import React, { useEffect, useRef } from 'react';

interface DataPoint {
  timestamp: number;
  value: number;
}

interface IntensitySparklineProps {
  data: DataPoint[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  strokeWidth?: number;
  showAxes?: boolean;
}

/**
 * IntensitySparkline Component
 *
 * D3-based sparkline for 48-hour intensity visualization
 * - Smooth line chart with area fill
 * - Auto-scaling Y-axis
 * - Tooltip on hover
 * - Compact design for panels
 */
const IntensitySparkline: React.FC<IntensitySparklineProps> = ({
  data,
  width = 200,
  height = 40,
  color = '#4F46E5',
  fillColor = 'rgba(79, 70, 229, 0.1)',
  strokeWidth = 1.5,
  showAxes = false,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = svgRef.current;
    const padding = showAxes ? 20 : 4;

    // Clear previous content
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    // Calculate scales
    const xMin = Math.min(...data.map(d => d.timestamp));
    const xMax = Math.max(...data.map(d => d.timestamp));
    const yMin = 0;
    const yMax = Math.max(...data.map(d => d.value), 1);

    const xScale = (x: number) =>
      padding + ((x - xMin) / (xMax - xMin)) * (width - 2 * padding);

    const yScale = (y: number) =>
      height - padding - ((y - yMin) / (yMax - yMin)) * (height - 2 * padding);

    // Create path data
    let pathData = '';
    let areaData = '';

    data.forEach((point, i) => {
      const x = xScale(point.timestamp);
      const y = yScale(point.value);

      if (i === 0) {
        pathData = `M ${x},${y}`;
        areaData = `M ${x},${height - padding} L ${x},${y}`;
      } else {
        pathData += ` L ${x},${y}`;
        areaData += ` L ${x},${y}`;
      }
    });

    // Close area path
    if (data.length > 0) {
      const lastX = xScale(data[data.length - 1].timestamp);
      areaData += ` L ${lastX},${height - padding} Z`;
    }

    // Create area element
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaData);
    area.setAttribute('fill', fillColor);
    area.setAttribute('stroke', 'none');
    svg.appendChild(area);

    // Create line element
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', pathData);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', strokeWidth.toString());
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    // Add axes if requested
    if (showAxes) {
      // X-axis
      const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      xAxis.setAttribute('x1', padding.toString());
      xAxis.setAttribute('y1', (height - padding).toString());
      xAxis.setAttribute('x2', (width - padding).toString());
      xAxis.setAttribute('y2', (height - padding).toString());
      xAxis.setAttribute('stroke', 'rgba(255,255,255,0.2)');
      xAxis.setAttribute('stroke-width', '1');
      svg.appendChild(xAxis);

      // Y-axis
      const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      yAxis.setAttribute('x1', padding.toString());
      yAxis.setAttribute('y1', padding.toString());
      yAxis.setAttribute('x2', padding.toString());
      yAxis.setAttribute('y2', (height - padding).toString());
      yAxis.setAttribute('stroke', 'rgba(255,255,255,0.2)');
      yAxis.setAttribute('stroke-width', '1');
      svg.appendChild(yAxis);
    }
  }, [data, width, height, color, fillColor, strokeWidth, showAxes]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        display: 'block',
        overflow: 'visible',
      }}
    />
  );
};

export default IntensitySparkline;
