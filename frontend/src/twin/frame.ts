import * as THREE from "three";

/**
 * Mutable per-frame state shared by the 3D components. React holds targets (the forecast for the selected
 * day, the weather for that day); these values ease toward them every frame so scrubbing the timeline
 * moves water, flow and weather smoothly instead of snapping.
 */
export const frame = {
  t: 0,
  // simulation (eased)
  head: 1,
  head0: 1,
  flow: { main: 1, A: 1, B: 1, C: 1 } as Record<string, number>,
  zone: {} as Record<string, number>, // supply / demand ratio
  // weather for the selected day (eased)
  wind: 2,
  windDir: new THREE.Vector2(0.6, 0.8), // direction the wind blows TOWARDS, in the x/z plane
  cloud: 0.1,
  rain: 0,
  haze: 1,
  // opening sequence
  introT: -1,
  reveal: 1, // 0..1 how much of the system is drawn (falaj, palms, gauges)
  outline: 1, // 0..1 how much of the UAE outline is drawn
  region: 0, // opacity of the regional map
  terrain: 1, // opacity of the satellite terrain
  space: 0, // 0 = atmosphere, 1 = black space
  altitude: 0,
  // recording moves, in radians a second and fraction of the distance a second (0 = still)
  orbit: 0,
  dolly: 0,
  flightTime: 0, // seconds for camera flights; 0 = the interface's own pace
  targets: {
    head: 1,
    head0: 1,
    flow: { main: 1, A: 1, B: 1, C: 1 } as Record<string, number>,
    zone: {} as Record<string, number>,
    wind: 2,
    windDir: new THREE.Vector2(0.6, 0.8),
    cloud: 0.1,
    rain: 0,
    haze: 1,
  },
};

export function easeFrame(dt: number) {
  const k = 1 - Math.exp(-dt * 3.2);
  const T = frame.targets;
  frame.head += (T.head - frame.head) * k;
  frame.head0 = T.head0;
  for (const key of Object.keys(T.flow)) frame.flow[key] = (frame.flow[key] ?? T.flow[key]) + (T.flow[key] - (frame.flow[key] ?? T.flow[key])) * k;
  for (const key of Object.keys(T.zone)) frame.zone[key] = (frame.zone[key] ?? T.zone[key]) + (T.zone[key] - (frame.zone[key] ?? T.zone[key])) * k;
  frame.wind += (T.wind - frame.wind) * k * 0.6;
  frame.windDir.lerp(T.windDir, k * 0.5).normalize();
  frame.cloud += (T.cloud - frame.cloud) * k * 0.6;
  frame.rain += (T.rain - frame.rain) * k;
  frame.haze += (T.haze - frame.haze) * k * 0.6;
}

/** Haze only near the ground: crisp from orbit, aerial perspective below ~50 km. */
export function hazeAt(altitude: number) {
  const t = Math.min(1, Math.max(0, (altitude - 18000) / (55000 - 18000)));
  return 1 - t * t * (3 - 2 * t);
}

/** Fixed, art-directed late-afternoon sun from the west-south-west: long shadows towards the east-north-east. */
export const SUN_DIR = new THREE.Vector3(-0.78, 0.42, 0.46).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.86, 0.68);
export const HAZE = new THREE.Color("#ddd0b4");
export const SKY_TOP = new THREE.Color("#9ba3a3");
