import * as THREE from "three";
import { HALF, lat2ty, lon2tx, MX, MY, LAT0, LON0, toLonLat } from "./geo";

/**
 * Satellite imagery for the twin, fetched by the browser and stitched into three mosaics:
 *   far  - Sentinel-2 cloudless 2023 by EOX (contains modified Copernicus Sentinel data), uniform and cloud-free
 *   near, core - Esri World Imagery (Maxar, Earthstar Geographics) for sub-metre detail around the falaj
 * Attribution is shown in the interface.
 */
const ESRI = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const EOX = (z: number, x: number, y: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`;
const URL = (name: MosaicLayout["name"], z: number, x: number, y: number) => (name === "far" ? EOX(z, x, y) : ESRI(z, x, y));

export interface MosaicLayout {
  name: "far" | "near" | "core";
  z: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
}

function layout(name: MosaicLayout["name"], z: number, x0m: number, z0m: number, x1m: number, z1m: number): MosaicLayout {
  const [lonMin, latMax] = toLonLat(x0m, z0m);
  const [lonMax, latMin] = toLonLat(x1m, z1m);
  const tx0 = Math.floor(lon2tx(lonMin, z));
  const tx1 = Math.floor(lon2tx(lonMax, z));
  const ty0 = Math.floor(lat2ty(latMax, z));
  const ty1 = Math.floor(lat2ty(latMin, z));
  return { name, z, x0: tx0, y0: ty0, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1 };
}

// far: the whole 44 km terrain; near: the falaj corridor from the oasis to the mother well; core: the oasis.
export const FAR = layout("far", 12, -HALF - 600, -HALF - 600, HALF + 600, HALF + 600);
export const NEAR = layout("near", 14, -3200, -4200, 10400, 4800);
export const CORE = layout("core", 17, -930, -870, 1260, 880);

/** Texture coordinate of a point (in the twin frame) inside a mosaic. */
export function uvOf(m: MosaicLayout, x: number, z: number): [number, number] {
  const lon = LON0 + x / MX;
  const lat = LAT0 - z / MY;
  const u = (lon2tx(lon, m.z) - m.x0) / m.nx;
  const v = 1 - (lat2ty(lat, m.z) - m.y0) / m.ny;
  return [u, v];
}

export interface Mosaic {
  layout: MosaicLayout;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

async function pool<T>(items: T[], limit: number, work: (t: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await work(items[i++]);
  });
  await Promise.all(runners);
}

export async function loadMosaic(m: MosaicLayout, onTile?: (done: number, total: number) => void): Promise<Mosaic> {
  const canvas = document.createElement("canvas");
  canvas.width = m.nx * 256;
  canvas.height = m.ny * 256;
  const ctx = canvas.getContext("2d", { willReadFrequently: m.name === "core" })!;
  ctx.fillStyle = "#b8a27f"; // neutral desert where a tile is missing, never black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tiles: [number, number][] = [];
  for (let ty = 0; ty < m.ny; ty++) for (let tx = 0; tx < m.nx; tx++) tiles.push([tx, ty]);
  // load from the centre outwards so the most important tiles arrive first
  tiles.sort((a, b) => Math.hypot(a[0] - m.nx / 2, a[1] - m.ny / 2) - Math.hypot(b[0] - m.nx / 2, b[1] - m.ny / 2));
  let done = 0;
  await pool(tiles, 12, async ([tx, ty]) => {
    try {
      const res = await fetch(URL(m.name, m.z, m.x0 + tx, m.y0 + ty), { mode: "cors" });
      if (res.ok) {
        const bmp = await createImageBitmap(await res.blob());
        ctx.drawImage(bmp, tx * 256, ty * 256);
        bmp.close();
      }
    } catch {
      /* a missing tile stays neutral */
    }
    onTile?.(++done, tiles.length);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { layout: m, canvas, texture };
}

/**
 * Where is the canopy? Excess-green index over the core mosaic, sampled on a jittered grid. Returns the
 * points (twin frame) that look like palm crowns, with a 0..1 confidence used to vary density.
 */
export function canopyPoints(core: Mosaic, inside: (x: number, z: number) => boolean, spacing: number, rand: () => number): { x: number; z: number; s: number }[] {
  const { canvas, layout: m } = core;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const W = canvas.width;
  const H = canvas.height;
  const out: { x: number; z: number; s: number }[] = [];
  for (let z = -900; z <= 880; z += spacing) {
    for (let x = -930; x <= 1260; x += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.9;
      const pz = z + (rand() - 0.5) * spacing * 0.9;
      if (!inside(px, pz)) continue;
      const [u, v] = uvOf(m, px, pz);
      const cx = Math.round(u * W);
      const cy = Math.round((1 - v) * H);
      if (cx < 2 || cy < 2 || cx >= W - 2 || cy >= H - 2) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((cy + dy) * W + (cx + dx)) * 4;
          r += img[i];
          g += img[i + 1];
          b += img[i + 2];
        }
      r /= 9;
      g /= 9;
      b /= 9;
      const exg = 2 * g - r - b;
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      // canopy: greener than its surroundings and not bright sand or concrete
      const score = Math.min(1, Math.max(0, (exg - 4) / 26)) * Math.min(1, Math.max(0, (175 - lum) / 70));
      if (score > 0.08 && rand() < 0.35 + score) out.push({ x: px, z: pz, s: score });
    }
  }
  return out;
}
