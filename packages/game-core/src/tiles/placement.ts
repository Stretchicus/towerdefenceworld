import { bridgeTileTemplate, makeTile, rotateConnections } from "./bag.js";
import { connectionsSatisfyFinishability } from "./finishability.js";
import { listOpenEnds } from "./openEnds.js";
import type {
  Planet,
  PlanetCell,
  PlacedTile,
  TileDef,
} from "../types.js";

export interface PlacementState {
  planet: Planet;
  placed: Map<number, PlacedTile>;
  /** Cells that are base stubs (always on route) */
  baseCellIds: number[];
}

export function createPlacementState(
  planet: Planet,
  rng: () => number = Math.random,
): PlacementState {
  const placed = new Map<number, PlacedTile>();
  for (const id of planet.baseCellIds) {
    const cell = planet.cells[id]!;
    const edge = Math.floor(rng() * cell.sides);
    const connections = Array(cell.sides).fill(false);
    connections[edge] = true;
    placed.set(id, {
      cellId: id,
      tile: {
        id: `base-stub-${id}`,
        routeKind: "branch",
        connections: Array(6).fill(false),
        hasTowerPoint: false,
        hasMine: false,
      },
      rotation: 0,
      connections,
    });
  }
  return { planet, placed, baseCellIds: [...planet.baseCellIds] };
}

function neighborEdgeIndex(cell: PlanetCell, neighborId: number): number {
  const idx = cell.neighbors.indexOf(neighborId);
  if (idx < 0) throw new Error(`Cell ${cell.id} not adjacent to ${neighborId}`);
  return idx;
}

function oppositeEdge(
  cell: PlanetCell,
  neighbor: PlanetCell,
  edgeOnCell: number,
): number {
  // Neighbor's edge that points back to cell
  void edgeOnCell;
  return neighborEdgeIndex(neighbor, cell.id);
}

export function edgesCompatible(
  a: PlacedTile,
  cellA: PlanetCell,
  b: PlacedTile,
  cellB: PlanetCell,
): boolean {
  const ea = neighborEdgeIndex(cellA, cellB.id);
  const eb = oppositeEdge(cellA, cellB, ea);
  const openA = a.connections[ea] ?? false;
  const openB = b.connections[eb] ?? false;
  // Carcassonne-style: both open or both closed
  return openA === openB;
}

export function isLegalPlacement(
  state: PlacementState,
  cellId: number,
  tile: TileDef,
  rotation: number,
): boolean {
  if (state.placed.has(cellId)) return false;
  if (state.baseCellIds.includes(cellId)) return false;
  if (!listOpenEnds(state).some((e) => e.cellId === cellId)) return false;
  const cell = state.planet.cells[cellId];
  if (!cell) return false;

  const connections = rotateConnections(tile.connections, cell.sides, rotation);
  const candidate: PlacedTile = {
    cellId,
    tile,
    rotation,
    connections,
  };

  let touchesRoute = false;
  for (let i = 0; i < cell.neighbors.length; i++) {
    const nid = cell.neighbors[i]!;
    const neighborPlaced = state.placed.get(nid);
    if (!neighborPlaced) continue;
    const nCell = state.planet.cells[nid]!;
    if (!edgesCompatible(candidate, cell, neighborPlaced, nCell)) {
      return false;
    }
    // Must attach via at least one mutual open edge to existing route
    const ea = i;
    const eb = neighborEdgeIndex(nCell, cellId);
    if ((candidate.connections[ea] ?? false) && (neighborPlaced.connections[eb] ?? false)) {
      touchesRoute = true;
    }
  }

  if (!touchesRoute) return false;

  if (!connectionsSatisfyFinishability(state, cellId, connections)) return false;

  return true;
}

function openEndCountWithCandidate(
  state: PlacementState,
  cellId: number,
  candidate: PlacedTile,
): number {
  const placed = new Map(state.placed);
  placed.set(cellId, candidate);
  return listOpenEnds({ ...state, placed }).length;
}

