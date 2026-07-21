# Economy / feel / roads Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Costly towers + cheap bods, cost chips with grey-out, flat on-hex roads, surface props, camera inertia, responsive HUD.

**Architecture:** Tune `defaultGameConfig` + JSON; client cost helpers from match config; `planetView` surface radii + face ribbons + orbit damping; `main.ts` incremental HUD updates and marker dirty keys.

**Tech Stack:** TypeScript, Three.js, existing npm workspaces.

## Global Constraints

- Build tag bump to v0.1.10
- No multi tower types this pass
- Keep corridor pairwise logic unchanged

---

### Task 1: Economy numbers

- [ ] Update `packages/game-core/src/defaultGameConfig.ts` and `config/defaultGame.json`
- [ ] Tower 70 stone + 55 power; grunt 4+2 water; bruiser 12+6 power
- [ ] Test: can afford exactly one basic tower from starting bank; not two
- [ ] Commit

### Task 2: Cost chips + afford greying

- [ ] Client: read tower/base/bod costs from match config if present, else defaults
- [ ] Chip helper + disable all spend buttons when `!canAfford`
- [ ] CSS for chips + disabled/hover
- [ ] Commit

### Task 3: Surface roads + prop radii

- [ ] `planetView`: road ribbons on faces; surface radius ~1.01 for markers/bods
- [ ] Remove raised edge tubes as primary route viz
- [ ] Commit

### Task 4: Camera inertia + responsive updates

- [ ] Orbit angular velocity + damping in `planetView`
- [ ] `main.ts`: avoid full HUD rebuild every tick; marker refresh only on fingerprint change
- [ ] Build tag v0.1.10; test + build client/server
- [ ] Commit
