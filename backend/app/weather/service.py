"""Weather for the model: live Meteomatics data when configured, cached on disk, with explicit fallbacks.

Rules enforced here:
  * Two API queries per refresh (hourly + daily), both locations in each, reused for `weather_cache_ttl_s`.
  * A failed live call never turns into silent synthetic data: either a previously fetched response is served
    and marked stale, or the bundle switches to mode="demo" and carries the live error for the UI to show.
  * A value the provider did not return stays None. Days without provider ET0 are computed (FAO-56) or
    extended from the last valid days and are marked "modelled".
"""
from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta, timezone

import httpx

from ..config import CACHE_DIR, SETTINGS, UAE_TZ, Settings
from ..geo import WEATHER_LOCATIONS
from ..model.et0 import et0_fao56
from . import demo, meteomatics
from .meteomatics import MeteomaticsError

HISTORY_DAYS = 7
FORECAST_DAYS = 21

HOURLY_PARAMS = ["t_2m:C", "relative_humidity_2m:p", "wind_speed_10m:ms", "global_rad:W"]
DAILY_CORE = ["precip_24h:mm"]
DAILY_OPTIONAL = ["evaporation_24h:mm", "evapotranspiration_24h:mm"]

PARAM_LABELS = {
    "t_2m:C": "Air temperature 2 m",
    "relative_humidity_2m:p": "Relative humidity 2 m",
    "wind_speed_10m:ms": "Wind speed 10 m",
    "global_rad:W": "Global radiation",
    "precip_24h:mm": "Precipitation, 24 h",
    "evaporation_24h:mm": "Evaporation, 24 h",
    "evapotranspiration_24h:mm": "Evapotranspiration, 24 h",
}

_lock = threading.Lock()
_memory: dict[str, dict] = {}


def _cache_path(day: date):
    return CACHE_DIR / f"weather_{day.isoformat()}.json"


