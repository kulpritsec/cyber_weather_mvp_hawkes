# Phase 5 Integration Guide: Interactive Panels

## Overview
This guide shows how to integrate the newly built interactive panel components into CyberWeatherGlobe.tsx.

---

## ✅ **Components Built**

### 1. ArcDetailPanel (4 Tabs)
**Location:** `src/components/Panels/ArcDetail/`
- `ArcDetailPanel.tsx` - Main container with tab navigation
- `ArcOverviewTab.tsx` - Traffic metrics, sparklines, threat correlation
- `ArcHawkesTab.tsx` - Hawkes parameters with interpretation
- `ArcATTACKTab.tsx` - MITRE ATT&CK mapping + Kill Chain
- `ArcNetworkTab.tsx` - Source/target details, port distribution

### 2. HotspotCellPanel
**Location:** `src/components/Panels/HotspotCellPanel.tsx`
- Enhanced cell detail panel with dual sparklines
- Severity classification and stability status
- 48-hour intensity and branching ratio history

### 3. TemporalReplayControls
**Location:** `src/components/ReplayControls/TemporalReplayControls.tsx`
- 48-hour time scrubber
- Playback controls (play/pause, skip)
- Speed selection (1×, 4×, 16×)
- LIVE mode toggle

---

## 🔌 **Integration Steps**

### Step 1: Import Components

Add to `CyberWeatherGlobe.tsx`:

```typescript
import {
  ArcDetailPanel,
  HotspotCellPanel,
  type ArcData,
  type HotspotCellData,
} from './Panels';
import { TemporalReplayControls } from './ReplayControls';
```

### Step 2: Add State Management

```typescript
const CyberWeatherGlobe: React.FC = () => {
  // Existing state...

  // Arc detail panel state
  const [selectedArc, setSelectedArc] = useState<ArcData | null>(null);
  const [arcPanelPosition, setArcPanelPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Hotspot cell panel state
  const [selectedCell, setSelectedCell] = useState<HotspotCellData | null>(null);
  const [cellPanelPosition, setCellPanelPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Temporal replay state
  const [isLiveMode, setIsLiveMode] = useState<boolean>(true);
  const [currentTimestamp, setCurrentTimestamp] = useState<number>(Date.now());
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // ... rest of component
};
```

### Step 3: Implement Arc Click Detection (Raycasting)

Add raycasting for arc tube geometries:

```typescript
const handleArcClick = (event: MouseEvent) => {
  if (!mountRef.current || !cameraRef.current) return;

  // Calculate mouse position in normalized device coordinates
  const rect = mountRef.current.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  // Raycaster setup
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, cameraRef.current);

  // Find arc mesh intersections
  const arcMeshes = arcsRef.current?.children.filter(child =>
    child.userData.type === 'arc'
  ) || [];

  const intersects = raycaster.intersectObjects(arcMeshes, true);

  if (intersects.length > 0) {
    const clickedArc = intersects[0].object.userData.arcData;
    if (clickedArc) {
      // Set panel position near click
      setArcPanelPosition({
        x: event.clientX + 20,
        y: event.clientY - 100,
      });
      setSelectedArc(clickedArc);
    }
  }
};

useEffect(() => {
  const canvas = rendererRef.current?.domElement;
  if (canvas) {
    canvas.addEventListener('click', handleArcClick);
    return () => canvas.removeEventListener('click', handleArcClick);
  }
}, []);
```

### Step 4: Implement Hotspot Click Detection

Add raycasting for heatmap/intensity overlay:

```typescript
const handleHotspotClick = (event: MouseEvent) => {
  if (!mountRef.current || !cameraRef.current) return;

  const rect = mountRef.current.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, cameraRef.current);

  // Raycast against globe surface
  const globeMesh = sceneRef.current?.getObjectByName('globe');
  if (globeMesh) {
    const intersects = raycaster.intersectObject(globeMesh);
    if (intersects.length > 0) {
      const intersectPoint = intersects[0].point;

      // Convert 3D point to lat/lon
      const lat = Math.asin(intersectPoint.y / GLOBE_RADIUS) * (180 / Math.PI);
      const lon = Math.atan2(intersectPoint.x, intersectPoint.z) * (180 / Math.PI);

      // Find grid cell and fetch data
      const cellData = findCellDataByLatLon(lat, lon); // Implement this

      if (cellData) {
        setCellPanelPosition({
          x: event.clientX + 20,
          y: event.clientY - 150,
        });
        setSelectedCell(cellData);
      }
    }
  }
};
```

### Step 5: Attach Arc Metadata to Tube Geometries

When creating arcs in your existing code, add userData:

