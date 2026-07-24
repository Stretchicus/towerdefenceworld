import type { PlacementState } from "./placement.js";

export type Pocket = {
  emptyCellIds: number[];
  stubEdges: { fromCellId: number; edge: number; intoCellId: number }[];
  sealedByCandidate: boolean;
};

function boundaryCellId(state: PlacementState): number | null {
  const last = state.planet.cells[state.planet.cells.length - 1];
  if (!last) return null;
  if (last.neighbors.every((n) => n === last.id)) return last.id;
  return null;
}

function isEmpty(
  cellId: number,
  state: PlacementState,
  candidateCellId: number,
  boundaryId: number | null,
): boolean {
  if (boundaryId !== null && cellId === boundaryId) return false;
  if (cellId === candidateCellId) return false;
  if (state.placed.has(cellId)) return false;
  return state.planet.cells[cellId] !== undefined;
}

function componentAdjacentTo(
  component: Set<number>,
  cellId: number,
  state: PlacementState,
): boolean {
  for (const id of component) {
    const cell = state.planet.cells[id]!;
    if (cell.neighbors.includes(cellId)) return true;
  }
  return false;
}

function sealedByCandidate(
  component: Set<number>,
  candidateCellId: number,
  state: PlacementState,
  boundaryId: number | null,
  isEmptyFn: (cellId: number) => boolean,
): boolean {
  if (!componentAdjacentTo(component, candidateCellId, state)) return false;

  for (const id of component) {
    const cell = state.planet.cells[id]!;
    for (const neighbor of cell.neighbors) {
      if (component.has(neighbor)) continue;
      if (isEmptyFn(neighbor)) return false;
      if (neighbor === candidateCellId) continue;
      if (state.placed.has(neighbor)) continue;
      if (boundaryId !== null && neighbor === boundaryId) continue;
      return false;
    }
  }
  return true;
}

function stubEdgesForComponent(
  component: Set<number>,
  state: PlacementState,
  candidateCellId: number,
): Pocket["stubEdges"] {
  const stubs: Pocket["stubEdges"] = [];
  for (const [fromCellId, tile] of state.placed) {
    if (fromCellId === candidateCellId) continue;
    const cell = state.planet.cells[fromCellId]!;
    for (let edge = 0; edge < cell.neighbors.length; edge++) {
      if (!(tile.connections[edge] ?? false)) continue;
      const intoCellId = cell.neighbors[edge]!;
      if (component.has(intoCellId)) {
        stubs.push({ fromCellId, edge, intoCellId });
      }
    }
  }
  return stubs;
}

export function pocketsAfterPlacing(
  state: PlacementState,
  candidateCellId: number,
): Pocket[] {
  const boundaryId = boundaryCellId(state);
  const isEmptyFn = (cellId: number) =>
    isEmpty(cellId, state, candidateCellId, boundaryId);

  const visited = new Set<number>();
  const pockets: Pocket[] = [];

  for (const cell of state.planet.cells) {
    if (boundaryId !== null && cell.id === boundaryId) continue;
    if (!isEmptyFn(cell.id) || visited.has(cell.id)) continue;

    const component = new Set<number>();
    const queue = [cell.id];
    visited.add(cell.id);
    component.add(cell.id);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const neighbor of state.planet.cells[cur]!.neighbors) {
        if (boundaryId !== null && neighbor === boundaryId) continue;
        if (!isEmptyFn(neighbor) || visited.has(neighbor)) continue;
        visited.add(neighbor);
        component.add(neighbor);
        queue.push(neighbor);
      }
    }

    const emptyCellIds = [...component].sort((a, b) => a - b);
    pockets.push({
      emptyCellIds,
      stubEdges: stubEdgesForComponent(component, state, candidateCellId),
      sealedByCandidate: sealedByCandidate(
        component,
        candidateCellId,
        state,
        boundaryId,
        isEmptyFn,
      ),
    });
  }

  return pockets;
}
