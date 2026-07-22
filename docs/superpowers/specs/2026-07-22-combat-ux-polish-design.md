# Combat UX polish — design

**Status:** Implemented 2026-07-22 (v0.1.35)  
**Scope:** Client combat visuals + HUD; thin game-core/client data plumbing for bod HP/type on the view model.

## Goals

1. Bod meshes show remaining HP as a top-truncated sphere (bottom portion kept).
2. Bod type is a shade of the owner color (grunt lighter, bruiser darker).
3. Bod upgrade control lives inside the spawn-toggle chip (separate hit target).
4. Resource names are replaced by icons + amounts across bank/costs/workshop.
5. Building: one tap on a free pad selects it, focuses the globe, and opens the type picker immediately.
6. Type picker stays the confirmation step (pick type → build).

## Non-goals

- New bod types or combat balance changes.
- Reworking pad rail layout beyond picker timing/copy.
- Changing server tick rate or netcode.

## Bod HP shape

- Pass `hp`, `maxHp`, `typeId` into `PlanetViewData.bods` (from match snapshot).
- Geometry: `SphereGeometry` with `thetaStart = (1 - ratio) * π`, `thetaLength = ratio * π`, `ratio = clamp(hp/maxHp, ε, 1)`.
- 100% → full sphere; 50% → lower hemisphere flat-on-top; near 0 → small bottom cap.
- Orient mesh so local +Y is planet-outward (flat faces away from the surface).
- Rebuild geometry when the displayed ratio band changes enough to matter (or on each sync if cheap).

## Bod type shades

- Base = owner team color.
- Grunt: lighten (~+25–35% toward white).
- Bruiser: darken (~25–35%).
- Unknown types: base owner color.
- Keep strong emissive so units stay readable on the dark planet.

## Bod chip

- Single chip per type:
  - Main/left: toggle spawn (`data-bod`), shows name + spawn cost icons.
  - Right: upgrade control (`data-bod-up`) with level + upgrade cost icons; `stopPropagation` so it does not toggle.
- Remove the separate full-width upgrade button row.

## Resource icons

- Shared helper: map `stone` / `power` / `water` (and safe fallback) → small inline SVG + numeric amount.
- `title` / `aria-label` keep the resource name.
- Use in: bank chips, `costChipsHtml`, workshop cost chips, type picker, bod costs, tower/base upgrade costs.
- Visual language: stone = pale pile, power = yellow bolt, water = blue drop.

## Tower build flow

- Free pad click (globe or pad disc): set `selectedBuildCell`, `showTypePicker = true`, `focusCell`.
- Type chip click: `buildTower`, clear selection/picker.
- Switching pads: retarget selection and keep picker open.
- Hint copy: “Pad #N — pick a tower type” (no “tap again”).
- Optional: clicking empty non-pad space or an occupied pad clears selection (nice-to-have if easy).

## Verification

- Visual: damage shrinks bod height; grunt/bruiser distinguishable under same owner color.
- HUD: upgrade click upgrades; chip body toggles; no accidental double action.
- Icons render in lobby workshop + combat bank/costs.
- Single pad click opens type list; one type click builds.
