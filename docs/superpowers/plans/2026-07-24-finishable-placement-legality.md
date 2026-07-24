# Finishable Placement Legality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blunt “open-stub count must not increase” legality guard with finishability classification (required / forbidden / constrained-optional edges + pockets) so illegal means “can only ever end as an open/dead stub,” matching SVG examples 1–6.

**Architecture:** Add a dedicated `finishability.ts` module that, for a candidate cell, discovers empty pockets after hypothetically placing there, classifies each edge, and validates a candidate connection mask against those constraints. `isLegalPlacement` keeps attach/Carcassonne checks, then calls `connectionsSatisfyFinishability`. Flat hex fixtures encode examples 1–6 for unit tests; planet play continues to use Goldberg adjacency with the same rules.

**Tech Stack:** TypeScript monorepo (`@tdw/game-core`), `node:test`, existing `PlacementState` / `listOpenEnds` / `rotateConnections`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-finishable-placement-legality-design.md`
- Ship bugfixes straight to `main` (commit + push `origin main`); no feature-branch PR unless asked
- Do **not** reintroduce seal/prune
- Keep `placementNetworkComplete` as finish predicate
- Do **not** add red/blue/green overlays to the live client
- TDD: failing fixture test before implementation for each example cluster
- Frequent commits after each green task

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `packages/game-core/src/tiles/finishability.ts` | Pocket detection; edge class; validate connections |
| Create: `packages/game-core/src/tiles/flatHex.ts` | Tiny flat hex graph builder for SVG-style fixtures |
| Modify: `packages/game-core/src/tiles/placement.ts` | Call finishability from `isLegalPlacement`; remove stub-count guard |
| Modify: `packages/game-core/src/index.ts` | Export finishability helpers used by tests |
| Modify: `packages/game-core/src/index.test.ts` | Replace stub-count tests; add examples 1–6 |
| Modify: `packages/game-core/src/tiles/sampleTile.ts` | Only if comments/weights still assume stub-count (keep legal-only sampling) |
| Modify: `docs/CHANGELOG.md`, `packages/client/src/main.ts` | v0.1.59 notes + `CLIENT_BUILD` |

---

### Task 1: Flat hex fixture helper

**Files:**
- Create: `packages/game-core/src/tiles/flatHex.ts`
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `export type FlatHexCoord = { q: number; r: number }`
  - `export function buildFlatHexPlanet(cells: FlatHexCoord[], baseCoords?: FlatHexCoord[]): Planet`
  - Axial pointy-top neighbours; `PlanetCell.id` = index in `cells`; `neighbors[i]` = adjacent cell id or omit missing edges by only linking existing cells (sides = number of existing neighbours — **prefer fixed 6 sides** with `neighbors` only listing real adj; match existing `PlanetCell` shape: `neighbors: number[]` length = sides). Use **always 6 neighbour slots**; missing map edge uses a sentinel? Existing code assumes `neighbors.length === sides` and every entry is a valid id. So for flat fixtures: only include cells that exist; for map-boundary, do **not** invent ghost cells — use a 6-length neighbour array where absent directions are simply not present by setting `sides` to actual count **or** pad with self-links forbidden.

**Decision (lock):** Build cells with `sides: 6` and `neighbors: number[]` of length 6. For a missing direction, point `neighbors[i]` at a dedicated **sentinel empty id is wrong**. Instead: only create the listed coords; for each of 6 directions, if neighbour coord exists in the map, set id; if not, set neighbour to a unique **off-map wall cell** that is pre-`placed` with **all connections false** and listed in `placed` so openings toward walls fail finishability as forbidden. Simpler approach used in plan:

**Lock:** `buildFlatHexPlanet` only includes listed coords. Neighbour arrays have length = count of existing adjacent listed cells (5 or 6 typically for interior). Tests that need “south forbidden” encode that by **not** having empty growth south (no empty neighbour) — opening south is impossible / treated as forbidden because there is no empty playable neighbour (classifier: open toward non-empty non-route wall). For missing direction on hex, use `neighbors` length 6 with `-1` **not allowed**. Use off-board placed “blocker” cells with closed edges included in `planet.cells` and `state.placed` as inert closed tiles.

Concrete helper:

```ts
export function buildFlatHexPlanet(
  playable: FlatHexCoord[],
  opts?: { baseCoords?: FlatHexCoord[] },
): Planet
```

- [ ] **Step 1: Write failing test**

```ts
it("buildFlatHexPlanet links axial neighbours symmetrically", () => {
  const planet = buildFlatHexPlanet([
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
  ]);
  assert.equal(planet.cells.length, 3);
  const a = planet.cells[0]!;
  assert.ok(a.neighbors.includes(1));
  assert.ok(planet.cells[1]!.neighbors.includes(0));
});
```

- [ ] **Step 2: Run test — expect FAIL** (export missing)

Run: `npm run test -w @tdw/game-core`

- [ ] **Step 3: Implement `flatHex.ts`**

Pointy-top axial deltas:

```ts
const DIRS = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
];
```

Map `key(q,r) -> id`. Each cell `sides: 6`, `neighbors[i] = id of DIRS[i]` if present else create shared **boundary** cells (one per missing slot instance) that are not in playable set — actually create one global `BOUNDARY` cell id with 6 self-neighbours closed, and point missing dirs at it. Include boundary in `planet.cells`. `baseCellIds` from `opts.baseCoords` mapped to ids (default `[]`).

- [ ] **Step 4: Tests PASS + export from `index.ts`**

- [ ] **Step 5: Commit + push main**

```bash
git add packages/game-core/src/tiles/flatHex.ts packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(tiles): flat hex planet helper for placement fixtures"
git push origin main
```

---

### Task 2: Pocket detection

**Files:**
- Create: `packages/game-core/src/tiles/finishability.ts`
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `PlacementState`, planet adjacency
- Produces:
  - `export type Pocket = { emptyCellIds: number[]; stubEdges: { fromCellId: number; edge: number; intoCellId: number }[]; sealedByCandidate: boolean }`
  - `export function pocketsAfterPlacing(state: PlacementState, candidateCellId: number): Pocket[]`
  - Definition: after treating `candidateCellId` as occupied (not empty), find connected components of remaining empty **playable** cells (exclude boundary blockers). A pocket is **sealed by candidate** if every escape from that component to non-empty goes through `candidateCellId` or already-placed cells (no path via empty cells to another frontier). Practical check: BFS empty cells reachable without going through candidate; for each component adjacent to candidate, `sealedByCandidate =` every neighbour of the component that is empty was inside the component, and all other neighbours are placed or boundary.

- [ ] **Step 1: Failing test** — build a ring of placed cells around one empty; candidate is the last gap; assert one pocket size 1, `sealedByCandidate: true`, `stubEdges` empty.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `pocketsAfterPlacing`**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit + push main**

```bash
git commit -m "feat(tiles): detect empty pockets sealed by a candidate placement"
git push origin main
```

---

### Task 3: Edge constraint classifier + validate mask

**Files:**
- Modify: `packages/game-core/src/tiles/finishability.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `export type EdgeKind = "required" | "forbidden" | "optional"`
  - `export type EdgeConstraint = { edge: number; kind: EdgeKind; groupId?: string }`
  - `export function classifyCandidateEdges(state: PlacementState, cellId: number): EdgeConstraint[]`
  - `export function connectionsSatisfyFinishability(state: PlacementState, cellId: number, connections: boolean[]): boolean`

