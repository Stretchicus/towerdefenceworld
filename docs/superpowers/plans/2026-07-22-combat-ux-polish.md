# Combat UX polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Truncated HP bods, type shades, bod chip upgrade-in-toggle, resource icons, and one-tap tower type picker.

**Architecture:** Thin data plumbing into `PlanetViewData`; geometry/material updates in `planetView.ts`; shared resource icon helper used by HUD + workshop; build state machine simplified in `main.ts`.

**Tech Stack:** TypeScript, Three.js, existing client HUD HTML/CSS.

## Global Constraints

- No combat balance / new bod types.
- Preserve owner-color readability; type is shade only.
- Always push after meaningful commits (project rule).

---

### Task 1: Resource icons helper

**Files:**
- Create: `packages/client/src/resourceIcons.ts`
- Modify: `packages/client/src/main.ts` (`costChipsHtml`, bank chips)
- Modify: `packages/client/src/loadoutWorkshop.ts` (`costChips`)
- Modify: `packages/client/src/styles.css` (icon chip sizing)

- [ ] Add `resourceIconSvg(id)` + `resourceAmountHtml(id, amount, className?)` with stone/power/water SVGs and text fallback.
- [ ] Wire into cost chips + bank + workshop.
- [ ] Build client; smoke that chips show icons.
- [ ] Commit.

### Task 2: Bod chip with inline upgrade

**Files:**
- Modify: `packages/client/src/main.ts` (bod HTML + handlers)
- Modify: `packages/client/src/styles.css` (`.bod-chip`, upgrade slot)

- [ ] Render one chip: toggle body + inner upgrade control.
- [ ] Ensure upgrade click stops propagation; patchMatchLive still updates both costs.
- [ ] Commit.

### Task 3: One-tap type picker

**Files:**
- Modify: `packages/client/src/main.ts` (pad disc + `onCellClick` combat branch, hints)

- [ ] First free-pad tap sets selection + `showTypePicker = true` + focus.
- [ ] Update pad hint / ready-build classes; remove “tap again” copy.
- [ ] Commit.

### Task 4: Bod HP + type in view data + truncated meshes

**Files:**
- Modify: `packages/client/src/planetView.ts` (`PlanetViewData`, `syncBods`, `placeBodMesh`)
- Modify: `packages/client/src/main.ts` (map match bods → view data with hp/maxHp/typeId)
- Modify: `packages/client/src/styles.css` only if needed

- [ ] Extend bod view model with `hp`, `maxHp`, `typeId`.
- [ ] Truncate sphere by HP ratio; orient outward; shade by type.
- [ ] Rebuild geometry when ratio changes materially.
- [ ] Build client; commit.

### Task 5: Changelog + ship

- [ ] Bump `CLIENT_BUILD`, changelog entry.
- [ ] `npm test` + client build.
- [ ] Commit + push.
