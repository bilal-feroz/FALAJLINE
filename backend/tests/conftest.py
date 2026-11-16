from __future__ import annotations

import sys
from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import SETTINGS  # noqa: E402
from app.model import telemetry as tel  # noqa: E402
from app.weather import meteomatics, service  # noqa: E402

NOW = datetime(2026, 11, 16, 14, 0, tzinfo=timezone.utc)
ANCHOR = date(2026, 11, 16)


@pytest.fixture(autouse=True)
def pinned_scenario(monkeypatch):
    """Pin the simulated-telemetry anchor so results do not depend on the day the tests run."""
    monkeypatch.setattr(tel, "SETTINGS", replace(SETTINGS, sim_anchor=ANCHOR))


@pytest.fixture
def now() -> datetime:
    return NOW


@pytest.fixture
def demo_weather() -> dict:
    return service._demo_bundle(NOW, "test bundle")


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    """Send every cache and usage file to a temp directory and clear the in-memory cache."""
    monkeypatch.setattr(service, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(meteomatics, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(meteomatics, "_USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(service, "_memory", {})
    return tmp_path
