"""Actionable warnings: what is at risk, when, how sure we are, why, and what to do.

Escalation is deliberately slow to anger: a level is issued only once it has held for consecutive daily
evaluations, unless two independent sensors corroborate the decline. Every number quoted in a
recommendation comes from re-running the same forecast model with the proposed change applied.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone

import numpy as np

from . import confidence as conf
from .forecast import RISK_LEVELS, ForecastResult, run_forecast
from .params import LPS_TO_M3_DAY, ModelParams, Scenario
from .state import StateEstimate
from .telemetry import Telemetry

SOURCE = {"id": "MW-1", "name": "Mother well (umm al-falaj) and falaj main channel"}
AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]


def _d(day: date) -> str:
    return f"{day.day} {day:%b}"


def _d_ar(day: date) -> str:
    return f"{day.day} {AR_MONTHS[day.month - 1]}"


def _days_ar(n: int) -> str:
    """Arabic number agreement for a count of days."""
    if n <= 0:
        return "اليوم"
    if n == 1:
        return "خلال يوم واحد"
    if n == 2:
        return "خلال يومين"
    return f"خلال {n} أيام" if n <= 10 else f"خلال {n} يوماً"


def apply_persistence(raw_history: list[np.ndarray], corroborated: bool, required: int) -> list[dict]:
    """raw_history: raw risk levels per zone for consecutive daily evaluations, oldest first, newest last.

    A level is issued when it has held for `required` consecutive evaluations. Corroboration by two
    independent sensors allows one step of escalation above the persistent level straight away.
    """
    now = raw_history[-1]
    window = raw_history[-required:] if len(raw_history) >= required else raw_history
    persistent = np.min(np.vstack(window), axis=0)
    if len(raw_history) < required:
        persistent = np.minimum(persistent, 1)  # not enough history to confirm anything above WATCH
    out = []
    for z in range(len(now)):
        ceiling = int(persistent[z]) + (1 if corroborated else 0)
        issued = int(min(now[z], ceiling))
        held = issued < int(now[z])
        if held:
            reason = (f"Raw assessment is {RISK_LEVELS[int(now[z])]} but it has not yet held for {required} consecutive daily evaluations; "
                      f"issued as {RISK_LEVELS[issued]} pending confirmation.")
        elif issued > int(persistent[z]):
            reason = "Escalated immediately: the decline is corroborated by the well level and the main flume independently."
        else:
            reason = f"Level has held for {required} consecutive daily evaluations."
        out.append({
            "raw": RISK_LEVELS[int(now[z])],
            "issued": RISK_LEVELS[issued],
            "issued_level": issued,
            "held_back": held,
            "history": [RISK_LEVELS[int(h[z])] for h in raw_history],
            "reason": reason,
        })
    return out


def _attribution(res: ForecastResult, z: int, ref_day: int) -> list[dict]:
    """Rank what is eroding (or protecting) this zone's supply margin on the reference day."""
    p, st, inp = res.params, res.state, res.inputs
    base = float(res.central_ratio[ref_day, z])
    zone = p.zones[z]
    factors = []

    frozen_head = run_forecast(p, st, inp, res.scenario, members=1, freeze_head=True).ratio[0, ref_day, z]
    head0, head1 = float(res.head[0, 0]), float(res.head[0, ref_day])
    d_source = float(frozen_head - base)
    if ref_day > 0:
        factors.append({
            "key": "source_recession",
            "label": "Source recession",
            "detail": f"Mother well head forecast to fall from {head0:.2f} m to {head1:.2f} m by {_d(inp.dates[ref_day])} "
                      f"({(head1 / head0 - 1) * 100:+.0f}% discharge), on an observed trend of {st.trend_m_per_day * 100:+.1f} cm/day.",
            "points": round(d_source * 100, 1),
        })

    frozen_demand = run_forecast(p, st, inp, res.scenario, members=1, freeze_demand=True).ratio[0, ref_day, z]
    d_weather = float(frozen_demand - base)
    if ref_day > 0 and abs(d_weather) >= 0.005:
        e0, e1 = float(inp.et0_mm[0]), float(inp.et0_mm[ref_day])
        verb = "raises" if d_weather > 0 else "eases"
        factors.append({
            "key": "weather_demand",
            "label": "Weather-driven demand",
            "detail": f"Rotation-mean ET0 moves from {e0:.2f} to {e1:.2f} mm/day, which {verb} irrigation demand by {abs(e1 / e0 - 1) * 100:.0f}%.",
            "points": round(d_weather * 100, 1),
        })

    b = p.branch_index(zone.branch)
    excess = 0.0 if res.scenario.repair_anomalies else float(st.branch_excess[b])
    if excess > 0:
        factors.append({
            "key": "branch_leak",
            "label": f"Excess loss on {p.branches[b].name}",
            "detail": f"Outlets on this branch receive {excess:.0%} less than the design balance: suspected leakage or partial blockage.",
            "points": round(base * (1 / (1 - excess) - 1) * 100, 1),
        })

    rt = res.routing
    zshare = zone.share / sum(x.share for x in p.zones if x.branch == zone.branch)
    bshare = p.branches[b].share / sum(x.share for x in p.branches)
    entitled = float(rt.q_source[0, ref_day]) * bshare * zshare
    path_eff = float(rt.zone_delivered[0, ref_day, z]) / entitled / (1 - excess) if entitled > 0 else 1.0
    factors.append({
        "key": "conveyance",
        "label": "Conveyance losses",
        "detail": f"{(1 - path_eff):.0%} of this zone's share seeps away between the mother well and its outlet "
                  f"({p.channels.tunnel_length_km:.0f} km tunnel plus {zone.channel_km:.2f} km of branch channel; {zone.position}-end zone).",
        "points": round(base * (1 / path_eff - 1) * 100, 1),
    })

    delivered = rt.zone_delivered[0, 0]
    demand = res.demand[0, 0]
    water_share, demand_share = float(delivered[z] / delivered.sum()), float(demand[z] / demand.sum())
    system_ratio = float(delivered.sum() / demand.sum())
    gap = system_ratio - float(res.central_ratio[0, z])
    if gap > 0.01:
        factors.append({
            "key": "allocation",
            "label": "Allocation imbalance",
            "detail": f"The zone holds {water_share:.1%} of delivered water but carries {demand_share:.1%} of demand: its fixed share predates today's crop pattern.",
            "points": round(gap * 100, 1),
        })

    for f in factors:
        f["direction"] = "adverse" if f["points"] > 0 else "relief"
    factors.sort(key=lambda f: -f["points"])
    return factors


