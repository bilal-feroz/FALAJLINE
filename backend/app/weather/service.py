"""Weather for the model: live Meteomatics data when configured, cached on disk, with explicit fallbacks.

Rules enforced here:
  * Two API queries per refresh (hourly + daily, run in parallel), both locations in each, reused for
    `weather_cache_ttl_s`. Rainfall history and the UAE field are separate queries with longer caches.
  * A failed live call never turns into silent synthetic data: either a previously fetched response is served
    and marked stale, or the bundle switches to mode="demo" and carries the live error for the UI to show.
  * A value the provider did not return stays None. Days without provider ET0 are computed (FAO-56) or
    extended from the last valid days and are marked "modelled".
"""
from __future__ import annotations

import json
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import httpx

from ..config import CACHE_DIR, SETTINGS, UAE_TZ, Settings
from ..geo import WEATHER_LOCATIONS
from ..model.et0 import et0_fao56
from . import demo, meteomatics
from .meteomatics import MeteomaticsError

HISTORY_DAYS = 7
FORECAST_DAYS = 21

HOURLY_CORE = ["t_2m:C", "relative_humidity_2m:p", "wind_speed_10m:ms", "global_rad:W"]
HOURLY_OPTIONAL = ["wind_dir_10m:d", "wind_gusts_10m_1h:ms", "total_cloud_cover:p"]
HOURLY_PARAMS = HOURLY_CORE + HOURLY_OPTIONAL
DAILY_CORE = ["precip_24h:mm"]
DAILY_OPTIONAL = ["evaporation_24h:mm", "evapotranspiration_24h:mm", "prob_precip_24h:p", "soil_moisture_index_-15cm:idx"]

PARAM_LABELS = {
    "t_2m:C": "Air temperature 2 m",
    "relative_humidity_2m:p": "Relative humidity 2 m",
    "wind_speed_10m:ms": "Wind speed 10 m",
    "global_rad:W": "Global radiation",
    "precip_24h:mm": "Precipitation, 24 h",
    "evaporation_24h:mm": "Evaporation, 24 h",
    "evapotranspiration_24h:mm": "Evapotranspiration, 24 h",
    "wind_dir_10m:d": "Wind direction 10 m",
    "wind_gusts_10m_1h:ms": "Wind gusts 10 m",
    "total_cloud_cover:p": "Total cloud cover",
    "prob_precip_24h:p": "Probability of precipitation, 24 h",
    "soil_moisture_index_-15cm:idx": "Soil moisture index, 15 cm",
}

_lock = threading.Lock()
_memory: dict[str, dict] = {}


_LOC_SIG = "_".join(f"{loc['lat']:.3f}-{loc['lon']:.3f}" for loc in WEATHER_LOCATIONS)


def _cache_path(day: date):
    # the sampled coordinates are part of the key, so moving a location never reuses old data
    return CACHE_DIR / f"weather_{day.isoformat()}_{_LOC_SIG}.json"


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
                    "wind_dir_deg": today_rec["wind_dir_deg"],
                    "gust_ms": today_rec["gust_max_ms"],
                    "cloud_pct": today_rec["cloud_pct"],
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


def _fetch_with_fallback(settings, core, optional, status, label, queries, transport, **kw):
    """Query core + optional parameters; if the account rejects an optional one, retry with the core set."""
    try:
        res = meteomatics.fetch(settings, parameters=core + optional, locations=WEATHER_LOCATIONS, transport=transport, **kw)
        queries.append({"path": res.path, "elapsed_ms": res.elapsed_ms, "status": "ok"})
        return res
    except MeteomaticsError as exc:
        if exc.kind not in {"bad_request", "forbidden", "not_found"} or not optional:
            raise
        queries.append({"path": f"({label}, all parameters)", "elapsed_ms": 0, "status": f"rejected: {exc.message}"})
        for prm in optional:
            status[prm] = "unsupported"
        res = meteomatics.fetch(settings, parameters=core, locations=WEATHER_LOCATIONS, transport=transport, **kw)
        queries.append({"path": res.path, "elapsed_ms": res.elapsed_ms, "status": "ok"})
        return res


