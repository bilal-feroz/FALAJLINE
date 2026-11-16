"""Meteomatics integration: parsing, caching, failure handling and the labelled demo fallback.

No network: the API is replaced by an httpx mock transport.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
from urllib.parse import unquote

import httpx
import pytest

from app.config import SETTINGS
from app.weather import meteomatics, service
from app.weather.service import get_weather

LIVE = replace(SETTINGS, meteomatics_username="user", meteomatics_password="pass", meteomatics_base_url="https://api.example.test", force_demo=False)
NO_CREDS = replace(SETTINGS, meteomatics_username="", meteomatics_password="", force_demo=False)
VALUES = {"t_2m:C": 24.0, "relative_humidity_2m:p": 50.0, "wind_speed_10m:ms": 2.5, "global_rad:W": 200.0,
          "wind_dir_10m:d": 315.0, "wind_gusts_10m_1h:ms": 6.0, "total_cloud_cover:p": 20.0,
          "precip_24h:mm": 0.0, "evaporation_24h:mm": -0.07, "evapotranspiration_24h:mm": 3.9,
          "prob_precip_24h:p": 2.0, "soil_moisture_index_-15cm:idx": 0.1}


def fake_api(*, status=200, reject=(), missing=(), horizon_days=None, calls=None):
    """A stand-in Meteomatics server. `reject`: parameters that make a query fail with 400.
    `missing`: parameters returned as -999. `horizon_days`: values beyond this many days are null."""

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        assert request.headers.get("authorization", "").startswith("Basic ")
        if status != 200:
            return httpx.Response(status, text="error")
        span, params, coords, _ = unquote(request.url.path).strip("/").split("/")
        params = params.split(",")
        if any(p in reject for p in params):
            return httpx.Response(400, text="parameter not available")
        rng, step = span.rsplit(":", 1)
        start, end = (datetime.fromisoformat(x.replace("Z", "+00:00")) for x in rng.split("--"))
        delta = timedelta(hours=1) if step == "PT1H" else timedelta(days=1)
        times = []
        while start <= end:
            times.append(start)
            start += delta
        cutoff = None if horizon_days is None else times[0] + timedelta(days=horizon_days)
        data = []
        for p in params:
            rows = []
            for t in times:
                v = -999 if p in missing else VALUES[p]
                if cutoff and t > cutoff:
                    v = None
                rows.append({"date": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "value": v})
            data.append({"parameter": p, "coordinates": [{"lat": 0, "lon": 0, "dates": rows} for _ in coords.split("+")]})
        return httpx.Response(200, json={"status": "OK", "dateGenerated": "2026-11-16T14:00:00Z", "data": data})

    return httpx.MockTransport(handler)


def oasis(bundle):
    return next(loc for loc in bundle["locations"] if loc["id"] == "oasis")


def test_no_credentials_gives_labelled_demo_data(now, isolated_cache):
    b = get_weather(now, settings=NO_CREDS)
    assert b["mode"] == "demo" and "DEMO DATA" in b["source"] and "DEMO DATA" in b["notice"]
    assert all(d["provenance"] == "simulated" and d["et0_provenance"] == "simulated" for d in oasis(b)["daily"])
    assert b["queries"] == [] and b["forecast_issued_at"] is None


def test_live_response_is_parsed_and_marked_observed(now, isolated_cache):
    calls = []
    b = get_weather(now, settings=LIVE, transport=fake_api(calls=calls))
    assert b["mode"] == "live" and b["status"] == "ok" and b["source"] == "Meteomatics Weather API"
    assert len(calls) == 2, "one hourly and one daily query per refresh, both locations in each"
    assert all("+" in unquote(c) for c in calls)
    days = oasis(b)["daily"]
    assert len(days) == service.HISTORY_DAYS + service.FORECAST_DAYS + 1
    assert all(d["provenance"] == "observed" and d["et0_source"] == "provider" and d["et0_mm"] == 3.9 for d in days)
    assert all(d["t_mean_c"] == 24.0 and d["et0_fao_mm"] is not None for d in days)
    assert b["forecast_issued_at"] and b["retrieved_at"] and {p["status"] for p in b["parameters"]} == {"ok"}
    assert "user" not in str(b) and "pass" not in " ".join(q["path"] for q in b["queries"])


def test_second_call_is_served_from_cache(now, isolated_cache):
    calls = []
    get_weather(now, settings=LIVE, transport=fake_api(calls=calls))
    again = get_weather(now + timedelta(minutes=10), settings=LIVE, transport=fake_api(calls=calls))
    assert len(calls) == 2 and again["cache"]["hit"] and again["cache"]["age_s"] == 600
    get_weather(now + timedelta(seconds=LIVE.weather_cache_ttl_s + 1), settings=LIVE, transport=fake_api(calls=calls))
    assert len(calls) == 4, "cache expires after the TTL"


def test_invalid_credentials_do_not_become_fake_live_data(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(status=401))
    assert b["mode"] == "demo" and b["status"] == "live_failed"
    assert b["live_error"]["kind"] == "auth" and b["live_error"]["status"] == 401
    assert all(d["provenance"] == "simulated" for d in oasis(b)["daily"])


def test_rate_limit_serves_last_good_response_marked_stale(now, isolated_cache):
    get_weather(now, settings=LIVE, transport=fake_api())
    later = now + timedelta(seconds=LIVE.weather_cache_ttl_s + 60)
    b = get_weather(later, settings=LIVE, transport=fake_api(status=429))
    assert b["mode"] == "live" and b["status"] == "stale" and b["live_error"]["kind"] == "rate_limit"
    assert "last successful" in b["notice"] and b["cache"]["age_s"] > LIVE.weather_cache_ttl_s


def test_rate_limit_with_nothing_cached_falls_back_to_labelled_demo(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(status=429))
    assert b["mode"] == "demo" and b["live_error"]["kind"] == "rate_limit"


def test_network_failure_is_retried_then_reported(now, isolated_cache, monkeypatch):
    monkeypatch.setattr(meteomatics.time, "sleep", lambda _s: None)
    attempts = []

    def boom(request):
        attempts.append(1)
        raise httpx.ConnectError("down")

    b = get_weather(now, settings=LIVE, transport=httpx.MockTransport(boom))
    # the hourly and daily queries each retry three times before giving up
    assert len(attempts) == 6 and b["mode"] == "demo" and b["live_error"]["kind"] == "network"


def test_unsupported_optional_parameter_degrades_gracefully(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(reject=("evapotranspiration_24h:mm",)))
    status = {p["id"]: p["status"] for p in b["parameters"]}
    assert b["mode"] == "live" and status["evapotranspiration_24h:mm"] == "unsupported" and status["precip_24h:mm"] == "ok"
    day = oasis(b)["daily"][10]
    assert day["et_provider_mm"] is None and day["evaporation_mm"] is None
    assert day["et0_source"] == "fao56" and day["et0_provenance"] == "modelled" and day["et0_mm"] == day["et0_fao_mm"] > 0


def test_missing_values_stay_missing(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(missing=("precip_24h:mm", "wind_speed_10m:ms", "evapotranspiration_24h:mm")))
    day = oasis(b)["daily"][10]
    assert day["precip_mm"] is None and day["wind_mean_ms"] is None and day["et_provider_mm"] is None
    assert "wind_mean_ms" in day["missing"] and "precip_mm" in day["missing"]
    assert day["et0_fao_mm"] is None, "ET0 is not computed from incomplete drivers"


def test_days_beyond_provider_horizon_are_extended_and_flagged(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(horizon_days=20))
    days = oasis(b)["daily"]
    ext = [d for d in days if d["et0_source"] == "extended"]
    assert ext and all(d["et0_provenance"] == "modelled" and d["t_mean_c"] is None for d in ext)
    assert all(d["et0_mm"] == pytest.approx(3.9) for d in ext)


def test_local_query_budget_blocks_calls(now, isolated_cache):
    calls = []
    b = get_weather(now, settings=replace(LIVE, weather_daily_query_budget=0), transport=fake_api(calls=calls))
    assert calls == [] and b["mode"] == "demo" and b["live_error"]["kind"] == "budget"


def test_new_parameters_are_aggregated_per_day(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api())
    day = oasis(b)["daily"][10]
    assert day["wind_dir_deg"] == 315.0 and day["gust_max_ms"] == 6.0 and day["cloud_pct"] == 20.0
    assert day["prob_precip_pct"] == 2.0 and day["soil_moisture_idx"] == 0.1
    assert oasis(b)["current"]["wind_dir_deg"] == 315.0


def test_rejected_optional_hourly_parameter_keeps_the_core(now, isolated_cache):
    b = get_weather(now, settings=LIVE, transport=fake_api(reject=("wind_dir_10m:d",)))
    status = {p["id"]: p["status"] for p in b["parameters"]}
    assert b["mode"] == "live" and status["wind_dir_10m:d"] == "unsupported" and status["t_2m:C"] == "ok"
    day = oasis(b)["daily"][10]
    assert day["wind_dir_deg"] is None and day["t_mean_c"] == 24.0


def test_vector_mean_wind_direction_wraps_north():
    from app.weather.service import _vector_mean_dir
    assert _vector_mean_dir([1.0, 1.0], [350.0, 10.0]) in (0.0, 360.0)
    assert _vector_mean_dir([3.0, 1.0], [90.0, 180.0]) == pytest.approx(108.0, abs=1.0)
    assert _vector_mean_dir([], []) is None


def test_history_summarises_real_rain_events(now, isolated_cache):
    rain = {"2026-08-22": 52.8, "2026-10-17": 8.4, "2026-10-18": 12.0, "2026-11-02": 1.2}

    def handler(request):
        span, params, coords, _ = unquote(request.url.path).strip("/").split("/")
        rng, step = span.rsplit(":", 1)
        start, end = (datetime.fromisoformat(x.replace("Z", "+00:00")) for x in rng.split("--"))
        rows = []
        t = start
        while t <= end:
            local_day = (t + timedelta(hours=4) - timedelta(days=1)).date().isoformat()
            rows.append({"date": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "value": rain.get(local_day, 0.0)})
            t += timedelta(days=1)
        data = [{"parameter": params, "coordinates": [{"lat": 0, "lon": 0, "dates": rows} for _ in coords.split("+")]}]
        return httpx.Response(200, json={"status": "OK", "data": data})

    h = service.get_history(now, settings=LIVE, transport=httpx.MockTransport(handler))
    assert h["available"] and h["provenance"] == "observed" and h["threshold_mm"] == 5.0
    rec = next(loc for loc in h["locations"] if loc["id"] == "recharge")
    assert rec["total_mm"] == pytest.approx(74.4) and rec["recharge_events"] == 3 and rec["rain_days"] == 4
    assert rec["last_recharge_event"] == {"date": "2026-10-18", "mm": 12.0, "days_ago": 29}
    assert rec["wettest_day"]["date"] == "2026-08-22"
    assert service.get_history(now, settings=LIVE, transport=httpx.MockTransport(handler))["cache_age_s"] == 0  # second call is cached


def test_history_and_field_are_never_invented_without_live_access(now, isolated_cache):
    assert service.get_history(now, settings=NO_CREDS)["available"] is False
    assert service.get_field(now, settings=NO_CREDS)["available"] is False
    down = httpx.MockTransport(lambda r: httpx.Response(401, text="no"))
    assert service.get_history(now, settings=LIVE, transport=down)["available"] is False
    assert service.get_field(now, settings=LIVE, transport=down)["available"] is False


def test_field_csv_matrix_is_parsed_north_first(now, isolated_cache):
    csv = "validdate;2026-11-17 00:00:00\nparameter;evapotranspiration_24h:mm\ndata;51.4;51.45;51.5\n22.4;4.1;4.2;-999\n22.45;4.3;4.4;4.5\n"
    f = service.get_field(now, settings=LIVE, transport=httpx.MockTransport(lambda r: httpx.Response(200, text=csv)))
    assert f["available"] and f["lats"] == [22.45, 22.4] and f["lons"] == [51.4, 51.45, 51.5]
    assert f["values"] == [[4.3, 4.4, 4.5], [4.1, 4.2, None]] and f["min"] == 4.1 and f["max"] == 4.5
