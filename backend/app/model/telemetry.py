"""SIMULATED sensor network for a representative Al Ain falaj.

There is no live falaj telemetry available to this project, so the readings are synthesised. To keep them
internally consistent they are produced by running the same hydraulic routing on a hidden "truth" scenario
(a receding source plus a developing leak) and sampling it with sensor noise, gaps and one bad reading.
Every value produced here carries provenance="simulated" and is never presented as a measurement.

Health is not read from the fault labels: it is classified from the data itself (reading age, flat-lined
values, outliers), exactly as it would have to be with real sensors.
"""
from __future__ import annotations

import json
import warnings
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..config import SETTINGS, UAE_TZ
from ..geo import build_geography
from .hydraulics import route, source_discharge
from .params import ModelParams

INTERVAL_MIN = 60
STALE_AFTER_MIN = 90  # a reading older than 1.5 intervals is stale
OFFLINE_AFTER_MIN = 360  # no reading for 6 h: treat the sensor as failed
STUCK_RUN = 6  # identical consecutive readings that indicate a frozen sensor
HISTORY_DAYS = 30
HOURLY_WINDOW_H = 72
DAILY_WINDOW_D = 14

DEFAULT_FAULTS = {"S-OUT-Z2": "offline", "S-FL-B": "stale"}
FAULT_GAP_HOURS = {"offline": 11, "stale": 3}
FAULT_MODES = ("ok", "stale", "offline", "stuck")
SATELLITE_ID = "S2-NDVI"


@dataclass(frozen=True)
class TruthScenario:
    """Hidden state used only to generate simulated readings. The forecast model never reads it."""

    onset_days_before_anchor: float = 16.0
    head_before_m: float = 1.57
    head_equilibrium_m: float = 0.35
    recession_tau_days: float = 40.0
    conductance_factor: float = 1.02
    tunnel_loss_per_km: float = 0.009
    leak_branch: str = "C"
    leak_start_days_before_anchor: float = 4.5
    leak_ramp_days: float = 2.0
    leak_fraction: float = 0.085
    outlier_sensor: str = "S-FL-MAIN"
    outlier_hours_before_anchor: float = 26.0
    outlier_factor: float = 0.55


@dataclass(frozen=True)
class SensorDef:
    id: str
    kind: str  # level | flow
    label: str
    unit: str
    component: str  # source | main | branch:A | zone:Z1
    noise_rel: float
    noise_abs: float
    lon: float
    lat: float


@dataclass
class SensorSeries:
    definition: SensorDef
    times: np.ndarray  # hours since series start (float)
    values: np.ndarray  # NaN where missing or rejected
    raw: np.ndarray  # as transmitted (NaN where missing)
    rejected: np.ndarray  # bool mask of outlier-rejected readings
    status: str = "ok"
    age_min: float | None = None
    last_value: float | None = None
    last_index: int | None = None
    stuck_from: int | None = None


@dataclass
class Telemetry:
    as_of: datetime
    start: datetime
    hours: np.ndarray
    sensors: dict[str, SensorSeries]
    faults: dict[str, str]
    satellite: dict = field(default_factory=dict)

    def time_at(self, idx: int) -> datetime:
        return self.start + timedelta(hours=float(self.hours[idx]))


def sensor_definitions(params: ModelParams) -> list[SensorDef]:
    geo = build_geography()
    net = geo["network"]
    defs = [
        SensorDef("S-GW-01", "level", "Mother well water level", "m", "source", 0.0, 0.006, *net["mother_well"]),
        SensorDef("S-FL-MAIN", "flow", "Main channel flume at the shari'a", "L/s", "main", 0.015, 0.0, *net["sharia"]),
    ]
    for b in params.branches:
        defs.append(SensorDef(f"S-FL-{b.id}", "flow", f"{b.name} gauge", "L/s", f"branch:{b.id}", 0.02, 0.0, *net["branch_heads"][b.id]))
    centroids = {z["id"]: z["centroid"] for z in geo["zones"]}
    for z in params.zones:
        c = centroids[z.id]
        defs.append(SensorDef(f"S-OUT-{z.id}", "flow", f"{z.id} outlet gauge", "L/s", f"zone:{z.id}", 0.025, 0.0, c["lon"], c["lat"]))
    return defs


def _anchor_dt(anchor: date) -> datetime:
    return datetime(anchor.year, anchor.month, anchor.day, tzinfo=UAE_TZ)


def truth_head(hours_from_anchor: np.ndarray, truth: TruthScenario) -> np.ndarray:
    """Water-table head above the tunnel invert (m): steady, then an exponential recession."""
    since_onset = hours_from_anchor / 24.0 + truth.onset_days_before_anchor
    decay = np.exp(-np.clip(since_onset, 0.0, None) / truth.recession_tau_days)
    return truth.head_equilibrium_m + (truth.head_before_m - truth.head_equilibrium_m) * decay


