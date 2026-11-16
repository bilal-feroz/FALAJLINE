"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useState } from "react";
import { useScenario, useStore } from "@/lib/store";
import { CameraRig } from "./CameraRig";
import { loadDem, type Dem } from "./dem";
import { easeFrame, frame } from "./frame";
import { distanceToPolyline, pointInPolygon, seeded } from "./geo";
import { Gauges } from "./Gauges";
import { canopyPoints, CORE, FAR, loadMosaic, NEAR, type Mosaic } from "./imagery";
import { LabelLayer, LabelProjector } from "./Labels";
import { EadWells, Sensors } from "./Markers";
import { Network } from "./Network";
import { buildNet, type Net } from "./net";
import { Palms, type Palm } from "./Palms";
import { Region } from "./Region";
import { buildProfile } from "./section";
import { Lights, Rain, Sky } from "./Sky";
import { Terrain, terrainUniforms } from "./Terrain";

/** Eases the twin toward the forecast and weather of the selected day. */
function FrameDriver() {
  const data = useStore((s) => s.data);
  const sc = useScenario();
  const day = useStore((s) => s.day);
  useEffect(() => {
    if (!data || !sc) return;
    const base = data.scenarios.baseline;
    const T = frame.targets;
    T.head = sc.source.head_m.central[day];
    T.head0 = sc.source.head_m.central[0];
    T.flow = { main: sc.main.flow_lps.central[day] / base.main.flow_lps.central[0] };
    sc.branches.forEach((b, i) => (T.flow[b.id] = b.flow_lps[day] / base.branches[i].flow_lps[0]));
    T.zone = Object.fromEntries(sc.zones.map((z) => [z.id, z.ratio.central[day]]));
    const w = data.weather.locations.find((l) => l.id === "oasis")?.daily.find((d) => d.date === sc.dates[day]);
    T.wind = w?.wind_mean_ms ?? 2.5;
    if (w?.wind_dir_deg !== null && w?.wind_dir_deg !== undefined) {
      const r = (w.wind_dir_deg * Math.PI) / 180;
      T.windDir.set(-Math.sin(r), Math.cos(r)); // the wind blows towards dir + 180°
    }
    T.cloud = Math.min(1, (w?.cloud_pct ?? 10) / 100);
    T.rain = w?.precip_mm && w.precip_mm >= 0.2 ? Math.min(1, 0.35 + w.precip_mm / 3) : 0;
    T.haze = 0.85 + Math.max(0, ((w?.rh_mean_pct ?? 45) - 40) / 80);
    if (!frame.zone[sc.zones[0].id]) {
      frame.head = T.head;
      frame.zone = { ...T.zone };
      frame.flow = { ...T.flow };
    }
  }, [data, sc, day]);
  useFrame((_, dt) => {
    frame.t += Math.min(dt, 0.1);
    easeFrame(Math.min(dt, 0.1));
  });
  return null;
}

/** Debug and recording hook: the live camera next to the frame state. */
function ExposeCamera() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const w = window as unknown as { __falaj?: Record<string, unknown> };
    if (w.__falaj) w.__falaj.camera = camera;
  }, [camera]);
  return null;
}

