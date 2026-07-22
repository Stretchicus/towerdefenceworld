import {
  TOWER_POINT_POOL,
  blankTower,
  defaultTowerLoadout,
  loadoutFileFromTowers,
  normalizeTowerForResources,
  parseLoadoutFile,
  scoreTowerPoints,
  scoreTowerPointsRaw,
  validateLoadout,
  type TowerDef,
} from "@tdw/game-core";

export type WorkshopTab = "simple" | "advanced";

export type SliderField =
  | "power"
  | "range"
  | "fireRate"
  | "buildDiscount"
  | "upgradeDiscount";

export interface WorkshopState {
  towers: TowerDef[];
  resourceCount: number;
  selectedIndex: number;
  tab: WorkshopTab;
  jsonText: string;
  errors: string[];
}

const BASE_SLIDER_FIELDS: SliderField[] = ["power", "range"];
const THREE_RESOURCE_SLIDER_FIELDS: SliderField[] = [
  "fireRate",
  "buildDiscount",
  "upgradeDiscount",
];
const SLIDER_CONFIG: Record<
  SliderField,
  { label: string; min: number; max: number }
> = {
  power: { label: "Power", min: 1, max: 20 },
  range: { label: "Range", min: 1, max: 6 },
  fireRate: { label: "Fire rate", min: 1, max: 10 },
  buildDiscount: { label: "Build discount", min: 0, max: 10 },
  upgradeDiscount: { label: "Upgrade discount", min: 0, max: 8 },
};

