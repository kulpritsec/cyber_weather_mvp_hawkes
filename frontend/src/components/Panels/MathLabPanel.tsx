/**
 * MathLabPanel.tsx
 *
 * Interactive Hawkes Process Mathematics Laboratory
 * Visualises λ(t) = μ(t) + Σ α·e^{-β(t−tᵢ)} in real-time with
 * animated intensity chart, covariate decomposition, arc gauges,
 * and interactive parameter sliders.
 *
 * Now wired to real backend data: seasonal multipliers, event calendar,
 * campaign recurrence, forecast projections, and backtest metrics.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  CSSProperties,
} from 'react';

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

const VECTOR_COLORS: Record<string, string> = {
  ssh: '#00e5ff', rdp: '#ff6d00', http: '#b388ff', dns_amp: '#76ff03',
  brute_force: '#ff4081', botnet_c2: '#ffd740', ransomware: '#ff1744',
};

// ─── PROPS ────────────────────────────────────────────────────────────────────
interface MathLabPanelProps {
  onClose: () => void;
  initialVector?: string;
  cellId?: number;
  cellVector?: string;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
type SpeedOption = { label: string; value: number | null };
const SPEEDS: SpeedOption[] = [
  { label: '‖', value: null },   // pause
  { label: '0.25×', value: 0.25 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const startRad = toRad(startDeg);
  const endRad = toRad(endDeg);
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const spanDeg = ((endDeg - startDeg) % 360 + 360) % 360;
  const largeArc = spanDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

// ─── ARC GAUGE ────────────────────────────────────────────────────────────────
interface ArcGaugeProps {
  value: number;
  max: number;
  color: string;
  label: string;
  valueLabel: string;
}

function ArcGauge({ value, max, color, label, valueLabel }: ArcGaugeProps) {
  const cx = 60;
  const cy = 55;
  const r = 35;
  const startDeg = 135;
  const fullSpan = 270;
  const fraction = Math.min(Math.max(value / max, 0), 1);
  const endDeg = startDeg + fullSpan * fraction;
  const bgPath = describeArc(cx, cy, r, startDeg, startDeg + fullSpan);
  const fillPath = fraction > 0.001 ? describeArc(cx, cy, r, startDeg, endDeg) : '';

  return (
    <svg width={120} height={100} style={{ overflow: 'visible' }}>
      <path d={bgPath} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={8} strokeLinecap="round" />
      {fillPath && (
        <path d={fillPath} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
      )}
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight="bold" fill={color} fontFamily={C.mono}>
        {valueLabel}
      </text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize={9} fill={C.muted} fontFamily={C.mono}
        style={{ textTransform: 'uppercase' }}>
        {label}
      </text>
    </svg>
  );
}

// ─── MINI SPARKLINE ──────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 120, height = 30 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 0.01);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
  ).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const MathLabPanel: React.FC<MathLabPanelProps> = ({ onClose, initialVector, cellId, cellVector }) => {
  // ── Simulation refs (not in state → no re-render storms) ──────────────────
  const clockRef = useRef<number>(0);
  const eventsRef = useRef<number[]>([]);
  const speedRef = useRef<number>(1);
  const pausedRef = useRef<boolean>(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const lastRealTimeRef = useRef<number>(performance.now());

  // ── React state ────────────────────────────────────────────────────────────
  const [selectedVector, setSelectedVector] = useState(initialVector || cellVector || 'ssh');
  const [availableVectors, setAvailableVectors] = useState<string[]>(['ssh', 'rdp', 'http', 'dns_amp']);
  const [params, setParams] = useState({ mu_base: 0.12, alpha: 0.8, beta: 1.5 });
  const [covariates, setCovariates] = useState({ s_t: 1.0, e_t: 1.0, c_t: 1.0 });
  const [currentLambda, setCurrentLambda] = useState<number>(0.12);
  const [branchingRatio, setBranchingRatio] = useState<number>(0.533);
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null);
  const [activeSpeed, setActiveSpeed] = useState<number | null>(1);
  const [excitationFraction, setExcitationFraction] = useState<number>(0);
  const [muT, setMuT] = useState<number>(0.12);

  // Real data state
  const [realSeasonal, setRealSeasonal] = useState<any>(null);
  const [realEvents, setRealEvents] = useState<any[]>([]);
  const [realCampaigns, setRealCampaigns] = useState<any[]>([]);
  const [backtest, setBacktest] = useState<any>(null);
  const [cellHistory, setCellHistory] = useState<any>(null);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'fallback'>('loading');
  const [activeTab, setActiveTab] = useState<'simulation' | 'forecast' | 'backtest'>('simulation');
  const [realEventCount, setRealEventCount] = useState(0);

  // Refs for real covariate values (used in animation loop without re-renders)
  const realCovRef = useRef({ s_t: 1.0, e_t: 1.0, c_t: 1.0 });
  const realCovDescRef = useRef({ s_desc: '', e_desc: '', c_desc: '' });

  // Throttle ref for React state updates
  const lastStateUpdateRef = useRef<number>(0);

  // ── Fetch available vectors ────────────────────────────────────────────────
  useEffect(() => {
    fetch("/v1/vectors")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableVectors(data.map((v: any) => v.name));
        }
      })
      .catch(() => {});
  }, []);

  // ── Fetch real Hawkes params when vector changes ───────────────────────────
  useEffect(() => {
    setDataSource('loading');
    fetch(`/v1/params?vector=${selectedVector}&res=2.5`)
      .then(r => r.json())
      .then(data => {
        const feats = data.features || [];
        if (feats.length > 0) {
          const mus = feats.map((f: any) => f.properties.mu).sort((a: number, b: number) => a - b);
          const betas = feats.map((f: any) => f.properties.beta).sort((a: number, b: number) => a - b);
          const nbrs = feats.map((f: any) => f.properties.n_br).sort((a: number, b: number) => a - b);
          const median = (arr: number[]) => arr[Math.floor(arr.length / 2)];
          const mu = median(mus);
          const beta = median(betas);
          const n_br = median(nbrs);
          const simBeta = Math.min(beta, 5.0);
          const simAlpha = n_br * simBeta;
          setParams({ mu_base: Math.min(mu, 1.0), alpha: simAlpha, beta: simBeta });
          setBranchingRatio(n_br);
          setDataSource('live');
        } else {
          setDataSource('fallback');
        }
      })
      .catch(() => setDataSource('fallback'));
  }, [selectedVector]);

  // ── Fetch real covariates ──────────────────────────────────────────────────
  useEffect(() => {
    // Seasonal
    fetch("/v1/context/seasonal")
      .then(r => r.json())
      .then(data => {
        setRealSeasonal(data);
        const vData = data.vectors?.[selectedVector];
        if (vData) {
          realCovRef.current.s_t = vData.current_s_t || 1.0;
          const monthName = MONTH_NAMES[vData.current_month_idx || 0];
          const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][vData.current_dow_idx || 0];
          realCovDescRef.current.s_desc = `STL decomposition — ${monthName} × ${dow} = ${(vData.current_s_t || 1).toFixed(3)}`;
        }
      })
      .catch(() => {});

    // Events
    fetch("/v1/context/events?active_only=true")
      .then(r => r.json())
      .then(data => {
        const events = data.events || [];
        setRealEvents(events);
        // Compute E(t) = product of (1 + impact * weight) for active events matching vector
        const vectorEvents = events.filter((e: any) =>
          !e.vectors || e.vectors.length === 0 || e.vectors.includes(selectedVector)
        );
        let e_t = 1.0;
        const activeNames: string[] = [];
        vectorEvents.forEach((e: any) => {
          e_t *= (1.0 + (e.impact || 0) * 0.5);
          activeNames.push(e.name);
        });
        realCovRef.current.e_t = e_t;
        realCovDescRef.current.e_desc = activeNames.length > 0
          ? `${activeNames.length} active: ${activeNames.slice(0, 2).join(', ')}${activeNames.length > 2 ? ` +${activeNames.length - 2}` : ''}`
          : 'No active events affecting this vector';
      })
      .catch(() => {});

    // Campaigns
    fetch("/v1/context/campaigns?active_only=true")
      .then(r => r.json())
      .then(data => {
        const campaigns = data.campaigns || [];
        setRealCampaigns(campaigns);
        const vectorCampaigns = campaigns.filter((c: any) => c.vectors?.includes(selectedVector));
        let c_t = 1.0;
        const activeGroups: string[] = [];
        vectorCampaigns.forEach((c: any) => {
          const monthIdx = new Date().getMonth();
          const monthPos = c.months?.indexOf(monthIdx + 1);
          if (monthPos >= 0 && c.intensity?.[monthPos]) {
            c_t *= (1.0 + c.intensity[monthPos] * 0.3);
            activeGroups.push(c.group);
          }
        });
        realCovRef.current.c_t = c_t;
        realCovDescRef.current.c_desc = activeGroups.length > 0
          ? `Active: ${activeGroups.join(', ')}`
          : 'No active campaigns for this vector';
      })
      .catch(() => {});

    // Backtest
    fetch(`/v1/context/backtest?vector=${selectedVector}`)
      .then(r => r.json())
      .then(setBacktest)
      .catch(() => {});
  }, [selectedVector]);

  // ── Fetch cell history if cellId provided ──────────────────────────────────
  useEffect(() => {
    if (!cellId) return;
    const v = cellVector || selectedVector;
    fetch(`/v1/cells/${cellId}/history?hours=48&vector=${v}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setCellHistory)
      .catch(() => setCellHistory(null));
  }, [cellId, cellVector, selectedVector]);

  // ── SSE real event counter ─────────────────────────────────────────────────
  useEffect(() => {
    const evtSource = new EventSource("/v1/events/stream?last_event_id=0");
    let count = 0;
    evtSource.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (ev.vector === selectedVector) count++;
      } catch {}
    };
    const id = setInterval(() => {
      setRealEventCount(count);
      count = 0;
    }, 5000);
    return () => { evtSource.close(); clearInterval(id); };
  }, [selectedVector]);

  // ── Chart drawing (imperative DOM manipulation) ───────────────────────────
  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const W = 820;
    const H = 200;
    const xLeft = 20;
    const xRight = 800;
    const yTop = 10;
    const yBottom = 180;
    const chartW = xRight - xLeft;
    const chartH = yBottom - yTop;

    const t = clockRef.current;
    const { mu_base, alpha, beta } = params;
    const { s_t: covS, e_t: covE, c_t: covC } = realCovRef.current;

    const computeMu = (tp: number): number => {
      // Use real covariates with gentle time variation for visual interest
      const sV = covS * (1.0 + 0.05 * Math.sin(tp / 55));
      const eV = covE;
      const cV = covC * (1.0 + 0.03 * Math.sin(tp / 110));
      return mu_base * sV * eV * cV;
    };

    const computeLambda = (tp: number, evts: number[]): number => {
      const mu = computeMu(tp);
      const exc = evts
        .filter(ti => ti <= tp && ti > tp - 120)
        .reduce((s, ti) => s + alpha * Math.exp(-beta * (tp - ti)), 0);
      return mu + exc;
    };

    const tStart = t - 120;
    const tEnd = t + 30;
    const visibleEvents = eventsRef.current.filter(ti => ti >= tStart && ti <= t);

    let yMax = 0.01;
    for (let i = 0; i <= 60; i++) {
      const tp = tStart + (i / 60) * (tEnd - tStart);
      const lv = computeLambda(tp, visibleEvents);
      if (lv > yMax) yMax = lv;
    }
    yMax = yMax * 1.15 + 0.05;

    const mapX = (tp: number): number => xLeft + ((tp - tStart) / (tEnd - tStart)) * chartW;
    const mapY = (lv: number): number => yBottom - (lv / yMax) * chartH;

    const mkEl = (tag: string): SVGElement => document.createElementNS('http://www.w3.org/2000/svg', tag);
    const setA = (el: SVGElement, attrs: Record<string, string | number>) => {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    };
    const pointsToD = (pts: [number, number][]): string => {
      if (!pts.length) return '';
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
    };

    // Grid lines
    [0.25, 0.5, 0.75].forEach(frac => {
      const gy = yTop + (1 - frac) * chartH;
      const line = mkEl('line') as SVGLineElement;
      setA(line, { x1: xLeft, y1: gy, x2: xRight, y2: gy, stroke: 'rgba(0,180,255,0.1)', 'stroke-dasharray': '2,4', 'stroke-width': 1 });
      svg.appendChild(line);
    });

    // μ baseline
    const muNow = computeMu(t);
    const muLineY = mapY(muNow);
    if (muLineY >= yTop && muLineY <= yBottom) {
      const muLine = mkEl('line') as SVGLineElement;
      setA(muLine, { x1: xLeft, y1: muLineY, x2: xRight, y2: muLineY, stroke: '#22c55e', 'stroke-dasharray': '4,4', 'stroke-width': 1, opacity: 0.7 });
      svg.appendChild(muLine);
    }

    // Excitation kernels
    visibleEvents.forEach(ti => {
      const kernelPts: [number, number][] = [];
      const kEnd = Math.min(t + 30, ti + 15);
      for (let i = 0; i <= 80; i++) {
        const tp = ti + (i / 80) * (kEnd - ti);
        const kv = alpha * Math.exp(-beta * (tp - ti));
        kernelPts.push([mapX(tp), mapY(computeMu(tp) + kv)]);
      }
      if (kernelPts.length > 1) {
        const kPath = mkEl('path') as SVGPathElement;
        setA(kPath, { d: pointsToD(kernelPts), fill: 'none', stroke: 'rgba(255,140,50,0.6)', 'stroke-dasharray': '3,3', 'stroke-width': 1 });
        svg.appendChild(kPath);
      }
    });

    // Total λ(t) — past
    {
      const pastPts: [number, number][] = [];
      for (let i = 0; i <= 200; i++) {
        const tp = tStart + (i / 200) * 120;
        pastPts.push([mapX(tp), mapY(computeLambda(tp, visibleEvents))]);
      }
      const pastPath = mkEl('path') as SVGPathElement;
      const vecColor = VECTOR_COLORS[selectedVector] || C.accent;
      setA(pastPath, { d: pointsToD(pastPts), fill: 'none', stroke: vecColor, 'stroke-width': 2 });
      svg.appendChild(pastPath);
    }

    // Total λ(t) — future projection
    {
      const futurePts: [number, number][] = [];
      for (let i = 0; i <= 80; i++) {
        const tp = t + (i / 80) * 30;
        const decayExc = visibleEvents.reduce((s, ti) => s + alpha * Math.exp(-beta * (tp - ti)), 0);
        futurePts.push([mapX(tp), mapY(computeMu(tp) + decayExc)]);
      }
      const futurePath = mkEl('path') as SVGPathElement;
      setA(futurePath, { d: pointsToD(futurePts), fill: 'none', stroke: `${VECTOR_COLORS[selectedVector] || C.accent}50`, 'stroke-dasharray': '5,5', 'stroke-width': 1.5 });
      svg.appendChild(futurePath);
    }

    // Cursor line
    {
      const curLine = mkEl('line') as SVGLineElement;
      setA(curLine, { x1: mapX(t), y1: yTop, x2: mapX(t), y2: yBottom, stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 1 });
      svg.appendChild(curLine);
    }

    // Event ticks
    visibleEvents.forEach(ti => {
      const tx = mapX(ti);
      if (tx < xLeft || tx > xRight) return;
      const tick = mkEl('line') as SVGLineElement;
      setA(tick, { x1: tx, y1: 170, x2: tx, y2: 178, stroke: '#f97316', 'stroke-width': 2 });
      svg.appendChild(tick);
    });

    // Axis labels
    const xLabels: [number, string][] = [[tStart, '-120s'], [tStart + 60, '-60s'], [t, 'now'], [t + 30, '+30s']];
    xLabels.forEach(([tp, lbl]) => {
      const txt = mkEl('text') as SVGTextElement;
      setA(txt, { x: mapX(tp), y: H - 2, 'text-anchor': 'middle', 'font-size': 9, fill: 'rgba(91,125,168,0.8)', 'font-family': C.mono });
      txt.textContent = lbl;
      svg.appendChild(txt);
    });
    [{v: 0, lbl: '0'}, {v: yMax, lbl: yMax.toFixed(2)}].forEach(({ v, lbl }) => {
      const txt = mkEl('text') as SVGTextElement;
      setA(txt, { x: xLeft - 2, y: mapY(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'rgba(91,125,168,0.8)', 'font-family': C.mono });
      txt.textContent = lbl;
      svg.appendChild(txt);
    });

    // NOW label
    {
      const nowTxt = mkEl('text') as SVGTextElement;
      setA(nowTxt, { x: mapX(t) + 3, y: yTop + 8, 'font-size': 8, fill: 'rgba(255,255,255,0.5)', 'font-family': C.mono });
      nowTxt.textContent = 'NOW';
      svg.appendChild(nowTxt);
    }
  }, [params, selectedVector]);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    lastRealTimeRef.current = performance.now();

    const loop = (realNow: number) => {
      const dt = (realNow - lastRealTimeRef.current) / 1000;
      lastRealTimeRef.current = realNow;

      if (!pausedRef.current) {
        clockRef.current += dt * speedRef.current;
        const t = clockRef.current;
        const { s_t: covS, e_t: covE, c_t: covC } = realCovRef.current;

        // Use real covariates with gentle time variation
        const s_t = covS * (1.0 + 0.05 * Math.sin(t / 55));
        const e_t = covE;
        const c_t = covC * (1.0 + 0.03 * Math.sin(t / 110));
        const mu_t = params.mu_base * s_t * e_t * c_t;

        const events = eventsRef.current.filter(ti => ti > t - 120);
        eventsRef.current = events;

        const excitation = events.reduce(
          (sum, ti) => sum + params.alpha * Math.exp(-params.beta * (t - ti)),
          0,
        );
        const lambda_t = mu_t + excitation;

        if (Math.random() < lambda_t * dt) {
          eventsRef.current = [...eventsRef.current, t];
        }

        if (realNow - lastStateUpdateRef.current > 100) {
          lastStateUpdateRef.current = realNow;
          setCovariates({
            s_t: Math.round(s_t * 1000) / 1000,
            e_t: Math.round(e_t * 1000) / 1000,
            c_t: Math.round(c_t * 1000) / 1000,
          });
          setCurrentLambda(Math.round(lambda_t * 1000) / 1000);
          setBranchingRatio(Math.round((params.alpha / params.beta) * 1000) / 1000);
          setMuT(Math.round(mu_t * 1000) / 1000);
          setExcitationFraction(lambda_t > 0 ? excitation / lambda_t : 0);
        }

        drawChart();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [params, drawChart]);

  // ── Speed control ─────────────────────────────────────────────────────────
  const handleSpeed = (speed: number | null) => {
    setActiveSpeed(speed);
    if (speed === null) {
      pausedRef.current = true;
    } else {
      pausedRef.current = false;
      speedRef.current = speed;
    }
  };

  // ── Derived display values ────────────────────────────────────────────────
  const { s_t, e_t, c_t } = covariates;
  const mu_t_display = muT > 0 ? muT : params.mu_base;

  const branchingColor =
    branchingRatio < 0.5 ? '#22c55e' : branchingRatio < 0.8 ? '#eab308' : '#ef4444';
  const branchingText =
    branchingRatio < 0.5 ? 'SUBCRITICAL' : branchingRatio < 0.8 ? 'NEAR-CRITICAL' : 'SUPERCRITICAL';

  const muBase = params.mu_base;
  const segBase = mu_t_display > 0 ? (muBase / mu_t_display) * 100 : 25;
  const segS = mu_t_display > 0 ? ((muBase * s_t - muBase) / mu_t_display) * 100 : 25;
  const segE = mu_t_display > 0 ? ((muBase * s_t * e_t - muBase * s_t) / mu_t_display) * 100 : 25;
  const segC = Math.max(0, 100 - segBase - segS - segE);

  // ── Styles ────────────────────────────────────────────────────────────────
  const panelStyle: CSSProperties = {
    position: 'fixed', top: '60px', right: '16px',
    width: '880px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto', zIndex: 1200, borderRadius: '10px',
    background: C.bg, border: `1px solid ${C.border}`,
    boxShadow: '0 8px 60px rgba(0,0,0,0.7)', backdropFilter: 'blur(24px)',
    color: C.text, fontFamily: C.mono,
  };
  const sectionStyle: CSSProperties = { padding: '12px 18px', borderBottom: `1px solid ${C.border}` };
  const sliderStyle: CSSProperties = {
    WebkitAppearance: 'none', appearance: 'none', width: '100%', height: '4px',
    borderRadius: '2px', background: `linear-gradient(to right, ${VECTOR_COLORS[selectedVector] || C.accent}, rgba(0,204,255,0.3))`,
    outline: 'none', cursor: 'pointer',
  };
  const speedBtnActive: CSSProperties = {
    background: 'rgba(0,204,255,0.15)', color: '#00ccff', border: '1px solid rgba(0,204,255,0.4)',
    borderRadius: '4px', padding: '3px 9px', fontFamily: C.mono, fontSize: '12px', cursor: 'pointer',
  };
  const speedBtnInactive: CSSProperties = {
    background: 'transparent', color: C.muted, border: `1px solid ${C.border}`,
    borderRadius: '4px', padding: '3px 9px', fontFamily: C.mono, fontSize: '12px', cursor: 'pointer',
  };
  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px',
    fontFamily: C.mono, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: active ? 'rgba(0,204,255,0.12)' : 'transparent',
    color: active ? C.accent : C.muted,
    border: `1px solid ${active ? 'rgba(0,204,255,0.3)' : 'transparent'}`,
  });

  const vecColor = VECTOR_COLORS[selectedVector] || C.accent;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={panelStyle}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '22px', fontWeight: 'bold', color: C.accent, letterSpacing: '0.04em' }}>
              ∫ MATH LAB
            </span>
            {/* Data source badge */}
            <span style={{
              fontSize: '9px', padding: '2px 8px', borderRadius: '3px',
              background: dataSource === 'live' ? 'rgba(34,197,94,0.15)' : 'rgba(255,107,107,0.15)',
              color: dataSource === 'live' ? '#22c55e' : '#ff6b6b',
              border: `1px solid ${dataSource === 'live' ? 'rgba(34,197,94,0.3)' : 'rgba(255,107,107,0.3)'}`,
            }}>
              {dataSource === 'live' ? 'LIVE DATA' : dataSource === 'loading' ? 'LOADING...' : 'FALLBACK'}
            </span>
            {realEventCount > 0 && (
              <span style={{ fontSize: '9px', color: C.muted }}>
                {realEventCount} {selectedVector} events/5s
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '3px' }}>
            λ(t) = μ(t) + Σ α·e<sup>−β(t−tᵢ)</sup>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Vector selector */}
          <select
            value={selectedVector}
            onChange={e => setSelectedVector(e.target.value)}
            style={{
              background: 'rgba(10,20,40,0.9)', color: vecColor, border: `1px solid ${vecColor}40`,
              borderRadius: '4px', padding: '3px 8px', fontFamily: C.mono, fontSize: '11px',
              cursor: 'pointer', outline: 'none',
            }}
          >
            {availableVectors.map(v => (
              <option key={v} value={v} style={{ background: '#0a1428', color: VECTOR_COLORS[v] || C.accent }}>
                {v.toUpperCase().replace('_', ' ')}
              </option>
            ))}
          </select>
          {/* Speed controls */}
          {SPEEDS.map(s => (
            <button key={s.label} style={activeSpeed === s.value ? speedBtnActive : speedBtnInactive}
              onClick={() => handleSpeed(s.value)}>
              {s.label}
            </button>
          ))}
          <button onClick={onClose} style={{
            ...speedBtnInactive, color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)',
            fontSize: '16px', lineHeight: 1, padding: '1px 8px', marginLeft: '8px',
          }}>×</button>
        </div>
      </div>

      {/* ── TAB BAR ────────────────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, display: 'flex', gap: '6px', paddingTop: '8px', paddingBottom: '8px' }}>
        <div style={tabStyle(activeTab === 'simulation')} onClick={() => setActiveTab('simulation')}>Simulation</div>
        <div style={tabStyle(activeTab === 'forecast')} onClick={() => setActiveTab('forecast')}>Forecast & Covariates</div>
        <div style={tabStyle(activeTab === 'backtest')} onClick={() => setActiveTab('backtest')}>Model Backtest</div>
        {cellHistory && (
          <div style={{ marginLeft: 'auto', fontSize: '9px', color: '#22c55e', padding: '6px 10px', background: 'rgba(34,197,94,0.08)', borderRadius: '4px', border: '1px solid rgba(34,197,94,0.2)' }}>
            CELL #{cellId} · {cellHistory.vector?.toUpperCase()} · {cellHistory.severity?.toUpperCase()}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── TAB: SIMULATION ──────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'simulation' && (
        <>
          {/* Intensity Chart */}
          <div style={{ ...sectionStyle, paddingTop: '10px', paddingBottom: '6px' }}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Intensity λ(t) — 120s Window + 30s Projection · <span style={{ color: vecColor }}>{selectedVector.toUpperCase()}</span>
            </div>
            <svg ref={svgRef} width={820} height={200} style={{ display: 'block', maxWidth: '100%' }}
              viewBox="0 0 820 200" preserveAspectRatio="xMidYMid meet" />
          </div>

          {/* Live Equation */}
          <div style={sectionStyle}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Live Equation
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <span style={{ color: C.text }}>λ(t) =</span>
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={termBox('#22c55e', highlightedTerm === 'mu')}
                  onMouseEnter={() => setHighlightedTerm('mu')} onMouseLeave={() => setHighlightedTerm(null)}>
                  μ(t)
                </span>
                <span style={{ fontSize: '9px', color: '#22c55e', marginTop: '2px' }}>= {mu_t_display.toFixed(3)}</span>
              </div>
              <span style={{ color: C.muted }}> + Σᵢ </span>
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={termBox('#f97316', highlightedTerm === 'alpha')}
                  onMouseEnter={() => setHighlightedTerm('alpha')} onMouseLeave={() => setHighlightedTerm(null)}>
                  α
                </span>
                <span style={{ fontSize: '9px', color: '#f97316', marginTop: '2px' }}>{params.alpha.toFixed(2)}</span>
              </div>
              <span style={{ color: C.muted }}> · e^&#123;</span>
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={termBox('#3b82f6', highlightedTerm === 'beta')}
                  onMouseEnter={() => setHighlightedTerm('beta')} onMouseLeave={() => setHighlightedTerm(null)}>
                  −β
                </span>
                <span style={{ fontSize: '9px', color: '#3b82f6', marginTop: '2px' }}>{params.beta.toFixed(2)}</span>
              </div>
              <span style={{ color: C.muted }}>(t−tᵢ)&#125;</span>
              <div style={{ marginLeft: '8px', padding: '4px 10px', background: `${vecColor}10`, border: `1px solid ${vecColor}40`, borderRadius: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ color: vecColor, fontSize: '13px', fontWeight: 'bold' }}>= {currentLambda.toFixed(3)}</span>
                <span style={{ color: C.muted, fontSize: '9px' }}>λ(t) now</span>
              </div>
              <div style={{ marginLeft: '14px', padding: '4px 12px', background: `rgba(${hexToRgb(branchingColor)}, 0.12)`, border: `1px solid rgba(${hexToRgb(branchingColor)}, 0.4)`, borderRadius: '5px' }}>
                <span style={{ color: branchingColor, fontSize: '13px' }}>n̂ = α/β = {branchingRatio.toFixed(3)}</span>
                <span style={{ color: branchingColor, fontSize: '10px', marginLeft: '8px' }}>{branchingText}</span>
              </div>
            </div>
          </div>

          {/* Covariate Decomposition — now with REAL data */}
          <div style={sectionStyle}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              μ(t) = μ_base × S(t) × E(t) × C(t)
              {dataSource === 'live' && <span style={{ color: '#22c55e', marginLeft: '8px' }}>LIVE COVARIATES</span>}
            </div>
            <div style={{ display: 'flex', height: '22px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px', border: `1px solid ${C.border}` }}>
              {[
                { w: segBase, color: '#22c55e', label: 'BASE' },
                { w: Math.max(0, segS), color: '#3b82f6', label: 'S(t)' },
                { w: Math.max(0, segE), color: '#f97316', label: 'E(t)' },
                { w: Math.max(0, segC), color: '#8b5cf6', label: 'C(t)' },
              ].map(seg => (
                <div key={seg.label} style={{
                  width: `${seg.w}%`, background: seg.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '9px', color: 'rgba(0,0,0,0.8)', fontFamily: C.mono, fontWeight: 'bold',
                  overflow: 'hidden', transition: 'width 0.3s', minWidth: seg.w > 4 ? undefined : 0,
                }}>
                  {seg.w > 6 ? seg.label : ''}
                </div>
              ))}
            </div>
            {/* Teaching cards with REAL descriptions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                {
                  color: '#22c55e', title: 'μ_base', value: params.mu_base.toFixed(3),
                  desc: dataSource === 'live'
                    ? `Median baseline from ${selectedVector.toUpperCase()} MLE fit across all grid cells`
                    : 'Baseline arrival rate — steady-state SOC noise floor',
                },
                {
                  color: '#3b82f6', title: 'S(t)', value: s_t.toFixed(3),
                  desc: realCovDescRef.current.s_desc || 'Seasonal multiplier from STL decomposition',
                },
                {
                  color: '#f97316', title: 'E(t)', value: e_t.toFixed(3),
                  desc: realCovDescRef.current.e_desc || 'Event calendar uplift',
                },
                {
                  color: '#8b5cf6', title: 'C(t)', value: c_t.toFixed(3),
                  desc: realCovDescRef.current.c_desc || 'Campaign recurrence multiplier',
                },
              ].map(card => (
                <div key={card.title} style={{ background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(0,180,255,0.12)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ color: card.color, fontSize: '11px', fontWeight: 'bold' }}>{card.title}</div>
                  <div style={{ color: card.color, fontSize: '20px', fontWeight: 'bold', lineHeight: 1.2 }}>{card.value}</div>
                  <div style={{ color: C.muted, fontSize: '10px', marginTop: '4px', lineHeight: 1.4 }}>{card.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Parameter Dials */}
          <div style={sectionStyle}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Process Parameters · <span style={{ color: vecColor }}>{selectedVector.toUpperCase()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '8px' }}>
              <ArcGauge value={mu_t_display} max={0.5} color="#22c55e" label="μ(t)" valueLabel={mu_t_display.toFixed(3)} />
              <ArcGauge value={params.alpha} max={2.0} color="#f97316" label="α" valueLabel={params.alpha.toFixed(2)} />
              <ArcGauge value={params.beta} max={3.0} color="#3b82f6" label="β" valueLabel={params.beta.toFixed(2)} />
              <ArcGauge value={branchingRatio} max={1.0} color={branchingColor} label="n̂ = α/β" valueLabel={branchingRatio.toFixed(3)} />
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '9px', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>
                Process State
              </div>
              <div style={{ display: 'flex', height: '18px', borderRadius: '4px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                <div style={{ width: `${(1 - excitationFraction) * 100}%`, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'rgba(0,0,0,0.8)', fontWeight: 'bold', transition: 'width 0.3s' }}>
                  {(1 - excitationFraction) * 100 > 15 ? 'BACKGROUND' : ''}
                </div>
                <div style={{ width: `${excitationFraction * 100}%`, background: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'rgba(0,0,0,0.8)', fontWeight: 'bold', transition: 'width 0.3s' }}>
                  {excitationFraction * 100 > 15 ? 'SELF-EXCITATION' : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Parameter Sliders */}
          <div style={{ ...sectionStyle, borderBottom: 'none' }}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Parameter Controls
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#22c55e' }}>μ_base</span>
                  <span style={{ fontSize: '11px', color: C.text }}>{params.mu_base.toFixed(3)}</span>
                </div>
                <input type="range" min={0.01} max={0.5} step={0.01} value={params.mu_base}
                  onChange={e => setParams(p => ({ ...p, mu_base: parseFloat(e.target.value) }))} style={sliderStyle} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#f97316' }}>α (jump)</span>
                  <span style={{ fontSize: '11px', color: C.text }}>{params.alpha.toFixed(2)}</span>
                </div>
                <input type="range" min={0.1} max={2.0} step={0.05} value={params.alpha}
                  onChange={e => setParams(p => ({ ...p, alpha: parseFloat(e.target.value) }))} style={sliderStyle} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', color: '#3b82f6' }}>β (decay)</span>
                  <span style={{ fontSize: '11px', color: C.text }}>{params.beta.toFixed(2)}</span>
                </div>
                <input type="range" min={0.1} max={3.0} step={0.05} value={params.beta}
                  onChange={e => setParams(p => ({ ...p, beta: parseFloat(e.target.value) }))} style={sliderStyle} />
              </div>
            </div>
            <div style={{
              marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
              background: `rgba(${hexToRgb(branchingColor)}, 0.08)`, border: `1px solid rgba(${hexToRgb(branchingColor)}, 0.3)`, borderRadius: '6px',
            }}>
              <span style={{ color: C.muted, fontSize: '11px' }}>Live:</span>
              <span style={{ color: branchingColor, fontSize: '14px', fontWeight: 'bold' }}>
                n̂ = {params.alpha.toFixed(2)} / {params.beta.toFixed(2)} = {(params.alpha / params.beta).toFixed(3)}
              </span>
              <span style={{ color: branchingColor, fontSize: '11px' }}>→ {branchingText}</span>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── TAB: FORECAST & COVARIATES ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'forecast' && (
        <>
          {/* Seasonal Profile */}
          <div style={sectionStyle}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Seasonal Profile S(t) — <span style={{ color: vecColor }}>{selectedVector.toUpperCase()}</span>
            </div>
            {realSeasonal?.vectors?.[selectedVector] ? (
              <div>
                <div style={{ display: 'flex', gap: '4px', height: '60px', alignItems: 'flex-end', marginBottom: '6px' }}>
                  {(realSeasonal.vectors[selectedVector].monthly || []).map((v: number, i: number) => {
                    const currentMonth = new Date().getMonth();
                    const isCurrent = i === currentMonth;
                    const barH = Math.max(4, ((v - 0.7) / 0.7) * 56);
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <div style={{ fontSize: '8px', color: isCurrent ? vecColor : C.muted }}>{v.toFixed(2)}</div>
                        <div style={{
                          width: '100%', height: `${barH}px`, borderRadius: '2px',
                          background: isCurrent ? vecColor : v >= 1.0 ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.3)',
                          border: isCurrent ? `2px solid ${vecColor}` : 'none',
                        }} />
                        <div style={{ fontSize: '8px', color: isCurrent ? vecColor : C.muted, fontWeight: isCurrent ? 700 : 400 }}>
                          {MONTH_NAMES[i]}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <div style={{ fontSize: '9px', color: C.muted }}>
                    Day-of-week: [{(realSeasonal.vectors[selectedVector].dow || []).map((d: number) => d.toFixed(2)).join(', ')}]
                  </div>
                  <div style={{ fontSize: '9px', color: vecColor, fontWeight: 600 }}>
                    Current S(t) = {realSeasonal.vectors[selectedVector].current_s_t?.toFixed(3)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>Loading seasonal data...</div>
            )}
          </div>

          {/* Active Events */}
          <div style={sectionStyle}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Active Events E(t) — {realEvents.length} events active
            </div>
            {realEvents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                {realEvents.slice(0, 8).map((ev: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(10,20,40,0.8)', borderRadius: '4px', border: '1px solid rgba(0,180,255,0.08)' }}>
                    <div style={{
                      width: '4px', height: '24px', borderRadius: '2px',
                      background: ev.impact >= 0.7 ? '#ef4444' : ev.impact >= 0.4 ? '#f97316' : '#22c55e',
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '10px', color: C.text, fontWeight: 600 }}>{ev.name}</div>
                      <div style={{ fontSize: '9px', color: C.muted }}>{ev.category} · impact: {(ev.impact || 0).toFixed(2)}</div>
                    </div>
                    <div style={{ fontSize: '9px', color: C.muted }}>
                      {ev.vectors?.slice(0, 3).join(', ')}
                    </div>
                    {ev.live && <span style={{ fontSize: '8px', color: '#00ccff', background: 'rgba(0,204,255,0.1)', padding: '1px 5px', borderRadius: '3px' }}>LIVE</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>No active events</div>
            )}
          </div>

          {/* Active Campaigns */}
          <div style={{ ...sectionStyle, borderBottom: 'none' }}>
            <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Campaign Recurrence C(t) — {realCampaigns.length} groups tracked
            </div>
            {realCampaigns.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {realCampaigns.slice(0, 8).map((c: any, i: number) => {
                  const vectorMatch = c.vectors?.includes(selectedVector);
                  const monthIdx = new Date().getMonth() + 1;
                  const isActive = c.months?.includes(monthIdx);
                  return (
                    <div key={i} style={{
                      padding: '8px 10px', borderRadius: '4px',
                      background: vectorMatch && isActive ? 'rgba(249,115,22,0.08)' : 'rgba(10,20,40,0.6)',
                      border: `1px solid ${vectorMatch && isActive ? 'rgba(249,115,22,0.3)' : 'rgba(0,180,255,0.08)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', color: vectorMatch && isActive ? '#f97316' : C.text, fontWeight: 600 }}>
                          {c.group}
                        </span>
                        {isActive && <span style={{ fontSize: '8px', color: '#f97316', background: 'rgba(249,115,22,0.15)', padding: '1px 5px', borderRadius: '3px' }}>ACTIVE</span>}
                      </div>
                      <div style={{ fontSize: '9px', color: C.muted, marginTop: '2px' }}>{c.aka}</div>
                      <div style={{ fontSize: '8px', color: C.muted, marginTop: '3px' }}>
                        Vectors: {c.vectors?.join(', ')} · Months: {c.months?.map((m: number) => MONTH_NAMES[m - 1]).join(', ')}
                      </div>
                      {c.intensity && (
                        <Sparkline data={c.intensity} color={vectorMatch ? '#f97316' : C.muted} width={100} height={16} />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic' }}>Loading campaign data...</div>
            )}
          </div>

          {/* Cell History (if drill-down active) */}
          {cellHistory && (
            <div style={sectionStyle}>
              <div style={{ fontSize: '10px', color: '#22c55e', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Cell Drill-Down — #{cellId} · ({cellHistory.lat?.toFixed(2)}, {cellHistory.lon?.toFixed(2)})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div style={{ background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(0,180,255,0.12)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, textTransform: 'uppercase' }}>Events 24h</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: vecColor }}>{cellHistory.event_count_24h || 0}</div>
                </div>
                <div style={{ background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(0,180,255,0.12)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, textTransform: 'uppercase' }}>Severity</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: cellHistory.severity === 'emergency' ? '#ef4444' : cellHistory.severity === 'warning' ? '#f97316' : '#22c55e' }}>
                    {(cellHistory.severity || 'clear').toUpperCase()}
                  </div>
                </div>
                <div style={{ background: 'rgba(10,20,40,0.8)', border: '1px solid rgba(0,180,255,0.12)', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, textTransform: 'uppercase' }}>n̂ (cell)</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: (cellHistory.current_params?.n_br || 0) >= 0.7 ? '#ef4444' : '#22c55e' }}>
                    {(cellHistory.current_params?.n_br || 0).toFixed(3)}
                  </div>
                </div>
              </div>
              {cellHistory.intensity_history?.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, marginBottom: '4px' }}>48h Intensity</div>
                  <Sparkline data={cellHistory.intensity_history.map((p: any) => p.value)} color={vecColor} width={800} height={40} />
                </div>
              )}
              {cellHistory.branching_history?.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '9px', color: C.muted, marginBottom: '4px' }}>48h Branching Ratio</div>
                  <Sparkline data={cellHistory.branching_history.map((p: any) => p.value)} color={branchingColor} width={800} height={40} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ── TAB: MODEL BACKTEST ──────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'backtest' && (
        <div style={{ ...sectionStyle, borderBottom: 'none' }}>
          <div style={{ fontSize: '10px', color: C.muted, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Model Comparison — <span style={{ color: vecColor }}>{selectedVector.toUpperCase()}</span>
            {backtest?.data_driven && <span style={{ color: '#22c55e', marginLeft: '8px' }}>DATA-DRIVEN</span>}
          </div>
          {backtest?.models ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {Object.entries(backtest.models).map(([key, model]: [string, any]) => {
                  const mapeColor = model.mape < 0.5 ? '#22c55e' : model.mape < 0.7 ? '#eab308' : '#ef4444';
                  const isBest = key === 'full_context';
                  return (
                    <div key={key} style={{
                      padding: '12px', borderRadius: '6px',
                      background: isBest ? 'rgba(0,204,255,0.06)' : 'rgba(10,20,40,0.8)',
                      border: `1px solid ${isBest ? 'rgba(0,204,255,0.3)' : 'rgba(0,180,255,0.1)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: isBest ? C.accent : C.text }}>
                          {key.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        {model.is_measured && <span style={{ fontSize: '8px', color: '#22c55e', background: 'rgba(34,197,94,0.15)', padding: '1px 5px', borderRadius: '3px' }}>MEASURED</span>}
                      </div>
                      <div style={{ fontSize: '9px', color: C.muted, marginBottom: '10px', lineHeight: 1.4 }}>{model.description}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '8px', color: C.muted, textTransform: 'uppercase' }}>MAPE</div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: mapeColor }}>{(model.mape * 100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '8px', color: C.muted, textTransform: 'uppercase' }}>Coverage 90</div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: model.coverage_90 >= 0.9 ? '#22c55e' : '#eab308' }}>{(model.coverage_90 * 100).toFixed(0)}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '8px', color: C.muted, textTransform: 'uppercase' }}>Brier</div>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: model.brier < 0.2 ? '#22c55e' : '#eab308' }}>{model.brier.toFixed(3)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {backtest.snapshot_count > 0 && (
                <div style={{ marginTop: '12px', fontSize: '9px', color: C.muted, textAlign: 'center' }}>
                  Based on {backtest.snapshot_count.toLocaleString()} forecast snapshots · {backtest.eval_points} evaluation points
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: '10px', color: C.muted, fontStyle: 'italic', textAlign: 'center', padding: '30px 0' }}>
              Loading backtest metrics...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function termBox(color: string, isHighlighted: boolean): CSSProperties {
  return {
    background: isHighlighted ? `rgba(${hexToRgb(color)}, 0.3)` : `rgba(${hexToRgb(color)}, 0.15)`,
    border: `1px solid rgba(${hexToRgb(color)}, 0.4)`,
    borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
    fontFamily: C.mono, fontSize: '14px', color, transition: 'background 0.15s',
  };
}

export default MathLabPanel;
