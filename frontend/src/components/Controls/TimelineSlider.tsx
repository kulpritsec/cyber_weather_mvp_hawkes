import React from 'react';

type TimelineMode = 'nowcast' | 'forecast';

interface TimelineOption {
  mode: TimelineMode;
  horizon?: number;
  label: string;
  description: string;
}

interface TimelineSliderProps {
  currentMode: TimelineMode;
  currentHorizon?: number;
  onChange: (mode: TimelineMode, horizon?: number) => void;
}

const TIMELINE_OPTIONS: TimelineOption[] = [
  { mode: 'nowcast', label: 'NOW', description: 'Current threat intensity' },
  { mode: 'forecast', horizon: 6, label: '+6H', description: '6 hour forecast' },
  { mode: 'forecast', horizon: 24, label: '+24H', description: '24 hour forecast' },
  { mode: 'forecast', horizon: 72, label: '+72H', description: '72 hour forecast' },
];

const TimelineSlider: React.FC<TimelineSliderProps> = ({
  currentMode,
  currentHorizon,
  onChange,
}) => {
  const isActive = (option: TimelineOption): boolean => {
    if (option.mode === 'nowcast') {
      return currentMode === 'nowcast';
    }
    return currentMode === 'forecast' && currentHorizon === option.horizon;
  };

  return (
    <div className="timeline-slider">
      <div className="timeline-header">
        <h3>Time Horizon</h3>
      </div>
      <div className="timeline-track">
        {TIMELINE_OPTIONS.map((option, index) => {
          const active = isActive(option);
          return (
            <div
              key={`${option.mode}-${option.horizon || 0}`}
              className="timeline-option-wrapper"
            >
              <button
                className={`timeline-option ${active ? 'active' : ''}`}
                onClick={() => onChange(option.mode, option.horizon)}
                title={option.description}
              >
                <span className="timeline-label">{option.label}</span>
              </button>
              {index < TIMELINE_OPTIONS.length - 1 && (
                <div className={`timeline-connector ${active ? 'active' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="timeline-description">
        {TIMELINE_OPTIONS.find(isActive)?.description || 'Current view'}
      </div>
      <style>{`
        .timeline-slider {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(10, 15, 25, 0.85);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 16px 20px;
          z-index: 100;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          min-width: 400px;
        }

        .timeline-header {
          text-align: center;
          margin-bottom: 12px;
        }

        .timeline-header h3 {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          color: #8B92A4;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .timeline-track {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .timeline-option-wrapper {
          display: flex;
          align-items: center;
          flex: 1;
        }

        .timeline-option {
          flex: 1;
          padding: 12px 20px;
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #8B92A4;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
          white-space: nowrap;
        }

        .timeline-option:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .timeline-option.active {
          background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
          border-color: #6366F1;
          color: #fff;
          box-shadow: 0 4px 16px rgba(79, 70, 229, 0.4);
        }

        .timeline-label {
          display: block;
          text-align: center;
        }

        .timeline-connector {
          width: 20px;
          height: 2px;
          background: rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }

        .timeline-connector.active {
          background: linear-gradient(90deg, #6366F1 0%, rgba(99, 102, 241, 0.3) 100%);
        }

        .timeline-description {
          text-align: center;
          font-size: 11px;
          color: #6B7280;
          font-style: italic;
        }
      `}</style>
    </div>
  );
};

export default TimelineSlider;
