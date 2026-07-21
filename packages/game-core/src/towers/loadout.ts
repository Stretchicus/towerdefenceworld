import type { ResourceMap, TowerDef } from "../types.js";

export const TOWER_POINT_POOL = 100;

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function resourceTotal(cost: ResourceMap | undefined): number {
  if (!cost) return 0;
  return (cost.stone ?? 0) + (cost.power ?? 0);
}

/** Point spend for a tower (design formula v1), before rounding. */
export function scoreTowerPointsRaw(def: TowerDef): number {
  const buildTotal = resourceTotal(def.buildCost);
  const upgradeTotal = resourceTotal(def.upgradeCost);
  return (
    def.power * 5 +
    def.range * 15 +
    Math.max(0, 150 - buildTotal) * 0.15 +
    Math.max(0, 100 - upgradeTotal) * 0.1
  );
}

/** Point spend for a tower (design formula v1). */
export function scoreTowerPoints(def: TowerDef): number {
  return Math.round(scoreTowerPointsRaw(def));
}

export function validateTowerDef(def: TowerDef): ValidationResult {
  const errors: string[] = [];
  if (!def?.id || typeof def.id !== "string") {
    errors.push("tower id required");
  }
  if (def.power < 1 || def.power > 40) {
    errors.push(`${def.id}: power must be 1–40`);
  }
  if (def.range < 1 || def.range > 6) {
    errors.push(`${def.id}: range must be 1–6`);
  }
  for (const [k, v] of Object.entries(def.buildCost ?? {})) {
    if (v < 0 || v > 200) errors.push(`${def.id}: buildCost.${k} out of range`);
  }
  for (const [k, v] of Object.entries(def.upgradeCost ?? {})) {
    if (v < 0 || v > 200) errors.push(`${def.id}: upgradeCost.${k} out of range`);
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
  // Inert combat fields must stay at 0 this phase
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
  const spent = scoreTowerPoints(def);
  if (spent > TOWER_POINT_POOL) {
    errors.push(
      `${def.id}: ${spent} points exceeds pool of ${TOWER_POINT_POOL}`,
    );
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateLoadout(towers: TowerDef[]): ValidationResult {
  if (!Array.isArray(towers)) {
    return { ok: false, errors: ["loadout must be an array"] };
  }
  if (towers.length === 0) {
    return { ok: false, errors: ["loadout needs at least one tower"] };
  }
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const t of towers) {
    if (seen.has(t.id)) errors.push(`duplicate tower id: ${t.id}`);
    seen.add(t.id);
    const r = validateTowerDef(t);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function baseTower(
  partial: Partial<TowerDef> & Pick<TowerDef, "id" | "power" | "range" | "buildCost" | "upgradeCost">,
): TowerDef {
  return {
    aoeSize: 0,
    aoeFade: 0,
    jump: 0,
    jumpLoss: 0,
    slowPower: 0,
    shotGivesPercent: 0,
    shootCost: {},
    upgradeStatIncrease: { power: 0.15, range: 0.1 },
    upgradeLevelIncrease: 1.35,
    friendlyFireDefault: false,
    ...partial,
  };
}

/** Default trio — each spends ≤ 100 points. */
export function defaultTowerLoadout(): TowerDef[] {
  return [
    baseTower({
      id: "basic",
      power: 12,
      range: 2,
      buildCost: { stone: 70, power: 55 },
      upgradeCost: { stone: 40, power: 30 },
    }),
    baseTower({
      id: "sniper",
      power: 8,
      range: 4,
      buildCost: { stone: 80, power: 70 },
      upgradeCost: { stone: 50, power: 50 },
      upgradeStatIncrease: { power: 0.12, range: 0.08 },
    }),
    baseTower({
      id: "mortar",
      power: 16,
      range: 1,
      buildCost: { stone: 85, power: 65 },
      upgradeCost: { stone: 55, power: 45 },
      upgradeStatIncrease: { power: 0.2, range: 0.05 },
    }),
  ];
}

export function blankTower(id: string): TowerDef {
  return baseTower({
    id,
    power: 8,
    range: 2,
    buildCost: { stone: 70, power: 55 },
    upgradeCost: { stone: 40, power: 30 },
  });
}

export interface LoadoutFileV1 {
  version: 1;
  kind: "tdw-tower-loadout";
  towers: TowerDef[];
}

export function parseLoadoutFile(raw: unknown): ValidationResult & {
  towers?: TowerDef[];
} {
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["invalid JSON"] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== "tdw-tower-loadout") {
    return { ok: false, errors: ["kind must be tdw-tower-loadout"] };
  }
  if (obj.version !== 1) {
    return { ok: false, errors: ["unsupported version"] };
  }
  if (!Array.isArray(obj.towers)) {
    return { ok: false, errors: ["towers array required"] };
  }
  const towers = obj.towers as TowerDef[];
  const v = validateLoadout(towers);
  if (!v.ok) return v;
  return { ok: true, towers };
}

export function loadoutFileFromTowers(towers: TowerDef[]): LoadoutFileV1 {
  return { version: 1, kind: "tdw-tower-loadout", towers };
}
