import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { fetchCyberData, fetchAdvisories } from "../lib/api";
import { ArcDetailPanel, HotspotCellPanel, PredictiveContextPanel, MathLabPanel, InfrastructurePanel, PredictiveThreatIntelPanel , NetworkFlowMathematics, LiveThreatTicker, FeedStatusPanel, AlchemyPanel, ContextEnginePanel, VulnWeatherPanel } from './Panels';
import { BlockchainForensics } from './Panels';
import IOCEnrichmentPanel from "./Panels/IOCEnrichmentPanel";
import type { ArcData, HotspotCellData } from './Panels';
import IOCEnrichmentPanel from "./Panels/IOCEnrichmentPanel";
import TTPHeatmapPanel from "./Panels/TTPHeatmapPanel";
import { TemporalReplayControls } from './ReplayControls';
import { addCountryBorders } from "./Globe/CountryBorders";
import {
  calculatePanelPosition,
  raycastArcs,
  raycastGlobe,
  getMouseNDC,
  latLonToGridCell,
  fetchCellHistory,
  enhanceArcWithIntelligence,
  generateMockHotspotData,
} from '../utils';

// ─── DESIGN SYSTEM ──────────────────────────────────────────────────────
const COLORS = {
  bg: "#050a12",
  globe: "#0a1628",
  globeEdge: "#0d2847",
  grid: "#0c2240",
  ocean: "#060e1e",
  land: "#0f2a4a",
  landHighlight: "#1a4070",
  // Threat severity (weather scale)
  clear: "#22c55e",
  advisory: "#3b82f6",
  watch: "#eab308",
  warning: "#f97316",
  emergency: "#ef4444",
  // Arcs
  arcSSH: "#00e5ff",
  arcRDP: "#ff6d00",
  arcHTTP: "#b388ff",
  arcDNS: "#76ff03",
  // UI
  panel: "rgba(8,18,38,0.85)",
  panelBorder: "rgba(0,180,255,0.15)",
  textPrimary: "#e0eaf8",
  textSecondary: "#5a7da8",
  textAccent: "#00ccff",
  scanline: "rgba(0,200,255,0.03)",
};

const VECTOR_COLORS: Record<string, string> = {
  ssh: COLORS.arcSSH,
  rdp: COLORS.arcRDP,
  http: COLORS.arcHTTP,
  dns_amp: COLORS.arcDNS,
  brute_force: "#ffab00",
  botnet_c2: "#ff1744",
  ransomware: "#d500f9",
};

const SEVERITY_CONFIG: Record<number, { label: string; color: string; icon: string; desc: string }> = {
  1: { label: "CLEAR", color: COLORS.clear, icon: "◉", desc: "Clear skies — light and variable" },
  2: { label: "ADVISORY", color: COLORS.advisory, icon: "◈", desc: "Scattered activity — isolated showers" },
  3: { label: "WATCH", color: COLORS.watch, icon: "◆", desc: "Developing storm system" },
  4: { label: "WARNING", color: COLORS.warning, icon: "⬡", desc: "Severe storm warning — sustained pressure" },
  5: { label: "EMERGENCY", color: COLORS.emergency, icon: "⬢", desc: "Category 5 cyber hurricane — cascade imminent" },
};

// ─── GEOGRAPHIC DATA ────────────────────────────────────────────────────
// Simplified coastline points (major landmass outlines)
const COASTLINE_POINTS: [number, number][] = [];
function addCoastRegion(latMin: number, latMax: number, lonMin: number, lonMax: number, density = 0.08) {
  for (let i = 0; i < density * 1000; i++) {
    const lat = latMin + Math.random() * (latMax - latMin);
    const lon = lonMin + Math.random() * (lonMax - lonMin);
    COASTLINE_POINTS.push([lat, lon]);
  }
}
// North America
addCoastRegion(25, 50, -130, -60, 0.15);
addCoastRegion(50, 70, -170, -55, 0.08);
// South America
addCoastRegion(-55, 12, -82, -35, 0.12);
// Europe
addCoastRegion(35, 70, -10, 40, 0.15);
// Africa
addCoastRegion(-35, 37, -20, 52, 0.12);
// Asia
addCoastRegion(10, 55, 40, 145, 0.2);
addCoastRegion(55, 75, 30, 180, 0.08);
// Australia
addCoastRegion(-45, -10, 110, 155, 0.08);

// ─── TYPES ──────────────────────────────────────────────────────────────
interface Hotspot {
  name: string;
  lat: number;
  lon: number;
  vector: string;
  intensity: number;
  n_br: number;
  severity?: number;
}

interface VectorStats {
  name: string;
  severity: number;
  avg_intensity: number;
  max_intensity: number;
  max_branching_ratio: number;
  active_cells: number;
  trend: "increasing" | "stable" | "decreasing";
}

interface ThreatData {
  timestamp: string;
  global_threat_level: number;
  total_events_24h: number;
  events_per_second: number;
  vectors: VectorStats[];
  top_threats: Hotspot[];
  all_hotspots: Hotspot[];
}

// ─── HELPERS ────────────────────────────────────────────────────────────
function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function createArcCurve(src: { lat: number; lon: number }, tgt: { lat: number; lon: number }, radius: number) {
  const v1 = latLonToVec3(src.lat, src.lon, radius);
  const v2 = latLonToVec3(tgt.lat, tgt.lon, radius);
  const mid = v1.clone().add(v2).multiplyScalar(0.5);
  const dist = v1.distanceTo(v2);
  mid.normalize().multiplyScalar(radius + dist * 0.35);
  return new THREE.QuadraticBezierCurve3(v1, mid, v2);
}

// ─── DATA PROCESSING ────────────────────────────────────────────────────
async function fetchThreatData(): Promise<ThreatData> {
  try {
    // Fetch data for all vectors
    // Auto-discover vectors from API
    let vectors = ["ssh", "rdp", "http", "dns_amp", "botnet_c2", "ransomware"]; // fallback
    try {
      const vr = await fetch("/v1/vectors");
      if (vr.ok) {
        const vdata = await vr.json();
        vectors = vdata.map((v: any) => v.name);
      }
    } catch {}
    const allData = await Promise.all(
      vectors.map(async (v) => {
        const [nowcast, params] = await Promise.all([
          fetchCyberData("nowcast", v, undefined, 2.5),
          fetchCyberData("params", v, undefined, 2.5),
        ]);
        return { vector: v, nowcast, params };
      })
    );

    // Process hotspots from grid cells
    const hotspots: Hotspot[] = [];
    const vectorStats: VectorStats[] = [];

    for (const { vector, nowcast, params } of allData) {
      const cells = nowcast.features || [];
      const paramCells = params.features || [];

      if (cells.length === 0) continue;

      // Get top cells for this vector — geographically distributed
      const allCells = cells
        .map((f: any) => ({
          lat: (f.geometry.coordinates[0][0][1] + f.geometry.coordinates[0][2][1]) / 2,
          lon: (f.geometry.coordinates[0][0][0] + f.geometry.coordinates[0][2][0]) / 2,
          intensity: f.properties.intensity || 0,
          pressure: f.properties.pressure || 0,
        }))
        .sort((a: any, b: any) => b.intensity - a.intensity);

      // Select top cells ensuring geographic spread (grid-based dedup)
      const seen = new Set<string>();
      const sortedCells: typeof allCells = [];
      for (const c of allCells) {
        const regionKey = `${Math.floor(c.lat / 15)}_${Math.floor(c.lon / 30)}`;
        const regionCount = sortedCells.filter(s => {
          const sk = `${Math.floor(s.lat / 15)}_${Math.floor(s.lon / 30)}`;
          return sk === regionKey;
        }).length;
        if (regionCount < 3) { // Max 3 hotspots per 15°x30° region
          sortedCells.push(c);
          if (sortedCells.length >= 40) break;
        }
      }

      // Match with param data for n_br
      sortedCells.forEach((cell: any) => {
        const matchingParam = paramCells.find((p: any) => {
          const pLat = (p.geometry.coordinates[0][0][1] + p.geometry.coordinates[0][2][1]) / 2;
          const pLon = (p.geometry.coordinates[0][0][0] + p.geometry.coordinates[0][2][0]) / 2;
          return Math.abs(pLat - cell.lat) < 0.1 && Math.abs(pLon - cell.lon) < 0.1;
        });
        const n_br = matchingParam?.properties?.n_br || 0;

        hotspots.push({
          name: `${cell.lat.toFixed(1)}°, ${cell.lon.toFixed(1)}°`,
          lat: cell.lat,
          lon: cell.lon,
          vector,
          intensity: cell.intensity,
          n_br,
        });
      });

      // Calculate vector stats
      const intensities = cells.map((f: any) => f.properties.intensity || 0);
      const maxIntensity = Math.max(...intensities, 0);
      const avgIntensity = intensities.reduce((a: number, b: number) => a + b, 0) / intensities.length;

      const branchingRatios = paramCells.map((f: any) => f.properties.n_br || 0);
      const maxBr = Math.max(...branchingRatios, 0);

      const severity = maxBr >= 0.7 ? 4 : maxBr >= 0.5 ? 3 : maxBr >= 0.3 ? 2 : 1;

      vectorStats.push({
        name: vector,
        severity,
        avg_intensity: avgIntensity,
        max_intensity: maxIntensity,
        max_branching_ratio: maxBr,
        active_cells: cells.length,
        trend: maxBr >= 0.5 ? "increasing" : avgIntensity > 50 ? "increasing" : "stable",
      });
    }

    // Calculate global threat level
    const maxSeverity = Math.max(...vectorStats.map((v) => v.severity), 1);
    const globalLevel = Math.min(5, maxSeverity);

    // Sort top threats
    const topThreats = hotspots
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 10)
      .map((h) => ({
        ...h,
        severity: h.n_br >= 0.7 ? 4 : h.n_br >= 0.5 ? 3 : h.n_br >= 0.3 ? 2 : 1,
      }));

    return {
      timestamp: new Date().toISOString(),
      global_threat_level: globalLevel,
      total_events_24h: Math.floor(hotspots.reduce((s, h) => s + h.intensity, 0)),
      events_per_second: Math.max(1, Math.round(hotspots.reduce((s, h) => s + h.intensity, 0))),
      vectors: vectorStats,
      top_threats: topThreats,
      all_hotspots: hotspots,
    };
  } catch (error) {
    console.error("Error fetching threat data:", error);
    // Return minimal data on error
    return {
      timestamp: new Date().toISOString(),
      global_threat_level: 1,
      total_events_24h: 0,
      events_per_second: 0,
      vectors: [],
      top_threats: [],
      all_hotspots: [],
    };
  }
}

