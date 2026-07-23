import type { GameConfig, TileDef, WorldSize } from "../types.js";
import { createRng } from "../rng.js";

/** Canonical edge layout for up to 6 sides; pent uses first 5 after rotation. */
export function makeTile(
  id: string,
  connections: boolean[],
  extras: Partial<
    Pick<
      TileDef,
      "hasTowerPoint" | "hasMine" | "mineTypeId" | "mineResourceId" | "routeKind"
    >
  > = {},
): TileDef {
  const routeKind =
    extras.routeKind ??
    (connections.filter(Boolean).length <= 2 ? "single" : "branch");
  return {
    id,
    routeKind,
    connections: padConnections(connections, 6),
    hasTowerPoint: extras.hasTowerPoint ?? false,
    hasMine: extras.hasMine ?? false,
    mineTypeId: extras.mineTypeId,
    mineResourceId: extras.mineResourceId,
  };
}

function padConnections(c: boolean[], n: number): boolean[] {
  const out = c.slice(0, n);
  while (out.length < n) out.push(false);
  return out;
}

export function rotateConnections(
  connections: boolean[],
  sides: number,
  rotation: number,
): boolean[] {
  const base = connections.slice(0, sides);
  const r = ((rotation % sides) + sides) % sides;
  return base.map((_, i) => base[(i - r + sides) % sides]!);
}

/** Pick a single resource id from the active match list. */
export function pickMineResource(
  resources: string[],
  rng: () => number,
): string | undefined {
  if (!resources.length) return undefined;
  const i = Math.floor(rng() * resources.length);
  return resources[Math.min(i, resources.length - 1)];
}

export function generateTileBag(
  config: GameConfig,
  size: WorldSize,
  seed: number,
  activeResources?: string[],
): TileDef[] {
  const rng = createRng(seed);
  const count = config.tileBagSize[size];
  const resources =
    activeResources?.length
      ? activeResources
      : config.resources.slice(0, config.resourceCountDefault);
  const bag: TileDef[] = [];
  for (let i = 0; i < count; i++) {
    const kindRoll = rng();
    let connections: boolean[];
    let routeKind: TileDef["routeKind"];
    if (kindRoll < 0.55) {
      connections = [true, false, false, true, false, false];
      routeKind = "single";
    } else if (kindRoll < 0.85) {
      connections = [true, false, true, false, false, false];
      routeKind = "single";
    } else {
      connections = [true, false, true, false, true, false];
      routeKind = "branch";
    }
    const hasTowerPoint = rng() < config.towerPointChance;
    const hasMine = rng() < config.mineChance;
    // Separate stream so mine resource pick does not desync bag layout RNG
    const mineResourceId = hasMine
      ? pickMineResource(resources, createRng(seed ^ (i * 0x9e3779b9)))
      : undefined;
    bag.push(
      makeTile(`t${i}`, connections, {
        routeKind,
        hasTowerPoint,
        hasMine,
        mineTypeId: hasMine ? "basic" : undefined,
        mineResourceId,
      }),
    );
  }
  return bag;
}

/** Reserve tiles for auto-bridge — simple corridors */
export function bridgeTileTemplate(index: number): TileDef {
  return makeTile(`bridge-${index}`, [true, false, false, true, false, false], {
    routeKind: "single",
    hasTowerPoint: false,
    hasMine: false,
  });
}