export function placeTile(
  state: PlacementState,
  cellId: number,
  tile: TileDef,
  rotation: number,
): boolean {
  if (!isLegalPlacement(state, cellId, tile, rotation)) return false;
  const cell = state.planet.cells[cellId]!;
  state.placed.set(cellId, {
    cellId,
    tile,
    rotation,
    connections: rotateConnections(tile.connections, cell.sides, rotation),
  });
  return true;
}

export function findLegalPlacements(
  state: PlacementState,
  tile: TileDef,
): { cellId: number; rotation: number }[] {
  const out: { cellId: number; rotation: number }[] = [];
  const frontier = new Set(listOpenEnds(state).map((end) => end.cellId));
  for (const cellId of frontier) {
    const cell = state.planet.cells[cellId]!;
    for (let r = 0; r < cell.sides; r++) {
      if (isLegalPlacement(state, cell.id, tile, r)) {
        out.push({ cellId: cell.id, rotation: r });
      }
    }
  }
  return out;
}

export function legalRotationsForCell(
  state: PlacementState,
  tile: TileDef,
  cellId: number,
): number[] {
  const cell = state.planet.cells[cellId];
  if (!cell) return [];
  const out: number[] = [];
  for (let r = 0; r < cell.sides; r++) {
    if (isLegalPlacement(state, cellId, tile, r)) out.push(r);
  }
  return out;
}

export function nextLegalRotation(
  state: PlacementState,
  tile: TileDef,
  cellId: number,
  fromRotation: number,
  dir: 1 | -1,
): number | null {
  const legal = legalRotationsForCell(state, tile, cellId);
  if (legal.length === 0) return null;
  const cell = state.planet.cells[cellId]!;
  const sides = cell.sides;
  for (let step = 1; step <= sides; step++) {
    const r = (((fromRotation + dir * step) % sides) + sides) % sides;
    if (legal.includes(r)) return r;
  }
  return legal[0]!;
}

/** Route graph: undirected edges where both sides open */
export function buildRouteGraph(state: PlacementState): Map<number, number[]> {
  const graph = new Map<number, number[]>();
  const ensure = (id: number) => {
    if (!graph.has(id)) graph.set(id, []);
  };

  for (const [cellId, placed] of state.placed) {
    ensure(cellId);
    const cell = state.planet.cells[cellId]!;
    for (let i = 0; i < cell.neighbors.length; i++) {
      if (!(placed.connections[i] ?? false)) continue;
      const nid = cell.neighbors[i]!;
      const nPlaced = state.placed.get(nid);
      if (!nPlaced) continue;
      const nCell = state.planet.cells[nid]!;
      const eb = neighborEdgeIndex(nCell, cellId);
      if (!(nPlaced.connections[eb] ?? false)) continue;
      ensure(nid);
      if (!graph.get(cellId)!.includes(nid)) graph.get(cellId)!.push(nid);
      if (!graph.get(nid)!.includes(cellId)) graph.get(nid)!.push(cellId);
    }
  }
  return graph;
}

