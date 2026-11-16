"""Assembles one consistent picture: weather -> telemetry -> state -> forecasts -> warnings.

Everything downstream of the weather bundle is a pure function of (time, fault profile, scenario settings),
so the same inputs always produce the same numbers and a timeline scrub in the UI needs no API calls.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from .config import SETTINGS, UAE_TZ
from .geo import build_geography
from .model import confidence as conf
from .model import forecast as fc
from .model import telemetry as tel
from .model import warnings as warn
from .model.params import ModelParams, Scenario, default_params, preset_scenarios
from .model.state import estimate_state
from .weather.service import get_weather

PROVENANCE_LEGEND = {
    "observed": "Real-world data from an external provider: Meteomatics weather, OpenStreetMap geography, EAD well locations.",
    "simulated": "Synthetic stand-in for field data that is not connected: the falaj sensor network, the vegetation index, demo weather.",
    "modelled": "Computed by the FALAJLINE model from the inputs above: forecasts, demand, risk states, gap-filled values.",
    "unavailable": "Missing. Shown as missing and never replaced by a number.",
}

DISCLAIMER = (
    "FALAJLINE is a hackathon prototype. The falaj network is a conceptual engineering reconstruction of a representative "
    "Al Ain falaj, its telemetry is simulated, and the model is not calibrated against measured falaj discharge."
)

_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
CACHE_TTL_S = 20.0


def _evaluate(params: ModelParams, weather: dict, as_of: datetime, faults: dict[str, str]):
    """Telemetry, state and baseline forecast as they would have been computed at `as_of`."""
    telemetry = tel.generate(params, as_of, faults)
    state = estimate_state(telemetry, params)
    inputs = fc.inputs_from_weather(weather, as_of.astimezone(UAE_TZ).date(), params)
    return telemetry, state, inputs


def compute(
    now: datetime | None = None,
    faults_spec: str | None = None,
    demand_reduction: float = 0.15,
    loss_reduction: float = 0.45,
    weather: dict | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    params = default_params()
    faults = tel.parse_faults(faults_spec)
    weather = weather or get_weather(now)

    telemetry, state, inputs = _evaluate(params, weather, now, faults)
    extended_days = int(inputs.extended.sum())
    confidence = conf.build(params, telemetry, state, weather, extended_days, len(inputs.dates))

    scenarios: dict[str, dict] = {}
    results: dict[str, fc.ForecastResult] = {}
    for sc in preset_scenarios(demand_reduction, loss_reduction):
        res = fc.run_forecast(params, state, inputs, sc)
        results[sc.id] = res
        pub = fc.to_public(res)
        pub["guidance"] = warn.day_guidance(res)
        pub["confidence"] = {"system": confidence["system"]["by_day"], "zones": {zid: z["by_day"] for zid, z in confidence["zones"].items()}}
        scenarios[sc.id] = pub

    # Persistence: what would the raw assessment have been one and two days ago?
    history = []
    for back in (2, 1):
        try:
            _, st_prev, in_prev = _evaluate(params, weather, now - timedelta(days=back), faults)
            history.append(fc.run_forecast(params, st_prev, in_prev, Scenario()).risk[0])
        except (ValueError, StopIteration):
            continue
    history.append(results["baseline"].risk[0])
    warnings = warn.build_warnings(params, results["baseline"], telemetry, confidence, history, now)

    base = scenarios["baseline"]
    comparison = []
    for sid, pub in scenarios.items():
        first = pub["system"]["first_shortfall_day"]
        base_first = base["system"]["first_shortfall_day"]
        comparison.append({
            "id": sid,
            "label": pub["scenario"]["label"],
            "description": pub["scenario"]["description"],
            "first_shortfall_day": first,
            "first_shortfall_date": pub["system"]["first_shortfall_date"],
            "days_gained": None if sid == "baseline" else (None if base_first is None else ((21 - base_first) if first is None else first - base_first)),
            "beyond_horizon": first is None,
            "zones_short_by_end": len(pub["system"]["zones_short"][-1]),
            "zones_ever_short": sum(1 for z in pub["zones"] if z["shortfall"]["predicted"]),
            "deficit_m3_total": pub["system"]["deficit_m3_total"],
            "end_ratio": pub["system"]["ratio"]["central"][-1],
            "min_zone_ratio": min(min(z["ratio"]["central"]) for z in pub["zones"]),
        })

    public_conf = {
        "method": confidence["method"],
        "system": confidence["system"]["now"],
        "zones": {zid: z["now"] for zid, z in confidence["zones"].items()},
    }
    local_now = now.astimezone(UAE_TZ)
    return {
        "meta": {
            "generated_at": now.astimezone(timezone.utc).isoformat(),
            "local_time": local_now.isoformat(),
            "timezone": "GST (UTC+4)",
            "today": local_now.date().isoformat(),
            "sim_anchor": SETTINGS.sim_anchor.isoformat(),
            "provenance_legend": PROVENANCE_LEGEND,
            "disclaimer": DISCLAIMER,
            "scenario_settings": {"demand_reduction": demand_reduction, "loss_reduction": loss_reduction},
        },
        "geo": build_geography(),
        "params": params.to_public(),
        "weather": weather,
        "telemetry": tel.to_public(telemetry),
        "state": state.to_public(),
        "confidence": public_conf,
        "scenarios": scenarios,
        "scenario_order": list(scenarios.keys()),
        "comparison": comparison,
        "warnings": warnings,
    }


def get_state(faults_spec: str | None = None, demand_reduction: float = 0.15, loss_reduction: float = 0.45) -> dict:
    """Cached wrapper used by the API so UI polling does not recompute or touch the weather API."""
    key = (faults_spec, round(demand_reduction, 3), round(loss_reduction, 3))
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_S:
            return hit[1]
    bundle = compute(faults_spec=faults_spec, demand_reduction=demand_reduction, loss_reduction=loss_reduction)
    with _cache_lock:
        _cache[key] = (now, bundle)
        for k in [k for k, (t, _) in _cache.items() if now - t > 300]:
            _cache.pop(k, None)
    return bundle


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
