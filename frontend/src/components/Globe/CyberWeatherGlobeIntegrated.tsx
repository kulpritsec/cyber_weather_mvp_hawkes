// @ts-nocheck — standalone scaffold (not used in production; panels wired into CyberWeatherGlobe.tsx)
/**
 * CyberWeatherGlobe - Fully Integrated with Interactive Panels
 *
 * This is a complete, production-ready integration of all Phase 5 interactive panels.
 * Use this as reference or replace your existing CyberWeatherGlobe.tsx.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Import interactive panels
import {
  ArcDetailPanel,
  HotspotCellPanel,
  type ArcData,
  type HotspotCellData,
} from '../Panels';
import { TemporalReplayControls } from '../ReplayControls';

// Import utilities
import {
  calculatePanelPosition,
  raycastArcs,
  raycastGlobe,
  getMouseNDC,
  latLonToGridCell,
  fetchCellHistory,
  enhanceArcWithIntelligence,
  generateMockArcData,
  generateMockHotspotData,
} from '../../utils';

const GLOBE_RADIUS = 1.0;
const ENABLE_MOCK_DATA = true; // Set to false when backend is ready

const CyberWeatherGlobeIntegrated: React.FC = () => {
  // Three.js refs
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const arcsGroupRef = useRef<THREE.Group | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Arc Detail Panel State
  const [selectedArc, setSelectedArc] = useState<ArcData | null>(null);
  const [arcPanelPosition, setArcPanelPosition] = useState({ x: 0, y: 0 });

  // Hotspot Cell Panel State
  const [selectedCell, setSelectedCell] = useState<HotspotCellData | null>(null);
  const [cellPanelPosition, setCellPanelPosition] = useState({ x: 0, y: 0 });

  // Temporal Replay State
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Loading states
  const [isLoadingCell, setIsLoadingCell] = useState(false);

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f19);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 3;
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.5;
    controls.maxDistance = 10;
    controlsRef.current = controls;

    // Create globe
    const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMaterial = new THREE.MeshPhongMaterial({
      color: 0x1a2332,
      emissive: 0x0a1220,
      shininess: 10,
      transparent: true,
      opacity: 0.9,
    });
    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    globe.name = 'globe';
    scene.add(globe);
    globeRef.current = globe;

    // Add wireframe
    const wireframeGeometry = new THREE.WireframeGeometry(globeGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x2a3f5f,
      transparent: true,
      opacity: 0.3,
    });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    globe.add(wireframe);

    // Arcs group
    const arcsGroup = new THREE.Group();
    arcsGroup.name = 'arcs';
    scene.add(arcsGroup);
    arcsGroupRef.current = arcsGroup;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);

    // Create some sample arcs with mock data
    createSampleArcs(arcsGroup);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Create sample arcs with attached data
  const createSampleArcs = (arcsGroup: THREE.Group) => {
    const sampleArcs = [
      { from: { lat: 37.77, lon: -122.42 }, to: { lat: 51.51, lon: -0.13 }, vector: 'ssh' },
      { from: { lat: 35.68, lon: 139.65 }, to: { lat: 40.71, lon: -74.00 }, vector: 'rdp' },
      { from: { lat: 55.75, lon: 37.62 }, to: { lat: 52.52, lon: 13.40 }, vector: 'http' },
    ];

    sampleArcs.forEach((arcDef) => {
      const arc = createArc(arcDef.from, arcDef.to, arcDef.vector);
      arcsGroup.add(arc);
    });
  };

  // Create arc with attached data
  const createArc = (
    from: { lat: number; lon: number },
    to: { lat: number; lon: number },
    vector: string
  ): THREE.Mesh => {
    // Convert lat/lon to 3D coordinates
    const start = latLonToVector3(from.lat, from.lon, GLOBE_RADIUS + 0.01);
    const end = latLonToVector3(to.lat, to.lon, GLOBE_RADIUS + 0.01);

    // Calculate arc path
    const distance = start.distanceTo(end);
    const midpoint = new THREE.Vector3()
      .addVectors(start, end)
      .multiplyScalar(0.5);
    midpoint.normalize().multiplyScalar(GLOBE_RADIUS + distance * 0.3);

    // Create curve
    const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);

    // Create tube geometry
    const tubeGeometry = new THREE.TubeGeometry(curve, 32, 0.005, 8, false);

    // Material (color by vector)
    const vectorColors: Record<string, number> = {
      ssh: 0x3b82f6,
      rdp: 0xa855f7,
      http: 0x22c55e,
      dns_amp: 0xf59e0b,
    };
    const color = vectorColors[vector] || 0x60a5fa;

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
    });

    const tube = new THREE.Mesh(tubeGeometry, material);

    // Generate mock arc data
    const arcData = ENABLE_MOCK_DATA
      ? generateMockArcData({ vector })
      : enhanceArcWithIntelligence(
          {
            id: `arc_${Date.now()}_${Math.random()}`,
            sourceCell: { cellId: 0, lat: from.lat, lon: from.lon },
            targetCell: { cellId: 0, lat: to.lat, lon: to.lon },
            vector,
            packets: 1000000,
            bandwidth: 2000000000,
            confidence: 0.85,
            firstSeen: new Date(),
            intensityHistory: [],
            hawkesParams: { mu: 0.2, beta: 0.5, nBr: 0.75, stability: 'unstable' },
            branchingHistory: [],
            networkDetails: {
              source: { lat: from.lat, lon: from.lon, asn: 'AS15169', network: '8.8.8.0/24', country: 'US' },
              target: { lat: to.lat, lon: to.lon, asn: 'AS212238', network: '185.220.101.0/24', country: 'UK' },
              portDistribution: { 22: 560 },
              packetTimeline: [],
            },
          },
          vector,
          'Russia',
          'Government'
        );

    // Attach data to mesh
    tube.userData = {
      type: 'arc',
      arcData,
      clickable: true,
    };

    return tube;
  };

  // Convert lat/lon to 3D vector
  const latLonToVector3 = (lat: number, lon: number, radius: number): THREE.Vector3 => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);

    return new THREE.Vector3(x, y, z);
  };

  // Handle arc clicks
  const handleArcClick = useCallback(
    async (event: MouseEvent) => {
      if (!mountRef.current || !cameraRef.current || !arcsGroupRef.current) return;

      // Prevent click if clicking on a panel
      const target = event.target as HTMLElement;
      if (target.closest('.arc-detail-panel') || target.closest('.hotspot-cell-panel')) {
        return;
      }

      const mouse = getMouseNDC(event, mountRef.current);
      const arcMeshes = arcsGroupRef.current.children.filter(
        (child) => child.userData.type === 'arc'
      );

      const hit = raycastArcs(mouse, cameraRef.current, arcMeshes);

      if (hit && hit.arc.userData.arcData) {
        const arcData = hit.arc.userData.arcData as ArcData;

        const position = calculatePanelPosition(
          event.clientX,
          event.clientY,
          600,
          500
        );

        setArcPanelPosition(position);
        setSelectedArc(arcData);
        setSelectedCell(null); // Close cell panel
      }
    },
    []
  );

  // Handle hotspot clicks
  const handleHotspotClick = useCallback(
    async (event: MouseEvent) => {
      if (!mountRef.current || !cameraRef.current || !globeRef.current) return;

      // Prevent click if clicking on a panel
      const target = event.target as HTMLElement;
      if (target.closest('.arc-detail-panel') || target.closest('.hotspot-cell-panel')) {
        return;
      }

      const mouse = getMouseNDC(event, mountRef.current);
      const hit = raycastGlobe(mouse, cameraRef.current, globeRef.current, GLOBE_RADIUS);

      if (hit) {
        const { lat, lon } = hit;
        const { cellId, cellLat, cellLon } = latLonToGridCell(lat, lon);

        setIsLoadingCell(true);

        try {
          let cellData: HotspotCellData | null = null;

          if (ENABLE_MOCK_DATA) {
            // Use mock data
            cellData = generateMockHotspotData({
              cellId,
              lat: cellLat,
              lon: cellLon,
              vector: 'ssh',
            });
          } else {
            // Fetch from backend
            cellData = await fetchCellHistory(cellId, 'ssh', 48, '/api/v1');
          }

          if (cellData) {
            const position = calculatePanelPosition(
              event.clientX,
              event.clientY,
              360,
              600
            );

            setCellPanelPosition(position);
            setSelectedCell(cellData);
            setSelectedArc(null); // Close arc panel
          }
        } catch (error) {
          console.error('Failed to fetch cell data:', error);
        } finally {
          setIsLoadingCell(false);
        }
      }
    },
    []
  );

  // Combined click handler
  const handleClick = useCallback(
    async (event: MouseEvent) => {
      // Try arc click first (arcs have higher priority)
      if (arcsGroupRef.current && arcsGroupRef.current.children.length > 0) {
        await handleArcClick(event);
      }

      // If no arc was clicked and we still don't have a selected arc, try hotspot
      if (!selectedArc) {
        await handleHotspotClick(event);
      }
    },
    [handleArcClick, handleHotspotClick, selectedArc]
  );

  // Attach click listener
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('click', handleClick);
    };
  }, [handleClick]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC to close panels
      if (event.key === 'Escape') {
        setSelectedArc(null);
        setSelectedCell(null);
      }

      // L to toggle live mode
      if (event.key === 'l' || event.key === 'L') {
        handleLiveToggle(!isLiveMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLiveMode]);

  // Temporal replay handlers
  const handleTimeChange = useCallback(async (timestamp: number) => {
    setCurrentTimestamp(timestamp);
    setIsLiveMode(false);

    if (ENABLE_MOCK_DATA) {
      console.log('Temporal replay - Mock mode - timestamp:', new Date(timestamp));
      return;
    }

    try {
      const response = await fetch(
        `/api/v1/snapshots?end=${Math.floor(timestamp / 1000)}&vector=ssh`
      );
      const data = await response.json();

      if (data.snapshots && data.snapshots.length > 0) {
        console.log('Loaded snapshot:', data.snapshots[data.snapshots.length - 1]);
        // Update globe visualization with historical data
      }
    } catch (error) {
      console.error('Failed to fetch snapshot:', error);
    }
  }, []);

  const handlePlaybackSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    console.log('Playback speed changed to:', speed);
  }, []);

  const handleLiveToggle = useCallback((isLive: boolean) => {
    setIsLiveMode(isLive);
    if (isLive) {
      setCurrentTimestamp(Date.now());
      console.log('Switched to LIVE mode');
    } else {
      console.log('Exited LIVE mode');
    }
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Three.js canvas mount point */}
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Arc Detail Panel */}
      {selectedArc && (
        <ArcDetailPanel
          arc={selectedArc}
          position={arcPanelPosition}
          onClose={() => setSelectedArc(null)}
        />
      )}

      {/* Hotspot Cell Panel */}
      {selectedCell && (
        <HotspotCellPanel
          cell={selectedCell}
          position={cellPanelPosition}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {/* Loading Indicator */}
      {isLoadingCell && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '24px 32px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            zIndex: 9999,
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          Loading cell data...
        </div>
      )}

      {/* Temporal Replay Controls */}
      <TemporalReplayControls
        onTimeChange={handleTimeChange}
        onPlaybackSpeedChange={handlePlaybackSpeedChange}
        onLiveToggle={handleLiveToggle}
        isLive={isLiveMode}
      />

      {/* Info Panel */}
      <div
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          background: 'rgba(10, 15, 25, 0.9)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '8px',
          padding: '16px',
          color: 'white',
          fontSize: '12px',
          zIndex: 1000,
          maxWidth: '300px',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '14px' }}>
          🌐 Cyber Weather MVP
        </div>
        <div style={{ color: '#8B92A4', marginBottom: '4px' }}>
          Click on <strong style={{ color: '#60A5FA' }}>arcs</strong> for attack details
        </div>
        <div style={{ color: '#8B92A4', marginBottom: '4px' }}>
          Click on <strong style={{ color: '#22C55E' }}>globe</strong> for cell history
        </div>
        <div style={{ color: '#8B92A4', marginBottom: '8px' }}>
          Press <strong>ESC</strong> to close panels
        </div>
        <div style={{ fontSize: '11px', color: '#6B7280', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', marginTop: '8px' }}>
          Mode: {ENABLE_MOCK_DATA ? '🧪 Mock Data' : '🔴 Live Backend'}
        </div>
      </div>
    </div>
  );
};

export default CyberWeatherGlobeIntegrated;
