"""21-day water availability forecast.

Deterministic and explainable: a linear-reservoir recession of the source, steady routing through the
network, and weather-driven demand. Uncertainty comes from a fixed-seed ensemble that perturbs the
ASSUMPTIONS (storage, conductance, losses, demand, weather error growing with lead time) and the estimated
starting state. The spread is a statement about those assumptions, not a validated error statistic.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .et0 import rain_recharge_m3d, zone_demand_lps
from .hydraulics import Routing, recession_step, route, source_discharge
from .params import LPS_TO_M3_DAY, ModelParams, Scenario, with_zone_shares
from .state import StateEstimate

RISK_LEVELS = ["NORMAL", "WATCH", "PREPARE", "ACT"]
RATIO_CAP = 9.99


@dataclass
class ForecastInputs:
    start: date
    dates: list[date]
    et0_mm: np.ndarray  # (D,) rotation-mean ET0 that drives demand
    et0_daily_mm: np.ndarray  # (D,) ET0 of the day itself
    precip_mm: np.ndarray  # (D,) rotation-mean rainfall over the oasis (unknown days credit no rain)
    precip_daily_mm: np.ndarray  # (D,) NaN where unknown
    recharge_m3d: np.ndarray  # (D,) rain-fed recharge reaching the source aquifer
    et0_source: list[str]  # provider | fao56 | extended
    et0_provenance: list[str]
    notes: list[str]

    @property
    def extended(self) -> np.ndarray:
        return np.array([s == "extended" for s in self.et0_source])


def inputs_from_weather(bundle: dict, start: date, params: ModelParams) -> ForecastInputs:
    """Align the weather bundle with the forecast days. Unknown values stay unknown (NaN)."""
    horizon = params.risk.horizon_days
    oasis = next(loc for loc in bundle["locations"] if loc["id"] == "oasis")
    upstream = next(loc for loc in bundle["locations"] if loc["id"] == "recharge")
    by_date = {d["date"]: d for d in oasis["daily"]}
    dates = [start + timedelta(days=i) for i in range(horizon + 1)]
    notes: list[str] = []

    et0, src, prov, rain = [], [], [], []
    known = [d["et0_mm"] for d in oasis["daily"] if d["et0_mm"] is not None]
    if not known:
        raise ValueError("Weather bundle contains no usable evapotranspiration values.")
    for day in dates:
        rec = by_date.get(day.isoformat())
        if rec is None or rec["et0_mm"] is None:
            et0.append(float(np.mean(known[-5:])))
            src.append("extended")
            prov.append("modelled")
            rain.append(np.nan)
        else:
            et0.append(float(rec["et0_mm"]))
            src.append(rec["et0_source"])
            prov.append(rec["et0_provenance"])
            rain.append(np.nan if rec["precip_mm"] is None else float(rec["precip_mm"]))
    # Rotation mean: trailing window that reaches back into the days before the forecast starts.
    rot = max(1, params.demand.rotation_days)
    hist = {date.fromisoformat(k): v for k, v in by_date.items()}
    et0_daily, rain_daily = np.array(et0), np.array(rain)

    def trailing(day: date, i: int, key: str, own: np.ndarray, nan_as: float | None) -> float:
        vals = []
        for back in range(rot):
            j = i - back
            if j >= 0:
                v = own[j]
            else:
                rec = hist.get(day - timedelta(days=back))
                v = np.nan if rec is None or rec[key] is None else rec[key]
            if np.isnan(v):
                if nan_as is None:
                    continue
                v = nan_as
            vals.append(float(v))
        return float(np.mean(vals)) if vals else float(own[i])

    et0 = [trailing(day, i, "et0_mm", et0_daily, None) for i, day in enumerate(dates)]
    rain = [trailing(day, i, "precip_mm", rain_daily, 0.0) for i, day in enumerate(dates)]
    n_ext = sum(1 for s in src if s == "extended")
    if n_ext:
        notes.append(f"{n_ext} forecast day(s) lie beyond the weather provider's data; demand there holds the mean of the last valid days (modelled).")

    up_days = sorted(upstream["daily"], key=lambda d: d["date"])
    up_dates = [date.fromisoformat(d["date"]) for d in up_days]
    up_rain = np.array([np.nan if d["precip_mm"] is None else d["precip_mm"] for d in up_days], dtype=float)
    unknown = int(np.isnan(up_rain).sum())
    if unknown:
        notes.append(f"Upstream rainfall is unavailable for {unknown} day(s); no recharge is credited for them (conservative).")
    recharge_all = rain_recharge_m3d(up_rain, params)
    lookup = dict(zip(up_dates, recharge_all))
    recharge = np.array([float(lookup.get(day, 0.0)) for day in dates])
    wet = [(d, r) for d, r in zip(up_dates, up_rain) if not np.isnan(r) and r > 0 and d >= start]
    if wet and recharge.sum() == 0:
        d, r = max(wet, key=lambda item: item[1])
        notes.append(f"Forecast upstream rain peaks at {r:.1f} mm on {d:%d %b}, below the {params.source.recharge_threshold_mm:.0f} mm recharge threshold: no recharge credited.")
    elif recharge.sum() > 0:
        notes.append(f"Upstream rain above the recharge threshold adds {recharge.sum():,.0f} m³ of recharge over the horizon.")

    return ForecastInputs(start, dates, np.array(et0), et0_daily, np.array(rain), rain_daily, recharge, src, prov, notes)


def rebalanced_params(params: ModelParams, demand_day0: np.ndarray, state: StateEstimate, surface_loss_factor: float, repair: bool) -> ModelParams:
    """Shares that equalise supply/demand across zones for the given demand pattern."""
    ch = params.channels
    excess = np.zeros(len(params.branches)) if repair else state.branch_excess
    branch_of = [params.branch_index(z.branch) for z in params.zones]
    eff = np.array([
        (1 - ch.branch_loss_per_km * surface_loss_factor) ** z.channel_km * (1 - excess[b]) for z, b in zip(params.zones, branch_of)
    ])
    gross = demand_day0 / eff  # flow each zone needs at the divider
    branch_shares, zone_shares = {}, {}
    for b_idx, b in enumerate(params.branches):
        members = [i for i, bi in enumerate(branch_of) if bi == b_idx]
        total = float(sum(gross[i] for i in members))
        branch_shares[b.id] = total / float(gross.sum())
        for i in members:
            zone_shares[params.zones[i].id] = float(gross[i] / total)
    return with_zone_shares(params, branch_shares, zone_shares)


@dataclass
class ForecastResult:
    scenario: Scenario
    params: ModelParams
    inputs: ForecastInputs
    state: StateEstimate
    head: np.ndarray  # (M, D)
    q_source: np.ndarray  # (M, D)
    routing: Routing  # arrays (M, D, ...)
    demand: np.ndarray  # (M, D, Z)
    ratio: np.ndarray  # (M, D, Z)
    short: np.ndarray  # (M, D, Z) bool
    risk: np.ndarray  # (D, Z) int level
    p_short: np.ndarray  # (D, Z)

    @property
    def central_ratio(self) -> np.ndarray:
        return self.ratio[0]

    def first_shortfall_day(self, z: int) -> int | None:
        hits = np.flatnonzero(self.short[0, :, z])
        return int(hits[0]) if len(hits) else None

    def crossing_days(self, z: int) -> np.ndarray:
        """First shortfall day for each ensemble member; D (beyond horizon) when a member never falls short."""
        s = self.short[:, :, z]
        first = s.argmax(axis=1)
        return np.where(s.any(axis=1), first, s.shape[1])

    def p_within(self, day: int, window: int, z: int | None = None) -> np.ndarray | float:
        end = min(self.short.shape[1], day + window + 1)
        hit = self.short[:, day:end].any(axis=1)  # (M, Z)
        p = hit.mean(axis=0)
        return p if z is None else float(p[z])


def _central_ratio(params: ModelParams, state: StateEstimate, inputs: ForecastInputs, scenario: Scenario, *, freeze_head=False, freeze_demand=False):
    """Single best-estimate run used for what-if attribution. Returns (ratio, delivered, demand)."""
    res = run_forecast(params, state, inputs, scenario, members=1, freeze_head=freeze_head, freeze_demand=freeze_demand)
    return res.ratio[0], res.routing.zone_delivered[0], res.demand[0]


def run_forecast(
    params: ModelParams,
    state: StateEstimate,
    inputs: ForecastInputs,
    scenario: Scenario | None = None,
    *,
    members: int | None = None,
    freeze_head: bool = False,
    freeze_demand: bool = False,
) -> ForecastResult:
    scenario = scenario or Scenario()
    unc, src, risk = params.uncertainty, params.source, params.risk
    m = members or unc.members
    d = len(inputs.dates)
    rng = np.random.default_rng(unc.seed)
    z = rng.standard_normal((m, 7))
    z[0] = 0.0  # member 0 is the best-estimate (central) run

    surface_loss_factor = 1.0 - scenario.loss_reduction
    demand_factor = 1.0 - scenario.demand_reduction
    excess = np.zeros(len(params.branches)) if scenario.repair_anomalies else state.branch_excess

    et0 = np.full(d, inputs.et0_mm[0]) if freeze_demand else inputs.et0_mm
    rain = np.full(d, inputs.precip_mm[0]) if freeze_demand else inputs.precip_mm
    demand_central = zone_demand_lps(et0, rain, params, demand_factor)  # (D, Z)

    run_params = params
    if scenario.rebalance:
        run_params = rebalanced_params(params, demand_central[0], state, surface_loss_factor, scenario.repair_anomalies)

    conductance = np.clip(src.conductance_lps_per_m * (1 + unc.conductance_rel_sd * z[:, 0]), 0.5 * src.conductance_lps_per_m, None)
    c_m3d = conductance * LPS_TO_M3_DAY
    storage = src.storage_m2 * np.exp(unc.storage_log_sd * z[:, 1])
    h0 = np.clip(state.head_m + state.head_sd * z[:, 2], 0.0, None)
    slope = state.trend_m_per_day + state.trend_se * z[:, 3]
    # Net external inflow implied by the observed trend: storage*dh/dt = N - C*h  ->  N = storage*slope + C*h0
    net_inflow = storage * slope + c_m3d * h0
    loss_scale = np.exp(unc.loss_log_sd * z[:, 4])

    head = np.empty((m, d))
    head[:, 0] = h0
    for i in range(1, d):
        if freeze_head:
            head[:, i] = h0
        else:
            head[:, i] = recession_step(head[:, i - 1], net_inflow + inputs.recharge_m3d[i - 1], c_m3d, storage)
    # While the flume confirms today's flow, uncertainty in conductance changes how fast the source recedes
    # but not the flow that a given head produces today. Without the flume it affects both.
    mapping = np.full(m, src.conductance_lps_per_m) if state.flow_observed else conductance
    q_source = source_discharge(head, mapping[:, None])

    routing = route(
        q_source,
        run_params,
        loss_scale=loss_scale[:, None],
        surface_loss_factor=surface_loss_factor,
        branch_excess_loss=excess,
        main_bias=state.main_bias,
    )

    lead = np.arange(d, dtype=float)
    weather_sd = unc.weather_rel_sd_day0 + unc.weather_rel_sd_per_day * lead + unc.weather_extended_extra_sd * inputs.extended
    factor = (1 + unc.demand_rel_sd * z[:, 5])[:, None] * (1 + z[:, 6][:, None] * weather_sd[None, :])
    demand = demand_central[None, :, :] * np.clip(factor, 0.4, None)[:, :, None]

    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(demand > 1e-9, routing.zone_delivered / np.where(demand > 1e-9, demand, 1.0), RATIO_CAP)
    ratio = np.clip(ratio, 0.0, RATIO_CAP)
    short = ratio < risk.required_supply_ratio

    result = ForecastResult(scenario, run_params, inputs, state, head, q_source, routing, demand, ratio, short,
                            risk=np.zeros((d, len(params.zones)), dtype=int), p_short=short.mean(axis=0))
    result.risk = _risk_levels(result)
    return result


def _risk_levels(res: ForecastResult) -> np.ndarray:
    """Risk state per day and zone, as it would stand on that day if the forecast holds.

    ACT      a shortfall within `act_window_days` is likely
    PREPARE  a shortfall within `prepare_window_days` is plausible
    WATCH    deterioration is emerging: some chance within the horizon, or a thin and shrinking margin
    """
    r = res.params.risk
    d, n_z = res.p_short.shape
    central = res.central_ratio
    levels = np.zeros((d, n_z), dtype=int)
    for day in range(d):
        p_act = res.p_within(day, r.act_window_days)
        p_prep = res.p_within(day, r.prepare_window_days)
        p_any = res.p_within(day, d)
        ahead = central[min(d - 1, day + 3)]
        thin = (central[day] - r.required_supply_ratio < r.watch_margin) & (ahead < central[day] - 0.005)
        lvl = np.where(p_any >= r.watch_probability, 1, np.where(thin, 1, 0))
        lvl = np.where(p_prep >= r.prepare_probability, 2, lvl)
        lvl = np.where(p_act >= r.act_probability, 3, lvl)
        lvl = np.where(central[day] < r.required_supply_ratio, 3, lvl)  # best estimate is already short that day
        levels[day] = lvl
    return levels


def _q(a: np.ndarray, q: float) -> np.ndarray:
    return np.percentile(a, q, axis=0)


def _r(a, n=2):
    return [None if (isinstance(v, float) and np.isnan(v)) else round(float(v), n) for v in np.asarray(a).ravel()]


def to_public(res: ForecastResult) -> dict:
    p, inp = res.params, res.inputs
    d = len(inp.dates)
    req = p.risk.required_supply_ratio
    rt = res.routing
    zones = []
    for i, zp in enumerate(p.zones):
        first = res.first_shortfall_day(i)
        cross = res.crossing_days(i)
        prob = float((cross < d).mean())
        earliest = int(np.percentile(cross, 10))
        latest = int(np.percentile(cross, 90))
        central_short = np.flatnonzero(res.short[0, :, i])
        deficit = np.clip(res.demand[0, :, i] - rt.zone_delivered[0, :, i], 0.0, None)
        zones.append(
            {
                "id": zp.id,
                "name": zp.name,
                "branch": zp.branch,
                "position": zp.position,
                "area_ha": zp.area_ha,
                "demand_lps": _r(res.demand[0, :, i]),
                "supply_lps": {"central": _r(rt.zone_delivered[0, :, i]), "p10": _r(_q(rt.zone_delivered[:, :, i], 10)), "p90": _r(_q(rt.zone_delivered[:, :, i], 90))},
                "ratio": {"central": _r(res.ratio[0, :, i], 3), "p10": _r(_q(res.ratio[:, :, i], 10), 3), "p90": _r(_q(res.ratio[:, :, i], 90), 3)},
                "p_short": _r(res.p_short[:, i], 3),
                "risk": [RISK_LEVELS[v] for v in res.risk[:, i]],
                "deficit_lps": _r(deficit),
                "deficit_m3_total": round(float(deficit.sum() * LPS_TO_M3_DAY), 0),
                "shortfall": {
                    "predicted": first is not None,
                    "first_day": first,
                    "first_date": None if first is None else inp.dates[first].isoformat(),
                    "earliest_day": None if earliest >= d else earliest,
                    "earliest_date": None if earliest >= d else inp.dates[earliest].isoformat(),
                    "latest_day": None if latest >= d else latest,
                    "latest_date": None if latest >= d else inp.dates[latest].isoformat(),
                    "last_day": None if not len(central_short) else int(central_short[-1]),
                    "continues_beyond_horizon": bool(len(central_short) and central_short[-1] == d - 1),
                    "ensemble_share": round(prob, 3),
                    "peak_deficit_pct": round(float(max(0.0, (req - res.ratio[0, :, i].min()) / req) * 100), 1),
                },
            }
        )

    total_supply = rt.zone_delivered.sum(axis=-1)  # (M, D)
    total_demand = res.demand.sum(axis=-1)
    sys_ratio = total_supply / np.clip(total_demand, 1e-9, None)
    sys_risk = res.risk.max(axis=1)
    sys_short = np.flatnonzero(sys_ratio[0] < req)
    any_first = [res.first_shortfall_day(i) for i in range(len(p.zones))]
    any_first = [v for v in any_first if v is not None]

    return {
        "scenario": {
            "id": res.scenario.id,
            "label": res.scenario.label,
            "description": res.scenario.description,
            "demand_reduction": res.scenario.demand_reduction,
            "loss_reduction": res.scenario.loss_reduction,
            "repair_anomalies": res.scenario.repair_anomalies,
            "rebalance": res.scenario.rebalance,
        },
        "provenance": "modelled",
        "start_date": inp.start.isoformat(),
        "dates": [x.isoformat() for x in inp.dates],
        "horizon_days": d - 1,
        "required_supply_ratio": req,
        "ensemble_members": int(res.ratio.shape[0]),
        "weather_basis": [{"et0_mm": round(float(e), 2), "et0_rotation_mm": round(float(er), 2), "source": s, "provenance": pv,
                           "precip_mm": None if np.isnan(r) else round(float(r), 2)}
                          for e, er, s, pv, r in zip(inp.et0_daily_mm, inp.et0_mm, inp.et0_source, inp.et0_provenance, inp.precip_daily_mm)],
        "rotation_days": p.demand.rotation_days,
        "source": {
            "head_m": {"central": _r(res.head[0], 3), "p10": _r(_q(res.head, 10), 3), "p90": _r(_q(res.head, 90), 3)},
            "discharge_lps": {"central": _r(res.q_source[0]), "p10": _r(_q(res.q_source, 10)), "p90": _r(_q(res.q_source, 90))},
            "recharge_m3d": _r(inp.recharge_m3d, 0),
        },
        "main": {
            "flow_lps": {"central": _r(rt.q_sharia[0]), "p10": _r(_q(rt.q_sharia, 10)), "p90": _r(_q(rt.q_sharia, 90))},
            "divider_lps": _r(rt.q_divider[0]),
            "capacity_lps": p.channels.main_capacity_lps,
        },
        "branches": [
            {
                "id": b.id,
                "name": b.name,
                "share": round(b.share / sum(x.share for x in p.branches), 4),
                "flow_lps": _r(rt.branch_in[0, :, bi]),
                "loss_lps": _r(rt.branch_loss[0, :, bi]),
                "delivered_lps": _r(rt.branch_in[0, :, bi] - rt.branch_loss[0, :, bi]),
                "capacity_lps": p.channels.branch_capacity_lps,
                "excess_loss": round(float(0.0 if res.scenario.repair_anomalies else res.state.branch_excess[bi]), 4),
                "risk": [RISK_LEVELS[int(res.risk[day, [i for i, zp in enumerate(p.zones) if zp.branch == b.id]].max())] for day in range(d)],
            }
            for bi, b in enumerate(p.branches)
        ],
        "zones": zones,
        "system": {
            "supply_lps": {"central": _r(total_supply[0]), "p10": _r(_q(total_supply, 10)), "p90": _r(_q(total_supply, 90))},
            "demand_lps": {"central": _r(total_demand[0]), "p10": _r(_q(total_demand, 10)), "p90": _r(_q(total_demand, 90))},
            "ratio": {"central": _r(sys_ratio[0], 3), "p10": _r(_q(sys_ratio, 10), 3), "p90": _r(_q(sys_ratio, 90), 3)},
            "risk": [RISK_LEVELS[v] for v in sys_risk],
            "zones_short": [[p.zones[i].id for i in np.flatnonzero(res.short[0, day])] for day in range(d)],
            "zones_at_risk": [[p.zones[i].id for i in np.flatnonzero(res.risk[day] >= 2)] for day in range(d)],
            "first_shortfall_day": min(any_first) if any_first else None,
            "first_shortfall_date": inp.dates[min(any_first)].isoformat() if any_first else None,
            "first_system_shortfall_day": int(sys_short[0]) if len(sys_short) else None,
            "deficit_m3_total": round(float(np.clip(res.demand[0] - rt.zone_delivered[0], 0, None).sum() * LPS_TO_M3_DAY), 0),
        },
        "balance": {
            "source_lps": _r(rt.q_source[0]),
            "delivered_lps": _r(rt.total_delivered[0]),
            "tunnel_loss_lps": _r(rt.tunnel_loss[0]),
            "main_loss_lps": _r(rt.main_loss[0]),
            "branch_loss_lps": _r(rt.branch_loss[0].sum(axis=-1)),
            "spill_lps": _r(rt.total_spill[0]),
            "max_abs_residual_lps": float(np.abs(rt.residual).max()),
        },
        "notes": inp.notes,
    }
