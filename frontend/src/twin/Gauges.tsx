"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RISK_COLOR } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Dem } from "./dem";
import { frame } from "./frame";
import type { Net } from "./net";

/**
 * One sight-glass per farm zone: a glass column whose water level is the zone's supply as a share of its
 * demand (full column = 150%), with a dark ring at 100%. Read together they are a bar chart standing in the
 * oasis; while the timeline plays they drain and fill with the forecast.
 */
export const GAUGE_H = 150;
const R = 9;
const tmp = new THREE.Vector3();

const glassVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const glassFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
    gl_FragColor = vec4(uColor * (0.55 + 0.75 * f), (0.1 + 0.5 * f) * uOpacity);
    #include <colorspace_fragment>
  }
`;

function Gauge({ id, at, dem, order, risk }: { id: string; at: [number, number]; dem: Dem; order: number; risk: string }) {
  const liquid = useRef<THREE.Mesh>(null);
  const surface = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const scaled = useRef<THREE.Group>(null);
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const selected = useStore((s) => s.selection?.type === "zone" && s.selection.id === id);
  const hovered = useStore((s) => s.hover === id);
  const y0 = dem.heightAt(at[0], at[1]);
  const glass = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color("#fffaf0") }, uOpacity: { value: 1 } },
        vertexShader: glassVertex,
        fragmentShader: glassFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const liquidMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(risk), toneMapped: false, transparent: true, opacity: 0.94 }), [risk]);
  const surfaceMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(risk).multiplyScalar(1.35), toneMapped: false, side: THREE.DoubleSide }), [risk]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#17130e" }), []);
  const capMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fbf6ea", transparent: true, opacity: 0.9 }), []);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#120d08", transparent: true, opacity: 0.32, depthWrite: false }), []);

  useFrame(({ camera }) => {
    const rise = Math.min(1, Math.max(0, (frame.reveal - 0.62 - order * 0.04) / 0.22));
    const e = rise * rise * (3 - 2 * rise);
    const ratio = frame.zone[id] ?? 1;
    const level = Math.max(0.5, (GAUGE_H * Math.min(ratio, 1.5)) / 1.5) * e;
    if (liquid.current) {
      liquid.current.scale.y = level;
      liquid.current.position.y = level / 2;
    }
    if (surface.current) surface.current.position.y = level + 0.05;
    // wider from far away so the columns still read as a chart in the overview
    if (scaled.current) {
      const d = camera.position.distanceTo(tmp.set(at[0], y0 + 60, at[1]));
      const k = THREE.MathUtils.clamp(d / 2600, 0.62, 2.1) * (selected || hovered ? 1.12 : 1);
      scaled.current.scale.set(k, 1, k);
    }
    (glass.uniforms.uOpacity as THREE.IUniform).value = e * (selected || hovered ? 1.5 : 1);
    if (group.current) group.current.visible = e > 0.001;
  });

  const onClick = (ev: ThreeEvent<MouseEvent>) => {
    ev.stopPropagation();
    if (ev.delta > 4) return;
    select({ type: "zone", id });
  };

  return (
    <group ref={group} position={[at[0], y0, at[1]]}>
      <group ref={scaled}>
        <mesh
          position={[0, GAUGE_H / 2, 0]}
          material={glass}
          renderOrder={9}
          onClick={onClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHover(id);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHover(null);
            document.body.style.cursor = "";
          }}
        >
          <cylinderGeometry args={[R, R, GAUGE_H, 32, 1, true]} />
        </mesh>
        <mesh ref={liquid} material={liquidMat} raycast={() => null}>
          <cylinderGeometry args={[R * 0.78, R * 0.78, 1, 28]} />
        </mesh>
        <mesh ref={surface} rotation={[-Math.PI / 2, 0, 0]} material={surfaceMat} raycast={() => null}>
          <circleGeometry args={[R * 0.78, 28]} />
        </mesh>
        {/* the requirement: 100% of demand */}
        <mesh position={[0, GAUGE_H / 1.5, 0]} rotation={[Math.PI / 2, 0, 0]} material={ringMat} raycast={() => null}>
          <torusGeometry args={[R * 1.08, 0.9, 6, 40]} />
        </mesh>
        <mesh position={[0, GAUGE_H + 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} material={capMat} raycast={() => null}>
          <torusGeometry args={[R * 1.0, 0.55, 6, 32]} />
        </mesh>
        <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} material={shadowMat} raycast={() => null}>
          <circleGeometry args={[R * 1.8, 32]} />
        </mesh>
      </group>
    </group>
  );
}

/** A slim beacon over the mother well; clicking it opens the source. */
function WellBeacon({ at, dem }: { at: [number, number]; dem: Dem }) {
  const select = useStore((s) => s.select);
  const y0 = dem.heightAt(at[0], at[1]);
  const ref = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    const d = camera.position.distanceTo(tmp.set(at[0], y0, at[1]));
    const k = THREE.MathUtils.clamp(d / 5000, 0.6, 3);
    ref.current.scale.set(k, Math.min(1, Math.max(0.001, frame.reveal / 0.15)), k);
    if (pulse.current) {
      const t = (frame.t * 0.45) % 1;
      pulse.current.scale.setScalar(1 + t * 2.2);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }
  });
  return (
    <group ref={ref} position={[at[0], y0, at[1]]}>
      <mesh
        position={[0, 120, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 4) return;
          select({ type: "source", id: "MW-1" });
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <cylinderGeometry args={[2.4, 2.4, 240, 8]} />
        <meshBasicMaterial color="#17130e" transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 242, 0]} raycast={() => null}>
        <sphereGeometry args={[7.5, 18, 12]} />
        <meshBasicMaterial color={new THREE.Color(0.55, 0.85, 0.9)} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[15, 21, 48]} />
        <meshBasicMaterial color="#17130e" transparent opacity={0.9} />
      </mesh>
      <mesh ref={pulse} position={[0, 1.4, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[19, 22, 48]} />
        <meshBasicMaterial color={new THREE.Color(0.35, 0.62, 0.68)} transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Gauges({ net, dem }: { net: Net; dem: Dem }) {
  const show = useStore((s) => s.layers.gauges);
  const sc = useScenario();
  const day = useStore((s) => s.day);
  return (
    <group visible={show}>
      {net.zones.map((z, i) => {
        const risk = sc?.zones.find((q) => q.id === z.id)?.risk[day] ?? "NORMAL";
        return <Gauge key={z.id} id={z.id} at={z.centroid} dem={dem} order={i} risk={RISK_COLOR[risk]} />;
      })}
      <WellBeacon at={net.well} dem={dem} />
    </group>
  );
}
