import type { Planet, PlanetCell, Vec3, WorldSize } from "../types.js";

const PHI = (1 + Math.sqrt(5)) / 2;

export const WORLD_FREQUENCY: Record<WorldSize, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function scale(a: Vec3, s: number): Vec3 {
  return v3(a.x * s, a.y * s, a.z * s);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const L = len(a) || 1;
  return scale(a, 1 / L);
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return normalize(add(a, b));
}

function keyOf(p: Vec3, digits = 6): string {
  const f = 10 ** digits;
  return `${Math.round(p.x * f)},${Math.round(p.y * f)},${Math.round(p.z * f)}`;
}

function icosahedronVertices(): Vec3[] {
  const verts: Vec3[] = [];
  verts.push(normalize(v3(-1, PHI, 0)));
  verts.push(normalize(v3(1, PHI, 0)));
  verts.push(normalize(v3(-1, -PHI, 0)));
  verts.push(normalize(v3(1, -PHI, 0)));
  verts.push(normalize(v3(0, -1, PHI)));
  verts.push(normalize(v3(0, 1, PHI)));
  verts.push(normalize(v3(0, -1, -PHI)));
  verts.push(normalize(v3(0, 1, -PHI)));
  verts.push(normalize(v3(PHI, 0, -1)));
  verts.push(normalize(v3(PHI, 0, 1)));
  verts.push(normalize(v3(-PHI, 0, -1)));
  verts.push(normalize(v3(-PHI, 0, 1)));
  return verts;
}

/** Fixed icosahedron faces (indices into the 12 verts). */
function icosahedronFaces(): number[][] {
  return [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
}

function getOrAddVertex(
  map: Map<string, number>,
  list: Vec3[],
  p: Vec3,
): number {
  const k = keyOf(p);
  const existing = map.get(k);
  if (existing !== undefined) return existing;
  const id = list.length;
  map.set(k, id);
  list.push(p);
  return id;
}

/**
 * Build Goldberg dual cells from a frequency-f geodesic icosahedron.
 * Each mesh vertex becomes a cell; degree 5 → pentagon, degree 6 → hexagon.
 */
export function buildPlanet(size: WorldSize, seatCount: number): Planet {
  const frequency = WORLD_FREQUENCY[size];
  const baseVerts = icosahedronVertices();
  const baseFaces = icosahedronFaces();

  const verts: Vec3[] = [];
  const vertMap = new Map<string, number>();
  for (const p of baseVerts) getOrAddVertex(vertMap, verts, p);

  let faces = baseFaces.map((f) => [...f]);

  for (let f = 0; f < frequency; f++) {
    const next: number[][] = [];
    const midCache = new Map<string, number>();
    const edgeKey = (a: number, b: number) =>
      a < b ? `${a}:${b}` : `${b}:${a}`;

    for (const [a, b, c] of faces) {
      const mab =
        midCache.get(edgeKey(a, b)) ??
        (() => {
          const id = getOrAddVertex(vertMap, verts, mid(verts[a], verts[b]));
          midCache.set(edgeKey(a, b), id);
          return id;
        })();
      const mbc =
        midCache.get(edgeKey(b, c)) ??
        (() => {
          const id = getOrAddVertex(vertMap, verts, mid(verts[b], verts[c]));
          midCache.set(edgeKey(b, c), id);
          return id;
        })();
      const mca =
        midCache.get(edgeKey(c, a)) ??
        (() => {
          const id = getOrAddVertex(vertMap, verts, mid(verts[c], verts[a]));
          midCache.set(edgeKey(c, a), id);
          return id;
        })();
      next.push([a, mab, mca], [b, mbc, mab], [c, mca, mbc], [mab, mbc, mca]);
    }
    faces = next;
  }

  // Adjacency from triangular edges
  const adj = new Map<number, Set<number>>();
  const faceCentroids: { tri: number[]; c: Vec3 }[] = [];
  for (const tri of faces) {
    const [a, b, c] = tri;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u)!.add(v);
      adj.get(v)!.add(u);
    }
    const centroid = normalize(add(add(verts[a], verts[b]), verts[c]));
    faceCentroids.push({ tri, c: centroid });
  }

  // Faces incident on each vertex (for dual polygon order)
  const incident: Map<number, number[]> = new Map();
  faceCentroids.forEach((fc, fi) => {
    for (const vi of fc.tri) {
      if (!incident.has(vi)) incident.set(vi, []);
      incident.get(vi)!.push(fi);
    }
  });

  const cells: PlanetCell[] = [];
  for (let i = 0; i < verts.length; i++) {
    const neighbors = [...(adj.get(i) ?? [])];
    const sides = (neighbors.length === 5 ? 5 : 6) as 5 | 6;

    // Order dual vertices (face centroids) around cell center
    const faceIds = incident.get(i) ?? [];
    const centroids = faceIds.map((fi) => faceCentroids[fi]!.c);
    const ordered = orderAround(verts[i]!, centroids);

    // Order neighbors consistently with edge midpoints
    const orderedNeighbors = orderNeighbors(verts[i]!, neighbors, verts);

    cells.push({
      id: i,
      sides,
      center: verts[i],
      neighbors: orderedNeighbors,
      vertices: ordered,
    });
  }

  const baseCellIds = pickBaseCells(cells, seatCount);

  return { size, frequency, cells, baseCellIds };
}

