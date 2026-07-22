import type { ResourceMap, TowerDef } from "../types.js";

export const TOWER_POINT_POOL = 100;
export const BASELINE_FIRE_RATE = 6;

export type SliderStatField =
  | "power"
  | "range"
  | "fireRate"
  | "buildDiscount"
  | "upgradeDiscount";

/** Point cost per unit for each workshop slider. */
export const SLIDER_POINT_COST: Record<SliderStatField, number> = {
  power: 5,
  range: 15,
  fireRate: 8,
  buildDiscount: 10,
  upgradeDiscount: 25,
};

export const SLIDER_MIN: Record<SliderStatField, number> = {
  power: 1,
  range: 1,
  fireRate: 1,
  buildDiscount: 0,
  upgradeDiscount: 0,
};

/** Absolute caps for fields wiped/ignored when resourceCount < 3. */
const SLIDER_ABS_MAX: Record<SliderStatField, number> = {
  power: 20,
  range: 6,
  fireRate: 10,
  buildDiscount: 10,
  upgradeDiscount: 8,
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export type LoadoutValidationResult =
  | { ok: true; towers: TowerDef[] }
  | { ok: false; errors: string[] };

export function allowedSliderFields(
  resourceCount: number,
): SliderStatField[] {
  return resourceCount >= 3
    ? ["power", "range", "fireRate", "buildDiscount", "upgradeDiscount"]
    : ["power", "range"];
}

/**
 * Max slider value that still fits in the pool when every other allowed
 * slider is at its minimum: floor((pool − minCostOthers) / cost).
 */
export function maxSliderValue(
  field: SliderStatField,
  resourceCount: number,
): number {
  const fields = allowedSliderFields(resourceCount);
  if (!fields.includes(field)) {
    return SLIDER_ABS_MAX[field];
  }
  let othersMin = 0;
  for (const f of fields) {
    if (f === field) continue;
    othersMin += SLIDER_MIN[f] * SLIDER_POINT_COST[f];
  }
  const max = Math.floor(
    (TOWER_POINT_POOL - othersMin) / SLIDER_POINT_COST[field],
  );
  return Math.max(SLIDER_MIN[field], max);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function towerCooldownTicks(fireRate: number): number {
  return Math.max(1, 11 - fireRate);
}

export function scoreTowerPointsRaw(
  def: TowerDef,
  resourceCount: number,
): number {
  let s = def.power * 5 + def.range * 15;
  if (resourceCount >= 3) {
    s +=
      def.fireRate * 8 +
      def.buildDiscount * 10 +
      def.upgradeDiscount * 25;
  }
  return s;
}

export function scoreTowerPoints(
  def: TowerDef,
  resourceCount: number,
): number {
  return Math.round(scoreTowerPointsRaw(def, resourceCount));
}

export function deriveTowerCosts(
  def: TowerDef,
  resourceCount: number,
): {
  buildCost: ResourceMap;
  upgradeCost: ResourceMap;
} {
  const buildCost: ResourceMap = {
    stone: Math.round(20 + def.range * 12),
    power: Math.round(20 + def.power * 4),
  };
  const upgradeCost: ResourceMap = {
    stone: Math.round(12 + def.range * 6),
    power: Math.round(12 + def.power * 2),
  };
  if (resourceCount >= 3) {
    buildCost.water = Math.round(10 + def.fireRate * 5);
    upgradeCost.water = Math.round(6 + def.fireRate * 3);
  }
  const apply = (cost: ResourceMap, steps: number): ResourceMap => {
    const out: ResourceMap = {};
    for (const [k, v] of Object.entries(cost)) {
      out[k] = Math.max(1, Math.ceil(v * (1 - steps * 0.05)));
    }
    return out;
  };
  return {
    buildCost: apply(buildCost, def.buildDiscount),
    upgradeCost: apply(upgradeCost, def.upgradeDiscount),
  };
}

export function normalizeTowerForResources(
  def: TowerDef,
  resourceCount: number,
): TowerDef {
  const next = structuredClone(def);
  if (resourceCount < 3) {
    next.fireRate = BASELINE_FIRE_RATE;
    next.buildDiscount = 0;
    next.upgradeDiscount = 0;
  }
  const costs = deriveTowerCosts(next, resourceCount);
  next.buildCost = costs.buildCost;
  next.upgradeCost = costs.upgradeCost;
  return next;
}

export function validateTowerDef(
  def: TowerDef,
  resourceCount: number,
): ValidationResult {
  const errors: string[] = [];
  if (!def?.id || typeof def.id !== "string") {
    errors.push("tower id required");
  }
  const powerMax = maxSliderValue("power", resourceCount);
  const rangeMax = maxSliderValue("range", resourceCount);
  const fireMax = maxSliderValue("fireRate", resourceCount);
  const buildDiscMax = maxSliderValue("buildDiscount", resourceCount);
  const upgradeDiscMax = maxSliderValue("upgradeDiscount", resourceCount);
  if (def.power < SLIDER_MIN.power || def.power > powerMax) {
    errors.push(`${def.id}: power must be ${SLIDER_MIN.power}–${powerMax}`);
  }
  if (def.range < SLIDER_MIN.range || def.range > rangeMax) {
    errors.push(`${def.id}: range must be ${SLIDER_MIN.range}–${rangeMax}`);
  }
  if (def.fireRate < SLIDER_MIN.fireRate || def.fireRate > fireMax) {
    errors.push(
      `${def.id}: fireRate must be ${SLIDER_MIN.fireRate}–${fireMax}`,
    );
  }
  if (
    def.buildDiscount < SLIDER_MIN.buildDiscount ||
    def.buildDiscount > buildDiscMax
  ) {
    errors.push(
      `${def.id}: buildDiscount must be ${SLIDER_MIN.buildDiscount}–${buildDiscMax}`,
    );
  }
  if (
    def.upgradeDiscount < SLIDER_MIN.upgradeDiscount ||
    def.upgradeDiscount > upgradeDiscMax
  ) {
    errors.push(
      `${def.id}: upgradeDiscount must be ${SLIDER_MIN.upgradeDiscount}–${upgradeDiscMax}`,
    );
  }
  if (
    def.upgradeLevelIncrease < 1 ||
    def.upgradeLevelIncrease > 2
  ) {
    errors.push(`${def.id}: upgradeLevelIncrease must be 1–2`);
  }
  for (const key of ["power", "range"] as const) {
    const v = def.upgradeStatIncrease?.[key] ?? 0;
    if (v < 0 || v > 0.5) {
      errors.push(`${def.id}: upgradeStatIncrease.${key} must be 0–0.5`);
    }
  }
  for (const key of [
    "aoeSize",
    "aoeFade",
    "jump",
    "jumpLoss",
    "slowPower",
    "shotGivesPercent",
  ] as const) {
    if (num(def[key]) !== 0) {
      errors.push(`${def.id}: ${key} must be 0 this phase`);
    }
  }
  const normalized = normalizeTowerForResources(def, resourceCount);
  const spent = scoreTowerPoints(normalized, resourceCount);
  if (spent > TOWER_POINT_POOL) {
    errors.push(
      `${def.id}: ${spent} points exceeds pool of ${TOWER_POINT_POOL}`,
    );
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateLoadout(
  towers: TowerDef[],
  resourceCount: number,
): LoadoutValidationResult {
  if (!Array.isArray(towers)) {
    return { ok: false, errors: ["loadout must be an array"] };
  }
  if (towers.length === 0) {
    return { ok: false, errors: ["loadout needs at least one tower"] };
  }
  const seen = new Set<string>();
  const errors: string[] = [];
  const normalized: TowerDef[] = [];
  for (const t of towers) {
    if (seen.has(t.id)) errors.push(`duplicate tower id: ${t.id}`);
    seen.add(t.id);
    const r = validateTowerDef(t, resourceCount);
    if (!r.ok) {
      errors.push(...r.errors);
    } else {
      normalized.push(normalizeTowerForResources(t, resourceCount));
    }
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, towers: normalized };
}

function baseTower(
  partial: Partial<TowerDef> & Pick<TowerDef, "id" | "power" | "range">,
): TowerDef {
  return {
    fireRate: BASELINE_FIRE_RATE,
    buildDiscount: 0,
    upgradeDiscount: 0,
    aoeSize: 0,
    aoeFade: 0,
    jump: 0,
    jumpLoss: 0,
    slowPower: 0,
    shotGivesPercent: 0,
    shootCost: {},
    buildCost: {},
    upgradeCost: {},
    upgradeStatIncrease: { power: 0.15, range: 0.1 },
    upgradeLevelIncrease: 1.35,
    friendlyFireDefault: false,
    ...partial,
  };
}

/** Default trio — each spends ≤ 100 points for the given resource mode. */
export function defaultTowerLoadout(resourceCount: number): TowerDef[] {
  const roles = [
    baseTower({ id: "basic", power: 4, range: 2 }),
    baseTower({
      id: "sniper",
      power: 1,
      range: 3,
      upgradeStatIncrease: { power: 0.12, range: 0.08 },
    }),
    baseTower({
      id: "mortar",
      power: 7,
      range: 1,
      upgradeStatIncrease: { power: 0.2, range: 0.05 },
    }),
  ];
  return roles.map((t) => normalizeTowerForResources(t, resourceCount));
}

export function blankTower(id: string, resourceCount = 3): TowerDef {
  return normalizeTowerForResources(
    baseTower({ id, power: 4, range: 1, fireRate: 4 }),
    resourceCount,
  );
}

export interface LoadoutFileV2 {
  version: 2;
  kind: "tdw-tower-loadout";
  towers: TowerDef[];
}

export function parseLoadoutFile(
  raw: unknown,
  resourceCount: number,
): LoadoutValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["invalid JSON"] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== "tdw-tower-loadout") {
    return { ok: false, errors: ["kind must be tdw-tower-loadout"] };
  }
  if (obj.version !== 2) {
    return { ok: false, errors: ["unsupported version"] };
  }
  if (!Array.isArray(obj.towers)) {
    return { ok: false, errors: ["towers array required"] };
  }
  return validateLoadout(obj.towers as TowerDef[], resourceCount);
}

export function loadoutFileFromTowers(towers: TowerDef[]): LoadoutFileV2 {
  return { version: 2, kind: "tdw-tower-loadout", towers };
}
