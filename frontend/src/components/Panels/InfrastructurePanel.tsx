/**
 * Infrastructure Topology Panel
 *
 * Submarine Cables · Internet Exchange Points · Cloud Regions · Satellite Coverage
 * Mercator projection SVG map — no external map library required
 */

import { useState } from 'react';

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

// ─── MERCATOR PROJECTION ──────────────────────────────────────────────────────
function mercator(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = (lon + 180) / 360 * w;
  const latRad = lat * Math.PI / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = h / 2 - (mercN * h / (2 * Math.PI));
  return [x, y];
}

// ─── CONTINENT DATA ───────────────────────────────────────────────────────────
const CONTINENTS: Array<{ name: string; coords: [number, number][] }> = [
  {
    name: 'North America',
    coords: [
      [-165, 70], [-140, 75], [-90, 75], [-65, 80], [-65, 50], [-55, 45],
      [-80, 25], [-90, 15], [-75, 10], [-85, 10], [-95, 20], [-100, 20],
      [-120, 30], [-120, 35], [-125, 50], [-130, 60], [-165, 65], [-165, 70],
    ],
  },
  {
    name: 'South America',
    coords: [
      [-80, 10], [-75, 5], [-50, -5], [-35, -10], [-38, -15], [-40, -22],
      [-50, -33], [-68, -55], [-76, -50], [-80, -40], [-78, -20], [-80, 10],
    ],
  },
  {
    name: 'Europe',
    coords: [
      [-10, 35], [35, 35], [40, 40], [35, 50], [30, 60], [25, 70],
      [10, 62], [0, 65], [-5, 58], [-8, 50], [-5, 44], [-10, 38], [-10, 35],
    ],
  },
  {
    name: 'Africa',
    coords: [
      [-18, 15], [35, 22], [42, 12], [42, -10], [35, -35], [28, -35],
      [18, -30], [12, -18], [10, -5], [0, 5], [-5, 5], [-18, 15],
    ],
  },
  {
    name: 'Asia+Russia',
    coords: [
      [35, 70], [140, 70], [145, 45], [135, 35], [125, 25], [100, 5],
      [95, 5], [80, 15], [70, 25], [60, 25], [50, 35], [40, 38], [35, 50], [35, 70],
    ],
  },
  {
    name: 'Australia',
    coords: [
      [114, -22], [135, -12], [150, -22], [155, -28], [145, -38], [130, -35], [116, -35], [114, -22],
    ],
  },
];

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

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface SelectedItem {
  type: string;
  name: string;
  detail: string;
}

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

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
  }}>
    {text}
  </div>
);

