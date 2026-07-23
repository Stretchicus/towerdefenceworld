# Route-end placement & no-entry routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow roads only from castle stubs / open ends with dynamic legal tile sampling until all castles connect; drag-drop place + RMB rotate; combat uses random alive-enemy branches and per-player no-entry signs (Targets HUD removed).

**Architecture:** Replace corridor-mask match flow with grow-from-ends APIs in `tiles/` (`openEnds`, stricter legality, `sampleNextTile`). Match sim draws one placeable tile per turn and finishes when `basesConnected`. Client gains drag-drop placement and combat edge picking. Server sends per-viewer snapshots so enemy no-entries stay hidden.

**Tech Stack:** TypeScript monorepo (`@tdw/game-core`, `@tdw/server`, `@tdw/client`), node:test, Three.js.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-route-ends-placement-and-no-entry-design.md`
- Always commit meaningful work and push (`always-push` rule).
- TDD for game-core network/routing; client verified with build + manual smoke notes.
- Do not redesign mines/tower combat math beyond attaching flags on sampled tiles.
- Open-end definition: a **placeable empty cell** adjacent to a placed tile across a **mutual-intent open stub** (placed tile has that edge open; empty cell will attach there). Closed edges never create ends.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/game-core/src/tiles/openEnds.ts` | Compute open ends; edge keys |
| `packages/game-core/src/tiles/shapes.ts` | Straight / bend / T / cross templates |
| `packages/game-core/src/tiles/sampleTile.ts` | Weighted legal tile sampling |
| `packages/game-core/src/tiles/placement.ts` | Single-stub bases; open-end-only legality |
| `packages/game-core/src/sim/routing.ts` | Random branch pick; block-aware next hop |
| `packages/game-core/src/sim/match.ts` | Match wiring; no-entry; finish rules; serialize viewer |
| `packages/game-core/src/types.ts` + `defaultGameConfig` / JSON | `splitChance`, `placementTurnCap` |
| `packages/server/src/room.ts` | Per-seat serialize; `toggleNoEntry` |
| `packages/client/src/planetView.ts` | Drag ghost tile; RMB rotate; edge pick; no-entry meshes |
| `packages/client/src/main.ts` | Drop/place; remove Targets; no-entry UI state |
| `packages/game-core/src/index.test.ts` | Core tests |

Corridor APIs may remain in repo unused by match flow (do not delete in this plan unless a task explicitly removes dead imports).

---

### Task 1: Open ends + single-stub castle init