// ─── THREE.JS GLOBE ─────────────────────────────────────────────────────
function useGlobe(canvasRef: React.RefObject<HTMLCanvasElement>, containerRef: React.RefObject<HTMLDivElement>, hotspots: Hotspot[], threatLevelRef?: React.RefObject<number>) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, down: false, lastX: 0, lastY: 0 });
  const rotRef = useRef({ x: 0.3, y: 0, autoRotate: true, speed: 0.0012, paused: false });
  const arcsGroupRef = useRef<THREE.Group | null>(null);
  const sseEventsRef = useRef<Array<{lat: number; lon: number; srcLat: number; srcLon: number; vector: string; ts: number}>>([]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a12, 0.0008);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(0, 0, 3.5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050a12, 1);
    rendererRef.current = renderer;

    // Ambient light
    scene.add(new THREE.AmbientLight(0x1a3050, 0.6));
    const dirLight = new THREE.DirectionalLight(0x4488cc, 0.8);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0x0066aa, 0.3);
    rimLight.position.set(-5, -2, -5);
    scene.add(rimLight);

    // Globe
    const R = 1;
    const globeGeo = new THREE.SphereGeometry(R, 64, 64);
    const globeMat = new THREE.MeshPhongMaterial({
      color: 0x0a1628,
      emissive: 0x040c1a,
      emissiveIntensity: 0.3,
      shininess: 15,
      transparent: true,
      opacity: 0.95,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);
    globeRef.current = globe;

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(R * 1.015, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x0077cc,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Outer halo
    const haloGeo = new THREE.SphereGeometry(R * 1.08, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x0055aa,
      transparent: true,
      opacity: 0.04,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(haloGeo, haloMat));

    // Grid lines (lat/lon)
    const gridMat = new THREE.LineBasicMaterial({ color: 0x0c2240, transparent: true, opacity: 0.25 });
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lon = 0; lon <= 360; lon += 2) {
        pts.push(latLonToVec3(lat, lon - 180, R * 1.001));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(geo, gridMat));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 2) {
        pts.push(latLonToVec3(lat, lon, R * 1.001));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(geo, gridMat));
    }

    // Land mass point cloud
    const landPositions: number[] = [];
    COASTLINE_POINTS.forEach(([lat, lon]) => {
      const v = latLonToVec3(lat, lon, R * 1.002);
      landPositions.push(v.x, v.y, v.z);
    });
    const landGeo = new THREE.BufferGeometry();
    landGeo.setAttribute("position", new THREE.Float32BufferAttribute(landPositions, 3));
    const landMat = new THREE.PointsMaterial({ color: 0x1a4a7a, size: 0.006, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Points(landGeo, landMat));

    // Country borders — using built-in coastline point cloud (sufficient detail)
    addCountryBorders(scene, R);

    // Hotspot markers — handled by reactive useEffect below

    // ARC CONNECTIONS — handled by reactive useEffect

    // Stars background
    const starPositions: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const r = 50 + Math.random() * 150;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x4477aa, size: 0.15, transparent: true, opacity: 0.4 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Mouse interaction
    const onMouseDown = (e: MouseEvent) => {
      mouseRef.current.down = true;
      mouseRef.current.lastX = e.clientX;
      mouseRef.current.lastY = e.clientY;
      rotRef.current.autoRotate = false;
    };
    const onMouseUp = () => {
      mouseRef.current.down = false;
      setTimeout(() => {
        rotRef.current.autoRotate = !rotRef.current.paused;
      }, 3000);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseRef.current.down) return;
      const dx = e.clientX - mouseRef.current.lastX;
      const dy = e.clientY - mouseRef.current.lastY;
      rotRef.current.y += dx * 0.005;
      rotRef.current.x += dy * 0.005;
      rotRef.current.x = Math.max(-1.2, Math.min(1.2, rotRef.current.x));
      mouseRef.current.lastX = e.clientX;
      mouseRef.current.lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      camera.position.z = Math.max(2.5, Math.min(6, camera.position.z + e.deltaY * 0.002));
    };
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel);

    // ─── DAY/NIGHT TERMINATOR ───
    const terminatorGeo = new THREE.SphereGeometry(2.02, 64, 64);
    const terminatorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float dotSun = dot(normalize(vPosition), normalize(sunDirection));
          float terminator = smoothstep(-0.15, 0.15, -dotSun);
          gl_FragColor = vec4(0.0, 0.0, 0.02, terminator * 0.45);
        }
      `,
    });
    const terminatorMesh = new THREE.Mesh(terminatorGeo, terminatorMat);
    globe.add(terminatorMesh);

    // Animate
    let animId: number;
    const clock = new THREE.Clock();
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Rotate globe
      if (rotRef.current.autoRotate) {
        rotRef.current.y += rotRef.current.speed || 0.0012;
      }
      globe.rotation.x = rotRef.current.x;
      globe.rotation.y = rotRef.current.y;

      // Sync everything with globe rotation
      const globeQ = globe.quaternion.clone();
      scene.traverse((child) => {
        if (child === globe || child === scene) return;
        // Skip children of globe — they inherit rotation automatically
        let p = child.parent;
        while (p) { if (p === globe) return; p = p.parent; }
        if (child.type === "Mesh" || child.type === "Line" || child.type === "Points") {
          if ((child as any).material?.size !== 0.15) {
            (child as any).quaternion.copy(globeQ);
          }
        }
      });

      // Animate arc particles with sin-wave opacity
      if (arcsGroupRef.current) {
        const elapsed = clock.getElapsedTime();
        arcsGroupRef.current.children.forEach((child) => {
          if (child.userData?.isParticle && child.userData?.curve) {
            const ud = child.userData;
            let prog = ((elapsed * ud.speed) + ud.offset) % 1;
            const pt = ud.curve.getPoint(prog);
            child.position.copy(pt);
            // Fade in/out at endpoints, bright in middle
            const fade = Math.sin(prog * Math.PI);
            (child as any).material.opacity = fade * (ud.offset === 0 ? 0.95 : 0.6);
          }
        });
      }
      // Update sun direction for day/night terminator
      const now = Date.now() / 1000;
      const dayFrac = (now % 86400) / 86400;
      const sunAngle = dayFrac * Math.PI * 2 - Math.PI;
      const sunDecl = 0.4 * Math.sin((new Date().getMonth() - 2) / 12 * Math.PI * 2);
      terminatorMat.uniforms.sunDirection.value.set(
        Math.cos(sunAngle) * Math.cos(sunDecl),
        Math.sin(sunDecl),
        Math.sin(sunAngle) * Math.cos(sunDecl)
      );
      const _tl = threatLevelRef?.current || 1;
      const _bg = [0x082a12, 0x081430, 0x1a1808, 0x1c1208, 0x1c0a10];
      renderer.setClearColor(_bg[_tl - 1] || 0x050a12, 1);
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, [hotspots]);

  // ─── REACTIVE UPDATE: Clear and recreate hotspots/arcs when data changes ──
  const hotspotsGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || hotspots.length === 0) return;

    // Async wrapper for fetching flow data
    (async () => {
    const R = 1;

    // Remove old hotspot markers
    if (hotspotsGroupRef.current) {
      scene.remove(hotspotsGroupRef.current);
      hotspotsGroupRef.current.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    const hsGroup = new THREE.Group();
    hotspotsGroupRef.current = hsGroup;

    hotspots.forEach((spot) => {
      const v = latLonToVec3(spot.lat, spot.lon, R * 1.005);
      const col = new THREE.Color(VECTOR_COLORS[spot.vector] || COLORS.textAccent);
      const dotGeo = new THREE.SphereGeometry(Math.min(0.022, 0.009 * (0.6 + Math.log1p(spot.intensity) * 0.15)), 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(v);
      dot.userData = { type: "hotspot", clickable: true, spot };
      hsGroup.add(dot);
      const ringGeo = new THREE.RingGeometry(0.015, 0.020, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(v);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      hsGroup.add(ring);
    });
    if (globeRef.current) { globeRef.current.add(hsGroup); } else { scene.add(hsGroup); }

    // Remove old arcs
    if (arcsGroupRef.current) {
      scene.remove(arcsGroupRef.current);
      arcsGroupRef.current.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    const arcsGroup = new THREE.Group();
    arcsGroupRef.current = arcsGroup;

    const genSeries = (base: number, count = 48) =>
      Array.from({ length: count }, (_, k) => ({
        timestamp: Date.now() - (count - k) * 3600000,
        value: Math.max(0, base + (Math.random() - 0.5) * 20),
      }));
    const genBrSeries = (base: number, count = 48) =>
      Array.from({ length: count }, (_, k) => ({
        timestamp: Date.now() - (count - k) * 3600000,
        value: Math.min(0.99, Math.max(0.1, base + (Math.random() - 0.5) * 0.1)),
      }));

    // Build arcs from real attack flow data
    // Fetch top source→target flows from backend
    let flowData: any[] = [];
    try {
      const flowRes = await fetch("/v1/flows/top?hours=24&limit=30");
      if (flowRes.ok) {
        const fd = await flowRes.json();
        flowData = fd.flows || [];
      }
    } catch {}

    // Ensure minimum arc diversity — supplement with synthetic global arcs
    const countryCodes = Object.keys(COUNTRY_CENTROIDS);
    if (flowData.length < 20) {
      // Generate diverse arcs from random countries to hotspots
      const needed = 30 - flowData.length;
      const vectors = ["ssh", "rdp", "http", "dns_amp", "botnet_c2", "malware"];
      for (let i = 0; i < needed; i++) {
        const srcCC = countryCodes[Math.floor(Math.random() * countryCodes.length)];
        const vec = vectors[Math.floor(Math.random() * vectors.length)];
        const h = hotspots[Math.floor(Math.random() * Math.max(hotspots.length, 1))] || { lat: 0, lon: 0, intensity: 10 };
        flowData.push({
          source_country: srcCC, vector: vec,
          event_count: Math.round(5 + Math.random() * h.intensity),
          avg_lat: h.lat, avg_lon: h.lon, unique_ips: 1, top_port: [22, 80, 443, 3389, 53][Math.floor(Math.random() * 5)],
        });
      }
    }

    for (let i = 0; i < flowData.length; i++) {
      const flow = flowData[i];
      const srcCC = flow.source_country;
      const srcCoords = COUNTRY_CENTROIDS[srcCC];
      if (!srcCoords) continue;
      const [srcLat, srcLon] = srcCoords;

      // Target: find highest-intensity hotspot for this vector that's far from source
      const vectorHotspots = hotspots
        .filter(h => h.vector === flow.vector || flow.vector === "malware" || flow.vector === "botnet_c2")
        .sort((a, b) => b.intensity - a.intensity);
      
      // Pick a target: prefer geographically distant hotspot, but accept closer ones too
      let tgt: { lat: number; lon: number; name: string } | null = null;
      for (const h of vectorHotspots) {
        const dLat = Math.abs(srcLat - h.lat);
        const dLon = Math.abs(srcLon - h.lon);
        if (dLat > 5 || dLon > 8) {
          tgt = { lat: h.lat, lon: h.lon, name: h.name };
          break;
        }
      }
      // Fallback: pick any hotspot or a random global city
      if (!tgt) {
        for (const h of hotspots) {
          const dLat = Math.abs(srcLat - h.lat);
          const dLon = Math.abs(srcLon - h.lon);
          if (dLat > 3 || dLon > 5) {
            tgt = { lat: h.lat, lon: h.lon, name: h.name };
            break;
          }
        }
      }
      // Final fallback: pick a random country centroid as target
      if (!tgt) {
        const tgtCC = countryCodes[Math.floor(Math.random() * countryCodes.length)];
        const tgtCoords = COUNTRY_CENTROIDS[tgtCC];
        if (tgtCoords && (Math.abs(srcLat - tgtCoords[0]) > 3 || Math.abs(srcLon - tgtCoords[1]) > 5)) {
          tgt = { lat: tgtCoords[0], lon: tgtCoords[1], name: tgtCC };
        }
      }
      if (!tgt) continue;

      const src = { lat: srcLat, lon: srcLon, name: srcCC, vector: flow.vector, intensity: flow.event_count, n_br: 0.5 };

      const curve = createArcCurve(src, tgt, R);
      const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.0025, 6, false);
      const col = new THREE.Color(VECTOR_COLORS[src.vector] || COLORS.textAccent);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.15 });
      const tube = new THREE.Mesh(tubeGeo, mat);
      tube.userData = {
        type: 'arc', clickable: true,
        arcData: enhanceArcWithIntelligence({
          id: `arc_${i}_${src.vector}_${Date.now()}`,
          sourceCell: { cellId: i * 100, lat: src.lat, lon: src.lon, country: srcCC },
          targetCell: { cellId: (i + 2) * 100, lat: tgt.lat, lon: tgt.lon, country: "Target" },
          vector: flow.vector, packets: flow.event_count * 1500,
          bandwidth: flow.event_count * 3000000,
          confidence: Math.min(0.99, 0.6 + Math.min(flow.event_count / 10000, 0.35)),
          firstSeen: new Date(Date.now() - 24 * 3600000),
          intensityHistory: genSeries(src.intensity * 80 + 20),
          hawkesParams: { mu: 0.1 + src.n_br * 0.2, muStd: 0.02, beta: 0.4 + src.n_br * 0.3, betaStd: 0.05, nBr: src.n_br, nBrStd: 0.08, stability: src.n_br >= 0.7 ? 'unstable' : 'stable' },
          branchingHistory: genBrSeries(src.n_br),
          attackMapping: { techniques: [], killChainPhase: [] },
          networkDetails: { source: { lat: src.lat, lon: src.lon, asn: 'AS-Unknown', network: '0.0.0.0/0', country: srcCC }, target: { lat: tgt.lat, lon: tgt.lon, asn: 'AS-Unknown', network: '0.0.0.0/0', country: "Target" }, portDistribution: flow.top_port ? { [flow.top_port]: flow.event_count } : { 22: flow.event_count }, packetTimeline: [] },
        }, src.vector, '', ''),
      };
      arcsGroup.add(tube);
      // Multiple directional particles showing flow
      const baseSpeed = 0.08 + Math.random() * 0.06;
      for (let p = 0; p < 4; p++) {
        const size = p === 0 ? 0.008 : 0.005;
        const opac = p === 0 ? 0.95 : 0.6;
        const pGeo = new THREE.SphereGeometry(size, 6, 6);
        const pMat = new THREE.MeshBasicMaterial({ color: p === 0 ? new THREE.Color(0xffffff) : col, transparent: true, opacity: opac });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        pMesh.userData = { isParticle: true, curve, offset: p * 0.12, speed: baseSpeed, delay: 0 };
        arcsGroup.add(pMesh);
      }
    }
    if (globeRef.current) { globeRef.current.add(arcsGroup); } else { scene.add(arcsGroup); }
    })(); // end async wrapper
  }, [hotspots]);

  return { cameraRef, rendererRef, globeRef, arcsGroupRef, rotRef };
}

// ─── UI COMPONENTS ──────────────────────────────────────────────────────

function SeverityBadge({ level, size = "md" }: { level: number; size?: "sm" | "md" | "lg" }) {
  const cfg = SEVERITY_CONFIG[level] || SEVERITY_CONFIG[1];
  const sz = size === "sm" ? "10px" : size === "lg" ? "16px" : "12px";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}40`,
        borderRadius: "3px",
        padding: "2px 8px",
        fontSize: sz,
        color: cfg.color,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontWeight: 600,
        letterSpacing: "0.05em",
        lineHeight: 1.6,
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function StatCard({ label, value, sub, color = COLORS.textAccent }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "10px", color: COLORS.textSecondary, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px", fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: COLORS.textSecondary, marginTop: "2px", fontFamily: "'JetBrains Mono', monospace" }}>{sub}</div>}
    </div>
  );
}

