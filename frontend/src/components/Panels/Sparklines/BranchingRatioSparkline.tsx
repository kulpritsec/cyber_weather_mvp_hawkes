import React, { useEffect, useRef } from 'react';

interface DataPoint {
  timestamp: number;
  value: number;
}

interface BranchingRatioSparklineProps {
  data: DataPoint[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  showThresholds?: boolean;
}

/**
 * BranchingRatioSparkline Component
 *
 * Specialized sparkline for branching ratio (n̂) visualization
 * - Threshold lines at 0.5, 0.7, 0.9
 * - Color-coded by current severity
 * - Gradient fill based on value
 * - Critical threshold highlighting
 */
const BranchingRatioSparkline: React.FC<BranchingRatioSparklineProps> = ({
  data,
  width = 200,
  height = 50,
  strokeWidth = 2,
  showThresholds = true,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const getColor = (value: number): string => {
    if (value >= 0.9) return '#EF4444'; // Emergency - Red
    if (value >= 0.7) return '#F59E0B'; // Warning - Orange
    if (value >= 0.5) return '#EAB308'; // Watch - Yellow
    if (value >= 0.3) return '#3B82F6'; // Advisory - Blue
    return '#10B981'; // Clear - Green
  };

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = svgRef.current;
    const padding = { top: 8, right: 4, bottom: 8, left: 4 };

    // Clear previous content
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    // Calculate scales (branching ratio is always 0-1)
    const xMin = Math.min(...data.map(d => d.timestamp));
    const xMax = Math.max(...data.map(d => d.timestamp));
    const yMin = 0;
    const yMax = 1.0;

    const xScale = (x: number) =>
      padding.left + ((x - xMin) / (xMax - xMin)) * (width - padding.left - padding.right);

    const yScale = (y: number) =>
      height - padding.bottom - ((y - yMin) / (yMax - yMin)) * (height - padding.top - padding.bottom);

    // Draw threshold lines
    if (showThresholds) {
      const thresholds = [
        { value: 0.5, label: 'Watch', color: '#EAB308', dash: '2,2' },
        { value: 0.7, label: 'Warning', color: '#F59E0B', dash: '4,2' },
        { value: 0.9, label: 'Emergency', color: '#EF4444', dash: '4,2' },
      ];

      thresholds.forEach(({ value, color, dash }) => {
        const y = yScale(value);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padding.left.toString());
        line.setAttribute('y1', y.toString());
        line.setAttribute('x2', (width - padding.right).toString());
        line.setAttribute('y2', y.toString());
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', dash);
        line.setAttribute('opacity', '0.4');
        svg.appendChild(line);
      });
    }

    // Create path data
    let pathData = '';
    let areaData = '';

    data.forEach((point, i) => {
      const x = xScale(point.timestamp);
      const y = yScale(point.value);

      if (i === 0) {
        pathData = `M ${x},${y}`;
        areaData = `M ${x},${height - padding.bottom} L ${x},${y}`;
      } else {
        pathData += ` L ${x},${y}`;
        areaData += ` L ${x},${y}`;
      }
    });

    // Close area path
    if (data.length > 0) {
      const lastX = xScale(data[data.length - 1].timestamp);
      areaData += ` L ${lastX},${height - padding.bottom} Z`;
    }

    // Get current value for color
    const currentValue = data[data.length - 1]?.value || 0;
    const lineColor = getColor(currentValue);
    const fillColor = `${lineColor}22`; // 22 = 13% opacity in hex

    // Create gradient definition
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'branchingGradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '0%');
    gradient.setAttribute('y2', '100%');

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', lineColor);
    stop1.setAttribute('stop-opacity', '0.3');

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', lineColor);
    stop2.setAttribute('stop-opacity', '0.05');

    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    defs.appendChild(gradient);
    svg.appendChild(defs);

    // Create area element with gradient
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaData);
    area.setAttribute('fill', 'url(#branchingGradient)');
    area.setAttribute('stroke', 'none');
    svg.appendChild(area);

    // Create line element
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', pathData);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', lineColor);
    line.setAttribute('stroke-width', strokeWidth.toString());
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    // Add current value indicator dot
    if (data.length > 0) {
      const lastPoint = data[data.length - 1];
      const x = xScale(lastPoint.timestamp);
      const y = yScale(lastPoint.value);

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', x.toString());
      dot.setAttribute('cy', y.toString());
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', lineColor);
      dot.setAttribute('stroke', '#fff');
      dot.setAttribute('stroke-width', '1.5');
      svg.appendChild(dot);
    }
  }, [data, width, height, strokeWidth, showThresholds]);

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

export default BranchingRatioSparkline;
