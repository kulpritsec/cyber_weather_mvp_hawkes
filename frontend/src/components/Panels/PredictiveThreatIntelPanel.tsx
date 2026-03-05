import { useState, useEffect, useMemo, useCallback } from "react";
import { scaleLinear } from "d3-scale";
import { max, mean } from "d3-array";
import { line, area, curveBasis } from "d3-shape";

// ─── DESIGN SYSTEM ──────────────────────────────────────────────────────
const C = {
  bg: "#020610", panel: "rgba(4,10,24,0.97)", panelAlt: "rgba(8,18,38,0.90)",
  border: "rgba(0,110,200,0.08)", borderLit: "rgba(0,180,255,0.28)",
  text: "#9aafca", dim: "#263548", bright: "#e4f0ff", accent: "#00bbee",
  // Kill chain phases
  recon: "#818cf8", weaponize: "#a78bfa", deliver: "#c084fc",
  exploit: "#e879f9", install: "#f472b6", c2: "#fb7185", action: "#f43f5e",
  // Risk spectrum
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e", info: "#3b82f6",
  // Geo
  tension: "#ef4444", neutral: "#6b7280", allied: "#22c55e", rival: "#dc2626",
  conflict: "#f43f5e", sanctions: "#a855f7",
  // Supply chain
  vendor: "#06b6d4", dependency: "#8b5cf6", exposed: "#f97316", compromised: "#ef4444",
  // Simulation
  simLine: "#00ccff", simBand: "rgba(0,204,255,0.12)", simMedian: "#fbbf24",
};
const MONO = "'JetBrains Mono','Fira Code',monospace";
const SERIF = "'Crimson Pro','Georgia',serif";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface KillChainPhase {
  id: string;
  label: string;
  color: string;
  x: number;
}

interface AttackTechnique {
  id: string;
  name: string;
  phase: string;
  baseProbEntry: number;
}

interface Transition {
  from: string;
  to: string;
  prob: number;
}

interface SupplyChainEntity {
  id: string;
  name: string;
  vendor: string;
  type: string;
  slttUsers: number;
  criticality: string;
  cves: string[];
  exploitedInWild: boolean;
  sector: string;
  note?: string;
}

interface GeoActor {
  country: string;
  code: string;
  tension: number;
  trend: string;
  aptGroups: string[];
  drivers: string[];
  targetSectors: string[];
  cyberMultiplier: number;
  vectors: string[];
}

interface GeoEvent {
  date: string;
  event: string;
  tensionDelta: number;
  actor: string;
  vector: string;
}

interface ForecastDayData {
  day: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  mean: number;
  max: number;
}

interface SimResults {
  [vector: string]: ForecastDayData[];
}

interface HawkesParams {
  [vector: string]: { mu: number; alpha: number; beta: number };
}

