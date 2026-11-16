"use client";

import { MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useStore } from "@/lib/store";
import type { CameraPreset } from "@/lib/types";
import type { Dem } from "./dem";
import { frame } from "./frame";
import { toXZ } from "./geo";
import type { Net } from "./net";

export interface Pose {
  target: THREE.Vector3;
  r: number;
  polar: number; // from vertical
  az: number; // around y, 0 = camera south of the target looking north
}

export function poseToPosition(p: Pose, out = new THREE.Vector3()) {
  return out.set(p.target.x + p.r * Math.sin(p.polar) * Math.sin(p.az), p.target.y + p.r * Math.cos(p.polar), p.target.z + p.r * Math.sin(p.polar) * Math.cos(p.az));
}

function currentPose(camera: THREE.Camera, target: THREE.Vector3): Pose {
  const d = camera.position.clone().sub(target);
  const r = d.length();
  return { target: target.clone(), r, polar: Math.acos(Math.min(1, Math.max(-1, d.y / r))), az: Math.atan2(d.x, d.z) };
}

/** Camera azimuth that looks along (dx, dz), turned `turn` radians to the left (north) of it. */
function lookAlong(dx: number, dz: number, turn: number) {
  const phi = Math.atan2(dz, dx) - turn;
  return Math.atan2(-Math.cos(phi), -Math.sin(phi));
}

