"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2, LineMaterial } from "three-stdlib";
import { useScenario, useStore } from "@/lib/store";
import type { Dem } from "./dem";
import { frame } from "./frame";
import { densify, type XZ } from "./geo";
import { drape, type Net } from "./net";

const WATER = new THREE.Color(1.15, 1.55, 1.6); // pale glowing water: the one cool colour in the scene
const SHORT = new THREE.Color(1.65, 0.62, 0.4);
const BED = new THREE.Color("#f4ecdb");
const CASING = new THREE.Color("#17130e");

function smooth(a: number, b: number, v: number) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A draped channel: dark casing, a cream bed that draws itself in, and water moving along it. */
function Channel({
  points,
  length,
  width,
  revealFrom,
  revealTo,
  flowKey,
  short,
}: {
  points: [number, number, number][];
  length: number;
  width: number;
  revealFrom: number;
  revealTo: number;
  flowKey: string;
  short: boolean;
}) {
  const bed = useRef<Line2>(null);
  const casing = useRef<Line2>(null);
  const flow = useRef<Line2>(null);
  const offset = useRef(0);

  useFrame((_, dt) => {
    const p = smooth(revealFrom, revealTo, frame.reveal);
    for (const ref of [bed, casing]) {
      const m = ref.current?.material as LineMaterial | undefined;
      if (m) m.dashOffset = length * (1 - p);
    }
    const fm = flow.current?.material as LineMaterial | undefined;
    if (fm) {
      const f = frame.flow[flowKey] ?? 1;
      const vis = smooth(revealTo - 0.05, revealTo + 0.12, frame.reveal);
      offset.current -= dt * (40 + 150 * Math.max(0.05, f));
      fm.dashOffset = offset.current;
      fm.opacity = vis * (0.4 + 0.6 * Math.min(1, f));
      fm.linewidth = width * (0.65 + 0.5 * Math.min(1.3, f));
      fm.color.copy(short ? SHORT : WATER);
    }
  });

  return (
    <group>
      <Line ref={casing} points={points} color={CASING} lineWidth={width + 3.2} transparent opacity={0.7} dashed dashSize={length} gapSize={length * 2} renderOrder={2} />
      <Line ref={bed} points={points} color={BED} lineWidth={width} transparent opacity={0.95} dashed dashSize={length} gapSize={length * 2} renderOrder={3} />
      <Line ref={flow} points={points} color={WATER} lineWidth={width} transparent opacity={0} dashed dashSize={24} gapSize={46} toneMapped={false} depthTest={false} renderOrder={4} />
    </group>
  );
}

/** The tunnel is underground: on the surface it shows as a line of access shafts, with water moving below. */
function Tunnel({ net, dem }: { net: Net; dem: Dem }) {
  const pts = useMemo(() => drape(net.tunnel, dem, 2), [net, dem]);
  const trace = useRef<Line2>(null);
  const flow = useRef<Line2>(null);
  const offset = useRef(0);
  useFrame((_, dt) => {
    const t = smooth(0, 0.3, frame.reveal);
    const tm = trace.current?.material as LineMaterial | undefined;
    if (tm) {
      tm.opacity = 0.78 * t;
      tm.dashOffset = net.lengths.tunnel * (1 - t);
    }
    const fm = flow.current?.material as LineMaterial | undefined;
    if (fm) {
      const f = frame.flow.main ?? 1;
      offset.current -= dt * (90 + 260 * Math.max(0.05, f));
      fm.dashOffset = offset.current;
      fm.opacity = smooth(0.25, 0.45, frame.reveal) * (0.45 + 0.55 * Math.min(1, f));
    }
  });
  return (
    <group>
      <Line ref={trace} points={pts} color={CASING} lineWidth={2.2} transparent opacity={0} dashed dashSize={net.lengths.tunnel} gapSize={net.lengths.tunnel * 2} renderOrder={2} depthWrite={false} />
      <Line ref={flow} points={pts} color={WATER} lineWidth={2.6} transparent opacity={0} dashed dashSize={70} gapSize={170} toneMapped={false} depthTest={false} depthWrite={false} renderOrder={4} />
    </group>
  );
}

