"""Confidence as a transparent data-quality index.

The index starts from a ceiling below 100, because the model is not calibrated against measured falaj
discharge, and loses itemised points for missing, stale or substituted inputs and for lead time.
It is a heuristic for "how much should I trust this", shown with its reasons. It is not a probability.
"""
from __future__ import annotations

from .params import ModelParams
from .state import StateEstimate
from .telemetry import Telemetry

UNCALIBRATED_CEILING = 75
LEAD_PENALTY_PER_DAY = 1.2
LEAD_PENALTY_CAP = 20
METHOD_NOTE = "Heuristic data-quality index (0–100) with itemised reasons. Not a statistical probability."


def grade(index: float) -> str:
    return "HIGH" if index >= 70 else "MODERATE" if index >= 45 else "LOW"


def _factor(key: str, label: str, status: str, impact: float, detail: str) -> dict:
    return {"key": key, "label": label, "status": status, "impact": int(round(impact)), "detail": detail}


def system_factors(t: Telemetry, state: StateEstimate, weather: dict, extended_days: int) -> list[dict]:
    f: list[dict] = []
    mode, status = weather.get("mode"), weather.get("status")
    if mode == "live" and status == "ok":
        f.append(_factor("weather", "Weather forecast", "ok", 0, "Live Meteomatics data."))
    elif mode == "live":
        f.append(_factor("weather", "Weather forecast", "degraded", -6, weather.get("notice") or "Serving an older Meteomatics response."))
    else:
        f.append(_factor("weather", "Weather forecast", "missing", -20, "Synthetic DEMO weather is in use: demand is not driven by real forecast data."))
    if extended_days:
        f.append(_factor("weather_horizon", "Weather horizon", "degraded", -min(6, extended_days),
                         f"{extended_days} forecast day(s) are beyond the provider's data and were extended."))

    level = t.sensors["S-GW-01"]
    if state.basis == "level_sensor" and level.status == "ok":
        f.append(_factor("source_level", "Mother well level", "ok", 0, "S-GW-01 reporting; 7-day trend fitted."))
    elif state.basis == "level_sensor":
        f.append(_factor("source_level", "Mother well level", "degraded", -8, f"S-GW-01 is stale ({state.data_age_h:.1f} h old); trend extrapolated to now."))
    elif state.basis == "flow_derived":
        f.append(_factor("source_level", "Mother well level", "missing", -16,
                         f"S-GW-01 is {level.status}. Source head is inferred from the main flume and depends on assumed conductance."))
    else:
        f.append(_factor("source_level", "Mother well level", "missing", -30,
                         f"No current source observation. Starting state carried forward from data {state.data_age_h:.0f} h old."))

    flume = t.sensors["S-FL-MAIN"]
    if flume.status == "ok":
        f.append(_factor("main_flow", "Main channel flume", "ok", 0, "S-FL-MAIN reporting."))
    elif flume.status == "stale":
        f.append(_factor("main_flow", "Main channel flume", "degraded", -5, "S-FL-MAIN is stale."))
    else:
        f.append(_factor("main_flow", "Main channel flume", "missing", -10, f"S-FL-MAIN is {flume.status}: today's flow is modelled from the well level, not observed."))

    if state.corroborated_decline:
        f.append(_factor("corroboration", "Trend corroboration", "ok", 0, "Decline confirmed independently by the well level and the main flume."))
    elif state.trend_m_per_day < 0:
        f.append(_factor("corroboration", "Trend corroboration", "degraded", -5, "The decline is seen on one sensor only; no independent confirmation."))

    sat = t.satellite
    age = sat.get("latest_valid_age_days")
    if sat.get("latest_status") != "valid":
        f.append(_factor("satellite", "Vegetation index", "missing", -3 if age is not None and age <= 12 else -5,
                         "Latest pass is cloud-obscured: marked unavailable, not treated as zero."
                         + (f" Last valid pass {age:.0f} days ago." if age is not None else "")))
    elif age is not None and age > 8:
        f.append(_factor("satellite", "Vegetation index", "degraded", -2, f"Last valid pass is {age:.0f} days old."))
    else:
        f.append(_factor("satellite", "Vegetation index", "ok", 0, "Recent valid pass available (simulated feed)."))
    return f


def zone_factors(zone_id: str, branch_id: str, t: Telemetry) -> list[dict]:
    f: list[dict] = []
    gauge = t.sensors[f"S-FL-{branch_id}"]
    if gauge.status == "stale":
        f.append(_factor("branch_gauge", f"Branch {branch_id} gauge", "degraded", -4, f"S-FL-{branch_id} is stale: branch balance cannot be checked right now."))
    elif gauge.status != "ok":
        f.append(_factor("branch_gauge", f"Branch {branch_id} gauge", "missing", -8, f"S-FL-{branch_id} is {gauge.status}: branch flow is modelled, leakage cannot be checked."))
    outlet = t.sensors[f"S-OUT-{zone_id}"]
    if outlet.status == "stale":
        f.append(_factor("zone_outlet", f"{zone_id} outlet gauge", "degraded", -3, f"S-OUT-{zone_id} is stale."))
    elif outlet.status != "ok":
        f.append(_factor("zone_outlet", f"{zone_id} outlet gauge", "missing", -7, f"S-OUT-{zone_id} is {outlet.status}: delivery to this zone is modelled, not observed."))
    return f


def score(factors: list[dict], lead_days: float = 0.0) -> dict:
    """Combine deductions into an index, with lead-time decay and the structural ceiling."""
    lead = min(LEAD_PENALTY_CAP, LEAD_PENALTY_PER_DAY * max(0.0, lead_days))
    # Deductions come off the ceiling, not off 100, so every missing input is visible in the result.
    index = int(round(max(5, UNCALIBRATED_CEILING + sum(x["impact"] for x in factors) - lead)))
    listed = [x for x in factors if x["impact"] != 0]
    ok = [x for x in factors if x["impact"] == 0]
    if lead >= 1:
        listed.append(_factor("lead_time", "Lead time", "degraded", -lead, f"Looking {lead_days:.0f} days ahead: weather and source assumptions drift with lead time."))
    limit = _factor("calibration", "Model calibration", "limit", 0,
                    f"Starts from a ceiling of {UNCALIBRATED_CEILING}, not 100: the model is not calibrated against measured falaj discharge.")
    return {"index": index, "grade": grade(index), "factors": listed + [limit], "supporting": ok, "method": METHOD_NOTE}


def per_day(factors: list[dict], days: int) -> list[dict]:
    out = []
    for d in range(days):
        s = score(factors, d)
        out.append({"index": s["index"], "grade": s["grade"]})
    return out


def build(params: ModelParams, t: Telemetry, state: StateEstimate, weather: dict, extended_days: int, days: int) -> dict:
    sys_f = system_factors(t, state, weather, extended_days)
    zones = {}
    for z in params.zones:
        zf = sys_f + zone_factors(z.id, z.branch, t)
        zones[z.id] = {"now": score(zf, 0), "by_day": per_day(zf, days), "_factors": zf}
    return {"system": {"now": score(sys_f, 0), "by_day": per_day(sys_f, days), "_factors": sys_f}, "zones": zones, "method": METHOD_NOTE}