def _first_date(res: ForecastResult, z: int) -> tuple[int | None, str]:
    day = res.first_shortfall_day(z)
    return day, ("no shortfall within 21 days" if day is None else _d(res.inputs.dates[day]))


def _zone_actions(level: int, zone, res: ForecastResult, rebal: ForecastResult, repair: ForecastResult | None, factors: list[dict], peak_deficit: float) -> list[dict]:
    p = res.params
    z = p.zone_index(zone.id)
    b = p.branch_index(zone.branch)
    branch = p.branches[b]
    keys = {f["key"]: f for f in factors if f["direction"] == "adverse"}
    day0, date0 = _first_date(res, z)
    actions: list[dict] = []

    def add(action: str, rationale: str, owner: str):
        actions.append({"priority": len(actions) + 1, "action": action, "rationale": rationale, "owner": owner})

    # Redistribution: quantified by the rebalanced run.
    old_share = branch.share / sum(x.share for x in p.branches)
    new_share = rebal.params.branches[b].share
    delta_lps = (new_share - old_share) * float(res.routing.q_divider[0, 0])
    _, date_rb = _first_date(rebal, z)
    donors = [(x.name, x.share / sum(y.share for y in p.branches) - rebal.params.branches[i].share) for i, x in enumerate(p.branches)]
    donor = max(donors, key=lambda item: item[1])[0]
    rb_day = rebal.first_shortfall_day(z)
    gains = day0 is not None and (rb_day is None or rb_day > day0)
    if gains:
        verb = "Temporarily redistribute" if level >= 3 else "Prepare a temporary redistribution"
        if delta_lps > 0.3:
            text = f"{verb}: shift about {delta_lps:.1f} L/s at the divider from the {donor} to the {branch.name}, and rebalance turns within the branch in proportion to demand."
        else:
            text = f"{verb} of turns within the {branch.name} in proportion to demand."
        add(text, f"Re-running the model with shares proportional to demand moves the first shortfall in {zone.id} from {date0} to {date_rb}. "
                  "Zones now in surplus give up margin, so all zones then reach their limit at about the same time.", "Areef / water manager")

    if "branch_leak" in keys and repair is not None:
        _, date_rp = _first_date(repair, z)
        lost = float(res.routing.branch_in[0, 0, b]) * float(res.state.branch_excess[b])
        add(f"Check the suspected leakage or blockage on the {branch.name}, between the divider and the outlets, and repair it.",
            f"About {lost:.1f} L/s is unaccounted for on this branch. With it restored the model moves the first shortfall in {zone.id} from {date0} to {date_rp}.",
            "Field maintenance crew")

    if level >= 3:
        add(f"Notify the farm operators of {zone.id} {zone.name} now that turns will be shortened from {date0}.",
            "Operators need lead time to prioritise palms over understorey crops before supply drops.", "Areef / water manager")
        add(f"Review irrigation allocation in {zone.id}: plan a {max(5, int(np.ceil(peak_deficit / 5.0)) * 5)}% cut in applied depth, protecting date palms first.",
            f"The forecast peak deficit is {peak_deficit:.0f}% of demand; an orderly reduction avoids uneven stress across plots.", "Farm operators")
    elif level == 2:
        add(f"Pre-notify the farm operators of {zone.id} {zone.name} that shortened turns may be needed around {date0}.",
            "A shortfall is plausible but not yet likely; early notice costs nothing.", "Areef / water manager")
        add(f"Review the irrigation allocation for {zone.id} and agree which plots would be reduced first.",
            "Deciding the order in advance turns a shortfall into a planned rotation rather than a dispute.", "Areef / farm operators")

    if level == 1:
        add(f"Keep {zone.id} under watch: check the outlet and branch readings daily and confirm them on site once this week.",
            "Deterioration is emerging but no shortfall is yet plausible within two weeks.", "Water manager")
    return actions


