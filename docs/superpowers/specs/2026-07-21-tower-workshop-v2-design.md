# Tower workshop v2 — derived costs, fire rate, resource-gated sliders

Date: 2026-07-21  
Status: approved (pending user file review)  
Supersedes (workshop economy section of): `2026-07-21-tower-loadouts-workshop-design.md`  
Approach: full workshop v2 in one pass

## Goals

1. Workshop edits **combat stats** and **economy discounts**, not raw resource costs.
2. **Build/upgrade costs are derived** from stats, then reduced by % discount sliders.
3. Lobby **`resourceCount` gates which sliders exist** (2 vs 3 for this phase).
4. Add **fire rate** as a real combat stat (replaces hardcoded tower cooldown).
5. Keep **100 skill-point pool** with fixed SP per slider step (tunable later).
6. Loadout file **v2 only** — no v1 import / backwards compatibility.

## Non-goals

- Slow / AoE / jump combat wiring (fields stay inert, 0 SP).
- 4–5 resource slider expansion (same as 3 for now).
- Tower↔bod RPS.
- Importing or migrating `tdw-loadout-v1.json`.

---

## 1. Core model

### Resource count → available sliders

| `resourceCount` | Sliders |
|-----------------|--------|
| 2 | Power · Range |
| 3 | Power · Range · Fire rate · Build discount · Upgrade discount |
| 4+ | Same as 3 until a future phase adds slow/AoE/etc. |

### Authoritative tower fields (player-edited)

- `power`, `range`
- `fireRate` (used when resourceCount ≥ 3; forced to default baseline when 2)
- `buildDiscount`, `upgradeDiscount` (steps; forced to 0 when resourceCount is 2)
- `id` and existing non-point schema fields as today

### Derived fields (never trusted from client JSON)

- `buildCost`, `upgradeCost` — always recomputed on validate / setLoadout / match start

### Resource ↔ stat (v1 mapping; revisit in balance)

| Stat | Resource taxed |
|------|----------------|
| range | stone |
| power | power |
| fire rate | water (3-resource matches only) |

---

## 2. Skill points

Pool: `TOWER_POINT_POOL = 100` per tower. Spent ≤ 100 required. Under-spend allowed.

### Slider ranges & SP per step (starting tunables)

| Slider | Range | SP / step | Effect |
|--------|-------|-----------|--------|
| Power | 1–20 | 5 | Damage per shot |
| Range | 1–6 | 15 | Hex range |
| Fire rate | 1–10 | 8 | Shot cooldown (see §4) |
| Build discount | 0–10 | 10 | Each step = 5% off derived build |
| Upgrade discount | 0–8 | 25 | Each step = 5% off derived upgrade |

```
spent =
  power * 5
  + range * 15
  + (resourceCount >= 3
      ? fireRate * 8 + buildDiscount * 10 + upgradeDiscount * 25
      : 0)
```

When `resourceCount === 2`, fire rate / discounts do not appear and contribute **0** SP (values normalized to baseline/0 on validate).

Workshop auto-balance: dragging a slider keeps spent at 100 by adjusting the highest other allowed slider (same UX intent as current auto-balance).

---

## 3. Derived costs

### Before discount

```
buildCost.stone  = round(20 + range * 12)
buildCost.power  = round(20 + power * 4)
buildCost.water  = resourceCount >= 3 ? round(10 + fireRate * 5) : (omit)

upgradeCost.stone = round(12 + range * 6)
upgradeCost.power = round(12 + power * 2)
upgradeCost.water = resourceCount >= 3 ? round(6 + fireRate * 3) : (omit)
```

Only resources active in the match are kept (existing filter behaviour).

### After % discount

```
finalAmount = max(1, ceil(baseAmount * (1 - discountSteps * 0.05)))
```

Applied per resource entry on build (using `buildDiscount`) and upgrade (using `upgradeDiscount`).

---

## 4. Fire rate → combat

Replace hardcoded `tower.cooldown = 5` after a shot with:

```
cooldown = max(1, 11 - fireRate)
```

Examples: rate 1 → 10 ticks; rate 6 → 5 ticks (≈ current feel); rate 10 → 1 tick.

When `resourceCount === 2`, towers use a fixed baseline `fireRate = 6` (cooldown 5) so 2-resource matches keep today’s pace without a rate slider.

---

## 5. Defaults

`defaultTowerLoadout(resourceCount)` returns basic / sniper / mortar roles, each with spent ≤ 100 under that resource mode, costs derived from the formulas above.

AI always receives that default for the match’s `resourceCount`.

---

## 6. Workshop UX

- Simple tab: only sliders allowed for current lobby `resourceCount`.
- Under combat sliders: show which resource is taxed and live cost chips (pre/post discount where relevant).
- Meter `spent / 100`; Ready blocked if any tower invalid / over pool.
- Changing lobby resource count re-validates: normalize illegal fields, recompute costs; Ready blocked if still invalid.
- Advanced JSON: edit authoritative fields only; **cost maps in JSON are ignored** and regenerated on validate/apply.
- Download filename: `tdw-loadout-v2.json`.

---

## 7. File format

```json
{
  "version": 2,
  "kind": "tdw-tower-loadout",
  "towers": [ /* TowerDef-like objects without relying on buildCost/upgradeCost */ ]
}
```

- Reject `version !== 2` (including v1) with a clear error — **no migration**.
- On accept: recompute costs, score points, schema-validate.

---

## 8. Server / sim

- `setLoadout` / Ready / Start validate with match lobby `resourceCount`.
- Persist discounts + fireRate on seat/player loadout; derived costs stored on defs after validate.
- Match combat: charge derived costs; shooting uses fireRate cooldown.
- Loadouts still immutable after match start.

---

## 9. Acceptance

1. resourceCount 2 → workshop shows only Power/Range; costs have no water; cooldown baseline 5.
2. resourceCount 3 → all five sliders; water appears on bills from fire rate; discounts reduce costs by 5%/step.
3. Editing JSON costs cannot produce a cheaper tower than the formula allows.
4. Over-pool loadouts fail Ready/Start and upload.
5. v1 loadout files are rejected.
6. Defaults validate at ≤100 for both modes; AI uses defaults.
7. `npm test` covers scoring, derivation, discount math, fireRate cooldown, gating.

---

## 10. Balance note

All SP weights, cost coefficients, discount caps, and cooldown mapping are **starting values** for playtest. Expect a follow-up balance pass once the workshop is in use.
