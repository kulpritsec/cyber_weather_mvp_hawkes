# Cyber Weather Forecast — Frontend

React + Three.js frontend featuring an interactive 3D threat intelligence globe with live backend integration.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Runs at **http://localhost:5173** — expects backend at **http://localhost:8000**.

## Stack

| Library | Purpose |
|---------|---------|
| React 18 | Component framework |
| Three.js 0.169 | 3D globe rendering |
| D3 (contour, geo, scale, array) | Contour generation, projections, color scales |
| Vite 5 | Dev server and build toolchain |
| TypeScript 5.5 | Type safety |

## Project Structure

```
frontend/src/
├── App.tsx                    # Root — mounts CyberWeatherGlobe
├── components/
│   ├── CyberWeatherGlobe.tsx  # Main component — globe + all panel state
│   └── Panels/
│       ├── index.ts           # Barrel exports
│       ├── ArcDetail/         # Arc detail panel (Overview, Hawkes, ATT&CK, Network tabs)
│       ├── HotspotCellPanel/  # Hotspot cell detail panel
│       ├── PredictiveContextPanel.tsx  # PCE — live feed, arcs, forecasts, campaigns
│       ├── MathLabPanel.tsx   # Hawkes process blackboard (animated)
│       ├── InfrastructurePanel.tsx     # Cable/IXP/cloud/satellite topology map
│       └── Sparklines/        # IntensitySparkline, BranchingRatioSparkline
```

## Panels

All panels are overlaid on the globe. Toolbar buttons toggle them; `Esc` closes all.

### Predictive Context Engine (`PCE`)
Live panel wired to all `/v1/context/*` backend endpoints. Shows:
- Recent event count and top vectors
- Seasonal threat curves (monthly)
- Threat actor campaigns with elevation status
- 30-day Hawkes intensity forecast chart
- Active arc visualizations between source/target regions

### Math Lab (`∫ λ(t)`)
Animated Hawkes process teaching tool — no backend data required. Features:
- Real-time SVG intensity chart drawn at 60fps via `requestAnimationFrame`
- Simulated event stream with configurable arrival rate
- Parameter sliders: μ_base, α (excitability), β (decay rate)
- Live n̂ = α/β readout with criticality status (subcritical / near-critical / supercritical)
- Animated covariate bar: S(t) seasonal · E(t) geopolitical · C(t) campaign multipliers
- Arc gauges for each parameter
- Speed controls: 0.25× / 1× / 2× / 4×

### Infrastructure Topology (`🌐 NET`)
SVG Mercator world map — no external map library. Toggleable layers:
- **Submarine cables** — 8 major cables (TAT-14, SEA-ME-WE 6, JUPITER, Curie, 2Africa, MAREA, Havfrue, SJC2)
- **IXPs** — 8 major internet exchange points with pulsing SVG animations
- **Cloud regions** — AWS / Azure / GCP regions (14 total) with provider color coding
- **Satellite bands** — Starlink / OneWeb / Kuiper coverage latitude bands

Positioned left side so it can be open simultaneously with right-side panels.

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview production build locally
```
