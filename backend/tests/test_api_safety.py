"""The public deployment must not let anyone spend the Meteomatics allowance or see the credentials."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import main


def test_forced_refresh_is_closed_on_vercel_without_a_token(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("FALAJLINE_REFRESH_TOKEN", raising=False)
    assert TestClient(main.app).post("/api/weather/refresh").status_code == 403


def test_forced_refresh_needs_the_right_token(monkeypatch):
    monkeypatch.setenv("FALAJLINE_REFRESH_TOKEN", "s3cret-token")
    r = TestClient(main.app).post("/api/weather/refresh", headers={"authorization": "Bearer wrong"})
    assert r.status_code == 403


def test_health_reports_configuration_but_never_the_credentials():
    r = TestClient(main.app).get("/api/health")
    assert r.status_code == 200
    body = r.text.lower()
    assert "password" not in body and "username" not in body