function orderAround(center: Vec3, points: Vec3[]): Vec3[] {
  if (points.length <= 1) return points;
  const ref = orthonormalBasis(center);
  return [...points].sort((a, b) => {
    const aa = angleInPlane(center, ref, a);
    const bb = angleInPlane(center, ref, b);
    return aa - bb;
  });
}

function orderNeighbors(
  center: Vec3,
  neighborIds: number[],
  verts: Vec3[],
): number[] {
  const ref = orthonormalBasis(center);
  return [...neighborIds].sort((ia, ib) => {
    const aa = angleInPlane(center, ref, verts[ia]);
    const bb = angleInPlane(center, ref, verts[ib]);
    return aa - bb;
  });
}

function orthonormalBasis(n: Vec3): { t: Vec3; b: Vec3 } {
  const nn = normalize(n);
  const tmp =
    Math.abs(nn.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const t = normalize(cross(tmp, nn));
  const b = cross(nn, t);
  return { t, b };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return v3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function angleInPlane(
  center: Vec3,
  basis: { t: Vec3; b: Vec3 },
  p: Vec3,
): number {
  const d = sub(p, center);
  const x = d.x * basis.t.x + d.y * basis.t.y + d.z * basis.t.z;
  const y = d.x * basis.b.x + d.y * basis.b.y + d.z * basis.b.z;
  return Math.atan2(y, x);
}

function pickBaseCells(cells: PlanetCell[], seatCount: number): number[] {
  const n = Math.max(2, Math.min(4, seatCount));
  // Bases sit on pentagons only (12 available on a Goldberg sphere)
  const pool = cells.filter((c) => c.sides === 5);
  const from = pool.length >= n ? pool : cells;
  const start = from.reduce(
    (best, c) => (c.center.y > best.center.y ? c : best),
    from[0]!,
  );
  const picked: number[] = [start.id];
  while (picked.length < n) {
    let bestId = -1;
    let bestMin = -1;
    for (const c of from) {
      if (picked.includes(c.id)) continue;
      let minD = Infinity;
      for (const pid of picked) {
        const d = dist(c.center, cells[pid]!.center);
        if (d < minD) minD = d;
      }
      if (minD > bestMin) {
        bestMin = minD;
        bestId = c.id;
      }
    }
    if (bestId < 0) break;
    picked.push(bestId);
  }
  return picked;
}

function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

export function cellById(planet: Planet, id: number): PlanetCell {
  return planet.cells[id];
}
