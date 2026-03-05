import React from 'react';
import { IntensitySparkline, BranchingRatioSparkline } from './Sparklines';
import './HotspotCellPanel.css';

export interface DataPoint {
  timestamp: number;
  value: number;
}

export interface HawkesParams {
  mu: number;
  beta: number;
  nBr: number;
}

export interface HotspotCellData {
  cellId: number;
  lat: number;
  lon: number;
  vector: string;
  hawkesParams: HawkesParams;
  eventCount24h: number;
  severity: 'clear' | 'advisory' | 'watch' | 'warning' | 'emergency';
  intensityHistory: DataPoint[];
  branchingHistory: DataPoint[];
  location?: string;
}

interface HotspotCellPanelProps {
  cell: HotspotCellData;
  position: { x: number; y: number };
  onClose: () => void;
}

const HotspotCellPanel: React.FC<HotspotCellPanelProps> = ({ cell, position, onClose }) => {
  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'emergency':
        return '#EF4444';
      case 'warning':
        return '#F59E0B';
      case 'watch':
        return '#EAB308';
      case 'advisory':
        return '#3B82F6';
      case 'clear':
      default:
        return '#10B981';
    }
  };

  const getSeverityLabel = (severity: string): string => {
    return severity?.toUpperCase() || "UNKNOWN";
  };

  const getStabilityStatus = (nBr: number): { label: string; trend: string; trendIcon: string } => {
    let label = 'Stable';
    let trend = 'Stable';
    let trendIcon = '→';

    if (nBr >= 0.9) {
      label = 'Critical (n̂ ≥ 0.9)';
      trend = 'Escalating rapidly';
      trendIcon = '↑↑';
    } else if (nBr >= 0.7) {
      label = 'Unstable (approaching critical)';
      trend = 'Increasing';
      trendIcon = '↑';
    } else if (nBr >= 0.5) {
      label = 'Elevated (watch threshold)';
      trend = 'Moderately increasing';
      trendIcon = '↗';
    } else {
      label = 'Stable';
      trend = 'Controlled';
      trendIcon = '→';
    }

    return { label, trend, trendIcon };
  };

  const formatCoordinates = (lat: number, lon: number): string => {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
  };

  const stabilityStatus = getStabilityStatus(cell.hawkesParams.nBr);
  const severityColor = getSeverityColor(cell.severity);

  return (
    <div
      className="hotspot-cell-panel"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* Header */}
      <div className="cell-panel-header">
        <div className="cell-panel-title">
          <span className="cell-icon">🔥</span>
          <span className="cell-id">Grid Cell #{cell.cellId}</span>
          <span className="cell-vector-badge" data-vector={cell.vector}>
            {cell.vector?.toUpperCase() || "UNKNOWN"}
          </span>
        </div>
        <button className="cell-panel-close-button" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      {/* Cell Location */}
      <div className="cell-section">
        <div className="cell-section-header">Location</div>
        <div className="cell-location-info">
          <div className="location-row">
            <span className="location-label">Coordinates:</span>
            <span className="location-value">{formatCoordinates(cell.lat, cell.lon)}</span>
          </div>
          {cell.location && (
            <div className="location-row">
              <span className="location-label">Region:</span>
              <span className="location-value">{cell.location}</span>
            </div>
          )}
        </div>
      </div>

      {/* Current Metrics */}
      <div className="cell-section">
        <div className="cell-section-header">Current Metrics</div>
        <div className="cell-metrics-grid">
          <div className="cell-metric-item">
            <div className="cell-metric-label">μ (Base Rate)</div>
            <div className="cell-metric-value">{(cell.hawkesParams?.mu ?? 0).toFixed(3)}</div>
          </div>
          <div className="cell-metric-item">
            <div className="cell-metric-label">β (Decay)</div>
            <div className="cell-metric-value">{(cell.hawkesParams?.beta ?? 0).toFixed(3)}</div>
          </div>
          <div className="cell-metric-item cell-metric-highlight">
            <div className="cell-metric-label">n̂ (Branching)</div>
            <div className="cell-metric-value">{(cell.hawkesParams?.nBr ?? 0).toFixed(3)}</div>
          </div>
          <div className="cell-metric-item">
            <div className="cell-metric-label">24h Events</div>
            <div className="cell-metric-value">{(cell.eventCount24h ?? 0).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Severity Classification */}
      <div className="cell-section">
        <div className="cell-section-header">Severity Classification</div>
        <div className="cell-severity-box">
          <div className="severity-row">
            <span className="severity-row-label">Current:</span>
            <span
              className="severity-badge"
              style={{
                backgroundColor: `${severityColor}22`,
                color: severityColor,
                borderColor: `${severityColor}66`,
              }}
            >
              {getSeverityLabel(cell.severity || "clear")} (n̂ = {(cell.hawkesParams?.nBr ?? 0).toFixed(3)})
            </span>
          </div>
          <div className="severity-row">
            <span className="severity-row-label">Status:</span>
            <span className="severity-value">{stabilityStatus.label}</span>
          </div>
          <div className="severity-row">
            <span className="severity-row-label">Trend:</span>
            <span className="severity-value">
              {stabilityStatus.trendIcon} {stabilityStatus.trend}
            </span>
          </div>
        </div>
      </div>

      {/* 48h Intensity Sparkline */}
      <div className="cell-section">
        <div className="cell-section-header">48h Intensity</div>
        <div className="cell-sparkline-container">
          <IntensitySparkline
            data={cell.intensityHistory}
            width={280}
            height={40}
            color="#4F46E5"
            fillColor="rgba(79, 70, 229, 0.15)"
          />
        </div>
      </div>

      {/* 48h Branching Ratio Sparkline */}
      <div className="cell-section">
        <div className="cell-section-header">48h Branching Ratio (n̂)</div>
        <div className="cell-sparkline-container">
          <BranchingRatioSparkline
            data={cell.branchingHistory}
            width={280}
            height={50}
            strokeWidth={1.5}
            showThresholds={true}
          />
        </div>
      </div>
    </div>
  );
};

export default HotspotCellPanel;
