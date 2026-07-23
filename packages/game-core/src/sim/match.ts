import {
  activeResources,
  addResources,
  canAfford,
  defaultGameConfig,
  filterCostToResources,
  pay,
  scaleCost,
  startingBankFor,
} from "../config.js";
import { createRng } from "../rng.js";
import { buildPlanet } from "../planet/goldberg.js";
import {
  autoBridge,
  basesConnected,
  buildRouteGraph,
  createPlacementState,
  findLegalPlacements,
  isLegalPlacement,
  placeTile,
  type PlacementState,
} from "../tiles/placement.js";
import { sampleNextTile } from "../tiles/sampleTile.js";
import { edgeKey } from "../tiles/openEnds.js";
import { findPath, pathLength } from "./pathfinding.js";
import {
  pickRandomContinuationToAliveEnemy,
  pickRandomPathToAliveEnemy,
} from "./routing.js";
import type {
  GameConfig,
  LobbySettings,
  MatchPhase,
  Planet,
  ResourceMap,
  TileDef,
  TowerDef,
  UpgradeTarget,
} from "../types.js";
import {
  BASELINE_FIRE_RATE,
  defaultTowerLoadout,
  towerCooldownTicks,
  validateLoadout,
} from "../towers/loadout.js";

export interface PlayerState {
  id: string;
  name: string;
  teamId: string;
  isAi: boolean;
  bank: ResourceMap;
  baseHp: number;
  baseLevel: number;
  /** @deprecated Retained for wire compatibility; routing ignores target flags. */
  targetEnabled: Record<string, boolean>;
  /** Bod type id → enabled for auto-build */
  bodEnabled: Record<string, boolean>;
  bodLevels: Record<string, number>;
  /** Spawn assignment counters for round-robin */
  assignCounts: Record<string, number>;
  alive: boolean;
  /** Per-player tower types (point-budget validated) */
  loadout: TowerDef[];
}

export interface TowerStructure {
  id: string;
  cellId: number;
  ownerId: string;
  typeId: string;
  level: number;
  friendlyFire: boolean;
  cooldown: number;
}

export interface MineStructure {
  id: string;
  cellId: number;
  ownerId: string;
  typeId: string;
  level: number;
}

export interface BodInstance {
  id: string;
  ownerId: string;
  typeId: string;
  hp: number;
  maxHp: number;
  cellId: number;
  path: number[];
  pathIndex: number;
  /** Ticks until next cell step */
  moveCooldown: number;
  held: ResourceMap;
  /** Resource ids collected (one per mine visit) for client orbit FX */
  pickups: string[];
  targetPlayerId: string;
  buildRemaining: number;
}

export interface MatchState {
  id: string;
  seed: number;
  config: GameConfig;
  settings: LobbySettings;
  resources: string[];
  phase: MatchPhase;
  tick: number;
  planet: Planet;
  placement: PlacementState;
  currentOffer: TileDef | null;
  placementTurns: number;
  forcedSplitRemaining: number;
  placementRng: () => number;
  currentSeat: number;
  players: PlayerState[];
  towers: TowerStructure[];
  mines: MineStructure[];
  bods: BodInstance[];
  buildQueue: { playerId: string; bodTypeId: string; remaining: number }[];
  winnerIds: string[];
  combatEndsAtTick: number | null;
  nextEntityId: number;
  routeGraph: Map<number, number[]>;
  edgeBlocks: Map<string, Set<string>>;
  /** Pulses while waiting on an AI placement seat (throttle) */
  aiPlacementPulse: number;
}

export function assignTeams(
  mode: LobbySettings["mode"],
  playerIds: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (mode === "ffa") {
    for (const id of playerIds) out[id] = `team-${id}`;
    return out;
  }
  // teams: pairs (0,1) vs (2,3) or for 2 players each alone then... 2 players = duel ffa-like teams
  if (playerIds.length === 2) {
    out[playerIds[0]!] = "team-a";
    out[playerIds[1]!] = "team-b";
    return out;
  }
  out[playerIds[0]!] = "team-a";
  out[playerIds[1]!] = "team-a";
  out[playerIds[2]!] = "team-b";
  if (playerIds[3]) out[playerIds[3]] = "team-b";
  return out;
}

