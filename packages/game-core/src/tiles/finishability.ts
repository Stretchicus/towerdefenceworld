import type { PlacementState } from "./placement.js";

export type EdgeKind = "required" | "forbidden" | "optional";

export type EdgeConstraint = {
  edge: number;
  kind: EdgeKind;
  groupId?: string;
};

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

function edgeTo(cellId: number, neighborId: number, state: PlacementState): number {
  const edge = state.planet.cells[cellId]!.neighbors.indexOf(neighborId);
  if (edge < 0) throw new Error(`Cell ${cellId} is not adjacent to ${neighborId}`);
  return edge;
}

function setConstraint(
  constraints: EdgeConstraint[],
  edge: number,
  kind: EdgeKind,
  groupId?: string,
): void {
  constraints[edge] =
    groupId === undefined ? { edge, kind } : { edge, kind, groupId };
}

function candidateEdgesInto(
  state: PlacementState,
  candidateCellId: number,
  cells: Set<number>,
): { edge: number; cellId: number }[] {
  const candidate = state.planet.cells[candidateCellId]!;
  const edges: { edge: number; cellId: number }[] = [];
  for (let edge = 0; edge < candidate.neighbors.length; edge++) {
    const neighbor = candidate.neighbors[edge]!;
    if (cells.has(neighbor)) edges.push({ edge, cellId: neighbor });
  }
  return edges;
}

function shortestDistancesWithin(
  state: PlacementState,
  fromCellId: number,
  allowed: Set<number>,
): Map<number, number> {
  if (!allowed.has(fromCellId)) return new Map();
  const distances = new Map<number, number>([[fromCellId, 0]]);
  const queue = [fromCellId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextDistance = distances.get(current)! + 1;
    for (const neighbor of state.planet.cells[current]!.neighbors) {
      if (!allowed.has(neighbor) || distances.has(neighbor)) continue;
      distances.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  return distances;
}

function requiredEdgesForStubPaths(
  state: PlacementState,
  pocketCells: Set<number>,
  pocketEdges: { edge: number; cellId: number }[],
  stubs: Pocket["stubEdges"],
): Set<number> {
  const required = new Set<number>();
  for (const stub of stubs) {
    const distances = shortestDistancesWithin(state, stub.intoCellId, pocketCells);
    let best = Infinity;
    for (const edge of pocketEdges) {
      const distance = distances.get(edge.cellId);
      if (distance !== undefined && distance < best) best = distance;
    }
    if (!Number.isFinite(best)) continue;
    for (const edge of pocketEdges) {
      if (distances.get(edge.cellId) === best) required.add(edge.edge);
    }
  }
  return required;
}

function pocketGroupId(pocket: Pocket): string {
  const id = Math.min(...pocket.emptyCellIds);
  return `pocket-${id}`;
}

export function classifyCandidateEdges(
  state: PlacementState,
  cellId: number,
): EdgeConstraint[] {
  const cell = state.planet.cells[cellId];
  if (!cell) return [];
  const boundaryId = boundaryCellId(state);
  const constraints: EdgeConstraint[] = cell.neighbors.map((_, edge) => ({
    edge,
    kind: "optional",
  }));
  const attachingStubEdges = new Set<number>();

  for (let edge = 0; edge < cell.neighbors.length; edge++) {
    const neighborId = cell.neighbors[edge]!;
    const neighborCell = state.planet.cells[neighborId];
    if (!neighborCell || (boundaryId !== null && neighborId === boundaryId)) {
      setConstraint(constraints, edge, "forbidden");
      continue;
    }

    const neighborPlaced = state.placed.get(neighborId);
    if (!neighborPlaced) continue;

    const neighborEdge = edgeTo(neighborId, cellId, state);
    if (neighborPlaced.connections[neighborEdge] ?? false) {
      setConstraint(constraints, edge, "required");
      attachingStubEdges.add(edge);
    } else {
      setConstraint(constraints, edge, "forbidden");
    }
  }

  for (const pocket of pocketsAfterPlacing(state, cellId)) {
    if (!pocket.sealedByCandidate) continue;

    const pocketCells = new Set(pocket.emptyCellIds);
    const pocketEdges = candidateEdgesInto(state, cellId, pocketCells);
    if (pocketEdges.length === 0) continue;

    if (pocket.stubEdges.length >= 1) {
      const required = requiredEdgesForStubPaths(
        state,
        pocketCells,
        pocketEdges,
        pocket.stubEdges,
      );
      const edgesToRequire =
        required.size > 0 ? required : new Set(pocketEdges.map((edge) => edge.edge));
      for (const edge of edgesToRequire) setConstraint(constraints, edge, "required");
    } else if (pocket.emptyCellIds.length === 1) {
      for (const edge of pocketEdges) {
        setConstraint(constraints, edge.edge, "forbidden");
      }
    } else {
      const groupId = pocketGroupId(pocket);
      for (const edge of pocketEdges) {
        setConstraint(constraints, edge.edge, "optional", groupId);
      }
    }
  }

  const requiredEdges = constraints.filter((c) => c.kind === "required");
  const requiredOnlyAttachPlaced =
    attachingStubEdges.size === 1 &&
    requiredEdges.length === attachingStubEdges.size &&
    requiredEdges.every((c) => attachingStubEdges.has(c.edge));
  if (requiredOnlyAttachPlaced) {
    // A pure attach must keep growing if any playable empty neighbour is available.
    // Finite flat fixtures can label that open frontier as a pocket first, so this
    // pass intentionally re-groups non-forbidden empty edges as at-least-one.
    for (const constraint of constraints) {
      if (constraint.kind !== "optional") continue;
      const neighborId = cell.neighbors[constraint.edge]!;
      if (state.placed.has(neighborId)) continue;
      if (boundaryId !== null && neighborId === boundaryId) continue;
      if (!state.planet.cells[neighborId]) continue;
      setConstraint(
        constraints,
        constraint.edge,
        "optional",
        "frontier-continuations",
      );
    }
  }

  return constraints;
}

export function connectionsSatisfyFinishability(
  state: PlacementState,
  cellId: number,
  connections: boolean[],
): boolean {
  const constraints = classifyCandidateEdges(state, cellId);
  if (constraints.length === 0) return false;

  const groups = new Map<string, { open: number; total: number }>();
  for (const constraint of constraints) {
    const open = connections[constraint.edge] ?? false;
    if (constraint.kind === "required" && !open) return false;
    if (constraint.kind === "forbidden" && open) return false;
    if (constraint.kind === "optional" && constraint.groupId) {
      const group = groups.get(constraint.groupId) ?? { open: 0, total: 0 };
      group.total += 1;
      if (open) group.open += 1;
      groups.set(constraint.groupId, group);
    }
  }

  for (const [groupId, group] of groups) {
    if (groupId === "frontier-continuations") {
      if (group.open < 1) return false;
    } else if (group.open !== 0 && group.open !== group.total) {
      return false;
    }
  }

  return true;
}
