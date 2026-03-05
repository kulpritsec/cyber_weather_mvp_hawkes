import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ─── DESIGN TOKENS — matches weather.kulpritstudios.com globe ──────────
const MONO = "'JetBrains Mono', 'Fira Code', monospace";
const API = "/alchemy";
const C = {
  bg: "rgba(2,8,16,0.97)",
  bgCard: "rgba(6,14,28,0.95)",
  bgDeep: "rgba(0,0,0,0.3)",
  border: "rgba(0,204,255,0.08)",
  borderLit: "rgba(0,204,255,0.25)",
  borderPurple: "rgba(168,85,247,0.4)",
  purple: "#a855f7",
  purpleDim: "rgba(168,85,247,0.6)",
  purpleGlow: "rgba(168,85,247,0.15)",
  cyan: "#00ccff",
  cyanDim: "rgba(0,204,255,0.6)",
  cyanGlow: "rgba(0,204,255,0.12)",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.5)",
  yellow: "#f59e0b",
  red: "#ef4444",
  neon: "#39ff14",
  text: "rgba(224,240,255,0.95)",
  textAccent: "rgba(0,204,255,0.9)",
  textDim: "rgba(140,180,220,0.5)",
  textMuted: "rgba(100,140,180,0.3)",
};

const STRUCT_COLORS = { AROMATIC: "#f59e0b", CYCLIC: "#22c55e", BRANCHED: "#3b82f6", LINEAR: "#6b7280" };

const TACTIC_COLORS = {
  "reconnaissance": "#8B5CF6", "resource-development": "#7C3AED",
  "initial-access": "#DC2626", "execution": "#EA580C",
  "persistence": "#D97706", "privilege-escalation": "#CA8A04",
  "defense-evasion": "#65A30D", "credential-access": "#16A34A",
  "discovery": "#0D9488", "lateral-movement": "#0891B2",
  "collection": "#2563EB", "command-and-control": "#4F46E5",
  "exfiltration": "#7C3AED", "impact": "#BE185D",
};