export interface CreateMatchInput {
  id: string;
  seed: number;
  settings: LobbySettings;
  seats: {
    id: string;
    name: string;
    isAi: boolean;
    loadout?: TowerDef[];
  }[];
  config?: GameConfig;
}

function resolveSeatLoadout(
  seat: CreateMatchInput["seats"][number],
  resourceCount: number,
): TowerDef[] {
  if (seat.isAi) return defaultTowerLoadout(resourceCount);
  if (seat.loadout?.length) {
    const v = validateLoadout(seat.loadout, resourceCount);
    if (v.ok) return v.towers;
  }
  return defaultTowerLoadout(resourceCount);
}

export function createMatch(input: CreateMatchInput): MatchState {
  const config = input.config ?? defaultGameConfig;
  const settings = { ...input.settings };
  if (settings.mode === "teams" && settings.seatCount === 3) {
    settings.mode = "ffa";
  }
  const resources = activeResources(config, settings.resourceCount);
  const planet = buildPlanet(settings.worldSize, settings.seatCount);
  const placementRng = createRng(input.seed);
  const placement = createPlacementState(planet, placementRng);
  const teams = assignTeams(
    settings.mode,
    input.seats.map((s) => s.id),
  );

  const players: PlayerState[] = input.seats.map((s) => {
    const others = input.seats.filter((o) => o.id !== s.id).map((o) => o.id);
    const targetEnabled: Record<string, boolean> = {};
    for (const o of others) targetEnabled[o] = true;
    const bodEnabled: Record<string, boolean> = {};
    const bodLevels: Record<string, number> = {};
    for (const [id, def] of Object.entries(config.bods)) {
      bodEnabled[id] = def.enabledByDefault;
      bodLevels[id] = 0;
    }
    return {
      id: s.id,
      name: s.name,
      teamId: teams[s.id]!,
      isAi: s.isAi,
      bank: startingBankFor(config, resources),
      baseHp: config.base.hp,
      baseLevel: 0,
      targetEnabled,
      bodEnabled,
      bodLevels,
      assignCounts: Object.fromEntries(others.map((o) => [o, 0])),
      alive: true,
      loadout: resolveSeatLoadout(s, settings.resourceCount),
    };
  });

  const state: MatchState = {
    id: input.id,
    seed: input.seed,
    config,
    settings,
    resources,
    phase: "placement",
    tick: 0,
    planet,
    placement,
    currentOffer: null,
    placementTurns: 0,
    forcedSplitRemaining: settings.seatCount === 3 ? 1 : 0,
    placementRng,
    currentSeat: 0,
    players,
    towers: [],
    mines: [],
    bods: [],
    buildQueue: [],
    winnerIds: [],
    combatEndsAtTick: null,
    nextEntityId: 1,
    routeGraph: buildRouteGraph(placement),
    edgeBlocks: new Map(players.map((player) => [player.id, new Set<string>()])),
    aiPlacementPulse: 0,
  };
  state.currentOffer = sampleOffer(state);

  if (settings.placementMode === "auto") {
    runAutoPlacement(state);
  }

  return state;
}

function runAutoPlacement(state: MatchState): void {
  while (
    state.phase === "placement" &&
    !basesConnected(state.placement) &&
    state.placementTurns < state.config.placementTurnCap
  ) {
    const tile = state.currentOffer;
    if (!tile) break;
    const options = findLegalPlacements(state.placement, tile);
    if (options.length === 0) break;
    const pick = chooseAiPlacement(state, options);
    if (!placeTile(state.placement, pick.cellId, tile, pick.rotation)) break;
    completePlacementTurn(state);
  }
  if (state.phase === "placement") finishPlacement(state);
}

export function finishPlacement(state: MatchState): void {
  if (
    !basesConnected(state.placement) &&
    state.placementTurns >= state.config.placementTurnCap
  ) {
    autoBridge(state.placement);
  }
  state.currentOffer = null;
  state.routeGraph = buildRouteGraph(state.placement);
  state.phase = "combat";
  const seconds =
    state.settings.timedSeconds ?? state.config.timedMatchSeconds;
  if (state.settings.winRule === "timed") {
    state.combatEndsAtTick = state.tick + seconds * state.config.tickRateHz;
  }
}

export function currentTile(state: MatchState): TileDef | null {
  return state.currentOffer;
}

