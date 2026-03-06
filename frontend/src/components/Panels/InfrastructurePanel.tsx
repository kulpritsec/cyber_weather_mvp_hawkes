/**
 * Infrastructure Topology Panel
 *
 * Submarine Cables · Internet Exchange Points · Cloud Regions · Satellite Coverage
 * Live exposure data · Attack flows · Country threat shading
 * Mercator projection SVG map with real 50m country borders
 *
 * Enhanced with:
 *  - Mini 3D rotating globe (Three.js inset)
 *  - Real TeleGeography submarine cable data
 *  - Cloud provider health (Cloudflare PoPs, GCP incidents)
 *  - IODA internet outage detection
 *  - Network flow anomaly correlation
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg: 'rgba(8, 15, 28, 0.97)',
  border: 'rgba(0, 180, 255, 0.18)',
  panel: 'rgba(10, 20, 40, 0.85)',
  text: '#e0eaf8',
  muted: '#5a7da8',
  accent: '#00ccff',
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

const QUERY_COLORS: Record<string, string> = {
  cve_exchange: '#ef4444',
  smb_exposed: '#f97316',
  vnc_open: '#a855f7',
  k12_exposed: '#eab308',
  rdp_exposed: '#3b82f6',
  ssh_exposed: '#22c55e',
  telnet_open: '#ec4899',
  default: '#6b7280',
};

const VECTOR_COLORS: Record<string, string> = {
  ssh: '#00e5ff',
  rdp: '#ff6d00',
  http: '#b388ff',
  dns_amp: '#76ff03',
  brute_force: '#ffab00',
  botnet_c2: '#ff1744',
  ransomware: '#d500f9',
  malware: '#ff5252',
};

// ─── MERCATOR PROJECTION ──────────────────────────────────────────────────────
function mercator(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = (lon + 180) / 360 * w;
  const latRad = lat * Math.PI / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = h / 2 - (mercN * h / (2 * Math.PI));
  return [x, y];
}

// ─── THREE.JS HELPER ──────────────────────────────────────────────────────────
function latLonToVec3(lat: number, lon: number, R: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -R * Math.sin(phi) * Math.cos(theta),
    R * Math.cos(phi),
    R * Math.sin(phi) * Math.sin(theta)
  );
}

// ─── CABLES ───────────────────────────────────────────────────────────────────
interface Cable {
  name: string;
  capacity: string;
  owners: string;
  color: string;
  coords: [number, number][];
}

const CABLES: Cable[] = [
  {
    name: 'TAT-14', capacity: '3.2 Tbps', owners: 'AT&T, BT, DT',
    color: '#00ccff',
    coords: [[-73.9, 40.7], [-50, 42], [-20, 45], [-8, 52], [1, 51], [13, 54]],
  },
  {
    name: 'SEA-ME-WE 6', capacity: '100 Tbps', owners: 'Consortium',
    color: '#f97316',
    coords: [[103.8, 1.3], [100, 5], [80, 8], [65, 23], [43, 12], [32, 31], [30, 31], [10, 43], [3, 43]],
  },
  {
    name: 'JUPITER', capacity: '60 Tbps', owners: 'Google, PLDT, SoftBank',
    color: '#22c55e',
    coords: [[135.5, 34.7], [130, 30], [125, 20], [130, 15], [145, 15], [160, 20], [170, 25], [-160, 25], [-150, 21], [-122, 37]],
  },
  {
    name: 'Curie', capacity: '72 Tbps', owners: 'Google',
    color: '#a855f7',
    coords: [[-118.2, 33.8], [-110, 20], [-85, 10], [-78, 5], [-70, -5], [-55, -25], [-50, -28], [-43, -22]],
  },
  {
    name: '2Africa', capacity: '180 Tbps', owners: 'Meta, MTN, Orange',
    color: '#eab308',
    coords: [
      [-1, 51], [0, 35], [-15, 15], [-17, 14], [-17, 5], [10, 5], [30, -25],
      [35, -15], [40, 5], [43, 11], [50, 15], [55, 25], [55, 26], [32, 31], [10, 43], [0, 38], [-2, 44],
    ],
  },
  {
    name: 'MAREA', capacity: '200 Tbps', owners: 'Meta, Microsoft',
    color: '#ec4899',
    coords: [[-76.5, 37], [-50, 38], [-30, 40], [-15, 42], [-3, 43.5]],
  },
  {
    name: 'Havfrue/AEC-2', capacity: '345 Tbps', owners: 'Google, Aqua Comms',
    color: '#6366f1',
    coords: [[-71, 42], [-45, 50], [-25, 57], [-20, 63], [-15, 65], [8, 55], [10, 57]],
  },
  {
    name: 'SJC2', capacity: '80 Tbps', owners: 'Google',
    color: '#14b8a6',
    coords: [[139.7, 35.7], [145, 30], [155, 15], [165, 15], [170, 13], [172, 13]],
  },
];

// ─── IXPs ─────────────────────────────────────────────────────────────────────
interface IXP {
  name: string;
  lon: number;
  lat: number;
  throughput: string;
  members: number;
  tier: 1 | 2;
}

const IXPS: IXP[] = [
  { name: 'DE-CIX Frankfurt', lon: 8.6,    lat: 50.1,  throughput: '9 Tbps',   members: 1100, tier: 1 },
  { name: 'AMS-IX Amsterdam', lon: 4.9,    lat: 52.4,  throughput: '8 Tbps',   members: 850,  tier: 1 },
  { name: 'LINX London',      lon: -0.1,   lat: 51.5,  throughput: '7 Tbps',   members: 750,  tier: 1 },
  { name: 'Equinix Ashburn',  lon: -77.5,  lat: 38.9,  throughput: '5 Tbps',   members: 500,  tier: 1 },
  { name: 'BBIX Tokyo',       lon: 139.7,  lat: 35.7,  throughput: '3.5 Tbps', members: 200,  tier: 2 },
  { name: 'IX.br Sao Paulo',  lon: -46.6,  lat: -23.5, throughput: '2.5 Tbps', members: 350,  tier: 2 },
  { name: 'HKIX Hong Kong',   lon: 114.2,  lat: 22.3,  throughput: '4 Tbps',   members: 400,  tier: 2 },
  { name: 'SIX Seattle',      lon: -122.3, lat: 47.6,  throughput: '2 Tbps',   members: 250,  tier: 2 },
];

const IXP_STRATEGIC: Record<string, string> = {
  'DE-CIX Frankfurt': 'Largest IXP globally — central European BGP route aggregation point for 1,100+ networks',
  'AMS-IX Amsterdam': 'Second largest IXP — critical Amsterdam Internet hub connecting European and transatlantic traffic',
  'LINX London':      'UK national exchange — major peering hub for European and transatlantic routing',
  'Equinix Ashburn':  'Primary North American peering hub — US East Coast BGP nexus in Equinix data center campus',
  'BBIX Tokyo':       'Primary Japanese IXP — critical Asia-Pacific peering and transit aggregation point',
  'IX.br Sao Paulo':  'Largest Latin American IXP — Brazilian national internet exchange for regional routing',
  'HKIX Hong Kong':   'Asia-Pacific regional hub — major peering point for China and Southeast Asia traffic',
  'SIX Seattle':      'US Pacific Northwest peering hub — connects North American and transpacific routes',
};

// ─── CLOUD REGIONS ────────────────────────────────────────────────────────────
interface CloudRegion {
  provider: 'AWS' | 'Azure' | 'GCP';
  region: string;
  name: string;
  lon: number;
  lat: number;
  az: number;
}

const CLOUD_REGIONS: CloudRegion[] = [
  { provider: 'AWS',   region: 'us-east-1',        name: 'N. Virginia', lon: -77.5,  lat: 38.9,  az: 6 },
  { provider: 'AWS',   region: 'us-west-2',         name: 'Oregon',      lon: -123,   lat: 45.5,  az: 4 },
  { provider: 'AWS',   region: 'eu-west-1',         name: 'Ireland',     lon: -8,     lat: 53.3,  az: 3 },
  { provider: 'AWS',   region: 'eu-central-1',      name: 'Frankfurt',   lon: 8.6,    lat: 50.1,  az: 3 },
  { provider: 'AWS',   region: 'ap-southeast-1',    name: 'Singapore',   lon: 103.8,  lat: 1.3,   az: 3 },
  { provider: 'AWS',   region: 'ap-northeast-1',    name: 'Tokyo',       lon: 139.7,  lat: 35.7,  az: 4 },
  { provider: 'Azure', region: 'eastus',            name: 'East US',     lon: -79,    lat: 36.5,  az: 3 },
  { provider: 'Azure', region: 'westeurope',        name: 'W. Europe',   lon: 4.9,    lat: 52.4,  az: 3 },
  { provider: 'Azure', region: 'southeastasia',     name: 'SE Asia',     lon: 103.8,  lat: 1.3,   az: 2 },
  { provider: 'Azure', region: 'japaneast',         name: 'Japan East',  lon: 139.7,  lat: 35.7,  az: 2 },
  { provider: 'GCP',   region: 'us-east1',          name: 'S. Carolina', lon: -80.5,  lat: 33.8,  az: 3 },
  { provider: 'GCP',   region: 'europe-west1',      name: 'Belgium',     lon: 3.7,    lat: 50.4,  az: 3 },
  { provider: 'GCP',   region: 'asia-southeast1',   name: 'Singapore',   lon: 103.8,  lat: 1.3,   az: 3 },
  { provider: 'GCP',   region: 'asia-northeast1',   name: 'Tokyo',       lon: 139.7,  lat: 35.7,  az: 3 },
];

const PROVIDER_COLORS: Record<string, string> = {
  AWS:   '#f59e0b',
  Azure: '#3b82f6',
  GCP:   '#ef4444',
};

// ─── SATELLITE CONSTELLATIONS ────────────────────────────────────────────────
interface SatConstellation {
  name: string;
  operator: string;
  sats: number;
  latBand: number;
  color: string;
  borderColor: string;
}

const SAT_CONSTELLATIONS: SatConstellation[] = [
  { name: 'Starlink',         operator: 'SpaceX',          sats: 6000, latBand: 70, color: 'rgba(255,255,255,0.06)',   borderColor: 'rgba(255,255,255,0.15)' },
  { name: 'OneWeb',           operator: 'OneWeb/Bharti',   sats: 630,  latBand: 55, color: 'rgba(99,102,241,0.06)',    borderColor: 'rgba(99,102,241,0.2)' },
  { name: 'Kuiper (planned)', operator: 'Amazon',          sats: 3236, latBand: 60, color: 'rgba(245,158,11,0.05)',    borderColor: 'rgba(245,158,11,0.15)' },
];

// ─── DATA TYPES ─────────────────────────────────────────────────────────────
interface ExposurePoint {
  lat: number;
  lon: number;
  query: string;
  ip: string;
  port: number;
  product: string;
  org: string;
  country: string;
  vuln_count: number;
}

interface FlowData {
  source_country: string;
  vector: string;
  event_count: number;
  avg_lat: number;
  avg_lon: number;
  unique_ips: number;
  top_port: number | null;
}

interface CountryThreat {
  code: string;
  lat: number;
  lon: number;
  total: number;
  vectors: Record<string, number>;
  avg_severity: number;
}

interface ExposureSummary {
  total_global_exposure: number;
  query_count: number;
  top_countries: Record<string, number>;
  top_vulns: string[];
  queries: Array<{
    tag: string;
    query: string;
    total_global: number;
    sample_stored: number;
    cves: string[];
    last_updated: string | null;
  }>;
}

interface TimelineSeries {
  [tag: string]: Array<{ timestamp: string; total: number; sample: number }>;
}

interface CountryGeo {
  iso: string;
  name: string;
  path: string;
}

interface SelectedItem {
  type: string;
  name: string;
  detail: string;
  extra?: string;
}

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

// ─── NEW: Live cable from TeleGeography ─────────────────────────────────────
interface LiveCable {
  id: string;
  name: string;
  color: string;
  coordinates: number[][][]; // MultiLineString: array of linestrings, each an array of [lon, lat]
  segmentCount: number;
}

// ─── NEW: Cloud health types ────────────────────────────────────────────────
interface CloudflareComponent {
  name: string;
  status: string;
  group_id: string | null;
  code: string; // extracted airport code
}

interface GCPIncident {
  service_name: string;
  severity: string;
  begin: string;
  end: string | null;
  update_text: string;
}

interface CloudHealthState {
  cfOperational: number;
  cfDegraded: number;
  cfOutage: number;
  cfComponents: CloudflareComponent[];
  gcpIncidents: GCPIncident[];
  loaded: boolean;
}

// ─── NEW: IODA outage types ─────────────────────────────────────────────────
interface IODAOutage {
  country: string;
  countryCode: string;
  datasource: string;
  signalDrop: number; // percentage drop from normal
  severity: 'watch' | 'warning' | 'critical';
}

// ─── NEW: Anomaly correlation types ─────────────────────────────────────────
interface AnomalyCorrelation {
  country: string;
  countryCode: string;
  flowIncrease: number; // percentage
  outageDetected: boolean;
  outageSource: string;
  severity: 'watch' | 'warning' | 'critical';
  explanation: string;
}

// ─── COUNTRY CENTROIDS ───────────────────────────────────────────────────
const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [39.8, -98.5], CA: [56.1, -106.3], MX: [23.6, -102.6], BR: [-14.2, -51.9],
  AR: [-38.4, -63.6], CO: [4.6, -74.3], CL: [-35.7, -71.5], GB: [55.4, -3.4],
  DE: [51.2, 10.4], FR: [46.2, 2.2], NL: [52.1, 5.3], IT: [41.9, 12.6],
  ES: [40.5, -3.7], SE: [60.1, 18.6], PL: [51.9, 19.1], RO: [45.9, 25.0],
  UA: [48.4, 31.2], CH: [46.8, 8.2], AT: [47.5, 14.6], BE: [50.5, 4.5],
  CZ: [49.8, 15.5], FI: [61.9, 25.7], NO: [60.5, 8.5], DK: [56.3, 9.5],
  PT: [39.4, -8.2], GR: [39.1, 21.8], HU: [47.2, 19.5], IE: [53.4, -8.2],
  CN: [35.9, 104.2], RU: [61.5, 105.3], JP: [36.2, 138.3], KR: [35.9, 127.8],
  IN: [20.6, 79.0], ID: [-0.8, 113.9], TH: [15.9, 100.9], VN: [14.1, 108.3],
  TW: [23.7, 121.0], SG: [1.4, 103.8], HK: [22.4, 114.1], MY: [4.2, 102.0],
  PH: [12.9, 121.8], PK: [30.4, 69.3], IR: [32.4, 53.7], IQ: [33.2, 43.7],
  SA: [23.9, 45.1], AE: [23.4, 53.8], IL: [31.1, 34.9], TR: [39.0, 35.2],
  ZA: [-30.6, 22.9], NG: [9.1, 8.7], KE: [-0.02, 37.9], EG: [26.8, 30.8],
  AU: [-25.3, 133.8], NZ: [-40.9, 174.9], BY: [53.7, 28.0],
};

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CN: 'China', RU: 'Russia', DE: 'Germany', GB: 'United Kingdom',
  FR: 'France', JP: 'Japan', KR: 'South Korea', IN: 'India', BR: 'Brazil',
  IR: 'Iran', UA: 'Ukraine', NL: 'Netherlands', PK: 'Pakistan', ID: 'Indonesia',
  TR: 'Turkey', AU: 'Australia', CA: 'Canada', IT: 'Italy', ES: 'Spain',
  VN: 'Vietnam', TH: 'Thailand', MX: 'Mexico', PL: 'Poland', RO: 'Romania',
  ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt', SA: 'Saudi Arabia', AE: 'UAE',
  SG: 'Singapore', TW: 'Taiwan', HK: 'Hong Kong', MY: 'Malaysia', PH: 'Philippines',
  IQ: 'Iraq', IL: 'Israel', SE: 'Sweden', NO: 'Norway', FI: 'Finland',
  DK: 'Denmark', CH: 'Switzerland', AT: 'Austria', BE: 'Belgium', CZ: 'Czechia',
  HU: 'Hungary', GR: 'Greece', PT: 'Portugal', IE: 'Ireland', BY: 'Belarus',
  AR: 'Argentina', CO: 'Colombia', CL: 'Chile', KE: 'Kenya', NZ: 'New Zealand',
};

// ─── PROPS ────────────────────────────────────────────────────────────────────
interface InfrastructurePanelProps {
  onClose: () => void;
}

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────
const Tooltip = ({ text, x, y }: { text: string; x: number; y: number }) => (
  <div style={{
    position: 'absolute', left: x + 10, top: y - 10,
    background: 'rgba(8,15,28,0.95)', border: '1px solid rgba(0,180,255,0.3)',
    borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: C.mono,
    color: C.text, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
    maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis',
  }}>
    {text}
  </div>
);

// ─── TOGGLE BUTTON ────────────────────────────────────────────────────────────
const ToggleBtn = ({
  label, active, onClick, color,
}: { label: string; active: boolean; onClick: () => void; color?: string }) => {
  const c = color || 'rgba(0,204,255';
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${c},0.15)` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? `${c},0.4)` : 'rgba(255,255,255,0.1)'}`,
        borderRadius: '4px', padding: '3px 10px', fontSize: '10px',
        fontFamily: C.mono, color: active ? C.accent : C.muted,
        cursor: 'pointer', transition: 'all 0.15s ease', letterSpacing: '0.04em',
      }}
    >
      {label}
    </button>
  );
};

// ─── SPARKLINE ──────────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 20 }: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return <span style={{ fontSize: '9px', color: C.muted }}>--</span>;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        opacity={0.8}
      />
    </svg>
  );
}

// ─── Convert GeoJSON to Mercator SVG paths ──────────────────────────────────
function geoToSvgPaths(
  geo: any,
  w: number,
  h: number
): CountryGeo[] {
  const results: CountryGeo[] = [];
  if (!geo?.features) return results;

  for (const feature of geo.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    const iso = feature.properties?.ISO_A2 || '';
    const name = feature.properties?.NAME || '';

    let polygons: number[][][][] = [];
    if (geom.type === 'Polygon') {
      polygons = [geom.coordinates];
    } else if (geom.type === 'MultiPolygon') {
      polygons = geom.coordinates;
    } else {
      continue;
    }

    const pathParts: string[] = [];
    for (const polygon of polygons) {
      const ring = polygon[0];
      if (!ring || ring.length < 3) continue;

      const points = ring.map((coord: number[]) => {
        const clampedLat = Math.max(-82, Math.min(82, coord[1]));
        return mercator(coord[0], clampedLat, w, h);
      });

      let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
      for (let i = 1; i < points.length; i++) {
        d += `L${points[i][0].toFixed(1)},${points[i][1].toFixed(1)}`;
      }
      d += 'Z';
      pathParts.push(d);
    }

    if (pathParts.length > 0) {
      results.push({ iso, name, path: pathParts.join(' ') });
    }
  }
  return results;
}

// ─── MINI GLOBE COMPONENT ──────────────────────────────────────────────────
function MiniGlobe({
  liveCables,
  ixps,
  cloudRegions,
  outageCountries,
}: {
  liveCables: LiveCable[];
  ixps: IXP[];
  cloudRegions: CloudRegion[];
  outageCountries: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const markersGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(180, 180);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;

    // Lighting
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0x88bbff, 0.8);
    directional.position.set(5, 3, 5);
    scene.add(directional);

    // Globe
    const globeGeo = new THREE.SphereGeometry(1, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    const globeMat = new THREE.MeshPhongMaterial({
      color: 0x1a3a5c,
      emissive: 0x0a1628,
      emissiveIntensity: 0.3,
      shininess: 15,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);
    globeRef.current = globe;

    // Load texture asynchronously
    textureLoader.load('/earth-night.jpg', (texture) => {
      globeMat.map = texture;
      globeMat.color.set(0xffffff);
      globeMat.needsUpdate = true;
    });

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(1.04, 32, 32);
    const atmosMat = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Markers group (rotates with globe)
    const markersGroup = new THREE.Group();
    globe.add(markersGroup);
    markersGroupRef.current = markersGroup;

    // Add IXP markers as glowing dots
    for (const ixp of ixps) {
      const pos = latLonToVec3(ixp.lat, ixp.lon, 1.01);
      const dotGeo = new THREE.SphereGeometry(0.015, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({
        color: 0x00ccff,
        transparent: true,
        opacity: 0.9,
      });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pos);
      markersGroup.add(dot);

      // Glow ring
      const ringGeo = new THREE.RingGeometry(0.02, 0.035, 16);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ccff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      markersGroup.add(ring);
    }

    // Add cloud region markers as small squares
    for (const cr of cloudRegions) {
      const pos = latLonToVec3(cr.lat, cr.lon, 1.015);
      const sqGeo = new THREE.PlaneGeometry(0.025, 0.025);
      const sqColor = cr.provider === 'AWS' ? 0xf59e0b : cr.provider === 'Azure' ? 0x3b82f6 : 0xef4444;
      const sqMat = new THREE.MeshBasicMaterial({
        color: sqColor,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const sq = new THREE.Mesh(sqGeo, sqMat);
      sq.position.copy(pos);
      sq.lookAt(pos.clone().multiplyScalar(2));
      markersGroup.add(sq);
    }

    // Add cable routes (top 30)
    const topCables = liveCables.slice(0, 30);
    for (const cable of topCables) {
      for (const lineString of cable.coordinates) {
        if (lineString.length < 2) continue;
        const positions: number[] = [];
        // Sample points to avoid too many vertices
        const step = Math.max(1, Math.floor(lineString.length / 50));
        for (let i = 0; i < lineString.length; i += step) {
          const coord = lineString[i];
          const v = latLonToVec3(coord[1], coord[0], 1.005);
          positions.push(v.x, v.y, v.z);
        }
        if (positions.length >= 6) {
          const lineGeo = new THREE.BufferGeometry();
          lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const cableColor = cable.color ? new THREE.Color(cable.color) : new THREE.Color(0x00ccff);
          const lineMat = new THREE.LineBasicMaterial({
            color: cableColor,
            transparent: true,
            opacity: 0.5,
            linewidth: 1,
          });
          markersGroup.add(new THREE.Line(lineGeo, lineMat));
        }
      }
    }

    // Add IODA outage markers as pulsing red dots
    for (const cc of outageCountries) {
      const coords = COUNTRY_COORDS[cc];
      if (!coords) continue;
      const pos = latLonToVec3(coords[0], coords[1], 1.02);
      const outGeo = new THREE.SphereGeometry(0.025, 12, 12);
      const outMat = new THREE.MeshBasicMaterial({
        color: 0xff1744,
        transparent: true,
        opacity: 0.9,
      });
      const outDot = new THREE.Mesh(outGeo, outMat);
      outDot.position.copy(pos);
      outDot.userData = { pulse: true, baseScale: 1 };
      markersGroup.add(outDot);
    }

    // Animation loop
    let time = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      time += 0.016;
      globe.rotation.y += 0.002;

      // Pulse outage markers
      markersGroup.children.forEach(child => {
        if (child.userData?.pulse) {
          const scale = 1 + Math.sin(time * 4) * 0.3;
          child.scale.set(scale, scale, scale);
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
            child.material.opacity = 0.5 + Math.sin(time * 4) * 0.4;
          }
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      scene.clear();
      globeGeo.dispose();
      globeMat.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
    };
  }, [liveCables, ixps, cloudRegions, outageCountries]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={180}
      style={{
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        border: '1px solid rgba(0,180,255,0.2)',
        background: 'rgba(5,10,20,0.8)',
        flexShrink: 0,
      }}
    />
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function InfrastructurePanel({ onClose }: InfrastructurePanelProps) {
  const [showCables, setShowCables] = useState(true);
  const [showIXPs,   setShowIXPs]   = useState(true);
  const [showCloud,  setShowCloud]  = useState(false);
  const [showSat,    setShowSat]    = useState(false);
  const [showExposure, setShowExposure] = useState(true);
  const [showFlows,    setShowFlows]    = useState(true);
  const [showCountryThreat, setShowCountryThreat] = useState(true);
  const [showOutages, setShowOutages] = useState(true);
  const [useLiveCables, setUseLiveCables] = useState(true);

  const [hoveredCable, setHoveredCable] = useState<string | null>(null);
  const [hoveredIXP,   setHoveredIXP]   = useState<string | null>(null);
  const [hoveredCloud, setHoveredCloud] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [tooltip,      setTooltip]      = useState<TooltipState | null>(null);

  // ─── Live data state ──────────────────────────────────
  const [exposurePoints, setExposurePoints] = useState<ExposurePoint[]>([]);
  const [flows, setFlows] = useState<FlowData[]>([]);
  const [countryThreats, setCountryThreats] = useState<CountryThreat[]>([]);
  const [summary, setSummary] = useState<ExposureSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineSeries>({});
  const [countryPaths, setCountryPaths] = useState<CountryGeo[]>([]);
  const [dataStatus, setDataStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  // ─── NEW: Live cables state ──────────────────────────────
  const [liveCables, setLiveCables] = useState<LiveCable[]>([]);
  const [liveCableCount, setLiveCableCount] = useState(0);

  // ─── NEW: Cloud health state ──────────────────────────────
  const [cloudHealth, setCloudHealth] = useState<CloudHealthState>({
    cfOperational: 0, cfDegraded: 0, cfOutage: 0,
    cfComponents: [], gcpIncidents: [], loaded: false,
  });

  // ─── NEW: IODA outage state ──────────────────────────────
  const [iodaOutages, setIodaOutages] = useState<IODAOutage[]>([]);
  const [iodaLoaded, setIodaLoaded] = useState(false);

  // ─── NEW: Anomaly correlations ──────────────────────────────
  const [anomalies, setAnomalies] = useState<AnomalyCorrelation[]>([]);

  const SVG_W = 830;
  const SVG_H = 420;

  // ─── Fetch all live data on mount ─────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const results = await Promise.allSettled([
        fetch('/v1/exposure/geo').then(r => r.ok ? r.json() : null),
        fetch('/v1/flows/top?hours=24&limit=30').then(r => r.ok ? r.json() : null),
        fetch('/v1/top-countries').then(r => r.ok ? r.json() : null),
        fetch('/v1/exposure/summary').then(r => r.ok ? r.json() : null),
        fetch('/v1/exposure/timeline?days=30').then(r => r.ok ? r.json() : null),
        fetch('/countries-50m.json').then(r => r.ok ? r.json() : null)
          .catch(() => fetch('/countries-110m.json').then(r => r.ok ? r.json() : null)),
      ]);

      if (cancelled) return;

      let liveCount = 0;

      // Exposure points
      const geoData = results[0].status === 'fulfilled' ? results[0].value : null;
      if (geoData?.features) {
        setExposurePoints(geoData.features.map((f: any) => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          ...f.properties,
        })));
        liveCount++;
      }

      // Attack flows
      const flowData = results[1].status === 'fulfilled' ? results[1].value : null;
      if (flowData?.flows) {
        setFlows(flowData.flows);
        liveCount++;
      }

      // Country threats
      const countryData = results[2].status === 'fulfilled' ? results[2].value : null;
      if (countryData?.countries) {
        setCountryThreats(countryData.countries);
        liveCount++;
      }

      // Exposure summary
      const summaryData = results[3].status === 'fulfilled' ? results[3].value : null;
      if (summaryData) {
        setSummary(summaryData);
        liveCount++;
      }

      // Timeline
      const timelineData = results[4].status === 'fulfilled' ? results[4].value : null;
      if (timelineData?.series) {
        setTimeline(timelineData.series);
        liveCount++;
      }

      // Country GeoJSON for map
      const geoJson = results[5].status === 'fulfilled' ? results[5].value : null;
      if (geoJson) {
        const paths = geoToSvgPaths(geoJson, SVG_W, SVG_H);
        setCountryPaths(paths);
        liveCount++;
      }

      setDataStatus(liveCount >= 3 ? 'live' : liveCount > 0 ? 'fallback' : 'fallback');
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // ─── NEW: Fetch TeleGeography submarine cable data ──────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchCables() {
      try {
        const results = await Promise.allSettled([
          fetch('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json')
            .then(r => r.ok ? r.json() : null),
        ]);

        if (cancelled) return;

        const cableGeo = results[0].status === 'fulfilled' ? results[0].value : null;
        if (cableGeo?.features && Array.isArray(cableGeo.features)) {
          const parsed: LiveCable[] = [];
          for (const feature of cableGeo.features) {
            if (!feature.properties || !feature.geometry) continue;
            const geom = feature.geometry;
            let coords: number[][][] = [];
            if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
              coords = geom.coordinates;
            } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
              coords = [geom.coordinates];
            } else {
              continue;
            }
            const totalSegments = coords.reduce((sum, ls) => sum + ls.length, 0);
            parsed.push({
              id: feature.properties.id || feature.properties.name || '',
              name: feature.properties.name || 'Unknown',
              color: feature.properties.color || '#00ccff',
              coordinates: coords,
              segmentCount: totalSegments,
            });
          }
          // Sort by segment count (longest cables first)
          parsed.sort((a, b) => b.segmentCount - a.segmentCount);
          setLiveCableCount(parsed.length);
          // Keep top 100 for SVG rendering
          setLiveCables(parsed.slice(0, 100));
        }
      } catch {
        // Fallback: keep using seed cables
        setLiveCables([]);
      }
    }

    fetchCables();
    return () => { cancelled = true; };
  }, []);

  // ─── NEW: Fetch Cloud Health data ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchCloudHealth() {
      const results = await Promise.allSettled([
        fetch('https://yh6f0r4529hb.statuspage.io/api/v2/components.json')
          .then(r => r.ok ? r.json() : null),
        fetch('https://status.cloud.google.com/incidents.json')
          .then(r => r.ok ? r.json() : null),
      ]);

      if (cancelled) return;

      let cfOp = 0, cfDeg = 0, cfOut = 0;
      const cfComps: CloudflareComponent[] = [];
      const gcpIncs: GCPIncident[] = [];

      // Cloudflare components
      const cfData = results[0].status === 'fulfilled' ? results[0].value : null;
      if (cfData?.components && Array.isArray(cfData.components)) {
        for (const comp of cfData.components) {
          // Filter to components with airport codes: name contains (XXX) pattern
          const airportMatch = comp.name?.match(/\(([A-Z]{3})\)/);
          if (!airportMatch) continue;
          const status = comp.status || 'operational';
          const parsed: CloudflareComponent = {
            name: comp.name,
            status,
            group_id: comp.group_id || null,
            code: airportMatch[1],
          };
          cfComps.push(parsed);
          if (status === 'operational') cfOp++;
          else if (status === 'degraded_performance') cfDeg++;
          else if (status === 'partial_outage' || status === 'major_outage') cfOut++;
          else cfOp++; // default to operational
        }
      }

      // GCP incidents
      const gcpData = results[1].status === 'fulfilled' ? results[1].value : null;
      if (Array.isArray(gcpData)) {
        // Get only recent/active incidents (no end date or end within 24h)
        const now = Date.now();
        const dayAgo = now - 86400000;
        for (const inc of gcpData.slice(0, 50)) {
          const endTime = inc.end ? new Date(inc.end).getTime() : null;
          const beginTime = inc.begin ? new Date(inc.begin).getTime() : now;
          const isActive = !endTime || endTime > dayAgo;
          const isRecent = beginTime > dayAgo;
          if (isActive || isRecent) {
            gcpIncs.push({
              service_name: inc.service_name || 'Unknown',
              severity: inc.severity || 'medium',
              begin: inc.begin || '',
              end: inc.end || null,
              update_text: inc['most-recent-update']?.text || inc.external_desc || '',
            });
          }
          if (gcpIncs.length >= 10) break;
        }
      }

      setCloudHealth({
        cfOperational: cfOp, cfDegraded: cfDeg, cfOutage: cfOut,
        cfComponents: cfComps, gcpIncidents: gcpIncs, loaded: true,
      });
    }

    fetchCloudHealth();
    return () => { cancelled = true; };
  }, []);

  // ─── NEW: Fetch IODA outage data ──────────────────────────────
  useEffect(() => {
    if (countryThreats.length === 0) return;
    let cancelled = false;

    async function fetchIODA() {
      // Get top 5 countries by threat count
      const sorted = [...countryThreats].sort((a, b) => b.total - a.total);
      const top5 = sorted.slice(0, 5);

      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - 86400;

      const results = await Promise.allSettled(
        top5.map(ct =>
          fetch(`https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/${ct.code}?from=${dayAgo}&until=${now}`)
            .then(r => r.ok ? r.json() : null)
        )
      );

      if (cancelled) return;

      const outages: IODAOutage[] = [];
      results.forEach((result, idx) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const data = result.value;
        const cc = top5[idx].code;
        const name = COUNTRY_NAMES[cc] || cc;

        // Check each datasource for signal drops
        if (data?.data && Array.isArray(data.data)) {
          for (const ds of data.data) {
            const dsName = ds.datasource || ds.source || 'unknown';
            const values = ds.values || ds.signal || [];
            if (!Array.isArray(values) || values.length < 2) continue;

            // Calculate baseline (average of first half) vs recent (last quarter)
            const midpoint = Math.floor(values.length / 2);
            const baseline = values.slice(0, midpoint).filter((v: number) => v != null && v > 0);
            const recent = values.slice(-Math.floor(values.length / 4)).filter((v: number) => v != null && v > 0);

            if (baseline.length === 0 || recent.length === 0) continue;

            const baselineAvg = baseline.reduce((a: number, b: number) => a + b, 0) / baseline.length;
            const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;

            if (baselineAvg === 0) continue;
            const dropPct = ((baselineAvg - recentAvg) / baselineAvg) * 100;

            // Threshold: >15% drop is significant
            if (dropPct > 15) {
              let severity: 'watch' | 'warning' | 'critical' = 'watch';
              if (dropPct > 50) severity = 'critical';
              else if (dropPct > 30) severity = 'warning';

              outages.push({
                country: name,
                countryCode: cc,
                datasource: dsName,
                signalDrop: Math.round(dropPct),
                severity,
              });
            }
          }
        }
      });

      setIodaOutages(outages);
      setIodaLoaded(true);
    }

    fetchIODA();
    return () => { cancelled = true; };
  }, [countryThreats]);

  // ─── NEW: Compute anomaly correlations ──────────────────────────────
  useEffect(() => {
    if (flows.length === 0 || !iodaLoaded) return;

    // Compute flow volume per country
    const flowByCountry: Record<string, number> = {};
    for (const f of flows) {
      flowByCountry[f.source_country] = (flowByCountry[f.source_country] || 0) + f.event_count;
    }

    // Calculate average flow volume
    const flowValues = Object.values(flowByCountry);
    const avgFlow = flowValues.length > 0
      ? flowValues.reduce((a, b) => a + b, 0) / flowValues.length
      : 0;

    const correlations: AnomalyCorrelation[] = [];

    // Check each country with high flow AND outage
    for (const [cc, total] of Object.entries(flowByCountry)) {
      if (avgFlow === 0) continue;
      const ratio = total / avgFlow;
      const pctIncrease = Math.round((ratio - 1) * 100);

      // Only flag if significantly above average
      if (pctIncrease < 100) continue;

      const countryOutages = iodaOutages.filter(o => o.countryCode === cc);
      const hasOutage = countryOutages.length > 0;

      // Must have both high flow AND outage to correlate
      if (!hasOutage && pctIncrease < 300) continue;

      let severity: 'watch' | 'warning' | 'critical' = 'watch';
      if (hasOutage && pctIncrease > 300) severity = 'critical';
      else if (hasOutage && pctIncrease > 150) severity = 'warning';
      else if (pctIncrease > 400) severity = 'warning';

      const name = COUNTRY_NAMES[cc] || cc;
      const outageDesc = hasOutage
        ? countryOutages.map(o => `${o.datasource} ${o.signalDrop}% drop`).join(', ')
        : 'no connectivity drop detected';

      let explanation = '';
      if (hasOutage && pctIncrease > 200) {
        explanation = `${name}: ${pctIncrease}% flow increase + ${outageDesc} — possible coordinated attack or infrastructure disruption`;
      } else if (hasOutage) {
        explanation = `${name}: ${pctIncrease}% flow increase + ${outageDesc} — monitoring for escalation`;
      } else {
        explanation = `${name}: ${pctIncrease}% flow increase above baseline — anomalous traffic volume`;
      }

      correlations.push({
        country: name,
        countryCode: cc,
        flowIncrease: pctIncrease,
        outageDetected: hasOutage,
        outageSource: hasOutage ? countryOutages[0].datasource : '',
        severity,
        explanation,
      });
    }

    // Sort by severity then flow increase
    const severityOrder = { critical: 0, warning: 1, watch: 2 };
    correlations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.flowIncrease - a.flowIncrease);

    setAnomalies(correlations.slice(0, 10));
  }, [flows, iodaOutages, iodaLoaded]);

  // Convert lon/lat to SVG coords
  const m = (lon: number, lat: number): [number, number] => mercator(lon, lat, SVG_W, SVG_H);

  // Build polyline points string
  const cablePoints = (coords: [number, number][]) =>
    coords.map(([lon, lat]) => m(lon, lat).join(',')).join(' ');

  // Handle mouse move on SVG container
  const handleSvgMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip(prev =>
      prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
    );
  };

  // Click handlers
  const selectCable = (cable: Cable) => {
    setSelectedItem({
      type: 'cable', name: cable.name,
      detail: `Capacity: ${cable.capacity} | Owners: ${cable.owners}`,
    });
  };
  const selectIXP = (ixp: IXP) => {
    setSelectedItem({
      type: 'ixp', name: ixp.name,
      detail: `${ixp.throughput} peak throughput · ${ixp.members} member networks`,
      extra: IXP_STRATEGIC[ixp.name],
    });
  };
  const selectCloud = (r: CloudRegion) => {
    setSelectedItem({
      type: 'cloud', name: `${r.provider} ${r.name}`,
      detail: `Region: ${r.region} · ${r.az} Availability Zones`,
    });
  };

  // Country threat color
  const maxThreat = Math.max(...countryThreats.map(c => c.total), 1);

  // Countries with IODA outages for special rendering
  const outageCountryCodes = new Set(iodaOutages.map(o => o.countryCode));
  // Countries with anomaly escalation
  const escalationCodes = new Set(anomalies.filter(a => a.severity === 'critical').map(a => a.countryCode));

  const getCountryFill = (iso: string): string => {
    if (showOutages && escalationCodes.has(iso)) return 'rgba(255,23,68,0.45)';
    if (showOutages && outageCountryCodes.has(iso)) return 'rgba(255,152,0,0.35)';
    if (!showCountryThreat) return 'rgba(20,40,80,0.45)';
    const ct = countryThreats.find(c => c.code === iso);
    if (!ct) return 'rgba(20,40,80,0.45)';
    const norm = Math.min(ct.total / maxThreat, 1);
    if (norm > 0.7) return `rgba(239,68,68,${0.2 + norm * 0.35})`;
    if (norm > 0.4) return `rgba(249,115,22,${0.15 + norm * 0.3})`;
    if (norm > 0.2) return `rgba(234,179,8,${0.1 + norm * 0.25})`;
    return `rgba(34,197,94,${0.05 + norm * 0.2})`;
  };

  const getCountryStroke = (iso: string): string => {
    if (showOutages && escalationCodes.has(iso)) return 'rgba(255,23,68,0.7)';
    if (showOutages && outageCountryCodes.has(iso)) return 'rgba(255,152,0,0.5)';
    return 'rgba(40,80,140,0.4)';
  };

  const getCountryStrokeWidth = (iso: string): number => {
    if (showOutages && (escalationCodes.has(iso) || outageCountryCodes.has(iso))) return 1.2;
    return 0.4;
  };

  // Cloud region health status color
  const getCloudRegionHealthBorder = useCallback((region: CloudRegion): string => {
    if (!cloudHealth.loaded) return PROVIDER_COLORS[region.provider];
    // Check if any CF components near this region have issues
    const degradedComps = cloudHealth.cfComponents.filter(c =>
      c.status === 'degraded_performance'
    );
    const outageComps = cloudHealth.cfComponents.filter(c =>
      c.status === 'partial_outage' || c.status === 'major_outage'
    );

    // Check GCP incidents for GCP regions
    if (region.provider === 'GCP') {
      const activeGCP = cloudHealth.gcpIncidents.filter(i => !i.end);
      if (activeGCP.length > 0) return '#ff9800';
    }

    if (outageComps.length > 0) return '#ef4444';
    if (degradedComps.length > 0) return '#ff9800';
    return '#22c55e';
  }, [cloudHealth]);

  // Grid lines
  const latLines = [-60, -30, 0, 30, 60];
  const lonLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

  // Flow arrow targets
  const getFlowTarget = (flow: FlowData): [number, number] => {
    const targets: [number, number][] = [
      [-77.5, 38.9], [8.6, 50.1], [139.7, 35.7], [-122.3, 47.6],
      [4.9, 52.4], [103.8, 1.3], [-46.6, -23.5], [114.2, 22.3],
    ];
    const srcCoords = COUNTRY_COORDS[flow.source_country];
    if (!srcCoords) return targets[0];
    let best = targets[0];
    let bestDist = 0;
    for (const t of targets) {
      const d = Math.abs(srcCoords[1] - t[0]) + Math.abs(srcCoords[0] - t[1]);
      if (d > bestDist) { bestDist = d; best = t; }
    }
    return best;
  };

  // Determine which cables to render on SVG
  const activeSeedCables = CABLES;
  const shouldUseLive = useLiveCables && liveCables.length > 0;

  // Severity color helpers
  const severityColor = (sev: 'watch' | 'warning' | 'critical') => {
    if (sev === 'critical') return '#ff1744';
    if (sev === 'warning') return '#ff9800';
    return '#eab308';
  };
  const severityBg = (sev: 'watch' | 'warning' | 'critical') => {
    if (sev === 'critical') return 'rgba(255,23,68,0.15)';
    if (sev === 'warning') return 'rgba(255,152,0,0.12)';
    return 'rgba(234,179,8,0.1)';
  };

  return (
    <div style={{
      position: 'fixed', top: '60px', left: '16px',
      width: '900px', maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 80px)', overflow: 'hidden',
      zIndex: 1200, borderRadius: '10px',
      background: C.bg, border: `1px solid ${C.border}`,
      boxShadow: '0 8px 60px rgba(0,0,0,0.7)', backdropFilter: 'blur(24px)',
      display: 'flex', flexDirection: 'column',
      fontFamily: C.mono,
    }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '10px 16px 8px', borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        {/* Title row with mini globe */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: C.accent, letterSpacing: '0.06em' }}>
                  INFRASTRUCTURE TOPOLOGY
                </div>
                <div style={{ fontSize: '10px', color: C.muted, marginTop: '2px', letterSpacing: '0.04em' }}>
                  Cables · IXPs · Cloud · Exposure · Attack Flows · Threat Map · Outages
                </div>
              </div>
              {/* Live data badge */}
              <div style={{
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                padding: '2px 8px', borderRadius: '3px',
                background: dataStatus === 'live' ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
                color: dataStatus === 'live' ? '#22c55e' : '#eab308',
                border: `1px solid ${dataStatus === 'live' ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.3)'}`,
              }}>
                {dataStatus === 'loading' ? 'LOADING' : dataStatus === 'live' ? 'LIVE DATA' : 'PARTIAL'}
              </div>
              {/* Cable count badge */}
              {liveCableCount > 0 && (
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  padding: '2px 8px', borderRadius: '3px',
                  background: 'rgba(0,204,255,0.1)',
                  color: C.accent,
                  border: '1px solid rgba(0,204,255,0.25)',
                }}>
                  {liveCableCount} CABLES
                </div>
              )}
              {/* IODA badge */}
              {iodaOutages.length > 0 && (
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  padding: '2px 8px', borderRadius: '3px',
                  background: 'rgba(255,23,68,0.12)',
                  color: '#ff1744',
                  border: '1px solid rgba(255,23,68,0.3)',
                }}>
                  {iodaOutages.length} OUTAGE{iodaOutages.length !== 1 ? 'S' : ''}
                </div>
              )}
            </div>

            {/* ── EXPOSURE SUMMARY STATS BAR ── */}
            {summary && (
              <div style={{
                display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center',
                padding: '4px 0',
              }}>
                <div style={{ fontSize: '10px', color: C.muted }}>
                  GLOBAL EXPOSURE:
                  <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: '4px' }}>
                    {summary.total_global_exposure.toLocaleString()}
                  </span>
                </div>
                {summary.queries.map(q => (
                  <div key={q.tag} style={{
                    fontSize: '9px', color: C.muted,
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <span style={{
                      display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                      background: QUERY_COLORS[q.tag] || QUERY_COLORS.default,
                    }} />
                    <span style={{ color: C.text }}>{q.tag.replace(/_/g, ' ')}</span>
                    <span>{q.total_global.toLocaleString()}</span>
                    {timeline[q.tag] && timeline[q.tag].length > 1 && (
                      <Sparkline
                        data={timeline[q.tag].map(p => p.total)}
                        color={QUERY_COLORS[q.tag] || QUERY_COLORS.default}
                        width={50}
                        height={14}
                      />
                    )}
                  </div>
                ))}
                {summary.top_vulns.length > 0 && (
                  <div style={{ fontSize: '9px', color: C.muted }}>
                    TOP CVE:
                    <span style={{ color: '#ef4444', marginLeft: '4px' }}>
                      {summary.top_vulns.slice(0, 3).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mini 3D Globe (top-right) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
            <MiniGlobe
              liveCables={liveCables}
              ixps={IXPS}
              cloudRegions={CLOUD_REGIONS}
              outageCountries={Array.from(outageCountryCodes)}
            />
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
                borderRadius: '4px', color: C.muted, fontSize: '10px',
                padding: '2px 12px', cursor: 'pointer',
                fontFamily: C.mono, letterSpacing: '0.06em',
              }}
            >
              CLOSE
            </button>
          </div>
        </div>

        {/* Toggle row */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <ToggleBtn label="CABLES" active={showCables} onClick={() => setShowCables(v => !v)} />
          <ToggleBtn label="IXPs"   active={showIXPs}   onClick={() => setShowIXPs(v => !v)} />
          <ToggleBtn label="CLOUD"  active={showCloud}  onClick={() => setShowCloud(v => !v)} />
          <ToggleBtn label="SAT"    active={showSat}    onClick={() => setShowSat(v => !v)} />
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
          <ToggleBtn label="EXPOSURE" active={showExposure} onClick={() => setShowExposure(v => !v)} color="rgba(239,68,68" />
          <ToggleBtn label="FLOWS"    active={showFlows}    onClick={() => setShowFlows(v => !v)} color="rgba(0,229,255" />
          <ToggleBtn label="THREATS"  active={showCountryThreat} onClick={() => setShowCountryThreat(v => !v)} color="rgba(249,115,22" />
          <ToggleBtn label="OUTAGES"  active={showOutages} onClick={() => setShowOutages(v => !v)} color="rgba(255,23,68" />
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
          {liveCableCount > 0 && (
            <ToggleBtn
              label={useLiveCables ? 'LIVE CABLES' : 'SEED CABLES'}
              active={useLiveCables}
              onClick={() => setUseLiveCables(v => !v)}
              color="rgba(20,184,166"
            />
          )}
        </div>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{ overflowY: 'auto', flexGrow: 1, padding: '10px 16px 16px' }}>

        {/* ── MAP ── */}
        <div
          style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', cursor: 'crosshair' }}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg
            width={SVG_W}
            height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ display: 'block', background: 'rgba(5,12,25,1)', maxWidth: '100%' }}
          >
            {/* SVG defs for outage pattern */}
            <defs>
              <pattern id="outage-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,23,68,0.3)" strokeWidth="1.5" />
              </pattern>
            </defs>

            {/* ── GRID ── */}
            {latLines.map(lat => {
              const [, y] = m(0, lat);
              const isEquator = lat === 0;
              return (
                <line
                  key={`lat${lat}`}
                  x1={0} y1={y} x2={SVG_W} y2={y}
                  stroke={isEquator ? 'rgba(0,180,255,0.15)' : 'rgba(0,180,255,0.06)'}
                  strokeWidth={isEquator ? 0.8 : 0.4}
                />
              );
            })}
            {lonLines.map(lon => {
              const [x] = m(lon, 0);
              return (
                <line
                  key={`lon${lon}`}
                  x1={x} y1={0} x2={x} y2={SVG_H}
                  stroke="rgba(0,180,255,0.06)"
                  strokeWidth={0.4}
                />
              );
            })}

            {/* ── COUNTRIES (50m GeoJSON) with threat shading ── */}
            {countryPaths.map(cp => (
              <g key={cp.iso + cp.name}>
                <path
                  d={cp.path}
                  fill={getCountryFill(cp.iso)}
                  stroke={getCountryStroke(cp.iso)}
                  strokeWidth={getCountryStrokeWidth(cp.iso)}
                  onMouseEnter={(e) => {
                    const ct = countryThreats.find(c => c.code === cp.iso);
                    const outage = iodaOutages.find(o => o.countryCode === cp.iso);
                    if (ct || cp.name || outage) {
                      const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                      let text = '';
                      if (ct) {
                        text = `${cp.name} (${cp.iso}) · ${ct.total.toLocaleString()} events · Top: ${Object.entries(ct.vectors).sort((a,b) => b[1]-a[1]).slice(0,2).map(([v,c]) => `${v} ${c.toLocaleString()}`).join(', ')}`;
                      } else {
                        text = `${cp.name} (${cp.iso})`;
                      }
                      if (outage) {
                        text += ` | OUTAGE: ${outage.datasource} ${outage.signalDrop}% drop`;
                      }
                      setTooltip({
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0),
                        text,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                />
                {/* Outage hatch overlay */}
                {showOutages && outageCountryCodes.has(cp.iso) && (
                  <path
                    d={cp.path}
                    fill="url(#outage-hatch)"
                    stroke="none"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </g>
            ))}

            {/* ── SAT BANDS ── */}
            {showSat && SAT_CONSTELLATIONS.map(sat => {
              const [, yTop]    = m(0,  sat.latBand);
              const [, yBottom] = m(0, -sat.latBand);
              const [xRight]    = m(180, 0);
              return (
                <g key={sat.name}>
                  <rect x={0} y={yTop} width={SVG_W} height={yBottom - yTop}
                    fill={sat.color} stroke="none" />
                  <line x1={0} y1={yTop} x2={SVG_W} y2={yTop}
                    stroke={sat.borderColor} strokeWidth={0.6} strokeDasharray="4 3" />
                  <line x1={0} y1={yBottom} x2={SVG_W} y2={yBottom}
                    stroke={sat.borderColor} strokeWidth={0.6} strokeDasharray="4 3" />
                  <text x={xRight - 4} y={yTop + 10} textAnchor="end" fontSize={7}
                    fill={sat.borderColor} fontFamily={C.mono}>
                    {sat.name} · {sat.sats.toLocaleString()} sats
                  </text>
                </g>
              );
            })}

            {/* ── LIVE CABLES from TeleGeography ── */}
            {showCables && shouldUseLive && liveCables.map((cable, ci) => {
              const isHovered = hoveredCable === cable.name;
              return (
                <g key={`live-${cable.id || ci}`}>
                  {cable.coordinates.map((lineString, lsi) => {
                    if (lineString.length < 2) return null;
                    // Sample every Nth point for performance
                    const step = Math.max(1, Math.floor(lineString.length / 80));
                    const sampled = lineString.filter((_, idx) => idx % step === 0 || idx === lineString.length - 1);
                    const pts = sampled.map(coord => {
                      const clampedLat = Math.max(-82, Math.min(82, coord[1]));
                      const [px, py] = m(coord[0], clampedLat);
                      return `${px.toFixed(1)},${py.toFixed(1)}`;
                    }).join(' ');
                    return (
                      <polyline
                        key={`ls-${lsi}`}
                        points={pts}
                        stroke={cable.color || '#00ccff'}
                        strokeWidth={isHovered ? 2 : 0.8}
                        opacity={isHovered ? 0.9 : 0.35}
                        fill="none"
                        style={isHovered
                          ? { filter: `drop-shadow(0 0 3px ${cable.color || '#00ccff'})`, cursor: 'pointer' }
                          : { cursor: 'pointer' }}
                        onMouseEnter={e => {
                          setHoveredCable(cable.name);
                          const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                          setTooltip({
                            x: e.clientX - (rect?.left ?? 0),
                            y: e.clientY - (rect?.top ?? 0),
                            text: `${cable.name} (TeleGeography live data)`,
                          });
                        }}
                        onMouseLeave={() => { setHoveredCable(null); setTooltip(null); }}
                        onClick={() => setSelectedItem({
                          type: 'cable', name: cable.name,
                          detail: `Live submarine cable data from TeleGeography · ${cable.segmentCount} coordinate segments`,
                          extra: 'Source: submarinecablemap.com — real-time infrastructure mapping',
                        })}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* ── SEED CABLES (fallback) ── */}
            {showCables && !shouldUseLive && activeSeedCables.map(cable => {
              const isHovered = hoveredCable === cable.name;
              const pts = cablePoints(cable.coords);
              const [startLon, startLat] = cable.coords[0];
              const [endLon,   endLat]   = cable.coords[cable.coords.length - 1];
              const [sx, sy] = m(startLon, startLat);
              const [ex, ey] = m(endLon,   endLat);
              return (
                <g key={cable.name}>
                  <polyline
                    points={pts}
                    stroke={cable.color}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    opacity={isHovered ? 1 : 0.6}
                    fill="none"
                    style={isHovered
                      ? { filter: `drop-shadow(0 0 4px ${cable.color})`, cursor: 'pointer' }
                      : { cursor: 'pointer' }}
                    onMouseEnter={e => {
                      setHoveredCable(cable.name);
                      const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top  ?? 0),
                        text: `${cable.name} · ${cable.capacity} · ${cable.owners}`,
                      });
                    }}
                    onMouseLeave={() => { setHoveredCable(null); setTooltip(null); }}
                    onClick={() => selectCable(cable)}
                  />
                  <circle cx={sx} cy={sy} r={2.5} fill={cable.color} style={{ pointerEvents: 'none' }} />
                  <circle cx={ex} cy={ey} r={2.5} fill={cable.color} style={{ pointerEvents: 'none' }} />
                </g>
              );
            })}

            {/* ── ATTACK FLOW ARROWS ── */}
            {showFlows && flows.slice(0, 20).map((flow, i) => {
              const srcCoords = COUNTRY_COORDS[flow.source_country];
              if (!srcCoords) return null;
              const [srcLat, srcLon] = srcCoords;
              const tgt = getFlowTarget(flow);
              const [sx, sy] = m(srcLon, srcLat);
              const [ex, ey] = m(tgt[0], tgt[1]);
              const mx = (sx + ex) / 2;
              const my = Math.min(sy, ey) - Math.abs(ex - sx) * 0.15 - 15;
              const color = VECTOR_COLORS[flow.vector] || '#6b7280';
              const thickness = Math.max(0.8, Math.min(3, Math.log10(flow.event_count + 1) * 0.6));
              return (
                <g key={`flow-${i}`}>
                  <path
                    d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={thickness}
                    opacity={0.5}
                    strokeDasharray="4 2"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => {
                      const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0),
                        text: `${flow.source_country} > ${flow.vector} · ${flow.event_count.toLocaleString()} events · ${flow.unique_ips} IPs${flow.top_port ? ` · port ${flow.top_port}` : ''}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => setSelectedItem({
                      type: 'flow', name: `${flow.source_country} > ${flow.vector}`,
                      detail: `${flow.event_count.toLocaleString()} events · ${flow.unique_ips} unique IPs${flow.top_port ? ` · port ${flow.top_port}` : ''}`,
                      extra: `Source coordinates: ${flow.avg_lat.toFixed(2)}, ${flow.avg_lon.toFixed(2)}`,
                    })}
                  />
                  <circle cx={ex} cy={ey} r={2} fill={color} opacity={0.7} style={{ pointerEvents: 'none' }} />
                  <circle cx={sx} cy={sy} r={1.5} fill={color} opacity={0.5} style={{ pointerEvents: 'none' }} />
                </g>
              );
            })}

            {/* ── EXPOSURE POINTS ── */}
            {showExposure && exposurePoints.map((ep, i) => {
              const [px, py] = m(ep.lon, ep.lat);
              const color = QUERY_COLORS[ep.query] || QUERY_COLORS.default;
              const r = ep.vuln_count > 0 ? 3.5 : 2;
              return (
                <circle
                  key={`exp-${i}`}
                  cx={px} cy={py} r={r}
                  fill={color}
                  opacity={0.6}
                  stroke={ep.vuln_count > 0 ? '#ffffff' : 'none'}
                  strokeWidth={ep.vuln_count > 0 ? 0.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => {
                    const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top ?? 0),
                      text: `${ep.ip}:${ep.port} · ${ep.product || 'unknown'} · ${ep.org || ''} · ${ep.country}${ep.vuln_count > 0 ? ` · ${ep.vuln_count} CVEs` : ''}`,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => setSelectedItem({
                    type: 'exposure', name: `${ep.ip}:${ep.port}`,
                    detail: `${ep.query.replace(/_/g, ' ')} · ${ep.product || 'unknown service'} · ${ep.org || 'unknown org'} · ${ep.country}`,
                    extra: ep.vuln_count > 0 ? `${ep.vuln_count} known vulnerabilities` : undefined,
                  })}
                />
              );
            })}

            {/* ── OUTAGE MARKERS on map ── */}
            {showOutages && iodaOutages.map((outage, i) => {
              const coords = COUNTRY_COORDS[outage.countryCode];
              if (!coords) return null;
              const [px, py] = m(coords[1], coords[0]);
              const color = severityColor(outage.severity);
              return (
                <g key={`outage-marker-${i}`}>
                  <circle cx={px} cy={py} r={8} fill="none" stroke={color} strokeWidth={1.5} opacity={0.6}>
                    <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={px} cy={py} r={4} fill={color} opacity={0.8} />
                  <text x={px} y={py - 10} textAnchor="middle" fontSize={7} fill={color} fontFamily={C.mono} fontWeight={700}>
                    {outage.countryCode}
                  </text>
                </g>
              );
            })}

            {/* ── IXPs ── */}
            {showIXPs && IXPS.map(ixp => {
              const [px, py] = m(ixp.lon, ixp.lat);
              const innerR   = ixp.tier === 1 ? 5 : 3.5;
              const outerR   = ixp.tier === 1 ? 14 : 10;
              const animMax  = ixp.tier === 1 ? 20 : 16;
              const abbreviated = ixp.name.split(' ').slice(0, 2).join(' ');
              return (
                <g
                  key={ixp.name}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => {
                    setHoveredIXP(ixp.name);
                    const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top  ?? 0),
                      text: `${ixp.name} · ${ixp.throughput} · ${ixp.members} members`,
                    });
                  }}
                  onMouseLeave={() => { setHoveredIXP(null); setTooltip(null); }}
                  onClick={() => selectIXP(ixp)}
                >
                  <circle cx={px} cy={py} r={outerR}
                    fill="none" stroke="rgba(0,204,255,0.3)" strokeWidth={1}>
                    <animate attributeName="r" values={`${outerR};${animMax};${outerR}`} dur="3s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={px} cy={py} r={innerR}
                    fill="rgba(0,204,255,0.8)" stroke="#00ccff" strokeWidth={1}
                    opacity={hoveredIXP === ixp.name ? 1 : 0.85} />
                  <text x={px} y={py + innerR + 8} textAnchor="middle" fontSize={6.5}
                    fill={C.muted} fontFamily={C.mono}>
                    {abbreviated}
                  </text>
                </g>
              );
            })}

            {/* ── CLOUD REGIONS ── */}
            {showCloud && CLOUD_REGIONS.map(r => {
              const [px, py] = m(r.lon, r.lat);
              const color    = PROVIDER_COLORS[r.provider];
              const key      = `${r.provider}-${r.region}`;
              const isHov    = hoveredCloud === key;
              const sz       = 7;
              const healthBorder = getCloudRegionHealthBorder(r);
              return (
                <g
                  key={key}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => {
                    setHoveredCloud(key);
                    const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top  ?? 0),
                      text: `${r.provider} · ${r.region} · ${r.name} · ${r.az} AZs`,
                    });
                  }}
                  onMouseLeave={() => { setHoveredCloud(null); setTooltip(null); }}
                  onClick={() => selectCloud(r)}
                >
                  <rect
                    x={px - sz / 2} y={py - sz / 2} width={sz} height={sz}
                    rx={2}
                    fill={`${color}22`}
                    stroke={healthBorder}
                    strokeWidth={isHov ? 1.8 : 1}
                    opacity={isHov ? 1 : 0.8}
                    style={isHov ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined}
                  />
                  {/* Health indicator dot */}
                  {cloudHealth.loaded && (
                    <circle
                      cx={px + sz / 2 + 2} cy={py - sz / 2 - 2} r={2}
                      fill={healthBorder}
                      opacity={0.9}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Floating tooltip */}
          {tooltip && <Tooltip text={tooltip.text} x={tooltip.x} y={tooltip.y} />}
        </div>

        {/* ── SELECTED ITEM DETAIL ── */}
        {selectedItem && (
          <div style={{
            marginTop: '8px',
            background: 'rgba(10,20,40,0.9)',
            border: '1px solid rgba(0,180,255,0.2)',
            borderRadius: '6px', padding: '10px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: C.accent, marginBottom: '3px' }}>
                  {selectedItem.type === 'cable' && '[CABLE]'}
                  {selectedItem.type === 'ixp'   && '[IXP]'}
                  {selectedItem.type === 'cloud'  && '[CLOUD]'}
                  {selectedItem.type === 'flow'   && '[FLOW]'}
                  {selectedItem.type === 'exposure' && '[EXPOSURE]'}
                  {' '}{selectedItem.name}
                </div>
                <div style={{ fontSize: '11px', color: C.text, marginBottom: '4px' }}>
                  {selectedItem.detail}
                </div>
                {selectedItem.extra && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>
                    {selectedItem.extra}
                  </div>
                )}
                {selectedItem.type === 'cable' && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic', marginTop: '2px' }}>
                    Submarine cable systems are critical internet backbone infrastructure — physical
                    disruption or wiretapping events on these routes have significant global impact.
                  </div>
                )}
                {selectedItem.type === 'cloud' && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic', marginTop: '2px' }}>
                    Cloud availability zones provide redundancy within a region.
                    Outages or latency events affect all co-located workloads.
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                style={{
                  background: 'none', border: 'none', color: C.muted,
                  fontSize: '14px', cursor: 'pointer', flexShrink: 0,
                }}
              >
                x
              </button>
            </div>
          </div>
        )}

        {/* ── CLOUD HEALTH & INTERNET HEALTH CARDS ── */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
          {/* ── CLOUD HEALTH CARD ── */}
          <div style={{
            flex: '1 1 380px', minWidth: '300px',
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: '6px', padding: '10px 14px',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, color: C.accent,
              letterSpacing: '0.08em', marginBottom: '8px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              CLOUD HEALTH
              {cloudHealth.loaded && (
                <span style={{
                  fontSize: '8px', fontWeight: 400, color: C.muted,
                  padding: '1px 6px', borderRadius: '3px',
                  background: 'rgba(255,255,255,0.05)',
                }}>
                  {cloudHealth.cfComponents.length} PoPs
                </span>
              )}
            </div>

            {!cloudHealth.loaded ? (
              <div style={{ fontSize: '10px', color: C.muted }}>Loading cloud health data...</div>
            ) : (
              <>
                {/* Cloudflare PoP summary */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, letterSpacing: '0.06em', marginBottom: '4px' }}>
                    CLOUDFLARE PoP STATUS
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
                      <span style={{ fontSize: '10px', color: C.text }}>{cloudHealth.cfOperational}</span>
                      <span style={{ fontSize: '9px', color: C.muted }}>operational</span>
                    </div>
                    {cloudHealth.cfDegraded > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff9800' }} />
                        <span style={{ fontSize: '10px', color: '#ff9800', fontWeight: 700 }}>{cloudHealth.cfDegraded}</span>
                        <span style={{ fontSize: '9px', color: C.muted }}>degraded</span>
                      </div>
                    )}
                    {cloudHealth.cfOutage > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                        <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: 700 }}>{cloudHealth.cfOutage}</span>
                        <span style={{ fontSize: '9px', color: C.muted }}>outage</span>
                      </div>
                    )}
                  </div>
                  {/* List degraded / outage components */}
                  {cloudHealth.cfComponents.filter(c => c.status !== 'operational').length > 0 && (
                    <div style={{ marginTop: '6px', maxHeight: '80px', overflowY: 'auto' }}>
                      {cloudHealth.cfComponents.filter(c => c.status !== 'operational').slice(0, 8).map((comp, i) => (
                        <div key={i} style={{
                          fontSize: '9px', color: comp.status.includes('outage') ? '#ef4444' : '#ff9800',
                          padding: '1px 0',
                        }}>
                          {comp.code} {comp.name.split('(')[0].trim()} — {comp.status.replace(/_/g, ' ')}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* GCP incidents */}
                <div>
                  <div style={{ fontSize: '9px', color: C.muted, letterSpacing: '0.06em', marginBottom: '4px' }}>
                    GCP INCIDENTS ({cloudHealth.gcpIncidents.length})
                  </div>
                  {cloudHealth.gcpIncidents.length === 0 ? (
                    <div style={{ fontSize: '10px', color: '#22c55e' }}>No active incidents</div>
                  ) : (
                    <div style={{ maxHeight: '80px', overflowY: 'auto' }}>
                      {cloudHealth.gcpIncidents.slice(0, 5).map((inc, i) => (
                        <div key={i} style={{
                          fontSize: '9px', padding: '3px 0',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                        }}>
                          <div style={{
                            color: inc.severity === 'high' ? '#ef4444' : inc.severity === 'medium' ? '#ff9800' : '#eab308',
                            fontWeight: 700,
                          }}>
                            {inc.service_name} [{inc.severity}]
                            {!inc.end && <span style={{ color: '#ff1744', marginLeft: '6px' }}>ACTIVE</span>}
                          </div>
                          <div style={{ color: C.muted, fontSize: '8px', marginTop: '1px' }}>
                            {inc.update_text.slice(0, 120)}{inc.update_text.length > 120 ? '...' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── INTERNET HEALTH CARD (IODA) ── */}
          <div style={{
            flex: '1 1 380px', minWidth: '300px',
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: '6px', padding: '10px 14px',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, color: C.accent,
              letterSpacing: '0.08em', marginBottom: '8px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              INTERNET HEALTH
              <span style={{
                fontSize: '8px', fontWeight: 400, color: C.muted,
                padding: '1px 6px', borderRadius: '3px',
                background: 'rgba(255,255,255,0.05)',
              }}>
                IODA
              </span>
              {iodaOutages.length > 0 && (
                <span style={{
                  fontSize: '8px', fontWeight: 700,
                  padding: '1px 6px', borderRadius: '3px',
                  background: 'rgba(255,23,68,0.15)',
                  color: '#ff1744',
                }}>
                  {iodaOutages.length} ALERT{iodaOutages.length !== 1 ? 'S' : ''}
                </span>
              )}
            </div>

            {!iodaLoaded ? (
              <div style={{ fontSize: '10px', color: C.muted }}>Loading IODA outage data...</div>
            ) : iodaOutages.length === 0 ? (
              <div style={{ fontSize: '10px', color: '#22c55e' }}>
                No significant connectivity drops detected in monitored countries
              </div>
            ) : (
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {iodaOutages.map((outage, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    padding: '5px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: severityColor(outage.severity),
                      marginTop: '2px', flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: C.text, fontWeight: 700 }}>
                        {outage.country}
                        <span style={{
                          fontSize: '8px', color: severityColor(outage.severity),
                          marginLeft: '6px', fontWeight: 400,
                          padding: '1px 4px', borderRadius: '2px',
                          background: severityBg(outage.severity),
                        }}>
                          {outage.severity.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: '9px', color: C.muted }}>
                        {outage.datasource}: {outage.signalDrop}% signal drop from baseline
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              marginTop: '8px', fontSize: '8px', color: C.muted, fontStyle: 'italic',
            }}>
              Data: IODA (Internet Outage Detection & Analysis) — BGP, Active Probing, Network Telescope, Google Transparency
            </div>
          </div>
        </div>

        {/* ── ANOMALY CORRELATION CARD ── */}
        <div style={{
          marginTop: '10px',
          background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: '6px', padding: '10px 14px',
        }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, color: C.accent,
            letterSpacing: '0.08em', marginBottom: '8px',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            ANOMALY CORRELATION
            <span style={{
              fontSize: '8px', fontWeight: 400, color: C.muted,
              padding: '1px 6px', borderRadius: '3px',
              background: 'rgba(255,255,255,0.05)',
            }}>
              Flow + Outage Cross-Reference
            </span>
            {anomalies.filter(a => a.severity === 'critical').length > 0 && (
              <span style={{
                fontSize: '8px', fontWeight: 700,
                padding: '1px 6px', borderRadius: '3px',
                background: 'rgba(255,23,68,0.15)',
                color: '#ff1744',
                border: '1px solid rgba(255,23,68,0.3)',
              }}>
                ESCALATION INDICATOR
              </span>
            )}
          </div>

          {anomalies.length === 0 ? (
            <div style={{ fontSize: '10px', color: C.muted }}>
              {flows.length === 0
                ? 'Waiting for flow data to compute correlations...'
                : 'No correlated anomalies detected — flow volumes within normal parameters'}
            </div>
          ) : (
            <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
              {anomalies.map((anomaly, i) => (
                <div key={i} style={{
                  padding: '6px 8px', marginBottom: '4px',
                  borderRadius: '4px',
                  background: severityBg(anomaly.severity),
                  border: `1px solid ${severityColor(anomaly.severity)}33`,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px',
                  }}>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: severityColor(anomaly.severity),
                    }} />
                    <span style={{ fontSize: '10px', color: C.text, fontWeight: 700 }}>
                      {anomaly.country} ({anomaly.countryCode})
                    </span>
                    <span style={{
                      fontSize: '8px', color: severityColor(anomaly.severity),
                      padding: '1px 6px', borderRadius: '2px',
                      background: severityBg(anomaly.severity),
                      fontWeight: 700,
                    }}>
                      {anomaly.severity.toUpperCase()}
                    </span>
                    <span style={{ fontSize: '9px', color: C.muted }}>
                      +{anomaly.flowIncrease}% flow
                    </span>
                    {anomaly.outageDetected && (
                      <span style={{ fontSize: '9px', color: '#ff1744', fontWeight: 700 }}>
                        + {anomaly.outageSource} instability
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '9px', color: C.muted, paddingLeft: '18px' }}>
                    {anomaly.explanation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── LEGEND ── */}
        <div style={{
          marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '14px',
          padding: '8px 12px',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: '6px',
        }}>
          {/* Cable legend */}
          {showCables && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                SUBMARINE CABLES {shouldUseLive ? `(TOP 100 OF ${liveCableCount})` : `(${CABLES.length} SEED)`}
              </div>
              {!shouldUseLive && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {CABLES.map(c => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '16px', height: '2px', background: c.color, borderRadius: '1px' }} />
                      <span style={{ fontSize: '8px', color: C.text }}>{c.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {shouldUseLive && (
                <div style={{ fontSize: '8px', color: C.muted }}>
                  Showing {Math.min(100, liveCables.length)} longest cables of {liveCableCount} total.
                  Source: TeleGeography
                </div>
              )}
            </div>
          )}

          {/* IXP legend */}
          {showIXPs && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                IXPs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(0,204,255,0.8)', border: '1px solid #00ccff' }} />
                  <span style={{ fontSize: '8px', color: C.text }}>Tier 1 (&gt;5 Tbps)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'rgba(0,204,255,0.8)', border: '1px solid #00ccff' }} />
                  <span style={{ fontSize: '8px', color: C.text }}>Tier 2</span>
                </div>
              </div>
            </div>
          )}

          {/* Exposure legend */}
          {showExposure && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                EXPOSURE ({exposurePoints.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {Object.entries(QUERY_COLORS).filter(([k]) => k !== 'default').slice(0, 5).map(([tag, color]) => {
                  const count = exposurePoints.filter(p => p.query === tag).length;
                  if (count === 0) return null;
                  return (
                    <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                      <span style={{ fontSize: '8px', color: C.text }}>{tag.replace(/_/g, ' ')} ({count})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flow legend */}
          {showFlows && flows.length > 0 && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                ATTACK FLOWS ({flows.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {Array.from(new Set(flows.map(f => f.vector))).slice(0, 5).map(vec => {
                  const color = VECTOR_COLORS[vec] || '#6b7280';
                  const total = flows.filter(f => f.vector === vec).reduce((s, f) => s + f.event_count, 0);
                  return (
                    <div key={vec} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '12px', height: '2px', background: color, borderRadius: '1px' }} />
                      <span style={{ fontSize: '8px', color: C.text }}>{vec} ({total.toLocaleString()})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Threat shading legend */}
          {showCountryThreat && countryThreats.length > 0 && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                COUNTRY THREATS
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <span style={{ fontSize: '8px', color: C.muted }}>Low</span>
                <div style={{
                  width: '60px', height: '8px', borderRadius: '2px',
                  background: 'linear-gradient(90deg, rgba(34,197,94,0.3), rgba(234,179,8,0.4), rgba(249,115,22,0.5), rgba(239,68,68,0.6))',
                }} />
                <span style={{ fontSize: '8px', color: C.muted }}>High</span>
              </div>
              <div style={{ fontSize: '8px', color: C.muted, marginTop: '2px' }}>
                Top: {countryThreats.slice(0, 3).map(c => `${c.code} ${c.total.toLocaleString()}`).join(' · ')}
              </div>
            </div>
          )}

          {/* Outage legend */}
          {showOutages && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                OUTAGE INDICATORS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                  <span style={{ fontSize: '8px', color: C.text }}>Watch (15-30% drop)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff9800' }} />
                  <span style={{ fontSize: '8px', color: C.text }}>Warning (30-50% drop)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff1744' }} />
                  <span style={{ fontSize: '8px', color: C.text }}>Critical (&gt;50% drop)</span>
                </div>
              </div>
            </div>
          )}

          {/* Cloud legend */}
          {showCloud && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                CLOUD REGIONS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {(['AWS', 'Azure', 'GCP'] as const).map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: `${PROVIDER_COLORS[p]}33`, border: `1px solid ${PROVIDER_COLORS[p]}` }} />
                    <span style={{ fontSize: '8px', color: C.text }}>{p}</span>
                  </div>
                ))}
                {cloudHealth.loaded && (
                  <div style={{ fontSize: '8px', color: C.muted, marginTop: '2px' }}>
                    Border: <span style={{ color: '#22c55e' }}>green</span>=ok <span style={{ color: '#ff9800' }}>yellow</span>=degraded <span style={{ color: '#ef4444' }}>red</span>=outage
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sat legend */}
          {showSat && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                SATELLITE COVERAGE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {SAT_CONSTELLATIONS.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '16px', height: '3px', background: s.color, borderTop: `1px dashed ${s.borderColor}`, borderBottom: `1px dashed ${s.borderColor}` }} />
                    <span style={{ fontSize: '8px', color: C.text }}>{s.name} ({s.sats.toLocaleString()})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
