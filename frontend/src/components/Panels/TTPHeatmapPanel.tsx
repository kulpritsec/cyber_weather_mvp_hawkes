/**
 * TTPHeatmapPanel — "Technique Weather Radar"
 * ATT&CK matrix heatmap with sparklines and Alchemy cross-reference
 */
import { useState, useEffect, useCallback, useMemo } from "react";

const C = {
  bg: "rgba(8,15,28,0.97)", panel: "rgba(10,20,40,0.95)",
  border: "rgba(0,180,255,0.12)", borderLit: "rgba(0,180,255,0.30)",
  text: "#a8bcd0", dim: "#3a5068", bright: "#e0eaf8", accent: "#00ccff",
  warning: "#f97316", danger: "#ef4444", success: "#22c55e",
  heat0: "rgba(0,0,0,0)", heat1: "rgba(0,120,200,0.15)", heat2: "rgba(0,180,255,0.30)",
  heat3: "rgba(0,255,200,0.45)", heat4: "rgba(255,200,0,0.60)",
  heat5: "rgba(255,100,0,0.80)", heat6: "rgba(255,40,40,0.95)",
};
const MONO = "'JetBrains Mono', monospace";

const TACTIC_COLORS: Record<string, string> = {
  "reconnaissance": "#64748b", "resource-development": "#8b5cf6",
  "initial-access": "#ef4444", "execution": "#f97316",
  "persistence": "#eab308", "privilege-escalation": "#84cc16",
  "defense-evasion": "#22c55e", "credential-access": "#14b8a6",
  "discovery": "#06b6d4", "lateral-movement": "#3b82f6",
  "collection": "#6366f1", "command-and-control": "#a855f7",
  "exfiltration": "#ec4899", "impact": "#f43f5e",
};

interface Technique {
  id: string; name: string; tactic: string;
  count_24h: number; count_7d: number;
  trend: "increasing" | "stable" | "decreasing";
  sparkline: number[]; groups: string[];
  top_sources: string[]; top_countries: string[];
}
interface HeatmapData {
  tactics: { id: string; label: string }[];
  techniques: Record<string, Technique>;
  top_techniques: string[];
  total_events_mapped: number;
  unique_techniques_active: number;
  window_hours: number;
}
interface TechniqueDetail {
  technique_id: string; total_events: number;
  timeline: Record<string, number>;
  top_sources: Record<string, number>;
  top_countries: Record<string, number>;
  top_ips: Record<string, number>;
  recent_events: any[];
  alchemy_groups: string[];
}

