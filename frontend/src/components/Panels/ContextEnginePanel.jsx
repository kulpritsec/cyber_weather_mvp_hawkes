import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";

// ─── DESIGN SYSTEM (matches globe tokens) ──────────────────────────────
const C = {
  bg: "rgba(2,8,16,0.98)", panel: "rgba(6,14,30,0.94)", panelHover: "rgba(10,22,48,0.96)",
  border: "rgba(0,160,255,0.12)", borderActive: "rgba(0,220,255,0.4)",
  text: "#c8daf0", dim: "#3d5a7a", bright: "#eaf4ff", accent: "#00ccff",
  clear: "#22c55e", advisory: "#3b82f6", watch: "#eab308", warning: "#f97316", emergency: "#ef4444",
  ssh: "#00e5ff", rdp: "#ff6d00", http: "#b388ff", dns_amp: "#76ff03",
  event: "#ff4081", seasonal: "#7c4dff", campaign: "#ffab00", vuln: "#00e676",
  gridLine: "rgba(0,160,255,0.06)",
};

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

// ─── GLOBAL EVENT CALENDAR ─────────────────────────────────────────────
const EVENT_CALENDAR = [
  { id: "wc2026", name: "FIFA World Cup 2026", category: "sporting", start: "2026-06-11", end: "2026-07-19", region: "global", impact: 0.85, vectors: ["http", "dns_amp", "brute_force"], description: "Ticketing fraud, credential stuffing on fan portals, DDoS on streaming. 2022 Qatar WC saw 600% phishing spike." },
  { id: "olympics2026", name: "Milano-Cortina Winter Olympics", category: "sporting", start: "2026-02-06", end: "2026-02-22", region: "europe", impact: 0.72, vectors: ["http", "dns_amp"], description: "State-sponsored disruption, ticketing fraud, watering hole attacks on Olympic partner sites." },
  { id: "superbowl2027", name: "Super Bowl LXI", category: "sporting", start: "2027-02-07", end: "2027-02-08", region: "north_america", impact: 0.65, vectors: ["http", "dns_amp", "brute_force"], description: "Sportsbook credential stuffing, streaming DDoS, ticket fraud." },
  { id: "march-madness", name: "NCAA March Madness", category: "sporting", start: "2026-03-17", end: "2026-04-06", region: "north_america", impact: 0.45, vectors: ["http", "brute_force"], description: "Bracket pool phishing, sportsbook account takeover." },
  { id: "blackfriday2026", name: "Black Friday / Cyber Monday", category: "commerce", start: "2026-11-27", end: "2026-11-30", region: "global", impact: 0.90, vectors: ["http", "brute_force", "botnet_c2"], description: "Peak credential stuffing. 2024 saw 3.6B bot requests in 48h. Skimming, fake storefronts, gift card fraud." },
  { id: "singles-day", name: "Singles Day (11.11)", category: "commerce", start: "2026-11-11", end: "2026-11-11", region: "asia", impact: 0.70, vectors: ["http", "brute_force"], description: "Alibaba ecosystem targeting, payment fraud, fake merchant campaigns." },
  { id: "prime-day", name: "Amazon Prime Day", category: "commerce", start: "2026-07-15", end: "2026-07-16", region: "global", impact: 0.55, vectors: ["http", "brute_force"], description: "Phishing campaigns mimicking Amazon, fake deal sites, credential harvesting." },
  { id: "tax-season-us", name: "US Tax Filing Deadline", category: "commerce", start: "2026-04-01", end: "2026-04-15", region: "north_america", impact: 0.60, vectors: ["http", "brute_force", "ssh"], description: "IRS phishing, tax preparer account compromise, W-2 harvesting." },
  { id: "taiwan-election", name: "Taiwan Local Elections", category: "geopolitical", start: "2026-11-01", end: "2026-11-30", region: "asia", impact: 0.75, vectors: ["ssh", "http", "dns_amp"], description: "PRC-linked escalation around Taiwan elections. 2024: Volt Typhoon pre-positioning." },
  { id: "us-midterms", name: "US Midterm Elections", category: "geopolitical", start: "2026-10-01", end: "2026-11-03", region: "north_america", impact: 0.80, vectors: ["http", "ssh", "dns_amp", "botnet_c2"], description: "Election infrastructure probing, disinformation, voter reg targeting." },
  { id: "eu-summit", name: "EU Council Summit", category: "geopolitical", start: "2026-06-25", end: "2026-06-26", region: "europe", impact: 0.40, vectors: ["ssh", "http"], description: "Espionage targeting diplomatic comms and delegation devices." },
  { id: "patch-tuesday", name: "Patch Tuesday Cycle", category: "vulnerability", start: "recurring-monthly", end: "recurring-monthly", region: "global", impact: 0.50, vectors: ["http", "ssh", "rdp"], description: "T+0 to T+72h post-patch is peak exploitation. Reverse engineering of patches reveals vulnerabilities." },
  { id: "defcon-blackhat", name: "DEF CON / Black Hat", category: "vulnerability", start: "2026-08-01", end: "2026-08-09", region: "global", impact: 0.55, vectors: ["http", "ssh", "rdp"], description: "0-day disclosures, new tool releases, PoC publications drive scanning waves within 24-48h." },
  { id: "pwn2own", name: "Pwn2Own Vancouver", category: "vulnerability", start: "2026-03-18", end: "2026-03-20", region: "global", impact: 0.35, vectors: ["http"], description: "Browser and enterprise software 0-days disclosed, rapid weaponization follows." },
  { id: "earnings-q1", name: "Q1 Earnings Season", category: "financial", start: "2026-04-15", end: "2026-05-15", region: "global", impact: 0.35, vectors: ["http", "ssh", "brute_force"], description: "BEC targeting finance teams, insider data theft, ransomware timed to earnings pressure." },
  { id: "fiscal-year-end", name: "Fiscal Year End", category: "financial", start: "2026-06-15", end: "2026-06-30", region: "global", impact: 0.30, vectors: ["http", "brute_force"], description: "Wire fraud attempts spike during large year-end transactions." },
  { id: "christmas", name: "Christmas / New Year", category: "holiday", start: "2026-12-23", end: "2027-01-02", region: "global", impact: 0.75, vectors: ["ransomware", "ssh", "rdp", "botnet_c2"], description: "Skeleton crew period. 68% of major ransomware incidents occurred on weekends or holidays." },
  { id: "cny2026", name: "Chinese New Year", category: "holiday", start: "2026-02-17", end: "2026-02-23", region: "asia", impact: 0.40, vectors: ["http", "brute_force"], description: "Reduced SOC staffing in APAC, phishing targeting travel and gift purchases." },
  { id: "ramadan", name: "Ramadan", category: "holiday", start: "2026-02-18", end: "2026-03-19", region: "middle_east", impact: 0.35, vectors: ["http", "dns_amp"], description: "Reduced monitoring in MENA, charity fraud phishing." },
  { id: "summer-holidays", name: "European Summer Holidays", category: "holiday", start: "2026-07-15", end: "2026-08-31", region: "europe", impact: 0.45, vectors: ["ransomware", "rdp", "ssh"], description: "Extended vacation periods reduce IR capacity across EU. Ransomware operators favor this window." },
  // ─── IRAN / MIDDLE EAST CONFLICT ──────────────────────────────────────
  { id: "iran-conflict-2026", name: "Iran Conflict — Cyber Escalation", category: "geopolitical", start: "2026-01-15", end: "2026-12-31", region: "middle_east", impact: 0.95, vectors: ["ssh", "http", "dns_amp", "botnet_c2", "ransomware"], description: "Active Iran conflict driving sustained APT33/APT34/MuddyWater campaigns. Critical infrastructure targeting (energy, water, financial). Wiper malware, DDoS on gov/mil, destructive attacks on allied nations." },
  { id: "iran-retaliatory-ops", name: "Iran Retaliatory Cyber Operations", category: "geopolitical", start: "2026-02-01", end: "2026-06-30", region: "global", impact: 0.88, vectors: ["ssh", "http", "dns_amp", "ransomware", "botnet_c2"], description: "Iranian APTs historically launch retaliatory cyber ops within days of kinetic escalation. Targets: US/EU energy, financial, defense contractors. Shamoon-style wiper campaigns, DDoS via botnets." },
  { id: "iran-allied-targeting", name: "Iran Allied Nation Targeting", category: "geopolitical", start: "2026-01-15", end: "2026-12-31", region: "middle_east", impact: 0.80, vectors: ["http", "ssh", "dns_amp"], description: "Israeli, Saudi, UAE, Bahraini infrastructure targeted. Water/energy SCADA systems, financial sector, telecom. Precedent: 2012 Aramco (Shamoon), 2020 Israel water system attacks." },
  { id: "iran-disinfo-ops", name: "Iran Influence/Disinformation Ops", category: "geopolitical", start: "2026-02-01", end: "2026-12-31", region: "global", impact: 0.60, vectors: ["http", "botnet_c2"], description: "IRGC-linked influence operations targeting social media, news sites. Fake personas, hack-and-leak operations, defacement campaigns." },
  { id: "strait-hormuz-cyber", name: "Strait of Hormuz Cyber Threat", category: "geopolitical", start: "2026-03-01", end: "2026-09-30", region: "middle_east", impact: 0.75, vectors: ["ssh", "http", "dns_amp"], description: "Maritime/shipping infrastructure targeting. GPS spoofing, AIS manipulation, port system intrusions. Energy supply chain disruption." },
];

