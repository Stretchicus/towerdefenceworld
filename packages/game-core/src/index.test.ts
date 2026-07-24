import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoPlaceBag,
  basesConnected,
  buildFlatHexPlanet,
  flatHexBoundaryId,
  buildPlanet,
  canAfford,
  createMatch,
  createPlacementState,
  createRng,
  currentTile,
  edgeKey,
  isLegalPlacement,
  listOpenEnds,
  makeTile,
  defaultTowerLoadout,
  deriveTowerCosts,
  generateTileBag,
  defaultGameConfig,
  findPath,
  findLegalPlacements,
  intentBuildTower,
  intentToggleNoEntry,
  normalizeTowerForResources,
  parseLoadoutFile,
  pay,
  pickRandomPathToAliveEnemy,
  pickSpawnTarget,
  placeTile,
  placementNetworkComplete,
  sampleNextTile,
  scaleCost,
  scoreTowerPoints,
  scoreTowerPointsRaw,
  serializeMatch,
  shapeConnections,
  startingBankFor,
  TOWER_POINT_POOL,
  tickMatch,
  towerCooldownTicks,
  maxSliderValue,
  runAiPlacement,
  validateLoadout,
  validateTowerDef,
  type MatchState,
} from "./index.js";

function flushCountdown(match: MatchState): void {
  let guard = 0;
  while (match.phase === "countdown" && guard++ < 1000) tickMatch(match);
}
describe("flat hex planet", () => {
  it("buildFlatHexPlanet links axial neighbours symmetrically", () => {
    const playable = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ];
    const planet = buildFlatHexPlanet(playable);
    const boundaryId = flatHexBoundaryId(playable.length);
    const playableIds = new Set([0, 1, 2]);

    assert.equal(planet.cells.length, 4);

    for (const id of playableIds) {
      const cell = planet.cells[id]!;
      assert.equal(cell.sides, 6);
      assert.equal(cell.neighbors.length, 6);
    }

    assert.ok(planet.cells[0]!.neighbors.includes(1));
    assert.ok(planet.cells[1]!.neighbors.includes(0));
    assert.ok(planet.cells[0]!.neighbors.includes(2));
    assert.ok(planet.cells[2]!.neighbors.includes(0));

    for (const id of playableIds) {
      for (const n of planet.cells[id]!.neighbors) {
        if (!playableIds.has(n)) {
          assert.equal(n, boundaryId);
        }
      }
    }

    const withBase = buildFlatHexPlanet(playable, {
      baseCoords: [{ q: 0, r: 0 }],
    });
    assert.deepEqual(withBase.baseCellIds, [0]);

    assert.throws(
      () =>
        buildFlatHexPlanet(playable, { baseCoords: [{ q: 5, r: 5 }] }),
      /not in playable set/,
    );
  });
});

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

  it("neighbors[i] faces geometric edge i", () => {
    const planet = buildPlanet("small", 2);
    for (const cell of planet.cells) {
      const c = cell.center;
      for (let i = 0; i < cell.neighbors.length; i++) {
        const va = cell.vertices[i]!;
        const vb = cell.vertices[(i + 1) % cell.vertices.length]!;
        const mid = {
          x: (va.x + vb.x) * 0.5,
          y: (va.y + vb.y) * 0.5,
          z: (va.z + vb.z) * 0.5,
        };
        const edgeDir = {
          x: mid.x - c.x,
          y: mid.y - c.y,
          z: mid.z - c.z,
        };
        let best = 0;
        let bestDot = -Infinity;
        for (let k = 0; k < cell.neighbors.length; k++) {
          const n = planet.cells[cell.neighbors[k]!]!.center;
          const dir = { x: n.x - c.x, y: n.y - c.y, z: n.z - c.z };
          const dot =
            dir.x * edgeDir.x + dir.y * edgeDir.y + dir.z * edgeDir.z;
          if (dot > bestDot) {
            bestDot = dot;
            best = k;
          }
        }
        assert.equal(
          best,
          i,
          `cell ${cell.id} edge ${i} best neighbor index ${best}`,
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
  it("uses the canonical tile shape masks", () => {
    assert.deepEqual(shapeConnections("straight"), [
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    assert.deepEqual(shapeConnections("bend"), [
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    assert.deepEqual(shapeConnections("split"), [
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    assert.deepEqual(shapeConnections("cross"), [
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("samples only tiles with a legal placement", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const planet = buildPlanet("small", 2);
      const rng = createRng(seed);
      const state = createPlacementState(planet, rng);
      const tile = sampleNextTile(state, {
        seatCount: 2,
        tilesPlacedNonBase: 0,
        roundIndex: 0,
        splitChance: 0.22,
        resources: ["stone", "power"],
        towerPointChance: 0.35,
        mineChance: 0.2,
        rng,
      });
      assert.ok(findLegalPlacements(state, tile).length > 0, `seed ${seed}`);
    }
  });

  it("offers a 3-seat split early only when a non-increasing placement exists", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const planet = buildPlanet("small", 3);
      const rng = createRng(seed);
      const state = createPlacementState(planet, rng);
      let forcedSplitRemaining = 1;
      for (let placed = 0; placed < 3; placed++) {
        const beforeEnds = listOpenEnds(state).length;
        const splitLegal = findLegalPlacements(
          state,
          makeTile("probe-split", shapeConnections("split")),
        ).length > 0;
        const tile = sampleNextTile(state, {
          seatCount: 3,
          tilesPlacedNonBase: placed,
          roundIndex: 0,
          splitChance: 0.22,
          resources: ["stone", "power", "water"],
          towerPointChance: 0.35,
          mineChance: 0.2,
          rng,
          forcedSplitRemaining,
        });
        const isSplit = tile.id.startsWith("split-");
        if (isSplit) {
          assert.ok(splitLegal, `seed ${seed}: split offered without legal placement`);
          forcedSplitRemaining = 0;
        } else if (forcedSplitRemaining > 0 && placed === 2) {
          assert.equal(
            splitLegal,
            false,
            `seed ${seed}: expected forced split when legal, or no legal split`,
          );
        }
        const legal = findLegalPlacements(state, tile);
        assert.ok(legal.length > 0, `seed ${seed}, offer ${placed}`);
        const choice = legal[Math.floor(rng() * legal.length)]!;
        assert.equal(placeTile(state, choice.cellId, tile, choice.rotation), true);
        assert.ok(
          listOpenEnds(state).length <= beforeEnds,
          `seed ${seed}: placement must not increase open ends`,
        );
      }
    }
  });

  it("placements that increase open ends are always illegal", () => {
    const planet = buildPlanet("small", 2);
    const placement = createPlacementState(planet, createRng(5));
    const before = listOpenEnds(placement).length;
    assert.ok(before >= 2);
    const split = makeTile("early-split", shapeConnections("split"));
    let sawIncreasing = false;
    for (const end of listOpenEnds(placement)) {
      const cell = planet.cells[end.cellId]!;
      for (let r = 0; r < cell.sides; r++) {
        const connections = split.connections.slice(0, cell.sides).map((_, i) => {
          return split.connections[(i - r + cell.sides) % cell.sides] ?? false;
        });
        while (connections.length < cell.sides) connections.push(false);
        const placed = new Map(placement.placed);
        placed.set(end.cellId, {
          cellId: end.cellId,
          tile: split,
          rotation: r,
          connections,
        });
        const after = listOpenEnds({ ...placement, placed }).length;
        if (after <= before) continue;
        sawIncreasing = true;
        assert.equal(
          isLegalPlacement(placement, end.cellId, split, r),
          false,
          `must reject open-end increase at ${end.cellId} rot ${r}`,
        );
      }
    }
    assert.ok(sawIncreasing, "expected at least one increasing split rotation on day-1 stubs");
  });
  it("does not sample splits in the first 2-seat round", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const planet = buildPlanet("small", 2);
      const rng = createRng(seed);
      const state = createPlacementState(planet, rng);
      for (let placed = 0; placed < 2; placed++) {
        const tile = sampleNextTile(state, {
          seatCount: 2,
          tilesPlacedNonBase: placed,
          roundIndex: 0,
          splitChance: 1,
          resources: ["stone", "power"],
          towerPointChance: 0,
          mineChance: 0,
          rng,
        });
        assert.equal(tile.routeKind, "single", `seed ${seed}, offer ${placed}`);
        const legal = findLegalPlacements(state, tile);
        assert.ok(legal.length > 0);
        const choice = legal[Math.floor(rng() * legal.length)]!;
        assert.equal(placeTile(state, choice.cellId, tile, choice.rotation), true);
      }
    }
  });

  it("only allows placement on open route ends", () => {
    const planet = buildPlanet("small", 2);
    const rng = createRng(1);
    const placement = createPlacementState(planet, rng);
    const straight = makeTile("straight", [true, false, false, true, false, false]);
    const openEndIds = new Set(listOpenEnds(placement).map((e) => e.cellId));

    const stubId = planet.baseCellIds[0]!;
    let farCellId: number | null = null;
    const seen = new Set<number>([stubId]);
    for (const mid of planet.cells[stubId]!.neighbors) {
      seen.add(mid);
      for (const n of planet.cells[mid]!.neighbors) {
        if (seen.has(n)) continue;
        if (placement.placed.has(n)) continue;
        if (openEndIds.has(n)) continue;
        farCellId = n;
        break;
      }
      if (farCellId !== null) break;
    }
    assert.ok(farCellId !== null, "need a cell two hops from a stub");
    const farCell = planet.cells[farCellId]!;
    for (let r = 0; r < farCell.sides; r++) {
      assert.equal(
        isLegalPlacement(placement, farCellId, straight, r),
        false,
        `far cell rotation ${r}`,
      );
    }

    const end = listOpenEnds(placement)[0]!;
    const endCell = planet.cells[end.cellId]!;
    let legal = false;
    for (let r = 0; r < endCell.sides; r++) {
      if (isLegalPlacement(placement, end.cellId, straight, r)) {
        legal = true;
        break;
      }
    }
    assert.ok(legal, "expected legal straight on open-end neighbour");
  });

  it("each base starts with exactly one open edge and one open end", () => {
    const planet = buildPlanet("small", 2);
    const rng = createRng(1);
    const placement = createPlacementState(planet, rng);
    for (const id of planet.baseCellIds) {
      const opens = placement.placed.get(id)!.connections.filter(Boolean).length;
      assert.equal(opens, 1);
    }
    const ends = listOpenEnds(placement);
    assert.equal(ends.length, planet.baseCellIds.length);
  });

  it("auto-places tiles from single-stub bases", () => {
    const planet = buildPlanet("small", 2);
    const rng = createRng(42);
    const state = createPlacementState(planet, rng);
    const bag = generateTileBag(defaultGameConfig, "small", 42);
    autoPlaceBag(state, bag, rng);
    assert.ok(state.placed.size > planet.baseCellIds.length);
  });

  it("auto placement grows from base ends until every base connects", () => {
    const match = createMatch({
      id: "grow-auto",
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
    assert.equal(match.phase, "countdown");
    assert.ok(
      placementNetworkComplete(match.placement),
      "auto finish must leave a clean network (no open stubs / spur tips)",
    );
    assert.equal(
      listOpenEnds(match.placement).length,
      0,
      "auto finish must have zero open stubs",
    );
    // No non-base cul-de-sacs
    for (const [cellId, nbrs] of match.routeGraph) {
      if (match.planet.baseCellIds.includes(cellId)) continue;
      assert.ok(
        (nbrs?.length ?? 0) >= 2,
        `spur tip at ${cellId}`,
      );
    }
    flushCountdown(match);
    assert.equal(match.phase, "combat");
    const bases = match.planet.baseCellIds;
    assert.equal(bases.length, 3);
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const path = findPath(match.routeGraph, bases[i]!, bases[j]!);
        assert.ok(path && path.length >= 2, `path ${i}-${j}`);
      }
    }
  });

  it("finishes manual placement when the initial offer is unavailable", () => {
    const match = createMatch({
      id: "no-initial-offer",
      seed: 3,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "manual",
        resourceCount: 2,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
      ],
      config: {
        ...defaultGameConfig,
        placementTurnCap: 0,
      },
    });

    assert.equal(match.currentOffer, null);
    assert.equal(match.phase, "countdown");
    flushCountdown(match);
    assert.equal(match.phase, "combat");
  });

  it("3-seat early offers never increase open ends", () => {
    const match = createMatch({
      id: "forced-split",
      seed: 1,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "manual",
        resourceCount: 3,
        seatCount: 3,
      },
      seats: [
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
        { id: "p3", name: "C", isAi: true },
      ],
    });

    for (let turn = 0; turn < 3 && match.phase === "placement"; turn++) {
      const before = listOpenEnds(match.placement).length;
      const offer = currentTile(match);
      assert.ok(offer);
      for (let pulse = 0; pulse < 12; pulse++) runAiPlacement(match);
      assert.ok(
        listOpenEnds(match.placement).length <= before,
        `turn ${turn} increased open ends`,
      );
    }
  });

  it("manual placement consumes offers and finishes when bases connect", () => {
    const match = createMatch({
      id: "grow-manual",
      seed: 17,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "manual",
        resourceCount: 2,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
      ],
    });

    while (match.phase === "placement") {
      const offer = currentTile(match);
      assert.ok(offer, "placement phase must expose an offer");
      const legal = findLegalPlacements(match.placement, offer);
      assert.ok(legal.length > 0, "offer must have a legal open-end placement");
      const before = match.placementTurns;
      for (let pulse = 0; pulse < 12; pulse++) runAiPlacement(match);
      assert.equal(match.placementTurns, before + 1);
    }

    assert.ok(basesConnected(match.placement));
    assert.ok(placementNetworkComplete(match.placement));
    assert.equal(listOpenEnds(match.placement).length, 0);
    assert.equal(match.currentOffer, null);
  });

  it("legal placements never increase open-end count after connect", () => {
    const planet = buildPlanet("small", 2);
    const placement = createPlacementState(planet, createRng(2));
    let guard = 0;
    while (!basesConnected(placement) && guard++ < 200) {
      const tile = sampleNextTile(placement, {
        seatCount: 2,
        tilesPlacedNonBase: guard,
        roundIndex: Math.floor(guard / 2),
        splitChance: 0.5,
        resources: ["stone", "power"],
        towerPointChance: 0,
        mineChance: 0,
        rng: createRng(100 + guard),
      });
      const legal = findLegalPlacements(placement, tile);
      if (legal.length === 0) break;
      placeTile(placement, legal[0]!.cellId, tile, legal[0]!.rotation);
    }
    assert.ok(basesConnected(placement), "expected connected board");
    if (listOpenEnds(placement).length === 0) return;

    const before = listOpenEnds(placement).length;
    const split = makeTile("cleanup-split", shapeConnections("split"));
    for (const opt of findLegalPlacements(placement, split)) {
      const cell = planet.cells[opt.cellId]!;
      const connections = split.connections.slice(0, cell.sides).map((_, i) => {
        return (
          split.connections[(i - opt.rotation + cell.sides) % cell.sides] ?? false
        );
      });
      while (connections.length < cell.sides) connections.push(false);
      const placed = new Map(placement.placed);
      placed.set(opt.cellId, {
        cellId: opt.cellId,
        tile: split,
        rotation: opt.rotation,
        connections,
      });
      assert.ok(
        listOpenEnds({ ...placement, placed }).length <= before,
        "legal placement must not increase open ends",
      );
    }
  });
});

describe("match combat", () => {
  it("toggles a player's no-entry block on an existing route edge", () => {
    const match = createMatch({
      id: "no-entry-toggle",
      seed: 7,
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
    const [cellA, neighbors] = match.routeGraph.entries().next().value!;
    const cellB = neighbors[0]!;
    const key = edgeKey(cellA, cellB);

    assert.deepEqual(intentToggleNoEntry(match, "p1", cellA, cellB), {
      ok: true,
    });
    assert.equal(match.edgeBlocks.get("p1")?.has(key), true);

    assert.deepEqual(intentToggleNoEntry(match, "p1", cellB, cellA), {
      ok: true,
    });
    assert.equal(match.edgeBlocks.get("p1")?.has(key), false);
  });

  it("serializes only the viewing player's no-entry blocks", () => {
    const match = createMatch({
      id: "no-entry-private",
      seed: 7,
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
    const edges = [...match.routeGraph].flatMap(([cellA, neighbors]) =>
      neighbors
        .filter((cellB) => cellA < cellB)
        .map((cellB) => [cellA, cellB] as const),
    );
    assert.ok(edges.length >= 2);
    const [a1, a2] = edges[0]!;
    const [b1, b2] = edges[1]!;
    assert.equal(intentToggleNoEntry(match, "p1", a1, a2).ok, true);
    assert.equal(intentToggleNoEntry(match, "p2", b1, b2).ok, true);

    assert.deepEqual(serializeMatch(match, "p1").myEdgeBlocks, [
      edgeKey(a1, a2),
    ]);
    assert.deepEqual(serializeMatch(match, "p2").myEdgeBlocks, [
      edgeKey(b1, b2),
    ]);
    assert.equal("myEdgeBlocks" in serializeMatch(match), false);
  });

  it("chooses seeded random branches that reach an alive enemy castle", () => {
    const graph = new Map<number, number[]>([
      [0, [1]],
      [1, [0, 2, 3]],
      [2, [1, 4]],
      [3, [1, 5]],
      [4, [2]],
      [5, [3]],
    ]);
    const state = {
      players: [
        { id: "p1", teamId: "a", alive: true },
        { id: "p2", teamId: "b", alive: true },
        { id: "p3", teamId: "c", alive: true },
      ],
      planet: { baseCellIds: [0, 4, 5] },
    };

    assert.deepEqual(
      pickRandomPathToAliveEnemy(
        graph,
        0,
        state,
        state.players[0]!,
        createRng(7),
      ),
      [0, 1, 2, 4],
    );
    assert.deepEqual(
      pickRandomPathToAliveEnemy(
        graph,
        0,
        state,
        state.players[0]!,
        createRng(1),
      ),
      [0, 1, 3, 5],
    );
  });

  it("does not route to dead enemy castles", () => {
    const graph = new Map<number, number[]>([
      [0, [1]],
      [1, [0, 2, 3]],
      [2, [1, 4]],
      [3, [1, 5]],
      [4, [2]],
      [5, [3]],
    ]);
    const state = {
      players: [
        { id: "p1", teamId: "a", alive: true },
        { id: "p2", teamId: "b", alive: false },
        { id: "p3", teamId: "c", alive: true },
      ],
      planet: { baseCellIds: [0, 4, 5] },
    };

    assert.deepEqual(
      pickRandomPathToAliveEnemy(
        graph,
        0,
        state,
        state.players[0]!,
        createRng(7),
      ),
      [0, 1, 3, 5],
    );
  });

  it("re-rolls the forward branch when a bod moves through a junction", () => {
    const match = createMatch({
      id: "junction-reroute",
      seed: 1,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 2,
        seatCount: 3,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
        { id: "p3", name: "C", isAi: false },
      ],
    });
    flushCountdown(match);
    match.planet.baseCellIds = [0, 4, 5];
    match.routeGraph = new Map([
      [0, [1]],
      [1, [0, 2, 3]],
      [2, [1, 4]],
      [3, [1, 5]],
      [4, [2]],
      [5, [3]],
    ]);
    match.placementRng = createRng(1);
    for (const player of match.players) {
      player.bodEnabled = { grunt: false, bruiser: false };
    }
    match.bods.push({
      id: "bod-junction",
      ownerId: "p1",
      typeId: "grunt",
      hp: 40,
      maxHp: 40,
      cellId: 1,
      path: [0, 1, 2, 4],
      pathIndex: 1,
      moveCooldown: 0,
      held: {},
      pickups: [],
      targetPlayerId: "p2",
      buildRemaining: 0,
    });

    tickMatch(match);

    assert.equal(match.bods[0]!.cellId, 3);
    assert.equal(match.bods[0]!.targetPlayerId, "p3");
  });

  it("skips an owner-blocked branch when another enemy branch is open", () => {
    const match = createMatch({
      id: "blocked-junction-reroute",
      seed: 1,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 2,
        seatCount: 3,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
        { id: "p3", name: "C", isAi: false },
      ],
    });
    flushCountdown(match);
    match.planet.baseCellIds = [0, 4, 5];
    match.routeGraph = new Map([
      [0, [1]],
      [1, [0, 2, 3]],
      [2, [1, 4]],
      [3, [1, 5]],
      [4, [2]],
      [5, [3]],
    ]);
    match.edgeBlocks.get("p1")!.add(edgeKey(1, 3));
    match.placementRng = createRng(1);
    for (const player of match.players) {
      player.bodEnabled = { grunt: false, bruiser: false };
    }
    match.bods.push({
      id: "bod-blocked-junction",
      ownerId: "p1",
      typeId: "grunt",
      hp: 40,
      maxHp: 40,
      cellId: 1,
      path: [0, 1, 3, 5],
      pathIndex: 1,
      moveCooldown: 0,
      held: {},
      pickups: [],
      targetPlayerId: "p3",
      buildRemaining: 0,
    });

    tickMatch(match);

    assert.equal(match.bods[0]!.cellId, 2);
    assert.equal(match.bods[0]!.targetPlayerId, "p2");
  });

  it("reverses when every forward route is owner-blocked", () => {
    const match = createMatch({
      id: "blocked-forward-reverse",
      seed: 1,
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
    flushCountdown(match);
    match.planet.baseCellIds = [0, 2];
    match.routeGraph = new Map([
      [0, [1]],
      [1, [0, 2]],
      [2, [1]],
    ]);
    match.edgeBlocks.get("p1")!.add(edgeKey(1, 2));
    for (const player of match.players) {
      player.bodEnabled = { grunt: false, bruiser: false };
    }
    match.bods.push({
      id: "bod-reverse",
      ownerId: "p1",
      typeId: "grunt",
      hp: 40,
      maxHp: 40,
      cellId: 1,
      path: [0, 1, 2],
      pathIndex: 1,
      moveCooldown: 0,
      held: {},
      pickups: [],
      targetPlayerId: "p2",
      buildRemaining: 0,
    });

    tickMatch(match);

    assert.equal(match.bods[0]!.cellId, 0);
    assert.equal(match.bods[0]!.targetPlayerId, "p1");
  });

  it("damages the owner's castle after reversing into it", () => {
    const match = createMatch({
      id: "reverse-friendly-castle-damage",
      seed: 1,
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
    flushCountdown(match);
    match.planet.baseCellIds = [0, 2];
    match.routeGraph = new Map([
      [0, [1]],
      [1, [0, 2]],
      [2, [1]],
    ]);
    match.edgeBlocks.get("p1")!.add(edgeKey(1, 2));
    match.config.bodMoveEveryTicks = 1;
    for (const player of match.players) {
      player.bodEnabled = { grunt: false, bruiser: false };
    }
    const owner = match.players[0]!;
    const hpBefore = owner.baseHp;
    match.bods.push({
      id: "bod-friendly-castle",
      ownerId: owner.id,
      typeId: "grunt",
      hp: 40,
      maxHp: 40,
      cellId: 1,
      path: [0, 1, 2],
      pathIndex: 1,
      moveCooldown: 0,
      held: {},
      pickups: [],
      targetPlayerId: "p2",
      buildRemaining: 0,
    });

    for (let i = 0; i < 5; i++) tickMatch(match);

    assert.equal(owner.baseHp, hpBefore - 40);
    assert.equal(match.bods.length, 0);
  });

  it("picks alive spawn targets even when legacy target flags are disabled", () => {
    const match = createMatch({
      id: "alive-target",
      seed: 3,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 2,
        seatCount: 3,
      },
      seats: [
        { id: "p1", name: "A", isAi: false },
        { id: "p2", name: "B", isAi: false },
        { id: "p3", name: "C", isAi: false },
      ],
    });
    const owner = match.players[0]!;
    owner.targetEnabled.p2 = false;
    owner.targetEnabled.p3 = false;
    match.players[1]!.alive = false;

    assert.equal(pickSpawnTarget(match, owner), "p3");
  });

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
    assert.equal(match.phase, "countdown");
    flushCountdown(match);
    assert.equal(match.phase, "combat");
    assert.ok(basesConnected(match.placement));
    for (let i = 0; i < 30; i++) tickMatch(match);
    assert.ok(match.tick >= 30);
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
    flushCountdown(match);
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
      pickups: [],
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

  it("assigns mineResourceId from active resources on corridor tiles", () => {
    const match = createMatch({
      id: "mine-res",
      seed: 99,
      settings: {
        mode: "ffa",
        winRule: "last_base",
        worldSize: "small",
        placementMode: "auto",
        resourceCount: 2,
        seatCount: 2,
      },
      seats: [
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
      ],
    });
    assert.deepEqual(match.resources, ["stone", "power"]);
    const mineTiles = [...match.placement.placed.values()].filter(
      (p) => p.tile.hasMine,
    );
    assert.ok(mineTiles.length > 0, "expected some mine tiles");
    for (const p of mineTiles) {
      assert.ok(
        p.tile.mineResourceId === "stone" || p.tile.mineResourceId === "power",
        `unexpected resource ${p.tile.mineResourceId}`,
      );
    }
  });

  it("pays bod build cost from the owner bank when the bod is created", () => {
    const match = createMatch({
      id: "bod-cost",
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
        { id: "p1", name: "A", isAi: true },
        { id: "p2", name: "B", isAi: true },
      ],
    });
    flushCountdown(match);
    // No passive income so the debit is unambiguous
    match.config.base.resourceGenPerTick = {};
    for (const p of match.players) {
      p.bodEnabled = { grunt: true, bruiser: false };
      p.bank = { stone: 20, water: 20, power: 20 };
    }
    const cost = {
      stone: match.config.bods.grunt!.resourcesToBuild.stone ?? 0,
      water: match.config.bods.grunt!.resourcesToBuild.water ?? 0,
    };
    const p1 = match.players[0]!;
    const beforeStone = p1.bank.stone!;
    const beforeWater = p1.bank.water!;
    const buildTicks = match.config.bods.grunt!.buildTimeTicks;
    for (let i = 0; i < buildTicks - 1; i++) tickMatch(match);
    assert.equal(match.bods.filter((b) => b.ownerId === "p1").length, 0);
    assert.equal(p1.bank.stone, beforeStone);
    assert.equal(p1.bank.water, beforeWater);
    tickMatch(match);
    assert.equal(match.bods.filter((b) => b.ownerId === "p1").length, 1);
    assert.equal(p1.bank.stone, beforeStone - cost.stone);
    assert.equal(p1.bank.water, beforeWater - cost.water);
  });

  it("does not create a bod when the owner cannot afford it", () => {
    const match = createMatch({
      id: "bod-broke",
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
    flushCountdown(match);
    match.config.base.resourceGenPerTick = {};
    const p1 = match.players[0]!;
    p1.bodEnabled = { grunt: true, bruiser: false };
    p1.bank = { stone: 20, water: 20, power: 20 };
    // Start a build while funded
    tickMatch(match);
    assert.ok(match.buildQueue.some((q) => q.playerId === "p1"));
    // Drain funds before the bod would spawn
    p1.bank = { stone: 0, water: 0, power: 0 };
    const buildTicks = match.config.bods.grunt!.buildTimeTicks;
    for (let i = 0; i < buildTicks + 5; i++) tickMatch(match);
    assert.equal(match.bods.filter((b) => b.ownerId === "p1").length, 0);
    assert.equal(p1.bank.stone, 0);
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
    flushCountdown(match);
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
      pickups: ["stone"],
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
    assert.equal(loadout[0]!.visualId, "keep");
    assert.equal(loadout[1]!.visualId, "orb");
    assert.equal(loadout[2]!.visualId, "orbit");
    const broken = { ...loadout[0]!, power: 40, range: 6 };
    assert.equal(validateTowerDef(broken, 3).ok, false);
  });

  it("slider maxes fit pool when other stats are at minimum", () => {
    assert.equal(maxSliderValue("power", 2), 17);
    assert.equal(maxSliderValue("range", 2), 6);
    assert.equal(maxSliderValue("buildDiscount", 2), 8);
    assert.equal(maxSliderValue("upgradeDiscount", 2), 3);
    assert.equal(maxSliderValue("power", 3), 15);
    assert.equal(maxSliderValue("range", 3), 5);
    assert.equal(maxSliderValue("fireRate", 3), 10);
    assert.equal(maxSliderValue("buildDiscount", 3), 7);
    assert.equal(maxSliderValue("upgradeDiscount", 3), 2);
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

    const v2 = validateLoadout([{ ...raw, fireRate: 10, buildDiscount: 2 }], 2);
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.towers[0]!.fireRate, 6);
    assert.equal(v2.towers[0]!.buildDiscount, 2);
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
