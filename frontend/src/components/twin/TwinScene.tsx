"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useScenario, useStore } from "@/lib/store";
import { anim, stepAnim } from "./anim";
import { Falaj } from "./Falaj";
import { Grove } from "./Grove";
import { Ground } from "./Ground";
import { labelTargets } from "./TwinLabels";

export interface Layers {
  surface: boolean;
  underground: boolean;
  flow: boolean;
  risk: boolean;
  sensors: boolean;
  labels: boolean;
}

export type CameraPreset = "overview" | "source" | "section" | "oasis";

// The scene is built with the mother well at -x and then mirrored (see the group in TwinScene), so that on
// screen east is to the right and the viewer looks north, as on the map. Camera poses are in world space.
const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [58, 92, 176], target: [13, -9, 2] },
  source: { pos: [112, 30, 70], target: [46, -2, 4] },
  section: { pos: [36, 6, 132], target: [36, -5, 0] },
  oasis: { pos: [-34, 54, 84], target: [-38, -2, -2] },
};
// Where the camera starts when the introduction hands over: high above, looking down like the map it follows.
const ARRIVAL = { pos: [0, 255, 46] as [number, number, number], target: [0, 0, 2] as [number, number, number] };

/** Pushes the forecast for the selected day into the animated scene state. */
function Animator() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const first = useRef(true);

  useEffect(() => {
    const base = data.scenarios.baseline;
    const ref = base.main.flow_lps.central[0];
    const flow: Record<string, number> = { main: sc.main.flow_lps.central[day] / ref };
    sc.branches.forEach((b, i) => (flow[`branch:${b.id}`] = b.flow_lps[day] / base.branches[i].flow_lps[0]));
    sc.zones.forEach((z, i) => (flow[`zone:${z.id}`] = z.supply_lps.central[day] / base.zones[i].supply_lps.central[0]));
    anim.head0 = sc.source.head_m.central[0];
    anim.target.head = sc.source.head_m.central[day];
    anim.target.flow = flow;
    if (first.current) {
      anim.head = anim.target.head;
      anim.flow = { ...flow };
      first.current = false;
    }
  }, [data, sc, day]);

  useFrame((_, dt) => stepAnim(Math.min(dt, 0.1)));
  return null;
}

/** Moves each DOM label to the screen position of its anchor in the scene. */
function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    labelTargets.forEach((get, el) => {
      const [x, y, z] = get();
      v.set(-x, y, z).project(camera); // anchors are in mirrored scene space
      const visible = v.z > -1 && v.z < 1;
      el.style.transform = `translate(-50%, -50%) translate(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * size.height).toFixed(1)}px)`;
      el.style.opacity = visible ? "1" : "0";
    });
  });
  return null;
}

function CameraRig({ preset, nonce, arrival }: { preset: CameraPreset; nonce: number; arrival: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const flight = useRef<{ t: number; duration: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; to: CameraPreset } | null>(null);
  const handled = useRef({ nonce, arrival: 0 });

  useEffect(() => {
    if (!controls) return;
    if (arrival !== handled.current.arrival) {
      // the introduction has just dissolved: descend from the map view into the overview
      handled.current.arrival = arrival;
      camera.position.set(...ARRIVAL.pos);
      controls.target.set(...ARRIVAL.target);
      controls.update();
      flight.current = { t: 0, duration: 2.8, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), to: "overview" };
    } else if (nonce !== handled.current.nonce) {
      handled.current.nonce = nonce;
      flight.current = { t: 0, duration: 1.1, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), to: preset };
    }
  }, [preset, nonce, arrival, controls, camera]);

  useFrame((_, dt) => {
    const f = flight.current;
    if (!f || !controls) return;
    f.t = Math.min(1, f.t + Math.min(dt, 0.05) / f.duration);
    const e = f.t * f.t * (3 - 2 * f.t);
    const p = PRESETS[f.to];
    camera.position.lerpVectors(f.fromPos, new THREE.Vector3(...p.pos), e);
    controls.target.lerpVectors(f.fromTarget, new THREE.Vector3(...p.target), e);
    controls.update();
    if (f.t >= 1) flight.current = null;
  });
  return null;
}

export default function TwinScene({ layers, preset, nonce }: { layers: Layers; preset: CameraPreset; nonce: number }) {
  const select = useStore((s) => s.select);
  const arrival = useStore((s) => s.arrival);
  // if the introduction is playing when the scene mounts, wait above the block for the hand-over
  const start = useMemo(() => (useStore.getState().intro ? ARRIVAL : PRESETS.overview), []);
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: start.pos, fov: 34, near: 1, far: 700 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#07090a"]} />
      <fog attach="fog" args={["#07090a", 190, 430]} />
      <hemisphereLight args={["#cfe0ee", "#4a3a27", 0.7]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        position={[-45, 75, 55]}
        intensity={3.0}
        color="#ffe6c4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-85}
        shadow-camera-right={85}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={260}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[60, 20, -40]} intensity={0.35} color="#7fb6d6" />

      <Animator />
      <group scale={[-1, 1, 1]}>
        <Ground underground={layers.underground} surface={layers.surface} onSelectSource={() => select({ type: "source", id: "MW-1" })} />
        <Falaj underground={layers.underground} surface={layers.surface} showFlow={layers.flow} showSensors={layers.sensors} />
        {layers.surface && <Grove showRisk={layers.risk} />}
      </group>
      <LabelProjector />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={18} maxDistance={320} maxPolarAngle={Math.PI * 0.495} target={start.target} />
      <CameraRig preset={preset} nonce={nonce} arrival={arrival} />
    </Canvas>
  );
}
