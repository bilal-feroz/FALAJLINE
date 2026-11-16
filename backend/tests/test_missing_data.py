"""Missing, stale and bad data: detected, never turned into numbers, and always paid for in confidence."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np


from app import engine
from app.model import confidence as conf
from app.config import UAE_TZ
from app.model import forecast as fc
from app.model import telemetry as tel
from app.model.params import Scenario, default_params
from app.model.state import estimate_state
from app.model.warnings import apply_persistence

P = default_params()


def _run(now, weather, faults, **kw):
    t = tel.generate(P, now, faults, **kw)
    st = estimate_state(t, P)
    inp = fc.inputs_from_weather(weather, now.astimezone(UAE_TZ).date(), P)
    return t, st, fc.run_forecast(P, st, inp, Scenario())


# -- detection ----------------------------------------------------------------
def test_healthy_network_reports_ok(now):
    t = tel.generate(P, now, {})
    assert {s.status for s in t.sensors.values()} == {"ok"}


def test_stale_offline_and_frozen_sensors_are_detected_from_the_data(now):
    t = tel.generate(P, now, {"S-FL-B": "stale", "S-OUT-Z2": "offline", "S-OUT-Z4": "stuck"})
    assert t.sensors["S-FL-B"].status == "stale"
    assert t.sensors["S-OUT-Z2"].status == "offline"
    assert t.sensors["S-OUT-Z4"].status == "stuck"
    assert 90 < t.sensors["S-FL-B"].age_min <= 360 < t.sensors["S-OUT-Z2"].age_min
    # a frozen sensor still transmits, but its repeated values are not trusted
    stuck = t.sensors["S-OUT-Z4"]
    assert np.isnan(stuck.values[stuck.stuck_from:]).all() and not np.isnan(stuck.raw[-1])


def test_missing_readings_are_null_not_zero(now):
    pub = tel.to_public(tel.generate(P, now, {"S-OUT-Z2": "offline"}))
    s = next(x for x in pub["sensors"] if x["id"] == "S-OUT-Z2")
    gap = s["hourly"]["values"][-tel.FAULT_GAP_HOURS["offline"]:]
    assert all(v is None for v in gap)
    assert s["last_value"] and s["last_value"] > 0  # last real reading is kept, with its age
    assert s["valid_24h"] < s["expected_24h"]
    assert 0.0 not in [v for v in s["hourly"]["values"] if v is not None]


def test_day_with_too_few_readings_has_no_daily_mean(now):
    t = tel.generate(P, now, {})
    series = t.sensors["S-FL-MAIN"]
    series.values[-40:] = np.nan  # wipe today and most of yesterday
    pub = tel.to_public(t)
    daily = next(x for x in pub["sensors"] if x["id"] == "S-FL-MAIN")["daily"]
    assert daily[-1]["mean"] is None and daily[-3]["mean"] is not None


def test_real_sentinel2_ndvi_is_observed_and_plausible(now):
    sat = tel.generate(P, now, {}).satellite
    assert sat["provenance"] == "observed" and "Sentinel-2" in sat["source"]
    assert sat["passes"] and all(datetime.fromisoformat(p["time"]) <= now for p in sat["passes"])
    for p in sat["passes"]:
        if p["status"] == "valid":
            assert all(v is not None and 0.2 < v < 0.95 for v in p["zones"].values())


def test_cloud_obscured_pass_is_unavailable_not_zero():
    # 21 Jul 2026: the scene over the oasis was cloud, so every zone is unavailable rather than zero
    as_of = datetime(2026, 7, 22, 9, tzinfo=timezone.utc)
    sat = tel.generate(P, as_of, {}).satellite
    assert sat["latest_status"] == "cloud_obscured"
    assert all(v is None for v in sat["passes"][-1]["zones"].values())
    assert sat["latest_valid_age_days"] > 1.0  # age counts from the last clear pass, not the cloudy one
    factors = conf.system_factors(tel.generate(P, as_of, {}), estimate_state(tel.generate(P, as_of, {}), P), {"mode": "live", "status": "ok"}, 0)
    sat_factor = next(f for f in factors if f["key"] == "satellite")
    assert sat_factor["status"] == "missing" and sat_factor["impact"] < 0 and "not treated as zero" in sat_factor["detail"]


def test_losing_sensors_never_lowers_the_risk_level(now, demo_weather):
    """Less data widens uncertainty and costs confidence, but it must not de-escalate a warning."""
    _, _, healthy = _run(now, demo_weather, {})
    for faults in ({"S-GW-01": "offline"}, {"S-GW-01": "offline", "S-FL-MAIN": "offline"}, {"S-GW-01": "stale"}):
        _, _, degraded = _run(now, demo_weather, faults)
        assert (degraded.risk[0] >= healthy.risk[0]).all(), faults


# -- fallbacks ----------------------------------------------------------------
def test_level_sensor_failure_falls_back_to_flume_then_to_last_known(now, demo_weather):
    _, healthy, f0 = _run(now, demo_weather, {})
    _, no_level, f1 = _run(now, demo_weather, {"S-GW-01": "offline"})
    _, no_source, f2 = _run(now, demo_weather, {"S-GW-01": "offline", "S-FL-MAIN": "offline"})
    assert (healthy.basis, no_level.basis, no_source.basis) == ("level_sensor", "flow_derived", "last_known")
    # the estimate stays close to the truth, but is held with less certainty at each step
    assert abs(no_level.head_m - healthy.head_m) < 0.05 and abs(no_source.head_m - healthy.head_m) < 0.05
    assert healthy.head_sd < no_level.head_sd and healthy.head_sd < no_source.head_sd
    assert healthy.trend_se < no_level.trend_se < no_source.trend_se
    # and the forecast band widens accordingly
    width = lambda f: float(np.percentile(f.ratio[:, 0, 0], 90) - np.percentile(f.ratio[:, 0, 0], 10))  # noqa: E731
    assert width(f0) < width(f2)


def test_branch_leak_detected_only_from_a_complete_balance(now):
    full = estimate_state(tel.generate(P, now, {}), P)
    leak = next(c for c in full.branch_checks if c.branch == "C")
    assert leak.anomaly and leak.verifiable and 0.05 < leak.excess_loss < 0.12
    assert not any(c.anomaly for c in full.branch_checks if c.branch != "C")
    # with an outlet gauge down the balance cannot be checked now; the last verified value is kept and flagged
    blind = estimate_state(tel.generate(P, now, {"S-OUT-Z5": "offline"}), P)
    chk = next(c for c in blind.branch_checks if c.branch == "C")
    assert not chk.verifiable and chk.age_h >= tel.FAULT_GAP_HOURS["offline"] - 1


# -- confidence ---------------------------------------------------------------
def test_confidence_falls_as_inputs_go_missing(now, demo_weather):
    def index(faults):
        return engine.compute(now=now, weather=demo_weather, faults_spec=faults)["confidence"]

    healthy = index("none")
    no_level = index("S-GW-01:offline")
    no_source = index("S-GW-01:offline,S-FL-MAIN:offline")
    assert healthy["system"]["index"] > no_level["system"]["index"] > no_source["system"]["index"]
    reasons = " ".join(f["detail"] for f in no_source["system"]["factors"])
    assert "No current source observation" in reasons
    # a zone-specific gap only lowers that zone
    z2 = index("S-OUT-Z2:offline")
    assert z2["zones"]["Z2"]["index"] < healthy["zones"]["Z2"]["index"]
    assert z2["zones"]["Z5"]["index"] == healthy["zones"]["Z5"]["index"]


def test_confidence_never_reaches_100_and_explains_why(now, demo_weather):
    c = engine.compute(now=now, weather=demo_weather, faults_spec="none")["confidence"]["system"]
    assert c["index"] <= 75 and "not a statistical probability" in c["method"].lower()
    assert any(f["key"] == "calibration" for f in c["factors"])


def test_demo_weather_costs_confidence_against_live(now, demo_weather):
    live_like = {**demo_weather, "mode": "live", "status": "ok"}
    demo = engine.compute(now=now, weather=demo_weather, faults_spec="none")["confidence"]["system"]["index"]
    live = engine.compute(now=now, weather=live_like, faults_spec="none")["confidence"]["system"]["index"]
    assert demo < live


def test_confidence_decays_with_lead_time(now, demo_weather):
    by_day = engine.compute(now=now, weather=demo_weather, faults_spec="none")["scenarios"]["baseline"]["confidence"]["system"]
    idx = [d["index"] for d in by_day]
    assert idx[0] > idx[7] > idx[14] and idx == sorted(idx, reverse=True)


# -- noise and persistence ----------------------------------------------------
def test_one_bad_reading_is_rejected_and_changes_nothing_material(now, demo_weather):
    """A halved level reading and a 60% flume dip, each a single sample: rejected, and no warning moves."""
    _, clean, f_clean = _run(now, demo_weather, {})
    t, spiked, f_spiked = _run(now, demo_weather, {}, extra_outliers={"S-GW-01": [(2, 0.5)], "S-FL-MAIN": [(1, 0.4)]})
    assert t.sensors["S-GW-01"].rejected.sum() == 1
    assert abs(spiked.head_m - clean.head_m) < 0.005
    assert abs(spiked.trend_m_per_day - clean.trend_m_per_day) < 0.002
    assert np.array_equal(f_spiked.risk[0], f_clean.risk[0]), "the level issued today must not change"
    assert np.abs(f_spiked.risk - f_clean.risk).max() <= 1
    for z in range(len(P.zones)):
        a, b = f_clean.first_shortfall_day(z), f_spiked.first_shortfall_day(z)
        assert (a is None) == (b is None) and (a is None or abs(a - b) <= 1)


def test_unfiltered_bad_reading_would_have_moved_the_estimate(now):
    """Shows the filter is doing the work: the same spike left in the data shifts the fitted head."""
    t = tel.generate(P, now, {}, extra_outliers={"S-GW-01": [(2, 0.5)]})
    series = t.sensors["S-GW-01"]
    k = int(np.flatnonzero(series.rejected)[-1])
    filtered = estimate_state(t, P).head_m
    series.values[k] = series.raw[k]  # put the rejected reading back
    assert abs(estimate_state(t, P).head_m - filtered) > 0.005


def test_built_in_outlier_is_reported(now):
    pub = tel.to_public(tel.generate(P, now, {}))
    flume = next(x for x in pub["sensors"] if x["id"] == "S-FL-MAIN")
    assert len(flume["rejected"]) == 1 and flume["status"] == "ok"


def test_escalation_needs_persistence_or_corroboration():
    watch, prepare, act = (np.array([v]) for v in (1, 2, 3))
    jump = apply_persistence([watch, act], corroborated=False, required=2)[0]
    assert jump["issued"] == "WATCH" and jump["held_back"] and jump["raw"] == "ACT"
    assert apply_persistence([watch, act], corroborated=True, required=2)[0]["issued"] == "PREPARE"
    assert apply_persistence([act, act], corroborated=False, required=2)[0]["issued"] == "ACT"
    assert apply_persistence([act, watch], corroborated=False, required=2)[0]["issued"] == "WATCH"  # de-escalates at once
    first_look = apply_persistence([act], corroborated=False, required=2)[0]
    assert first_look["issued"] == "WATCH" and first_look["held_back"]


def test_warnings_are_actionable(now, demo_weather):
    w = engine.compute(now=now, weather=demo_weather)["warnings"]
    zone = [x for x in w["warnings"] if x["type"] == "supply_shortfall"]
    assert zone and any(x["type"] == "branch_anomaly" for x in w["warnings"])
    for x in zone:
        assert x["affected_zones"] and x["source"]["name"] and x["level"] in {"WATCH", "PREPARE", "ACT"}
        assert x["confidence"]["factors"] and x["factors"] and x["actions"]
        assert all(a["action"] and a["rationale"] and a["owner"] for a in x["actions"])
        if x["level"] in {"PREPARE", "ACT"}:
            assert x["window"]["start_date"] and x["sms"]["en"] and x["sms"]["ar"] and x["sms"]["chars_en"] <= 160
    # sensor problems are surfaced as notices, not hidden
    assert {n["sensor"] for n in w["notices"]} >= {"S-OUT-Z2", "S-FL-B"}


def test_hindcast_as_of_yesterday_is_available_for_persistence(now, demo_weather):
    t = tel.generate(P, now - timedelta(days=1), {})
    assert estimate_state(t, P).head_m > estimate_state(tel.generate(P, now, {}), P).head_m