export function intentPlaceTile(
  state: MatchState,
  playerId: string,
  cellId: number,
  rotation: number,
): { ok: boolean; error?: string } {
  if (state.phase !== "placement") return { ok: false, error: "not_placement" };
  if (state.settings.placementMode !== "manual") {
    return { ok: false, error: "auto_mode" };
  }
  const seat = state.players[state.currentSeat];
  if (!seat || seat.id !== playerId) return { ok: false, error: "not_your_turn" };
  const tile = currentTile(state);
  if (!tile) return { ok: false, error: "bag_empty" };

  let rot = rotation;
  if (!isLegalPlacement(state.placement, cellId, tile, rot)) {
    const cell = state.planet.cells[cellId];
    if (!cell) return { ok: false, error: "illegal" };
    let found = false;
    for (let r = 0; r < cell.sides; r++) {
      if (isLegalPlacement(state.placement, cellId, tile, r)) {
        rot = r;
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, error: "illegal" };
  }

  if (!placeTile(state.placement, cellId, tile, rot)) {
    return { ok: false, error: "illegal" };
  }
  completePlacementTurn(state);
  return { ok: true };
}

function sampleOffer(state: MatchState): TileDef | null {
  if (
    basesConnected(state.placement) ||
    state.placementTurns >= state.config.placementTurnCap
  ) {
    return null;
  }
  try {
    const tile = sampleNextTile(state.placement, {
      seatCount: state.settings.seatCount,
      tilesPlacedNonBase: state.placementTurns,
      roundIndex: Math.floor(
        state.placementTurns / Math.max(1, state.settings.seatCount),
      ),
      splitChance: state.config.splitChance,
      resources: state.resources,
      towerPointChance: state.config.towerPointChance,
      mineChance: state.config.mineChance,
      rng: state.placementRng,
      forcedSplitRemaining: state.forcedSplitRemaining,
    });
    if (tile.id.startsWith("split-") && state.forcedSplitRemaining > 0) {
      state.forcedSplitRemaining--;
    }
    return tile;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "No tile shape has a legal placement"
    ) {
      throw error;
    }
  }
  autoBridge(state.placement);
  return null;
}

function completePlacementTurn(state: MatchState): void {
  state.placementTurns++;
  state.routeGraph = buildRouteGraph(state.placement);
  if (
    basesConnected(state.placement) ||
    state.placementTurns >= state.config.placementTurnCap
  ) {
    finishPlacement(state);
    return;
  }
  state.currentSeat = (state.currentSeat + 1) % state.players.length;
  state.aiPlacementPulse = 0;
  state.currentOffer = sampleOffer(state);
  if (!state.currentOffer) finishPlacement(state);
}

/** Simple AI intents for a seat — one tile every ~1.2s at 10Hz pulses */
export function runAiPlacement(state: MatchState): void {
  if (state.phase !== "placement" || state.settings.placementMode !== "manual") {
    return;
  }
  const seat = state.players[state.currentSeat];
  if (!seat?.isAi) {
    state.aiPlacementPulse = 0;
    return;
  }
  state.aiPlacementPulse++;
  if (state.aiPlacementPulse < 12) return;
  state.aiPlacementPulse = 0;

  const tile = currentTile(state);
  if (!tile) return;
  const options = findLegalPlacements(state.placement, tile);
  if (options.length === 0) return;
  const pick = chooseAiPlacement(state, options);
  intentPlaceTile(state, seat.id, pick.cellId, pick.rotation);
}

function chooseAiPlacement(
  state: MatchState,
  options: { cellId: number; rotation: number }[],
): { cellId: number; rotation: number } {
  return options[
    Math.floor(state.placementRng() * options.length) % options.length
  ]!;
}

export function pickSpawnTarget(state: MatchState, owner: PlayerState): string {
  const enemies = state.players.filter(
    (p) => p.alive && p.teamId !== owner.teamId,
  );
  if (enemies.length === 0) return owner.id;

  let best = enemies[0]!;
  let bestCount = owner.assignCounts[best.id] ?? 0;
  let bestPath = pathLength(
    state.routeGraph,
    baseCell(state, owner.id),
    baseCell(state, best.id),
  );
  for (const e of enemies) {
    const c = owner.assignCounts[e.id] ?? 0;
    const plen = pathLength(
      state.routeGraph,
      baseCell(state, owner.id),
      baseCell(state, e.id),
    );
    if (c < bestCount || (c === bestCount && plen < bestPath)) {
      best = e;
      bestCount = c;
      bestPath = plen;
    }
  }
  owner.assignCounts[best.id] = (owner.assignCounts[best.id] ?? 0) + 1;
  return best.id;
}

