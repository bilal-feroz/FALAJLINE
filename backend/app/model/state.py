"""State estimation: turn sensor readings into the starting state of the forecast.

Nothing here invents data. When the preferred sensor is unavailable the estimator falls back along an
explicit chain (level sensor -> head inferred from the main flume -> last valid reading carried forward),
records which basis it used, and widens the uncertainty accordingly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .hydraulics import _reach_efficiency
from .params import ModelParams
from .telemetry import SensorSeries, Telemetry

FIT_WINDOW_H = 7 * 24
MIN_FIT_POINTS = 36
BALANCE_WINDOW_H = 72
BALANCE_SAMPLES = 24
ANOMALY_EXCESS = 0.03  # branch loss this far above design counts as an anomaly...
ANOMALY_PERSISTENCE = 0.75  # ...if seen in this share of recent hourly balances


@dataclass
class BranchCheck:
    branch: str
    verifiable: bool  # all sensors needed for the balance are currently reporting
    observed_efficiency: float | None
    design_efficiency: float
    excess_loss: float  # fraction of branch flow lost beyond design seepage
    anomaly: bool
    samples: int
    age_h: float | None  # age of the newest complete balance
    note: str


@dataclass
class StateEstimate:
    head_m: float
    head_sd: float
    trend_m_per_day: float
    trend_se: float
    basis: str  # level_sensor | flow_derived | last_known
    basis_label: str
    points: int
    data_age_h: float
    main_bias: float
    main_bias_basis: str
    flow_observed: bool  # the main flume currently confirms the level-to-flow relation
    branch_checks: list[BranchCheck]
    level_trend_significant: bool
    flow_trend_significant: bool
    notes: list[str] = field(default_factory=list)

    @property
    def branch_excess(self) -> np.ndarray:
        return np.array([c.excess_loss for c in self.branch_checks])

    @property
    def corroborated_decline(self) -> bool:
        """Two independent sensors (well level and main flume) both show a significant decline."""
        return self.level_trend_significant and self.flow_trend_significant and self.trend_m_per_day < 0

    def to_public(self) -> dict:
        return {
            "head_m": round(self.head_m, 3),
            "head_sd": round(self.head_sd, 3),
            "trend_m_per_day": round(self.trend_m_per_day, 4),
            "trend_se": round(self.trend_se, 4),
            "basis": self.basis,
            "basis_label": self.basis_label,
            "points": self.points,
            "data_age_h": round(self.data_age_h, 1),
            "main_bias": round(self.main_bias, 3),
            "main_bias_basis": self.main_bias_basis,
            "flow_observed": self.flow_observed,
            "corroborated_decline": self.corroborated_decline,
            "level_trend_significant": self.level_trend_significant,
            "flow_trend_significant": self.flow_trend_significant,
            "branch_checks": [c.__dict__ for c in self.branch_checks],
            "notes": self.notes,
        }


def _fit(series: SensorSeries, end_idx: int, window_h: int = FIT_WINDOW_H):
    """Least-squares line through valid readings in the window ending at end_idx.

    Returns (value_at_end, slope_per_day, slope_se, residual_sd, n) or None if there is too little data.
    """
    lo = max(0, end_idx - window_h + 1)
    t = series.times[lo: end_idx + 1]
    v = series.values[lo: end_idx + 1]
    ok = ~np.isnan(v)
    n = int(ok.sum())
    if n < MIN_FIT_POINTS:
        return None
    x = (t[ok] - series.times[end_idx]) / 24.0  # days relative to the end of the window
    y = v[ok]
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (slope * x + intercept)
    sd = float(np.sqrt(np.sum(resid**2) / max(1, n - 2)))
    sxx = float(np.sum((x - x.mean()) ** 2))
    se = sd / np.sqrt(sxx) if sxx > 0 else float("inf")
    return float(intercept), float(slope), float(se), sd, n


def _last_valid(series: SensorSeries) -> int | None:
    idx = np.flatnonzero(~np.isnan(series.values))
    return int(idx[-1]) if len(idx) else None


def estimate_state(t: Telemetry, params: ModelParams) -> StateEstimate:
    notes: list[str] = []
    n = len(t.hours)
    end = n - 1
    level = t.sensors["S-GW-01"]
    flume = t.sensors["S-FL-MAIN"]
    c = params.source.conductance_lps_per_m
    tunnel_eff = float(_reach_efficiency(params.channels.tunnel_loss_per_km, params.channels.tunnel_length_km))

    level_fit = _fit(level, end) if level.status in {"ok", "stale"} else None
    flume_fit = _fit(flume, end) if flume.status in {"ok", "stale"} else None

    def significant(fit) -> bool:
        return fit is not None and abs(fit[1]) > 3.0 * fit[2]

    level_sig, flow_sig = significant(level_fit), significant(flume_fit)

    # Persistence of an observed trend is a structural assumption, so the slope uncertainty has a floor.
    def slope_se(slope: float, fit_se: float) -> float:
        return float(np.hypot(fit_se, 0.12 * abs(slope) + 0.001))

    if level_fit is not None:
        head, slope, se, sd, pts = level_fit
        basis, label = "level_sensor", "Mother well level sensor S-GW-01 (7-day fit)"
        head_sd = max(0.008, sd / np.sqrt(24)) + (0.01 if level.status == "stale" else 0.0)
        trend_se = slope_se(slope, se)
        age_h = (level.age_min or 0.0) / 60.0
        if level.status == "stale":
            notes.append(f"S-GW-01 is stale ({age_h:.1f} h); the fit is extrapolated to now.")
    elif flume_fit is not None:
        q, q_slope, q_se, q_sd, pts = flume_fit
        k = c * tunnel_eff
        head, slope = q / k, q_slope / k
        basis, label = "flow_derived", "Head inferred from main flume S-FL-MAIN (level sensor unavailable)"
        head_sd = 0.08 * head + q_sd / k / np.sqrt(24)  # conductance and tunnel loss are assumptions
        trend_se = slope_se(slope, q_se / k) * 1.5
        age_h = (flume.age_min or 0.0) / 60.0
        notes.append("Mother well level sensor unavailable: source head is inferred from main-channel flow, which depends on the assumed conductance and tunnel loss.")
    else:
        # Carry the last trustworthy fit forward. Uncertainty grows with the age of the data.
        candidates = []
        for series, scale in ((level, 1.0), (flume, 1.0 / (c * tunnel_eff))):
            last = _last_valid(series)
            if last is None:
                continue
            fit = _fit(series, last)
            if fit is not None:
                candidates.append((last, fit, scale, series.definition.id))
        if not candidates:
            raise ValueError("No valid source observations in the telemetry window; a forecast cannot be initialised.")
        last, fit, scale, sid = max(candidates, key=lambda item: item[0])
        age_days = (end - last) / 24.0
        value, raw_slope, raw_se, raw_sd, pts = fit
        slope = raw_slope * scale
        head = value * scale + slope * age_days
        basis, label = "last_known", f"Last valid {sid} readings carried forward ({age_days * 24:.0f} h old)"
        head_sd = 0.03 + 0.04 * age_days + (0.08 * head if scale != 1.0 else 0.0)
        trend_se = slope_se(slope, raw_se * scale) * (2.0 + age_days)
        age_h = age_days * 24.0
        notes.append(f"No current source observation: both S-GW-01 and S-FL-MAIN are unavailable. Using {sid} data that is {age_days * 24:.0f} h old.")

    # Main-flow bias: does the flume agree with what the level implies under the assumed conductance?
    bias, bias_basis, flow_observed = 1.0, "Design values (flume and level not both available)", False
    if level_fit is not None and flume_fit is not None:
        lo = max(0, n - 48)
        both = ~np.isnan(level.values[lo:]) & ~np.isnan(flume.values[lo:])
        if both.sum() >= 12:
            ratio = flume.values[lo:][both] / (c * level.values[lo:][both] * tunnel_eff)
            bias = float(np.clip(np.median(ratio), 0.85, 1.12))
            bias_basis = f"Median of {int(both.sum())} paired level/flume readings over 48 h"
            flow_observed = True

    checks = [_branch_check(t, params, b_idx) for b_idx in range(len(params.branches))]
    for chk in checks:
        if chk.anomaly:
            notes.append(chk.note)

    return StateEstimate(
        head_m=float(max(head, 0.0)),
        head_sd=float(head_sd),
        trend_m_per_day=float(slope),
        trend_se=float(trend_se),
        basis=basis,
        basis_label=label,
        points=int(pts),
        data_age_h=float(age_h),
        main_bias=bias,
        main_bias_basis=bias_basis,
        flow_observed=flow_observed or basis == "flow_derived",
        branch_checks=checks,
        level_trend_significant=level_sig,
        flow_trend_significant=flow_sig,
        notes=notes,
    )


def _branch_check(t: Telemetry, params: ModelParams, b_idx: int) -> BranchCheck:
    """Mass balance of one branch: flow entering it versus the sum of its zone outlets."""
    branch = params.branches[b_idx]
    zones = [z for z in params.zones if z.branch == branch.id]
    shares = np.array([z.share for z in zones])
    shares = shares / shares.sum()
    design = float(np.sum(shares * _reach_efficiency(params.channels.branch_loss_per_km, np.array([z.channel_km for z in zones]))))

    n = len(t.hours)
    lo = max(0, n - BALANCE_WINDOW_H)
    inflow = t.sensors[f"S-FL-{branch.id}"].values[lo:]
    outlets = np.vstack([t.sensors[f"S-OUT-{z.id}"].values[lo:] for z in zones])
    complete = ~np.isnan(inflow) & ~np.isnan(outlets).any(axis=0)
    idx = np.flatnonzero(complete)
    needed = [t.sensors[f"S-FL-{branch.id}"]] + [t.sensors[f"S-OUT-{z.id}"] for z in zones]
    verifiable = all(s.status == "ok" for s in needed)

    if len(idx) < 6:
        return BranchCheck(branch.id, False, None, design, 0.0, False, int(len(idx)), None,
                           f"{branch.name}: no complete flow balance in the last {BALANCE_WINDOW_H} h; design losses assumed, leakage cannot be checked.")
    idx = idx[-BALANCE_SAMPLES:]
    eff = outlets[:, idx].sum(axis=0) / inflow[idx]
    excess_series = 1.0 - eff / design
    observed = float(np.median(eff))
    excess = float(max(0.0, np.median(excess_series)))
    persistent = float(np.mean(excess_series > ANOMALY_EXCESS)) >= ANOMALY_PERSISTENCE
    anomaly = bool(excess > ANOMALY_EXCESS and persistent)
    age_h = float(n - 1 - (lo + idx[-1]))
    if anomaly:
        note = (f"{branch.name}: outlets receive {excess:.0%} less than the design balance in {len(idx)} consecutive hourly checks "
                "— suspected leakage or partial blockage.")
    elif not verifiable:
        note = f"{branch.name}: balance last verified {age_h:.0f} h ago; a sensor on this branch is not reporting."
    else:
        note = f"{branch.name}: flow balance within design losses."
    return BranchCheck(branch.id, verifiable, observed, design, excess if anomaly else 0.0, anomaly, int(len(idx)), age_h, note)
