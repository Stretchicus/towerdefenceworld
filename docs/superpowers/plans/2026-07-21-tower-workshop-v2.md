# Tower Workshop v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild tower workshop economy so players edit combat stats + % discounts; costs are derived; fire rate drives cooldown; lobby `resourceCount` gates sliders.

**Architecture:** Extend `TowerDef` with `fireRate` / `buildDiscount` / `upgradeDiscount`. `game-core` owns scoring, cost derivation, normalize-for-resourceCount, defaults, and v2 file parse. Server validates with lobby `resourceCount`. Client workshop shows gated sliders and live derived cost chips. Match shooting uses `max(1, 11 - fireRate)`.

**Tech Stack:** TypeScript monorepo `@tdw/game-core`, `@tdw/server`, `@tdw/client`.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-21-tower-workshop-v2-design.md` verbatim for formulas
- `TOWER_POINT_POOL = 100`
- Loadout file **v2 only** — reject v1, no migration
- No slow/AoE/jump combat wiring
- Client build tag bump when UI ships
- Auto-commit after each task

## File map

| File | Responsibility |
|------|----------------|
| `packages/game-core/src/types.ts` | Add `fireRate`, `buildDiscount`, `upgradeDiscount` on `TowerDef` |
| `packages/game-core/src/towers/loadout.ts` | Scoring, derive costs, normalize, validate, defaults, v2 parse |
| `packages/game-core/src/defaultGameConfig.ts` + `config/defaultGame.json` | Align template towers with v2 fields |
| `packages/game-core/src/sim/match.ts` | Fire-rate cooldown; defaults take `resourceCount` |
| `packages/game-core/src/index.ts` + `index.test.ts` | Exports + tests |
| `packages/server/src/room.ts` | Validate/setLoadout/start with `settings.resourceCount` |
| `packages/client/src/loadoutWorkshop.ts` | Gated sliders, derived cost UI, v2 download |
| `packages/client/src/main.ts` | Pass resourceCount into workshop; build tag |
| `packages/client/src/styles.css` | Minor workshop layout if needed |

---

### Task 1: Core loadout math (game-core)

**Files:**
- Modify: `packages/game-core/src/types.ts`
- Modify: `packages/game-core/src/towers/loadout.ts`
- Modify: `packages/game-core/src/index.ts`
- Modify: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Produces:
  - `BASELINE_FIRE_RATE = 6`
  - `scoreTowerPoints(def, resourceCount): number`
  - `scoreTowerPointsRaw(def, resourceCount): number`
  - `deriveTowerCosts(def, resourceCount): { buildCost, upgradeCost }`
  - `normalizeTowerForResources(def, resourceCount): TowerDef` (forces fireRate/discounts when count===2; recomputes costs)
  - `validateTowerDef(def, resourceCount)`, `validateLoadout(towers, resourceCount)`
  - `defaultTowerLoadout(resourceCount): TowerDef[]`
  - `towerCooldownTicks(fireRate): number` → `max(1, 11 - fireRate)`
  - `parseLoadoutFile(raw, resourceCount)` — requires `version === 2`

- [ ] **Step 1: Extend `TowerDef`**

Add to `packages/game-core/src/types.ts` inside `TowerDef`:

```ts
fireRate: number;
buildDiscount: number;
upgradeDiscount: number;
```

- [ ] **Step 2: Write failing tests** in `index.test.ts`

```ts
it("v2 scoring and derived costs respect resourceCount", () => {
  const {
    scoreTowerPoints,
    deriveTowerCosts,
    normalizeTowerForResources,
    towerCooldownTicks,
    defaultTowerLoadout,
    validateLoadout,
    parseLoadoutFile,
    TOWER_POINT_POOL,
  } = await import("./index.js"); // use static imports like existing tests

  assert.equal(towerCooldownTicks(6), 5);
  assert.equal(towerCooldownTicks(1), 10);
  assert.equal(towerCooldownTicks(10), 1);

  const sniperish = {
    id: "t",
    power: 8,
    range: 4,
    fireRate: 6,
    buildDiscount: 0,
    upgradeDiscount: 0,
    // …inert fields + empty costs filled by normalize
  };
  // Prefer building via normalizeTowerForResources / blank helper

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
```

Adapt to existing test style (static imports, concrete objects via `defaultTowerLoadout` / helpers). Also assert:

```ts
// power 10, range 2, rate 6, discounts 0 @ resourceCount 3
// spent = 10*5 + 2*15 + 6*8 = 50+30+48 = 128 → over pool after full def
// cheaper example: power 8, range 2, rate 4 → 40+30+32 = 102
// build stone = round(20+2*12)=44, power=round(20+8*4)=52, water=round(10+4*5)=30
```

Include one exact `deriveTowerCosts` numeric assertion from the spec formulas.

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test`  
Expected: FAIL (missing exports / wrong signatures)

- [ ] **Step 4: Implement loadout v2 math** in `loadout.ts`

Replace old point formula (build/upgrade cheapness) with spec §2–4:

```ts
export const BASELINE_FIRE_RATE = 6;

export function towerCooldownTicks(fireRate: number): number {
  return Math.max(1, 11 - fireRate);
}

export function scoreTowerPointsRaw(def: TowerDef, resourceCount: number): number {
  let s = def.power * 5 + def.range * 15;
  if (resourceCount >= 3) {
    s += def.fireRate * 8 + def.buildDiscount * 10 + def.upgradeDiscount * 25;
  }
  return s;
}

export function deriveTowerCosts(def: TowerDef, resourceCount: number): {
  buildCost: ResourceMap;
  upgradeCost: ResourceMap;
} {
  const buildCost: ResourceMap = {
    stone: Math.round(20 + def.range * 12),
    power: Math.round(20 + def.power * 4),
  };
  const upgradeCost: ResourceMap = {
    stone: Math.round(12 + def.range * 6),
    power: Math.round(12 + def.power * 2),
  };
  if (resourceCount >= 3) {
    buildCost.water = Math.round(10 + def.fireRate * 5);
    upgradeCost.water = Math.round(6 + def.fireRate * 3);
  }
  const apply = (cost: ResourceMap, steps: number): ResourceMap => {
    const out: ResourceMap = {};
    for (const [k, v] of Object.entries(cost)) {
      out[k] = Math.max(1, Math.ceil(v * (1 - steps * 0.05)));
    }
    return out;
  };
  return {
    buildCost: apply(buildCost, def.buildDiscount),
    upgradeCost: apply(upgradeCost, def.upgradeDiscount),
  };
}

export function normalizeTowerForResources(
  def: TowerDef,
  resourceCount: number,
): TowerDef {
  const next = structuredClone(def);
  if (resourceCount < 3) {
    next.fireRate = BASELINE_FIRE_RATE;
    next.buildDiscount = 0;
    next.upgradeDiscount = 0;
  }
  const costs = deriveTowerCosts(next, resourceCount);
  next.buildCost = costs.buildCost;
  next.upgradeCost = costs.upgradeCost;
  return next;
}
```

Update clamps in `validateTowerDef(def, resourceCount)`:
- power 1–20, range 1–6, fireRate 1–10, buildDiscount 0–10, upgradeDiscount 0–8
- always `normalize` then score ≤ 100
- inert combat fields still must be 0

Update `defaultTowerLoadout(resourceCount)` so each of basic/sniper/mortar:
- uses v2 fields
- after normalize, `scoreTowerPoints(...) <= 100`
- keeps role intent (sniper high range / lower power, etc.)

Update `parseLoadoutFile(raw, resourceCount)`:
- require `kind === "tdw-tower-loadout"` and `version === 2` (reject 1)
- normalize each tower; validate loadout

Update exports in `index.ts`.

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`  
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/game-core/src/types.ts packages/game-core/src/towers/loadout.ts packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(game-core): workshop v2 scoring, derived costs, fireRate"
```

---

### Task 2: Match cooldown + defaults wiring

**Files:**
- Modify: `packages/game-core/src/sim/match.ts`
- Modify: `packages/game-core/src/defaultGameConfig.ts`
- Modify: `packages/game-core/config/defaultGame.json`
- Modify: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `towerCooldownTicks`, `defaultTowerLoadout(resourceCount)`, `normalizeTowerForResources`, `validateLoadout`
- Produces: shooting uses per-tower fireRate cooldown

- [ ] **Step 1: Failing test — cooldown from fireRate**

```ts
it("tower cooldown uses fireRate", () => {
  const match = createMatch({ /* … */ seats: […] });
  // force a tower with fireRate 10 on owner loadout / structure
  // tick once with enemy bod in range
  // assert tower.cooldown === 1
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test`  
Expected: FAIL (`cooldown` still 5)

- [ ] **Step 3: Wire match**

In `resolveSeatLoadout` / `createMatch`, call `defaultTowerLoadout(input.settings.resourceCount)` and normalize seat loadouts with that count.

In shoot loop, replace `tower.cooldown = 5` with:

```ts
const def = resolveTowerDef(state, tower);
const rate = def?.fireRate ?? BASELINE_FIRE_RATE;
tower.cooldown = towerCooldownTicks(rate);
```

Update `defaultGameConfig` / JSON tower templates to include `fireRate`, `buildDiscount`, `upgradeDiscount` and derived-looking costs (config is fallback only; match prefers loadout).

- [ ] **Step 4: Tests PASS + commit**

```bash
git add packages/game-core
git commit -m "feat(sim): fireRate-driven tower cooldown; loadout defaults by resourceCount"
```

---

### Task 3: Server validates with resourceCount

**Files:**
- Modify: `packages/server/src/room.ts`

**Interfaces:**
- Consumes: `validateLoadout(towers, resourceCount)`, `defaultTowerLoadout(resourceCount)`, `normalizeTowerForResources`

- [ ] **Step 1: Thread resourceCount**

On create/join AI fill: `loadout: defaultTowerLoadout(room.settings.resourceCount)`.

On `setLoadout` / `ready` / `start`:

```ts
const rc = room.settings.resourceCount;
const normalized = raw.towers.map((t) => normalizeTowerForResources(t, rc));
const checked = validateLoadout(normalized, rc);
```

On `setLobby` when `resourceCount` changes: re-normalize every human seat loadout; clear `ready` if invalid.

Pass `resourceCount` into `createMatch` seats via already-normalized loadouts.

- [ ] **Step 2: Build server**

Run: `npm run build -w @tdw/server`  
Expected: success

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/room.ts
git commit -m "feat(server): validate loadouts against lobby resourceCount"
```

---

### Task 4: Client workshop v2 UI

**Files:**
- Modify: `packages/client/src/loadoutWorkshop.ts`
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/src/styles.css` (if needed)
- Modify: `docs/CHANGELOG.md`

**Interfaces:**
- Consumes: v2 loadout APIs + lobby `settings.resourceCount`
- Produces: gated sliders; live derived cost chips; `tdw-loadout-v2.json`

- [ ] **Step 1: Workshop API**

Change workshop state to track `resourceCount`.  
Simple tab sliders:
- Always: power, range
- If `resourceCount >= 3`: fireRate, buildDiscount, upgradeDiscount  
Remove raw build/upgrade resource sliders.

On each change: `normalizeTowerForResources` + rebalance using `scoreTowerPointsRaw(def, resourceCount)` among **allowed** fields only.

Show under combat sliders: taxed resource + cost chips from `def.buildCost` / `upgradeCost`.

Download: `version: 2`, filename `tdw-loadout-v2.json`.  
Upload: `parseLoadoutFile(json, resourceCount)` — reject v1.

- [ ] **Step 2: Wire main.ts**

Pass `lastLobby.settings.resourceCount` into workshop create/bind.  
When host changes Resources dropdown, after `setLobby`, workshop re-normalizes (paint already runs on state).  
Bump `CLIENT_BUILD` to `v0.1.25` (or next).  
CHANGELOG entry for workshop v2.

- [ ] **Step 3: Build client**

Run: `npm run build -w @tdw/client`  
Expected: success

- [ ] **Step 4: Commit**

```bash
git add packages/client docs/CHANGELOG.md
git commit -m "feat(client): workshop v2 gated sliders and derived cost display"
```

---

### Task 5: Spec status + smoke verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-tower-workshop-v2-design.md` (status → implemented)
- Optionally note supersession on old loadout design doc

- [ ] **Step 1: Full verify**

Run:

```bash
npm test
npm run build
```

Expected: tests pass; all workspaces build.

- [ ] **Step 2: Manual checklist** (dev or deploy)

1. Lobby resources=2 → only Power/Range; no water on cost chips  
2. Resources=3 → five sliders; water on bill; discounts shrink chips  
3. Upload v1 JSON → error  
4. Combat: high fireRate towers shoot faster  

- [ ] **Step 3: Commit docs status**

```bash
git add docs/superpowers/specs/2026-07-21-tower-workshop-v2-design.md
git commit -m "docs: mark workshop v2 design implemented"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Gated sliders by resourceCount | 1, 3, 4 |
| Derived costs + % discounts | 1, 4 |
| Fixed SP formula | 1 |
| Fire rate cooldown | 2 |
| Defaults ≤100 both modes | 1 |
| v2 only / reject v1 | 1, 4 |
| Server validate with resourceCount | 3 |
| Workshop UX + cost chips | 4 |
| Acceptance tests | 1, 2, 5 |

## Placeholder scan

None intentional — formulas copied from spec; tunables may change in a later balance pass.
