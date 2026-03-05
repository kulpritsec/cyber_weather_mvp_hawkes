#!/bin/bash
# ═══════════════════════════════════════════════════════════
# PATCH: Add ALCHEMY API status to Feed Status panel
# ═══════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
PANEL="$APP_DIR/frontend/src/components/Panels/FeedStatusPanel.jsx"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

[ -f "$PANEL" ] || fail "FeedStatusPanel.jsx not found"

# Backup
cp "$PANEL" "$PANEL.bak"

# Write the updated component
cat > "$PANEL" << 'COMPONENT_EOF'
import { useState, useEffect, useCallback } from "react";

const C = {
  bg: "rgba(2,8,16,0.98)",
  panel: "rgba(8,18,38,0.95)",
  border: "rgba(0,180,255,0.15)",
  borderLit: "rgba(0,180,255,0.3)",
  textPrimary: "#e0eaf8",
  textDim: "#5a7da8",
  textAccent: "#00ccff",
  textBright: "#f0f6ff",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
};

const MONO = "'JetBrains Mono', monospace";

const FEED_DEFS = {
  dshield: {
    name: "SANS DShield",
    desc: "Distributed sensor network — port scan & brute force telemetry",
    vectors: ["ssh"],
    color: "#00e5ff",
    icon: "🛡️",
  },
  abusech_threatfox: {
    name: "Abuse.ch ThreatFox",
    desc: "IOC sharing — malware, botnet C2, ransomware indicators",
    vectors: ["malware", "botnet_c2", "ransomware"],
    color: "#fbbf24",
    icon: "🦊",
  },
  abusech_feodo: {
    name: "Abuse.ch Feodo Tracker",
    desc: "Botnet C2 server tracking — Dridex, Emotet, TrickBot, QakBot",
    vectors: ["botnet_c2"],
    color: "#ea80fc",
    icon: "🎯",
  },
  greynoise: {
    name: "GreyNoise Community",
    desc: "Internet-wide scan & attack telemetry — IP classification",
    vectors: ["ssh", "rdp", "http"],
    color: "#a3e635",
    icon: "📡",
  },
  synthetic: {
    name: "Synthetic Seed",
    desc: "ML-generated baseline data for model initialization",
    vectors: ["ssh", "rdp", "http", "dns_amp"],
    color: "#6b7280",
    icon: "🧪",
  },
};

function feedStatus(minsSinceLast) {
  if (minsSinceLast === null || minsSinceLast === undefined) return { label: "NO DATA", color: C.textDim, bg: "rgba(107,114,128,0.1)" };
  if (minsSinceLast <= 20) return { label: "ACTIVE", color: C.green, bg: "rgba(34,197,94,0.1)" };
  if (minsSinceLast <= 60) return { label: "OK", color: C.yellow, bg: "rgba(234,179,8,0.1)" };
  if (minsSinceLast <= 180) return { label: "DELAYED", color: C.orange, bg: "rgba(249,115,22,0.1)" };
  return { label: "STALE", color: C.red, bg: "rgba(239,68,68,0.1)" };
}

function formatAgo(mins) {
  if (mins === null || mins === undefined) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }) +
      " " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return "—"; }
}

