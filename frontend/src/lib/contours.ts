import { contours } from 'd3-contour'

interface GridPoint {
  lat: number
  lon: number
  value: number
}

export function generateContours(gridData: GridPoint[], levels: number[] = [0.2, 0.4, 0.6, 0.8]) {
  if (!gridData.length) return []

  // Create a regular grid for contouring
  const latExtent = [Math.min(...gridData.map(d => d.lat)), Math.max(...gridData.map(d => d.lat))]
  const lonExtent = [Math.min(...gridData.map(d => d.lon)), Math.max(...gridData.map(d => d.lon))]
  
  const width = 120  // grid resolution for contouring
  const height = 60
  
  const latStep = (latExtent[1] - latExtent[0]) / height
  const lonStep = (lonExtent[1] - lonExtent[0]) / width
  
  // Create interpolated grid
  const grid = new Array(width * height).fill(0)
  
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const lat = latExtent[0] + i * latStep
      const lon = lonExtent[0] + j * lonStep
      
      // Find nearest grid points and interpolate
      let totalWeight = 0
      let weightedSum = 0
      
      for (const point of gridData) {
        const dist = Math.sqrt(Math.pow(point.lat - lat, 2) + Math.pow(point.lon - lon, 2))
        if (dist < 0.01) { // very close point
          weightedSum = point.value
          totalWeight = 1
          break
        }
        const weight = 1 / (1 + dist * dist)
        weightedSum += point.value * weight
        totalWeight += weight
      }
      
      grid[i * width + j] = totalWeight > 0 ? weightedSum / totalWeight : 0
    }
  }
  
  // Generate contours
  const contourGenerator = contours()
    .size([width, height])
    .thresholds(levels)
  
  const contourLines = contourGenerator(grid)
  
  // Convert to geographic coordinates
  return contourLines.map((contour: any, i: number) => ({
    level: levels[i],
    coordinates: contour.coordinates.map((ring: any) => 
      ring.map((polygon: any) => 
        polygon.map(([x, y]: [number, number]) => [
          lonExtent[0] + (x / width) * (lonExtent[1] - lonExtent[0]),
          latExtent[0] + (y / height) * (latExtent[1] - latExtent[0])
        ])
      )
    )
  }))
}