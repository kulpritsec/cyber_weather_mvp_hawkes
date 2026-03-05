import React from 'react';
import { ArcData } from './ArcDetailPanel';
import { BranchingRatioSparkline } from '../Sparklines';
import './ArcHawkesTab.css';

interface ArcHawkesTabProps {
  arc: ArcData;
}

const ArcHawkesTab: React.FC<ArcHawkesTabProps> = ({ arc }) => {
  const { hawkesParams, branchingHistory } = arc;

  const formatParam = (value: number, std?: number): string => {
    if (std !== undefined) {
      return `${value.toFixed(3)} ± ${std.toFixed(3)}`;
    }
    return value.toFixed(3);
  };

  const getStabilityClass = (stability: string): string => {
    switch (stability) {
      case 'stable':
        return 'stability-stable';
      case 'unstable':
        return 'stability-unstable';
      case 'critical':
        return 'stability-critical';
      default:
        return '';
    }
  };

  const getInterpretation = (nBr: number, stability: string): JSX.Element => {
    let offspringDesc = '';
    let stabilityDesc = '';
    let implicationDesc = '';
    let trendDesc = '';

    // Offspring description
    if (nBr < 0.3) {
      offspringDesc = 'a very low number of offspring events';
    } else if (nBr < 0.5) {
      offspringDesc = 'a moderate number of offspring events';
    } else if (nBr < 0.7) {
      offspringDesc = 'a significant number of offspring events';
    } else if (nBr < 0.9) {
      offspringDesc = 'a high number of offspring events';
    } else {
      offspringDesc = 'an extremely high number of offspring events';
    }

    // Stability description
    if (stability === 'stable') {
      stabilityDesc = 'The system is stable and attacks are decaying naturally.';
    } else if (stability === 'unstable') {
      stabilityDesc = 'The system is approaching critical instability (n̂ > 0.7).';
    } else {
      stabilityDesc = 'The system has reached critical instability (n̂ ≥ 0.9).';
    }

    // Implication description
    if (nBr >= 0.7) {
      implicationDesc =
        'This indicates a self-sustaining attack pattern where successful compromises are being leveraged to launch follow-on attacks.';
    } else if (nBr >= 0.5) {
      implicationDesc =
        'This suggests coordinated attack activity with some level of self-propagation.';
    } else {
      implicationDesc =
        'This indicates primarily independent attack events with limited cascade effects.';
    }

    // Trend description (simplified - would need historical comparison in real implementation)
    if (nBr >= 0.8) {
      trendDesc =
        'The branching ratio suggests active exploitation of vulnerable infrastructure.';
    } else if (nBr >= 0.6) {
      trendDesc = 'The branching ratio indicates sustained attack momentum.';
    } else {
      trendDesc = 'The branching ratio shows controlled threat activity.';
    }

    return (
      <>
        <p>
          Each observed attack event triggers an average of{' '}
          <strong>{nBr.toFixed(2)} {offspringDesc}</strong>. {stabilityDesc}
        </p>
        <p>{implicationDesc}</p>
        <p>{trendDesc}</p>
        <p className="stability-summary">
          <strong>Stability Status:</strong>{' '}
          <span className={getStabilityClass(stability)}>
            {stability?.toUpperCase() || "UNKNOWN"}
          </span>
        </p>
      </>
    );
  };

  return (
    <div className="arc-hawkes-tab">
      {/* Raw Parameters */}
      <div className="panel-section">
        <div className="panel-section-header">Hawkes Process Parameters</div>
        <div className="hawkes-params-table">
          <div className="param-row">
            <div className="param-symbol">μ</div>
            <div className="param-name">Base Rate</div>
            <div className="param-value">
              {formatParam(hawkesParams.mu, hawkesParams.muStd)} events/hour
            </div>
          </div>
          <div className="param-row">
            <div className="param-symbol">β</div>
            <div className="param-name">Decay Rate</div>
            <div className="param-value">
              {formatParam(hawkesParams.beta, hawkesParams.betaStd)} /hour
            </div>
          </div>
          <div className="param-row param-row-highlight">
            <div className="param-symbol">n̂</div>
            <div className="param-name">Branching Ratio</div>
            <div className="param-value">
              {formatParam(hawkesParams.nBr, hawkesParams.nBrStd)}
            </div>
          </div>
        </div>
      </div>

      {/* 48-Hour Branching Ratio Sparkline */}
      <div className="panel-section">
        <div className="panel-section-header">48-Hour Branching Ratio (n̂)</div>
        <div className="sparkline-container">
          <BranchingRatioSparkline
            data={branchingHistory}
            width={560}
            height={80}
            strokeWidth={2}
            showThresholds={true}
          />
          <div className="threshold-legend">
            <div className="legend-item">
              <div className="legend-dash" style={{ borderColor: '#EAB308', borderStyle: 'dashed' }} />
              <span>Watch (0.5)</span>
            </div>
            <div className="legend-item">
              <div className="legend-dash" style={{ borderColor: '#F59E0B', borderStyle: 'dashed' }} />
              <span>Warning (0.7)</span>
            </div>
            <div className="legend-item">
              <div className="legend-dash" style={{ borderColor: '#EF4444', borderStyle: 'dashed' }} />
              <span>Emergency (0.9)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Plain-Language Interpretation */}
      <div className="panel-section">
        <div className="panel-section-header">Operational Analysis</div>
        <div className="process-interpretation">
          {getInterpretation(hawkesParams.nBr, hawkesParams.stability)}
        </div>
      </div>
    </div>
  );
};

export default ArcHawkesTab;