export default function FeedStatusPanel({ onClose }) {
  const [pipeline, setPipeline] = useState(null);
  const [feedStats, setFeedStats] = useState(null);
  const [alchemyHealth, setAlchemyHealth] = useState(null);
  const [alchemyError, setAlchemyError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    const baseUrl = import.meta.env.VITE_API_BASE ?? "";
    try {
      const pipeRes = await fetch(`${baseUrl}/v1/pipeline/status`);
      if (pipeRes.ok) setPipeline(await pipeRes.json());

      try {
        const feedRes = await fetch(`${baseUrl}/v1/feeds/status`);
        if (feedRes.ok) setFeedStats(await feedRes.json());
      } catch {}

      // ALCHEMY health
      try {
        const alchRes = await fetch(`/alchemy/health`);
        if (alchRes.ok) {
          setAlchemyHealth(await alchRes.json());
          setAlchemyError(false);
        } else {
          setAlchemyError(true);
        }
      } catch {
        setAlchemyError(true);
      }

      setLastRefresh(new Date());
      setLoading(false);
      setError(null);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  const feeds = Object.entries(FEED_DEFS).map(([key, def]) => {
    const dbStats = feedStats?.sources?.[key];
    return {
      key, ...def,
      total: dbStats?.total_events || null,
      lastEvent: dbStats?.last_event || null,
      minsSince: dbStats?.mins_since_last || null,
      events24h: dbStats?.events_24h || null,
    };
  });

  const pipelineOk = pipeline?.scheduler_running && !pipeline?.ingest?.is_stale;

  return (
    <div style={{
      position: "fixed", top: "60px", left: "50%", transform: "translateX(-50%)",
      zIndex: 40, width: "90vw", maxWidth: "720px", maxHeight: "calc(100vh - 80px)",
      overflowY: "auto", borderRadius: "10px",
      background: C.bg, border: `1px solid ${C.borderLit}`,
      boxShadow: "0 12px 60px rgba(0,0,0,0.7), 0 0 40px rgba(0,140,255,0.08)",
      backdropFilter: "blur(20px)",
      fontFamily: MONO, color: C.textPrimary,
      animation: "panelSlideIn 0.25s ease-out",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 51, padding: "14px 20px",
        background: "linear-gradient(180deg, rgba(2,8,16,0.99) 0%, rgba(2,8,16,0.95) 100%)",
        borderBottom: `1px solid ${C.border}`, borderRadius: "10px 10px 0 0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 800, color: C.textBright, letterSpacing: "0.06em" }}>
            CTI FEED STATUS
          </div>
          <div style={{ fontSize: "9px", color: C.textDim, marginTop: "2px" }}>
            Real-time ingestion health · {lastRefresh ? `Updated ${formatTime(lastRefresh.toISOString())}` : "Loading..."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={fetchData} style={{
            padding: "5px 10px", borderRadius: "4px", cursor: "pointer",
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textDim, fontFamily: MONO, fontSize: "10px",
          }}>↻ REFRESH</button>
          {onClose && (
            <button onClick={onClose} style={{
              padding: "5px 10px", borderRadius: "4px", cursor: "pointer",
              background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`,
              color: C.textDim, fontFamily: MONO, fontSize: "12px", fontWeight: 700,
            }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 20px" }}>

        {/* ── PIPELINE HEALTH ── */}
        {pipeline && (
          <div style={{
            marginBottom: "16px", padding: "12px 16px", borderRadius: "8px",
            background: pipelineOk ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
            border: `1px solid ${pipelineOk ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: pipelineOk ? C.green : C.red,
                boxShadow: `0 0 8px ${pipelineOk ? C.green : C.red}`,
                animation: "pulse-dot 2s ease-in-out infinite",
              }} />
              <span style={{ fontSize: "10px", fontWeight: 700, color: pipelineOk ? C.green : C.red, letterSpacing: "0.1em" }}>
                PIPELINE {pipelineOk ? "OPERATIONAL" : "DEGRADED"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <div style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "4px" }}>INGEST</div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: C.textAccent }}>{pipeline.ingest.total_runs}</div>
                <div style={{ fontSize: "8px", color: C.textDim }}>runs · {formatAgo(pipeline.ingest.minutes_since_last_run)}</div>
                <div style={{ fontSize: "8px", color: C.textDim, marginTop: "2px" }}>{pipeline.ingest.last_events} events last run</div>
              </div>
              <div style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "4px" }}>HAWKES FITTING</div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: C.textAccent }}>{pipeline.fitting.total_runs}</div>
                <div style={{ fontSize: "8px", color: C.textDim }}>runs · {formatAgo(pipeline.fitting.minutes_since_last_run)}</div>
                <div style={{ fontSize: "8px", color: C.textDim, marginTop: "2px" }}>{pipeline.fitting.last_cells_fitted} cells fitted</div>
              </div>
              <div style={{ padding: "8px 10px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "4px" }}>ADVISORIES</div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: C.textAccent }}>{pipeline.advisory.total_runs}</div>
                <div style={{ fontSize: "8px", color: C.textDim }}>runs</div>
                <div style={{ fontSize: "8px", color: C.textDim, marginTop: "2px" }}>{pipeline.advisory.last_count} active</div>
              </div>
            </div>
          </div>
        )}

        {/* ── MITRE ALCHEMY API ── */}
        <div style={{
          marginBottom: "16px", padding: "12px 16px", borderRadius: "8px",
          background: !alchemyError ? "rgba(168,85,247,0.04)" : "rgba(239,68,68,0.04)",
          border: `1px solid ${!alchemyError ? "rgba(168,85,247,0.2)" : "rgba(239,68,68,0.2)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "14px" }}>🧪</span>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: C.textBright, letterSpacing: "0.04em" }}>
                  MITRE ALCHEMY API
                </div>
                <div style={{ fontSize: "8px", color: C.textDim, marginTop: "1px" }}>
                  Adversary molecular structure analysis · ATT&CK + D3FEND
                </div>
              </div>
            </div>
            <div style={{
              padding: "3px 10px", borderRadius: "4px",
              background: !alchemyError ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              border: `1px solid ${!alchemyError ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            }}>
              <div style={{
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                color: !alchemyError ? C.green : C.red,
              }}>
                {!alchemyError ? "ONLINE" : "OFFLINE"}
              </div>
            </div>
          </div>

          {alchemyHealth && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px",
              paddingTop: "8px", borderTop: `1px solid ${C.border}`,
            }}>
              <div style={{ padding: "6px 8px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "3px" }}>GROUPS</div>
                <div style={{ fontSize: "14px", fontWeight: 800, color: C.purple }}>{alchemyHealth.groups_loaded || 0}</div>
              </div>
              <div style={{ padding: "6px 8px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "3px" }}>ATT&CK DATA</div>
                <div style={{ fontSize: "14px", fontWeight: 800, color: alchemyHealth.attack_data ? C.green : C.red }}>
                  {alchemyHealth.attack_data ? "LOADED" : "MISSING"}
                </div>
              </div>
              <div style={{ padding: "6px 8px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "3px" }}>VERSION</div>
                <div style={{ fontSize: "14px", fontWeight: 800, color: C.textAccent }}>{alchemyHealth.version || "—"}</div>
              </div>
            </div>
          )}

          {alchemyError && (
            <div style={{ fontSize: "8px", color: C.red, paddingTop: "6px", borderTop: `1px solid ${C.border}` }}>
              ALCHEMY API unreachable at /alchemy/health — check container status
            </div>
          )}
        </div>

        {/* ── CTI FEEDS ── */}
        <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.12em", marginBottom: "10px" }}>
          CTI DATA SOURCES
        </div>

        {feeds.map((feed) => {
          const status = feedStatus(feed.minsSince);
          const isLive = feed.minsSince !== null && feed.minsSince <= 20;
          const isGreynoise = feed.key === "greynoise";

          return (
            <div key={feed.key} style={{
              marginBottom: "8px", padding: "12px 16px", borderRadius: "8px",
              background: C.panel, border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px" }}>{feed.icon}</span>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.textBright, letterSpacing: "0.04em" }}>
                      {feed.name}
                    </div>
                    <div style={{ fontSize: "8px", color: C.textDim, marginTop: "1px" }}>
                      {feed.desc}
                    </div>
                  </div>
                </div>
                <div style={{
                  padding: "3px 10px", borderRadius: "4px",
                  background: isGreynoise ? "rgba(249,115,22,0.1)" : status.bg,
                  border: `1px solid ${isGreynoise ? "rgba(249,115,22,0.3)" : status.color + "40"}`,
                }}>
                  <div style={{
                    fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                    color: isGreynoise ? C.orange : status.color,
                  }}>
                    {isGreynoise ? "RATE LIMITED" : status.label}
                  </div>
                </div>
              </div>

              <div style={{
                display: "flex", gap: "16px", paddingTop: "6px",
                borderTop: `1px solid ${C.border}`,
              }}>
                <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <span style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>VECTORS</span>
                  {feed.vectors.map((v) => (
                    <span key={v} style={{
                      padding: "1px 5px", borderRadius: "3px",
                      background: `${feed.color}12`, border: `1px solid ${feed.color}25`,
                      fontSize: "8px", color: feed.color, textTransform: "uppercase",
                    }}>{v}</span>
                  ))}
                </div>
                {feed.total && (
                  <div>
                    <span style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>TOTAL </span>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: C.textAccent }}>{formatNumber(feed.total)}</span>
                  </div>
                )}
                {feed.events24h && (
                  <div>
                    <span style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>24H </span>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: C.textAccent }}>{formatNumber(feed.events24h)}</span>
                  </div>
                )}
                {feed.lastEvent && (
                  <div style={{ marginLeft: "auto" }}>
                    <span style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>LAST </span>
                    <span style={{ fontSize: "9px", color: isLive ? C.green : C.textDim }}>{formatAgo(feed.minsSince)}</span>
                  </div>
                )}
                {isGreynoise && !feed.total && (
                  <div style={{ marginLeft: "auto", fontSize: "8px", color: C.orange }}>
                    Community API — enrichment only
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ── DB TOTALS ── */}
        {pipeline && (
          <div style={{
            marginTop: "12px", padding: "10px 16px", borderRadius: "8px",
            background: "rgba(0,204,255,0.04)", border: `1px solid ${C.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.1em" }}>DATABASE</div>
            <div style={{ display: "flex", gap: "16px", fontSize: "9px" }}>
              <span style={{ color: C.textDim }}>
                Scheduler{" "}
                <span style={{ color: pipeline.scheduler_running ? C.green : C.red, fontWeight: 700 }}>
                  {pipeline.scheduler_running ? "RUNNING" : "STOPPED"}
                </span>
              </span>
              <span style={{ color: C.textDim }}>
                Ingest stale{" "}
                <span style={{ color: pipeline.ingest.is_stale ? C.red : C.green, fontWeight: 700 }}>
                  {pipeline.ingest.is_stale ? "YES" : "NO"}
                </span>
              </span>
              <span style={{ color: C.textDim }}>
                Errors{" "}
                <span style={{ color: (pipeline.ingest.last_errors?.length || 0) > 0 ? C.red : C.green, fontWeight: 700 }}>
                  {pipeline.ingest.last_errors?.length || 0}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes panelSlideIn { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
COMPONENT_EOF

ok "Updated FeedStatusPanel.jsx with ALCHEMY API status"
echo ""
echo "  Rebuild with:"
echo "    docker compose build --no-cache frontend && docker compose up -d frontend"
