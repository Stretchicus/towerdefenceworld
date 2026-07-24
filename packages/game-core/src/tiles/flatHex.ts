import type { Planet, PlanetCell, Vec3 } from "../types.js";

export type FlatHexCoord = { q: number; r: number };

const DIRS: FlatHexCoord[] = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
];

function coordKey(c: FlatHexCoord): string {
  return `${c.q},${c.r}`;
}

function axialToCenter(c: FlatHexCoord): Vec3 {
  const x = Math.sqrt(3) * (c.q + c.r / 2);
  const z = 1.5 * c.r;
  return { x, y: 0, z };
}

function hexVertices(center: Vec3, radius = 1): Vec3[] {
  const verts: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    verts.push({
      x: center.x + radius * Math.cos(angle),
      y: 0,
      z: center.z + radius * Math.sin(angle),
    });
  }
  return verts;
}

export function buildFlatHexPlanet(
  playable: FlatHexCoord[],
  opts?: { baseCoords?: FlatHexCoord[] },
): Planet {
  const idByKey = new Map<string, number>();
  for (let i = 0; i < playable.length; i++) {
    idByKey.set(coordKey(playable[i]!), i);
  }

  const boundaryId = playable.length;
  const cells: PlanetCell[] = playable.map((coord, id) => {
    const center = axialToCenter(coord);
    const neighbors = DIRS.map((d) => {
      const nKey = coordKey({ q: coord.q + d.q, r: coord.r + d.r });
      return idByKey.get(nKey) ?? boundaryId;
    });
    return {
      id,
      sides: 6,
      center,
      neighbors,
      vertices: hexVertices(center),
    };
  });

  const boundaryCenter = { x: 0, y: -100, z: 0 };
  cells.push({
    id: boundaryId,
    sides: 6,
    center: boundaryCenter,
    neighbors: [boundaryId, boundaryId, boundaryId, boundaryId, boundaryId, boundaryId],
    vertices: hexVertices(boundaryCenter),
  });

  const baseCellIds = (opts?.baseCoords ?? []).map((c) => {
    const id = idByKey.get(coordKey(c));
    if (id === undefined) {
      throw new Error(`base coord (${c.q},${c.r}) is not in playable set`);
    }
    return id;
  });

  return {
    size: "small",
    frequency: 1,
    cells,
    baseCellIds,
  };
}

/** Id of the shared off-map boundary cell appended after playable cells. */
export function flatHexBoundaryId(playableCount: number): number {
  return playableCount;
}
