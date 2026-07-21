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
  legalRotationsForCell,
  nextLegalRotation,
} from "./tiles/placement.js";
export type { PlacementState } from "./tiles/placement.js";
export {
  buildCorridorNetwork,
  fillCorridorPlacement,
  findLegalCorridorPlacements,
  generateCorridorBag,
  isLegalCorridorPlacement,
} from "./tiles/corridors.js";
export type { CorridorNetwork } from "./tiles/corridors.js";
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
export {
  TOWER_POINT_POOL,
  BASELINE_FIRE_RATE,
  scoreTowerPoints,
  scoreTowerPointsRaw,
  deriveTowerCosts,
  normalizeTowerForResources,
  towerCooldownTicks,
  validateTowerDef,
  validateLoadout,
  defaultTowerLoadout,
  blankTower,
  parseLoadoutFile,
  loadoutFileFromTowers,
} from "./towers/loadout.js";
export type { ValidationResult, LoadoutFileV2 } from "./towers/loadout.js";
