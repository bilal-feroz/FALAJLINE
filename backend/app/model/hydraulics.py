"""Steady-state routing of falaj flow: source -> tunnel -> main channel -> branches -> zone outlets.

A falaj is a gravity system: flow is set by the source, not by demand. Each day the discharge leaving the
mother well is split by the fixed division structure, and every litre is either delivered to a zone outlet,
lost to seepage / leakage, or spilled where a channel is over capacity. `Routing.residual` checks that.

All functions are vectorised: `q_source` may carry any leading dimensions (ensemble members, days).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .params import ModelParams


@dataclass
class Routing:
    q_source: np.ndarray  # (...)
    tunnel_loss: np.ndarray  # (...)
    q_sharia: np.ndarray  # (...)  flow where the falaj surfaces
    main_spill: np.ndarray
    main_loss: np.ndarray
    q_divider: np.ndarray
    branch_in: np.ndarray  # (..., B)
    branch_spill: np.ndarray  # (..., B)
    branch_loss: np.ndarray  # (..., B) seepage plus any excess (leak) loss
    zone_delivered: np.ndarray  # (..., Z)

    @property
    def total_delivered(self) -> np.ndarray:
        return self.zone_delivered.sum(axis=-1)

    @property
    def total_loss(self) -> np.ndarray:
        return self.tunnel_loss + self.main_loss + self.branch_loss.sum(axis=-1)

    @property
    def total_spill(self) -> np.ndarray:
        return self.main_spill + self.branch_spill.sum(axis=-1)

    @property
    def residual(self) -> np.ndarray:
        """Water-balance closure: source - (delivered + losses + spills). Zero within rounding."""
        return self.q_source - (self.total_delivered + self.total_loss + self.total_spill)


def _reach_efficiency(loss_per_km, length_km):
    """Fraction of flow surviving a reach with a constant fractional seepage loss per km."""
    return np.power(np.clip(1.0 - loss_per_km, 0.0, 1.0), length_km)


def source_discharge(head_m, conductance_lps_per_m):
    """Linear-reservoir falaj discharge: proportional to water-table head above the tunnel invert."""
    return np.asarray(conductance_lps_per_m) * np.clip(head_m, 0.0, None)


def route(
    q_source,
    params: ModelParams,
    *,
    loss_scale=1.0,
    surface_loss_factor: float = 1.0,
    branch_excess_loss=None,
    main_bias=1.0,
) -> Routing:
    """Route source discharge (L/s) through the network.

    loss_scale           multiplies every seepage rate (ensemble uncertainty); broadcastable to q_source.
    surface_loss_factor  multiplies surface-channel seepage rates only (efficiency scenario).
    branch_excess_loss   (B,) extra fractional loss per branch on top of design seepage (detected leakage).
    main_bias            correction to tunnel efficiency inferred from the main flow gauge.
    """
    ch = params.channels
    q_source = np.asarray(q_source, dtype=float)
    loss_scale = np.asarray(loss_scale, dtype=float)
    n_b = len(params.branches)
    excess = np.zeros(n_b) if branch_excess_loss is None else np.asarray(branch_excess_loss, dtype=float)

    tunnel_eff = np.clip(_reach_efficiency(ch.tunnel_loss_per_km * loss_scale, ch.tunnel_length_km) * main_bias, 0.0, 1.0)
    q_sharia = q_source * tunnel_eff
    tunnel_loss = q_source - q_sharia

    main_in = np.minimum(q_sharia, ch.main_capacity_lps)
    main_spill = q_sharia - main_in
    main_eff = _reach_efficiency(ch.main_loss_per_km * loss_scale * surface_loss_factor, ch.main_length_km)
    q_divider = main_in * main_eff
    main_loss = main_in - q_divider

    shares = np.array([b.share for b in params.branches])
    shares = shares / shares.sum()
    offered = q_divider[..., None] * shares
    branch_in = np.minimum(offered, ch.branch_capacity_lps)
    branch_spill = offered - branch_in

    zone_branch = np.array([params.branch_index(z.branch) for z in params.zones])
    zone_share = np.array([z.share for z in params.zones])
    for b in range(n_b):  # normalise water rights within each branch
        mask = zone_branch == b
        zone_share[mask] = zone_share[mask] / zone_share[mask].sum()
    zone_km = np.array([z.channel_km for z in params.zones])

    rate = ch.branch_loss_per_km * loss_scale[..., None] * surface_loss_factor
    zone_eff = _reach_efficiency(rate, zone_km) * (1.0 - excess[zone_branch])
    zone_gross = branch_in[..., zone_branch] * zone_share
    zone_delivered = zone_gross * zone_eff

    branch_loss = np.zeros_like(branch_in)
    for b in range(n_b):
        mask = zone_branch == b
        branch_loss[..., b] = (zone_gross[..., mask] - zone_delivered[..., mask]).sum(axis=-1)

    return Routing(
        q_source=q_source,
        tunnel_loss=tunnel_loss,
        q_sharia=q_sharia,
        main_spill=main_spill,
        main_loss=main_loss,
        q_divider=q_divider,
        branch_in=branch_in,
        branch_spill=branch_spill,
        branch_loss=branch_loss,
        zone_delivered=zone_delivered,
    )


def recession_step(head, net_inflow_m3d, conductance_m3d_per_m, storage_m2, dt_days: float = 1.0):
    """Advance the linear reservoir one step using its exact solution.

    storage * dh/dt = net_inflow - conductance * h   for h > 0
    When the water table is at or below the tunnel invert the falaj stops draining it and the head just
    follows net inflow.
    """
    head = np.asarray(head, dtype=float)
    h_eq = net_inflow_m3d / conductance_m3d_per_m
    k = conductance_m3d_per_m / storage_m2
    drained = h_eq + (head - h_eq) * np.exp(-k * dt_days)
    undrained = head + net_inflow_m3d / storage_m2 * dt_days
    return np.where(head > 0.0, np.maximum(drained, np.minimum(h_eq, 0.0)), undrained)
