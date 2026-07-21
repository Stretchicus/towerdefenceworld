# Changelog

## 0.1.0 — 2026-07-21

### Added

- Monorepo: `@tdw/game-core`, `@tdw/server`, `@tdw/client`
- Living SPEC, ADRs, deploy notes
- Full economy JSON schemas; v1 thin combat wiring
- Goldberg planet S/M/L, placement legality, auto-placer, auto-bridge
- Phase-2 tick sim: targeting, mines, death loot, upgrades
- Node WebSocket rooms with lobby (FFA/teams, win rules, AI seats)
- Three.js sphere client + placement/combat HUD
- Apache reverse-proxy deploy documentation

### Why

Deliver the agreed v1 online vertical slice for Tower Defence World.

### Impact

Greenfield playable local/online smoke on self-hosted Node.

### Migration

None (initial release).

### Breaking changes

None.

### Testing

- `npm test` (game-core unit tests)
- Manual: `npm run dev`, 2-browser room smoke (see docs/DEPLOY.md)
