"""FALAJLINE API. Run with:  uvicorn app.main:app --port 8000  (from the backend directory)."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import engine
from .alerts.queue import QUEUE
from .config import CACHE_DIR, SETTINGS
from .geo import EAD_WELLS_URL, build_geography
from .model.params import default_params
from .weather import meteomatics
from .weather.service import get_weather

app = FastAPI(title="FALAJLINE", version="0.1.0", description="Early warning intelligence for the falaj irrigation systems of Al Ain Oasis.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_last_weather_refresh = 0.0


def _state(faults: str | None, demand_reduction: float, loss_reduction: float) -> dict:
    try:
        bundle = engine.get_state(faults, demand_reduction, loss_reduction)
    except ValueError as exc:  # e.g. no valid source observations at all
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    QUEUE.sync(bundle["warnings"]["warnings"])
    return bundle


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat(),
        "weather_mode": "live" if SETTINGS.meteomatics_configured else "demo",
        "meteomatics_configured": SETTINGS.meteomatics_configured,
        "meteomatics_queries_today": meteomatics.usage_today(),
        "telemetry": "simulated",
    }


@app.get("/api/state")
def state(
    faults: str | None = Query(None, description='Sensor fault profile, e.g. "S-GW-01:offline,S-FL-B:stale". Omit for the demo default, "none" for a healthy network.'),
    demand_reduction: float = Query(0.15, ge=0.0, le=0.5),
    loss_reduction: float = Query(0.45, ge=0.0, le=0.9),
) -> dict:
    """Everything the UI needs in one response."""
    return {**_state(faults, demand_reduction, loss_reduction), "queue": QUEUE.snapshot()}


@app.get("/api/weather")
def weather() -> dict:
    """Weather bundle: live Meteomatics data when configured (cached), otherwise labelled demo data."""
    return get_weather()


@app.post("/api/weather/refresh")
def weather_refresh() -> dict:
    """Force a new Meteomatics query. Limited to one per minute to protect the daily allowance."""
    global _last_weather_refresh
    if time.time() - _last_weather_refresh < 60:
        raise HTTPException(status_code=429, detail="Weather was refreshed less than a minute ago.")
    _last_weather_refresh = time.time()
    bundle = get_weather(force_refresh=True)
    engine.clear_cache()
    return bundle


@app.get("/api/network")
def network() -> dict:
    """Topology, geography and every model assumption."""
    return {"geo": build_geography(), "params": default_params().to_public(), "disclaimer": engine.DISCLAIMER}


@app.get("/api/telemetry")
def telemetry(faults: str | None = None) -> dict:
    bundle = _state(faults, 0.15, 0.45)
    return {"telemetry": bundle["telemetry"], "state": bundle["state"], "confidence": bundle["confidence"]}


@app.get("/api/forecast")
def forecast(scenario: str = "baseline", faults: str | None = None) -> dict:
    bundle = _state(faults, 0.15, 0.45)
    if scenario not in bundle["scenarios"]:
        raise HTTPException(status_code=404, detail=f"Unknown scenario. Available: {', '.join(bundle['scenario_order'])}")
    return bundle["scenarios"][scenario]


class ScenarioRequest(BaseModel):
    demand_reduction: float = Field(0.15, ge=0.0, le=0.5, description="Fraction of irrigation demand removed")
    loss_reduction: float = Field(0.45, ge=0.0, le=0.9, description="Fraction by which surface-channel seepage is cut")
    faults: str | None = None


@app.post("/api/scenarios")
def scenarios(req: ScenarioRequest) -> dict:
    """Re-run all three scenarios through the model with the given settings."""
    bundle = _state(req.faults, req.demand_reduction, req.loss_reduction)
    return {"scenarios": bundle["scenarios"], "scenario_order": bundle["scenario_order"], "comparison": bundle["comparison"], "settings": bundle["meta"]["scenario_settings"]}


@app.get("/api/warnings")
def warnings(faults: str | None = None) -> dict:
    return _state(faults, 0.15, 0.45)["warnings"]


# -- simulated delivery queue ------------------------------------------------
@app.get("/api/alerts/queue")
def queue() -> dict:
    return QUEUE.snapshot()


class LinkRequest(BaseModel):
    online: bool


@app.post("/api/alerts/queue/link")
def queue_link(req: LinkRequest) -> dict:
    QUEUE.set_link(req.online)
    return QUEUE.snapshot()


@app.post("/api/alerts/queue/retry/{message_id:path}")
def queue_retry(message_id: str) -> dict:
    if not QUEUE.retry(message_id):
        raise HTTPException(status_code=409, detail="Only failed messages can be retried.")
    return QUEUE.snapshot()


@app.post("/api/alerts/queue/redispatch")
def queue_redispatch() -> dict:
    QUEUE.redispatch()
    return QUEUE.snapshot()


# -- public groundwater monitoring wells (real locations, no levels) -----------
@app.get("/api/geo/ead-wells")
def ead_wells() -> dict:
    """Environment Agency – Abu Dhabi groundwater monitoring wells around Al Ain.

    Fetched from EAD's public map service and cached locally for a week. The layer carries well IDs and
    locations only: no water levels. If the service is unreachable the wells are reported as unavailable.
    """
    path = CACHE_DIR / "ead_wells.json"
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if time.time() - cached["fetched_at"] < 7 * 86400:
            return cached
    except (OSError, ValueError, KeyError):
        cached = None
    try:
        resp = httpx.get(EAD_WELLS_URL, timeout=20.0, headers={"User-Agent": "falajline-prototype"})
        resp.raise_for_status()
        features = resp.json().get("features", [])
        wells = [
            {"id": f["properties"].get("WELL"), "frequency": f["properties"].get("MEASFREQ"), "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
            for f in features
            if f.get("geometry")
        ]
        payload = {
            "available": True,
            "provenance": "observed",
            "source": "Environment Agency – Abu Dhabi, Groundwater Level Monitoring Wells (public map service)",
            "note": "Well IDs and locations only. The public layer carries no water levels, so these wells are context, not model input.",
            "fetched_at": time.time(),
            "wells": wells,
        }
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return payload
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        if cached:
            return {**cached, "note": cached["note"] + " (Served from an older local copy; the service could not be reached.)"}
        return {"available": False, "provenance": "unavailable", "reason": f"EAD map service could not be reached ({type(exc).__name__}).", "wells": []}