function baseCell(state: MatchState, playerId: string): number {
  const idx = state.players.findIndex((p) => p.id === playerId);
  return state.planet.baseCellIds[idx] ?? state.planet.baseCellIds[0]!;
}

function playerAtBaseCell(state: MatchState, cellId: number): PlayerState | null {
  const index = state.planet.baseCellIds.indexOf(cellId);
  return index >= 0 ? (state.players[index] ?? null) : null;
}

function refreshBodRoute(state: MatchState, bod: BodInstance): void {
  const owner = state.players.find((player) => player.id === bod.ownerId);
  if (!owner) return;
  const previous =
    bod.pathIndex > 0 ? (bod.path[bod.pathIndex - 1] ?? null) : null;
  let continuation =
    previous === null
      ? pickRandomPathToAliveEnemy(
          state.routeGraph,
          bod.cellId,
          state,
          owner,
          state.placementRng,
        )
      : pickRandomContinuationToAliveEnemy(
          state.routeGraph,
          bod.cellId,
          previous,
          state,
          owner,
          state.placementRng,
        );
  if (!continuation && previous !== null) {
    continuation = pickRandomPathToAliveEnemy(
      state.routeGraph,
      bod.cellId,
      state,
      owner,
      state.placementRng,
    );
  }
  if (!continuation) return;

  bod.path = [
    ...bod.path.slice(0, bod.pathIndex + 1),
    ...continuation.slice(1),
  ];
  const target = playerAtBaseCell(state, continuation[continuation.length - 1]!);
  if (target) bod.targetPlayerId = target.id;
}

export function intentToggleTarget(
  state: MatchState,
  playerId: string,
  targetId: string,
  enabled: boolean,
): { ok: boolean } {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || !(targetId in p.targetEnabled)) return { ok: false };
  p.targetEnabled[targetId] = enabled;
  return { ok: true };
}

export function intentToggleBod(
  state: MatchState,
  playerId: string,
  bodTypeId: string,
  enabled: boolean,
): { ok: boolean } {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || !(bodTypeId in p.bodEnabled)) return { ok: false };
  p.bodEnabled[bodTypeId] = enabled;
  return { ok: true };
}

export function intentToggleFriendlyFire(
  state: MatchState,
  playerId: string,
  towerId: string,
  enabled: boolean,
): { ok: boolean } {
  const t = state.towers.find((x) => x.id === towerId && x.ownerId === playerId);
  if (!t) return { ok: false };
  t.friendlyFire = enabled;
  return { ok: true };
}

export function intentToggleNoEntry(
  state: MatchState,
  playerId: string,
  cellA: number,
  cellB: number,
): { ok: boolean; error?: string } {
  if (state.phase !== "combat") return { ok: false, error: "not_combat" };
  if (!state.players.some((player) => player.id === playerId)) {
    return { ok: false, error: "missing_player" };
  }
  if (!(state.routeGraph.get(cellA) ?? []).includes(cellB)) {
    return { ok: false, error: "not_route_edge" };
  }

  let blocks = state.edgeBlocks.get(playerId);
  if (!blocks) {
    blocks = new Set();
    state.edgeBlocks.set(playerId, blocks);
  }
  const key = edgeKey(cellA, cellB);
  if (blocks.has(key)) blocks.delete(key);
  else blocks.add(key);
  return { ok: true };
}

