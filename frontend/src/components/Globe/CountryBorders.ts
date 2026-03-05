import * as THREE from 'three';

function ll2v(lat: number, lon: number, R: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -R * Math.sin(phi) * Math.cos(theta),
    R * Math.cos(phi),
    R * Math.sin(phi) * Math.sin(theta)
  );
}

function ringToPoints(ring: number[][], R: number): THREE.Vector3[] {
  return ring.map(coord => ll2v(coord[1], coord[0], R));
}

export async function addCountryBorders(scene: THREE.Scene, R: number): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'countryBorders';

  try {
    const resp = await fetch('/countries-110m.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geo = await resp.json();

    const borderMat = new THREE.LineBasicMaterial({
      color: 0x1a6090,
      transparent: true,
      opacity: 0.4,
    });

    const borderR = R * 1.0018;

    for (const feature of geo.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      let polygons: number[][][][] = [];
      if (geom.type === 'Polygon') {
        polygons = [geom.coordinates];
      } else if (geom.type === 'MultiPolygon') {
        polygons = geom.coordinates;
      } else {
        continue;
      }

      for (const polygon of polygons) {
        const ring = polygon[0];
        if (!ring || ring.length < 3) continue;

        const points = ringToPoints(ring, borderR);
        const subdivided: THREE.Vector3[] = [];

        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i];
          const b = points[i + 1];
          subdivided.push(a);
          const dist = a.distanceTo(b);
          if (dist > 0.05) {
            const steps = Math.ceil(dist / 0.03);
            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              const mid = new THREE.Vector3().lerpVectors(a, b, t);
              mid.normalize().multiplyScalar(borderR);
              subdivided.push(mid);
            }
          }
        }
        subdivided.push(points[points.length - 1]);

        const lineGeo = new THREE.BufferGeometry().setFromPoints(subdivided);
        group.add(new THREE.Line(lineGeo, borderMat));
      }
    }

    scene.add(group);
    console.log(`[CountryBorders] Loaded ${geo.features.length} countries`);
  } catch (err) {
    console.warn('[CountryBorders] Failed to load:', err);
  }

  return group;
}
