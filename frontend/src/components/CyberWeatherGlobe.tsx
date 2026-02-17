import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { fetchCyberData, fetchAdvisories } from "../lib/api";

// ─── PANEL IMPORTS ───────────────────────────────────────────────────────
import { ArcDetailPanel, HotspotCellPanel, PredictiveContextPanel, MathLabPanel, InfrastructurePanel } from './Panels';
import type { ArcData, HotspotCellData } from './Panels';
import { TemporalReplayControls } from './ReplayControls';
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
    const vectors = ["ssh", "rdp", "http", "dns_amp"];
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

      // Get top cells for this vector
      const sortedCells = cells
        .map((f: any) => ({
          lat: (f.geometry.coordinates[0][0][1] + f.geometry.coordinates[0][2][1]) / 2,
          lon: (f.geometry.coordinates[0][0][0] + f.geometry.coordinates[0][2][0]) / 2,
          intensity: f.properties.intensity || 0,
          pressure: f.properties.pressure || 0,
        }))
        .sort((a: any, b: any) => b.intensity - a.intensity)
        .slice(0, 5);

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
      .slice(0, 5)
      .map((h) => ({
        ...h,
        severity: h.n_br >= 0.7 ? 4 : h.n_br >= 0.5 ? 3 : h.n_br >= 0.3 ? 2 : 1,
      }));

    return {
      timestamp: new Date().toISOString(),
      global_threat_level: globalLevel,
      total_events_24h: Math.floor(hotspots.reduce((s, h) => s + h.intensity, 0) * 24 * 3600),
      events_per_second: Math.max(1, Math.round(hotspots.reduce((s, h) => s + h.intensity, 0))),
      vectors: vectorStats,
      top_threats: topThreats,
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
    };
  }
}

// ─── THREE.JS GLOBE ─────────────────────────────────────────────────────
function useGlobe(canvasRef: React.RefObject<HTMLCanvasElement>, containerRef: React.RefObject<HTMLDivElement>, hotspots: Hotspot[]) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, down: false, lastX: 0, lastY: 0 });
  const rotRef = useRef({ x: 0.3, y: 0, autoRotate: true });
  const arcsGroupRef = useRef<THREE.Group | null>(null);

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
    camera.position.set(0, 0, 3.2);
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

    // Hotspot markers
    hotspots.forEach((spot) => {
      const v = latLonToVec3(spot.lat, spot.lon, R * 1.005);
      const col = new THREE.Color(VECTOR_COLORS[spot.vector] || COLORS.textAccent);

      // Core point
      const dotGeo = new THREE.SphereGeometry(0.012 * (0.5 + spot.intensity), 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(v);
      scene.add(dot);

      // Pulse ring
      const ringGeo = new THREE.RingGeometry(0.02, 0.025, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(v);
      ring.lookAt(new THREE.Vector3(0, 0, 0));
      scene.add(ring);
    });

    // ─── ARC CONNECTIONS ──────────────────────────────────────────────
    const arcsGroup = new THREE.Group();
    scene.add(arcsGroup);
    arcsGroupRef.current = arcsGroup;

    // Inline time-series helpers (no external imports needed inside effect)
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

    const arcPairs = hotspots.slice(0, Math.min(hotspots.length, 8));
    for (let i = 0; i < arcPairs.length; i++) {
      const src = arcPairs[i];
      const tgt = arcPairs[(i + 2) % arcPairs.length];
      if (src.lat === tgt.lat && src.lon === tgt.lon) continue;

      const curve = createArcCurve(src, tgt, R);
      const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.003, 6, false);
      const col = new THREE.Color(VECTOR_COLORS[src.vector] || COLORS.textAccent);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 });
      const tube = new THREE.Mesh(tubeGeo, mat);

      const baseArc: Partial<ArcData> = {
        id: `arc_${i}_${src.vector}_${Date.now()}`,
        sourceCell: { cellId: i * 100, lat: src.lat, lon: src.lon, country: src.name },
        targetCell: { cellId: (i + 2) * 100, lat: tgt.lat, lon: tgt.lon, country: tgt.name },
        vector: src.vector,
        packets: Math.floor(src.intensity * 1500000 + 500000),
        bandwidth: Math.floor(src.intensity * 3000000000 + 500000000),
        confidence: Math.min(0.99, 0.7 + src.n_br * 0.25),
        firstSeen: new Date(Date.now() - Math.random() * 48 * 3600000),
        intensityHistory: genSeries(src.intensity * 80 + 20),
        hawkesParams: {
          mu: 0.1 + src.n_br * 0.2,
          muStd: 0.02,
          beta: 0.4 + src.n_br * 0.3,
          betaStd: 0.05,
          nBr: src.n_br,
          nBrStd: 0.08,
          stability: src.n_br >= 0.7 ? 'unstable' : 'stable',
        },
        branchingHistory: genBrSeries(src.n_br),
        attackMapping: { techniques: [], killChainPhase: [] },
        networkDetails: {
          source: { lat: src.lat, lon: src.lon, asn: 'AS-Unknown', network: '0.0.0.0/0', country: src.name },
          target: { lat: tgt.lat, lon: tgt.lon, asn: 'AS-Unknown', network: '0.0.0.0/0', country: tgt.name },
          portDistribution: { 22: 560, 80: 350, 443: 225 },
          packetTimeline: [],
        },
      };

      const arcData = enhanceArcWithIntelligence(baseArc, src.vector, '', '');
      tube.userData = { type: 'arc', arcData, clickable: true };
      arcsGroup.add(tube);
    }

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
        rotRef.current.autoRotate = true;
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
      camera.position.z = Math.max(2, Math.min(6, camera.position.z + e.deltaY * 0.002));
    };
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel);

    // Animate
    let animId: number;
    const clock = new THREE.Clock();
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Rotate globe
      if (rotRef.current.autoRotate) {
        rotRef.current.y += 0.0012;
      }
      globe.rotation.x = rotRef.current.x;
      globe.rotation.y = rotRef.current.y;

      // Sync everything with globe rotation
      const globeQ = globe.quaternion.clone();
      scene.traverse((child) => {
        if (child === globe || child === scene) return;
        if (child.type === "Mesh" || child.type === "Line" || child.type === "Points") {
          if ((child as any).material?.size !== 0.15) {
            // Skip stars
            (child as any).quaternion.copy(globeQ);
          }
        }
      });

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

  return { cameraRef, rendererRef, globeRef, arcsGroupRef };
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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 0",
        borderBottom: `1px solid ${COLORS.panelBorder}`,
      }}
    >
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
      <div style={{ flex: 1, fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textPrimary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {v.name.replace("_", " ")}
      </div>
      <SeverityBadge level={v.severity} size="sm" />
      <div style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: trendColor, width: "14px", textAlign: "center" }}>{trendIcon}</div>
      <div style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textSecondary, width: "50px", textAlign: "right" }}>n̂={v.max_branching_ratio.toFixed(3)}</div>
    </div>
  );
}