function MiniSparkline({ data, width = 60, height = 16, color = C.accent }: {
  data: number[]; width?: number; height?: number; color?: string;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`${color}15`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function heatColor(count: number, maxCount: number): string {
  if (count === 0) return C.heat0;
  const pct = Math.min(count / Math.max(maxCount, 1), 1);
  if (pct < 0.05) return C.heat1;
  if (pct < 0.15) return C.heat2;
  if (pct < 0.35) return C.heat3;
  if (pct < 0.6) return C.heat4;
  if (pct < 0.85) return C.heat5;
  return C.heat6;
}

function trendIcon(trend: string) {
  if (trend === "increasing") return { icon: "▲", color: C.danger };
  if (trend === "decreasing") return { icon: "▼", color: C.success };
  return { icon: "—", color: C.dim };
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function TTPHeatmapPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [techDetail, setTechDetail] = useState<TechniqueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"matrix" | "list">("list");
  const [hours, setHours] = useState(24);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/v1/ttp/heatmap?hours=${hours}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [hours]);

  useEffect(() => { fetchData(); const id = setInterval(fetchData, 5 * 60 * 1000); return () => clearInterval(id); }, [fetchData]);

  useEffect(() => {
    if (!selectedTech) { setTechDetail(null); return; }
    setDetailLoading(true);
    fetch(`/v1/ttp/technique/${selectedTech}?hours=${hours}`)
      .then(r => r.json()).then(setTechDetail).catch(() => setTechDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedTech, hours]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (selectedTech) setSelectedTech(null); else onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTech, onClose]);

  const techniques = useMemo(() => data ? Object.values(data.techniques).filter(t => t.count_24h > 0) : [], [data]);
  const maxCount = useMemo(() => Math.max(...techniques.map(t => t.count_24h), 1), [techniques]);

  const tacticGroups = useMemo(() => {
    if (!data) return {};
    const groups: Record<string, Technique[]> = {};
    for (const tactic of data.tactics) {
      groups[tactic.id] = techniques.filter(t => t.tactic === tactic.id).sort((a, b) => b.count_24h - a.count_24h);
    }
    return groups;
  }, [data, techniques]);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1200,
      background: "rgba(2,5,12,0.96)", backdropFilter: "blur(20px)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* HEADER */}
      <div style={{
        padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, background: "rgba(4,10,24,0.98)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ fontSize: "20px" }}>📡</div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: "14px", fontWeight: 800, color: C.bright, letterSpacing: "0.06em" }}>
              TECHNIQUE WEATHER RADAR
            </div>
            <div style={{ fontFamily: MONO, fontSize: "9px", color: C.dim }}>
              ATT&CK HEATMAP · LIVE EVENT→TECHNIQUE MAPPING · ALCHEMY CROSS-REFERENCE
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", gap: "2px", background: "rgba(255,255,255,0.02)", borderRadius: "4px", padding: "2px" }}>
            {[6, 12, 24, 72, 168].map(h => (
              <button key={h} onClick={() => setHours(h)} style={{
                padding: "4px 10px", fontSize: "9px", fontFamily: MONO,
                border: "none", borderRadius: "3px", cursor: "pointer",
                background: hours === h ? `${C.accent}15` : "transparent",
                color: hours === h ? C.accent : C.dim, fontWeight: hours === h ? 700 : 400,
              }}>{h}H</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "2px", background: "rgba(255,255,255,0.02)", borderRadius: "4px", padding: "2px" }}>
            {([{ id: "matrix", label: "MATRIX" }, { id: "list", label: "LIST" }] as const).map(v => (
              <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                padding: "4px 10px", fontSize: "9px", fontFamily: MONO,
                border: "none", borderRadius: "3px", cursor: "pointer",
                background: viewMode === v.id ? `${C.accent}15` : "transparent",
                color: viewMode === v.id ? C.accent : C.dim,
              }}>{v.label}</button>
            ))}
          </div>
          <button onClick={fetchData} style={{
            padding: "4px 10px", fontSize: "9px", fontFamily: MONO,
            border: `1px solid ${C.border}`, borderRadius: "3px",
            cursor: "pointer", background: "transparent", color: C.dim,
          }}>↻</button>
          <button onClick={onClose} style={{
            fontFamily: MONO, fontSize: "11px", color: C.dim,
            background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
            borderRadius: "4px", padding: "5px 12px", cursor: "pointer",
          }}>ESC ×</button>
        </div>
      </div>

      {/* STATS BAR */}
      {data && (
        <div style={{
          padding: "8px 20px", borderBottom: `1px solid ${C.border}`,
          display: "flex", gap: "24px", background: "rgba(4,10,24,0.6)", flexShrink: 0,
        }}>
          {[
            { label: "EVENTS MAPPED", value: fmtCount(data.total_events_mapped), color: C.accent },
            { label: "ACTIVE TECHNIQUES", value: data.unique_techniques_active, color: C.bright },
            { label: "WINDOW", value: `${data.window_hours}H`, color: C.dim },
            { label: "TOP TECHNIQUE", value: data.top_techniques.length > 0 ? data.techniques[data.top_techniques[0]]?.name || "—" : "—", color: C.danger },
            { label: "TRENDING ▲", value: techniques.filter(t => t.trend === "increasing").length, color: C.warning },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em" }}>{s.label}</span>
              <span style={{ fontFamily: MONO, fontSize: "13px", fontWeight: 800, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontFamily: MONO, fontSize: "11px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "28px", marginBottom: "8px", animation: "pulse 1.5s infinite" }}>📡</div>
              Scanning technique activity...
            </div>
          </div>
        ) : error ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.danger, fontFamily: MONO, fontSize: "11px" }}>⚠ {error}</div>
        ) : (
          <div style={{ flex: 1, display: "flex" }}>
            <div style={{ flex: 1, padding: "12px 16px", overflow: "auto" }}>
              {viewMode === "matrix" ? (
                /* MATRIX VIEW */
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${data?.tactics.length || 14}, minmax(80px, 1fr))`, gap: "2px" }}>
                  {data?.tactics.map(tactic => (
                    <div key={tactic.id} style={{ padding: "6px 4px", textAlign: "center", borderBottom: `2px solid ${TACTIC_COLORS[tactic.id] || C.accent}`, marginBottom: "4px" }}>
                      <div style={{ fontFamily: MONO, fontSize: "7px", color: TACTIC_COLORS[tactic.id] || C.accent, letterSpacing: "0.1em", fontWeight: 700 }}>
                        {tactic.label.toUpperCase()}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: "9px", color: C.dim, marginTop: "2px" }}>
                        {(tacticGroups[tactic.id] || []).length}
                      </div>
                    </div>
                  ))}
                  {data?.tactics.map(tactic => (
                    <div key={`col-${tactic.id}`} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {(tacticGroups[tactic.id] || []).map(tech => {
                        const t = trendIcon(tech.trend);
                        const isSelected = selectedTech === tech.id;
                        return (
                          <button key={tech.id} onClick={() => setSelectedTech(isSelected ? null : tech.id)} style={{
                            padding: "6px 4px", borderRadius: "3px",
                            border: isSelected ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                            background: isSelected ? `${C.accent}15` : heatColor(tech.count_24h, maxCount),
                            cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                          }}>
                            <div style={{ fontFamily: MONO, fontSize: "8px", color: C.accent, letterSpacing: "0.04em", marginBottom: "2px" }}>{tech.id}</div>
                            <div style={{ fontFamily: MONO, fontSize: "8px", color: C.text, lineHeight: 1.2, marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={tech.name}>{tech.name}</div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontFamily: MONO, fontSize: "10px", fontWeight: 800, color: C.bright }}>{fmtCount(tech.count_24h)}</span>
                              <span style={{ fontFamily: MONO, fontSize: "8px", color: t.color }}>{t.icon}</span>
                            </div>
                            <div style={{ marginTop: "2px" }}><MiniSparkline data={tech.sparkline} width={68} height={12} color={tech.trend === "increasing" ? C.danger : C.accent} /></div>
                            {tech.groups.length > 0 && <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, marginTop: "2px" }}>{tech.groups.length} APT{tech.groups.length !== 1 ? "s" : ""}</div>}
                          </button>
                        );
                      })}
                      {(tacticGroups[tactic.id] || []).length === 0 && <div style={{ padding: "12px 4px", textAlign: "center", color: C.dim, fontFamily: MONO, fontSize: "8px" }}>—</div>}
                    </div>
                  ))}
                </div>
              ) : (
                /* LIST VIEW */
                <div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: "10px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.borderLit}` }}>
                        {["TECHNIQUE", "NAME", "TACTIC", "24H", "7D", "TREND", "SPARKLINE", "SOURCES", "COUNTRIES", "GROUPS"].map(h => (
                          <th key={h} style={{ padding: "6px 5px", textAlign: "left", color: C.dim, fontSize: "7px", letterSpacing: "0.1em", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {techniques.sort((a, b) => b.count_24h - a.count_24h).map(tech => {
                        const t = trendIcon(tech.trend);
                        const isSelected = selectedTech === tech.id;
                        return (
                          <tr key={tech.id} onClick={() => setSelectedTech(isSelected ? null : tech.id)} style={{
                            cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                            background: isSelected ? `${C.accent}10` : heatColor(tech.count_24h, maxCount),
                            transition: "background 0.15s",
                          }}>
                            <td style={{ padding: "5px", color: C.accent, fontWeight: 600, whiteSpace: "nowrap" }}>{tech.id}</td>
                            <td style={{ padding: "5px", color: C.bright, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tech.name}</td>
                            <td style={{ padding: "5px" }}>
                              <span style={{ padding: "1px 5px", borderRadius: "2px", fontSize: "8px", background: `${TACTIC_COLORS[tech.tactic] || C.accent}15`, color: TACTIC_COLORS[tech.tactic] || C.accent, border: `1px solid ${TACTIC_COLORS[tech.tactic] || C.accent}30` }}>
                                {tech.tactic.replace(/-/g, " ").toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "5px", color: C.bright, fontWeight: 700 }}>{fmtCount(tech.count_24h)}</td>
                            <td style={{ padding: "5px", color: C.dim }}>{fmtCount(tech.count_7d)}</td>
                            <td style={{ padding: "5px", color: t.color }}>{t.icon}</td>
                            <td style={{ padding: "5px" }}><MiniSparkline data={tech.sparkline} width={50} height={14} color={tech.trend === "increasing" ? C.danger : C.accent} /></td>
                            <td style={{ padding: "5px", color: C.dim, fontSize: "9px" }}>{tech.top_sources.slice(0, 2).join(", ")}</td>
                            <td style={{ padding: "5px", color: C.dim, fontSize: "9px" }}>{tech.top_countries.slice(0, 3).join(", ")}</td>
                            <td style={{ padding: "5px", color: C.dim, fontSize: "9px" }}>{tech.groups.length > 0 ? `${tech.groups.length} groups` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* DETAIL SIDEBAR */}
            {selectedTech && (
              <div style={{ width: "340px", borderLeft: `1px solid ${C.border}`, background: "rgba(4,10,24,0.98)", overflow: "auto", padding: "14px", flexShrink: 0 }}>
                {detailLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontFamily: MONO, fontSize: "10px" }}>Loading...</div>
                ) : techDetail && data?.techniques[selectedTech] ? (() => {
                  const tech = data.techniques[selectedTech];
                  const t = trendIcon(tech.trend);
                  return (
                    <div>
                      <div style={{ marginBottom: "12px", paddingBottom: "10px", borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ fontFamily: MONO, fontSize: "12px", fontWeight: 800, color: C.accent }}>{selectedTech}</div>
                        <div style={{ fontFamily: MONO, fontSize: "11px", color: C.bright, marginTop: "2px" }}>{tech.name}</div>
                        <div style={{ marginTop: "4px" }}>
                          <span style={{ padding: "2px 6px", borderRadius: "3px", fontSize: "8px", fontFamily: MONO, background: `${TACTIC_COLORS[tech.tactic] || C.accent}15`, color: TACTIC_COLORS[tech.tactic] || C.accent, border: `1px solid ${TACTIC_COLORS[tech.tactic] || C.accent}30` }}>
                            {tech.tactic.replace(/-/g, " ").toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "12px" }}>
                        {[
                          { label: "TOTAL EVENTS", value: fmtCount(techDetail.total_events), color: C.bright },
                          { label: "TREND", value: t.icon, color: t.color },
                        ].map((s, i) => (
                          <div key={i} style={{ padding: "8px", borderRadius: "4px", background: `${s.color}06`, border: `1px solid ${s.color}15`, textAlign: "center" }}>
                            <div style={{ fontFamily: MONO, fontSize: "16px", fontWeight: 800, color: s.color }}>{s.value}</div>
                            <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.1em" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom: "12px", padding: "8px", borderRadius: "4px", background: `${C.accent}04`, border: `1px solid ${C.accent}10` }}>
                        <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.1em", marginBottom: "4px" }}>ACTIVITY TIMELINE</div>
                        <MiniSparkline data={tech.sparkline} width={300} height={40} color={tech.trend === "increasing" ? C.danger : C.accent} />
                      </div>

                      {techDetail.alchemy_groups.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${C.border}` }}>
                            ALCHEMY GROUPS ({techDetail.alchemy_groups.length})
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                            {techDetail.alchemy_groups.slice(0, 20).map(g => (
                              <span key={g} style={{ padding: "2px 6px", borderRadius: "3px", fontSize: "9px", fontFamily: MONO, background: `${C.danger}08`, border: `1px solid ${C.danger}20`, color: C.danger }}>{g}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {Object.keys(techDetail.top_ips).length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${C.border}` }}>TOP SOURCE IPs</div>
                          {Object.entries(techDetail.top_ips).slice(0, 8).map(([ip, count]) => (
                            <div key={ip} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
                              <span style={{ fontFamily: MONO, fontSize: "10px", color: C.accent }}>{ip}</span>
                              <span style={{ fontFamily: MONO, fontSize: "10px", color: C.dim }}>{fmtCount(count as number)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {Object.keys(techDetail.top_countries).length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${C.border}` }}>TOP COUNTRIES</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {Object.entries(techDetail.top_countries).slice(0, 10).map(([cc, count]) => (
                              <span key={cc} style={{ padding: "2px 6px", borderRadius: "3px", fontSize: "9px", fontFamily: MONO, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, color: C.text }}>{cc}: {fmtCount(count as number)}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {Object.keys(techDetail.top_sources).length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${C.border}` }}>DATA SOURCES</div>
                          {Object.entries(techDetail.top_sources).slice(0, 5).map(([src, count]) => {
                            const maxSrc = Math.max(...Object.values(techDetail.top_sources).map(Number));
                            return (
                              <div key={src} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                                <span style={{ width: "80px", fontFamily: MONO, fontSize: "9px", color: C.text }}>{src}</span>
                                <div style={{ flex: 1, height: "6px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
                                  <div style={{ width: `${((count as number) / maxSrc) * 100}%`, height: "100%", background: C.accent, opacity: 0.4, borderRadius: "2px" }} />
                                </div>
                                <span style={{ fontFamily: MONO, fontSize: "9px", color: C.dim, width: "40px", textAlign: "right" }}>{fmtCount(count as number)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {techDetail.recent_events.length > 0 && (
                        <div>
                          <div style={{ fontFamily: MONO, fontSize: "7px", color: C.dim, letterSpacing: "0.12em", marginBottom: "6px", paddingBottom: "4px", borderBottom: `1px solid ${C.border}` }}>RECENT EVENTS ({techDetail.recent_events.length})</div>
                          {techDetail.recent_events.slice(0, 8).map((evt, i) => (
                            <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${C.border}`, fontSize: "9px", fontFamily: MONO }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: C.accent }}>{evt.source_ip || "—"}</span>
                                <span style={{ color: C.dim }}>{evt.country || "XX"}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", color: C.dim, fontSize: "8px" }}>
                                <span>{evt.vector}:{evt.port || "—"}</span>
                                <span>{evt.ts ? new Date(evt.ts).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div style={{ textAlign: "center", padding: "40px 0", color: C.dim, fontFamily: MONO, fontSize: "10px" }}>No data</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        table tr:hover { background: ${C.accent}05 !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      `}</style>
    </div>
  );
}
