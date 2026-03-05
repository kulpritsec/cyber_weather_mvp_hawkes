/**
 * Custom GLSL shaders for heatmap and forecast overlays
 */

/**
 * Vertex shader for sphere overlay
 * Passes UV coordinates and calculates position
 */
export const overlayVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Fragment shader for heatmap overlay
 * Samples intensity from DataTexture and maps to color gradient
 */
export const heatmapFragmentShader = `
  uniform sampler2D intensityMap;
  uniform float opacity;
  uniform vec3 clearColor;
  uniform vec3 advisoryColor;
  uniform vec3 watchColor;
  uniform vec3 warningColor;
  uniform vec3 emergencyColor;

  varying vec2 vUv;
  varying vec3 vNormal;

  // Smooth color interpolation
  vec3 getColorForIntensity(float intensity) {
    if (intensity < 0.01) {
      return vec3(0.0); // Transparent for zero intensity
    }

    if (intensity < 0.2) {
      return mix(clearColor, advisoryColor, intensity / 0.2);
    } else if (intensity < 0.4) {
      return mix(advisoryColor, watchColor, (intensity - 0.2) / 0.2);
    } else if (intensity < 0.6) {
      return mix(watchColor, warningColor, (intensity - 0.4) / 0.2);
    } else if (intensity < 0.8) {
      return mix(warningColor, emergencyColor, (intensity - 0.6) / 0.2);
    } else {
      return emergencyColor;
    }
  }

  void main() {
    // Sample intensity from texture
    vec4 texel = texture2D(intensityMap, vUv);
    float intensity = texel.r;

    // Get color based on intensity
    vec3 color = getColorForIntensity(intensity);

    // Edge fade based on view angle (fresnel-like effect)
    float edgeFade = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    float alpha = intensity > 0.01 ? intensity * opacity * (1.0 - edgeFade * 0.3) : 0.0;

    // Output with transparency
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Fragment shader for forecast overlay with pulsing effect
 */
export const forecastFragmentShader = `
  uniform sampler2D intensityMap;
  uniform float opacity;
  uniform float time;
  uniform vec3 clearColor;
  uniform vec3 advisoryColor;
  uniform vec3 watchColor;
  uniform vec3 warningColor;
  uniform vec3 emergencyColor;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  // Smooth color interpolation
  vec3 getColorForIntensity(float intensity) {
    if (intensity < 0.01) {
      return vec3(0.0);
    }

    if (intensity < 0.2) {
      return mix(clearColor, advisoryColor, intensity / 0.2);
    } else if (intensity < 0.4) {
      return mix(advisoryColor, watchColor, (intensity - 0.2) / 0.2);
    } else if (intensity < 0.6) {
      return mix(watchColor, warningColor, (intensity - 0.4) / 0.2);
    } else if (intensity < 0.8) {
      return mix(warningColor, emergencyColor, (intensity - 0.6) / 0.2);
    } else {
      return emergencyColor;
    }
  }

  // Dashed pattern function
  float getDashPattern(vec2 uv, float time) {
    float angle = atan(uv.y - 0.5, uv.x - 0.5);
    float radius = length(vPosition);

    // Create animated dashed lines
    float pattern = sin((angle + time * 0.5) * 20.0) * 0.5 + 0.5;
    float pulse = sin(time * 2.0) * 0.3 + 0.7;

    return pattern * pulse;
  }

  void main() {
    // Sample intensity from texture
    vec4 texel = texture2D(intensityMap, vUv);
    float intensity = texel.r;

    // Get color based on intensity
    vec3 color = getColorForIntensity(intensity);

    // Apply dashed pattern for forecast differentiation
    float dash = getDashPattern(vUv, time);

    // Pulsing opacity
    float pulse = sin(time * 1.5) * 0.2 + 0.8;

    // Edge fade
    float edgeFade = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    float alpha = intensity > 0.01 ? intensity * opacity * dash * pulse * (1.0 - edgeFade * 0.3) : 0.0;

    // Output with transparency and dashed effect
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Fragment shader with gaussian blur sampling for smoother heatmap
 */
export const smoothHeatmapFragmentShader = `
  uniform sampler2D intensityMap;
  uniform float opacity;
  uniform vec3 clearColor;
  uniform vec3 advisoryColor;
  uniform vec3 watchColor;
  uniform vec3 warningColor;
  uniform vec3 emergencyColor;
  uniform vec2 texelSize; // 1.0 / texture dimensions

  varying vec2 vUv;
  varying vec3 vNormal;

  // 3x3 Gaussian kernel
  const float kernel[9] = float[](
    0.0625, 0.125, 0.0625,
    0.125,  0.25,  0.125,
    0.0625, 0.125, 0.0625
  );

  vec3 getColorForIntensity(float intensity) {
    if (intensity < 0.01) {
      return vec3(0.0);
    }

    if (intensity < 0.2) {
      return mix(clearColor, advisoryColor, intensity / 0.2);
    } else if (intensity < 0.4) {
      return mix(advisoryColor, watchColor, (intensity - 0.2) / 0.2);
    } else if (intensity < 0.6) {
      return mix(watchColor, warningColor, (intensity - 0.4) / 0.2);
    } else if (intensity < 0.8) {
      return mix(warningColor, emergencyColor, (intensity - 0.6) / 0.2);
    } else {
      return emergencyColor;
    }
  }

  float sampleIntensitySmooth(vec2 uv) {
    float intensity = 0.0;
    int idx = 0;

    // 3x3 sampling with gaussian weights
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y)) * texelSize;
        vec4 sample = texture2D(intensityMap, uv + offset);
        intensity += sample.r * kernel[idx];
        idx++;
      }
    }

    return intensity;
  }

  void main() {
    // Sample intensity with gaussian blur
    float intensity = sampleIntensitySmooth(vUv);

    // Get color based on intensity
    vec3 color = getColorForIntensity(intensity);

    // Edge fade
    float edgeFade = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    float alpha = intensity > 0.01 ? intensity * opacity * (1.0 - edgeFade * 0.3) : 0.0;

    // Output
    gl_FragColor = vec4(color, alpha);
  }
`;
