/**
 * Infrastructure Topology Panel
 *
 * Submarine Cables · Internet Exchange Points · Cloud Regions · Satellite Coverage
 * Live exposure data · Attack flows · Country threat shading
 * Mercator projection SVG map with real 50m country borders
 */

import { useState, useEffect, useRef } from 'react';

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
  { name: 'IX.br São Paulo',  lon: -46.6,  lat: -23.5, throughput: '2.5 Tbps', members: 350,  tier: 2 },
  { name: 'HKIX Hong Kong',   lon: 114.2,  lat: 22.3,  throughput: '4 Tbps',   members: 400,  tier: 2 },
  { name: 'SIX Seattle',      lon: -122.3, lat: 47.6,  throughput: '2 Tbps',   members: 250,  tier: 2 },
];

const IXP_STRATEGIC: Record<string, string> = {
  'DE-CIX Frankfurt': 'Largest IXP globally — central European BGP route aggregation point for 1,100+ networks',
  'AMS-IX Amsterdam': 'Second largest IXP — critical Amsterdam Internet hub connecting European and transatlantic traffic',
  'LINX London':      'UK national exchange — major peering hub for European and transatlantic routing',
  'Equinix Ashburn':  'Primary North American peering hub — US East Coast BGP nexus in Equinix data center campus',
  'BBIX Tokyo':       'Primary Japanese IXP — critical Asia-Pacific peering and transit aggregation point',
  'IX.br São Paulo':  'Largest Latin American IXP — Brazilian national internet exchange for regional routing',
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
  path: string; // SVG path d attribute
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

// ─── COUNTRY CENTROIDS (for flow arrows when only CC is known) ───────────
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
  if (data.length < 2) return <span style={{ fontSize: '9px', color: C.muted }}>—</span>;
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

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function InfrastructurePanel({ onClose }: InfrastructurePanelProps) {
  const [showCables, setShowCables] = useState(true);
  const [showIXPs,   setShowIXPs]   = useState(true);
  const [showCloud,  setShowCloud]  = useState(false);
  const [showSat,    setShowSat]    = useState(false);
  const [showExposure, setShowExposure] = useState(true);
  const [showFlows,    setShowFlows]    = useState(true);
  const [showCountryThreat, setShowCountryThreat] = useState(true);

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
  const getCountryFill = (iso: string): string => {
    if (!showCountryThreat) return 'rgba(20,40,80,0.45)';
    const ct = countryThreats.find(c => c.code === iso);
    if (!ct) return 'rgba(20,40,80,0.45)';
    const norm = Math.min(ct.total / maxThreat, 1);
    if (norm > 0.7) return `rgba(239,68,68,${0.2 + norm * 0.35})`;
    if (norm > 0.4) return `rgba(249,115,22,${0.15 + norm * 0.3})`;
    if (norm > 0.2) return `rgba(234,179,8,${0.1 + norm * 0.25})`;
    return `rgba(34,197,94,${0.05 + norm * 0.2})`;
  };

  // Grid lines
  const latLines = [-60, -30, 0, 30, 60];
  const lonLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

  // Flow arrow targets — pick target from IXPs near the flow destination or default
  const getFlowTarget = (flow: FlowData): [number, number] => {
    // Find nearest IXP or use a default target
    const targets: [number, number][] = [
      [-77.5, 38.9], [8.6, 50.1], [139.7, 35.7], [-122.3, 47.6],
      [4.9, 52.4], [103.8, 1.3], [-46.6, -23.5], [114.2, 22.3],
    ];
    // Pick a target that's geographically distant from source
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

  return (
    <div style={{
      position: 'fixed', top: '60px', left: '16px',
      width: '880px', maxWidth: 'calc(100vw - 32px)',
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
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: C.accent, letterSpacing: '0.06em' }}>
                🌐 INFRASTRUCTURE TOPOLOGY
              </div>
              <div style={{ fontSize: '10px', color: C.muted, marginTop: '2px', letterSpacing: '0.04em' }}>
                Cables · IXPs · Cloud · Exposure · Attack Flows · Threat Map
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
              {dataStatus === 'loading' ? '⏳ LOADING' : dataStatus === 'live' ? '● LIVE DATA' : '○ PARTIAL'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
              borderRadius: '4px', color: C.muted, fontSize: '16px',
              width: '28px', height: '28px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            ×
          </button>
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
                {/* Timeline sparkline */}
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

        {/* Toggle row */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <ToggleBtn label="⬡ CABLES" active={showCables} onClick={() => setShowCables(v => !v)} />
          <ToggleBtn label="◉ IXPs"   active={showIXPs}   onClick={() => setShowIXPs(v => !v)} />
          <ToggleBtn label="▪ CLOUD"  active={showCloud}  onClick={() => setShowCloud(v => !v)} />
          <ToggleBtn label="⊙ SAT"    active={showSat}    onClick={() => setShowSat(v => !v)} />
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
          <ToggleBtn label="⦿ EXPOSURE" active={showExposure} onClick={() => setShowExposure(v => !v)} color="rgba(239,68,68" />
          <ToggleBtn label="→ FLOWS"    active={showFlows}    onClick={() => setShowFlows(v => !v)} color="rgba(0,229,255" />
          <ToggleBtn label="◼ THREATS"  active={showCountryThreat} onClick={() => setShowCountryThreat(v => !v)} color="rgba(249,115,22" />
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
              <path
                key={cp.iso + cp.name}
                d={cp.path}
                fill={getCountryFill(cp.iso)}
                stroke="rgba(40,80,140,0.4)"
                strokeWidth={0.4}
                onMouseEnter={(e) => {
                  const ct = countryThreats.find(c => c.code === cp.iso);
                  if (ct || cp.name) {
                    const rect = (e.currentTarget.closest('div') as HTMLDivElement | null)?.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - (rect?.left ?? 0),
                      y: e.clientY - (rect?.top ?? 0),
                      text: ct
                        ? `${cp.name} (${cp.iso}) · ${ct.total.toLocaleString()} events · Top: ${Object.entries(ct.vectors).sort((a,b) => b[1]-a[1]).slice(0,2).map(([v,c]) => `${v} ${c.toLocaleString()}`).join(', ')}`
                        : `${cp.name} (${cp.iso})`,
                    });
                  }
                }}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'pointer' }}
              />
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

            {/* ── CABLES ── */}
            {showCables && CABLES.map(cable => {
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
              // Curve midpoint
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
                        text: `${flow.source_country} → ${flow.vector} · ${flow.event_count.toLocaleString()} events · ${flow.unique_ips} IPs${flow.top_port ? ` · port ${flow.top_port}` : ''}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => setSelectedItem({
                      type: 'flow', name: `${flow.source_country} → ${flow.vector}`,
                      detail: `${flow.event_count.toLocaleString()} events · ${flow.unique_ips} unique IPs${flow.top_port ? ` · port ${flow.top_port}` : ''}`,
                      extra: `Source coordinates: ${flow.avg_lat.toFixed(2)}°, ${flow.avg_lon.toFixed(2)}°`,
                    })}
                  />
                  {/* Arrow head at target */}
                  <circle cx={ex} cy={ey} r={2} fill={color} opacity={0.7} style={{ pointerEvents: 'none' }} />
                  {/* Source marker */}
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
                    extra: ep.vuln_count > 0 ? `⚠ ${ep.vuln_count} known vulnerabilities` : undefined,
                  })}
                />
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
                    stroke={color}
                    strokeWidth={isHov ? 1.8 : 1}
                    opacity={isHov ? 1 : 0.8}
                    style={isHov ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined}
                  />
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
                  {selectedItem.type === 'cable' && '⬡'}
                  {selectedItem.type === 'ixp'   && '◉'}
                  {selectedItem.type === 'cloud'  && '▪'}
                  {selectedItem.type === 'flow'   && '→'}
                  {selectedItem.type === 'exposure' && '⦿'}
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
                ×
              </button>
            </div>
          </div>
        )}

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
                SUBMARINE CABLES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {CABLES.map(c => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '16px', height: '2px', background: c.color, borderRadius: '1px' }} />
                    <span style={{ fontSize: '8px', color: C.text }}>{c.name}</span>
                  </div>
                ))}
              </div>
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
