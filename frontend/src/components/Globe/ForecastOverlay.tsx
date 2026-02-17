import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  createIntensityDataTexture,
  GridCellData,
  SEVERITY_COLORS,
} from './shaderUtils';
import { overlayVertexShader, forecastFragmentShader } from './shaders';

interface ForecastOverlayProps {
  scene: THREE.Scene;
  cellData: GridCellData[];
  horizon: number; // Forecast horizon in hours (6, 24, or 72)
  opacity?: number;
}

/**
 * ForecastOverlay Component
 *
 * Renders a shader-based forecast overlay with pulsing/dashed effects
 * - Uses DataTexture for forecast intensity values
 * - Animated pulsing opacity to distinguish from nowcast
 * - Dashed pattern effect
 * - Time-based animations
 */
const ForecastOverlay: React.FC<ForecastOverlayProps> = ({
  scene,
  cellData,
  horizon,
  opacity = 0.6,
}) => {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());

  // Create shader material
  const shaderMaterial = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        intensityMap: { value: null },
        opacity: { value: opacity },
        time: { value: 0.0 },
        clearColor: { value: SEVERITY_COLORS.clear },
        advisoryColor: { value: SEVERITY_COLORS.advisory },
        watchColor: { value: SEVERITY_COLORS.watch },
        warningColor: { value: SEVERITY_COLORS.warning },
        emergencyColor: { value: SEVERITY_COLORS.emergency },
      },
      vertexShader: overlayVertexShader,
      fragmentShader: forecastFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });

    materialRef.current = material;
    return material;
  }, [opacity]);

  // Create overlay mesh
  useEffect(() => {
    if (meshRef.current) return; // Already created

    // Create sphere geometry slightly larger than globe and heatmap
    // Offset based on horizon for visual depth
    const radiusOffset = 1.003 + (horizon / 72) * 0.01; // 1.003 to 1.013
    const geometry = new THREE.SphereGeometry(radiusOffset, 128, 128);
    const mesh = new THREE.Mesh(geometry, shaderMaterial);
    mesh.name = `forecastOverlay_${horizon}h`;

    meshRef.current = mesh;
    scene.add(mesh);

    return () => {
      if (meshRef.current) {
        scene.remove(meshRef.current);
        geometry.dispose();
      }
    };
  }, [scene, shaderMaterial, horizon]);

  // Update DataTexture when cell data changes
  useEffect(() => {
    if (!materialRef.current) return;

    // Dispose old texture
    if (textureRef.current) {
      textureRef.current.dispose();
    }

    // Create new DataTexture from forecast cell data
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

  // Animation loop for pulsing effect
  useEffect(() => {
    let animationFrameId: number;

    const animate = () => {
      if (materialRef.current) {
        const elapsed = clockRef.current.getElapsedTime();
        materialRef.current.uniforms.time.value = elapsed;
        materialRef.current.uniformsNeedUpdate = true;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

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

export default ForecastOverlay;
