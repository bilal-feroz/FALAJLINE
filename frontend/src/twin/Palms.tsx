"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useScenario, useStore } from "@/lib/store";
import type { Dem } from "./dem";
import { frame, SUN_DIR } from "./frame";
import { seeded } from "./geo";

export interface Palm {
  x: number;
  z: number;
  s: number; // canopy confidence 0..1 (from the imagery)
  zone: number;
}

const TRUNK_H = 9.5;
const MAX_PALMS = 9000;

function frondTexture() {
  const W = 64;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.lineCap = "round";
  // leaflets in pairs, angled towards the tip, shorter near the base and the tip
  for (let y = H - 20; y > 10; y -= 7) {
    const t = 1 - y / H;
    const len = 30 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)), 0.7);
    const shade = 60 + 40 * t;
    g.strokeStyle = `rgb(${70 + shade * 0.25}, ${92 + shade * 0.45}, ${46 + shade * 0.12})`;
    g.lineWidth = 3.2;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(W / 2, y);
      g.lineTo(W / 2 + side * len, y - len * 0.75);
      g.stroke();
    }
  }
  g.strokeStyle = "rgb(150, 140, 95)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 4);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.65)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function crownGeometry() {
  const rand = seeded(7);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const fronds = 14;
  const segs = 5;
  for (let f = 0; f < fronds; f++) {
    const az = (f / fronds) * Math.PI * 2 + rand() * 0.35;
    const ring = f % 3;
    const elev = ring === 0 ? 0.95 : ring === 1 ? 0.42 : -0.12;
    const L = 4.1 + rand() * 0.9;
    const droop = ring === 2 ? 1.4 : 1.1;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = L * t * Math.cos(elev);
      const h = L * t * Math.sin(elev) - droop * t * t;
      const w = 0.78 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.06));
      const cx = dx * r;
      const cz = dz * r;
      const cy = TRUNK_H + 0.2 + h;
      const fold = 0.16 * w;
      pos.push(cx - dz * w, cy + fold, cz + dx * w, cx + dz * w, cy + fold, cz - dx * w);
      uv.push(0, t, 1, t);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sway (world space, after the instance transform) and the growth reveal used by the opening sequence. */