export function basesConnected(state: PlacementState): boolean {
  const graph = buildRouteGraph(state);
  if (state.baseCellIds.length === 0) return true;
  const start = state.baseCellIds[0]!;
  const seen = new Set<number>();
  const q = [start];
  seen.add(start);
  while (q.length) {
    const cur = q.pop()!;
    for (const n of graph.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return state.baseCellIds.every((id) => seen.has(id));
}

/** Castles share one graph, no stubs into empty land, no spur tips. */
export function placementNetworkComplete(state: PlacementState): boolean {
  if (!basesConnected(state)) return false;
  if (listOpenEnds(state).length > 0) return false;
  if (hasAsymmetricRouteOpens(state)) return false;
  const graph = buildRouteGraph(state);
  for (const cellId of state.placed.keys()) {
    if (state.baseCellIds.includes(cellId)) continue;
    if ((graph.get(cellId)?.length ?? 0) < 2) return false;
  }
  return true;
}

function hasAsymmetricRouteOpens(state: PlacementState): boolean {
  for (const [cellId, tile] of state.placed) {
    const cell = state.planet.cells[cellId]!;
    for (let i = 0; i < cell.neighbors.length; i++) {
      if (!(tile.connections[i] ?? false)) continue;
      const nid = cell.neighbors[i]!;
      const np = state.placed.get(nid);
      if (!np) continue;
      const eb = neighborEdgeIndex(state.planet.cells[nid]!, cellId);
      if (!(np.connections[eb] ?? false)) return true;
    }
  }
  return false;
}

export function autoPlaceOne(
  state: PlacementState,
  tile: TileDef,
  preferRng: () => number,
): boolean {
  const options = findLegalPlacements(state, tile);
  if (options.length === 0) return false;
  const pick = options[Math.floor(preferRng() * options.length) % options.length]!;
  return placeTile(state, pick.cellId, tile, pick.rotation);
}

export function autoPlaceBag(
  state: PlacementState,
  bag: TileDef[],
  rng: () => number,
): TileDef[] {
  const remaining: TileDef[] = [];
  for (const tile of bag) {
    if (!autoPlaceOne(state, tile, rng)) remaining.push(tile);
  }
  return remaining;
}

/**
 * Force-connect bases with corridor tiles along shortest cell hops
 * that are still empty (graph distance on planet adjacency, not route),
 * then join remaining open stubs until the network is clean.
 *
 * Turn-cap emergency only: prefers `placeTile` (finishability-gated). When no
 * legal bridge exists, `forcePlaceBridge` and carve helpers may bypass
 * finishability to avoid leaving an incomplete board — still no seal/prune.
 */
export function autoBridge(state: PlacementState): void {
  let carveGuard = 0;
  while (!basesConnected(state) && carveGuard++ < state.baseCellIds.length) {
    if (!carveOpenEndsTogether(state)) break;
  }

  if (!basesConnected(state)) {
    let guard = 0;
    while (!basesConnected(state) && guard++ < 500) {
      const graph = buildRouteGraph(state);
      const components = baseComponents(state, graph);
      if (components.length < 2) break;
      const a = components[0]!;
      const b = components[1]!;
      const path = shortestCellPath(state.planet, a[0]!, b[0]!);
      if (!path || path.length < 2) break;
      let bridged = false;
      for (const cellId of path) {
        if (state.placed.has(cellId)) continue;
        const tile = bridgeTileTemplate(cellId);
        const options = findLegalPlacements(state, tile);
        const hit = options.find((o) => o.cellId === cellId);
        if (hit) {
          placeTile(state, hit.cellId, tile, hit.rotation);
          bridged = true;
          break;
        }
        const cell = state.planet.cells[cellId]!;
        for (let r = 0; r < cell.sides; r++) {
          if (forcePlaceBridge(state, cellId, tile, r)) {
            bridged = true;
            break;
          }
        }
        if (bridged) break;
      }
      if (!bridged) {
        const tile = bridgeTileTemplate(1000 + guard);
        if (!autoPlaceOne(state, tile, () => 0.5)) break;
      }
    }
    carveGuard = 0;
    while (!basesConnected(state) && carveGuard++ < state.baseCellIds.length) {
      if (!carveOpenEndsTogether(state)) break;
    }
  }

  closeOpenEndsByPlacing(state);
}

/**
 * Join remaining open stubs by legal tiles or carving corridors between ends.
 * Never deletes tiles or seals connection bits without placing/carving a route.
 *
 * Tries finishable `placeTile` first (`placeAnyClosingTile`). Carve helpers
 * (`carveAnyOpenEndPair`, `carveStubBackToNetwork`, `openEdge`) are cap-only
 * fallbacks and may bypass finishability; normal manual/auto placement must not.
 */
export function closeOpenEndsByPlacing(state: PlacementState): void {
  let guard = 0;
  while (!placementNetworkComplete(state) && guard++ < 500) {
    if (repairAsymmetricRouteOpens(state)) continue;
    if (placeAnyClosingTile(state)) continue;
    if (carveAnyOpenEndPair(state)) continue;
    if (carveStubBackToNetwork(state)) continue;
    if (linkCulDeSacTips(state)) continue;
    break;
  }
}

/** Complete half-open edges between two placed cells (carving artifacts). */
function repairAsymmetricRouteOpens(state: PlacementState): boolean {
  let fixed = false;
  for (const [cellId, tile] of state.placed) {
    const cell = state.planet.cells[cellId]!;
    for (let i = 0; i < cell.neighbors.length; i++) {
      if (!(tile.connections[i] ?? false)) continue;
      const nid = cell.neighbors[i]!;
      const np = state.placed.get(nid);
      if (!np) continue;
      const eb = neighborEdgeIndex(state.planet.cells[nid]!, cellId);
      if (np.connections[eb] ?? false) continue;
      np.connections[eb] = true;
      fixed = true;
    }
  }
  return fixed;
}

/** Connect degree-1 non-base tips into another adjacent route cell or via a loop. */
function linkCulDeSacTips(state: PlacementState): boolean {
  const graph = buildRouteGraph(state);
  for (const cellId of state.placed.keys()) {
    if (state.baseCellIds.includes(cellId)) continue;
    const deg = graph.get(cellId)?.length ?? 0;
    if (deg >= 2) continue;
    const cell = state.planet.cells[cellId]!;
    const linked = new Set(graph.get(cellId) ?? []);
    for (const nid of cell.neighbors) {
      if (!state.placed.has(nid) || linked.has(nid)) continue;
      openEdge(state, cellId, nid);
      return true;
    }
    // No adjacent placed alternate — carve empty neighbour back into the network
    for (const nid of cell.neighbors) {
      if (state.placed.has(nid)) continue;
      const goals = new Set<number>();
      for (const pid of state.placed.keys()) {
        if (pid === cellId) continue;
        for (const n of state.planet.cells[pid]!.neighbors) {
          if (!state.placed.has(n)) goals.add(n);
        }
      }
      const path = shortestPathToGoal(state.planet, nid, goals);
      if (!path || path.length < 1) continue;
      const attachId = path[path.length - 1]!;
      let joinTo: number | null = null;
      for (const n of state.planet.cells[attachId]!.neighbors) {
        if (state.placed.has(n) && n !== cellId) {
          joinTo = n;
          break;
        }
      }
      if (joinTo === null) continue;
      const route = [cellId, nid, ...path.slice(1), joinTo];
      for (let k = 0; k < route.length - 1; k++) {
        openEdge(state, route[k]!, route[k + 1]!);
      }
      return true;
    }
  }
  return false;
}

function placeAnyClosingTile(state: PlacementState): boolean {
  const shapes = [
    bridgeTileTemplate(9000 + state.placed.size),
    bridgeTileTemplate(9100 + state.placed.size),
  ];
  for (const tile of shapes) {
    if (autoPlaceOne(state, tile, () => 0.5)) return true;
  }
  const bend = makeTile(
    `close-bend-${state.placed.size}`,
    [true, false, true, false, false, false],
  );
  const straight = makeTile(
    `close-straight-${state.placed.size}`,
    [true, false, false, true, false, false],
  );
  const split = makeTile(
    `close-split-${state.placed.size}`,
    [true, false, true, false, true, false],
  );
  for (const tile of [bend, straight, split]) {
    const options = findLegalPlacements(state, tile);
    if (options.length === 0) continue;
    options.sort((a, b) => {
      const ca = {
        cellId: a.cellId,
        tile,
        rotation: a.rotation,
        connections: rotateConnections(
          tile.connections,
          state.planet.cells[a.cellId]!.sides,
          a.rotation,
        ),
      };
      const cb = {
        cellId: b.cellId,
        tile,
        rotation: b.rotation,
        connections: rotateConnections(
          tile.connections,
          state.planet.cells[b.cellId]!.sides,
          b.rotation,
        ),
      };
      return (
        openEndCountWithCandidate(state, a.cellId, ca) -
        openEndCountWithCandidate(state, b.cellId, cb)
      );
    });
    const pick = options[0]!;
    if (placeTile(state, pick.cellId, tile, pick.rotation)) return true;
  }
  return false;
}

function carveAnyOpenEndPair(state: PlacementState): boolean {
  const ends = listOpenEnds(state);
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!;
      const b = ends[j]!;
      if (a.cellId === b.cellId) {
        openEdge(state, a.fromCellId, a.cellId);
        openEdge(state, b.fromCellId, b.cellId);
        return true;
      }
      const path = shortestCellPath(state.planet, a.cellId, b.cellId);
      if (!path || path.length < 1) continue;
      const route = [a.fromCellId, ...path, b.fromCellId];
      for (let k = 0; k < route.length - 1; k++) {
        openEdge(state, route[k]!, route[k + 1]!);
      }
      return true;
    }
  }
  return false;
}

