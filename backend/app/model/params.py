"""Configurable parameters of the FALAJLINE water-system model.

Every number here is a documented ASSUMPTION for a representative Al Ain falaj. None of it is calibrated
against measured falaj discharge; the confidence logic caps what the system is allowed to claim because of that.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace

from ..geo import TUNNEL_LENGTH_KM, build_geography

LPS_TO_M3_DAY = 86.4  # 1 L/s sustained for a day = 86.4 m3


@dataclass(frozen=True)
class SourceParams:
    """Lumped linear-reservoir description of the aquifer around the mother well.

    storage * dh/dt = net_inflow - conductance * h     (h = water-table head above the tunnel invert)
    """

    conductance_lps_per_m: float = 62.0  # falaj discharge gained per metre of head above the tunnel invert
    specific_yield: float = 0.08  # drainable porosity of the alluvial gravels
    capture_area_m2: float = 2.7e6  # effective area drained by the mother well and infiltration gallery
    # Rain-fed recharge from the upstream piedmont (only storms above the threshold produce recharge).
    recharge_area_km2: float = 30.0
    recharge_fraction: float = 0.08
    recharge_threshold_mm: float = 5.0
    recharge_lag_days: tuple[float, ...] = (0.0, 0.02, 0.06, 0.11, 0.15, 0.16, 0.14, 0.11, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01, 0.01)

    @property
    def storage_m2(self) -> float:
        return self.specific_yield * self.capture_area_m2

    @property
    def conductance_m3d_per_m(self) -> float:
        return self.conductance_lps_per_m * LPS_TO_M3_DAY


@dataclass(frozen=True)
class ChannelParams:
    tunnel_length_km: float = TUNNEL_LENGTH_KM
    tunnel_loss_per_km: float = 0.008  # seepage along the unlined conveyance section
    main_length_km: float = 0.36
    main_loss_per_km: float = 0.030
    main_capacity_lps: float = 120.0
    branch_loss_per_km: float = 0.060  # masonry / earthen distributaries
    branch_capacity_lps: float = 48.0


@dataclass(frozen=True)
class BranchParams:
    id: str
    name: str
    share: float  # fraction of the flow arriving at the divider


@dataclass(frozen=True)
class ZoneParams:
    id: str
    name: str
    branch: str
    area_ha: float  # from the zone polygon
    canopy_cover: float  # fraction of the zone under irrigated canopy
    share: float  # fraction of the branch flow this zone holds as its water right
    channel_km: float  # channel distance from the divider to the zone outlet
    position: str  # "head" or "tail"


@dataclass(frozen=True)
class DemandParams:
    crop_coefficient: float = 0.95  # FAO-56 Kc for date palm
    application_efficiency: float = 0.60  # basin / flood irrigation
    effective_rain_fraction: float = 0.75
    effective_rain_threshold_mm: float = 2.0
    # Water is delivered in timed turns over a rotation, and the root zone stores water between turns, so the
    # requirement is judged on mean ET0 over one rotation rather than on a single hot or cool day.
    rotation_days: int = 7


@dataclass(frozen=True)
class RiskParams:
    required_supply_ratio: float = 1.0  # supply / demand below this counts as a shortfall
    horizon_days: int = 21
    act_window_days: int = 7
    act_probability: float = 0.60
    prepare_window_days: int = 14
    prepare_probability: float = 0.40
    watch_probability: float = 0.20
    watch_margin: float = 0.12  # supply margin below which a declining trend is worth watching
    persistence_evaluations: int = 2  # consecutive daily evaluations needed before escalating


@dataclass(frozen=True)
class UncertaintyParams:
    """Assumed spreads used for the scenario ensemble. They express how unsure the assumptions are;
    they are not error statistics measured against observations."""

    members: int = 240
    seed: int = 20261116
    storage_log_sd: float = 0.22
    conductance_rel_sd: float = 0.06
    loss_log_sd: float = 0.20
    demand_rel_sd: float = 0.05
    weather_rel_sd_day0: float = 0.02
    weather_rel_sd_per_day: float = 0.005
    weather_extended_extra_sd: float = 0.05


@dataclass(frozen=True)
class ModelParams:
    source: SourceParams = field(default_factory=SourceParams)
    channels: ChannelParams = field(default_factory=ChannelParams)
    branches: tuple[BranchParams, ...] = ()
    zones: tuple[ZoneParams, ...] = ()
    demand: DemandParams = field(default_factory=DemandParams)
    risk: RiskParams = field(default_factory=RiskParams)
    uncertainty: UncertaintyParams = field(default_factory=UncertaintyParams)

    def branch_index(self, branch_id: str) -> int:
        return [b.id for b in self.branches].index(branch_id)

    def zone_index(self, zone_id: str) -> int:
        return [z.id for z in self.zones].index(zone_id)

    def to_public(self) -> dict:
        d = asdict(self)
        d["source"]["storage_m2"] = self.source.storage_m2
        return d


# Traditional falaj water rights are time shares of the whole flow, fixed long ago and not proportional to
# today's crop demand. The shares below are a representative allocation with that kind of imbalance.
_BRANCH_SHARES = {"A": 0.363, "B": 0.332, "C": 0.305}
_ZONE_SHARES = {"Z1": 0.517, "Z2": 0.483, "Z3": 0.492, "Z4": 0.508, "Z5": 0.559, "Z6": 0.441}
_ZONE_COVER = {"Z1": 0.60, "Z2": 0.62, "Z3": 0.64, "Z4": 0.62, "Z5": 0.60, "Z6": 0.63}
_BRANCH_NAMES = {"A": "North branch", "B": "West branch", "C": "South branch"}
_SINUOSITY = 1.3


def _haversine_km(a: list[float], b: list[float]) -> float:
    import math

    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def default_params() -> ModelParams:
    geo = build_geography()
    lines = geo["network"]["branches"]
    zones = []
    for z in geo["zones"]:
        line = lines[z["branch"]]
        idx = next(i for i, p in enumerate(line) if abs(p[0] - z["centroid"]["lon"]) < 1e-5 and abs(p[1] - z["centroid"]["lat"]) < 1e-5)
        km = sum(_haversine_km(line[i], line[i + 1]) for i in range(idx)) * _SINUOSITY
        zones.append(
            ZoneParams(
                id=z["id"],
                name=z["name"],
                branch=z["branch"],
                area_ha=z["area_ha"],
                canopy_cover=_ZONE_COVER[z["id"]],
                share=_ZONE_SHARES[z["id"]],
                channel_km=round(km, 3),
                position="head" if idx == 1 else "tail",
            )
        )
    branches = tuple(BranchParams(id=b, name=_BRANCH_NAMES[b], share=s) for b, s in _BRANCH_SHARES.items())
    return ModelParams(branches=branches, zones=tuple(zones))


@dataclass(frozen=True)
class Scenario:
    """A what-if run. Every scenario goes through the same model; only these inputs differ."""

    id: str = "baseline"
    label: str = "Current operating conditions"
    description: str = "Existing allocation, existing channel condition, demand driven by forecast weather."
    demand_reduction: float = 0.0  # fraction of irrigation demand removed (rotation tightening, deficit irrigation)
    loss_reduction: float = 0.0  # fraction by which surface-channel seepage rates are cut (repairs, lining)
    repair_anomalies: bool = False  # remove excess losses detected on branches
    rebalance: bool = False  # reallocate shares in proportion to demand


def preset_scenarios(demand_reduction: float = 0.15, loss_reduction: float = 0.45) -> list[Scenario]:
    return [
        Scenario(),
        Scenario(
            id="reduced_demand",
            label="Reduced water demand",
            description=f"Irrigation demand cut by {demand_reduction:.0%} through tighter rotation and deficit irrigation of understorey crops.",
            demand_reduction=demand_reduction,
        ),
        Scenario(
            id="improved_efficiency",
            label="Improved channel efficiency",
            description=f"Surface-channel seepage cut by {loss_reduction:.0%} and detected branch leakage repaired.",
            loss_reduction=loss_reduction,
            repair_anomalies=True,
        ),
    ]


def with_zone_shares(params: ModelParams, branch_shares: dict[str, float], zone_shares: dict[str, float]) -> ModelParams:
    branches = tuple(replace(b, share=branch_shares[b.id]) for b in params.branches)
    zones = tuple(replace(z, share=zone_shares[z.id]) for z in params.zones)
    return replace(params, branches=branches, zones=zones)
