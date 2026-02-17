# Interactive Panels Build Guide

## Overview
This document provides complete specifications for building the remaining interactive components based on the assessment. Components are prioritized by criticality and dependencies.

---

## ✅ **Completed Components**

### Phase 1-4 (Foundation)
- ✅ VectorFilter, TimelineSlider, ViewMode, CellDetailPopover
- ✅ HeatmapOverlay, ForecastOverlay, Shader system
- ✅ CTI feeds, Pipeline orchestrator, Hawkes fitting
- ✅ SSE event stream

### Current Sprint (Sparklines)
- ✅ **IntensitySparkline** - 48-hour intensity visualization
- ✅ **BranchingRatioSparkline** - n̂ with threshold markers (0.5, 0.7, 0.9)

---

## 🚧 **Critical Path Components to Build**

### 1. ArcDetailPanel (4 Tabs) - PRIORITY 1

**File Structure:**
```
src/components/Panels/ArcDetail/
├── ArcDetailPanel.tsx          (Main container with tabs)
├── ArcOverviewTab.tsx          (Packets, bandwidth, sparklines, threat correlation)
├── ArcHawkesTab.tsx            (Hawkes parameters + interpretation)
├── ArcATTACKTab.tsx            (MITRE techniques + Kill Chain)
├── ArcNetworkTab.tsx           (Source/target details, ASN, ports)
└── index.ts
```

#### ArcDetailPanel.tsx
Main container with 4-tab navigation:
```typescript
interface ArcDetailPanelProps {
  arc: ArcData;
  position: { x: number; y: number };
  onClose: () => void;
}

interface ArcData {
  id: string;
  sourceCell: CellInfo;
  targetCell: CellInfo;
  vector: string;
  packets: number;
  bandwidth: number;
  confidence: number;
  firstSeen: Date;
  intensityHistory: DataPoint[];
  hawkesParams: HawkesParams;
  branchingHistory: DataPoint[];
  threatGroup?: ThreatGroupInfo;
  attackMapping: MITREMapping;
  networkDetails: NetworkInfo;
}
```

**Design:**
- Floating panel at click position
- 4 tabs: Overview | Hawkes | ATT&CK | Network
- 600px width, auto height (max 500px)
- Glassmorphism design matching existing controls
- Close button (X) in header
- Tab content scrollable if needed

#### ArcOverviewTab.tsx
Shows:
1. **Metrics Section**:
   - Packets: `1,234,567`
   - Bandwidth: `2.3 GB`
   - Confidence: `87%` with progress bar
   - First Seen: `2026-02-15 14:23:18 UTC`

2. **48-Hour Intensity Sparkline**:
   ```tsx
   <IntensitySparkline
     data={arc.intensityHistory}
     width={500}
     height={60}
   />
   ```

3. **Threat Group Correlation** (if matched):
   ```tsx
   <div className="threat-correlation-box">
     <div className="threat-icon">⚠️</div>
     <div className="threat-info">
       <div className="threat-name">APT28 / Fancy Bear</div>
       <div className="threat-origin">Russia</div>
       <div className="threat-confidence">92% match confidence</div>
     </div>
   </div>
   ```

4. **Infrastructure Match** (if applicable):
   - Known campaign infrastructure: `YES`
   - Related campaigns: `3 active`
   - Last observed: `12 hours ago`

#### ArcHawkesTab.tsx
Shows:
1. **Raw Parameters**:
   ```
   μ (Base Rate):        0.145 ± 0.032 events/hour
   β (Decay Rate):       0.523 ± 0.089 /hour
   n̂ (Branching Ratio): 0.783 ± 0.124
   ```

2. **48-Hour Branching Ratio Sparkline**:
   ```tsx
   <BranchingRatioSparkline
     data={arc.branchingHistory}
     width={500}
     height={80}
     showThresholds={true}
   />
   ```

3. **Plain-Language Interpretation**:
   ```tsx
   <div className="process-interpretation">
     <p><strong>Operational Analysis:</strong></p>
     <p>
       Each observed attack event triggers an average of <strong>0.78 offspring events</strong>.
       The system is <strong>approaching critical instability</strong> (n̂ {'>'} 0.7).

       This indicates a <strong>self-sustaining attack pattern</strong> where successful
       compromises are being leveraged to launch follow-on attacks. The branching ratio
       has increased 23% over the past 12 hours, suggesting <strong>active exploitation</strong>
       of vulnerable infrastructure.
     </p>
     <p><strong>Stability:</strong> {arc.hawkesParams.stability}</p>
   </div>
   ```

#### ArcATTACKTab.tsx
Shows:
1. **MITRE ATT&CK Mapping**:
   ```tsx
   const VECTOR_TO_ATTACK_MAP = {
     ssh: [
       { id: 'T1110.001', name: 'Password Guessing', tactic: 'Credential Access' },
       { id: 'T1021.004', name: 'SSH', tactic: 'Lateral Movement' },
     ],
     rdp: [
       { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access' },
       { id: 'T1021.001', name: 'RDP', tactic: 'Lateral Movement' },
     ],
     http: [
       { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access' },
       { id: 'T1505.003', name: 'Web Shell', tactic: 'Persistence' },
     ],
   };
   ```

   Render as cards:
   ```tsx
   {techniques.map(tech => (
     <div key={tech.id} className="attack-technique">
       <div className="tech-id">{tech.id}</div>
       <div className="tech-name">{tech.name}</div>
       <div className="tech-tactic">{tech.tactic}</div>
     </div>
   ))}
   ```

