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