// ─── TOGGLE BUTTON ────────────────────────────────────────────────────────────
const ToggleBtn = ({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      background: active ? 'rgba(0,204,255,0.15)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${active ? 'rgba(0,204,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
      borderRadius: '4px', padding: '3px 10px', fontSize: '11px',
      fontFamily: C.mono, color: active ? C.accent : C.muted,
      cursor: 'pointer', transition: 'all 0.15s ease', letterSpacing: '0.04em',
    }}
  >
    {label}
  </button>
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function InfrastructurePanel({ onClose }: InfrastructurePanelProps) {
  const [showCables, setShowCables] = useState(true);
  const [showIXPs,   setShowIXPs]   = useState(true);
  const [showCloud,  setShowCloud]  = useState(true);
  const [showSat,    setShowSat]    = useState(true);

  const [hoveredCable, setHoveredCable] = useState<string | null>(null);
  const [hoveredIXP,   setHoveredIXP]   = useState<string | null>(null);
  const [hoveredCloud, setHoveredCloud] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [tooltip,      setTooltip]      = useState<TooltipState | null>(null);

  const SVG_W = 830;
  const SVG_H = 420;

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

  // Cable click → select item
  const selectCable = (cable: Cable) => {
    setSelectedItem({
      type: 'cable',
      name: cable.name,
      detail: `Capacity: ${cable.capacity} | Owners: ${cable.owners}`,
    });
  };

  // IXP click → select item
  const selectIXP = (ixp: IXP) => {
    setSelectedItem({
      type: 'ixp',
      name: ixp.name,
      detail: `${ixp.throughput} peak throughput · ${ixp.members} member networks`,
    });
  };

  // Cloud click → select item
  const selectCloud = (r: CloudRegion) => {
    setSelectedItem({
      type: 'cloud',
      name: `${r.provider} ${r.name}`,
      detail: `Region: ${r.region} · ${r.az} Availability Zones`,
    });
  };

  // Lat/lon lines
  const latLines = [-60, -30, 0, 30, 60];
  const lonLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

  return (
    <div style={{
      position: 'fixed', top: '60px', left: '16px',
      width: '860px', maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 80px)', overflow: 'hidden',
      zIndex: 1200, borderRadius: '10px',
      background: C.bg, border: `1px solid ${C.border}`,
      boxShadow: '0 8px 60px rgba(0,0,0,0.7)', backdropFilter: 'blur(24px)',
      display: 'flex', flexDirection: 'column',
      fontFamily: C.mono,
    }}>
      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '12px 16px 10px', borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: C.accent, letterSpacing: '0.06em' }}>
              🌐 INFRASTRUCTURE TOPOLOGY
            </div>
            <div style={{ fontSize: '10px', color: C.muted, marginTop: '2px', letterSpacing: '0.04em' }}>
              Submarine Cables · Internet Exchange Points · Cloud Regions · Satellite Coverage
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
        {/* Toggle row */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <ToggleBtn label="⬡ CABLES" active={showCables} onClick={() => setShowCables(v => !v)} />
          <ToggleBtn label="◉ IXPs"   active={showIXPs}   onClick={() => setShowIXPs(v => !v)} />
          <ToggleBtn label="▪ CLOUD"  active={showCloud}  onClick={() => setShowCloud(v => !v)} />
          <ToggleBtn label="⊙ SAT"    active={showSat}    onClick={() => setShowSat(v => !v)} />
        </div>
      </div>

      {/* ── SCROLLABLE BODY ── */}
      <div style={{ overflowY: 'auto', flexGrow: 1, padding: '12px 16px 16px' }}>

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
                  stroke={isEquator ? 'rgba(0,180,255,0.15)' : 'rgba(0,180,255,0.08)'}
                  strokeWidth={isEquator ? 1 : 0.5}
                />
              );
            })}
            {lonLines.map(lon => {
              const [x] = m(lon, 0);
              return (
                <line
                  key={`lon${lon}`}
                  x1={x} y1={0} x2={x} y2={SVG_H}
                  stroke="rgba(0,180,255,0.08)"
                  strokeWidth={0.5}
                />
              );
            })}

            {/* ── CONTINENTS ── */}
            {CONTINENTS.map(cont => {
              const pts = cont.coords.map(([lon, lat]) => m(lon, lat).join(',')).join(' ');
              return (
                <polygon
                  key={cont.name}
                  points={pts}
                  fill="rgba(20,40,80,0.6)"
                  stroke="rgba(40,80,140,0.5)"
                  strokeWidth={0.5}
                />
              );
            })}

            {/* ── SAT BANDS ── */}
            {showSat && SAT_CONSTELLATIONS.map(sat => {
              const [, yTop]    = m(0,  sat.latBand);
              const [, yBottom] = m(0, -sat.latBand);
              const [xRight]    = m(180, 0);
              return (
                <g key={sat.name}>
                  <rect
                    x={0} y={yTop} width={SVG_W} height={yBottom - yTop}
                    fill={sat.color} stroke="none"
                  />
                  <line x1={0} y1={yTop}    x2={SVG_W} y2={yTop}
                    stroke={sat.borderColor} strokeWidth={0.8} strokeDasharray="4 3" />
                  <line x1={0} y1={yBottom} x2={SVG_W} y2={yBottom}
                    stroke={sat.borderColor} strokeWidth={0.8} strokeDasharray="4 3" />
                  <text
                    x={xRight - 4} y={yTop + 11}
                    textAnchor="end" fontSize={8}
                    fill={sat.borderColor} fontFamily={C.mono}
                  >
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
                    opacity={isHovered ? 1 : 0.7}
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
                  {/* Landing point circles */}
                  <circle cx={sx} cy={sy} r={3} fill={cable.color} style={{ pointerEvents: 'none' }} />
                  <circle cx={ex} cy={ey} r={3} fill={cable.color} style={{ pointerEvents: 'none' }} />
                </g>
              );
            })}

            {/* ── IXPs ── */}
            {showIXPs && IXPS.map(ixp => {
              const [px, py] = m(ixp.lon, ixp.lat);
              const innerR   = ixp.tier === 1 ? 6 : 4;
              const outerR   = ixp.tier === 1 ? 16 : 12;
              const animMax  = ixp.tier === 1 ? 22 : 18;
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
                  {/* Pulsing outer ring */}
                  <circle cx={px} cy={py} r={outerR}
                    fill="none" stroke="rgba(0,204,255,0.3)" strokeWidth={1}>
                    <animate attributeName="r"
                      values={`${outerR};${animMax};${outerR}`}
                      dur="3s" repeatCount="indefinite" />
                    <animate attributeName="opacity"
                      values="0.6;0;0.6"
                      dur="3s" repeatCount="indefinite" />
                  </circle>
                  {/* Inner dot */}
                  <circle cx={px} cy={py} r={innerR}
                    fill="rgba(0,204,255,0.8)" stroke="#00ccff" strokeWidth={1}
                    opacity={hoveredIXP === ixp.name ? 1 : 0.85}
                  />
                  {/* Label */}
                  <text
                    x={px} y={py + innerR + 9}
                    textAnchor="middle" fontSize={7}
                    fill={C.muted} fontFamily={C.mono}
                  >
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
              const sz       = 8;
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
            marginTop: '10px',
            background: 'rgba(10,20,40,0.9)',
            border: '1px solid rgba(0,180,255,0.2)',
            borderRadius: '6px', padding: '12px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: C.accent, marginBottom: '4px' }}>
                  {selectedItem.type === 'cable' && '⬡'}
                  {selectedItem.type === 'ixp'   && '◉'}
                  {selectedItem.type === 'cloud'  && '▪'}
                  {' '}{selectedItem.name}
                </div>
                <div style={{ fontSize: '11px', color: C.text, marginBottom: '6px' }}>
                  {selectedItem.detail}
                </div>
                {selectedItem.type === 'ixp' && IXP_STRATEGIC[selectedItem.name] && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>
                    {IXP_STRATEGIC[selectedItem.name]}
                  </div>
                )}
                {selectedItem.type === 'cable' && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>
                    Submarine cable systems are critical internet backbone infrastructure — physical
                    disruption or wiretapping events on these routes have significant global impact.
                  </div>
                )}
                {selectedItem.type === 'cloud' && (
                  <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>
                    Cloud availability zones provide redundancy within a region.
                    Outages or latency events in this region affect all co-located workloads.
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
          marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '16px',
          padding: '10px 12px',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: '6px',
        }}>
          {/* Cable legend */}
          {showCables && (
            <div>
              <div style={{ fontSize: '9px', color: C.muted, marginBottom: '5px', letterSpacing: '0.08em' }}>
                SUBMARINE CABLES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {CABLES.map(c => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '20px', height: '2px', background: c.color, borderRadius: '1px' }} />
                    <span style={{ fontSize: '9px', color: C.text }}>{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* IXP legend */}
          {showIXPs && (
            <div>
              <div style={{ fontSize: '9px', color: C.muted, marginBottom: '5px', letterSpacing: '0.08em' }}>
                IXPs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: 'rgba(0,204,255,0.8)', border: '1px solid #00ccff',
                  }} />
                  <span style={{ fontSize: '9px', color: C.text }}>Tier 1 (&gt;5 Tbps)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'rgba(0,204,255,0.8)', border: '1px solid #00ccff',
                  }} />
                  <span style={{ fontSize: '9px', color: C.text }}>Tier 2</span>
                </div>
              </div>
            </div>
          )}

          {/* Cloud legend */}
          {showCloud && (
            <div>
              <div style={{ fontSize: '9px', color: C.muted, marginBottom: '5px', letterSpacing: '0.08em' }}>
                CLOUD REGIONS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(['AWS', 'Azure', 'GCP'] as const).map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '2px',
                      background: `${PROVIDER_COLORS[p]}33`,
                      border: `1px solid ${PROVIDER_COLORS[p]}`,
                    }} />
                    <span style={{ fontSize: '9px', color: C.text }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sat legend */}
          {showSat && (
            <div>
              <div style={{ fontSize: '9px', color: C.muted, marginBottom: '5px', letterSpacing: '0.08em' }}>
                SATELLITE COVERAGE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {SAT_CONSTELLATIONS.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '20px', height: '4px',
                      background: s.color,
                      borderTop: `1px dashed ${s.borderColor}`,
                      borderBottom: `1px dashed ${s.borderColor}`,
                    }} />
                    <span style={{ fontSize: '9px', color: C.text }}>
                      {s.name} ({s.sats.toLocaleString()})
                    </span>
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
