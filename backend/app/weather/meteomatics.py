"""Thin client for the Meteomatics Weather API.

URL pattern (documented):  {base}/{start}--{end}:{step}/{param1,param2}/{lat,lon+lat,lon}/json
Authentication is HTTP basic auth; credentials stay on the server and are never sent to the browser.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from ..config import CACHE_DIR, Settings

MISSING_SENTINEL = -900.0  # Meteomatics uses -999 for "no data"


class MeteomaticsError(Exception):
    def __init__(self, kind: str, message: str, status: int | None = None):
        super().__init__(message)
        self.kind = kind  # auth | forbidden | rate_limit | bad_request | not_found | server | network | budget
        self.status = status
        self.message = message

    def public(self) -> dict:
        return {"kind": self.kind, "status": self.status, "message": self.message}


@dataclass
class QueryResult:
    path: str  # request path without host or credentials, safe to show in the UI
    generated_at: str | None
    series: dict[str, list[list[tuple[datetime, float | None]]]]  # param -> per-location [(time, value)]
    elapsed_ms: int


_USAGE_FILE = CACHE_DIR / "meteomatics_usage.json"


def usage_today() -> int:
    try:
        data = json.loads(_USAGE_FILE.read_text(encoding="utf-8"))
        if data.get("date") == datetime.now(timezone.utc).date().isoformat():
            return int(data.get("count", 0))
    except (OSError, ValueError):
        pass
    return 0


def _count_query() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"date": datetime.now(timezone.utc).date().isoformat(), "count": usage_today() + 1}
    _USAGE_FILE.write_text(json.dumps(payload), encoding="utf-8")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _classify(status: int, body: str) -> MeteomaticsError:
    detail = body.strip().replace("\n", " ")[:220]
    if status == 401:
        return MeteomaticsError("auth", "Meteomatics rejected the credentials (HTTP 401). Check METEOMATICS_USERNAME / METEOMATICS_PASSWORD.", status)
    if status == 403:
        return MeteomaticsError("forbidden", f"Meteomatics refused this request for the account (HTTP 403). {detail}", status)
    if status == 429:
        return MeteomaticsError("rate_limit", "Meteomatics rate limit reached (HTTP 429). Serving cached data until it resets.", status)
    if status == 404:
        return MeteomaticsError("not_found", f"Meteomatics has no data for this request (HTTP 404). {detail}", status)
    if 400 <= status < 500:
        return MeteomaticsError("bad_request", f"Meteomatics rejected the request (HTTP {status}). {detail}", status)
    return MeteomaticsError("server", f"Meteomatics server error (HTTP {status}).", status)


def fetch(
    settings: Settings,
    *,
    start: datetime,
    end: datetime,
    step: str,
    parameters: list[str],
    locations: list[dict],
    transport: httpx.BaseTransport | None = None,
    attempts: int = 3,
) -> QueryResult:
    """Run one query. Retries only transient failures (network errors, 5xx)."""
    if usage_today() >= settings.weather_daily_query_budget:
        raise MeteomaticsError("budget", f"Local daily query budget of {settings.weather_daily_query_budget} reached; not calling the API.")

    coords = "+".join(f"{loc['lat']},{loc['lon']}" for loc in locations)
    path = f"/{_iso(start)}--{_iso(end)}:{step}/{','.join(parameters)}/{coords}/json"
    url = settings.meteomatics_base_url + path
    last: MeteomaticsError | None = None
    for attempt in range(attempts):
        t0 = time.perf_counter()
        try:
            with httpx.Client(transport=transport, timeout=httpx.Timeout(25.0, connect=10.0)) as client:
                resp = client.get(url, auth=(settings.meteomatics_username, settings.meteomatics_password))
            _count_query()
        except httpx.HTTPError as exc:
            last = MeteomaticsError("network", f"Could not reach Meteomatics ({type(exc).__name__}).")
            time.sleep(0.6 * (attempt + 1))
            continue
        elapsed = int((time.perf_counter() - t0) * 1000)
        if resp.status_code >= 500:
            last = _classify(resp.status_code, resp.text)
            time.sleep(0.6 * (attempt + 1))
            continue
        if resp.status_code != 200:
            raise _classify(resp.status_code, resp.text)
        try:
            body = resp.json()
        except ValueError as exc:
            raise MeteomaticsError("server", "Meteomatics returned a response that is not valid JSON.") from exc
        return QueryResult(path=path, generated_at=body.get("dateGenerated"), series=_parse(body, len(locations)), elapsed_ms=elapsed)
    assert last is not None
    raise last


def _parse(body: dict, n_locations: int) -> dict[str, list[list[tuple[datetime, float | None]]]]:
    out: dict[str, list[list[tuple[datetime, float | None]]]] = {}
    for block in body.get("data", []):
        per_location: list[list[tuple[datetime, float | None]]] = []
        for coord in block.get("coordinates", [])[:n_locations]:
            rows = []
            for item in coord.get("dates", []):
                value = item.get("value")
                if value is None or (isinstance(value, (int, float)) and value <= MISSING_SENTINEL):
                    value = None  # missing stays missing; it is never turned into a number
                when = datetime.fromisoformat(item["date"].replace("Z", "+00:00"))
                rows.append((when, None if value is None else float(value)))
            per_location.append(rows)
        out[block.get("parameter", "?")] = per_location
    return out
