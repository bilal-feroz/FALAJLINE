"""Build backend/app/data/sentinel2_ndvi.json: real per-zone NDVI from Sentinel-2 L2A.

Source: Copernicus Sentinel-2 Level-2A, served as Cloud-Optimised GeoTIFFs by the Element 84 Earth Search
STAC API on AWS Open Data (no account needed). For every scene over Al Ain Oasis it reads small windows of the
red (B04), near-infrared (B08) and scene-classification (SCL) bands and computes the mean NDVI of each farm
zone over pixels that are not cloud, cloud shadow, cirrus or no-data. A zone with too few clear pixels is
recorded as unavailable for that pass, never as zero.

NDVI describes canopy condition only. It is never used as a measure of groundwater.

Run from the backend folder (needs rasterio, see requirements-data.txt):
    .venv/Scripts/python scripts/fetch_sentinel2.py [--since 2026-05-01]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF,.tiff")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")

import rasterio  # noqa: E402
from rasterio.enums import Resampling  # noqa: E402
from rasterio.features import rasterize  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402

from app.geo import build_geography  # noqa: E402

STAC = "https://earth-search.aws.element84.com/v1/search"
OUT = ROOT / "app" / "data" / "sentinel2_ndvi.json"
INVALID_SCL = {0, 1, 3, 8, 9, 10, 11}  # no data, defective, cloud shadow, cloud medium/high, cirrus, snow
MIN_CLEAR = 0.6


def search(bbox: list[float], since: str, until: str) -> list[dict]:
    items: list[dict] = []
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "datetime": f"{since}/{until}", "limit": 100, "sortby": [{"field": "properties.datetime", "direction": "asc"}]}
    url = STAC
    with httpx.Client(timeout=60) as client:
        while True:
            r = client.post(url, json=body)
            r.raise_for_status()
            page = r.json()
            items += page.get("features", [])
            nxt = next((link for link in page.get("links", []) if link.get("rel") == "next"), None)
            if not nxt or not nxt.get("body"):
                break
            body = nxt["body"]
    # one entry per acquisition (the same pass can be listed under reprocessed ids)
    seen: dict[str, dict] = {}
    for it in items:
        key = it["properties"]["datetime"][:16]
        if key not in seen or it["id"] > seen[key]["id"]:
            seen[key] = it
    return [seen[k] for k in sorted(seen)]


def band_scale(asset: dict) -> tuple[float, float]:
    rb = (asset.get("raster:bands") or [{}])[0]
    return float(rb.get("scale", 0.0001)), float(rb.get("offset", 0.0))


def process(item: dict, zones: list[dict], oasis_ring: list[list[float]]) -> dict:
    props = item["properties"]
    assets = item["assets"]
    epsg = props.get("proj:epsg") or int(str(props.get("proj:code", "EPSG:32640")).split(":")[1])
    crs = f"EPSG:{epsg}"
    geoms = {z["id"]: transform_geom("EPSG:4326", crs, {"type": "Polygon", "coordinates": [z["polygon"]]}) for z in zones}
    oasis = transform_geom("EPSG:4326", crs, {"type": "Polygon", "coordinates": [oasis_ring]})
    xs = [p[0] for p in oasis["coordinates"][0]]
    ys = [p[1] for p in oasis["coordinates"][0]]
    bounds = (min(xs) - 60, min(ys) - 60, max(xs) + 60, max(ys) + 60)

    def read(key: str, shape: tuple[int, int] | None = None, resampling=Resampling.nearest):
        with rasterio.open(assets[key]["href"]) as src:
            win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
            data = src.read(1, window=win, out_shape=shape, resampling=resampling, boundless=True, fill_value=0)
            return data, src.window_transform(win), win

    red, transform, _ = read("red")
    nir, _, _ = read("nir", shape=red.shape)
    scl, _, _ = read("scl", shape=red.shape)
    rs, ro = band_scale(assets["red"])
    ns, no = band_scale(assets["nir"])
    if props.get("earthsearch:boa_offset_applied"):
        # Earth Search has already removed the L2A +1000 DN offset; the listed offset must not be applied twice.
        ro = no = 0.0
    r = red.astype("float64") * rs + ro
    n = nir.astype("float64") * ns + no
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (n - r) / (n + r)
    clear = ~np.isin(scl, list(INVALID_SCL)) & (red > 0) & (nir > 0) & np.isfinite(ndvi)

    out_zones: dict[str, float | None] = {}
    clear_frac: dict[str, float] = {}
    for z in zones:
        mask = rasterize([(geoms[z["id"]], 1)], out_shape=red.shape, transform=transform, fill=0, dtype="uint8").astype(bool)
        total = int(mask.sum())
        ok = mask & clear
        frac = ok.sum() / total if total else 0.0
        clear_frac[z["id"]] = round(float(frac), 3)
        out_zones[z["id"]] = round(float(np.nanmean(ndvi[ok])), 3) if total and frac >= MIN_CLEAR else None
    omask = rasterize([(oasis, 1)], out_shape=red.shape, transform=transform, fill=0, dtype="uint8").astype(bool)
    ook = omask & clear
    ofrac = ook.sum() / omask.sum() if omask.sum() else 0.0
    valid_zones = sum(v is not None for v in out_zones.values())
    status = "valid" if valid_zones == len(zones) else "cloud_obscured" if valid_zones == 0 else "partial"
    return {
        "time": props["datetime"],
        "item": item["id"],
        "platform": props.get("platform"),
        "scene_cloud_pct": round(float(props.get("eo:cloud_cover", 0.0)), 1),
        "oasis_clear_frac": round(float(ofrac), 3),
        "status": status,
        "oasis": round(float(np.nanmean(ndvi[ook])), 3) if ofrac >= MIN_CLEAR else None,
        "zones": out_zones,
        "zone_clear_frac": clear_frac,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-05-01")
    args = ap.parse_args()
    geo = build_geography()
    zones = geo["zones"]
    ring = geo["oasis"]["outline"]
    w, s, e, n = geo["oasis"]["bbox"]
    until = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    items = search([w, s, e, n], f"{args.since}T00:00:00Z", until)
    print(f"{len(items)} scenes since {args.since}")

    def safe(it):
        try:
            return process(it, zones, ring)
        except Exception as exc:  # a scene that cannot be read is skipped, not invented
            print("  skip", it["id"], type(exc).__name__, str(exc)[:120])
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        passes = [p for p in pool.map(safe, items) if p]
    passes.sort(key=lambda p: p["time"])
    for p in passes:
        print(" ", p["time"][:10], p["status"].ljust(14), "oasis", p["oasis"], "clear", p["oasis_clear_frac"], p["zones"])
    payload = {
        "source": "Copernicus Sentinel-2 Level-2A, via Element 84 Earth Search (AWS Open Data)",
        "licence": "Contains modified Copernicus Sentinel data, free and open (Copernicus data policy)",
        "method": "Mean NDVI (B08-B04)/(B08+B04) over each zone's clear pixels; scene classification removes cloud, shadow and cirrus. "
                  f"A zone with under {int(MIN_CLEAR * 100)}% clear pixels is unavailable for that pass.",
        "note": "NDVI describes canopy condition only. It is not a measure of groundwater.",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "since": args.since,
        "passes": passes,
    }
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print("wrote", OUT, len(passes), "passes")


if __name__ == "__main__":
    main()
