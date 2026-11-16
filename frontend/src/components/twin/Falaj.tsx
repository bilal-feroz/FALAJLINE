"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { STATUS_COLOR } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Selection, Sensor } from "@/lib/types";
import { anim } from "./anim";
import { DIVIDER, INV_SHARIA, INV_WELL, PATHS, SHAFT_XS, SHARIA_X, TUNNEL_CURVE, WELL_X, ZONES, ground, tunnelInvert, waterTable, wetSectionEnd, type PathDef } from "./layout";

const STONE = "#7b6f5c";
const WATER = "#46d3c6";

/** How strongly a flow shows: a third less water should look clearly thinner, not almost the same. */
function emphasis(frac: number): number {
  return Math.min(1.25, Math.max(0.06, (frac - 0.38) / 0.62));
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

function click(sel: Selection) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useStore.getState().select(sel);
  };
}

/** Water moving along a channel: particle count and speed follow the simulated flow. */
function Particles({ curve, count, flowKey, size = 0.17 }: { curve: THREE.Curve<THREE.Vector3>; count: number; flowKey: string; size?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const phase = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const length = useMemo(() => curve.getLength(), [curve]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const e = emphasis(anim.flow[flowKey] ?? 1);
    phase.current = (phase.current + (Math.min(dt, 0.05) * (1.2 + 5.0 * e)) / length) % 1;
    const visible = Math.round(count * Math.min(1, e));
    for (let i = 0; i < count; i++) {
      if (i < visible) {
        const t = (phase.current + i / visible) % 1;
        curve.getPointAt(t, dummy.position);
        dummy.position.y += 0.1;
        const fade = Math.sin(Math.PI * t); // ease in and out at the ends of the reach
        dummy.scale.setScalar(0.45 + 0.55 * fade);
      } else {
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[size, 8, 6]} />
      <meshBasicMaterial color="#bff7f0" toneMapped={false} />
    </instancedMesh>
  );
}

function Channel({ path, showFlow, selected }: { path: PathDef; showFlow: boolean; selected: boolean }) {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const { bed, stream } = useMemo(
    () => ({ bed: new THREE.TubeGeometry(path.curve, 48, 0.5, 8), stream: new THREE.TubeGeometry(path.curve, 48, 0.3, 8) }),
    [path],
  );
  useFrame(() => {
    if (!water.current) return;
    const e = emphasis(anim.flow[path.flowKey] ?? 1);
    water.current.emissiveIntensity = 0.25 + 0.9 * Math.min(1, e);
    water.current.opacity = 0.45 + 0.5 * Math.min(1, e);
  });
  return (
    <group>
      <mesh geometry={bed} scale={[1, 0.34, 1]} position={[0, 0.03, 0]} castShadow receiveShadow onClick={click(path.component)} {...pointer}>
        <meshStandardMaterial color={selected ? "#b9a988" : STONE} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={stream} scale={[1, 0.3, 1]} position={[0, 0.13, 0]}>
        <meshStandardMaterial ref={water} color="#1f8f95" emissive={WATER} emissiveIntensity={0.8} transparent opacity={0.9} roughness={0.25} />
      </mesh>
      {showFlow && <Particles curve={path.curve} count={path.particles} flowKey={path.flowKey} />}
    </group>
  );
}

function MotherWell({ underground, selected }: { underground: boolean; selected: boolean }) {
  const column = useRef<THREE.Mesh>(null);
  const level = useRef<THREE.Mesh>(null);
  const today = useRef<THREE.Mesh>(null);
  const top = ground(WELL_X, 0);
  const bottom = INV_WELL - 0.6;

  useFrame(() => {
    const wt = waterTable(WELL_X, anim.head);
    if (column.current) {
      const h = Math.max(0.05, wt - bottom);
      column.current.scale.y = h;
      column.current.position.y = bottom + h / 2;
    }
    if (level.current) level.current.position.y = wt;
    if (today.current) today.current.position.y = waterTable(WELL_X, anim.head0);
  });

  return (
    <group position={[WELL_X, 0, 0]} onClick={click({ type: "source", id: "MW-1" })} {...pointer}>
      {/* stone collar at the surface */}
      <mesh position={[0, top + 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[1.25, 0.3, 8, 22]} />
        <meshStandardMaterial color={selected ? "#d8c7a3" : "#978a72"} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {underground && (
        <>
          <mesh position={[0, (top + bottom) / 2, 0]}>
            <cylinderGeometry args={[1.05, 1.05, top - bottom, 20, 1, true]} />
            <meshStandardMaterial color="#8a7c66" roughness={1} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh ref={column}>
            <cylinderGeometry args={[0.82, 0.82, 1, 18]} />
            <meshStandardMaterial color="#1b7f8f" emissive={WATER} emissiveIntensity={0.55} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={level} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.12, 0.07, 6, 28]} />
            <meshBasicMaterial color="#9ff3ea" toneMapped={false} />
          </mesh>
          <mesh ref={today} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.3, 0.035, 6, 28]} />
            <meshBasicMaterial color="#cdb88c" toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Tunnel({ showFlow, selected }: { showFlow: boolean; selected: boolean }) {
  const wet = useRef<THREE.Mesh>(null);
  const tube = useMemo(() => new THREE.TubeGeometry(TUNNEL_CURVE, 60, 0.58, 12), []);
  const angle = Math.atan2(INV_SHARIA - INV_WELL, SHARIA_X - WELL_X);

  useFrame(() => {
    if (!wet.current) return;
    const end = Math.min(SHARIA_X, wetSectionEnd(anim.head));
    const len = Math.max(0.1, end - WELL_X);
    const mid = WELL_X + len / 2;
    wet.current.scale.y = len / Math.cos(angle);
    wet.current.position.set(mid, tunnelInvert(mid) + 0.25, 0);
  });

  return (
    <group>
      <mesh geometry={tube} onClick={click({ type: "tunnel", id: "tunnel" })} {...pointer}>
        <meshStandardMaterial color={selected ? "#d8c7a3" : "#93846b"} roughness={1} transparent opacity={0.36} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* the stretch of tunnel below the water table, where the falaj gains its water */}
      <mesh ref={wet} rotation={[0, 0, angle - Math.PI / 2]}>
        <cylinderGeometry args={[0.66, 0.66, 1, 12, 1, true]} />
        <meshBasicMaterial color="#48d6cf" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {showFlow && <Particles curve={TUNNEL_CURVE} count={44} flowKey="main" size={0.19} />}
      {SHAFT_XS.map((x) => {
        const top = ground(x, 0);
        const bottom = tunnelInvert(x) + 0.5;
        return (
          <mesh key={x} position={[x, (top + bottom) / 2, 0]}>
            <cylinderGeometry args={[0.4, 0.4, top - bottom, 12, 1, true]} />
            <meshStandardMaterial color="#8a7c66" roughness={1} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Spoil rings around the access shafts: the line of craters that marks a falaj on the surface. */
function ShaftMounds() {
  return (
    <group>
      {SHAFT_XS.map((x) => (
        <mesh key={x} position={[x, ground(x, 0) + 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.55]} castShadow>
          <torusGeometry args={[0.85, 0.36, 7, 16]} />
          <meshStandardMaterial color="#a08a63" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function SensorPost({ sensor, position, selected }: { sensor: Sensor; position: [number, number, number]; selected: boolean }) {
  const lamp = useRef<THREE.Mesh>(null);
  const color = STATUS_COLOR[sensor.status];
  useFrame(({ clock }) => {
    if (!lamp.current) return;
    const pulse = sensor.status === "ok" ? 1 : 1 + 0.35 * Math.sin(clock.elapsedTime * 5);
    lamp.current.scale.setScalar((selected ? 1.5 : 1) * pulse);
  });
  return (
    <group position={position} onClick={click({ type: "sensor", id: sensor.id })} {...pointer}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 1.8, 6]} />
        <meshStandardMaterial color="#cfd3cf" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 1.55, 0.16]} rotation={[-0.6, 0, 0]}>
        <boxGeometry args={[0.5, 0.03, 0.34]} />
        <meshStandardMaterial color="#1b2733" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh ref={lamp} position={[0, 1.95, 0]}>
        <sphereGeometry args={[0.2, 12, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* generous invisible hit area */}
      <mesh position={[0, 1.1, 0]} visible={false}>
        <cylinderGeometry args={[0.7, 0.7, 2.4, 8]} />
        <meshBasicMaterial side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function sensorPosition(s: Sensor): [number, number, number] | null {
  if (s.id === "S-GW-01") return [WELL_X - 2.2, ground(WELL_X - 2.2, -1.4), -1.4];
  if (s.id === "S-FL-MAIN") return [SHARIA_X + 2.2, 0.05, -1.5];
  if (s.component.startsWith("branch:")) {
    const path = PATHS.find((p) => p.id === `${s.component.slice(7)}-head`);
    if (!path) return null;
    const p = path.curve.getPointAt(0.42);
    return [p.x + 0.9, 0.05, p.z - 0.9];
  }
  if (s.component.startsWith("zone:")) {
    const z = ZONES.find((x) => x.id === s.component.slice(5));
    return z ? [z.outlet.x + 1.0, 0.05, z.outlet.z + 1.0] : null;
  }
  return null;
}

export function Falaj({
  underground,
  surface,
  showFlow,
  showSensors,
}: {
  underground: boolean;
  surface: boolean;
  showFlow: boolean;
  showSensors: boolean;
}) {
  const sensors = useStore((s) => s.data)!.telemetry.sensors;
  const selection = useStore((s) => s.selection);
  const is = (type: Selection["type"], id?: string) => selection?.type === type && (id === undefined || selection.id === id);

  return (
    <group>
      <MotherWell underground={underground} selected={is("source")} />
      <ShaftMounds />
      {underground && <Tunnel showFlow={showFlow} selected={is("tunnel")} />}

      {surface && (
        <>
          {/* shari'a: where the falaj surfaces */}
          <group position={[SHARIA_X, 0, 0]}>
            {[-0.75, 0.75].map((z) => (
              <mesh key={z} position={[0, 0.55, z]} castShadow>
                <boxGeometry args={[0.5, 1.1, 0.3]} />
                <meshStandardMaterial color="#978a72" roughness={0.9} />
              </mesh>
            ))}
            <mesh position={[0, 1.2, 0]} castShadow>
              <boxGeometry args={[0.6, 0.28, 1.9]} />
              <meshStandardMaterial color="#a5977d" roughness={0.9} />
            </mesh>
          </group>
          {/* division structure */}
          <mesh position={[DIVIDER.x, 0.2, DIVIDER.z]} castShadow>
            <cylinderGeometry args={[1.25, 1.4, 0.4, 6]} />
            <meshStandardMaterial color="#978a72" roughness={0.9} flatShading />
          </mesh>
          {PATHS.map((p) => (
            <Channel key={p.id} path={p} showFlow={showFlow} selected={is(p.component.type, p.component.id)} />
          ))}
          {ZONES.map((z) => (
            <mesh key={z.id} position={[z.outlet.x, 0.22, z.outlet.z]} castShadow>
              <boxGeometry args={[0.95, 0.44, 0.95]} />
              <meshStandardMaterial color="#978a72" roughness={0.9} />
            </mesh>
          ))}
        </>
      )}

      {showSensors &&
        sensors.map((s) => {
          const pos = sensorPosition(s);
          return pos ? <SensorPost key={s.id} sensor={s} position={pos} selected={is("sensor", s.id)} /> : null;
        })}

    </group>
  );
}
