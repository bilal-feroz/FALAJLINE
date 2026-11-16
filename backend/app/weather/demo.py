"""DEMO DATA weather: synthetic, deterministic, and always labelled as such.

Used only when no Meteomatics credentials are configured (or the live API cannot be reached and nothing is
cached). Values are built from approximate monthly climate normals for Al Ain plus smooth pseudo-variability.
They are never presented as measurements.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

# Approximate monthly normals for Al Ain (index 0 = January).
_T_MAX = [24.0, 27.0, 31.0, 36.0, 41.0, 43.5, 44.0, 43.5, 41.0, 36.5, 30.5, 26.0]
_T_MIN = [12.0, 14.0, 17.0, 20.5, 24.5, 27.0, 29.5, 29.5, 26.0, 22.0, 17.5, 14.0]
_RH = [60.0, 55.0, 46.0, 38.0, 32.0, 33.0, 38.0, 40.0, 42.0, 45.0, 55.0, 60.0]
_WIND = [3.0, 3.3, 3.6, 3.7, 3.8, 3.8, 3.6, 3.5, 3.2, 2.9, 2.8, 2.9]
_RAD = [175.0, 210.0, 245.0, 285.0, 315.0, 320.0, 300.0, 290.0, 270.0, 235.0, 195.0, 170.0]


def _interp(table: list[float], day: date) -> float:
    """Blend between mid-month normals so the series has no steps at month boundaries."""
    pos = (day.month - 1) + (day.day - 15) / 30.0
    lo = math.floor(pos)
    frac = pos - lo
    return table[lo % 12] * (1 - frac) + table[(lo + 1) % 12] * frac


def _wobble(day: date, salt: float) -> float:
    n = day.toordinal()
    return 0.6 * math.sin(n * 0.71 + salt) + 0.4 * math.sin(n * 0.23 + salt * 2.3)


def synth_day(day: date, location_id: str) -> dict:
    salt = 1.3 if location_id == "oasis" else 2.9
    cooler = 0.0 if location_id == "oasis" else -1.4  # piedmont sits higher
    w = _wobble(day, salt)
    t_max = _interp(_T_MAX, day) + cooler + 1.4 * w
    t_min = _interp(_T_MIN, day) + cooler + 1.0 * w
    return {
        "t_mean_c": round((t_max + t_min) / 2, 1),
        "t_max_c": round(t_max, 1),
        "t_min_c": round(t_min, 1),
        "rh_mean_pct": round(max(12.0, min(95.0, _interp(_RH, day) - 5.0 * w)), 1),
        "wind_mean_ms": round(max(0.5, _interp(_WIND, day) + 0.5 * _wobble(day, salt + 4.0)), 1),
        "wind_dir_deg": round((315.0 + 40.0 * _wobble(day, salt + 7.0)) % 360.0, 0),  # prevailing north-westerly shamal
        "gust_max_ms": round(max(2.0, 2.0 * _interp(_WIND, day) + 1.2 * _wobble(day, salt + 5.0)), 1),
        "cloud_pct": round(max(0.0, 12.0 + 10.0 * _wobble(day, salt + 9.0)), 0),
        "prob_precip_pct": None,
        "soil_moisture_idx": None,
        "rad_mean_w": round(_interp(_RAD, day) * (1 - 0.04 * max(0.0, -w)), 1),
        "precip_mm": 0.0,
        "evaporation_mm": None,
        "et_provider_mm": None,
    }


def synth_series(start: date, days: int, location_id: str) -> list[dict]:
    return [{"date": start + timedelta(days=i), **synth_day(start + timedelta(days=i), location_id)} for i in range(days)]
