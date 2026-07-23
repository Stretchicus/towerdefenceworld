/** Inline SVG icons for resource ids (stone / power / water + fallback). */

const ICONS: Record<string, string> = {
  stone: `<svg class="res-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="#e8e6e1" d="M3 11.5 5.2 7.2 8 5.5l2.6 1.4L13 11.5H3z"/><path fill="#c4c0b8" d="M3 11.5h10l-1.2 1.8H4.2z"/><path fill="#f5f3ef" d="M5.5 9.2 7.2 6.8l1.6.9-1.1 2.3z"/></svg>`,
  power: `<svg class="res-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="#f5d76e" d="M9.2 1.5 4.5 8.2h3.1L6.8 14.5 13 6.8H9.6L9.2 1.5z"/><path fill="#ffe9a0" d="M9.2 1.5 8.4 5.2h2.2L9.2 1.5z"/></svg>`,
  water: `<svg class="res-ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="#5eb8e8" d="M8 1.8c0 0-4.2 5.1-4.2 8.1A4.2 4.2 0 0 0 8 14.1a4.2 4.2 0 0 0 4.2-4.2C12.2 6.9 8 1.8 8 1.8z"/><path fill="#9fd6f5" d="M6.2 9.4c.2-1.4 1.1-2.9 1.8-4 .7 1.1 1.6 2.6 1.8 4-.2 1.5-1 2.4-1.8 2.4s-1.6-.9-1.8-2.4z"/></svg>`,
};

const LABELS: Record<string, string> = {
  stone: "stone",
  power: "power",
  water: "water",
};

/** Hex colours for 3D mines / orbs */
export const RESOURCE_COLORS: Record<string, number> = {
  stone: 0xc4c0b8,
  power: 0xf5d76e,
  water: 0x5eb8e8,
};

export function resourceColor(id: string): number {
  return RESOURCE_COLORS[id] ?? 0x9aabb8;
}

export function resourceLabel(id: string): string {
  return LABELS[id] ?? id;
}

export function resourceIconSvg(id: string): string {
  return (
    ICONS[id] ??
    `<svg class="res-ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="#9ab"/></svg>`
  );
}

/** Icon + amount for cost/bank chips. */
export function resourceAmountHtml(
  id: string,
  amount: string | number,
  extraClass = "",
): string {
  const label = resourceLabel(id);
  const cls = ["res-amt", extraClass].filter(Boolean).join(" ");
  return `<span class="${cls}" title="${label}" aria-label="${label} ${amount}">${resourceIconSvg(id)}<span class="res-num">${amount}</span></span>`;
}
