"""Hydraulics, ET0, forecast and scenario behaviour."""
from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from app import engine
from app.config import UAE_TZ
from app.model import forecast as fc
from app.model import telemetry as tel
from app.model.et0 import et0_fao56, rain_recharge_m3d, zone_demand_lps
from app.model.hydraulics import recession_step, route
from app.model.params import Scenario, default_params, preset_scenarios
from app.model.state import estimate_state

P = default_params()


def _forecast(now, weather, scenario=None, faults=None):
    t = tel.generate(P, now, faults if faults is not None else {})
    st = estimate_state(t, P)
    inp = fc.inputs_from_weather(weather, now.astimezone(UAE_TZ).date(), P)
    return fc.run_forecast(P, st, inp, scenario or Scenario())


# -- water balance -----------------------------------------------------------
@pytest.mark.parametrize("q", [0.0, 5.0, 40.0, 71.3, 118.0, 250.0])
def test_routing_conserves_water(q):
    """Every litre leaving the source is delivered, lost or spilled, including above channel capacity."""
    r = route(np.array([q]), P, branch_excess_loss=np.array([0.0, 0.0, 0.09]))
    assert abs(float(r.residual[0])) < 1e-9
    assert float(r.total_delivered[0] + r.total_loss[0] + r.total_spill[0]) == pytest.approx(q, abs=1e-9)
    assert (r.zone_delivered >= 0).all() and (r.branch_loss >= 0).all()


def test_spill_only_above_capacity():
    assert float(route(np.array([60.0]), P).total_spill[0]) == 0.0
    assert float(route(np.array([250.0]), P).total_spill[0]) > 0.0


def test_ensemble_forecast_conserves_water(now, demo_weather):
    res = _forecast(now, demo_weather)
    assert float(np.abs(res.routing.residual).max()) < 1e-9


def test_source_drop_propagates_downstream():
    """A weaker source means less flow in the main channel, every branch and every zone."""
    high, low = route(np.array([70.0]), P), route(np.array([50.0]), P)
    assert low.q_sharia[0] < high.q_sharia[0]
    assert (low.branch_in < high.branch_in).all()
    assert (low.zone_delivered < high.zone_delivered).all()


def test_tail_zones_lose_more_than_head_zones():
    r = route(np.array([70.0]), P)
    for b in P.branches:
        zones = [(i, z) for i, z in enumerate(P.zones) if z.branch == b.id]
        eff = {z.position: r.zone_delivered[0, i] / (r.branch_in[0, P.branch_index(b.id)] * z.share / sum(x.share for _, x in zones)) for i, z in zones}
        assert eff["tail"] < eff["head"]


def test_recession_is_exact_solution_of_linear_reservoir():
    h, n, c, s = 1.2, 2000.0, 5000.0, 200_000.0
    one = recession_step(h, n, c, s, 2.0)
    two = recession_step(recession_step(h, n, c, s, 1.0), n, c, s, 1.0)
    assert float(one) == pytest.approx(float(two), rel=1e-12)
    assert float(recession_step(h, n, c, s, 5000.0)) == pytest.approx(n / c, rel=1e-6)  # settles at equilibrium


# -- evapotranspiration and demand --------------------------------------------
def test_et0_matches_fao56_worked_example():
    """FAO-56 example 18 (Brussels, 6 July): ET0 = 3.9 mm/day."""
    et0 = et0_fao56(t_max_c=21.5, t_min_c=12.3, rh_mean_pct=70.55, wind_10m_ms=2.78, solar_rad_w_m2=22.07 / 0.0864,
                    lat_deg=50.8, elevation_m=100.0, day=date(2026, 7, 6))
    assert et0 == pytest.approx(3.9, abs=0.15)


def test_demand_scales_with_et0_and_rain_reduces_it():
    dry = zone_demand_lps(4.0, 0.0, P)
    assert zone_demand_lps(5.0, 0.0, P).sum() == pytest.approx(dry.sum() * 1.25)
    assert zone_demand_lps(4.0, 6.0, P).sum() < dry.sum()
    assert zone_demand_lps(4.0, 1.0, P).sum() == pytest.approx(dry.sum())  # below the effective-rain threshold


def test_light_rain_gives_no_recharge_and_heavy_rain_is_lagged():
    assert rain_recharge_m3d(np.array([0.0, 1.4, 0.7, 0.0]), P).sum() == 0.0
    series = rain_recharge_m3d(np.concatenate([[25.0], np.zeros(20)]), P)
    assert series[0] == 0.0 and series.argmax() >= 3
    assert series.sum() == pytest.approx((25.0 - 5.0) / 1000 * 30e6 * 0.08)


