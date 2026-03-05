import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// VULN WEATHER PANEL — "Vulnerability Pressure Systems"
// ═══════════════════════════════════════════════════════════════════════════════
// EPSS (Exploit Prediction Scoring System) + CISA KEV visualization
// Weather metaphor: vulnerabilities are pressure fronts, EPSS = barometric pressure
//
// DATA SOURCES (all free, no auth):
//   EPSS:     https://epss.cyentia.com/epss_scores-current.csv.gz (daily, ~240K CVEs)
//   CISA KEV: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
//   NVD:      https://services.nvd.nist.gov/rest/json/cves/2.0 (rate limited, needs API key for higher throughput)
//
// INTEGRATION: These should be proxied through the backend to avoid CORS issues.
//   Recommended endpoints:
//     GET /v1/vuln/epss/top?limit=50        → top EPSS scores
//     GET /v1/vuln/kev/recent?days=30       → recent KEV additions
//     GET /v1/vuln/divergence?limit=30      → CVSS-EPSS divergence cases
//     GET /v1/vuln/trending                 → EPSS score velocity (rising/falling)
//     GET /v1/vuln/stats                    → aggregate statistics
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg: "#050a12",
  panel: "rgba(8,18,38,0.92)",
  panelSolid: "#0a1628",
  border: "rgba(0,180,255,0.12)",
  borderBright: "rgba(0,180,255,0.3)",
  text: "#e0eaf8",
  dim: "#4a6d8f",
  bright: "#f0f6ff",
  accent: "#00ccff",
  // Severity weather palette
  emergency: "#ef4444",   // Cat 5 — active exploit, high EPSS
  severe:    "#f97316",   // Cat 4 — KEV listed, rising EPSS
  watch:     "#eab308",   // Cat 3 — moderate EPSS, known exploit code
  advisory:  "#3b82f6",   // Cat 2 — low EPSS but high CVSS
  clear:     "#22c55e",   // Cat 1 — low everything
  // EPSS gradient stops
  epssLow:    "#22c55e",
  epssMed:    "#eab308",
  epssHigh:   "#f97316",
  epssCrit:   "#ef4444",
};

const MONO = "'JetBrains Mono', monospace";

// ─── WEATHER SEVERITY CLASSIFICATION ─────────────────────────────────────────
function classifyVuln(epss, cvss, inKev, ransomware) {
  if (ransomware || (inKev && epss > 0.5)) return { level: 5, label: "EMERGENCY", color: C.emergency, icon: "🌪️" };
  if (inKev || epss > 0.7) return { level: 4, label: "SEVERE", color: C.severe, icon: "⛈️" };
  if (epss > 0.3 || (cvss >= 9.0 && epss > 0.1)) return { level: 3, label: "WATCH", color: C.watch, icon: "🌩️" };
  if (cvss >= 7.0 || epss > 0.1) return { level: 2, label: "ADVISORY", color: C.advisory, icon: "🌧️" };
  return { level: 1, label: "CLEAR", color: C.clear, icon: "☁️" };
}

function epssColor(score) {
  if (score >= 0.7) return C.epssCrit;
  if (score >= 0.3) return C.epssHigh;
  if (score >= 0.1) return C.epssMed;
  return C.epssLow;
}

function epssBarometric(score) {
  // Invert: high EPSS = low pressure (storm) = dangerous
  const hPa = Math.round(1013 - (score * 100));
  return `${hPa} hPa`;
}

