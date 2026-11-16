"use client";

import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RISK_COLOR } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import { ZONES, palmField, zoneOutline } from "./layout";

const TRUNK_H = 2.3;

function crownGeometry(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const g = new THREE.PlaneGeometry(0.46, 1, 1, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5; // 0 at the base, 1 at the tip
      const taper = 1 - 0.75 * t;
      p.setXYZ(i, p.getX(i) * taper, 0.72 * Math.sin(t * Math.PI * 0.82) - 0.62 * t * t, 1.7 * t);
    }
    g.rotateY((k / n) * Math.PI * 2 + (k % 2) * 0.2);
    g.rotateX(k % 2 ? 0.08 : -0.06);
    fronds.push(g);
  }
  const merged = mergeGeometries(fronds)!;
  merged.translate(0, TRUNK_H, 0);
  merged.computeVertexNormals();
  return merged;
}

/** Instanced date palms. Canopy colour dries out in zones whose supply falls below demand. */
function Palms() {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const palms = useMemo(() => palmField(), []);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const crown = useMemo(() => crownGeometry(), []);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    palms.forEach((p, i) => {
      dummy.position.set(p.x, 0.05, p.z);
      dummy.rotation.set(0, p.r, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      trunks.current?.setMatrixAt(i, dummy.matrix);
      crowns.current?.setMatrixAt(i, dummy.matrix);
    });
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) crowns.current.instanceMatrix.needsUpdate = true;
  }, [palms]);

  useEffect(() => {
    const mesh = crowns.current;
    if (!mesh) return;
    const healthy = new THREE.Color("#3f7a3d");
    const lush = new THREE.Color("#2f6a3a");
    const dry = new THREE.Color("#9a8748");
    const c = new THREE.Color();
    palms.forEach((p, i) => {
      const zone = sc.zones.find((z) => z.id === ZONES[p.zone].id);
      const ratio = zone ? zone.ratio.central[day] : 1;
      const stress = Math.min(1, Math.max(0, (1 - ratio) / 0.22));
      c.copy(healthy).lerp(lush, (p.s - 0.8) / 0.5).lerp(dry, stress * 0.85);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [palms, sc, day]);

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, palms.length]} castShadow>
        <cylinderGeometry args={[0.09, 0.16, TRUNK_H, 5]} onUpdate={(g) => g.translate(0, TRUNK_H / 2, 0)} />
        <meshStandardMaterial color="#5b4630" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[crown, undefined, palms.length]} castShadow>
        <meshStandardMaterial roughness={0.85} side={THREE.DoubleSide} flatShading />
      </instancedMesh>
    </group>
  );
}

const pointer = {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  },
  onPointerOut: () => {
    document.body.style.cursor = "";
  },
};

function Zone({ index, showRisk }: { index: number; showRisk: boolean }) {
  const layout = ZONES[index];
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selection?.type === "zone" && s.selection.id === layout.id);
  const select = useStore((s) => s.select);
  const zone = sc.zones.find((z) => z.id === layout.id)!;
  const ratio = zone.ratio.central[day];
  const color = RISK_COLOR[zone.risk[day]];
  const short = ratio < sc.required_supply_ratio;

  const { plot, ring, bunds } = useMemo(() => {
    const outline = zoneOutline(layout);
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const r = [...outline, outline[0]].map((p) => new THREE.Vector3(p.x, 0.2, p.y));
    // low earth bunds dividing the basin plots
    const lines: THREE.Vector3[] = [];
    for (let x = layout.cx - layout.w / 2 + 3.5; x < layout.cx + layout.w / 2 - 1; x += 4.1) {
      lines.push(new THREE.Vector3(x, 0.14, layout.cz - layout.d / 2 + 1.2), new THREE.Vector3(x, 0.14, layout.cz + layout.d / 2 - 1.2));
    }
    for (let z = layout.cz - layout.d / 2 + 3.5; z < layout.cz + layout.d / 2 - 1; z += 4.1) {
      lines.push(new THREE.Vector3(layout.cx - layout.w / 2 + 1.2, 0.14, z), new THREE.Vector3(layout.cx + layout.w / 2 - 1.2, 0.14, z));
    }
    return { plot: g, ring: r, bunds: new THREE.BufferGeometry().setFromPoints(lines) };
  }, [layout]);

  return (
    <group>
      <mesh
        geometry={plot}
        position={[0, 0.1, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          select({ type: "zone", id: layout.id });
        }}
        {...pointer}
      >
        <meshStandardMaterial color="#35432c" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={bunds}>
        <lineBasicMaterial color="#6d6248" transparent opacity={0.55} />
      </lineSegments>
      {showRisk && (
        <>
          <mesh geometry={plot} position={[0, 0.17, 0]} renderOrder={1}>
            <meshBasicMaterial color={color} transparent opacity={short ? 0.42 : zone.risk[day] === "NORMAL" ? 0.1 : 0.24} depthWrite={false} toneMapped={false} />
          </mesh>
          <Line points={ring} color={selected ? "#ffffff" : color} lineWidth={selected ? 3 : 1.6} transparent opacity={0.95} />
        </>
      )}
      {!showRisk && selected && <Line points={ring} color="#ffffff" lineWidth={2.5} />}
    </group>
  );
}

export function Grove({ showRisk }: { showRisk: boolean }) {
  return (
    <group>
      {ZONES.map((z, i) => (
        <Zone key={z.id} index={i} showRisk={showRisk} />
      ))}
      <Palms />
    </group>
  );
}