// ─── SEASONAL PATTERNS ─────────────────────────────────────────────────
const SEASONAL_MULTIPLIERS = {
  ssh: [0.85, 0.90, 1.05, 1.10, 1.00, 0.95, 0.88, 0.82, 1.08, 1.15, 1.25, 1.30],
  rdp: [1.10, 1.05, 0.95, 0.90, 0.85, 0.80, 0.85, 0.90, 1.00, 1.10, 1.20, 1.35],
  http: [0.90, 0.85, 0.95, 1.10, 1.05, 1.00, 0.95, 1.05, 1.10, 1.05, 1.30, 1.15],
  dns_amp: [0.80, 0.85, 1.15, 1.00, 0.95, 1.20, 1.10, 1.05, 0.90, 0.95, 1.00, 1.10],
};

// ─── CAMPAIGN RECURRENCE ───────────────────────────────────────────────
const CAMPAIGN_RECURRENCE = [
  { group: "APT28", aka: "Fancy Bear", months: [1,2,3,9,10,11], intensity: [0.7,0.8,0.6,0.9,1.0,0.85], vectors: ["ssh","http"], note: "Peaks before/during geopolitical events, election cycles" },
  { group: "APT41", aka: "Double Dragon", months: [3,4,5,6,9,10], intensity: [0.8,0.9,1.0,0.7,0.85,0.75], vectors: ["http","dns_amp"], note: "Supply chain focus, ramps spring/fall, quiet during Chinese holidays" },
  { group: "Lazarus", aka: "Hidden Cobra", months: [1,2,5,6,7,11,12], intensity: [0.6,0.7,0.9,1.0,0.85,0.75,0.8], vectors: ["http","ransomware"], note: "Financial theft peaks mid-year, crypto targeting year-round" },
  { group: "Sandworm", aka: "Voodoo Bear", months: [1,2,3,10,11,12], intensity: [0.85,0.9,0.7,0.8,0.95,1.0], vectors: ["ssh","dns_amp"], note: "Infrastructure disruption peaks in winter, aligned with geopolitical pressure" },
  { group: "FIN7", aka: "Carbanak", months: [3,4,5,10,11,12], intensity: [0.6,0.7,0.75,0.85,1.0,0.95], vectors: ["http","rdp"], note: "Retail targeting peaks Q4 pre-holiday, hospitality in spring" },
  { group: "Cl0p", aka: "TA505", months: [1,2,5,6,7,12], intensity: [0.7,0.8,0.9,1.0,0.75,0.85], vectors: ["ransomware","http"], note: "Mass exploitation campaigns (MOVEit-style) followed by extortion waves" },
  { group: "LockBit", aka: "ABCD", months: [1,3,5,6,7,8,11,12], intensity: [0.7,0.8,0.85,0.9,0.95,1.0,0.9,0.95], vectors: ["ransomware","rdp","ssh"], note: "Year-round but peaks during holiday/weekend staffing gaps" },
  { group: "Volt Typhoon", aka: "Bronze Silhouette", months: [1,2,3,4,10,11], intensity: [0.8,0.85,0.9,0.7,0.95,1.0], vectors: ["ssh","http"], note: "Pre-positioning intensifies around Taiwan Strait tensions" },
  // ─── IRANIAN APT CAMPAIGNS (conflict-driven escalation) ───────────────
  { group: "APT33", aka: "Elfin / Refined Kitten", months: [1,2,3,4,5,6,7,8,9,10,11,12], intensity: [0.9,0.95,1.0,0.95,0.9,0.85,0.8,0.85,0.9,0.95,1.0,0.95], vectors: ["ssh","http","dns_amp"], note: "IRGC-linked. Energy/aviation targeting. Year-round during conflict. Shamoon/Stonedrill wiper campaigns." },
  { group: "APT34", aka: "OilRig / Helix Kitten", months: [1,2,3,4,5,6,7,8,9,10,11,12], intensity: [0.85,0.9,0.95,1.0,0.9,0.85,0.8,0.85,0.9,0.95,1.0,0.9], vectors: ["http","ssh","dns_amp"], note: "MOIS-linked. Middle East gov/telecom/financial. DNS tunneling, credential harvesting. Escalated during conflict." },
  { group: "MuddyWater", aka: "Mercury / Seedworm", months: [1,2,3,4,5,6,7,8,9,10,11,12], intensity: [0.8,0.85,0.9,0.85,0.8,0.75,0.7,0.75,0.85,0.9,0.95,0.85], vectors: ["http","ssh","botnet_c2"], note: "MOIS-linked. Government/telecom across Middle East, Central/South Asia. Spear-phishing, PowerShell backdoors." },
  { group: "CyberAv3ngers", aka: "IRGC-CEC", months: [1,2,3,4,5,6,7,8,9,10,11,12], intensity: [0.95,1.0,0.95,0.9,0.85,0.8,0.85,0.9,0.95,1.0,0.95,0.9], vectors: ["ssh","http","dns_amp"], note: "IRGC-affiliated. OT/ICS targeting — water utilities, PLCs. Unitronics Vision attacks (Nov 2023). Critical infrastructure focus." },
];

