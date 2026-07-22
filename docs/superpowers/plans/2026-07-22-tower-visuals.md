# Tower visuals Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Ten procedural tower visuals selectable in workshop, shown on map and build/upgrade UI.

**Architecture:** `visualId` on `TowerDef` (game-core); client `towerVisuals.ts` (Three) + SVG icons for HUD/workshop; planet markers resolve visual from loadout.

**Tech Stack:** TypeScript, Three.js, existing workshop HTML.

---

### Task 1: game-core `visualId`
- [ ] Catalog + validate + defaults on basic/sniper/mortar
- [ ] Tests + export

### Task 2: Client Three factories + planet
- [ ] `towerVisuals.ts` create/tick
- [ ] Wire `PlanetView` markers + fingerprint

### Task 3: Workshop picker + HUD icons
- [ ] SVG icons; workshop bind; type picker / upgrade rows
- [ ] Changelog, build tag, push
