"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { frame, HAZE, hazeAt, SKY_TOP, SUN_COLOR, SUN_DIR } from "./frame";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec3 uTop;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uSpace;
  uniform float uCloud;
  uniform float uRain;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 top = mix(uTop, uHaze * 0.9, uCloud * 0.6 + uRain * 0.5);
    vec3 col = h >= 0.0 ? mix(uHaze, top, smoothstep(0.0, 0.6, h)) : uHaze * mix(1.0, 0.94, smoothstep(0.0, -0.3, h));
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(s, 10.0) * 0.18 + pow(s, 90.0) * 0.35 + pow(s, 1800.0) * 3.0) * (1.0 - uRain * 0.8);
    col *= 1.0 - uRain * 0.22;
    // above the atmosphere: deep space with a few stars
    float star = step(0.9985, hash(floor(d * 900.0))) * smoothstep(0.0, 0.4, h + 0.4);
    vec3 space = vec3(0.028, 0.025, 0.021) + star * 0.5;
    col = mix(col, space, uSpace);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function Sky() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHaze: { value: HAZE.clone() },
          uTop: { value: SKY_TOP.clone() },
          uSunDir: { value: SUN_DIR.clone() },
          uSunCol: { value: SUN_COLOR.clone() },
          uSpace: { value: 0 },
          uCloud: { value: 0 },
          uRain: { value: 0 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );

  useEffect(() => {
    scene.fog = new THREE.FogExp2(HAZE.clone(), 3.4e-5);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useFrame(() => {
    if (mesh.current) mesh.current.position.copy(camera.position);
    const u = material.uniforms;
    u.uSpace.value = frame.space;
    u.uCloud.value = frame.cloud;
    u.uRain.value = Math.min(1, frame.rain);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = 3.4e-5 * frame.haze * hazeAt(frame.altitude);
      scene.fog.color.copy(HAZE).multiplyScalar(1 - Math.min(1, frame.rain) * 0.15);
    }
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-100} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1000, 32, 16]} />
    </mesh>
  );
}

export function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    sun.current?.position.copy(SUN_DIR.clone().multiplyScalar(10000));
  }, []);
  useFrame(() => {
    if (sun.current) sun.current.intensity = 2.3 * (1 - Math.min(1, frame.rain) * 0.45) * (1 - frame.cloud * 0.25);
  });
  return (
    <>
      <hemisphereLight args={["#efe5d0", "#5e4f38", 1.05]} />
      <directionalLight ref={sun} color={SUN_COLOR} intensity={2.3} />
    </>
  );
}

/** Rain on forecast days that have it (Meteomatics precip_24h), around the camera's focus. */
export function Rain() {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const ref = useRef<THREE.LineSegments>(null);
  const N = 2600;
  const BOX = 2600;
  const HGT = 700;
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    const seeds = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
    return { geo: g, seeds };
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: "#efe6d6", transparent: true, opacity: 0, depthWrite: false }), []);
  useFrame(() => {
    const r = Math.min(1, frame.rain);
    mat.opacity = r * 0.38;
    if (!ref.current) return;
    ref.current.visible = r > 0.02;
    if (r <= 0.02) return;
    const c = controls?.target ?? new THREE.Vector3();
    const p = geo.attributes.position.array as Float32Array;
    const wx = frame.windDir.x * frame.wind * 6;
    const wz = frame.windDir.y * frame.wind * 6;
    for (let i = 0; i < N; i++) {
      const fall = (seeds[i * 3 + 2] * HGT - frame.t * 260 * (0.8 + seeds[i * 3] * 0.4)) % HGT;
      const y = c.y + (fall < 0 ? fall + HGT : fall);
      const x = c.x + (seeds[i * 3] - 0.5) * BOX;
      const z = c.z + (seeds[i * 3 + 1] - 0.5) * BOX;
      p.set([x, y, z, x + wx, y - 26, z + wz], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} raycast={() => null} />;
}