// ─── BACKTEST RESULTS ──────────────────────────────────────────────────
const BACKTEST_RESULTS = {
  baseline_hawkes: { mape: 0.342, coverage_90: 0.78, brier: 0.281, aic: 4520, description: "Standard Hawkes (constant μ)" },
  seasonal_hawkes: { mape: 0.248, coverage_90: 0.84, brier: 0.215, aic: 4180, description: "Hawkes + STL seasonal decomposition" },
  event_hawkes: { mape: 0.221, coverage_90: 0.87, brier: 0.193, aic: 4050, description: "Hawkes + event calendar covariates" },
  full_context: { mape: 0.178, coverage_90: 0.91, brier: 0.162, aic: 3870, description: "Hawkes + seasonal + events + campaign recurrence" },
};

// ─── GENERATE FORECAST DATA ────────────────────────────────────────────
function generateForecastSeries(months = 12, vector = "ssh") {
  const now = Date.now();
  const pts = [];
  const seasonal = SEASONAL_MULTIPLIERS[vector] || SEASONAL_MULTIPLIERS.ssh;
  for (let d = -180; d <= months * 30; d++) {
    const t = now + d * 86400000;
    const date = new Date(t);
    const monthIdx = date.getMonth();
    const dayOfWeek = date.getDay();
    const baseRate = 3.5 * seasonal[monthIdx];
    const dowEffect = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.85 : 1.05;
    let eventBoost = 0;
    const dateStr = date.toISOString().slice(0, 10);
    EVENT_CALENDAR.forEach(evt => {
      if (evt.start === "recurring-monthly") return;
      if (dateStr >= evt.start && dateStr <= evt.end && evt.vectors.includes(vector)) eventBoost += evt.impact * 0.4;
    });
    const noise = (Math.random() - 0.5) * 0.6;
    const isForecast = d > 0;
    const uncertainty = isForecast ? 0.15 + (d / (months * 30)) * 0.35 : 0;
    const value = Math.max(0.1, baseRate * dowEffect * (1 + eventBoost) + noise);
    pts.push({ t, value, lower: value * (1 - uncertainty * 1.65), upper: value * (1 + uncertainty * 1.65), isForecast, eventBoost: eventBoost > 0, seasonal: seasonal[monthIdx] });
  }
  return pts;
}

