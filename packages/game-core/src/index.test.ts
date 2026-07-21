import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoBridge,
  autoPlaceBag,
  basesConnected,
  buildPlanet,
  buildRouteGraph,
  canAfford,
  createMatch,
  createPlacementState,
  createRng,
  defaultTowerLoadout,
  deriveTowerCosts,
  generateTileBag,
  defaultGameConfig,
  findPath,
  intentBuildTower,
  normalizeTowerForResources,
  parseLoadoutFile,
  pay,
  scaleCost,
  scoreTowerPoints,
  scoreTowerPointsRaw,
  serializeMatch,
  startingBankFor,
  TOWER_POINT_POOL,
  tickMatch,
  towerCooldownTicks,
  runAiPlacement,
  validateLoadout,
  validateTowerDef,
} from "./index.js";

describe("goldberg planet", () => {
  it("has exactly 12 pentagons for each size", () => {
    for (const size of ["small", "medium", "large"] as const) {
      const planet = buildPlanet(size, 4);
      const pents = planet.cells.filter((c: { sides: number }) => c.sides === 5);
      assert.equal(pents.length, 12, size);
      assert.ok(planet.cells.length > 12);
      assert.equal(planet.baseCellIds.length, 4);
      for (const id of planet.baseCellIds) {
        assert.equal(planet.cells[id]!.sides, 5, "bases must be pentagons");
      }
    }
  });

  it("neighbors are symmetric", () => {
    const planet = buildPlanet("small", 2);
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        assert.ok(
          planet.cells[n]!.neighbors.includes(cell.id),
          `${cell.id} <-> ${n}`,
        );
      }
    }
  });

  it("places 2 bases nearly antipodal and 4 well separated", () => {
    const two = buildPlanet("small", 2);
    assert.equal(two.baseCellIds.length, 2);
    const a = two.cells[two.baseCellIds[0]!]!.center;
    const b = two.cells[two.baseCellIds[1]!]!.center;
    const dot =
      (a.x * b.x + a.y * b.y + a.z * b.z) /
      (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    assert.ok(dot < -0.85, `expected near-opposite bases, dot=${dot}`);

    const four = buildPlanet("medium", 4);
    assert.equal(four.baseCellIds.length, 4);
    let minDot = 1;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const p = four.cells[four.baseCellIds[i]!]!.center;
        const q = four.cells[four.baseCellIds[j]!]!.center;
        const d =
          (p.x * q.x + p.y * q.y + p.z * q.z) /
          (Math.hypot(p.x, p.y, p.z) * Math.hypot(q.x, q.y, q.z));
        if (d < minDot) minDot = d;
      }
    }
    // Regular tetrahedron cos⁻¹(1/3) ≈ 109.5° → dot ≈ -1/3
    assert.ok(minDot < -0.15, `expected tetrahedral spread, minDot=${minDot}`);
  });
});

describe("placement", () => {
  it("auto-places and connects bases via bridge if needed", () => {
    const planet = buildPlanet("small", 2);
    const state = createPlacementState(planet);
    const bag = generateTileBag(defaultGameConfig, "small", 42);
    const rng = createRng(42);
    autoPlaceBag(state, bag, rng);
    if (!basesConnected(state)) autoBridge(state);
    assert.equal(basesConnected(state), true);
    const graph = buildRouteGraph(state);
    const path = findPath(
      graph,
      planet.baseCellIds[0]!,
      planet.baseCellIds[1]!,
    );
    assert.ok(path && path.length >= 1);
  });

  it("corridor network links every base pair without dead-end stubs", () => {
    const match = createMatch({
      id: "corr",
      seed: 3,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 3,
        seatCount: 3,
      },
      seats: [
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
        { id: "p3", name: "C", isAi: true },
      ],
    });
    assert.equal(match.phase, "combat");
    const bases = match.planet.baseCellIds;
    assert.equal(bases.length, 3);
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const path = findPath(match.routeGraph, bases[i]!, bases[j]!);
        assert.ok(path && path.length >= 2, `path ${i}-${j}`);
      }
    }
    // Corridor cells only: every placed non-base tile is on a corridor cell
    for (const [id, placed] of match.placement.placed) {
      if (match.planet.baseCellIds.includes(id)) continue;
      assert.ok(
        match.corridors.cellIds.has(id),
        `non-corridor placement ${id}`,
      );
      void placed;
    }
    const towers = [...match.placement.placed.values()].filter(
      (p) =>
        p.tile.hasTowerPoint &&
        !match.planet.baseCellIds.includes(p.cellId),
    ).length;
    assert.ok(towers >= 5, `expected ≥5 tower pads, got ${towers}`);
    assert.ok(
      match.corridors.cellIds.size >=
        Math.floor(match.planet.cells.length * 0.75),
      `corridor fill ${match.corridors.cellIds.size}/${match.planet.cells.length}`,
    );
  });
});

