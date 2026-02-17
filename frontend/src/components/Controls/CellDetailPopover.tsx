import React from 'react';

interface HawkesParams {
  mu: number;
  beta: number;
  n_br: number;
  mu_std?: number;
  beta_std?: number;
  n_br_std?: number;
  stability: 'stable' | 'unstable';
}

interface CellInfo {
  gridId: number;
  vector: string;
  lat: number;
  lon: number;
  intensity: number;
  confidence: number;
  params?: HawkesParams;
  advisories?: string[];
}

interface CellDetailPopoverProps {
  cellInfo: CellInfo | null;
  position: { x: number; y: number };
  onClose: () => void;
}

const CellDetailPopover: React.FC<CellDetailPopoverProps> = ({
  cellInfo,
  position,
  onClose,
}) => {
  if (!cellInfo) return null;

  const getSeverityColor = (nbr: number): string => {
    if (nbr >= 0.9) return '#EF4444'; // Emergency - Red
    if (nbr >= 0.7) return '#F59E0B'; // Warning - Orange
    if (nbr >= 0.5) return '#EAB308'; // Watch - Yellow
    if (nbr >= 0.3) return '#3B82F6'; // Advisory - Blue
    return '#10B981'; // Clear - Green
  };

  const getSeverityLabel = (nbr: number): string => {
    if (nbr >= 0.9) return 'EMERGENCY';
    if (nbr >= 0.7) return 'WARNING';
    if (nbr >= 0.5) return 'WATCH';
    if (nbr >= 0.3) return 'ADVISORY';
    return 'CLEAR';
  };

  const { params } = cellInfo;

  return (
    <>
      <div
        className="cell-detail-popover"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
      >
        <div className="popover-header">
          <div className="popover-title">
            <span className="vector-badge" style={{
              backgroundColor: getSeverityColor(params?.n_br || 0)
            }}>
              {cellInfo.vector.toUpperCase()}
            </span>
            <span className="grid-id">Cell #{cellInfo.gridId}</span>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="popover-body">
          {/* Location Info */}
          <div className="info-section">
            <div className="info-label">Location</div>
            <div className="info-value">
              {cellInfo.lat.toFixed(2)}°, {cellInfo.lon.toFixed(2)}°
            </div>
          </div>

          {/* Current Intensity */}
          <div className="info-section">
            <div className="info-label">Current Intensity</div>
            <div className="info-value">
              <span className="intensity-value">{cellInfo.intensity.toFixed(2)}</span>
              <span className="confidence-badge">
                {(cellInfo.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
          </div>

          {/* Hawkes Parameters */}
          {params && (
            <>
              <div className="divider" />
              <div className="hawkes-section">
                <div className="section-title">Hawkes Process Parameters</div>

                <div className="param-grid">
                  <div className="param-item">
                    <div className="param-label">μ (Base Rate)</div>
                    <div className="param-value">
                      {params.mu.toFixed(3)}
                      {params.mu_std && (
                        <span className="param-std">±{params.mu_std.toFixed(3)}</span>
                      )}
                    </div>
                  </div>

                  <div className="param-item">
                    <div className="param-label">β (Decay)</div>
                    <div className="param-value">
                      {params.beta.toFixed(3)}
                      {params.beta_std && (
                        <span className="param-std">±{params.beta_std.toFixed(3)}</span>
                      )}
                    </div>
                  </div>

                  <div className="param-item highlight">
                    <div className="param-label">n̂ (Branching)</div>
                    <div className="param-value" style={{
                      color: getSeverityColor(params.n_br)
                    }}>
                      {params.n_br.toFixed(3)}
                      {params.n_br_std && (
                        <span className="param-std">±{params.n_br_std.toFixed(3)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="severity-badge" style={{
                  backgroundColor: `${getSeverityColor(params.n_br)}22`,
                  borderColor: getSeverityColor(params.n_br)
                }}>
                  <span style={{ color: getSeverityColor(params.n_br) }}>
                    {getSeverityLabel(params.n_br)}
                  </span>
                  <span className="severity-status">
                    {params.stability === 'stable' ? '✓ Stable' : '⚠ Unstable'}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Advisories */}
          {cellInfo.advisories && cellInfo.advisories.length > 0 && (
            <>
              <div className="divider" />
              <div className="advisories-section">
                <div className="section-title">Active Advisories</div>
                <ul className="advisory-list">
                  {cellInfo.advisories.map((advisory, idx) => (
                    <li key={idx} className="advisory-item">{advisory}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .cell-detail-popover {
          position: fixed;
          background: rgba(10, 15, 25, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 0;
          min-width: 320px;
          max-width: 400px;
          z-index: 1000;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          animation: popover-slide-in 0.2s ease-out;
        }

        @keyframes popover-slide-in {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .popover-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .popover-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .vector-badge {
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 0.5px;
        }

        .grid-id {
          font-size: 13px;
          color: #8B92A4;
          font-weight: 500;
        }

        .close-button {
          background: none;
          border: none;
          color: #8B92A4;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .close-button:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .popover-body {
          padding: 16px;
        }

        .info-section {
          margin-bottom: 14px;
        }

        .info-label {
          font-size: 11px;
          color: #6B7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .info-value {
          font-size: 14px;
          color: #fff;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .intensity-value {
          font-size: 18px;
          font-weight: 600;
          color: #4F46E5;
        }

        .confidence-badge {
          font-size: 11px;
          color: #8B92A4;
          padding: 3px 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }

        .divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 16px 0;
        }

        .hawkes-section, .advisories-section {
          margin-top: 16px;
        }

        .section-title {
          font-size: 12px;
          color: #fff;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
        }

        .param-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 12px;
        }

        .param-item {
          background: rgba(255, 255, 255, 0.03);
          padding: 10px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .param-item.highlight {
          background: rgba(79, 70, 229, 0.1);
          border-color: rgba(79, 70, 229, 0.3);
        }

        .param-label {
          font-size: 10px;
          color: #8B92A4;
          margin-bottom: 4px;
          font-weight: 500;
        }

        .param-value {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
        }

        .param-std {
          font-size: 10px;
          color: #6B7280;
          margin-left: 4px;
        }

        .severity-badge {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 12px;
          border-radius: 6px;
          border: 2px solid;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .severity-status {
          font-size: 11px;
          font-weight: 500;
          color: #8B92A4;
        }

        .advisory-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .advisory-item {
          padding: 10px 12px;
          background: rgba(245, 158, 11, 0.1);
          border-left: 3px solid #F59E0B;
          border-radius: 4px;
          font-size: 12px;
          color: #FCD34D;
          margin-bottom: 8px;
          line-height: 1.4;
        }

        .advisory-item:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </>
  );
};

export default CellDetailPopover;