**Classification algorithm (lock):**

1. Start all edges as `optional`.
2. For each edge to a **placed** neighbour: if neighbour has open stub into `cellId` → `required`; if neighbour closed toward `cellId` → must be closed (Carcassonne already); mark edge not optional open.
3. For each pocket from `pocketsAfterPlacing`:
   - Let `E` = edges of candidate into that pocket’s empty cells.
   - Let `S` = stubEdges into pocket from already-placed (not candidate).
   - If `sealedByCandidate`:
     - If `S.length >= 1`: each candidate edge that faces a cell receiving a stub (or all `E` if stub is inside and must be joined — for v1: **every edge in `E` that is the unique gateway to a stub cell, else all `E` required when `S>=1` and `|E|` matches examples**) → simpler **v1 rule:** if `S.length >= 1`, **all edges in `E` are required** only when `|E| === 1`; when `|E| > 1`, require exactly the edges that neighbour a pocket cell that is the `intoCellId` of a stub **or** if stub enters a pocket cell not adjacent to candidate, require **at least one** path — for SVG ex1, candidate has exactly one edge into the pocket → that edge required. **Lock v1:** mark each edge in `E` that is adjacent to any pocket cell that lies on a shortest empty path from a stub’s `intoCellId` to the candidate as `required`. If that set is empty but `S>=1`, mark all `E` required.
     - If `S.length === 0` && pocket size `k === 1`: all `E` → `forbidden`.
     - If `S.length === 0` && `k >= 2`: all `E` → `optional` with same `groupId = pocket-<id>` meaning **all-or-nothing** (both/neither for any subset size: either open 0 of group or open all of group — matches ex5 two greens).
4. For edges to empty cells **not** in a sealed pocket (open frontier, ex6): leave `optional` with `groupId = "frontier-continuations"` and rule **at-least-one** among that group when the candidate has exactly one required attach to placed route and would otherwise be a pure tip (only one open total). **Lock:** if after steps 1–3 the only `required` opens are toward placed tiles and count of required opens equals the number of attaching stubs, then the set `F` of optional edges toward empty non-sealed cells gets group rule `atLeastOne`.
5. Boundary / blocker neighbours: opening toward a fully-closed boundary cell → `forbidden`.

`connectionsSatisfyFinishability`:

```ts
// required => connections[e] true
// forbidden => connections[e] false
// optional groups:
//   allOrNothing(group): all true or all false
//   atLeastOne(group): >=1 true
```

