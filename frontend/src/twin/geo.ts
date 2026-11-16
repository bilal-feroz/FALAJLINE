/**
 * Local frame of the digital twin, in metres.
 *   x: east of the oasis centroid      z: SOUTH of the oasis centroid      y: up, relative to the oasis floor
 * Looking from +z towards -z puts north at the top of the screen and east on the right, as on a map.
 * Same constants as the backend (geo.OASIS_CENTER) and the baked elevation grid (public/twin/dem.json).
 */
export const LON0 = 55.7679;
export const LAT0 = 24.2148;
export const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
export const MY = 110574;
export const ELEV0 = 289; // elevation of the oasis floor (m a.s.l.)
export const HALF = 22000; // the terrain covers a 44 km square

export type XZ = [number, number];

export function toXZ(lon: number, lat: number): XZ {
  return [(lon - LON0) * MX, (LAT0 - lat) * MY];
}

export function toLonLat(x: number, z: number): [number, number] {
  return [LON0 + x / MX, LAT0 - z / MY];
}

export function lon2tx(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

export function lat2ty(lat: number, zoom: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** zoom;
}

export function pointInPolygon(x: number, z: number, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polylineLength(pts: XZ[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Resample a polyline at a fixed spacing, keeping both ends. */
export function densify(pts: XZ[], step: number): XZ[] {
  const out: XZ[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Smooth a polyline with Chaikin corner cutting (channels look dug, not drafted). */
export function chaikin(pts: XZ[], iterations = 2): XZ[] {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const out: XZ[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export function distanceToPolyline(x: number, z: number, pts: XZ[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Landmarks used by the opening sequence (real coordinates). */
export const CITIES = [
  { name: "Abu Dhabi", lon: 54.3773, lat: 24.4539 },
  { name: "Dubai", lon: 55.2708, lat: 25.2048 },
  { name: "Al Ain", lon: 55.7447, lat: 24.2075 },
];