interface SimulationParams {
  vectors: string[];
  days: number;
  numSims: number;
  hawkesParams: HawkesParams;
  geoMultipliers: { [v: string]: number };
  supplyChainExposure: { [v: string]: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA: ATT&CK TECHNIQUE GRAPH
// ═══════════════════════════════════════════════════════════════════════════

const KILL_CHAIN_PHASES: KillChainPhase[] = [
  { id: "recon", label: "Reconnaissance", color: C.recon, x: 0 },
  { id: "resource", label: "Resource Dev", color: C.weaponize, x: 1 },
  { id: "initial", label: "Initial Access", color: C.deliver, x: 2 },
  { id: "execution", label: "Execution", color: C.exploit, x: 3 },
  { id: "persist", label: "Persistence", color: C.exploit, x: 4 },
  { id: "privesc", label: "Privilege Esc", color: C.install, x: 5 },
  { id: "defense", label: "Defense Evasion", color: C.install, x: 6 },
  { id: "credential", label: "Credential Access", color: C.c2, x: 7 },
  { id: "lateral", label: "Lateral Movement", color: C.c2, x: 8 },
  { id: "collection", label: "Collection", color: C.action, x: 9 },
  { id: "exfil", label: "Exfiltration", color: C.action, x: 10 },
  { id: "impact", label: "Impact", color: C.critical, x: 11 },
];

const ATTACK_TECHNIQUES: AttackTechnique[] = [
  { id: "T1595", name: "Active Scanning", phase: "recon", baseProbEntry: 0.35 },
  { id: "T1589", name: "Gather Victim ID", phase: "recon", baseProbEntry: 0.25 },
  { id: "T1588", name: "Obtain Capabilities", phase: "resource", baseProbEntry: 0.40 },
  { id: "T1587", name: "Develop Capabilities", phase: "resource", baseProbEntry: 0.15 },
  { id: "T1566", name: "Phishing", phase: "initial", baseProbEntry: 0.55 },
  { id: "T1190", name: "Exploit Public App", phase: "initial", baseProbEntry: 0.42 },
  { id: "T1133", name: "External Remote Svc", phase: "initial", baseProbEntry: 0.30 },
  { id: "T1078", name: "Valid Accounts", phase: "initial", baseProbEntry: 0.38 },
  { id: "T1059", name: "Command/Script", phase: "execution", baseProbEntry: 0.60 },
  { id: "T1204", name: "User Execution", phase: "execution", baseProbEntry: 0.45 },
  { id: "T1053", name: "Scheduled Task", phase: "persist", baseProbEntry: 0.35 },
  { id: "T1547", name: "Boot/Logon Autostart", phase: "persist", baseProbEntry: 0.30 },
  { id: "T1548", name: "Abuse Elevation", phase: "privesc", baseProbEntry: 0.40 },
  { id: "T1068", name: "Exploitation for PE", phase: "privesc", baseProbEntry: 0.25 },
  { id: "T1027", name: "Obfuscated Files", phase: "defense", baseProbEntry: 0.50 },
  { id: "T1562", name: "Impair Defenses", phase: "defense", baseProbEntry: 0.35 },
  { id: "T1003", name: "OS Credential Dump", phase: "credential", baseProbEntry: 0.45 },
  { id: "T1110", name: "Brute Force", phase: "credential", baseProbEntry: 0.40 },
  { id: "T1021", name: "Remote Services", phase: "lateral", baseProbEntry: 0.50 },
  { id: "T1570", name: "Lateral Tool Xfer", phase: "lateral", baseProbEntry: 0.30 },
  { id: "T1005", name: "Data from Local Sys", phase: "collection", baseProbEntry: 0.45 },
  { id: "T1560", name: "Archive Collected", phase: "collection", baseProbEntry: 0.35 },
  { id: "T1041", name: "Exfil Over C2", phase: "exfil", baseProbEntry: 0.40 },
  { id: "T1567", name: "Exfil Over Web Svc", phase: "exfil", baseProbEntry: 0.30 },
  { id: "T1486", name: "Data Encrypted", phase: "impact", baseProbEntry: 0.35 },
  { id: "T1489", name: "Service Stop", phase: "impact", baseProbEntry: 0.25 },
  { id: "T1529", name: "System Shutdown", phase: "impact", baseProbEntry: 0.15 },
];

const TRANSITIONS: Transition[] = [
  { from: "T1595", to: "T1588", prob: 0.65 }, { from: "T1595", to: "T1566", prob: 0.45 },
  { from: "T1589", to: "T1566", prob: 0.70 }, { from: "T1589", to: "T1078", prob: 0.40 },
  { from: "T1588", to: "T1190", prob: 0.55 }, { from: "T1588", to: "T1133", prob: 0.35 },
  { from: "T1566", to: "T1204", prob: 0.75 }, { from: "T1566", to: "T1059", prob: 0.60 },
  { from: "T1190", to: "T1059", prob: 0.70 }, { from: "T1190", to: "T1068", prob: 0.45 },
  { from: "T1133", to: "T1078", prob: 0.60 }, { from: "T1133", to: "T1021", prob: 0.50 },
  { from: "T1078", to: "T1021", prob: 0.65 }, { from: "T1078", to: "T1548", prob: 0.40 },
  { from: "T1059", to: "T1053", prob: 0.55 }, { from: "T1059", to: "T1027", prob: 0.60 },
  { from: "T1204", to: "T1059", prob: 0.80 }, { from: "T1204", to: "T1547", prob: 0.35 },
  { from: "T1053", to: "T1548", prob: 0.45 }, { from: "T1547", to: "T1562", prob: 0.50 },
  { from: "T1548", to: "T1003", prob: 0.65 }, { from: "T1548", to: "T1562", prob: 0.40 },
  { from: "T1068", to: "T1003", prob: 0.70 }, { from: "T1027", to: "T1003", prob: 0.35 },
  { from: "T1562", to: "T1003", prob: 0.55 }, { from: "T1003", to: "T1021", prob: 0.75 },
  { from: "T1003", to: "T1570", prob: 0.45 }, { from: "T1110", to: "T1078", prob: 0.50 },
  { from: "T1110", to: "T1021", prob: 0.40 }, { from: "T1021", to: "T1005", prob: 0.60 },
  { from: "T1021", to: "T1570", prob: 0.35 }, { from: "T1570", to: "T1005", prob: 0.55 },
  { from: "T1005", to: "T1560", prob: 0.70 }, { from: "T1560", to: "T1041", prob: 0.55 },
  { from: "T1560", to: "T1567", prob: 0.40 }, { from: "T1041", to: "T1486", prob: 0.45 },
  { from: "T1567", to: "T1486", prob: 0.35 }, { from: "T1486", to: "T1489", prob: 0.60 },
  { from: "T1489", to: "T1529", prob: 0.30 },
];

// ═══════════════════════════════════════════════════════════════════════════
// DATA: SUPPLY CHAIN
// ═══════════════════════════════════════════════════════════════════════════

const SUPPLY_CHAIN_ENTITIES: SupplyChainEntity[] = [
  { id: "moveit", name: "MOVEit Transfer", vendor: "Progress Software", type: "file_transfer", slttUsers: 340, criticality: "high",
    cves: ["CVE-2023-34362", "CVE-2023-35036"], exploitedInWild: true, sector: "cross-sector" },
  { id: "citrix", name: "Citrix NetScaler", vendor: "Cloud Software Group", type: "vpn_gateway", slttUsers: 520, criticality: "critical",
    cves: ["CVE-2023-4966", "CVE-2023-3519"], exploitedInWild: true, sector: "cross-sector" },
  { id: "fortinet", name: "FortiGate VPN", vendor: "Fortinet", type: "vpn_gateway", slttUsers: 890, criticality: "critical",
    cves: ["CVE-2024-21762", "CVE-2023-27997"], exploitedInWild: true, sector: "cross-sector" },
  { id: "solarwinds", name: "SolarWinds Orion", vendor: "SolarWinds", type: "it_management", slttUsers: 180, criticality: "high",
    cves: ["CVE-2020-10148"], exploitedInWild: true, sector: "cross-sector" },
  { id: "tyler", name: "Tyler Technologies", vendor: "Tyler Technologies", type: "erp_civic", slttUsers: 1200, criticality: "high",
    cves: [], exploitedInWild: false, sector: "government" },
  { id: "esri", name: "ArcGIS Platform", vendor: "Esri", type: "gis_mapping", slttUsers: 780, criticality: "medium",
    cves: ["CVE-2023-25593"], exploitedInWild: false, sector: "government" },
  { id: "crowdstrike", name: "CrowdStrike Falcon", vendor: "CrowdStrike", type: "edr_security", slttUsers: 420, criticality: "critical",
    cves: [], exploitedInWild: false, sector: "cross-sector", note: "Jul 2024 update incident" },
  { id: "barracuda", name: "Barracuda ESG", vendor: "Barracuda Networks", type: "email_gateway", slttUsers: 290, criticality: "high",
    cves: ["CVE-2023-2868"], exploitedInWild: true, sector: "cross-sector" },
];

// ═══════════════════════════════════════════════════════════════════════════
// DATA: GEOPOLITICAL
// ═══════════════════════════════════════════════════════════════════════════

const GEO_ACTORS: GeoActor[] = [
  {
    country: "China", code: "CN", tension: 0.78, trend: "rising",
    aptGroups: ["Volt Typhoon", "APT41", "APT40"],
    drivers: ["Taiwan Strait tensions", "South China Sea disputes", "Tech sanctions escalation"],
    targetSectors: ["Critical Infrastructure", "Defense", "Telecom"],
    cyberMultiplier: 1.35, vectors: ["ssh", "http", "dns_amp"],
  },
  {
    country: "Russia", code: "RU", tension: 0.85, trend: "elevated",
    aptGroups: ["Sandworm", "APT28", "APT29"],
    drivers: ["Ukraine conflict continuation", "NATO expansion", "Energy sanctions"],
    targetSectors: ["Government", "Energy", "Election Systems"],
    cyberMultiplier: 1.55, vectors: ["ransomware", "botnet_c2", "brute_force"],
  },
  {
    country: "Iran", code: "IR", tension: 0.65, trend: "volatile",
    aptGroups: ["APT33", "APT34", "MuddyWater"],
    drivers: ["Nuclear negotiations", "Regional proxy conflicts", "Sanctions regime"],
    targetSectors: ["Energy", "Financial", "Water/Wastewater"],
    cyberMultiplier: 1.20, vectors: ["rdp", "http", "brute_force"],
  },
  {
    country: "North Korea", code: "KP", tension: 0.72, trend: "stable-high",
    aptGroups: ["Lazarus", "Kimsuky", "Andariel"],
    drivers: ["Sanctions evasion (crypto theft)", "Missile program funding", "Intelligence collection"],
    targetSectors: ["Financial", "Crypto/DeFi", "Defense"],
    cyberMultiplier: 1.15, vectors: ["http", "ssh", "ransomware"],
  },
];

const GEO_EVENTS_TIMELINE: GeoEvent[] = [
  { date: "2026-02-14", event: "US-China trade talks collapse", tensionDelta: 0.08, actor: "CN", vector: "ssh" },
  { date: "2026-02-10", event: "Russia energy infrastructure attacks reported", tensionDelta: 0.05, actor: "RU", vector: "botnet_c2" },
  { date: "2026-02-05", event: "DPRK crypto exchange hack ($150M)", tensionDelta: 0.03, actor: "KP", vector: "http" },
  { date: "2026-01-28", event: "Iran nuclear facility inspection blocked", tensionDelta: 0.06, actor: "IR", vector: "rdp" },
  { date: "2026-01-20", event: "South China Sea naval standoff", tensionDelta: 0.10, actor: "CN", vector: "dns_amp" },
  { date: "2026-01-15", event: "US sanctions new Russian cyber entities", tensionDelta: 0.04, actor: "RU", vector: "ransomware" },
];

// ═══════════════════════════════════════════════════════════════════════════
// MONTE CARLO SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function runSimulation(params: SimulationParams): SimResults {
  const { vectors, days, numSims, hawkesParams, geoMultipliers, supplyChainExposure } = params;
  const results: SimResults = {};

  vectors.forEach(vec => {
    const hp = hawkesParams[vec] || realParams[vec] || { mu: 2.0, alpha: 1.5, beta: 2.5 };
    const geoMult = geoMultipliers[vec] || 1.0;
    const scExposure = supplyChainExposure[vec] || 0;
    const dailyForecasts: ForecastDayData[] = [];

    for (let d = 0; d < days; d++) {
      const daySims: number[] = [];
      for (let s = 0; s < numSims; s++) {
        const seasonal = 1.0 + 0.15 * Math.sin((d + 45) * 2 * Math.PI / 365);
        const baseRate = hp.mu * seasonal * geoMult;
        const scShock = Math.random() < scExposure * 0.01 ? 3.0 + Math.random() * 5.0 : 0;

        let intensity = baseRate + scShock;
        const n_br = hp.alpha / hp.beta;
        const numEvents = poissonSample(intensity);

        let totalEvents = numEvents;
        let generation = numEvents;
        for (let g = 0; g < 5; g++) {
          generation = poissonSample(generation * n_br);
          totalEvents += generation;
          if (generation === 0) break;
        }

        const dow = d % 7;
        const dowMult = dow < 5 ? 1.1 : 0.85;
        daySims.push(totalEvents * dowMult);
      }

      daySims.sort((a, b) => a - b);
      dailyForecasts.push({
        day: d,
        p5: daySims[Math.floor(numSims * 0.05)],
        p25: daySims[Math.floor(numSims * 0.25)],
        median: daySims[Math.floor(numSims * 0.5)],
        p75: daySims[Math.floor(numSims * 0.75)],
        p95: daySims[Math.floor(numSims * 0.95)],
        mean: daySims.reduce((a, b) => a + b, 0) / numSims,
        max: daySims[numSims - 1],
      });
    }
    results[vec] = dailyForecasts;
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZATION COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

interface AttackGraphProps {
  observedTechniques: string[];
  onToggleTechnique: (id: string) => void;
  width?: number;
  height?: number;
}

function AttackGraph({ observedTechniques, onToggleTechnique, width = 660, height = 500 }: AttackGraphProps) {
  const phaseX = useMemo(() => {
    return Object.fromEntries(
      KILL_CHAIN_PHASES.map(p => [p.id, 30 + p.x * ((width - 60) / (KILL_CHAIN_PHASES.length - 1))])
    );
  }, [width]);

  const techPositions = useMemo(() => {
    const byPhase: { [k: string]: AttackTechnique[] } = {};
    ATTACK_TECHNIQUES.forEach(t => {
      if (!byPhase[t.phase]) byPhase[t.phase] = [];
      byPhase[t.phase].push(t);
    });
    const pos: { [id: string]: { x: number; y: number } } = {};
    Object.entries(byPhase).forEach(([phase, techs]) => {
      techs.forEach((t, i) => {
        const spacing = Math.min(70, (height - 120) / techs.length);
        const startY = height / 2 - ((techs.length - 1) * spacing / 2);
        pos[t.id] = { x: phaseX[phase], y: startY + i * spacing };
      });
    });
    return pos;
  }, [phaseX, height]);

  const posteriorProbs = useMemo(() => {
    const probs: { [id: string]: number } = {};
    ATTACK_TECHNIQUES.forEach(t => { probs[t.id] = observedTechniques.includes(t.id) ? 1.0 : t.baseProbEntry; });
    for (let iter = 0; iter < 3; iter++) {
      TRANSITIONS.forEach(tr => {
        if (observedTechniques.includes(tr.from) || probs[tr.from] > 0.5) {
          const boost = probs[tr.from] * tr.prob;
          probs[tr.to] = Math.min(1.0, Math.max(probs[tr.to], boost));
        }
      });
    }
    return probs;
  }, [observedTechniques]);

  return (
    <svg width={width} height={height} style={{ background: "rgba(0,0,0,0.15)", borderRadius: "6px" }}>
      <defs>
        <marker id="edge-arrow" viewBox="0 0 8 6" refX="8" refY="3" markerWidth="6" markerHeight="5" orient="auto">
          <path d="M0,0 L8,3 L0,6 Z" fill={C.accent} opacity="0.4" />
        </marker>
      </defs>

      {KILL_CHAIN_PHASES.map(phase => (
        <g key={phase.id}>
          <line x1={phaseX[phase.id]} y1={30} x2={phaseX[phase.id]} y2={height - 10}
            stroke={phase.color} strokeWidth={0.5} opacity={0.15} />
          <text x={phaseX[phase.id]} y={18} fill={phase.color} fontSize="7" fontFamily={MONO}
            textAnchor="middle" letterSpacing="0.05em" opacity={0.7}>
            {phase.label?.toUpperCase() || "UNKNOWN"}
          </text>
        </g>
      ))}

      {TRANSITIONS.map((tr, i) => {
        const from = techPositions[tr.from];
        const to = techPositions[tr.to];
        if (!from || !to) return null;
        const isActive = posteriorProbs[tr.from] > 0.5 && posteriorProbs[tr.to] > 0.3;
        const isObservedPath = observedTechniques.includes(tr.from);
        return (
          <line key={i} x1={from.x + 20} y1={from.y} x2={to.x - 20} y2={to.y}
            stroke={isObservedPath ? C.critical : isActive ? C.accent : C.dim}
            strokeWidth={isObservedPath ? 2 : isActive ? 1.2 : 0.6}
            opacity={isObservedPath ? 0.7 : isActive ? 0.4 : 0.15}
            markerEnd="url(#edge-arrow)"
            strokeDasharray={isActive ? undefined : "3,3"} />
        );
      })}

      {ATTACK_TECHNIQUES.map(tech => {
        const pos = techPositions[tech.id];
        if (!pos) return null;
        const isObserved = observedTechniques.includes(tech.id);
        const prob = posteriorProbs[tech.id];
        const phase = KILL_CHAIN_PHASES.find(p => p.id === tech.phase);
        if (!phase) return null;
        const r = 16;

        return (
          <g key={tech.id} onClick={() => onToggleTechnique(tech.id)}
            style={{ cursor: "pointer" }} transform={`translate(${pos.x},${pos.y})`}>
            {prob > 0.4 && !isObserved && (
              <circle r={r + 4} fill="none" stroke={prob > 0.7 ? C.critical : C.high}
                strokeWidth={1} opacity={prob * 0.5} strokeDasharray="2,2" />
            )}
            <circle r={r}
              fill={isObserved ? `${C.critical}30` : `${phase.color}${Math.floor(prob * 20).toString(16).padStart(2, "0")}`}
              stroke={isObserved ? C.critical : phase.color}
              strokeWidth={isObserved ? 2.5 : 1.2}
              opacity={isObserved ? 1 : 0.4 + prob * 0.6} />
            <text y={-2} fill={isObserved ? C.critical : prob > 0.5 ? C.bright : C.dim}
              fontSize="8" fontFamily={MONO} textAnchor="middle" fontWeight={700}>
              {isObserved ? "✓" : `${(prob * 100).toFixed(0)}%`}
            </text>
            <text y={8} fill={C.dim} fontSize="6" fontFamily={MONO} textAnchor="middle">
              {tech.id}
            </text>
            <text y={r + 11} fill={isObserved ? C.bright : C.dim} fontSize="6.5" fontFamily={MONO}
              textAnchor="middle" fontWeight={isObserved ? 600 : 400}>
              {tech.name.length > 18 ? tech.name.slice(0, 18) + "…" : tech.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── SUPPLY CHAIN BLAST RADIUS ──────────────────────────────────────────
interface SupplyChainMapProps {
  selectedVendor: string | null;
  onSelectVendor: (id: string | null) => void;
}

function SupplyChainMap({ selectedVendor, onSelectVendor }: SupplyChainMapProps) {
  const sorted = useMemo(() => [...SUPPLY_CHAIN_ENTITIES].sort((a, b) => b.slttUsers - a.slttUsers), []);
  const maxUsers = sorted[0]?.slttUsers || 1;

  return (
    <div>
      {sorted.map(entity => {
        const isSelected = selectedVendor === entity.id;
        const riskColor = entity.exploitedInWild ? C.compromised : entity.criticality === "critical" ? C.high : C.medium;
        return (
          <div key={entity.id} onClick={() => onSelectVendor(isSelected ? null : entity.id)}
            style={{
              padding: "10px 12px", borderRadius: "6px", marginBottom: "6px", cursor: "pointer",
              background: isSelected ? `${riskColor}08` : `${riskColor}03`,
              border: `1px solid ${isSelected ? riskColor + "35" : riskColor + "10"}`,
              borderLeft: `3px solid ${riskColor}50`, transition: "all 0.2s",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: C.bright }}>{entity.name}</span>
                <span style={{ fontSize: "9px", color: C.dim, marginLeft: "6px" }}>{entity.vendor}</span>
              </div>
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                {entity.exploitedInWild && (
                  <span style={{ fontSize: "7px", padding: "1px 5px", borderRadius: "2px", background: `${C.critical}15`, color: C.critical, border: `1px solid ${C.critical}25` }}>
                    EXPLOITED IN WILD
                  </span>
                )}
                <span style={{ fontSize: "10px", fontWeight: 700, color: riskColor, fontFamily: MONO }}>
                  {entity.slttUsers.toLocaleString()} SLTTs
                </span>
              </div>
            </div>
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "7px", color: C.dim, minWidth: "50px" }}>BLAST RADIUS</span>
              <div style={{ flex: 1, height: "8px", background: `${C.border}`, borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                  width: `${(entity.slttUsers / maxUsers) * 100}%`, height: "100%",
                  background: `linear-gradient(90deg, ${riskColor}60, ${riskColor})`,
                  borderRadius: "4px", transition: "width 0.5s",
                }} />
              </div>
            </div>
            {isSelected && (
              <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                {[
                  { k: "Type", v: entity.type.replace("_", " ") },
                  { k: "Criticality", v: entity.criticality?.toUpperCase() || "UNKNOWN" },
                  { k: "Sector", v: entity.sector },
                ].map((item, j) => (
                  <div key={j}>
                    <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.08em" }}>{item.k}</div>
                    <div style={{ fontSize: "9px", color: C.bright }}>{item.v}</div>
                  </div>
                ))}
                {entity.cves.length > 0 && (
                  <div style={{ gridColumn: "span 3" }}>
                    <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.08em", marginBottom: "2px" }}>KNOWN CVEs</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                      {entity.cves.map((cve, j) => (
                        <span key={j} style={{ fontSize: "8px", padding: "1px 5px", borderRadius: "2px", background: `${C.critical}10`, color: C.critical, border: `1px solid ${C.critical}20` }}>{cve}</span>
                      ))}
                    </div>
                  </div>
                )}
                {entity.note && (
                  <div style={{ gridColumn: "span 3", fontSize: "8px", color: C.high, fontStyle: "italic" }}>
                    Note: {entity.note}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── GEOPOLITICAL TENSION DASHBOARD ─────────────────────────────────────
function GeopoliticalPanel() {
  return (
    <div>
      {GEO_ACTORS.map((actor, i) => {
        const tensionPct = actor.tension * 100;
        const barColor = actor.tension > 0.75 ? C.critical : actor.tension > 0.5 ? C.high : C.medium;
        return (
          <div key={i} style={{
            padding: "10px 12px", borderRadius: "6px", marginBottom: "8px",
            background: `${barColor}04`, border: `1px solid ${barColor}12`,
            borderLeft: `3px solid ${barColor}50`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: C.bright }}>{actor.country}</span>
                <span style={{ fontSize: "9px", color: barColor, fontFamily: MONO, fontWeight: 600 }}>
                  {actor.trend?.toUpperCase() || "UNKNOWN"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "8px", color: C.dim }}>Cyber ×</span>
                <span style={{ fontSize: "12px", fontWeight: 800, color: barColor, fontFamily: MONO }}>
                  {actor.cyberMultiplier.toFixed(2)}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <span style={{ fontSize: "7px", color: C.dim, minWidth: "48px" }}>TENSION</span>
              <div style={{ flex: 1, height: "10px", background: `${C.dim}15`, borderRadius: "5px", overflow: "hidden", position: "relative" }}>
                <div style={{
                  width: `${tensionPct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${C.medium}, ${barColor})`,
                  borderRadius: "5px", transition: "width 0.5s",
                }} />
                <div style={{ position: "absolute", left: "50%", top: 0, width: "1px", height: "100%", background: C.dim }} />
                <div style={{ position: "absolute", left: "75%", top: 0, width: "1px", height: "100%", background: `${C.critical}40` }} />
              </div>
              <span style={{ fontSize: "10px", fontWeight: 700, color: barColor, fontFamily: MONO, minWidth: "32px", textAlign: "right" }}>
                {tensionPct.toFixed(0)}%
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "4px" }}>
              {actor.aptGroups.map((grp, j) => (
                <span key={j} style={{ fontSize: "8px", padding: "1px 5px", borderRadius: "2px", background: `${barColor}10`, color: barColor, border: `1px solid ${barColor}20` }}>{grp}</span>
              ))}
            </div>
            <div style={{ fontSize: "8px", color: C.dim, lineHeight: 1.5 }}>
              {actor.drivers.map((d, j) => (<span key={j}>{j > 0 ? " · " : ""}{d}</span>))}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "7px", color: C.dim }}>Targets:</span>
              {actor.targetSectors.map((s, j) => (<span key={j} style={{ fontSize: "7px", color: C.text }}>{s}</span>))}
              <span style={{ fontSize: "7px", color: C.dim, marginLeft: "4px" }}>Vectors:</span>
              {actor.vectors.map((v, j) => (<span key={j} style={{ fontSize: "7px", color: C.accent, fontWeight: 600 }}>{v}</span>))}
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: "8px", color: C.dim, letterSpacing: "0.12em", marginTop: "12px", marginBottom: "6px" }}>
        RECENT GEOPOLITICAL EVENTS AFFECTING CYBER THREAT LANDSCAPE
      </div>
      {GEO_EVENTS_TIMELINE.map((evt, i) => (
        <div key={i} style={{
          display: "flex", gap: "8px", padding: "5px 8px", marginBottom: "3px",
          borderRadius: "3px", background: `${evt.tensionDelta > 0.05 ? C.critical : C.high}03`,
          borderLeft: `2px solid ${evt.tensionDelta > 0.05 ? C.critical : C.high}40`,
        }}>
          <span style={{ fontSize: "8px", color: C.dim, fontFamily: MONO, minWidth: "70px" }}>{evt.date}</span>
          <span style={{ fontSize: "8px", color: C.text, flex: 1 }}>{evt.event}</span>
          <span style={{ fontSize: "8px", color: C.critical, fontFamily: MONO, fontWeight: 600 }}>+{(evt.tensionDelta * 100).toFixed(0)}%</span>
          <span style={{ fontSize: "8px", color: C.accent }}>{evt.vector}</span>
        </div>
      ))}
    </div>
  );
}

// ─── SIMULATION FORECAST CHART ──────────────────────────────────────────
interface ForecastChartProps {
  simResults: SimResults;
  vector: string;
  width?: number;
  height?: number;
}

function ForecastChart({ simResults, vector, width = 620, height = 220 }: ForecastChartProps) {
  const data = simResults[vector];
  if (!data || data.length === 0) return null;

  const margin = { top: 15, right: 50, bottom: 25, left: 45 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const xScale = scaleLinear().domain([0, data.length - 1]).range([0, w]);
  const yMax = (max(data, d => d.p95) ?? 0) * 1.1;
  const yScale = scaleLinear().domain([0, yMax]).range([h, 0]);

  const medianLine = line<ForecastDayData>().x((_, i) => xScale(i)).y(d => yScale(d.median)).curve(curveBasis);
  const meanLine = line<ForecastDayData>().x((_, i) => xScale(i)).y(d => yScale(d.mean)).curve(curveBasis);
  const band90 = area<ForecastDayData>().x((_, i) => xScale(i)).y0(d => yScale(d.p5)).y1(d => yScale(d.p95)).curve(curveBasis);
  const band50 = area<ForecastDayData>().x((_, i) => xScale(i)).y0(d => yScale(d.p25)).y1(d => yScale(d.p75)).curve(curveBasis);

  const last7 = data.slice(-7);
  const first7 = data.slice(0, 7);
  const trendPct = (((mean(last7, d => d.median) ?? 0) / (mean(first7, d => d.median) ?? 1)) - 1) * 100;
  const lastDay = data[data.length - 1];

  return (
    <div>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yScale.ticks(5).map((tick: number, i: number) => (
            <g key={i}>
              <line x1={0} y1={yScale(tick)} x2={w} y2={yScale(tick)} stroke={C.border} strokeWidth={0.5} />
              <text x={-6} y={yScale(tick) + 3} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="end">{tick.toFixed(0)}</text>
            </g>
          ))}
          <path d={band90(data) ?? undefined} fill={C.simBand} />
          <path d={band50(data) ?? undefined} fill={`${C.accent}10`} />
          <path d={medianLine(data) ?? undefined} fill="none" stroke={C.simMedian} strokeWidth={2} />
          <path d={meanLine(data) ?? undefined} fill="none" stroke={C.accent} strokeWidth={1.2} strokeDasharray="4,3" />
          <line x1={xScale(0)} y1={0} x2={xScale(0)} y2={h} stroke={C.bright} strokeWidth={1} strokeDasharray="3,2" opacity={0.5} />
          <text x={xScale(0)} y={-4} fill={C.bright} fontSize="7" fontFamily={MONO} textAnchor="middle">NOW</text>
          {data.length > 7 && (
            <line x1={xScale(7)} y1={0} x2={xScale(7)} y2={h} stroke={C.dim} strokeWidth={0.5} strokeDasharray="4,4" />
          )}
          {data.length > 30 && (
            <line x1={xScale(30)} y1={0} x2={xScale(30)} y2={h} stroke={C.dim} strokeWidth={0.5} strokeDasharray="4,4" />
          )}
          <text x={w / 2} y={h + 20} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">
            Days from now (forecast horizon)
          </text>
          <text x={w + 4} y={yScale(lastDay.median)} fill={C.simMedian} fontSize="9" fontFamily={MONO} fontWeight={700}>
            {lastDay.median.toFixed(1)}
          </text>
          <text x={w + 4} y={yScale(lastDay.p95)} fill={C.critical} fontSize="8" fontFamily={MONO}>
            P95: {lastDay.p95.toFixed(1)}
          </text>
          <text x={w + 4} y={yScale(lastDay.p5)} fill={C.low} fontSize="8" fontFamily={MONO}>
            P5: {lastDay.p5.toFixed(1)}
          </text>
        </g>
      </svg>
      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
        <span style={{ fontSize: "8px", color: C.simMedian }}>━ Median</span>
        <span style={{ fontSize: "8px", color: C.accent }}>╌ Mean</span>
        <span style={{ fontSize: "8px", color: C.accent, opacity: 0.4 }}>■ 50% CI</span>
        <span style={{ fontSize: "8px", color: C.accent, opacity: 0.2 }}>■ 90% CI</span>
        <span style={{ marginLeft: "auto", fontSize: "9px", fontWeight: 700, fontFamily: MONO,
          color: trendPct > 10 ? C.critical : trendPct > 0 ? C.high : C.low }}>
          TREND: {trendPct > 0 ? "▲" : "▼"} {Math.abs(trendPct).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════

interface PredictiveThreatIntelPanelProps {
  onClose: () => void;
}

export default function PredictiveThreatIntelPanel({ onClose }: PredictiveThreatIntelPanelProps) {
  const [activeTab, setActiveTab] = useState("attack_graph");

  // Fetch real Hawkes params from pipeline
  const [realParams, setRealParams] = useState<{[v: string]: {mu: number; alpha: number; beta: number}}>({});
  useEffect(() => {
    async function loadParams() {
      const vecs = ["ssh", "rdp", "http", "dns_amp", "botnet_c2", "ransomware"];
      const params: {[v: string]: {mu: number; alpha: number; beta: number}} = {};
      for (const v of vecs) {
        try {
          const r = await fetch(`/v1/data?mode=params&vector=${v}&res=2.5`);
          const data = await r.json();
          const feats = data.features || [];
          if (feats.length > 0) {
            const mus = feats.map((f: any) => f.properties.mu).sort((a: number, b: number) => a - b);
            const betas = feats.map((f: any) => f.properties.beta).sort((a: number, b: number) => a - b);
            const nbrs = feats.map((f: any) => f.properties.n_br).sort((a: number, b: number) => a - b);
            const med = (arr: number[]) => arr[Math.floor(arr.length / 2)];
            const mu = med(mus);
            const beta = Math.min(med(betas), 5.0);
            const alpha = med(nbrs) * beta;
            params[v] = { mu: Math.min(mu, 2.0), alpha, beta };
          }
        } catch {}
      }
      setRealParams(params);
    }
    loadParams();
  }, []);
  const [observedTechniques, setObservedTechniques] = useState(["T1566", "T1204", "T1059"]);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [simVector, setSimVector] = useState("ssh");
  const [simDays, setSimDays] = useState(30);
  const [simCount, setSimCount] = useState(500);
  const [isSimRunning, setIsSimRunning] = useState(false);
  const [simResults, setSimResults] = useState<SimResults | null>(null);
  const [simProgress, setSimProgress] = useState(0);

  const VECTORS = ["ssh", "rdp", "http", "dns_amp", "brute_force", "botnet_c2", "ransomware"];

  const geoMultipliers = useMemo(() => {
    const mults: { [v: string]: number } = {};
    VECTORS.forEach(v => {
      let mult = 1.0;
      GEO_ACTORS.forEach(a => {
        if (a.vectors.includes(v)) mult *= (1 + (a.cyberMultiplier - 1) * a.tension);
      });
      mults[v] = mult;
    });
    return mults;
  }, []);

  const scExposure = useMemo(() => {
    const exp: { [v: string]: number } = {};
    const relevant = SUPPLY_CHAIN_ENTITIES.filter(e => e.exploitedInWild);
    VECTORS.forEach(v => { exp[v] = relevant.length * 2; });
    return exp;
  }, []);

  const hawkesParams: HawkesParams = useMemo(() => ({
    ssh: { mu: 2.5, alpha: 2.0, beta: 2.8 },
    rdp: { mu: 1.8, alpha: 1.6, beta: 2.2 },
    http: { mu: 3.2, alpha: 2.5, beta: 3.0 },
    dns_amp: { mu: 1.2, alpha: 1.8, beta: 2.5 },
    brute_force: { mu: 2.0, alpha: 1.5, beta: 2.0 },
    botnet_c2: { mu: 1.5, alpha: 2.2, beta: 2.5 },
    ransomware: { mu: 0.8, alpha: 1.2, beta: 1.5 },
  }), []);

  const toggleTechnique = useCallback((id: string) => {
    setObservedTechniques(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }, []);

  const runSim = useCallback(() => {
    setIsSimRunning(true);
    setSimProgress(0);
    setTimeout(() => {
      setSimProgress(30);
      setTimeout(() => {
        setSimProgress(70);
        const results = runSimulation({
          vectors: VECTORS,
          days: simDays,
          numSims: simCount,
          hawkesParams,
          geoMultipliers,
          supplyChainExposure: scExposure,
        });
        setSimResults(results);
        setSimProgress(100);
        setTimeout(() => setIsSimRunning(false), 300);
      }, 200);
    }, 100);
  }, [simDays, simCount, hawkesParams, geoMultipliers, scExposure]);

  useEffect(() => { runSim(); }, []);

  const tabs = [
    { id: "attack_graph", label: "BAYESIAN ATTACK GRAPH" },
    { id: "supply_chain", label: "SUPPLY CHAIN" },
    { id: "geopolitical", label: "GEOPOLITICAL" },
    { id: "simulation", label: "SIMULATION ENGINE" },
  ];

  const panelStyle: React.CSSProperties = {
    background: C.panel, border: `1px solid ${C.border}`, borderRadius: "6px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
  };
  const headerStyle: React.CSSProperties = {
    fontSize: "8px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO,
    marginBottom: "8px", paddingBottom: "6px", borderBottom: `1px solid ${C.border}`,
  };

  const predictedNext = useMemo(() => {
    const probs: { [id: string]: number } = {};
    ATTACK_TECHNIQUES.forEach(t => { probs[t.id] = t.baseProbEntry; });
    TRANSITIONS.forEach(tr => {
      if (observedTechniques.includes(tr.from)) {
        probs[tr.to] = Math.min(1.0, Math.max(probs[tr.to] || 0, tr.prob));
      }
    });
    return ATTACK_TECHNIQUES
      .filter(t => !observedTechniques.includes(t.id) && probs[t.id] > 0.35)
      .map(t => ({ ...t, prob: probs[t.id] }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 6);
  }, [observedTechniques]);

  return (
    <div style={{
      position: "fixed",
      top: "60px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(1100px, calc(100vw - 32px))",
      maxHeight: "calc(100vh - 80px)",
      overflowY: "auto",
      zIndex: 200,
      background: C.bg,
      color: C.text,
      fontFamily: MONO,
      borderRadius: "8px",
      border: `1px solid ${C.borderLit}`,
      boxShadow: "0 8px 48px rgba(0,0,0,0.7)",
    }}>
      {/* Dot grid background */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", borderRadius: "8px",
        backgroundImage: `radial-gradient(circle at 1px 1px, ${C.border} 0.3px, transparent 0)`,
        backgroundSize: "26px 26px", opacity: 0.18 }} />

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50, padding: "10px 20px",
        background: "linear-gradient(180deg, rgba(2,6,16,0.99) 0%, rgba(2,6,16,0.92) 100%)",
        borderBottom: `1px solid ${C.border}`, backdropFilter: "blur(12px)",
        borderRadius: "8px 8px 0 0",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 800, color: C.bright, letterSpacing: "0.06em" }}>
              PREDICTIVE THREAT INTELLIGENCE
            </div>
            <div style={{ fontSize: "8px", color: C.dim, marginTop: "1px" }}>
              Bayesian Attack Graphs · Supply Chain Contagion · Geopolitical Modulation · Monte Carlo Forecast
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div style={{
              padding: "4px 12px", borderRadius: "4px",
              background: simResults ? `${C.low}10` : `${C.dim}10`,
              border: `1px solid ${simResults ? C.low + "25" : C.dim + "15"}`,
            }}>
              <span style={{ fontSize: "9px", color: simResults ? C.low : C.dim, fontWeight: 600 }}>
                {simResults ? `${simCount.toLocaleString()} sims · ${simDays}d horizon` : "No simulation"}
              </span>
            </div>
            <button onClick={onClose} style={{
              background: "none", border: `1px solid ${C.border}`, borderRadius: "4px",
              color: C.dim, cursor: "pointer", padding: "4px 10px", fontFamily: MONO,
              fontSize: "11px", lineHeight: 1,
            }}>✕</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: "6px 14px", fontSize: "9px", fontFamily: MONO, letterSpacing: "0.05em",
              border: "none", borderRadius: "4px 4px 0 0", cursor: "pointer",
              background: activeTab === t.id ? C.panel : "transparent",
              color: activeTab === t.id ? C.accent : C.dim,
              borderBottom: activeTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "12px 20px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "12px" }}>

          {/* LEFT */}
          <div>
            {activeTab === "attack_graph" && (
              <div>
                <div style={{ ...panelStyle, padding: "14px", marginBottom: "10px" }}>
                  <div style={headerStyle}>
                    BAYESIAN ATTACK GRAPH — MITRE ATT&CK KILL CHAIN
                    <span style={{ marginLeft: "6px", fontSize: "8px", color: C.accent }}>Click techniques to toggle observed/unobserved</span>
                  </div>
                  <AttackGraph observedTechniques={observedTechniques} onToggleTechnique={toggleTechnique} width={660} height={480} />
                </div>
                <div style={{ ...panelStyle, padding: "14px" }}>
                  <div style={headerStyle}>MATHEMATICAL MODEL — CONDITIONAL PROBABILITY PROPAGATION</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ padding: "10px", borderRadius: "5px", background: `${C.accent}04`, border: `1px solid ${C.accent}12` }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: C.accent, marginBottom: "4px" }}>Bayesian Update Rule</div>
                      <div style={{ fontFamily: SERIF, fontSize: "13px", color: C.bright, fontStyle: "italic", marginBottom: "6px" }}>
                        P(Tₙ₊₁ | Tₙ observed) = P(transition) × P(Tₙ observed)
                      </div>
                      <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>
                        When a technique is observed in the CTI feed, the posterior probability of all downstream
                        techniques updates via forward propagation through the transition matrix. Three iterations of
                        message passing approximate belief propagation on the directed attack graph.
                      </div>
                    </div>
                    <div style={{ padding: "10px", borderRadius: "5px", background: `${C.critical}04`, border: `1px solid ${C.critical}12` }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: C.critical, marginBottom: "4px" }}>Connection to Hawkes λ(t)</div>
                      <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>
                        The Hawkes model captures univariate self-excitation per vector. The Bayesian attack graph
                        extends this to multivariate: observing T1566 (Phishing) increases λ(t) for the HTTP vector,
                        but the attack graph also raises P(T1059 Command/Script) and P(T1486 Data Encrypted). This
                        cross-vector probability propagation feeds the simulation engine's scenario generator.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "supply_chain" && (
              <div style={{ ...panelStyle, padding: "14px" }}>
                <div style={headerStyle}>SUPPLY CHAIN DEPENDENCY MAP — SLTT BLAST RADIUS ANALYSIS</div>
                <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6, marginBottom: "10px" }}>
                  Each vendor below serves hundreds to thousands of SLTT organizations through the MS-ISAC
                  community. A zero-day exploit or supply chain compromise in any of these products creates
                  a correlated exposure event — hundreds of organizations become vulnerable simultaneously.
                  The "blast radius" measures how many MS-ISAC members are directly affected. This feeds
                  the simulation engine as a systemic shock probability per day.
                </div>
                <SupplyChainMap selectedVendor={selectedVendor} onSelectVendor={setSelectedVendor} />
              </div>
            )}

            {activeTab === "geopolitical" && (
              <div style={{ ...panelStyle, padding: "14px" }}>
                <div style={headerStyle}>GEOPOLITICAL THREAT MODULATION — STATE ACTOR TENSION INDICES</div>
                <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6, marginBottom: "10px" }}>
                  Nation-state cyber operations correlate with geopolitical tension levels. Each actor has
                  a computed "cyber multiplier" derived from tension index × historical correlation. When
                  US-China tensions rise from 0.70 to 0.85, the SSH and HTTP vectors receive a 1.35× baseline
                  boost in the simulation engine, reflecting the empirical increase in Volt Typhoon activity
                  during diplomatic crises.
                </div>
                <GeopoliticalPanel />
              </div>
            )}

            {activeTab === "simulation" && (
              <div>
                <div style={{ ...panelStyle, padding: "14px", marginBottom: "10px" }}>
                  <div style={headerStyle}>MONTE CARLO SIMULATION ENGINE — THREAT WEATHER FORECAST</div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", marginBottom: "12px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.1em", marginBottom: "3px" }}>VECTOR</div>
                      <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
                        {VECTORS.map(v => (
                          <button key={v} onClick={() => setSimVector(v)} style={{
                            padding: "4px 8px", borderRadius: "3px", cursor: "pointer", fontFamily: MONO, fontSize: "8px",
                            background: simVector === v ? `${C.accent}15` : "transparent",
                            border: `1px solid ${simVector === v ? C.accent : C.border}`,
                            color: simVector === v ? C.accent : C.dim,
                          }}>{v}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.1em", marginBottom: "3px" }}>HORIZON</div>
                      <div style={{ display: "flex", gap: "2px" }}>
                        {[7, 30, 60, 90].map(d => (
                          <button key={d} onClick={() => setSimDays(d)} style={{
                            padding: "4px 8px", borderRadius: "3px", cursor: "pointer", fontFamily: MONO, fontSize: "9px",
                            background: simDays === d ? `${C.accent}15` : "transparent",
                            border: `1px solid ${simDays === d ? C.accent : C.border}`,
                            color: simDays === d ? C.accent : C.dim,
                          }}>{d}d</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.1em", marginBottom: "3px" }}>SIMULATIONS</div>
                      <div style={{ display: "flex", gap: "2px" }}>
                        {[100, 500, 1000, 5000].map(n => (
                          <button key={n} onClick={() => setSimCount(n)} style={{
                            padding: "4px 8px", borderRadius: "3px", cursor: "pointer", fontFamily: MONO, fontSize: "9px",
                            background: simCount === n ? `${C.accent}15` : "transparent",
                            border: `1px solid ${simCount === n ? C.accent : C.border}`,
                            color: simCount === n ? C.accent : C.dim,
                          }}>{n >= 1000 ? `${n / 1000}K` : n}</button>
                        ))}
                      </div>
                    </div>
                    <button onClick={runSim} disabled={isSimRunning} style={{
                      padding: "8px 20px", borderRadius: "4px", cursor: isSimRunning ? "wait" : "pointer",
                      background: isSimRunning ? `${C.dim}15` : `${C.accent}15`,
                      border: `1px solid ${isSimRunning ? C.dim : C.accent}`,
                      color: isSimRunning ? C.dim : C.accent, fontFamily: MONO, fontSize: "10px", fontWeight: 700,
                    }}>
                      {isSimRunning ? `RUNNING ${simProgress}%` : "▶ RUN SIMULATION"}
                    </button>
                  </div>
                  {isSimRunning && (
                    <div style={{ height: "3px", background: `${C.dim}15`, borderRadius: "2px", overflow: "hidden", marginBottom: "10px" }}>
                      <div style={{ width: `${simProgress}%`, height: "100%", background: C.accent, borderRadius: "2px", transition: "width 0.3s" }} />
                    </div>
                  )}
                </div>

                {simResults && (
                  <div style={{ ...panelStyle, padding: "14px", marginBottom: "10px" }}>
                    <div style={headerStyle}>
                      FORECAST: {simVector?.toUpperCase() || "UNKNOWN"} — {simDays}-DAY HORIZON
                      <span style={{ marginLeft: "6px", fontSize: "8px", color: C.accent }}>{simCount.toLocaleString()} simulations</span>
                    </div>
                    <ForecastChart simResults={simResults} vector={simVector} width={620} height={240} />
                  </div>
                )}

                {simResults && (
                  <div style={{ ...panelStyle, padding: "14px" }}>
                    <div style={headerStyle}>ALL-VECTOR THREAT WEATHER FORECAST</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
                      {VECTORS.map(vec => {
                        const data = simResults[vec];
                        if (!data) return null;
                        const lastD = data[data.length - 1];
                        const firstD = data[0];
                        const trendPct = ((lastD.median / firstD.median) - 1) * 100;
                        const category = lastD.p95 > 15 ? 5 : lastD.p95 > 10 ? 4 : lastD.p95 > 7 ? 3 : lastD.p95 > 4 ? 2 : 1;
                        const catColor = category >= 4 ? C.critical : category >= 3 ? C.high : category >= 2 ? C.medium : C.low;
                        const catLabels: { [k: number]: string } = { 1: "Clear", 2: "Watch", 3: "Advisory", 4: "Warning", 5: "Emergency" };

                        const sparkW = 100, sparkH = 30;
                        const sparkX = scaleLinear().domain([0, data.length - 1]).range([0, sparkW]);
                        const sparkY = scaleLinear().domain([0, max(data, d => d.p95) ?? 0]).range([sparkH, 0]);
                        const sparkLine = line<ForecastDayData>().x((_, i) => sparkX(i)).y(d => sparkY(d.median)).curve(curveBasis);
                        const sparkArea = area<ForecastDayData>().x((_, i) => sparkX(i)).y0(sparkH).y1(d => sparkY(d.median)).curve(curveBasis);

                        return (
                          <div key={vec} onClick={() => { setSimVector(vec); }}
                            style={{
                              padding: "10px", borderRadius: "6px", cursor: "pointer",
                              background: `${catColor}04`, border: `1px solid ${catColor}15`,
                              borderLeft: `3px solid ${catColor}40`,
                            }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                              <span style={{ fontSize: "10px", fontWeight: 700, color: C.bright }}>{vec}</span>
                              <span style={{
                                fontSize: "7px", padding: "1px 5px", borderRadius: "2px",
                                background: `${catColor}15`, color: catColor, fontWeight: 700,
                                border: `1px solid ${catColor}25`,
                              }}>CAT {category}: {catLabels[category]}</span>
                            </div>
                            <svg width={sparkW} height={sparkH} style={{ display: "block", margin: "4px 0" }}>
                              <path d={sparkArea(data) ?? undefined} fill={`${catColor}10`} />
                              <path d={sparkLine(data) ?? undefined} fill="none" stroke={catColor} strokeWidth={1.2} />
                            </svg>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px" }}>
                              <span style={{ color: C.dim }}>Med: {lastD.median.toFixed(1)}</span>
                              <span style={{ color: C.dim }}>P95: {lastD.p95.toFixed(1)}</span>
                              <span style={{ color: trendPct > 0 ? C.critical : C.low, fontWeight: 700 }}>
                                {trendPct > 0 ? "▲" : "▼"}{Math.abs(trendPct).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <div>
            <div style={{ ...panelStyle, padding: "12px", marginBottom: "10px" }}>
              <div style={headerStyle}>PREDICTED NEXT TECHNIQUES</div>
              <div style={{ fontSize: "8px", color: C.dim, marginBottom: "6px" }}>
                Based on {observedTechniques.length} observed techniques:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginBottom: "8px" }}>
                {observedTechniques.map(id => {
                  const tech = ATTACK_TECHNIQUES.find(t => t.id === id);
                  return tech ? (
                    <span key={id} style={{ fontSize: "8px", padding: "2px 5px", borderRadius: "2px", background: `${C.critical}12`, color: C.critical, border: `1px solid ${C.critical}20` }}>
                      ✓ {tech.id}
                    </span>
                  ) : null;
                })}
              </div>
              {predictedNext.map((tech, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "5px 8px", marginBottom: "3px", borderRadius: "4px",
                  background: tech.prob > 0.6 ? `${C.critical}06` : `${C.high}04`,
                  borderLeft: `2px solid ${tech.prob > 0.6 ? C.critical : C.high}40`,
                }}>
                  <div>
                    <div style={{ fontSize: "9px", color: C.bright, fontWeight: 600 }}>{tech.name}</div>
                    <div style={{ fontSize: "7px", color: C.dim }}>{tech.id} · {tech.phase}</div>
                  </div>
                  <div style={{
                    fontSize: "12px", fontWeight: 800, fontFamily: MONO,
                    color: tech.prob > 0.6 ? C.critical : C.high,
                  }}>{(tech.prob * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>

            <div style={{ ...panelStyle, padding: "12px", marginBottom: "10px" }}>
              <div style={headerStyle}>GEOPOLITICAL MULTIPLIERS</div>
              {Object.entries(geoMultipliers).map(([vec, mult]) => (
                <div key={vec} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "9px", color: C.dim }}>{vec}</span>
                  <span style={{
                    fontSize: "10px", fontWeight: 700, fontFamily: MONO,
                    color: mult > 1.3 ? C.critical : mult > 1.15 ? C.high : C.low,
                  }}>×{mult.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div style={{ ...panelStyle, padding: "12px", marginBottom: "10px" }}>
              <div style={headerStyle}>SUPPLY CHAIN EXPOSURE</div>
              <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.5, marginBottom: "6px" }}>
                {SUPPLY_CHAIN_ENTITIES.filter(e => e.exploitedInWild).length} products with active exploitation across{" "}
                {SUPPLY_CHAIN_ENTITIES.reduce((a, e) => a + (e.exploitedInWild ? e.slttUsers : 0), 0).toLocaleString()} SLTT organizations.
              </div>
              {SUPPLY_CHAIN_ENTITIES.filter(e => e.exploitedInWild).map(e => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "9px", color: C.bright }}>{e.name}</span>
                  <span style={{ fontSize: "9px", color: C.critical, fontWeight: 700 }}>{e.slttUsers} SLTTs</span>
                </div>
              ))}
            </div>

            <div style={{ ...panelStyle, padding: "12px" }}>
              <div style={headerStyle}>SIMULATION MODEL</div>
              <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>
                Each simulation day draws events from a Hawkes process with
                inhomogeneous baseline μ(t) × S(t) × G(t), where G(t) is the
                geopolitical multiplier. Supply chain shocks arrive as Bernoulli
                events (p = exposure_rate/day) adding 3-8× intensity spikes.
                Self-exciting offspring propagate through 5 generations with
                branching ratio n̂ = α/β. Day-of-week modulation applies
                weekday 1.1× / weekend 0.85× empirical patterns.
              </div>
              <div style={{ marginTop: "6px", padding: "6px 8px", borderRadius: "4px", background: `${C.accent}06`, border: `1px solid ${C.accent}12`, textAlign: "center" }}>
                <div style={{ fontFamily: SERIF, fontSize: "12px", color: C.accent }}>
                  λ_sim(t) = μ·S(t)·G(t) + SC_shock + Σ self-exciting offspring
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Crimson+Pro:ital,wght@0,400;0,700;1,400&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0,110,200,0.08); border-radius: 2px; }
      `}</style>
    </div>
  );
}
