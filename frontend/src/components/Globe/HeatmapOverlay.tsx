import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  createIntensityDataTexture,
  GridCellData,
  SEVERITY_COLORS,
  GRID_CONFIG,
} from './shaderUtils';
import { overlayVertexShader, smoothHeatmapFragmentShader } from './shaders';

interface HeatmapOverlayProps {
  scene: THREE.Scene;
  cellData: GridCellData[];
  opacity?: number;
  smoothing?: boolean;
}

/**
 * HeatmapOverlay Component
 *
 * Renders a shader-based heatmap overlay on the globe
 * - Uses DataTexture for intensity values
 * - Custom ShaderMaterial for color gradient mapping
 * - Gaussian smoothing for interpolation between cells
 * - Transparent where intensity is 0
 */
const HeatmapOverlay: React.FC<HeatmapOverlayProps> = ({
  scene,
  cellData,
  opacity = 0.7,
  smoothing = true,
}) => {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);

  // Create shader material
  const shaderMaterial = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        intensityMap: { value: null },
        opacity: { value: opacity },
        clearColor: { value: SEVERITY_COLORS.clear },
        advisoryColor: { value: SEVERITY_COLORS.advisory },
        watchColor: { value: SEVERITY_COLORS.watch },
        warningColor: { value: SEVERITY_COLORS.warning },
        emergencyColor: { value: SEVERITY_COLORS.emergency },
        texelSize: {
          value: new THREE.Vector2(
            1.0 / GRID_CONFIG.cols,
            1.0 / GRID_CONFIG.rows
          ),
        },
      },
      vertexShader: overlayVertexShader,
      fragmentShader: smoothing ? smoothHeatmapFragmentShader : smoothHeatmapFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });

    materialRef.current = material;
    return material;
  }, [opacity, smoothing]);

  // Create overlay mesh
  useEffect(() => {
    if (meshRef.current) return; // Already created

    // Create sphere geometry slightly larger than globe (1.003 radius if globe is 1.0)
    const geometry = new THREE.SphereGeometry(1.003, 128, 128);
    const mesh = new THREE.Mesh(geometry, shaderMaterial);
    mesh.name = 'heatmapOverlay';

    meshRef.current = mesh;
    scene.add(mesh);

    return () => {
      if (meshRef.current) {
        scene.remove(meshRef.current);
        geometry.dispose();
      }
    };
  }, [scene, shaderMaterial]);

  // Update DataTexture when cell data changes
  useEffect(() => {
    if (!materialRef.current) return;

    // Dispose old texture
    if (textureRef.current) {
      textureRef.current.dispose();
    }

    // Create new DataTexture from cell data
    const texture = createIntensityDataTexture(cellData);
    textureRef.current = texture;

    // Update shader uniform
    materialRef.current.uniforms.intensityMap.value = texture;
    materialRef.current.uniformsNeedUpdate = true;
  }, [cellData]);

  // Update opacity
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.opacity.value = opacity;
      materialRef.current.uniformsNeedUpdate = true;
    }
  }, [opacity]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (textureRef.current) {
        textureRef.current.dispose();
      }
      if (materialRef.current) {
        materialRef.current.dispose();
      }
    };
  }, []);

  return null; // This is a Three.js component, no React DOM elements
};

export default HeatmapOverlay;
