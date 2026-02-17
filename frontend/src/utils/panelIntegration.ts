/**
 * Panel Integration Utilities
 *
 * Helpers for integrating interactive panels with CyberWeatherGlobe:
 * - Raycasting utilities
 * - Panel positioning logic
 * - Data fetching hooks
 * - Arc/Cell data builders
 */

import * as THREE from 'three';
import type { ArcData, HotspotCellData } from '../components/Panels';
import { getMITRETechniques, getKillChainPhases } from './mitreMapping';
import { matchThreatGroup } from './threatGroups';

/**
 * Calculate optimal panel position near mouse click
 * Ensures panel stays within viewport bounds
 */
export function calculatePanelPosition(
  clickX: number,
  clickY: number,
  panelWidth: number,
  panelHeight: number,
  offset: { x: number; y: number } = { x: 20, y: -100 }
): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = clickX + offset.x;
  let y = clickY + offset.y;

  // Keep panel within right boundary
  if (x + panelWidth > viewportWidth - 20) {
    x = clickX - panelWidth - 20; // Show on left side instead
  }

  // Keep panel within bottom boundary
  if (y + panelHeight > viewportHeight - 20) {
    y = viewportHeight - panelHeight - 20;
  }

  // Keep panel within top boundary
  if (y < 20) {
    y = 20;
  }

  // Keep panel within left boundary
  if (x < 20) {
    x = 20;
  }

  return { x, y };
}

/**
 * Perform raycasting to detect arc mesh intersection
 */
export function raycastArcs(
  mouse: { x: number; y: number },
  camera: THREE.Camera,
  arcMeshes: THREE.Object3D[]
): { arc: THREE.Object3D; point: THREE.Vector3 } | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);

  const intersects = raycaster.intersectObjects(arcMeshes, true);

  if (intersects.length > 0) {
    const firstHit = intersects[0];
    // Traverse up to find the arc mesh (might hit child geometry)
    let arcMesh = firstHit.object;
    while (arcMesh.parent && !arcMesh.userData.arcData) {
      arcMesh = arcMesh.parent;
    }

    if (arcMesh.userData.arcData) {
      return {
        arc: arcMesh,
        point: firstHit.point,
      };
    }
  }

  return null;
}

/**
 * Perform raycasting against globe surface to get lat/lon
 */
export function raycastGlobe(
  mouse: { x: number; y: number },
  camera: THREE.Camera,
  globeMesh: THREE.Mesh,
  globeRadius: number = 1.0
): { lat: number; lon: number; point: THREE.Vector3 } | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);

  const intersects = raycaster.intersectObject(globeMesh);

  if (intersects.length > 0) {
    const point = intersects[0].point;

    // Convert 3D point to lat/lon
    const lat = Math.asin(point.y / globeRadius) * (180 / Math.PI);
    const lon = Math.atan2(point.x, point.z) * (180 / Math.PI);

    return { lat, lon, point };
  }

  return null;
}

/**
 * Convert mouse event to normalized device coordinates
 */
export function getMouseNDC(
  event: MouseEvent,
  containerElement: HTMLElement
): { x: number; y: number } {
  const rect = containerElement.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return { x, y };
}

/**
 * Find grid cell ID from lat/lon coordinates
 */
export function latLonToGridCell(
  lat: number,
  lon: number,
  resolution: number = 2.5
): { cellId: number; cellLat: number; cellLon: number } {
  // Snap to grid center
  const cellLat = Math.floor(lat / resolution) * resolution + resolution / 2;
  const cellLon = Math.floor(lon / resolution) * resolution + resolution / 2;

  // Generate consistent cell ID
  const latIndex = Math.floor((lat + 90) / resolution);
  const lonIndex = Math.floor((lon + 180) / resolution);
  const cellId = latIndex * Math.floor(360 / resolution) + lonIndex;

  return { cellId, cellLat, cellLon };
}

/**
 * Build ArcData from event aggregation (for future backend integration)
 */
export async function buildArcDataFromEvents(
  arcId: string,
  apiBaseUrl: string = '/api/v1'
): Promise<ArcData | null> {
  try {
    // Future: Call /v1/arcs/{id} endpoint
    // For now, this is a placeholder
    const response = await fetch(`${apiBaseUrl}/arcs/${arcId}`);
    if (!response.ok) return null;

    const data = await response.json();
    return data as ArcData;
  } catch (error) {
    console.error('Failed to fetch arc data:', error);
    return null;
  }
}

/**
 * Fetch cell history from backend
 */
export async function fetchCellHistory(
  cellId: number,
  vector?: string,
  hours: number = 48,
  apiBaseUrl: string = '/api/v1'
): Promise<HotspotCellData | null> {
  try {
    const params = new URLSearchParams({
      hours: hours.toString(),
      ...(vector && { vector }),
    });

    const response = await fetch(`${apiBaseUrl}/cells/${cellId}/history?${params}`);
    if (!response.ok) {
      console.error(`Failed to fetch cell history: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Transform backend response to HotspotCellData format
    const hotspotData: HotspotCellData = {
      cellId: data.cell_id,
      lat: data.lat,
      lon: data.lon,
      vector: data.vector,
      hawkesParams: data.current_params || { mu: 0, beta: 0, nBr: 0 },
      eventCount24h: data.event_count_24h,
      severity: data.severity,
      intensityHistory: data.intensity_history,
      branchingHistory: data.branching_history,
      location: undefined, // Could be enriched with geocoding
    };

    return hotspotData;
  } catch (error) {
    console.error('Failed to fetch cell history:', error);
    return null;
  }
}

/**
 * Enhance ArcData with MITRE and threat intelligence
 */
export function enhanceArcWithIntelligence(
  baseArc: Partial<ArcData>,
  vector: string,
  sourceCountry?: string,
  targetSector?: string
): ArcData {
  // Get MITRE ATT&CK techniques
  const techniques = getMITRETechniques(vector);
  const killChainPhases = getKillChainPhases(vector);

  // Get threat group correlations
  const threatMatches = matchThreatGroup(vector, sourceCountry, targetSector);
  const threatGroup = threatMatches.length > 0 ? {
    name: threatMatches[0].name,
    aliases: threatMatches[0].aliases,
    origin: threatMatches[0].origin,
    confidence: 0.85,
    knownVectors: threatMatches[0].knownVectors,
    lastObserved: new Date(),
    relatedCampaigns: 0,
  } : undefined;

  return {
    ...baseArc,
    attackMapping: {
      techniques,
      killChainPhase: killChainPhases,
    },
    threatGroup,
  } as ArcData;
}

/**
 * Debounce function for click handlers
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Check if click is on a panel (to prevent closing when clicking inside)
 */
export function isClickOnPanel(event: MouseEvent, panelRef: React.RefObject<HTMLElement>): boolean {
  if (!panelRef.current) return false;
  return panelRef.current.contains(event.target as Node);
}

/**
 * Create arc mesh userData structure
 */
export function createArcUserData(arcData: ArcData): Record<string, any> {
  return {
    type: 'arc',
    arcData,
    clickable: true,
    hoverable: true,
  };
}

/**
 * Create hotspot mesh userData structure
 */
export function createHotspotUserData(cellId: number, vector: string): Record<string, any> {
  return {
    type: 'hotspot',
    cellId,
    vector,
    clickable: true,
    hoverable: true,
  };
}
