# Placement legality: finishable stubs (no forced dead ends)

**Status:** Draft for review 2026-07-24  
**Version target:** follow-on bugfix after v0.1.58  
**Supersedes:** the v0.1.58 rule “placements that increase open-stub count are always illegal” (too blunt; bans normal growth)

## Goal

Define when a road tile placement is **legal** so players never place a tile that can **only ever finish as an open/dead stub**. Growing stubs while building remains allowed. Combat still starts only when the network is already clean (connected castles, zero open stubs, no spur tips) — without seal/prune deleting roads.

## Player-facing vs engine

- **Player:** sees a **tile offer** that is valid in **≥1** legal cell/rotation. They do not see red/blue/green overlays.
- **Engine:** for a candidate `(cell, rotation, tile)`, classifies each edge of that cell as **required**, **forbidden**, or **optional-with-constraints**, then accepts the placement only if the tile’s opens match that classification.

The SVG examples (1–6) are the acceptance oracle for that engine classification.

---

## Core definition

**Illegal placement:** a placement that introduces (or fails to satisfy) a road obligation that, given the remaining empty cells and already-placed stubs, **cannot be completed without leaving a permanent open stub or dead-end spur**.

**Legal placement:** attaches on an open route end, respects Carcassonne mutual open/closed with placed neighbours, and every open/closed choice on the new tile leaves a **still-finishable** future for the empty cells it touches.

This is **not** “never increase open-stub count.” A straight that moves a tip forward increases nothing net but is fine either way; a split that opens new finishable branches can be fine; a poke into a one-hex sealed void is not.

---

## Edge classification (per candidate cell)

When testing tile `T` at empty cell `X` with rotation `R`, for each edge `i` of `X`:

### 1. Required (blue)

Must be **open** on `T`.

Typical causes:

- Placed neighbour across `i` already has an open stub into `X` (attach / mesh completion).
- Placing `X` would **close a pocket** that already contains ≥1 road stub into that pocket — `X` must open into the pocket to join that stub before the pocket is sealed (example 1, mesh cases 3–4).

### 2. Forbidden (red)

Must be **closed** on `T`.

Typical causes:

- Opening into a **1-cell** enclosed void with **no** existing stub already in that void — a loop is impossible, so a stub into it can only die (example 2).
- Opening in a direction that, on the playable graph, has **no finishable continuation** (off-playable / unfillable).
- Opening that would break mesh completion (leaving a required join unsatisfied by opening the wrong set — examples 3–4 show required vs forbidden legs).

### 3. Optional with constraints (green)

May be open or closed, but only in **allowed combinations**, because each open green is a **commitment**: neighbouring empty cells inherit future obligations.

Examples from the SVG:

| Example | Green rule |
|---------|------------|
| 5 | Two greens into a **multi-hex** enclosed pocket: **both open or both closed** (so a small loop remains possible). Exactly one is illegal. |
| 6 | Early growth off a single join to C: among the three continuation greens, **at least one** must be open (cannot cap as a permanent tip). Which/how many are open changes what the surrounding empties must satisfy later. |

**Propagation (explicit):** choosing a green open into empty neighbour `Y` means there must still exist a finishable completion of `Y` (and cells beyond) consistent with all other opens. More greens ⇒ more commitments; legality must check that the **combined** set remains solvable, not each green in isolation only.

---

## Pockets (enclosed empty regions)

A **pocket** is a maximal connected set of empty cells whose boundary is already (or would be, after placing `X`) fully surrounded by placed cells / map edge such that roads cannot escape except through the candidate’s edges into that set.

When classifying edges of `X` that face a pocket:

1. Let `S` = number of **existing** open stubs from already-placed tiles into that pocket (not counting `X`).
2. Let `k` = pocket size in empty cells (**including** cells that remain empty after placing `X`; `X` is not in the pocket once placed).
3. Let `E` = the set of edges of `X` that face into that pocket.

Rules:

- If placing `X` **completes the seal** of the pocket (no other escape):
  - If `S ≥ 1`: at least the joins needed to absorb those stubs are **required** on edges in `E` (example 1: 3-leg including into the pocket).
  - If `S = 0` and `k = 1`: every edge in `E` is **forbidden** (example 2).
  - If `S = 0` and `k ≥ 2`: edges in `E` are **green with parity/combination constraints** — e.g. for two facing edges into the same pocket, **both or neither** (example 5). Do not allow a single orphan stub into the pocket.
- If the pocket is **not** sealed by this placement (roads can still grow around): treat facing empties more like example 6 — continuations are greens with “still solvable” checks rather than immediate both-or-neither, unless the local geometry already creates a sealed sub-pocket.

Flat finite diagrams in the SVG assume the drawn cluster is the whole playable graph. On the sphere planet, “pocket” / “unfillable” use the real Goldberg adjacency (no flat-map edge of the world); same logical rules.

---

## Baseline attach rules (unchanged)

Still required before the finishability layer:

1. `X` must be an **open route end** (empty neighbour of a placed open stub).
2. Carcassonne compatibility with every already-placed neighbour (mutual open or mutual closed).
3. At least one mutual open attach to the existing route.

Then apply required / forbidden / green constraints above.

---

## End of placement (unchanged intent)

Placement ends when:

- all castles share one connected route graph, **and**
- zero open stubs into empty land, **and**
- no non-base spur tips (route degree ≥ 2 for every non-base road cell).

No seal/prune that deletes or silently closes roads. Cap fallback may only **place/carve real corridors** that themselves obey finishability.

---

## Tile sampling

Each turn, sample only shapes that have **≥1** `(cell, rotation)` passing the full legality check (attach + finishability).

- Do **not** use “open-stub count must not increase” as a filter.
- Splits/crosses are offered when some legal rotation exists under the finishability rules (often merges / multi-stub cells).
- 3p “prefer a split early” only when a legal split placement exists.

---

## Acceptance examples (SVG 1–6)

These are normative. Implementation tests should encode each as a small board fixture.

1. **Closing pocket with an internal stub** — placing the blue cell requires a **3-way**: through the B–C line **and** into the pocket to meet the existing stub. Other legs forbidden.
2. **Closing 1-hex empty pocket, no internal stub** — through B–C only; **any** open into the pocket is forbidden (cannot loop).
3. **Dense mesh** — all blue legs required to complete existing stubs; reds forbidden.
4. **Simpler mesh** — subset of blues required; other mesh-facing opens forbidden as shown.
5. **Multi-hex enclosed area** — through-line required; the two pocket-facing greens must be **both or neither**; southern opens forbidden as shown.
6. **Earlier growth** — must open toward C; among the three continuation greens, **≥1** open; which combination is legal only if surrounding empties remain finishable under the commitments those greens create.

---

## Non-goals

- Changing combat no-entry, countdown, or mine/pad decoration odds.
- Showing red/blue/green overlays in the live client (examples are design/test oracles only).
- Reintroducing seal/prune as a way to “fix” illegal boards after the fact.

---

## Implementation sketch (for the later plan)

- Replace the v0.1.58 `after > before` open-end guard in `isLegalPlacement` with a **finishability classifier** over candidate edges (pocket detection + required/forbidden/green combination checks).
- Keep `placementNetworkComplete` as the finish predicate.
- Add fixture tests mirroring examples 1–6 (flat hex graphs are fine for unit tests; planet tests for attach + no-prune finish remain).

## Open point (resolved in conversation)

Example 6’s “≥1 green” is layout-specific minimum. The general rule is: optional opens are commitments; legality depends on the **combination** and the solvability of neighbouring empties, not a global stub-count inequality.
