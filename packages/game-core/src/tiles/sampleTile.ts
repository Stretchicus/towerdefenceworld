import type { TileDef } from "../types.js";
import { makeTile, pickMineResource } from "./bag.js";
import { listOpenEnds } from "./openEnds.js";
import {
  basesConnected,
  buildRouteGraph,
  findLegalPlacements,
  type PlacementState,
} from "./placement.js";
import { shapeConnections, type TileShapeId } from "./shapes.js";

export interface SampleTileOpts {
  seatCount: number;
  tilesPlacedNonBase: number;
  /** floor(tilesPlacedNonBase / seatCount) */
  roundIndex: number;
  splitChance: number;
  resources: string[];
  towerPointChance: number;
  mineChance: number;
  rng: () => number;
  forcedSplitRemaining?: number;
}

type LegalCandidate = {
  shape: TileShapeId;
  tile: TileDef;
  mergeCapable: boolean;
};

const SHAPES: TileShapeId[] = ["straight", "bend", "split", "cross"];

export function sampleNextTile(
  state: PlacementState,
  opts: SampleTileOpts,
): TileDef {
  const componentByCell = routeComponents(state);
  const candidates: LegalCandidate[] = [];
  for (const shape of SHAPES) {
    const tile = makeTile(shape, shapeConnections(shape));
    const placements = findLegalPlacements(state, tile);
    if (placements.length === 0) continue;
    candidates.push({
      shape,
      tile,
      mergeCapable: placements.some(({ cellId }) =>
        placementConsumesMultipleEnds(state, cellId, componentByCell),
      ),
    });
  }

  if (candidates.length === 0) {
    throw new Error("No tile shape has a legal placement");
  }

  // Prefer a legal split early in 3p only when one exists (non-increasing).
  const splitRequired = mustForceFirstRoundSplit(opts);
  const splitCandidates = candidates.filter(({ shape }) => shape === "split");
  const forcedCandidates =
    splitRequired && splitCandidates.length > 0 ? splitCandidates : candidates;
  const pool = forcedCandidates;
  const joinPressure =
    !basesConnected(state) &&
    (new Set(componentByCell.values()).size > 1 || hasAdjacentOpenEnds(state));
  const weights = pool.map((candidate) =>
    candidateWeight(candidate, opts, joinPressure),
  );
  const selected = pool[pickWeightedIndex(weights, opts.rng)]!;

  const hasTowerPoint = opts.rng() < opts.towerPointChance;
  const hasMine = opts.rng() < opts.mineChance;
  return makeTile(
    `${selected.shape}-${opts.tilesPlacedNonBase}`,
    selected.tile.connections,
    {
      hasTowerPoint,
      hasMine,
      mineTypeId: hasMine ? "basic" : undefined,
      mineResourceId: hasMine
        ? pickMineResource(opts.resources, opts.rng)
        : undefined,
    },
  );
}

function mustForceFirstRoundSplit(opts: SampleTileOpts): boolean {
  if (opts.seatCount !== 3 || opts.roundIndex !== 0) return false;
  const required = opts.forcedSplitRemaining ?? 1;
  const turnsRemaining = opts.seatCount - opts.tilesPlacedNonBase;
  return required > 0 && turnsRemaining <= required;
}

function candidateWeight(
  candidate: LegalCandidate,
  opts: SampleTileOpts,
  joinPressure: boolean,
): number {
  if (
    opts.seatCount === 2 &&
    opts.tilesPlacedNonBase < opts.seatCount
  ) {
    return candidate.shape === "straight" || candidate.shape === "bend" ? 1 : 0;
  }

  const splitChance = Math.max(0, Math.min(1, opts.splitChance));
  let weight: number;
  switch (candidate.shape) {
    case "straight":
    case "bend":
      weight = 1;
      break;
    case "split":
      // Only legal (non-increasing) splits reach here; weight by config.
      weight =
        splitChance >= 1
          ? Number.MAX_SAFE_INTEGER
          : (2 * splitChance) / Math.max(1 - splitChance, Number.EPSILON);
      if (candidate.mergeCapable) weight *= 2;
      break;
    case "cross":
      weight = joinPressure && candidate.mergeCapable ? 0.05 : 0;
      break;
  }

  if (
    joinPressure &&
    candidate.mergeCapable &&
    (candidate.shape === "straight" || candidate.shape === "bend")
  ) {
    weight *= 4;
  }
  return weight;
}

function pickWeightedIndex(weights: number[], rng: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    const positive = weights.findIndex((weight) => weight > 0);
    return positive >= 0
      ? positive
      : Math.min(Math.floor(rng() * weights.length), weights.length - 1);
  }
  let roll = Math.max(0, Math.min(rng(), 1 - Number.EPSILON)) * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

function routeComponents(state: PlacementState): Map<number, number> {
  const graph = buildRouteGraph(state);
  const componentByCell = new Map<number, number>();
  let component = 0;
  for (const cellId of state.placed.keys()) {
    if (componentByCell.has(cellId)) continue;
    const pending = [cellId];
    componentByCell.set(cellId, component);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of graph.get(current) ?? []) {
        if (componentByCell.has(neighbor)) continue;
        componentByCell.set(neighbor, component);
        pending.push(neighbor);
      }
    }
    component++;
  }
  return componentByCell;
}

function placementConsumesMultipleEnds(
  state: PlacementState,
  cellId: number,
  componentByCell: Map<number, number>,
): boolean {
  const sources = listOpenEnds(state)
    .filter((end) => end.cellId === cellId)
    .map((end) => end.fromCellId);
  if (sources.length < 2) return false;
  return (
    new Set(sources.map((source) => componentByCell.get(source))).size > 1 ||
    new Set(sources).size > 1
  );
}

function hasAdjacentOpenEnds(state: PlacementState): boolean {
  const endIds = new Set(listOpenEnds(state).map((end) => end.cellId));
  for (const cellId of endIds) {
    if (state.planet.cells[cellId]!.neighbors.some((id) => endIds.has(id))) {
      return true;
    }
  }
  return false;
}
