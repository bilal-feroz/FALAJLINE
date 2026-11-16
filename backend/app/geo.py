"""Geographic context for Al Ain Oasis.

What is real here: the oasis outline (OpenStreetMap way 96620970) and the coordinates derived from it.
What is conceptual: the farm-zone partition, the falaj alignment, the mother-well position and every sensor
position. They are a representative engineering reconstruction, not a survey of protected heritage
infrastructure, and are labelled as such everywhere they are shown.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

# Al Ain Oasis, Abu Dhabi Emirate, UAE (centroid of the OSM outline).
OASIS_CENTER = {"lat": 24.2148, "lon": 55.7679}
OASIS_ELEVATION_M = 292.0

# Representative upstream recharge area: alluvial piedmont of the Hajar mountains east of Al Ain.
# A point chosen to sample upstream weather, not a surveyed catchment boundary.
RECHARGE_AREA = {"lat": 24.27, "lon": 55.98, "elevation_m": 520.0}

WEATHER_LOCATIONS = [
    {
        "id": "oasis",
        "name": "Al Ain Oasis",
        "role": "Irrigation demand (evapotranspiration over the palm groves)",
        "lat": 24.2171,
        "lon": 55.7666,
        "elevation_m": OASIS_ELEVATION_M,
        "real_location": True,
    },
    {
        "id": "recharge",
        "name": "Hajar piedmont recharge area (representative)",
        "role": "Upstream rainfall that can recharge the aquifer feeding the falaj",
        "lat": RECHARGE_AREA["lat"],
        "lon": RECHARGE_AREA["lon"],
        "elevation_m": RECHARGE_AREA["elevation_m"],
        "real_location": True,
    },
]

# Six representative farm zones: seeds expressed as fractions of the oasis bounding box (x: W->E, y: S->N).
# The falaj is taken to surface at the south-eastern tip of the oasis; each branch serves a head zone and then
# a tail zone further along the channel.
SHARIA_FRAC = (0.97, 0.36)
DIVIDER_FRAC = (0.70, 0.45)
ZONE_SEEDS = [
    {"id": "Z1", "name": "North Grove · Head", "branch": "A", "fx": 0.56, "fy": 0.72},
    {"id": "Z2", "name": "North Grove · Tail", "branch": "A", "fx": 0.34, "fy": 0.84},
    {"id": "Z3", "name": "West Grove · Head", "branch": "B", "fx": 0.40, "fy": 0.56},
    {"id": "Z4", "name": "West Grove · Tail", "branch": "B", "fx": 0.13, "fy": 0.52},
    {"id": "Z5", "name": "South Grove · Head", "branch": "C", "fx": 0.80, "fy": 0.34},
    {"id": "Z6", "name": "South Grove · Tail", "branch": "C", "fx": 0.74, "fy": 0.14},
]

# Conceptual falaj alignment: bearing and distance of the mother well from the point where the falaj surfaces.
MOTHER_WELL_BEARING_DEG = 108.0
TUNNEL_LENGTH_KM = 3.4


def _project(lon: float, lat: float, lat0: float) -> tuple[float, float]:
    return lon * 111_320.0 * math.cos(math.radians(lat0)), lat * 110_574.0


def _unproject(x: float, y: float, lat0: float) -> tuple[float, float]:
    return x / (111_320.0 * math.cos(math.radians(lat0))), y / 110_574.0


def _area(poly: list[tuple[float, float]]) -> float:
    n = len(poly)
    return abs(sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))) / 2.0


def _centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(poly)
    a = cx = cy = 0.0
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-9:
        return poly[0]
    return cx / (3 * a), cy / (3 * a)


def _clip_half_plane(poly, p, q):
    """Keep the part of `poly` closer to seed p than to seed q (Sutherland–Hodgman against one half-plane)."""
    mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    nx, ny = q[0] - p[0], q[1] - p[1]

    def side(pt):
        return (pt[0] - mx) * nx + (pt[1] - my) * ny  # <= 0 means on p's side

    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        sa, sb = side(a), side(b)
        if sa <= 0:
            out.append(a)
        if (sa < 0 < sb) or (sb < 0 < sa):
            t = sa / (sa - sb)
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def _offset(lon: float, lat: float, bearing_deg: float, dist_m: float) -> tuple[float, float]:
    b = math.radians(bearing_deg)
    dlat = dist_m * math.cos(b) / 110_574.0
    dlon = dist_m * math.sin(b) / (111_320.0 * math.cos(math.radians(lat)))
    return lon + dlon, lat + dlat


@lru_cache(maxsize=1)
def build_geography() -> dict:
    """Oasis outline (real), plus the conceptual zone partition and network alignment derived from it."""
    feature = json.loads((DATA_DIR / "al_ain_oasis.geojson").read_text(encoding="utf-8"))
    ring = feature["geometry"]["coordinates"][0]
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    lat0 = (south + north) / 2
    poly = [_project(lon, lat, lat0) for lon, lat in ring]

    seeds = []
    for z in ZONE_SEEDS:
        lon = west + z["fx"] * (east - west)
        lat = south + z["fy"] * (north - south)
        seeds.append(_project(lon, lat, lat0))

    zones = []
    for i, z in enumerate(ZONE_SEEDS):
        cell = poly
        for j, other in enumerate(seeds):
            if i != j and len(cell) >= 3:
                cell = _clip_half_plane(cell, seeds[i], other)
        cx, cy = _centroid(cell)
        clon, clat = _unproject(cx, cy, lat0)
        coords = [list(map(lambda v: round(v, 6), _unproject(x, y, lat0))) for x, y in cell]
        coords.append(coords[0])
        zones.append(
            {
                "id": z["id"],
                "name": z["name"],
                "branch": z["branch"],
                "area_ha": round(_area(cell) / 1e4, 1),
                "centroid": {"lat": round(clat, 6), "lon": round(clon, 6)},
                "polygon": coords,
            }
        )

    # Network alignment (conceptual). The falaj surfaces (the shari'a) at the south-eastern tip of the oasis.
    sharia = (west + SHARIA_FRAC[0] * (east - west), south + SHARIA_FRAC[1] * (north - south))
    divider = (west + DIVIDER_FRAC[0] * (east - west), south + DIVIDER_FRAC[1] * (north - south))
    well = _offset(sharia[0], sharia[1], MOTHER_WELL_BEARING_DEG, TUNNEL_LENGTH_KM * 1000)

    shafts = []
    n_shafts = 9
    for k in range(1, n_shafts + 1):
        t = k / (n_shafts + 1)
        shafts.append([round(well[0] + t * (sharia[0] - well[0]), 6), round(well[1] + t * (sharia[1] - well[1]), 6)])

    by_branch: dict[str, list[dict]] = {}
    for z in zones:
        by_branch.setdefault(z["branch"], []).append(z)
    branch_lines = {}
    branch_heads = {}
    for bid, zs in by_branch.items():
        zs_sorted = sorted(zs, key=lambda z: (z["centroid"]["lon"] - divider[0]) ** 2 + (z["centroid"]["lat"] - divider[1]) ** 2)  # head first
        head = zs_sorted[0]["centroid"]
        line = [list(divider)] + [[z["centroid"]["lon"], z["centroid"]["lat"]] for z in zs_sorted]
        branch_lines[bid] = [[round(a, 6), round(b, 6)] for a, b in line]
        branch_heads[bid] = [
            round(divider[0] + 0.25 * (head["lon"] - divider[0]), 6),
            round(divider[1] + 0.25 * (head["lat"] - divider[1]), 6),
        ]

    return {
        "oasis": {
            "name": "Al Ain Oasis",
            "center": OASIS_CENTER,
            "bbox": [west, south, east, north],
            "area_ha": round(_area(poly) / 1e4, 1),
            "outline": [[round(a, 6), round(b, 6)] for a, b in ring] + [[round(ring[0][0], 6), round(ring[0][1], 6)]],
            "source": feature["properties"]["source"],
            "license": feature["properties"]["license"],
            "provenance": "observed",
        },
        "zones": zones,
        "network": {
            "provenance": "conceptual",
            "note": (
                "Conceptual engineering reconstruction of a representative falaj. Alignment, mother-well position, "
                "zone boundaries and sensor positions are illustrative and are not a survey of protected "
                "archaeological infrastructure."
            ),
            "mother_well": [round(well[0], 6), round(well[1], 6)],
            "sharia": [round(sharia[0], 6), round(sharia[1], 6)],
            "divider": [round(divider[0], 6), round(divider[1], 6)],
            "tunnel": [[round(well[0], 6), round(well[1], 6)], [round(sharia[0], 6), round(sharia[1], 6)]],
            "access_shafts": shafts,
            "main_channel": [[round(sharia[0], 6), round(sharia[1], 6)], [round(divider[0], 6), round(divider[1], 6)]],
            "branches": branch_lines,
            "branch_heads": branch_heads,
        },
        "recharge_area": {**RECHARGE_AREA, "name": WEATHER_LOCATIONS[1]["name"], "provenance": "representative"},
    }
