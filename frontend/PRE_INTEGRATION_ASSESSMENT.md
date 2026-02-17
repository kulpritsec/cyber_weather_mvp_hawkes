# Pre-Integration Assessment: Interactive Features

## Current Implementation Status

### ✅ **Completed Components**

#### Phase 3: Interactive Controls
- ✅ **VectorFilter** - Left sidebar with toggleable vector buttons
- ✅ **TimelineSlider** - Bottom scrubber for nowcast/forecast switching
- ✅ **ViewMode** - Top bar for ARCS/HEAT/PARAMS switching
- ✅ **CellDetailPopover** - Basic grid cell information display
- ✅ **SSE Event Stream** - Real-time event streaming backend

#### Phase 4: Shader Overlays
- ✅ **HeatmapOverlay** - Intensity heatmap with color gradients
- ✅ **ForecastOverlay** - Animated forecast visualization
- ✅ **DataTexture System** - Grid-based intensity mapping
- ✅ **Custom GLSL Shaders** - GPU-accelerated rendering

#### Backend
- ✅ **CTI Feed Integration** - DShield, GreyNoise, Abuse.ch
- ✅ **Pipeline Orchestrator** - APScheduler automation
- ✅ **Hawkes Process Fitting** - Parameter estimation with bootstrap
- ✅ **API Endpoints** - /v1/data, /v1/advisories, /v1/pipeline/status, /v1/events/stream

---

## ⚠️ **Missing Components for Full Specification**

### 1. Click-on-Arc Detail Panel (CRITICAL)
**Status**: ❌ Not Implemented
**Requirements**:
- ✅ TubeGeometry for arcs (ALREADY in CyberWeatherGlobe.tsx)
- ❌ 4-tab detail panel (Overview, Hawkes, ATT&CK, Network)
- ❌ D3 sparklines for intensity/branching ratio
- ❌ Threat group correlation matching
- ❌ MITRE ATT&CK mapping
- ❌ Cyber Kill Chain visualization
- ❌ Per-minute packet timeline
- ❌ Hawkes parameter interpretation text

**Components Needed**:
- `ArcDetailPanel.tsx` - Main 4-tab panel container
- `ArcOverviewTab.tsx` - Packets, bandwidth, sparklines, threat correlation
- `ArcHawkesTab.tsx` - Hawkes params, sparklines, plain-language interpretation
- `ArcATTACKTab.tsx` - MITRE techniques, threat groups, Kill Chain
- `ArcNetworkTab.tsx` - Source/target details, ASN, port distribution

### 2. Click-on-Hotspot Cell Panel (CRITICAL)
**Status**: ⚠️ Partially Implemented
**Current**: Basic CellDetailPopover exists but lacks:
- ❌ Dual sparklines (intensity + branching ratio history)
- ❌ 24h event count
- ❌ Threshold markers on sparklines
- ❌ Historical data integration

**Needs Enhancement**:
- Upgrade existing `CellDetailPopover` to `HotspotCellPanel`
- Add D3 sparkline components
- Integrate with /v1/snapshots for historical data

### 3. Temporal Replay Controls (CRITICAL)
**Status**: ❌ Not Implemented
**Requirements**:
- ❌ 48-hour rewind scrubber
- ❌ Playback speed controls (1×, 4×, 16×)
- ❌ LIVE button to snap to real-time
- ❌ Integration with /v1/snapshots endpoint
- ❌ Time-travel state management

**Components Needed**:
- `TemporalReplayControls.tsx` - Main replay interface
- `TimelineScrubber.tsx` - 48-hour range slider
- `PlaybackControls.tsx` - Play/pause/speed buttons

### 4. D3 Sparkline Utilities (CRITICAL)
**Status**: ❌ Not Implemented
**Requirements**:
- ❌ 48-hour intensity sparkline
- ❌ Branching ratio sparkline with threshold lines
- ❌ Per-minute packet timeline
- ❌ Port distribution bar chart

