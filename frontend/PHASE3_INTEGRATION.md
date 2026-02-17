# Phase 3: Interactive Controls Integration Guide

## Overview
This document outlines the changes needed to integrate Phase 3 interactive controls into CyberWeatherGlobe.tsx.

## New Components Created
✅ `src/components/Controls/VectorFilter.tsx` - Toggle attack vectors on/off
✅ `src/components/Controls/TimelineSlider.tsx` - Switch between nowcast and forecast horizons
✅ `src/components/Controls/ViewMode.tsx` - Toggle display modes (heatmap/arcs/parameters)
✅ `src/components/Controls/CellDetailPopover.tsx` - Show grid cell details on click
✅ `src/components/Controls/index.ts` - Export barrel file

## Integration Steps for CyberWeatherGlobe.tsx

### 1. Add Imports (at top of file, after existing imports)

```typescript
// Add after line 3:
import { VectorFilter, TimelineSlider, ViewMode, CellDetailPopover, DisplayMode } from './Controls';
import { Raycaster, Vector2 } from 'three';
```

### 2. Add State Management (after existing state declarations, around line 571)

```typescript
// Add after line 574:
  // Interactive controls state
  const [enabledVectors, setEnabledVectors] = useState({
    ssh: true,
    rdp: true,
    http: true,
    dns_amp: true,
  });
  const [timelineMode, setTimelineMode] = useState<'nowcast' | 'forecast'>('nowcast');
  const [forecastHorizon, setForecastHorizon] = useState<number | undefined>(undefined);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('arcs');
  const [selectedCell, setSelectedCell] = useState<any>(null);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const raycasterRef = useRef<Raycaster>(new Raycaster());
  const mouseRef = useRef<Vector2>(new Vector2());
```

### 3. Add Vector Config for VectorFilter

```typescript
// Add after state declarations:
  const vectorConfigs = [
    { name: 'ssh', label: 'SSH', color: COLORS.arcSSH, enabled: enabledVectors.ssh },
    { name: 'rdp', label: 'RDP', color: COLORS.arcRDP, enabled: enabledVectors.rdp },
    { name: 'http', label: 'HTTP', color: COLORS.arcHTTP, enabled: enabledVectors.http },
    { name: 'dns_amp', label: 'DNS Amp', color: COLORS.arcDNS, enabled: enabledVectors.dns_amp },
  ];
```

### 4. Add Event Handlers

```typescript
// Add before useEffect hooks:
  const handleVectorToggle = useCallback((vectorName: string) => {
    setEnabledVectors(prev => ({
      ...prev,
      [vectorName]: !prev[vectorName as keyof typeof prev]
    }));
  }, []);

  const handleTimelineChange = useCallback((mode: 'nowcast' | 'forecast', horizon?: number) => {
    setTimelineMode(mode);
    setForecastHorizon(horizon);
    // Trigger data refetch with new mode/horizon
    fetchThreatData().then(setData);
  }, []);

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
  }, []);

  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!canvasRef.current || !data) return;

    const rect = canvasRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycasting logic would go here to detect clicked hotspot
    // For now, just show popover at click position
    setPopoverPosition({ x: event.clientX, y: event.clientY });

    // TODO: Implement full raycasting to find clicked grid cell
    // and populate selectedCell with actual cell data
  }, [data]);
```

### 5. Add Canvas Click Listener

```typescript
// Add new useEffect after existing ones:
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('click', handleCanvasClick);
    return () => canvas.removeEventListener('click', handleCanvasClick);
  }, [handleCanvasClick]);
```

### 6. Add Control Components to JSX

```typescript
// Add these components inside the main return div, before the closing </div>:

      {/* Interactive Controls */}
      <VectorFilter
        vectors={vectorConfigs}
        onToggle={handleVectorToggle}
      />

      <TimelineSlider
        currentMode={timelineMode}
        currentHorizon={forecastHorizon}
        onChange={handleTimelineChange}
      />

      <ViewMode
        currentMode={displayMode}
        onChange={handleDisplayModeChange}
      />

      {selectedCell && (
        <CellDetailPopover
          cellInfo={selectedCell}
          position={popoverPosition}
          onClose={() => setSelectedCell(null)}
        />
      )}
```

### 7. Filter Displayed Hotspots by Enabled Vectors

```typescript
// Modify the hotspots rendering logic (in useGlobe hook or wherever hotspots are rendered)
// to filter by enabledVectors:

const visibleHotspots = data?.top_threats.filter(
  hotspot => enabledVectors[hotspot.vector as keyof typeof enabledVectors]
) || [];

// Use visibleHotspots instead of data?.top_threats for rendering
```

## Raycasting Implementation (Advanced)

For full raycasting support to detect clicked grid cells:

```typescript
const handleCanvasClick = useCallback((event: MouseEvent) => {
  if (!canvasRef.current || !data) return;

  const rect = canvasRef.current.getBoundingClientRect();
  const mouse = new Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  // Raycast against hotspot meshes (assuming they're stored in a ref)
  raycasterRef.current.setFromCamera(mouse, camera);
  const intersects = raycasterRef.current.intersectObjects(hotspotMeshes);

  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    const hotspotData = clickedMesh.userData;  // Attach hotspot data to mesh.userData

    // Fetch full cell details from API
    fetchCyberData('params', hotspotData.vector, undefined, 2.5).then(response => {
      const cellFeature = response.features.find((f: any) =>
        f.properties.grid_id === hotspotData.gridId
      );

      if (cellFeature) {
        setSelectedCell({
          gridId: cellFeature.properties.grid_id,
          vector: hotspotData.vector,
          lat: hotspotData.lat,
          lon: hotspotData.lon,
          intensity: hotspotData.intensity,
          confidence: cellFeature.properties.confidence || 0.8,
          params: {
            mu: cellFeature.properties.mu,
            beta: cellFeature.properties.beta,
            n_br: cellFeature.properties.n_br,
            mu_std: cellFeature.properties.mu_std,
            beta_std: cellFeature.properties.beta_std,
            n_br_std: cellFeature.properties.n_br_std,
            stability: cellFeature.properties.stability,
          },
          advisories: [], // Fetch from /v1/advisories endpoint
        });
        setPopoverPosition({ x: event.clientX, y: event.clientY });
      }
    });
  }
}, [data]);
```

## Testing Checklist

- [ ] VectorFilter toggles show/hide vectors correctly
- [ ] TimelineSlider switches between nowcast and forecast data
- [ ] ViewMode changes display style (once implemented in globe rendering)
- [ ] Clicking hotspots shows CellDetailPopover with correct data
- [ ] Popover displays Hawkes parameters with proper formatting
- [ ] Severity colors match branching ratio thresholds
- [ ] All controls have smooth animations and hover effects

## Next Steps

After integration:
1. Test all controls with live backend data
2. Implement full raycasting for precise click detection
3. Add advisory fetching to popover
4. Implement display mode switching in globe renderer
5. Add keyboard shortcuts for common actions
6. Commit Phase 3A implementation
7. Proceed to Phase 3B (SSE Event Stream)
