/**
 * Threat Group Database & Correlation Utilities
 *
 * Database of known APT groups and their characteristics.
 * Used for correlating attack patterns to known threat actors.
 */

export interface ThreatGroup {
  id: string;
  name: string;
  aliases: string[];
  origin: string;
  knownVectors: string[];
  firstObserved: Date;
  active: boolean;
  sophistication: 'low' | 'medium' | 'high' | 'advanced';
  primaryTargets: string[];
  description: string;
}

/**
 * Known APT/Threat Group Database
 */
export const THREAT_GROUPS: ThreatGroup[] = [
  {
    id: 'apt28',
    name: 'APT28',
    aliases: ['Fancy Bear', 'Sofacy', 'Pawn Storm', 'Sednit'],
    origin: 'Russia',
    knownVectors: ['ssh', 'rdp', 'http', 'brute_force'],
    firstObserved: new Date('2007-01-01'),
    active: true,
    sophistication: 'advanced',
    primaryTargets: ['Government', 'Military', 'Media', 'Energy'],
    description: 'Russian state-sponsored cyber espionage group active since 2007.',
  },
  {
    id: 'apt29',
    name: 'APT29',
    aliases: ['Cozy Bear', 'The Dukes', 'CozyDuke'],
    origin: 'Russia',
    knownVectors: ['http', 'ssh', 'brute_force'],
    firstObserved: new Date('2008-01-01'),
    active: true,
    sophistication: 'advanced',
    primaryTargets: ['Government', 'Think Tanks', 'Healthcare'],
    description: 'Sophisticated Russian cyber espionage group targeting government entities.',
  },
  {
    id: 'apt41',
    name: 'APT41',
    aliases: ['Wicked Panda', 'Double Dragon'],
    origin: 'China',
    knownVectors: ['http', 'ssh', 'dns_amp'],
    firstObserved: new Date('2012-01-01'),
    active: true,
    sophistication: 'advanced',
    primaryTargets: ['Technology', 'Healthcare', 'Telecom', 'Gaming'],
    description: 'Chinese state-sponsored group conducting espionage and financial crimes.',
  },
  {
    id: 'lazarus',
    name: 'Lazarus Group',
    aliases: ['Hidden Cobra', 'Guardians of Peace', 'ZINC'],
    origin: 'North Korea',
    knownVectors: ['http', 'ssh', 'ransomware'],
    firstObserved: new Date('2009-01-01'),
    active: true,
    sophistication: 'advanced',
    primaryTargets: ['Financial', 'Media', 'Cryptocurrency', 'Defense'],
    description: 'North Korean state-sponsored group known for destructive attacks and financial theft.',
  },
  {
    id: 'turla',
    name: 'Turla',
    aliases: ['Snake', 'Venomous Bear', 'Uroburos'],
    origin: 'Russia',
    knownVectors: ['http', 'ssh', 'botnet_c2'],
    firstObserved: new Date('2008-01-01'),
    active: true,
    sophistication: 'advanced',
    primaryTargets: ['Government', 'Military', 'Embassy', 'Research'],
    description: 'Russian cyber espionage group with sophisticated toolset.',
  },
  {
    id: 'carbanak',
    name: 'Carbanak',
    aliases: ['FIN7', 'Carbon Spider'],
    origin: 'Russia',
    knownVectors: ['http', 'brute_force', 'botnet_c2'],
    firstObserved: new Date('2013-01-01'),
    active: true,
    sophistication: 'high',
    primaryTargets: ['Financial', 'Hospitality', 'Retail'],
    description: 'Financially-motivated cybercrime group targeting financial institutions.',
  },
  {
    id: 'equation',
    name: 'Equation Group',
    aliases: ['Tilded Team'],
    origin: 'Unknown',
    knownVectors: ['http', 'ssh', 'dns_amp', 'brute_force'],
    firstObserved: new Date('2001-01-01'),
    active: false,
    sophistication: 'advanced',
    primaryTargets: ['Government', 'Telecom', 'Energy', 'Aerospace'],
    description: 'Highly sophisticated espionage group linked to state-level operations.',
  },
  {
    id: 'muddywater',
    name: 'MuddyWater',
    aliases: ['Seedworm', 'TEMP.Zagros'],
    origin: 'Iran',
    knownVectors: ['http', 'ssh', 'brute_force'],
    firstObserved: new Date('2017-01-01'),
    active: true,
    sophistication: 'medium',
    primaryTargets: ['Government', 'Telecom', 'Oil & Gas'],
    description: 'Iranian state-sponsored group targeting Middle East organizations.',
  },
  {
    id: 'oceanlotus',
    name: 'OceanLotus',
    aliases: ['APT32', 'SeaLotus', 'Cobalt Kitty'],
    origin: 'Vietnam',
    knownVectors: ['http', 'ssh'],
    firstObserved: new Date('2012-01-01'),
    active: true,
    sophistication: 'high',
    primaryTargets: ['Government', 'Media', 'Manufacturing', 'Hospitality'],
    description: 'Vietnamese state-sponsored group targeting foreign corporations and dissidents.',
  },
  {
    id: 'conti',
    name: 'Conti',
    aliases: ['Wizard Spider', 'Ryuk'],
    origin: 'Russia',
    knownVectors: ['ransomware', 'brute_force', 'http'],
    firstObserved: new Date('2020-01-01'),
    active: false,
    sophistication: 'high',
    primaryTargets: ['Healthcare', 'Government', 'Manufacturing', 'Retail'],
    description: 'Ransomware group known for targeting critical infrastructure.',
  },
];

