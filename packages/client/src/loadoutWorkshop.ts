import {
  TOWER_POINT_POOL,
  blankTower,
  defaultTowerLoadout,
  loadoutFileFromTowers,
  parseLoadoutFile,
  scoreTowerPoints,
  validateLoadout,
  type TowerDef,
} from "@tdw/game-core";

export type WorkshopTab = "simple" | "advanced";

export interface WorkshopState {
  towers: TowerDef[];
  selectedIndex: number;
  tab: WorkshopTab;
  jsonText: string;
  errors: string[];
}

export function createWorkshopState(towers?: TowerDef[]): WorkshopState {
  const list =
    towers && towers.length > 0
      ? structuredClone(towers)
      : defaultTowerLoadout();
  return {
    towers: list,
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
  const v = validateLoadout(state.towers);
  return v.ok ? [] : v.errors;
}

export function isWorkshopValid(state: WorkshopState): boolean {
  return workshopValidation(state).length === 0;
}

export function pointsMeter(def: TowerDef): {
  spent: number;
  pool: number;
  over: boolean;
} {
  const spent = scoreTowerPoints(def);
  return { spent, pool: TOWER_POINT_POOL, over: spent > TOWER_POINT_POOL };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const meter = t ? pointsMeter(t) : null;

  const towerTabs = state.towers
    .map((tw, i) => {
      const m = pointsMeter(tw);
      return `<button type="button" class="ws-tower-tab ${i === idx ? "on" : ""} ${m.over ? "over" : ""}" data-ws-select="${i}">${escapeHtml(tw.id)} <span class="ws-pts">${m.spent}/${m.pool}</span></button>`;
    })
    .join("");

  const simple = t
    ? `<div class="ws-simple">
        <label>Id <input data-ws-field="id" value="${escapeHtml(t.id)}" /></label>
        <label>Power <input type="range" min="1" max="40" data-ws-field="power" value="${t.power}" /><span data-ws-val="power">${t.power}</span></label>
        <label>Range <input type="range" min="1" max="6" data-ws-field="range" value="${t.range}" /><span data-ws-val="range">${t.range}</span></label>
        <label>Build stone <input type="range" min="0" max="200" data-ws-field="buildStone" value="${t.buildCost.stone ?? 0}" /><span data-ws-val="buildStone">${t.buildCost.stone ?? 0}</span></label>
        <label>Build power <input type="range" min="0" max="200" data-ws-field="buildPower" value="${t.buildCost.power ?? 0}" /><span data-ws-val="buildPower">${t.buildCost.power ?? 0}</span></label>
        <label>Upgrade stone <input type="range" min="0" max="200" data-ws-field="upStone" value="${t.upgradeCost.stone ?? 0}" /><span data-ws-val="upStone">${t.upgradeCost.stone ?? 0}</span></label>
        <label>Upgrade power <input type="range" min="0" max="200" data-ws-field="upPower" value="${t.upgradeCost.power ?? 0}" /><span data-ws-val="upPower">${t.upgradeCost.power ?? 0}</span></label>
        <div class="ws-meter ${meter?.over ? "over" : ""}">
          <div class="ws-meter-fill" style="width:${Math.min(100, ((meter?.spent ?? 0) / TOWER_POINT_POOL) * 100)}%"></div>
          <span>${meter?.spent ?? 0} / ${TOWER_POINT_POOL} points</span>
        </div>
      </div>`
    : `<p class="hint">No towers in loadout.</p>`;

  const advanced = `<textarea class="ws-json" data-ws-json rows="12" spellcheck="false">${escapeHtml(state.jsonText)}</textarea>
    <div class="row">
      <button type="button" class="secondary" data-ws-validate-json>Validate JSON</button>
      <button type="button" data-ws-apply-json>Apply JSON</button>
    </div>`;

  return `<div class="workshop" id="tower-workshop">
    <h2>TOWER WORKSHOP</h2>
    <p class="hint">100 points per tower · download / upload · Ready blocked if invalid</p>
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
  onChange: () => void,
): void {
  const applyField = (field: string, raw: string) => {
    const t = state.towers[state.selectedIndex];
    if (!t) return;
    if (field === "id") {
      t.id = raw.trim() || t.id;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (field === "power") t.power = n;
      else if (field === "range") t.range = n;
      else if (field === "buildStone") t.buildCost = { ...t.buildCost, stone: n };
      else if (field === "buildPower") t.buildCost = { ...t.buildCost, power: n };
      else if (field === "upStone") t.upgradeCost = { ...t.upgradeCost, stone: n };
      else if (field === "upPower") t.upgradeCost = { ...t.upgradeCost, power: n };
    }
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

  root.querySelectorAll("[data-ws-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedIndex = Number((btn as HTMLElement).dataset.wsSelect);
      onChange();
    });
  });
  root.querySelectorAll("[data-ws-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = (btn as HTMLElement).dataset.wsTab as WorkshopTab;
      if (state.tab === "advanced") syncWorkshopJson(state);
      onChange();
    });
  });
  root.querySelector("[data-ws-add]")?.addEventListener("click", () => {
    const id = `tower-${state.towers.length + 1}`;
    state.towers.push(blankTower(id));
    state.selectedIndex = state.towers.length - 1;
    syncWorkshopJson(state);
    onChange();
  });
  root.querySelector("[data-ws-remove]")?.addEventListener("click", () => {
    if (state.towers.length <= 1) return;
    state.towers.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    syncWorkshopJson(state);
    onChange();
  });
  root.querySelector("[data-ws-defaults]")?.addEventListener("click", () => {
    state.towers = defaultTowerLoadout();
    state.selectedIndex = 0;
    syncWorkshopJson(state);
    onChange();
  });
  root.querySelector("[data-ws-download]")?.addEventListener("click", () => {
    const blob = new Blob(
      [JSON.stringify(loadoutFileFromTowers(state.towers), null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tdw-loadout-v1.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  root.querySelector("[data-ws-upload]")?.addEventListener("change", (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const parsed = parseLoadoutFile(JSON.parse(text));
        if (!parsed.ok || !parsed.towers) {
          state.errors = parsed.ok ? ["import failed"] : parsed.errors;
          onChange();
          return;
        }
        state.towers = structuredClone(parsed.towers);
        state.selectedIndex = 0;
        syncWorkshopJson(state);
        onChange();
      } catch {
        state.errors = ["invalid JSON file"];
        onChange();
      }
    });
  });
  root.querySelectorAll("[data-ws-field]").forEach((el) => {
    const input = el as HTMLInputElement;
    const field = input.dataset.wsField!;
    if (input.type === "range") {
      input.addEventListener("input", () => {
        const t = state.towers[state.selectedIndex];
        if (!t) return;
        applyField(field, input.value);
        const val = root.querySelector(`[data-ws-val="${field}"]`);
        if (val) val.textContent = input.value;
        const meter = pointsMeter(t);
        const fill = root.querySelector(".ws-meter-fill") as HTMLElement | null;
        const box = root.querySelector(".ws-meter");
        const label = root.querySelector(".ws-meter span");
        if (fill) {
          fill.style.width = `${Math.min(100, (meter.spent / TOWER_POINT_POOL) * 100)}%`;
        }
        box?.classList.toggle("over", meter.over);
        if (label) {
          label.textContent = `${meter.spent} / ${TOWER_POINT_POOL} points`;
        }
        const tab = root.querySelector(
          `[data-ws-select="${state.selectedIndex}"] .ws-pts`,
        );
        if (tab) tab.textContent = `${meter.spent}/${meter.pool}`;
        softValidate();
      });
      input.addEventListener("change", () => {
        applyField(field, input.value);
        onChange();
      });
    } else {
      input.addEventListener("change", () => {
        applyField(field, input.value);
        onChange();
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
      const parsed = parseLoadoutFile(JSON.parse(state.jsonText));
      state.errors = parsed.ok ? [] : parsed.errors;
    } catch {
      state.errors = ["invalid JSON"];
    }
    onChange();
  });
  root.querySelector("[data-ws-apply-json]")?.addEventListener("click", () => {
    try {
      const parsed = parseLoadoutFile(JSON.parse(state.jsonText));
      if (!parsed.ok || !parsed.towers) {
        state.errors = parsed.ok ? ["apply failed"] : parsed.errors;
        onChange();
        return;
      }
      state.towers = structuredClone(parsed.towers);
      state.selectedIndex = 0;
      syncWorkshopJson(state);
      onChange();
    } catch {
      state.errors = ["invalid JSON"];
      onChange();
    }
  });
}
