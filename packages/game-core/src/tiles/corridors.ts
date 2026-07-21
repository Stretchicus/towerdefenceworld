import type { Planet, PlanetCell, TileDef } from "../types.js";
import { makeTile, rotateConnections } from "./bag.js";
import { createPlacementState, type PlacementState } from "./placement.js";

export interface CorridorNetwork {
  /** All cells that belong to at least one pairwise base path */
  cellIds: Set<number>;
  /** For each corridor cell: which neighbor edges must be open */
  requiredOpen: Map<number, boolean[]>;
  /** Shortest path cell lists for each unordered base pair */
  pairPaths: { a: number; b: number; cells: number[] }[];
}

function shortestPath(planet: Planet, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const n of planet.cells[cur]!.neighbors) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  let c: number | null = to;
  while (c !== null) {
    path.push(c);
    c = prev.get(c) ?? null;
  }
  path.reverse();
  return path;
}

/**
 * Build a shared corridor network: one shortest path per base pair.
 * Paths may share cells/edges — no random dead-end branches.
 */
export function buildCorridorNetwork(
  planet: Planet,
  baseIds: number[],
): CorridorNetwork {
  const pairPaths: CorridorNetwork["pairPaths"] = [];
  const cellIds = new Set<number>();
  const edgeSet = new Set<string>();

  for (let i = 0; i < baseIds.length; i++) {
    for (let j = i + 1; j < baseIds.length; j++) {
      const a = baseIds[i]!;
      const b = baseIds[j]!;
      const path = shortestPath(planet, a, b);
      if (!path || path.length < 2) continue;
      pairPaths.push({ a, b, cells: path });
      for (const id of path) cellIds.add(id);
      for (let k = 0; k < path.length - 1; k++) {
        const u = path[k]!;
        const v = path[k + 1]!;
        edgeSet.add(u < v ? `${u}:${v}` : `${v}:${u}`);
      }
    }
  }

  const requiredOpen = new Map<number, boolean[]>();
  for (const id of cellIds) {
    const cell = planet.cells[id]!;
    const opens = Array<boolean>(cell.sides).fill(false);
    for (let e = 0; e < cell.neighbors.length; e++) {
      const n = cell.neighbors[e]!;
      const key = id < n ? `${id}:${n}` : `${n}:${id}`;
      if (edgeSet.has(key)) opens[e] = true;
    }
    requiredOpen.set(id, opens);
  }

  return { cellIds, requiredOpen, pairPaths };
}

function tileFromMask(
  cell: PlanetCell,
  opens: boolean[],
  extras: { hasTowerPoint: boolean; hasMine: boolean },
): { tile: TileDef; rotation: number } {
  const openCount = opens.filter(Boolean).length;
  const routeKind = openCount <= 2 ? "single" : "branch";
  const pattern = [...opens];
  while (pattern.length < 6) pattern.push(false);
  const tile = makeTile(`corridor-${cell.id}`, pattern, {
    routeKind,
    hasTowerPoint: extras.hasTowerPoint,
    hasMine: extras.hasMine,
    mineTypeId: extras.hasMine ? "basic" : undefined,
  });
  return { tile, rotation: 0 };
}

/**
 * Fill every corridor cell with exact connection masks —
 * pairwise routes without dead ends.
 */
export function fillCorridorPlacement(
  state: PlacementState,
  network: CorridorNetwork,
  opts: { towerPointChance: number; mineChance: number; rng: () => number },
): void {
  for (const baseId of state.baseCellIds) {
    const opens = network.requiredOpen.get(baseId);
    const cell = state.planet.cells[baseId]!;
    if (!opens) continue;
    const placed = state.placed.get(baseId);
    if (placed) {
      placed.connections = opens.slice(0, cell.sides);
      placed.tile.connections = [...opens];
      while (placed.tile.connections.length < 6) placed.tile.connections.push(false);
    }
  }

  for (const cellId of network.cellIds) {
    if (state.baseCellIds.includes(cellId)) continue;
    if (state.placed.has(cellId)) continue;
    const cell = state.planet.cells[cellId]!;
    const opens = network.requiredOpen.get(cellId);
    if (!opens) continue;
    const { tile, rotation } = tileFromMask(cell, opens, {
      hasTowerPoint: opts.rng() < opts.towerPointChance,
      hasMine: opts.rng() < opts.mineChance,
    });
    state.placed.set(cellId, {
      cellId,
      tile,
      rotation,
      connections: opens.slice(0, cell.sides),
    });
  }
}

export function matchRequiredRotation(
  tile: TileDef,
  cell: PlanetCell,
  required: boolean[],
): number | null {
  for (let r = 0; r < cell.sides; r++) {
    const connections = rotateConnections(tile.connections, cell.sides, r);
    let ok = true;
    for (let i = 0; i < cell.sides; i++) {
      if ((connections[i] ?? false) !== (required[i] ?? false)) {
        ok = false;
        break;
      }
    }
    if (ok) return r;
  }
  return null;
}

export function isLegalCorridorPlacement(
  state: PlacementState,
  network: CorridorNetwork,
  cellId: number,
  tile: TileDef,
  rotation: number,
): boolean {
  if (!network.cellIds.has(cellId)) return false;
  if (state.placed.has(cellId)) return false;
  if (state.baseCellIds.includes(cellId)) return false;
  const required = network.requiredOpen.get(cellId);
  const cell = state.planet.cells[cellId];
  if (!required || !cell) return false;

  const connections = rotateConnections(tile.connections, cell.sides, rotation);
  for (let i = 0; i < cell.sides; i++) {
    if ((connections[i] ?? false) !== (required[i] ?? false)) return false;
  }
  let touches = false;
  for (let i = 0; i < cell.neighbors.length; i++) {
    if (!(required[i] ?? false)) continue;
    const nid = cell.neighbors[i]!;
    if (state.placed.has(nid)) touches = true;
  }
  return touches;
}

export function findLegalCorridorPlacements(
  state: PlacementState,
  network: CorridorNetwork,
  tile: TileDef,
): { cellId: number; rotation: number }[] {
  const out: { cellId: number; rotation: number }[] = [];
  for (const cellId of network.cellIds) {
    const cell = state.planet.cells[cellId]!;
    for (let r = 0; r < cell.sides; r++) {
      if (isLegalCorridorPlacement(state, network, cellId, tile, r)) {
        out.push({ cellId, rotation: r });
      }
    }
  }
  return out;
}

export function generateCorridorBag(
  network: CorridorNetwork,
  planet: Planet,
  baseIds: number[],
  opts: { towerPointChance: number; mineChance: number; rng: () => number },
): TileDef[] {
  const bag: TileDef[] = [];
  for (const cellId of network.cellIds) {
    if (baseIds.includes(cellId)) continue;
    const cell = planet.cells[cellId]!;
    const opens = network.requiredOpen.get(cellId)!;
    const { tile } = tileFromMask(cell, opens, {
      hasTowerPoint: opts.rng() < opts.towerPointChance,
      hasMine: opts.rng() < opts.mineChance,
    });
    bag.push(tile);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(opts.rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return bag;
}

export function createCorridorPlacementState(planet: Planet): {
  placement: PlacementState;
  network: CorridorNetwork;
} {
  const placement = createPlacementState(planet);
  const network = buildCorridorNetwork(planet, planet.baseCellIds);
  return { placement, network };
}