export function intentBuildTower(
  state: MatchState,
  playerId: string,
  cellId: number,
  typeId?: string,
): { ok: boolean; error?: string } {
  if (state.phase !== "combat") return { ok: false, error: "not_combat" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.alive) return { ok: false, error: "dead" };
  const placed = state.placement.placed.get(cellId);
  if (!placed?.tile.hasTowerPoint) return { ok: false, error: "no_point" };
  if (state.towers.some((t) => t.cellId === cellId)) {
    return { ok: false, error: "occupied" };
  }
  if (state.mines.some((m) => m.cellId === cellId)) {
    return { ok: false, error: "occupied" };
  }
  const resolvedType =
    typeId && player.loadout.some((t) => t.id === typeId)
      ? typeId
      : player.loadout[0]?.id;
  if (!resolvedType) return { ok: false, error: "bad_type" };
  const def = player.loadout.find((t) => t.id === resolvedType);
  if (!def) return { ok: false, error: "bad_type" };
  const cost = filterCostToResources(def.buildCost, state.resources);
  if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
  pay(player.bank, cost);
  state.towers.push({
    id: `tw-${state.nextEntityId++}`,
    cellId,
    ownerId: playerId,
    typeId: resolvedType,
    level: 0,
    friendlyFire: def.friendlyFireDefault,
    cooldown: 0,
  });
  return { ok: true };
}

/** Mines are neutral — claiming is a no-op kept for protocol compatibility. */
export function intentClaimMine(
  _state: MatchState,
  _playerId: string,
  _cellId: number,
): { ok: boolean; error?: string } {
  return { ok: true };
}

export function intentUpgrade(
  state: MatchState,
  playerId: string,
  target: UpgradeTarget,
): { ok: boolean; error?: string } {
  if (state.phase !== "combat") return { ok: false, error: "not_combat" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.alive) return { ok: false, error: "dead" };

  if (target.kind === "tower") {
    const t = state.towers.find(
      (x) => x.id === target.structureId && x.ownerId === playerId,
    );
    if (!t) return { ok: false, error: "missing" };
    const def = resolveTowerDef(state, t);
    if (!def) return { ok: false, error: "missing" };
    const cost = filterCostToResources(
      scaleCost(def.upgradeCost, def.upgradeLevelIncrease, t.level),
      state.resources,
    );
    if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
    pay(player.bank, cost);
    t.level++;
    return { ok: true };
  }

  if (target.kind === "mine") {
    // Neutral mines — upgrades disabled this pass
    return { ok: false, error: "no_mine_upgrade" };
  }

  if (target.kind === "bod") {
    const def = state.config.bods[target.bodTypeId];
    if (!def) return { ok: false, error: "missing" };
    const level = player.bodLevels[target.bodTypeId] ?? 0;
    const cost = filterCostToResources(
      scaleCost(def.upgradeCost, def.upgradeLevelIncrease, level),
      state.resources,
    );
    if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
    pay(player.bank, cost);
    player.bodLevels[target.bodTypeId] = level + 1;
    return { ok: true };
  }

  if (target.kind === "base") {
    if (target.playerId !== playerId) return { ok: false, error: "not_yours" };
    const def = state.config.base;
    const cost = filterCostToResources(
      scaleCost(def.upgradeCost, def.upgradeLevelIncrease, player.baseLevel),
      state.resources,
    );
    if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
    pay(player.bank, cost);
    player.baseLevel++;
    const hpGain = def.upgradeStatIncrease.hp ?? 0;
    player.baseHp += Math.floor(state.config.base.hp * hpGain);
    return { ok: true };
  }

  return { ok: false, error: "bad_target" };
}

function resolveTowerDef(
  state: MatchState,
  t: TowerStructure,
): TowerDef | undefined {
  const owner = state.players.find((p) => p.id === t.ownerId);
  return (
    owner?.loadout.find((d) => d.id === t.typeId) ??
    state.config.towers[t.typeId]
  );
}

function towerPower(state: MatchState, t: TowerStructure): number {
  const def = resolveTowerDef(state, t);
  if (!def) return 0;
  const inc = def.upgradeStatIncrease.power ?? 0;
  return def.power * (1 + inc * t.level);
}

function towerRange(state: MatchState, t: TowerStructure): number {
  const def = resolveTowerDef(state, t);
  if (!def) return 1;
  const inc = def.upgradeStatIncrease.range ?? 0;
  return def.range * (1 + inc * t.level);
}

function bodStats(state: MatchState, owner: PlayerState, typeId: string) {
  const def = state.config.bods[typeId]!;
  const level = owner.bodLevels[typeId] ?? 0;
  const hpInc = def.upgradeStatIncrease.hp ?? 0;
  const resInc = def.upgradeStatIncrease.resistance ?? 0;
  return {
    hp: def.hp * (1 + hpInc * level),
    resistance: Math.min(0.9, def.resistance * (1 + resInc * level)),
    perc: def.resourcePercOnDeath,
    buildTime: def.buildTimeTicks,
    cost: filterCostToResources(def.resourcesToBuild, state.resources),
  };
}

