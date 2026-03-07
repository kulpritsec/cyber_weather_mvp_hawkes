/**
 * Infrastructure Topology Panel
 *
 * Submarine Cables · Internet Exchange Points · Cloud Regions · Satellite Coverage
 * Live exposure data · Attack flows · Country threat shading
 * Mercator projection SVG map with real 50m country borders
 *
 * Enhanced with:
 *  - Mini 3D rotating globe (Three.js inset)
 *  - Full 3D interactive globe mode with flat/globe toggle
 *  - Real TeleGeography submarine cable data
 *  - Cloud provider health (Cloudflare PoPs, GCP incidents)
 *  - IODA internet outage detection
 *  - Network flow anomaly correlation
 *  - Real satellite tracking via CelesTrak TLE + satellite.js SGP4
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { addCountryBorders } from '../Globe/CountryBorders';

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

// ─── SATELLITE CONSTELLATION COLORS ─────────────────────────────────────────
const SAT_CONSTELLATION_COLORS: Record<string, string> = {
  starlink: '#00e5ff',
  oneweb: '#6366f1',
  geo: '#eab308',
  iridium: '#22c55e',
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

// ─── SATELLITE CONSTELLATIONS (flat map bands) ──────────────────────────────
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

// ─── Live cable from TeleGeography ──────────────────────────────────────────
interface LiveCable {
  id: string;
  name: string;
  color: string;
  coordinates: number[][][];
  segmentCount: number;
}

// ─── Cloud health types ─────────────────────────────────────────────────────
interface CloudflareComponent {
  name: string;
  status: string;
  group_id: string | null;
  code: string;
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

// ─── IODA outage types ──────────────────────────────────────────────────────
interface IODAOutage {
  country: string;
  countryCode: string;
  datasource: string;
  signalDrop: number;
  severity: 'watch' | 'warning' | 'critical';
}

// ─── Anomaly correlation types ──────────────────────────────────────────────
interface AnomalyCorrelation {
  country: string;
  countryCode: string;
  flowIncrease: number;
  outageDetected: boolean;
  outageSource: string;
  severity: 'watch' | 'warning' | 'critical';
  explanation: string;
}

// ─── Satellite record type ──────────────────────────────────────────────────
interface SatRecord {
  name: string;
  satrec: any;
  constellation: string;
}

interface SatCounts {
  starlink: number;
  oneweb: number;
  geo: number;
  iridium: number;
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

// ─── VIEW MODE TOGGLE (FLAT / GLOBE) ─────────────────────────────────────────
const ViewModeToggle = ({
  mode, onChange,
}: { mode: 'flat' | 'globe'; onChange: (m: 'flat' | 'globe') => void }) => (
  <div style={{
    display: 'inline-flex', borderRadius: '6px', overflow: 'hidden',
    border: '1px solid rgba(0,180,255,0.25)', background: 'rgba(5,10,20,0.7)',
  }}>
    {(['flat', 'globe'] as const).map(m => (
      <button
        key={m}
        onClick={() => onChange(m)}
        style={{
          padding: '3px 14px', fontSize: '10px', fontFamily: C.mono,
          fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer',
          border: 'none', transition: 'all 0.2s ease',
          background: mode === m ? 'rgba(0,204,255,0.18)' : 'transparent',
          color: mode === m ? C.accent : C.muted,
          borderRight: m === 'flat' ? '1px solid rgba(0,180,255,0.15)' : 'none',
        }}
      >
        {m === 'flat' ? '\u25C9 FLAT' : '\u25C9 GLOBE'}
      </button>
    ))}
  </div>
);

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

// ─── SATELLITE TLE FETCHING & PARSING ───────────────────────────────────────

const TLE_SOURCES: { group: string; constellation: string; url: string; maxSats: number }[] = [
  { group: 'starlink', constellation: 'starlink', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', maxSats: 800 },
  { group: 'oneweb', constellation: 'oneweb', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=tle', maxSats: 400 },
  { group: 'geo', constellation: 'geo', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=tle', maxSats: 450 },
  { group: 'iridium', constellation: 'iridium', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle', maxSats: 66 },
];

// Hardcoded fallback TLE data (small sample) for when CelesTrak is unreachable
const FALLBACK_TLES: { name: string; line1: string; line2: string; constellation: string }[] = [
  { name: 'STARLINK-1007', constellation: 'starlink', line1: '1 44713U 19074A   24001.00000000  .00001264  00000-0  94000-4 0  9990', line2: '2 44713  53.0554  73.4562 0001369  80.0000 280.0000 15.06380000    10' },
  { name: 'STARLINK-1008', constellation: 'starlink', line1: '1 44714U 19074B   24001.00000000  .00001100  00000-0  82000-4 0  9990', line2: '2 44714  53.0550 110.4562 0001200  85.0000 275.0000 15.06380000    10' },
  { name: 'STARLINK-1009', constellation: 'starlink', line1: '1 44715U 19074C   24001.00000000  .00001050  00000-0  78000-4 0  9990', line2: '2 44715  53.0548 147.4562 0001150  90.0000 270.0000 15.06380000    10' },
  { name: 'STARLINK-1010', constellation: 'starlink', line1: '1 44716U 19074D   24001.00000000  .00000980  00000-0  73000-4 0  9990', line2: '2 44716  53.0546 184.4562 0001100  95.0000 265.0000 15.06380000    10' },
  { name: 'STARLINK-1011', constellation: 'starlink', line1: '1 44717U 19074E   24001.00000000  .00000920  00000-0  69000-4 0  9990', line2: '2 44717  53.0544 221.4562 0001050 100.0000 260.0000 15.06380000    10' },
  { name: 'STARLINK-1012', constellation: 'starlink', line1: '1 44718U 19074F   24001.00000000  .00000870  00000-0  65000-4 0  9990', line2: '2 44718  53.0542 258.4562 0001000 105.0000 255.0000 15.06380000    10' },
  { name: 'STARLINK-1013', constellation: 'starlink', line1: '1 44719U 19074G   24001.00000000  .00000830  00000-0  62000-4 0  9990', line2: '2 44719  53.0540 295.4562 0000950 110.0000 250.0000 15.06380000    10' },
  { name: 'STARLINK-1014', constellation: 'starlink', line1: '1 44720U 19074H   24001.00000000  .00000790  00000-0  59000-4 0  9990', line2: '2 44720  53.0538 332.4562 0000900 115.0000 245.0000 15.06380000    10' },
  { name: 'ONEWEB-0012', constellation: 'oneweb', line1: '1 45131U 20008A   24001.00000000  .00000100  00000-0  10000-3 0  9990', line2: '2 45131  87.8800  45.0000 0002500  90.0000 270.0000 13.15000000    10' },
  { name: 'ONEWEB-0017', constellation: 'oneweb', line1: '1 45132U 20008B   24001.00000000  .00000100  00000-0  10000-3 0  9990', line2: '2 45132  87.8800  90.0000 0002500  95.0000 265.0000 13.15000000    10' },
  { name: 'ONEWEB-0020', constellation: 'oneweb', line1: '1 45133U 20008C   24001.00000000  .00000100  00000-0  10000-3 0  9990', line2: '2 45133  87.8800 135.0000 0002500 100.0000 260.0000 13.15000000    10' },
  { name: 'ONEWEB-0032', constellation: 'oneweb', line1: '1 45134U 20008D   24001.00000000  .00000100  00000-0  10000-3 0  9990', line2: '2 45134  87.8800 180.0000 0002500 105.0000 255.0000 13.15000000    10' },
  { name: 'IRIDIUM 106', constellation: 'iridium', line1: '1 43075U 18002A   24001.00000000  .00000050  00000-0  15000-4 0  9990', line2: '2 43075  86.3940  60.0000 0002100  90.0000 270.0000 14.34200000    10' },
  { name: 'IRIDIUM 103', constellation: 'iridium', line1: '1 43076U 18002B   24001.00000000  .00000050  00000-0  15000-4 0  9990', line2: '2 43076  86.3940 120.0000 0002100  95.0000 265.0000 14.34200000    10' },
  { name: 'IRIDIUM 109', constellation: 'iridium', line1: '1 43077U 18002C   24001.00000000  .00000050  00000-0  15000-4 0  9990', line2: '2 43077  86.3940 180.0000 0002100 100.0000 260.0000 14.34200000    10' },
  { name: 'IRIDIUM 102', constellation: 'iridium', line1: '1 43078U 18002D   24001.00000000  .00000050  00000-0  15000-4 0  9990', line2: '2 43078  86.3940 240.0000 0002100 105.0000 255.0000 14.34200000    10' },
  { name: 'SES-1', constellation: 'geo', line1: '1 36516U 10012A   24001.00000000  .00000010  00000-0  00000+0 0  9990', line2: '2 36516   0.0300 270.0000 0003500 270.0000  90.0000  1.00270000    10' },
  { name: 'GALAXY 17', constellation: 'geo', line1: '1 32708U 08016A   24001.00000000  .00000010  00000-0  00000+0 0  9990', line2: '2 32708   0.0200 310.0000 0002800 280.0000  80.0000  1.00270000    10' },
  { name: 'INTELSAT 37E', constellation: 'geo', line1: '1 42950U 17054A   24001.00000000  .00000010  00000-0  00000+0 0  9990', line2: '2 42950   0.0100 350.0000 0002200 290.0000  70.0000  1.00270000    10' },
  { name: 'ASTRA 2F', constellation: 'geo', line1: '1 38778U 12051A   24001.00000000  .00000010  00000-0  00000+0 0  9990', line2: '2 38778   0.0400  28.2000 0002000 300.0000  60.0000  1.00270000    10' },
];

function parseTLEText(text: string, constellation: string, maxSats: number): SatRecord[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const records: SatRecord[] = [];
  let i = 0;
  while (i < lines.length - 1 && records.length < maxSats) {
    let name = '';
    let line1 = '';
    let line2 = '';
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      line1 = lines[i];
      line2 = lines[i + 1];
      name = `${constellation.toUpperCase()}-${records.length}`;
      i += 2;
    } else if (i + 2 < lines.length && lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      name = lines[i];
      line1 = lines[i + 1];
      line2 = lines[i + 2];
      i += 3;
    } else {
      i++;
      continue;
    }
    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      if (satrec) {
        records.push({ name, satrec, constellation });
      }
    } catch {
      // skip bad TLE
    }
  }
  return records;
}

function propagateSatellites(sats: SatRecord[], now: Date): { positions: Float32Array; colors: Float32Array; count: number } {
  const gmst = satellite.gstime(now);
  const positions = new Float32Array(sats.length * 3);
  const colors = new Float32Array(sats.length * 3);
  let count = 0;

  for (let i = 0; i < sats.length; i++) {
    try {
      const posVel = satellite.propagate(sats[i].satrec, now);
      if (!posVel || typeof posVel.position === 'boolean' || !posVel.position) continue;
      const eci = posVel.position as { x: number; y: number; z: number };
      const geodetic = satellite.eciToGeodetic(eci, gmst);
      const lat = satellite.degreesLat(geodetic.latitude);
      const lon = satellite.degreesLong(geodetic.longitude);
      const altKm = geodetic.height;

      // Map orbital altitude to visual radius on globe
      // LEO (~550km) -> R*1.05, MEO (~20000km) -> R*1.07, GEO (~35786km) -> R*1.08
      const R = 1;
      let visualR = R * 1.05;
      if (altKm > 30000) visualR = R * 1.08;
      else if (altKm > 5000) visualR = R * 1.07;
      else visualR = R * (1.04 + Math.min(altKm / 50000, 0.04));

      const pos = latLonToVec3(lat, lon, visualR);
      positions[count * 3] = pos.x;
      positions[count * 3 + 1] = pos.y;
      positions[count * 3 + 2] = pos.z;

      const cHex = SAT_CONSTELLATION_COLORS[sats[i].constellation] || '#ffffff';
      const c = new THREE.Color(cHex);
      colors[count * 3] = c.r;
      colors[count * 3 + 1] = c.g;
      colors[count * 3 + 2] = c.b;

      count++;
    } catch {
      // skip propagation errors
    }
  }

  return { positions, colors, count };
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

// ─── INFRA GLOBE COMPONENT (Full 3D Globe for main content area) ────────────
interface InfraGlobeProps {
  showCables: boolean;
  showIXPs: boolean;
  showCloud: boolean;
  showSat: boolean;
  showExposure: boolean;
  showFlows: boolean;
  showOutages: boolean;
  showSatellites: boolean;
  liveCables: LiveCable[];
  useLiveCables: boolean;
  exposurePoints: ExposurePoint[];
  flows: FlowData[];
  iodaOutages: IODAOutage[];
  anomalies: AnomalyCorrelation[];
  satRecords: SatRecord[];
  satCounts: SatCounts;
  onSelectItem: (item: SelectedItem | null) => void;
}

function InfraGlobe({
  showCables, showIXPs, showCloud, showSat, showExposure, showFlows, showOutages,
  showSatellites, liveCables, useLiveCables, exposurePoints, flows,
  iodaOutages, anomalies, satRecords, satCounts, onSelectItem,
}: InfraGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const mouseRef = useRef({ down: false, lastX: 0, lastY: 0 });
  const rotRef = useRef({ x: 0.3, y: 0, autoRotate: true });
  const satPointsRef = useRef<THREE.Points | null>(null);
  const lastSatUpdateRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  // Clickable objects for raycasting
  const clickableRef = useRef<THREE.Object3D[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 830;
    const H = 420;
    const R = 1;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050c19, 1);
    rendererRef.current = renderer;

    // Lighting
    scene.add(new THREE.AmbientLight(0x334466, 0.6));
    const dirLight = new THREE.DirectionalLight(0x88bbff, 0.8);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);

    // Globe sphere
    const globeGeo = new THREE.SphereGeometry(R, 96, 96);
    const textureLoader = new THREE.TextureLoader();
    const globeMat = new THREE.MeshPhongMaterial({
      color: 0x0a1628,
      emissive: 0x040c1a,
      emissiveIntensity: 0.3,
      shininess: 15,
      transparent: true,
      opacity: 0.95,
    });
    textureLoader.load('/earth-night.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      globeMat.map = tex;
      globeMat.color.setHex(0x1a2a3a);
      globeMat.emissive.setHex(0x050a12);
      globeMat.emissiveIntensity = 0.15;
      globeMat.opacity = 0.98;
      globeMat.needsUpdate = true;
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);
    globeRef.current = globe;

    // Atmosphere
    const atmosGeo = new THREE.SphereGeometry(R * 1.015, 64, 64);
    const atmosMat = new THREE.MeshBasicMaterial({ color: 0x0077cc, transparent: true, opacity: 0.08, side: THREE.BackSide });
    scene.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Outer halo
    const haloGeo = new THREE.SphereGeometry(R * 1.08, 32, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x0055aa, transparent: true, opacity: 0.04, side: THREE.BackSide });
    scene.add(new THREE.Mesh(haloGeo, haloMat));

    // Grid lines
    const gridMat = new THREE.LineBasicMaterial({ color: 0x0c2240, transparent: true, opacity: 0.15 });
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 4) pts.push(latLonToVec3(lat, lon - 180, R * 1.001));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(latLonToVec3(lat, lon, R * 1.001));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }

    // Country borders with filled land
    addCountryBorders(scene, R, {
      showFill: true,
      showBorders: true,
      fillColor: 0x0f2a4a,
      fillOpacity: 0.5,
      borderColor: 0x1a6090,
      borderOpacity: 0.4,
    });

    // Stars background
    const starPos: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const sr = 40 + Math.random() * 100;
      const stheta = Math.random() * Math.PI * 2;
      const sphi = Math.acos(2 * Math.random() - 1);
      starPos.push(sr * Math.sin(sphi) * Math.cos(stheta), sr * Math.sin(sphi) * Math.sin(stheta), sr * Math.cos(sphi));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x4477aa, size: 0.15, transparent: true, opacity: 0.35 })));

    // Overlay group (attached to globe so it rotates with it)
    const overlayGroup = new THREE.Group();
    overlayGroup.name = 'infraOverlays';
    globe.add(overlayGroup);
    overlayGroupRef.current = overlayGroup;

    // ─── Mouse interaction ───
    const onMouseDown = (e: MouseEvent) => {
      mouseRef.current.down = true;
      mouseRef.current.lastX = e.clientX;
      mouseRef.current.lastY = e.clientY;
      rotRef.current.autoRotate = false;
    };
    const onMouseUp = (e: MouseEvent) => {
      mouseRef.current.down = false;
      setTimeout(() => { rotRef.current.autoRotate = true; }, 3000);
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
      e.preventDefault();
      camera.position.z = Math.max(1.6, Math.min(6, camera.position.z + e.deltaY * 0.002));
    };
    const onClick = (e: MouseEvent) => {
      if (!cameraRef.current || !globeRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
      const clickables = clickableRef.current;
      if (clickables.length > 0) {
        const hits = raycaster.intersectObjects(clickables, false);
        if (hits.length > 0) {
          const userData = hits[0].object.userData;
          if (userData?.selectItem) {
            onSelectItem(userData.selectItem);
            return;
          }
        }
      }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);

    // ─── Animation loop ───
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.016;

      // Rotation
      if (rotRef.current.autoRotate) {
        rotRef.current.y += 0.0012;
      }
      globe.rotation.x = rotRef.current.x;
      globe.rotation.y = rotRef.current.y;

      // Pulse animated objects
      const t = timeRef.current;
      overlayGroup.children.forEach(child => {
        if (child.userData?.pulseType === 'ixpRing' && child instanceof THREE.Mesh) {
          const s = 1 + Math.sin(t * 3 + (child.userData.phase || 0)) * 0.4;
          child.scale.set(s, s, s);
          if (child.material instanceof THREE.MeshBasicMaterial) {
            child.material.opacity = 0.2 + Math.sin(t * 3 + (child.userData.phase || 0)) * 0.2;
          }
        }
        if (child.userData?.pulseType === 'outage' && child instanceof THREE.Mesh) {
          const s = 1 + Math.sin(t * 4) * 0.3;
          child.scale.set(s, s, s);
          if (child.material instanceof THREE.MeshBasicMaterial) {
            child.material.opacity = 0.5 + Math.sin(t * 4) * 0.4;
          }
        }
        if (child.userData?.pulseType === 'anomaly' && child instanceof THREE.Mesh) {
          const s = 1 + Math.sin(t * 3.5) * 0.25;
          child.scale.set(s, s, s);
        }
      });

      // Update satellite positions every 5 seconds
      if (satPointsRef.current && satRecords.length > 0 && Date.now() - lastSatUpdateRef.current > 5000) {
        const now = new Date();
        const { positions: newPos, colors: newCol, count } = propagateSatellites(satRecords, now);
        const geom = satPointsRef.current.geometry;
        const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
        const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
        for (let j = 0; j < count * 3; j++) {
          (posAttr.array as Float32Array)[j] = newPos[j];
          (colAttr.array as Float32Array)[j] = newCol[j];
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        geom.setDrawRange(0, count);
        lastSatUpdateRef.current = Date.now();
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      renderer.dispose();
      scene.clear();
    };
  }, []); // Core setup runs once

  // ─── Rebuild overlays when data/toggles change ───
  useEffect(() => {
    const overlayGroup = overlayGroupRef.current;
    const globe = globeRef.current;
    if (!overlayGroup || !globe) return;

    // Clear previous overlays
    while (overlayGroup.children.length > 0) {
      const child = overlayGroup.children[0];
      overlayGroup.remove(child);
      if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      if (child instanceof THREE.Line) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      if (child instanceof THREE.Points) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
    }
    clickableRef.current = [];
    satPointsRef.current = null;

    const R = 1;

    // ─── Submarine Cables ───
    if (showCables) {
      const cables = useLiveCables && liveCables.length > 0 ? liveCables.slice(0, 60) : [];
      // Live cables
      for (const cable of cables) {
        for (const lineString of cable.coordinates) {
          if (lineString.length < 2) continue;
          const positions: number[] = [];
          const step = Math.max(1, Math.floor(lineString.length / 60));
          for (let i = 0; i < lineString.length; i += step) {
            const coord = lineString[i];
            const v = latLonToVec3(coord[1], coord[0], R * 1.002);
            positions.push(v.x, v.y, v.z);
          }
          if (positions.length >= 6) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            const cableColor = cable.color ? new THREE.Color(cable.color) : new THREE.Color(0x00ccff);
            const lineMat = new THREE.LineBasicMaterial({ color: cableColor, transparent: true, opacity: 0.45 });
            const line = new THREE.Line(lineGeo, lineMat);
            line.userData = { selectItem: { type: 'cable', name: cable.name, detail: `Live submarine cable from TeleGeography · ${cable.segmentCount} segments`, extra: 'Source: submarinecablemap.com' } };
            overlayGroup.add(line);
            clickableRef.current.push(line);
          }
        }
      }
      // Seed cables (if not using live)
      if (!useLiveCables || liveCables.length === 0) {
        for (const cable of CABLES) {
          const pts: THREE.Vector3[] = [];
          for (const [lon, lat] of cable.coords) {
            pts.push(latLonToVec3(lat, lon, R * 1.002));
          }
          if (pts.length >= 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
            const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cable.color), transparent: true, opacity: 0.6 });
            const line = new THREE.Line(lineGeo, lineMat);
            line.userData = { selectItem: { type: 'cable', name: cable.name, detail: `Capacity: ${cable.capacity} | Owners: ${cable.owners}` } };
            overlayGroup.add(line);
            clickableRef.current.push(line);
          }
        }
      }
    }

    // ─── IXPs ───
    if (showIXPs) {
      for (const ixp of IXPS) {
        const pos = latLonToVec3(ixp.lat, ixp.lon, R * 1.005);
        // Core sphere
        const dotGeo = new THREE.SphereGeometry(ixp.tier === 1 ? 0.02 : 0.014, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.9 });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(pos);
        dot.userData = { selectItem: { type: 'ixp', name: ixp.name, detail: `${ixp.throughput} peak throughput · ${ixp.members} member networks`, extra: IXP_STRATEGIC[ixp.name] } };
        overlayGroup.add(dot);
        clickableRef.current.push(dot);
        // Animated ring
        const ringGeo = new THREE.RingGeometry(0.025, 0.04, 20);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.lookAt(pos.clone().multiplyScalar(2));
        ring.userData = { pulseType: 'ixpRing', phase: Math.random() * 6.28 };
        overlayGroup.add(ring);
      }
    }

    // ─── Cloud Regions ───
    if (showCloud) {
      for (const cr of CLOUD_REGIONS) {
        const pos = latLonToVec3(cr.lat, cr.lon, R * 1.005);
        const cubeGeo = new THREE.BoxGeometry(0.02, 0.02, 0.02);
        const provColor = cr.provider === 'AWS' ? 0xf59e0b : cr.provider === 'Azure' ? 0x3b82f6 : 0xef4444;
        const cubeMat = new THREE.MeshBasicMaterial({ color: provColor, transparent: true, opacity: 0.8 });
        const cube = new THREE.Mesh(cubeGeo, cubeMat);
        cube.position.copy(pos);
        cube.lookAt(pos.clone().multiplyScalar(2));
        cube.userData = { selectItem: { type: 'cloud', name: `${cr.provider} ${cr.name}`, detail: `Region: ${cr.region} · ${cr.az} Availability Zones` } };
        overlayGroup.add(cube);
        clickableRef.current.push(cube);
      }
    }

    // ─── Satellite coverage bands (static shells) ───
    if (showSat) {
      const bandConfigs = [
        { name: 'Starlink', innerR: R * 1.05, color: 0x00e5ff, opacity: 0.04 },
        { name: 'OneWeb', innerR: R * 1.06, color: 0x6366f1, opacity: 0.03 },
        { name: 'GEO', innerR: R * 1.08, color: 0xeab308, opacity: 0.025 },
      ];
      for (const band of bandConfigs) {
        const shellGeo = new THREE.SphereGeometry(band.innerR, 48, 48);
        const shellMat = new THREE.MeshBasicMaterial({ color: band.color, transparent: true, opacity: band.opacity, side: THREE.DoubleSide, depthWrite: false });
        overlayGroup.add(new THREE.Mesh(shellGeo, shellMat));
      }
    }

    // ─── Exposure Points ───
    if (showExposure && exposurePoints.length > 0) {
      for (const ep of exposurePoints) {
        const pos = latLonToVec3(ep.lat, ep.lon, R * 1.003);
        const sz = ep.vuln_count > 0 ? 0.008 : 0.005;
        const dotGeo = new THREE.SphereGeometry(sz, 6, 6);
        const cHex = QUERY_COLORS[ep.query] || QUERY_COLORS.default;
        const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cHex), transparent: true, opacity: 0.7 });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(pos);
        dot.userData = { selectItem: { type: 'exposure', name: `${ep.ip}:${ep.port}`, detail: `${ep.query.replace(/_/g, ' ')} · ${ep.product || 'unknown'} · ${ep.country}`, extra: ep.vuln_count > 0 ? `${ep.vuln_count} known vulnerabilities` : undefined } };
        overlayGroup.add(dot);
        clickableRef.current.push(dot);
      }
    }

    // ─── Attack Flow Arcs ───
    if (showFlows && flows.length > 0) {
      const targets: [number, number][] = [[-77.5, 38.9], [8.6, 50.1], [139.7, 35.7], [-122.3, 47.6], [4.9, 52.4], [103.8, 1.3]];
      for (const flow of flows.slice(0, 15)) {
        const srcCoords = COUNTRY_COORDS[flow.source_country];
        if (!srcCoords) continue;
        const [srcLat, srcLon] = srcCoords;
        // Pick furthest target
        let best = targets[0];
        let bestDist = 0;
        for (const t of targets) {
          const d = Math.abs(srcLon - t[0]) + Math.abs(srcLat - t[1]);
          if (d > bestDist) { bestDist = d; best = t; }
        }
        const v1 = latLonToVec3(srcLat, srcLon, R * 1.003);
        const v2 = latLonToVec3(best[1], best[0], R * 1.003);
        const mid = v1.clone().add(v2).multiplyScalar(0.5);
        const dist = v1.distanceTo(v2);
        mid.normalize().multiplyScalar(R + dist * 0.35);
        const curve = new THREE.QuadraticBezierCurve3(v1, mid, v2);
        const arcPts = curve.getPoints(40);
        const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
        const arcColor = VECTOR_COLORS[flow.vector] || '#6b7280';
        const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(arcColor), transparent: true, opacity: 0.5 });
        const arc = new THREE.Line(arcGeo, arcMat);
        arc.userData = { selectItem: { type: 'flow', name: `${flow.source_country} > ${flow.vector}`, detail: `${flow.event_count.toLocaleString()} events · ${flow.unique_ips} unique IPs${flow.top_port ? ` · port ${flow.top_port}` : ''}` } };
        overlayGroup.add(arc);
        clickableRef.current.push(arc);
      }
    }

    // ─── IODA Outage markers ───
    if (showOutages) {
      for (const outage of iodaOutages) {
        const coords = COUNTRY_COORDS[outage.countryCode];
        if (!coords) continue;
        const pos = latLonToVec3(coords[0], coords[1], R * 1.015);
        const outGeo = new THREE.SphereGeometry(0.025, 12, 12);
        const outMat = new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.9 });
        const outDot = new THREE.Mesh(outGeo, outMat);
        outDot.position.copy(pos);
        outDot.userData = { pulseType: 'outage', selectItem: { type: 'outage', name: `${outage.country} Outage`, detail: `${outage.datasource}: ${outage.signalDrop}% signal drop`, extra: `Severity: ${outage.severity}` } };
        overlayGroup.add(outDot);
        clickableRef.current.push(outDot);
      }
      // Anomaly escalation markers
      for (const anom of anomalies.filter(a => a.severity === 'critical' || a.severity === 'warning')) {
        const coords = COUNTRY_COORDS[anom.countryCode];
        if (!coords) continue;
        const pos = latLonToVec3(coords[0], coords[1], R * 1.025);
        const anomGeo = new THREE.SphereGeometry(0.018, 10, 10);
        const anomColor = anom.severity === 'critical' ? 0xff1744 : 0xff9800;
        const anomMat = new THREE.MeshBasicMaterial({ color: anomColor, transparent: true, opacity: 0.8 });
        const anomDot = new THREE.Mesh(anomGeo, anomMat);
        anomDot.position.copy(pos);
        anomDot.userData = { pulseType: 'anomaly' };
        overlayGroup.add(anomDot);
      }
    }

    // ─── Satellite Points (real tracked) ───
    if (showSatellites && satRecords.length > 0) {
      const now = new Date();
      const { positions, colors, count } = propagateSatellites(satRecords, now);
      const maxCount = satRecords.length;
      const satGeo = new THREE.BufferGeometry();
      const posBuffer = new THREE.Float32BufferAttribute(new Float32Array(maxCount * 3), 3);
      const colBuffer = new THREE.Float32BufferAttribute(new Float32Array(maxCount * 3), 3);
      for (let j = 0; j < count * 3; j++) {
        (posBuffer.array as Float32Array)[j] = positions[j];
        (colBuffer.array as Float32Array)[j] = colors[j];
      }
      satGeo.setAttribute('position', posBuffer);
      satGeo.setAttribute('color', colBuffer);
      satGeo.setDrawRange(0, count);
      const satMat = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
      const satPoints = new THREE.Points(satGeo, satMat);
      overlayGroup.add(satPoints);
      satPointsRef.current = satPoints;
      lastSatUpdateRef.current = Date.now();
    }

  }, [showCables, showIXPs, showCloud, showSat, showExposure, showFlows, showOutages, showSatellites,
      liveCables, useLiveCables, exposurePoints, flows, iodaOutages, anomalies, satRecords]);

  return (
    <canvas
      ref={canvasRef}
      width={830}
      height={420}
      style={{
        width: '830px', height: '420px', maxWidth: '100%',
        display: 'block', borderRadius: '6px', cursor: 'grab',
        background: 'rgba(5,12,25,1)',
      }}
    />
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function InfrastructurePanel({ onClose }: InfrastructurePanelProps) {
  const [viewMode, setViewMode] = useState<'flat' | 'globe'>('flat');

  const [showCables, setShowCables] = useState(true);
  const [showIXPs,   setShowIXPs]   = useState(true);
  const [showCloud,  setShowCloud]  = useState(false);
  const [showSat,    setShowSat]    = useState(false);
  const [showExposure, setShowExposure] = useState(true);
  const [showFlows,    setShowFlows]    = useState(true);
  const [showCountryThreat, setShowCountryThreat] = useState(true);
  const [showOutages, setShowOutages] = useState(true);
  const [useLiveCables, setUseLiveCables] = useState(true);
  const [showSatellites, setShowSatellites] = useState(false);

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

  // ─── Live cables state ──────────────────────────────
  const [liveCables, setLiveCables] = useState<LiveCable[]>([]);
  const [liveCableCount, setLiveCableCount] = useState(0);

  // ─── Cloud health state ──────────────────────────────
  const [cloudHealth, setCloudHealth] = useState<CloudHealthState>({
    cfOperational: 0, cfDegraded: 0, cfOutage: 0,
    cfComponents: [], gcpIncidents: [], loaded: false,
  });

  // ─── IODA outage state ──────────────────────────────
  const [iodaOutages, setIodaOutages] = useState<IODAOutage[]>([]);
  const [iodaLoaded, setIodaLoaded] = useState(false);

  // ─── Anomaly correlations ──────────────────────────────
  const [anomalies, setAnomalies] = useState<AnomalyCorrelation[]>([]);

  // ─── Satellite state ──────────────────────────────
  const [satRecords, setSatRecords] = useState<SatRecord[]>([]);
  const [satCounts, setSatCounts] = useState<SatCounts>({ starlink: 0, oneweb: 0, geo: 0, iridium: 0 });
  const [satStatus, setSatStatus] = useState<'idle' | 'loading' | 'live' | 'fallback'>('idle');

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

      const geoData = results[0].status === 'fulfilled' ? results[0].value : null;
      if (geoData?.features) {
        setExposurePoints(geoData.features.map((f: any) => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          ...f.properties,
        })));
        liveCount++;
      }

      const flowData = results[1].status === 'fulfilled' ? results[1].value : null;
      if (flowData?.flows) {
        setFlows(flowData.flows);
        liveCount++;
      }

      const countryData = results[2].status === 'fulfilled' ? results[2].value : null;
      if (countryData?.countries) {
        setCountryThreats(countryData.countries);
        liveCount++;
      }

      const summaryData = results[3].status === 'fulfilled' ? results[3].value : null;
      if (summaryData) {
        setSummary(summaryData);
        liveCount++;
      }

      const timelineData = results[4].status === 'fulfilled' ? results[4].value : null;
      if (timelineData?.series) {
        setTimeline(timelineData.series);
        liveCount++;
      }

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

  // ─── Fetch TeleGeography submarine cable data ──────────────────
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
            const totalSegments = coords.reduce((sum: number, ls: number[][]) => sum + ls.length, 0);
            parsed.push({
              id: feature.properties.id || feature.properties.name || '',
              name: feature.properties.name || 'Unknown',
              color: feature.properties.color || '#00ccff',
              coordinates: coords,
              segmentCount: totalSegments,
            });
          }
          parsed.sort((a, b) => b.segmentCount - a.segmentCount);
          setLiveCableCount(parsed.length);
          setLiveCables(parsed.slice(0, 100));
        }
      } catch {
        setLiveCables([]);
      }
    }

    fetchCables();
    return () => { cancelled = true; };
  }, []);

  // ─── Fetch Cloud Health data ──────────────────────────────
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

      const cfData = results[0].status === 'fulfilled' ? results[0].value : null;
      if (cfData?.components && Array.isArray(cfData.components)) {
        for (const comp of cfData.components) {
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
          else cfOp++;
        }
      }

      const gcpData = results[1].status === 'fulfilled' ? results[1].value : null;
      if (Array.isArray(gcpData)) {
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

  // ─── Fetch IODA outage data ──────────────────────────────
  useEffect(() => {
    if (countryThreats.length === 0) return;
    let cancelled = false;

    async function fetchIODA() {
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

        if (data?.data && Array.isArray(data.data)) {
          for (const ds of data.data) {
            const dsName = ds.datasource || ds.source || 'unknown';
            const values = ds.values || ds.signal || [];
            if (!Array.isArray(values) || values.length < 2) continue;

            const midpoint = Math.floor(values.length / 2);
            const baseline = values.slice(0, midpoint).filter((v: number) => v != null && v > 0);
            const recent = values.slice(-Math.floor(values.length / 4)).filter((v: number) => v != null && v > 0);

            if (baseline.length === 0 || recent.length === 0) continue;

            const baselineAvg = baseline.reduce((a: number, b: number) => a + b, 0) / baseline.length;
            const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;

            if (baselineAvg === 0) continue;
            const dropPct = ((baselineAvg - recentAvg) / baselineAvg) * 100;

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

  // ─── Compute anomaly correlations ──────────────────────────────
  useEffect(() => {
    if (flows.length === 0 || !iodaLoaded) return;

    const flowByCountry: Record<string, number> = {};
    for (const f of flows) {
      flowByCountry[f.source_country] = (flowByCountry[f.source_country] || 0) + f.event_count;
    }

    const flowValues = Object.values(flowByCountry);
    const avgFlow = flowValues.length > 0
      ? flowValues.reduce((a, b) => a + b, 0) / flowValues.length
      : 0;

    const correlations: AnomalyCorrelation[] = [];

    for (const [cc, total] of Object.entries(flowByCountry)) {
      if (avgFlow === 0) continue;
      const ratio = total / avgFlow;
      const pctIncrease = Math.round((ratio - 1) * 100);

      if (pctIncrease < 100) continue;

      const countryOutages = iodaOutages.filter(o => o.countryCode === cc);
      const hasOutage = countryOutages.length > 0;

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

    const severityOrder = { critical: 0, warning: 1, watch: 2 };
    correlations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.flowIncrease - a.flowIncrease);

    setAnomalies(correlations.slice(0, 10));
  }, [flows, iodaOutages, iodaLoaded]);

  // ─── Fetch satellite TLE data (on toggle or globe mode) ─────────────────
  useEffect(() => {
    if (!showSatellites) return;
    if (satRecords.length > 0) return; // already loaded
    let cancelled = false;
    setSatStatus('loading');

    async function fetchSatellites() {
      let allRecords: SatRecord[] = [];
      const counts: SatCounts = { starlink: 0, oneweb: 0, geo: 0, iridium: 0 };
      let usedFallback = false;

      for (const src of TLE_SOURCES) {
        try {
          const resp = await fetch(src.url, { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const text = await resp.text();
          const records = parseTLEText(text, src.constellation, src.maxSats);
          allRecords = allRecords.concat(records);
          counts[src.constellation as keyof SatCounts] = records.length;
          console.log(`[Satellites] Loaded ${records.length} ${src.constellation} TLEs from CelesTrak`);
        } catch (err) {
          console.warn(`[Satellites] Failed to fetch ${src.constellation} TLEs:`, err);
        }
      }

      // If we got very few, use fallback
      if (allRecords.length < 10) {
        console.warn('[Satellites] CelesTrak unreachable, using fallback TLE dataset. Set up a backend proxy for production.');
        usedFallback = true;
        for (const fb of FALLBACK_TLES) {
          try {
            const satrec = satellite.twoline2satrec(fb.line1, fb.line2);
            if (satrec) {
              allRecords.push({ name: fb.name, satrec, constellation: fb.constellation });
              counts[fb.constellation as keyof SatCounts] = (counts[fb.constellation as keyof SatCounts] || 0) + 1;
            }
          } catch { /* skip */ }
        }
      }

      // Cap at 2000 total for performance
      if (allRecords.length > 2000) {
        // Sample proportionally
        const sampled: SatRecord[] = [];
        const ratio = 2000 / allRecords.length;
        for (const rec of allRecords) {
          if (Math.random() < ratio) sampled.push(rec);
          if (sampled.length >= 2000) break;
        }
        allRecords = sampled;
        // Recount
        counts.starlink = allRecords.filter(r => r.constellation === 'starlink').length;
        counts.oneweb = allRecords.filter(r => r.constellation === 'oneweb').length;
        counts.geo = allRecords.filter(r => r.constellation === 'geo').length;
        counts.iridium = allRecords.filter(r => r.constellation === 'iridium').length;
      }

      if (!cancelled) {
        setSatRecords(allRecords);
        setSatCounts(counts);
        setSatStatus(usedFallback ? 'fallback' : 'live');
        console.log(`[Satellites] Total tracked: ${allRecords.length}`);
      }
    }

    fetchSatellites();
    return () => { cancelled = true; };
  }, [showSatellites]);

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
    const degradedComps = cloudHealth.cfComponents.filter(c =>
      c.status === 'degraded_performance'
    );
    const outageComps = cloudHealth.cfComponents.filter(c =>
      c.status === 'partial_outage' || c.status === 'major_outage'
    );
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
                  Cables · IXPs · Cloud · Exposure · Attack Flows · Threat Map · Outages · Satellites
                </div>
              </div>
              {/* View mode toggle */}
              <ViewModeToggle mode={viewMode} onChange={setViewMode} />
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
              {/* Satellite badge */}
              {satRecords.length > 0 && (
                <div style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
                  padding: '2px 8px', borderRadius: '3px',
                  background: satStatus === 'live' ? 'rgba(0,229,255,0.1)' : 'rgba(234,179,8,0.1)',
                  color: satStatus === 'live' ? '#00e5ff' : '#eab308',
                  border: `1px solid ${satStatus === 'live' ? 'rgba(0,229,255,0.25)' : 'rgba(234,179,8,0.25)'}`,
                }}>
                  {satRecords.length} SATS
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

          {/* Mini 3D Globe (top-right) — HIDDEN in globe mode (redundant) */}
          {viewMode === 'flat' && (
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
          )}
          {viewMode === 'globe' && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
                borderRadius: '4px', color: C.muted, fontSize: '10px',
                padding: '2px 12px', cursor: 'pointer', alignSelf: 'flex-start',
                fontFamily: C.mono, letterSpacing: '0.06em', marginLeft: '12px',
              }}
            >
              CLOSE
            </button>
          )}
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
          <ToggleBtn
            label={satStatus === 'loading' ? 'SATS...' : `SATS${satRecords.length > 0 ? ` (${satRecords.length})` : ''}`}
            active={showSatellites}
            onClick={() => setShowSatellites(v => !v)}
            color="rgba(0,229,255"
          />
        </div>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{ overflowY: 'auto', flexGrow: 1, padding: '10px 16px 16px' }}>

        {/* ── MAP / GLOBE VIEW ── */}
        {viewMode === 'flat' ? (
          /* ─────────── FLAT MAP (100% preserved SVG Mercator) ─────────── */
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
                      const step = Math.max(1, Math.floor(lineString.length / 80));
                      const sampled = lineString.filter((_: any, idx: number) => idx % step === 0 || idx === lineString.length - 1);
                      const pts = sampled.map((coord: number[]) => {
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
        ) : (
          /* ─────────── 3D GLOBE MODE ─────────── */
          <div style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden' }}>
            <InfraGlobe
              showCables={showCables}
              showIXPs={showIXPs}
              showCloud={showCloud}
              showSat={showSat}
              showExposure={showExposure}
              showFlows={showFlows}
              showOutages={showOutages}
              showSatellites={showSatellites}
              liveCables={liveCables}
              useLiveCables={useLiveCables}
              exposurePoints={exposurePoints}
              flows={flows}
              iodaOutages={iodaOutages}
              anomalies={anomalies}
              satRecords={satRecords}
              satCounts={satCounts}
              onSelectItem={setSelectedItem}
            />
            {/* Satellite info overlay (globe mode only) */}
            {showSatellites && satRecords.length > 0 && (
              <div style={{
                position: 'absolute', top: '8px', right: '8px',
                background: 'rgba(8,15,28,0.9)', border: '1px solid rgba(0,180,255,0.2)',
                borderRadius: '6px', padding: '8px 12px', fontSize: '9px', fontFamily: C.mono,
              }}>
                <div style={{ fontSize: '8px', color: C.accent, fontWeight: 700, letterSpacing: '0.08em', marginBottom: '4px' }}>
                  SATELLITES ({satRecords.length})
                </div>
                {satCounts.starlink > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00e5ff' }} />
                    <span style={{ color: C.text }}>Starlink</span>
                    <span style={{ color: C.muted }}>{satCounts.starlink}</span>
                  </div>
                )}
                {satCounts.oneweb > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6366f1' }} />
                    <span style={{ color: C.text }}>OneWeb</span>
                    <span style={{ color: C.muted }}>{satCounts.oneweb}</span>
                  </div>
                )}
                {satCounts.geo > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#eab308' }} />
                    <span style={{ color: C.text }}>GEO</span>
                    <span style={{ color: C.muted }}>{satCounts.geo}</span>
                  </div>
                )}
                {satCounts.iridium > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                    <span style={{ color: C.text }}>Iridium</span>
                    <span style={{ color: C.muted }}>{satCounts.iridium}</span>
                  </div>
                )}
                <div style={{ fontSize: '7px', color: C.muted, marginTop: '4px', fontStyle: 'italic' }}>
                  {satStatus === 'live' ? 'CelesTrak TLE · SGP4' : 'Fallback dataset'}
                </div>
              </div>
            )}
          </div>
        )}

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
                  {selectedItem.type === 'outage' && '[OUTAGE]'}
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

          {/* Satellite tracking legend */}
          {showSatellites && satRecords.length > 0 && (
            <div>
              <div style={{ fontSize: '8px', color: C.muted, marginBottom: '4px', letterSpacing: '0.08em' }}>
                TRACKED SATELLITES ({satRecords.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {satCounts.starlink > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00e5ff' }} />
                    <span style={{ fontSize: '8px', color: C.text }}>Starlink ({satCounts.starlink})</span>
                  </div>
                )}
                {satCounts.oneweb > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6366f1' }} />
                    <span style={{ fontSize: '8px', color: C.text }}>OneWeb ({satCounts.oneweb})</span>
                  </div>
                )}
                {satCounts.geo > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#eab308' }} />
                    <span style={{ fontSize: '8px', color: C.text }}>GEO ({satCounts.geo})</span>
                  </div>
                )}
                {satCounts.iridium > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
                    <span style={{ fontSize: '8px', color: C.text }}>Iridium ({satCounts.iridium})</span>
                  </div>
                )}
                <div style={{ fontSize: '7px', color: C.muted, marginTop: '2px' }}>
                  SGP4 propagation via satellite.js · TLE from CelesTrak
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