**Components Needed**:
- `sparklines/IntensitySparkline.tsx`
- `sparklines/BranchingRatioSparkline.tsx`
- `sparklines/PacketTimeline.tsx`
- `sparklines/PortDistribution.tsx`

### 5. Threat Intelligence Integration
**Status**: ❌ Not Implemented
**Requirements**:
- ❌ Threat group database/mapping
- ❌ MITRE ATT&CK technique mapping
- ❌ Campaign infrastructure correlation
- ❌ Cyber Kill Chain phase mapping

**Data Structures Needed**:
- Threat group → vector mapping
- Vector → ATT&CK technique mapping
- Known APT infrastructure database
- Campaign correlation logic

### 6. Backend API Gaps
**Status**: ⚠️ Partially Available
**Exists**:
- ✅ /v1/events/stream - Real-time events
- ✅ /v1/data?mode=params - Hawkes parameters
- ✅ /v1/advisories - Threat advisories

**Missing**:
- ❌ /v1/snapshots - Historical Hawkes parameter snapshots
- ❌ /v1/arcs/{id} - Individual arc details endpoint
- ❌ /v1/cells/{id}/history - Cell historical data
- ❌ /v1/correlations - Campaign correlation data
- ❌ /v1/threat-intel/groups - Threat group database

---

## 🎯 **Cutting-Edge Roadmap Features**

### Phase 5 (Next): Core Interactive Panels
**Priority**: HIGH
1. ✅ ArcDetailPanel (4 tabs) - **Build Now**
2. ✅ Enhanced HotspotCellPanel - **Build Now**
3. ✅ TemporalReplayControls - **Build Now**
4. ✅ D3 Sparklines - **Build Now**

### Phase 6 (Advanced): Predictive & AI Features
**Priority**: MEDIUM
1. ⏳ Predictive storm tracks
2. ⏳ Anomaly detection overlay (2σ deviation)
3. ⏳ Campaign correlation graph (D3 force layout)
4. ⏳ Claude API briefing integration
5. ⏳ Collaborative annotations (persistent storage)

---

## 📋 **Implementation Priority Matrix**

### CRITICAL PATH (Build Immediately)
```
1. ArcDetailPanel (all 4 tabs)      [Blocks: Arc clicking functionality]
2. D3 Sparkline utilities           [Blocks: All panels]
3. TemporalReplayControls           [Blocks: Replay feature]
4. Enhanced HotspotCellPanel        [Blocks: Hotspot clicking]
5. Backend /v1/snapshots            [Blocks: Temporal replay + sparklines]
```

### HIGH PRIORITY (Next Sprint)
```
6. Threat Intel integration         [Enhances: Arc Overview tab]
7. MITRE ATT&CK mapping            [Enhances: Arc ATT&CK tab]
8. Arc raycasting integration      [Enables: Arc clicking]
9. Hotspot raycasting integration  [Enables: Hotspot clicking]
```

### FUTURE ENHANCEMENTS (Post-MVP)
```
10. Predictive storm tracks
11. Anomaly detection overlay
12. Campaign correlation graph
13. Claude API briefing
14. Collaborative annotations
```

---

## 🔧 **Technical Debt & Gaps**

### Data Flow Issues
1. **Historical Data**: No backend endpoint for time-series Hawkes parameters
2. **Arc Metadata**: Arcs exist but no data structure for packets/bandwidth/campaign info
3. **Threat Intel**: No integrated threat group database
4. **Snapshots**: ForecastSnapshot table exists but no API endpoint

### Integration Gaps
1. **Raycasting**: No raycasting setup for arc/hotspot click detection
2. **State Management**: No global state for selected arc/cell
3. **Panel Positioning**: No smart positioning logic for detail panels
4. **Data Fetching**: No hooks for fetching arc/cell details on click

### Performance Concerns
1. **D3 in React**: Need proper useEffect hooks to prevent re-renders
2. **Sparkline Updates**: Need memoization for real-time data
3. **Panel Rendering**: Heavy panels may impact 60 FPS target
4. **Historical Data**: 48-hour snapshots could be large payloads

---

## 📦 **Dependencies to Add**

