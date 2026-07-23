# Neutral single-resource mines

**Status:** Approved 2026-07-23  
**Version target:** client/sim v0.1.53

## Goal

Each mine is one of the match’s active resources, assigned when the tile is created. Mines are **neutral** (no claim/owner). Any bod that steps on a mine tile picks up that resource. Client shows coloured mines, floating icons, and orbiting pickup orbs on bods. Kill loot remains per bod type (`resourcePercOnDeath`).

## Data

- `TileDef.mineResourceId?: string` — set when `hasMine` at tile generation (random among active resources).
- `MineDef`: single `amount` per visit (replace multi-key `generated`).
- `BodInstance.pickups: string[]` — one resource id per mine visit (soft-cap 12) for orbit FX.
- No mine ownership / claiming for economy this pass.

## Sim

- On bod enter cell: if placed tile `hasMine` and `mineResourceId`, add `amount` to `held`, push to `pickups`.
- Remove auto-claim on tower build and claim-click economy (handler may no-op).
- Kill: killer gets `held * resourcePercOnDeath` for that bod type.

## Client

- Mine mesh tinted to resource colour; floating resource icon above.
- No claim-on-click.
- Placement tile preview shows mine resource.
- Orbiting coloured orbs on bods from `pickups`.

## Out of scope

- Mine upgrades / ownership UI  
- New bod types (only keep per-type loot %)
