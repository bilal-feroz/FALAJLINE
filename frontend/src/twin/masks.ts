import * as THREE from "three";
import type { XZ } from "./geo";
import type { Net } from "./net";

/**
 * Raster masks the terrain shader reads:
 *   zone ids     which farm zone a point is in (nearest sampling)
 *   zone border  distance to the nearest zone border, in metres (smooth sampling), for the risk glow
 *   focus        where the water arrives (the oasis); the rest of the map is toned down
 */

export const ZONE_RECT = { x0: -1000, z0: -900, x1: 1300, z1: 950 };
export const FOCUS_RECT = { x0: -3600, z0: -4600, x1: 10800, z1: 5200 };
export const ZONE_DIST_MAX = 90; // metres encoded in the border-distance texture

/** 1D squared Euclidean distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** In-place 2D squared distance transform: 0 at the sources, a large value elsewhere. */
function edt(grid: Float64Array, W: number, H: number) {
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
}

function polyPath(ctx: CanvasRenderingContext2D, poly: XZ[], P: (x: number, z: number) => [number, number]) {
  ctx.beginPath();
  poly.forEach(([x, z], k) => {
    const [px, pz] = P(x, z);
    if (k) ctx.lineTo(px, pz);
    else ctx.moveTo(px, pz);
  });
  ctx.closePath();
}

export function zoneTextures(polys: XZ[][]) {
  const R = ZONE_RECT;
  const W = 1024;
  const H = Math.round((W * (R.z1 - R.z0)) / (R.x1 - R.x0));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const sx = W / (R.x1 - R.x0);
  const sz = H / (R.z1 - R.z0);
  const P = (x: number, z: number): [number, number] => [(x - R.x0) * sx, (z - R.z0) * sz];
  polys.forEach((poly, i) => {
    ctx.fillStyle = `rgb(${(i + 1) * 32},0,0)`;
    polyPath(ctx, poly, P);
    ctx.fill();
  });
  const px = ctx.getImageData(0, 0, W, H).data;
  const ids = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) ids[i] = Math.floor(px[i * 4] / 32 + 0.5);

  // border pixels: any 4-neighbour belongs to another zone (or to no zone)
  const BIG = 1e12;
  const grid = new Float64Array(W * H).fill(BIG);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const id = ids[i];
      if (!id) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || ids[i - 1] !== id || ids[i + 1] !== id || ids[i - W] !== id || ids[i + W] !== id) grid[i] = 0;
    }
  edt(grid, W, H);
  const metresPerPx = (R.x1 - R.x0) / W;
  // rows are written bottom-up so the shader samples both textures with the same coordinates as a canvas texture
  const dist = new Uint8Array(W * H);
  const idData = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const src = y * W + x;
      const dst = (H - 1 - y) * W + x;
      dist[dst] = Math.min(255, Math.round((Math.sqrt(grid[src]) * metresPerPx * 255) / ZONE_DIST_MAX));
      idData[dst] = ids[src] * 32;
    }

  const idTex = new THREE.DataTexture(idData, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  idTex.minFilter = idTex.magFilter = THREE.NearestFilter;
  idTex.generateMipmaps = false;
  idTex.unpackAlignment = 1;
  idTex.needsUpdate = true;

  const distTex = new THREE.DataTexture(dist, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  distTex.minFilter = THREE.LinearMipmapLinearFilter;
  distTex.magFilter = THREE.LinearFilter;
  distTex.generateMipmaps = true;
  distTex.unpackAlignment = 1;
  distTex.needsUpdate = true;
  return { idTex, distTex };
}

export function focusTexture(net: Net) {
  const R = FOCUS_RECT;
  const W = 1024;
  const H = Math.round((W * (R.z1 - R.z0)) / (R.x1 - R.x0));
  const sx = W / (R.x1 - R.x0);
  const P = (x: number, z: number): [number, number] => [(x - R.x0) * sx, (z - R.z0) * sx];
  const a = document.createElement("canvas");
  a.width = W;
  a.height = H;
  const g = a.getContext("2d")!;
  g.fillStyle = g.strokeStyle = "#fff";
  g.lineJoin = g.lineCap = "round";
  polyPath(g, net.outline, P);
  g.fill();
  g.lineWidth = 40 * sx;
  g.stroke();

  const b = document.createElement("canvas");
  b.width = W;
  b.height = H;
  const gb = b.getContext("2d")!;
  gb.filter = "blur(4px)"; // ignored where unsupported: the edge is then simply sharp
  gb.drawImage(a, 0, 0);
  const tex = new THREE.CanvasTexture(b);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