// ─── REALISTIC MOCK DATA ─────────────────────────────────────────────────────
// Derived from real EPSS/KEV structure — replace with API calls
const MOCK_VULNS = [
  { cve: "CVE-2024-24919", vendor: "Check Point", product: "Quantum Gateway", cvss: 8.6, epss: 0.942, percentile: 0.996, inKev: true, kevDate: "2024-05-30", ransomware: false, delta7d: 0.031, cwe: "CWE-200", vector: "NETWORK" },
  { cve: "CVE-2024-21887", vendor: "Ivanti", product: "Connect Secure", cvss: 9.1, epss: 0.971, percentile: 0.998, inKev: true, kevDate: "2024-01-10", ransomware: true, delta7d: 0.002, cwe: "CWE-77", vector: "NETWORK" },
  { cve: "CVE-2025-0282", vendor: "Ivanti", product: "Connect Secure", cvss: 9.0, epss: 0.892, percentile: 0.994, inKev: true, kevDate: "2025-01-08", ransomware: false, delta7d: 0.089, cwe: "CWE-121", vector: "NETWORK" },
  { cve: "CVE-2024-3400", vendor: "Palo Alto", product: "PAN-OS", cvss: 10.0, epss: 0.957, percentile: 0.997, inKev: true, kevDate: "2024-04-12", ransomware: true, delta7d: -0.003, cwe: "CWE-77", vector: "NETWORK" },
  { cve: "CVE-2023-44487", vendor: "Multiple", product: "HTTP/2", cvss: 7.5, epss: 0.732, percentile: 0.981, inKev: true, kevDate: "2023-10-10", ransomware: false, delta7d: -0.012, cwe: "CWE-400", vector: "NETWORK" },
  { cve: "CVE-2025-21298", vendor: "Microsoft", product: "Windows OLE", cvss: 9.8, epss: 0.147, percentile: 0.872, inKev: false, kevDate: null, ransomware: false, delta7d: 0.058, cwe: "CWE-416", vector: "NETWORK" },
  { cve: "CVE-2025-24813", vendor: "Apache", product: "Tomcat", cvss: 9.8, epss: 0.834, percentile: 0.991, inKev: true, kevDate: "2025-03-17", ransomware: true, delta7d: 0.156, cwe: "CWE-502", vector: "NETWORK" },
  { cve: "CVE-2024-47575", vendor: "Fortinet", product: "FortiManager", cvss: 9.8, epss: 0.908, percentile: 0.995, inKev: true, kevDate: "2024-10-23", ransomware: false, delta7d: -0.021, cwe: "CWE-306", vector: "NETWORK" },
  { cve: "CVE-2025-30406", vendor: "Gladinet", product: "CentreStack", cvss: 9.8, epss: 0.672, percentile: 0.975, inKev: true, kevDate: "2025-04-08", ransomware: true, delta7d: 0.234, cwe: "CWE-321", vector: "NETWORK" },
  { cve: "CVE-2024-55591", vendor: "Fortinet", product: "FortiOS", cvss: 9.8, epss: 0.879, percentile: 0.993, inKev: true, kevDate: "2025-01-14", ransomware: false, delta7d: 0.042, cwe: "CWE-288", vector: "NETWORK" },
  // Divergence cases — high CVSS, low EPSS
  { cve: "CVE-2025-12345", vendor: "Oracle", product: "WebLogic", cvss: 9.8, epss: 0.028, percentile: 0.421, inKev: false, kevDate: null, ransomware: false, delta7d: 0.003, cwe: "CWE-502", vector: "NETWORK" },
  { cve: "CVE-2025-23456", vendor: "SAP", product: "NetWeaver", cvss: 9.1, epss: 0.015, percentile: 0.312, inKev: false, kevDate: null, ransomware: false, delta7d: -0.002, cwe: "CWE-434", vector: "NETWORK" },
  { cve: "CVE-2025-34567", vendor: "Cisco", product: "IOS XE", cvss: 8.8, epss: 0.041, percentile: 0.498, inKev: false, kevDate: null, ransomware: false, delta7d: 0.011, cwe: "CWE-78", vector: "ADJACENT" },
  // Low CVSS, high EPSS — the dangerous sleepers
  { cve: "CVE-2024-78901", vendor: "WordPress", product: "Plugin", cvss: 5.3, epss: 0.456, percentile: 0.963, inKev: false, kevDate: null, ransomware: false, delta7d: 0.078, cwe: "CWE-89", vector: "NETWORK" },
  { cve: "CVE-2025-45678", vendor: "Apache", product: "Struts", cvss: 6.1, epss: 0.523, percentile: 0.971, inKev: false, kevDate: null, ransomware: false, delta7d: 0.134, cwe: "CWE-79", vector: "NETWORK" },
  { cve: "CVE-2024-99012", vendor: "Jenkins", product: "Core", cvss: 4.3, epss: 0.312, percentile: 0.948, inKev: false, kevDate: null, ransomware: false, delta7d: 0.045, cwe: "CWE-352", vector: "NETWORK" },
  // Recent KEV additions (last 30 days)
  { cve: "CVE-2025-55182", vendor: "React", product: "Server Components", cvss: 9.1, epss: 0.567, percentile: 0.972, inKev: true, kevDate: "2025-02-10", ransomware: false, delta7d: 0.189, cwe: "CWE-94", vector: "NETWORK" },
  { cve: "CVE-2025-5777", vendor: "SonicWall", product: "SMA 100", cvss: 9.8, epss: 0.743, percentile: 0.984, inKev: true, kevDate: "2025-02-05", ransomware: false, delta7d: 0.067, cwe: "CWE-787", vector: "NETWORK" },
  { cve: "CVE-2025-48927", vendor: "TeleMessage", product: "Archive Server", cvss: 8.1, epss: 0.612, percentile: 0.976, inKev: true, kevDate: "2025-02-14", ransomware: false, delta7d: 0.201, cwe: "CWE-200", vector: "NETWORK" },
  { cve: "CVE-2025-59287", vendor: "Microsoft", product: "WSUS", cvss: 8.8, epss: 0.789, percentile: 0.989, inKev: true, kevDate: "2025-02-18", ransomware: true, delta7d: 0.312, cwe: "CWE-290", vector: "NETWORK" },
];

