# Changelog

## 0.1.57 — 2026-07-23

### Fixed

- Manual and auto placement prune spur cul-de-sacs so finished roads have no dead ends
- Tile hold preview uses correct edge rotation and brighter ribbons; legal hexes are dimmer
- Build-pad clicks preferred over road no-entry (larger pad tolerance)

### Added

- Full-screen **STARTING IN 3, 2, 1** countdown after the last tile before combat

## 0.1.56 — 2026-07-23

### Fixed

- Auto/manual placement finish seals open stubs so roads never dead-end into empty land
- Open join arms draw as half-ribbons on already-placed tiles (road to the edge you attach to)

### Changed

- Current tile is held under the cursor on your turn — click a green end to place (no grab from the HUD)

## 0.1.55 — 2026-07-23

### Added

- Grow-from-ends placement: each castle starts with one road stub; tiles may only be placed on open route ends until all castles connect
- Legal tile sampler with split/join pressure (no dead draws; early splits in 3-player games)
- Drag-and-drop tile placement with click/right-click rotate among legal orientations for the hovered end
- Per-player no-entry signs: click a road edge during combat to block your own bods; unlimited toggles, invisible to enemies

### Changed

- Combat pathing picks randomly among branches that reach an alive enemy castle (not shortest-path only)
- Bods reverse when blocked and can damage their owner's castle if retreat locks them in

### Removed

- Targets HUD and `targetEnabled` control; bods only chase alive enemy castles
- Preplanned corridor placement flow (replaced by grow-from-ends network building)

## 0.1.54 — 2026-07-23

### Changed

- Mine visual is a timber headframe with a winding wheel (resource-coloured rim/bucket)
- Pickup orbs keep resource colours (no longer overwritten by bod team tint) and orbit farther out

## 0.1.53 — 2026-07-23

### Added

- Neutral single-resource mines: each mine yields one match resource; bods pick up on step-on
- Coloured mine visuals with floating resource icons; orbiting pickup orbs on bods
- Placement tile preview names the mine resource

### Changed

- Mines are no longer claimable; kill loot still uses held × `resourcePercOnDeath`

## 0.1.52 — 2026-07-23

### Fixed

- Bod build cost is charged when the bod spawns (not when the build queue starts); no spawn if the owner cannot afford it (humans and AI)

## 0.1.51 — 2026-07-23

### Fixed

- Build modal tower buttons work on a single click (no longer rebuilt every combat tick)
- World BUILD bar actually hides (`hidden` was overridden by CSS `display: grid`)

## 0.1.50 — 2026-07-23

### Fixed

- World BUILD bar hides after a tower is built and stays under the build modal

## 0.1.49 — 2026-07-23

### Changed

- Tower build flow: select pad → BUILD bar (world + HUD) → modal tower choice → build
- Build targets HUD no longer lists tower types/costs inline; unaffordable pads dim

## 0.1.48 — 2026-07-22

### Fixed

- Hide placement “road ribbons” hint after combat / when the match ends

## 0.1.47 — 2026-07-22

### Fixed

- No leftover placement-style hex highlight when the match ends

## 0.1.46 — 2026-07-22

### Changed

- End screen uses “Winner” for a single victor, “Winners” when there are more

## 0.1.45 — 2026-07-22

### Fixed

- Empty tower pads are raised plinths with flat rings (correct face orientation)
- Hide “Upgrade base” after the match ends

### Changed

- Winner fireworks climb higher before bursting

## 0.1.44 — 2026-07-22

### Fixed

- Clear all bods (and the build queue) when the match ends so none keep walking

## 0.1.43 — 2026-07-22

### Changed

- Winner fireworks are staggered mortar shells: angled rise, apex burst into a multicolour sphere

## 0.1.42 — 2026-07-22

### Fixed

- Pad rings sit on the rendered hex face (match mesh vertex scale + clearer lift)

## 0.1.41 — 2026-07-22

### Changed

- Castle contact damage is the bod’s remaining HP (was flat `baseContactDamage`)

## 0.1.40 — 2026-07-22

### Added

- End-game: winning castles launch looping fireworks; losing castles burn with flames

## 0.1.39 — 2026-07-22

### Fixed

- Pads sit above the hex face (not sunk); castles seat on the pentagon face like towers

## 0.1.38 — 2026-07-22

### Fixed

- Towers and pads sit on the hex face (no longer float on the sphere radius)

## 0.1.37 — 2026-07-22

### Added

- Ten procedural tower visuals selectable in the workshop (`visualId` on each loadout tower)
- Defaults: basic→keep, sniper→orb, mortar→orbit; used on the map and in build/upgrade UI

## 0.1.36 — 2026-07-22

### Fixed

- Bod truncated HP mesh has a solid colored flat cap (no hollow top)
- BODS list shows a color preview swatch per type (grunt lighter / bruiser darker)

## 0.1.35 — 2026-07-22

### Changed

- Bods show remaining HP as a top-truncated sphere; grunt/bruiser are lighter/darker owner shades
- Bod upgrade control sits inside the spawn toggle chip
- Resource amounts use icons (stone / power / water) instead of text names
- Building: one tap on a free pad opens the tower type picker

## 0.1.34 — 2026-07-22

### Changed

- Two-resource workshops keep build/upgrade discount sliders (only fire rate is 3-resource)
- Resources dropdown temporarily limited to 2 and 3

## 0.1.33 — 2026-07-22

### Changed

- Removed workshop “Taxed resources” and “Loadout valid” hints

## 0.1.32 — 2026-07-22

### Fixed

- Adding a tower keeps the new tower tab selected (no reset to the first tab)

### Changed

- Removed the workshop resource/points status hint under the heading

## 0.1.31 — 2026-07-22

### Changed

- Workshop download/upload are icon buttons beside the TOWER WORKSHOP heading

## 0.1.30 — 2026-07-22

### Changed

- Workshop: `+` and reset sit on the tower tab row; remove uses a trash icon
- Defaults and Remove ask for confirmation before applying

## 0.1.29 — 2026-07-22

### Changed

- Workshop drops Simple / Advanced JSON tabs (sliders only; download/upload kept)
- Active tower tab shows spent points as a thin bottom edge bar instead of a wash fill

## 0.1.28 — 2026-07-22

### Changed

- Workshop slider maxes match the 100-point pool (`floor((100 − other mins) / cost)`)
- Points meter fill lives in the active tower tab background

### Fixed

- Removed the auto-balance hint under the workshop sliders

## 0.1.27 — 2026-07-22

### Fixed

- Workshop sliders stay grabbed while dragging (no mid-drag lobby redraw / server push)
- Slider drag can no longer push a tower over the 100-point pool

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
