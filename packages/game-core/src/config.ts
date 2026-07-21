import type { GameConfig, ResourceMap } from "./types.js";
export { defaultGameConfig } from "./defaultGameConfig.js";

export function activeResources(config: GameConfig, count: number): string[] {
  const n = Math.max(1, Math.min(count, config.resources.length));
  return config.resources.slice(0, n);
}

export function emptyBank(resources: string[]): ResourceMap {
  const bank: ResourceMap = {};
  for (const r of resources) bank[r] = 0;
  return bank;
}

export function startingBankFor(
  config: GameConfig,
  resources: string[],
): ResourceMap {
  const bank = emptyBank(resources);
  for (const r of resources) {
    bank[r] = config.startingBank[r] ?? 0;
  }
  return bank;
}

export function canAfford(bank: ResourceMap, cost: ResourceMap): boolean {
  for (const [k, v] of Object.entries(cost)) {
    if ((bank[k] ?? 0) < v) return false;
  }
  return true;
}

export function pay(bank: ResourceMap, cost: ResourceMap): void {
  for (const [k, v] of Object.entries(cost)) {
    bank[k] = (bank[k] ?? 0) - v;
  }
}

export function addResources(target: ResourceMap, add: ResourceMap, scale = 1): void {
  for (const [k, v] of Object.entries(add)) {
    target[k] = (target[k] ?? 0) + v * scale;
  }
}

export function scaleCost(
  base: ResourceMap,
  levelIncrease: number,
  level: number,
): ResourceMap {
  const mult = Math.pow(levelIncrease, level);
  const out: ResourceMap = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = Math.ceil(v * mult);
  }
  return out;
}

export function filterCostToResources(
  cost: ResourceMap,
  resources: string[],
): ResourceMap {
  const set = new Set(resources);
  const out: ResourceMap = {};
  for (const [k, v] of Object.entries(cost)) {
    if (set.has(k)) out[k] = v;
  }
  return out;
}
