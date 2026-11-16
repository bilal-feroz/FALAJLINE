"""Reference evapotranspiration (FAO-56 Penman–Monteith, daily) and zone irrigation demand."""
from __future__ import annotations

import math
from datetime import date

import numpy as np

from .params import LPS_TO_M3_DAY, ModelParams


def saturation_vapour_pressure(t_c: float) -> float:
    """kPa (FAO-56 eq. 11)."""
    return 0.6108 * math.exp(17.27 * t_c / (t_c + 237.3))


def extraterrestrial_radiation(lat_deg: float, day: date) -> float:
    """Ra in MJ m-2 day-1 (FAO-56 eq. 21)."""
    j = day.timetuple().tm_yday
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * j / 365)
    delta = 0.409 * math.sin(2 * math.pi * j / 365 - 1.39)
    ws = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta))))
    return 24 * 60 / math.pi * 0.0820 * dr * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))


def et0_fao56(
    *,
    t_max_c: float,
    t_min_c: float,
    rh_mean_pct: float,
    wind_10m_ms: float,
    solar_rad_w_m2: float,
    lat_deg: float,
    elevation_m: float,
    day: date,
    t_mean_c: float | None = None,
    wind_height_m: float = 10.0,
) -> float:
    """Daily grass-reference evapotranspiration in mm/day.

    solar_rad_w_m2 is the 24 h mean global horizontal irradiance. Soil heat flux is neglected (daily step).
    """
    t_mean = (t_max_c + t_min_c) / 2 if t_mean_c is None else t_mean_c
    u2 = wind_10m_ms * 4.87 / math.log(67.8 * wind_height_m - 5.42)
    rs = max(0.0, solar_rad_w_m2) * 0.0864  # MJ m-2 day-1
    pressure = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    gamma = 0.000665 * pressure
    es = (saturation_vapour_pressure(t_max_c) + saturation_vapour_pressure(t_min_c)) / 2
    ea = es * max(0.0, min(100.0, rh_mean_pct)) / 100.0
    slope = 4098 * saturation_vapour_pressure(t_mean) / (t_mean + 237.3) ** 2

    ra = extraterrestrial_radiation(lat_deg, day)
    rso = (0.75 + 2e-5 * elevation_m) * ra
    rns = 0.77 * rs
    sigma = 4.903e-9
    tk4 = ((t_max_c + 273.16) ** 4 + (t_min_c + 273.16) ** 4) / 2
    cloud = 1.35 * min(1.0, rs / rso if rso > 0 else 1.0) - 0.35
    rnl = sigma * tk4 * (0.34 - 0.14 * math.sqrt(max(ea, 0.0))) * max(cloud, 0.05)
    rn = rns - rnl

    num = 0.408 * slope * rn + gamma * 900 / (t_mean + 273) * u2 * (es - ea)
    den = slope + gamma * (1 + 0.34 * u2)
    return max(0.0, num / den)


def zone_demand_lps(et0_mm, precip_mm, params: ModelParams, demand_factor: float = 1.0) -> np.ndarray:
    """Gross irrigation requirement at each zone outlet, L/s. Shape (..., Z).

    ETc = Kc * canopy_cover * ET0, less effective rainfall, divided by application efficiency.
    """
    d = params.demand
    et0 = np.asarray(et0_mm, dtype=float)[..., None]
    rain = np.asarray(precip_mm, dtype=float)[..., None]
    area = np.array([z.area_ha for z in params.zones])
    cover = np.array([z.canopy_cover for z in params.zones])
    etc = d.crop_coefficient * cover * et0
    eff_rain = d.effective_rain_fraction * np.clip(rain - d.effective_rain_threshold_mm, 0.0, None)
    net_mm = np.clip(etc - eff_rain, 0.0, None)
    m3_day = net_mm * area * 10.0 / d.application_efficiency  # 1 mm over 1 ha = 10 m3
    return m3_day * demand_factor / LPS_TO_M3_DAY


def rain_recharge_m3d(precip_mm_series: np.ndarray, params: ModelParams) -> np.ndarray:
    """Recharge reaching the mother-well aquifer on each day from upstream rain, with a lag kernel.

    precip_mm_series: daily upstream rainfall including antecedent days. Returns an array of equal length.
    Rain below the threshold wets the surface and evaporates; it is credited no recharge.
    """
    s = params.source
    rain = np.asarray(precip_mm_series, dtype=float)
    effective = np.clip(np.nan_to_num(rain, nan=0.0) - s.recharge_threshold_mm, 0.0, None)
    volume = effective / 1000.0 * s.recharge_area_km2 * 1e6 * s.recharge_fraction  # m3 per rain day
    kernel = np.asarray(s.recharge_lag_days)
    kernel = kernel / kernel.sum()
    return np.convolve(volume, kernel)[: len(rain)]