function animate(material: THREE.Material, uniforms: Record<string, THREE.IUniform>, strength: number) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aGrow;
        uniform float uTime;
        uniform float uWindAmp;
        uniform vec2 uWindDir;
        uniform float uReveal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float g = clamp((uReveal * 1.35 - aGrow) / 0.35, 0.0, 1.0);
        g = g * g * (3.0 - 2.0 * g);
        float hNorm = max(transformed.y, 0.0) / ${TRUNK_H.toFixed(1)};
        transformed *= g;`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float ph = instanceMatrix[3][0] * 0.013 + instanceMatrix[3][2] * 0.021;
        #else
          float ph = 0.0;
        #endif
        float sway = uWindAmp * hNorm * hNorm * (0.55 * sin(uTime * 1.35 + ph) + 0.3 * sin(uTime * 2.7 + ph * 1.7) + 0.55);
        float flutter = ${strength.toFixed(2)} * uWindAmp * 0.35 * hNorm * sin(uTime * 7.0 + position.x * 3.1 + position.z * 2.3 + ph);
        mvPosition.xz += uWindDir * (sway + flutter);
        mvPosition.y += flutter * 0.4;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
}

export function Palms({ palms, dem, growOrigin }: { palms: Palm[]; dem: Dem; growOrigin: [number, number] }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const blobs = useRef<THREE.InstancedMesh>(null);
  const sc = useScenario();
  const day = useStore((s) => s.day);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uWindAmp: { value: 0.25 }, uWindDir: { value: new THREE.Vector2(0.6, 0.8) }, uReveal: { value: 1 } }),
    [],
  );

  const list = useMemo(() => {
    if (palms.length <= MAX_PALMS) return palms;
    const rand = seeded(11);
    return palms.filter(() => rand() < MAX_PALMS / palms.length);
  }, [palms]);

  const { trunkGeo, crownGeo, blobGeo, trunkMat, crownMat, blobMat } = useMemo(() => {
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.33, TRUNK_H, 6, 3, true);
    trunkGeo.translate(0, TRUNK_H / 2, 0);
    const crownGeo = crownGeometry();
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#6f5a40", roughness: 1, flatShading: true });
    const crownMat = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82 });
    const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: "#120c06", transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    animate(trunkMat, uniforms, 0.2);
    animate(crownMat, uniforms, 1);
    // shadows grow with the palms
    blobMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aGrow;\nuniform float uReveal;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nfloat g = clamp((uReveal * 1.35 - aGrow) / 0.35, 0.0, 1.0);\ntransformed *= g * g * (3.0 - 2.0 * g);",
        );
    };
    return { trunkGeo, crownGeo, blobGeo, trunkMat, crownMat, blobMat };
  }, [uniforms]);

  // instance transforms, growth order (outwards from where the falaj surfaces) and shadow placement
  useEffect(() => {
    const n = list.length;
    const rand = seeded(23);
    const grow = new Float32Array(n);
    const dummy = new THREE.Object3D();
    const shadowDir = new THREE.Vector2(-SUN_DIR.x, -SUN_DIR.z).normalize();
    const shadowLen = TRUNK_H / Math.tan(Math.asin(SUN_DIR.y));
    let maxD = 1;
    for (const p of list) maxD = Math.max(maxD, Math.hypot(p.x - growOrigin[0], p.z - growOrigin[1]));
    list.forEach((p, i) => {
      const y = dem.heightAt(p.x, p.z);
      const s = 0.72 + rand() * 0.45 + p.s * 0.12;
      grow[i] = (Math.hypot(p.x - growOrigin[0], p.z - growOrigin[1]) / maxD) * 0.85 + rand() * 0.15;
      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      trunks.current?.setMatrixAt(i, dummy.matrix);
      crowns.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + shadowDir.x * shadowLen * 0.55 * s, y + 0.35, p.z + shadowDir.y * shadowLen * 0.55 * s);
      dummy.rotation.set(0, -Math.atan2(shadowDir.y, shadowDir.x), 0);
      dummy.scale.set(shadowLen * 0.95 * s, 1, 5.6 * s);
      dummy.updateMatrix();
      blobs.current?.setMatrixAt(i, dummy.matrix);
    });
    for (const m of [trunks.current, crowns.current, blobs.current]) {
      if (!m) continue;
      m.count = n;
      m.geometry.setAttribute("aGrow", new THREE.InstancedBufferAttribute(grow, 1));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [list, dem, growOrigin]);

  // canopy colour: natural variation, drying where the zone's supply falls below demand on the selected day
  useEffect(() => {
    const mesh = crowns.current;
    if (!mesh || !sc) return;
    const rand = seeded(5);
    const c = new THREE.Color();
    const dry = new THREE.Color(1.25, 0.98, 0.52);
    const white = new THREE.Color(1, 1, 1);
    list.forEach((p, i) => {
      const z = sc.zones[p.zone];
      const ratio = z ? z.ratio.central[day] : 1;
      const stress = Math.min(1, Math.max(0, (1.02 - ratio) / 0.18));
      const v = 0.82 + rand() * 0.3;
      c.copy(white).multiplyScalar(v).lerp(dry, stress * 0.7);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [list, sc, day]);

  useFrame(() => {
    uniforms.uTime.value = frame.t;
    uniforms.uWindAmp.value = 0.14 + 0.075 * frame.wind;
    uniforms.uWindDir.value.copy(frame.windDir);
    uniforms.uReveal.value = frame.reveal;
  });

  if (!list.length) return null;
  return (
    <group>
      <instancedMesh ref={blobs} args={[blobGeo, blobMat, list.length]} frustumCulled={false} renderOrder={1} raycast={() => null} />
      <instancedMesh ref={trunks} args={[trunkGeo, trunkMat, list.length]} frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={crowns} args={[crownGeo, crownMat, list.length]} frustumCulled={false} raycast={() => null} />
    </group>
  );
}
