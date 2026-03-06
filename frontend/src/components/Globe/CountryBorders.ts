import * as THREE from 'three';

// ─── Coordinate Conversion ──────────────────────────────────────────────────
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

// ─── Ear-clip Triangulation ─────────────────────────────────────────────────
// Lightweight earcut for polygon triangulation on the sphere surface.
// Works on projected 2D coordinates (lat/lon) then maps triangles to 3D.

function earcut2D(coords: number[][]): number[] {
  // Convert to flat array [x0,y0, x1,y1, ...]
  const flat: number[] = [];
  for (const c of coords) {
    flat.push(c[0], c[1]);
  }
  return earcutFlat(flat, 2);
}

function earcutFlat(data: number[], dim: number): number[] {
  const n = data.length / dim;
  if (n < 3) return [];

  const indices: number[] = [];
  const verts: number[] = [];
  for (let i = 0; i < n; i++) verts.push(i);

  // Ensure correct winding (CCW)
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (data[j * dim] - data[i * dim]) * (data[j * dim + 1] + data[i * dim + 1]);
  }
  if (area > 0) verts.reverse();

  let remaining = [...verts];
  let safety = remaining.length * 3;

  while (remaining.length > 2 && safety-- > 0) {
    let earFound = false;
    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length];
      const curr = remaining[i];
      const next = remaining[(i + 1) % remaining.length];

      const ax = data[prev * dim], ay = data[prev * dim + 1];
      const bx = data[curr * dim], by = data[curr * dim + 1];
      const cx = data[next * dim], cy = data[next * dim + 1];

      // Check if this is a convex vertex (ear tip)
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cross <= 0) continue; // concave, skip

      // Check no other vertex is inside this triangle
      let inside = false;
      for (let j = 0; j < remaining.length; j++) {
        if (j === (i - 1 + remaining.length) % remaining.length || j === i || j === (i + 1) % remaining.length) continue;
        const v = remaining[j];
        const px = data[v * dim], py = data[v * dim + 1];
        if (pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;

      // Valid ear — clip it
      indices.push(prev, curr, next);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) {
      // Fallback: force-clip to avoid infinite loop
      if (remaining.length >= 3) {
        indices.push(remaining[0], remaining[1], remaining[2]);
        remaining.splice(1, 1);
      } else {
        break;
      }
    }
  }

  return indices;
}

function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

// ─── Subdivision for sphere surface ─────────────────────────────────────────
function subdivideSegment(a: THREE.Vector3, b: THREE.Vector3, R: number, maxDist = 0.05): THREE.Vector3[] {
  const result: THREE.Vector3[] = [a];
  const dist = a.distanceTo(b);
  if (dist > maxDist) {
    const steps = Math.ceil(dist / (maxDist * 0.8));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const mid = new THREE.Vector3().lerpVectors(a, b, t);
      mid.normalize().multiplyScalar(R);
      result.push(mid);
    }
  }
  return result;
}

