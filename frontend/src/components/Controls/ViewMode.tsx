import React from 'react';

export type DisplayMode = 'heatmap' | 'arcs' | 'parameters';

interface ViewModeOption {
  mode: DisplayMode;
  icon: string;
  label: string;
  description: string;
}

interface ViewModeProps {
  currentMode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

const VIEW_MODES: ViewModeOption[] = [
  {
    mode: 'heatmap',
    icon: '🗺️',
    label: 'Heatmap',
    description: 'Intensity overlay on globe',
  },
  {
    mode: 'arcs',
    icon: '⚡',
    label: 'Attack Arcs',
    description: 'Visualize attack trajectories',
  },
  {
    mode: 'parameters',
    icon: '📊',
    label: 'Parameters',
    description: 'Show Hawkes model params',
  },
];

const ViewMode: React.FC<ViewModeProps> = ({ currentMode, onChange }) => {
  return (
    <div className="view-mode">
      <div className="view-mode-header">
        <h3>Display Mode</h3>
      </div>
      <div className="view-mode-buttons">
        {VIEW_MODES.map((option) => {
          const isActive = currentMode === option.mode;
          return (
            <button
              key={option.mode}
              className={`view-mode-button ${isActive ? 'active' : ''}`}
              onClick={() => onChange(option.mode)}
              title={option.description}
            >
              <span className="view-mode-icon">{option.icon}</span>
              <span className="view-mode-label">{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="view-mode-description">
        {VIEW_MODES.find((m) => m.mode === currentMode)?.description}
      </div>
      <style>{`
        .view-mode {
          position: absolute;
          top: 20px;
          right: 20px;
          background: rgba(10, 15, 25, 0.85);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 16px;
          min-width: 180px;
          z-index: 100;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .view-mode-header {
          margin-bottom: 12px;
        }

        .view-mode-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .view-mode-buttons {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .view-mode-button {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #8B92A4;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .view-mode-button:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .view-mode-button.active {
          background: linear-gradient(135deg, #10B981 0%, #059669 100%);
          border-color: #10B981;
          color: #fff;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }

        .view-mode-icon {
          font-size: 18px;
          line-height: 1;
        }

        .view-mode-label {
          flex: 1;
        }

        .view-mode-description {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 11px;
          color: #6B7280;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
};

export default ViewMode;
