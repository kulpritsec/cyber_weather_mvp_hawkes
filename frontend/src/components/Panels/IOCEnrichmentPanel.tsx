/**
 * IOCEnrichmentPanel.tsx — "Indicator Microscope"
 *
 * Click an IP/domain/hash on the globe or enter manually → instant pivot to
 * reputation, geolocation, ASN, associated malware, passive DNS, campaigns.
 *
 * Microscope metaphor:
 *   Center = IOC
 *   Ring 1 = Reputation sources (AbuseIPDB, VirusTotal, OTX)
 *   Ring 2 = Associated infrastructure (passive DNS, ASN, URLs)
 *   Ring 3 = Linked campaigns/pulses (OTX Pulses, ThreatFox malware)
 *
 * Sources: AlienVault OTX, AbuseIPDB, VirusTotal, URLhaus, ThreatFox
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Design Tokens (matching existing panels) ─────────────
const C = {
  bg: "rgba(8, 15, 28, 0.97)",
  bgSolid: "#080f1c",
  surface: "rgba(12, 22, 42, 0.85)",
  surfaceHover: "rgba(16, 30, 56, 0.9)",
  border: "rgba(0, 180, 255, 0.12)",
  borderBright: "rgba(0, 180, 255, 0.3)",
  accent: "#00b4ff",
  accentDim: "rgba(0, 180, 255, 0.08)",
  warning: "#ff9f43",
  danger: "#ff4757",
  success: "#2ed573",
  textPrimary: "#e0e6f0",
  textSecondary: "#6b7a94",
  textAccent: "#00b4ff",
  scanline: "rgba(0, 180, 255, 0.02)",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

// ── Types ────────────────────────────────────────────────
interface EnrichmentResult {
  indicator: string;
  ioc_type: string;
  aggregate_score: number;
  sources: Record<string, SourceResult>;
  timeline: TimelineEntry[];
  queried_at: string;
}

interface SourceResult {
  source: string;
  error: string | null;
  data: any;
}

interface TimelineEntry {
  source: string;
  date: string;
  label: string;
}

interface IOCEnrichmentPanelProps {
  onClose: () => void;
  initialIndicator?: string;
}

// ── Radial Graph Component ───────────────────────────────
const RadialGraph: React.FC<{
  data: EnrichmentResult | null;
  loading: boolean;
}> = ({ data, loading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;
    const cy = H / 2;
    const t = timeRef.current;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background rings (always visible, microscope reticle)
    const ringRadii = [45, 100, 155, 210];
    ringRadii.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 180, 255, ${0.06 + i * 0.01})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Crosshair lines
    ctx.strokeStyle = "rgba(0, 180, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 220);
    ctx.lineTo(cx, cy + 220);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 220, cy);
    ctx.lineTo(cx + 220, cy);
    ctx.stroke();

    // Rotating scan line
    const scanAngle = (t * 0.5) % (Math.PI * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(scanAngle);
    const grad = ctx.createLinearGradient(0, 0, 220, 0);
    grad.addColorStop(0, "rgba(0, 180, 255, 0.15)");
    grad.addColorStop(1, "rgba(0, 180, 255, 0)");
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 220, -0.05, 0.35);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    if (loading) {
      // Pulsing center during load
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + pulse * 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 180, 255, ${0.2 + pulse * 0.15})`;
      ctx.fill();
      ctx.font = `10px ${C.mono}`;
      ctx.fillStyle = C.textSecondary;
      ctx.textAlign = "center";
      ctx.fillText("ENRICHING...", cx, cy + 45);
    } else if (data) {
      // ── Center: IOC indicator ──
      const score = data.aggregate_score;
      const scoreColor =
        score >= 70 ? C.danger : score >= 40 ? C.warning : score >= 10 ? C.accent : C.success;

      // Pulsing threat ring
      const threatPulse = 0.7 + 0.3 * Math.sin(t * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, 35, 0, Math.PI * 2);
      ctx.fillStyle = `${scoreColor}${Math.round(threatPulse * 25)
        .toString(16)
        .padStart(2, "0")}`;
      ctx.fill();
      ctx.strokeStyle = scoreColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Score text
      ctx.font = `bold 16px ${C.mono}`;
      ctx.fillStyle = scoreColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${score}`, cx, cy - 2);
      ctx.font = `8px ${C.mono}`;
      ctx.fillStyle = C.textSecondary;
      ctx.fillText("THREAT", cx, cy + 14);

      // ── Ring 1: Reputation sources ──
      const ring1Sources = [
        {
          label: "AbuseIPDB",
          color: data.sources.abuseipdb?.data
            ? (data.sources.abuseipdb.data.abuse_confidence_score > 50 ? C.danger : C.success)
            : "#444",
          value: data.sources.abuseipdb?.data?.abuse_confidence_score ?? "—",
          active: !!data.sources.abuseipdb?.data,
          angle: -Math.PI / 3,
        },
        {
          label: "VirusTotal",
          color: data.sources.virustotal?.data
            ? (data.sources.virustotal.data.malicious > 5 ? C.danger : C.success)
            : "#444",
          value: data.sources.virustotal?.data
            ? `${data.sources.virustotal.data.malicious}/${data.sources.virustotal.data.total_engines}`
            : "—",
          active: !!data.sources.virustotal?.data,
          angle: Math.PI / 3,
        },
        {
          label: "OTX Rep",
          color: data.sources.otx?.data
            ? (data.sources.otx.data.reputation > 0 ? C.warning : C.success)
            : "#444",
          value: data.sources.otx?.data?.reputation ?? "—",
          active: !!data.sources.otx?.data,
          angle: Math.PI,
        },
      ];

      ring1Sources.forEach((src) => {
        const x = cx + Math.cos(src.angle) * 100;
        const y = cy + Math.sin(src.angle) * 100;

        // Connection line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = src.active ? `${src.color}40` : "rgba(60,60,80,0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Node
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fillStyle = src.active ? `${src.color}20` : "rgba(30,30,50,0.5)";
        ctx.fill();
        ctx.strokeStyle = src.active ? src.color : "#333";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Value
        ctx.font = `bold 10px ${C.mono}`;
        ctx.fillStyle = src.active ? src.color : "#555";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(src.value), x, y);

        // Label
        ctx.font = `8px ${C.mono}`;
        ctx.fillStyle = C.textSecondary;
        ctx.fillText(src.label, x, y + 28);
      });

      // ── Ring 2: Infrastructure ──
      const infra: Array<{ label: string; value: string; angle: number }> = [];
      const otx = data.sources.otx?.data;
      if (otx) {
        if (otx.asn) infra.push({ label: "ASN", value: String(otx.asn).substring(0, 12), angle: 0 });
        if (otx.country)
          infra.push({ label: "GEO", value: otx.country.substring(0, 10), angle: Math.PI / 2 });
        if (otx.passive_dns?.length)
          infra.push({
            label: "PDNS",
            value: `${otx.passive_dns.length} rec`,
            angle: Math.PI,
          });
      }
      const abuse = data.sources.abuseipdb?.data;
      if (abuse?.isp) {
        infra.push({
          label: "ISP",
          value: abuse.isp.substring(0, 12),
          angle: -Math.PI / 2,
        });
      }

      const infraSpacing = infra.length > 0 ? (Math.PI * 2) / infra.length : 0;
      infra.forEach((item, i) => {
        const angle = -Math.PI / 2 + i * infraSpacing;
        const x = cx + Math.cos(angle) * 155;
        const y = cy + Math.sin(angle) * 155;

        // Thin line from ring 1
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * 118, cy + Math.sin(angle) * 118);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "rgba(0, 180, 255, 0.1)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Small diamond node
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = C.accentDim;
        ctx.strokeStyle = "rgba(0, 180, 255, 0.2)";
        ctx.lineWidth = 1;
        ctx.fillRect(-8, -8, 16, 16);
        ctx.strokeRect(-8, -8, 16, 16);
        ctx.restore();

        ctx.font = `bold 8px ${C.mono}`;
        ctx.fillStyle = C.textAccent;
        ctx.textAlign = "center";
        ctx.fillText(item.label, x, y - 16);
        ctx.font = `7px ${C.mono}`;
        ctx.fillStyle = C.textPrimary;
        ctx.fillText(item.value, x, y + 16);
      });

      // ── Ring 3: Campaigns/Pulses ──
      const campaigns: Array<{ label: string; source: string; angle: number }> = [];
      if (otx?.pulses) {
        otx.pulses.slice(0, 4).forEach((p: any, i: number) => {
          campaigns.push({
            label: (p.adversary || p.name || "Pulse").substring(0, 16),
            source: "OTX",
            angle: 0,
          });
        });
      }
      const tfox = data.sources.threatfox?.data;
      if (tfox?.found && tfox.iocs) {
        tfox.iocs.slice(0, 3).forEach((ioc: any) => {
          campaigns.push({
            label: (ioc.malware || ioc.threat_type || "IOC").substring(0, 16),
            source: "TFox",
            angle: 0,
          });
        });
      }

      const campSpacing = campaigns.length > 0 ? (Math.PI * 2) / campaigns.length : 0;
      campaigns.forEach((camp, i) => {
        const angle = i * campSpacing;
        const x = cx + Math.cos(angle) * 210;
        const y = cy + Math.sin(angle) * 210;

        // Pulse animation for active campaigns
        const campPulse = 0.5 + 0.5 * Math.sin(t * 1.5 + i);
        ctx.beginPath();
        ctx.arc(x, y, 4 + campPulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = camp.source === "OTX" ? `${C.warning}60` : `${C.danger}60`;
        ctx.fill();

        ctx.font = `7px ${C.mono}`;
        ctx.fillStyle = C.textSecondary;
        ctx.textAlign = "center";
        ctx.fillText(camp.label, x, y + 14);
        ctx.font = `6px ${C.mono}`;
        ctx.fillStyle = camp.source === "OTX" ? C.warning : C.danger;
        ctx.fillText(camp.source, x, y + 22);
      });

      // Ring labels
      ctx.font = `7px ${C.mono}`;
      ctx.fillStyle = "rgba(0, 180, 255, 0.15)";
      ctx.textAlign = "right";
      ctx.fillText("REPUTATION", cx - 48, cy - 92);
      ctx.fillText("INFRASTRUCTURE", cx - 48, cy - 147);
      ctx.fillText("CAMPAIGNS", cx - 48, cy - 202);
    } else {
      // Empty state
      ctx.font = `11px ${C.mono}`;
      ctx.fillStyle = C.textSecondary;
      ctx.textAlign = "center";
      ctx.fillText("Enter an IOC to begin analysis", cx, cy - 8);
      ctx.font = `9px ${C.mono}`;
      ctx.fillText("IP · Domain · Hash · URL · CVE", cx, cy + 12);
    }

    timeRef.current += 0.016;
    animRef.current = requestAnimationFrame(draw);
  }, [data, loading]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};

// ── Source Card Component ─────────────────────────────────
const SourceCard: React.FC<{
  title: string;
  icon: string;
  status: "ok" | "error" | "loading" | "empty";
  children: React.ReactNode;
}> = ({ title, icon, status, children }) => {
  const statusColors = {
    ok: C.success,
    error: C.danger,
    loading: C.accent,
    empty: C.textSecondary,
  };

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: "6px",
        padding: "10px 12px",
        marginBottom: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px" }}>{icon}</span>
          <span
            style={{
              fontFamily: C.mono,
              fontSize: "10px",
              fontWeight: 700,
              color: C.textPrimary,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: statusColors[status],
            boxShadow: `0 0 6px ${statusColors[status]}`,
          }}
        />
      </div>
      <div style={{ fontFamily: C.mono, fontSize: "10px", color: C.textSecondary, lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
};

// ── Timeline Component ───────────────────────────────────
const Timeline: React.FC<{ entries: TimelineEntry[] }> = ({ entries }) => {
  if (!entries.length) return null;

  const sourceColors: Record<string, string> = {
    "OTX Pulse": C.warning,
    "OTX PDNS": "#8b5cf6",
    AbuseIPDB: C.danger,
    URLhaus: "#ff6348",
    ThreatFox: "#ff4757",
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <div
        style={{
          fontFamily: C.mono,
          fontSize: "9px",
          fontWeight: 700,
          color: C.textSecondary,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "8px",
        }}
      >
        ⏱ INDICATOR TIMELINE
      </div>
      <div style={{ position: "relative", paddingLeft: "12px" }}>
        {/* Vertical line */}
        <div
          style={{
            position: "absolute",
            left: "3px",
            top: 0,
            bottom: 0,
            width: "1px",
            background: `linear-gradient(180deg, ${C.accent}40, transparent)`,
          }}
        />
        {entries.slice(0, 8).map((entry, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              marginBottom: "6px",
              position: "relative",
            }}
          >
            {/* Dot */}
            <div
              style={{
                position: "absolute",
                left: "-11px",
                top: "3px",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: sourceColors[entry.source] || C.accent,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                <span
                  style={{
                    fontFamily: C.mono,
                    fontSize: "8px",
                    color: sourceColors[entry.source] || C.accent,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {entry.source}
                </span>
                <span
                  style={{
                    fontFamily: C.mono,
                    fontSize: "8px",
                    color: C.textSecondary,
                    flexShrink: 0,
                  }}
                >
                  {entry.date?.substring(0, 10) || "—"}
                </span>
              </div>
              <div
                style={{
                  fontFamily: C.mono,
                  fontSize: "9px",
                  color: C.textPrimary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Score Badge ──────────────────────────────────────────
const ScoreBadge: React.FC<{ score: number; label: string }> = ({ score, label }) => {
  const color = score >= 70 ? C.danger : score >= 40 ? C.warning : score >= 10 ? C.accent : C.success;
  const bg = score >= 70 ? `${C.danger}15` : score >= 40 ? `${C.warning}15` : `${C.success}15`;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "3px",
        background: bg,
        border: `1px solid ${color}30`,
      }}
    >
      <span style={{ fontFamily: C.mono, fontSize: "11px", fontWeight: 700, color }}>{score}</span>
      <span style={{ fontFamily: C.mono, fontSize: "8px", color: C.textSecondary }}>{label}</span>
    </div>
  );
};

// ── Main Panel ───────────────────────────────────────────
const IOCEnrichmentPanel: React.FC<IOCEnrichmentPanelProps> = ({ onClose, initialIndicator }) => {
  const [indicator, setIndicator] = useState(initialIndicator || "");
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"microscope" | "sources" | "timeline">("microscope");
  const [apiHealth, setApiHealth] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Check API health on mount
  useEffect(() => {
    fetch("/v1/ioc/health")
      .then((r) => r.json())
      .then(setApiHealth)
      .catch(() => {});
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Auto-enrich if initialIndicator provided
  useEffect(() => {
    if (initialIndicator) {
      setIndicator(initialIndicator);
      enrich(initialIndicator);
    }
  }, [initialIndicator]);

  const enrich = async (value?: string) => {
    const target = (value || indicator).trim();
    if (!target) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const r = await fetch(`/v1/ioc/enrich?indicator=${encodeURIComponent(target)}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const data: EnrichmentResult = await r.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Enrichment failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") enrich();
    if (e.key === "Escape") {
      e.stopPropagation();
      if (indicator) {
        setIndicator("");
        setResult(null);
      } else {
        onClose();
      }
    }
  };

  // Shortcut indicators for quick testing
  const quickLookups = [
    { label: "8.8.8.8", type: "DNS" },
    { label: "1.1.1.1", type: "DNS" },
    { label: "185.220.101.1", type: "TOR" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(520px, 100vw)",
        zIndex: 60,
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        backdropFilter: "blur(20px)",
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.3s ease-out",
        overflow: "hidden",
      }}
    >
      {/* Scanline overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${C.scanline} 2px, ${C.scanline} 4px)`,
          opacity: 0.3,
          zIndex: 1,
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>🔬</span>
            <div>
              <div
                style={{
                  fontFamily: C.mono,
                  fontSize: "12px",
                  fontWeight: 700,
                  color: C.textPrimary,
                  letterSpacing: "0.08em",
                }}
              >
                INDICATOR MICROSCOPE
              </div>
              <div
                style={{
                  fontFamily: C.mono,
                  fontSize: "9px",
                  color: C.textSecondary,
                  letterSpacing: "0.06em",
                }}
              >
                IOC ENRICHMENT · MULTI-SOURCE ANALYSIS
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: "4px",
              color: C.textSecondary,
              fontFamily: C.mono,
              fontSize: "10px",
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            ESC ✕
          </button>
        </div>

        {/* Search bar */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginTop: "10px",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              background: "rgba(0, 180, 255, 0.04)",
              border: `1px solid ${indicator ? C.borderBright : C.border}`,
              borderRadius: "4px",
              padding: "0 10px",
              transition: "border-color 0.2s",
            }}
          >
            <span style={{ color: C.textSecondary, fontSize: "12px", marginRight: "6px" }}>⌕</span>
            <input
              ref={inputRef}
              value={indicator}
              onChange={(e) => setIndicator(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="IP, domain, hash, URL, or CVE..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontFamily: C.mono,
                fontSize: "11px",
                color: C.textPrimary,
                padding: "8px 0",
              }}
            />
            {indicator && (
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: "8px",
                  color: C.textSecondary,
                  background: C.accentDim,
                  padding: "2px 6px",
                  borderRadius: "3px",
                  textTransform: "uppercase",
                }}
              >
                {result?.ioc_type || "—"}
              </span>
            )}
          </div>
          <button
            onClick={() => enrich()}
            disabled={loading || !indicator.trim()}
            style={{
              background: loading ? C.accentDim : C.accent,
              border: "none",
              borderRadius: "4px",
              color: loading ? C.textSecondary : "#000",
              fontFamily: C.mono,
              fontSize: "10px",
              fontWeight: 700,
              padding: "8px 14px",
              cursor: loading ? "wait" : "pointer",
              letterSpacing: "0.06em",
              opacity: !indicator.trim() ? 0.4 : 1,
            }}
          >
            {loading ? "⏳" : "ENRICH"}
          </button>
        </div>

        {/* Quick lookups */}
        <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
          {quickLookups.map((q) => (
            <button
              key={q.label}
              onClick={() => {
                setIndicator(q.label);
                enrich(q.label);
              }}
              style={{
                background: C.accentDim,
                border: `1px solid ${C.border}`,
                borderRadius: "3px",
                color: C.textSecondary,
                fontFamily: C.mono,
                fontSize: "8px",
                padding: "2px 6px",
                cursor: "pointer",
              }}
            >
              {q.label}
              <span style={{ color: C.textAccent, marginLeft: "3px" }}>{q.type}</span>
            </button>
          ))}
          {/* API health indicators */}
          <div style={{ marginLeft: "auto", display: "flex", gap: "3px", alignItems: "center" }}>
            {["otx", "abuseipdb", "virustotal", "urlhaus", "threatfox"].map((src) => (
              <div
                key={src}
                title={`${src}: ${apiHealth[src] ? "configured" : "not configured"}`}
                style={{
                  width: "4px",
                  height: "4px",
                  borderRadius: "50%",
                  background: apiHealth[src] ? C.success : "#444",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
          zIndex: 2,
        }}
      >
        {(["microscope", "sources", "timeline"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              background: activeTab === tab ? C.accentDim : "transparent",
              border: "none",
              borderBottom: activeTab === tab ? `2px solid ${C.accent}` : "2px solid transparent",
              color: activeTab === tab ? C.textAccent : C.textSecondary,
              fontFamily: C.mono,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "8px",
              cursor: "pointer",
            }}
          >
            {tab === "microscope" ? "🔬 GRAPH" : tab === "sources" ? "📡 SOURCES" : "⏱ TIMELINE"}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
          zIndex: 2,
        }}
      >
        {error && (
          <div
            style={{
              margin: "12px",
              padding: "8px 12px",
              background: `${C.danger}10`,
              border: `1px solid ${C.danger}30`,
              borderRadius: "4px",
              fontFamily: C.mono,
              fontSize: "10px",
              color: C.danger,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {/* ── Microscope Tab ── */}
        {activeTab === "microscope" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: "460px", padding: "8px" }}>
              <RadialGraph data={result} loading={loading} />
            </div>
            {result && (
              <div style={{ padding: "0 12px 12px" }}>
                {/* Aggregate score bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    background: C.surface,
                    borderRadius: "4px",
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <ScoreBadge score={result.aggregate_score} label="THREAT" />
                  <div
                    style={{
                      flex: 1,
                      height: "4px",
                      background: "#1a1a2e",
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${result.aggregate_score}%`,
                        height: "100%",
                        background:
                          result.aggregate_score >= 70
                            ? C.danger
                            : result.aggregate_score >= 40
                            ? C.warning
                            : C.success,
                        borderRadius: "2px",
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                  <span style={{ fontFamily: C.mono, fontSize: "9px", color: C.textSecondary }}>
                    {result.ioc_type.toUpperCase()} · {Object.values(result.sources).filter((s) => s.data).length}/5
                    sources
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Sources Tab ── */}
        {activeTab === "sources" && (
          <div style={{ padding: "12px" }}>
            {!result && !loading && (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  fontFamily: C.mono,
                  fontSize: "10px",
                  color: C.textSecondary,
                }}
              >
                Enter an indicator and click ENRICH to see source results
              </div>
            )}

            {loading && (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  fontFamily: C.mono,
                  fontSize: "11px",
                  color: C.accent,
                }}
              >
                Querying 5 sources in parallel...
              </div>
            )}

            {result && (
              <>
                {/* AbuseIPDB */}
                <SourceCard
                  title="AbuseIPDB"
                  icon="🛡"
                  status={
                    result.sources.abuseipdb?.error
                      ? "error"
                      : result.sources.abuseipdb?.data
                      ? "ok"
                      : "empty"
                  }
                >
                  {result.sources.abuseipdb?.error ? (
                    <span style={{ color: C.danger }}>{result.sources.abuseipdb.error}</span>
                  ) : result.sources.abuseipdb?.data ? (
                    <div>
                      <div style={{ display: "flex", gap: "12px", marginBottom: "4px" }}>
                        <ScoreBadge
                          score={result.sources.abuseipdb.data.abuse_confidence_score}
                          label="ABUSE"
                        />
                        <span>
                          {result.sources.abuseipdb.data.total_reports} reports ·{" "}
                          {result.sources.abuseipdb.data.num_distinct_users} reporters
                        </span>
                      </div>
                      <div>
                        ISP: {result.sources.abuseipdb.data.isp || "—"} ·{" "}
                        {result.sources.abuseipdb.data.country_name || "—"}
                        {result.sources.abuseipdb.data.is_tor && (
                          <span style={{ color: C.warning, marginLeft: "6px" }}>⚡ TOR EXIT</span>
                        )}
                      </div>
                      <div>Usage: {result.sources.abuseipdb.data.usage_type || "—"}</div>
                    </div>
                  ) : (
                    <span>IP addresses only</span>
                  )}
                </SourceCard>

                {/* VirusTotal */}
                <SourceCard
                  title="VirusTotal"
                  icon="🦠"
                  status={
                    result.sources.virustotal?.error
                      ? "error"
                      : result.sources.virustotal?.data
                      ? "ok"
                      : "empty"
                  }
                >
                  {result.sources.virustotal?.error ? (
                    <span style={{ color: C.danger }}>{result.sources.virustotal.error}</span>
                  ) : result.sources.virustotal?.data ? (
                    <div>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                        <span style={{ color: C.danger }}>
                          ✗ {result.sources.virustotal.data.malicious} malicious
                        </span>
                        <span style={{ color: C.warning }}>
                          ⚠ {result.sources.virustotal.data.suspicious} suspicious
                        </span>
                        <span style={{ color: C.success }}>
                          ✓ {result.sources.virustotal.data.harmless} clean
                        </span>
                        <span>/ {result.sources.virustotal.data.total_engines} engines</span>
                      </div>
                      {result.sources.virustotal.data.as_owner && (
                        <div>
                          AS: {result.sources.virustotal.data.as_owner} ·{" "}
                          {result.sources.virustotal.data.network || "—"}
                        </div>
                      )}
                      {result.sources.virustotal.data.popular_threat_name && (
                        <div style={{ color: C.danger }}>
                          Threat: {result.sources.virustotal.data.popular_threat_name}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span>No data</span>
                  )}
                </SourceCard>

                {/* AlienVault OTX */}
                <SourceCard
                  title="AlienVault OTX"
                  icon="👽"
                  status={
                    result.sources.otx?.error
                      ? "error"
                      : result.sources.otx?.data
                      ? "ok"
                      : "empty"
                  }
                >
                  {result.sources.otx?.error ? (
                    <span style={{ color: C.danger }}>{result.sources.otx.error}</span>
                  ) : result.sources.otx?.data ? (
                    <div>
                      <div style={{ marginBottom: "4px" }}>
                        Reputation: {result.sources.otx.data.reputation} · Pulses:{" "}
                        {result.sources.otx.data.pulse_count} · PDNS:{" "}
                        {result.sources.otx.data.passive_dns?.length || 0} records
                      </div>
                      {result.sources.otx.data.asn && <div>ASN: {result.sources.otx.data.asn}</div>}
                      {result.sources.otx.data.country && (
                        <div>
                          Geo: {result.sources.otx.data.city || "—"}, {result.sources.otx.data.country}
                        </div>
                      )}
                      {result.sources.otx.data.pulses?.length > 0 && (
                        <div style={{ marginTop: "6px" }}>
                          <div
                            style={{
                              fontSize: "8px",
                              fontWeight: 700,
                              color: C.warning,
                              marginBottom: "3px",
                              textTransform: "uppercase",
                            }}
                          >
                            Linked Pulses:
                          </div>
                          {result.sources.otx.data.pulses.slice(0, 4).map((p: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                padding: "3px 0",
                                borderBottom: `1px solid ${C.border}`,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {p.adversary && (
                                <span style={{ color: C.danger, marginRight: "4px" }}>
                                  [{p.adversary}]
                                </span>
                              )}
                              <span style={{ color: C.textPrimary }}>{p.name}</span>
                              {p.tags?.length > 0 && (
                                <span style={{ color: C.textSecondary, marginLeft: "4px" }}>
                                  ({p.tags.slice(0, 3).join(", ")})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {result.sources.otx.data.passive_dns?.length > 0 && (
                        <div style={{ marginTop: "6px" }}>
                          <div
                            style={{
                              fontSize: "8px",
                              fontWeight: 700,
                              color: "#8b5cf6",
                              marginBottom: "3px",
                              textTransform: "uppercase",
                            }}
                          >
                            Passive DNS:
                          </div>
                          {result.sources.otx.data.passive_dns.slice(0, 5).map((d: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                fontSize: "9px",
                                padding: "2px 0",
                                borderBottom: `1px solid ${C.border}`,
                              }}
                            >
                              <span style={{ color: C.textPrimary }}>{d.hostname || d.address}</span>
                              <span style={{ color: C.textSecondary, marginLeft: "4px" }}>
                                {d.record_type} · {d.first?.substring(0, 10)}–
                                {d.last?.substring(0, 10)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span>No data</span>
                  )}
                </SourceCard>

                {/* URLhaus */}
                <SourceCard
                  title="URLhaus"
                  icon="🔗"
                  status={
                    result.sources.urlhaus?.error
                      ? "error"
                      : result.sources.urlhaus?.data?.found
                      ? "ok"
                      : "empty"
                  }
                >
                  {result.sources.urlhaus?.error ? (
                    <span style={{ color: C.danger }}>{result.sources.urlhaus.error}</span>
                  ) : result.sources.urlhaus?.data?.found ? (
                    <div>
                      <div style={{ color: C.danger, marginBottom: "4px" }}>
                        ⚠ Found in URLhaus — {result.sources.urlhaus.data.url_count || "?"} malware URLs
                      </div>
                      {result.sources.urlhaus.data.urls?.slice(0, 3).map((u: any, i: number) => (
                        <div
                          key={i}
                          style={{
                            padding: "3px 0",
                            borderBottom: `1px solid ${C.border}`,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ color: u.status === "online" ? C.danger : C.textSecondary }}>
                            [{u.status}]
                          </span>{" "}
                          {u.threat || "malware"} · {u.date_added?.substring(0, 10)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: C.success }}>Not found in URLhaus ✓</span>
                  )}
                </SourceCard>

                {/* ThreatFox */}
                <SourceCard
                  title="ThreatFox"
                  icon="🦊"
                  status={
                    result.sources.threatfox?.error
                      ? "error"
                      : result.sources.threatfox?.data?.found
                      ? "ok"
                      : "empty"
                  }
                >
                  {result.sources.threatfox?.error ? (
                    <span style={{ color: C.danger }}>{result.sources.threatfox.error}</span>
                  ) : result.sources.threatfox?.data?.found ? (
                    <div>
                      <div style={{ color: C.danger, marginBottom: "4px" }}>
                        ⚠ {result.sources.threatfox.data.ioc_count} IOC matches
                      </div>
                      {result.sources.threatfox.data.iocs?.slice(0, 4).map((ioc: any, i: number) => (
                        <div
                          key={i}
                          style={{
                            padding: "3px 0",
                            borderBottom: `1px solid ${C.border}`,
                          }}
                        >
                          <span style={{ color: C.danger, fontWeight: 700 }}>{ioc.malware}</span>
                          <span style={{ marginLeft: "4px" }}>
                            [{ioc.threat_type}] conf:{ioc.confidence_level}%
                          </span>
                          <div style={{ fontSize: "8px", color: C.textSecondary }}>
                            First: {ioc.first_seen?.substring(0, 10)} · Reporter: {ioc.reporter}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: C.success }}>Not found in ThreatFox ✓</span>
                  )}
                </SourceCard>
              </>
            )}
          </div>
        )}

        {/* ── Timeline Tab ── */}
        {activeTab === "timeline" && (
          <div style={{ padding: "12px" }}>
            {!result ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  fontFamily: C.mono,
                  fontSize: "10px",
                  color: C.textSecondary,
                }}
              >
                Enrich an indicator to see its temporal history
              </div>
            ) : result.timeline.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  fontFamily: C.mono,
                  fontSize: "10px",
                  color: C.textSecondary,
                }}
              >
                No timeline events found for this indicator
              </div>
            ) : (
              <>
                <Timeline entries={result.timeline} />
                <div
                  style={{
                    marginTop: "12px",
                    padding: "8px 10px",
                    background: C.surface,
                    borderRadius: "4px",
                    border: `1px solid ${C.border}`,
                    fontFamily: C.mono,
                    fontSize: "9px",
                    color: C.textSecondary,
                  }}
                >
                  {result.timeline.length} events from{" "}
                  {new Set(result.timeline.map((t) => t.source)).size} sources · Earliest:{" "}
                  {result.timeline[result.timeline.length - 1]?.date?.substring(0, 10) || "—"} · Latest:{" "}
                  {result.timeline[0]?.date?.substring(0, 10) || "—"}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: `1px solid ${C.border}`,
          fontFamily: C.mono,
          fontSize: "8px",
          color: C.textSecondary,
          display: "flex",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 2,
        }}
      >
        <span>
          Sources: OTX · AbuseIPDB · VirusTotal · URLhaus · ThreatFox
        </span>
        <span>{result ? `Queried: ${result.queried_at?.substring(11, 19)} UTC` : "Ready"}</span>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default IOCEnrichmentPanel;