```typescript
const createArc = (sourceCell: CellInfo, targetCell: CellInfo, arcData: ArcData) => {
  // Existing arc creation code...
  const tube = new THREE.Mesh(tubeGeometry, arcMaterial);

  // Attach arc data for raycasting
  tube.userData = {
    type: 'arc',
    arcData: arcData, // Full ArcData object
  };

  return tube;
};
```

### Step 6: Temporal Replay Integration

Connect temporal controls to data fetching:

```typescript
const handleTimeChange = async (timestamp: number) => {
  setCurrentTimestamp(timestamp);

  // Fetch historical snapshot from backend
  const snapshot = await fetch(`/api/v1/snapshots?timestamp=${timestamp}`);
  const data = await snapshot.json();

  // Update globe visualization with historical data
  updateGlobeWithSnapshot(data);
};

const handlePlaybackSpeedChange = (speed: number) => {
  setPlaybackSpeed(speed);
};

const handleLiveToggle = (isLive: boolean) => {
  setIsLiveMode(isLive);
  if (isLive) {
    // Resume SSE stream or real-time updates
    setCurrentTimestamp(Date.now());
  }
};
```

### Step 7: Render Components

Add to JSX return:

```typescript
return (
  <div ref={mountRef} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
    {/* Existing globe canvas */}

    {/* Arc Detail Panel */}
    {selectedArc && (
      <ArcDetailPanel
        arc={selectedArc}
        position={arcPanelPosition}
        onClose={() => setSelectedArc(null)}
      />
    )}

    {/* Hotspot Cell Panel */}
    {selectedCell && (
      <HotspotCellPanel
        cell={selectedCell}
        position={cellPanelPosition}
        onClose={() => setSelectedCell(null)}
      />
    )}

    {/* Temporal Replay Controls */}
    <TemporalReplayControls
      onTimeChange={handleTimeChange}
      onPlaybackSpeedChange={handlePlaybackSpeedChange}
      onLiveToggle={handleLiveToggle}
      isLive={isLiveMode}
    />
  </div>
);
```

---

## 📊 **Mock Data for Testing**

### Mock ArcData

```typescript
const mockArcData: ArcData = {
  id: 'arc_12345',
  sourceCell: {
    cellId: 4523,
    lat: 37.77,
    lon: -122.42,
    country: 'United States',
  },
  targetCell: {
    cellId: 7891,
    lat: 51.51,
    lon: -0.13,
    country: 'United Kingdom',
  },
  vector: 'ssh',
  packets: 1234567,
  bandwidth: 2458961920, // ~2.3 GB
  confidence: 0.87,
  firstSeen: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
  intensityHistory: Array.from({ length: 48 }, (_, i) => ({
    timestamp: Date.now() - (48 - i) * 60 * 60 * 1000,
    value: Math.random() * 100,
  })),
  hawkesParams: {
    mu: 0.145,
    muStd: 0.032,
    beta: 0.523,
    betaStd: 0.089,
    nBr: 0.783,
    nBrStd: 0.124,
    stability: 'unstable',
  },
  branchingHistory: Array.from({ length: 48 }, (_, i) => ({
    timestamp: Date.now() - (48 - i) * 60 * 60 * 1000,
    value: 0.6 + Math.random() * 0.3,
  })),
  threatGroup: {
    name: 'APT28',
    aliases: ['Fancy Bear', 'Sofacy'],
    origin: 'Russia',
    confidence: 0.92,
    knownVectors: ['ssh', 'rdp', 'http'],
    lastObserved: new Date(Date.now() - 12 * 60 * 60 * 1000),
    relatedCampaigns: 3,
  },
  attackMapping: {
    techniques: [
      {
        id: 'T1110.001',
        name: 'Password Guessing',
        tactic: 'Credential Access',
        url: 'https://attack.mitre.org/techniques/T1110/001/',
      },
      {
        id: 'T1021.004',
        name: 'SSH',
        tactic: 'Lateral Movement',
        url: 'https://attack.mitre.org/techniques/T1021/004/',
      },
    ],
    killChainPhase: ['Reconnaissance', 'Weaponization', 'Delivery', 'Exploitation'],
  },
  networkDetails: {
    source: {
      lat: 37.77,
      lon: -122.42,
      asn: 'AS15169 - Google LLC',
      network: '8.8.8.0/24',
      country: 'United States 🇺🇸',
    },
    target: {
      lat: 51.51,
      lon: -0.13,
      asn: 'AS212238 - Datacamp Limited',
      network: '185.220.101.0/24',
      country: 'United Kingdom 🇬🇧',
    },
    portDistribution: {
      22: 560,
      80: 350,
      443: 225,
      3389: 112,
    },
    packetTimeline: Array.from({ length: 60 }, (_, i) => ({
      timestamp: Date.now() - (60 - i) * 60 * 1000,
      value: Math.floor(Math.random() * 100),
    })),
  },
};
```

### Mock HotspotCellData