function VectorRow({ v }: { v: VectorStats }) {
  const color = VECTOR_COLORS[v.name] || COLORS.textAccent;
  const trendIcon = v.trend === "increasing" ? "▲" : v.trend === "decreasing" ? "▼" : "—";
  const trendColor = v.trend === "increasing" ? COLORS.warning : v.trend === "decreasing" ? COLORS.clear : COLORS.textSecondary;
  const barPct = Math.min(v.max_branching_ratio / 0.95 * 100, 100);
  const barColor = v.max_branching_ratio >= 0.8 ? COLORS.warning : v.max_branching_ratio >= 0.5 ? COLORS.textAccent : COLORS.clear;
  return (
    <div style={{ padding: "5px 0", borderBottom: `1px solid ${COLORS.panelBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
        <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textPrimary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {v.name.replace("_", " ")}
        </div>
        <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: trendColor, width: "12px", textAlign: "center" }}>{trendIcon}</div>
        <SeverityBadge level={v.severity} size="sm" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "11px" }}>
        <div style={{ flex: 1, height: "3px", background: "rgba(255,255,255,0.04)", borderRadius: "2px", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${barPct}%`, borderRadius: "2px",
            background: `linear-gradient(90deg, ${barColor}40, ${barColor})`,
            boxShadow: `0 0 4px ${barColor}40`,
            transition: "width 1s ease",
          }} />
        </div>
        <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textSecondary, width: "48px", textAlign: "right", flexShrink: 0 }}>
          n̂={v.max_branching_ratio.toFixed(3)}
        </div>
      </div>
    </div>
  );
}

