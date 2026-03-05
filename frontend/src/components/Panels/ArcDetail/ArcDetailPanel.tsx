import React, { useState } from 'react';
import ArcOverviewTab from './ArcOverviewTab';
import ArcHawkesTab from './ArcHawkesTab';
import ArcATTACKTab from './ArcATTACKTab';
import ArcNetworkTab from './ArcNetworkTab';
import './ArcDetailPanel.css';

export interface DataPoint {
  timestamp: number;
  value: number;
}

export interface CellInfo {
  cellId: number;
  lat: number;
  lon: number;
  country?: string;
}

export interface HawkesParams {
  mu: number;
  muStd?: number;
  beta: number;
  betaStd?: number;
  nBr: number;
  nBrStd?: number;
  stability: 'stable' | 'unstable' | 'critical';
}

export interface ThreatGroupInfo {
  name: string;
  aliases: string[];
  origin: string;
  confidence: number;
  knownVectors: string[];
  lastObserved: Date;
  relatedCampaigns: number;
}

export interface MITRETechnique {
  id: string;
  name: string;
  tactic: string;
  url: string;
}

export interface MITREMapping {
  techniques: MITRETechnique[];
  killChainPhase: string[];
}

export interface NetworkInfo {
  source: {
    lat: number;
    lon: number;
    asn: string;
    network: string;
    country: string;
  };
  target: {
    lat: number;
    lon: number;
    asn: string;
    network: string;
    country: string;
  };
  portDistribution: Record<number, number>;
  packetTimeline: DataPoint[];
}

export interface ArcData {
  id: string;
  sourceCell: CellInfo;
  targetCell: CellInfo;
  vector: string;
  packets: number;
  bandwidth: number;
  confidence: number;
  firstSeen: Date;
  intensityHistory: DataPoint[];
  hawkesParams: HawkesParams;
  branchingHistory: DataPoint[];
  threatGroup?: ThreatGroupInfo;
  attackMapping: MITREMapping;
  networkDetails: NetworkInfo;
}

interface ArcDetailPanelProps {
  arc: ArcData;
  position: { x: number; y: number };
  onClose: () => void;
}

type TabType = 'overview' | 'hawkes' | 'attack' | 'network';

const ArcDetailPanel: React.FC<ArcDetailPanelProps> = ({ arc, position, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'hawkes', label: 'Hawkes', icon: '📈' },
    { id: 'attack', label: 'ATT&CK', icon: '🎯' },
    { id: 'network', label: 'Network', icon: '🌐' },
  ];

  return (
    <div
      className="arc-detail-panel"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">
          <span className="arc-icon">⚡</span>
          <span className="arc-vector-badge" data-vector={arc.vector}>
            {arc.vector?.toUpperCase() || "UNKNOWN"}
          </span>
          <span className="arc-id">Arc #{arc.id}</span>
        </div>
        <button className="panel-close-button" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="panel-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`panel-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="panel-content">
        {activeTab === 'overview' && <ArcOverviewTab arc={arc} />}
        {activeTab === 'hawkes' && <ArcHawkesTab arc={arc} />}
        {activeTab === 'attack' && <ArcATTACKTab arc={arc} />}
        {activeTab === 'network' && <ArcNetworkTab arc={arc} />}
      </div>
    </div>
  );
};

export default ArcDetailPanel;