function TopThreats({ threats }: { threats: Hotspot[] }) {
  return (
    <div>
      {threats.map((t, i) => {
        const col = VECTOR_COLORS[t.vector] || COLORS.textAccent;
        const sevCfg = SEVERITY_CONFIG[t.severity || 1] || SEVERITY_CONFIG[1];
        const barW = `${t.intensity * 100}%`;
        return (
          <div key={i} style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" }}>
              <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: COLORS.textPrimary }}>{t.name}</span>
              <span style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: col, textTransform: "uppercase" }}>{t.vector}</span>
            </div>
            <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: barW,
                  borderRadius: "2px",
                  background: `linear-gradient(90deg, ${col}40, ${col})`,
                  boxShadow: `0 0 8px ${col}60`,
                  transition: "width 1s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px" }}>
              <span style={{ fontSize: "9px", color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
                λ={t.intensity.toFixed(2)} · n̂={t.n_br.toFixed(3)}
              </span>
              <span style={{ fontSize: "9px", color: sevCfg.color, fontFamily: "'JetBrains Mono', monospace" }}>
                {sevCfg.icon} {sevCfg.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────

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
  const [selectedArc, setSelectedArc] = useState<ArcData | null>(null);
  const [arcPanelPos, setArcPanelPos] = useState({ x: 0, y: 0 });
  const [selectedCell, setSelectedCell] = useState<HotspotCellData | null>(null);
  const [cellPanelPos, setCellPanelPos] = useState({ x: 0, y: 0 });
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [isLoadingCell, setIsLoadingCell] = useState(false);

  // Fetch threat data
  useEffect(() => {
    fetchThreatData().then(setData);
    const id = setInterval(() => {
      fetchThreatData().then(setData);
    }, 30000); // Update every 30 seconds
    return () => clearInterval(id);
  }, []);

  // Update clock
  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date());
      setEps(Math.floor(28 + Math.random() * 15));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Initialize globe — now returns refs for click detection
  const { cameraRef, globeRef, arcsGroupRef } = useGlobe(canvasRef, containerRef, data?.top_threats || []);

  // ─── CLICK HANDLER ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = async (event: MouseEvent) => {
      if (!cameraRef.current) return;

      // Don't intercept clicks on overlay panels
      const target = event.target as HTMLElement;
      if (target.closest('.arc-detail-panel') || target.closest('.hotspot-cell-panel')) return;

      const mouse = getMouseNDC(event, canvas as HTMLElement);

      // 1. Try arc first (higher priority)
      if (arcsGroupRef.current) {
        const arcMeshes = arcsGroupRef.current.children.filter((c) => c.userData?.clickable);
        const hit = raycastArcs(mouse, cameraRef.current, arcMeshes);
        if (hit && hit.arc.userData.arcData) {
          const pos = calculatePanelPosition(event.clientX, event.clientY, 600, 500);
          setArcPanelPos(pos);
          setSelectedArc(hit.arc.userData.arcData as ArcData);
          setSelectedCell(null);
          return;
        }
      }

      // 2. Fall through to globe hotspot
      if (globeRef.current) {
        const hit = raycastGlobe(mouse, cameraRef.current, globeRef.current);
        if (hit) {
          const { cellId } = latLonToGridCell(hit.lat, hit.lon);
          setIsLoadingCell(true);
          try {
            let cellData = await fetchCellHistory(cellId);
            if (!cellData) {
              // No backend data — generate plausible mock from real lat/lon
              cellData = generateMockHotspotData({ cellId, lat: hit.lat, lon: hit.lon });
            }
            const pos = calculatePanelPosition(event.clientX, event.clientY, 360, 600);
            setCellPanelPos(pos);
            setSelectedCell(cellData);
            setSelectedArc(null);
          } catch {
            const cellData = generateMockHotspotData({ cellId, lat: hit.lat, lon: hit.lon });
            const pos = calculatePanelPosition(event.clientX, event.clientY, 360, 600);
            setCellPanelPos(pos);
            setSelectedCell(cellData);
            setSelectedArc(null);
          } finally {
            setIsLoadingCell(false);
          }
        }
      }
    };

    const clickWrapper = (e: Event) => handleClick(e as MouseEvent);
    canvas.addEventListener('click', clickWrapper);
    return () => canvas.removeEventListener('click', clickWrapper);
  }, [cameraRef, globeRef, arcsGroupRef]);

  // ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedArc(null); setSelectedCell(null); setShowContextEngine(false); setShowMathLab(false); setShowInfrastructure(false); }
      if (e.key === 'l' || e.key === 'L') setIsLiveMode((v) => !v);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  if (!data) return null;

  const sevCfg = SEVERITY_CONFIG[data.global_threat_level];
  const dateStr = clock.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = clock.toLocaleTimeString("en-US", { hour12: false });

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

      {/* Three.js Canvas */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

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

          {/* ─── MATH LAB BUTTON ─── */}
          <button
            onClick={() => setShowMathLab((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 14px", borderRadius: "4px",
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
              padding: "6px 14px", borderRadius: "4px",
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

          <div
            style={{
              padding: "6px 16px",
              borderRadius: "4px",
              background: `${sevCfg.color}15`,
              border: `1px solid ${sevCfg.color}50`,
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: COLORS.textSecondary, letterSpacing: "0.15em", marginBottom: "2px" }}>GLOBAL THREAT</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "16px",
                fontWeight: 800,
                color: sevCfg.color,
                letterSpacing: "0.08em",
              }}
            >
              {sevCfg.icon} {sevCfg.label}
            </div>
          </div>
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
          <div style={headerFont}>Threat Overview</div>
          <StatCard label="Events / 24h" value={data.total_events_24h.toLocaleString()} sub={`${eps} events/sec`} color={COLORS.textAccent} />
          <StatCard label="Active Vectors" value={data.vectors.length} sub={`${data.top_threats.length} hotspots tracked`} />
          <StatCard
            label="Peak Branching Ratio"
            value={Math.max(...data.vectors.map((v) => v.max_branching_ratio), 0).toFixed(3)}
            sub="n̂ · subcritical < 1.0"
            color={data.global_threat_level >= 4 ? COLORS.warning : COLORS.textAccent}
          />
        </div>

        <div style={panelStyle}>
          <div style={headerFont}>Vector Status</div>
          {data.vectors.map((v) => (
            <VectorRow key={v.name} v={v} />
          ))}
        </div>
      </div>

      {/* ─── RIGHT PANEL ─── */}
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
          <div style={headerFont}>Storm Tracking — Top Threats</div>
          <TopThreats threats={data.top_threats} />
        </div>

        <div style={panelStyle}>
          <div style={headerFont}>Forecast Conditions</div>
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
        </div>

        {/* Legend */}
        <div style={panelStyle}>
          <div style={headerFont}>Vector Legend</div>
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
        </div>
      </div>

      {/* ─── PREDICTIVE CONTEXT ENGINE ─── */}
      {showContextEngine && (
        <PredictiveContextPanel onClose={() => setShowContextEngine(false)} />
      )}

      {/* ─── MATH LAB ─── */}
      {showMathLab && (
        <MathLabPanel onClose={() => setShowMathLab(false)} />
      )}

      {/* ─── INFRASTRUCTURE TOPOLOGY ─── */}
      {showInfrastructure && (
        <InfrastructurePanel onClose={() => setShowInfrastructure(false)} />
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
      <TemporalReplayControls
        onTimeChange={() => setIsLiveMode(false)}
        onPlaybackSpeedChange={() => {}}
        onLiveToggle={(live) => setIsLiveMode(live)}
        isLive={isLiveMode}
      />

      {/* Keyframes */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
        @keyframes pulse-dot {
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
