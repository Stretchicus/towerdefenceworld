import type { GameConfig, TileDef, WorldSize } from "../types.js";
import { createRng } from "../rng.js";

/** Canonical edge layout for up to 6 sides; pent uses first 5 after rotation. */
export function makeTile(
  id: string,
  connections: boolean[],
  extras: Partial<Pick<TileDef, "hasTowerPoint" | "hasMine" | "mineTypeId" | "routeKind">> = {},
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

export function generateTileBag(
  config: GameConfig,
  size: WorldSize,
  seed: number,
): TileDef[] {
  const rng = createRng(seed);
  const count = config.tileBagSize[size];
  const bag: TileDef[] = [];
  for (let i = 0; i < count; i++) {
    const kindRoll = rng();
    let connections: boolean[];
    let routeKind: TileDef["routeKind"];
    if (kindRoll < 0.55) {
      // straight-ish single
      connections = [true, false, false, true, false, false];
      routeKind = "single";
    } else if (kindRoll < 0.85) {
      // soft bend
      connections = [true, false, true, false, false, false];
      routeKind = "single";
    } else {
      // branch T
      connections = [true, false, true, false, true, false];
      routeKind = "branch";
    }
    const hasTowerPoint = rng() < config.towerPointChance;
    const hasMine = rng() < config.mineChance;
    bag.push(
      makeTile(`t${i}`, connections, {
        routeKind,
        hasTowerPoint,
        hasMine,
        mineTypeId: hasMine ? "basic" : undefined,
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