function carveStubBackToNetwork(state: PlacementState): boolean {
  const ends = listOpenEnds(state);
  if (ends.length === 0) return false;
  const end = ends[0]!;
  const goals = new Set<number>();
  for (const cellId of state.placed.keys()) {
    if (cellId === end.fromCellId) continue;
    for (const n of state.planet.cells[cellId]!.neighbors) {
      if (!state.placed.has(n)) goals.add(n);
    }
  }
  if (goals.has(end.cellId)) {
    // Already adjacent to another route cell — open mutual edges via that neighbour
    const cell = state.planet.cells[end.cellId]!;
    for (const nid of cell.neighbors) {
      if (!state.placed.has(nid) || nid === end.fromCellId) continue;
      openEdge(state, end.fromCellId, end.cellId);
      openEdge(state, end.cellId, nid);
      return true;
    }
  }
  const path = shortestPathToGoal(state.planet, end.cellId, goals);
  if (!path || path.length < 1) return false;
  const attachId = path[path.length - 1]!;
  let joinTo: number | null = null;
  for (const n of state.planet.cells[attachId]!.neighbors) {
    if (state.placed.has(n) && n !== end.fromCellId) {
      joinTo = n;
      break;
    }
  }
  if (joinTo === null) return false;
  const route = [end.fromCellId, ...path, joinTo];
  for (let k = 0; k < route.length - 1; k++) {
    openEdge(state, route[k]!, route[k + 1]!);
  }
  return true;
}