// Aggregate stats
const MOCK_STATS = {
  totalCves: 243847,
  totalKev: 1247,
  kevLast30d: 23,
  epssAbove50: 1842,
  epssAbove90: 487,
  avgEpssKev: 0.673,
  ransomwareKev: 312,
  medianTimeToKev: 14, // days from disclosure to KEV listing
};

// EPSS distribution histogram (mock)
const EPSS_HISTOGRAM = [
  { bin: "0.0-0.1", count: 228410, pct: 93.7 },
  { bin: "0.1-0.2", count: 6120, pct: 2.5 },
  { bin: "0.2-0.3", count: 3290, pct: 1.3 },
  { bin: "0.3-0.4", count: 1980, pct: 0.8 },
  { bin: "0.4-0.5", count: 1205, pct: 0.5 },
  { bin: "0.5-0.6", count: 892, pct: 0.4 },
  { bin: "0.6-0.7", count: 678, pct: 0.3 },
  { bin: "0.7-0.8", count: 521, pct: 0.2 },
  { bin: "0.8-0.9", count: 389, pct: 0.16 },
  { bin: "0.9-1.0", count: 362, pct: 0.15 },
];

// ─── SVG MINI COMPONENTS ─────────────────────────────────────────────────────

function EpssGauge({ score, size = 60 }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference * (1 - score);
  const color = epssColor(score);

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`${color}15`} strokeWidth="3" />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize="11" fontFamily={MONO} fontWeight="700"
        style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
      >
        {(score * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function DeltaArrow({ delta }) {
  if (Math.abs(delta) < 0.001) return <span style={{ color: C.dim }}>━</span>;
  const up = delta > 0;
  const color = up ? C.emergency : C.clear;
  const mag = Math.abs(delta);
  const arrows = mag > 0.1 ? (up ? "⬆⬆" : "⬇⬇") : (up ? "▲" : "▼");
  return (
    <span style={{ color, fontSize: "9px", fontWeight: 700 }}>
      {arrows} {(mag * 100).toFixed(1)}%
    </span>
  );
}

function MiniBar({ value, max = 1, color, width = 80, height = 6 }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ width, height, background: `${color}15`, borderRadius: 3, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", background: color,
        borderRadius: 3, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ─── TAB: STORM MAP (overview) ───────────────────────────────────────────────
function StormMapTab({ vulns, stats }) {
  const topThreats = [...vulns]
    .sort((a, b) => b.epss - a.epss)
    .slice(0, 8);

  const sevCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  vulns.forEach(v => {
    const cls = classifyVuln(v.epss, v.cvss, v.inKev, v.ransomware);
    sevCounts[cls.level]++;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Threat level summary bar */}
      <div style={{ display: "flex", gap: "6px" }}>
        {[
          { level: 5, label: "EMERGENCY", icon: "🌪️", color: C.emergency },
          { level: 4, label: "SEVERE", icon: "⛈️", color: C.severe },
          { level: 3, label: "WATCH", icon: "🌩️", color: C.watch },
          { level: 2, label: "ADVISORY", icon: "🌧️", color: C.advisory },
          { level: 1, label: "CLEAR", icon: "☁️", color: C.clear },
        ].map(s => (
          <div key={s.level} style={{
            flex: 1, padding: "8px 6px", borderRadius: "6px", textAlign: "center",
            background: sevCounts[s.level] > 0 ? `${s.color}12` : "transparent",
            border: `1px solid ${sevCounts[s.level] > 0 ? s.color + "40" : C.border}`,
          }}>
            <div style={{ fontSize: "14px" }}>{s.icon}</div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: s.color, fontFamily: MONO }}>
              {sevCounts[s.level]}
            </div>
            <div style={{ fontSize: "6px", color: C.dim, letterSpacing: "0.12em", fontFamily: MONO }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Barometric pressure header */}
      <div style={{
        padding: "10px 14px", borderRadius: "6px",
        background: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(0,204,255,0.05) 100%)",
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "6px" }}>
          VULNERABILITY BAROMETER
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
          {[
            { label: "TOTAL CVEs", value: stats.totalCves.toLocaleString(), color: C.accent },
            { label: "ACTIVE KEV", value: stats.totalKev.toLocaleString(), color: C.severe },
            { label: "KEV (30d)", value: `+${stats.kevLast30d}`, color: C.emergency },
            { label: "EPSS > 50%", value: stats.epssAbove50.toLocaleString(), color: C.watch },
            { label: "RANSOMWARE", value: stats.ransomwareKev.toLocaleString(), color: C.emergency },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "14px", fontWeight: 800, color: s.color, fontFamily: MONO }}>
                {s.value}
              </div>
              <div style={{ fontSize: "6px", color: C.dim, letterSpacing: "0.1em", fontFamily: MONO }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active storm cells — top EPSS threats */}
      <div>
        <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "8px" }}>
          ACTIVE STORM CELLS — TOP EXPLOITATION PROBABILITY
        </div>
        {topThreats.map(v => {
          const cls = classifyVuln(v.epss, v.cvss, v.inKev, v.ransomware);
          return (
            <div key={v.cve} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "7px 10px", marginBottom: "3px", borderRadius: "4px",
              background: `${cls.color}08`, border: `1px solid ${cls.color}20`,
            }}>
              <EpssGauge score={v.epss} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: C.bright, fontFamily: MONO }}>
                    {v.cve}
                  </span>
                  {v.inKev && (
                    <span style={{
                      fontSize: "6px", padding: "1px 4px", borderRadius: "3px",
                      background: `${C.emergency}20`, border: `1px solid ${C.emergency}40`,
                      color: C.emergency, fontFamily: MONO, letterSpacing: "0.08em",
                    }}>KEV</span>
                  )}
                  {v.ransomware && (
                    <span style={{
                      fontSize: "6px", padding: "1px 4px", borderRadius: "3px",
                      background: `${C.emergency}20`, border: `1px solid ${C.emergency}40`,
                      color: C.emergency, fontFamily: MONO, letterSpacing: "0.08em",
                    }}>🔒 RANSOM</span>
                  )}
                </div>
                <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>
                  {v.vendor} {v.product} · CVSS {v.cvss} · {epssBarometric(v.epss)}
                </div>
              </div>
              <DeltaArrow delta={v.delta7d} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TAB: KEV ALERTS ─────────────────────────────────────────────────────────
function KevAlertsTab({ vulns }) {
  const kevVulns = vulns
    .filter(v => v.inKev)
    .sort((a, b) => (b.kevDate || "").localeCompare(a.kevDate || ""));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{
        padding: "10px 14px", borderRadius: "6px",
        background: `${C.emergency}08`, border: `1px solid ${C.emergency}20`,
      }}>
        <div style={{ fontSize: "7px", color: C.emergency, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "4px" }}>
          ⚠️ CISA KNOWN EXPLOITED VULNERABILITIES — ACTIVE STORMS
        </div>
        <div style={{ fontSize: "9px", color: C.dim, fontFamily: MONO }}>
          Federally mandated remediation deadlines. These CVEs have confirmed exploitation in the wild.
        </div>
      </div>

      {/* Timeline */}
      <div style={{ position: "relative", paddingLeft: "16px" }}>
        {/* Vertical timeline line */}
        <div style={{
          position: "absolute", left: "6px", top: 0, bottom: 0, width: "2px",
          background: `linear-gradient(180deg, ${C.emergency}60, ${C.emergency}10)`,
        }} />

        {kevVulns.map((v, i) => {
          const cls = classifyVuln(v.epss, v.cvss, v.inKev, v.ransomware);
          const daysSince = v.kevDate
            ? Math.floor((Date.now() - new Date(v.kevDate).getTime()) / 86400000)
            : null;

          return (
            <div key={v.cve} style={{
              position: "relative", marginBottom: "10px", paddingLeft: "14px",
            }}>
              {/* Timeline dot */}
              <div style={{
                position: "absolute", left: "-12px", top: "8px",
                width: "8px", height: "8px", borderRadius: "50%",
                background: cls.color, boxShadow: `0 0 6px ${cls.color}60`,
              }} />

              <div style={{
                padding: "10px 12px", borderRadius: "6px",
                background: `${cls.color}06`, border: `1px solid ${cls.color}18`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: C.bright, fontFamily: MONO }}>
                        {v.cve}
                      </span>
                      <span style={{ fontSize: "7px", color: cls.color, fontFamily: MONO }}>
                        {cls.icon} {cls.label}
                      </span>
                      {v.ransomware && (
                        <span style={{
                          fontSize: "6px", padding: "1px 4px", borderRadius: "3px",
                          background: `${C.emergency}25`, color: C.emergency,
                          fontFamily: MONO, fontWeight: 700,
                        }}>RANSOMWARE</span>
                      )}
                    </div>
                    <div style={{ fontSize: "9px", color: C.text, fontFamily: MONO }}>
                      {v.vendor} — {v.product}
                    </div>
                    <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO, marginTop: "2px" }}>
                      {v.cwe} · {v.vector} · CVSS {v.cvss}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "9px", color: C.dim, fontFamily: MONO }}>
                      KEV {v.kevDate}
                    </div>
                    {daysSince !== null && (
                      <div style={{
                        fontSize: "8px", fontFamily: MONO, marginTop: "2px",
                        color: daysSince < 14 ? C.emergency : daysSince < 30 ? C.watch : C.dim,
                      }}>
                        {daysSince}d ago
                      </div>
                    )}
                    <div style={{ marginTop: "4px" }}>
                      <EpssGauge score={v.epss} size={32} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TAB: DIVERGENCE (CVSS vs EPSS) ─────────────────────────────────────────
function DivergenceTab({ vulns }) {
  // Find cases where CVSS and EPSS disagree significantly
  const scored = vulns.map(v => ({
    ...v,
    divergence: (v.cvss / 10) - v.epss, // positive = overrated by CVSS, negative = underrated
  }));

  const overrated = scored.filter(v => v.divergence > 0.3).sort((a, b) => b.divergence - a.divergence);
  const underrated = scored.filter(v => v.divergence < -0.2).sort((a, b) => a.divergence - b.divergence);

  const renderVulnRow = (v, type) => {
    const color = type === "over" ? C.advisory : C.emergency;
    return (
      <div key={v.cve} style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "8px 10px", marginBottom: "4px", borderRadius: "4px",
        background: `${color}06`, border: `1px solid ${color}15`,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: C.bright, fontFamily: MONO }}>
            {v.cve}
          </div>
          <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>
            {v.vendor} {v.product}
          </div>
        </div>
        {/* CVSS bar */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "6px", color: C.dim, fontFamily: MONO, marginBottom: "2px" }}>CVSS</div>
          <MiniBar value={v.cvss} max={10} color={C.advisory} width={50} />
          <div style={{ fontSize: "8px", color: C.advisory, fontFamily: MONO, marginTop: "1px" }}>
            {v.cvss}
          </div>
        </div>
        {/* Divergence arrow */}
        <div style={{ fontSize: "12px", color: C.dim }}>
          {type === "over" ? "⟫" : "⟪"}
        </div>
        {/* EPSS bar */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "6px", color: C.dim, fontFamily: MONO, marginBottom: "2px" }}>EPSS</div>
          <MiniBar value={v.epss} max={1} color={epssColor(v.epss)} width={50} />
          <div style={{ fontSize: "8px", color: epssColor(v.epss), fontFamily: MONO, marginTop: "1px" }}>
            {(v.epss * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* CVSS-EPSS scatter concept */}
      <div style={{
        padding: "10px 14px", borderRadius: "6px",
        background: `${C.accent}05`, border: `1px solid ${C.border}`,
      }}>
        <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "6px" }}>
          WEATHER FRONT ANALYSIS — SEVERITY vs EXPLOITABILITY DIVERGENCE
        </div>
        <div style={{ fontSize: "8px", color: C.text, fontFamily: MONO, lineHeight: 1.5 }}>
          Where CVSS severity and EPSS exploit probability disagree reveals the most actionable intelligence.
          High-CVSS + low-EPSS wastes patching resources. Low-CVSS + high-EPSS = hidden danger.
        </div>
      </div>

      {/* Overrated by CVSS */}
      <div>
        <div style={{
          fontSize: "7px", color: C.advisory, letterSpacing: "0.14em",
          fontFamily: MONO, marginBottom: "6px",
          display: "flex", alignItems: "center", gap: "6px",
        }}>
          <span>🌧️ OVERCAST — HIGH SEVERITY, LOW EXPLOITATION</span>
          <span style={{ color: C.dim, fontStyle: "italic", fontSize: "7px", letterSpacing: "normal" }}>
            (deprioritize)
          </span>
        </div>
        {overrated.slice(0, 5).map(v => renderVulnRow(v, "over"))}
      </div>

      {/* Underrated by CVSS */}
      <div>
        <div style={{
          fontSize: "7px", color: C.emergency, letterSpacing: "0.14em",
          fontFamily: MONO, marginBottom: "6px",
          display: "flex", alignItems: "center", gap: "6px",
        }}>
          <span>🌪️ HIDDEN STORMS — LOW SEVERITY, HIGH EXPLOITATION</span>
          <span style={{ color: C.dim, fontStyle: "italic", fontSize: "7px", letterSpacing: "normal" }}>
            (prioritize!)
          </span>
        </div>
        {underrated.slice(0, 5).map(v => renderVulnRow(v, "under"))}
      </div>
    </div>
  );
}