def _sms(level: int, zone, first: date | None, lead: int | None, peak: float) -> dict | None:
    if level < 2 or first is None:
        return None
    if level >= 3:
        en = (f"FALAJLINE ACT: {zone.id} {zone.name.replace(' · ', ' ')} water supply forecast below need from {_d(first)} "
              f"({'today' if lead == 0 else f'in {lead} d'}), deficit up to {peak:.0f}%. Shorten turns; areef will confirm the rota.")
        ar = (f"فلج لاين – تحرّك الآن: يُتوقع أن يقلّ إمداد المياه في المنطقة {zone.id} عن الحاجة ابتداءً من {_d_ar(first)} "
              f"({_days_ar(lead)})، بعجز يصل إلى {peak:.0f}٪. يُرجى تقليل مدة الري بانتظار جدول التناوب من العريف.")
    else:
        en = (f"FALAJLINE PREPARE: {zone.id} {zone.name.replace(' · ', ' ')} water supply may fall below need around {_d(first)} "
              f"(in {lead} d). Be ready to shorten turns. No action needed yet.")
        ar = (f"فلج لاين – استعداد: قد يقلّ إمداد المياه في المنطقة {zone.id} عن الحاجة قرابة {_d_ar(first)} "
              f"({_days_ar(lead)}). يُرجى الاستعداد لتقليل مدة الري. لا حاجة لأي إجراء الآن.")
    return {"en": en, "ar": ar, "chars_en": len(en), "segments_en": 1 if len(en) <= 160 else int(np.ceil(len(en) / 153)),
            "segments_ar": 1 if len(ar) <= 70 else int(np.ceil(len(ar) / 67))}


