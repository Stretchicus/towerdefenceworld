# Tower Loadouts Workshop Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Per-player tower loadouts with 100-point budget, lobby workshop + download/upload, pad type picker, and bod upgrade UI.

**Architecture:** `game-core` owns validation/scoring/defaults; match stores `player.loadout`; server accepts `setLoadout` and `buildTower` with `typeId`; client workshop in lobby + combat pickers.

**Tech Stack:** TypeScript monorepo `@tdw/game-core`, `@tdw/server`, `@tdw/client`.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-21-tower-loadouts-workshop-design.md`
- `TOWER_POINT_POOL = 100`; formula as in spec
- Default loadout: basic, sniper, mortar
- No RPS / AoE wiring this phase
- Client build tag bump when UI ships

## Files

- Create: `packages/game-core/src/towers/loadout.ts`
- Modify: `types.ts`, `defaultGameConfig.ts`, `config/defaultGame.json`, `sim/match.ts`, `index.ts`, `index.test.ts`
- Modify: `packages/server/src/room.ts`
- Modify: `packages/client/src/main.ts`, `styles.css`

---

### Task 1: Loadout validation + defaults (game-core)

- [x] Implement `scoreTowerPoints`, `validateTowerDef`, `validateLoadout`, `defaultTowerLoadout`
- [x] Tests: basic scores ≤100; over-budget rejects; defaults validate
- [ ] Commit

### Task 2: Match uses player loadout

- [x] `PlayerState.loadout: TowerDef[]`
- [x] `createMatch` accepts optional per-seat loadouts; AI gets defaults
- [x] `intentBuildTower(..., typeId)` resolves from player loadout
- [x] Serialize loadouts + tower typeId
- [x] Tests for build with typeId
- [ ] Commit

### Task 3: Server lobby setLoadout

- [x] Seat stores loadout; `setLoadout` message; validate; copy into match on start
- [x] Lobby snapshot includes loadout summary for local seat
- [ ] Commit

### Task 4: Client workshop + combat UI

- [x] Lobby tower workshop (sliders, JSON, download/upload, points meter)
- [x] Pad type picker; bod upgrade buttons
- [x] Build tag bump
- [ ] Commit