def truth_leak(hours_from_anchor: np.ndarray, truth: TruthScenario) -> np.ndarray:
    since = hours_from_anchor / 24.0 + truth.leak_start_days_before_anchor
    return truth.leak_fraction * np.clip(since / truth.leak_ramp_days, 0.0, 1.0)


def truth_flows(hours_from_anchor: np.ndarray, params: ModelParams, truth: TruthScenario) -> dict[str, np.ndarray]:
    """True value at every sensor location for each hour."""
    from dataclasses import replace

    true_params = replace(params, channels=replace(params.channels, tunnel_loss_per_km=truth.tunnel_loss_per_km))
    head = truth_head(hours_from_anchor, truth)
    q = source_discharge(head, params.source.conductance_lps_per_m * truth.conductance_factor)
    leak = truth_leak(hours_from_anchor, truth)
    out = {"S-GW-01": head}
    b_idx = params.branch_index(truth.leak_branch)
    # Leak varies in time, so route each distinct leak level; hours without a leak share one call.
    excess = np.zeros((len(hours_from_anchor), len(params.branches)))
    excess[:, b_idx] = leak
    main = np.empty_like(q)
    branch = np.empty((len(q), len(params.branches)))
    zone = np.empty((len(q), len(params.zones)))
    for value in np.unique(leak):
        mask = leak == value
        ex = np.zeros(len(params.branches))
        ex[b_idx] = value
        r = route(q[mask], true_params, branch_excess_loss=ex)
        main[mask], branch[mask], zone[mask] = r.q_sharia, r.branch_in, r.zone_delivered
    out["S-FL-MAIN"] = main
    for i, b in enumerate(params.branches):
        out[f"S-FL-{b.id}"] = branch[:, i]
    for i, z in enumerate(params.zones):
        out[f"S-OUT-{z.id}"] = zone[:, i]
    return out


def _noise(sensor_id: str, n: int) -> np.ndarray:
    rng = np.random.default_rng(zlib.crc32(sensor_id.encode()))
    return rng.standard_normal(n)


def hampel_mask(values: np.ndarray, half_window: int = 12, n_sigma: float = 6.0, floor_rel: float = 0.10) -> np.ndarray:
    """True where a reading is an outlier against the rolling median of its neighbours."""
    n = len(values)
    if n == 0:
        return np.zeros(0, dtype=bool)
    padded = np.concatenate([np.full(half_window, np.nan), values, np.full(half_window, np.nan)])
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * half_window + 1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # windows that are entirely missing
        med = np.nanmedian(windows, axis=1)
        mad = np.nanmedian(np.abs(windows - med[:, None]), axis=1)
    threshold = np.maximum(n_sigma * 1.4826 * mad, floor_rel * np.abs(med))
    with np.errstate(invalid="ignore"):
        return np.abs(values - med) > threshold


def parse_faults(spec: str | None) -> dict[str, str]:
    """`None` -> default demo faults; "none" -> no faults; otherwise "S-GW-01:offline,S-FL-B:stale"."""
    if spec is None:
        return dict(DEFAULT_FAULTS)
    spec = spec.strip()
    if spec in {"", "none"}:
        return {}
    out = {}
    for part in spec.split(","):
        sid, _, mode = part.partition(":")
        sid, mode = sid.strip(), (mode.strip() or "offline")
        if sid and mode in FAULT_MODES and mode != "ok":
            out[sid] = mode
    return out


