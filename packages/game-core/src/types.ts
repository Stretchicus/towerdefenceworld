/** Shared resource quantity map */
export type ResourceMap = Record<string, number>;

export type WorldSize = "small" | "medium" | "large";
export type MatchMode = "ffa" | "teams";
export type WinRule = "last_base" | "timed";
export type PlacementMode = "manual" | "auto";
export type MatchPhase = "lobby" | "placement" | "combat" | "ended";

export interface TowerDef {
  id: string;
  power: number;
  range: number;
  fireRate: number;
  buildDiscount: number;
  upgradeDiscount: number;
  aoeSize: number;
  aoeFade: number;
  jump: number;
  jumpLoss: number;
  slowPower: number;
  shotGivesPercent: number;
  shootCost: ResourceMap;
  buildCost: ResourceMap;
  upgradeCost: ResourceMap;
  upgradeStatIncrease: Record<string, number>;
  upgradeLevelIncrease: number;
  friendlyFireDefault: boolean;
}

export interface MineDef {
  id: string;
  generated: ResourceMap;
  upgradeCost: ResourceMap;
  upgradeLevelIncrease: number;
  upgradeGeneratedIncrease: Record<string, number>;
}

export interface BodDef {
  id: string;
  hp: number;
  resistance: number;
  resourcesToBuild: ResourceMap;
  resourcePercOnDeath: number;
  buildTimeTicks: number;
  upgradeCost: ResourceMap;
  upgradeLevelIncrease: number;
  upgradeStatIncrease: Record<string, number>;
  enabledByDefault: boolean;
}

export interface BaseDef {
  hp: number;
  resourceGenPerTick: ResourceMap;
  upgradeCost: ResourceMap;
  upgradeLevelIncrease: number;
  upgradeStatIncrease: Record<string, number>;
}

export interface GameConfig {
  resources: string[];
  resourceCountDefault: number;
  startingBank: ResourceMap;
  towerPointChance: number;
  /** Guaranteed minimum tower pads on the corridor (non-base cells) */
  minTowerPoints: number;
  /** Fraction of planet cells that should lie on meandering corridors */
  corridorFillFraction: number;
  mineChance: number;
  baseContactDamage: number;
  tickRateHz: number;
  /** Combat ticks between each bod step along the route (higher = slower) */
  bodMoveEveryTicks: number;
  timedMatchSeconds: number;
  towers: Record<string, TowerDef>;
  mines: Record<string, MineDef>;
  bods: Record<string, BodDef>;
  base: BaseDef;
  tileBagSize: Record<WorldSize, number>;
}

export interface LobbySettings {
  mode: MatchMode;
  winRule: WinRule;
  worldSize: WorldSize;
  placementMode: PlacementMode;
  resourceCount: number;
  seatCount: number;
  timedSeconds?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlanetCell {
  id: number;
  /** 5 = pentagon, 6 = hexagon */
  sides: 5 | 6;
  center: Vec3;
  /** Neighbour cell ids, ordered around the cell */
  neighbors: number[];
  /** Boundary vertices for rendering */
  vertices: Vec3[];
}

export interface Planet {
  size: WorldSize;
  frequency: number;
  cells: PlanetCell[];
  baseCellIds: number[];
}

/** Per-edge connection: 1 = route opens on that edge */
export type EdgeMask = number[];

export type RouteKind = "single" | "branch" | "empty";

export interface TileDef {
  id: string;
  routeKind: RouteKind;
  /** Connection bits for edges 0..maxSides-1 before rotation */
  connections: boolean[];
  hasTowerPoint: boolean;
  hasMine: boolean;
  mineTypeId?: string;
}

export interface PlacedTile {
  cellId: number;
  tile: TileDef;
  rotation: number;
  /** Effective connections after rotation, length = cell.sides */
  connections: boolean[];
}

export type UpgradeTarget =
  | { kind: "tower"; structureId: string }
  | { kind: "mine"; structureId: string }
  | { kind: "bod"; bodTypeId: string }
  | { kind: "base"; playerId: string };