- [ ] **Step 1: Failing tests for classify + satisfy on a sealed 1-cell pocket (ex2 shape)**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement classifier + satisfy**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit + push main**

```bash
git commit -m "feat(tiles): classify required/forbidden/optional finishability edges"
git push origin main
```

---

### Task 4: Wire into `isLegalPlacement` (remove stub-count)

**Files:**
- Modify: `packages/game-core/src/tiles/placement.ts` (`isLegalPlacement`)
- Modify: `packages/game-core/src/index.test.ts` (delete/replace “increase open ends always illegal” tests)

**Interfaces:**
- Consumes: `connectionsSatisfyFinishability`
- After attach/Carcassonne/`touchesRoute`, replace:

```ts
const before = listOpenEnds(state).length;
const after = openEndCountWithCandidate(...);
if (after > before) return false;
```

with:

```ts
if (!connectionsSatisfyFinishability(state, cellId, connections)) return false;
```

Remove `openEndCountWithCandidate` if unused.

- [ ] **Step 1: Write failing test** that a forward straight on an open tip (increases nothing or keeps growth) remains legal **and** a poke into a 1-hex sealed empty pocket is illegal even if stub count does not increase.

- [ ] **Step 2: Run — FAIL** on pocket poke if only stub-count exists

- [ ] **Step 3: Wire finishability; remove stub-count guard**

- [ ] **Step 4: Full `npm run test -w @tdw/game-core` PASS**

- [ ] **Step 5: Commit + push main**

```bash
git commit -m "fix(placement): use finishability instead of open-stub count"
git push origin main
```

---

### Task 5: SVG examples 1–6 as fixtures

**Files:**
- Test: `packages/game-core/src/index.test.ts` (or `packages/game-core/src/tiles/finishability.test.ts` if preferred — **lock:** keep in `index.test.ts` describe `"finishability examples"` for one runner)
- Helper builders in test file using `buildFlatHexPlanet` + manual `placed` maps

For each example 1–6:

- Build the yellow network as `PlacementState.placed` with correct `connections`
- Identify blue candidate cell id
- Assert:
  - Required edges must be open for legality
  - A mask with any forbidden edge open → `isLegalPlacement` false / `connectionsSatisfyFinishability` false
  - Green rules: ex5 both/neither; ex6 ≥1 continuation

Encode rotations via `makeTile` + `placeTile`/`isLegalPlacement`.

- [ ] **Step 1: Add failing tests for examples 1 and 2**

- [ ] **Step 2: Implement/adjust classifier until PASS**

- [ ] **Step 3: Add examples 3–4**

- [ ] **Step 4: Add examples 5–6**

- [ ] **Step 5: Full test suite PASS + commit**

```bash
git commit -m "test(tiles): finishability fixtures for SVG examples 1-6"
git push origin main
```

---

### Task 6: Cap fallback respects finishability + ship notes

**Files:**
- Modify: `packages/game-core/src/tiles/placement.ts` (`forcePlaceBridge` / `closeOpenEndsByPlacing` paths) — prefer `placeTile` (already finishability-gated); ensure any force path either uses `isLegalPlacement` or calls `connectionsSatisfyFinishability` before writing
- Modify: `docs/CHANGELOG.md` — `0.1.59`
- Modify: `packages/client/src/main.ts` — `CLIENT_BUILD = "v0.1.59"`
- Modify: spec status line to **Approved 2026-07-24**

- [ ] **Step 1: Grep for force/carve writes; gate or leave carve-only on incomplete boards at cap (carve is emergency — document: carve may bypass finishability only inside `autoBridge`/`closeOpenEndsByPlacing` after turn cap, still no prune). **Lock:** leave carve as-is for cap safety; normal placement always finishability.**

- [ ] **Step 2: Changelog + build tag**

- [ ] **Step 3: `npm run test -w @tdw/game-core` && `npm run build -w @tdw/client` && `npm run build -w @tdw/server`**

- [ ] **Step 4: Commit + push main**

```bash
git commit -m "docs: changelog finishable placement legality (v0.1.59)"
git push origin main
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Illegal = unfinishable stub / dead end | 3–4 |
| Required / forbidden / optional edges | 3 |
| Pockets sealed by candidate; S/k rules | 2–3 |
| Ex5 all-or-nothing greens | 3, 5 |
| Ex6 ≥1 continuation greens + commitments | 3, 5 |
| Baseline attach unchanged | 4 |
| Remove stub-count rule | 4 |
| Sampler only legal tiles | 4 (automatic via `findLegalPlacements`) |
| Examples 1–6 tests | 5 |
| No seal/prune; complete finish predicate kept | 4, 6 |
| No client overlays | 6 (non-goal) |

## Self-review notes

- Locked flat-hex boundary strategy (blocker cells) so “south forbidden” is expressible.
- Locked sealed-pocket stub join heuristic for v1; examples 1–6 drive refinements in Task 5.
- Cap carve may bypass finishability; normal manual/auto placement must not.
- No stub-count filter remains after Task 4.