function shortestPathToGoal(
  planet: Planet,
  from: number,
  goals: Set<number>,
): number[] | null {
  if (goals.has(from)) return [from];
  const q = [from];
  const prev = new Map<number, number | null>([[from, null]]);
  let found: number | null = null;
  while (q.length) {
    const cur = q.shift()!;
    if (goals.has(cur)) {
      found = cur;
      break;
    }
    for (const n of planet.cells[cur]!.neighbors) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  if (found === null) return null;
  const path: number[] = [];
  let c: number | null = found;
  while (c !== null) {
    path.push(c);
    c = prev.get(c) ?? null;
  }
  path.reverse();
  return path;
}

function carveOpenEndsTogether(state: PlacementState): boolean {
  const graph = buildRouteGraph(state);
  const components = baseComponents(state, graph);
  if (components.length < 2) return false;
  const reachableA = reachableFrom(graph, components[0]![0]!);
  const reachableB = reachableFrom(graph, components[1]![0]!);
  const ends = listOpenEnds(state);
  const sources = ends.filter((end) => reachableA.has(end.fromCellId));
  const targets = ends.filter((end) => reachableB.has(end.fromCellId));
  if (sources.length === 0 || targets.length === 0) return false;
  const targetByCell = new Map(targets.map((end) => [end.cellId, end]));
  const pending = sources.map((end) => end.cellId);
  const previous = new Map<number, number | null>(
    sources.map((end) => [end.cellId, null]),
  );
  let goal: number | null = null;
  while (pending.length > 0 && goal === null) {
    const current = pending.shift()!;
    if (targetByCell.has(current)) {
      goal = current;
      break;
    }
    for (const neighbor of state.planet.cells[current]!.neighbors) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      pending.push(neighbor);
    }
  }
  if (goal === null) return false;
  const path: number[] = [];
  for (let current: number | null = goal; current !== null; ) {
    path.push(current);
    current = previous.get(current) ?? null;
  }
  path.reverse();
  const source = sources.find((end) => end.cellId === path[0])!;
  const target = targetByCell.get(goal)!;
  const route = [source.fromCellId, ...path, target.fromCellId];
  for (let i = 0; i < route.length - 1; i++) {
    openEdge(state, route[i]!, route[i + 1]!);
  }
  return true;
}