/**
 * Match threat group based on attack vector and characteristics
 */
export function matchThreatGroup(
  vector: string,
  sourceCountry?: string,
  targetSector?: string
): ThreatGroup[] {
  const matches: Array<{ group: ThreatGroup; confidence: number }> = [];

  for (const group of THREAT_GROUPS) {
    let confidence = 0;

    // Vector match (primary factor)
    if (group.knownVectors.includes(vector.toLowerCase())) {
      confidence += 0.6;
    }

    // Origin/source country match (secondary factor)
    if (sourceCountry && group.origin.toLowerCase() === sourceCountry.toLowerCase()) {
      confidence += 0.2;
    }

    // Target sector match (tertiary factor)
    if (targetSector && group.primaryTargets.some((t) => t.toLowerCase() === targetSector.toLowerCase())) {
      confidence += 0.2;
    }

    // Only include active groups or high-confidence matches
    if (confidence >= 0.6 && (group.active || confidence >= 0.8)) {
      matches.push({ group, confidence });
    }
  }

  // Sort by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);

  // Return top matches with confidence >= 0.6
  return matches.filter((m) => m.confidence >= 0.6).map((m) => m.group);
}

/**
 * Get threat group by ID
 */
export function getThreatGroupById(id: string): ThreatGroup | undefined {
  return THREAT_GROUPS.find((g) => g.id === id.toLowerCase());
}

/**
 * Get threat group by name or alias
 */
export function getThreatGroupByName(name: string): ThreatGroup | undefined {
  const lowerName = name.toLowerCase();
  return THREAT_GROUPS.find(
    (g) =>
      g.name.toLowerCase() === lowerName ||
      g.aliases.some((alias) => alias.toLowerCase() === lowerName)
  );
}

/**
 * Get all active threat groups
 */
export function getActiveThreatGroups(): ThreatGroup[] {
  return THREAT_GROUPS.filter((g) => g.active);
}

/**
 * Get threat groups by origin country
 */
export function getThreatGroupsByOrigin(country: string): ThreatGroup[] {
  return THREAT_GROUPS.filter((g) => g.origin.toLowerCase() === country.toLowerCase());
}

/**
 * Get threat groups using a specific vector
 */
export function getThreatGroupsByVector(vector: string): ThreatGroup[] {
  return THREAT_GROUPS.filter((g) => g.knownVectors.includes(vector.toLowerCase()));
}

/**
 * Calculate correlation confidence for a threat group match
 */
export function calculateCorrelationConfidence(
  group: ThreatGroup,
  vector: string,
  sourceCountry?: string,
  targetSector?: string
): number {
  let confidence = 0;

  // Vector match
  if (group.knownVectors.includes(vector.toLowerCase())) {
    confidence += 0.6;
  }

  // Origin match
  if (sourceCountry && group.origin.toLowerCase() === sourceCountry.toLowerCase()) {
    confidence += 0.2;
  }

  // Target sector match
  if (targetSector && group.primaryTargets.some((t) => t.toLowerCase() === targetSector.toLowerCase())) {
    confidence += 0.2;
  }

  return Math.min(confidence, 1.0);
}
