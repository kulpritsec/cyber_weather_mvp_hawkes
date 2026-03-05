#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY: MITRE ALCHEMY integration with cyber-weather
# ═══════════════════════════════════════════════════════════════════════════════
#
# Adds ALCHEMY as a Docker service alongside the cyber-weather stack:
#   - Builds from /home/deploy/MITRE_ALCHEMY (already cloned)
#   - Downloads ATT&CK + D3FEND data on first run
#   - Runs on port 8001, proxied through Caddy at /alchemy/*
#   - 🧪 ALCHEMY button on globe header opens interactive panel
#
# Usage:
#   cd ~/cyber-weather/app
#   chmod +x deploy_alchemy.sh
#   ./deploy_alchemy.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
ALCHEMY_DIR="$HOME/MITRE_ALCHEMY"
GLOBE="$APP_DIR/frontend/src/components/CyberWeatherGlobe.tsx"
PANELS_DIR="$APP_DIR/frontend/src/components/Panels"
COMPOSE="$APP_DIR/docker-compose.yml"
CADDYFILE="/etc/caddy/Caddyfile"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MITRE ALCHEMY — INTEGRATION DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── PREFLIGHT ────────────────────────────────────────────────────────────
echo "▸ STEP 1: Preflight"

[ -d "$ALCHEMY_DIR" ] || fail "MITRE_ALCHEMY not found at $ALCHEMY_DIR — run: git clone https://github.com/kulpritsec/MITRE_ALCHEMY.git ~/MITRE_ALCHEMY"
[ -f "$GLOBE" ] || fail "CyberWeatherGlobe.tsx not found"
[ -f "$COMPOSE" ] || fail "docker-compose.yml not found"

ok "All paths verified"

# ─── BACKUP ───────────────────────────────────────────────────────────────
BACKUP_DIR="$APP_DIR/backups/$(date +%Y%m%d_%H%M%S)_alchemy"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
cp "$COMPOSE" "$BACKUP_DIR/docker-compose.yml.bak"
sudo cp "$CADDYFILE" "$BACKUP_DIR/Caddyfile.bak"
ok "Backed up to $BACKUP_DIR"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 1: FIX ALCHEMY REPO ISSUES
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 2: Fix ALCHEMY repo"

# Fix double comma in pyproject.toml
if grep -q '"scipy>=1.10",,' "$ALCHEMY_DIR/pyproject.toml"; then
    sed -i 's/"scipy>=1.10",,/"scipy>=1.10",/' "$ALCHEMY_DIR/pyproject.toml"
    ok "Fixed double comma in pyproject.toml"
else
    ok "pyproject.toml already clean"
fi

# Download ATT&CK data if not present
if [ -f "$ALCHEMY_DIR/data/attack-data/enterprise-attack.json" ]; then
    ok "ATT&CK data already downloaded"
else
    info "Downloading ATT&CK enterprise data..."
    mkdir -p "$ALCHEMY_DIR/data/attack-data"
    curl -sL "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json" \
        -o "$ALCHEMY_DIR/data/attack-data/enterprise-attack.json"
    if [ -f "$ALCHEMY_DIR/data/attack-data/enterprise-attack.json" ]; then
        SIZE=$(du -h "$ALCHEMY_DIR/data/attack-data/enterprise-attack.json" | cut -f1)
        ok "Downloaded ATT&CK data ($SIZE)"
    else
        warn "ATT&CK download failed — ALCHEMY will try on container startup"
    fi
fi

# Ensure D3FEND data directory exists
mkdir -p "$ALCHEMY_DIR/data/d3fend-data"
if [ ! -f "$ALCHEMY_DIR/data/d3fend-data/mappings.json" ]; then
    # Create minimal placeholder — ALCHEMY handles missing gracefully
    echo '{"mappings": []}' > "$ALCHEMY_DIR/data/d3fend-data/mappings.json"
    ok "Created D3FEND placeholder"
