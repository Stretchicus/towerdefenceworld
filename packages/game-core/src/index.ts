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
  pickMineResource,
} from "./tiles/bag.js";
export {
  createPlacementState,
  isLegalPlacement,
  placeTile,
  findLegalPlacements,
  buildRouteGraph,
  basesConnected,
  placementNetworkComplete,
  autoPlaceOne,
  autoPlaceBag,
  autoBridge,
  closeOpenEndsByPlacing,
  legalRotationsForCell,
  nextLegalRotation,
} from "./tiles/placement.js";
export type { PlacementState } from "./tiles/placement.js";
export {
  edgeKey,
  listOpenEnds,
} from "./tiles/openEnds.js";
export type { OpenEnd } from "./tiles/openEnds.js";
export { shapeConnections } from "./tiles/shapes.js";
export type { TileShapeId } from "./tiles/shapes.js";
export { sampleNextTile } from "./tiles/sampleTile.js";
export type { SampleTileOpts } from "./tiles/sampleTile.js";
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
  reachesAliveEnemy,
  pickRandomPathToAliveEnemy,
} from "./sim/routing.js";
export type { RoutingPlayer, RoutingState } from "./sim/routing.js";
export {
  createMatch,
  assignTeams,
  finishPlacement,
  currentTile,
  intentPlaceTile,
  intentToggleTarget,
  intentToggleBod,
  intentToggleFriendlyFire,
  intentToggleNoEntry,
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
  TOWER_VISUAL_IDS,
  TOWER_VISUAL_LABELS,
  DEFAULT_TOWER_VISUAL,
  isTowerVisualId,
  normalizeTowerVisualId,
  SLIDER_POINT_COST,
  SLIDER_MIN,
  allowedSliderFields,
  maxSliderValue,
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
export type {
  ValidationResult,
  LoadoutValidationResult,
  LoadoutFileV2,
  SliderStatField,
  TowerVisualId,
} from "./towers/loadout.js";