# -- forecast -----------------------------------------------------------------
def test_forecast_predicts_a_future_shortfall(now, demo_weather):
    """The demo scenario must show a shortfall that has not happened yet."""
    res = _forecast(now, demo_weather)
    firsts = [res.first_shortfall_day(i) for i in range(len(P.zones))]
    predicted = [f for f in firsts if f is not None]
    assert predicted, "no zone falls short within the horizon"
    assert min(predicted) >= 1, "shortfall is already happening on day 0; nothing left to warn about"
    assert len(set(firsts)) > 2, "zones should fall short on different days"


def test_source_and_main_flow_decline_through_horizon(now, demo_weather):
    res = _forecast(now, demo_weather)
    assert np.all(np.diff(res.head[0]) < 0)
    assert np.all(np.diff(res.routing.q_sharia[0]) < 0)


def test_uncertainty_band_brackets_central_and_widens(now, demo_weather):
    res = _forecast(now, demo_weather)
    total = res.routing.zone_delivered.sum(axis=-1)
    p10, p90 = np.percentile(total, 10, axis=0), np.percentile(total, 90, axis=0)
    assert np.all(p10 <= total[0] + 1e-9) and np.all(total[0] <= p90 + 1e-9)
    assert (p90[-1] - p10[-1]) > (p90[0] - p10[0])


def test_forecast_is_deterministic(now, demo_weather):
    a, b = _forecast(now, demo_weather), _forecast(now, demo_weather)
    assert np.array_equal(a.ratio, b.ratio)


def test_risk_never_relaxes_before_a_shortfall(now, demo_weather):
    """Approaching a central shortfall, the risk level only climbs."""
    res = _forecast(now, demo_weather)
    for z in range(len(P.zones)):
        first = res.first_shortfall_day(z)
        if first:
            assert np.all(np.diff(res.risk[: first + 1, z]) >= 0)
            assert res.risk[first, z] == 3


# -- scenarios ----------------------------------------------------------------
def test_scenarios_are_recalculated_not_canned(now, demo_weather):
    base, less, eff = (_forecast(now, demo_weather, sc) for sc in preset_scenarios())
    # reduced demand: same water, lower requirement
    assert np.allclose(less.routing.zone_delivered[0], base.routing.zone_delivered[0])
    assert np.allclose(less.demand[0], base.demand[0] * 0.85)
    # improved efficiency: same requirement, more water delivered from the same source
    assert np.allclose(eff.q_source[0], base.q_source[0])
    assert np.allclose(eff.demand[0], base.demand[0])
    assert (eff.routing.zone_delivered[0] > base.routing.zone_delivered[0]).all()
    for alt in (less, eff):
        assert (alt.ratio[0] > base.ratio[0]).all()
        assert abs(float(np.abs(alt.routing.residual).max())) < 1e-9


def test_scenario_strength_changes_the_answer(now, demo_weather):
    deficits = []
    for cut in (0.0, 0.05, 0.15, 0.30):
        res = _forecast(now, demo_weather, Scenario(id="x", demand_reduction=cut))
        deficits.append(float(np.clip(res.demand[0] - res.routing.zone_delivered[0], 0, None).sum()))
    assert deficits == sorted(deficits, reverse=True) and deficits[0] > deficits[-1]
    losses = [float(_forecast(now, demo_weather, Scenario(id="y", loss_reduction=x)).routing.total_loss[0, 0]) for x in (0.0, 0.3, 0.6)]
    assert losses == sorted(losses, reverse=True) and losses[0] > losses[-1]


def test_rebalancing_equalises_supply_ratio_on_day_zero(now, demo_weather):
    res = _forecast(now, demo_weather, Scenario(id="r", rebalance=True))
    ratios = res.central_ratio[0]
    assert float(ratios.max() - ratios.min()) < 1e-6
    assert abs(float(np.abs(res.routing.residual).max())) < 1e-9


def test_engine_bundle_is_complete_and_timeline_ready(now, demo_weather):
    bundle = engine.compute(now=now, weather=demo_weather, faults_spec="none")
    assert bundle["scenario_order"] == ["baseline", "reduced_demand", "improved_efficiency"]
    for sid in bundle["scenario_order"]:
        sc = bundle["scenarios"][sid]
        assert len(sc["dates"]) == 22 == len(sc["guidance"]) == len(sc["system"]["risk"])
        assert sc["balance"]["max_abs_residual_lps"] < 1e-9
        for z in sc["zones"]:
            assert len(z["risk"]) == 22 and len(z["ratio"]["central"]) == 22
    base, less = bundle["comparison"][0], bundle["comparison"][1]
    assert less["deficit_m3_total"] < base["deficit_m3_total"]
    assert bundle["telemetry"]["provenance"] == "simulated"
    assert bundle["scenarios"]["baseline"]["provenance"] == "modelled"


def test_state_bundle_is_json_serialisable(now, demo_weather):
    import json

    bundle = engine.compute(now=now, weather=demo_weather, rain_history={"available": False, "provenance": "unavailable"})
    json.dumps(bundle)  # numpy values must never leak into the API response
    assert bundle["rain_history"]["available"] is False
