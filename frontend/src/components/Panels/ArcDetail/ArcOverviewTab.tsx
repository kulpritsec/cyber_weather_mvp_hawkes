import React from 'react';
import { ArcData } from './ArcDetailPanel';
import { IntensitySparkline } from '../Sparklines';
import './ArcOverviewTab.css';

interface ArcOverviewTabProps {
  arc: ArcData;
}

const ArcOverviewTab: React.FC<ArcOverviewTabProps> = ({ arc }) => {
  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-US');
  };

  const formatBandwidth = (bytes: number): string => {
    if (bytes >= 1_000_000_000) {
      return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
    } else if (bytes >= 1_000_000) {
      return `${(bytes / 1_000_000).toFixed(2)} MB`;
    } else if (bytes >= 1_000) {
      return `${(bytes / 1_000).toFixed(2)} KB`;
    }
    return `${bytes} B`;
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(date);
  };

  return (
    <div className="arc-overview-tab">
      {/* Metrics Section */}
      <div className="panel-section">
        <div className="panel-section-header">Traffic Metrics</div>
        <div className="metrics-grid">
          <div className="metric-item">
            <div className="metric-label">Packets</div>
            <div className="metric-value">{formatNumber(arc.packets)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Bandwidth</div>
            <div className="metric-value">{formatBandwidth(arc.bandwidth)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Confidence</div>
            <div className="metric-value">
              {Math.round(arc.confidence * 100)}%
              <div className="confidence-bar">
                <div
                  className="confidence-fill"
                  style={{ width: `${arc.confidence * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">First Seen</div>
            <div className="metric-value metric-timestamp">{formatDate(arc.firstSeen)}</div>
          </div>
        </div>
      </div>

      {/* 48-Hour Intensity Sparkline */}
      <div className="panel-section">
        <div className="panel-section-header">48-Hour Intensity</div>
        <div className="sparkline-container">
          <IntensitySparkline
            data={arc.intensityHistory}
            width={560}
            height={60}
            color="#4F46E5"
            fillColor="rgba(79, 70, 229, 0.15)"
          />
        </div>
      </div>

      {/* Threat Group Correlation */}
      {arc.threatGroup && (
        <div className="panel-section">
          <div className="panel-section-header">Threat Correlation</div>
          <div className="threat-correlation-box">
            <div className="threat-icon">⚠️</div>
            <div className="threat-info">
              <div className="threat-name">
                {arc.threatGroup.name}
                {arc.threatGroup.aliases.length > 0 && (
                  <span className="threat-aliases">
                    {' '}
                    / {arc.threatGroup.aliases.join(', ')}
                  </span>
                )}
              </div>
              <div className="threat-origin">
                <span className="threat-origin-label">Origin:</span> {arc.threatGroup.origin}
              </div>
              <div className="threat-confidence-match">
                <span className="confidence-badge" data-confidence={arc.threatGroup.confidence >= 0.8 ? 'high' : 'medium'}>
                  {Math.round(arc.threatGroup.confidence * 100)}% match confidence
                </span>
              </div>
            </div>
          </div>

          {/* Infrastructure Match */}
          {arc.threatGroup.relatedCampaigns > 0 && (
            <div className="infrastructure-match">
              <div className="infrastructure-item">
                <span className="infra-label">Known campaign infrastructure:</span>
                <span className="infra-value infra-yes">YES</span>
              </div>
              <div className="infrastructure-item">
                <span className="infra-label">Related campaigns:</span>
                <span className="infra-value">{arc.threatGroup.relatedCampaigns} active</span>
              </div>
              <div className="infrastructure-item">
                <span className="infra-label">Last observed:</span>
                <span className="infra-value">
                  {Math.round(
                    (Date.now() - arc.threatGroup.lastObserved.getTime()) / (1000 * 60 * 60)
                  )}{' '}
                  hours ago
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No Threat Correlation */}
      {!arc.threatGroup && (
        <div className="panel-section">
          <div className="panel-section-header">Threat Correlation</div>
          <div className="no-correlation">
            <div className="no-correlation-icon">ℹ️</div>
            <div className="no-correlation-text">
              No known threat group matched to this attack pattern.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArcOverviewTab;
