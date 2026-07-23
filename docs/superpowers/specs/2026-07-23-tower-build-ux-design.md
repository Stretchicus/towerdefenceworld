# Tower build UX redesign

**Status:** Approved 2026-07-23  
**Version target:** client v0.1.49

## Goal

Replace the combat “tap pad → inline type picker” flow with a clearer select → Build → modal choose → build workflow. Game continues while the modal is open. Client-only; still one `buildTower` message.

## Flow

1. Player selects a free build pad (planet tap or HUD pad disc).
2. Camera focuses that pad. If any loadout tower is affordable, an Underground-style **BUILD** bar appears over the pad in the world and across the selected HUD disc.
3. Clicking Build opens a tower-choice modal (match keeps ticking).
4. Clicking an affordable tower sends `buildTower` and clears selection.

### Dismiss modal

- Explicit **Cancel**, or click outside (backdrop).
- Pad stays selected; Build bars remain if still affordable.

### Deselect pad

- Toggle the same pad again, or click empty / non-pad ground.
- Selecting a different free pad switches target and closes the modal if open.

## Affordability

- If no loadout tower is affordable: free pads are dimmed (world + HUD); no Build bars.
- If a pad is selected and the bank becomes affordable: Build bars appear.
- In the modal, unaffordable towers stay visible but dimmed and not clickable.

## HUD

- Remove inline type/cost picker and “pick a tower type” hints.
- Keep: build target discs + existing towers (upgrades with costs unchanged).
- Selected + affordable: disc uses London Underground roundel look — horizontal BUILD bar crossing the disc.

## World Build control

- HTML overlay projected from the selected pad each frame.
- Same visual language as the HUD bar.
- Hide when the pad is behind the globe or off-screen.

## Technical notes

- State: `selectedBuildCell`, `showBuildPopup`.
- Projection helper + DOM overlay (no CSS2DRenderer).
- Pass affordability into planet view to dim empty pad meshes.
- No server/sim API changes.

## Out of scope

- Redesigning tower upgrades
- In-scene mesh / CSS2D buttons