else
    ok "D3FEND data present"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 2: ADD ALCHEMY SERVICE TO DOCKER COMPOSE
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 3: Add alchemy service to docker-compose.yml"

if grep -q "alchemy:" "$COMPOSE"; then
    ok "Alchemy service already in docker-compose.yml"
else
    # Insert the alchemy service before the volumes: section
    sed -i '/^volumes:/i\
  alchemy:\
    build:\
      context: /home/deploy/MITRE_ALCHEMY\
      target: api\
    ports:\
      - "127.0.0.1:8001:8000"\
    environment:\
      ALCHEMY_LOG_LEVEL: INFO\
      ALCHEMY_CORS_ORIGINS: "https://weather.kulpritstudios.com"\
    restart: unless-stopped\
    healthcheck:\
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]\
      interval: 30s\
      timeout: 10s\
      retries: 3\
' "$COMPOSE"
    ok "Added alchemy service (port 8001)"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 3: PATCH CADDY
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 4: Patch Caddy config"

if sudo grep -q "alchemy" "$CADDYFILE"; then
    ok "Caddy already has alchemy routes"
else
    # Add alchemy routes before the default handle block
    sudo sed -i '/handle {/i\
    handle /alchemy/* {\
        uri strip_prefix /alchemy\
        reverse_proxy 127.0.0.1:8001\
    }\
\
    handle /alchemy {\
        reverse_proxy 127.0.0.1:8001\
    }' "$CADDYFILE"
    ok "Added /alchemy/* route to Caddy"

    info "Reloading Caddy..."
    sudo systemctl reload caddy
    ok "Caddy reloaded"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 4: FRONTEND — ALCHEMY PANEL COMPONENT
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 5: Create AlchemyPanel component"

cat > "$PANELS_DIR/AlchemyPanel.jsx" << 'PANEL_EOF'
import { useState, useEffect, useCallback, useRef } from "react";

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

const STRUCTURE_COLORS = {
  Linear: "#22c55e",
  Branched: "#f97316",
  Cyclic: "#a855f7",
  Aromatic: "#ef4444",
};

function formatPct(n) { return `${Math.round(n * 100)}%`; }

