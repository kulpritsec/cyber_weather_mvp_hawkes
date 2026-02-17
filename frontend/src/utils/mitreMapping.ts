/**
 * MITRE ATT&CK Technique Mapping Utilities
 *
 * Maps attack vectors to MITRE ATT&CK techniques and tactics.
 * Based on MITRE ATT&CK Framework v14.1
 */

export interface MITRETechnique {
  id: string;
  name: string;
  tactic: string;
  url: string;
  description?: string;
}

export interface KillChainPhase {
  phase: string;
  description: string;
}

/**
 * Vector-to-MITRE-ATT&CK Technique Mapping
 */
export const VECTOR_TO_ATTACK_MAP: Record<string, MITRETechnique[]> = {
  ssh: [
    {
      id: 'T1110.001',
      name: 'Password Guessing',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/001/',
      description: 'Adversaries may use password guessing to obtain valid account credentials.',
    },
    {
      id: 'T1110.003',
      name: 'Password Spraying',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/003/',
      description: 'Adversaries may use password spraying to obtain valid account credentials.',
    },
    {
      id: 'T1021.004',
      name: 'SSH',
      tactic: 'Lateral Movement',
      url: 'https://attack.mitre.org/techniques/T1021/004/',
      description: 'Adversaries may use SSH to move laterally within an environment.',
    },
    {
      id: 'T1078',
      name: 'Valid Accounts',
      tactic: 'Initial Access',
      url: 'https://attack.mitre.org/techniques/T1078/',
      description: 'Adversaries may obtain credentials to access systems, services, or networks.',
    },
  ],
  rdp: [
    {
      id: 'T1110',
      name: 'Brute Force',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/',
      description: 'Adversaries may use brute force techniques to gain access to accounts.',
    },
    {
      id: 'T1110.001',
      name: 'Password Guessing',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/001/',
      description: 'Adversaries may use password guessing to obtain valid account credentials.',
    },
    {
      id: 'T1021.001',
      name: 'Remote Desktop Protocol',
      tactic: 'Lateral Movement',
      url: 'https://attack.mitre.org/techniques/T1021/001/',
      description: 'Adversaries may use RDP to move laterally within an environment.',
    },
    {
      id: 'T1133',
      name: 'External Remote Services',
      tactic: 'Initial Access',
      url: 'https://attack.mitre.org/techniques/T1133/',
      description: 'Adversaries may leverage external-facing remote services to gain initial access.',
    },
  ],
  http: [
    {
      id: 'T1190',
      name: 'Exploit Public-Facing Application',
      tactic: 'Initial Access',
      url: 'https://attack.mitre.org/techniques/T1190/',
      description: 'Adversaries may exploit vulnerabilities in public-facing web applications.',
    },
    {
      id: 'T1505.003',
      name: 'Web Shell',
      tactic: 'Persistence',
      url: 'https://attack.mitre.org/techniques/T1505/003/',
      description: 'Adversaries may install web shells to maintain persistence.',
    },
    {
      id: 'T1071.001',
      name: 'Web Protocols',
      tactic: 'Command and Control',
      url: 'https://attack.mitre.org/techniques/T1071/001/',
      description: 'Adversaries may communicate using HTTP/HTTPS protocols.',
    },
    {
      id: 'T1059.007',
      name: 'JavaScript',
      tactic: 'Execution',
      url: 'https://attack.mitre.org/techniques/T1059/007/',
      description: 'Adversaries may abuse JavaScript for execution.',
    },
  ],
  dns_amp: [
    {
      id: 'T1498.002',
      name: 'Reflection Amplification',
      tactic: 'Impact',
      url: 'https://attack.mitre.org/techniques/T1498/002/',
      description: 'Adversaries may use DNS amplification to conduct DDoS attacks.',
    },
    {
      id: 'T1071.004',
      name: 'DNS',
      tactic: 'Command and Control',
      url: 'https://attack.mitre.org/techniques/T1071/004/',
      description: 'Adversaries may communicate using DNS protocol.',
    },
    {
      id: 'T1583.007',
      name: 'Acquire Infrastructure: Serverless',
      tactic: 'Resource Development',
      url: 'https://attack.mitre.org/techniques/T1583/007/',
      description: 'Adversaries may abuse DNS infrastructure for attacks.',
    },
  ],
  brute_force: [
    {
      id: 'T1110',
      name: 'Brute Force',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/',
      description: 'Adversaries may use brute force techniques to gain access.',
    },
    {
      id: 'T1110.001',
      name: 'Password Guessing',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/001/',
      description: 'Adversaries may use password guessing.',
    },
    {
      id: 'T1110.003',
      name: 'Password Spraying',
      tactic: 'Credential Access',
      url: 'https://attack.mitre.org/techniques/T1110/003/',
      description: 'Adversaries may use password spraying.',
    },
  ],
  botnet_c2: [
    {
      id: 'T1071',
      name: 'Application Layer Protocol',
      tactic: 'Command and Control',
      url: 'https://attack.mitre.org/techniques/T1071/',
      description: 'Adversaries may communicate using application layer protocols.',
    },
    {
      id: 'T1573',
      name: 'Encrypted Channel',
      tactic: 'Command and Control',
      url: 'https://attack.mitre.org/techniques/T1573/',
      description: 'Adversaries may employ encrypted communications channels.',
    },
    {
      id: 'T1219',
      name: 'Remote Access Software',
      tactic: 'Command and Control',
      url: 'https://attack.mitre.org/techniques/T1219/',
      description: 'Adversaries may use legitimate remote access tools for C2.',
    },
  ],
  ransomware: [
    {
      id: 'T1486',
      name: 'Data Encrypted for Impact',
      tactic: 'Impact',
      url: 'https://attack.mitre.org/techniques/T1486/',
      description: 'Adversaries may encrypt data to impact availability.',
    },
    {
      id: 'T1490',
      name: 'Inhibit System Recovery',
      tactic: 'Impact',
      url: 'https://attack.mitre.org/techniques/T1490/',
      description: 'Adversaries may delete or disable system recovery features.',
    },
    {
      id: 'T1491',
      name: 'Defacement',
      tactic: 'Impact',
      url: 'https://attack.mitre.org/techniques/T1491/',
      description: 'Adversaries may modify visual content for intimidation.',
    },
    {
      id: 'T1489',
      name: 'Service Stop',
      tactic: 'Impact',
      url: 'https://attack.mitre.org/techniques/T1489/',
      description: 'Adversaries may stop or disable services.',
    },
  ],
};