const MAX_BOD_PICKUPS = 12;

function mineVisitAmount(state: MatchState): number {
  const def = state.config.mines.basic ?? Object.values(state.config.mines)[0];
  return def?.amount ?? 2;
}

/** Neutral mine on a placed tile — grant one resource visit to the bod. */
function collectMineIfPresent(state: MatchState, bod: BodInstance): void {
  const placed = state.placement.placed.get(bod.cellId);
  const resourceId = placed?.tile.mineResourceId;
  if (!placed?.tile.hasMine || !resourceId) return;
  if (!state.resources.includes(resourceId)) return;
  const amount = mineVisitAmount(state);
  bod.held[resourceId] = (bod.held[resourceId] ?? 0) + amount;
  if (bod.pickups.length < MAX_BOD_PICKUPS) {
    bod.pickups.push(resourceId);
  }
}

function killBod(
  state: MatchState,
  bod: BodInstance,
  killerPlayerId: string | null,
): void {
  const owner = state.players.find((p) => p.id === bod.ownerId);
  const stats = owner
    ? bodStats(state, owner, bod.typeId)
    : { perc: state.config.bods[bod.typeId]?.resourcePercOnDeath ?? 0.5 };
  if (killerPlayerId) {
    const killer = state.players.find((p) => p.id === killerPlayerId);
    if (killer) {
      addResources(killer.bank, bod.held, stats.perc);
    }
  }
  state.bods = state.bods.filter((b) => b.id !== bod.id);
}