// ─── Build filled land polygon mesh for a single ring ───────────────────────
function buildFilledRing(ring: number[][], R: number): THREE.BufferGeometry | null {
  if (ring.length < 4) return null; // need at least 3 unique points + closing

  // Triangulate in 2D (lat/lon space)
  const triIndices = earcut2D(ring);
  if (triIndices.length < 3) return null;

  // Convert each triangle to 3D sphere positions with subdivision
  const positions: number[] = [];

  for (let i = 0; i < triIndices.length; i += 3) {
    const i0 = triIndices[i];
    const i1 = triIndices[i + 1];
    const i2 = triIndices[i + 2];

    if (i0 >= ring.length || i1 >= ring.length || i2 >= ring.length) continue;

    const v0 = ll2v(ring[i0][1], ring[i0][0], R);
    const v1 = ll2v(ring[i1][1], ring[i1][0], R);
    const v2 = ll2v(ring[i2][1], ring[i2][0], R);

    positions.push(v0.x, v0.y, v0.z);
    positions.push(v1.x, v1.y, v1.z);
    positions.push(v2.x, v2.y, v2.z);
  }

  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// ─── ISO → country name mapping for hit detection ───────────────────────────
const countryNameCache = new Map<string, string>();

// ─── Main: Add country topology to scene ────────────────────────────────────

export interface CountryTopologyResult {
  group: THREE.Group;
  bordersGroup: THREE.Group;
  landGroup: THREE.Group;
  countryMeshes: Map<string, THREE.Mesh[]>;
}

export async function addCountryBorders(
  scene: THREE.Scene,
  R: number,
  options?: {
    showFill?: boolean;
    showBorders?: boolean;
    fillColor?: number;
    fillOpacity?: number;
    borderColor?: number;
    borderOpacity?: number;
  }
): Promise<CountryTopologyResult> {
  const opts = {
    showFill: true,
    showBorders: true,
    fillColor: 0x0f2a4a,
    fillOpacity: 0.55,
    borderColor: 0x1a6090,
    borderOpacity: 0.45,
    ...options,
  };

  const group = new THREE.Group();
  group.name = 'countryTopology';

  const bordersGroup = new THREE.Group();
  bordersGroup.name = 'countryBorders';

  const landGroup = new THREE.Group();
  landGroup.name = 'countryLand';

  const countryMeshes = new Map<string, THREE.Mesh[]>();

  try {
    // Try 50m first, fall back to 110m
    let geo: any = null;
    for (const url of ['/countries-50m.json', '/countries-110m.json']) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          geo = await resp.json();
          console.log(`[CountryTopology] Loaded ${url} (${geo.features.length} features)`);
          break;
        }
      } catch { /* try next */ }
    }

    if (!geo) throw new Error('No country data available');

    // ─── Border material ──────────────────────────────
    const borderMat = new THREE.LineBasicMaterial({
      color: opts.borderColor,
      transparent: true,
      opacity: opts.borderOpacity,
    });

    // ─── Land fill material ───────────────────────────
    const landMat = new THREE.MeshBasicMaterial({
      color: opts.fillColor,
      transparent: true,
      opacity: opts.fillOpacity,
      side: THREE.FrontSide,
      depthWrite: false,
    });

    const borderR = R * 1.0015;
    const fillR = R * 1.001;

    let totalBorderLines = 0;
    let totalFillTris = 0;

    for (const feature of geo.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      const iso = feature.properties?.ISO_A2 || feature.properties?.ADM0_A3 || '';
      const name = feature.properties?.NAME || '';
      if (name) countryNameCache.set(iso, name);

      let polygons: number[][][][] = [];
      if (geom.type === 'Polygon') {
        polygons = [geom.coordinates];
      } else if (geom.type === 'MultiPolygon') {
        polygons = geom.coordinates;
      } else {
        continue;
      }

      const meshesForCountry: THREE.Mesh[] = [];

      for (const polygon of polygons) {
        const outerRing = polygon[0];
        if (!outerRing || outerRing.length < 3) continue;

        // ─── Border lines ───────────────────────────
        if (opts.showBorders) {
          const points = ringToPoints(outerRing, borderR);
          const subdivided: THREE.Vector3[] = [];

          for (let i = 0; i < points.length - 1; i++) {
            const segs = subdivideSegment(points[i], points[i + 1], borderR);
            subdivided.push(...segs);
          }
          subdivided.push(points[points.length - 1]);

          const lineGeo = new THREE.BufferGeometry().setFromPoints(subdivided);
          bordersGroup.add(new THREE.Line(lineGeo, borderMat));
          totalBorderLines++;
        }

        // ─── Filled land polygon ────────────────────
        if (opts.showFill) {
          const fillGeo = buildFilledRing(outerRing, fillR);
          if (fillGeo) {
            const mesh = new THREE.Mesh(fillGeo, landMat);
            mesh.userData = { type: 'country', iso, name };
            landGroup.add(mesh);
            meshesForCountry.push(mesh);
            totalFillTris += fillGeo.getAttribute('position').count / 3;
          }
        }
      }

      if (meshesForCountry.length > 0) {
        countryMeshes.set(iso, meshesForCountry);
      }
    }

    group.add(landGroup);
    group.add(bordersGroup);
    scene.add(group);

    console.log(`[CountryTopology] ${totalBorderLines} border lines, ${totalFillTris} fill triangles`);

  } catch (err) {
    console.warn('[CountryTopology] Failed to load:', err);
  }

  return { group, bordersGroup, landGroup, countryMeshes };
}

// ─── Utility: Get country name from ISO code ────────────────────────────────
export function getCountryName(iso: string): string {
  return countryNameCache.get(iso) || iso;
}
