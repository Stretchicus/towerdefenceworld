export interface RoutingPlayer {
  id: string;
  teamId: string;
  alive: boolean;
}

export interface RoutingState {
  players: RoutingPlayer[];
  planet: { baseCellIds: number[] };
}

function aliveEnemyBases(
  state: RoutingState,
  ownerTeamId: string,
): Set<number> {
  const bases = new Set<number>();
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i]!;
    const base = state.planet.baseCellIds[i];
    if (player.alive && player.teamId !== ownerTeamId && base !== undefined) {
      bases.add(base);
    }
  }
  return bases;
}

function canReachEnemy(
  graph: Map<number, number[]>,
  viaNeighbor: number,
  blocked: ReadonlySet<number>,
  enemyBases: ReadonlySet<number>,
): boolean {
  if (blocked.has(viaNeighbor)) return false;
  const seen = new Set(blocked);
  const pending = [viaNeighbor];
  seen.add(viaNeighbor);
  while (pending.length > 0) {
    const cell = pending.pop()!;
    if (enemyBases.has(cell)) return true;
    for (const neighbor of graph.get(cell) ?? []) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  return false;
}

export function reachesAliveEnemy(
  graph: Map<number, number[]>,
  start: number,
  from: number,
  viaNeighbor: number,
  state: RoutingState,
  ownerTeamId: string,
): boolean {
  const blocked = new Set([start]);
  if (from >= 0) blocked.add(from);
  return canReachEnemy(
    graph,
    viaNeighbor,
    blocked,
    aliveEnemyBases(state, ownerTeamId),
  );
}

function pickPath(
  graph: Map<number, number[]>,
  start: number,
  from: number | null,
  state: RoutingState,
  owner: RoutingPlayer,
  rng: () => number,
): number[] | null {
  const enemyBases = aliveEnemyBases(state, owner.teamId);
  if (enemyBases.has(start)) return [start];

  const path = [start];
  const visited = new Set<number>([start]);
  if (from !== null) visited.add(from);
  let current = start;

  while (!enemyBases.has(current)) {
    const options = (graph.get(current) ?? []).filter(
      (neighbor) =>
        !visited.has(neighbor) &&
        canReachEnemy(graph, neighbor, visited, enemyBases),
    );
    if (options.length === 0) return null;
    const optionIndex =
      options.length === 1 ? 0 : Math.floor(rng() * options.length) % options.length;
    const next = options[optionIndex]!;
    path.push(next);
    visited.add(next);
    current = next;
  }
  return path;
}

export function pickRandomPathToAliveEnemy(
  graph: Map<number, number[]>,
  start: number,
  state: RoutingState,
  owner: RoutingPlayer,
  rng: () => number,
): number[] | null {
  return pickPath(graph, start, null, state, owner, rng);
}

export function pickRandomContinuationToAliveEnemy(
  graph: Map<number, number[]>,
  start: number,
  from: number,
  state: RoutingState,
  owner: RoutingPlayer,
  rng: () => number,
): number[] | null {
  return pickPath(graph, start, from, state, owner, rng);
}
