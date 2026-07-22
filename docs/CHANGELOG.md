# Changelog

## 0.1.26 — 2026-07-22

### Changed

- Command lobby uses a responsive two-column layout on wide screens (setup + workshop)

## 0.1.25 — 2026-07-21

### Changed

- Workshop v2 gates stat and discount sliders by lobby resource count, derives live build/upgrade costs, and imports/exports v2 loadout files.

## 0.1.24 — 2026-07-21

### Fixed

- Workshop sliders no longer jump the lobby scroll back to the top

## 0.1.23 — 2026-07-21

### Changed

- Workshop sliders auto-balance to 100 points by adjusting the highest other stat

## 0.1.22 — 2026-07-21

### Fixed

- Lobby tower workshop scrolls when taller than the viewport

## 0.1.21 — 2026-07-21

### Added

- Per-player tower loadouts (basic / sniper / mortar) with 100-point budget
- Lobby tower workshop: sliders, JSON, download/upload `tdw-loadout-v1.json`
- Combat pad type picker; bod upgrade buttons with level-scaled costs

### Docs

- Design: `docs/superpowers/specs/2026-07-21-tower-loadouts-workshop-design.md`

## 0.1.13 — 2026-07-21

### Fixed

- Road strips meet through hex centres so paths look continuous
- At least 5 tower pads guaranteed on corridors
- Auto corridors meander via triangle detours to ~75% of planet cells

## 0.1.11 — 2026-07-21

### Fixed

- Roads drawn coplanar with hex faces (no sphere-chord dip at joins)
- Upgrade cost chips / greying use level-scaled costs (match server)

## 0.1.10 — 2026-07-21

### Changed

- Towers cost ~one start bank (70 stone + 55 power); bods much cheaper
- Cost chips on build/upgrade/bod actions; unaffordable actions greyed out
- Routes as flat road ribbons on the hex surface; props sit on the grid
- Camera orbit inertia; HUD/markers no longer fully rebuild every tick

### Docs

- Design: `docs/superpowers/specs/2026-07-21-economy-feel-roads-design.md`

## 0.1.3 — 2026-07-21

### Fixed

- Manual placement: Start applies lobby form (was stuck on default Auto)
- AI places one tile ~every 1.2s on its turn, not 10/sec
- Turn banner shows whose placement turn it is

## 0.1.1 — 2026-07-21

### Changed

- Routes drawn as bright gold tubes; route cells highlighted
- Empty tower pads shown as cyan rings + HUD build list / upgrade buttons
- Leave button exits room (seat becomes AI mid-match)
- AI builds slower and only near its own base

### Testing

- `npm test`; client/server build

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
