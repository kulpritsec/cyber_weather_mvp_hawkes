import * as THREE from 'three';

/**
 * Grid configuration matching backend
 * 2.5° resolution = 72 rows × 144 columns
 */
export const GRID_CONFIG = {
  resolution: 2.5,
  rows: Math.floor(180 / 2.5), // 72
  cols: Math.floor(360 / 2.5), // 144
};

/**
 * Severity color gradient (matches weather metaphor)
 */
export const SEVERITY_COLORS = {
  clear: new THREE.Color(0x22c55e),      // Green
  advisory: new THREE.Color(0x3b82f6),   // Blue
  watch: new THREE.Color(0xeab308),      // Yellow
  warning: new THREE.Color(0xf97316),    // Orange
  emergency: new THREE.Color(0xef4444),  // Red
};

/**
 * Grid cell data structure
 */
export interface GridCellData {
  lat: number;
  lon: number;
  intensity: number;
  confidence?: number;
}

/**
 * Convert lat/lon to grid indices
 */
export function latLonToGridIndex(lat: number, lon: number): { row: number; col: number } {
  const row = Math.floor((90 - lat) / GRID_CONFIG.resolution);
  const col = Math.floor((lon + 180) / GRID_CONFIG.resolution);

  return {
    row: Math.max(0, Math.min(GRID_CONFIG.rows - 1, row)),
    col: Math.max(0, Math.min(GRID_CONFIG.cols - 1, col)),
  };
}

/**
 * Create DataTexture from grid cell data
 *
 * @param cellData Array of grid cell data with lat/lon/intensity
 * @param width Texture width (default: 144)
 * @param height Texture height (default: 72)
 * @returns THREE.DataTexture containing intensity values
 */
export function createIntensityDataTexture(
  cellData: GridCellData[],
  width: number = GRID_CONFIG.cols,
  height: number = GRID_CONFIG.rows
): THREE.DataTexture {
  const size = width * height;
  const data = new Uint8Array(4 * size); // RGBA

  // Initialize to transparent
  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    data[idx] = 0;     // R
    data[idx + 1] = 0; // G
    data[idx + 2] = 0; // B
    data[idx + 3] = 0; // A (transparent)
  }

  // Compute max for normalization
  const maxIntensity = Math.max(1, ...cellData.map(c => c.intensity));

  // Fill with cell data
  cellData.forEach((cell) => {
    const { row, col } = latLonToGridIndex(cell.lat, cell.lon);
    const idx = (row * width + col) * 4;

    // Normalize intensity relative to dataset max
    const rawNorm = cell.intensity / maxIntensity;
    const normalizedIntensity = rawNorm < 0.05 ? 0 : Math.min(255, Math.floor(rawNorm * 255));

    data[idx] = normalizedIntensity;     // R channel = intensity
    data[idx + 1] = normalizedIntensity; // G channel = intensity
    data[idx + 2] = normalizedIntensity; // B channel = intensity
    data[idx + 3] = normalizedIntensity; // A channel = opacity
  });

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return texture;
}

/**
 * Apply gaussian blur to texture data for smooth interpolation
 */
export function applyGaussianSmoothing(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number = 1
): Uint8Array {
  const result = new Uint8Array(data.length);
  const kernel = generateGaussianKernel(radius);
  const kernelSize = kernel.length;
  const halfKernel = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, weightSum = 0;

      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const sampleX = (x + kx + width) % width;
          const sampleY = Math.max(0, Math.min(height - 1, y + ky));
          const sampleIdx = (sampleY * width + sampleX) * 4;

          const weight = kernel[ky + halfKernel] * kernel[kx + halfKernel];

          sumR += data[sampleIdx] * weight;
          sumG += data[sampleIdx + 1] * weight;
          sumB += data[sampleIdx + 2] * weight;
          sumA += data[sampleIdx + 3] * weight;
          weightSum += weight;
        }
      }

      const idx = (y * width + x) * 4;
      result[idx] = sumR / weightSum;
      result[idx + 1] = sumG / weightSum;
      result[idx + 2] = sumB / weightSum;
      result[idx + 3] = sumA / weightSum;
    }
  }

  return result;
}

/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(radius: number): number[] {
  const size = radius * 2 + 1;
  const kernel: number[] = [];
  const sigma = radius / 2;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }

  // Normalize
  return kernel.map(v => v / sum);
}

/**
 * Map intensity value to severity color
 */
export function intensityToColor(intensity: number): THREE.Color {
  if (intensity >= 0.8) return SEVERITY_COLORS.emergency;
  if (intensity >= 0.6) return SEVERITY_COLORS.warning;
  if (intensity >= 0.4) return SEVERITY_COLORS.watch;
  if (intensity >= 0.2) return SEVERITY_COLORS.advisory;
  return SEVERITY_COLORS.clear;
}
