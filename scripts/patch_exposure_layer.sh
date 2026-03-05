#!/bin/bash
# ============================================================
#  Add Shodan Exposure Layer to Globe
#  Renders exposed infrastructure as hollow amber diamonds
#  distinct from solid attack hotspot dots
# ============================================================
set -e

GLOBE="frontend/src/components/CyberWeatherGlobe.tsx"

echo "============================================================"
echo "  Adding Shodan Exposure Layer"
echo "============================================================"

# ─── 1. Add state variables ───
# Find showFeedStatus state and add exposure state after it
if grep -q "showExposure" "$GLOBE"; then
    echo "  ⊘ Exposure state already exists"
else
    sed -i '/const \[showFeedStatus/a\  const [showExposure, setShowExposure] = useState(true);\n  const [exposureData, setExposureData] = useState<any[]>([]);\n  const exposureGroupRef = useRef<THREE.Group | null>(null);' "$GLOBE"
    echo "  ✓ Added showExposure state + ref"
fi

# ─── 2. Add exposure data fetch ───
# Add a useEffect to fetch exposure geo data
if grep -q "exposure/geo" "$GLOBE"; then
    echo "  ⊘ Exposure fetch already exists"
else
    # Insert after the main data fetch useEffect (the one with fetchThreatData)
    FETCH_LINE=$(grep -n "fetchThreatData().then(setData)" "$GLOBE" | head -1 | cut -d: -f1)
    if [ -n "$FETCH_LINE" ]; then
        sed -i "${FETCH_LINE}a\\
\\
    // Fetch Shodan exposure data for globe layer\\
    async function fetchExposureGeo() {\\
      try {\\
        const res = await fetch('/v1/exposure/geo');\\
        if (res.ok) {\\
          const geo = await res.json();\\
          const features = geo.features || [];\\
          setExposureData(features.map((f: any) => ({\\
            lat: f.geometry.coordinates[1],\\
            lon: f.geometry.coordinates[0],\\
            query: f.properties.query || '',\\
            port: f.properties.port || 0,\\
            product: f.properties.product || '',\\
            org: f.properties.org || '',\\
            country: f.properties.country || '',\\
          })));\\
        }\\
      } catch {}\\
    }\\
    fetchExposureGeo();\\
    const exposureInterval = setInterval(fetchExposureGeo, 300000); // 5 min\\
    return () => clearInterval(exposureInterval);" "$GLOBE"
        echo "  ✓ Added exposure geo fetch"
    else
        echo "  ✗ Could not find fetch insertion point"
    fi
fi

# ─── 3. Add exposure rendering useEffect ───
if grep -q "exposureGroupRef.current" "$GLOBE"; then
    echo "  ⊘ Exposure rendering already exists"
else
    # Find the closing of the hotspot useEffect and add after it
    # We'll add before the country detail useEffect
    COUNTRY_LINE=$(grep -n "top-countries" "$GLOBE" | head -1 | cut -d: -f1)
    if [ -n "$COUNTRY_LINE" ]; then
        COUNTRY_LINE=$((COUNTRY_LINE - 5))
        sed -i "${COUNTRY_LINE}i\\