export function tickMatch(state: MatchState): void {
  if (state.phase !== "combat") return;
  state.tick++;

  // Base resource gen
  for (const p of state.players) {
    if (!p.alive) continue;
    const gen = filterCostToResources(
      state.config.base.resourceGenPerTick,
      state.resources,
    );
    const scale = 1 + (state.config.base.upgradeStatIncrease.hp ? 0 : 0);
    // slight gen bump with base level
    addResources(p.bank, gen, 1 + 0.05 * p.baseLevel);
    void scale;
  }

  // Auto-build enqueue (one job per player). Charge happens when the bod spawns.
  for (const p of state.players) {
    if (!p.alive) continue;
    if (state.buildQueue.some((q) => q.playerId === p.id)) continue;
    for (const [typeId, on] of Object.entries(p.bodEnabled)) {
      if (!on) continue;
      const st = bodStats(state, p, typeId);
      if (!canAfford(p.bank, st.cost)) continue;
      state.buildQueue.push({
        playerId: p.id,
        bodTypeId: typeId,
        remaining: st.buildTime,
      });
      break;
    }
  }

  // Progress build queue — spawn only if the owner can still afford the bod
  for (const q of [...state.buildQueue]) {
    q.remaining--;
    if (q.remaining > 0) continue;
    state.buildQueue = state.buildQueue.filter((x) => x !== q);
    const owner = state.players.find((p) => p.id === q.playerId);
    if (!owner?.alive) continue;
    const st = bodStats(state, owner, q.bodTypeId);
    if (!canAfford(owner.bank, st.cost)) continue;
    pay(owner.bank, st.cost);
    const start = baseCell(state, owner.id);
    let path = pickRandomPathToAliveEnemy(
      state.routeGraph,
      start,
      state,
      owner,
      state.placementRng,
    );
    let targetId = path
      ? (playerAtBaseCell(state, path[path.length - 1]!)?.id ?? owner.id)
      : pickSpawnTarget(state, owner);
    if (!path) {
      path = findPath(state.routeGraph, start, baseCell(state, targetId)) ?? [
        start,
      ];
    }
    state.bods.push({
      id: `bod-${state.nextEntityId++}`,
      ownerId: owner.id,
      typeId: q.bodTypeId,
      hp: st.hp,
      maxHp: st.hp,
      cellId: start,
      path,
      pathIndex: 0,
      moveCooldown: state.config.bodMoveEveryTicks,
      held: {},
      pickups: [],
      targetPlayerId: targetId,
      buildRemaining: 0,
    });
  }

  // Towers shoot before movement (v1: single target, power/range only)
  for (const tower of state.towers) {
    if (tower.cooldown > 0) {
      tower.cooldown--;
      continue;
    }
    const owner = state.players.find((p) => p.id === tower.ownerId);
    if (!owner) continue;
    const range = towerRange(state, tower);
    const power = towerPower(state, tower);
    let best: BodInstance | null = null;
    let bestDist = Infinity;
    for (const bod of state.bods) {
      const bodOwner = state.players.find((p) => p.id === bod.ownerId);
      if (!bodOwner) continue;
      const sameTeam = bodOwner.teamId === owner.teamId;
      if (sameTeam && !tower.friendlyFire) continue;
      const dist = pathLength(state.routeGraph, tower.cellId, bod.cellId);
      if (dist > range) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = bod;
      }
    }
    if (!best) continue;
    const bodOwner = state.players.find((p) => p.id === best!.ownerId)!;
    const st = bodStats(state, bodOwner, best.typeId);
    const dmg = power * (1 - st.resistance);
    best.hp -= dmg;
    const def = resolveTowerDef(state, tower);
    const rate = def?.fireRate ?? BASELINE_FIRE_RATE;
    tower.cooldown = towerCooldownTicks(rate);
    if (best.hp <= 0) {
      killBod(state, best, tower.ownerId);
    }
  }

  // Move bods along edges over bodMoveEveryTicks (travel during cooldown, not wait-then-jump)
  for (const bod of [...state.bods]) {
    const currentTarget = state.players.find(
      (player) => player.id === bod.targetPlayerId,
    );
    if (
      bod.pathIndex >= bod.path.length - 1 &&
      (!currentTarget?.alive ||
        currentTarget.teamId ===
          state.players.find((player) => player.id === bod.ownerId)?.teamId)
    ) {
      if (bod.moveCooldown > 0) {
        bod.moveCooldown--;
        continue;
      }
      refreshBodRoute(state, bod);
      if (bod.pathIndex >= bod.path.length - 1) {
        killBod(state, bod, null);
        continue;
      }
    }

    if (bod.pathIndex >= bod.path.length - 1) {
      // Linger on final cell, then strike once
      if (bod.moveCooldown > 0) {
        bod.moveCooldown--;
        continue;
      }
      if (bod.cellId === baseCell(state, bod.targetPlayerId)) {
        const target = state.players.find((p) => p.id === bod.targetPlayerId);
        const owner = state.players.find((p) => p.id === bod.ownerId);
        if (target && owner && target.teamId !== owner.teamId && target.alive) {
          // Damage equals remaining bod HP (damaged bods hit softer)
          target.baseHp -= Math.max(0, bod.hp);
          if (target.baseHp <= 0) {
            target.baseHp = 0;
            target.alive = false;
          }
        }
      }
      killBod(state, bod, null);
      continue;
    }

    bod.moveCooldown--;
    if (bod.moveCooldown > 0) continue;

    refreshBodRoute(state, bod);
    bod.pathIndex++;
    bod.cellId = bod.path[bod.pathIndex]!;
    collectMineIfPresent(state, bod);

    if (bod.pathIndex < bod.path.length - 1) {
      bod.moveCooldown = state.config.bodMoveEveryTicks;
    } else {
      // brief pause on goal before damage
      bod.moveCooldown = Math.max(3, Math.floor(state.config.bodMoveEveryTicks / 2));
    }
  }

  checkWin(state);
}

function checkWin(state: MatchState): void {
  if (state.phase !== "combat") return;

  const alive = state.players.filter((p) => p.alive);
  const aliveTeams = new Set(alive.map((p) => p.teamId));

  if (state.settings.winRule === "last_base") {
    if (aliveTeams.size <= 1) {
      endMatch(state, alive.map((p) => p.id));
    }
    return;
  }

  // timed
  if (
    state.combatEndsAtTick !== null &&
    state.tick >= state.combatEndsAtTick
  ) {
    let bestHp = -1;
    let winners: string[] = [];
    for (const p of state.players) {
      if (p.baseHp > bestHp) {
        bestHp = p.baseHp;
        winners = [p.id];
      } else if (p.baseHp === bestHp) {
        winners.push(p.id);
      }
    }
    endMatch(state, winners);
  }
}

/** Freeze the board: no more combat entities after the match ends. */
function endMatch(state: MatchState, winnerIds: string[]): void {
  state.phase = "ended";
  state.winnerIds = winnerIds;
  state.bods = [];
  state.buildQueue = [];
}

