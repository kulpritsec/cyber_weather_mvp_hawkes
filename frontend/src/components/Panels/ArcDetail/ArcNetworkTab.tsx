import React from 'react';
import { ArcData } from './ArcDetailPanel';
import './ArcNetworkTab.css';

interface ArcNetworkTabProps {
  arc: ArcData;
}

const ArcNetworkTab: React.FC<ArcNetworkTabProps> = ({ arc }) => {
  const { networkDetails, sourceCell, targetCell } = arc;

  const formatCoordinates = (lat: number, lon: number): string => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
  };

  const getTopPorts = (portDist: Record<number, number>, limit: number = 5) => {
    const entries = Object.entries(portDist).map(([port, count]) => ({
      port: parseInt(port),
      count: count,
    }));
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, limit);
  };

  const totalPackets = Object.values(networkDetails.portDistribution).reduce(
    (sum, count) => sum + count,
    0
  );

  const topPorts = getTopPorts(networkDetails.portDistribution);

  return (
    <div className="arc-network-tab">
      {/* Source Cell Details */}
      <div className="panel-section">
        <div className="panel-section-header">
          Source Cell Details
        </div>
        <div className="network-info-card">
          <div className="network-info-row">
            <span className="info-label">Location:</span>
            <span className="info-value">
              {formatCoordinates(networkDetails.source.lat, networkDetails.source.lon)}
            </span>
          </div>
          <div className="network-info-row">
            <span className="info-label">ASN:</span>
            <span className="info-value info-monospace">{networkDetails.source.asn}</span>
          </div>
          <div className="network-info-row">
            <span className="info-label">Network:</span>
            <span className="info-value info-monospace">{networkDetails.source.network}</span>
          </div>
          <div className="network-info-row">
            <span className="info-label">Country:</span>
            <span className="info-value">{networkDetails.source.country}</span>
          </div>
        </div>
      </div>

      {/* Target Cell Details */}
      <div className="panel-section">
        <div className="panel-section-header">
          Target Cell Details
        </div>
        <div className="network-info-card">
          <div className="network-info-row">
            <span className="info-label">Location:</span>
            <span className="info-value">
              {formatCoordinates(networkDetails.target.lat, networkDetails.target.lon)}
            </span>
          </div>
          <div className="network-info-row">
            <span className="info-label">ASN:</span>
            <span className="info-value info-monospace">{networkDetails.target.asn}</span>
          </div>
          <div className="network-info-row">
            <span className="info-label">Network:</span>
            <span className="info-value info-monospace">{networkDetails.target.network}</span>
          </div>
          <div className="network-info-row">
            <span className="info-label">Country:</span>
            <span className="info-value">{networkDetails.target.country}</span>
          </div>
        </div>
      </div>

      {/* Port Distribution */}
      <div className="panel-section">
        <div className="panel-section-header">
          Port Distribution
        </div>
        <div className="port-distribution-chart">
          {topPorts.map((portInfo) => {
            const percentage = (portInfo.count / totalPackets) * 100;
            return (
              <div key={portInfo.port} className="port-bar-container">
                <div className="port-label">Port {portInfo.port}</div>
                <div className="port-bar-wrapper">
                  <div
                    className="port-bar-fill"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="port-percentage">{percentage.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-Minute Packet Timeline */}
      <div className="panel-section">
        <div className="panel-section-header">
          Per-Minute Packet Timeline (Last 60 Minutes)
        </div>
        <div className="packet-timeline-container">
          <PacketTimelineSVG data={networkDetails.packetTimeline} />
        </div>
      </div>
    </div>
  );
};

// Simple inline SVG sparkline for packet timeline
interface PacketTimelineSVGProps {
  data: { timestamp: number; value: number }[];
}

const PacketTimelineSVG: React.FC<PacketTimelineSVGProps> = ({ data }) => {
  const width = 560;
  const height = 60;
  const padding = 4;

  if (data.length === 0) {
    return (
      <div className="no-timeline-data">
        No packet timeline data available
      </div>
    );
  }

  const xMin = Math.min(...data.map((d) => d.timestamp));
  const xMax = Math.max(...data.map((d) => d.timestamp));
  const yMin = 0;
  const yMax = Math.max(...data.map((d) => d.value), 1);

  const xScale = (x: number) =>
    padding + ((x - xMin) / (xMax - xMin)) * (width - 2 * padding);

  const yScale = (y: number) =>
    height - padding - ((y - yMin) / (yMax - yMin)) * (height - 2 * padding);

  // Create bar chart
  const barWidth = (width - 2 * padding) / data.length;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {data.map((point, i) => {
        const x = xScale(point.timestamp);
        const y = yScale(point.value);
        const barHeight = height - padding - y;

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(barWidth - 1, 1)}
            height={barHeight}
            fill="#60A5FA"
            opacity={0.7}
          />
        );
      })}
      {/* Baseline */}
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1"
      />
    </svg>
  );
};

export default ArcNetworkTab;
