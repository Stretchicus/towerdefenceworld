import {
  TOWER_POINT_POOL,
  SLIDER_MIN,
  allowedSliderFields,
  blankTower,
  defaultTowerLoadout,
  loadoutFileFromTowers,
  maxSliderValue,
  normalizeTowerForResources,
  parseLoadoutFile,
  scoreTowerPoints,
  scoreTowerPointsRaw,
  validateLoadout,
  type SliderStatField,
  type TowerDef,
} from "@tdw/game-core";

export type WorkshopTab = "simple" | "advanced";

export type SliderField = SliderStatField;

export interface WorkshopState {
  towers: TowerDef[];
  resourceCount: number;
  selectedIndex: number;
  tab: WorkshopTab;
  jsonText: string;
  errors: string[];
}

const SLIDER_LABEL: Record<SliderField, string> = {
  power: "Power",
  range: "Range",
  fireRate: "Fire rate",
  buildDiscount: "Build discount",
  upgradeDiscount: "Upgrade discount",
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getField(def: TowerDef, field: SliderField): number {
  return def[field];
}

function setField(
  def: TowerDef,
  field: SliderField,
  value: number,
  resourceCount: number,
): void {
  const min = SLIDER_MIN[field];
  const max = maxSliderValue(field, resourceCount);
  def[field] = clamp(value, min, max);
}

function fieldContribution(
  def: TowerDef,
  field: SliderField,
  resourceCount: number,
): number {
  const original = getField(def, field);
  setField(def, field, 0, resourceCount);
  const base = scoreTowerPointsRaw(def, resourceCount);
  setField(def, field, original, resourceCount);
  return scoreTowerPointsRaw(def, resourceCount) - base;
}

function nudgeReducePoints(
  def: TowerDef,
  field: SliderField,
  resourceCount: number,
): boolean {
  const v = getField(def, field);
  if (v <= SLIDER_MIN[field]) return false;
  setField(def, field, v - 1, resourceCount);
  return true;
}

function nudgeIncreasePoints(
  def: TowerDef,
  field: SliderField,
  resourceCount: number,
): boolean {
  const v = getField(def, field);
  if (v >= maxSliderValue(field, resourceCount)) return false;
  setField(def, field, v + 1, resourceCount);
  return true;
}

function undoNudge(
  def: TowerDef,
  field: SliderField,
  direction: "reduce" | "increase",
  resourceCount: number,
): void {
  if (direction === "reduce") {
    setField(def, field, getField(def, field) + 1, resourceCount);
  } else {
    setField(def, field, getField(def, field) - 1, resourceCount);
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
        if (!nudgeReducePoints(def, field, resourceCount)) continue;
        const afterRaw = scoreTowerPointsRaw(def, resourceCount);
        if (afterRaw >= beforeRaw - 1e-9) {
          undoNudge(def, field, "reduce", resourceCount);
          continue;
        }
        moved = true;
        break;
      }
      if (!moved) {
        // Others are already at floor — force the dragged field back under pool.
        if (!nudgeReducePoints(def, lockedField, resourceCount)) return;
        continue;
      }
    } else {
      for (const field of others) {
        const beforeRaw = scoreTowerPointsRaw(def, resourceCount);
        if (!nudgeIncreasePoints(def, field, resourceCount)) continue;
        const after = scoreTowerPoints(def, resourceCount);
        const afterRaw = scoreTowerPointsRaw(def, resourceCount);
        if (afterRaw <= beforeRaw + 1e-9) {
          undoNudge(def, field, "increase", resourceCount);
          continue;
        }
        // Never accept a nudge that pushes over the pool (validation is ≤ 100).
        if (after > TOWER_POINT_POOL) {
          undoNudge(def, field, "increase", resourceCount);
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
  selectedIndex: number,
  /** Skip rewriting this range input unless its value was clamped. */
  draggingField?: SliderField,
): void {
  for (const field of allowedSliderFields(resourceCount)) {
    const input = root.querySelector(
      `[data-ws-field="${field}"]`,
    ) as HTMLInputElement | null;
    const val = root.querySelector(`[data-ws-val="${field}"]`);
    const n = getField(def, field);
    const max = maxSliderValue(field, resourceCount);
    if (input) {
      input.max = String(max);
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
  const pct = Math.min(100, (meter.spent / TOWER_POINT_POOL) * 100);
  root.querySelectorAll(".ws-tower-tab").forEach((el) => {
    const btn = el as HTMLElement;
    const i = Number(btn.dataset.wsSelect);
    const fill = btn.querySelector(".ws-meter-fill") as HTMLElement | null;
    if (i === selectedIndex) {
      if (fill) fill.style.width = `${pct}%`;
      else {
        const span = document.createElement("span");
        span.className = "ws-meter-fill";
        span.style.width = `${pct}%`;
        btn.prepend(span);
      }
      btn.classList.toggle("over", meter.over);
    }
  });
  const tabPts = root.querySelector(
    `[data-ws-select="${selectedIndex}"] .ws-pts`,
  );
  if (tabPts) tabPts.textContent = `${meter.spent}/${meter.pool}`;
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

  const towerTabs = state.towers
    .map((tw, i) => {
      const m = pointsMeter(tw, state.resourceCount);
      const on = i === idx;
      const fillPct = Math.min(100, (m.spent / TOWER_POINT_POOL) * 100);
      const fill = on
        ? `<span class="ws-meter-fill" style="width:${fillPct}%"></span>`
        : "";
      return `<button type="button" class="ws-tower-tab ${on ? "on" : ""} ${m.over ? "over" : ""}" data-ws-select="${i}">${fill}<span class="ws-tab-face">${escapeHtml(tw.id)} <span class="ws-pts">${m.spent}/${m.pool}</span></span></button>`;
    })
    .join("");

  const simpleSliders = t
    ? allowedSliderFields(state.resourceCount)
        .map((field) => {
          const value = getField(t, field);
          const min = SLIDER_MIN[field];
          const max = maxSliderValue(field, state.resourceCount);
          return `<label>${SLIDER_LABEL[field]} <input type="range" min="${min}" max="${max}" data-ws-field="${field}" value="${value}" /><span data-ws-val="${field}">${formatSliderDisplay(field, value)}</span></label>`;
        })
        .join("")
    : "";
  const simple = t
    ? `<div class="ws-simple">
        <label>Id <input data-ws-field="id" value="${escapeHtml(t.id)}" /></label>
        ${simpleSliders}
        <p class="hint">Taxed resources: power → power · range → stone${state.resourceCount >= 3 ? " · fire rate → water" : ""}</p>
        <div class="ws-costs"><span>Build ${costChips(t.buildCost)}</span><span>Upgrade ${costChips(t.upgradeCost)}</span></div>
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
    setField(t, field, n, state.resourceCount);
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
    syncSimpleSliderDom(
      root,
      t,
      state.resourceCount,
      state.selectedIndex,
      draggingField,
    );
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
