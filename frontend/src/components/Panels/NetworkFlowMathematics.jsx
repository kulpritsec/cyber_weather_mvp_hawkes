import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";

// ─── DESIGN SYSTEM ──────────────────────────────────────────────────────
const C = {
  bg: "#020810", panel: "rgba(4,12,28,0.96)", panelGlow: "rgba(6,16,36,0.92)",
  border: "rgba(0,140,255,0.10)", borderLit: "rgba(0,200,255,0.35)",
  text: "#b8cce6", dim: "#304060", bright: "#eaf4ff", accent: "#00ccff",
  // Math palette
  lambda: "#60a5fa",  mu: "#34d399",  rho: "#f472b6", throughput: "#22d3ee",
  capacity: "#fbbf24", queue: "#a78bfa", latency: "#fb923c", entropy: "#818cf8",
  burst: "#f87171", spectral: "#c084fc", velocity: "#2dd4bf", drop: "#ef4444",
  // Fluid dynamics
  laminar: "#22c55e", turbulent: "#ef4444", transition: "#eab308",
  gridLine: "rgba(0,120,200,0.06)",
};
const MONO = "'JetBrains Mono','Fira Code',monospace";
const SERIF = "'Crimson Pro','Georgia',serif";

// ─── MATHEMATICAL UTILITIES ─────────────────────────────────────────────

// Queueing theory: M/M/1
function mm1Metrics(arrivalRate, serviceRate) {
  const rho = arrivalRate / serviceRate; // utilization
  if (rho >= 1) return { rho, Lq: Infinity, Wq: Infinity, L: Infinity, W: Infinity, P0: 0, stable: false };
  const L = rho / (1 - rho);           // mean number in system
  const Lq = rho * rho / (1 - rho);    // mean queue length
  const W = 1 / (serviceRate - arrivalRate); // mean time in system
  const Wq = rho / (serviceRate - arrivalRate); // mean wait in queue
  const P0 = 1 - rho;                  // probability system empty
  return { rho, L, Lq, W, Wq, P0, stable: true };
}

// Shannon channel capacity
function shannonCapacity(bandwidth_hz, snr_linear) {
  return bandwidth_hz * Math.log2(1 + snr_linear);
}

// Hurst parameter estimation (R/S analysis simplified)
function estimateHurst(series) {
  if (series.length < 20) return 0.5;
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const cumDev = series.map((x, i) => series.slice(0, i + 1).reduce((a, b) => a + (b - mean), 0));
  const R = Math.max(...cumDev) - Math.min(...cumDev);
  const S = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}

// Generate realistic network traffic time series
function generateTrafficSeries(points = 200, baseRate = 5.0) {
  const series = [];
  let t = 0;
  for (let i = 0; i < points; i++) {
    t += 0.05;
    // Self-similar component (long-range dependence)
    const lrd = 0.8 * Math.sin(t * 0.3) + 0.4 * Math.sin(t * 0.7) + 0.2 * Math.sin(t * 1.9);
    // Bursty component (Pareto-like)
    const burst = Math.random() < 0.05 ? 3 + Math.random() * 8 : 0;
    // Diurnal pattern
    const diurnal = 0.6 * Math.sin(t * 0.15 - 1);
    const value = Math.max(0.1, baseRate + lrd + burst + diurnal + (Math.random() - 0.5) * 1.5);
    series.push({ t, value, burst: burst > 0 });
  }
  return series;
}

// Packet velocity distribution (log-normal + bimodal for CDN vs origin)
function generateVelocityDistribution(n = 500) {
  const packets = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.6) {
      // CDN-served (fast, tight distribution)
      packets.push({ latency: 5 + Math.exp(Math.random() * 1.5), source: "cdn" });
    } else if (Math.random() < 0.7) {
      // Origin server (moderate)
      packets.push({ latency: 30 + Math.exp(Math.random() * 2.5), source: "origin" });
    } else {
      // Congested / long-haul (slow, wide distribution)
      packets.push({ latency: 100 + Math.exp(Math.random() * 3), source: "congested" });
    }
  }
  return packets;
}

// Simple DFT for spectral analysis
function spectralAnalysis(series, maxFreq = 50) {
  const N = series.length;
  const freqs = [];
  for (let k = 1; k <= Math.min(maxFreq, N / 2); k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * k * n / N;
      re += series[n].value * Math.cos(angle);
      im += series[n].value * Math.sin(angle);
    }
    const power = (re * re + im * im) / N;
    freqs.push({ k, frequency: k / N, power, logPower: Math.log10(Math.max(0.001, power)) });
  }
  return freqs;
}

// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZATION COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── ANIMATED GAUGE ─────────────────────────────────────────────────────
function Gauge({ value, min, max, label, symbol, color, unit = "", size = 80, danger = null }) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const startA = -140, endA = 140;
  const angle = startA + pct * (endA - startA);
  const r = size * 0.38;
  const cx = size / 2, cy = size / 2;
  const isDanger = danger !== null && value >= danger;

  const arcPath = (s, e, radius) => {
    const sr = s * Math.PI / 180, er = e * Math.PI / 180;
    const sx = cx + radius * Math.cos(sr), sy = cy + radius * Math.sin(sr);
    const ex = cx + radius * Math.cos(er), ey = cy + radius * Math.sin(er);
    return `M${sx},${sy} A${radius},${radius} 0 ${e - s > 180 ? 1 : 0} 1 ${ex},${ey}`;
  };

  const needleX = cx + (r - 6) * Math.cos(angle * Math.PI / 180);
  const needleY = cy + (r - 6) * Math.sin(angle * Math.PI / 180);

  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
        <path d={arcPath(startA, endA, r)} fill="none" stroke={`${color}18`} strokeWidth={5} strokeLinecap="round" />
        {danger !== null && (
          <path d={arcPath(startA + ((danger - min) / (max - min)) * (endA - startA), endA, r)}
            fill="none" stroke={`${C.drop}20`} strokeWidth={5} strokeLinecap="round" />
        )}
        <path d={arcPath(startA, angle, r)} fill="none" stroke={isDanger ? C.drop : color} strokeWidth={5} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${isDanger ? C.drop : color}50)`, transition: "all 0.4s ease-out" }} />
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={C.bright} strokeWidth={1.5} strokeLinecap="round"
          style={{ transition: "all 0.4s ease-out" }} />
        <circle cx={cx} cy={cy} r={2.5} fill={isDanger ? C.drop : color} />
        <text x={cx} y={cy + 1} fill={C.bright} fontSize="11" fontFamily={MONO} textAnchor="middle" fontWeight="700">
          {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 2 : 0)}
        </text>
        <text x={cx} y={cy + 10} fill={C.dim} fontSize="7" fontFamily={MONO} textAnchor="middle">{unit}</text>
      </svg>
      <div style={{ fontSize: "13px", fontFamily: SERIF, color: isDanger ? C.drop : color, fontWeight: 700, marginTop: "-2px" }}>{symbol}</div>
      <div style={{ fontSize: "7px", fontFamily: MONO, color: C.dim, letterSpacing: "0.1em" }}>{label}</div>
    </div>
  );
}

// ─── QUEUEING THEORY VISUALIZATION ──────────────────────────────────────
function QueueingViz({ arrivalRate, serviceRate, width = 600, height = 180 }) {
  const metrics = mm1Metrics(arrivalRate, serviceRate);
  const { rho, L, Lq, W, Wq, P0, stable } = metrics;

  // Queue state distribution P(n) = (1-ρ)ρⁿ
  const maxN = 20;
  const dist = Array.from({ length: maxN }, (_, n) => ({
    n, prob: stable ? (1 - rho) * Math.pow(rho, n) : 0,
  }));

  const margin = { top: 15, right: 15, bottom: 25, left: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const xScale = d3.scaleBand().domain(dist.map(d => d.n)).range([0, w]).padding(0.2);
  const yScale = d3.scaleLinear().domain([0, Math.max(0.5, d3.max(dist, d => d.prob) * 1.2)]).range([h, 0]);

  return (
    <div>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {yScale.ticks(4).map((tick, i) => (
            <g key={i}>
              <line x1={0} y1={yScale(tick)} x2={w} y2={yScale(tick)} stroke={C.gridLine} strokeWidth={0.5} />
              <text x={-6} y={yScale(tick) + 3} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="end">{tick.toFixed(2)}</text>
            </g>
          ))}
          {dist.map((d, i) => (
            <g key={i}>
              <rect x={xScale(d.n)} y={yScale(d.prob)} width={xScale.bandwidth()} height={Math.max(0, h - yScale(d.prob))}
                fill={d.n <= Math.ceil(L) ? C.queue : `${C.queue}40`} rx={1}
                opacity={d.n === 0 ? 1 : 0.6 + 0.4 * d.prob / Math.max(0.01, dist[0].prob)}
                style={{ transition: "all 0.4s ease-out" }} />
              {d.n % 2 === 0 && (
                <text x={xScale(d.n) + xScale.bandwidth() / 2} y={h + 14} fill={C.dim} fontSize="7" fontFamily={MONO} textAnchor="middle">{d.n}</text>
              )}
            </g>
          ))}
          {/* Mean L marker */}
          {stable && L < maxN && (
            <g>
              <line x1={xScale(Math.floor(L)) + xScale.bandwidth() / 2} y1={0}
                x2={xScale(Math.floor(L)) + xScale.bandwidth() / 2} y2={h}
                stroke={C.latency} strokeWidth={1} strokeDasharray="4,3" />
              <text x={xScale(Math.floor(L)) + xScale.bandwidth() / 2} y={-4}
                fill={C.latency} fontSize="8" fontFamily={MONO} textAnchor="middle">E[L]={L.toFixed(1)}</text>
            </g>
          )}
          <text x={w / 2} y={h + 22} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">
            Packets in system (n)
          </text>
          <text x={-30} y={h / 2} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle"
            transform={`rotate(-90,-30,${h / 2})`}>P(N=n)</text>
        </g>
      </svg>
    </div>
  );
}

// ─── PACKET VELOCITY DISTRIBUTION ───────────────────────────────────────
function VelocityDistribution({ packets, width = 600, height = 160 }) {
  const margin = { top: 15, right: 15, bottom: 25, left: 45 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  // Kernel density estimation
  const bins = 60;
  const maxLatency = 400;
  const bandwidth = 8;
  const density = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= bins; i++) {
      const x = (i / bins) * maxLatency;
      let sum = 0;
      for (const p of packets) {
        const u = (x - p.latency) / bandwidth;
        sum += Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
      }
      pts.push({ x, y: sum / packets.length });
    }
    return pts;
  }, [packets]);

  // Per-source densities
  const sources = ["cdn", "origin", "congested"];
  const sourceColors = { cdn: C.throughput, origin: C.latency, congested: C.drop };
  const sourceDensities = useMemo(() => {
    return sources.map(src => {
      const srcPackets = packets.filter(p => p.source === src);
      if (srcPackets.length === 0) return { src, pts: [] };
      const pts = [];
      for (let i = 0; i <= bins; i++) {
        const x = (i / bins) * maxLatency;
        let sum = 0;
        for (const p of srcPackets) {
          const u = (x - p.latency) / bandwidth;
          sum += Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
        }
        pts.push({ x, y: sum / packets.length });
      }
      return { src, pts };
    });
  }, [packets]);

  const xScale = d3.scaleLinear().domain([0, maxLatency]).range([0, w]);
  const yMax = d3.max(density, d => d.y) * 1.15;
  const yScale = d3.scaleLinear().domain([0, yMax]).range([h, 0]);
  const area = d3.area().x(d => xScale(d.x)).y0(h).y1(d => yScale(d.y)).curve(d3.curveBasis);
  const line = d3.line().x(d => xScale(d.x)).y(d => yScale(d.y)).curve(d3.curveBasis);

  // Percentiles
  const sorted = [...packets].sort((a, b) => a.latency - b.latency);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]?.latency || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.latency || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]?.latency || 0;

  return (
    <svg width={width} height={height}>
      <defs>
        {sources.map(src => (
          <linearGradient key={src} id={`vel-grad-${src}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sourceColors[src]} stopOpacity="0.2" />
            <stop offset="100%" stopColor={sourceColors[src]} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {xScale.ticks(6).map((tick, i) => (
          <g key={i}>
            <line x1={xScale(tick)} y1={0} x2={xScale(tick)} y2={h} stroke={C.gridLine} strokeWidth={0.5} />
            <text x={xScale(tick)} y={h + 14} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">{tick}ms</text>
          </g>
        ))}

        {/* Source-specific fills */}
        {sourceDensities.map(({ src, pts }) => pts.length > 0 && (
          <path key={src} d={area(pts)} fill={`url(#vel-grad-${src})`} />
        ))}
        {sourceDensities.map(({ src, pts }) => pts.length > 0 && (
          <path key={`line-${src}`} d={line(pts)} fill="none" stroke={sourceColors[src]} strokeWidth={1.2} opacity={0.7} />
        ))}

        {/* Percentile markers */}
        {[
          { val: p50, label: "P50", color: C.throughput },
          { val: p95, label: "P95", color: C.latency },
          { val: p99, label: "P99", color: C.drop },
        ].map(({ val, label, color }) => (
          <g key={label}>
            <line x1={xScale(val)} y1={0} x2={xScale(val)} y2={h} stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
            <text x={xScale(val)} y={-3} fill={color} fontSize="8" fontFamily={MONO} textAnchor="middle" fontWeight={700}>
              {label}={val.toFixed(0)}ms
            </text>
          </g>
        ))}

        <text x={w / 2} y={h + 22} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">Round-trip latency (ms)</text>
      </g>
    </svg>
  );
}

