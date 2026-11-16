"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2, LineMaterial } from "three-stdlib";
import region from "@/data/region.json";
import { useStore } from "@/lib/store";
import type { WeatherField } from "@/lib/types";
import { frame } from "./frame";
import { CITIES, MX, MY, polylineLength, toXZ, type XZ } from "./geo";

/**
 * The regional map for the opening sequence: Natural Earth coastlines and borders, and today's Meteomatics
 * evaporative-demand field over the UAE. Drawn at true geographic scale under the twin.
 */
const BOX = { lonMin: 49, latMin: 20, lonMax: 60, latMax: 28.5 };
const W = 4096;
const H = Math.round((W * ((BOX.latMax - BOX.latMin) * MY)) / ((BOX.lonMax - BOX.lonMin) * MX));
const Y = -320;

// cream ramp, dark to light: higher evaporative demand reads brighter
const RAMP: [number, [number, number, number]][] = [
  [0, [44, 37, 28]],
  [0.3, [104, 85, 58]],
  [0.55, [168, 136, 92]],
  [0.8, [222, 190, 136]],
  [1, [246, 232, 200]],
];

export function rampColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(", ")})`;

const px = (lon: number) => ((lon - BOX.lonMin) / (BOX.lonMax - BOX.lonMin)) * W;
const py = (lat: number) => ((BOX.latMax - lat) / (BOX.latMax - BOX.latMin)) * H;

type Country = { code: string; name: string; rings: number[][][] };

function drawMap(field: WeatherField | null) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a0907";
  g.fillRect(0, 0, W, H);
  // graticule
  g.strokeStyle = "rgba(242,234,216,0.05)";
  g.lineWidth = 2;
  for (let lon = 50; lon <= 59; lon++) {
    g.beginPath();
    g.moveTo(px(lon), 0);
    g.lineTo(px(lon), H);
    g.stroke();
  }
  for (let lat = 21; lat <= 28; lat++) {
    g.beginPath();
    g.moveTo(0, py(lat));
    g.lineTo(W, py(lat));
    g.stroke();
  }
  const countries = (region as { countries: Country[] }).countries;
  const path = (rings: number[][][]) => {
    const p = new Path2D();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => (i ? p.lineTo(px(lon), py(lat)) : p.moveTo(px(lon), py(lat))));
      p.closePath();
    }
    return p;
  };
  for (const ct of countries) {
    g.fillStyle = ct.code === "ARE" ? "#1a1612" : "#13110e";
    g.fill(path(ct.rings));
  }
  const uae = countries.find((c) => c.code === "ARE");
  // Meteomatics field, clipped to the UAE
  if (uae && field?.available && field.values.length && field.min !== null && field.max !== null) {
    const fw = field.lons.length;
    const fh = field.lats.length;
    const off = document.createElement("canvas");
    off.width = fw;
    off.height = fh;
    const og = off.getContext("2d")!;
    const img = og.createImageData(fw, fh);
    const span = Math.max(0.1, field.max - field.min);
    field.values.forEach((row, j) =>
      row.forEach((v, i) => {
        const k = (j * fw + i) * 4;
        if (v === null) {
          img.data[k + 3] = 0;
          return;
        }
        const [r, gg, b] = rampColor((v - field.min!) / span);
        img.data[k] = r;
        img.data[k + 1] = gg;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }),
    );
    og.putImageData(img, 0, 0);
    const dLon = (field.lons[fw - 1] - field.lons[0]) / (fw - 1);
    const dLat = (field.lats[0] - field.lats[fh - 1]) / (fh - 1);
    g.save();
    g.clip(path(uae.rings));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.globalAlpha = 0.92;
    g.drawImage(off, px(field.lons[0] - dLon / 2), py(field.lats[0] + dLat / 2), px(field.lons[fw - 1] + dLon / 2) - px(field.lons[0] - dLon / 2), py(field.lats[fh - 1] - dLat / 2) - py(field.lats[0] + dLat / 2));
    g.restore();
  }
  for (const ct of countries) {
    if (ct.code === "ARE") continue;
    g.strokeStyle = "rgba(242,234,216,0.22)";
    g.lineWidth = 2.5;
    g.stroke(path(ct.rings));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function City({ name, lon, lat }: { name: string; lon: number; lat: number }) {
  const [x, z] = toXZ(lon, lat);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current) return;
    const s = Math.max(1, frame.altitude / 900);
    ref.current.scale.setScalar(s);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = frame.region;
  });
  return (
    <mesh ref={ref} position={[x, Y + 60, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <circleGeometry args={[name === "Al Ain" ? 3 : 2, 20]} />
      <meshBasicMaterial color={name === "Al Ain" ? new THREE.Color(1.6, 1.5, 1.25) : "#d6ccb6"} transparent toneMapped={false} depthWrite={false} fog={false} />
    </mesh>
  );
}

export function Region() {
  const field = useStore((s) => s.field);
  const texture = useMemo(() => drawMap(field), [field]);
  useEffect(() => () => texture.dispose(), [texture]);
  const plane = useRef<THREE.Mesh>(null);
  const outline = useRef<Line2>(null);
  const group = useRef<THREE.Group>(null);

  const { center, size, uaeRing, uaeLen, islands } = useMemo(() => {
    const [x0, z0] = toXZ(BOX.lonMin, BOX.latMax);
    const [x1, z1] = toXZ(BOX.lonMax, BOX.latMin);
    const uae = (region as { countries: Country[] }).countries.find((c) => c.code === "ARE")!;
    const rings = uae.rings.map((r) => r.map(([lon, lat]) => toXZ(lon, lat)) as XZ[]).sort((a, b) => b.length - a.length);
    const main = rings[0];
    return {
      center: [(x0 + x1) / 2, (z0 + z1) / 2] as XZ,
      size: [x1 - x0, z1 - z0] as XZ,
      uaeRing: [...main, main[0]].map(([x, z]) => [x, Y + 40, z] as [number, number, number]),
      uaeLen: polylineLength([...main, main[0]]),
      islands: rings.slice(1).map((r) => [...r, r[0]].map(([x, z]) => [x, Y + 40, z] as [number, number, number])),
    };
  }, []);

  useFrame(() => {
    const o = frame.region;
    if (group.current) group.current.visible = o > 0.002;
    if (plane.current) (plane.current.material as THREE.MeshBasicMaterial).opacity = o;
    const m = outline.current?.material as LineMaterial | undefined;
    if (m) {
      m.dashOffset = uaeLen * (1 - frame.outline);
      m.opacity = o;
    }
  });

  return (
    <group ref={group}>
      <mesh ref={plane} position={[center[0], Y, center[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-20} raycast={() => null}>
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      <Line ref={outline} points={uaeRing} color={new THREE.Color(1.25, 1.18, 1.02)} lineWidth={2} dashed dashSize={uaeLen} gapSize={uaeLen * 2} transparent toneMapped={false} depthWrite={false} renderOrder={-19} />
      {islands.map((pts, i) => (
        <Line key={i} points={pts} color="#d9cfb9" lineWidth={1.2} transparent opacity={0.8} depthWrite={false} renderOrder={-19} />
      ))}
      {CITIES.map((c) => (
        <City key={c.name} {...c} />
      ))}
    </group>
  );
}