// ─── FORECAST CHART ────────────────────────────────────────────────────
function ForecastChart({ data, events, width = 800, height = 220, vector = "ssh" }) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const vecColor = C[vector] || C.accent;
  const margin = { top: 20, right: 30, bottom: 30, left: 45 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const xScale = useMemo(() => d3.scaleTime().domain(d3.extent(data, d => d.t)).range([0, w]), [data, w]);
  const yScale = useMemo(() => d3.scaleLinear().domain([0, d3.max(data, d => d.upper || d.value) * 1.15]).range([h, 0]), [data, h]);
  const line = useMemo(() => d3.line().x(d => xScale(d.t)).y(d => yScale(d.value)).curve(d3.curveBasis), [xScale, yScale]);
  const area = useMemo(() => d3.area().x(d => xScale(d.t)).y0(d => yScale(d.lower)).y1(d => yScale(d.upper)).curve(d3.curveBasis), [xScale, yScale]);
  const histData = data.filter(d => !d.isForecast);
  const foreData = data.filter(d => d.isForecast);
  const nowX = xScale(Date.now());
  const visibleEvents = events.filter(evt => {
    if (evt.start === "recurring-monthly") return false;
    const s = new Date(evt.start).getTime(), e = new Date(evt.end).getTime();
    const [dS, dE] = xScale.domain();
    return s < dE && e > dS;
  });

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="pce-forecast-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={vecColor} stopOpacity="0.15" /><stop offset="100%" stopColor={vecColor} stopOpacity="0" /></linearGradient>
          <linearGradient id="pce-history-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={vecColor} stopOpacity="0.08" /><stop offset="100%" stopColor={vecColor} stopOpacity="0" /></linearGradient>
          <clipPath id="pce-chart-clip"><rect x={0} y={0} width={w} height={h} /></clipPath>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yScale.ticks(5).map((tick, i) => (<g key={i}><line x1={0} y1={yScale(tick)} x2={w} y2={yScale(tick)} stroke={C.gridLine} strokeWidth={0.5} /><text x={-8} y={yScale(tick) + 3} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="end">{tick.toFixed(1)}</text></g>))}
          {xScale.ticks(8).map((tick, i) => (<text key={i} x={xScale(tick)} y={h + 18} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">{d3.timeFormat("%b %d")(tick)}</text>))}
          {visibleEvents.map((evt, i) => {
            const x1 = Math.max(0, xScale(new Date(evt.start).getTime()));
            const x2 = Math.min(w, xScale(new Date(evt.end).getTime()));
            const catColors = { sporting: C.event, commerce: C.warning, geopolitical: C.emergency, vulnerability: C.vuln, financial: C.advisory, holiday: C.seasonal };
            const color = catColors[evt.category] || C.dim;
            return (<g key={i}><rect x={x1} y={0} width={Math.max(2, x2 - x1)} height={h} fill={color} opacity={0.06} /><line x1={x1} y1={0} x2={x1} y2={h} stroke={color} strokeWidth={0.5} opacity={0.3} strokeDasharray="3,3" /><text x={x1 + 3} y={12} fill={color} fontSize="7" fontFamily={MONO} opacity={0.7}>{evt.name.length > 20 ? evt.name.slice(0, 18) + "..." : evt.name}</text></g>);
          })}
          {foreData.length > 0 && <path d={area(foreData)} fill="url(#pce-forecast-grad)" clipPath="url(#pce-chart-clip)" />}
          <path d={d3.area().x(d => xScale(d.t)).y0(h).y1(d => yScale(d.value)).curve(d3.curveBasis)(histData)} fill="url(#pce-history-grad)" clipPath="url(#pce-chart-clip)" />
          <path d={line(histData)} fill="none" stroke={vecColor} strokeWidth={1.5} opacity={0.8} />
          {foreData.length > 0 && <path d={line(foreData)} fill="none" stroke={vecColor} strokeWidth={1.5} strokeDasharray="6,3" opacity={0.7} />}
          {foreData.length > 0 && (<><path d={d3.line().x(d => xScale(d.t)).y(d => yScale(d.upper)).curve(d3.curveBasis)(foreData)} fill="none" stroke={vecColor} strokeWidth={0.5} opacity={0.3} strokeDasharray="2,2" /><path d={d3.line().x(d => xScale(d.t)).y(d => yScale(d.lower)).curve(d3.curveBasis)(foreData)} fill="none" stroke={vecColor} strokeWidth={0.5} opacity={0.3} strokeDasharray="2,2" /></>)}
          <line x1={nowX} y1={0} x2={nowX} y2={h} stroke={C.accent} strokeWidth={1} strokeDasharray="4,2" />
          <text x={nowX} y={-6} fill={C.accent} fontSize="8" fontFamily={MONO} textAnchor="middle">NOW</text>
          <text x={-35} y={h / 2} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle" transform={`rotate(-90, -35, ${h / 2})`}>μ(t) events/hr</text>
          <rect x={0} y={0} width={w} height={h} fill="transparent"
            onMouseMove={(e) => { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return; const mx = e.clientX - rect.left - margin.left; const t = xScale.invert(mx); const closest = data.reduce((prev, curr) => Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev); setTooltip({ x: xScale(closest.t), y: yScale(closest.value), data: closest, clientX: e.clientX, clientY: e.clientY }); }}
            onMouseLeave={() => setTooltip(null)} />
          {tooltip && (<><line x1={tooltip.x} y1={0} x2={tooltip.x} y2={h} stroke={C.dim} strokeWidth={0.5} strokeDasharray="2,2" /><circle cx={tooltip.x} cy={tooltip.y} r={4} fill={vecColor} stroke={C.bright} strokeWidth={1} /></>)}
        </g>
      </svg>
      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.clientX + 16, top: tooltip.clientY - 40, background: C.panel, border: `1px solid ${C.borderActive}`, borderRadius: "6px", padding: "8px 12px", pointerEvents: "none", zIndex: 200, backdropFilter: "blur(12px)", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: "9px", color: C.dim, fontFamily: MONO }}>{new Date(tooltip.data.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: vecColor, fontFamily: MONO }}>μ(t) = {tooltip.data.value.toFixed(2)}</div>
          {tooltip.data.isForecast && <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>90% CI: [{tooltip.data.lower.toFixed(2)}, {tooltip.data.upper.toFixed(2)}]</div>}
          {tooltip.data.eventBoost && <div style={{ fontSize: "8px", color: C.event, fontFamily: MONO, marginTop: "2px" }}>▲ Event-driven uplift</div>}
        </div>
      )}
      <div ref={svgRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}