def _read_cache(day: date) -> dict | None:
    key = day.isoformat()
    if key in _memory:
        return _memory[key]
    try:
        bundle = json.loads(_cache_path(day).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    _memory[key] = bundle
    return bundle


def _write_cache(day: date, bundle: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _memory[day.isoformat()] = bundle
    _cache_path(day).write_text(json.dumps(bundle), encoding="utf-8")


def _latest_cache(today: date) -> dict | None:
    for back in range(0, 3):
        bundle = _read_cache(today - timedelta(days=back))
        if bundle:
            return bundle
    return None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _finish_day(rec: dict, loc: dict, day: date) -> dict:
    """Derive ET0 for one day and record which inputs were missing."""
    needed = ["t_max_c", "t_min_c", "rh_mean_pct", "wind_mean_ms", "rad_mean_w"]
    missing = [k for k in needed + ["precip_mm"] if rec.get(k) is None]
    fao = None
    if not any(rec.get(k) is None for k in needed):
        fao = et0_fao56(
            t_max_c=rec["t_max_c"],
            t_min_c=rec["t_min_c"],
            t_mean_c=rec.get("t_mean_c"),
            rh_mean_pct=rec["rh_mean_pct"],
            wind_10m_ms=rec["wind_mean_ms"],
            solar_rad_w_m2=rec["rad_mean_w"],
            lat_deg=loc["lat"],
            elevation_m=loc["elevation_m"],
            day=day,
        )
    rec["et0_fao_mm"] = None if fao is None else round(fao, 2)
    rec["missing"] = missing
    return rec


def _resolve_et0(days: list[dict], base_provenance: str) -> None:
    """Choose the ET0 the model uses for each day and say where it came from."""
    for rec in days:
        if rec.get("et_provider_mm") is not None:
            rec["et0_mm"], rec["et0_source"], rec["et0_provenance"] = rec["et_provider_mm"], "provider", base_provenance
        elif rec.get("et0_fao_mm") is not None:
            # computed by FALAJLINE from the provider's (or demo) drivers
            rec["et0_mm"], rec["et0_source"] = rec["et0_fao_mm"], "fao56"
            rec["et0_provenance"] = "simulated" if base_provenance == "simulated" else "modelled"
        else:
            rec["et0_mm"], rec["et0_source"], rec["et0_provenance"] = None, "unavailable", "unavailable"
    # Extend over days the provider did not cover: hold the mean of the last valid days. Marked modelled.
    valid = [r["et0_mm"] for r in days if r["et0_mm"] is not None]
    for i, rec in enumerate(days):
        if rec["et0_mm"] is None and valid:
            prior = [r["et0_mm"] for r in days[:i] if r["et0_mm"] is not None and r["et0_source"] != "extended"][-5:]
            rec["et0_mm"] = round(_mean(prior) if prior else _mean(valid), 2)
            rec["et0_source"], rec["et0_provenance"] = "extended", "modelled"


def _demo_bundle(now: datetime, reason: str, live_error: dict | None = None) -> dict:
    today = now.astimezone(UAE_TZ).date()
    start = today - timedelta(days=HISTORY_DAYS)
    locations = []
    for loc in WEATHER_LOCATIONS:
        days = []
        for rec in demo.synth_series(start, HISTORY_DAYS + FORECAST_DAYS + 1, loc["id"]):
            day = rec.pop("date")
            rec = {"date": day.isoformat(), "kind": "past" if day < today else "today" if day == today else "forecast", **rec}
            rec["provenance"] = "simulated"
            days.append(_finish_day(rec, loc, day))
        _resolve_et0(days, "simulated")
        today_rec = next(d for d in days if d["date"] == today.isoformat())
        locations.append(
            {
                **loc,
                "daily": days,
                "current": {
                    "time": now.astimezone(timezone.utc).isoformat(),
                    "t_c": today_rec["t_mean_c"],
                    "rh_pct": today_rec["rh_mean_pct"],
                    "wind_ms": today_rec["wind_mean_ms"],
                    "rad_w": today_rec["rad_mean_w"],
                    "provenance": "simulated",
                },
            }
        )
    return {
        "mode": "demo",
        "status": "demo" if live_error is None else "live_failed",
        "source": "DEMO DATA — synthetic weather built from approximate Al Ain climate normals",
        "notice": reason,
        "live_error": live_error,
        "retrieved_at": now.astimezone(timezone.utc).isoformat(),
        "forecast_issued_at": None,
        "cache": {"hit": False, "age_s": 0, "ttl_s": SETTINGS.weather_cache_ttl_s},
        "queries": [],
        "queries_today": meteomatics.usage_today(),
        "parameters": [{"id": p, "label": PARAM_LABELS[p], "status": "simulated"} for p in HOURLY_PARAMS + DAILY_CORE]
        + [{"id": p, "label": PARAM_LABELS[p], "status": "not_simulated"} for p in DAILY_OPTIONAL],
        "locations": locations,
        "today": today.isoformat(),
    }


def _fetch_live(settings: Settings, now: datetime, transport: httpx.BaseTransport | None) -> dict:
    today = now.astimezone(UAE_TZ).date()
    first = today - timedelta(days=HISTORY_DAYS)
    last = today + timedelta(days=FORECAST_DAYS)
    # Local days: a UAE day D runs from D-1 20:00Z to D 20:00Z.
    h_start = datetime(first.year, first.month, first.day, tzinfo=UAE_TZ)
    h_end = datetime(last.year, last.month, last.day, 23, tzinfo=UAE_TZ)
    d_start = datetime(first.year, first.month, first.day, tzinfo=UAE_TZ) + timedelta(days=1)  # value at D+1 00:00 local = day D
    d_end = datetime(last.year, last.month, last.day, tzinfo=UAE_TZ) + timedelta(days=1)

    queries = []
    param_status = {p: "ok" for p in HOURLY_PARAMS + DAILY_CORE + DAILY_OPTIONAL}

    hourly = meteomatics.fetch(settings, start=h_start, end=h_end, step="PT1H", parameters=HOURLY_PARAMS, locations=WEATHER_LOCATIONS, transport=transport)
    queries.append({"path": hourly.path, "elapsed_ms": hourly.elapsed_ms, "status": "ok"})

    daily_series: dict = {}
    daily_generated = None
    try:
        daily = meteomatics.fetch(settings, start=d_start, end=d_end, step="P1D", parameters=DAILY_CORE + DAILY_OPTIONAL, locations=WEATHER_LOCATIONS, transport=transport)
        daily_series, daily_generated = daily.series, daily.generated_at
        queries.append({"path": daily.path, "elapsed_ms": daily.elapsed_ms, "status": "ok"})
    except MeteomaticsError as exc:
        if exc.kind not in {"bad_request", "forbidden", "not_found"}:
            raise
        # One of the optional parameters is not available to this account/model: retry with the core set
        # and report the optional ones as unsupported instead of failing the whole refresh.
        queries.append({"path": "(daily, all parameters)", "elapsed_ms": 0, "status": f"rejected: {exc.message}"})
        for p in DAILY_OPTIONAL:
            param_status[p] = "unsupported"
        try:
            daily = meteomatics.fetch(settings, start=d_start, end=d_end, step="P1D", parameters=DAILY_CORE, locations=WEATHER_LOCATIONS, transport=transport)
            daily_series, daily_generated = daily.series, daily.generated_at
            queries.append({"path": daily.path, "elapsed_ms": daily.elapsed_ms, "status": "ok"})
        except MeteomaticsError as exc2:
            if exc2.kind in {"auth", "rate_limit", "budget"}:
                raise
            param_status["precip_24h:mm"] = "unavailable"
            queries.append({"path": "(daily, core parameters)", "elapsed_ms": 0, "status": f"failed: {exc2.message}"})

    for p in HOURLY_PARAMS:
        if p not in hourly.series:
            param_status[p] = "unavailable"
    for p in DAILY_CORE + DAILY_OPTIONAL:
        if param_status[p] == "ok" and p not in daily_series:
            param_status[p] = "unavailable"

    locations = []
    for li, loc in enumerate(WEATHER_LOCATIONS):
        buckets: dict[date, dict[str, list[float]]] = {}
        latest: dict[str, tuple[datetime, float]] = {}
        for p in HOURLY_PARAMS:
            for when, value in (hourly.series.get(p) or [[]] * len(WEATHER_LOCATIONS))[li]:
                if value is None:
                    continue
                buckets.setdefault(when.astimezone(UAE_TZ).date(), {}).setdefault(p, []).append(value)
                if when <= now and (p not in latest or when > latest[p][0]):
                    latest[p] = (when, value)

        def daily_value(param: str, day: date) -> float | None:
            rows = (daily_series.get(param) or [[]] * len(WEATHER_LOCATIONS))[li]
            target = day + timedelta(days=1)
            for when, value in rows:
                if when.astimezone(UAE_TZ).date() == target:
                    return value
            return None

        days = []
        for offset in range(HISTORY_DAYS + FORECAST_DAYS + 1):
            day = first + timedelta(days=offset)
            b = buckets.get(day, {})
            enough = lambda p: len(b.get(p, [])) >= 20  # noqa: E731 - need most of the day to trust a daily mean
            temps = b.get("t_2m:C", []) if enough("t_2m:C") else []
            rec = {
                "date": day.isoformat(),
                "kind": "past" if day < today else "today" if day == today else "forecast",
                "t_mean_c": round(_mean(temps), 1) if temps else None,
                "t_max_c": round(max(temps), 1) if temps else None,
                "t_min_c": round(min(temps), 1) if temps else None,
                "rh_mean_pct": round(_mean(b["relative_humidity_2m:p"]), 1) if enough("relative_humidity_2m:p") else None,
                "wind_mean_ms": round(_mean(b["wind_speed_10m:ms"]), 2) if enough("wind_speed_10m:ms") else None,
                "rad_mean_w": round(_mean(b["global_rad:W"]), 1) if enough("global_rad:W") else None,
                "precip_mm": daily_value("precip_24h:mm", day),
                "evaporation_mm": daily_value("evaporation_24h:mm", day),
                "et_provider_mm": daily_value("evapotranspiration_24h:mm", day),
                "provenance": "observed",
            }
            days.append(_finish_day(rec, loc, day))
        _resolve_et0(days, "observed")
        cur_time = max((t for t, _ in latest.values()), default=None)
        locations.append(
            {
                **loc,
                "daily": days,
                "current": {
                    "time": cur_time.isoformat() if cur_time else None,
                    "t_c": latest.get("t_2m:C", (None, None))[1],
                    "rh_pct": latest.get("relative_humidity_2m:p", (None, None))[1],
                    "wind_ms": latest.get("wind_speed_10m:ms", (None, None))[1],
                    "rad_w": latest.get("global_rad:W", (None, None))[1],
                    "provenance": "observed",
                },
            }
        )

    return {
        "mode": "live",
        "status": "ok",
        "source": "Meteomatics Weather API",
        "notice": None,
        "live_error": None,
        "retrieved_at": now.astimezone(timezone.utc).isoformat(),
        "forecast_issued_at": hourly.generated_at or daily_generated,
        "cache": {"hit": False, "age_s": 0, "ttl_s": settings.weather_cache_ttl_s},
        "queries": queries,
        "queries_today": meteomatics.usage_today(),
        "parameters": [{"id": p, "label": PARAM_LABELS[p], "status": s} for p, s in param_status.items()],
        "locations": locations,
        "today": today.isoformat(),
    }


def get_weather(
    now: datetime | None = None,
    *,
    settings: Settings | None = None,
    force_refresh: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Return the weather bundle used by the model and shown in the UI."""
    settings = settings or SETTINGS
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(UAE_TZ).date()

    if not settings.meteomatics_configured:
        reason = "FALAJLINE_FORCE_DEMO is set." if settings.force_demo else "No Meteomatics credentials configured."
        return _demo_bundle(now, f"{reason} Showing synthetic DEMO DATA, not live weather.")

    with _lock:
        cached = _read_cache(today)
        if cached and not force_refresh:
            age = (now - datetime.fromisoformat(cached["retrieved_at"])).total_seconds()
            if age < settings.weather_cache_ttl_s:
                return {**cached, "cache": {"hit": True, "age_s": int(age), "ttl_s": settings.weather_cache_ttl_s}, "queries_today": meteomatics.usage_today()}
        try:
            bundle = _fetch_live(settings, now, transport)
            _write_cache(today, bundle)
            return bundle
        except MeteomaticsError as exc:
            stale = _latest_cache(today)
            if stale and stale.get("mode") == "live":
                age = (now - datetime.fromisoformat(stale["retrieved_at"])).total_seconds()
                return {
                    **stale,
                    "status": "stale",
                    "notice": f"Live refresh failed — showing the last successful Meteomatics response, {int(age // 60)} min old.",
                    "live_error": exc.public(),
                    "cache": {"hit": True, "age_s": int(age), "ttl_s": settings.weather_cache_ttl_s},
                    "queries_today": meteomatics.usage_today(),
                }
            return _demo_bundle(
                now,
                "Live Meteomatics data is unavailable and nothing is cached. Showing synthetic DEMO DATA, not live weather.",
                live_error=exc.public(),
            )


def location(bundle: dict, location_id: str) -> dict:
    return next(loc for loc in bundle["locations"] if loc["id"] == location_id)