def generate(
    params: ModelParams,
    as_of: datetime,
    faults: dict[str, str] | None = None,
    *,
    anchor: date | None = None,
    truth: TruthScenario | None = None,
    extra_outliers: dict[str, list[tuple[float, float]]] | None = None,
) -> Telemetry:
    """Build the simulated telemetry visible at `as_of`.

    extra_outliers: {sensor_id: [(hours_before_as_of, factor)]}, used by tests to inject bad readings.
    """
    truth = truth or TruthScenario()
    faults = dict(DEFAULT_FAULTS) if faults is None else faults
    anchor_dt = _anchor_dt(anchor or SETTINGS.sim_anchor)
    start = anchor_dt - timedelta(days=HISTORY_DAYS)
    last_hour = as_of.astimezone(UAE_TZ).replace(minute=0, second=0, microsecond=0)
    n = int((last_hour - start).total_seconds() // 3600) + 1
    n = max(n, 48)
    hours = np.arange(n, dtype=float)
    from_anchor = hours - HISTORY_DAYS * 24.0
    true = truth_flows(from_anchor, params, truth)

    sensors: dict[str, SensorSeries] = {}
    for d in sensor_definitions(params):
        z = np.resize(_noise(d.id, 24 * (HISTORY_DAYS + 20)), n)
        raw = true[d.id] * (1.0 + d.noise_rel * z) + d.noise_abs * z
        raw = np.round(raw, 3 if d.kind == "level" else 2)

        if d.id == truth.outlier_sensor:
            k = int(round(HISTORY_DAYS * 24 - truth.outlier_hours_before_anchor))
            if 0 <= k < n:
                raw[k] = round(raw[k] * truth.outlier_factor, 2)
        for hours_before, factor in (extra_outliers or {}).get(d.id, []):
            k = n - 1 - int(round(hours_before))
            if 0 <= k < n:
                raw[k] = raw[k] * factor

        mode = faults.get(d.id)
        if mode in FAULT_GAP_HOURS:
            raw[n - FAULT_GAP_HOURS[mode]:] = np.nan
        elif mode == "stuck":
            raw[n - 10:] = raw[n - 11]

        sensors[d.id] = _classify(d, hours, raw, as_of, start)

    return Telemetry(
        as_of=as_of,
        start=start,
        hours=hours,
        sensors=sensors,
        faults=faults,
        satellite=_vegetation(params, as_of),
    )


def _classify(d: SensorDef, hours: np.ndarray, raw: np.ndarray, as_of: datetime, start: datetime) -> SensorSeries:
    values = raw.copy()
    rejected = hampel_mask(values)
    values[rejected] = np.nan

    stuck_from = None
    valid_idx = np.flatnonzero(~np.isnan(raw))
    if len(valid_idx) >= STUCK_RUN:
        tail = raw[valid_idx[-STUCK_RUN:]]
        if np.ptp(tail) == 0.0:
            run_value = tail[-1]
            i = len(valid_idx) - 1
            while i > 0 and raw[valid_idx[i - 1]] == run_value:
                i -= 1
            stuck_from = int(valid_idx[i]) + 1  # the first repeat is the first untrustworthy reading
            values[stuck_from:] = np.nan

    series = SensorSeries(definition=d, times=hours, values=values, raw=raw, rejected=rejected, stuck_from=stuck_from)
    if len(valid_idx) == 0:
        series.status = "offline"
        return series
    last = int(valid_idx[-1])
    last_time = start + timedelta(hours=float(hours[last]))
    series.age_min = max(0.0, (as_of - last_time).total_seconds() / 60.0)
    series.last_index = last
    series.last_value = float(raw[last])
    if series.age_min > OFFLINE_AFTER_MIN:
        series.status = "offline"
    elif stuck_from is not None:
        series.status = "stuck"
    elif series.age_min > STALE_AFTER_MIN:
        series.status = "stale"
    return series


_S2_FILE = Path(__file__).resolve().parent.parent / "data" / "sentinel2_ndvi.json"


@lru_cache(maxsize=1)
def _sentinel2() -> dict | None:
    try:
        return json.loads(_S2_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _vegetation(params: ModelParams, as_of: datetime) -> dict:
    """OBSERVED vegetation index: per-zone NDVI from Copernicus Sentinel-2 L2A (see scripts/fetch_sentinel2.py).

    Only passes acquired before `as_of` are used. A pass whose zone pixels were cloud, shadow or cirrus is
    reported as unavailable for that zone, never as zero. NDVI describes canopy condition only: it says
    nothing about groundwater level.
    """
    data = _sentinel2()
    base = {"id": SATELLITE_ID, "label": "Vegetation index (NDVI) · Sentinel-2 L2A", "revisit_days": 5}
    if not data:
        return {**base, "provenance": "unavailable", "note": "Sentinel-2 extract not found; vegetation index unavailable.",
                "passes": [], "latest_valid_age_days": None, "latest_status": "unavailable"}
    zone_ids = [z.id for z in params.zones]
    passes = []
    for raw in data.get("passes", []):
        when = datetime.fromisoformat(raw["time"].replace("Z", "+00:00"))
        if when > as_of:
            continue
        zones = {zid: raw["zones"].get(zid) for zid in zone_ids}
        passes.append({"time": when.astimezone(timezone.utc).isoformat(), "status": raw["status"], "zones": zones,
                       "oasis": raw.get("oasis"), "scene_cloud_pct": raw.get("scene_cloud_pct")})
    passes = passes[-40:]
    valid = [p for p in passes if p["status"] == "valid"]
    age = None
    if valid:
        age = (as_of - datetime.fromisoformat(valid[-1]["time"])).total_seconds() / 86400.0

    def change(zid: str, days: float) -> float | None:
        """NDVI change for a zone between the latest clear value and the clear value nearest `days` earlier."""
        series = [(datetime.fromisoformat(p["time"]), p["zones"][zid]) for p in passes if p["zones"].get(zid) is not None]
        if len(series) < 2:
            return None
        t_last, v_last = series[-1]
        target = t_last - timedelta(days=days)
        t_ref, v_ref = min(series[:-1], key=lambda tv: abs((tv[0] - target).total_seconds()))
        return round(v_last - v_ref, 3) if abs((t_ref - target).days) <= 8 else None

    return {
        **base,
        "provenance": "observed",
        "source": data.get("source"),
        "licence": data.get("licence"),
        "method": data.get("method"),
        "note": data.get("note"),
        "retrieved_at": data.get("retrieved_at"),
        "passes": passes,
        "latest_valid_age_days": None if age is None else round(age, 1),
        "latest_status": passes[-1]["status"] if passes else "unavailable",
        "change_30d": {zid: change(zid, 30) for zid in zone_ids},
    }


def _fmt_age(minutes: float | None) -> str:
    if minutes is None:
        return "no readings received"
    h, m = divmod(int(round(minutes)), 60)
    return f"{h} h {m:02d} min ago" if h else f"{m} min ago"


def to_public(t: Telemetry) -> dict:
    """Serialise for the API. Missing readings are null, not zero."""
    n = len(t.hours)
    out = []
    lo = max(0, n - HOURLY_WINDOW_H)
    for s in t.sensors.values():
        d = s.definition
        recent = s.values[max(0, n - 24):]
        rej_idx = np.flatnonzero(s.rejected[max(0, n - 48):]) + max(0, n - 48)
        daily = []
        end_day = t.as_of.astimezone(UAE_TZ).date()
        for back in range(DAILY_WINDOW_D, -1, -1):
            day = end_day - timedelta(days=back)
            day_start = datetime(day.year, day.month, day.day, tzinfo=UAE_TZ)
            i0 = int((day_start - t.start).total_seconds() // 3600)
            chunk = s.values[max(0, i0): max(0, min(n, i0 + 24))]
            valid = chunk[~np.isnan(chunk)]
            expected = max(1, min(n, i0 + 24) - max(0, i0))
            # a daily mean needs at least half the expected readings; otherwise the day is a gap
            daily.append({"date": day.isoformat(), "mean": round(float(valid.mean()), 3) if len(valid) >= max(3, expected // 2) else None, "n": int(len(valid))})
        detail = {
            "ok": f"Reporting normally · last reading {_fmt_age(s.age_min)}",
            "stale": f"Stale · last reading {_fmt_age(s.age_min)} (expected every {INTERVAL_MIN} min)",
            "offline": f"Offline · last reading {_fmt_age(s.age_min)}",
            "stuck": f"Suspected frozen sensor · value unchanged for {0 if s.stuck_from is None else n - s.stuck_from + 1} readings",
        }[s.status]
        out.append(
            {
                "id": d.id,
                "kind": d.kind,
                "label": d.label,
                "unit": d.unit,
                "component": d.component,
                "lon": d.lon,
                "lat": d.lat,
                "provenance": "simulated",
                "interval_min": INTERVAL_MIN,
                "status": s.status,
                "status_detail": detail,
                "injected_fault": t.faults.get(d.id),
                "last_value": s.last_value,
                "last_time": None if s.last_index is None else t.time_at(s.last_index).astimezone(timezone.utc).isoformat(),
                "age_min": None if s.age_min is None else round(s.age_min, 1),
                "valid_24h": int(np.count_nonzero(~np.isnan(recent))),
                "expected_24h": int(len(recent)),
                "rejected": [
                    {"time": t.time_at(int(i)).astimezone(timezone.utc).isoformat(), "value": float(s.raw[i]), "reason": "outlier vs rolling median"}
                    for i in rej_idx
                ],
                "hourly": {
                    "start": t.time_at(lo).astimezone(timezone.utc).isoformat(),
                    "values": [None if np.isnan(v) else float(v) for v in s.values[lo:]],
                },
                "daily": daily,
            }
        )
    counts = {k: sum(1 for s in out if s["status"] == k) for k in ("ok", "stale", "offline", "stuck")}
    return {
        "provenance": "simulated",
        "label": "SIMULATED SENSOR NETWORK",
        "note": (
            "No live falaj telemetry is connected. These readings are synthesised by a hidden scenario run through "
            "the same hydraulic model, with sensor noise, gaps and faults. They are not measurements."
        ),
        "as_of": t.as_of.astimezone(timezone.utc).isoformat(),
        "sensors": out,
        "health": counts,
        "faults": t.faults,
        "fault_modes": list(FAULT_MODES),
        "satellite": t.satellite,
    }