function reachableFrom(
  graph: Map<number, number[]>,
  start: number,
): Set<number> {
  const seen = new Set<number>([start]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const neighbor of graph.get(current) ?? []) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      pending.push(neighbor);
    }
  }
  return seen;
}

function openEdge(state: PlacementState, a: number, b: number): void {
  for (const [cellId, neighborId] of [
    [a, b],
    [b, a],
  ] as const) {
    const cell = state.planet.cells[cellId]!;
    const edge = neighborEdgeIndex(cell, neighborId);
    let placed = state.placed.get(cellId);
    if (!placed) {
      const tile = bridgeTileTemplate(cellId);
      placed = {
        cellId,
        tile,
        rotation: 0,
        connections: Array(cell.sides).fill(false),
      };
      state.placed.set(cellId, placed);
    }
    placed.connections[edge] = true;
  }
}

/** Cap-only bridge write when `placeTile` has no legal rotation; skips finishability. */
function forcePlaceBridge(
  state: PlacementState,
  cellId: number,
  tile: TileDef,
  rotation: number,
): boolean {
  if (state.placed.has(cellId)) return false;
  const cell = state.planet.cells[cellId]!;
  const connections = rotateConnections(tile.connections, cell.sides, rotation);
  const candidate: PlacedTile = { cellId, tile, rotation, connections };
  for (let i = 0; i < cell.neighbors.length; i++) {
    const nid = cell.neighbors[i]!;
    const neighborPlaced = state.placed.get(nid);
    if (!neighborPlaced) continue;
    const nCell = state.planet.cells[nid]!;
    if (!edgesCompatible(candidate, cell, neighborPlaced, nCell)) return false;
  }
  // Must touch existing route with open edge
  let touches = false;
  for (let i = 0; i < cell.neighbors.length; i++) {
    const nid = cell.neighbors[i]!;
    const neighborPlaced = state.placed.get(nid);
    if (!neighborPlaced) continue;
    const nCell = state.planet.cells[nid]!;
    const eb = neighborEdgeIndex(nCell, cellId);
    if ((candidate.connections[i] ?? false) && (neighborPlaced.connections[eb] ?? false)) {
      touches = true;
    }
  }
  if (!touches) return false;
  state.placed.set(cellId, candidate);
  return true;
}

function baseComponents(
  state: PlacementState,
  graph: Map<number, number[]>,
): number[][] {
  const remaining = new Set(state.baseCellIds);
  const comps: number[][] = [];
  while (remaining.size) {
    const start = remaining.values().next().value!;
    const seen = new Set<number>();
    const q = [start];
    seen.add(start);
    while (q.length) {
      const cur = q.pop()!;
      for (const n of graph.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    const comp = state.baseCellIds.filter((id) => seen.has(id));
    for (const id of comp) remaining.delete(id);
    comps.push(comp);
  }
  return comps;
}

function shortestCellPath(
  planet: Planet,
  from: number,
  to: number,
): number[] | null {
  const q = [from];
  const prev = new Map<number, number | null>([[from, null]]);
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