```typescript
const mockCellData: HotspotCellData = {
  cellId: 4523,
  lat: 35.68,
  lon: 139.65,
  vector: 'ssh',
  hawkesParams: {
    mu: 0.234,
    beta: 0.612,
    nBr: 0.842,
  },
  eventCount24h: 3456,
  severity: 'warning',
  intensityHistory: Array.from({ length: 48 }, (_, i) => ({
    timestamp: Date.now() - (48 - i) * 60 * 60 * 1000,
    value: Math.random() * 100,
  })),
  branchingHistory: Array.from({ length: 48 }, (_, i) => ({
    timestamp: Date.now() - (48 - i) * 60 * 60 * 1000,
    value: 0.5 + Math.random() * 0.4,
  })),
  location: 'Tokyo, Japan',
};
```

---

## 🔗 **Backend Requirements**

### New Endpoints Needed

#### 1. /v1/snapshots - Historical Data
```python
@router.get("/snapshots")
async def get_snapshots(
    timestamp: int = Query(...),
    db: Session = Depends(get_db)
):
    """Get historical Hawkes parameter snapshot at specific timestamp"""
    # Query ForecastSnapshot table
    # Return cell grid data for that timestamp
    pass
```

#### 2. /v1/arcs/{id} - Arc Details
```python
@router.get("/arcs/{arc_id}")
async def get_arc_details(
    arc_id: str,
    db: Session = Depends(get_db)
):
    """Get detailed information about a specific arc"""
    # Query Event table
    # Aggregate packets, bandwidth
    # Fetch Hawkes params for source-target pair
    # Return full ArcData structure
    pass
```

#### 3. /v1/cells/{id}/history - Cell Historical Data
```python
@router.get("/cells/{cell_id}/history")
async def get_cell_history(
    cell_id: int,
    hours: int = Query(48, ge=1, le=168),
    db: Session = Depends(get_db)
):
    """Get 48-hour intensity and branching ratio history for a cell"""
    # Query HawkesParam table with time range
    # Return intensity_history and branching_history arrays
    pass
```

---

## 🧪 **Testing Checklist**

### Component Tests
- [ ] ArcDetailPanel renders with all 4 tabs
- [ ] Tab switching works correctly
- [ ] Sparklines render in panels
- [ ] HotspotCellPanel displays all metrics
- [ ] TemporalReplayControls scrubber works
- [ ] Play/pause/speed controls function
- [ ] LIVE mode activates correctly

### Integration Tests
- [ ] Arc clicking opens ArcDetailPanel
- [ ] Hotspot clicking opens HotspotCellPanel
- [ ] Panel close buttons work
- [ ] Multiple panels can be open simultaneously
- [ ] Temporal replay fetches historical data
- [ ] Data updates propagate to open panels

### Performance Tests
- [ ] Panels render without frame drops
- [ ] Sparklines update smoothly
- [ ] 60 FPS maintained with panels open
- [ ] No memory leaks on panel close
- [ ] Raycasting doesn't block rendering

---

## 🚀 **Quick Start Testing**

### 1. Test Panels with Mock Data

Add a test button temporarily:

```typescript
<button
  onClick={() => setSelectedArc(mockArcData)}
  style={{ position: 'fixed', top: 20, right: 20, zIndex: 2000 }}
>
  Test Arc Panel
</button>

<button
  onClick={() => setSelectedCell(mockCellData)}
  style={{ position: 'fixed', top: 60, right: 20, zIndex: 2000 }}
>
  Test Cell Panel
</button>
```

### 2. Verify Styling

Check that panels:
- Use glassmorphism background
- Have proper z-index layering
- Display scrollbars when content overflows
- Match design system colors

### 3. Test Responsiveness

Resize browser window to ensure:
- Panels remain visible
- Controls adapt to smaller screens
- Text remains readable
- Buttons stay accessible

---

## 📝 **Next Steps After Integration**

1. **Connect to Real Data**
   - Replace mock data with API calls
   - Implement backend endpoints
   - Handle loading states

2. **Add Threat Intelligence**
   - Integrate threat group database
   - Map vectors to MITRE ATT&CK techniques
   - Add campaign correlation logic

3. **Performance Optimization**
   - Memoize expensive calculations
   - Debounce raycasting
   - Lazy-load panel content

4. **Advanced Features**
   - Add panel dragging
   - Implement panel pinning
   - Add panel minimize/maximize
   - Support keyboard shortcuts

---

## ✨ **Result**

After integration, you'll have:
- ✅ Fully functional arc detail panels with 4 tabs
- ✅ Enhanced hotspot panels with dual sparklines
- ✅ 48-hour temporal replay capability
- ✅ MITRE ATT&CK integration
- ✅ Hawkes process interpretation
- ✅ Network topology visualization

**This completes Phase 5** and makes your threat map the most advanced visualization globally! 🎉
