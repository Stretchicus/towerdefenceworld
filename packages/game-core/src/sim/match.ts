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
import { generateTileBag } from "../tiles/bag.js";
import {
  autoBridge,
  autoPlaceBag,
  basesConnected,
  buildRouteGraph,
  createPlacementState,
  findLegalPlacements,
  placeTile,
  type PlacementState,
} from "../tiles/placement.js";
import { findPath, pathLength } from "./pathfinding.js";
import type {
  GameConfig,
  LobbySettings,
  MatchPhase,
  Planet,
  ResourceMap,
  TileDef,
  UpgradeTarget,
} from "../types.js";

export interface PlayerState {
  id: string;
  name: string;
  teamId: string;
  isAi: boolean;
  bank: ResourceMap;
  baseHp: number;
  baseLevel: number;
  /** Other player ids this player wants to attack (all true at start) */
  targetEnabled: Record<string, boolean>;
  /** Bod type id → enabled for auto-build */
  bodEnabled: Record<string, boolean>;
  bodLevels: Record<string, number>;
  /** Spawn assignment counters for round-robin */
  assignCounts: Record<string, number>;
  alive: boolean;
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
  held: ResourceMap;
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
  tileBag: TileDef[];
  bagIndex: number;
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
  seats: { id: string; name: string; isAi: boolean }[];
  config?: GameConfig;
}

export function createMatch(input: CreateMatchInput): MatchState {
  const config = input.config ?? defaultGameConfig;
  const settings = { ...input.settings };
  if (settings.mode === "teams" && settings.seatCount === 3) {
    settings.mode = "ffa";
  }
  const resources = activeResources(config, settings.resourceCount);
  const planet = buildPlanet(settings.worldSize, settings.seatCount);
  const placement = createPlacementState(planet);
  const tileBag = generateTileBag(config, settings.worldSize, input.seed);
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
    tileBag,
    bagIndex: 0,
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
  };

  if (settings.placementMode === "auto") {
    runAutoPlacement(state);
  }

  return state;
}

function runAutoPlacement(state: MatchState): void {
  const rng = createRng(state.seed ^ 0x9e3779b9);
  const remaining = state.tileBag.slice(state.bagIndex);
  autoPlaceBag(state.placement, remaining, rng);
  state.bagIndex = state.tileBag.length;
  finishPlacement(state);
}

export function finishPlacement(state: MatchState): void {
  if (!basesConnected(state.placement)) {
    autoBridge(state.placement);
  }
  state.routeGraph = buildRouteGraph(state.placement);
  state.phase = "combat";
  const seconds =
    state.settings.timedSeconds ?? state.config.timedMatchSeconds;
  if (state.settings.winRule === "timed") {
    state.combatEndsAtTick = state.tick + seconds * state.config.tickRateHz;
  }
}

export function currentTile(state: MatchState): TileDef | null {
  if (state.bagIndex >= state.tileBag.length) return null;
  return state.tileBag[state.bagIndex]!;
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
  if (!placeTile(state.placement, cellId, tile, rotation)) {
    return { ok: false, error: "illegal" };
  }
  state.bagIndex++;
  state.routeGraph = buildRouteGraph(state.placement);
  advancePlacementTurn(state);
  return { ok: true };
}

function advancePlacementTurn(state: MatchState): void {
  if (state.bagIndex >= state.tileBag.length) {
    finishPlacement(state);
    return;
  }
  // Skip if no legal moves for current tile — discard and continue
  const tile = currentTile(state);
  if (tile && findLegalPlacements(state.placement, tile).length === 0) {
    state.bagIndex++;
    if (state.bagIndex >= state.tileBag.length) {
      finishPlacement(state);
      return;
    }
  }
  state.currentSeat = (state.currentSeat + 1) % state.players.length;
}

