"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RISK_COLOR } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Dem } from "./dem";
import { frame, HAZE, hazeAt, SUN_COLOR, SUN_DIR } from "./frame";
import { ELEV0, HALF } from "./geo";
import { CORE, FAR, NEAR, uvOf, type Mosaic } from "./imagery";
import { FOCUS_RECT, focusTexture, ZONE_DIST_MAX, ZONE_RECT, zoneTextures } from "./masks";
import type { Net } from "./net";

const NV = 420; // vertices per side; spacing warps from ~25 m at the oasis to ~300 m at the edge
const WARP = 0.2;

function warp(u: number) {
  return HALF * (WARP * u + (1 - WARP) * u * u * u);
}

function buildGeometry(dem: Dem) {
  const n = NV * NV;
  const pos = new Float32Array(n * 3);
  const uvF = new Float32Array(n * 2);
  const uvN = new Float32Array(n * 2);
  const uvC = new Float32Array(n * 2);
  for (let j = 0; j < NV; j++) {
    const z = warp(-1 + (2 * j) / (NV - 1));
    for (let i = 0; i < NV; i++) {
      const x = warp(-1 + (2 * i) / (NV - 1));
      const k = j * NV + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = dem.heightAt(x, z);
      pos[k * 3 + 2] = z;
      uvF.set(uvOf(FAR, x, z), k * 2);
      uvN.set(uvOf(NEAR, x, z), k * 2);
      uvC.set(uvOf(CORE, x, z), k * 2);
    }
  }
  const idx = new Uint32Array((NV - 1) * (NV - 1) * 6);
  let p = 0;
  for (let j = 0; j < NV - 1; j++)
    for (let i = 0; i < NV - 1; i++) {
      const a = j * NV + i;
      idx[p++] = a;
      idx[p++] = a + NV;
      idx[p++] = a + 1;
      idx[p++] = a + 1;
      idx[p++] = a + NV;
      idx[p++] = a + NV + 1;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uvFar", new THREE.BufferAttribute(uvF, 2));
  g.setAttribute("uvNear", new THREE.BufferAttribute(uvN, 2));
  g.setAttribute("uvCore", new THREE.BufferAttribute(uvC, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([184, 162, 127, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
})();
const blank = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const vertexShader = /* glsl */ `
  attribute vec2 uvFar;
  attribute vec2 uvNear;
  attribute vec2 uvCore;
  varying vec2 vUvFar;
  varying vec2 vUvNear;
  varying vec2 vUvCore;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUvFar = uvFar;
    vUvNear = uvNear;
    vUvCore = uvCore;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tFar;
  uniform sampler2D tNear;
  uniform sampler2D tCore;
  uniform sampler2D tZone;
  uniform sampler2D tZoneDist;
  uniform sampler2D tFocus;
  uniform float uNearOn;
  uniform float uCoreOn;
  uniform vec4 uZoneRect;
  uniform vec4 uFocusRect;
  uniform float uZoneDistMax;
  uniform vec4 uZoneCol[6];
  uniform float uSel;
  uniform float uHover;
  uniform float uZoneReveal;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uFogCol;
  uniform float uFogDen;
  uniform float uTime;
  uniform float uCloud;
  uniform vec2 uWind;
  uniform float uOpacity;
  uniform float uHalf;
  uniform float uZonesOn;
  uniform float uGrade;
  uniform float uElev0;
  uniform vec3 uDuoDark;
  uniform vec3 uDuoLight;
  uniform vec3 uInk;
  varying vec2 vUvFar;
  varying vec2 vUvNear;
  varying vec2 vUvCore;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  float inside(vec2 uv) {
    vec2 e = smoothstep(vec2(0.0), vec2(0.09), uv) * smoothstep(vec2(1.0), vec2(0.91), uv);
    return e.x * e.y;
  }
  float zoneAt(vec2 uv) { return floor(texture2D(tZone, uv).r * 255.0 / 32.0 + 0.5); }
  float contour(float h, float interval, float width, float fadeA, float fadeB) {
    float c = h / interval;
    float w = fwidth(c);
    float l = 1.0 - smoothstep(0.0, w * width, abs(fract(c - 0.5) - 0.5));
    return l * (1.0 - smoothstep(fadeA, fadeB, w));
  }

  void main() {
    vec3 col = texture2D(tFar, vUvFar).rgb;
    col = mix(col, texture2D(tNear, vUvNear).rgb, uNearOn * inside(vUvNear));
    col = mix(col, texture2D(tCore, vUvCore).rgb, uCoreOn * inside(vUvCore));

    // the system keeps its true colour; the rest of the map is printed in ink on cream, like an atlas,
    // from a softened copy of the imagery so the city reads as texture rather than detail
    vec2 fuv = (vWorld.xz - uFocusRect.xy) / (uFocusRect.zw - uFocusRect.xy);
    fuv.y = 1.0 - fuv.y;
    float focus = 0.0;
    if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) focus = smoothstep(0.04, 0.6, texture2D(tFocus, fuv).r);
    vec3 soft = texture2D(tFar, vUvFar, 1.0).rgb;
    soft = mix(soft, texture2D(tNear, vUvNear, 1.6).rgb, uNearOn * inside(vUvNear));
    float l = dot(soft, vec3(0.2126, 0.7152, 0.0722));
    float p = pow(max(l, 0.0), 0.4545);
    vec3 duo = mix(uDuoDark, uDuoLight, smoothstep(0.1, 0.92, p));
    float lc = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 nat = max(mix(vec3(lc), col, 1.2), vec3(0.0));
    nat = pow(nat, vec3(1.06)) * vec3(1.04, 1.0, 0.94);
    float g = uGrade * (1.0 - focus);
    col = mix(nat, duo, g);

    // contour lines from the elevation model: 10 m, with an index line every 50 m
    float hgt = vWorld.y + uElev0;
    float lines = max(contour(hgt, 10.0, 1.0, 0.1, 0.3) * 0.13, contour(hgt, 50.0, 1.4, 0.12, 0.34) * 0.3);
    col = mix(col, uInk, lines * g);

    // farm zones: a glow along each border in the zone's risk colour, strongest where supply falls short
    vec2 zuv = (vWorld.xz - uZoneRect.xy) / (uZoneRect.zw - uZoneRect.xy);
    zuv.y = 1.0 - zuv.y;
    if (uZonesOn > 0.5 && zuv.x > 0.0 && zuv.x < 1.0 && zuv.y > 0.0 && zuv.y < 1.0) {
      float zid = zoneAt(zuv);
      if (zid > 0.5) {
        vec4 zc = vec4(0.0);
        for (int k = 0; k < 6; k++) { if (abs(float(k + 1) - zid) < 0.5) zc = uZoneCol[k]; }
        bool sel = abs(zid - (uSel + 1.0)) < 0.5;
        bool hov = abs(zid - (uHover + 1.0)) < 0.5;
        float dm = texture2D(tZoneDist, zuv).r * uZoneDistMax;
        float camD = distance(vWorld, cameraPosition);
        float gw = clamp(camD * 0.0055, 6.0, 38.0);
        float glow = exp(-dm / gw);
        float a = zc.a * glow;
        if (sel) a = max(a, 0.95 * glow) + 0.07;
        if (hov) a += 0.05;
        // mix in perceptual space: over dark canopy a linear mix would read far stronger than intended
        vec3 cs = sqrt(max(col, vec3(0.0)));
        col = pow(mix(cs, sqrt(zc.rgb), clamp(a, 0.0, 0.9) * uZoneReveal), vec3(2.0));
      }
    }

    // relief on top of the photo, so Jebel Hafeet and the wadis read in 3D
    vec3 n = normalize(vNormal);
    float ndl = max(dot(n, uSunDir), 0.0);
    float rim = 1.0 - n.y;
    vec3 lit = col * mix(0.7 + 0.48 * ndl * uSunCol - 0.2 * rim, vec3(0.86 + 0.3 * ndl - 0.22 * rim), g);

    // drifting cloud shadows, scaled by the forecast cloud cover
    if (uCloud > 0.03) {
      float c = fbm((vWorld.xz + uWind * uTime * 9.0) / 2300.0);
      float shade = smoothstep(0.62 - uCloud * 0.35, 0.86 - uCloud * 0.25, c);
      lit *= 1.0 - 0.3 * shade * min(1.0, uCloud * 1.6);
    }

    // aerial perspective
    float d = distance(vWorld, cameraPosition);
    float fog = 1.0 - exp(-pow(d * uFogDen, 2.0));
    lit = mix(lit, uFogCol, fog);
    lit = min(lit, vec3(0.96)); // the ground never blooms; only the water and the instruments do

    float r = length(vWorld.xz) / uHalf;
    float alpha = uOpacity * smoothstep(1.0, 0.72, r);
    gl_FragColor = vec4(lit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const linear = (hex: string) => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

export const terrainUniforms = {
  tFar: { value: placeholder as THREE.Texture },
  tNear: { value: placeholder as THREE.Texture },
  tCore: { value: placeholder as THREE.Texture },
  tZone: { value: blank as THREE.Texture },
  tZoneDist: { value: blank as THREE.Texture },
  tFocus: { value: blank as THREE.Texture },
  uNearOn: { value: 0 },
  uCoreOn: { value: 0 },
  uZoneRect: { value: new THREE.Vector4(ZONE_RECT.x0, ZONE_RECT.z0, ZONE_RECT.x1, ZONE_RECT.z1) },
  uFocusRect: { value: new THREE.Vector4(FOCUS_RECT.x0, FOCUS_RECT.z0, FOCUS_RECT.x1, FOCUS_RECT.z1) },
  uZoneDistMax: { value: ZONE_DIST_MAX },
  uZoneCol: { value: Array.from({ length: 6 }, () => new THREE.Vector4(1, 1, 1, 0)) },
  uSel: { value: -1 },
  uHover: { value: -1 },
  uZoneReveal: { value: 1 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunCol: { value: new THREE.Vector3(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b) },
  uFogCol: { value: new THREE.Vector3(HAZE.r, HAZE.g, HAZE.b) },
  uFogDen: { value: 3.6e-5 },
  uTime: { value: 0 },
  uCloud: { value: 0.1 },
  uWind: { value: new THREE.Vector2(0.6, 0.8) },
  uOpacity: { value: 1 },
  uHalf: { value: HALF },
  uZonesOn: { value: 1 },
  uGrade: { value: 0 },
  uElev0: { value: ELEV0 },
  uDuoDark: { value: linear("#6b5a43") },
  uDuoLight: { value: linear("#f7eedb") },
  uInk: { value: linear("#2a2219") },
};

/** How strongly each risk level glows along the zone border. */
const GLOW = { NORMAL: 0.35, WATCH: 0.55, PREPARE: 0.7, ACT: 0.85 } as const;

export function Terrain({ dem, mosaics, net }: { dem: Dem; mosaics: Partial<Record<"far" | "near" | "core", Mosaic>>; net: Net }) {
  const geometry = useMemo(() => buildGeometry(dem), [dem]);
  const gl = useThree((s) => s.gl);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: terrainUniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: true,
      }),
    [],
  );
  const sc = useScenario();
  const nearFade = useRef(0);
  const coreFade = useRef(0);
  const day = useStore((s) => s.day);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);

  useEffect(() => {
    const max = gl.capabilities.getMaxAnisotropy();
    for (const m of Object.values(mosaics)) if (m) m.texture.anisotropy = Math.min(8, max);
    if (mosaics.far) terrainUniforms.tFar.value = mosaics.far.texture;
    if (mosaics.near) terrainUniforms.tNear.value = mosaics.near.texture;
    if (mosaics.core) terrainUniforms.tCore.value = mosaics.core.texture;
  }, [mosaics, gl]);

  useEffect(() => {
    const { idTex, distTex } = zoneTextures(net.zones.map((z) => z.poly));
    const focus = focusTexture(net);
    terrainUniforms.tZone.value = idTex;
    terrainUniforms.tZoneDist.value = distTex;
    terrainUniforms.tFocus.value = focus;
    return () => {
      idTex.dispose();
      distTex.dispose();
      focus.dispose();
    };
  }, [net]);

  // zone glow follows the risk state of the selected day
  useEffect(() => {
    if (!sc) return;
    sc.zones.forEach((z, i) => {
      const c = new THREE.Color(RISK_COLOR[z.risk[day]]);
      const short = z.ratio.central[day] < sc.required_supply_ratio;
      terrainUniforms.uZoneCol.value[i].set(c.r, c.g, c.b, short ? 0.9 : GLOW[z.risk[day]]);
    });
  }, [sc, day]);

  useEffect(() => {
    const ids = sc?.zones.map((z) => z.id) ?? [];
    terrainUniforms.uSel.value = selection?.type === "zone" ? ids.indexOf(selection.id) : -1;
    terrainUniforms.uHover.value = hover ? ids.indexOf(hover) : -1;
  }, [selection, hover, sc]);

  useFrame((_, dt) => {
    const u = terrainUniforms;
    u.uTime.value = frame.t;
    u.uCloud.value = frame.cloud;
    u.uWind.value.copy(frame.windDir).multiplyScalar(Math.max(0.6, frame.wind));
    u.uOpacity.value = frame.terrain;
    u.uFogDen.value = 3.4e-5 * frame.haze * hazeAt(frame.altitude);
    u.uGrade.value = 0.9 * THREE.MathUtils.smoothstep(frame.reveal, 0.0, 0.55);
    u.uZoneReveal.value = THREE.MathUtils.smoothstep(frame.reveal, 0.5, 0.85);
    // the sharper mosaics only matter close up; from high above they would show as patches
    const nearAlt = 1 - THREE.MathUtils.smoothstep(frame.altitude, 18000, 34000);
    const coreAlt = 1 - THREE.MathUtils.smoothstep(frame.altitude, 7000, 14000);
    nearFade.current = Math.min(1, nearFade.current + (mosaics.near ? dt * 1.2 : 0));
    coreFade.current = Math.min(1, coreFade.current + (mosaics.core ? dt * 1.2 : 0));
    u.uNearOn.value = nearFade.current * nearAlt;
    u.uCoreOn.value = coreFade.current * coreAlt;
  });

  return <mesh geometry={geometry} material={material} renderOrder={-5} raycast={() => null} frustumCulled={false} />;
}
