# Phase 4: Heatmap + Forecast Overlays Integration Guide

## Overview
Shader-based visualization overlays for the 3D globe with WebGL DataTexture and custom GLSL shaders.

## New Components Created
✅ `src/components/Globe/HeatmapOverlay.tsx` - Real-time intensity heatmap with Gaussian smoothing
✅ `src/components/Globe/ForecastOverlay.tsx` - Forecast visualization with pulsing/dashed effects
✅ `src/components/Globe/shaderUtils.ts` - DataTexture generation and grid utilities
✅ `src/components/Globe/shaders.ts` - Custom GLSL vertex and fragment shaders
✅ `src/components/Globe/index.ts` - Export barrel file

## Architecture

### DataTexture System
- **Resolution**: 144 columns × 72 rows (2.5° grid matching backend)
- **Format**: RGBA Uint8Array
- **R Channel**: Normalized intensity (0-255)
- **A Channel**: Opacity (0 or 255)
- **Filtering**: Linear interpolation with optional Gaussian smoothing

### Shader Pipeline
1. **Vertex Shader**: Passes UV coordinates and normals
2. **Fragment Shader**:
   - Samples intensity from DataTexture
   - Maps to severity color gradient
   - Applies edge fade (fresnel effect)
   - For forecasts: adds pulsing and dashed patterns

### Color Gradient Mapping
```
Intensity Range → Color
─────────────────────────
0.0 - 0.2      → Clear (Green)
0.2 - 0.4      → Advisory (Blue)
0.4 - 0.6      → Watch (Yellow)
0.6 - 0.8      → Warning (Orange)
0.8 - 1.0      → Emergency (Red)
```

## Integration Steps for CyberWeatherGlobe.tsx

### 1. Add Imports

```typescript
// Add after existing imports:
import { HeatmapOverlay, ForecastOverlay, GridCellData } from './Globe';
```

### 2. Add State for Overlay Data

```typescript
// Add after existing state declarations:
const [heatmapData, setHeatmapData] = useState<GridCellData[]>([]);
const [forecastData, setForecastData] = useState<{
  [horizon: number]: GridCellData[];
}>({
  6: [],
  24: [],
  72: [],
});
const [showHeatmap, setShowHeatmap] = useState(true);
const [showForecast, setShowForecast] = useState(false);
const sceneRef = useRef<THREE.Scene | null>(null);
```

### 3. Process API Data into GridCellData Format

```typescript
// Add helper function to convert API response to GridCellData:
function processApiDataToGridCells(apiResponse: any): GridCellData[] {
  if (!apiResponse || !apiResponse.features) return [];

  return apiResponse.features.map((feature: any) => {
    // Extract center coordinates from polygon
    const coords = feature.geometry.coordinates[0];
    const lat = (coords[0][1] + coords[2][1]) / 2;
    const lon = (coords[0][0] + coords[2][0]) / 2;

    return {
      lat,
      lon,
      intensity: feature.properties.intensity || 0,
      confidence: feature.properties.confidence || 0.8,
    };
  });
}
```

### 4. Fetch and Update Overlay Data

```typescript
// Modify fetchThreatData or create new function:
useEffect(() => {
  async function fetchOverlayData() {
    try {
      // Fetch nowcast data for heatmap
      const nowcastResponse = await fetchCyberData('nowcast', 'ssh', undefined, 2.5);
      setHeatmapData(processApiDataToGridCells(nowcastResponse));

      // Fetch forecast data for all horizons
      const horizons = [6, 24, 72];
      const forecastPromises = horizons.map(async (h) => {
        const response = await fetchCyberData('forecast', 'ssh', h, 2.5);
        return { horizon: h, data: processApiDataToGridCells(response) };
      });

      const forecastResults = await Promise.all(forecastPromises);
      const newForecastData = forecastResults.reduce((acc, { horizon, data }) => {
        acc[horizon] = data;
        return acc;
      }, {} as any);

      setForecastData(newForecastData);
    } catch (error) {
      console.error('Error fetching overlay data:', error);
    }
  }

  fetchOverlayData();
  const interval = setInterval(fetchOverlayData, 30000); // Update every 30s

  return () => clearInterval(interval);
}, []);
```

### 5. Access Three.js Scene Reference

In your `useGlobe` hook or wherever you initialize the Three.js scene:

```typescript
// Store scene reference for overlays
sceneRef.current = scene;
```

### 6. Render Overlay Components

```typescript
// Add to your JSX, inside the main container:

{/* Heatmap Overlay */}
{showHeatmap && sceneRef.current && (
  <HeatmapOverlay
    scene={sceneRef.current}
    cellData={heatmapData}
    opacity={0.7}
    smoothing={true}
  />
)}

{/* Forecast Overlays */}
{showForecast && sceneRef.current && forecastHorizon && (
  <ForecastOverlay
    scene={sceneRef.current}
    cellData={forecastData[forecastHorizon] || []}
    horizon={forecastHorizon}
    opacity={0.6}
  />
)}
```

### 7. Connect to View Mode Control (from Phase 3)