def build_warnings(
    params: ModelParams,
    res: ForecastResult,
    telemetry: Telemetry,
    confidence: dict,
    raw_history: list[np.ndarray],
    now: datetime,
) -> dict:
    st: StateEstimate = res.state
    inp = res.inputs
    d = len(inp.dates)
    req = params.risk.required_supply_ratio
    persistence = apply_persistence(raw_history, st.corroborated_decline, params.risk.persistence_evaluations)
    issued_at = now.astimezone(timezone.utc).isoformat()

    rebal = run_forecast(params, st, inp, replace(res.scenario, rebalance=True))
    repair = run_forecast(params, st, inp, replace(res.scenario, repair_anomalies=True)) if st.branch_excess.any() else None

    warnings: list[dict] = []
    for z, zone in enumerate(params.zones):
        pers = persistence[z]
        level = pers["issued_level"]
        if level == 0:
            continue
        first = res.first_shortfall_day(z)
        cross = res.crossing_days(z)
        share = float((cross < d).mean())
        earliest, latest = int(np.percentile(cross, 10)), int(np.percentile(cross, 90))
        short_days = np.flatnonzero(res.short[0, :, z])
        ratio = res.central_ratio[:, z]
        peak = float(max(0.0, (req - ratio.min()) / req) * 100)
        deficit = np.clip(res.demand[0, :, z] - res.routing.zone_delivered[0, :, z], 0, None)
        ref_day = first if first is not None else d - 1
        factors = _attribution(res, z, ref_day)
        zc = confidence["zones"][zone.id]
        c = conf.score(zc["_factors"], first if first is not None else d - 1)
        continues = bool(len(short_days) and short_days[-1] == d - 1)

        if first is not None:
            end_txt = "the end of the 21-day horizon and likely beyond" if continues else _d(inp.dates[int(short_days[-1])])
            summary = (f"Supply to {zone.name} is forecast to fall below irrigation demand on {_d(inp.dates[first])} "
                       f"({'today' if first == 0 else f'in {first} days'}) and stay short through {end_txt}. "
                       f"Peak deficit {peak:.0f}% of demand, about {deficit.sum() * LPS_TO_M3_DAY:,.0f} m³ over the horizon.")
            title = f"{zone.id} {zone.name}: supply forecast to fall below demand from {_d(inp.dates[first])}"
        else:
            summary = (f"No shortfall in the central forecast, but {share:.0%} of ensemble runs fall short within 21 days. "
                       f"Supply margin shrinks from {(ratio[0] - 1) * 100:+.0f}% today to {(ratio[-1] - 1) * 100:+.0f}% by {_d(inp.dates[-1])}.")
            title = f"{zone.id} {zone.name}: supply margin eroding"

        warnings.append({
            "id": f"W-{zone.id}-SUPPLY",
            "type": "supply_shortfall",
            "level": pers["issued"],
            "raw_level": pers["raw"],
            "held_back": pers["held_back"],
            "persistence": pers,
            "title": title,
            "summary": summary,
            "source": SOURCE,
            "branch": zone.branch,
            "affected_zones": [zone.id],
            "window": {
                "predicted": first is not None,
                "start_day": first,
                "start_date": None if first is None else inp.dates[first].isoformat(),
                "earliest_day": None if earliest >= d else earliest,
                "earliest_date": None if earliest >= d else inp.dates[earliest].isoformat(),
                "latest_day": None if latest >= d else latest,
                "latest_date": None if latest >= d else inp.dates[latest].isoformat(),
                "end_date": None if not len(short_days) else inp.dates[int(short_days[-1])].isoformat(),
                "continues_beyond_horizon": continues,
                "lead_days": first,
                "peak_deficit_pct": round(peak, 1),
                "deficit_m3_total": round(float(deficit.sum() * LPS_TO_M3_DAY), 0),
                "ensemble_share": round(share, 3),
                "margin_today_pct": round(float(ratio[0] - 1) * 100, 1),
            },
            "confidence": c,
            "factors": factors,
            "actions": _zone_actions(level, zone, res, rebal, repair, factors, peak),
            "sms": _sms(level, zone, None if first is None else inp.dates[first], first, peak),
            "issued_at": issued_at,
            "provenance": "modelled",
        })

    # Source-level warning: the common cause behind the zone warnings.
    sys_level = max((w["persistence"]["issued_level"] for w in warnings), default=0)
    q0, q1 = float(res.routing.q_sharia[0, 0]), float(res.routing.q_sharia[0, -1])
    if sys_level >= 1 and st.trend_m_per_day < 0:
        affected = [w["affected_zones"][0] for w in warnings]
        sc = conf.score(confidence["system"]["_factors"], 0)
        warnings.append({
            "id": "W-SOURCE",
            "type": "source_recession",
            "level": RISK_LEVELS[sys_level],
            "raw_level": RISK_LEVELS[sys_level],
            "held_back": False,
            "persistence": None,
            "title": f"Mother well receding: main-channel flow forecast to fall {(1 - q1 / q0) * 100:.0f}% in 21 days",
            "summary": (f"The water table at the mother well is falling by {abs(st.trend_m_per_day) * 100:.1f} cm/day ({st.basis_label}). "
                        f"If the trend holds, flow at the shari'a drops from {q0:.0f} L/s today to {q1:.0f} L/s by {_d(inp.dates[-1])}."),
            "source": SOURCE,
            "branch": None,
            "affected_zones": affected,
            "window": {"predicted": True, "start_day": 0, "start_date": inp.dates[0].isoformat(), "lead_days": 0,
                       "continues_beyond_horizon": True, "flow_today_lps": round(q0, 1), "flow_end_lps": round(q1, 1)},
            "confidence": sc,
            "factors": [
                {"key": "trend", "label": "Observed recession", "direction": "adverse", "points": None,
                 "detail": f"7-day trend {st.trend_m_per_day * 100:+.1f} ± {st.trend_se * 100:.1f} cm/day from {st.points} valid readings."},
                {"key": "recharge", "label": "No recharge in sight", "direction": "adverse", "points": None,
                 "detail": next((n for n in inp.notes if "recharge" in n.lower()), "No upstream rain above the recharge threshold is forecast.")},
                {"key": "corroboration", "label": "Independent confirmation", "direction": "adverse" if st.corroborated_decline else "relief", "points": None,
                 "detail": "The main flume shows the same decline as the well level." if st.corroborated_decline else "Only one sensor shows the decline so far."},
            ],
            "actions": [
                {"priority": 1, "owner": "Field maintenance crew", "action": "Inspect the mother well and walk the access shafts (thaqba) for collapse, siltation or root intrusion.",
                 "rationale": "A blockage in the gallery is the one cause of falling flow that can be cleared on site."},
                {"priority": 2, "owner": "Water manager", "action": "Ask the groundwater authority whether pumping near the mother well has increased, and request the latest monitoring-well levels.",
                 "rationale": "A falling water table with no local blockage points to abstraction or the end of a recharge season."},
                {"priority": 3, "owner": "Water manager", "action": "Line up supplementary supply for the weeks ahead if the recession continues.",
                 "rationale": f"Flow at the shari'a is forecast {(1 - q1 / q0) * 100:.0f}% lower in three weeks; rotation changes alone may not cover it."},
            ],
            "sms": None,
            "issued_at": issued_at,
            "provenance": "modelled",
        })

    for chk in st.branch_checks:
        if not chk.anomaly:
            continue
        b = params.branch_index(chk.branch)
        branch = params.branches[b]
        zones = [zp.id for zp in params.zones if zp.branch == chk.branch]
        lost = float(res.routing.branch_in[0, 0, b]) * chk.excess_loss
        zone_levels = [persistence[params.zone_index(zid)]["issued_level"] for zid in zones]
        warnings.append({
            "id": f"W-BRANCH-{chk.branch}",
            "type": "branch_anomaly",
            "level": RISK_LEVELS[max(1, min(2, max(zone_levels)))],
            "raw_level": RISK_LEVELS[max(1, min(2, max(zone_levels)))],
            "held_back": False,
            "persistence": None,
            "title": f"{branch.name}: {chk.excess_loss:.0%} of flow unaccounted for",
            "summary": (f"The gauge at the head of the {branch.name} and the outlets it feeds no longer balance: "
                        f"about {lost:.1f} L/s ({lost * LPS_TO_M3_DAY:,.0f} m³/day) is missing beyond design seepage, in {chk.samples} consecutive hourly checks."),
            "source": {"id": f"BR-{chk.branch}", "name": branch.name},
            "branch": chk.branch,
            "affected_zones": zones,
            "window": {"predicted": True, "start_day": 0, "start_date": inp.dates[0].isoformat(), "lead_days": 0, "continues_beyond_horizon": True},
            "confidence": conf.score(confidence["system"]["_factors"] + [f for zid in zones for f in conf.zone_factors(zid, chk.branch, telemetry)], 0),
            "factors": [
                {"key": "balance", "label": "Flow balance", "direction": "adverse", "points": None,
                 "detail": f"Observed branch efficiency {chk.observed_efficiency:.1%} against a design value of {chk.design_efficiency:.1%}."},
                {"key": "persistence", "label": "Persistent, not a spike", "direction": "adverse", "points": None,
                 "detail": f"Seen in at least {int(0.75 * chk.samples)} of the last {chk.samples} hourly balances, so a single noisy reading cannot explain it."},
            ],
            "actions": [
                {"priority": 1, "owner": "Field maintenance crew", "action": f"Walk the {branch.name} from the divider to the {' and '.join(zones)} outlets and check for leakage, a breached bund or a partial blockage.",
                 "rationale": f"Restoring the missing {lost:.1f} L/s is the cheapest water available to these zones."},
                {"priority": 2, "owner": "Water manager", "action": "Check both gauges on this branch against a manual flow measurement.",
                 "rationale": "A drifting gauge produces the same signature as a leak; one manual reading separates the two."},
            ],
            "sms": None,
            "issued_at": issued_at,
            "provenance": "modelled",
        })

    notices = []
    for s in telemetry.sensors.values():
        if s.status == "ok":
            continue
        d_ = s.definition
        effect = {
            "source": "Source head is being estimated from a fallback; forecast confidence is reduced.",
            "main": "Today's main-channel flow is modelled, not observed.",
        }.get(d_.component, "Values for this component are modelled, not observed, until it reports again.")
        age = "no readings" if s.age_min is None else f"{s.age_min / 60:.1f} h"
        notices.append({
            "id": f"N-{d_.id}",
            "sensor": d_.id,
            "status": s.status,
            "title": f"{d_.id} {d_.label}: {s.status}",
            "detail": f"Last valid reading {age} ago. {effect}",
            "action": "Inspect the sensor, its power supply and its telemetry link." if s.status != "stale" else "Check the telemetry link; readings are arriving late.",
        })
    if telemetry.satellite.get("latest_status") != "valid":
        notices.append({
            "id": "N-SAT", "sensor": telemetry.satellite["id"], "status": "unavailable",
            "title": "Vegetation index: latest pass cloud-obscured",
            "detail": "The scene is marked unavailable and is not used. It is not treated as a zero or as healthy canopy.",
            "action": "No action: wait for the next pass.",
        })

    order = {"ACT": 0, "PREPARE": 1, "WATCH": 2}
    type_order = {"supply_shortfall": 0, "source_recession": 1, "branch_anomaly": 2}
    warnings.sort(key=lambda w: (order.get(w["level"], 3), type_order[w["type"]], w["window"].get("start_day") if w["window"].get("start_day") is not None else 99))
    counts = {lvl: sum(1 for w in warnings if w["level"] == lvl) for lvl in ("ACT", "PREPARE", "WATCH")}
    return {
        "issued_at": issued_at,
        "system_level": RISK_LEVELS[sys_level],
        "counts": counts,
        "warnings": warnings,
        "notices": notices,
        "persistence_rule": (f"A level is issued once it has held for {params.risk.persistence_evaluations} consecutive daily evaluations. "
                             "If the well level and the main flume independently confirm the decline, one step of escalation is allowed immediately."),
        "corroborated": st.corroborated_decline,
    }