export function runAiCombat(state: MatchState): void {
  if (state.phase !== "combat") return;
  // Throttle: act every 25 ticks so humans can claim pads
  if (state.tick % 25 !== 0) return;
  for (const p of state.players) {
    if (!p.isAi || !p.alive) continue;
    const home = baseCell(state, p.id);
    let built = false;
    for (const [cellId, placed] of state.placement.placed) {
      if (!placed.tile.hasTowerPoint) continue;
      if (state.towers.some((t) => t.cellId === cellId)) continue;
      const dist = pathLength(state.routeGraph, home, cellId);
      if (dist > 4) continue;
      const typeId = p.loadout[0]?.id ?? "basic";
      const r = intentBuildTower(state, p.id, cellId, typeId);
      if (r.ok) {
        built = true;
        break;
      }
    }
    if (!built && (p.bank.stone ?? 0) > 150) {
      intentUpgrade(state, p.id, { kind: "base", playerId: p.id });
    }
  }
}

/** Public snapshot for clients (JSON-safe) */
export function serializeMatch(state: MatchState, viewerId?: string) {
  return {
    id: state.id,
    phase: state.phase,
    tick: state.tick,
    settings: state.settings,
    resources: state.resources,
    bagIndex: state.placementTurns,
    bagTotal: state.config.placementTurnCap,
    currentSeat: state.currentSeat,
    currentPlayerId: state.players[state.currentSeat]?.id ?? null,
    placementMode: state.settings.placementMode,
    currentTile: currentTile(state),
    legalPlacements:
      state.phase === "placement" && state.settings.placementMode === "manual"
        ? (() => {
            const tile = currentTile(state);
            return tile
              ? findLegalPlacements(state.placement, tile)
              : [];
          })()
        : [],
    corridorCellIds: [],
    winnerIds: state.winnerIds,
    combatEndsAtTick: state.combatEndsAtTick,
    planet: {
      size: state.planet.size,
      frequency: state.planet.frequency,
      baseCellIds: state.planet.baseCellIds,
      cells: state.planet.cells.map((c) => ({
        id: c.id,
        sides: c.sides,
        center: c.center,
        neighbors: c.neighbors,
        vertices: c.vertices,
      })),
    },
    placed: [...state.placement.placed.values()].map((p) => ({
      cellId: p.cellId,
      rotation: p.rotation,
      connections: p.connections,
      tile: p.tile,
    })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      isAi: p.isAi,
      bank: p.bank,
      baseHp: p.baseHp,
      baseLevel: p.baseLevel,
      targetEnabled: p.targetEnabled,
      bodEnabled: p.bodEnabled,
      bodLevels: p.bodLevels,
      alive: p.alive,
      baseCellId: baseCell(state, p.id),
      loadout: p.loadout,
    })),
    towers: state.towers,
    mines: state.mines,
    bodMoveEveryTicks: state.config.bodMoveEveryTicks,
    costs: {
      baseUpgradeBase: filterCostToResources(
        state.config.base.upgradeCost,
        state.resources,
      ),
      baseUpgradeLevelIncrease: state.config.base.upgradeLevelIncrease,
      bods: Object.fromEntries(
        Object.entries(state.config.bods).map(([id, def]) => [
          id,
          filterCostToResources(def.resourcesToBuild, state.resources),
        ]),
      ),
      bodUpgrades: Object.fromEntries(
        Object.entries(state.config.bods).map(([id, def]) => [
          id,
          {
            base: filterCostToResources(def.upgradeCost, state.resources),
            levelIncrease: def.upgradeLevelIncrease,
          },
        ]),
      ),
    },
    bods: state.bods.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      typeId: b.typeId,
      hp: b.hp,
      maxHp: b.maxHp,
      cellId: b.cellId,
      path: b.path,
      pathIndex: b.pathIndex,
      moveCooldown: b.moveCooldown,
      held: b.held,
      pickups: b.pickups,
      targetPlayerId: b.targetPlayerId,
    })),
    buildQueue: state.buildQueue,
    ...(viewerId === undefined
      ? {}
      : { myEdgeBlocks: [...(state.edgeBlocks.get(viewerId) ?? [])] }),
  };
}

export type MatchSnapshot = ReturnType<typeof serializeMatch>;
