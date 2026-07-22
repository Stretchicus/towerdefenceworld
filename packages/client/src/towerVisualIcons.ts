import {
  TOWER_VISUAL_IDS,
  TOWER_VISUAL_LABELS,
  normalizeTowerVisualId,
  type TowerVisualId,
} from "@tdw/game-core";

/** Tiny SVG silhouettes for workshop / HUD (currentColor). */
const ICONS: Record<TowerVisualId, string> = {
  keep: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 20V9h2V7h2v2h2V7h2v2h2V7h2v2h2v11H6zm2-2h2v-2H8v2zm4 0h2v-2h-2v2zm4 0h2v-2h-2v2z"/></svg>`,
  orb: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 14h2V5h-2v9zm1 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" opacity=".95"/><circle cx="12" cy="17" r="2.6" fill="currentColor" opacity=".45"/></svg>`,
  orbit: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 6 18h12L12 3z"/><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="17" cy="9" r="1.2" fill="currentColor"/><circle cx="7" cy="9" r="1.2" fill="currentColor"/></svg>`,
  spire: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 20h2V8h-2v12zm1-17 3 5H9l3-5z"/></svg>`,
  disk: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="11" y="6" width="2" height="14" fill="currentColor"/><ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor"/><ellipse cx="12" cy="12" rx="6" ry="1.8" fill="currentColor"/><ellipse cx="12" cy="16" rx="5" ry="1.6" fill="currentColor"/></svg>`,
  obelisk: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 20h6V8l-3-5-3 5v12z"/></svg>`,
  twin: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="16" width="16" height="4" rx="1" fill="currentColor"/><rect x="6" y="6" width="4" height="11" rx="1" fill="currentColor"/><rect x="14" y="6" width="4" height="11" rx="1" fill="currentColor"/></svg>`,
  crystal: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 7 10l5 11 5-11-5-7zm0 3.2 2.4 3.3H9.6L12 6.2z"/></svg>`,
  beacon: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4 8 20h8L12 4z"/><circle cx="12" cy="6" r="2.2" fill="currentColor" opacity=".7"/></svg>`,
  bastion: `<svg class="tv-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 16h14l-1.5 4H6.5L5 16zm3-7h8v7H8V9zm2-3h4v3h-4V6z"/></svg>`,
};

export function towerVisualIconHtml(visualId: string | undefined): string {
  const id = normalizeTowerVisualId(visualId);
  return ICONS[id];
}

export function towerVisualPickerHtml(selected: string | undefined): string {
  const cur = normalizeTowerVisualId(selected);
  return `<div class="ws-visuals" role="listbox" aria-label="Tower visual">
    ${TOWER_VISUAL_IDS.map((id) => {
      const label = TOWER_VISUAL_LABELS[id];
      return `<button type="button" class="ws-visual ${id === cur ? "on" : ""}" data-ws-visual="${id}" title="${label}" aria-label="${label}" role="option" aria-selected="${id === cur ? "true" : "false"}">${ICONS[id]}<span class="ws-visual-name">${label}</span></button>`;
    }).join("")}
  </div>`;
}