function allowedSliderFields(resourceCount: number): SliderField[] {
  return resourceCount >= 3
    ? [...BASE_SLIDER_FIELDS, ...THREE_RESOURCE_SLIDER_FIELDS]
    : BASE_SLIDER_FIELDS;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getField(def: TowerDef, field: SliderField): number {
  return def[field];
}

function setField(def: TowerDef, field: SliderField, value: number): void {
  const { min, max } = SLIDER_CONFIG[field];
  def[field] = clamp(value, min, max);
}

function fieldContribution(
  def: TowerDef,
  field: SliderField,
  resourceCount: number,
): number {
  const original = getField(def, field);
  setField(def, field, 0);
  const base = scoreTowerPointsRaw(def, resourceCount);
  setField(def, field, original);
  return scoreTowerPointsRaw(def, resourceCount) - base;
}

function nudgeReducePoints(def: TowerDef, field: SliderField): boolean {
  const v = getField(def, field);
  if (v <= SLIDER_CONFIG[field].min) return false;
  setField(def, field, v - 1);
  return true;
}

function nudgeIncreasePoints(def: TowerDef, field: SliderField): boolean {
  const v = getField(def, field);
  if (v >= SLIDER_CONFIG[field].max) return false;
  setField(def, field, v + 1);
  return true;
}

function undoNudge(
  def: TowerDef,
  field: SliderField,
  direction: "reduce" | "increase",
): void {
  if (direction === "reduce") {
    setField(def, field, getField(def, field) + 1);
  } else {
    setField(def, field, getField(def, field) - 1);
  }
}

/**
 * Keep tower at TOWER_POINT_POOL by adjusting other sliders.
 * Over → lower the highest-contributing other field.
 * Under → raise the highest-contributing other field that still has room.
 * If others cannot free enough points, clamp the locked field down so spent
 * never stays above the pool.
 * Uses raw (unrounded) score so tiny cost nudges can accumulate.
 */
export function rebalanceTowerToPool(
  def: TowerDef,
  lockedField: SliderField,
  resourceCount: number,
): void {
  for (let i = 0; i < 2000; i++) {
    const spent = scoreTowerPoints(def, resourceCount);
    if (spent === TOWER_POINT_POOL) return;

    const others = allowedSliderFields(resourceCount)
      .filter((f) => f !== lockedField)
      .sort(
        (a, b) =>
          fieldContribution(def, b, resourceCount) -
          fieldContribution(def, a, resourceCount),
      );

    let moved = false;
    if (spent > TOWER_POINT_POOL) {
      for (const field of others) {
        const beforeRaw = scoreTowerPointsRaw(def, resourceCount);
        if (!nudgeReducePoints(def, field)) continue;
        const afterRaw = scoreTowerPointsRaw(def, resourceCount);
        if (afterRaw >= beforeRaw - 1e-9) {
          undoNudge(def, field, "reduce");
          continue;
        }
        moved = true;
        break;
      }
      if (!moved) {
        // Others are already at floor — force the dragged field back under pool.
        if (!nudgeReducePoints(def, lockedField)) return;
        continue;
      }
    } else {
      for (const field of others) {
        const beforeRaw = scoreTowerPointsRaw(def, resourceCount);
        if (!nudgeIncreasePoints(def, field)) continue;
        const after = scoreTowerPoints(def, resourceCount);
        const afterRaw = scoreTowerPointsRaw(def, resourceCount);
        if (afterRaw <= beforeRaw + 1e-9) {
          undoNudge(def, field, "increase");
          continue;
        }
        // Never accept a nudge that pushes over the pool (validation is ≤ 100).
        if (after > TOWER_POINT_POOL) {
          undoNudge(def, field, "increase");
          continue;
        }
        moved = true;
        break;
      }
      if (!moved) return;
    }
  }
}

export function createWorkshopState(
  towers: TowerDef[] | undefined,
  resourceCount: number,
): WorkshopState {
  const list =
    towers && towers.length > 0
      ? towers.map((tower) =>
          normalizeTowerForResources(tower, resourceCount),
        )
      : defaultTowerLoadout(resourceCount);
  return {
    towers: list,
    resourceCount,
    selectedIndex: 0,
    tab: "simple",
    jsonText: JSON.stringify(loadoutFileFromTowers(list), null, 2),
    errors: [],
  };
}

export function syncWorkshopJson(state: WorkshopState): void {
  state.jsonText = JSON.stringify(
    loadoutFileFromTowers(state.towers),
    null,
    2,
  );
}

export function workshopValidation(state: WorkshopState): string[] {
  const v = validateLoadout(state.towers, state.resourceCount);
  return v.ok ? [] : v.errors;
}

export function isWorkshopValid(state: WorkshopState): boolean {
  return workshopValidation(state).length === 0;
}

export function pointsMeter(def: TowerDef, resourceCount: number): {
  spent: number;
  pool: number;
  over: boolean;
} {
  const spent = scoreTowerPoints(def, resourceCount);
  return { spent, pool: TOWER_POINT_POOL, over: spent > TOWER_POINT_POOL };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function costChips(cost: Record<string, number>): string {
  return Object.entries(cost)
    .map(([resource, amount]) => `<span class="chip">${resource} ${amount}</span>`)
    .join("");
}

function formatSliderDisplay(field: SliderField, n: number): string {
  if (field.endsWith("Discount")) {
    return `${n} → ${n * 5}% off`;
  }
  return String(n);
}

function syncSimpleSliderDom(
  root: HTMLElement,
  def: TowerDef,
  resourceCount: number,
  /** Skip rewriting this range input unless its value was clamped. */
  draggingField?: SliderField,
): void {
  for (const field of allowedSliderFields(resourceCount)) {
    const input = root.querySelector(
      `[data-ws-field="${field}"]`,
    ) as HTMLInputElement | null;
    const val = root.querySelector(`[data-ws-val="${field}"]`);
    const n = getField(def, field);
    if (input) {
      const next = String(n);
      // Assigning .value mid-drag cancels the pointer gesture in browsers,
      // even when the number is unchanged — only write when needed.
      if (field !== draggingField || input.value !== next) {
        input.value = next;
      }
    }
    if (val) val.textContent = formatSliderDisplay(field, n);
  }
  const costs = root.querySelector(".ws-costs");
  if (costs) {
    costs.innerHTML = `<span>Build ${costChips(def.buildCost)}</span><span>Upgrade ${costChips(def.upgradeCost)}</span>`;
  }
  const meter = pointsMeter(def, resourceCount);
  const fill = root.querySelector(".ws-meter-fill") as HTMLElement | null;
  const box = root.querySelector(".ws-meter");
  const label = root.querySelector(".ws-meter span");
  if (fill) {
    fill.style.width = `${Math.min(100, (meter.spent / TOWER_POINT_POOL) * 100)}%`;
  }
  box?.classList.toggle("over", meter.over);
  if (label) label.textContent = `${meter.spent} / ${TOWER_POINT_POOL} points`;
}

export function workshopHtml(state: WorkshopState): string {
  const errors = workshopValidation(state);
  state.errors = errors;
  const idx = Math.min(
    state.selectedIndex,
    Math.max(0, state.towers.length - 1),
  );
  state.selectedIndex = idx;
  const t = state.towers[idx];
  const meter = t ? pointsMeter(t, state.resourceCount) : null;

  const towerTabs = state.towers
    .map((tw, i) => {
      const m = pointsMeter(tw, state.resourceCount);
      return `<button type="button" class="ws-tower-tab ${i === idx ? "on" : ""} ${m.over ? "over" : ""}" data-ws-select="${i}">${escapeHtml(tw.id)} <span class="ws-pts">${m.spent}/${m.pool}</span></button>`;
    })
    .join("");

  const simpleSliders = t
    ? allowedSliderFields(state.resourceCount)
        .map((field) => {
          const config = SLIDER_CONFIG[field];
          const value = getField(t, field);
          return `<label>${config.label} <input type="range" min="${config.min}" max="${config.max}" data-ws-field="${field}" value="${value}" /><span data-ws-val="${field}">${formatSliderDisplay(field, value)}</span></label>`;
        })
        .join("")
    : "";
  const simple = t
    ? `<div class="ws-simple">
        <label>Id <input data-ws-field="id" value="${escapeHtml(t.id)}" /></label>
        ${simpleSliders}
        <p class="hint">Taxed resources: power → power · range → stone${state.resourceCount >= 3 ? " · fire rate → water" : ""}</p>
        <div class="ws-costs"><span>Build ${costChips(t.buildCost)}</span><span>Upgrade ${costChips(t.upgradeCost)}</span></div>
        <div class="ws-meter ${meter?.over ? "over" : ""}">
          <div class="ws-meter-fill" style="width:${Math.min(100, ((meter?.spent ?? 0) / TOWER_POINT_POOL) * 100)}%"></div>
          <span>${meter?.spent ?? 0} / ${TOWER_POINT_POOL} points</span>
        </div>
        <p class="hint">Sliders auto-balance to ${TOWER_POINT_POOL} by adjusting the highest other stat.</p>
      </div>`
    : `<p class="hint">No towers in loadout.</p>`;

  const advanced = `<textarea class="ws-json" data-ws-json rows="12" spellcheck="false">${escapeHtml(state.jsonText)}</textarea>
    <div class="row">
      <button type="button" class="secondary" data-ws-validate-json>Validate JSON</button>
      <button type="button" data-ws-apply-json>Apply JSON</button>
    </div>`;

  return `<div class="workshop" id="tower-workshop">
    <h2>TOWER WORKSHOP</h2>
    <p class="hint">${state.resourceCount} resources · 100 points per tower · derived costs · Ready blocked if invalid</p>
    <div class="ws-tower-tabs">${towerTabs || `<span class="hint">Empty</span>`}</div>
    <div class="row ws-actions">
      <button type="button" class="secondary" data-ws-add>Add</button>
      <button type="button" class="secondary" data-ws-remove ${state.towers.length <= 1 ? "disabled" : ""}>Remove</button>
      <button type="button" class="secondary" data-ws-defaults>Defaults</button>
      <button type="button" class="secondary" data-ws-download>Download</button>
      <label class="ws-upload secondary"><input type="file" accept="application/json,.json" data-ws-upload hidden />Upload</label>
    </div>
    <div class="row">
      <button type="button" class="chip ${state.tab === "simple" ? "on" : "off"}" data-ws-tab="simple">Simple</button>
      <button type="button" class="chip ${state.tab === "advanced" ? "on" : "off"}" data-ws-tab="advanced">Advanced JSON</button>
    </div>
    ${state.tab === "simple" ? simple : advanced}
    ${
      errors.length
        ? `<ul class="ws-errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
        : `<p class="hint ws-ok">Loadout valid</p>`
    }
  </div>`;
}

export function bindWorkshop(
  root: HTMLElement,
  state: WorkshopState,
  onChange: (kind?: "soft" | "hard" | "commit") => void,
): void {
  const applySlider = (field: SliderField, raw: string) => {
    const t = state.towers[state.selectedIndex];
    if (!t) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setField(t, field, n);
    const normalized = normalizeTowerForResources(t, state.resourceCount);
    state.towers[state.selectedIndex] = normalized;
    rebalanceTowerToPool(normalized, field, state.resourceCount);
    state.towers[state.selectedIndex] = normalizeTowerForResources(
      normalized,
      state.resourceCount,
    );
    syncWorkshopJson(state);
  };

  const softValidate = () => {
    const errors = workshopValidation(state);
    state.errors = errors;
    let list = root.querySelector(".ws-errors");
    const ok = root.querySelector(".ws-ok");
    if (errors.length) {
      ok?.remove();
      if (!list) {
        list = document.createElement("ul");
        list.className = "ws-errors";
        root.appendChild(list);
      }
      list.innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    } else {
      list?.remove();
      if (!root.querySelector(".ws-ok")) {
        const el = document.createElement("p");
        el.className = "hint ws-ok";
        el.textContent = "Loadout valid";
        root.appendChild(el);
      }
    }
    const ready = document.getElementById(
      "btn-ready",
    ) as HTMLButtonElement | null;
    if (ready) {
      ready.disabled = errors.length > 0;
      ready.title = errors.length ? "Fix loadout first" : "";
    }
  };

  const refreshAfterSlider = (draggingField?: SliderField) => {
    const t = state.towers[state.selectedIndex];
    if (!t) return;
    syncSimpleSliderDom(root, t, state.resourceCount, draggingField);
    const tab = root.querySelector(
      `[data-ws-select="${state.selectedIndex}"] .ws-pts`,
    );
    const meter = pointsMeter(t, state.resourceCount);
    if (tab) tab.textContent = `${meter.spent}/${meter.pool}`;
    softValidate();
  };

  root.querySelectorAll("[data-ws-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedIndex = Number((btn as HTMLElement).dataset.wsSelect);
      onChange("hard");
    });
  });
  root.querySelectorAll("[data-ws-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = (btn as HTMLElement).dataset.wsTab as WorkshopTab;
      if (state.tab === "advanced") syncWorkshopJson(state);
      onChange("hard");
    });
  });
  root.querySelector("[data-ws-add]")?.addEventListener("click", () => {
    const id = `tower-${state.towers.length + 1}`;
    const tower = normalizeTowerForResources(
      blankTower(id, state.resourceCount),
      state.resourceCount,
    );
    rebalanceTowerToPool(tower, "power", state.resourceCount);
    state.towers.push(normalizeTowerForResources(tower, state.resourceCount));
    state.selectedIndex = state.towers.length - 1;
    syncWorkshopJson(state);
    onChange("hard");
  });
  root.querySelector("[data-ws-remove]")?.addEventListener("click", () => {
    if (state.towers.length <= 1) return;
    state.towers.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    syncWorkshopJson(state);
    onChange("hard");
  });
  root.querySelector("[data-ws-defaults]")?.addEventListener("click", () => {
    state.towers = defaultTowerLoadout(state.resourceCount);
    state.selectedIndex = 0;
    syncWorkshopJson(state);
    onChange("hard");
  });
  root.querySelector("[data-ws-download]")?.addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify(loadoutFileFromTowers(state.towers), null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tdw-loadout-v2.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  root.querySelector("[data-ws-upload]")?.addEventListener("change", (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const parsed = parseLoadoutFile(JSON.parse(text), state.resourceCount);
        if (!parsed.ok || !parsed.towers) {
          state.errors = parsed.ok ? ["import failed"] : parsed.errors;
          onChange("hard");
          return;
        }
        state.towers = structuredClone(parsed.towers);
        state.selectedIndex = 0;
        syncWorkshopJson(state);
        onChange("hard");
      } catch {
        state.errors = ["invalid JSON file"];
        onChange("hard");
      }
    });
  });
  root.querySelectorAll("[data-ws-field]").forEach((el) => {
    const input = el as HTMLInputElement;
    const field = input.dataset.wsField!;
    if (input.type === "range") {
      const sliderField = field as SliderField;
      input.addEventListener("input", () => {
        applySlider(sliderField, input.value);
        // Local meter/chip updates only — no server push / lobby paint mid-drag.
        refreshAfterSlider(sliderField);
        onChange("soft");
      });
      input.addEventListener("change", () => {
        applySlider(sliderField, input.value);
        refreshAfterSlider(sliderField);
        onChange("commit");
      });
    } else {
      input.addEventListener("change", () => {
        const t = state.towers[state.selectedIndex];
        if (!t) return;
        t.id = input.value.trim() || t.id;
        syncWorkshopJson(state);
        onChange("hard");
      });
    }
  });

  const jsonArea = root.querySelector(
    "[data-ws-json]",
  ) as HTMLTextAreaElement | null;
  jsonArea?.addEventListener("input", () => {
    state.jsonText = jsonArea.value;
  });
  root.querySelector("[data-ws-validate-json]")?.addEventListener("click", () => {
    try {
      const parsed = parseLoadoutFile(
        JSON.parse(state.jsonText),
        state.resourceCount,
      );
      state.errors = parsed.ok ? [] : parsed.errors;
    } catch {
      state.errors = ["invalid JSON"];
    }
    onChange("hard");
  });
  root.querySelector("[data-ws-apply-json]")?.addEventListener("click", () => {
    try {
      const parsed = parseLoadoutFile(
        JSON.parse(state.jsonText),
        state.resourceCount,
      );
      if (!parsed.ok || !parsed.towers) {
        state.errors = parsed.ok ? ["apply failed"] : parsed.errors;
        onChange("hard");
        return;
      }
      state.towers = structuredClone(parsed.towers);
      state.selectedIndex = 0;
      syncWorkshopJson(state);
      onChange("hard");
    } catch {
      state.errors = ["invalid JSON"];
      onChange("hard");
    }
  });
}