// ─── HELPERS ───────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ─── INLINE SVG MOLECULAR VISUALIZER ───────────────────────────────────
function MoleculeViz({ graphData, selected, width = 680, height = 440 }) {
  const [tooltip, setTooltip] = useState(null);
  const [zoom, setZoom] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef(null);

  // Deterministic chemical structure layout
  const layout = useMemo(() => {
    if (!graphData?.nodes?.length) return { nodes: [], links: [] };

    const tactics = graphData.nodes.filter(n => n.type === 'tactic');
    const techs = graphData.nodes.filter(n => n.type === 'technique');
    const rawLinks = graphData.links || [];
    const structType = graphData.stats?.structure_type || 'LINEAR';
    const cx = width / 2, cy = height / 2;
    const laid = {};

    if ((structType === 'CYCLIC' || structType === 'AROMATIC') && tactics.length >= 3) {
      // ── RING: even polygon like cyclohexane ──
      const ringR = Math.min(width, height) * 0.24;
      tactics.forEach((t, i) => {
        const angle = (i / tactics.length) * Math.PI * 2 - Math.PI / 2;
        laid[t.id] = { x: cx + Math.cos(angle) * ringR, y: cy + Math.sin(angle) * ringR };
      });
    } else {
      // ── LINEAR / BRANCHED: zigzag carbon chain ──
      const spacing = Math.min(110, (width - 100) / Math.max(tactics.length - 1, 1));
      const startX = cx - (tactics.length - 1) * spacing / 2;
      tactics.forEach((t, i) => {
        laid[t.id] = {
          x: startX + i * spacing,
          y: cy + (i % 2 === 0 ? -28 : 28), // classic zigzag
        };
      });
    }

    // Count children per parent for even fan distribution
    const childrenOf = {};
    rawLinks.forEach(l => {
      if (l.type !== 'substituent') return;
      const pid = typeof l.source === 'object' ? l.source.id : l.source;
      if (!childrenOf[pid]) childrenOf[pid] = [];
      const cid = typeof l.target === 'object' ? l.target.id : l.target;
      childrenOf[pid].push(cid);
    });

    // Place substituents radiating outward from their tactic
    techs.forEach(t => {
      const parentLink = rawLinks.find(l =>
        l.type === 'substituent' &&
        (typeof l.target === 'object' ? l.target.id : l.target) === t.id
      );
      if (!parentLink) { laid[t.id] = { x: cx, y: cy }; return; }
      const pid = typeof parentLink.source === 'object' ? parentLink.source.id : parentLink.source;
      const pPos = laid[pid];
      if (!pPos) { laid[t.id] = { x: cx, y: cy }; return; }

      const siblings = childrenOf[pid] || [];
      const idx = siblings.indexOf(t.id);
      const total = siblings.length;

      // Angle pointing AWAY from ring/chain center
      const outAngle = Math.atan2(pPos.y - cy, pPos.x - cx);
      // Fan spread based on how many substituents
      const arcSpan = Math.min(Math.PI * 1.0, total * 0.22);
      const baseAngle = outAngle - arcSpan / 2;
      const angle = total <= 1 ? outAngle : baseAngle + (idx / Math.max(total - 1, 1)) * arcSpan;

      // Tiered distance: first row close, overflow further out
      const tier = Math.floor(idx / 6);
      const dist = 38 + tier * 18;

      laid[t.id] = {
        x: pPos.x + Math.cos(angle) * dist,
        y: pPos.y + Math.sin(angle) * dist,
      };
    });

    const posNodes = graphData.nodes.map(n => ({ ...n, x: laid[n.id]?.x || cx, y: laid[n.id]?.y || cy }));
    const posLinks = rawLinks.map(l => ({
      ...l,
      srcId: typeof l.source === 'object' ? l.source.id : l.source,
      tgtId: typeof l.target === 'object' ? l.target.id : l.target,
    }));

    return { nodes: posNodes, links: posLinks };
  }, [graphData, width, height]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const s = e.deltaY > 0 ? 0.92 : 1.08;
    setZoom(z => ({ ...z, k: Math.max(0.25, Math.min(5, z.k * s)) }));
  }, []);
  const onPanStart = useCallback((e) => {
    if (e.target.closest('[data-node]')) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, zx: zoom.x, zy: zoom.y };
  }, [zoom]);
  const onPanMove = useCallback((e) => {
    if (!panRef.current) return;
    setZoom(z => ({ ...z, x: panRef.current.zx + (e.clientX - panRef.current.sx), y: panRef.current.zy + (e.clientY - panRef.current.sy) }));
  }, []);
  const onPanEnd = useCallback(() => { panRef.current = null; }, []);

  const { nodes, links } = layout;
  const nMap = {};
  nodes.forEach(n => { nMap[n.id] = n; });
  const isAromatic = graphData?.stats?.structure_type === 'AROMATIC';

  return (
    <div style={{ position: "relative", width, height, background: "rgba(0,0,0,0.12)", borderRadius: "8px", border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <svg width={width} height={height} onWheel={handleWheel} onMouseDown={onPanStart} onMouseMove={onPanMove} onMouseUp={onPanEnd} onMouseLeave={() => { onPanEnd(); setTooltip(null); }} style={{ cursor: panRef.current ? "grabbing" : "grab" }}>
        <defs>
          <filter id="gc"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="gn"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="gs"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <radialGradient id="vbg"><stop offset="0%" stopColor="rgba(168,85,247,0.03)"/><stop offset="100%" stopColor="transparent"/></radialGradient>
        </defs>
        <rect width={width} height={height} fill="url(#vbg)"/>

        <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
          {/* ── BONDS ── */}
          {links.map((l, i) => {
            const s = nMap[l.srcId], t = nMap[l.tgtId];
            if (!s || !t) return null;
            const bb = l.type === 'backbone';
            return <line key={`b${i}`} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={bb ? "rgba(0,204,255,0.4)" : "rgba(140,180,220,0.1)"} strokeWidth={bb ? 2.5 : 0.6} strokeLinecap="round"/>;
          })}

          {/* Double bonds for aromatic */}
          {isAromatic && links.filter(l => l.type === 'backbone').map((l, i) => {
            if (i % 2 !== 0) return null;
            const s = nMap[l.srcId], t = nMap[l.tgtId];
            if (!s || !t) return null;
            const dx = t.x - s.x, dy = t.y - s.y, len = Math.sqrt(dx*dx+dy*dy)||1;
            const nx = -dy/len * 5, ny = dx/len * 5;
            return <line key={`d${i}`} x1={s.x+nx} y1={s.y+ny} x2={t.x+nx} y2={t.y+ny} stroke="rgba(0,204,255,0.18)" strokeWidth="1.2" strokeDasharray="4,3"/>;
          })}

          {/* ── NODES ── */}
          {nodes.map(n => {
            if (n.type === 'tactic') {
              const col = n.color || C.cyan;
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} data-node="1">
                  <circle r="30" fill="none" stroke={col} strokeWidth="0.3" opacity="0.12">
                    <animate attributeName="r" values="26;34;26" dur="4s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.15;0.03;0.15" dur="4s" repeatCount="indefinite"/>
                  </circle>
                  <circle r="22" fill="rgba(2,8,16,0.88)" stroke={col} strokeWidth="1.8" filter="url(#gc)"/>
                  <text textAnchor="middle" dy="-3" fill={col} fontSize="7" fontWeight="700" fontFamily={MONO}>{n.label}</text>
                  <text textAnchor="middle" dy="8" fill={C.textDim} fontSize="5" fontFamily={MONO}>{n.sublabel}</text>
                </g>
              );
            }
            const color = n.radioactive ? C.neon : n.coverage === 'full' ? C.green : n.coverage === 'partial' ? C.yellow : C.red;
            const r = Math.min(2.5 + (n.potency||1) * 0.8, 6);
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} data-node="1"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.closest('svg').getBoundingClientRect();
                  setTooltip({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 6, node: n });
                }}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: "pointer" }}
              >
                {n.radioactive && (
                  <circle r={r+5} fill="none" stroke={C.neon} strokeWidth="0.4" opacity="0.25">
                    <animate attributeName="r" values={`${r+3};${r+7};${r+3}`} dur="1.5s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.3;0.06;0.3" dur="1.5s" repeatCount="indefinite"/>
                  </circle>
                )}
                <circle r={r} fill={color} fillOpacity="0.8" stroke={color} strokeWidth="0.4" filter={n.radioactive ? "url(#gn)" : "url(#gs)"}/>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute", left: Math.min(tooltip.x, width - 200), top: Math.max(tooltip.y, 8),
          padding: "7px 9px", borderRadius: "5px",
          background: "rgba(6,14,28,0.96)", border: `1px solid ${C.borderLit}`,
          boxShadow: "0 0 14px rgba(0,204,255,0.08)",
          fontSize: "8px", maxWidth: "210px", pointerEvents: "none", zIndex: 10,
        }}>
          <div style={{ fontSize: "9px", fontWeight: 700, color: C.cyan, marginBottom: "2px" }}>{tooltip.node.tech_name}</div>
          {tooltip.node.tech_id && <div style={{ color: C.textDim }}>{tooltip.node.tech_id}</div>}
          <div style={{ color: C.purpleDim, marginTop: "2px" }}>{tooltip.node.group_type} · ×{tooltip.node.potency}</div>
          {tooltip.node.radioactive && <div style={{ color: C.neon, marginTop: "3px" }}>☢️ RADIOACTIVE (KEV)</div>}
          {tooltip.node.defenses?.length > 0 ? (
            <div style={{ marginTop: "4px", paddingTop: "3px", borderTop: `1px solid ${C.border}` }}>
              <div style={{ color: C.green, fontWeight: 600, marginBottom: "2px" }}>🛡️ D3FEND ({tooltip.node.defense_count})</div>
              {tooltip.node.defenses.slice(0,3).map((d,i) => <div key={i} style={{ color: C.greenDim, padding: "1px 0" }}>· {d.name}</div>)}
            </div>
          ) : <div style={{ marginTop: "4px", color: C.red }}>⚠ No D3FEND coverage</div>}
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: "5px", right: "5px", padding: "5px 7px",
        background: "rgba(2,8,16,0.88)", borderRadius: "4px", border: `1px solid ${C.border}`,
        fontSize: "6.5px", color: C.textDim,
      }}>
        <div style={{ display: "flex", gap: "7px" }}>
          <span>◯ Tactic</span>
          <span style={{ color: C.green }}>● Defended</span>
          <span style={{ color: C.yellow }}>● Partial</span>
          <span style={{ color: C.red }}>● None</span>
          <span style={{ color: C.neon }}>● ☢ KEV</span>
        </div>
        <div style={{ marginTop: "2px" }}>Scroll zoom · Drag pan</div>
      </div>
    </div>
  );
}