2. **Correlated Threat Groups**:
   - APT28 (Russia) - Known vectors: SSH, RDP
   - APT41 (China) - Known vectors: HTTP, DNS
   - Lazarus Group (N. Korea) - Known vectors: HTTP, SSH

3. **Cyber Kill Chain Position**:
   ```
   [✓] Reconnaissance
   [✓] Weaponization
   [✓] Delivery
   [●] Exploitation  ← Current Phase
   [ ] Installation
   [ ] C2
   [ ] Actions on Objectives
   ```

#### ArcNetworkTab.tsx
Shows:
1. **Source Cell Details**:
   - Location: `37.77°N, 122.42°W`
   - ASN: `AS15169 - Google LLC`
   - Network: `8.8.8.0/24`
   - Country: `United States 🇺🇸`

2. **Target Cell Details**:
   - Location: `51.51°N, 0.13°W`
   - ASN: `AS212238 - Datacamp Limited`
   - Network: `185.220.101.0/24`
   - Country: `United Kingdom 🇬🇧`

3. **Port Distribution** (Bar Chart):
   ```
   Port 22:   ████████████████████ 45%
   Port 80:   ████████████ 28%
   Port 443:  ████████ 18%
   Port 3389: ████ 9%
   ```

4. **Per-Minute Packet Timeline** (Sparkline):
   - X-axis: Last 60 minutes
   - Y-axis: Packets per minute
   - Shows activity bursts

---

### 2. Enhanced HotspotCellPanel - PRIORITY 2

**File:** `src/components/Panels/HotspotCellPanel.tsx`

Upgrade existing CellDetailPopover to show:

1. **Cell Header**:
   - Grid ID: `#4523`
   - Vector: `SSH` badge
   - Location: `35.68°N, 139.65°E (Tokyo)`

2. **Current Metrics**:
   - Hawkes Parameters: μ=0.234, β=0.612, n̂=0.842
   - 24h Event Count: `3,456 events`
   - Severity: `WARNING` badge

3. **Dual Sparklines**:
   ```tsx
   <div className="sparkline-section">
     <div className="sparkline-header">48h Intensity</div>
     <IntensitySparkline data={intensityHistory} width={280} height={40} />
   </div>

   <div className="sparkline-section">
     <div className="sparkline-header">48h Branching Ratio</div>
     <BranchingRatioSparkline data={branchingHistory} width={280} height={50} />
   </div>
   ```

4. **Severity Classification**:
   - Current: `WARNING (n̂ = 0.842)`
   - Status: `Unstable (approaching critical)`
   - Trend: `↑ Increasing (+ 15% / 6h)`

---

### 3. TemporalReplayControls - PRIORITY 3

**File:** `src/components/ReplayControls/TemporalReplayControls.tsx`

Bottom-center control panel with:

1. **48-Hour Scrubber**:
   ```tsx
   <input
     type="range"
     min={Date.now() - 48 * 3600 * 1000}
     max={Date.now()}
     value={currentTime}
     onChange={(e) => setCurrentTime(parseInt(e.target.value))}
     className="time-scrubber"
   />
   ```

2. **Playback Controls**:
   - ⏮ Skip to Start
   - ▶ Play / ⏸ Pause
   - ⏭ Skip to End

3. **Speed Selector**:
   - `1× | 4× | 16×` buttons
   - Active speed highlighted

4. **Live Button**:
   ```tsx
   <button
     onClick={() => setCurrentTime(Date.now())}
     className={isLive ? 'live-active' : 'live-inactive'}
   >
     {isLive ? '● LIVE' : 'GO LIVE'}
   </button>
   ```

5. **Time Display**:
   - Current: `2026-02-14 18:45:32 UTC`
   - Offset: `-6 hours ago`

**Backend Integration**:
Fetches from `/v1/snapshots?start={timestamp}&end={timestamp}` to get historical Hawkes parameters.

---

## 📊 **Data Structures Needed**

### ThreatGroupInfo
```typescript
interface ThreatGroupInfo {
  name: string;
  aliases: string[];
  origin: string;
  confidence: number;
  knownVectors: string[];
  lastObserved: Date;
  relatedCampaigns: number;
}
```

### MITREMapping
```typescript
interface MITREMapping {
  techniques: Array<{
    id: string;
    name: string;
    tactic: string;
    url: string;
  }>;
  killChainPhase: string[];
}
```

### NetworkInfo
```typescript
interface NetworkInfo {
  source: {
    lat: number;
    lon: number;
    asn: string;
    network: string;
    country: string;
  };
  target: {
    lat: number;
    lon: number;
    asn: string;
    network: string;
    country: string;
  };
  portDistribution: Record<number, number>;
  packetTimeline: DataPoint[];
}
```

