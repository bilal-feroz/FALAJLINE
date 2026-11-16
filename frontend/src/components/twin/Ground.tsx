"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { anim } from "./anim";
import { BEDROCK_TOP, CUT_X, FLOOR, INV_WELL, HEAD_SCALE, WELL_X, WT_GRADIENT, X0, X1, Z0, Z1, fbm, ground, smoothstep, waterTable } from "./layout";

const SAND = new THREE.Color("#c9ae7c");
const SAND_DARK = new THREE.Color("#a08355");
const ROCK = new THREE.Color("#7b6f60");
const SOIL = new THREE.Color("#6b5a41");

function terrainGeometry(x0: number, x1: number, z0: number, z1: number): THREE.BufferGeometry {
  const nx = Math.round(x1 - x0);
  const nz = Math.round(z1 - z0);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      const y = ground(x, z);
      pos.push(x, y, z);
      const grain = fbm(x * 0.35, z * 0.35);
      c.copy(SAND_DARK).lerp(SAND, grain);
      c.lerp(ROCK, smoothstep(6, 13, y) * 0.8); // foothills
      c.lerp(SOIL, smoothstep(CUT_X - 2, CUT_X + 10, x) * 0.75); // darker, worked ground of the oasis
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical face from the ground surface down to bedrock along a straight line in plan. */
function wallGeometry(ax: number, az: number, bx: number, bz: number): THREE.BufferGeometry {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.round(len));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    pos.push(x, ground(x, z), z, x, BEDROCK_TOP, z);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Cut faces show the geology: alluvial gravels over bedrock, the saturated zone tinted below the water
// table, the water table itself as a bright line, and today's level as a faint dashed reference.
const strataUniforms = {
  uHead: { value: 1.0 },
  uHead0: { value: 1.0 },
  uWellX: { value: WELL_X },
  uInv: { value: INV_WELL },
  uScale: { value: HEAD_SCALE },
  uGrad: { value: WT_GRADIENT },
  uLight: { value: new THREE.Vector3(-0.35, 0.6, 0.72).normalize() },
};

const strataMaterial = new THREE.ShaderMaterial({
  uniforms: strataUniforms,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormal;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNormal;
    uniform float uHead, uHead0, uWellX, uInv, uScale, uGrad;
    uniform vec3 uLight;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      float along = vWorld.x + vWorld.z;
      float y = vWorld.y;
      float warp = noise(vec2(along * 0.08, y * 0.3)) * 2.2;
      float bands = noise(vec2(along * 0.05, (y + warp) * 1.6));
      float pebbles = noise(vec2(along * 2.2, y * 2.2));
      vec3 upper = vec3(0.66, 0.54, 0.37);
      vec3 lower = vec3(0.38, 0.31, 0.23);
      vec3 col = mix(lower, upper, smoothstep(-17.0, 6.0, y));
      col *= 0.78 + 0.26 * bands + 0.10 * pebbles;

      float wt = uInv + uHead * uScale - uGrad * (vWorld.x - uWellX);
      float wt0 = uInv + uHead0 * uScale - uGrad * (vWorld.x - uWellX);
      float sat = smoothstep(wt + 0.04, wt - 0.5, y);
      vec3 wet = col * vec3(0.34, 0.70, 0.86) + vec3(0.00, 0.05, 0.075);
      col = mix(col, wet, sat * 0.88);
      float line = 1.0 - smoothstep(0.0, 0.13, abs(y - wt));
      col += vec3(0.25, 0.85, 0.82) * line * 0.9;
      float dash = step(0.5, fract(along * 0.45));
      float ref = (1.0 - smoothstep(0.0, 0.07, abs(y - wt0))) * dash * step(0.12, abs(wt0 - wt));
      col += vec3(0.80, 0.72, 0.55) * ref * 0.6;

      float lit = 0.62 + 0.38 * max(dot(normalize(vNormal), uLight), 0.0);
      gl_FragColor = vec4(col * lit, 1.0);
    }
  `,
});

/** Translucent groundwater body shown where the block is cut away. Its top is the water table. */
function GroundwaterBody() {
  const K = 44;
  const { body, surface, edge } = useMemo(() => {
    const bodyPos = new Float32Array((K + 1) * 2 * 3 + 4 * 3);
    const bodyIdx: number[] = [];
    for (let i = 0; i < K; i++) {
      const a = i * 2;
      bodyIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); // front face at z = Z1
    }
    const cap = (K + 1) * 2;
    bodyIdx.push(cap, cap + 1, cap + 2, cap + 2, cap + 1, cap + 3); // end face at x = X0
    const b = new THREE.BufferGeometry();
    b.setAttribute("position", new THREE.BufferAttribute(bodyPos, 3));
    b.setIndex(bodyIdx);

    const surfPos = new Float32Array((K + 1) * 2 * 3);
    const surfIdx: number[] = [];
    for (let i = 0; i < K; i++) {
      const a = i * 2;
      surfIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const s = new THREE.BufferGeometry();
    s.setAttribute("position", new THREE.BufferAttribute(surfPos, 3));
    s.setIndex(surfIdx);
    // a bright rim where the water surface meets the open faces, so the level reads at a glance
    const e = new THREE.BufferGeometry();
    e.setAttribute("position", new THREE.BufferAttribute(new Float32Array((K + 1) * 2 * 3), 3));
    e.setIndex(surfIdx);
    return { body: b, surface: s, edge: e };
  }, []);
  const last = useRef(-1);

  useFrame(() => {
    if (Math.abs(anim.head - last.current) < 1e-4) return;
    last.current = anim.head;
    const bp = body.attributes.position.array as Float32Array;
    const sp = surface.attributes.position.array as Float32Array;
    const ep = edge.attributes.position.array as Float32Array;
    for (let i = 0; i <= K; i++) {
      const x = X0 + ((CUT_X - X0) * i) / K;
      const y = Math.min(waterTable(x, anim.head), ground(x, 0) - 0.4);
      bp.set([x, y, Z1, x, BEDROCK_TOP, Z1], i * 6);
      sp.set([x, y, 0.02, x, y, Z1], i * 6);
      ep.set([x, y + 0.02, Z1 - 0.3, x, y + 0.02, Z1], i * 6);
    }
    edge.attributes.position.needsUpdate = true;
    edge.computeBoundingSphere();
    const yEnd = Math.min(waterTable(X0, anim.head), ground(X0, 0) - 0.4);
    bp.set([X0, yEnd, 0.02, X0, BEDROCK_TOP, 0.02, X0, yEnd, Z1, X0, BEDROCK_TOP, Z1], (K + 1) * 6);
    body.attributes.position.needsUpdate = true;
    surface.attributes.position.needsUpdate = true;
    body.computeBoundingSphere();
    surface.computeBoundingSphere();
  });

  return (
    <group>
      <mesh geometry={body} renderOrder={2}>
        <meshBasicMaterial color="#1a6f86" transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={surface} renderOrder={3}>
        <meshBasicMaterial color="#3fc4c9" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={edge} renderOrder={4}>
        <meshBasicMaterial color="#8ef0e6" transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Ground({ underground, surface, onSelectSource }: { underground: boolean; surface: boolean; onSelectSource: () => void }) {
  const geo = useMemo(
    () => ({
      slope: terrainGeometry(X0, CUT_X, Z0, 0),
      oasis: terrainGeometry(CUT_X, X1, Z0, Z1),
      lid: terrainGeometry(X0, CUT_X, 0, Z1),
      walls: [
        wallGeometry(X0, Z0, X1, Z0),
        wallGeometry(X1, Z0, X1, Z1),
        wallGeometry(X1, Z1, CUT_X, Z1),
        wallGeometry(X0, 0, X0, Z0),
      ],
      section: wallGeometry(X0, 0, CUT_X, 0), // the cut along the falaj
      sectionSide: wallGeometry(CUT_X, 0, CUT_X, Z1),
      lidWalls: [wallGeometry(CUT_X, Z1, X0, Z1), wallGeometry(X0, Z1, X0, 0)],
    }),
    [],
  );

  useFrame(() => {
    strataUniforms.uHead.value = anim.head;
    strataUniforms.uHead0.value = anim.head0;
  });

  const top = <meshStandardMaterial vertexColors flatShading roughness={1} metalness={0} transparent={!surface} opacity={surface ? 1 : 0.22} depthWrite={surface} />;

  return (
    <group>
      <mesh geometry={geo.slope} receiveShadow>
        {top}
      </mesh>
      <mesh geometry={geo.oasis} receiveShadow>
        {top}
      </mesh>
      {geo.walls.map((g, i) => (
        <mesh key={i} geometry={g} material={strataMaterial} />
      ))}

      {underground ? (
        <>
          <mesh
            geometry={geo.section}
            material={strataMaterial}
            onClick={(e) => {
              e.stopPropagation();
              onSelectSource();
            }}
          />
          <mesh geometry={geo.sectionSide} material={strataMaterial} />
          <GroundwaterBody />
        </>
      ) : (
        <>
          <mesh geometry={geo.lid} receiveShadow>
            {top}
          </mesh>
          {geo.lidWalls.map((g, i) => (
            <mesh key={i} geometry={g} material={strataMaterial} />
          ))}
        </>
      )}

      {/* bedrock */}
      <mesh position={[(X0 + X1) / 2, (BEDROCK_TOP + FLOOR) / 2, (Z0 + Z1) / 2]}>
        <boxGeometry args={[X1 - X0, BEDROCK_TOP - FLOOR, Z1 - Z0]} />
        <meshStandardMaterial color="#17191b" roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}