export default function AlchemyPanel({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [antidote, setAntidote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const svgRef = useRef(null);

  const base = "/alchemy";

  // Load groups list
  useEffect(() => {
    fetch(`${base}/groups`)
      .then(r => r.json())
      .then(d => setGroups(d.groups || []))
      .catch(() => setError("Failed to connect to ALCHEMY API"));
  }, []);

  // Analyze selected group
  const analyze = useCallback(async (name) => {
    setSelected(name);
    setLoading(true);
    setError(null);
    setTab("overview");
    try {
      const [transRes, graphRes, antidoteRes] = await Promise.allSettled([
        fetch(`${base}/transmute/${encodeURIComponent(name)}`).then(r => r.json()),
        fetch(`${base}/graph-data/${encodeURIComponent(name)}`).then(r => r.json()),
        fetch(`${base}/antidote/${encodeURIComponent(name)}`).then(r => r.json()),
      ]);
      if (transRes.status === "fulfilled") setResult(transRes.value);
      if (graphRes.status === "fulfilled") setGraphData(graphRes.value);
      if (antidoteRes.status === "fulfilled") setAntidote(antidoteRes.value);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  const filtered = groups.filter(g =>
    g.toLowerCase().includes(search.toLowerCase())
  );

  const structColor = result ? (STRUCTURE_COLORS[result.structure] || C.textAccent) : C.textAccent;

  return (
    <div style={{
      position: "fixed", top: "60px", left: "50%", transform: "translateX(-50%)",
      zIndex: 40, width: "94vw", maxWidth: "1100px", maxHeight: "calc(100vh - 80px)",
      overflowY: "auto", borderRadius: "10px",
      background: C.bg, border: `1px solid ${C.borderLit}`,
      boxShadow: "0 12px 60px rgba(0,0,0,0.7), 0 0 40px rgba(168,85,247,0.08)",
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
            🧪 MITRE ALCHEMY
          </div>
          <div style={{ fontSize: "9px", color: C.textDim, marginTop: "2px" }}>
            Quantitative Adversary Structure Analysis · Molecular Threat Visualization
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            padding: "5px 10px", borderRadius: "4px", cursor: "pointer",
            background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`,
            color: C.textDim, fontFamily: MONO, fontSize: "12px", fontWeight: 700,
          }}>✕</button>
        )}
      </div>

      <div style={{ display: "flex", minHeight: "500px" }}>
        {/* ── LEFT: Group Search ── */}
        <div style={{
          width: "240px", borderRight: `1px solid ${C.border}`,
          padding: "12px", overflowY: "auto", flexShrink: 0,
        }}>
          <input
            type="text" placeholder="Search groups..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: "6px",
              background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}`,
              color: C.textPrimary, fontFamily: MONO, fontSize: "10px",
              outline: "none", marginBottom: "8px", boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: "8px", color: C.textDim, marginBottom: "6px", letterSpacing: "0.1em" }}>
            {groups.length} GROUPS AVAILABLE
          </div>
          <div style={{ maxHeight: "420px", overflowY: "auto" }}>
            {filtered.slice(0, 50).map(g => (
              <button key={g} onClick={() => analyze(g)} style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 8px", marginBottom: "2px", borderRadius: "4px",
                background: selected === g ? "rgba(168,85,247,0.15)" : "transparent",
                border: selected === g ? "1px solid rgba(168,85,247,0.4)" : "1px solid transparent",
                color: selected === g ? C.purple : C.textDim,
                fontFamily: MONO, fontSize: "10px", cursor: "pointer",
                transition: "all 0.1s",
              }}>
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Analysis ── */}
        <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
          {!selected && !loading && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: C.textDim }}>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🧪</div>
              <div style={{ fontSize: "12px", letterSpacing: "0.06em" }}>
                Select a threat group to transmute
              </div>
              <div style={{ fontSize: "9px", marginTop: "4px" }}>
                Molecular structure · Stability metrics · Defense coverage
              </div>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: "center", padding: "60px", color: C.textAccent }}>
              <div style={{ fontSize: "14px", animation: "pulse-dot 1s infinite" }}>⚗️ Transmuting...</div>
            </div>
          )}

          {error && (
            <div style={{ padding: "12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", color: C.red, fontSize: "10px" }}>
              {error}
            </div>
          )}

          {result && !loading && (
            <>
              {/* Group header */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "16px", fontWeight: 800, color: C.textBright }}>{selected}</div>
                <div style={{ fontSize: "10px", color: C.textDim, marginTop: "2px" }}>
                  {result.formula || result.name}
                </div>
              </div>

              {/* Metric cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "16px" }}>
                <div style={{ padding: "10px 12px", borderRadius: "8px", background: `${structColor}08`, border: `1px solid ${structColor}30` }}>
                  <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em" }}>STRUCTURE</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: structColor, marginTop: "4px" }}>{result.structure}</div>
                </div>
                <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(0,204,255,0.04)", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em" }}>STABILITY</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: C.textAccent, marginTop: "4px" }}>{result.stability?.toFixed(3) || "—"}</div>
                </div>
                <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(0,204,255,0.04)", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em" }}>TECHNIQUES</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: C.textAccent, marginTop: "4px" }}>{result.technique_count || "—"}</div>
                </div>
                <div style={{ padding: "10px 12px", borderRadius: "8px", background: result.radioactive ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.04)", border: `1px solid ${result.radioactive ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.2)"}` }}>
                  <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.12em" }}>RADIOACTIVE</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: result.radioactive ? C.red : C.green, marginTop: "4px" }}>
                    {result.radioactive ? "☢️ YES" : "✓ NO"}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: "2px", marginBottom: "12px", borderBottom: `1px solid ${C.border}`, paddingBottom: "6px" }}>
                {[
                  { id: "overview", label: "OVERVIEW" },
                  { id: "techniques", label: "TECHNIQUES" },
                  { id: "defense", label: "DEFENSE" },
                  { id: "graph", label: "GRAPH DATA" },
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    padding: "5px 12px", fontSize: "9px", letterSpacing: "0.06em",
                    background: tab === t.id ? "rgba(168,85,247,0.15)" : "transparent",
                    border: "none", borderBottom: tab === t.id ? "2px solid #a855f7" : "2px solid transparent",
                    color: tab === t.id ? C.purple : C.textDim,
                    fontFamily: MONO, cursor: "pointer",
                  }}>{t.label}</button>
                ))}
              </div>

              {/* Tab content */}
              {tab === "overview" && (
                <div>
                  {/* CVEs */}
                  {result.cves && result.cves.length > 0 && (
                    <div style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>
                        LINKED CVEs ({result.cves.length})
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {result.cves.slice(0, 20).map(cve => (
                          <span key={cve} style={{
                            padding: "2px 6px", borderRadius: "3px", fontSize: "8px",
                            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                            color: C.red,
                          }}>{cve}</span>
                        ))}
                        {result.cves.length > 20 && (
                          <span style={{ fontSize: "8px", color: C.textDim }}>+{result.cves.length - 20} more</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Neutralization */}
                  {antidote && (
                    <div style={{
                      padding: "12px", borderRadius: "8px",
                      background: "rgba(34,197,94,0.04)", border: `1px solid rgba(34,197,94,0.2)`,
                    }}>
                      <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "8px" }}>
                        D3FEND NEUTRALIZATION
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ fontSize: "24px", fontWeight: 800, color: C.green }}>
                          {formatPct(antidote.neutralization_score || 0)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ height: "6px", borderRadius: "3px", background: "rgba(0,0,0,0.3)", overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: "3px",
                              background: `linear-gradient(90deg, ${C.green}, ${C.textAccent})`,
                              width: `${(antidote.neutralization_score || 0) * 100}%`,
                              transition: "width 0.5s",
                            }} />
                          </div>
                          <div style={{ fontSize: "8px", color: C.textDim, marginTop: "4px" }}>
                            {antidote.techniques_covered || 0} of {antidote.total_techniques || 0} techniques covered · {antidote.defenses_found || 0} defenses mapped
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Substituents / tactics breakdown */}
                  {result.substituents && result.substituents.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>
                        TACTIC CHAIN ({result.substituents.length} tactics)
                      </div>
                      {result.substituents.map((sub, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "4px 8px", borderBottom: `1px solid ${C.border}`,
                        }}>
                          <span style={{ fontSize: "10px", color: C.textDim, width: "20px" }}>{i + 1}</span>
                          <span style={{
                            padding: "2px 6px", borderRadius: "3px", fontSize: "8px",
                            background: `${C.purple}15`, border: `1px solid ${C.purple}30`,
                            color: C.purple, textTransform: "uppercase",
                          }}>{sub.tactic || sub.name}</span>
                          <span style={{ fontSize: "9px", color: C.textDim, marginLeft: "auto" }}>
                            {sub.technique_count || sub.techniques?.length || 0} techniques
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "techniques" && result.substituents && (
                <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                  {result.substituents.map((sub, i) => (
                    <div key={i} style={{ marginBottom: "12px" }}>
                      <div style={{
                        fontSize: "9px", fontWeight: 700, color: C.purple,
                        letterSpacing: "0.06em", marginBottom: "4px",
                        textTransform: "uppercase",
                      }}>
                        {sub.tactic || sub.name}
                      </div>
                      {(sub.techniques || []).map((tech, j) => (
                        <div key={j} style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "3px 8px", fontSize: "9px",
                          borderLeft: `2px solid ${tech.defended ? C.green : tech.radioactive ? C.red : C.border}`,
                          marginBottom: "2px",
                        }}>
                          <span style={{ color: C.textAccent, fontWeight: 600, width: "60px" }}>
                            {tech.id || tech.technique_id}
                          </span>
                          <span style={{ color: C.textPrimary, flex: 1 }}>{tech.name}</span>
                          {tech.radioactive && <span style={{ fontSize: "8px" }}>☢️</span>}
                          {tech.defended && <span style={{ color: C.green, fontSize: "8px" }}>🛡</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {tab === "defense" && antidote && (
                <div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "12px",
                  }}>
                    <div style={{ padding: "10px", borderRadius: "6px", background: "rgba(34,197,94,0.06)", border: `1px solid rgba(34,197,94,0.2)` }}>
                      <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>COVERED</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: C.green }}>{antidote.techniques_covered || 0}</div>
                    </div>
                    <div style={{ padding: "10px", borderRadius: "6px", background: "rgba(239,68,68,0.06)", border: `1px solid rgba(239,68,68,0.2)` }}>
                      <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>UNCOVERED</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: C.red }}>
                        {(antidote.total_techniques || 0) - (antidote.techniques_covered || 0)}
                      </div>
                    </div>
                    <div style={{ padding: "10px", borderRadius: "6px", background: "rgba(168,85,247,0.06)", border: `1px solid rgba(168,85,247,0.2)` }}>
                      <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em" }}>DEFENSES</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: C.purple }}>{antidote.defenses_found || 0}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "9px", color: C.textDim }}>
                    Defense coverage mapped via MITRE D3FEND countermeasures.
                    Green-bordered techniques in the Techniques tab have active defensive countermeasures.
                  </div>
                </div>
              )}

              {tab === "graph" && graphData && (
                <div>
                  <div style={{ fontSize: "8px", color: C.textDim, marginBottom: "8px", letterSpacing: "0.1em" }}>
                    GRAPH: {graphData.nodes?.length || 0} NODES · {graphData.links?.length || 0} EDGES · {graphData.tactics?.length || 0} TACTICS
                  </div>
                  <div style={{ fontSize: "9px", color: C.textDim, marginBottom: "8px" }}>
                    Open the full interactive visualization:
                  </div>
                  <a
                    href={`/alchemy/visualize/${encodeURIComponent(selected)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block", padding: "8px 16px", borderRadius: "6px",
                      background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)",
                      color: C.purple, fontFamily: MONO, fontSize: "11px", fontWeight: 700,
                      textDecoration: "none", letterSpacing: "0.04em",
                    }}
                  >
                    🔬 OPEN INTERACTIVE VISUALIZER →
                  </a>
                  {graphData.stats && (
                    <div style={{ marginTop: "12px", padding: "10px", borderRadius: "6px", background: "rgba(0,0,0,0.2)" }}>
                      <div style={{ fontSize: "8px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>GRAPH STATS</div>
                      {Object.entries(graphData.stats).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: "9px" }}>
                          <span style={{ color: C.textDim, textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</span>
                          <span style={{ color: C.textAccent, fontWeight: 600 }}>{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes panelSlideIn { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
PANEL_EOF

ok "Created AlchemyPanel.jsx"

# Update Panels/index.ts
INDEX="$PANELS_DIR/index.ts"
if ! grep -q "AlchemyPanel" "$INDEX" 2>/dev/null; then
    echo "" >> "$INDEX"
    echo "// MITRE ALCHEMY" >> "$INDEX"
    echo "export { default as AlchemyPanel } from './AlchemyPanel';" >> "$INDEX"
    ok "Added to Panels/index.ts"
else
    ok "Already in index.ts"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 5: WIRE INTO GLOBE
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 6: Wire into CyberWeatherGlobe.tsx"

# 6A: Import
if grep -q "AlchemyPanel" "$GLOBE"; then
    ok "Import already present"
else
    sed -i "s|FeedStatusPanel }|FeedStatusPanel, AlchemyPanel }|" "$GLOBE"
    ok "Added to barrel import"
fi

# 6B: State
if grep -q "showAlchemy" "$GLOBE"; then
    ok "State already present"
else
    ANCHOR=$(grep -n "const \[showFeedStatus," "$GLOBE" | head -1 | cut -d: -f1)
    if [ -z "$ANCHOR" ]; then
        ANCHOR=$(grep -n "const \[showReplay," "$GLOBE" | head -1 | cut -d: -f1)
    fi
    if [ -n "$ANCHOR" ]; then
        sed -i "${ANCHOR}a\\  const [showAlchemy, setShowAlchemy] = useState(false);" "$GLOBE"
        ok "Added state"
    else
        fail "Could not find state insertion point"
    fi
fi

# 6C: Button — after FEEDS button
if grep -q "ALCHEMY" "$GLOBE" && grep -q "setShowAlchemy" "$GLOBE"; then
    ok "Button already present"
else
    FEEDS_BTN=$(grep -n "FEEDS" "$GLOBE" | head -1 | cut -d: -f1)
    if [ -n "$FEEDS_BTN" ]; then
        CLOSE_BTN=$(awk "NR>$FEEDS_BTN && /<\/button>/{print NR; exit}" "$GLOBE")
        if [ -n "$CLOSE_BTN" ]; then
            sed -i "${CLOSE_BTN}a\\
\\
          {/* ─── ALCHEMY BUTTON ─── */}\\
          <button\\
            onClick={() => setShowAlchemy((v) => !v)}\\
            style={{\\
              display: \"flex\", flexDirection: \"column\", alignItems: \"center\",\\
              padding: \"6px 14px\", borderRadius: \"4px\",\\
              background: showAlchemy ? \"rgba(168,85,247,0.15)\" : \"rgba(168,85,247,0.05)\",\\
              border: \`1px solid \${showAlchemy ? \"rgba(168,85,247,0.5)\" : \"rgba(168,85,247,0.15)\"}\`,\\
              cursor: \"pointer\", transition: \"background 0.15s, border-color 0.15s\",\\
            }}\\
          >\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"9px\",\\
              color: \"rgba(168,85,247,0.6)\", letterSpacing: \"0.15em\", marginBottom: \"2px\",\\
            }}>\\
              MITRE\\
            </div>\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"13px\", fontWeight: 800,\\
              color: showAlchemy ? \"#a855f7\" : \"rgba(168,85,247,0.6)\", letterSpacing: \"0.08em\",\\
            }}>\\
              🧪 ALCHEMY\\
            </div>\\
          </button>" "$GLOBE"
            ok "Inserted button"
        fi
    fi
fi

# 6D: Panel render
if grep -q "showAlchemy &&" "$GLOBE"; then
    ok "Panel render already present"
else
    FEED_PANEL=$(grep -n "showFeedStatus &&" "$GLOBE" | tail -1 | cut -d: -f1)
    if [ -n "$FEED_PANEL" ]; then
        PANEL_CLOSE=$(awk "NR>$FEED_PANEL && /^[[:space:]]*\)}$/{print NR; exit}" "$GLOBE")
        if [ -n "$PANEL_CLOSE" ]; then
            sed -i "${PANEL_CLOSE}a\\
\\
      {/* ─── MITRE ALCHEMY ─── */}\\
      {showAlchemy && (\\
        <AlchemyPanel onClose={() => setShowAlchemy(false)} />\\
      )}" "$GLOBE"
            ok "Inserted panel render"
        fi
    else
        # Fallback: insert before ticker
        TICKER=$(grep -n "LIVE THREAT FEED TICKER" "$GLOBE" | head -1 | cut -d: -f1)
        if [ -n "$TICKER" ]; then
            sed -i "${TICKER}i\\
\\
      {/* ─── MITRE ALCHEMY ─── */}\\
      {showAlchemy && (\\
        <AlchemyPanel onClose={() => setShowAlchemy(false)} />\\
      )}" "$GLOBE"
            ok "Inserted panel render (before ticker)"
        fi
    fi
fi

# 6E: Escape handler
if grep -q "setShowAlchemy(false)" "$GLOBE"; then
    ok "Escape handler already patched"
else
    sed -i "s|setShowFeedStatus(false);|setShowFeedStatus(false); setShowAlchemy(false);|" "$GLOBE"
    ok "Added to Escape handler"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# VALIDATE
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ STEP 7: Validate"
ERRORS=0
grep -q "AlchemyPanel" "$GLOBE"              || { echo -e "  ${RED}✗${NC} Missing import"; ERRORS=$((ERRORS+1)); }
grep -q "showAlchemy" "$GLOBE"               || { echo -e "  ${RED}✗${NC} Missing state"; ERRORS=$((ERRORS+1)); }
grep -q "setShowAlchemy" "$GLOBE"            || { echo -e "  ${RED}✗${NC} Missing button"; ERRORS=$((ERRORS+1)); }
grep -q "alchemy:" "$COMPOSE"                || { echo -e "  ${RED}✗${NC} Missing compose service"; ERRORS=$((ERRORS+1)); }
sudo grep -q "alchemy" "$CADDYFILE"          || { echo -e "  ${RED}✗${NC} Missing Caddy route"; ERRORS=$((ERRORS+1)); }
[ -f "$PANELS_DIR/AlchemyPanel.jsx" ]        || { echo -e "  ${RED}✗${NC} Panel component missing"; ERRORS=$((ERRORS+1)); }
[ "$ERRORS" -gt 0 ] && fail "$ERRORS errors"
ok "All validated"

# Check for import corruption
if grep -q "import type.*AlchemyPanel" "$GLOBE"; then
    warn "AlchemyPanel found in type import — fixing..."
    sed -i "s|import type { ArcData, HotspotCellData.*|import type { ArcData, HotspotCellData } from './Panels';|" "$GLOBE"
    ok "Fixed type import"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# BUILD & DEPLOY
# ═══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════"
echo "  Ready to build"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  New service:  alchemy (port 8001)"
echo "  Caddy route:  /alchemy/* → 127.0.0.1:8001"
echo "  Globe button: 🧪 ALCHEMY"
echo ""
echo "  This builds THREE containers:"
echo "    • alchemy (new — MITRE ALCHEMY API)"
echo "    • frontend (patched — new panel + button)"
echo "    • backend (no changes, but compose up restarts)"
echo ""

read -p "  Build and deploy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$APP_DIR"
    info "Building alchemy + frontend..."
    docker compose build --no-cache alchemy frontend
    info "Deploying..."
    docker compose up -d
    echo ""

    # Wait for alchemy to start
    info "Waiting for ALCHEMY API..."
    for i in $(seq 1 15); do
        if curl -sf http://localhost:8001/health > /dev/null 2>&1; then
            ok "ALCHEMY API healthy"
            break
        fi
        sleep 2
    done

    # Test the endpoint
    GROUPS=$(curl -sf http://localhost:8001/groups 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "?")

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  🧪 ALCHEMY button in globe header"
    echo "  API:   https://weather.kulpritstudios.com/alchemy/groups"
    echo "  VIZ:   https://weather.kulpritstudios.com/alchemy/visualize/APT29"
    echo "  Docs:  https://weather.kulpritstudios.com/alchemy/docs"
    echo "  Groups loaded: $GROUPS"
    echo ""
    echo "  Rollback: cp $BACKUP_DIR/* back, sudo systemctl reload caddy"
    echo "═══════════════════════════════════════════════════════════"
else
    echo "  Skipped. Build manually with:"
    echo "    docker compose build --no-cache alchemy frontend && docker compose up -d"
fi