function Shafts({ net, dem }: { net: Net; dem: Dem }) {
  const rings = useRef<THREE.InstancedMesh>(null);
  const pits = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const ring = new THREE.TorusGeometry(3.6, 1.4, 6, 18);
    ring.rotateX(Math.PI / 2);
    ring.scale(1, 0.45, 1);
    const pit = new THREE.CircleGeometry(2.5, 16);
    pit.rotateX(-Math.PI / 2);
    return { ring, pit };
  }, []);
  const last = useRef(-1);
  useFrame(() => {
    const r = frame.reveal;
    if (Math.abs(r - last.current) < 1e-4) return;
    last.current = r;
    const dummy = new THREE.Object3D();
    const n = net.shafts.length;
    net.shafts.forEach(([x, z], i) => {
      const s = smooth((i / n) * 0.3, (i / n) * 0.3 + 0.06, r);
      const y = dem.heightAt(x, z);
      dummy.position.set(x, y + 0.5, z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      rings.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 0.7;
      dummy.updateMatrix();
      pits.current?.setMatrixAt(i, dummy.matrix);
    });
    if (rings.current) rings.current.instanceMatrix.needsUpdate = true;
    if (pits.current) pits.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={rings} args={[geo.ring, undefined, net.shafts.length]} frustumCulled={false} raycast={() => null}>
        <meshStandardMaterial color="#c9b08a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={pits} args={[geo.pit, undefined, net.shafts.length]} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial color="#1a130b" />
      </instancedMesh>
    </group>
  );
}

function Marker({ at, dem, radius, core }: { at: [number, number]; dem: Dem; radius: number; core: THREE.Color }) {
  const y = dem.heightAt(at[0], at[1]) + 2.5;
  return (
    <group position={[at[0], y, at[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={6}>
        <ringGeometry args={[radius * 0.72, radius, 48]} />
        <meshBasicMaterial color={CASING} transparent opacity={0.92} depthTest={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={6}>
        <circleGeometry args={[radius * 0.36, 32]} />
        <meshBasicMaterial color={core} toneMapped={false} depthTest={false} />
      </mesh>
    </group>
  );
}

/** Crisp zone borders drawn as lines on the ground; the risk colour glows inside them (terrain shader). */
function ZoneOutlines({ net, dem }: { net: Net; dem: Dem }) {
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const group = useRef<THREE.Group>(null);
  const rings = useMemo(
    () =>
      net.zones.map((z) => {
        const closed: XZ[] = [...z.poly, z.poly[0]];
        return { id: z.id, pts: drape(densify(closed, 6), dem, 1.2) };
      }),
    [net, dem],
  );
  const sel = selection?.type === "zone" ? selection.id : null;
  useFrame(() => {
    const o = smooth(0.55, 0.8, frame.reveal);
    group.current?.traverse((c) => {
      const m = (c as Line2).material as LineMaterial | undefined;
      if (m && "linewidth" in m) m.opacity = o * ((c.userData.base as number) ?? 1);
    });
  });
  return (
    <group ref={group}>
      {rings.map((r) => {
        const active = r.id === sel || r.id === hover;
        return (
          <Line
            key={r.id + (active ? "-on" : "")}
            points={r.pts}
            color={active ? "#ffffff" : "#fbf5e8"}
            lineWidth={r.id === sel ? 2.6 : active ? 1.8 : 1.05}
            transparent
            opacity={0}
            userData={{ base: active ? 1 : 0.8 }}
            depthTest={false}
            depthWrite={false}
            renderOrder={r.id === sel ? 6 : 5}
          />
        );
      })}
    </group>
  );
}

export function Network({ net, dem }: { net: Net; dem: Dem }) {
  const sc = useScenario();
  const day = useStore((s) => s.day);
  const showFlow = useStore((s) => s.layers.flow);

  const lines = useMemo(
    () => ({
      main: drape(net.main, dem, 2.5),
      branches: Object.fromEntries(Object.entries(net.branches).map(([k, v]) => [k, drape(v, dem, 2.5)])),
    }),
    [net, dem],
  );

  const shortBranch = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!sc) return out;
    for (const b of sc.branches) out[b.id] = sc.zones.some((z) => z.branch === b.id && z.ratio.central[day] < sc.required_supply_ratio);
    return out;
  }, [sc, day]);

  const branchIds = Object.keys(lines.branches).sort();
  return (
    <group>
      <ZoneOutlines net={net} dem={dem} />
      <Shafts net={net} dem={dem} />
      <Tunnel net={net} dem={dem} />
      <Channel points={lines.main} length={net.lengths.main} width={3.4} revealFrom={0.3} revealTo={0.42} flowKey="main" short={false} />
      {branchIds.map((id, i) => (
        <Channel
          key={id}
          points={lines.branches[id]}
          length={net.lengths.branches[id]}
          width={2.6}
          revealFrom={0.42 + i * 0.04}
          revealTo={0.62 + i * 0.04}
          flowKey={id}
          short={showFlow && !!shortBranch[id]}
        />
      ))}
      <Marker at={net.sharia} dem={dem} radius={15} core={WATER} />
      <Marker at={net.divider} dem={dem} radius={11} core={BED} />
    </group>
  );
}
