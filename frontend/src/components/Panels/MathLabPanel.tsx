/**
 * MathLabPanel.tsx
 *
 * Interactive Hawkes Process Mathematics Laboratory
 * Visualises λ(t) = μ(t) + Σ α·e^{-β(t−tᵢ)} in real-time with
 * animated intensity chart, covariate decomposition, arc gauges,
 * and interactive parameter sliders.
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

// ─── PROPS ────────────────────────────────────────────────────────────────────
interface MathLabPanelProps {
  onClose: () => void;
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
      {/* Background arc */}
      <path
        d={bgPath}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={8}
        strokeLinecap="round"
      />
      {/* Filled arc */}
      {fillPath && (
        <path
          d={fillPath}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
        />
      )}
      {/* Center value */}
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        fontSize={14}
        fontWeight="bold"
        fill={color}
        fontFamily={C.mono}
      >
        {valueLabel}
      </text>
      {/* Bottom label */}
      <text
        x={cx}
        y={cy + 30}
        textAnchor="middle"
        fontSize={9}
        fill={C.muted}
        fontFamily={C.mono}
        style={{ textTransform: 'uppercase' }}
      >
        {label}
      </text>
    </svg>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const MathLabPanel: React.FC<MathLabPanelProps> = ({ onClose }) => {
  // ── Simulation refs (not in state → no re-render storms) ──────────────────
  const clockRef = useRef<number>(0);
  const eventsRef = useRef<number[]>([]);
  const speedRef = useRef<number>(1);
  const pausedRef = useRef<boolean>(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const lastRealTimeRef = useRef<number>(performance.now());

  // ── React state (display only) ────────────────────────────────────────────
  const [params, setParams] = useState({ mu_base: 0.12, alpha: 0.8, beta: 1.5 });
  const [covariates, setCovariates] = useState({ s_t: 1.0, e_t: 1.0, c_t: 1.0 });
  const [currentLambda, setCurrentLambda] = useState<number>(0.12);
  const [branchingRatio, setBranchingRatio] = useState<number>(0.533);
  const [highlightedTerm, setHighlightedTerm] = useState<string | null>(null);
  const [activeSpeed, setActiveSpeed] = useState<number | null>(1); // null = paused
  const [excitationFraction, setExcitationFraction] = useState<number>(0);
  const [muT, setMuT] = useState<number>(0.12);

  // Throttle ref for React state updates
  const lastStateUpdateRef = useRef<number>(0);

  // ── Chart drawing (imperative DOM manipulation) ───────────────────────────
  const drawChart = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Clear all children
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
    const { s_t: covS, e_t: covE, c_t: covC } = covariates;

    // Covariate helpers (compute from time)
    const computeMu = (tp: number): number => {
      const sV = 1.0 + 0.28 * Math.sin(tp / 55);
      const eV = 1.0 + (Math.sin(tp / 38) > 0.7 ? 0.45 : 0);
      const cV = 1.0 + 0.18 * Math.sin(tp / 110 + Math.PI / 3);
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

    // Collect visible events
    const visibleEvents = eventsRef.current.filter(ti => ti >= tStart && ti <= t);

    // Determine y domain
    const sampleCount = 60;
    let yMax = 0.01;
    for (let i = 0; i <= sampleCount; i++) {
      const tp = tStart + (i / sampleCount) * (tEnd - tStart);
      const lv = computeLambda(tp, visibleEvents);
      if (lv > yMax) yMax = lv;
    }
    yMax = yMax * 1.15 + 0.05;

    // Mapping functions
    const mapX = (tp: number): number => xLeft + ((tp - tStart) / (tEnd - tStart)) * chartW;
    const mapY = (lv: number): number => yBottom - (lv / yMax) * chartH;

    const mkEl = (tag: string): SVGElement => document.createElementNS('http://www.w3.org/2000/svg', tag);
    const setA = (el: SVGElement, attrs: Record<string, string | number>) => {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    };

    // Helper: build a polyline path string from arrays of [x, y]
    const pointsToD = (pts: [number, number][]): string => {
      if (!pts.length) return '';
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
    };

    // 1. Grid lines
    [0.25, 0.5, 0.75].forEach(frac => {
      const gy = yTop + (1 - frac) * chartH;
      const line = mkEl('line') as SVGLineElement;
      setA(line, { x1: xLeft, y1: gy, x2: xRight, y2: gy, stroke: 'rgba(0,180,255,0.1)', 'stroke-dasharray': '2,4', 'stroke-width': 1 });
      svg.appendChild(line);
    });

    // 2. μ baseline
    const muNow = computeMu(t);
    const muLineY = mapY(muNow);
    if (muLineY >= yTop && muLineY <= yBottom) {
      const muLine = mkEl('line') as SVGLineElement;
      setA(muLine, {
        x1: xLeft, y1: muLineY, x2: xRight, y2: muLineY,
        stroke: '#22c55e', 'stroke-dasharray': '4,4', 'stroke-width': 1, opacity: 0.7,
      });
      svg.appendChild(muLine);
    }

    // 3. Individual excitation kernels (orange dashed)
    visibleEvents.forEach(ti => {
      const kernelPts: [number, number][] = [];
      const kEnd = Math.min(t + 30, ti + 15);
      const kSteps = 80;
      for (let i = 0; i <= kSteps; i++) {
        const tp = ti + (i / kSteps) * (kEnd - ti);
        const kv = alpha * Math.exp(-beta * (tp - ti));
        const mu = computeMu(tp);
        kernelPts.push([mapX(tp), mapY(mu + kv)]);
      }
      if (kernelPts.length > 1) {
        const kPath = mkEl('path') as SVGPathElement;
        setA(kPath, {
          d: pointsToD(kernelPts),
          fill: 'none',
          stroke: 'rgba(255,140,50,0.6)',
          'stroke-dasharray': '3,3',
          'stroke-width': 1,
        });
        svg.appendChild(kPath);
      }
    });

    // 4. Total λ(t) — past (solid cyan)
    {
      const pastPts: [number, number][] = [];
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const tp = tStart + (i / steps) * 120;
        const lv = computeLambda(tp, visibleEvents);
        pastPts.push([mapX(tp), mapY(lv)]);
      }
      const pastPath = mkEl('path') as SVGPathElement;
      setA(pastPath, {
        d: pointsToD(pastPts),
        fill: 'none',
        stroke: '#00ccff',
        'stroke-width': 2,
      });
      svg.appendChild(pastPath);
    }

    // 5. Total λ(t) — future (dashed faded cyan, decay only)
    {
      const futurePts: [number, number][] = [];
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const tp = t + (i / steps) * 30;
        // Future: only decay of existing events, no new spawns
        const decayMu = computeMu(tp);
        const decayExc = visibleEvents.reduce((s, ti) => s + alpha * Math.exp(-beta * (tp - ti)), 0);
        const lv = decayMu + decayExc;
        futurePts.push([mapX(tp), mapY(lv)]);
      }
      const futurePath = mkEl('path') as SVGPathElement;
      setA(futurePath, {
        d: pointsToD(futurePts),
        fill: 'none',
        stroke: 'rgba(0,204,255,0.3)',
        'stroke-dasharray': '5,5',
        'stroke-width': 1.5,
      });
      svg.appendChild(futurePath);
    }

    // 6. Cursor line (vertical at "now")
    {
      const curX = mapX(t);
      const curLine = mkEl('line') as SVGLineElement;
      setA(curLine, {
        x1: curX, y1: yTop, x2: curX, y2: yBottom,
        stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 1,
      });
      svg.appendChild(curLine);
    }

    // 7. Event ticks
    visibleEvents.forEach(ti => {
      const tx = mapX(ti);
      if (tx < xLeft || tx > xRight) return;
      const tick = mkEl('line') as SVGLineElement;
      setA(tick, {
        x1: tx, y1: 170, x2: tx, y2: 178,
        stroke: '#f97316', 'stroke-width': 2,
      });
      svg.appendChild(tick);
    });

    // 8. X-axis labels
    const xLabels: [number, string][] = [
      [tStart, '-120s'],
      [tStart + 60, '-60s'],
      [t, 'now'],
      [t + 30, '+30s'],
    ];
    xLabels.forEach(([tp, lbl]) => {
      const lx = mapX(tp);
      const txt = mkEl('text') as SVGTextElement;
      setA(txt, {
        x: lx, y: H - 2,
        'text-anchor': 'middle',
        'font-size': 9,
        fill: 'rgba(91,125,168,0.8)',
        'font-family': C.mono,
      });
      txt.textContent = lbl;
      svg.appendChild(txt);
    });

    // 9. Y-axis labels
    [{v: 0, lbl: '0'}, {v: yMax, lbl: yMax.toFixed(2)}].forEach(({ v, lbl }) => {
      const ly = mapY(v);
      const txt = mkEl('text') as SVGTextElement;
      setA(txt, {
        x: xLeft - 2, y: ly + 3,
        'text-anchor': 'end',
        'font-size': 9,
        fill: 'rgba(91,125,168,0.8)',
        'font-family': C.mono,
      });
      txt.textContent = lbl;
      svg.appendChild(txt);
    });

    // 10. "NOW" cursor label
    {
      const nowX = mapX(t);
      const nowTxt = mkEl('text') as SVGTextElement;
      setA(nowTxt, {
        x: nowX + 3, y: yTop + 8,
        'font-size': 8,
        fill: 'rgba(255,255,255,0.5)',
        'font-family': C.mono,
      });
      nowTxt.textContent = 'NOW';
      svg.appendChild(nowTxt);
    }
  }, [params, covariates]);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    lastRealTimeRef.current = performance.now();

    const loop = (realNow: number) => {
      const dt = (realNow - lastRealTimeRef.current) / 1000;
      lastRealTimeRef.current = realNow;

      if (!pausedRef.current) {
        clockRef.current += dt * speedRef.current;
        const t = clockRef.current;

        // Covariate oscillations
        const s_t = 1.0 + 0.28 * Math.sin(t / 55);
        const e_t = 1.0 + (Math.sin(t / 38) > 0.7 ? 0.45 : 0);
        const c_t = 1.0 + 0.18 * Math.sin(t / 110 + Math.PI / 3);
        const mu_t = params.mu_base * s_t * e_t * c_t;

        // Prune old events
        const events = eventsRef.current.filter(ti => ti > t - 120);
        eventsRef.current = events;

        // Compute λ(t)
        const excitation = events.reduce(
          (sum, ti) => sum + params.alpha * Math.exp(-params.beta * (t - ti)),
          0,
        );
        const lambda_t = mu_t + excitation;

        // Spawn new event (Poisson thinning)
        if (Math.random() < lambda_t * dt) {
          eventsRef.current = [...eventsRef.current, t];
        }

        // Throttled React state updates (~10fps)
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

        // Redraw chart (imperative, no React re-render)
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
    branchingRatio < 0.5
      ? 'SUBCRITICAL — events dissipate'
      : branchingRatio < 0.8
      ? 'NEAR-CRITICAL — cascade risk'
      : 'SUPERCRITICAL — self-sustaining';

  // Covariate bar segments
  const muBase = params.mu_base;
  const segBase = mu_t_display > 0 ? (muBase / mu_t_display) * 100 : 25;
  const segS = mu_t_display > 0 ? ((muBase * s_t - muBase) / mu_t_display) * 100 : 25;
  const segE = mu_t_display > 0 ? ((muBase * s_t * e_t - muBase * s_t) / mu_t_display) * 100 : 25;
  const segC = Math.max(0, 100 - segBase - segS - segE);

  // ── Term box style builder ─────────────────────────────────────────────────
  const termBox = (color: string, isHighlighted: boolean): CSSProperties => ({
    background: isHighlighted ? `rgba(${hexToRgb(color)}, 0.3)` : `rgba(${hexToRgb(color)}, 0.15)`,
    border: `1px solid rgba(${hexToRgb(color)}, 0.4)`,
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: C.mono,
    fontSize: '14px',
    color: color,
    transition: 'background 0.15s',
  });

  // ── Styles ────────────────────────────────────────────────────────────────
  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: '60px',
    right: '16px',
    width: '860px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto',
    zIndex: 1200,
    borderRadius: '10px',
    background: C.bg,
    border: `1px solid ${C.border}`,
    boxShadow: '0 8px 60px rgba(0,0,0,0.7)',
    backdropFilter: 'blur(24px)',
    color: C.text,
    fontFamily: C.mono,
  };

  const sectionStyle: CSSProperties = {
    padding: '12px 18px',
    borderBottom: `1px solid ${C.border}`,
  };

  const sliderStyle: CSSProperties = {
    WebkitAppearance: 'none',
    appearance: 'none',
    width: '100%',
    height: '4px',
    borderRadius: '2px',
    background: `linear-gradient(to right, ${C.accent}, rgba(0,204,255,0.3))`,
    outline: 'none',
    cursor: 'pointer',
  };

  const speedBtnActive: CSSProperties = {
    background: 'rgba(0,204,255,0.15)',
    color: '#00ccff',
    border: '1px solid rgba(0,204,255,0.4)',
    borderRadius: '4px',
    padding: '3px 9px',
    fontFamily: C.mono,
    fontSize: '12px',
    cursor: 'pointer',
  };
  const speedBtnInactive: CSSProperties = {
    background: 'transparent',
    color: C.muted,
    border: `1px solid ${C.border}`,
    borderRadius: '4px',
    padding: '3px 9px',
    fontFamily: C.mono,
    fontSize: '12px',
    cursor: 'pointer',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={panelStyle}>

      {/* ── SECTION 1: HEADER ─────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: C.accent, fontFamily: C.mono, letterSpacing: '0.04em' }}>
            ∫ MATH LAB
          </div>
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '3px', fontFamily: C.mono }}>
            Hawkes Process: λ(t) = μ(t) + Σ α·e<sup>−β(t−tᵢ)</sup>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {SPEEDS.map(s => (
            <button
              key={s.label}
              style={activeSpeed === s.value ? speedBtnActive : speedBtnInactive}
              onClick={() => handleSpeed(s.value)}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={onClose}
            style={{
              ...speedBtnInactive,
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.4)',
              fontSize: '16px',
              lineHeight: 1,
              padding: '1px 8px',
              marginLeft: '8px',
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── SECTION 2: INTENSITY CHART ────────────────────────────────── */}
      <div style={{ ...sectionStyle, paddingTop: '10px', paddingBottom: '6px' }}>
        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Intensity λ(t) — 120s Window + 30s Projection
        </div>
        <svg
          ref={svgRef}
          width={820}
          height={200}
          style={{ display: 'block', maxWidth: '100%' }}
          viewBox="0 0 820 200"
          preserveAspectRatio="xMidYMid meet"
        />
      </div>

      {/* ── SECTION 3: EQUATION RENDERER ─────────────────────────────── */}
      <div style={{ ...sectionStyle }}>
        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Live Equation
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
          <span style={{ color: C.text, fontFamily: C.mono }}>λ(t) =</span>

          {/* μ(t) term */}
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span
              style={termBox('#22c55e', highlightedTerm === 'mu')}
              onMouseEnter={() => setHighlightedTerm('mu')}
              onMouseLeave={() => setHighlightedTerm(null)}
            >
              μ(t)
            </span>
            <span style={{ fontSize: '9px', color: '#22c55e', marginTop: '2px' }}>
              = {mu_t_display.toFixed(3)}
            </span>
          </div>

          <span style={{ color: C.muted, fontFamily: C.mono }}> + Σᵢ </span>

          {/* α term */}
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span
              style={termBox('#f97316', highlightedTerm === 'alpha')}
              onMouseEnter={() => setHighlightedTerm('alpha')}
              onMouseLeave={() => setHighlightedTerm(null)}
            >
              α
            </span>
            <span style={{ fontSize: '9px', color: '#f97316', marginTop: '2px' }}>
              {params.alpha.toFixed(2)}
            </span>
          </div>

          <span style={{ color: C.muted, fontFamily: C.mono }}> · e^&#123;</span>

          {/* −β term */}
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span
              style={termBox('#3b82f6', highlightedTerm === 'beta')}
              onMouseEnter={() => setHighlightedTerm('beta')}
              onMouseLeave={() => setHighlightedTerm(null)}
            >
              −β
            </span>
            <span style={{ fontSize: '9px', color: '#3b82f6', marginTop: '2px' }}>
              {params.beta.toFixed(2)}
            </span>
          </div>

          <span style={{ color: C.muted, fontFamily: C.mono }}>(t−tᵢ)&#125;</span>

          {/* Total λ(t) live readout */}
          <div style={{
            marginLeft: '8px',
            padding: '4px 10px',
            background: 'rgba(0,204,255,0.08)',
            border: '1px solid rgba(0,204,255,0.3)',
            borderRadius: '5px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <span style={{ color: C.accent, fontFamily: C.mono, fontSize: '13px', fontWeight: 'bold' }}>
              = {currentLambda.toFixed(3)}
            </span>
            <span style={{ color: C.muted, fontSize: '9px' }}>λ(t) now</span>
          </div>

          {/* Branching ratio */}
          <div style={{
            marginLeft: '14px',
            padding: '4px 12px',
            background: `rgba(${hexToRgb(branchingColor)}, 0.12)`,
            border: `1px solid rgba(${hexToRgb(branchingColor)}, 0.4)`,
            borderRadius: '5px',
          }}>
            <span style={{ color: branchingColor, fontFamily: C.mono, fontSize: '13px' }}>
              n̂ = α/β = {branchingRatio.toFixed(3)}
            </span>
            <span style={{ color: branchingColor, fontSize: '10px', marginLeft: '8px' }}>
              {branchingText}
            </span>
          </div>
        </div>
      </div>

      {/* ── SECTION 4: COVARIATE DECOMPOSITION ───────────────────────── */}
      <div style={{ ...sectionStyle }}>
        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          μ(t) = μ_base × S(t) × E(t) × C(t)
        </div>

        {/* Stacked bar */}
        <div style={{ display: 'flex', height: '22px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px', border: `1px solid ${C.border}` }}>
          {[
            { w: segBase, color: '#22c55e', label: 'BASE' },
            { w: Math.max(0, segS), color: '#3b82f6', label: 'S(t)' },
            { w: Math.max(0, segE), color: '#f97316', label: 'E(t)' },
            { w: Math.max(0, segC), color: '#8b5cf6', label: 'C(t)' },
          ].map(seg => (
            <div
              key={seg.label}
              style={{
                width: `${seg.w}%`,
                background: seg.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: 'rgba(0,0,0,0.8)',
                fontFamily: C.mono,
                fontWeight: 'bold',
                overflow: 'hidden',
                transition: 'width 0.3s',
                minWidth: seg.w > 4 ? undefined : 0,
              }}
            >
              {seg.w > 6 ? seg.label : ''}
            </div>
          ))}
        </div>

        {/* Teaching cards: 2×2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            {
              color: '#22c55e',
              title: 'μ_base',
              value: params.mu_base.toFixed(3),
              desc: 'Baseline arrival rate — the steady-state SOC noise floor from historical data',
            },
            {
              color: '#3b82f6',
              title: 'S(t)',
              value: s_t.toFixed(3),
              desc: 'Seasonal multiplier from STL decomposition — Feb patch cycle peaks here',
            },
            {
              color: '#f97316',
              title: 'E(t)',
              value: e_t.toFixed(3),
              desc: 'Event calendar uplift — Patch Tuesday increases HTTP/RDP by 45% this window',
            },
            {
              color: '#8b5cf6',
              title: 'C(t)',
              value: c_t.toFixed(3),
              desc: 'Campaign recurrence — APT28 historically active in Q1, elevating SSH',
            },
          ].map(card => (
            <div
              key={card.title}
              style={{
                background: 'rgba(10,20,40,0.8)',
                border: '1px solid rgba(0,180,255,0.12)',
                borderRadius: '6px',
                padding: '10px',
              }}
            >
              <div style={{ color: card.color, fontSize: '11px', fontFamily: C.mono, fontWeight: 'bold' }}>
                {card.title}
              </div>
              <div style={{ color: card.color, fontSize: '20px', fontWeight: 'bold', fontFamily: C.mono, lineHeight: 1.2 }}>
                {card.value}
              </div>
              <div style={{ color: C.muted, fontSize: '10px', marginTop: '4px', lineHeight: 1.4 }}>
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 5: PARAMETER DIALS ───────────────────────────────── */}
      <div style={{ ...sectionStyle }}>
        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Process Parameters
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '8px' }}>
          <ArcGauge
            value={mu_t_display}
            max={0.5}
            color="#22c55e"
            label="μ(t)"
            valueLabel={mu_t_display.toFixed(3)}
          />
          <ArcGauge
            value={params.alpha}
            max={2.0}
            color="#f97316"
            label="α"
            valueLabel={params.alpha.toFixed(2)}
          />
          <ArcGauge
            value={params.beta}
            max={3.0}
            color="#3b82f6"
            label="β"
            valueLabel={params.beta.toFixed(2)}
          />
          <ArcGauge
            value={branchingRatio}
            max={1.0}
            color={branchingColor}
            label="n̂ = α/β"
            valueLabel={branchingRatio.toFixed(3)}
          />
        </div>

        {/* Process state bar */}
        <div style={{ marginTop: '10px' }}>
          <div style={{ fontSize: '9px', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>
            Process State
          </div>
          <div style={{ display: 'flex', height: '18px', borderRadius: '4px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <div
              style={{
                width: `${(1 - excitationFraction) * 100}%`,
                background: '#22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                fontFamily: C.mono,
                color: 'rgba(0,0,0,0.8)',
                fontWeight: 'bold',
                transition: 'width 0.3s',
              }}
            >
              {(1 - excitationFraction) * 100 > 15 ? 'BACKGROUND' : ''}
            </div>
            <div
              style={{
                width: `${excitationFraction * 100}%`,
                background: '#f97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                fontFamily: C.mono,
                color: 'rgba(0,0,0,0.8)',
                fontWeight: 'bold',
                transition: 'width 0.3s',
              }}
            >
              {excitationFraction * 100 > 15 ? 'SELF-EXCITATION' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 6: PARAMETER SLIDERS ─────────────────────────────── */}
      <div style={{ ...sectionStyle, borderBottom: 'none' }}>
        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Parameter Controls
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          {/* μ_base */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontSize: '11px', color: '#22c55e', fontFamily: C.mono }}>μ_base</span>
              <span style={{ fontSize: '11px', color: C.text, fontFamily: C.mono }}>{params.mu_base.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.5}
              step={0.01}
              value={params.mu_base}
              onChange={e => setParams(p => ({ ...p, mu_base: parseFloat(e.target.value) }))}
              style={sliderStyle}
            />
            <div style={{ fontSize: '9px', color: C.muted, marginTop: '3px' }}>0.01 — 0.5</div>
          </div>

          {/* α */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontSize: '11px', color: '#f97316', fontFamily: C.mono }}>α (jump size)</span>
              <span style={{ fontSize: '11px', color: C.text, fontFamily: C.mono }}>{params.alpha.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.05}
              value={params.alpha}
              onChange={e => setParams(p => ({ ...p, alpha: parseFloat(e.target.value) }))}
              style={sliderStyle}
            />
            <div style={{ fontSize: '9px', color: C.muted, marginTop: '3px' }}>0.1 — 2.0</div>
          </div>

          {/* β */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontSize: '11px', color: '#3b82f6', fontFamily: C.mono }}>β (decay rate)</span>
              <span style={{ fontSize: '11px', color: C.text, fontFamily: C.mono }}>{params.beta.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={3.0}
              step={0.05}
              value={params.beta}
              onChange={e => setParams(p => ({ ...p, beta: parseFloat(e.target.value) }))}
              style={sliderStyle}
            />
            <div style={{ fontSize: '9px', color: C.muted, marginTop: '3px' }}>0.1 — 3.0</div>
          </div>
        </div>

        {/* Live n̂ readout under sliders */}
        <div style={{
          marginTop: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 14px',
          background: `rgba(${hexToRgb(branchingColor)}, 0.08)`,
          border: `1px solid rgba(${hexToRgb(branchingColor)}, 0.3)`,
          borderRadius: '6px',
        }}>
          <span style={{ color: C.muted, fontSize: '11px', fontFamily: C.mono }}>Live:</span>
          <span style={{ color: branchingColor, fontSize: '14px', fontWeight: 'bold', fontFamily: C.mono }}>
            n̂ = {params.alpha.toFixed(2)} / {params.beta.toFixed(2)} = {(params.alpha / params.beta).toFixed(3)}
          </span>
          <span style={{ color: branchingColor, fontSize: '11px' }}>→ {branchingText}</span>
        </div>
      </div>
    </div>
  );
};

// ─── UTILITY: hex → "r,g,b" for rgba() usage ─────────────────────────────────
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default MathLabPanel;