// ─── TAB: TRENDING (EPSS Velocity) ──────────────────────────────────────────
function TrendingTab({ vulns }) {
  const rising = [...vulns]
    .filter(v => v.delta7d > 0.01)
    .sort((a, b) => b.delta7d - a.delta7d);

  const falling = [...vulns]
    .filter(v => v.delta7d < -0.005)
    .sort((a, b) => a.delta7d - b.delta7d);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        padding: "10px 14px", borderRadius: "6px",
        background: `${C.emergency}06`, border: `1px solid ${C.emergency}15`,
      }}>
        <div style={{ fontSize: "7px", color: C.emergency, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "4px" }}>
          📈 PRESSURE RISING — EPSS VELOCITY (7-DAY Δ)
        </div>
        <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>
          CVEs gaining exploitation momentum. Rising EPSS signals emerging weaponization.
        </div>
      </div>

      {rising.map(v => {
        const cls = classifyVuln(v.epss, v.cvss, v.inKev, v.ransomware);
        return (
          <div key={v.cve} style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "8px 10px", borderRadius: "4px",
            background: `${C.emergency}06`, border: `1px solid ${C.emergency}12`,
          }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `${C.emergency}15`, border: `2px solid ${C.emergency}40`,
              fontSize: "10px", fontWeight: 800, color: C.emergency, fontFamily: MONO,
            }}>
              +{(v.delta7d * 100).toFixed(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: C.bright, fontFamily: MONO }}>
                  {v.cve}
                </span>
                {v.inKev && (
                  <span style={{ fontSize: "6px", color: C.emergency, fontFamily: MONO }}>KEV</span>
                )}
              </div>
              <div style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>
                {v.vendor} {v.product} · EPSS {(v.epss * 100).toFixed(1)}% → {((v.epss + v.delta7d) * 100).toFixed(1)}%
              </div>
            </div>
            <MiniBar value={v.epss} max={1} color={C.emergency} width={60} height={8} />
          </div>
        );
      })}

      {falling.length > 0 && (
        <>
          <div style={{
            padding: "8px 14px", borderRadius: "6px",
            background: `${C.clear}06`, border: `1px solid ${C.clear}15`,
          }}>
            <div style={{ fontSize: "7px", color: C.clear, letterSpacing: "0.14em", fontFamily: MONO }}>
              📉 PRESSURE FALLING — STORMS DISSIPATING
            </div>
          </div>
          {falling.slice(0, 4).map(v => (
            <div key={v.cve} style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "6px 10px", borderRadius: "4px",
              background: `${C.clear}04`, border: `1px solid ${C.clear}10`,
            }}>
              <span style={{ fontSize: "10px", fontWeight: 700, color: C.clear, fontFamily: MONO, width: "40px", textAlign: "center" }}>
                {(v.delta7d * 100).toFixed(1)}
              </span>
              <span style={{ fontSize: "10px", color: C.bright, fontFamily: MONO }}>
                {v.cve}
              </span>
              <span style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>
                {v.vendor} {v.product}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── TAB: DISTRIBUTION (EPSS landscape) ─────────────────────────────────────
function DistributionTab({ histogram, stats }) {
  const maxCount = Math.max(...histogram.map(h => h.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        padding: "10px 14px", borderRadius: "6px",
        background: `${C.accent}05`, border: `1px solid ${C.border}`,
      }}>
        <div style={{ fontSize: "7px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO, marginBottom: "4px" }}>
          ATMOSPHERIC PRESSURE DISTRIBUTION — EPSS LANDSCAPE
        </div>
        <div style={{ fontSize: "8px", color: C.text, fontFamily: MONO }}>
          {stats.totalCves.toLocaleString()} CVEs scored. {((stats.epssAbove50 / stats.totalCves) * 100).toFixed(2)}% have
          EPSS above 50%. The vast majority pose negligible exploitation risk.
        </div>
      </div>

      {/* Histogram */}
      <div style={{ padding: "0 4px" }}>
        {histogram.map((h, i) => {
          const binMid = (i + 0.5) / 10;
          const color = epssColor(binMid);
          const barWidth = Math.max(2, (Math.log10(h.count + 1) / Math.log10(maxCount + 1)) * 100);

          return (
            <div key={h.bin} style={{
              display: "flex", alignItems: "center", gap: "8px",
              marginBottom: "4px",
            }}>
              <div style={{
                width: "50px", fontSize: "8px", color: C.dim, fontFamily: MONO,
                textAlign: "right",
              }}>
                {h.bin}
              </div>
              <div style={{ flex: 1, height: "14px", position: "relative" }}>
                <div style={{
                  height: "100%", width: `${barWidth}%`,
                  background: `linear-gradient(90deg, ${color}40, ${color})`,
                  borderRadius: "2px", transition: "width 0.5s ease",
                  position: "relative",
                }}>
                  <div style={{
                    position: "absolute", right: "-4px", top: "50%", transform: "translateY(-50%)",
                    width: "3px", height: "3px", borderRadius: "50%",
                    background: color, boxShadow: `0 0 4px ${color}`,
                  }} />
                </div>
              </div>
              <div style={{
                width: "60px", fontSize: "8px", color, fontFamily: MONO,
                textAlign: "right",
              }}>
                {h.count.toLocaleString()}
              </div>
              <div style={{
                width: "36px", fontSize: "7px", color: C.dim, fontFamily: MONO,
                textAlign: "right",
              }}>
                {h.pct}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Key insight metrics */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: "8px", marginTop: "4px",
      }}>
        {[
          { label: "MEDIAN TIME\nDISCLOSURE → KEV", value: `${stats.medianTimeToKev}d`, color: C.severe },
          { label: "AVG EPSS\nKEV ENTRIES", value: `${(stats.avgEpssKev * 100).toFixed(1)}%`, color: C.watch },
          { label: "EPSS > 90%", value: stats.epssAbove90.toLocaleString(), color: C.emergency },
        ].map(m => (
          <div key={m.label} style={{
            padding: "10px 8px", borderRadius: "6px", textAlign: "center",
            background: `${m.color}08`, border: `1px solid ${m.color}20`,
          }}>
            <div style={{ fontSize: "18px", fontWeight: 800, color: m.color, fontFamily: MONO }}>
              {m.value}
            </div>
            <div style={{
              fontSize: "6px", color: C.dim, fontFamily: MONO,
              letterSpacing: "0.1em", whiteSpace: "pre-line", lineHeight: 1.4, marginTop: "4px",
            }}>
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN PANEL EXPORT ───────────────────────────────────────────────────────
export default function VulnWeatherPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState("storm");
  const [vulns, setVulns] = useState(MOCK_VULNS);
  const [stats, setStats] = useState(MOCK_STATS);
  const [dataSource, setDataSource] = useState("CACHED");
  const panelRef = useRef(null);

  // Attempt to fetch live data from backend
  useEffect(() => {
    async function fetchLive() {
      try {
        const baseUrl = import.meta.env?.VITE_API_BASE ?? "";
        // Try the backend proxy endpoint
        const res = await fetch(`${baseUrl}/v1/vuln/epss/top?limit=50`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          if (data?.vulns?.length > 0) {
            setVulns(data.vulns);
            setDataSource("LIVE");
          }
          if (data?.stats) {
            setStats(data.stats);
          }
        }
      } catch {
        // Fall back to mock data — endpoint not implemented yet
        setDataSource("CACHED");
      }
    }
    fetchLive();
  }, []);

  const tabs = [
    { id: "storm",    label: "STORM MAP",    icon: "🌪️" },
    { id: "kev",      label: "KEV ALERTS",   icon: "⚠️" },
    { id: "diverge",  label: "DIVERGENCE",   icon: "🌀" },
    { id: "trending", label: "TRENDING",     icon: "📈" },
    { id: "dist",     label: "DISTRIBUTION", icon: "📊" },
  ];

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        top: "70px",
        right: "16px",
        width: "480px",
        maxHeight: "calc(100vh - 100px)",
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: "10px",
        backdropFilter: "blur(20px)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: `1px solid ${C.border}`,
        background: "linear-gradient(180deg, rgba(239,68,68,0.04) 0%, transparent 100%)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 800, color: C.bright, letterSpacing: "0.05em", fontFamily: MONO }}>
              🛡️ VULNERABILITY PRESSURE SYSTEMS
            </div>
            <div style={{ fontSize: "8px", color: C.dim, marginTop: "2px", fontFamily: MONO }}>
              EPSS Exploit Prediction · CISA KEV · CVSS Divergence Analysis
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              fontSize: "7px", padding: "2px 6px", borderRadius: "3px",
              background: dataSource === "LIVE" ? `${C.clear}20` : `${C.watch}20`,
              color: dataSource === "LIVE" ? C.clear : C.watch,
              fontFamily: MONO, letterSpacing: "0.1em",
            }}>
              {dataSource}
            </div>
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: `1px solid ${C.border}`,
                borderRadius: "4px", padding: "2px 8px", cursor: "pointer",
                color: C.dim, fontFamily: MONO, fontSize: "11px",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "3px", marginTop: "10px" }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, padding: "5px 4px", borderRadius: "4px",
                background: activeTab === t.id ? `${C.accent}15` : "transparent",
                border: `1px solid ${activeTab === t.id ? C.accent + "40" : "transparent"}`,
                cursor: "pointer", fontFamily: MONO, fontSize: "7px",
                color: activeTab === t.id ? C.accent : C.dim,
                letterSpacing: "0.06em", transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: "12px", marginBottom: "1px" }}>{t.icon}</div>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflow: "auto", padding: "14px 16px",
        scrollbarWidth: "thin",
        scrollbarColor: `${C.accent}30 transparent`,
      }}>
        {activeTab === "storm" && <StormMapTab vulns={vulns} stats={stats} />}
        {activeTab === "kev" && <KevAlertsTab vulns={vulns} />}
        {activeTab === "diverge" && <DivergenceTab vulns={vulns} />}
        {activeTab === "trending" && <TrendingTab vulns={vulns} />}
        {activeTab === "dist" && <DistributionTab histogram={EPSS_HISTOGRAM} stats={stats} />}
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 16px", borderTop: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO, letterSpacing: "0.1em" }}>
          EPSS v4 (FIRST) · CISA KEV · NVD 2.0
        </div>
        <div style={{ fontSize: "7px", color: C.dim, fontFamily: MONO }}>
          {vulns.length} CVEs loaded · {vulns.filter(v => v.inKev).length} KEV
        </div>
      </div>
    </div>
  );
}
