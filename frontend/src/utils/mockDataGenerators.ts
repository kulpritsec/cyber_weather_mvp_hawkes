/**
 * Mock Data Generators for Testing Interactive Panels
 *
 * Generates realistic test data for:
 * - ArcDetailPanel
 * - HotspotCellPanel
 * - Threat correlations
 * - Historical time-series data
 */

import type { ArcData, HotspotCellData } from '../components/Panels';
import { getMITRETechniques, getKillChainPhases } from './mitreMapping';
import { matchThreatGroup } from './threatGroups';

/**
 * Generate mock 48-hour time-series data
 */
export function generateTimeSeries(
  hours: number = 48,
  baseValue: number = 50,
  volatility: number = 20
): Array<{ timestamp: number; value: number }> {
  const data: Array<{ timestamp: number; value: number }> = [];
  const now = Date.now();
  const intervalMs = (hours * 60 * 60 * 1000) / 48; // One point per hour

  for (let i = 0; i < 48; i++) {
    const timestamp = now - (48 - i) * intervalMs;
    const noise = (Math.random() - 0.5) * volatility;
    const trend = i * 0.5; // Slight upward trend
    const value = Math.max(0, baseValue + noise + trend);
    data.push({ timestamp, value });
  }

  return data;
}

/**
 * Generate mock branching ratio time-series
 */
export function generateBranchingRatioSeries(
  hours: number = 48,
  targetLevel: 'stable' | 'elevated' | 'critical' = 'elevated'
): Array<{ timestamp: number; value: number }> {
  const baseValues = {
    stable: 0.3,
    elevated: 0.65,
    critical: 0.85,
  };

  const data: Array<{ timestamp: number; value: number }> = [];
  const now = Date.now();
  const intervalMs = (hours * 60 * 60 * 1000) / 48;
  const baseValue = baseValues[targetLevel];

  for (let i = 0; i < 48; i++) {
    const timestamp = now - (48 - i) * intervalMs;
    const noise = (Math.random() - 0.5) * 0.1;
    const trend = i * 0.003; // Gradual increase
    const value = Math.min(0.99, Math.max(0.1, baseValue + noise + trend));
    data.push({ timestamp, value });
  }

  return data;
}

/**
 * Generate mock packet timeline (per-minute for last hour)
 */
export function generatePacketTimeline(): Array<{ timestamp: number; value: number }> {
  const data: Array<{ timestamp: number; value: number }> = [];
  const now = Date.now();

  for (let i = 0; i < 60; i++) {
    const timestamp = now - (60 - i) * 60 * 1000; // One minute intervals
    const value = Math.floor(Math.random() * 100) + 20; // 20-120 packets
    data.push({ timestamp, value });
  }

  return data;
}

/**
 * Generate mock ArcData with real MITRE/threat correlations
 */
export function generateMockArcData(overrides?: Partial<ArcData>): ArcData {
  const vectors = ['ssh', 'rdp', 'http', 'dns_amp', 'brute_force'];
  const vector = overrides?.vector || vectors[Math.floor(Math.random() * vectors.length)];

  // Get real MITRE techniques for this vector
  const techniques = getMITRETechniques(vector);
  const killChainPhases = getKillChainPhases(vector);

  // Get real threat group matches
  const threatMatches = matchThreatGroup(vector, 'Russia', 'Government');
  const threatGroup = threatMatches.length > 0 ? {
    name: threatMatches[0].name,
    aliases: threatMatches[0].aliases,
    origin: threatMatches[0].origin,
    confidence: 0.85 + Math.random() * 0.1,
    knownVectors: threatMatches[0].knownVectors,
    lastObserved: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
    relatedCampaigns: Math.floor(Math.random() * 5) + 1,
  } : undefined;

  const arc: ArcData = {
    id: `arc_${Math.random().toString(36).substr(2, 9)}`,
    sourceCell: {
      cellId: Math.floor(Math.random() * 10000),
      lat: 37.77 + (Math.random() - 0.5) * 10,
      lon: -122.42 + (Math.random() - 0.5) * 20,
      country: 'United States',
    },
    targetCell: {
      cellId: Math.floor(Math.random() * 10000),
      lat: 51.51 + (Math.random() - 0.5) * 10,
      lon: -0.13 + (Math.random() - 0.5) * 20,
      country: 'United Kingdom',
    },
    vector,
    packets: Math.floor(Math.random() * 2000000) + 500000,
    bandwidth: Math.floor(Math.random() * 3000000000) + 1000000000,
    confidence: 0.75 + Math.random() * 0.2,
    firstSeen: new Date(Date.now() - Math.random() * 48 * 60 * 60 * 1000),
    intensityHistory: generateTimeSeries(48, 60, 25),
    hawkesParams: {
      mu: 0.1 + Math.random() * 0.3,
      muStd: 0.02 + Math.random() * 0.05,
      beta: 0.4 + Math.random() * 0.3,
      betaStd: 0.05 + Math.random() * 0.08,
      nBr: 0.6 + Math.random() * 0.3,
      nBrStd: 0.08 + Math.random() * 0.1,
      stability: Math.random() > 0.5 ? 'unstable' : 'stable',
    },
    branchingHistory: generateBranchingRatioSeries(48, 'elevated'),
    threatGroup,
    attackMapping: {
      techniques,
      killChainPhase: killChainPhases,
    },
    networkDetails: {
      source: {
        lat: 37.77 + (Math.random() - 0.5) * 5,
        lon: -122.42 + (Math.random() - 0.5) * 10,
        asn: `AS${Math.floor(Math.random() * 90000) + 10000} - ${['Google LLC', 'Amazon', 'Microsoft'][Math.floor(Math.random() * 3)]}`,
        network: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.0/24`,
        country: 'United States 🇺🇸',
      },
      target: {
        lat: 51.51 + (Math.random() - 0.5) * 5,
        lon: -0.13 + (Math.random() - 0.5) * 10,
        asn: `AS${Math.floor(Math.random() * 90000) + 10000} - ${['Datacamp Limited', 'OVH', 'DigitalOcean'][Math.floor(Math.random() * 3)]}`,
        network: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.0/24`,
        country: 'United Kingdom 🇬🇧',
      },
      portDistribution: {
        22: Math.floor(Math.random() * 600) + 100,
        80: Math.floor(Math.random() * 400) + 50,
        443: Math.floor(Math.random() * 300) + 50,
        3389: Math.floor(Math.random() * 150) + 20,
      },
      packetTimeline: generatePacketTimeline(),
    },
    ...overrides,
  };

  return arc;
}

