import * as THREE from "three";

/**
 * Geometry of the conceptual digital twin.
 *
 * The block is a cutaway diorama, not a survey: the tunnel section is compressed horizontally, the vertical
 * scale is exaggerated, and the change in water-table level is exaggerated further so that a few decimetres
 * of real decline are visible. The interface says so wherever the model is shown.
 */

// Block extents (scene units). x runs from the mother well (left) to the far side of the oasis (right).
export const X0 = -72;
export const X1 = 70;
export const Z0 = -38;
export const Z1 = 38;
export const CUT_X = -6; // the quadrant x < CUT_X, z > 0 is cut away to expose the section
export const BEDROCK_TOP = -19;
export const FLOOR = -25;

export const WELL_X = -58;
export const SHARIA_X = -2;
export const INV_WELL = 0.9; // tunnel invert at the mother well
export const INV_SHARIA = -0.15;
export const HEAD_SCALE = 4.2; // scene units of water-table rise per metre of head (exaggerated)
export const WT_GRADIENT = 0.17; // water table falls away from the mother well toward the oasis

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const zf = smooth(z - zi);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

export function fbm(x: number, z: number): number {
  return valueNoise(x, z) * 0.55 + valueNoise(x * 2.1 + 9.2, z * 2.1 + 3.7) * 0.3 + valueNoise(x * 4.3 + 1.7, z * 4.3 + 8.1) * 0.15;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Ground elevation. A piedmont slope rising toward the mother well, dunes, foothills at the back, a flat oasis. */
export function ground(x: number, z: number): number {
  const slope = Math.max(0, CUT_X + 4 - x) * 0.168;
  const awayFromSection = smoothstep(1.5, 12, Math.abs(z));
  const dunes = (fbm(x * 0.07, z * 0.07) - 0.5) * 2.4 * awayFromSection * smoothstep(CUT_X + 4, CUT_X - 12, x);
  const hills = smoothstep(-44, -72, x) * smoothstep(-8, -38, z) * (5 + 9 * fbm(x * 0.05 + 4, z * 0.05 + 2));
  const plain = (fbm(x * 0.15, z * 0.15) - 0.5) * 0.16;
  return slope + dunes + hills + plain;
}

export function tunnelInvert(x: number): number {
  return INV_WELL + ((x - WELL_X) / (SHARIA_X - WELL_X)) * (INV_SHARIA - INV_WELL);
}

/** Water-table elevation at x for a given head (metres above the tunnel invert at the mother well). */
export function waterTable(x: number, headM: number): number {
  return INV_WELL + headM * HEAD_SCALE - WT_GRADIENT * (x - WELL_X);
}

/** x where the water table drops below the tunnel: upstream of it the tunnel gains water. */
export function wetSectionEnd(headM: number): number {
  const tunnelSlope = (INV_SHARIA - INV_WELL) / (SHARIA_X - WELL_X);
  return WELL_X + (headM * HEAD_SCALE) / (WT_GRADIENT + tunnelSlope);
}

export const SHAFT_XS = [-51.5, -45, -38.5, -32, -25.5, -19, -12.5];
export const DIVIDER = new THREE.Vector3(9, 0.12, 0);

const v = (x: number, z: number, y = 0.12) => new THREE.Vector3(x, y, z);

export interface ZoneLayout {
  id: string;
  branch: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  outlet: THREE.Vector3;
}

export const ZONES: ZoneLayout[] = [
  { id: "Z1", branch: "A", cx: 25, cz: -20, w: 20, d: 17, outlet: v(22, -15.5) },
  { id: "Z2", branch: "A", cx: 50, cz: -22, w: 22, d: 17, outlet: v(45, -20) },
  { id: "Z3", branch: "B", cx: 29, cz: 0, w: 16, d: 12.5, outlet: v(26, 0.4) },
  { id: "Z4", branch: "B", cx: 52, cz: 1.5, w: 22, d: 14.5, outlet: v(48, 1.6) },
  { id: "Z5", branch: "C", cx: 20, cz: 19, w: 18, d: 15, outlet: v(18, 15.5) },
  { id: "Z6", branch: "C", cx: 43, cz: 25, w: 19, d: 13.5, outlet: v(39, 23.5) },
];

const curve = (pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.35);

export interface PathDef {
  id: string;
  component: { type: "tunnel" | "main" | "branch"; id: string };
  curve: THREE.CatmullRomCurve3;
  particles: number;
  flowKey: string; // which simulated flow drives this path
}

const tunnelCurve = new THREE.LineCurve3(new THREE.Vector3(WELL_X, INV_WELL + 0.25, 0), new THREE.Vector3(SHARIA_X, INV_SHARIA + 0.25, 0));

export const TUNNEL_CURVE = tunnelCurve;

export const PATHS: PathDef[] = [
  { id: "main", component: { type: "main", id: "main" }, curve: curve([v(SHARIA_X, 0), v(3, 0.2), DIVIDER.clone()]), particles: 12, flowKey: "main" },
  { id: "A-head", component: { type: "branch", id: "A" }, curve: curve([DIVIDER.clone(), v(13, -7), v(17.5, -12.5), ZONES[0].outlet]), particles: 14, flowKey: "branch:A" },
  { id: "A-tail", component: { type: "branch", id: "A" }, curve: curve([ZONES[0].outlet, v(30, -18.5), v(38, -19), ZONES[1].outlet]), particles: 14, flowKey: "zone:Z2" },
  { id: "B-head", component: { type: "branch", id: "B" }, curve: curve([DIVIDER.clone(), v(15, 0.6), v(21, 0.1), ZONES[2].outlet]), particles: 13, flowKey: "branch:B" },
  { id: "B-tail", component: { type: "branch", id: "B" }, curve: curve([ZONES[2].outlet, v(33, 1.2), v(41, 0.8), ZONES[3].outlet]), particles: 14, flowKey: "zone:Z4" },
  { id: "C-head", component: { type: "branch", id: "C" }, curve: curve([DIVIDER.clone(), v(11.5, 6), v(14, 11.5), ZONES[4].outlet]), particles: 13, flowKey: "branch:C" },
  { id: "C-tail", component: { type: "branch", id: "C" }, curve: curve([ZONES[4].outlet, v(25, 19.5), v(32, 22), ZONES[5].outlet]), particles: 14, flowKey: "zone:Z6" },
];

/** Outline of a farm zone: a rounded rectangle with slightly irregular corners. */
export function zoneOutline(z: ZoneLayout): THREE.Vector2[] {
  const r = 1.6;
  const hw = z.w / 2;
  const hd = z.d / 2;
  const j = (k: number) => (hash(z.cx + k * 3.1, z.cz - k * 1.7) - 0.5) * 1.4;
  const corners = [
    [-hw + j(1), -hd + j(2)],
    [hw + j(3), -hd + j(4)],
    [hw + j(5), hd + j(6)],
    [-hw + j(7), hd + j(8)],
  ];
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 4; i++) {
    const [px, pz] = corners[i];
    const [ax, az] = corners[(i + 3) % 4];
    const [bx, bz] = corners[(i + 1) % 4];
    const da = Math.hypot(ax - px, az - pz);
    const db = Math.hypot(bx - px, bz - pz);
    const p0 = new THREE.Vector2(px + ((ax - px) / da) * r, pz + ((az - pz) / da) * r);
    const p1 = new THREE.Vector2(px + ((bx - px) / db) * r, pz + ((bz - pz) / db) * r);
    for (let s = 0; s <= 5; s++) {
      const t = s / 5;
      const q = new THREE.Vector2(
        (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * px + t * t * p1.x,
        (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * pz + t * t * p1.y,
      );
      pts.push(new THREE.Vector2(q.x + z.cx, q.y + z.cz));
    }
  }
  return pts;
}

function inside(poly: THREE.Vector2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export interface Palm {
  x: number;
  z: number;
  s: number; // scale
  r: number; // rotation
  zone: number; // index into ZONES
}

/** Date palms on a jittered grid inside each zone, kept clear of the channels. */
export function palmField(): Palm[] {
  const channelPts = PATHS.flatMap((p) => p.curve.getSpacedPoints(40));
  const palms: Palm[] = [];
  ZONES.forEach((zone, zi) => {
    const poly = zoneOutline(zone);
    const step = 2.05;
    for (let x = zone.cx - zone.w / 2; x <= zone.cx + zone.w / 2; x += step) {
      for (let z = zone.cz - zone.d / 2; z <= zone.cz + zone.d / 2; z += step) {
        const px = x + (hash(x * 1.3, z * 2.1) - 0.5) * 1.1;
        const pz = z + (hash(x * 2.7, z * 0.9) - 0.5) * 1.1;
        if (!inside(poly, px, pz)) continue;
        if (hash(px * 5.1, pz * 3.3) < 0.1) continue; // a few gaps
        if (channelPts.some((c) => (c.x - px) ** 2 + (c.z - pz) ** 2 < 1.5)) continue;
        palms.push({ x: px, z: pz, s: 0.8 + hash(px, pz) * 0.5, r: hash(pz, px) * Math.PI * 2, zone: zi });
      }
    }
  });
  return palms;
}