// Collapsible panel wrapper
function CollapsePanel({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          cursor: "pointer", userSelect: "none",
          fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: 700,
          color: "rgba(0,204,255,0.7)", letterSpacing: "0.12em", textTransform: "uppercase",
          marginBottom: open ? "6px" : "0px",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: "8px", opacity: 0.5, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
      </div>
      {open && <div style={{ animation: "fadeIn 0.15s ease" }}>{children}</div>}
    </div>
  );
}

// Country centroids for arc source mapping — comprehensive global coverage
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  // Americas
  US: [39.8, -98.5], CA: [56.1, -106.3], MX: [23.6, -102.6], BR: [-14.2, -51.9],
  AR: [-38.4, -63.6], CO: [4.6, -74.3], CL: [-35.7, -71.5], PE: [-9.2, -75.0],
  VE: [6.4, -66.6], EC: [-1.8, -78.2], PR: [18.2, -66.6], CU: [21.5, -77.8],
  DO: [18.7, -70.2], PA: [8.5, -80.8], CR: [9.7, -83.8], UY: [-32.5, -55.8],
  // Europe
  GB: [55.4, -3.4], DE: [51.2, 10.4], FR: [46.2, 2.2], NL: [52.1, 5.3],
  IT: [41.9, 12.6], ES: [40.5, -3.7], SE: [60.1, 18.6], PL: [51.9, 19.1],
  RO: [45.9, 25.0], UA: [48.4, 31.2], BG: [42.7, 25.5], IE: [53.4, -8.2],
  CH: [46.8, 8.2], AT: [47.5, 14.6], BE: [50.5, 4.5], CZ: [49.8, 15.5],
  FI: [61.9, 25.7], NO: [60.5, 8.5], DK: [56.3, 9.5], PT: [39.4, -8.2],
  GR: [39.1, 21.8], HU: [47.2, 19.5], RS: [44.0, 21.0], HR: [45.1, 15.2],
  LT: [55.2, 23.9], LV: [56.9, 24.6], EE: [58.6, 25.0], SK: [48.7, 19.7],
  BY: [53.7, 28.0], MD: [47.4, 28.4],
  // Asia
  CN: [35.9, 104.2], RU: [61.5, 105.3], JP: [36.2, 138.3], KR: [35.9, 127.8],
  IN: [20.6, 79.0], ID: [-0.8, 113.9], TH: [15.9, 100.9], VN: [14.1, 108.3],
  TW: [23.7, 121.0], SG: [1.4, 103.8], HK: [22.4, 114.1], MY: [4.2, 102.0],
  PH: [12.9, 121.8], PK: [30.4, 69.3], BD: [23.7, 90.4], KZ: [48.0, 66.9],
  IR: [32.4, 53.7], IQ: [33.2, 43.7], SA: [23.9, 45.1], AE: [23.4, 53.8],
  IL: [31.1, 34.9], TR: [39.0, 35.2], KH: [12.6, 105.0], MM: [21.9, 96.0],
  NP: [28.4, 84.1], LK: [7.9, 80.8], GE: [42.3, 43.4], AM: [40.1, 45.0],
  // Africa
  ZA: [-30.6, 22.9], NG: [9.1, 8.7], KE: [-0.02, 37.9], EG: [26.8, 30.8],
  MA: [31.8, -7.1], TN: [33.9, 9.5], GH: [8.0, -1.0], ET: [9.1, 40.5],
  TZ: [-6.4, 34.9], DZ: [28.0, 1.7], CM: [7.4, 12.4], CI: [7.5, -5.6],
  SN: [14.5, -14.5], UG: [1.4, 32.3], MZ: [-18.7, 35.5],
  // Oceania
  AU: [-25.3, 133.8], NZ: [-40.9, 174.9],
};

interface CountryData {
  code: string; lat: number; lon: number; total: number;
  vectors: Record<string, number>; avg_severity: number;
}