// ─── SPECTRAL POWER DENSITY ─────────────────────────────────────────────
function SpectralChart({ traffic, width = 600, height = 150 }) {
  const spectrum = useMemo(() => spectralAnalysis(traffic, 50), [traffic]);
  const margin = { top: 15, right: 15, bottom: 25, left: 45 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const xScale = d3.scaleLog().domain([0.01, 0.5]).range([0, w]).clamp(true);
  const yScale = d3.scaleLinear().domain([d3.min(spectrum, d => d.logPower) - 0.5, d3.max(spectrum, d => d.logPower) + 0.5]).range([h, 0]);
  const line = d3.line().x(d => xScale(Math.max(0.01, d.frequency))).y(d => yScale(d.logPower)).curve(d3.curveBasis);
  const area = d3.area().x(d => xScale(Math.max(0.01, d.frequency))).y0(h).y1(d => yScale(d.logPower)).curve(d3.curveBasis);

  // Fit 1/f^β line for self-similarity check
  const validPts = spectrum.filter(s => s.frequency > 0.02);
  const logF = validPts.map(s => Math.log10(s.frequency));
  const logP = validPts.map(s => s.logPower);
  const n = logF.length;
  const sumX = logF.reduce((a, b) => a + b, 0), sumY = logP.reduce((a, b) => a + b, 0);
  const sumXY = logF.reduce((a, x, i) => a + x * logP[i], 0);
  const sumX2 = logF.reduce((a, x) => a + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return (
    <svg width={width} height={height}>
      <defs>
        <linearGradient id="spectral-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.spectral} stopOpacity="0.15" />
          <stop offset="100%" stopColor={C.spectral} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {yScale.ticks(4).map((tick, i) => (
          <g key={i}>
            <line x1={0} y1={yScale(tick)} x2={w} y2={yScale(tick)} stroke={C.gridLine} strokeWidth={0.5} />
            <text x={-6} y={yScale(tick) + 3} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="end">10^{tick.toFixed(1)}</text>
          </g>
        ))}
        <path d={area(spectrum.filter(s => s.frequency > 0.01))} fill="url(#spectral-grad)" />
        <path d={line(spectrum.filter(s => s.frequency > 0.01))} fill="none" stroke={C.spectral} strokeWidth={1.5} />

        {/* 1/f^β fit line */}
        <line x1={xScale(0.02)} y1={yScale(slope * Math.log10(0.02) + intercept)}
          x2={xScale(0.5)} y2={yScale(slope * Math.log10(0.5) + intercept)}
          stroke={C.burst} strokeWidth={1} strokeDasharray="6,4" opacity={0.6} />
        <text x={w - 60} y={yScale(slope * Math.log10(0.3) + intercept) - 6}
          fill={C.burst} fontSize="8" fontFamily={MONO}>β={Math.abs(slope).toFixed(2)}</text>

        <text x={w / 2} y={h + 20} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle">Frequency (log scale)</text>
        <text x={-35} y={h / 2} fill={C.dim} fontSize="8" fontFamily={MONO} textAnchor="middle"
          transform={`rotate(-90,-35,${h / 2})`}>log₁₀ Power</text>
      </g>
    </svg>
  );
}

// ─── FLUID DYNAMICS ANALOGY — REYNOLDS NUMBER METER ─────────────────────
function FluidFlowViz({ utilization, burstiness, width = 600, height = 100 }) {
  // Reynolds number analogy: Re = ρ * v * D / μ  →  Re_cyber = utilization * burstiness * throughput
  // Re < 2300 → laminar, 2300-4000 → transition, > 4000 → turbulent
  const Re = utilization * burstiness * 5000;
  const regime = Re < 2300 ? "LAMINAR" : Re < 4000 ? "TRANSITIONAL" : "TURBULENT";
  const regimeColor = Re < 2300 ? C.laminar : Re < 4000 ? C.transition : C.turbulent;

  // Animated flow particles
  const particles = useMemo(() => {
    const pts = [];
    for (let i = 0; i < 60; i++) {
      const baseY = 0.1 + Math.random() * 0.8;
      const turbulence = Re > 2300 ? (Math.random() - 0.5) * 0.15 * Math.min(1, (Re - 2300) / 3000) : 0;
      pts.push({
        x: Math.random(),
        y: baseY + turbulence,
        speed: 0.3 + (1 - Math.abs(baseY - 0.5) * 2) * 0.7, // parabolic velocity profile
        size: 1.5 + Math.random() * 1.5,
      });
    }
    return pts;
  }, [Re]);

  const margin = { top: 10, right: 10, bottom: 10, left: 10 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  return (
    <div>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Pipe walls */}
          <line x1={0} y1={0} x2={w} y2={0} stroke={regimeColor} strokeWidth={2} opacity={0.4} />
          <line x1={0} y1={h} x2={w} y2={h} stroke={regimeColor} strokeWidth={2} opacity={0.4} />

          {/* Flow particles */}
          {particles.map((p, i) => (
            <circle key={i} cx={p.x * w} cy={p.y * h} r={p.size}
              fill={regimeColor} opacity={0.3 + p.speed * 0.4}
              style={{ animation: `flowParticle ${3 / p.speed}s linear infinite`, animationDelay: `${-p.x * 3}s` }} />
          ))}

          {/* Velocity profile (parabolic for laminar) */}
          {Array.from({ length: 8 }, (_, i) => {
            const y = ((i + 1) / 9) * h;
            const normalizedY = (y / h - 0.5) * 2; // -1 to 1
            const vx = Re < 3000 ? (1 - normalizedY * normalizedY) : (0.6 + Math.random() * 0.4); // parabolic vs chaotic
            return (
              <line key={i} x1={w * 0.05} y1={y} x2={w * 0.05 + vx * w * 0.15} y2={y}
                stroke={regimeColor} strokeWidth={1.5} opacity={0.5} markerEnd="url(#arrow)" />
            );
          })}

          {/* Labels */}
          <text x={w / 2} y={h / 2 + 3} fill={regimeColor} fontSize="12" fontFamily={MONO} textAnchor="middle" fontWeight={700} opacity={0.4}>
            {regime} FLOW
          </text>
          <text x={w - 4} y={h / 2 + 3} fill={C.dim} fontSize="9" fontFamily={MONO} textAnchor="end">
            Re≈{Re.toFixed(0)}
          </text>
        </g>
      </svg>
    </div>
  );
}

// ─── LITTLE'S LAW TRIANGLE ──────────────────────────────────────────────
function LittlesLawViz({ L, lambda, W, width = 240 }) {
  const h = width * 0.8;
  const cx = width / 2, cy = h * 0.45;
  const r = width * 0.3;

  const points = [
    { x: cx, y: cy - r, label: "L", value: L.toFixed(2), color: C.queue, desc: "avg in system" },
    { x: cx - r * 0.87, y: cy + r * 0.5, label: "λ", value: lambda.toFixed(2), color: C.lambda, desc: "arrival rate" },
    { x: cx + r * 0.87, y: cy + r * 0.5, label: "W", value: W.toFixed(2), color: C.latency, desc: "avg sojourn" },
  ];

  return (
    <svg width={width} height={h}>
      {/* Triangle edges */}
      <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke={C.border} strokeWidth={1} />
      <line x1={points[1].x} y1={points[1].y} x2={points[2].x} y2={points[2].y} stroke={C.border} strokeWidth={1} />
      <line x1={points[2].x} y1={points[2].y} x2={points[0].x} y2={points[0].y} stroke={C.border} strokeWidth={1} />

      {/* Edge labels */}
      <text x={cx} y={cy + r * 0.5 + 18} fill={C.bright} fontSize="11" fontFamily={SERIF} textAnchor="middle" fontWeight={700}>
        L = λ × W
      </text>

      {/* Vertices */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={22} fill={`${p.color}12`} stroke={`${p.color}40`} strokeWidth={1.5} />
          <text x={p.x} y={p.y - 4} fill={p.color} fontSize="16" fontFamily={SERIF} textAnchor="middle" fontWeight={700}>{p.label}</text>
          <text x={p.x} y={p.y + 10} fill={C.bright} fontSize="10" fontFamily={MONO} textAnchor="middle" fontWeight={700}>{p.value}</text>
          <text x={p.x} y={p.y + 30} fill={C.dim} fontSize="7" fontFamily={MONO} textAnchor="middle">{p.desc}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── SHANNON CAPACITY METER ─────────────────────────────────────────────
function ShannonMeter({ currentThroughput, bandwidth_ghz, snr_db, width = 280 }) {
  const snr_linear = Math.pow(10, snr_db / 10);
  const capacity_bps = shannonCapacity(bandwidth_ghz * 1e9, snr_linear);
  const capacity_gbps = capacity_bps / 1e9;
  const utilPct = (currentThroughput / capacity_gbps) * 100;

  const h = 20;
  const barWidth = width - 80;

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "10px", fontFamily: SERIF, color: C.capacity, fontWeight: 700 }}>C = B log₂(1 + S/N)</span>
        <span style={{ fontSize: "9px", fontFamily: MONO, color: C.dim }}>
          = {bandwidth_ghz}GHz × log₂(1 + 10^({snr_db}/10))
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: barWidth, height: h, background: `${C.capacity}08`, borderRadius: "4px", border: `1px solid ${C.capacity}20`, position: "relative", overflow: "hidden" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${Math.min(100, utilPct)}%`,
            background: utilPct > 80 ? `linear-gradient(90deg, ${C.capacity}, ${C.drop})` : C.capacity,
            opacity: 0.3, borderRadius: "4px", transition: "width 0.5s ease-out",
          }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "9px", fontFamily: MONO, color: C.bright, fontWeight: 700 }}>
              {currentThroughput.toFixed(1)} / {capacity_gbps.toFixed(1)} Gbps ({utilPct.toFixed(0)}%)
            </span>
          </div>
        </div>
        <span style={{
          fontSize: "10px", fontFamily: MONO, fontWeight: 700,
          color: utilPct > 80 ? C.drop : utilPct > 60 ? C.latency : C.throughput,
        }}>
          {utilPct > 90 ? "⚠ SATURATED" : utilPct > 70 ? "△ HIGH" : "◉ NOMINAL"}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

export default function NetworkFlowMathematics({ onClose }) {

  // ─── REAL DATA FROM BACKEND ─────────────────────────────────────────
  const [realFlowData, setRealFlowData] = useState(null);
  useEffect(() => {
    fetch("/v1/network/flows?hours=24")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRealFlowData(data); })
      .catch(() => {});
  }, []);

  // Computed from real data
  const realTotalEvents = realFlowData?.vectors?.reduce((s, v) => s + v.events, 0) || 0;
  const realUniqueIPs = realFlowData?.vectors?.reduce((s, v) => s + v.unique_ips, 0) || 0;
  const realCountries = realFlowData?.top_countries?.length || 0;
  const realTopSource = realFlowData?.top_sources?.[0];

  const [activeTab, setActiveTab] = useState("queueing");
  const [time, setTime] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const animRef = useRef(null);

  // Animated parameters
  const [arrivalRate, setArrivalRate] = useState(3.2);
  const [serviceRate, setServiceRate] = useState(5.0);
  const [traffic] = useState(() => generateTrafficSeries(200, 5.0));
  const [packets, setPackets] = useState(() => generateVelocityDistribution(500));

  // Derived metrics
  const qMetrics = useMemo(() => mm1Metrics(arrivalRate, serviceRate), [arrivalRate, serviceRate]);
  const hurstH = useMemo(() => estimateHurst(traffic.map(t => t.value)), [traffic]);
  const throughputGbps = useMemo(() => 2.5 + arrivalRate * 0.8 + Math.sin(time / 3) * 0.5, [arrivalRate, time]);
  const burstIndex = useMemo(() => {
    const vals = traffic.map(t => t.value);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return variance / mean; // index of dispersion
  }, [traffic]);

  // Animation
  useEffect(() => {
    if (!isAnimating) return;
    let last = performance.now();
    const animate = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime(t => t + dt);
      // Drift arrival rate to create dynamic queueing behavior
      setArrivalRate(r => {
        const target = 3.0 + 1.8 * Math.sin(now / 4000) + 0.5 * Math.sin(now / 1500);
        return r + (target - r) * 0.02;
      });
      // Regenerate packets occasionally
      if (Math.random() < 0.01) setPackets(generateVelocityDistribution(500));
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [isAnimating]);

  const tabs = [
    { id: "queueing", label: "QUEUEING THEORY", icon: "📊" },
    { id: "velocity", label: "PACKET VELOCITY", icon: "⚡" },
    { id: "spectral", label: "SPECTRAL ANALYSIS", icon: "〰" },
    { id: "capacity", label: "SHANNON CAPACITY", icon: "📡" },
    { id: "fluid", label: "FLOW DYNAMICS", icon: "🌊" },
  ];

  const panelStyle = {
    background: C.panel, border: `1px solid ${C.border}`, borderRadius: "8px",
    backdropFilter: "blur(16px)", boxShadow: "0 4px 30px rgba(0,0,0,0.4)",
  };
  const headerStyle = {
    fontSize: "8px", color: C.dim, letterSpacing: "0.14em", fontFamily: MONO,
    marginBottom: "10px", paddingBottom: "6px", borderBottom: `1px solid ${C.border}`,
  };

  const chartWidth = Math.min(620, typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.94 * 0.65) - 60 : 620);

  return (
    <div style={{
      position: "fixed", top: "60px", left: "50%", transform: "translateX(-50%)",
      zIndex: 40, width: "94vw", maxWidth: "1200px", maxHeight: "calc(100vh - 80px)",
      overflowY: "auto", borderRadius: "10px",
      background: "rgba(2,8,16,0.98)", border: `1px solid ${C.borderLit}`,
      boxShadow: "0 12px 60px rgba(0,0,0,0.7), 0 0 40px rgba(0,140,255,0.08)",
      backdropFilter: "blur(20px)",
      color: C.text, fontFamily: MONO,
      animation: "panelSlideIn 0.25s ease-out",
    }}>
      {/* Grid overlay */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", borderRadius: "10px", overflow: "hidden",
        backgroundImage: `radial-gradient(circle at 1px 1px, ${C.border} 0.4px, transparent 0)`,
        backgroundSize: "32px 32px", opacity: 0.25,
      }} />

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50, padding: "12px 24px",
        background: "linear-gradient(180deg, rgba(2,8,16,0.99) 0%, rgba(2,8,16,0.95) 100%)",
        borderBottom: `1px solid ${C.border}`, borderRadius: "10px 10px 0 0",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 800, color: C.bright, letterSpacing: "0.06em" }}>
            NETWORK FLOW MATHEMATICS
          </div>
          <div style={{ fontSize: "9px", color: C.dim, marginTop: "2px" }}>
            Queueing Theory · Packet Velocity · Spectral Decomposition · Shannon Capacity · Fluid Dynamics
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => setIsAnimating(!isAnimating)} style={{
            padding: "5px 12px", borderRadius: "4px", cursor: "pointer",
            background: isAnimating ? `${C.accent}12` : "transparent",
            border: `1px solid ${isAnimating ? C.accent : C.border}`,
            color: isAnimating ? C.accent : C.dim, fontFamily: MONO, fontSize: "10px",
          }}>{isAnimating ? "⏸ LIVE" : "▶ START"}</button>
          <div style={{
            padding: "4px 10px", borderRadius: "4px",
            background: qMetrics.rho > 0.85 ? `${C.drop}12` : `${C.throughput}08`,
            border: `1px solid ${qMetrics.rho > 0.85 ? C.drop + "30" : C.throughput + "20"}`,
            fontFamily: MONO, fontSize: "11px", fontWeight: 700,
            color: qMetrics.rho > 0.85 ? C.drop : C.throughput,
          }}>
            ρ = {qMetrics.rho.toFixed(3)}
          </div>
          {onClose && (
            <button onClick={onClose} style={{
              padding: "5px 10px", borderRadius: "4px", cursor: "pointer",
              background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`,
              color: C.dim, fontFamily: MONO, fontSize: "12px", fontWeight: 700,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.target.style.color = C.bright; e.target.style.borderColor = C.borderLit; }}
            onMouseLeave={e => { e.target.style.color = C.dim; e.target.style.borderColor = C.border; }}
            >✕</button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: "2px", padding: "6px 24px",
        background: "rgba(2,8,16,0.5)", borderBottom: `1px solid ${C.border}`,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "7px 14px", fontSize: "9px", fontFamily: MONO, letterSpacing: "0.06em",
            border: "none", borderRadius: "4px 4px 0 0", cursor: "pointer",
            background: activeTab === t.id ? C.panel : "transparent",
            color: activeTab === t.id ? C.accent : C.dim,
            borderBottom: activeTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
          }}>
            <span style={{ marginRight: "5px" }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px 24px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "12px" }}>

          {/* ═══ LEFT: Active Tab Content ═══ */}
          <div>
            {activeTab === "queueing" && (
              <div>
                <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
                  <div style={headerStyle}>M/M/1 QUEUE — PACKET PROCESSING MODEL</div>
                  {/* Equation */}
                  <div style={{ fontFamily: SERIF, fontSize: "16px", color: C.text, lineHeight: 2, marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
                      <span style={{ color: C.rho, fontWeight: 700, fontSize: "18px" }}>ρ</span>
                      <span style={{ color: C.dim }}>=</span>
                      <span style={{ color: C.lambda, fontWeight: 700 }}>λ</span>
                      <span style={{ color: C.dim }}>/</span>
                      <span style={{ color: C.mu, fontWeight: 700 }}>μ</span>
                      <span style={{ color: C.dim }}>=</span>
                      <span style={{ fontFamily: MONO, fontSize: "14px", color: C.lambda }}>{arrivalRate.toFixed(2)}</span>
                      <span style={{ color: C.dim }}>/</span>
                      <span style={{ fontFamily: MONO, fontSize: "14px", color: C.mu }}>{serviceRate.toFixed(2)}</span>
                      <span style={{ color: C.dim }}>=</span>
                      <span style={{
                        fontFamily: MONO, fontSize: "18px", fontWeight: 800,
                        color: qMetrics.rho > 0.85 ? C.drop : qMetrics.rho > 0.6 ? C.latency : C.throughput,
                        padding: "2px 8px", borderRadius: "4px",
                        background: qMetrics.rho > 0.85 ? `${C.drop}12` : "transparent",
                      }}>
                        {qMetrics.rho.toFixed(4)}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: "10px", color: C.dim, marginLeft: "6px" }}>
                        {qMetrics.rho >= 1 ? "⚠ UNSTABLE — queue grows without bound" :
                         qMetrics.rho > 0.85 ? "⚠ NEAR SATURATION" :
                         qMetrics.rho > 0.6 ? "△ MODERATE LOAD" : "◉ STABLE"}
                      </span>
                    </div>
                  </div>
                  <QueueingViz arrivalRate={arrivalRate} serviceRate={serviceRate} width={chartWidth} height={180} />
                </div>

                {/* Little's Law */}
                <div style={{ ...panelStyle, padding: "16px" }}>
                  <div style={headerStyle}>LITTLE'S LAW — L = λW</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.6, marginBottom: "10px" }}>
                    The most fundamental result in queueing theory. The average number of packets in the system (L) equals
                    the arrival rate (λ) times the average time each packet spends in the system (W). This holds for any
                    queue discipline, any arrival distribution, any service distribution — it is universal.
                  </div>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <LittlesLawViz L={qMetrics.stable ? qMetrics.L : 99} lambda={arrivalRate} W={qMetrics.stable ? qMetrics.W : 99} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "velocity" && (
              <div>
                <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
                  <div style={headerStyle}>PACKET LATENCY DISTRIBUTION — KERNEL DENSITY ESTIMATION</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.6, marginBottom: "8px" }}>
                    Real network latency is multimodal — CDN-served packets arrive fast and tight (~5-20ms),
                    origin-server packets have moderate latency (~30-100ms), and congested-path packets show wide,
                    heavy-tailed distributions (100ms+). The P95 and P99 tail latencies matter more than the mean
                    for detecting congestion and attack-induced degradation.
                  </div>
                  <VelocityDistribution packets={packets} width={chartWidth} height={180} />
                  <div style={{ display: "flex", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
                    {[
                      { label: "CDN-served", color: C.throughput, desc: "Edge cache hit — minimal hops" },
                      { label: "Origin", color: C.latency, desc: "Full round-trip to origin server" },
                      { label: "Congested", color: C.drop, desc: "Queue buildup or long-haul path" },
                    ].map(s => (
                      <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <div style={{ width: "10px", height: "3px", background: s.color, borderRadius: "1px" }} />
                        <span style={{ fontSize: "9px", color: s.color, fontFamily: MONO }}>{s.label}</span>
                        <span style={{ fontSize: "8px", color: C.dim, fontFamily: MONO }}>{s.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ ...panelStyle, padding: "16px" }}>
                  <div style={headerStyle}>OPERATIONAL INTERPRETATION</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {[
                      { title: "DDoS Detection via Latency Shift", body: "A volumetric DDoS attack shifts the entire distribution rightward — P50 jumps from 15ms to 80ms+. The Hawkes model detects the event arrival spike; the velocity distribution shows the infrastructure impact.", color: C.drop },
                      { title: "Cable Cut Detection", body: "When a submarine cable fails, traffic reroutes through longer paths. The bimodal distribution collapses into a single wide mode — the CDN peak disappears as edge caches become unreachable via the fast path.", color: C.latency },
                      { title: "BGP Hijack Signature", body: "BGP hijacking creates an anomalous third mode in the distribution — packets routed through the hijacker's network arrive with characteristic latency that doesn't match CDN, origin, or normal congestion profiles.", color: C.spectral },
                      { title: "Connection to Hawkes λ(t)", body: "When λ(t) spikes (self-excitation), the queueing system responds: utilization ρ increases, queue lengths grow, and the latency distribution's tail fattens. The math connects: λ(t) → ρ(t) → W(t) → velocity shift.", color: C.lambda },
                    ].map((card, i) => (
                      <div key={i} style={{ padding: "10px", borderRadius: "5px", background: `${card.color}06`, border: `1px solid ${card.color}18` }}>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: card.color, marginBottom: "4px" }}>{card.title}</div>
                        <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>{card.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "spectral" && (
              <div>
                <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
                  <div style={headerStyle}>POWER SPECTRAL DENSITY — TRAFFIC SELF-SIMILARITY</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.6, marginBottom: "8px" }}>
                    Network traffic is self-similar: it looks bursty at every time scale (ms, seconds, minutes, hours).
                    The power spectrum of self-similar traffic follows a 1/f^β power law — the spectral slope β is
                    related to the Hurst parameter H by β = 2H - 1. H &gt; 0.5 indicates long-range dependence.
                  </div>
                  <SpectralChart traffic={traffic} width={chartWidth} height={180} />
                </div>

                <div style={{ ...panelStyle, padding: "16px" }}>
                  <div style={headerStyle}>HURST PARAMETER & SELF-SIMILARITY</div>
                  <div style={{ fontFamily: SERIF, fontSize: "15px", color: C.text, lineHeight: 2, marginBottom: "8px" }}>
                    <span style={{ color: C.burst, fontWeight: 700 }}>H</span>
                    <span style={{ color: C.dim }}> = </span>
                    <span style={{ fontFamily: MONO, fontSize: "18px", color: C.burst, fontWeight: 800 }}>{hurstH.toFixed(3)}</span>
                    <span style={{ color: C.dim, fontFamily: MONO, fontSize: "10px", marginLeft: "8px" }}>
                      {hurstH > 0.8 ? "STRONG long-range dependence (highly bursty)" :
                       hurstH > 0.6 ? "MODERATE long-range dependence" :
                       hurstH > 0.5 ? "WEAK self-similarity" : "SHORT-range dependent (Poisson-like)"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ padding: "10px", borderRadius: "5px", background: `${C.spectral}06`, border: `1px solid ${C.spectral}18` }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: C.spectral, marginBottom: "4px" }}>Why Self-Similarity Matters</div>
                      <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>
                        If H = 0.5 (Poisson), traffic smooths out when you aggregate over time — law of large numbers.
                        But with H &gt; 0.5, aggregation does NOT smooth the traffic. Bursts persist at every scale.
                        This means traditional capacity planning (based on average throughput) dramatically underestimates
                        required headroom. This connects directly to the Hawkes branching ratio: n̂ ≈ 2H - 1 for
                        self-exciting traffic.
                      </div>
                    </div>
                    <div style={{ padding: "10px", borderRadius: "5px", background: `${C.burst}06`, border: `1px solid ${C.burst}18` }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: C.burst, marginBottom: "4px" }}>Attack Detection via Spectral Shift</div>
                      <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.6 }}>
                        Normal traffic has characteristic spectral slope β. A DDoS attack or botnet activation introduces
                        power at specific frequencies (the attack's pulse rate), creating spectral peaks above the 1/f^β
                        baseline. Detecting these peaks is equivalent to detecting anomalous periodicity — a
                        complementary signal to the Hawkes intensity spike.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "capacity" && (
              <div>
                <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
                  <div style={headerStyle}>SHANNON-HARTLEY THEOREM — THEORETICAL CAPACITY BOUND</div>
                  <div style={{ fontFamily: SERIF, fontSize: "16px", color: C.text, lineHeight: 2.2, marginBottom: "10px" }}>
                    <span style={{ color: C.capacity, fontWeight: 700, fontSize: "18px" }}>C</span>
                    <span style={{ color: C.dim }}> = </span>
                    <span style={{ color: C.throughput, fontWeight: 700 }}>B</span>
                    <span style={{ color: C.dim }}> log₂(1 + </span>
                    <span style={{ color: C.lambda, fontWeight: 700 }}>S</span>
                    <span style={{ color: C.dim }}>/</span>
                    <span style={{ color: C.drop, fontWeight: 700 }}>N</span>
                    <span style={{ color: C.dim }}>)</span>
                    <span style={{ fontFamily: MONO, fontSize: "10px", color: C.dim, marginLeft: "10px" }}>
                      Maximum error-free data rate through a channel
                    </span>
                  </div>

                  {/* Multiple link examples */}
                  {[
                    { label: "Submarine Cable (TAT-14)", bw: 100, snr: 25, current: 2.1 },
                    { label: "Fiber Backbone (US East)", bw: 400, snr: 30, current: 45.0 },
                    { label: "Last Mile (Enterprise 10G)", bw: 10, snr: 20, current: 6.8 },
                    { label: "Satellite (Starlink LEO)", bw: 0.5, snr: 12, current: 0.15 },
                  ].map((link, i) => (
                    <div key={i} style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "10px", color: C.bright, fontFamily: MONO, fontWeight: 600, marginBottom: "4px" }}>
                        {link.label}
                      </div>
                      <ShannonMeter currentThroughput={link.current} bandwidth_ghz={link.bw} snr_db={link.snr} width={chartWidth} />
                    </div>
                  ))}
                </div>

                <div style={{ ...panelStyle, padding: "16px" }}>
                  <div style={headerStyle}>WHY SHANNON MATTERS FOR CTI</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.7 }}>
                    The Shannon bound is the hard ceiling on data throughput. When a DDoS attack pushes a link to
                    capacity, additional legitimate traffic is dropped — not delayed, dropped. The transition from
                    "degraded latency" to "packet loss" happens at the Shannon limit. By modeling current utilization
                    against theoretical capacity per link, the infrastructure layer can predict which links will
                    hit hard failure under projected Hawkes intensity increases — turning the Hawkes forecast into
                    an infrastructure impact prediction.
                  </div>
                </div>
              </div>
            )}

            {activeTab === "fluid" && (
              <div>
                <div style={{ ...panelStyle, padding: "16px", marginBottom: "12px" }}>
                  <div style={headerStyle}>FLUID DYNAMICS ANALOGY — NETWORK TRAFFIC AS FLUID FLOW</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.6, marginBottom: "10px" }}>
                    Network traffic behaves like fluid in a pipe. At low utilization (low Reynolds number), flow is
                    laminar — orderly, predictable, with a parabolic velocity profile. As utilization and burstiness
                    increase, the flow transitions through a critical Reynolds number to turbulent — chaotic, with
                    eddies (retransmissions), vortices (routing loops), and unpredictable pressure drops (latency spikes).
                  </div>
                  <FluidFlowViz utilization={qMetrics.rho} burstiness={burstIndex} width={chartWidth} />
                  <div style={{
                    marginTop: "10px", padding: "10px 14px", borderRadius: "4px",
                    background: `${qMetrics.rho > 0.7 ? C.turbulent : C.laminar}06`,
                    border: `1px solid ${qMetrics.rho > 0.7 ? C.turbulent : C.laminar}20`,
                  }}>
                    <div style={{ fontFamily: SERIF, fontSize: "14px", color: C.text, lineHeight: 1.8 }}>
                      <span style={{ color: C.throughput }}>Re</span>
                      <span style={{ color: C.dim, fontFamily: MONO, fontSize: "10px" }}> (cyber) </span>
                      <span style={{ color: C.dim }}>≈ </span>
                      <span style={{ color: C.rho }}>ρ</span>
                      <span style={{ color: C.dim }}> × </span>
                      <span style={{ color: C.burst }}>I</span>
                      <span style={{ color: C.dim, fontFamily: MONO, fontSize: "9px" }}>(dispersion)</span>
                      <span style={{ color: C.dim }}> × </span>
                      <span style={{ color: C.capacity }}>C</span>
                      <span style={{ color: C.dim, fontFamily: MONO, fontSize: "9px" }}>(capacity)</span>
                      <span style={{ color: C.dim }}> = </span>
                      <span style={{ fontFamily: MONO, fontSize: "14px", color: C.bright, fontWeight: 700 }}>
                        {(qMetrics.rho * burstIndex * 5000).toFixed(0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ ...panelStyle, padding: "16px" }}>
                  <div style={headerStyle}>THE COMPLETE MATHEMATICAL CHAIN</div>
                  <div style={{ fontSize: "10px", color: C.text, fontFamily: MONO, lineHeight: 1.7 }}>
                    This is where all the math connects into a single predictive pipeline:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
                    {[
                      { step: "1", label: "CTI feeds arrive", formula: "DShield, GreyNoise, Abuse.ch → Event(ts, lat, lon, vector)", color: C.accent },
                      { step: "2", label: "Hawkes process models arrivals", formula: "λ(t) = μ(t) + Σ α·exp(-β(t-tᵢ))  →  n̂ branching ratio", color: C.lambda },
                      { step: "3", label: "Covariates modulate baseline", formula: "μ(t) = μ_base × S(t) × ∏(1+wᵢEᵢ(t)) × C(t)", color: C.mu },
                      { step: "4", label: "λ(t) feeds queueing model", formula: "ρ(t) = λ(t)/μ_service  →  L(t) = λ(t)·W(t)  (Little's Law)", color: C.rho },
                      { step: "5", label: "Queue metrics → velocity shift", formula: "W(t) → packet latency distribution shift  →  P95/P99 degradation", color: C.latency },
                      { step: "6", label: "Throughput → Shannon bound check", formula: "throughput(t) vs C = B·log₂(1+S/N)  →  saturation prediction", color: C.capacity },
                      { step: "7", label: "Burstiness → flow regime", formula: "H(t), I(t) → Re_cyber  →  laminar/turbulent transition detection", color: C.burst },
                      { step: "8", label: "Infrastructure impact forecast", formula: "Which links/IXPs/cables hit capacity under projected λ(t+Δ)?", color: C.drop },
                    ].map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: "8px",
                        padding: "6px 10px", borderRadius: "4px",
                        background: `${s.color}04`, borderLeft: `3px solid ${s.color}60`,
                      }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: s.color, fontFamily: MONO, minWidth: "20px" }}>{s.step}</span>
                        <div>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: C.bright }}>{s.label}</div>
                          <div style={{ fontSize: "9px", color: C.dim, fontFamily: MONO }}>{s.formula}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ═══ RIGHT: Live Metrics Panel ═══ */}
          <div>
            <div style={{ ...panelStyle, padding: "14px", marginBottom: "12px" }}>
              <div style={headerStyle}>LIVE NETWORK STATE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                <Gauge value={arrivalRate} min={0} max={8} label="ARRIVAL RATE" symbol="λ" color={C.lambda} unit="pkt/s" />
                <Gauge value={serviceRate} min={0} max={8} label="SERVICE RATE" symbol="μ" color={C.mu} unit="pkt/s" />
                <Gauge value={qMetrics.rho} min={0} max={1} label="UTILIZATION" symbol="ρ" color={C.rho} unit="" danger={0.85} />
                <Gauge value={throughputGbps} min={0} max={10} label="THROUGHPUT" symbol="Θ" color={C.throughput} unit="Gbps" />
                <Gauge value={qMetrics.stable ? qMetrics.L : 99} min={0} max={30} label="QUEUE LENGTH" symbol="L" color={C.queue} unit="pkts" danger={15} />
                <Gauge value={qMetrics.stable ? qMetrics.W * 1000 : 999} min={0} max={500} label="SOJOURN TIME" symbol="W" color={C.latency} unit="ms" danger={200} />
              </div>
            </div>

            <div style={{ ...panelStyle, padding: "14px", marginBottom: "12px" }}>
              <div style={headerStyle}>BURSTINESS METRICS</div>
              {[
                { label: "Hurst parameter H", value: hurstH.toFixed(3), color: C.burst, desc: hurstH > 0.7 ? "Long-range dependent" : "Moderate self-similarity" },
                { label: "Index of dispersion I", value: burstIndex.toFixed(2), color: C.spectral, desc: burstIndex > 2 ? "Highly overdispersed" : "Moderate variance" },
                { label: "Spectral slope β", value: (2 * hurstH - 1).toFixed(2), color: C.spectral, desc: "1/f^β power law exponent" },
                { label: "Flow regime Re", value: (qMetrics.rho * burstIndex * 5000).toFixed(0), color: qMetrics.rho > 0.7 ? C.turbulent : C.laminar,
                  desc: qMetrics.rho * burstIndex * 5000 > 4000 ? "TURBULENT" : qMetrics.rho * burstIndex * 5000 > 2300 ? "TRANSITION" : "LAMINAR" },
              ].map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: "9px", color: C.dim }}>{m.label}</div>
                    <div style={{ fontSize: "7px", color: C.dim }}>{m.desc}</div>
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: m.color, fontFamily: MONO }}>{m.value}</span>
                </div>
              ))}
            </div>

            <div style={{ ...panelStyle, padding: "14px" }}>
              <div style={headerStyle}>HAWKES → QUEUE CONNECTION</div>
              <div style={{ fontSize: "9px", color: C.text, lineHeight: 1.7 }}>
                The Hawkes arrival rate λ(t) feeds directly into the queueing model as the time-varying arrival process.
                When n̂ → 1.0 (critical cascading), λ(t) can spike 10-100× above baseline in minutes. At ρ = λ/μ approaching 1.0,
                queue lengths → ∞ and latency → ∞ (Little's Law). The infrastructure hits Shannon capacity C, and
                packets are dropped rather than delayed. This is the mathematical model of a DDoS taking down a link.
              </div>
              <div style={{ marginTop: "8px", padding: "6px 10px", borderRadius: "4px", background: `${C.accent}08`, border: `1px solid ${C.accent}15`, textAlign: "center" }}>
                <span style={{ fontSize: "12px", fontFamily: SERIF, color: C.accent }}>
                  λ(t) → ρ(t) → L(t) → W(t) → velocity shift → capacity breach
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Crimson+Pro:ital,wght@0,400;0,700;1,400&display=swap');
        @keyframes flowParticle { from { transform: translateX(-20px); } to { transform: translateX(700px); } }
        @keyframes panelSlideIn { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      `}</style>
    </div>
  );
}