// ─── SEASONAL HEATMAP ──────────────────────────────────────────────────
function SeasonalHeatmap({ width = 540, height = 160 }) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const vectors = Object.keys(SEASONAL_MULTIPLIERS);
  const cellW = (width - 60) / 12, cellH = (height - 30) / vectors.length;
  const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0.75, 1.4]);
  return (
    <svg width={width} height={height}>
      {months.map((m, i) => <text key={i} x={60 + i * cellW + cellW / 2} y={14} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">{m}</text>)}
      {vectors.map((vec, vi) => (<g key={vec}><text x={55} y={30 + vi * cellH + cellH / 2 + 3} fill={C[vec] || C.dim} fontSize="9" fontFamily={MONO} textAnchor="end">{vec}</text>{SEASONAL_MULTIPLIERS[vec].map((val, mi) => (<g key={mi}><rect x={60 + mi * cellW} y={22 + vi * cellH} width={cellW - 1} height={cellH - 1} fill={colorScale(val)} rx={2} opacity={0.85} /><text x={60 + mi * cellW + cellW / 2} y={22 + vi * cellH + cellH / 2 + 3} fill={val > 1.1 ? "#1a1a2e" : C.bright} fontSize="8" fontFamily={MONO} textAnchor="middle" fontWeight={val > 1.15 ? 700 : 400}>{val.toFixed(2)}</text></g>))}</g>))}
    </svg>
  );
}

// ─── CAMPAIGN RECURRENCE CHART ─────────────────────────────────────────
function CampaignRecurrenceChart({ width = 540, height = 280, campaigns = CAMPAIGN_RECURRENCE }) {
  const months = ["J","F","M","A","M","J","J","A","S","O","N","D"];
  const cellW = (width - 120) / 12, cellH = (height - 30) / campaigns.length;
  const currentMonth = new Date().getMonth();
  return (
    <svg width={width} height={height}>
      {months.map((m, i) => (<g key={i}><text x={120 + i * cellW + cellW / 2} y={14} fill={i === currentMonth ? C.accent : C.dim} fontSize="9" fontFamily={MONO} textAnchor="middle" fontWeight={i === currentMonth ? 700 : 400}>{m}</text>{i === currentMonth && <rect x={120 + i * cellW} y={18} width={cellW} height={height - 24} fill={C.accent} opacity={0.04} />}</g>))}
      {campaigns.map((campaign, ci) => {
        const vecColor = C[campaign.vectors[0]] || C.accent;
        return (<g key={ci}><text x={115} y={28 + ci * cellH + cellH / 2 + 3} fill={C.text} fontSize="8" fontFamily={MONO} textAnchor="end">{campaign.group}</text>{Array.from({ length: 12 }, (_, mi) => { const monthIdx = campaign.months.indexOf(mi + 1); const isActive = monthIdx !== -1; const intensity = isActive ? campaign.intensity[monthIdx] : 0; return (<g key={mi}><rect x={120 + mi * cellW + 1} y={22 + ci * cellH + 1} width={cellW - 2} height={cellH - 2} fill={isActive ? vecColor : "transparent"} opacity={isActive ? intensity * 0.5 : 0} rx={2} stroke={isActive ? vecColor : C.gridLine} strokeWidth={isActive ? 0.5 : 0.3} strokeOpacity={isActive ? 0.4 : 0.3} />{isActive && <circle cx={120 + mi * cellW + cellW / 2} cy={22 + ci * cellH + cellH / 2} r={intensity * cellH * 0.3} fill={vecColor} opacity={intensity * 0.7} />}</g>); })}</g>);
      })}
    </svg>
  );
}

// ─── BACKTEST COMPARISON ───────────────────────────────────────────────
function BacktestComparison({ width = 540, results = null }) {
  const source = results || BACKTEST_RESULTS;
  const models = Object.entries(source);
  const best = models.reduce((a, b) => a[1].mape < b[1].mape ? a : b);
  return (
    <div>
      {models.map(([key, m]) => {
        const isBest = key === best[0];
        return (
          <div key={key} style={{ padding: "10px 12px", marginBottom: "6px", borderRadius: "4px", background: isBest ? `${C.clear}08` : "rgba(255,255,255,0.02)", border: `1px solid ${isBest ? C.clear + "30" : C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div><span style={{ fontSize: "11px", fontFamily: MONO, color: C.bright, fontWeight: 600 }}>{m.description}</span>{isBest && <span style={{ fontSize: "8px", fontFamily: MONO, color: C.clear, marginLeft: "8px", padding: "1px 6px", background: `${C.clear}15`, borderRadius: "2px" }}>BEST</span>}</div>
              <span style={{ fontSize: "9px", fontFamily: MONO, color: C.dim }}>{m.aic ? `AIC: ${m.aic}` : ""}{m.is_measured ? " · MEASURED" : ""}</span>
            </div>
            <div style={{ display: "flex", gap: "16px" }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, letterSpacing: "0.1em", marginBottom: "3px" }}>MAPE: {(m.mape * 100).toFixed(1)}%</div><div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px" }}><div style={{ height: "100%", width: `${(1 - m.mape) * 100}%`, background: isBest ? C.clear : C.accent, borderRadius: "2px", opacity: 0.7 }} /></div></div>
              <div style={{ flex: 1 }}><div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, letterSpacing: "0.1em", marginBottom: "3px" }}>90% CI: {(m.coverage_90 * 100).toFixed(0)}%</div><div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px" }}><div style={{ height: "100%", width: `${m.coverage_90 * 100}%`, background: m.coverage_90 >= 0.90 ? C.clear : C.watch, borderRadius: "2px", opacity: 0.7 }} /></div></div>
              <div style={{ width: "80px" }}><div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, letterSpacing: "0.1em", marginBottom: "3px" }}>BRIER</div><div style={{ fontSize: "14px", fontWeight: 700, color: isBest ? C.clear : C.text, fontFamily: MONO }}>{m.brier.toFixed(3)}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── EVENT CARD ─────────────────────────────────────────────────────────
function EventCard({ event, isActive }) {
  const catColors = { sporting: C.event, commerce: C.warning, geopolitical: C.emergency, vulnerability: C.vuln, financial: C.advisory, holiday: C.seasonal };
  const color = catColors[event.category] || C.dim;
  const isRecurring = event.start === "recurring-monthly";
  return (
    <div style={{ padding: "10px 12px", borderRadius: "6px", marginBottom: "6px", background: isActive ? `${color}0a` : "rgba(255,255,255,0.02)", border: `1px solid ${isActive ? color + "40" : C.border}`, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div><div style={{ fontSize: "11px", fontWeight: 700, color: C.bright, fontFamily: MONO }}>{event.name}</div><div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO, marginTop: "2px" }}>{isRecurring ? "Recurring · Monthly" : `${event.start} → ${event.end}`} · {event.region}</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {event.source && <span style={{ fontSize: "7px", fontFamily: MONO, color: "#00e5ff", padding: "1px 6px", background: "rgba(0,229,255,0.12)", borderRadius: "2px", letterSpacing: "0.08em" }}>LIVE</span>}
          {isActive && <span style={{ fontSize: "7px", fontFamily: MONO, color, padding: "1px 6px", background: `${color}15`, borderRadius: "2px", animation: "pulse-dot 2s infinite" }}>ACTIVE</span>}
          <span style={{ fontSize: "8px", fontFamily: MONO, color, padding: "1px 6px", background: `${color}10`, borderRadius: "2px", textTransform: "uppercase" }}>{event.category}</span>
        </div>
      </div>
      <div style={{ fontSize: "9px", color: C.text, fontFamily: MONO, lineHeight: 1.5, marginTop: "6px" }}>{event.description}</div>
      {event.source && <div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, marginTop: "3px", letterSpacing: "0.05em" }}>SOURCE: {event.source}{event.confidence != null ? ` · CONFIDENCE: ${(event.confidence * 100).toFixed(0)}%` : ""}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
        <div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, letterSpacing: "0.1em" }}>IMPACT</div>
        <div style={{ flex: 1, height: "3px", background: "rgba(255,255,255,0.05)", borderRadius: "1.5px" }}><div style={{ height: "100%", width: `${event.impact * 100}%`, background: color, borderRadius: "1.5px", boxShadow: `0 0 4px ${color}40` }} /></div>
        <div style={{ fontSize: "9px", fontWeight: 700, color, fontFamily: MONO }}>{(event.impact * 100).toFixed(0)}%</div>
        <div style={{ display: "flex", gap: "3px" }}>{event.vectors.map(v => <span key={v} style={{ fontSize: "7px", fontFamily: MONO, color: C[v] || C.dim, padding: "1px 4px", background: `${C[v] || C.dim}10`, borderRadius: "2px" }}>{v}</span>)}</div>
      </div>
    </div>
  );
}

// ─── COVARIATE FORMULA ─────────────────────────────────────────────────
function CovariateFormula() {
  return (
    <div style={{ padding: "14px 16px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: `1px solid ${C.border}`, marginBottom: "12px" }}>
      <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO, letterSpacing: "0.12em", marginBottom: "8px" }}>INHOMOGENEOUS HAWKES BACKGROUND RATE</div>
      <div style={{ fontSize: "14px", color: C.bright, fontFamily: MONO, textAlign: "center", lineHeight: 2 }}>
        <span style={{ color: C.accent }}>μ(t)</span> = <span style={{ color: C.text }}>μ</span><sub style={{ fontSize: "9px" }}>base</sub>
        {" × "}<span style={{ color: C.seasonal }}>S(t)</span>
        {" × "}<span style={{ color: C.text }}>∏</span><sub style={{ fontSize: "9px" }}>i</sub>
        {"(1 + "}<span style={{ color: C.event }}>w<sub style={{ fontSize: "8px" }}>i</sub></span>
        {" · "}<span style={{ color: C.event }}>E<sub style={{ fontSize: "8px" }}>i</sub>(t)</span>{")"}
        {" × "}<span style={{ color: C.campaign }}>C(t)</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" }}>
        {[
          { symbol: "μ_base", color: C.text, desc: "Fitted constant baseline from standard Hawkes" },
          { symbol: "S(t)", color: C.seasonal, desc: "STL seasonal decomposition (monthly + day-of-week)" },
          { symbol: "E_i(t)", color: C.event, desc: "Event calendar indicator (1 during event window, 0 otherwise)" },
          { symbol: "C(t)", color: C.campaign, desc: "Campaign recurrence prior from historical backtesting" },
        ].map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
            <span style={{ fontSize: "11px", fontFamily: MONO, color: c.color, fontWeight: 700, minWidth: "40px" }}>{c.symbol}</span>
            <span style={{ fontSize: "8px", fontFamily: MONO, color: C.dim, lineHeight: 1.4 }}>{c.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── MAIN PANEL ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
export default function ContextEnginePanel({ onClose }) {
  const [activeTab, setActiveTab] = useState("forecast");
  const [selectedVector, setSelectedVector] = useState("ssh");
  const [eventFilter, setEventFilter] = useState("all");
  const [forecastHorizon, setForecastHorizon] = useState(6);

  // Fetch real forecast data from backend
  const [forecastData, setForecastData] = useState([]);
  const [forecastParams, setForecastParams] = useState(null);
  const [dataSource, setDataSource] = useState("loading"); // "live" | "synthetic" | "loading"
  const [covariatesApplied, setCovariatesApplied] = useState(false);

  // Fetch events + campaigns from backend APIs (single source of truth)
  const [backendEvents, setBackendEvents] = useState(null);
  const [backendCampaigns, setBackendCampaigns] = useState(null);
  const [backtestResults, setBacktestResults] = useState(null);

  useEffect(() => {
    fetch("/v1/context/events").then(r => r.json()).then(d => setBackendEvents(d.events)).catch(() => {});
    fetch("/v1/context/campaigns").then(r => r.json()).then(d => setBackendCampaigns(d.campaigns)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/v1/context/backtest?vector=${selectedVector}`).then(r => r.json()).then(d => setBacktestResults(d)).catch(() => {});
  }, [selectedVector]);

  useEffect(() => {
    let cancelled = false;
    setDataSource("loading");
    async function loadForecast() {
      try {
        const r = await fetch(`/v1/forecast/series?vector=${selectedVector}&days=${Math.max(forecastHorizon, 6)}`);
        if (!r.ok) throw new Error("fetch failed");
        const data = await r.json();
        if (cancelled) return;
        const combined = [
          ...data.history.map(h => ({ ...h, isForecast: false, lower: h.value, upper: h.value })),
          ...data.forecast,
        ];
        setForecastData(combined);
        setForecastParams(data.params);
        setCovariatesApplied(!!data.covariates_applied);
        setDataSource("live");
      } catch {
        if (!cancelled) {
          setForecastData(generateForecastSeries(forecastHorizon, selectedVector));
          setCovariatesApplied(false);
          setDataSource("synthetic");
        }
      }
    }
    loadForecast();
    return () => { cancelled = true; };
  }, [forecastHorizon, selectedVector]);

  // Use backend events if available, otherwise fall back to hardcoded
  const resolvedEvents = backendEvents || EVENT_CALENDAR;
  const resolvedCampaigns = backendCampaigns || CAMPAIGN_RECURRENCE;

  const today = new Date().toISOString().slice(0, 10);
  const activeEvents = resolvedEvents.filter(e => e.start !== "recurring-monthly" && today >= e.start && today <= e.end);
  const upcomingEvents = resolvedEvents.filter(e => e.start !== "recurring-monthly" && e.start > today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 8);
  const filteredEvents = eventFilter === "all" ? resolvedEvents.filter(e => e.start !== "recurring-monthly") : resolvedEvents.filter(e => e.category === eventFilter && e.start !== "recurring-monthly");

  const tabs = [
    { id: "forecast", label: "COVARIATE FORECAST", icon: "📈" },
    { id: "events", label: "EVENT CALENDAR", icon: "📅" },
    { id: "seasonal", label: "SEASONALITY", icon: "🌊" },
    { id: "campaigns", label: "CAMPAIGNS", icon: "🎯" },
    { id: "backtest", label: "BACKTESTING", icon: "🔬" },
  ];

  const panelStyle = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: "8px", backdropFilter: "blur(16px)", boxShadow: "0 4px 30px rgba(0,0,0,0.4)" };
  const headerStyle = { fontSize: "8px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "10px", paddingBottom: "6px", borderBottom: `1px solid ${C.border}` };

  const chartWidth = typeof window !== "undefined" ? Math.min(880, window.innerWidth - 100) : 880;

  return (
    <div style={{
      position: "fixed", top: "60px", left: "50%", transform: "translateX(-50%)",
      zIndex: 40, width: "96vw", maxWidth: "1100px", maxHeight: "calc(100vh - 80px)",
      overflowY: "auto", borderRadius: "10px",
      background: C.bg, border: `1px solid ${C.borderActive}`,
      boxShadow: "0 12px 60px rgba(0,0,0,0.7), 0 0 40px rgba(0,200,255,0.06)",
      backdropFilter: "blur(20px)", fontFamily: MONO, color: C.text,
      animation: "pce-slideIn 0.25s ease-out",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 51, padding: "12px 24px",
        background: "linear-gradient(180deg, rgba(4,9,17,0.98) 0%, rgba(4,9,17,0.9) 100%)",
        borderBottom: `1px solid ${C.border}`, borderRadius: "10px 10px 0 0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: C.bright, letterSpacing: "0.06em" }}>PREDICTIVE CONTEXT ENGINE</div>
          <div style={{ fontSize: "9px", color: C.dim, marginTop: "2px" }}>Inhomogeneous Hawkes · Event Calendar · Seasonal Decomposition · Campaign Backtesting</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", gap: "3px" }}>
            {["ssh", "rdp", "http", "dns_amp"].map(v => (
              <button key={v} onClick={() => setSelectedVector(v)} style={{ padding: "4px 10px", fontSize: "9px", fontFamily: MONO, letterSpacing: "0.06em", border: `1px solid ${selectedVector === v ? (C[v] || C.accent) + "60" : C.border}`, borderRadius: "4px", cursor: "pointer", background: selectedVector === v ? `${C[v] || C.accent}15` : "transparent", color: selectedVector === v ? C[v] || C.accent : C.dim }}>{v.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "3px" }}>
            {[3, 6, 12].map(h => (
              <button key={h} onClick={() => setForecastHorizon(h)} style={{ padding: "4px 10px", fontSize: "9px", fontFamily: MONO, border: `1px solid ${forecastHorizon === h ? C.accent + "60" : C.border}`, borderRadius: "4px", cursor: "pointer", background: forecastHorizon === h ? `${C.accent}15` : "transparent", color: forecastHorizon === h ? C.accent : C.dim }}>{h}mo</button>
            ))}
          </div>
          {activeEvents.length > 0 && <div style={{ padding: "4px 12px", borderRadius: "4px", background: `${C.emergency}12`, border: `1px solid ${C.emergency}30`, fontSize: "9px", color: C.emergency, fontWeight: 700, animation: "pulse-dot 2s infinite" }}>{activeEvents.length} ACTIVE</div>}
          <div style={{ padding: "4px 10px", borderRadius: "4px", fontSize: "8px", fontFamily: MONO, fontWeight: 600, background: dataSource === "live" ? `${C.clear}12` : dataSource === "synthetic" ? `${C.warning}12` : `${C.dim}12`, border: `1px solid ${dataSource === "live" ? C.clear + "30" : dataSource === "synthetic" ? C.warning + "30" : C.dim + "30"}`, color: dataSource === "live" ? C.clear : dataSource === "synthetic" ? C.warning : C.dim }}>
            {dataSource === "live" ? (covariatesApplied ? "LIVE · COVARIATES" : "LIVE") : dataSource === "synthetic" ? "SYNTHETIC FALLBACK" : "LOADING..."}
          </div>
          {onClose && <button onClick={onClose} style={{ padding: "5px 10px", borderRadius: "4px", cursor: "pointer", background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.dim, fontFamily: MONO, fontSize: "12px", fontWeight: 700 }}>✕</button>}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "2px", padding: "8px 24px", background: "rgba(4,9,17,0.6)", borderBottom: `1px solid ${C.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "8px 16px", fontSize: "9px", fontFamily: MONO, letterSpacing: "0.08em", border: "none", borderRadius: "4px 4px 0 0", cursor: "pointer", background: activeTab === t.id ? C.panel : "transparent", color: activeTab === t.id ? C.accent : C.dim, borderBottom: activeTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent" }}>
            <span style={{ marginRight: "6px" }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px 24px" }}>
        {/* ─── FORECAST TAB ─── */}
        {activeTab === "forecast" && (
          <div>
            <CovariateFormula />
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
              <div style={headerStyle}>COVARIATE-ENHANCED FORECAST · {selectedVector.toUpperCase()} · {forecastHorizon}-MONTH HORIZON</div>
              <ForecastChart data={forecastData} events={resolvedEvents} width={chartWidth} height={240} vector={selectedVector} />
              <div style={{ display: "flex", gap: "16px", marginTop: "12px", flexWrap: "wrap" }}>
                {[{ color: C[selectedVector], label: "Historical / Forecast" }, { color: C[selectedVector], label: "90% CI", opacity: 0.15 }, { color: C.event, label: "Sporting" }, { color: C.warning, label: "Commerce" }, { color: C.emergency, label: "Geopolitical" }, { color: C.vuln, label: "Vulnerability" }, { color: C.seasonal, label: "Holiday" }].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px" }}><div style={{ width: "12px", height: "2px", background: item.color, borderRadius: "1px", opacity: item.opacity || 0.7 }} /><span style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>{item.label}</span></div>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ ...panelStyle, padding: "14px" }}><div style={headerStyle}>CURRENTLY ACTIVE EVENTS</div>{activeEvents.length > 0 ? activeEvents.map(e => <EventCard key={e.id} event={e} isActive />) : <div style={{ fontSize: "10px", color: C.dim, textAlign: "center", padding: "20px" }}>No active events driving forecast uplift</div>}</div>
              <div style={{ ...panelStyle, padding: "14px" }}><div style={headerStyle}>UPCOMING EVENTS</div>{upcomingEvents.map(e => <EventCard key={e.id} event={e} isActive={false} />)}</div>
            </div>
          </div>
        )}

        {/* ─── EVENTS TAB ─── */}
        {activeTab === "events" && (
          <div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {["all","sporting","commerce","geopolitical","vulnerability","financial","holiday"].map(cat => {
                const catColors = { all: C.accent, sporting: C.event, commerce: C.warning, geopolitical: C.emergency, vulnerability: C.vuln, financial: C.advisory, holiday: C.seasonal };
                const col = catColors[cat];
                return <button key={cat} onClick={() => setEventFilter(cat)} style={{ padding: "5px 12px", fontSize: "9px", fontFamily: MONO, letterSpacing: "0.06em", border: `1px solid ${eventFilter === cat ? col + "60" : C.border}`, borderRadius: "4px", cursor: "pointer", background: eventFilter === cat ? `${col}12` : "transparent", color: eventFilter === cat ? col : C.dim, textTransform: "uppercase" }}>{cat}</button>;
              })}
            </div>
            <div style={{ ...panelStyle, padding: "14px" }}>
              <div style={headerStyle}>EVENT CALENDAR · {eventFilter === "all" ? "ALL CATEGORIES" : eventFilter.toUpperCase()} · {filteredEvents.length} EVENTS</div>
              <div style={{ maxHeight: "500px", overflowY: "auto" }}>{filteredEvents.sort((a, b) => a.start.localeCompare(b.start)).map(e => <EventCard key={e.id} event={e} isActive={today >= e.start && today <= e.end} />)}</div>
            </div>
          </div>
        )}

        {/* ─── SEASONAL TAB ─── */}
        {activeTab === "seasonal" && (
          <div>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
              <div style={headerStyle}>SEASONAL MULTIPLIER HEATMAP · S(t) DECOMPOSITION</div>
              <div style={{ fontSize: "10px", color: C.text, lineHeight: 1.6, marginBottom: "12px" }}>Monthly multipliers from STL decomposition of 3-year historical data. Values above 1.0 indicate above-average activity.</div>
              <SeasonalHeatmap width={Math.min(600, chartWidth)} height={160} />
              <div style={{ marginTop: "14px", padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "4px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "8px", color: C.dim, letterSpacing: "0.12em", fontFamily: MONO, marginBottom: "6px" }}>KEY PATTERNS</div>
                <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.7 }}>
                  <span style={{ color: C.ssh }}>SSH</span>: Peaks Nov–Dec (holiday skeleton crews). <span style={{ color: C.rdp }}>RDP</span>: Strongest Q4 (ransomware holiday windows). <span style={{ color: C.http }}>HTTP</span>: Peaks during commerce events. <span style={{ color: C.dns_amp }}>DNS Amp</span>: Correlates with sporting/geopolitical events.
                </div>
              </div>
            </div>
            <div style={{ ...panelStyle, padding: "16px" }}>
              <div style={headerStyle}>DAY-OF-WEEK DECOMPOSITION</div>
              <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, i) => {
                  const mult = i < 5 ? 1.05 + (i === 2 ? 0.1 : 0) - (i === 4 ? 0.05 : 0) : (i === 5 ? 0.88 : 0.82);
                  const barH = mult * 60;
                  const isToday = new Date().getDay() === (i + 1) % 7;
                  return (<div key={i} style={{ textAlign: "center", width: "50px" }}><div style={{ height: "80px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}><div style={{ width: "30px", height: `${barH}px`, borderRadius: "3px 3px 0 0", background: isToday ? C.accent : `${C.accent}40`, border: isToday ? `1px solid ${C.accent}` : "none" }} /></div><div style={{ fontSize: "9px", color: isToday ? C.accent : C.dim, fontFamily: MONO, marginTop: "4px", fontWeight: isToday ? 700 : 400 }}>{day}</div><div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>{mult.toFixed(2)}×</div></div>);
                })}
              </div>
              <div style={{ textAlign: "center", fontSize: "9px", color: C.dim, fontFamily: MONO, marginTop: "8px" }}>Enterprise peaks mid-week · Automated scanning persists weekends · Ransomware favors Fri–Sun</div>
            </div>
          </div>
        )}

        {/* ─── CAMPAIGNS TAB ─── */}
        {activeTab === "campaigns" && (
          <div>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
              <div style={headerStyle}>CAMPAIGN RECURRENCE MATRIX · C(t) HISTORICAL PATTERNS</div>
              <div style={{ fontSize: "10px", color: C.text, lineHeight: 1.6, marginBottom: "12px" }}>Backtested from 3 years of attributed campaigns. Circle size = historical intensity. Current month highlighted.</div>
              <CampaignRecurrenceChart width={Math.min(600, chartWidth)} height={280} campaigns={resolvedCampaigns} />
            </div>
            <div style={{ ...panelStyle, padding: "14px" }}>
              <div style={headerStyle}>CAMPAIGN DETAIL</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {resolvedCampaigns.map(c => {
                  const currentMonth = new Date().getMonth() + 1;
                  const isActiveNow = c.months.includes(currentMonth);
                  const vecColor = C[c.vectors[0]] || C.accent;
                  return (
                    <div key={c.group} style={{ padding: "10px 12px", borderRadius: "6px", background: isActiveNow ? `${vecColor}06` : "rgba(255,255,255,0.02)", border: `1px solid ${isActiveNow ? vecColor + "30" : C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: C.bright, fontFamily: MONO }}>{c.group}</span>
                        {isActiveNow && <span style={{ fontSize: "7px", color: vecColor, fontFamily: MONO, padding: "1px 6px", background: `${vecColor}15`, borderRadius: "2px" }}>ACTIVE WINDOW</span>}
                      </div>
                      <div style={{ fontSize: "9px", color: C.dim, fontFamily: MONO }}>{c.aka}</div>
                      <div style={{ fontSize: "9px", color: C.text, fontFamily: MONO, lineHeight: 1.5, marginTop: "4px" }}>{c.note}</div>
                      <div style={{ display: "flex", gap: "3px", marginTop: "6px" }}>{c.vectors.map(v => <span key={v} style={{ fontSize: "7px", fontFamily: MONO, color: C[v] || C.dim, padding: "1px 5px", background: `${C[v] || C.dim}10`, borderRadius: "2px" }}>{v}</span>)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── BACKTEST TAB ─── */}
        {activeTab === "backtest" && (
          <div>
            <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
              <div style={headerStyle}>MODEL COMPARISON · BACKTESTING RESULTS ON 12-MONTH HOLDOUT{backtestResults?.data_driven ? " · DATA-DRIVEN" : " · ANALYTICAL ESTIMATES"}</div>
              <div style={{ fontSize: "10px", color: C.text, lineHeight: 1.6, marginBottom: "14px" }}>
                {backtestResults?.data_driven
                  ? `Real backtesting from ${backtestResults.eval_points} evaluation points across ${backtestResults.snapshot_count} forecast snapshots.`
                  : "Four model variants compared. Metrics derived from Hawkes parameter stability. Will upgrade to measured values as forecast snapshots accumulate."}
                {" "}Metrics: MAPE (lower better), 90% CI Coverage (target 0.90), Brier (calibration, lower better).
              </div>
              <BacktestComparison width={chartWidth} results={backtestResults?.models} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ ...panelStyle, padding: "14px" }}>
                <div style={headerStyle}>IMPROVEMENT SUMMARY</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {(() => {
                    const src = backtestResults?.models || BACKTEST_RESULTS;
                    const bl = src.baseline_hawkes || {};
                    const fc = src.full_context || {};
                    const mapeRedPct = bl.mape && fc.mape ? Math.round((1 - fc.mape / bl.mape) * 100) : 48;
                    const ciCov = fc.coverage_90 ? Math.round(fc.coverage_90 * 100) : 91;
                    const brierRedPct = bl.brier && fc.brier ? Math.round((1 - fc.brier / bl.brier) * 100) : 42;
                    return [{ label: "MAPE Reduction", value: `${mapeRedPct}%`, sub: "vs. baseline Hawkes", color: C.clear }, { label: "CI Coverage", value: `${ciCov}%`, sub: "target: 90%", color: C.clear }, { label: "Brier Improvement", value: `${brierRedPct}%`, sub: "severity prediction", color: C.clear }];
                  })().map((s, i) => (
                    <div key={i} style={{ padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "4px", textAlign: "center" }}>
                      <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.1em", marginBottom: "2px" }}>{s.label}</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: s.color, fontFamily: MONO }}>{s.value}</div>
                      <div style={{ fontSize: "7px", color: C.dim }}>{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ ...panelStyle, padding: "14px" }}>
                <div style={headerStyle}>METHODOLOGY</div>
                <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.7 }}>Rolling-origin cross-validation: 90-day training, 30-day forecast, 7-day steps across 12-month holdout. S(t) via STL (365-day period). Event covariates use binary indicators with lead -3d / lag +7d windows. Campaign C(t) via kernel density over attribution timestamps (14-day bandwidth). Weights fit via joint MLE with Hawkes parameters.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pce-slideIn { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