/** An invisible ground plane for hover and picking: zones, channels, the divider, the source. */
function PickPlane({ net }: { net: Net }) {
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const zoneAt = (x: number, z: number) => net.zones.find((q) => pointInPolygon(x, z, q.poly))?.id ?? null;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[3000, 0, 0]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (useStore.getState().intro !== "done") return;
        const id = zoneAt(e.point.x, e.point.z);
        setHover(id);
        document.body.style.cursor = id ? "pointer" : "";
      }}
      onPointerOut={() => {
        setHover(null);
        document.body.style.cursor = "";
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 4 || useStore.getState().intro !== "done") return;
        const { x, z } = e.point;
        if (Math.hypot(x - net.well[0], z - net.well[1]) < 260) return select({ type: "source", id: "MW-1" });
        if (Math.hypot(x - net.divider[0], z - net.divider[1]) < 70 || distanceToPolyline(x, z, net.main) < 30) return select({ type: "main", id: "main" }, false);
        for (const [id, line] of Object.entries(net.branches)) if (distanceToPolyline(x, z, line) < 26) return select({ type: "branch", id }, false);
        if (distanceToPolyline(x, z, net.tunnel) < 60) return select({ type: "tunnel", id: "tunnel" });
        const zid = zoneAt(x, z);
        select(zid ? { type: "zone", id: zid } : null);
      }}
    >
      <planeGeometry args={[40000, 40000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

function useTwinAssets(net: Net | null) {
  const [dem, setDem] = useState<Dem | null>(null);
  const [mosaics, setMosaics] = useState<Partial<Record<"far" | "near" | "core", Mosaic>>>({});
  const [palms, setPalms] = useState<Palm[]>([]);
  const setAsset = useStore((s) => s.setAsset);

  useEffect(() => {
    let alive = true;
    loadDem()
      .then((d) => {
        if (!alive) return;
        setDem(d);
        setAsset({ dem: true });
      })
      .catch(() => setAsset({ dem: false }));
    (async () => {
      for (const layout of [FAR, NEAR, CORE]) {
        const m = await loadMosaic(layout);
        if (!alive) return;
        setMosaics((prev) => ({ ...prev, [layout.name]: m }));
        setAsset({ [layout.name]: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [setAsset]);

  // palms: first a placeholder grove inside the zones, then the real canopy read from the imagery
  useEffect(() => {
    if (!net) return;
    const rand = seeded(3);
    const zoneOf = (x: number, z: number) => net.zones.findIndex((q) => pointInPolygon(x, z, q.poly));
    if (!mosaics.core) {
      const pts: Palm[] = [];
      for (let z = -900; z < 900; z += 11)
        for (let x = -950; x < 1300; x += 11) {
          const px = x + (rand() - 0.5) * 8;
          const pz = z + (rand() - 0.5) * 8;
          const zone = zoneOf(px, pz);
          if (zone >= 0 && rand() < 0.55) pts.push({ x: px, z: pz, s: 0.5, zone });
        }
      setPalms(pts);
      return;
    }
    const pts = canopyPoints(mosaics.core, (x, z) => pointInPolygon(x, z, net.outline), 7.2, rand)
      .map((p) => ({ ...p, zone: zoneOf(p.x, p.z) }))
      .filter((p) => p.zone >= 0);
    setPalms(pts);
    setAsset({ palms: pts.length });
  }, [net, mosaics.core, setAsset]);

  return { dem, mosaics, palms };
}

if (typeof window !== "undefined") {
  // handy in the browser console and for scripted recordings
  (window as unknown as { __falaj: unknown }).__falaj = { frame, store: useStore, terrain: terrainUniforms };
}

export default function TwinScene() {
  const geo = useStore((s) => s.data?.geo ?? null);
  const net = useMemo(() => (geo ? buildNet(geo) : null), [geo]);
  const { dem, mosaics, palms } = useTwinAssets(net);
  const select = useStore((s) => s.select);
  const setProfile = useStore((s) => s.setProfile);
  useEffect(() => {
    if (net && dem) setProfile(buildProfile(net, dem));
  }, [net, dem, setProfile]);

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
        camera={{ fov: 32, near: 50, far: 3e6, position: [-150000, 880000, -11000] }}
        onPointerMissed={() => useStore.getState().intro === "done" && select(null)}
      >
        <color attach="background" args={["#0b0a08"]} />
        <Sky />
        <Lights />
        <Region />
        <FrameDriver />
        {dem && net && (
          <>
            <Terrain dem={dem} mosaics={mosaics} net={net} />
            <Palms palms={palms} dem={dem} growOrigin={net.sharia} />
            <Network net={net} dem={dem} />
            <Gauges net={net} dem={dem} />
            <Sensors dem={dem} />
            <EadWells dem={dem} />
            <PickPlane net={net} />
            <CameraRig net={net} dem={dem} />
          </>
        )}
        <Rain />
        <LabelProjector />
        <ExposeCamera />
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <Bloom mipmapBlur intensity={0.7} luminanceThreshold={1.08} luminanceSmoothing={0.1} radius={0.6} />
          <Vignette eskil={false} offset={0.3} darkness={0.42} />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
      </Canvas>
      {dem && net && <LabelLayer net={net} dem={dem} />}
    </div>
  );
}

