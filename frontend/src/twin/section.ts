import type { Dem } from "./dem";
import { ELEV0 } from "./geo";
import type { Net } from "./net";

/**
 * Long profile of the falaj from the shari'a (s = 0) to the mother well (s = L): ground from the elevation
 * model, the tunnel invert (conceptual: it daylights at the shari'a and lies 20 m deep at the well) and the
 * water table, which stands `head` metres above the invert at the well and falls towards the oasis.
 */
export const PROFILE = { N: 160, DEPTH: 20, K_WET: 1500 };

export interface Profile {
  L: number;
  s: number[];
  ground: number[]; // m a.s.l.
  invert: number[]; // m a.s.l.
}

export function buildProfile(net: Net, dem: Dem): Profile {
  const { N, DEPTH } = PROFILE;
  const [sx, sz] = net.sharia;
  const [wx, wz] = net.well;
  const L = Math.hypot(wx - sx, wz - sz);
  const s: number[] = [];
  const ground: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    s.push(L * t);
    ground.push(dem.heightAt(sx + (wx - sx) * t, sz + (wz - sz) * t) + ELEV0);
  }
  // the elevation model carries buildings and noise of a few metres: smooth it to the shape of the land
  const raw = ground.slice();
  for (let i = 0; i < N; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 5); k <= Math.min(N - 1, i + 5); k++) {
      sum += raw[k];
      n++;
    }
    ground[i] = sum / n;
  }
  const g0 = ground[0];
  const gL = ground[N - 1];
  const invert = ground.map((g, i) => Math.min(g0 + (gL - DEPTH - g0) * (i / (N - 1)), g - 1.5 * Math.min(1, (s[i] / 300) ** 2)));
  return { L, s, ground, invert };
}

/** Water above the tunnel invert (m) at distance s, for a given head at the well. Negative = dry tunnel. */
export function waterAboveInvert(p: Profile, s: number, head: number) {
  return head - (p.L - s) / PROFILE.K_WET;
}

/** Where the tunnel starts collecting water (distance from the shari'a). */
export function wetStart(p: Profile, head: number) {
  return Math.max(0, p.L - head * PROFILE.K_WET);
}