/**
 * Generate mock HotspotCellData
 */
export function generateMockHotspotData(overrides?: Partial<HotspotCellData>): HotspotCellData {
  const vectors = ['ssh', 'rdp', 'http', 'dns_amp'];
  const vector = overrides?.vector || vectors[Math.floor(Math.random() * vectors.length)];

  const nBr = 0.5 + Math.random() * 0.4; // 0.5 - 0.9 range
  let severity: 'clear' | 'advisory' | 'watch' | 'warning' | 'emergency';

  if (nBr >= 0.9) {
    severity = 'emergency';
  } else if (nBr >= 0.7) {
    severity = 'warning';
  } else if (nBr >= 0.5) {
    severity = 'watch';
  } else if (nBr >= 0.3) {
    severity = 'advisory';
  } else {
    severity = 'clear';
  }

  const cell: HotspotCellData = {
    cellId: Math.floor(Math.random() * 10000),
    lat: -90 + Math.random() * 180,
    lon: -180 + Math.random() * 360,
    vector,
    hawkesParams: {
      mu: 0.15 + Math.random() * 0.25,
      beta: 0.45 + Math.random() * 0.35,
      nBr,
    },
    eventCount24h: Math.floor(Math.random() * 5000) + 1000,
    severity,
    intensityHistory: generateTimeSeries(48, 50, 20),
    branchingHistory: generateBranchingRatioSeries(48, severity === 'emergency' ? 'critical' : 'elevated'),
    location: ['Tokyo, Japan', 'London, UK', 'New York, USA', 'Sydney, Australia'][Math.floor(Math.random() * 4)],
    ...overrides,
  };

  return cell;
}

/**
 * Generate multiple mock arcs
 */
export function generateMockArcs(count: number = 5): ArcData[] {
  return Array.from({ length: count }, () => generateMockArcData());
}

/**
 * Generate multiple mock hotspots
 */
export function generateMockHotspots(count: number = 10): HotspotCellData[] {
  return Array.from({ length: count }, () => generateMockHotspotData());
}

/**
 * Get a random mock arc with specific vector
 */
export function getMockArcByVector(vector: string): ArcData {
  return generateMockArcData({ vector });
}

/**
 * Get a random mock hotspot with specific severity
 */
export function getMockHotspotBySeverity(
  severity: 'clear' | 'advisory' | 'watch' | 'warning' | 'emergency'
): HotspotCellData {
  // Determine n_br range based on severity
  const nBrRanges = {
    clear: [0.1, 0.3],
    advisory: [0.3, 0.5],
    watch: [0.5, 0.7],
    warning: [0.7, 0.9],
    emergency: [0.9, 0.99],
  };

  const [min, max] = nBrRanges[severity];
  const nBr = min + Math.random() * (max - min);

  return generateMockHotspotData({
    severity,
    hawkesParams: {
      mu: 0.15 + Math.random() * 0.25,
      beta: 0.45 + Math.random() * 0.35,
      nBr,
    },
  });
}