def day_guidance(res: ForecastResult) -> list[dict]:
    """Headline and recommended action for each day of the timeline, if the forecast holds."""
    p, inp = res.params, res.inputs
    out = []
    for day in range(len(inp.dates)):
        levels = res.risk[day]
        top = int(levels.max())
        short = [p.zones[i] for i in np.flatnonzero(res.short[0, day])]
        at_level = [p.zones[i] for i in np.flatnonzero(levels == top)]
        ids = ", ".join(z.id for z in at_level)
        if short:
            sids = ", ".join(z.id for z in short)
            headline = f"{len(short)} zone{'s' if len(short) > 1 else ''} below demand: {sids}"
            action = f"Run the reduced rotation in {sids}, protect date palms first, and redistribute from zones still in surplus."
        elif top == 3:
            headline = f"Shortfall likely within {p.risk.act_window_days} days: {ids}"
            action = f"Notify operators of {ids} and switch to the redistribution plan before supply drops."
        elif top == 2:
            headline = f"Shortfall plausible within {p.risk.prepare_window_days} days: {ids}"
            action = f"Pre-notify operators of {ids}, agree the reduction order and schedule the channel inspection."
        elif top == 1:
            headline = f"Margin eroding: {ids}"
            action = "Check readings daily and confirm the source trend on site."
        else:
            headline = "Supply covers demand in every zone"
            action = "Routine monitoring."
        out.append({"level": RISK_LEVELS[top], "headline": headline, "action": action, "zones_short": [z.id for z in short]})
    return out