// ─── METRIC BADGE ──────────────────────────────────────────────────────
function Badge({ label, value, color = C.textAccent, bg = C.cyanGlow }) {
  return (
    <div style={{ padding: "7px 9px", borderRadius: "6px", background: bg, border: `1px solid ${C.border}`, flex: 1, minWidth: "75px" }}>
      <div style={{ fontSize: "6.5px", color: C.textDim, letterSpacing: "0.12em", fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: "12px", fontWeight: 800, color, marginTop: "2px", fontFamily: MONO }}>{value}</div>
    </div>
  );
}

// ─── MAIN PANEL ────────────────────────────────────────────────────────
export default function AlchemyPanel({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [antidote, setAntidote] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [tab, setTab] = useState("molecule");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Compare
  const [compareMode, setCompareMode] = useState(false);
  const [compareSearch, setCompareSearch] = useState("");
  const [compareGroup, setCompareGroup] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Expansion toggles
  const [showCVEs, setShowCVEs] = useState(false);
  const [showCycles, setShowCycles] = useState(false);
  const [expandedDef, setExpandedDef] = useState(null);
  const [defenseView, setDefenseView] = useState("frt");

  useEffect(() => {
    fetchJSON(`${API}/groups`).then(d => setGroups(d.groups || [])).catch(() => setError("Failed to load groups"));
  }, []);

  const analyze = useCallback(async (g) => {
    setSelected(g); setResult(null); setMetrics(null); setAntidote(null); setGraphData(null);
    setTab("molecule"); setLoading(true); setError(null); setShowCVEs(false); setShowCycles(false); setExpandedDef(null);
    try {
      const [tx, met, ant, gd] = await Promise.all([
        fetchJSON(`${API}/transmute/${encodeURIComponent(g)}`),
        fetchJSON(`${API}/metrics/${encodeURIComponent(g)}`),
        fetchJSON(`${API}/antidote/${encodeURIComponent(g)}`).catch(() => null),
        fetchJSON(`${API}/graph-data/${encodeURIComponent(g)}`).catch(() => null),
      ]);
      setResult(tx); setMetrics(met); setAntidote(ant); setGraphData(gd);
    } catch (e) { setError(`Analysis failed: ${e.message}`); }
    finally { setLoading(false); }
  }, []);

  const runCompare = useCallback(async (g2) => {
    if (!selected || !g2) return;
    setCompareGroup(g2); setCompareLoading(true); setCompareResult(null);
    try {
      const data = await fetchJSON(`${API}/compare/${encodeURIComponent(selected)}/${encodeURIComponent(g2)}`);
      setCompareResult(data);
    } catch {
      try {
        const [r1, r2] = await Promise.all([
          fetchJSON(`${API}/transmute/${encodeURIComponent(selected)}`),
          fetchJSON(`${API}/transmute/${encodeURIComponent(g2)}`),
        ]);
        const s1 = new Set((r1.substituents||[]).map(s=>s.technique));
        const s2 = new Set((r2.substituents||[]).map(s=>s.technique));
        setCompareResult({
          group1: selected, group2: g2,
          stability_delta: (r2.stability||0)-(r1.stability||0),
          structure_change: { from: r1.structure, to: r2.structure, changed: r1.structure !== r2.structure },
          techniques_added: [...s2].filter(t=>!s1.has(t)),
          techniques_removed: [...s1].filter(t=>!s2.has(t)),
          backbone_delta: 0,
          group1_summary: { name: r1.name, structure: r1.structure, stability: r1.stability, techniques: r1.technique_count, radioactive: r1.radioactive },
          group2_summary: { name: r2.name, structure: r2.structure, stability: r2.stability, techniques: r2.technique_count, radioactive: r2.radioactive },
        });
      } catch { setError("Compare failed"); }
    } finally { setCompareLoading(false); }
  }, [selected]);

  const filtered = groups.filter(g => g.toLowerCase().includes(search.toLowerCase()));
  const compareFiltered = groups.filter(g => g !== selected && g.toLowerCase().includes(compareSearch.toLowerCase()));
  const structColor = result ? (STRUCT_COLORS[result.structure] || C.textDim) : C.textDim;
  const tacticGroups = {};
  if (result?.substituents) result.substituents.forEach(s => { const p = s.position||0; if (!tacticGroups[p]) tacticGroups[p]=[]; tacticGroups[p].push(s); });

  const TABS = [
    { id: "molecule", label: "🧬 MOLECULE" },
    { id: "overview", label: "📊 METRICS" },
    { id: "techniques", label: "⚡ TECHNIQUES" },
    { id: "defense", label: "🛡️ DEFENSE" },
    { id: "cycles", label: "🔄 CYCLES" },
    ...(compareMode ? [{ id: "compare", label: "⚖️ COMPARE" }] : []),
  ];

  return (
    <div style={{
      position: "fixed", bottom: "80px", left: "50%", transform: "translateX(-50%)",
      width: "min(1140px, 95vw)", maxHeight: "78vh",
      background: C.bg, border: `1px solid ${C.borderPurple}`,
      borderRadius: "12px", zIndex: 1000,
      fontFamily: MONO, color: C.text,
      display: "flex", flexDirection: "column",
      animation: "alcSlide 0.3s cubic-bezier(0.16,1,0.3,1)",
      backdropFilter: "blur(24px)",
      boxShadow: "0 0 80px rgba(168,85,247,0.08), 0 0 2px rgba(0,204,255,0.15)",
    }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px" }}>🧪</span>
          <span style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", color: C.purple }}>MITRE ALCHEMY</span>
          <span style={{ fontSize: "7px", color: C.textMuted, padding: "1px 5px", background: C.purpleGlow, borderRadius: "3px" }}>v0.3.0</span>
          {groups.length > 0 && <span style={{ fontSize: "7px", color: C.textDim }}>{groups.length} GROUPS</span>}
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button onClick={() => { setCompareMode(!compareMode); setCompareResult(null); }} style={{
            padding: "3px 8px", fontSize: "7px", letterSpacing: "0.1em", fontFamily: MONO,
            background: compareMode ? C.purpleGlow : "transparent", border: `1px solid ${compareMode ? C.purple : C.border}`,
            color: compareMode ? C.purple : C.textDim, borderRadius: "3px", cursor: "pointer",
          }}>⚖️ COMPARE</button>
          {selected && (
            <a href={`${API}/visualize/${encodeURIComponent(selected)}`} target="_blank" rel="noopener noreferrer"
              style={{ padding: "3px 8px", fontSize: "7px", letterSpacing: "0.1em", fontFamily: MONO,
                background: "transparent", border: `1px solid ${C.border}`, color: C.cyanDim,
                borderRadius: "3px", textDecoration: "none" }}>
              🔬 FULLSCREEN
            </a>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: "14px", padding: "2px 6px" }}>✕</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LEFT LIST */}
        <div style={{ width: "180px", minWidth: "180px", borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "6px" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              style={{ width: "100%", padding: "5px 7px", fontSize: "9px", background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: "3px", color: C.text, fontFamily: MONO, outline: "none" }} />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 3px 6px" }}>
            {filtered.map(g => (
              <button key={g} onClick={() => analyze(g)} style={{
                display: "block", width: "100%", textAlign: "left", padding: "4px 6px", fontSize: "8px",
                background: selected === g ? C.purpleGlow : "transparent",
                border: "none", borderLeft: selected === g ? `2px solid ${C.purple}` : "2px solid transparent",
                color: selected === g ? C.purple : C.text, cursor: "pointer", fontFamily: MONO, borderRadius: "2px",
              }}>{g}</button>
            ))}
          </div>
        </div>

        {/* RIGHT ANALYSIS */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
          {!selected && <div style={{ textAlign: "center", padding: "50px", color: C.textDim, fontSize: "9px" }}>Select a threat group to transmute</div>}
          {loading && <div style={{ textAlign: "center", padding: "50px", color: C.purple, fontSize: "9px" }}>⚗️ Transmuting {selected}...</div>}
          {error && <div style={{ padding: "10px", background: "rgba(239,68,68,0.08)", border: `1px solid rgba(239,68,68,0.25)`, borderRadius: "5px", fontSize: "8px", color: C.red }}>{error}</div>}

          {result && !loading && (<>
            {/* Title */}
            <div style={{ fontSize: "11px", fontWeight: 800, color: C.purple, marginBottom: "2px" }}>{result.name}</div>
            <div style={{ fontSize: "7px", color: C.textDim, marginBottom: "8px" }}>{selected} · {result.formula} · {result.structure}</div>

            {/* Quick stats */}
            <div style={{ display: "flex", gap: "5px", marginBottom: "8px", flexWrap: "wrap" }}>
              <Badge label="STRUCTURE" value={result.structure} color={structColor} bg={`${structColor}15`} />
              <Badge label="STABILITY" value={result.stability?.toFixed(3)||"—"} />
              <Badge label="TECHNIQUES" value={result.technique_count||"—"} />
              <Badge label="☢️ RADIO" value={result.radioactive?"YES":"NO"} color={result.radioactive?C.red:C.green} bg={result.radioactive?"rgba(239,68,68,0.06)":"rgba(34,197,94,0.04)"} />
              <Badge label="NEUTRAL" value={`${((result.neutralization||0)*100).toFixed(0)}%`} color={C.green} bg="rgba(34,197,94,0.04)" />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "1px", marginBottom: "10px", borderBottom: `1px solid ${C.border}`, paddingBottom: "5px", flexWrap: "wrap" }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "4px 8px", fontSize: "7.5px", letterSpacing: "0.05em",
                  background: tab === t.id ? C.purpleGlow : "transparent",
                  border: "none", borderBottom: tab === t.id ? `2px solid ${C.purple}` : "2px solid transparent",
                  color: tab === t.id ? C.purple : C.textDim, cursor: "pointer", fontFamily: MONO, fontWeight: tab === t.id ? 700 : 400,
                }}>{t.label}</button>
              ))}
            </div>

            {/* ═══ MOLECULE TAB ═══ */}
            {tab === "molecule" && (
              <div>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>
                  INTERACTIVE MOLECULAR STRUCTURE — {result.structure}
                </div>
                {graphData ? (
                  <MoleculeViz graphData={graphData} selected={selected} width={Math.min(780, window.innerWidth * 0.55)} height={400} />
                ) : (
                  <div style={{ textAlign: "center", padding: "40px", color: C.textDim, fontSize: "8px" }}>Loading graph data...</div>
                )}
              </div>
            )}

            {/* ═══ METRICS TAB ═══ */}
            {tab === "overview" && metrics && (
              <div>
                <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>QUANTITATIVE METRICS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px", marginBottom: "12px" }}>
                  <Badge label="BRANCHING" value={metrics.branching_factor?.toFixed(2)||"—"} />
                  <Badge label="INTERCONNECT" value={metrics.interconnectivity?.toFixed(4)||"—"} />
                  <Badge label="REDUNDANCY" value={metrics.redundancy_score?.toFixed(2)||"—"} />
                  <Badge label="MOL WEIGHT" value={metrics.molecular_weight||"—"} />
                  <Badge label="CYCLES" value={metrics.cycle_metrics?.cycle_count||0} />
                  <Badge label="LOOPS" value={(metrics.cycle_metrics?.loop_sizes||[]).slice(0,4).join(",")||"—"} />
                </div>
                {result.cves?.length > 0 && (
                  <div style={{ marginBottom: "10px" }}>
                    <button onClick={() => setShowCVEs(!showCVEs)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", padding: 0, display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ transform: showCVEs?"rotate(90deg)":"rotate(0)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                      CVEs ({result.cves.length}) — {result.radioactive?"☢️ KEV-LINKED":"NO KEV MATCH"}
                    </button>
                    {showCVEs && (
                      <div style={{ marginTop: "4px", padding: "6px", background: C.bgDeep, borderRadius: "4px", maxHeight: "100px", overflow: "auto" }}>
                        {result.cves.map(c => (
                          <a key={c} href={`https://nvd.nist.gov/vuln/detail/${c}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "block", fontSize: "8px", padding: "1px 0", color: C.textAccent, textDecoration: "none" }}>{c} ↗</a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ═══ TECHNIQUES TAB ═══ */}
            {tab === "techniques" && (
              <div style={{ maxHeight: "380px", overflow: "auto" }}>
                {Object.entries(tacticGroups).sort(([a],[b])=>a-b).map(([pos, techs]) => (
                  <div key={pos} style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "7px", color: C.purple, letterSpacing: "0.08em", fontWeight: 700, marginBottom: "3px", padding: "2px 5px", background: C.purpleGlow, borderRadius: "2px", display: "inline-block" }}>C{pos}</div>
                    {techs.map((s,i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 6px", marginBottom: "1px", borderRadius: "3px", background: s.radioactive?"rgba(239,68,68,0.05)":C.bgDeep, borderLeft: `2px solid ${s.radioactive?C.red:C.green}`, fontSize: "8px" }}>
                        {s.radioactive && <span style={{ fontSize: "9px" }}>☢️</span>}
                        <span style={{ color: C.text, flex: 1 }}>{s.technique}</span>
                        <span style={{ color: C.textMuted, fontSize: "6px" }}>{s.group_type}</span>
                        <span style={{ fontSize: "6px", padding: "1px 3px", borderRadius: "2px", background: C.purpleGlow, color: C.purpleDim }}>×{s.potency}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* ═══ DEFENSE TAB ═══ */}
            {/* ═══ DEFENSE TAB: FRT + PASTA ═══ */}
            {tab === "defense" && (
              <div>
                {/* Sub-view selector */}
                <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                  {[
                    { id: "frt", label: "⚔️ FAULT REFLECTION", desc: "Bilateral threat–defense" },
                    { id: "pasta", label: "🍝 PASTA ANALYSIS", desc: "7-stage threat model" },
                    { id: "d3fend", label: "🛡️ D3FEND", desc: "Per-technique coverage" },
                  ].map(v => (
                    <button key={v.id} onClick={() => setDefenseView(v.id)} style={{
                      flex: 1, padding: "6px 8px", borderRadius: "4px", textAlign: "left",
                      background: defenseView === v.id ? C.purpleGlow : C.bgDeep,
                      border: defenseView === v.id ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
                      cursor: "pointer", fontFamily: MONO,
                    }}>
                      <div style={{ fontSize: "7.5px", fontWeight: 700, color: defenseView === v.id ? C.purple : C.text }}>{v.label}</div>
                      <div style={{ fontSize: "6px", color: C.textDim, marginTop: "1px" }}>{v.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Stats bar */}
                {antidote && (
                  <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
                    <Badge label="NEUTRALIZATION" value={`${((antidote.neutralization_score||0)*100).toFixed(1)}%`} color={C.green} bg="rgba(34,197,94,0.04)" />
                    <Badge label="DEFENSES" value={antidote.defenses_found||0} />
                    <Badge label="COVERED" value={`${antidote.techniques_covered||0}/${antidote.total_techniques||0}`} />
                    <Badge label="GAPS" value={(antidote.total_techniques||0)-(antidote.techniques_covered||0)} color={C.red} bg="rgba(239,68,68,0.04)" />
                  </div>
                )}

                {/* ════ FAULT REFLECTION TREE VIEW ════ */}
                {defenseView === "frt" && (() => {
                  const subs = result?.substituents || [];
                  const total = antidote?.total_techniques || subs.length;
                  const covered = antidote?.techniques_covered || 0;
                  const gaps = total - covered;
                  const covRatio = total > 0 ? covered / total : 0;
                  // Approximate: first N techniques are "covered", rest are gaps
                  const sortedSubs = [...subs].sort((a, b) => (a.radioactive ? 1 : 0) - (b.radioactive ? 1 : 0));
                  const displaySubs = sortedSubs.slice(0, Math.min(20, subs.length));
                  const svgH = displaySubs.length * 28 + 80;
                  const midX = 260;

                  return (
                    <div>
                      <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>
                        BILATERAL THREAT–DEFENSE MODEL · {covered} REFLECTED · {gaps} BREACH
                      </div>
                      <div style={{ background: C.bgDeep, borderRadius: "6px", border: `1px solid ${C.border}`, overflow: "auto", maxHeight: "340px" }}>
                        <svg width="520" height={svgH} style={{ display: "block" }}>
                          <defs>
                            <filter id="frt-glow-red"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                            <filter id="frt-glow-green"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                          </defs>

                          {/* Header labels */}
                          <text x="80" y="16" fill={C.red} fontSize="7" fontWeight="700" fontFamily={MONO} textAnchor="middle">ATTACK VECTORS</text>
                          <text x={midX} y="16" fill={C.yellow} fontSize="7" fontWeight="700" fontFamily={MONO} textAnchor="middle">FAULT LINE</text>
                          <text x="440" y="16" fill={C.green} fontSize="7" fontWeight="700" fontFamily={MONO} textAnchor="middle">DEFENSE / BREACH</text>

                          {/* Fault line */}
                          <line x1={midX} y1="24" x2={midX} y2={svgH - 40} stroke={C.yellow} strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />

                          {/* Technique rows */}
                          {displaySubs.map((s, i) => {
                            const y = 40 + i * 28;
                            const idx = subs.indexOf(s);
                            const isDefended = idx < covered; // approximate
                            const techLabel = (s.technique || "").replace(/\[.*\]/, "").trim().slice(0, 28);
                            const techId = s.technique?.match(/\[(T\d+(?:\.\d+)?)\]/)?.[1] || "";

                            return (
                              <g key={i}>
                                {/* Attack arrow (left → fault line) */}
                                <line x1="10" y1={y} x2={midX - 8} y2={y} stroke={C.red} strokeWidth="1.2" opacity="0.7" filter="url(#frt-glow-red)">
                                  <animate attributeName="x2" values={`${midX-40};${midX-8};${midX-8}`} dur="1.5s" begin={`${i*0.05}s`} fill="freeze" />
                                </line>
                                <polygon points={`${midX-8},${y-3} ${midX},${y} ${midX-8},${y+3}`} fill={C.red} opacity="0.8" />

                                {/* Tech label */}
                                <text x="14" y={y + 3} fill={C.text} fontSize="6.5" fontFamily={MONO} opacity="0.8">{techLabel}</text>
                                {techId && <text x="14" y={y + 11} fill={C.textDim} fontSize="5" fontFamily={MONO}>{techId}</text>}
                                {s.radioactive && <text x={midX - 24} y={y + 4} fill={C.neon} fontSize="7">☢️</text>}

                                {isDefended ? (
                                  /* Reflected — green arrow bouncing back */
                                  <g>
                                    <line x1={midX + 4} y1={y} x2={midX + 120} y2={y} stroke={C.green} strokeWidth="1.2" opacity="0.6" filter="url(#frt-glow-green)" />
                                    <rect x={midX + 124} y={y - 6} width="90" height="12" rx="2" fill="rgba(34,197,94,0.08)" stroke={C.green} strokeWidth="0.5" />
                                    <text x={midX + 128} y={y + 3} fill={C.green} fontSize="6" fontFamily={MONO}>🛡 REFLECTED</text>
                                  </g>
                                ) : (
                                  /* Breach — dashed red arrow penetrating through */
                                  <g>
                                    <line x1={midX + 4} y1={y} x2={midX + 120} y2={y} stroke={C.red} strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
                                    <rect x={midX + 124} y={y - 6} width="90" height="12" rx="2" fill="rgba(239,68,68,0.06)" stroke={C.red} strokeWidth="0.5" />
                                    <text x={midX + 128} y={y + 3} fill={C.red} fontSize="6" fontFamily={MONO}>💥 BREACH</text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* Summary bar */}
                          <rect x="20" y={svgH - 30} width="480" height="14" rx="7" fill="rgba(255,255,255,0.03)" stroke={C.border} strokeWidth="0.5" />
                          <rect x="20" y={svgH - 30} width={480 * covRatio} height="14" rx="7" fill="rgba(34,197,94,0.2)" />
                          <text x="260" y={svgH - 20} fill={C.text} fontSize="7" fontFamily={MONO} textAnchor="middle" fontWeight="700">
                            {(covRatio * 100).toFixed(0)}% FAULT COVERAGE — {covered} defended / {gaps} exposed
                          </text>
                        </svg>
                      </div>
                      {subs.length > 20 && <div style={{ fontSize: "7px", color: C.textDim, marginTop: "4px" }}>Showing top 20 of {subs.length} techniques</div>}
                    </div>
                  );
                })()}

                {/* ════ PASTA 7-STAGE ANALYSIS VIEW ════ */}
                {defenseView === "pasta" && (() => {
                  const subs = result?.substituents || [];
                  const total = subs.length;
                  const gapCount = (antidote?.total_techniques || total) - (antidote?.techniques_covered || 0);
                  const covPct = antidote?.neutralization_score || 0;
                  const radioSubs = subs.filter(s => s.radioactive);
                  const byPos = {};
                  subs.forEach(s => { if (!byPos[s.position]) byPos[s.position] = []; byPos[s.position].push(s); });
                  const posCount = Object.keys(byPos).length;
                  const residualRisk = (result.stability || 0) * (1 - covPct) * 100;
                  const riskColor = residualRisk > 15 ? C.red : residualRisk > 8 ? "#f97316" : residualRisk > 3 ? C.yellow : C.green;
                  const riskLabel = residualRisk > 15 ? "CRITICAL" : residualRisk > 8 ? "HIGH" : residualRisk > 3 ? "MODERATE" : "LOW";

                  const stages = [
                    { n: "S1", label: "DEFINE OBJECTIVES", color: "#8B5CF6", data: `Actor: ${selected} · Stability: ${(result.stability||0).toFixed(3)} · Threat: ${result.radioactive?"ACTIVE CVE EXPLOITATION":"STANDARD CAPABILITY"}` },
                    { n: "S2", label: "TECHNICAL SCOPE", color: "#3B82F6", data: `Formula: ${result.formula} · ${total} techniques · ${posCount} tactic positions · ${result.structure} structure` },
                    { n: "S3", label: "DECOMPOSITION", color: "#0891B2", data: `Kill chain: ${Object.entries(byPos).sort(([a],[b])=>a-b).map(([p,t])=>`C${p}(${t.length})`).join(" → ")}` },
                    { n: "S4", label: "THREAT ANALYSIS", color: "#D97706", data: `${radioSubs.length} radioactive CVEs · Potency range: ${Math.min(...subs.map(s=>s.potency||1))}–${Math.max(...subs.map(s=>s.potency||1))} · KEV: ${result.radioactive?"YES":"NO"}` },
                    { n: "S5", label: "VULNERABILITY ANALYSIS", color: "#DC2626", data: `D3FEND gaps: ${gapCount} · Exposure: ${(100-covPct*100).toFixed(1)}% · ${antidote?.defenses_found||0} countermeasures mapped` },
                    { n: "S6", label: "ATTACK MODELING", color: "#EA580C", data: `Structure: ${result.structure} (${result.structure==="AROMATIC"?"self-reinforcing loops":result.structure==="CYCLIC"?"re-entry paths":result.structure==="BRANCHED"?"parallel vectors":"sequential chain"}) · Branching: ${metrics?.branching_factor?.toFixed(2)||"—"}` },
                    { n: "S7", label: "RISK & IMPACT", color: riskColor, data: `Residual risk: ${residualRisk.toFixed(1)} · Rating: ${riskLabel} · FAIR: Threat_p(${(result.stability||0).toFixed(2)}) × Vuln_p(${(1-covPct).toFixed(2)}) = ${(residualRisk/100).toFixed(3)}` },
                  ];

                  const stageH = 36;
                  const svgH = stages.length * (stageH + 16) + 60;

                  return (
                    <div>
                      <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "6px" }}>
                        PASTA THREAT MODEL — 7 STAGES · FAIR-ALIGNED
                      </div>
                      <div style={{ background: C.bgDeep, borderRadius: "6px", border: `1px solid ${C.border}`, padding: "8px", overflow: "auto", maxHeight: "380px" }}>
                        <svg width="500" height={svgH} style={{ display: "block" }}>
                          {stages.map((s, i) => {
                            const y = 10 + i * (stageH + 16);
                            return (
                              <g key={s.n}>
                                {/* Connector line */}
                                {i > 0 && (
                                  <line x1="250" y1={y - 12} x2="250" y2={y} stroke={s.color} strokeWidth="1.5" opacity="0.3" strokeDasharray="3,2">
                                    <animate attributeName="strokeDashoffset" values="5;0" dur="1s" begin={`${i*0.15}s`} repeatCount="indefinite" />
                                  </line>
                                )}
                                {/* Stage box */}
                                <rect x="4" y={y} width="492" height={stageH} rx="4" fill="rgba(0,0,0,0.2)" stroke={s.color} strokeWidth="0.8" opacity="0.8">
                                  <animate attributeName="opacity" values="0;0.8" dur="0.4s" begin={`${i*0.1}s`} fill="freeze" />
                                </rect>
                                {/* Stage number badge */}
                                <rect x="8" y={y + 4} width="28" height="14" rx="2" fill={s.color} opacity="0.2" />
                                <text x="22" y={y + 14} fill={s.color} fontSize="8" fontWeight="800" fontFamily={MONO} textAnchor="middle">{s.n}</text>
                                {/* Label */}
                                <text x="42" y={y + 13} fill={s.color} fontSize="7.5" fontWeight="700" fontFamily={MONO}>{s.label}</text>
                                {/* Data */}
                                <text x="42" y={y + 26} fill={C.textDim} fontSize="6" fontFamily={MONO}>{s.data.slice(0, 90)}</text>
                                {s.data.length > 90 && <text x="42" y={y + 33} fill={C.textDim} fontSize="6" fontFamily={MONO}>{s.data.slice(90, 180)}</text>}
                              </g>
                            );
                          })}

                          {/* FAIR equation at bottom */}
                          <g transform={`translate(0, ${svgH - 44})`}>
                            <rect x="4" y="0" width="492" height="38" rx="4" fill="rgba(168,85,247,0.04)" stroke={C.purple} strokeWidth="0.5" />
                            <text x="250" y="12" fill={C.purple} fontSize="7" fontWeight="700" fontFamily={MONO} textAnchor="middle">FAIR ALIGNMENT — PASTA RESIDUAL RISK FORMULA</text>
                            <text x="250" y="26" fill={C.text} fontSize="8" fontWeight="600" fontFamily={MONO} textAnchor="middle">
                              R = (Threat_p × Vuln_p) / Countermeasures = ({(result.stability||0).toFixed(2)} × {(1-covPct).toFixed(2)}) / {antidote?.defenses_found||1} = 
                            </text>
                            <text x="470" y="26" fill={riskColor} fontSize="9" fontWeight="800" fontFamily={MONO}>{riskLabel}</text>
                          </g>
                        </svg>
                      </div>
                    </div>
                  );
                })()}

                {/* ════ D3FEND PER-TECHNIQUE VIEW ════ */}
                {defenseView === "d3fend" && (
                  <div>
                    <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "5px" }}>PER-TECHNIQUE D3FEND COVERAGE</div>
                    <div style={{ maxHeight: "280px", overflow: "auto" }}>
                      {(result.substituents||[]).map((s,i) => {
                        const tid = s.technique?.match(/\[(T\d+(?:\.\d+)?)\]/)?.[1]||`t${i}`;
                        const isExp = expandedDef === tid;
                        return (
                          <button key={i} onClick={() => setExpandedDef(isExp?null:tid)} style={{
                            display: "block", width: "100%", textAlign: "left", padding: "4px 6px", marginBottom: "1px",
                            background: isExp?"rgba(34,197,94,0.04)":C.bgDeep, border: "none", borderLeft: `2px solid ${C.green}`, borderRadius: "2px", cursor: "pointer", fontFamily: MONO,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8px" }}>
                              <span style={{ color: C.text }}>{s.technique}</span>
                              <span style={{ color: C.textDim, fontSize: "6px" }}>{isExp?"▼":"▶"}</span>
                            </div>
                            {isExp && <div style={{ marginTop: "3px", paddingLeft: "6px", fontSize: "7px", color: C.green }}>D3FEND mapping for {tid}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ CYCLES TAB ═══ */}
            {tab === "cycles" && metrics && (
              <div>
                <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
                  <Badge label="CYCLES" value={metrics.cycle_metrics?.cycle_count||0} />
                  <Badge label="LOOP SIZES" value={(metrics.cycle_metrics?.loop_sizes||[]).join(",")||"None"} />
                </div>
                {metrics.cycle_metrics?.cycle_clusters?.length > 0 ? (
                  <div style={{ marginBottom: "10px" }}>
                    <div style={{ fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", marginBottom: "4px" }}>STRONGLY CONNECTED COMPONENTS</div>
                    {metrics.cycle_metrics.cycle_clusters.map((cl,i) => (
                      <div key={i} style={{ padding: "5px 7px", marginBottom: "3px", background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)", borderRadius: "4px" }}>
                        <div style={{ fontSize: "7px", color: C.yellow, fontWeight: 700, marginBottom: "2px" }}>CLUSTER {i+1} — {cl.length} nodes</div>
                        <div style={{ fontSize: "7px", color: C.textDim, lineHeight: "1.4" }}>{cl.join(" → ")}</div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ padding: "10px", fontSize: "8px", color: C.textDim, background: C.bgDeep, borderRadius: "4px" }}>No non-trivial SCCs. Structure is acyclic.</div>}
                {metrics.cycle_metrics?.simple_cycles?.length > 0 && (
                  <div>
                    <button onClick={() => setShowCycles(!showCycles)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: "7px", color: C.textDim, letterSpacing: "0.1em", padding: 0, display: "flex", alignItems: "center", gap: "3px", marginBottom: "4px" }}>
                      <span style={{ transform: showCycles?"rotate(90deg)":"rotate(0)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
                      SIMPLE CYCLES ({metrics.cycle_metrics.simple_cycles.length})
                    </button>
                    {showCycles && <div style={{ maxHeight: "160px", overflow: "auto" }}>
                      {metrics.cycle_metrics.simple_cycles.slice(0,20).map((cy,i) => (
                        <div key={i} style={{ padding: "3px 6px", marginBottom: "1px", fontSize: "7px", background: C.bgDeep, borderRadius: "3px", color: C.textDim }}>
                          <span style={{ color: C.yellow, fontWeight: 700 }}>#{i+1}</span> {cy.join(" → ")} → {cy[0]}
                        </div>
                      ))}
                    </div>}
                  </div>
                )}
                <div style={{ marginTop: "10px", padding: "8px", borderRadius: "4px", background: C.purpleGlow, border: `1px solid ${C.border}`, fontSize: "7px", color: C.textDim, lineHeight: "1.5" }}>
                  <span style={{ color: C.purple, fontWeight: 700 }}>CLASSIFICATION:</span>{" "}
                  {result.structure === "AROMATIC" && "stability ≥ 0.7, ≥3 cycles, 6+ member ring. Self-reinforcing."}
                  {result.structure === "CYCLIC" && "≥1 cycle, stability ≥ 0.3. Loops create persistence."}
                  {result.structure === "BRANCHED" && "No qualifying cycles, branching ≥ 1.5. Parallel paths."}
                  {result.structure === "LINEAR" && "Sequential kill chain. Fragile — disrupting any link breaks it."}
                </div>
              </div>
            )}

            {/* ═══ COMPARE TAB ═══ */}
            {tab === "compare" && compareMode && (
              <div>
                <div style={{ marginBottom: "8px" }}>
                  <input value={compareSearch} onChange={e => { setCompareSearch(e.target.value); setCompareGroup(null); setCompareResult(null); }} placeholder="Search comparison group..."
                    style={{ width: "100%", padding: "5px 7px", fontSize: "9px", background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: "3px", color: C.text, fontFamily: MONO, outline: "none", marginBottom: "3px" }} />
                  {compareSearch && !compareGroup && (
                    <div style={{ maxHeight: "100px", overflow: "auto", background: C.bgDeep, borderRadius: "3px" }}>
                      {compareFiltered.slice(0,12).map(g => (
                        <button key={g} onClick={() => { setCompareSearch(g); runCompare(g); }} style={{
                          display: "block", width: "100%", textAlign: "left", padding: "3px 6px", fontSize: "8px",
                          background: "transparent", border: "none", color: C.text, cursor: "pointer", fontFamily: MONO,
                        }}>{g}</button>
                      ))}
                    </div>
                  )}
                </div>
                {compareLoading && <div style={{ textAlign: "center", padding: "16px", color: C.purple, fontSize: "8px" }}>⚖️ Comparing...</div>}
                {compareResult && (<>
                  <div style={{ display: "flex", gap: "5px", marginBottom: "10px", flexWrap: "wrap" }}>
                    <Badge label="STABILITY Δ" value={`${compareResult.stability_delta>=0?"+":""}${compareResult.stability_delta?.toFixed(3)}`} color={compareResult.stability_delta>=0?C.green:C.red} />
                    <Badge label="STRUCTURE" value={compareResult.structure_change?.changed?`${compareResult.structure_change.from} → ${compareResult.structure_change.to}`:`${compareResult.structure_change?.from||"—"}`} color={compareResult.structure_change?.changed?C.yellow:C.textAccent} />
                    <Badge label="BACKBONE Δ" value={`${compareResult.backbone_delta>=0?"+":""}${compareResult.backbone_delta}`} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" }}>
                    {[{ k: "group1_summary", n: compareResult.group1 }, { k: "group2_summary", n: compareResult.group2 }].map(({ k, n }) => {
                      const s = compareResult[k]||{};
                      return (
                        <div key={k} style={{ padding: "8px", borderRadius: "6px", background: C.bgDeep, border: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: "9px", fontWeight: 800, color: C.purple, marginBottom: "4px" }}>{n}</div>
                          <div style={{ fontSize: "7px", color: C.textDim }}>Structure: <span style={{ color: STRUCT_COLORS[s.structure]||C.textAccent }}>{s.structure}</span></div>
                          <div style={{ fontSize: "7px", color: C.textDim }}>Stability: <span style={{ color: C.textAccent }}>{s.stability?.toFixed(3)}</span></div>
                          <div style={{ fontSize: "7px", color: C.textDim }}>Techniques: <span style={{ color: C.textAccent }}>{s.techniques}</span></div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    <div>
                      <div style={{ fontSize: "7px", color: C.green, letterSpacing: "0.1em", fontWeight: 700, marginBottom: "3px" }}>+ ADDED ({compareResult.techniques_added?.length||0})</div>
                      <div style={{ maxHeight: "120px", overflow: "auto" }}>{(compareResult.techniques_added||[]).slice(0,25).map((t,i) => (
                        <div key={i} style={{ fontSize: "7px", padding: "1px 4px", marginBottom: "1px", background: "rgba(34,197,94,0.04)", borderRadius: "2px", color: C.green }}>+ {t}</div>
                      ))}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "7px", color: C.red, letterSpacing: "0.1em", fontWeight: 700, marginBottom: "3px" }}>− REMOVED ({compareResult.techniques_removed?.length||0})</div>
                      <div style={{ maxHeight: "120px", overflow: "auto" }}>{(compareResult.techniques_removed||[]).slice(0,25).map((t,i) => (
                        <div key={i} style={{ fontSize: "7px", padding: "1px 4px", marginBottom: "1px", background: "rgba(239,68,68,0.04)", borderRadius: "2px", color: C.red }}>− {t}</div>
                      ))}</div>
                    </div>
                  </div>
                </>)}
              </div>
            )}
          </>)}
        </div>
      </div>

      <style>{`@keyframes alcSlide { from { opacity:0; transform:translateX(-50%) translateY(14px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}
