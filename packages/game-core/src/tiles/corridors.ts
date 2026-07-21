import type { Planet, PlanetCell, TileDef } from "../types.js";
import { makeTile, rotateConnections } from "./bag.js";
import { createPlacementState, type PlacementState } from "./placement.js";

export interface CorridorNetwork {
  /** All cells that belong to at least one pairwise base path */
  cellIds: Set<number>;
  /** For each corridor cell: which neighbor edges must be open */
  requiredOpen: Map<number, boolean[]>;
  /** Path cell lists for each unordered base pair */
  pairPaths: { a: number; b: number; cells: number[] }[];
}

export interface CorridorBuildOpts {
  rng?: () => number;
  /** Fraction of all planet cells that should lie on corridors (default 0.75) */
  fillFraction?: number;
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

function edgeKey(u: number, v: number): string {
  return u < v ? `${u}:${v}` : `${v}:${u}`;
}

function parseEdge(key: string): [number, number] {
  const [a, b] = key.split(":").map(Number);
  return [a!, b!];
}

function rebuildRequiredOpen(
  planet: Planet,
  cellIds: Set<number>,
  edgeSet: Set<string>,
): Map<number, boolean[]> {
  const requiredOpen = new Map<number, boolean[]>();
  for (const id of cellIds) {
    const cell = planet.cells[id]!;
    const opens = Array<boolean>(cell.sides).fill(false);
    for (let e = 0; e < cell.neighbors.length; e++) {
      const n = cell.neighbors[e]!;
      if (edgeSet.has(edgeKey(id, n))) opens[e] = true;
    }
    requiredOpen.set(id, opens);
  }
  return requiredOpen;
}

/**
 * Lengthen corridors by replacing an edge u—v with u—n—v when n completes
 * a triangle. Prefer unused cells so the network meanders and fills.
 */
function expandWithDetours(
  planet: Planet,
  cellIds: Set<number>,
  edgeSet: Set<string>,
  targetSize: number,
  rng: () => number,
): void {
  let guard = 0;
  const maxGuard = Math.max(200, targetSize * 40);
  while (cellIds.size < targetSize && guard++ < maxGuard) {
    const candidates: { key: string; u: number; v: number; n: number }[] = [];
    for (const key of edgeSet) {
      const [u, v] = parseEdge(key);
      const uNeigh = planet.cells[u]!.neighbors;
      for (const n of uNeigh) {
        if (n === v) continue;
        if (!planet.cells[v]!.neighbors.includes(n)) continue;
        candidates.push({ key, u, v, n });
      }
    }
    if (!candidates.length) break;
    const fresh = candidates.filter((c) => !cellIds.has(c.n));
    const pool = fresh.length ? fresh : candidates;
    const pick = pool[Math.floor(rng() * pool.length)]!;
    edgeSet.delete(pick.key);
    edgeSet.add(edgeKey(pick.u, pick.n));
    edgeSet.add(edgeKey(pick.v, pick.n));
    cellIds.add(pick.n);
  }
}

/**
 * Recompute pairwise paths on the corridor graph after detours.
 */
function recomputePairPaths(
  planet: Planet,
  baseIds: number[],
  edgeSet: Set<string>,
  cellIds: Set<number>,
): CorridorNetwork["pairPaths"] {
  const adj = new Map<number, number[]>();
  for (const id of cellIds) adj.set(id, []);
  for (const key of edgeSet) {
    const [u, v] = parseEdge(key);
    adj.get(u)?.push(v);
    adj.get(v)?.push(u);
  }

  const pairPaths: CorridorNetwork["pairPaths"] = [];
  for (let i = 0; i < baseIds.length; i++) {
    for (let j = i + 1; j < baseIds.length; j++) {
      const a = baseIds[i]!;
      const b = baseIds[j]!;
      const prev = new Map<number, number | null>([[a, null]]);
      const q = [a];
      while (q.length) {
        const cur = q.shift()!;
        if (cur === b) break;
        for (const n of adj.get(cur) ?? []) {
          if (prev.has(n)) continue;
          prev.set(n, cur);
          q.push(n);
        }
      }
      if (!prev.has(b)) {
        const path = shortestPath(planet, a, b);
        if (path) pairPaths.push({ a, b, cells: path });
        continue;
      }
      const cells: number[] = [];
      let c: number | null = b;
      while (c !== null) {
        cells.push(c);
        c = prev.get(c) ?? null;
      }
      cells.reverse();
      pairPaths.push({ a, b, cells });
    }
  }
  return pairPaths;
}

/**
 * Build a shared corridor network: one route per base pair, optionally
 * expanded with triangle detours until ~fillFraction of the planet is used.
 * Paths may share cells/edges — no random dead-end branches.
 */
export function buildCorridorNetwork(
  planet: Planet,
  baseIds: number[],
  opts: CorridorBuildOpts = {},
): CorridorNetwork {
  const rng = opts.rng ?? (() => 0.5);
  const fillFraction = opts.fillFraction ?? 0.75;
  const cellIds = new Set<number>();
  const edgeSet = new Set<string>();

  for (let i = 0; i < baseIds.length; i++) {
    for (let j = i + 1; j < baseIds.length; j++) {
      const a = baseIds[i]!;
      const b = baseIds[j]!;
      const path = shortestPath(planet, a, b);
      if (!path || path.length < 2) continue;
      for (const id of path) cellIds.add(id);
      for (let k = 0; k < path.length - 1; k++) {
        edgeSet.add(edgeKey(path[k]!, path[k + 1]!));
      }
    }
  }

  const targetSize = Math.max(
    cellIds.size,
    Math.floor(planet.cells.length * fillFraction),
  );
  expandWithDetours(planet, cellIds, edgeSet, targetSize, rng);

  const pairPaths = recomputePairPaths(planet, baseIds, edgeSet, cellIds);
  for (const p of pairPaths) {
    for (const id of p.cells) cellIds.add(id);
    for (let k = 0; k < p.cells.length - 1; k++) {
      edgeSet.add(edgeKey(p.cells[k]!, p.cells[k + 1]!));
    }
  }

  const requiredOpen = rebuildRequiredOpen(planet, cellIds, edgeSet);
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

export interface CorridorFillOpts {
  towerPointChance: number;
  mineChance: number;
  minTowerPoints?: number;
  rng: () => number;
}

function assignTowerFlags(
  candidates: number[],
  opts: CorridorFillOpts,
): Map<number, boolean> {
  const flags = new Map<number, boolean>();
  for (const id of candidates) {
    flags.set(id, opts.rng() < opts.towerPointChance);
  }
  const min = Math.min(opts.minTowerPoints ?? 5, candidates.length);
  let count = [...flags.values()].filter(Boolean).length;
  if (count >= min || candidates.length === 0) return flags;

  const lacking = [...candidates].filter((id) => !flags.get(id));
  for (let i = lacking.length - 1; i > 0; i--) {
    const j = Math.floor(opts.rng() * (i + 1));
    [lacking[i], lacking[j]] = [lacking[j]!, lacking[i]!];
  }
  for (const id of lacking) {
    if (count >= min) break;
    flags.set(id, true);
    count++;
  }
  return flags;
}

/**
 * Fill every corridor cell with exact connection masks —
 * pairwise routes without dead ends.
 */
export function fillCorridorPlacement(
  state: PlacementState,
  network: CorridorNetwork,
  opts: CorridorFillOpts,
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

  const nonBase = [...network.cellIds].filter(
    (id) => !state.baseCellIds.includes(id),
  );
  const towerFlags = assignTowerFlags(nonBase, opts);

  for (const cellId of network.cellIds) {
    if (state.baseCellIds.includes(cellId)) continue;
    if (state.placed.has(cellId)) continue;
    const cell = state.planet.cells[cellId]!;
    const opens = network.requiredOpen.get(cellId);
    if (!opens) continue;
    const { tile, rotation } = tileFromMask(cell, opens, {
      hasTowerPoint: towerFlags.get(cellId) ?? false,
      hasMine: opts.rng() < opts.mineChance,
    });
    state.placed.set(cellId, {
      cellId,
      tile,
      rotation,
      connections: opens.slice(0, cell.sides),
    });
  }

  // Stamp missing tower points onto already-placed cells if still short
  let towerCount = 0;
  for (const id of nonBase) {
    const p = state.placed.get(id);
    if (p?.tile.hasTowerPoint) towerCount++;
  }
  const min = Math.min(opts.minTowerPoints ?? 5, nonBase.length);
  if (towerCount < min) {
    const lacking = nonBase.filter(
      (id) => !state.placed.get(id)?.tile.hasTowerPoint,
    );
    for (let i = lacking.length - 1; i > 0; i--) {
      const j = Math.floor(opts.rng() * (i + 1));
      [lacking[i], lacking[j]] = [lacking[j]!, lacking[i]!];
    }
    for (const id of lacking) {
      if (towerCount >= min) break;
      const p = state.placed.get(id);
      if (!p) continue;
      p.tile.hasTowerPoint = true;
      towerCount++;
    }
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
  opts: CorridorFillOpts,
): TileDef[] {
  const nonBase = [...network.cellIds].filter((id) => !baseIds.includes(id));
  const towerFlags = assignTowerFlags(nonBase, opts);
  const bag: TileDef[] = [];
  for (const cellId of nonBase) {
    const cell = planet.cells[cellId]!;
    const opens = network.requiredOpen.get(cellId)!;
    const { tile } = tileFromMask(cell, opens, {
      hasTowerPoint: towerFlags.get(cellId) ?? false,
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