---

## 🔌 **Backend Endpoints Needed**

### /v1/arcs/{id} - Arc Details
```json
GET /v1/arcs/{arc_id}
Response:
{
  "arc_id": "arc_123",
  "source_cell_id": 4523,
  "target_cell_id": 7891,
  "vector": "ssh",
  "packets": 1234567,
  "bandwidth_bytes": 2458961920,
  "confidence": 0.87,
  "first_seen": "2026-02-15T14:23:18Z",
  "intensity_history": [...],
  "hawkes_params": {...},
  "branching_history": [...]
}
```

### /v1/cells/{id}/history - Cell Historical Data
```json
GET /v1/cells/{cell_id}/history?hours=48
Response:
{
  "cell_id": 4523,
  "intensity_history": [
    {"timestamp": 1708012800, "value": 12.3},
    ...
  ],
  "branching_history": [
    {"timestamp": 1708012800, "value": 0.67},
    ...
  ]
}
```

### /v1/snapshots - Historical Snapshots
```json
GET /v1/snapshots?start=1708012800&end=1708099200
Response:
{
  "snapshots": [
    {
      "timestamp": 1708012800,
      "cells": [
        {"cell_id": 4523, "mu": 0.234, "beta": 0.612, "n_br": 0.842},
        ...
      ]
    },
    ...
  ]
}
```

---

## 🎨 **Design System Tokens**

Use consistent styling across all panels:

```css
/* Panel Base */
background: rgba(10, 15, 25, 0.95);
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.15);
border-radius: 12px;
box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);

/* Typography */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Headers */
color: #FFFFFF;
font-size: 14px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.5px;

/* Body Text */
color: #E0EAF8;
font-size: 13px;

/* Secondary Text */
color: #8B92A4;
font-size: 11px;

/* Badges */
padding: 4px 10px;
border-radius: 4px;
font-size: 11px;
font-weight: 700;

/* Severity Colors */
clear: #10B981 (Green)
advisory: #3B82F6 (Blue)
watch: #EAB308 (Yellow)
warning: #F59E0B (Orange)
emergency: #EF4444 (Red)
```

---

## 🧪 **Testing Checklist**

### Unit Tests
- [ ] Sparklines render with various data sets
- [ ] Panel tabs switch correctly
- [ ] Temporal controls update state
- [ ] Close buttons work
- [ ] Tooltips display on hover

### Integration Tests
- [ ] Arc clicking opens correct panel
- [ ] Hotspot clicking shows cell details
- [ ] Temporal replay fetches snapshots
- [ ] Data updates propagate to panels
- [ ] Multiple panels can be open simultaneously

### Performance Tests
- [ ] Panels render without janking
- [ ] Sparklines update smoothly
- [ ] 60 FPS maintained with panels open
- [ ] Memory cleanup on panel close

---

## 📝 **Implementation Order**

**Week 1: Sparklines & Basic Panels**
1. ✅ IntensitySparkline
2. ✅ BranchingRatioSparkline
3. Port distribution chart
4. ArcDetailPanel container (tabs only)

**Week 2: Arc Panel Tabs**
5. ArcOverviewTab
6. ArcHawkesTab
7. ArcATTACKTab
8. ArcNetworkTab

**Week 3: Hotspot & Replay**
9. Enhanced HotspotCellPanel
10. TemporalReplayControls
11. Backend /v1/snapshots endpoint

**Week 4: Integration & Testing**
12. Raycasting for arc clicks
13. Raycasting for hotspot clicks
14. Full integration testing
15. Performance optimization

---

## 🚀 **Quick Start Command Sequence**

```bash
# Create remaining component files
touch src/components/Panels/ArcDetail/ArcDetailPanel.tsx
touch src/components/Panels/ArcDetail/ArcOverviewTab.tsx
touch src/components/Panels/ArcDetail/ArcHawkesTab.tsx
touch src/components/Panels/ArcDetail/ArcATTACKTab.tsx
touch src/components/Panels/ArcDetail/ArcNetworkTab.tsx
touch src/components/Panels/HotspotCellPanel.tsx
touch src/components/ReplayControls/TemporalReplayControls.tsx

# Build each component following the specifications above
# Test individually
# Integrate with CyberWeatherGlobe
# Deploy!
```

---

## 💡 **Pro Tips**

1. **Reuse Existing Styles**: Copy glassmorphism styles from VectorFilter/CellDetailPopover
2. **Mock Data First**: Build panels with mock data before integrating API
3. **Component Library**: Extract common elements (badges, metrics, headers) into shared components
4. **Storybook**: Build panels in isolation using Storybook for faster iteration
5. **TypeScript Strict**: Enable strict mode to catch data structure mismatches early

---

## ✨ **After Completion**

You'll have:
- ✅ Most advanced threat visualization globally
- ✅ Only map showing Hawkes process interpretation
- ✅ Only map with temporal replay
- ✅ Only map with MITRE ATT&CK integration
- ✅ Only map with threat group correlation
- ✅ Production-ready MVP

Next: Advanced features (predictive tracks, anomaly detection, Claude API, etc.)