describe("match combat", () => {
  it("runs auto placement into combat and ticks", () => {
    const match = createMatch({
      id: "test",
      seed: 7,
      settings: {
        mode: "ffa",
        winRule: "timed",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 3,
        seatCount: 2,
        timedSeconds: 5,
      },
      seats: [
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
      ],
    });
    assert.equal(match.phase, "combat");
    assert.ok(basesConnected(match.placement));
    for (let i = 0; i < 30; i++) tickMatch(match);
    assert.ok(match.tick === 30);
    const snap = serializeMatch(match);
    assert.equal(snap.players.length, 2);
    assert.ok(snap.planet.cells.length > 0);
  });

  it("tower cooldown uses fireRate", () => {
    const fastTower = {
      id: "fast",
      power: 1,
      range: 1,
      fireRate: 10,
      buildDiscount: 0,
      upgradeDiscount: 0,
      aoeSize: 0,
      aoeFade: 0,
      jump: 0,
      jumpLoss: 0,
      slowPower: 0,
      shotGivesPercent: 0,
      shootCost: {},
      buildCost: { stone: 1 },
      upgradeCost: { stone: 1 },
      upgradeStatIncrease: { power: 0.15, range: 0.1 },
      upgradeLevelIncrease: 1.35,
      friendlyFireDefault: false,
    };
    const match = createMatch({
      id: "firerate",
      seed: 1,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 3,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: false, loadout: [fastTower] },
        { id: "p2", name: "B", isAi: false },
      ],
    });
    for (const p of match.players) {
      p.bodEnabled = { grunt: false, bruiser: false };
    }
    const arena = match.planet.baseCellIds[0]!;
    match.bods.push({
      id: "bod-x",
      ownerId: "p2",
      typeId: "grunt",
      hp: 100,
      maxHp: 100,
      cellId: arena,
      path: [arena, match.planet.baseCellIds[1]!],
      pathIndex: 0,
      moveCooldown: 0,
      held: {},
      targetPlayerId: "p1",
      buildRemaining: 0,
    });
    match.towers.push({
      id: "tw-x",
      cellId: arena,
      ownerId: "p1",
      typeId: "fast",
      level: 0,
      friendlyFire: false,
      cooldown: 0,
    });
    tickMatch(match);
    assert.equal(match.towers[0]!.cooldown, 1);
  });

  it("death loot credits killer bank", () => {
    const match = createMatch({
      id: "loot",
      seed: 1,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 3,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
      ],
    });
    for (const p of match.players) {
      p.bodEnabled = { grunt: false, bruiser: false };
    }
    const arena = match.planet.baseCellIds[0]!;
    const startStone = match.players[0]!.bank.stone ?? 0;
    // Mid-path bod (not yet at goal) so towers get the kill credit
    match.bods.push({
      id: "bod-x",
      ownerId: "p2",
      typeId: "grunt",
      hp: 1,
      maxHp: 40,
      cellId: arena,
      path: [arena, match.planet.baseCellIds[1]!],
      pathIndex: 0,
      moveCooldown: 0,
      held: { stone: 100 },
      targetPlayerId: "p1",
      buildRemaining: 0,
    });
    match.towers.push({
      id: "tw-x",
      cellId: arena,
      ownerId: "p1",
      typeId: "basic",
      level: 0,
      friendlyFire: false,
      cooldown: 0,
    });
    tickMatch(match);
    const after = match.players[0]!.bank.stone ?? 0;
    assert.ok(after >= startStone + 50, `expected loot, ${startStone} -> ${after}`);
  });

  it("starting bank buys one basic tower but not two", () => {
    const resources = ["stone", "water", "power"];
    const bank = startingBankFor(defaultGameConfig, resources);
    const cost = defaultGameConfig.towers.basic!.buildCost;
    assert.equal(canAfford(bank, cost), true);
    pay(bank, cost);
    assert.equal(canAfford(bank, cost), false);
    assert.ok((bank.stone ?? 0) >= 4, "buffer left for cheap bods");
  });

  it("upgrade costs scale with level", () => {
    const base = { stone: 40, power: 30 };
    const l0 = scaleCost(base, 1.35, 0);
    const l1 = scaleCost(base, 1.35, 1);
    assert.equal(l0.stone, 40);
    assert.ok((l1.stone ?? 0) > (l0.stone ?? 0));
  });

  it("default tower loadout is point-legal", () => {
    for (const n of [2, 3] as const) {
      const loadout = defaultTowerLoadout(n);
      assert.equal(loadout.length, 3);
      const v = validateLoadout(loadout, n);
      assert.equal(v.ok, true, v.ok ? "" : v.errors.join("; "));
      for (const t of loadout) {
        assert.equal(t.fireRate, 6, `${t.id} fireRate for ${n} resources`);
        assert.ok(
          scoreTowerPoints(t, n) <= TOWER_POINT_POOL,
          `${t.id} score ${scoreTowerPoints(t, n)}`,
        );
      }
    }
    const loadout = defaultTowerLoadout(3);
    const broken = { ...loadout[0]!, power: 40, range: 6 };
    assert.equal(validateTowerDef(broken, 3).ok, false);
  });

  it("v2 scoring and derived costs respect resourceCount", () => {
    assert.equal(towerCooldownTicks(6), 5);
    assert.equal(towerCooldownTicks(1), 10);
    assert.equal(towerCooldownTicks(10), 1);

    const example = normalizeTowerForResources(
      {
        id: "t",
        power: 8,
        range: 2,
        fireRate: 4,
        buildDiscount: 0,
        upgradeDiscount: 0,
        aoeSize: 0,
        aoeFade: 0,
        jump: 0,
        jumpLoss: 0,
        slowPower: 0,
        shotGivesPercent: 0,
        shootCost: {},
        buildCost: {},
        upgradeCost: {},
        upgradeStatIncrease: { power: 0.15, range: 0.1 },
        upgradeLevelIncrease: 1.35,
        friendlyFireDefault: false,
      },
      3,
    );
    assert.equal(scoreTowerPointsRaw(example, 3), 102);
    const costs = deriveTowerCosts(example, 3);
    assert.deepEqual(costs.buildCost, { stone: 44, power: 52, water: 30 });
    assert.deepEqual(costs.upgradeCost, { stone: 24, power: 28, water: 18 });

    for (const n of [2, 3] as const) {
      const loadout = defaultTowerLoadout(n);
      assert.equal(validateLoadout(loadout, n).ok, true);
      for (const t of loadout) {
        assert.ok(scoreTowerPoints(t, n) <= TOWER_POINT_POOL);
        if (n === 2) {
          assert.equal(t.fireRate, 6);
          assert.equal(t.buildDiscount, 0);
          assert.equal(t.upgradeDiscount, 0);
          assert.equal(t.buildCost.water, undefined);
        } else {
          assert.ok((t.buildCost.water ?? 0) > 0 || t.fireRate >= 1);
        }
      }
    }

    const rejected = parseLoadoutFile(
      { version: 1, kind: "tdw-tower-loadout", towers: [] },
      3,
    );
    assert.equal(rejected.ok, false);
  });

  it("discount steps apply ceil(base * (1 - steps*0.05))", () => {
    const def = {
      id: "disc",
      power: 8,
      range: 2,
      fireRate: 4,
      buildDiscount: 2,
      upgradeDiscount: 0,
      aoeSize: 0,
      aoeFade: 0,
      jump: 0,
      jumpLoss: 0,
      slowPower: 0,
      shotGivesPercent: 0,
      shootCost: {},
      buildCost: {},
      upgradeCost: {},
      upgradeStatIncrease: { power: 0.15, range: 0.1 },
      upgradeLevelIncrease: 1.35,
      friendlyFireDefault: false,
    };
    const costs = deriveTowerCosts(def, 3);
    assert.deepEqual(costs.buildCost, { stone: 40, power: 47, water: 27 });
    assert.deepEqual(costs.upgradeCost, { stone: 24, power: 28, water: 18 });
  });

  it("validateLoadout returns normalized authoritative towers", () => {
    const raw = {
      id: "t",
      power: 5,
      range: 2,
      fireRate: 3,
      buildDiscount: 2,
      upgradeDiscount: 0,
      aoeSize: 0,
      aoeFade: 0,
      jump: 0,
      jumpLoss: 0,
      slowPower: 0,
      shotGivesPercent: 0,
      shootCost: {},
      buildCost: { stone: 999, power: 999, water: 999 },
      upgradeCost: { stone: 999, power: 999, water: 999 },
      upgradeStatIncrease: { power: 0.15, range: 0.1 },
      upgradeLevelIncrease: 1.35,
      friendlyFireDefault: false,
    };
    const v = validateLoadout([raw], 3);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.deepEqual(v.towers[0]!.buildCost, {
      stone: 40,
      power: 36,
      water: 23,
    });

    const v2 = validateLoadout([{ ...raw, fireRate: 10, buildDiscount: 5 }], 2);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.towers[0]!.fireRate, 6);
    assert.equal(v2.towers[0]!.buildDiscount, 0);
    assert.equal(v2.towers[0]!.upgradeDiscount, 0);
    assert.equal(v2.towers[0]!.buildCost.water, undefined);
  });

  it("buildTower uses loadout typeId and cost", () => {
    const match = createMatch({
      id: "loadout-build",
      seed: 3,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 3,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
      ],
    });
    const pad = [...match.placement.placed.values()].find(
      (p) => p.tile.hasTowerPoint,
    );
    assert.ok(pad, "need a tower pad");
    const sniper = match.players[0]!.loadout.find((t) => t.id === "sniper");
    assert.ok(sniper);
    match.players[0]!.bank = {
      stone: sniper!.buildCost.stone ?? 0,
      power: sniper!.buildCost.power ?? 0,
      water: sniper!.buildCost.water ?? 0,
    };
    const r = intentBuildTower(match, "p1", pad!.cellId, "sniper");
    assert.equal(r.ok, true, r.error);
    assert.equal(match.towers[0]?.typeId, "sniper");
    assert.equal(match.players[0]!.bank.stone, 0);
    const snap = serializeMatch(match);
    assert.ok(snap.players[0]!.loadout.some((t) => t.id === "sniper"));
  });

  it("two-resource matches charge tower builds in stone and power", () => {
    const match = createMatch({
      id: "two-resource-power-build",
      seed: 4,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 2,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
      ],
    });
    assert.deepEqual(match.resources, ["stone", "power"]);
    const pad = [...match.placement.placed.values()].find(
      (p) => p.tile.hasTowerPoint,
    );
    assert.ok(pad, "need a tower pad");
    const basic = match.players[0]!.loadout.find((t) => t.id === "basic");
    assert.ok(basic);
    match.players[0]!.bank = {
      stone: basic!.buildCost.stone ?? 0,
      power: basic!.buildCost.power ?? 0,
      water: 99,
    };

    const result = intentBuildTower(match, "p1", pad!.cellId, "basic");
    assert.equal(result.ok, true, result.error);
    assert.equal(match.players[0]!.bank.stone, 0);
    assert.equal(match.players[0]!.bank.power, 0);
    assert.equal(match.players[0]!.bank.water, 99);
  });

  it("manual placement waits on human; AI does not dump the bag", () => {
    const match = createMatch({
      id: "manual",
      seed: 99,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "manual",
        resourceCount: 3,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "Human", isAi: false },
        { id: "p2", name: "Bot", isAi: true },
      ],
    });
    assert.equal(match.phase, "placement");
    assert.equal(match.settings.placementMode, "manual");
    assert.equal(match.currentSeat, 0);
    const placedBefore = match.placement.placed.size;
    for (let i = 0; i < 40; i++) runAiPlacement(match);
    assert.equal(match.placement.placed.size, placedBefore);
    assert.equal(match.currentSeat, 0);
  });
});