/**
 * Cyber Kill Chain Phases (Lockheed Martin Model)
 */
export const KILL_CHAIN_PHASES: KillChainPhase[] = [
  {
    phase: 'Reconnaissance',
    description: 'Harvesting information to plan future operations',
  },
  {
    phase: 'Weaponization',
    description: 'Creating a deliverable payload using an exploit and backdoor',
  },
  {
    phase: 'Delivery',
    description: 'Transmitting the weapon to the targeted environment',
  },
  {
    phase: 'Exploitation',
    description: 'Triggering the adversary code to exploit a vulnerability',
  },
  {
    phase: 'Installation',
    description: 'Installing malware on the target system',
  },
  {
    phase: 'Command & Control',
    description: 'Establishing command and control channel',
  },
  {
    phase: 'Actions on Objectives',
    description: 'Taking actions to achieve intended objectives',
  },
];

/**
 * Vector-to-Kill-Chain Phase Mapping
 * Maps attack vectors to likely Kill Chain phases
 */
export const VECTOR_TO_KILL_CHAIN: Record<string, string[]> = {
  ssh: ['Reconnaissance', 'Weaponization', 'Delivery', 'Exploitation'],
  rdp: ['Reconnaissance', 'Weaponization', 'Delivery', 'Exploitation'],
  http: ['Reconnaissance', 'Weaponization', 'Delivery', 'Exploitation', 'Installation'],
  dns_amp: ['Reconnaissance', 'Weaponization', 'Delivery'],
  brute_force: ['Reconnaissance', 'Weaponization', 'Delivery', 'Exploitation'],
  botnet_c2: ['Installation', 'Command & Control', 'Actions on Objectives'],
  ransomware: ['Exploitation', 'Installation', 'Command & Control', 'Actions on Objectives'],
};

/**
 * Get MITRE ATT&CK techniques for a given vector
 */
export function getMITRETechniques(vector: string): MITRETechnique[] {
  return VECTOR_TO_ATTACK_MAP[vector.toLowerCase()] || [];
}

/**
 * Get Kill Chain phases for a given vector
 */
export function getKillChainPhases(vector: string): string[] {
  return VECTOR_TO_KILL_CHAIN[vector.toLowerCase()] || [];
}

/**
 * Get the current (most advanced) Kill Chain phase for a vector
 */
export function getCurrentKillChainPhase(vector: string): string | null {
  const phases = getKillChainPhases(vector);
  return phases.length > 0 ? phases[phases.length - 1] : null;
}

/**
 * Check if a Kill Chain phase is active for a vector
 */
export function isKillChainPhaseActive(vector: string, phase: string): boolean {
  const phases = getKillChainPhases(vector);
  return phases.includes(phase);
}

/**
 * Get all unique tactics from MITRE techniques for a vector
 */
export function getTacticsForVector(vector: string): string[] {
  const techniques = getMITRETechniques(vector);
  const tactics = techniques.map((t) => t.tactic);
  return Array.from(new Set(tactics));
}
