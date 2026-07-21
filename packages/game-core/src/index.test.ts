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
  generateTileBag,
  defaultGameConfig,
  findPath,
  pay,
  scaleCost,
  serializeMatch,
  startingBankFor,
  tickMatch,
  runAiPlacement,
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
