import type { PlacementState } from "./placement.js";

export type OpenEnd = {
  cellId: number;
  fromCellId: number;
  edgeOnFrom: number;
};

export function edgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

export function listOpenEnds(state: PlacementState): OpenEnd[] {
  const ends: OpenEnd[] = [];
  for (const [cellId, tile] of state.placed) {
    const cell = state.planet.cells[cellId]!;
    for (let i = 0; i < cell.neighbors.length; i++) {
      if (!(tile.connections[i] ?? false)) continue;
      const neighbor = cell.neighbors[i]!;
      if (state.placed.has(neighbor)) continue;
      ends.push({ cellId: neighbor, fromCellId: cellId, edgeOnFrom: i });
    }
  }
  return ends;
}

/**
 * Close every open connection that faces an empty (unplaced) neighbour.
 * Call when leaving placement so auto/manual boards never keep dead-end stubs.
 */
export function sealOpenEndsFacingEmpty(state: PlacementState): number {
  let sealed = 0;
  for (const [cellId, tile] of state.placed) {
    const cell = state.planet.cells[cellId]!;
    for (let i = 0; i < cell.neighbors.length; i++) {
      if (!(tile.connections[i] ?? false)) continue;
      const neighbor = cell.neighbors[i]!;
      if (state.placed.has(neighbor)) continue;
      tile.connections[i] = false;
      sealed++;
    }
  }
  return sealed;
}

/**
 * Remove non-base spur tips (route degree ≤ 1) until every remaining road
 * is on a path between castles — no cul-de-sac dead ends.
 */
export function pruneDeadEndSpurs(
  state: PlacementState,
  buildGraph: (s: PlacementState) => Map<number, number[]>,
): number {
  let removed = 0;
  let guard = 0;
  const max = state.placed.size + 8;
  while (guard++ < max) {
    sealOpenEndsFacingEmpty(state);
    const graph = buildGraph(state);
    let tip: number | null = null;
    for (const cellId of state.placed.keys()) {
      if (state.baseCellIds.includes(cellId)) continue;
      const deg = graph.get(cellId)?.length ?? 0;
      if (deg <= 1) {
        tip = cellId;
        break;
      }
    }
    if (tip === null) break;
    const neighbors = graph.get(tip) ?? [];
    state.placed.delete(tip);
    for (const n of neighbors) {
      const np = state.placed.get(n);
      if (!np) continue;
      const edge = state.planet.cells[n]!.neighbors.indexOf(tip);
      if (edge >= 0) np.connections[edge] = false;
    }
    removed++;
  }
  sealOpenEndsFacingEmpty(state);
  return removed;
}