**Files:**
- Create: `packages/game-core/src/tiles/openEnds.ts`
- Modify: `packages/game-core/src/tiles/placement.ts` (`createPlacementState`)
- Modify: `packages/game-core/src/index.ts` (exports)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `export type OpenEnd = { cellId: number; fromCellId: number; edgeOnFrom: number };`
  - `export function edgeKey(a: number, b: number): string` → `` `${Math.min(a,b)}:${Math.max(a,b)}` ``
  - `export function listOpenEnds(state: PlacementState): OpenEnd[]`
  - `createPlacementState(planet, rng?: () => number)` — each base gets **exactly one** random open edge; other edges closed

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test -w @tdw/game-core`

- [ ] **Step 3: Implement**

`listOpenEnds`: for each placed tile, for each open connection `i`, if `neighbors[i]` is empty (not in `placed`), push `{ cellId: neighbor, fromCellId: tile.cellId, edgeOnFrom: i }`.

`createPlacementState`: pick `edge = floor(rng()*cell.sides)`; set `connections[edge]=true` only.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit + push**

```bash
git add packages/game-core/src/tiles/openEnds.ts packages/game-core/src/tiles/placement.ts packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(tiles): single-stub castles and open-end listing"
git push
```

---

### Task 2: Open-end-only placement legality

**Files:**
- Modify: `packages/game-core/src/tiles/placement.ts` (`isLegalPlacement`, `findLegalPlacements`)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `listOpenEnds`
- Produces: `isLegalPlacement` returns true only if `cellId` is in `listOpenEnds(...).map(e => e.cellId)` **and** existing edge-compatibility / mutual-open attach rules hold (including attaching via the stub that made it an end)

- [ ] **Step 1: Failing test** — place a tile two cells away from any stub → illegal; place on the open-end neighbour with matching straight → legal.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** — at start of `isLegalPlacement`, if `!listOpenEnds(state).some(e => e.cellId === cellId) return false`. Keep Carcassonne mutual open/closed checks against placed neighbours.

- [ ] **Step 4: PASS + commit + push**

```bash
git commit -m "feat(tiles): only allow placement on open route ends"
```

---

### Task 3: Tile shapes + legal sampler

**Files:**
- Create: `packages/game-core/src/tiles/shapes.ts`
- Create: `packages/game-core/src/tiles/sampleTile.ts`
- Modify: `packages/game-core/src/types.ts` (`GameConfig.splitChance: number`, `placementTurnCap: number`)
- Modify: `packages/game-core/config/defaultGame.json`, `defaultGameConfig.ts` (`splitChance: 0.22`, `placementTurnCap: 200`)
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `export type TileShapeId = "straight" | "bend" | "split" | "cross";`
  - `export function shapeConnections(id: TileShapeId): boolean[]` with exact masks:
    - straight: `[true, false, false, true, false, false]`
    - bend: `[true, false, true, false, false, false]`
    - split (T): `[true, false, true, false, true, false]`
    - cross: `[true, true, true, true, false, false]` (four consecutive opens; rare, join pressure only)
  - `export interface SampleTileOpts { seatCount: number; tilesPlacedNonBase: number; roundIndex: number; /* floor(tilesPlaced/seatCount) */ splitChance: number; resources: string[]; towerPointChance: number; mineChance: number; rng: () => number; forcedSplitRemaining?: number; }`
  - `export function sampleNextTile(state: PlacementState, opts: SampleTileOpts): TileDef`
  - Logic: build candidate list of `{ shape, tile }` that have `findLegalPlacements(state, tile).length > 0`. Weight: if join pressure (`!basesConnected` and (componentCount>1 or two ends adjacent)), boost bends/straights that appear in merge-capable placements; apply 2p/3p split rules from spec; decorate mine/pad with existing chances + `pickMineResource`.

- [ ] **Step 1: Tests**
  - Sampler never returns a tile with zero legal placements on a 2-base stub board.
  - 3 seats: within first 3 sampled tiles after successive place+resample, at least one `routeKind === "branch"` (or shape split) — test via controlled rng seed loop.
  - 2 seats: first `seatCount` samples have no splits when `tilesPlacedNonBase < seatCount`.

- [ ] **Step 2–4: Implement until PASS**

- [ ] **Step 5: Commit + push**

```bash
git commit -m "feat(tiles): weighted legal tile sampler with split rules"
```

---

### Task 4: Match flow uses grow-from-ends (retire corridor bag)

**Files:**
- Modify: `packages/game-core/src/sim/match.ts` (`MatchState`, `createMatch`, `currentTile`, `intentPlaceTile`, `finishPlacement`, `runAiPlacement`, `runAutoPlacement`)
- Modify: `packages/game-core/src/index.test.ts` (corridor-specific tests → open-end / connect tests)
- Modify exports if `corridors` removed from state

**Interfaces:**
- Produces:
  - `MatchState.currentOffer: TileDef | null` (replace bag cursor for manual)
  - `MatchState.placementTurns: number`
  - `MatchState.forcedSplitRemaining: number` (3p: start at 1 until a split is offered/placed)
  - Remove dependence on `tileBag` / `corridors` for placement legality (may keep fields unused temporarily or delete)
  - `createMatch`: `createPlacementState(planet, rng)`; `currentOffer = sampleNextTile(...)`; no `buildCorridorNetwork` for bag
  - `intentPlaceTile`: use `isLegalPlacement` + `placeTile` (not corridor); then `placementTurns++`; if `basesConnected` → `finishPlacement`; else refresh `currentOffer = sampleNextTile`; advance seat
  - `finishPlacement`: **do not** `fillCorridorPlacement`; if not connected and `placementTurns >= placementTurnCap`, `autoBridge`; then `routeGraph = buildRouteGraph`; phase combat
  - Auto mode: loop AI place until connected or cap, then finish

- [ ] **Step 1: Update/replace tests** that assume corridor masks; add `createMatch` manual place until `basesConnected` with AI helper or seeded places.

- [ ] **Step 2: Implement match wiring**

- [ ] **Step 3: `npm run test -w @tdw/game-core` PASS**

- [ ] **Step 4: Commit + push**

```bash
git commit -m "feat(match): grow-from-ends placement until bases connect"
```

---

### Task 5: Client drag-drop placement + RMB / second-finger rotate

**Files:**
- Modify: `packages/client/src/planetView.ts` (pointer handlers; remove wheel/twist tile rotate; add drag ghost)
- Modify: `packages/client/src/main.ts` (wire drop → `placeTile`; rotate on contextmenu / second tap)

**Interfaces:**
- Produces callbacks on `PlanetView`:
  - `onTileDrop?: (cellId: number, rotation: number) => void`
  - `onTileRotateRequest?: (dir: 1 | -1) => void` (RMB / second finger)
- Ghost: while dragging in placement, show translucent connections preview at hovered legal end; only those cells in `legalCellIds` accept drop.
- Remove: wheel → rotate, two-finger twist → rotate (pinch zoom may remain).
- Keep HUD rotate buttons calling same `rotatePlacement`.

- [ ] **Step 1: Implement pointer state machine** (`idle | draggingTile`) separate from orbit drag (orbit only when not dragging tile / empty background).

- [ ] **Step 2: Build client** `npm run build -w @tdw/client`

- [ ] **Step 3: Commit + push**

```bash
git commit -m "feat(client): drag-drop tile placement and click-to-rotate"
```

---

### Task 6: Random branch routing + remove Targets

**Files:**
- Create: `packages/game-core/src/sim/routing.ts`
- Modify: `packages/game-core/src/sim/match.ts` (bod spawn path; `pickSpawnTarget`; remove `targetEnabled` usage)
- Modify: `packages/client/src/main.ts` (remove Targets HUD + `toggleTarget` handlers)
- Modify: `packages/server/src/room.ts` (keep handler as no-op or remove message)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `export function reachesAliveEnemy(graph, start, from, viaNeighbor, state, ownerTeamId): boolean`
  - `export function pickRandomPathToAliveEnemy(graph, start, state, owner, rng): number[] | null` — at each junction with multiple forward options that still reach an alive enemy castle, choose uniformly; build full path (or recompute hop-by-hop each step — prefer **recompute next hop each move** so no-entry updates apply).
  - Bod move: instead of fixed `path` only, store `path` as planned but **refresh next hop** when `pathIndex` advances if graph/blocks changed; minimum: on spawn call picker; on each step at node with degree>2, re-roll among legal next cells.
- `pickSpawnTarget`: alive enemies only; remove `targetEnabled` filter (can leave field deprecated unused or delete from `PlayerState` + snapshot).

- [ ] **Step 1: Tests** for junction random among two equal reaching branches (seeded); ignores dead bases.

- [ ] **Step 2: Implement + remove client Targets UI**

- [ ] **Step 3: Tests + builds PASS; commit + push**

```bash
git commit -m "feat(combat): random alive-enemy branches; remove Targets control"
```

---

### Task 7: No-entry state, intent, per-viewer snapshot

**Files:**
- Modify: `packages/game-core/src/sim/match.ts`
- Modify: `packages/server/src/room.ts` (`broadcastState` per seat)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `MatchState.edgeBlocks: Map<string /* playerId */, Set<string /* edgeKey */>>`
  - `export function intentToggleNoEntry(state, playerId, cellA, cellB): { ok, error? }` — combat only; edge must exist in `routeGraph`
  - `serializeMatch(state, viewerId?: string)` — includes `myEdgeBlocks: string[]` only for `viewerId`; never other players’ blocks
  - `broadcastState`: for each seat with `send`, `serializeMatch(room.match, seat.id)`

- [ ] **Step 1: Tests** — toggle adds/removes key; serialize for A hides B’s blocks.

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit + push**

```bash
git commit -m "feat(combat): per-player no-entry edges with private snapshots"
```

---

### Task 8: Bod respect no-entry + reverse + own-castle damage

**Files:**
- Modify: `packages/game-core/src/sim/routing.ts`, `match.ts` (bod step / castle contact)
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: owner’s `edgeBlocks`
- On choose next cell: exclude neighbours where `edgeKey(curr,n)` is blocked **for bod owner**.
- If no forward legal options toward alive enemy: choose previous cell (reverse) if unblocked; else any unblocked neighbour; if enter `owner.baseCellId`, apply same damage path as enemy contact (`baseHp` reduction / kill handling already used when enemy reaches base).

- [ ] **Step 1: Tests**
  - Blocked branch skipped when alternate exists.
  - Fully blocked forward → path reverses.
  - Reverse into own base damages own `baseHp`.

- [ ] **Step 2: Implement until PASS**

- [ ] **Step 3: Commit + push**

```bash
git commit -m "feat(combat): no-entry avoidance, reverse, and friendly castle damage"
```

---

### Task 9: Client no-entry click + signs

**Files:**
- Modify: `packages/client/src/planetView.ts` (pick road edge on click in combat; render no-entry disc/sign for `myEdgeBlocks` only)
- Modify: `packages/client/src/main.ts` (`toggleNoEntry` send; map snapshot blocks into view data)
- Modify: `packages/client/src/styles.css` if HUD hint needed (“click a road to block”)

**Interfaces:**
- `PlanetViewData.myEdgeBlocks?: { cellA: number; cellB: number }[]`
- `onRoadEdgeClick?: (cellA: number, cellB: number) => void`
- Visual: simple red “no entry” ring/sprite mid-edge, outward-oriented; only own blocks.

- [ ] **Step 1: Implement pick + mesh sync**

- [ ] **Step 2: Client build PASS**

- [ ] **Step 3: Commit + push**

```bash
git commit -m "feat(client): toggle and render private no-entry signs"
```

---

### Task 10: Changelog, version bump, verify, ship

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `packages/client/src/main.ts` (`CLIENT_BUILD` → `v0.1.55` or next)

- [ ] **Step 1: Changelog** covering placement rework, drag-drop, no-entry, Targets removal

- [ ] **Step 2: Verify**

```bash
npm run test -w @tdw/game-core
npm run build -w @tdw/game-core
npm run build -w @tdw/server
npm run build -w @tdw/client
```

- [ ] **Step 3: Commit + push**

```bash
git commit -m "docs: changelog for route-end placement and no-entry (v0.1.55)"
git push
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Drag/drop + RMB/2nd-finger rotate; no twist/wheel | 5 |
| Castle single random road stub | 1 |
| Place only on open ends; any player any end | 2, 4 |
| Legal sampling; 2p/3p split rules; join pressure | 3 |
| End when bases connected; turn-cap auto-bridge | 4 |
| Random branches to alive enemy castles | 6 |
| Remove Targets / targetEnabled control | 6 |
| No-entry unlimited, own bods only, private snapshot | 7–9 |
| Reverse + own castle damage | 8 |
| Mines/pads still on tiles | 3 (decorate sample) |

## Self-review notes

- Fixed ambiguous “closed edges become ends” → **open** edges facing empty create ends (Global Constraints).
- Cross shape: implementer must pick one explicit boolean mask in `shapes.ts` and keep tests aligned.
- Per-viewer serialize requires server broadcast change (Task 7) — do not leave as shared snapshot or fog fails.
