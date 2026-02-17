import React from 'react';

interface VectorConfig {
  name: string;
  label: string;
  color: string;
  enabled: boolean;
}

interface VectorFilterProps {
  vectors: VectorConfig[];
  onToggle: (vectorName: string) => void;
}

const VectorFilter: React.FC<VectorFilterProps> = ({ vectors, onToggle }) => {
  return (
    <div className="vector-filter">
      <div className="vector-filter-header">
        <h3>Attack Vectors</h3>
        <span className="vector-count">{vectors.filter(v => v.enabled).length}/{vectors.length} active</span>
      </div>
      <div className="vector-buttons">
        {vectors.map((vector) => (
          <button
            key={vector.name}
            className={`vector-button ${vector.enabled ? 'active' : 'inactive'}`}
            onClick={() => onToggle(vector.name)}
            style={{
              borderColor: vector.enabled ? vector.color : '#444',
              backgroundColor: vector.enabled ? `${vector.color}22` : 'transparent',
            }}
          >
            <span
              className="vector-indicator"
              style={{ backgroundColor: vector.enabled ? vector.color : '#666' }}
            />
            <span className="vector-label">{vector.label}</span>
          </button>
        ))}
      </div>
      <style>{`
        .vector-filter {
          position: absolute;
          top: 20px;
          left: 20px;
          background: rgba(10, 15, 25, 0.85);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 16px;
          min-width: 200px;
          z-index: 100;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .vector-filter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .vector-filter-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .vector-count {
          font-size: 11px;
          color: #8B92A4;
          font-weight: 500;
        }

        .vector-buttons {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .vector-button {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid;
          border-radius: 6px;
          background: transparent;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 13px;
          font-weight: 500;
          color: #fff;
          text-align: left;
        }

        .vector-button:hover {
          transform: translateX(2px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .vector-button.active {
          border-width: 2px;
        }

        .vector-button.inactive {
          opacity: 0.5;
          color: #8B92A4;
        }

        .vector-button.inactive:hover {
          opacity: 0.7;
        }

        .vector-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .vector-label {
          flex: 1;
          text-transform: capitalize;
        }
      `}</style>
    </div>
  );
};

export default VectorFilter;
