import { ELEV0, HALF } from "./geo";

/**
 * Elevation around Al Ain: AWS Open Data terrain tiles (SRTM-derived), baked onto the twin's grid.
 * public/twin/dem.u16.gz holds 768 x 768 uint16 values, rows north to south, elevation = v / 10 - 100.
 */
export interface Dem {
  size: number;
  data: Float32Array; // metres relative to the oasis floor (ELEV0)
  heightAt: (x: number, z: number) => number;
}

let pending: Promise<Dem> | null = null;

async function read(): Promise<Dem> {
  const res = await fetch("/twin/dem.u16.gz");
  if (!res.ok) throw new Error(`Elevation grid HTTP ${res.status}`);
  let buf = new Uint8Array(await res.arrayBuffer());
  // Some hosts decompress .gz transparently; only inflate when the gzip magic number is present.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const size = Math.round(Math.sqrt(u16.length));
  const data = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) data[i] = u16[i] / 10 - 100 - ELEV0;
  const cell = (2 * HALF) / (size - 1);
  const heightAt = (x: number, z: number) => {
    const fx = Math.min(size - 1.001, Math.max(0, (x + HALF) / cell));
    const fz = Math.min(size - 1.001, Math.max(0, (z + HALF) / cell));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * size + ix;
    return (data[i] * (1 - tx) + data[i + 1] * tx) * (1 - tz) + (data[i + size] * (1 - tx) + data[i + size + 1] * tx) * tz;
  };
  return { size, data, heightAt };
}

export function loadDem(): Promise<Dem> {
  if (!pending) pending = read().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}
