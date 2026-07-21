export type * from "./types.js";
export {
  defaultGameConfig,
  activeResources,
  emptyBank,
  startingBankFor,
  canAfford,
  pay,
  addResources,
  scaleCost,
  filterCostToResources,
} from "./config.js";
export { createRng, pickIndex } from "./rng.js";
export { buildPlanet, cellById, WORLD_FREQUENCY } from "./planet/goldberg.js";
export {
  makeTile,
  rotateConnections,
  generateTileBag,
  bridgeTileTemplate,
} from "./tiles/bag.js";
export {
  createPlacementState,
  isLegalPlacement,
  placeTile,
  findLegalPlacements,
  buildRouteGraph,
  basesConnected,
  autoPlaceOne,
  autoPlaceBag,
  autoBridge,
} from "./tiles/placement.js";
export type { PlacementState } from "./tiles/placement.js";
export { findPath, pathLength } from "./sim/pathfinding.js";
export {
  createMatch,
  assignTeams,
  finishPlacement,
  currentTile,
  intentPlaceTile,
  intentToggleTarget,
  intentToggleBod,
  intentToggleFriendlyFire,
  intentBuildTower,
  intentClaimMine,
  intentUpgrade,
  pickSpawnTarget,
  tickMatch,
  runAiPlacement,
  runAiCombat,
  serializeMatch,
} from "./sim/match.js";
export type {
  MatchState,
  MatchSnapshot,
  PlayerState,
  CreateMatchInput,
  TowerStructure,
  MineStructure,
  BodInstance,
} from "./sim/match.js";
