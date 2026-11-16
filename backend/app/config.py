"""Runtime configuration. Credentials are read from the environment / backend/.env only."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Gulf Standard Time. A fixed offset avoids needing the tz database on Windows; the UAE has no DST.
UAE_TZ = timezone(timedelta(hours=4), "GST")


def _load_env_file(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, existing environment variables win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(BACKEND_DIR / ".env")


def _cache_dir() -> Path:
    """Writable cache folder: backend/.cache locally, the temp dir on read-only hosts such as Vercel."""
    override = os.environ.get("FALAJLINE_CACHE_DIR", "").strip()
    if override:
        return Path(override)
    fallback = Path(tempfile.gettempdir()) / "falajline-cache"
    if os.environ.get("VERCEL"):
        return fallback
    local = BACKEND_DIR / ".cache"
    try:
        local.mkdir(parents=True, exist_ok=True)
        probe = local / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return local
    except OSError:
        return fallback


CACHE_DIR = _cache_dir()


@dataclass(frozen=True)
class Settings:
    meteomatics_username: str
    meteomatics_password: str
    meteomatics_base_url: str
    weather_cache_ttl_s: int
    weather_daily_query_budget: int
    force_demo: bool
    sim_anchor: date

    @property
    def meteomatics_configured(self) -> bool:
        return bool(self.meteomatics_username and self.meteomatics_password) and not self.force_demo


def _anchor() -> date:
    raw = os.environ.get("FALAJLINE_SIM_ANCHOR", "").strip()
    if raw:
        return date.fromisoformat(raw)
    return datetime.now(UAE_TZ).date()


def load_settings() -> Settings:
    return Settings(
        meteomatics_username=os.environ.get("METEOMATICS_USERNAME", "").strip(),
        meteomatics_password=os.environ.get("METEOMATICS_PASSWORD", "").strip(),
        meteomatics_base_url=os.environ.get("METEOMATICS_BASE_URL", "https://api.meteomatics.com").strip().rstrip("/"),
        weather_cache_ttl_s=int(os.environ.get("FALAJLINE_WEATHER_CACHE_TTL_S", "10800")),
        weather_daily_query_budget=int(os.environ.get("FALAJLINE_WEATHER_DAILY_BUDGET", "400")),
        force_demo=os.environ.get("FALAJLINE_FORCE_DEMO", "").strip() in {"1", "true", "yes"},
        sim_anchor=_anchor(),
    )


SETTINGS = load_settings()
