# Multi-tower loadouts, workshop & bod upgrades — design

Date: 2026-07-21  
Status: implemented  
Note: Workshop economy (raw resource sliders) superseded by `2026-07-21-tower-workshop-v2-design.md`.  
Approach: #2 — per-player loadout + point-budget workshop

## Goals

1. Each player brings their own tower loadout into the match (AI uses defaults).
2. Default loadout: **basic**, **sniper**, **mortar** (3 types).
3. No hard cap on type count — denser UI is the only friction.
4. Lobby **Tower workshop**: simple sliders + advanced JSON; download/upload.
5. Every tower balanced by a **fixed skill-point pool** (same pool size per tower).
6. Imports / ready / start **fail validation** if any tower exceeds the budget or schema.
7. Combat: pad focus → type picker from *your* loadout → build; **bod upgrade** buttons.
8. Record future work: tower↔bod rock-paper-scissors matchups (not this phase).

## Non-goals (this phase)

- Wiring AoE / jump / slow / shot-refund combat (schema fields stay inert, cost 0 points).
- Tower↔bod RPS matchups.
- Accounts / cloud loadout sync (local download/upload only).
- Host-forced shared loadout.

---

## 1. Loadouts & ownership

- Each human seat owns a `TowerLoadout` = ordered list of `TowerDef` (unique `id`s within the loadout).
- Sent to server on `ready` and/or `start` (authoritative copy stored on the seat / player).
- AI seats always receive `defaultTowerLoadout`.
- After match start, loadouts are immutable for that match.
- Match combat uses `player.loadout` (not global `config.towers` alone). Global config still holds mines/bods/base and the default tower templates.

### Defaults (must each spend ≤ pool, preferably ~full)

| id | Role | Intent |
|----|------|--------|
| `basic` | Balanced DPS | Current economy-facing gun |
| `sniper` | Long range, lower power | Picks off bods further out |
| `mortar` | Short range, higher power | Holds chokes / pad clusters |

Exact numbers are tuned so each validates under the point formula below.

---

## 2. Skill-point budget

- **Pool:** `TOWER_POINT_POOL = 100` per tower (constant; not shared across loadout).
- **Spent ≤ 100** required. Under-spend allowed (weaker gun). Over-spend → invalid.
- **This phase, point-relevant stats:** `power`, `range`, `buildCost` (stone+power), `upgradeCost` (stone+power).
- Inert combat fields (`aoeSize`, `aoeFade`, `jump`, `jumpLoss`, `slowPower`, `shotGivesPercent`, `shootCost`) must be present, within schema clamps (default 0 / `{}`), and contribute **0** points until activated later.

### Formula (v1)

```
buildTotal    = (buildCost.stone ?? 0) + (buildCost.power ?? 0)
upgradeTotal  = (upgradeCost.stone ?? 0) + (upgradeCost.power ?? 0)

spent = round(
  power * 5
  + range * 15
  + max(0, 150 - buildTotal) * 0.15    // cheaper build → more points
  + max(0, 100 - upgradeTotal) * 0.1   // cheaper upgrade → more points
)
```

Notes:

- Expensive build/upgrade **refunds** point pressure (you pay more resources in-match).
- Cheap guns burn the pool so you cannot also stack high power/range for free.
- `upgradeStatIncrease` / `upgradeLevelIncrease` / `friendlyFireDefault` are schema-validated but not in the point sum this phase (clamped to safe bands).

### Schema clamps (reject outside)

| Field | Min | Max |
|-------|-----|-----|
| power | 1 | 40 |
| range | 1 | 6 |
| buildCost stone/power each | 0 | 200 |
| upgradeCost stone/power each | 0 | 200 |
| upgradeLevelIncrease | 1.0 | 2.0 |
| upgradeStatIncrease.power/range | 0 | 0.5 |
| inert combat floats | 0 | 0 (this phase) |

### Validation API (`game-core`)

```ts
validateTowerDef(def): { ok: true } | { ok: false; errors: string[] }
validateLoadout(towers): { ok: true; towers } | { ok: false; errors: string[] }
scoreTowerPoints(def): number
defaultTowerLoadout(): TowerDef[]
```

Server rejects `setLoadout` / ready with bad loadout; client shows the same errors on import.

---

## 3. File format

```json
{
  "version": 1,
  "kind": "tdw-tower-loadout",
  "towers": [ /* TowerDef[] */ ]
}
```

- Download: `tdw-loadout-v1.json`
- Upload: parse JSON → `validateLoadout` → apply or list errors (no partial apply on failure).

---

## 4. Lobby workshop UX

- Panel on lobby for the local player: **Tower workshop**.
- List of towers in loadout; **Add tower**, **Remove**, **Restore defaults**.
- **Simple tab:** name/id, sliders for power/range/build/upgrade costs; meter `spent / 100`.
- **Advanced tab:** JSON editor (single tower or full file); **Validate**.
- **Download** / **Upload** buttons.
- Invalid state blocks Ready (or Ready sends last valid loadout only if we prefer — **prefer block Ready** until valid).

---

## 5. Combat UI

### Towers

1. Tap pad → focus map (existing).
2. Tap again → open **type picker** from your loadout (chips: name, short role, cost chips; grey if unaffordable).
3. Tap a type → `buildTower` with `typeId`.
4. Built towers display type colour/label; upgrades use that type’s scaled costs.

Protocol: extend `buildTower` with required `typeId` (must exist in that player’s loadout).

### Bods

- Bod row: enable toggle + **Upgrade** with level-scaled cost chips (existing `intentUpgrade { kind: "bod", bodTypeId }`).
- Show current level (L0 → next L1 cost, etc.).
- Grey when unaffordable.

---

## 6. Server / sim changes (summary)

- `PlayerState.loadout: TowerDef[]` (or seat loadout copied at match create).
- `intentBuildTower(..., typeId)` resolves def from player loadout.
- Serialize loadout ids + defs needed by client (or defs once at start + typeId on towers).
- Lobby messages: `setLoadout` intent; snapshot includes your loadout + others’ type names if useful (defs for self only is enough for privacy of full JSON — **expose full defs of all players in match** for fairness/UI of enemy towers).

---

## 7. Future (explicit backlog note)

**Tower ↔ bod rock-paper-scissors:** tag towers and bods with matchup affinities so some guns are strong vs some unit types and weak vs others. Not designed or implemented in this phase; track under SPEC § Future.

Also later: spend points on AoE/jump/slow when those combat systems activate.

---

## 8. Acceptance

1. New match: each human can edit loadout; defaults are 3 legal guns.
2. Download → tweak → upload round-trips when valid; over-budget import fails.
3. Build flow: pad select → type picker → correct type built and charged.
4. Bod upgrade button levels a bod type and updates cost chips.
5. AI builds from default loadout only.
6. `npm test` covers point scoring, validation reject/accept, build with typeId.