def _vector_mean_dir(speeds: list[float], dirs: list[float]) -> float | None:
    """Speed-weighted mean of meteorological wind directions (degrees the wind blows FROM)."""
    if not speeds or len(speeds) != len(dirs):
        return None
    u = sum(-sp * math.sin(math.radians(d)) for sp, d in zip(speeds, dirs))
    v = sum(-sp * math.cos(math.radians(d)) for sp, d in zip(speeds, dirs))
    if abs(u) < 1e-9 and abs(v) < 1e-9:
        return None
    return round((math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0, 0)


def _fetch_live(settings: Settings, now: datetime, transport: httpx.BaseTransport | None) -> dict:
    today = now.astimezone(UAE_TZ).date()
    first = today - timedelta(days=HISTORY_DAYS)
    last = today + timedelta(days=FORECAST_DAYS)
    # Local days: a UAE day D runs from D-1 20:00Z to D 20:00Z.
    h_start = datetime(first.year, first.month, first.day, tzinfo=UAE_TZ)
    h_end = datetime(last.year, last.month, last.day, 23, tzinfo=UAE_TZ)
    d_start = datetime(first.year, first.month, first.day, tzinfo=UAE_TZ) + timedelta(days=1)  # value at D+1 00:00 local = day D
    d_end = datetime(last.year, last.month, last.day, tzinfo=UAE_TZ) + timedelta(days=1)

    queries: list[dict] = []
    param_status = {prm: "ok" for prm in HOURLY_PARAMS + DAILY_CORE + DAILY_OPTIONAL}

    # The hourly and daily queries are independent: run them side by side to keep cold starts short.
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_hourly = pool.submit(_fetch_with_fallback, settings, HOURLY_CORE, HOURLY_OPTIONAL, param_status, "hourly", queries, transport,
                               start=h_start, end=h_end, step="PT1H")
        f_daily = pool.submit(_fetch_with_fallback, settings, DAILY_CORE, DAILY_OPTIONAL, param_status, "daily", queries, transport,
                              start=d_start, end=d_end, step="P1D")
        hourly = f_hourly.result()
        daily_series: dict = {}
        daily_generated = None
        try:
            daily = f_daily.result()
            daily_series, daily_generated = daily.series, daily.generated_at
        except MeteomaticsError as exc:
            if exc.kind in {"auth", "rate_limit", "budget"}:
                raise
            param_status["precip_24h:mm"] = "unavailable"
            queries.append({"path": "(daily)", "elapsed_ms": 0, "status": f"failed: {exc.message}"})

    for prm in HOURLY_PARAMS:
        if param_status[prm] == "ok" and prm not in hourly.series:
            param_status[prm] = "unavailable"
    for prm in DAILY_CORE + DAILY_OPTIONAL:
        if param_status[prm] == "ok" and prm not in daily_series:
            param_status[prm] = "unavailable"

    locations = []
    for li, loc in enumerate(WEATHER_LOCATIONS):
        buckets: dict[date, dict[str, list[float]]] = {}
        paired: dict[date, dict[datetime, dict[str, float]]] = {}
        latest: dict[str, tuple[datetime, float]] = {}
        for prm in HOURLY_PARAMS:
            for when, value in (hourly.series.get(prm) or [[]] * len(WEATHER_LOCATIONS))[li]:
                if value is None:
                    continue
                day = when.astimezone(UAE_TZ).date()
                buckets.setdefault(day, {}).setdefault(prm, []).append(value)
                paired.setdefault(day, {}).setdefault(when, {})[prm] = value
                if when <= now and (prm not in latest or when > latest[prm][0]):
                    latest[prm] = (when, value)

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
            enough = lambda prm: len(b.get(prm, [])) >= 20  # noqa: E731 - need most of the day to trust a daily mean
            temps = b.get("t_2m:C", []) if enough("t_2m:C") else []
            hours = [h for h in paired.get(day, {}).values() if "wind_speed_10m:ms" in h and "wind_dir_10m:d" in h]
            wind_dir = _vector_mean_dir([h["wind_speed_10m:ms"] for h in hours], [h["wind_dir_10m:d"] for h in hours]) if len(hours) >= 20 else None
            rec = {
                "date": day.isoformat(),
                "kind": "past" if day < today else "today" if day == today else "forecast",
                "t_mean_c": round(_mean(temps), 1) if temps else None,
                "t_max_c": round(max(temps), 1) if temps else None,
                "t_min_c": round(min(temps), 1) if temps else None,
                "rh_mean_pct": round(_mean(b["relative_humidity_2m:p"]), 1) if enough("relative_humidity_2m:p") else None,
                "wind_mean_ms": round(_mean(b["wind_speed_10m:ms"]), 2) if enough("wind_speed_10m:ms") else None,
                "wind_dir_deg": wind_dir,
                "gust_max_ms": round(max(b["wind_gusts_10m_1h:ms"]), 1) if enough("wind_gusts_10m_1h:ms") else None,
                "cloud_pct": round(_mean(b["total_cloud_cover:p"]), 0) if enough("total_cloud_cover:p") else None,
                "rad_mean_w": round(_mean(b["global_rad:W"]), 1) if enough("global_rad:W") else None,
                "precip_mm": daily_value("precip_24h:mm", day),
                "prob_precip_pct": daily_value("prob_precip_24h:p", day),
                "soil_moisture_idx": daily_value("soil_moisture_index_-15cm:idx", day),
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
                    "wind_dir_deg": latest.get("wind_dir_10m:d", (None, None))[1],
                    "gust_ms": latest.get("wind_gusts_10m_1h:ms", (None, None))[1],
                    "cloud_pct": latest.get("total_cloud_cover:p", (None, None))[1],
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
        "parameters": [{"id": prm, "label": PARAM_LABELS[prm], "status": st} for prm, st in param_status.items()],
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


# --------------------------------------------------------------------------------------------------------------
# Rainfall history (context for the source) and the UAE evaporative-demand field (shown in the opening sequence).
# Both are real Meteomatics data with their own, longer caches. Neither is ever synthesised: without live access
# they are reported as unavailable.
# --------------------------------------------------------------------------------------------------------------
HISTORY_TTL_S = 12 * 3600
FIELD_TTL_S = 6 * 3600
RECHARGE_RAIN_MM = 5.0  # same threshold the model uses before rain is credited as recharge
FIELD_BOX = {"lat_max": 26.4, "lon_min": 51.4, "lat_min": 22.4, "lon_max": 56.6, "res": 0.05}
_side_lock = threading.Lock()


def _json_cached(name: str, ttl_s: int, now: datetime) -> dict | None:
    try:
        payload = json.loads((CACHE_DIR / name).read_text(encoding="utf-8"))
        age = (now - datetime.fromisoformat(payload["retrieved_at"])).total_seconds()
        return {**payload, "cache_age_s": int(age)} if age < ttl_s else None
    except (OSError, ValueError, KeyError):
        return None


def _json_store(name: str, payload: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / name).write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        pass  # a cache that cannot be written only costs another query later


def _summarise_rain(rows: list[tuple[date, float | None]], today: date) -> dict:
    values = [(d, v) for d, v in rows if v is not None]
    events = [(d, v) for d, v in values if v >= RECHARGE_RAIN_MM]
    monthly: dict[str, float] = {}
    for d, v in values:
        monthly[d.strftime("%Y-%m")] = monthly.get(d.strftime("%Y-%m"), 0.0) + v
    wettest = max(values, key=lambda dv: dv[1]) if values else None
    last = events[-1] if events else None
    return {
        "total_mm": round(sum(v for _, v in values), 1),
        "rain_days": sum(1 for _, v in values if v >= 1.0),
        "missing_days": sum(1 for _, v in rows if v is None),
        "recharge_events": len(events),
        "last_recharge_event": None if last is None else {"date": last[0].isoformat(), "mm": round(last[1], 1), "days_ago": (today - last[0]).days},
        "recent_events": [{"date": d.isoformat(), "mm": round(v, 1)} for d, v in events[-6:]],
        "wettest_day": None if wettest is None else {"date": wettest[0].isoformat(), "mm": round(wettest[1], 1)},
        "monthly": [{"month": k, "mm": round(v, 1)} for k, v in sorted(monthly.items())],
    }


def get_history(now: datetime | None = None, *, settings: Settings | None = None, transport: httpx.BaseTransport | None = None) -> dict:
    """Daily rainfall over the last 365 days at the oasis and the upstream recharge area."""
    settings = settings or SETTINGS
    now = now or datetime.now(timezone.utc)
    if not settings.meteomatics_configured:
        return {"available": False, "provenance": "unavailable", "reason": "Rainfall history needs live Meteomatics access; demo mode does not invent it."}
    today = now.astimezone(UAE_TZ).date()
    name = f"history_{today.isoformat()}_{_LOC_SIG}.json"
    with _side_lock:
        cached = _json_cached(name, HISTORY_TTL_S, now)
        if cached:
            return cached
        first = today - timedelta(days=365)
        start = datetime(first.year, first.month, first.day, tzinfo=UAE_TZ) + timedelta(days=1)
        end = datetime(today.year, today.month, today.day, tzinfo=UAE_TZ)  # value at local midnight = the day before
        try:
            res = meteomatics.fetch(settings, start=start, end=end, step="P1D", parameters=["precip_24h:mm"], locations=WEATHER_LOCATIONS, transport=transport)
        except MeteomaticsError as exc:
            return {"available": False, "provenance": "unavailable", "reason": exc.message, "live_error": exc.public()}
        locations = []
        for li, loc in enumerate(WEATHER_LOCATIONS):
            rows = [((when.astimezone(UAE_TZ) - timedelta(days=1)).date(), value) for when, value in (res.series.get("precip_24h:mm") or [[]] * len(WEATHER_LOCATIONS))[li]]
            locations.append({"id": loc["id"], "name": loc["name"], **_summarise_rain(rows, today)})
        payload = {
            "available": True,
            "provenance": "observed",
            "source": "Meteomatics Weather API · precip_24h:mm",
            "threshold_mm": RECHARGE_RAIN_MM,
            "period": {"from": first.isoformat(), "to": (today - timedelta(days=1)).isoformat()},
            "locations": locations,
            "retrieved_at": now.astimezone(timezone.utc).isoformat(),
            "path": res.path,
        }
        _json_store(name, payload)
        return payload


def get_field(now: datetime | None = None, *, settings: Settings | None = None, transport: httpx.BaseTransport | None = None) -> dict:
    """Today's reference evapotranspiration over the UAE on a 0.05° grid (one Meteomatics query)."""
    settings = settings or SETTINGS
    now = now or datetime.now(timezone.utc)
    if not settings.meteomatics_configured:
        return {"available": False, "provenance": "unavailable", "reason": "The live UAE field needs Meteomatics access; demo mode does not invent it."}
    today = now.astimezone(UAE_TZ).date()
    name = f"field_et0_{today.isoformat()}.json"
    with _side_lock:
        cached = _json_cached(name, FIELD_TTL_S, now)
        if cached:
            return cached
        valid = datetime(today.year, today.month, today.day, tzinfo=UAE_TZ) + timedelta(days=1)  # 24 h ending at local midnight
        try:
            grid = meteomatics.fetch_grid(settings, when=valid, parameter="evapotranspiration_24h:mm", transport=transport, **FIELD_BOX)
        except MeteomaticsError as exc:
            return {"available": False, "provenance": "unavailable", "reason": exc.message, "live_error": exc.public()}
        flat = [v for row in grid.values for v in row if v is not None]
        payload = {
            "available": True,
            "provenance": "observed",
            "source": "Meteomatics Weather API · evapotranspiration_24h:mm",
            "label": "Evaporative demand today",
            "unit": "mm/day",
            "day": today.isoformat(),
            "valid_until": valid.astimezone(timezone.utc).isoformat(),
            "lats": grid.lats,
            "lons": grid.lons,
            "values": [[None if v is None else round(v, 2) for v in row] for row in grid.values],
            "min": round(min(flat), 2) if flat else None,
            "max": round(max(flat), 2) if flat else None,
            "retrieved_at": now.astimezone(timezone.utc).isoformat(),
            "path": grid.path,
        }
        _json_store(name, payload)
        return payload