\\
  // ─── EXPOSURE LAYER RENDERING ───\\
  useEffect(() => {\\
    const scene = sceneRef.current;\\
    if (!scene) return;\\
    // Remove old exposure markers\\
    if (exposureGroupRef.current) {\\
      if (globeRef.current) globeRef.current.remove(exposureGroupRef.current);\\
      else scene.remove(exposureGroupRef.current);\\
      exposureGroupRef.current.traverse((obj: any) => {\\
        if (obj.geometry) obj.geometry.dispose();\\
        if (obj.material) obj.material.dispose();\\
      });\\
      exposureGroupRef.current = null;\\
    }\\
    if (!showExposure || exposureData.length === 0) return;\\
    const R = 1;\\
    const expGroup = new THREE.Group();\\
    exposureGroupRef.current = expGroup;\\
    // Color by query type\\
    const EXPOSURE_COLORS: Record<string, number> = {\\
      rdp_open: 0xff6600,\\
      smb_exposed: 0xff9900,\\
      ssh_password: 0xffcc00,\\
      telnet_open: 0xff4400,\\
      vnc_open: 0xffaa00,\\
      database_exposed: 0xff3333,\\
      printer_exposed: 0xccaa00,\\
      webcam_exposed: 0xcc6600,\\
      scada_exposed: 0xff0000,\\
      gov_exposed: 0x00aaff,\\
      edu_exposed: 0x00ccff,\\
      healthcare_exposed: 0x00ff88,\\
      k12_exposed: 0x00ddff,\\
      vpn_exposed: 0xaa66ff,\\
      default: 0xffaa00,\\
    };\\
    // Deduplicate by grid cell to avoid overcrowding\\
    const cellMap = new Map<string, { lat: number; lon: number; count: number; query: string }>();\\
    exposureData.forEach((pt: any) => {\\
      const key = \`\${Math.round(pt.lat / 2) * 2}_\${Math.round(pt.lon / 2) * 2}\`;\\
      if (cellMap.has(key)) {\\
        cellMap.get(key)!.count++;\\
      } else {\\
        cellMap.set(key, { lat: pt.lat, lon: pt.lon, count: 1, query: pt.query });\\
      }\\
    });\\
    cellMap.forEach((cell) => {\\
      const v = latLonToVec3(cell.lat, cell.lon, R * 1.004);\\
      const colorHex = EXPOSURE_COLORS[cell.query] || EXPOSURE_COLORS.default;\\
      const col = new THREE.Color(colorHex);\\
      const size = Math.min(0.018, 0.008 + cell.count * 0.001);\\
      // Hollow ring marker (no filled dot — distinguishes from attack hotspots)\\
      const ringGeo = new THREE.RingGeometry(size * 0.6, size, 4); // 4 segments = diamond shape\\
      const ringMat = new THREE.MeshBasicMaterial({\\
        color: col,\\
        transparent: true,\\
        opacity: 0.55,\\
        side: THREE.DoubleSide,\\
      });\\
      const ring = new THREE.Mesh(ringGeo, ringMat);\\
      ring.position.copy(v);\\
      ring.lookAt(new THREE.Vector3(0, 0, 0));\\
      expGroup.add(ring);\\
      // Outer glow ring\\
      const glowGeo = new THREE.RingGeometry(size, size * 1.3, 4);\\
      const glowMat = new THREE.MeshBasicMaterial({\\
        color: col,\\
        transparent: true,\\
        opacity: 0.15,\\
        side: THREE.DoubleSide,\\
      });\\
      const glow = new THREE.Mesh(glowGeo, glowMat);\\
      glow.position.copy(v);\\
      glow.lookAt(new THREE.Vector3(0, 0, 0));\\
      expGroup.add(glow);\\
    });\\
    if (globeRef.current) globeRef.current.add(expGroup);\\
    else scene.add(expGroup);\\
  }, [exposureData, showExposure]);" "$GLOBE"
        echo "  ✓ Added exposure rendering useEffect"
    else
        echo "  ✗ Could not find insertion point for rendering"
    fi
fi

# ─── 4. Add toggle button ───
if grep -q "EXPOSURE LAYER" "$GLOBE"; then
    echo "  ⊘ Exposure toggle already exists"
else
    # Add after the TEMPORAL CONTROLS button
    sed -i '/TEMPORAL CONTROLS<\/button>/a\
          <button\
            onClick={() => setShowExposure((v) => !v)}\
            style={{\
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",\
              padding: "7px 0", borderRadius: "6px",\
              background: showExposure ? "rgba(255,170,0,0.15)" : "rgba(8,18,38,0.9)",\
              border: `1px solid ${showExposure ? "rgba(255,170,0,0.5)" : "rgba(255,170,0,0.15)"}`,\
              cursor: "pointer", transition: "all 0.15s", backdropFilter: "blur(12px)",\
              fontFamily: "'"'"'JetBrains Mono'"'"', monospace", fontSize: "10px", fontWeight: 700,\
              color: showExposure ? "#ffaa00" : "rgba(255,170,0,0.6)", letterSpacing: "0.08em",\
            }}\
          >🔍 EXPOSURE LAYER</button>' "$GLOBE"
    echo "  ✓ Added exposure toggle button"
fi

echo ""
echo "  Verify:"
grep -c "showExposure\|exposureData\|exposureGroupRef\|EXPOSURE" "$GLOBE"
echo "  references found"
echo ""
echo "  Rebuild:"
echo "    docker compose build --no-cache frontend && docker compose up -d frontend"
echo "============================================================"
