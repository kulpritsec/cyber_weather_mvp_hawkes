import React from 'react';
import { ArcData } from './ArcDetailPanel';
import './ArcATTACKTab.css';

interface ArcATTACKTabProps {
  arc: ArcData;
}

// Cyber Kill Chain phases
const KILL_CHAIN_PHASES = [
  'Reconnaissance',
  'Weaponization',
  'Delivery',
  'Exploitation',
  'Installation',
  'Command & Control',
  'Actions on Objectives',
];

const ArcATTACKTab: React.FC<ArcATTACKTabProps> = ({ arc }) => {
  const { attackMapping, threatGroup, vector } = arc;

  const isPhaseActive = (phase: string): boolean => {
    return attackMapping.killChainPhase.includes(phase);
  };

  const getCurrentPhase = (): string | null => {
    const activePhases = KILL_CHAIN_PHASES.filter(isPhaseActive);
    return activePhases.length > 0 ? activePhases[activePhases.length - 1] : null;
  };

  const currentPhase = getCurrentPhase();

  return (
    <div className="arc-attack-tab">
      {/* MITRE ATT&CK Techniques */}
      <div className="panel-section">
        <div className="panel-section-header">MITRE ATT&CK Techniques</div>
        <div className="attack-techniques-grid">
          {attackMapping.techniques.length > 0 ? (
            attackMapping.techniques.map((tech) => (
              <div key={tech.id} className="attack-technique">
                <div className="tech-header">
                  <div className="tech-id">{tech.id}</div>
                  <div className="tech-tactic" data-tactic={tech.tactic.toLowerCase()}>
                    {tech.tactic}
                  </div>
                </div>
                <div className="tech-name">{tech.name}</div>
                <a
                  href={tech.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tech-link"
                >
                  View Details →
                </a>
              </div>
            ))
          ) : (
            <div className="no-techniques">
              No MITRE ATT&CK techniques mapped for {vector?.toUpperCase() || "UNKNOWN"} vector.
            </div>
          )}
        </div>
      </div>

      {/* Correlated Threat Groups */}
      {threatGroup && (
        <div className="panel-section">
          <div className="panel-section-header">Correlated Threat Groups</div>
          <div className="threat-groups-list">
            <div className="threat-group-card threat-group-primary">
              <div className="group-header">
                <div className="group-name">{threatGroup.name}</div>
                <div className="group-confidence">
                  {Math.round(threatGroup.confidence * 100)}% match
                </div>
              </div>
              <div className="group-details">
                <div className="group-detail-item">
                  <span className="detail-label">Origin:</span>
                  <span className="detail-value">{threatGroup.origin}</span>
                </div>
                {threatGroup.aliases.length > 0 && (
                  <div className="group-detail-item">
                    <span className="detail-label">Also known as:</span>
                    <span className="detail-value">{threatGroup.aliases.join(', ')}</span>
                  </div>
                )}
                <div className="group-detail-item">
                  <span className="detail-label">Known vectors:</span>
                  <span className="detail-value">
                    {threatGroup.knownVectors.map((v) => v?.toUpperCase() || "UNKNOWN").join(', ')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cyber Kill Chain Position */}
      <div className="panel-section">
        <div className="panel-section-header">Cyber Kill Chain Position</div>
        <div className="kill-chain-visualization">
          {KILL_CHAIN_PHASES.map((phase, index) => {
            const active = isPhaseActive(phase);
            const current = phase === currentPhase;

            return (
              <div
                key={phase}
                className={`kill-chain-phase ${active ? 'phase-active' : 'phase-inactive'} ${
                  current ? 'phase-current' : ''
                }`}
              >
                <div className="phase-number">{index + 1}</div>
                <div className="phase-content">
                  <div className="phase-name">{phase}</div>
                  {current && <div className="phase-indicator">← Current Phase</div>}
                </div>
                <div className="phase-status">
                  {active ? '✓' : ' '}
                </div>
              </div>
            );
          })}
        </div>
        <div className="kill-chain-legend">
          <div className="legend-item">
            <div className="legend-box legend-box-active" />
            <span>Completed / Active</span>
          </div>
          <div className="legend-item">
            <div className="legend-box legend-box-current" />
            <span>Current Phase</span>
          </div>
          <div className="legend-item">
            <div className="legend-box legend-box-inactive" />
            <span>Not Yet Reached</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArcATTACKTab;
