# Route-end placement, dynamic tiles, and no-entry routing

**Status:** Approved 2026-07-23  
**Version target:** follow-on after v0.1.54 (ship as one feature across client + game-core + server)

## Goal

Replace corridor-puzzle placement with a grow-from-castles road builder, and replace the Targets HUD with per-player no-entry signs that reshape **your own** bod paths.

## Scope

1. **Placement UX** — drag/drop onto open route ends; right-click / second-finger rotate among legal orientations only.
2. **Network rules** — one road into each castle; place only on open ends; dynamic legal tile sampling with split/join pressure until all castles connect.
3. **Combat routing** — random among branches that reach an alive enemy castle; no-entry toggles; remove Targets / `targetEnabled` control.

Out of scope: redesigning mines/tower pads beyond attaching them to generated tiles as today; changing tower combat math.

---

## 1. Placement UX

- The current tile follows the pointer/finger while dragging. Planet orbit/pan stays on empty drag (desktop) / one-finger pan (mobile).
- **Drop only** on highlighted **open route ends** where the current tile + rotation is legal. Invalid hover cannot drop.
- **Rotate:** right-click (desktop) or second-finger tap (mobile) cycles legal orientations for the **current hover end**. Remove mouse-wheel and two-finger-twist rotate.
- HUD keeps a small tile preview + rotate button as fallback; primary flow is drag/drop.
- Server remains authoritative: client proposes `placeTile`; illegal placements are rejected.

---

## 2. Tile / network rules

### Start state

- Each castle hex has **exactly one** open road edge, chosen at random at match start. That edge is the castle’s only join point.
- The empty neighbour across that edge is an **open route end**.
- With *N* players there are *N* drop points at the start.

### Placement rule

- Tiles may only be placed on an **open route end** (empty cell adjacent to an open road stub of the growing network).
- On your turn you may place on **any** open end (shared network building).
- Edge matching: the attaching edge must be open against the stub; other edges must be consistent with already-placed neighbours (mutual opens or mutual closes). Closed edges against empty cells become new open stubs (new ends) when they face empty land.

### Tile shapes

- At minimum: **straight**, **bend**, **T-split** (3-way). Optional **cross** (4-way) if legal sampling needs it.
- A “join” is not a separate magic type: it is any placement that merges components or consumes ends by matching another open stub / network.

### Tile offer (legal sampling)

Each turn the sim **samples** a tile from the set of shapes that have ≥1 legal placement on some current open end (weighted):

| Rule | Behaviour |
|------|-----------|
| Always | Only offer placeable tiles (no dead draws). |
| 3 players | Among the first 3 tiles, ≥1 is a split. |
| 2 players | No splits in round 1; afterward splits at config `splitChance` (tweakable). |
| Join pressure | If >1 road components remain, or open ends are adjacent / one step from merging, bias weights toward tiles that enable merges so unification stays possible. |

Mines / tower-pad flags continue to attach to tiles with existing chances, independent of topology.

### End of placement

- Placement continues until **all alive castles** lie on **one** connected road graph **and** there are **zero open stubs** (no road edge into empty land) and **no spur tips** (every non-base road cell has route degree ≥ 2).
- After castles are already joined, placements that would **increase** the open-end count are illegal (cleanup phase); straights/bends that move a tip and merges that reduce ends remain legal.
- Combat starts only when that clean network already exists. There is **no** seal-or-prune pass that deletes or closes roads after the fact.
- **Safety:** if placement turns exceed a high cap without a clean network, auto-bridge remaining components and close stubs by placing/carving real corridors (still no prune).

### Removed systems

- Preplanned corridor masks / exact-mask bag (`buildCorridorNetwork` placement path) are retired for match flow in favour of this grow-from-ends model.
- Auto placement mode may keep an AI that repeatedly samples+places until the network is complete (same rules).
- Post-finish `sealOpenEndsFacingEmpty` / `pruneDeadEndSpurs` are removed from match flow.

---

## 3. Combat routing & no-entry

### Targeting

- Remove the **Targets** HUD and player-facing `targetEnabled` control.
- Spawn and pathing only consider **alive** enemy castles (`alive === true`).
- At a **junction**, among outgoing edges whose remaining graph still reaches ≥1 alive enemy castle, pick **uniformly at random** (interesting routes, not shortest-path only).

### No-entry

- During combat, click a **road edge** (segment between two mutually connected cells) to toggle **your** no-entry on that edge.
- **Unlimited** toggles. Only **your** bods respect your blocks.
- Your no-entries are **invisible to enemy clients** (omit from their snapshots or strip on send). Enemies still see bods change direction.
- Bod behaviour when blocked:
  1. At a split: do not take a blocked branch if another legal (reaches alive enemy) option exists.
  2. If the forward edge is blocked (including on a straight): **reverse** toward the previous cell, then continue toward the next upstream split (or keep reversing).
  3. If a bod reaches **its owner’s castle** under this retreat / lock-in behaviour: apply **castle contact damage** the same way an enemy bod would.

Locking the whole map with your own signs only hurts you: enemy bods ignore your signs.

### Towers

- Build/range rules unchanged. Route distance for towers uses the shared undirected road graph; enemy paths are not altered by your no-entries.

---

## Data / protocol (sketch)

- Match state tracks `openEnds: { cellId, fromCellId, edgeIndex }[]` (or equivalent).
- Current tile is generated each turn via legal sampler (not a fixed shuffled corridor bag).
- `playerEdgeBlocks: Record<playerId, Set<edgeKey>>` where `edgeKey` is a canonical undirected pair `min(cellA,cellB):max(cellA,cellB)`.
- Snapshot: each client receives only **their** edge blocks; enemies’ blocks omitted.
- Messages: keep `placeTile`; add `toggleNoEntry { cellA, cellB }`; remove client use of `toggleTarget`.

---

## Implementation phases

1. **Core network** — castle single stub, open-end placement legality, legal tile sampler, connect-all end condition (tests first).
2. **Client placement UX** — drag/drop, RMB / second-finger rotate, remove twist/wheel rotate.
3. **Combat routing** — random alive-enemy branches; no-entry state + bod reverse/own-castle damage; strip Targets UI; fog blocks in snapshots.

---

## Success criteria

- New match starts with exactly one road stub per castle and only those ends highlighted.
- Players can only drop on valid ends; rotate never offers illegal orientations for the hovered end.
- Placement ends only when all castles share one road graph with zero open stubs and no spur tips (or safety auto-bridge + stub close).
- No Targets button; bods only chase alive enemy castles.
- Own no-entries redirect only own bods; enemies cannot see the signs; own-castle contact still damages.