export function pickSpawnTarget(state: MatchState, owner: PlayerState): string {
  const enemies = state.players.filter(
    (p) => p.alive && p.teamId !== owner.teamId,
  );
  if (enemies.length === 0) return owner.id;

  const enabled = enemies.filter((e) => owner.targetEnabled[e.id] !== false);
  const pool = enabled.length > 0 ? enabled : enemies;

  // least-assigned / round-robin with path-length tiebreak
  let best = pool[0]!;
  let bestCount = owner.assignCounts[best.id] ?? 0;
  let bestPath = pathLength(
    state.routeGraph,
    baseCell(state, owner.id),
    baseCell(state, best.id),
  );
  for (const e of pool) {
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

export function intentBuildTower(
  state: MatchState,
  playerId: string,
  cellId: number,
  typeId = "basic",
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
  const def = state.config.towers[typeId];
  if (!def) return { ok: false, error: "bad_type" };
  const cost = filterCostToResources(def.buildCost, state.resources);
  if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
  pay(player.bank, cost);
  state.towers.push({
    id: `tw-${state.nextEntityId++}`,
    cellId,
    ownerId: playerId,
    typeId,
    level: 0,
    friendlyFire: def.friendlyFireDefault,
    cooldown: 0,
  });
  // Auto-claim mine on same tile if present and unclaimed
  if (placed.tile.hasMine && !state.mines.some((m) => m.cellId === cellId)) {
    const mineType = placed.tile.mineTypeId ?? "basic";
    state.mines.push({
      id: `mn-${state.nextEntityId++}`,
      cellId,
      ownerId: playerId,
      typeId: mineType,
      level: 0,
    });
  }
  return { ok: true };
}

export function intentClaimMine(
  state: MatchState,
  playerId: string,
  cellId: number,
): { ok: boolean; error?: string } {
  if (state.phase !== "combat") return { ok: false, error: "not_combat" };
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.alive) return { ok: false, error: "dead" };
  const placed = state.placement.placed.get(cellId);
  if (!placed?.tile.hasMine) return { ok: false, error: "no_mine" };
  if (state.mines.some((m) => m.cellId === cellId)) {
    return { ok: false, error: "claimed" };
  }
  const mineType = placed.tile.mineTypeId ?? "basic";
  const def = state.config.mines[mineType];
  if (!def) return { ok: false, error: "bad_type" };
  state.mines.push({
    id: `mn-${state.nextEntityId++}`,
    cellId,
    ownerId: playerId,
    typeId: mineType,
    level: 0,
  });
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
    const def = state.config.towers[t.typeId]!;
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
    const m = state.mines.find(
      (x) => x.id === target.structureId && x.ownerId === playerId,
    );
    if (!m) return { ok: false, error: "missing" };
    const def = state.config.mines[m.typeId]!;
    const cost = filterCostToResources(
      scaleCost(def.upgradeCost, def.upgradeLevelIncrease, m.level),
      state.resources,
    );
    if (!canAfford(player.bank, cost)) return { ok: false, error: "funds" };
    pay(player.bank, cost);
    m.level++;
    return { ok: true };
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

function towerPower(state: MatchState, t: TowerStructure): number {
  const def = state.config.towers[t.typeId]!;
  const inc = def.upgradeStatIncrease.power ?? 0;
  return def.power * (1 + inc * t.level);
}

function towerRange(state: MatchState, t: TowerStructure): number {
  const def = state.config.towers[t.typeId]!;
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

function mineGenerated(state: MatchState, m: MineStructure): ResourceMap {
  const def = state.config.mines[m.typeId]!;
  const out: ResourceMap = {};
  for (const [k, v] of Object.entries(def.generated)) {
    if (!state.resources.includes(k)) continue;
    const inc = def.upgradeGeneratedIncrease[k] ?? 0;
    out[k] = v * (1 + inc * m.level);
  }
  return out;
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

  // Auto-build enqueue
  for (const p of state.players) {
    if (!p.alive) continue;
    if (state.buildQueue.some((q) => q.playerId === p.id)) continue;
    for (const [typeId, on] of Object.entries(p.bodEnabled)) {
      if (!on) continue;
      const st = bodStats(state, p, typeId);
      if (!canAfford(p.bank, st.cost)) continue;
      pay(p.bank, st.cost);
      state.buildQueue.push({
        playerId: p.id,
        bodTypeId: typeId,
        remaining: st.buildTime,
      });
      break;
    }
  }

  // Progress build queue
  for (const q of [...state.buildQueue]) {
    q.remaining--;
    if (q.remaining > 0) continue;
    state.buildQueue = state.buildQueue.filter((x) => x !== q);
    const owner = state.players.find((p) => p.id === q.playerId);
    if (!owner?.alive) continue;
    const st = bodStats(state, owner, q.bodTypeId);
    const targetId = pickSpawnTarget(state, owner);
    const start = baseCell(state, owner.id);
    const goal = baseCell(state, targetId);
    const path = findPath(state.routeGraph, start, goal) ?? [start];
    state.bods.push({
      id: `bod-${state.nextEntityId++}`,
      ownerId: owner.id,
      typeId: q.bodTypeId,
      hp: st.hp,
      maxHp: st.hp,
      cellId: start,
      path,
      pathIndex: 0,
      held: {},
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
    tower.cooldown = 2;
    if (best.hp <= 0) {
      killBod(state, best, tower.ownerId);
    }
  }

  // Move bods + mines + base contact
  for (const bod of [...state.bods]) {
    if (bod.pathIndex < bod.path.length - 1) {
      bod.pathIndex++;
      bod.cellId = bod.path[bod.pathIndex]!;
    }

    const mine = state.mines.find((m) => m.cellId === bod.cellId);
    if (mine) {
      addResources(bod.held, mineGenerated(state, mine), 1);
    }

    // Reached end of path → if enemy base cell, damage
    const atGoal =
      bod.pathIndex >= bod.path.length - 1 &&
      bod.cellId === baseCell(state, bod.targetPlayerId);
    if (atGoal) {
      const target = state.players.find((p) => p.id === bod.targetPlayerId);
      const owner = state.players.find((p) => p.id === bod.ownerId);
      if (target && owner && target.teamId !== owner.teamId && target.alive) {
        target.baseHp -= state.config.baseContactDamage;
        if (target.baseHp <= 0) {
          target.baseHp = 0;
          target.alive = false;
        }
      }
      killBod(state, bod, null);
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
      state.phase = "ended";
      state.winnerIds = alive.map((p) => p.id);
    }
    return;
  }

  // timed
  if (
    state.combatEndsAtTick !== null &&
    state.tick >= state.combatEndsAtTick
  ) {
    state.phase = "ended";
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
    state.winnerIds = winners;
  }
}

/** Simple AI intents for a seat */
export function runAiPlacement(state: MatchState): void {
  if (state.phase !== "placement" || state.settings.placementMode !== "manual") {
    return;
  }
  const seat = state.players[state.currentSeat];
  if (!seat?.isAi) return;
  const tile = currentTile(state);
  if (!tile) return;
  const options = findLegalPlacements(state.placement, tile);
  if (options.length === 0) {
    state.bagIndex++;
    advancePlacementTurn(state);
    return;
  }
  const pick = options[0]!;
  intentPlaceTile(state, seat.id, pick.cellId, pick.rotation);
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
      const r = intentBuildTower(state, p.id, cellId, "basic");
      if (r.ok) {
        built = true;
        break;
      }
    }
    if (!built && (p.bank.stone ?? 0) > 100) {
      intentUpgrade(state, p.id, { kind: "base", playerId: p.id });
    }
  }
}

/** Public snapshot for clients (JSON-safe) */
export function serializeMatch(state: MatchState) {
  return {
    id: state.id,
    phase: state.phase,
    tick: state.tick,
    settings: state.settings,
    resources: state.resources,
    bagIndex: state.bagIndex,
    bagTotal: state.tileBag.length,
    currentSeat: state.currentSeat,
    currentTile: currentTile(state),
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
    })),
    towers: state.towers,
    mines: state.mines,
    bods: state.bods.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      typeId: b.typeId,
      hp: b.hp,
      maxHp: b.maxHp,
      cellId: b.cellId,
      held: b.held,
      targetPlayerId: b.targetPlayerId,
    })),
    buildQueue: state.buildQueue,
  };
}

export type MatchSnapshot = ReturnType<typeof serializeMatch>;
