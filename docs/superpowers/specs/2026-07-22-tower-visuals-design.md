# Tower visual designs — design

**Status:** Implemented 2026-07-22 (v0.1.37)  
**Approach:** Procedural low-poly factories on the client (castle-adjacent detail).

## Goals

- Ten distinct tower silhouettes, always tinted with the **owner team color**.
- Each loadout tower stores a `visualId`; workshop can pick it.
- Defaults: basic→`keep`, sniper→`orb`, mortar→`orbit`.
- Same visual used on the planet map and in build / upgrade HUD affordances.

## Non-goals

- External mesh assets / GLBs.
- Per-design combat stats (visual only).
- Changing tower combat balance.

## Catalog

| visualId | Name | Notes |
|----------|------|-------|
| `keep` | Keep | Square turret + crenellations |
| `orb` | Orb spire | Shaft + translucent pulsing sphere |
| `orbit` | Orbit tip | Cone + orbiting balls |
| `spire` | Spire | Tall cylinder + cone roof |
| `disk` | Disk array | Stacked discs on a post |
| `obelisk` | Obelisk | Tapered square pillar |
| `twin` | Twin barrels | Two barrels on a block |
| `crystal` | Crystal | Pedestal + angular gem |
| `beacon` | Beacon | Tri prism + top lamp |
| `bastion` | Bastion | Hex drum + cupola |

## Data

- `TowerDef.visualId: string` — one of the ids above.
- Validation: unknown → error (or clamp to `keep` on normalize — prefer validate + default on blank/default loadouts).
- Serialize through loadout / match snapshot as part of loadout defs; planet markers need `typeId` + resolve `visualId` from owner loadout (same as stats).

## Client rendering

- `towerVisuals.ts`: `createTowerVisual(visualId, teamColor): THREE.Group` + optional `tickTowerVisual(group, t)`.
- Accents = lighter/darker of team color; orb uses semi-transparent emissive; orbit balls animate in `PlanetView.render`.
- HUD: small inline SVG or canvas/CSS preview isn’t required if we can show a colored CSS/SVG glyph per id; prefer a tiny Three.js-free CSS/SVG icon set matching silhouettes for workshop + type picker, OR shared SVG paths. Simplest durable approach: CSS/SVG icon sprites per `visualId` for 2D UI + Three factories for 3D.

## Workshop

- Visual picker row: 10 selectable thumbnails (SVG), current selection highlighted.
- Stored on the selected tower; download/upload includes `visualId`.

## Verification

- Default trio shows three different silhouettes in-game.
- Changing visual in workshop updates after build / on existing towers after reload/sync.
- Team colors remain readable across designs.