### Frontend
```json
{
  "d3-scale": "^4.0.2",
  "d3-shape": "^3.2.0",
  "d3-array": "^3.2.4",
  "d3-axis": "^3.0.0",
  "d3-selection": "^3.0.0"
}
```

### Backend (for future enhancements)
```python
# Anomaly detection
scikit-learn==1.3.2

# Campaign correlation
networkx==3.2.1

# Claude API integration (already available via Anthropic SDK)
anthropic==0.8.0
```

---

## 🚀 **Recommended Build Sequence**

### Sprint 1: Interactive Panels (Current)
```
Day 1-2: D3 sparkline utilities + components
Day 3-4: ArcDetailPanel (all 4 tabs)
Day 5: Enhanced HotspotCellPanel
Day 6: TemporalReplayControls UI
Day 7: Raycasting integration + testing
```

### Sprint 2: Backend Support
```
Day 1-2: /v1/snapshots endpoint
Day 3: /v1/cells/{id}/history endpoint
Day 4: Threat Intel data structures
Day 5-6: MITRE ATT&CK mapping integration
Day 7: Integration testing
```

### Sprint 3: Advanced Features
```
Day 1-3: Predictive storm tracks
Day 4-5: Anomaly detection overlay
Day 6-7: Campaign correlation graph
```

### Sprint 4: AI & Collaboration
```
Day 1-3: Claude API briefing integration
Day 4-5: Collaborative annotations
Day 6-7: Performance optimization & polish
```

---

## ✅ **What We Have vs What We Need**

### Components: 40% Complete
- ✅ Basic controls (vector filter, timeline, view mode)
- ✅ Basic popover (needs enhancement)
- ✅ Shader overlays (heatmap, forecast)
- ❌ Arc detail panel (0%)
- ❌ Temporal replay (0%)
- ❌ D3 sparklines (0%)

### Backend: 60% Complete
- ✅ CTI feeds, pipeline, Hawkes fitting
- ✅ Basic API endpoints
- ❌ Snapshots endpoint (critical gap)
- ❌ Historical data endpoints
- ❌ Threat intel integration

### Data: 30% Complete
- ✅ Real-time events & parameters
- ❌ Historical time-series data
- ❌ Threat group correlations
- ❌ MITRE ATT&CK mappings
- ❌ Campaign infrastructure database

---

## 🎯 **Next Immediate Actions**

1. **Build D3 Sparklines** - Foundation for all panels
2. **Build ArcDetailPanel** - Core interactive feature
3. **Build TemporalReplayControls** - Unique differentiator
4. **Create /v1/snapshots Backend** - Enable historical data
5. **Integrate Raycasting** - Enable clicking
6. **Full Integration Test** - All components together

---

## 📊 **Estimated Completion**

- **Phase 5 (Interactive Panels)**: ~40-50 hours
- **Backend Support**: ~20-30 hours
- **Advanced Features (Phase 6)**: ~60-80 hours
- **Total to Full Spec**: ~120-160 hours

**MVP-Ready (Core Interactive)**: ~60-80 hours from now

---

## ✨ **Unique Selling Points After Completion**

1. **Only threat map with Hawkes process visualization**
2. **Only map showing branching ratio with plain-language interpretation**
3. **Only map with predictive storm tracks**
4. **Only map with temporal replay (48-hour rewind)**
5. **Only map with AI-generated briefings per click**
6. **Only map with campaign correlation graphs**
7. **Only map with collaborative annotations**

This will be **demonstrably more advanced** than:
- Fortinet Threat Map
- CheckPoint ThreatCloud Map
- FireEye Cyber Threat Map
- Any publicly available threat visualization

---

## 📝 **Conclusion**

**Current State**: Strong foundation with CTI integration, Hawkes modeling, and shader overlays
**Gap**: Missing critical interactive components (detail panels, replay, sparklines)
**Path Forward**: Build Phase 5 components immediately, then enhance with advanced features
**Timeline**: MVP-ready in 60-80 hours, full specification in 120-160 hours

Let's build the interactive panels next! 🚀