export function presetPose(preset: CameraPreset, net: Net, dem: Dem, zone?: string): Pose {
  const h = (x: number, z: number) => dem.heightAt(x, z);
  const cx = net.zones.reduce((a, z) => a + z.centroid[0], 0) / net.zones.length;
  const cz = net.zones.reduce((a, z) => a + z.centroid[1], 0) / net.zones.length;
  // every view of the oasis looks up the falaj towards its source, with the line running off to the right
  const az = lookAlong(net.well[0] - cx, net.well[1] - cz, 0.5);
  switch (preset) {
    case "oasis":
      return { target: new THREE.Vector3(cx, h(cx, cz), cz), r: 3100, polar: 0.98, az };
    case "source": {
      // the whole falaj side-on: the oasis on the left, the mother well on the right
      const x = net.sharia[0] + (net.well[0] - net.sharia[0]) * 0.48;
      const z = net.sharia[1] + (net.well[1] - net.sharia[1]) * 0.48;
      const side = lookAlong(net.well[0] - net.sharia[0], net.well[1] - net.sharia[1], Math.PI / 2 - 0.22);
      return { target: new THREE.Vector3(x, h(x, z), z), r: 13800, polar: 0.78, az: side };
    }
    case "zone": {
      const zz = net.zones.find((q) => q.id === zone) ?? net.zones[0];
      const [x, z] = zz.centroid;
      return { target: new THREE.Vector3(x, h(x, z) + 30, z), r: 1150, polar: 0.98, az };
    }
    case "system":
    default: {
      // the oasis in the foreground, the falaj leading the eye to the mother well and the mountains
      const x = cx + (net.well[0] - cx) * 0.13;
      const z = cz + (net.well[1] - cz) * 0.13;
      return { target: new THREE.Vector3(x, h(x, z), z), r: 6200, polar: 0.97, az };
    }
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

export const INTRO = { END: 13.2, UI_AT: 11.6 };
const [AX, AZ] = toXZ(54.25, 24.32); // over the UAE
const START: Pose = { target: new THREE.Vector3(AX, -320, AZ), r: 880e3, polar: 0.0002, az: 0 };

/** Camera pose and scene state at time t (s) of the opening sequence. */
function introPose(t: number, sys: Pose): Pose {
  const alAin = new THREE.Vector3(0, -150, 0);
  if (t < 2.6) {
    const drift = t / 2.6;
    return { ...START, target: START.target.clone().add(new THREE.Vector3(drift * 6000, 0, 0)) };
  }
  if (t < 6.0) {
    const e = ease((t - 2.6) / 3.4);
    return {
      target: new THREE.Vector3().lerpVectors(START.target.clone().add(new THREE.Vector3(6000, 0, 0)), alAin, e),
      r: Math.exp(THREE.MathUtils.lerp(Math.log(START.r), Math.log(170e3), e)),
      polar: 0.0002,
      az: 0,
    };
  }
  const e = ease(Math.min(1, (t - 6.0) / 4.8));
  return {
    target: new THREE.Vector3().lerpVectors(alAin, sys.target, e),
    r: Math.exp(THREE.MathUtils.lerp(Math.log(170e3), Math.log(sys.r), e)),
    polar: THREE.MathUtils.lerp(0.0002, sys.polar, smooth(0.15, 1, e)),
    az: THREE.MathUtils.lerp(0, sys.az, e),
  };
}

function introState(t: number) {
  frame.outline = smooth(0.25, 2.8, t);
  frame.region = 1 - smooth(8.4, 10.2, t);
  frame.terrain = smooth(6.2, 8.4, t);
  frame.space = 1 - smooth(6.6, 9.4, t);
  frame.reveal = smooth(9.2, 12.8, t);
}

export function setAppState() {
  frame.outline = 1;
  frame.region = 0;
  frame.terrain = 1;
  frame.space = 0;
  frame.reveal = 1;
  frame.introT = -1;
}

export function CameraRig({ net, dem }: { net: Net; dem: Dem }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const cam = useStore((s) => s.camera);
  const intro = useStore((s) => s.intro);
  const flight = useRef<{ t: number; dur: number; from: Pose; to: Pose } | null>(null);
  const offset = useRef(new THREE.Vector2());
  const sys = useMemo(() => presetPose("system", net, dem), [net, dem]);

  // start position: high above the UAE until the opening sequence (or the app) takes over
  useEffect(() => {
    if (intro === "done") return;
    poseToPosition(START, camera.position);
    camera.lookAt(START.target);
  }, [camera, intro]);

  // first arrival in the app (opening played or skipped): settle on the overview pose
  const placed = useRef(false);
  useEffect(() => {
    if (intro !== "done" || !controls || placed.current) return;
    placed.current = true;
    setAppState();
    controls.target.copy(sys.target);
    poseToPosition(sys, camera.position);
    camera.lookAt(sys.target);
    controls.update();
  }, [intro, controls, camera, sys]);

  // fly-to requests
  useEffect(() => {
    if (!controls || intro !== "done") return;
    if (cam.preset === "free") return;
    const to = presetPose(cam.preset, net, dem, cam.zone);
    flight.current = { t: 0, dur: cam.preset === "zone" ? 1.6 : 2.0, from: currentPose(camera, controls.target), to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam.nonce, controls]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = useStore.getState();
    if (!controls) return;
    // the map controls update (and clamp) the camera every frame; let them reach orbit during the opening
    controls.maxDistance = st.intro === "done" ? 70000 : Infinity;

    // ---- opening sequence
    if (st.intro === "playing") {
      if (frame.introT < 0) frame.introT = 0;
      frame.introT += dt;
      const t = frame.introT;
      introState(t);
      const p = introPose(t, sys);
      controls.enabled = false;
      controls.target.copy(p.target);
      poseToPosition(p, camera.position);
      camera.lookAt(p.target);
      if (t >= INTRO.END) {
        setAppState();
        controls.target.copy(sys.target);
        poseToPosition(sys, camera.position);
        controls.enabled = true;
        controls.update();
        st.endIntro();
      }
    } else if (st.intro === "pending") {
      controls.enabled = false;
      frame.outline = 0;
      frame.region = 1;
      frame.terrain = 0;
      frame.space = 1;
      frame.reveal = 0;
    } else if (flight.current) {
      // ---- fly-to
      const f = flight.current;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t);
      const lift = Math.sin(Math.PI * e) * 0.25; // rise slightly mid-flight for long moves
      const pose: Pose = {
        target: new THREE.Vector3().lerpVectors(f.from.target, f.to.target, e),
        r: Math.exp(THREE.MathUtils.lerp(Math.log(f.from.r), Math.log(f.to.r), e)) * (1 + lift * Math.min(1, f.from.target.distanceTo(f.to.target) / 6000)),
        polar: THREE.MathUtils.lerp(f.from.polar, f.to.polar, e),
        az: lerpAngle(f.from.az, f.to.az, e),
      };
      controls.enabled = false;
      controls.target.copy(pose.target);
      poseToPosition(pose, camera.position);
      camera.lookAt(pose.target);
      if (f.t >= 1) {
        flight.current = null;
        controls.enabled = !st.tour.running;
        controls.update();
      }
    } else {
      controls.enabled = !st.tour.running;
      // keep the focus inside the terrain
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -14000, 16000);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -14000, 14000);
    }

    // ---- keep the scene centred in the space the panels leave free
    let left = 0;
    let right = 0;
    let bottom = 108;
    const top = 72;
    if (st.intro === "done") {
      if (st.mode === "overview") {
        left = 428;
        if (st.selection) right = 428;
      } else if (st.mode === "alerts") right = 508;
      else if (st.mode === "forecast") bottom = 108 + Math.round(size.height * 0.42);
    } else {
      bottom = 0;
    }
    offset.current.x += ((right - left) / 2 - offset.current.x) * Math.min(1, dt * 3);
    offset.current.y += ((bottom - top) / 2 - offset.current.y) * Math.min(1, dt * 3);
    if (Math.abs(offset.current.x) > 0.5 || Math.abs(offset.current.y) > 0.5) {
      camera.setViewOffset(size.width, size.height, offset.current.x, offset.current.y, size.width, size.height);
    } else if (camera.view) {
      camera.clearViewOffset();
    }

    // ---- depth range follows altitude (from 900 km in orbit to a few hundred metres over the palms)
    const alt = Math.max(5, camera.position.y - dem.heightAt(controls.target.x, controls.target.z));
    frame.altitude = alt;
    const dist = camera.position.distanceTo(controls.target);
    camera.near = THREE.MathUtils.clamp(alt * 0.03, 0.5, 40000);
    camera.far = Math.max(90000, dist * 8, alt * 8);
    camera.updateProjectionMatrix();
  });

  return <MapControls makeDefault enableDamping dampingFactor={0.085} maxPolarAngle={1.32} minDistance={160} maxDistance={70000} zoomSpeed={0.9} screenSpacePanning={false} />;
}
