"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { STATUS_COLOR } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { EadWells } from "@/lib/types";
import type { Dem } from "./dem";
import { frame } from "./frame";
import { toXZ } from "./geo";

function dotTexture(ring: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(11,10,8,0.85)";
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(32, 32, ring ? 14 : 18, 0, Math.PI * 2);
  g.fill();
  if (ring) {
    g.strokeStyle = "#ffffff";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function SensorSprite({ id, x, y, z, color, selected }: { id: string; x: number; y: number; z: number; color: string; selected: boolean }) {
  const select = useStore((s) => s.select);
  const ref = useRef<THREE.Sprite>(null);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: dotTexture(true), color: new THREE.Color(color), sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }), [color]);
  useFrame(() => {
    // field sensors matter close up; from the overview they would only clutter the groves
    const near = 1 - Math.min(1, Math.max(0, (frame.altitude - 1800) / 900));
    const s = Math.min(1, Math.max(0, (frame.reveal - 0.7) / 0.2)) * (selected ? 1 : near);
    if (ref.current) {
      ref.current.scale.setScalar((selected ? 0.024 : 0.016) * s);
      ref.current.visible = s > 0.01;
    }
  });
  return (
    <sprite
      ref={ref}
      position={[x, y, z]}
      material={mat}
      renderOrder={20}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 4) return;
        select({ type: "sensor", id }, false);
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    />
  );
}

export function Sensors({ dem }: { dem: Dem }) {
  const sensors = useStore((s) => s.data?.telemetry.sensors ?? []);
  const selection = useStore((s) => s.selection);
  return (
    <group>
      {sensors.map((s) => {
        const [x, z] = toXZ(s.lon, s.lat);
        return <SensorSprite key={s.id} id={s.id} x={x} y={dem.heightAt(x, z) + 6} z={z} color={STATUS_COLOR[s.status]} selected={selection?.type === "sensor" && selection.id === s.id} />;
      })}
    </group>
  );
}

/** Real Environment Agency – Abu Dhabi groundwater monitoring wells (locations only). */
export function EadWells({ dem }: { dem: Dem }) {
  const show = useStore((s) => s.layers.wells);
  const [wells, setWells] = useState<EadWells | null>(null);
  useEffect(() => {
    if (!show || wells) return;
    fetch("/api/geo/ead-wells")
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => setWells(w ?? { available: false, wells: [] }))
      .catch(() => setWells({ available: false, wells: [] }));
  }, [show, wells]);
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (const w of wells?.wells ?? []) {
      const [x, z] = toXZ(w.lon, w.lat);
      if (Math.abs(x) > 21000 || Math.abs(z) > 21000) continue;
      pts.push(x, dem.heightAt(x, z) + 8, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [wells, dem]);
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, map: dotTexture(false), color: new THREE.Color("#e9dcc0"), transparent: true, depthTest: false, toneMapped: false }), []);
  if (!show || !wells?.available) return null;
  return <points geometry={geo} material={mat} renderOrder={19} raycast={() => null} />;
}