function TopCountries({ onCountryClick }: { onCountryClick?: (c: CountryData) => void }) {
  const [countries, setCountries] = useState<CountryData[]>([]);
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/v1/top-countries");
        const d = await res.json();
        setCountries(d.countries || []);
      } catch {}
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const max = Math.max(...countries.map(c => c.total), 1);
  return (
    <div>
      {countries.slice(0, 8).map((c, i) => {
        const topVector = Object.entries(c.vectors).sort((a, b) => b[1] - a[1])[0];
        const col = topVector ? (VECTOR_COLORS[topVector[0]] || COLORS.textAccent) : COLORS.textAccent;
        return (
          <div key={c.code} style={{ marginBottom: "4px", cursor: onCountryClick ? "pointer" : "default" }}
               onClick={() => onCountryClick?.(c)}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1px" }}>
              <span style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textPrimary, fontWeight: 600 }}>
                {i + 1}. {c.code}
              </span>
              <span style={{ fontSize: "8px", fontFamily: "'JetBrains Mono', monospace", color: col, textTransform: "uppercase" }}>
                {topVector ? topVector[0] : ""}
              </span>
            </div>
            <div style={{ height: "3px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(c.total / max) * 100}%`, borderRadius: "2px",
                background: `linear-gradient(90deg, ${col}40, ${col})`, transition: "width 1s ease" }} />
            </div>
            <div style={{ fontSize: "8px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace", marginTop: "1px" }}>
              {c.total.toLocaleString()} events
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopThreats({ threats }: { threats: Hotspot[] }) {
  const top5 = threats.slice(0, 5);
  return (
    <div>
      {top5.map((t, i) => {
        const col = VECTOR_COLORS[t.vector] || COLORS.textAccent;
        const sevCfg = SEVERITY_CONFIG[t.severity || 1] || SEVERITY_CONFIG[1];
        const maxI = Math.max(...threats.slice(0, 5).map(x => x.intensity), 1);
        const barW = `${Math.min(100, (t.intensity / maxI) * 100)}%`;
        return (
          <div key={i} style={{ marginBottom: "5px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
              <span style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "140px" }}>{t.name}</span>
              <span style={{ fontSize: "8px", fontFamily: "'JetBrains Mono', monospace", color: col, textTransform: "uppercase", fontWeight: 700 }}>{t.vector}</span>
            </div>
            <div style={{ height: "3px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: barW, borderRadius: "2px", background: `linear-gradient(90deg, ${col}40, ${col})`, transition: "width 1s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1px" }}>
              <span style={{ fontSize: "8px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
                λ={t.intensity.toFixed(1)} · n̂={t.n_br.toFixed(2)}
              </span>
              <span style={{ fontSize: "8px", color: sevCfg.color, fontFamily: "'JetBrains Mono', monospace" }}>
                {sevCfg.icon} {sevCfg.label}
              </span>
            </div>
          </div>
        );
      })}
      {threats.length > 5 && (
        <div style={{ fontSize: "8px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace", textAlign: "center", marginTop: "2px", opacity: 0.6 }}>
          +{threats.length - 5} more hotspots
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────


// Ensure cellData has all required fields for HotspotCellPanel
function sanitizeCellData(raw: any): HotspotCellData {
  return {
    cellId: raw?.cellId ?? raw?.cell_id ?? 0,
    lat: raw?.lat ?? 0,
    lon: raw?.lon ?? 0,
    vector: raw?.vector ?? 'unknown',
    hawkesParams: {
      mu: raw?.hawkesParams?.mu ?? raw?.current_params?.mu ?? 0,
      muStd: raw?.hawkesParams?.muStd ?? 0,
      beta: raw?.hawkesParams?.beta ?? raw?.current_params?.beta ?? 0,
      betaStd: raw?.hawkesParams?.betaStd ?? 0,
      nBr: raw?.hawkesParams?.nBr ?? raw?.current_params?.n_br ?? 0,
      nBrStd: raw?.hawkesParams?.nBrStd ?? 0,
      stability: raw?.hawkesParams?.stability ?? 'stable',
    },
    eventCount24h: raw?.eventCount24h ?? raw?.event_count_24h ?? 0,
    severity: raw?.severity ?? 'clear',
    intensityHistory: Array.isArray(raw?.intensityHistory) ? raw.intensityHistory : Array.isArray(raw?.intensity_history) ? raw.intensity_history : [],
    branchingHistory: Array.isArray(raw?.branchingHistory) ? raw.branchingHistory : Array.isArray(raw?.branching_history) ? raw.branching_history : [],
    location: raw?.location ?? undefined,
  };
}

export default function CyberWeatherGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ThreatData | null>(null);
  const [clock, setClock] = useState(new Date());
  const [eps, setEps] = useState(0);

  // Panel state
  const [showContextEngine, setShowContextEngine] = useState(false);
  const [showMathLab, setShowMathLab] = useState(false);
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const [showFlowMath, setShowFlowMath] = useState(false);
  const [showBlockchain, setShowBlockchain] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<any>(null);
  const [showFeedStatus, setShowFeedStatus] = useState(false);
  const [showExposure, setShowExposure] = useState(true);
  const [exposureData, setExposureData] = useState<any[]>([]);
  const exposureGroupRef = useRef<THREE.Group | null>(null);
  const [showAlchemy, setShowAlchemy] = useState(false);
  const [showThreatIntel, setShowThreatIntel] = useState(false);
  const [showIOCEnrich, setShowIOCEnrich] = useState(false);
  const [showTTPHeatmap, setShowTTPHeatmap] = useState(false);
  const [iocIndicator, setIOCIndicator] = useState<string>("");
  const [selectedArc, setSelectedArc] = useState<ArcData | null>(null);
  const [arcPanelPos, setArcPanelPos] = useState({ x: 0, y: 0 });
  const [selectedCell, setSelectedCell] = useState<HotspotCellData | null>(null);
  const [cellPanelPos, setCellPanelPos] = useState({ x: 0, y: 0 });
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [rotSpeed, setRotSpeed] = useState(0.0012);
  const [isLoadingCell, setIsLoadingCell] = useState(false);
  const [showVulnWeather, setShowVulnWeather] = useState(false);

  // Fetch threat data
  useEffect(() => {
    fetchThreatData().then(setData);

    // Fetch Shodan exposure data for globe layer
    async function fetchExposureGeo() {
      try {
        const res = await fetch('/v1/exposure/geo');
        if (res.ok) {
          const geo = await res.json();
          const features = geo.features || [];
          setExposureData(features.map((f: any) => ({
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            query: f.properties.query || '',
            port: f.properties.port || 0,
            product: f.properties.product || '',
            org: f.properties.org || '',
            country: f.properties.country || '',
          })));
        }
      } catch {}
    }
    fetchExposureGeo();
    const exposureInterval = setInterval(fetchExposureGeo, 300000); // 5 min
    return () => clearInterval(exposureInterval);
    const id = setInterval(() => {
      fetchThreatData().then(setData);
    }, 30000); // Update every 30 seconds
    return () => clearInterval(id);
  }, []);

  // ─── EXPOSURE LAYER RENDERING ───
  useEffect(() => {
    const globe = globeRef.current;
    const scene = globe?.parent || null;


    if (!scene) return;
    if (exposureGroupRef.current) {
      if (globe) globe.remove(exposureGroupRef.current);
      else scene.remove(exposureGroupRef.current);
      exposureGroupRef.current.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      exposureGroupRef.current = null;
    }
    if (!showExposure || exposureData.length === 0) return;
    const R = 1;
    const expGroup = new THREE.Group();
    exposureGroupRef.current = expGroup;
    const EXPOSURE_COLORS: Record<string, number> = {
      rdp_open: 0xff6600, smb_exposed: 0xff9900, ssh_password: 0xffcc00,
      telnet_open: 0xff4400, vnc_open: 0xffaa00, database_exposed: 0xff3333,
      printer_exposed: 0xccaa00, webcam_exposed: 0xcc6600, scada_exposed: 0xff0000,
      gov_exposed: 0x00aaff, edu_exposed: 0x00ccff, healthcare_exposed: 0x00ff88,
      k12_exposed: 0x00ddff, vpn_exposed: 0xaa66ff, default: 0xffaa00,
    };
    const cellMap = new Map<string, { lat: number; lon: number; count: number; query: string }>();
    exposureData.forEach((pt: any) => {
      const key = `${Math.round(pt.lat / 2) * 2}_${Math.round(pt.lon / 2) * 2}`;
      if (cellMap.has(key)) { cellMap.get(key)!.count++; }
      else { cellMap.set(key, { lat: pt.lat, lon: pt.lon, count: 1, query: pt.query }); }
    });
    cellMap.forEach((cell) => {
      const v = latLonToVec3(cell.lat, cell.lon, R * 1.004);
      const colorHex = EXPOSURE_COLORS[cell.query] || EXPOSURE_COLORS.default;
      const col = new THREE.Color(colorHex);
      const size = Math.min(0.018, 0.008 + cell.count * 0.001);
      const ringGeo = new THREE.RingGeometry(size * 0.6, size, 4);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(v);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      expGroup.add(ring);
      const glowGeo = new THREE.RingGeometry(size, size * 1.3, 4);
      const glowMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.copy(v);
      glow.lookAt(new THREE.Vector3(0, 0, 0));
      expGroup.add(glow);
    });
    if (globe) globe.add(expGroup);
    else scene.add(expGroup);
  }, [exposureData, showExposure]);

  // Update clock + real EPS from event stream
  const epsCountRef = useRef(0);
  const epsWindowRef = useRef<number[]>([]);
  useEffect(() => {
    // Track real events via SSE for EPS calculation
    let evtSource: EventSource | null = null;
    let sseRetry: ReturnType<typeof setTimeout> | null = null;
    const connectSSE = () => {
      evtSource = new EventSource("/v1/events/stream?last_event_id=0");
      evtSource.onmessage = (msg) => {
        epsCountRef.current++;
        try {
          const ev = JSON.parse(msg.data);
          if (ev.lat && ev.lon) {
            // Source = attacker's real geolocated position
            // Target = global infrastructure cities (data centers, IXPs, financial hubs)
            const TARGETS = [
              // North America
              [40.71,-74.01],[37.77,-122.42],[34.05,-118.24],[41.88,-87.63],
              [29.76,-95.37],[47.61,-122.33],[42.36,-71.06],[38.91,-77.04],
              [25.76,-80.19],[32.78,-96.80],[33.45,-112.07],[49.28,-123.12],
              [45.50,-73.57],[43.65,-79.38],[39.74,-104.99],[36.17,-115.14],
              // Europe
              [51.51,-0.13],[48.86,2.35],[52.52,13.41],[55.76,37.62],
              [59.33,18.07],[52.37,4.90],[50.85,4.35],[48.21,16.37],
              [41.39,2.17],[38.72,-9.14],[50.08,14.44],[47.37,8.54],
              [60.17,24.94],[53.35,-6.26],[45.46,9.19],[59.95,10.75],
              // Asia-Pacific
              [35.68,139.69],[39.91,116.40],[31.23,121.47],[22.32,114.17],
              [1.35,103.82],[37.57,126.98],[25.03,121.57],[28.61,77.21],
              [19.08,72.88],[13.76,100.50],[14.60,120.98],[-6.21,106.85],
              [3.14,101.69],[21.03,105.85],[34.69,135.50],[23.13,113.26],
              // Middle East / Africa
              [25.20,55.27],[24.47,54.37],[26.22,50.59],[30.04,31.24],
              [-26.20,28.04],[-33.93,18.42],[6.52,3.38],[-1.29,36.82],
              [33.89,35.50],[32.09,34.77],[36.19,44.01],
              // South America / Oceania
              [-23.55,-46.63],[-34.60,-58.38],[-33.45,-70.65],[4.71,-74.07],
              [-33.87,151.21],[-36.85,174.76],[-31.95,115.86],[19.43,-99.13],
            ];
            const tgt = TARGETS[Math.floor(Math.random() * TARGETS.length)];
            sseEventsRef.current.push({ lat: tgt[0], lon: tgt[1], srcLat: ev.lat, srcLon: ev.lon, vector: ev.vector || "ssh", ts: Date.now() });
            // 50% chance of a reverse arc (target responding / counterattack visual)
            if (Math.random() < 0.5) {
              const tgt2 = TARGETS[Math.floor(Math.random() * TARGETS.length)];
              sseEventsRef.current.push({ lat: tgt2[0], lon: tgt2[1], srcLat: tgt[0], srcLon: tgt[1], vector: ev.vector || "ssh", ts: Date.now() });
            }
            // 20% chance of lateral movement arc (target → another target)
            if (Math.random() < 0.2) {
              const src2 = TARGETS[Math.floor(Math.random() * TARGETS.length)];
              const tgt3 = TARGETS[Math.floor(Math.random() * TARGETS.length)];
              sseEventsRef.current.push({ lat: tgt3[0], lon: tgt3[1], srcLat: src2[0], srcLon: src2[1], vector: ev.vector || "ssh", ts: Date.now() });
            }
            if (sseEventsRef.current.length > 400) sseEventsRef.current = sseEventsRef.current.slice(-300);
          }
        } catch {}
      };
      evtSource.onerror = () => { evtSource?.close(); sseRetry = setTimeout(connectSSE, 3000); };
    };
    connectSSE();
    // Update clock and compute real EPS every second
    const id = setInterval(() => {
      setClock(new Date());
      epsWindowRef.current.push(epsCountRef.current);
      epsCountRef.current = 0;
      // Rolling 10-second average
      if (epsWindowRef.current.length > 10) epsWindowRef.current.shift();
      const avg = epsWindowRef.current.reduce((a, b) => a + b, 0) / Math.max(epsWindowRef.current.length, 1);
      setEps(Math.round(avg));
    }, 1000);
    return () => { clearInterval(id); evtSource?.close(); if (sseRetry) clearTimeout(sseRetry); };
  }, []);

  // Initialize globe — now returns refs for click detection
  const threatLevelRef = useRef<number>(data?.global_threat_level || 1);
  threatLevelRef.current = data?.global_threat_level || 1;
  const { cameraRef, globeRef, arcsGroupRef, rotRef } = useGlobe(canvasRef, containerRef, data?.all_hotspots || data?.top_threats || [], threatLevelRef);

  // ─── LIVE ARC SPAWNER: SSE events → animated arcs on globe ───
  useEffect(() => {
    const R = 1;
    const MAX_LIVE_ARCS = 200;
    const ARC_LIFETIME = 4000;
    const liveArcs: Array<{ mesh: THREE.Mesh; born: number }> = [];

    const interval = setInterval(() => {
      const group = arcsGroupRef.current;
      if (!group) return;

      const now = Date.now();
      // Fade & remove expired
      for (let i = liveArcs.length - 1; i >= 0; i--) {
        const age = now - liveArcs[i].born;
        if (age > ARC_LIFETIME) {
          const m = liveArcs[i].mesh;
          group.remove(m);
          if (m.geometry) m.geometry.dispose();
          if ((m as any).material) (m as any).material.dispose();
          liveArcs.splice(i, 1);
        } else {
          const mat = (liveArcs[i].mesh as any).material as THREE.MeshBasicMaterial;
          if (age < 500) mat.opacity = (age / 500) * 0.6;
          else if (age > ARC_LIFETIME - 1500) mat.opacity = ((ARC_LIFETIME - age) / 1500) * 0.6;
          else mat.opacity = 0.6;
        }
      }

      // Spawn from SSE buffer (up to 3 per tick for dense visual)
      const batch = sseEventsRef.current.length > 0 ? sseEventsRef.current.splice(0, 3) : [];
      for (const ev of batch) {
        if (liveArcs.length >= MAX_LIVE_ARCS) break;
        if (Math.abs(ev.srcLat - ev.lat) < 1 && Math.abs(ev.srcLon - ev.lon) < 1) continue;
        try {
          const curve = createArcCurve({ lat: ev.srcLat, lon: ev.srcLon }, { lat: ev.lat, lon: ev.lon }, R);
          const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.002, 4, false);
          const col = new THREE.Color(VECTOR_COLORS[ev.vector] || COLORS.textAccent);
          const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.01 });
          const tube = new THREE.Mesh(tubeGeo, mat);
          tube.userData = { liveArc: true };
          group.add(tube);
          liveArcs.push({ mesh: tube, born: Date.now() });
        } catch {}
      }
    }, 40);

    return () => {
      clearInterval(interval);
      liveArcs.forEach(a => {
        if (a.mesh.geometry) a.mesh.geometry.dispose();
        if ((a.mesh as any).material) (a.mesh as any).material.dispose();
      });
    };
  }, []);

  // ─── CLICK HANDLER ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = async (event: MouseEvent) => {
      console.log('Globe click detected');
      if (!cameraRef.current) return;

      // Don't intercept clicks on overlay panels
      const target = event.target as HTMLElement;
      if (target.closest('.arc-detail-panel') || target.closest('.hotspot-cell-panel')) return;

      const mouse = getMouseNDC(event, canvas as HTMLElement);

      // 1. Try arc first (higher priority)
      if (arcsGroupRef.current) {
        const arcMeshes = arcsGroupRef.current.children.filter((c) => c.userData?.clickable);
        console.log("Arc meshes found:", arcMeshes.length);
        const hit = raycastArcs(mouse, cameraRef.current, arcMeshes);
        console.log("Arc hit:", hit ? "YES" : "no");
        if (hit && hit.arc.userData.arcData) {
          const pos = calculatePanelPosition(event.clientX, event.clientY, 600, 500);
          setArcPanelPos(pos);
          setSelectedArc(hit.arc.userData.arcData as ArcData);
          setSelectedCell(null);
          return;
        }
      }
    };

    const clickWrapper = (e: Event) => handleClick(e as MouseEvent);
    canvas.addEventListener('click', clickWrapper);
    return () => canvas.removeEventListener('click', clickWrapper);
  }, [cameraRef, globeRef, arcsGroupRef, data]);



  // Sync pause/speed to rotRef
  useEffect(() => {
    rotRef.current.paused = isPaused;
    rotRef.current.autoRotate = !isPaused;
    rotRef.current.speed = rotSpeed;
  }, [isPaused, rotSpeed]);

  // ─── HOVER CURSOR ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMove = (event: MouseEvent) => {
      if (!cameraRef.current) return;
      const mouse = getMouseNDC(event, canvas as HTMLElement);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), cameraRef.current);
      let hit = false;
      if (arcsGroupRef.current) {
        const arcMeshes = arcsGroupRef.current.children.filter((c: THREE.Object3D) => c.userData.clickable);
        if (raycaster.intersectObjects(arcMeshes, true).length > 0) hit = true;
      }
      if (!hit && globeRef.current) {
        const dots = globeRef.current.children.filter(
          (c: THREE.Object3D) => c.type === "Mesh" && !c.userData.arcData && !c.userData.curve
        );
        if (raycaster.intersectObjects(dots, true).length > 0) hit = true;
      }
      canvas.style.cursor = hit ? "pointer" : "default";
    };

    canvas.addEventListener("mousemove", handleMove);
    return () => canvas.removeEventListener("mousemove", handleMove);
  }, [cameraRef, globeRef, arcsGroupRef, data]);

    // ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedArc(null); setSelectedCell(null); setShowContextEngine(false); setShowMathLab(false); setShowInfrastructure(false); setShowThreatIntel(false); setShowFlowMath(false); setShowReplay(false); setShowIOCEnrich(false); setIOCIndicator(""); }
      if (e.key === 'l' || e.key === 'L') setIsLiveMode((v) => !v);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  if (!data) return null;

  const sevCfg = SEVERITY_CONFIG[data.global_threat_level];
  const dateStr = clock.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const timeStr = clock.toLocaleTimeString("en-US", { hour12: false, timeZone: "UTC" });

  const panelStyle = {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: "6px",
    padding: "14px 16px",
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 30px rgba(0,0,0,0.5)",
  };

  const headerFont = {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    fontSize: "9px",
    color: COLORS.textSecondary,
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    marginBottom: "10px",
    paddingBottom: "6px",
    borderBottom: `1px solid ${COLORS.panelBorder}`,
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: COLORS.bg,
        overflow: "hidden",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Scanline overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${COLORS.scanline} 2px, ${COLORS.scanline} 4px)`,
          opacity: 0.4,
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(5,10,18,0.6) 100%)",
        }}
      />

      {/* ─── THREAT WATERMARK ─── */}
      <div style={{
        position: "absolute", top: "82px", left: "270px", zIndex: 8,
        animation: "threat-pulse 3s ease-in-out infinite",
        pointerEvents: "none", userSelect: "none",
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "32px", fontWeight: 800, letterSpacing: "0.06em",
          display: "inline-block", animation: "hex-roll 8s ease-in-out infinite",
          color: sevCfg?.color || "#f97316",
          opacity: 0.35,
          textShadow: `0 0 80px ${sevCfg?.color || "#f97316"}20`,
          lineHeight: 1,
        }}>
          {sevCfg?.icon}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "36px", fontWeight: 800, letterSpacing: "0.14em",
          color: sevCfg?.color || "#f97316",
          opacity: 0.3,
          textShadow: `0 0 70px ${sevCfg?.color || "#f97316"}18`,
          lineHeight: 1.1, marginTop: "4px",
        }}>
          {sevCfg?.label}
        </div>
      </div>
      {/* Three.js Canvas */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 5 }} />

      {/* ─── TOP BAR ─── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          background: "linear-gradient(180deg, rgba(5,10,18,0.95) 0%, transparent 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: sevCfg.color,
              boxShadow: `0 0 12px ${sevCfg.color}`,
              animation: "pulse-dot 2s ease-in-out infinite",
            }}
          />
          <div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "14px",
                fontWeight: 700,
                color: COLORS.textPrimary,
                letterSpacing: "0.08em",
              }}
            >
              CYBER WEATHER FORECAST
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "10px",
                color: COLORS.textSecondary,
                letterSpacing: "0.06em",
              }}
            >
              HAWKES PROCESS THREAT INTELLIGENCE · REAL-TIME
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "18px", color: COLORS.textPrimary, fontWeight: 700, letterSpacing: "0.05em" }}>
              {timeStr}
              <span style={{ fontSize: "10px", color: COLORS.textSecondary, marginLeft: "4px" }}>UTC</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: COLORS.textSecondary, letterSpacing: "0.06em" }}>{dateStr.toUpperCase()}</div>
          </div>

          {/* ─── CONTEXT ENGINE BUTTON ─── */}
          <button
            onClick={() => setShowContextEngine((v) => !v)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 14px",
              borderRadius: "4px",
              background: showContextEngine ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.08)",
              border: `1px solid ${showContextEngine ? "rgba(99,102,241,0.7)" : "rgba(99,102,241,0.3)"}`,
              cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(165,180,252,0.7)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              CONTEXT ENGINE
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showContextEngine ? "#a5b4fc" : "#6366f1", letterSpacing: "0.08em" }}>
              ◈ μ(t)
            </div>
          </button>

          {/* ─── FLOW MATH BUTTON ─── */}
          <button
            onClick={() => setShowFlowMath((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showFlowMath ? "rgba(0,204,255,0.15)" : "rgba(0,204,255,0.05)",
              border: `1px solid ${showFlowMath ? "rgba(0,204,255,0.5)" : "rgba(0,204,255,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
              color: "rgba(0,204,255,0.6)", letterSpacing: "0.15em", marginBottom: "2px",
            }}>
              NETWORK
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800,
              color: showFlowMath ? "#00ccff" : "rgba(0,204,255,0.6)", letterSpacing: "0.08em",
            }}>
              〰 FLOW
            </div>
          </button>

          {/* ─── MATH LAB BUTTON ─── */}
          <button
            onClick={() => setShowMathLab((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showMathLab ? "rgba(0,204,255,0.15)" : "rgba(0,204,255,0.05)",
              border: `1px solid ${showMathLab ? "rgba(0,204,255,0.5)" : "rgba(0,204,255,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(0,204,255,0.6)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              MATH LAB
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showMathLab ? "#00ccff" : "rgba(0,204,255,0.6)", letterSpacing: "0.08em" }}>
              ∫ λ(t)
            </div>
          </button>

          {/* ─── INFRASTRUCTURE BUTTON ─── */}
          <button
            onClick={() => setShowInfrastructure((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showInfrastructure ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.05)",
              border: `1px solid ${showInfrastructure ? "rgba(34,197,94,0.5)" : "rgba(34,197,94,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(34,197,94,0.6)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              TOPOLOGY
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showInfrastructure ? "#22c55e" : "rgba(34,197,94,0.6)", letterSpacing: "0.08em" }}>
              🌐 NET
            </div>
          </button>

          <button
            onClick={() => setShowThreatIntel((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showThreatIntel ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.05)",
              border: `1px solid ${showThreatIntel ? "rgba(239,68,68,0.5)" : "rgba(239,68,68,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(239,68,68,0.6)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              PREDICT
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showThreatIntel ? "#ef4444" : "rgba(239,68,68,0.6)", letterSpacing: "0.08em" }}>
              ⚡ PTI
            </div>
          </button>

          {/* ─── IOC ENRICHMENT BUTTON ─── */}
          <button
            onClick={() => setShowIOCEnrich((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showIOCEnrich ? "rgba(0,180,255,0.15)" : "rgba(0,180,255,0.05)",
              border: `1px solid ${showIOCEnrich ? "rgba(0,180,255,0.5)" : "rgba(0,180,255,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
              color: "rgba(0,180,255,0.6)", letterSpacing: "0.15em", marginBottom: "2px",
            }}>
              INDICATOR
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800,
              color: showIOCEnrich ? "#00b4ff" : "rgba(0,180,255,0.6)", letterSpacing: "0.08em",
            }}>
              🔬 IOC
            </div>
          </button>
          {/* ─── TTP HEATMAP BUTTON ─── */}
          <button
            onClick={() => setShowTTPHeatmap((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showTTPHeatmap ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.05)",
              border: `1px solid ${showTTPHeatmap ? "rgba(168,85,247,0.5)" : "rgba(168,85,247,0.2)"}`,
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(168,85,247,0.6)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              TECHNIQUE
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showTTPHeatmap ? "#a855f7" : "rgba(168,85,247,0.6)", letterSpacing: "0.08em" }}>
              📡 TTP
            </div>
          </button>




          {/* ─── ALCHEMY BUTTON ─── */}
          <button
            onClick={() => setShowAlchemy((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showAlchemy ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.05)",
              border: `1px solid ${showAlchemy ? "rgba(168,85,247,0.5)" : "rgba(168,85,247,0.15)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
              color: "rgba(168,85,247,0.6)", letterSpacing: "0.15em", marginBottom: "2px",
            }}>
              MITRE
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800,
              color: showAlchemy ? "#a855f7" : "rgba(168,85,247,0.6)", letterSpacing: "0.08em",
            }}>
              🧪 ALCHEMY
            </div>
          </button>

          {/* ─── BLOCKCHAIN BUTTON ─── */}
          <button
            onClick={() => setShowBlockchain((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showBlockchain ? "rgba(247,147,26,0.15)" : "rgba(247,147,26,0.05)",
              border: `1px solid ${showBlockchain ? "rgba(247,147,26,0.5)" : "rgba(247,147,26,0.2)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "rgba(247,147,26,0.6)", letterSpacing: "0.15em", marginBottom: "2px" }}>
              BLOCKCHAIN
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800, color: showBlockchain ? "#f7931a" : "rgba(247,147,26,0.6)", letterSpacing: "0.08em" }}>
              ₿ CHAIN
            </div>
          </button>

          {/* ─── VULN WEATHER BUTTON ─── */}
          <button
            onClick={() => setShowVulnWeather((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 8px", borderRadius: "4px", minWidth: "82px", textAlign: "center" as const,
              background: showVulnWeather ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.05)",
              border: `1px solid ${showVulnWeather ? "rgba(239,68,68,0.5)" : "rgba(239,68,68,0.15)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
              color: "rgba(239,68,68,0.6)", letterSpacing: "0.15em", marginBottom: "2px",
            }}>
              PRESSURE
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800,
              color: showVulnWeather ? "#ef4444" : "rgba(239,68,68,0.6)", letterSpacing: "0.08em",
            }}>
              🛡️ VULN
            </div>
          </button>


        </div>
      </div>

      {/* ─── LEFT PANEL ─── */}
      <div
        style={{
          position: "absolute",
          top: "80px",
          left: "16px",
          zIndex: 10,
          width: "240px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={panelStyle}>
          <CollapsePanel title="Threat Overview" defaultOpen={true}>
          <StatCard label="Events / 24h" value={data.total_events_24h.toLocaleString()} sub={`${eps} events/sec`} color={COLORS.textAccent} />
          <StatCard label="Active Vectors" value={data.vectors.length} sub={`${data.top_threats.length} hotspots tracked`} />
          <StatCard
            label="Peak Branching Ratio"
            value={Math.max(...data.vectors.map((v) => v.max_branching_ratio), 0).toFixed(3)}
            sub="n̂ · subcritical < 1.0"
            color={data.global_threat_level >= 4 ? COLORS.warning : COLORS.textAccent}
          />
        </CollapsePanel>

        </div>
        <div style={panelStyle}>
          <CollapsePanel title="Vector Status" defaultOpen={true}>
          {data.vectors.map((v) => (
            <VectorRow key={v.name} v={v} />
          ))}
        </CollapsePanel>

        </div>
        <div style={panelStyle}>
          <CollapsePanel title="Top Attacking Countries" defaultOpen={false}>
          <TopCountries onCountryClick={(c) => setSelectedCountry(c)} />
        </CollapsePanel>
        </div>
        {/* ─── PIPELINE HEALTH ─── */}
        <div style={panelStyle}>
          <CollapsePanel title={`Pipeline ${data.events_per_second > 0 ? "● LIVE" : "○ STALE"}`} defaultOpen={false}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: COLORS.textSecondary, marginTop: "2px" }}>
            {data.total_events_24h.toLocaleString()} events / 24h · {data.events_per_second.toFixed(0)} eps
          </div>
          </CollapsePanel>
        </div>

        {/* ─── QUICK ACTIONS ─── */}

      </div>
      <div
        style={{
          position: "absolute",
          top: "80px",
          right: "16px",
          zIndex: 10,
          width: "240px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={panelStyle}>
          <CollapsePanel title="Storm Tracking" defaultOpen={true}>
          <TopThreats threats={data.top_threats} />
          </CollapsePanel>
        </div>

        <div style={panelStyle}>
          <CollapsePanel title="Forecast Conditions" defaultOpen={false}>
          <div style={{ fontSize: "11px", color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
            <div style={{ marginBottom: "8px" }}>
              <span style={{ color: sevCfg.color, fontWeight: 700 }}>
                {sevCfg.icon} {sevCfg.label}
              </span>
              <span style={{ color: COLORS.textSecondary }}> — {sevCfg.desc}</span>
            </div>
            {data.vectors.filter((v) => v.trend === "increasing").length > 0 && (
              <div style={{ marginBottom: "6px", padding: "6px 8px", background: `${COLORS.warning}10`, borderLeft: `2px solid ${COLORS.warning}`, borderRadius: "0 3px 3px 0" }}>
                <span style={{ color: COLORS.warning }}>▲</span>
                <span style={{ color: COLORS.textSecondary }}> Intensifying: </span>
                <span style={{ color: COLORS.textPrimary }}>
                  {data.vectors
                    .filter((v) => v.trend === "increasing")
                    .map((v) => v.name.toUpperCase())
                    .join(", ")}
                </span>
              </div>
            )}
            <div style={{ fontSize: "10px", color: COLORS.textSecondary, marginTop: "8px", fontStyle: "italic" }}>
              24h outlook:{" "}
              {data.global_threat_level >= 4
                ? "Sustained pressure expected. Recommend elevated defensive posture."
                : data.global_threat_level >= 3
                ? "Developing conditions. Monitor branching ratios for escalation."
                : "Stable conditions with isolated activity."}
            </div>
          </div>
        </CollapsePanel>
        </div>

        {/* Legend */}
        <div style={panelStyle}>
          <CollapsePanel title="Vector Legend" defaultOpen={false}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            {Object.entries(VECTOR_COLORS).map(([name, color]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "12px", height: "3px", background: color, borderRadius: "1px", boxShadow: `0 0 6px ${color}60` }} />
                <span style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {name.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${COLORS.panelBorder}` }}>
            <div style={{ fontSize: "8px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textSecondary, letterSpacing: "0.1em", marginBottom: "4px" }}>SEVERITY SCALE</div>
            <div style={{ display: "flex", gap: "2px", height: "6px", borderRadius: "3px", overflow: "hidden" }}>
              {[1, 2, 3, 4, 5].map((l) => (
                <div
                  key={l}
                  style={{
                    flex: 1,
                    background: SEVERITY_CONFIG[l].color,
                    opacity: data.global_threat_level >= l ? 1 : 0.2,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px" }}>
              <span style={{ fontSize: "7px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>CLEAR</span>
              <span style={{ fontSize: "7px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>EMERGENCY</span>
            </div>
          </div>
        </CollapsePanel>
        </div>

        {/* ─── STATUS BUTTONS ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
          <button
            onClick={() => setShowFeedStatus((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              padding: "7px 0", borderRadius: "6px",
              background: showFeedStatus ? "rgba(34,197,94,0.15)" : "rgba(8,18,38,0.9)",
              border: `1px solid ${showFeedStatus ? "rgba(34,197,94,0.5)" : "rgba(34,197,94,0.15)"}`,
              cursor: "pointer", transition: "all 0.15s", backdropFilter: "blur(12px)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: 700,
              color: showFeedStatus ? "#22c55e" : "rgba(34,197,94,0.6)", letterSpacing: "0.08em",
            }}
          >📡 FEED STATUS</button>
          <button
            onClick={() => setShowReplay((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              padding: "7px 0", borderRadius: "6px",
              background: showReplay ? "rgba(0,204,255,0.15)" : "rgba(8,18,38,0.9)",
              border: `1px solid ${showReplay ? "rgba(0,204,255,0.5)" : "rgba(0,204,255,0.15)"}`,
              cursor: "pointer", transition: "all 0.15s", backdropFilter: "blur(12px)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: 700,
              color: showReplay ? "#00ccff" : "rgba(0,204,255,0.6)", letterSpacing: "0.08em",
            }}
          >⏱ TEMPORAL CONTROLS</button>
        </div>
      </div>

      {/* ─── PREDICTIVE CONTEXT ENGINE ─── */}
      {showContextEngine && (
        <ContextEnginePanel onClose={() => setShowContextEngine(false)} />
      )}

      {/* ─── MATH LAB ─── */}
      {showMathLab && (
        <MathLabPanel onClose={() => setShowMathLab(false)} />
      )}

      {/* ─── INFRASTRUCTURE TOPOLOGY ─── */}
      {showInfrastructure && (
        <InfrastructurePanel onClose={() => setShowInfrastructure(false)} />
      )}

      {/* ─── NETWORK FLOW MATHEMATICS ─── */}
      {showFlowMath && (
        <NetworkFlowMathematics onClose={() => setShowFlowMath(false)} />
      )}

      {/* ─── BLOCKCHAIN FORENSICS ─── */}
      {showBlockchain && (
        <BlockchainForensics onClose={() => setShowBlockchain(false)} />
      )}

      {/* ─── PREDICTIVE THREAT INTELLIGENCE ─── */}
      {showThreatIntel && (
        <PredictiveThreatIntelPanel onClose={() => setShowThreatIntel(false)} />
      )}
      {/* ─── IOC ENRICHMENT PANEL ─── */}
      {showIOCEnrich && (
        <IOCEnrichmentPanel
          onClose={() => { setShowIOCEnrich(false); setIOCIndicator(""); }}
          initialIndicator={iocIndicator}
        />
      )}
      {showTTPHeatmap && (
        <TTPHeatmapPanel onClose={() => setShowTTPHeatmap(false)} />
      )}

      {/* ─── ARC DETAIL PANEL ─── */}
      {selectedArc && (
        <ArcDetailPanel
          arc={selectedArc}
          position={arcPanelPos}
          onClose={() => setSelectedArc(null)}
        />
      )}

      {/* ─── HOTSPOT CELL PANEL ─── */}
      {selectedCell && (
        <HotspotCellPanel
          cell={selectedCell}
          position={cellPanelPos}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {/* ─── CELL DATA LOADING INDICATOR ─── */}
      {isLoadingCell && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(8,18,38,0.95)',
            border: '1px solid rgba(0,180,255,0.3)',
            color: '#00ccff',
            padding: '18px 32px',
            borderRadius: '8px',
            zIndex: 9999,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.12em',
          }}
        >
          ◈ LOADING CELL DATA…
        </div>
      )}

      {/* ─── TEMPORAL REPLAY CONTROLS ─── */}
      {showReplay && (
      <TemporalReplayControls
        onTimeChange={() => setIsLiveMode(false)}
        onPlaybackSpeedChange={() => {}}
        onLiveToggle={(live) => setIsLiveMode(live)}
        isLive={isLiveMode}
      />
      )}



      {/* ─── CTI FEED STATUS ─── */}
      {showFeedStatus && (
        <FeedStatusPanel onClose={() => setShowFeedStatus(false)} />
      )}

      {/* ─── MITRE ALCHEMY ─── */}
      {showAlchemy && (
        <AlchemyPanel onClose={() => setShowAlchemy(false)} />
      )}
      {/* ─── LIVE THREAT FEED TICKER ─── */}
      {selectedCountry && (
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 50, width: "360px", background: "rgba(10,15,25,0.97)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(0,204,255,0.3)", borderRadius: "10px", padding: "20px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "16px", fontWeight: 800, color: COLORS.textPrimary }}>
              {selectedCountry.code}
            </div>
            <button onClick={() => setSelectedCountry(null)} style={{
              background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px",
              color: "#fff", cursor: "pointer", padding: "2px 8px", fontSize: "12px",
            }}>✕</button>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: COLORS.textSecondary, marginBottom: "10px" }}>
            {selectedCountry.total?.toLocaleString()} events in last 24h
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {Object.entries(selectedCountry.vectors || {}).sort((a: any, b: any) => b[1] - a[1]).map(([vec, cnt]: [string, any]) => {
              const col = VECTOR_COLORS[vec] || COLORS.textAccent;
              const pct = Math.round((cnt / selectedCountry.total) * 100);
              return (
                <div key={vec}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: col, textTransform: "uppercase", fontWeight: 700 }}>{vec}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: COLORS.textSecondary }}>{cnt.toLocaleString()} ({pct}%)</span>
                  </div>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, borderRadius: "2px", background: `linear-gradient(90deg, ${col}40, ${col})` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: COLORS.textSecondary, marginTop: "10px", opacity: 0.6 }}>
            Coords: {selectedCountry.lat?.toFixed(1)}°, {selectedCountry.lon?.toFixed(1)}°
          </div>
        </div>
      )}
      <LiveThreatTicker />

      {/* ─── VULNERABILITY PRESSURE SYSTEMS ─── */}
      {showVulnWeather && (
        <VulnWeatherPanel onClose={() => setShowVulnWeather(false)} />
      )}
      {/* Keyframes */}


        {/* ─── GLOBE CONTROLS ─── */}
        <div style={{
          position: "fixed",
          bottom: "40px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: "12px",
          background: "rgba(8,18,38,0.9)",
          border: "1px solid rgba(0,180,255,0.15)",
          borderRadius: "8px",
          padding: "8px 16px",
          backdropFilter: "blur(12px)",
          pointerEvents: "auto",
        }}>
          <button
            onClick={() => setIsPaused(p => !p)}
            style={{
              background: "none",
              border: "1px solid rgba(0,180,255,0.3)",
              borderRadius: "4px",
              color: "#00ccff",
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.1em",
            }}
          >
            {isPaused ? "▶ PLAY" : "❚❚ PAUSE"}
          </button>
          <span style={{ color: "#5a7da8", fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em" }}>SPEED</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(rotSpeed / 0.005 * 100)}
            onChange={(e) => setRotSpeed(Number(e.target.value) / 100 * 0.005)}
            style={{ width: "80px", accentColor: "#00ccff", cursor: "pointer" }}
          />
          <span style={{ color: "#e0eaf8", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", minWidth: "30px" }}>
            {(rotSpeed * 1000).toFixed(1)}
          </span>
        </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } } @keyframes hex-roll { 0% { transform: translateX(0) rotate(0deg); } 8% { transform: translateX(30px) rotate(60deg); } 16% { transform: translateX(60px) rotate(120deg); } 24% { transform: translateX(90px) rotate(180deg); } 32% { transform: translateX(120px) rotate(240deg); } 40% { transform: translateX(150px) rotate(300deg); } 50% { transform: translateX(180px) rotate(360deg); } 58% { transform: translateX(150px) rotate(300deg); } 66% { transform: translateX(120px) rotate(240deg); } 74% { transform: translateX(90px) rotate(180deg); } 82% { transform: translateX(60px) rotate(120deg); } 90% { transform: translateX(30px) rotate(60deg); } 100% { transform: translateX(0) rotate(0deg); } } @keyframes threat-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.04); } } @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        canvas { cursor: grab; }
        canvas:active { cursor: grabbing; }
        ::selection { background: ${COLORS.textAccent}30; color: ${COLORS.textPrimary}; }
      `}</style>
    </div>
  );
}
