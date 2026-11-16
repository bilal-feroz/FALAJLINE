import type { Geo } from "@/lib/types";
import type { Dem } from "./dem";
import { chaikin, densify, polylineLength, toXZ, type XZ } from "./geo";

/** The conceptual falaj network in the twin frame, draped on the terrain. Built once from the API geometry. */
export interface Net {
  well: XZ;
  sharia: XZ;
  divider: XZ;
  tunnel: XZ[]; // well -> shari'a
  main: XZ[]; // shari'a -> divider
  branches: Record<string, XZ[]>; // divider -> head zone -> tail zone
  shafts: XZ[];
  zones: { id: string; name: string; branch: string; centroid: XZ; poly: XZ[] }[];
  outline: XZ[];
  lengths: { tunnel: number; main: number; branches: Record<string, number> };
}

export function buildNet(geo: Geo): Net {
  const n = geo.network;
  const well = toXZ(...n.mother_well);
  const sharia = toXZ(...n.sharia);
  const divider = toXZ(...n.divider);
  const tunnel = densify([well, sharia], 20);
  const main = densify([sharia, divider], 10);
  const branches: Record<string, XZ[]> = {};
  for (const [id, line] of Object.entries(n.branches)) {
    const pts = line.map(([lon, lat]) => toXZ(lon, lat));
    branches[id] = densify(chaikin(pts, 3), 10);
  }
  const L = polylineLength([well, sharia]);
  const shafts: XZ[] = [];
  for (let d = 40; d < L - 90; d += 58) {
    const t = d / L;
    shafts.push([well[0] + (sharia[0] - well[0]) * t, well[1] + (sharia[1] - well[1]) * t]);
  }
  return {
    well,
    sharia,
    divider,
    tunnel,
    main,
    branches,
    shafts,
    zones: geo.zones.map((z) => ({ id: z.id, name: z.name, branch: z.branch, centroid: toXZ(z.centroid.lon, z.centroid.lat), poly: z.polygon.map(([lon, lat]) => toXZ(lon, lat)) })),
    outline: geo.oasis.outline.map(([lon, lat]) => toXZ(lon, lat)),
    lengths: {
      tunnel: L,
      main: polylineLength(main),
      branches: Object.fromEntries(Object.entries(branches).map(([k, v]) => [k, polylineLength(v)])),
    },
  };
}

export function drape(pts: XZ[], dem: Dem, lift: number): [number, number, number][] {
  return pts.map(([x, z]) => [x, dem.heightAt(x, z) + lift, z]);
}
