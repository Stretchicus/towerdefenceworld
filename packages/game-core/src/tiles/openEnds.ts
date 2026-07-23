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
