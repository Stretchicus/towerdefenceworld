# Economy, cost UI, surface roads, and feel — design

Date: 2026-07-21  
Status: approved

## Goals

1. Towers costly enough for ~1 at start, ~30s income for the next; bods far cheaper.
2. Unaffordable actions greyed out; compact cost chips on every spend action.
3. Props and roads sit on the hex grid (not atmosphere shell); roads as flat face ribbons.
4. Client always responsive: camera inertia, tweened motion, no per-tick HUD/mesh thrash.
5. Multiple tower types: **out of scope** (later phase).

## Economy

| Item | Value |
|------|--------|
| Starting bank | stone/water/power 80 each (unchanged) |
| Basic tower `buildCost` | `{ stone: 70, power: 55 }` |
| Grunt `resourcesToBuild` | `{ stone: 4, water: 2 }` |
| Bruiser `resourcesToBuild` | `{ stone: 12, power: 6 }` |
| AI combat | Same costs; keep auto-build (natural pace from economy) |

Keep `config/defaultGame.json` in sync with `defaultGameConfig.ts`.

## Cost UI

- Compact chips next to actions: e.g. `stone 70` · `power 55` (resource key labels, no emoji required).
- Apply to: build tower, upgrade tower, upgrade base, and any other spend buttons present.
- Unaffordable → `disabled` + muted styling; affordable → normal + hover/active feedback.
- Drive costs from match config / state payload when available; avoid hardcoding if config is already on the wire.

## Roads & surface placement

- Replace per-edge raised Bézier tubes with **flat road ribbons on hex faces** (corridor cells tinted / inset strip along open connections).
- Castles, towers, pads, mines, bods: position at cell-center radius ≈ tile surface (~1.00–1.02), **not** atmosphere (1.08).
- Bod motion: lerp along surface (normalize to surface radius), tween between cells.

## Feel / responsiveness

- **Camera inertia:** pointer drag adds angular velocity; release coasts with damping.
- **HUD:** incremental DOM updates (bank text, disabled flags); do not replace full `innerHTML` every combat tick.
- **Markers:** rebuild only when entity fingerprint changes; do not redraw roads every tick.
- Buttons that cannot fire must look disabled so “no response” is not confused with lag.

## Non-goals

- New tower types
- Redesign of placement corridor logic
- Full Orbital Dominion visual clone