```typescript
// Update handleDisplayModeChange:
const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
  setDisplayMode(mode);

  switch (mode) {
    case 'heatmap':
      setShowHeatmap(true);
      setShowForecast(false);
      break;
    case 'arcs':
      setShowHeatmap(false);
      setShowForecast(false);
      break;
    case 'parameters':
      setShowHeatmap(false);
      setShowForecast(false);
      // Could show parameter-based overlay here
      break;
  }
}, []);
```

### 8. Connect to Timeline Control (from Phase 3)

```typescript
// Update handleTimelineChange:
const handleTimelineChange = useCallback((mode: 'nowcast' | 'forecast', horizon?: number) => {
  setTimelineMode(mode);
  setForecastHorizon(horizon);

  if (mode === 'nowcast') {
    setShowHeatmap(true);
    setShowForecast(false);
  } else if (mode === 'forecast' && horizon) {
    setShowHeatmap(false);
    setShowForecast(true);
  }

  // Trigger data refetch with new mode/horizon
  fetchThreatData().then(setData);
}, []);
```

## Advanced Configuration

### Custom Color Gradients

Modify shader uniforms to use custom colors:

```typescript
const customMaterial = new THREE.ShaderMaterial({
  uniforms: {
    clearColor: { value: new THREE.Color(0x00ff00) },      // Custom green
    emergencyColor: { value: new THREE.Color(0xff0000) },  // Custom red
    // ... other uniforms
  },
});
```

### Adjust Smoothing Intensity

In `shaderUtils.ts`, modify the Gaussian kernel radius:

```typescript
// Less smoothing
const texture = createIntensityDataTexture(cellData);
const smoothedData = applyGaussianSmoothing(texture.image.data, width, height, 1);

// More smoothing
const smoothedData = applyGaussianSmoothing(texture.image.data, width, height, 3);
```

### Multiple Vector Overlays

Combine data from multiple vectors:

```typescript
const allVectorsData = await Promise.all(
  ['ssh', 'rdp', 'http', 'dns_amp'].map(async (vector) => {
    const response = await fetchCyberData('nowcast', vector, undefined, 2.5);
    return processApiDataToGridCells(response);
  })
);

// Merge all data
const combinedData = allVectorsData.flat();
setHeatmapData(combinedData);
```

## Performance Optimization

### Texture Caching
```typescript
const textureCache = useRef<Map<string, THREE.DataTexture>>(new Map());

function getCachedTexture(key: string, data: GridCellData[]): THREE.DataTexture {
  if (textureCache.current.has(key)) {
    return textureCache.current.get(key)!;
  }

  const texture = createIntensityDataTexture(data);
  textureCache.current.set(key, texture);
  return texture;
}
```

### Conditional Rendering
Only render overlays when visible:

```typescript
{displayMode === 'heatmap' && heatmapData.length > 0 && (
  <HeatmapOverlay ... />
)}
```

## Troubleshooting

### Overlay Not Visible
- Check `sceneRef.current` is not null
- Verify `cellData` array has entries
- Ensure opacity > 0
- Check camera is positioned to view the overlay

### Flickering or Z-Fighting
- Adjust sphere radius offsets (1.003, 1.005, etc.)
- Set `depthWrite: false` in ShaderMaterial
- Use different radii for heatmap vs forecast

### Performance Issues
- Reduce texture resolution (use 72x36 instead of 144x72)
- Disable Gaussian smoothing for simpler fragment shader
- Lower sphere geometry segments (64 instead of 128)

### Colors Not Matching
- Verify severity thresholds in fragment shader
- Check color uniform values match design system
- Ensure intensity values are normalized (0.0 - 1.0)

## Testing Checklist

- [ ] Heatmap displays with correct color gradient
- [ ] Forecast overlay has pulsing/dashed effect
- [ ] Overlays update when data changes
- [ ] Smooth transitions between nowcast and forecast
- [ ] Multiple forecast horizons render at different radii
- [ ] Edge fade effect works correctly
- [ ] Performance is smooth (60 FPS) with overlays active
- [ ] Overlays toggle on/off cleanly
- [ ] No memory leaks (textures properly disposed)

## Next Steps

1. Integrate with Phase 3 controls (ViewMode, TimelineSlider)
2. Add overlay fade-in/fade-out animations
3. Implement parameter-based overlay mode
4. Add legend/scale indicator for intensity values
5. Test with live backend data across all vectors
6. Optimize shader performance for mobile devices
7. Commit Phase 4 implementation

## Technical Notes

### WebGL Compatibility
- Requires WebGL 1.0 or higher
- Fragment shader uses standard GLSL ES 1.00
- Compatible with all modern browsers

### Memory Management
- Each DataTexture: ~41KB (144 × 72 × 4 bytes)
- ShaderMaterial: ~10KB
- Total per overlay: ~51KB
- Multiple overlays are manageable for modern GPUs

### Render Order
1. Globe base mesh (opaque)
2. Coastline points (opaque)
3. Heatmap overlay (transparent, additive)
4. Forecast overlays (transparent, additive)
5. Hotspot markers (transparent)
6. Attack arcs (transparent)
