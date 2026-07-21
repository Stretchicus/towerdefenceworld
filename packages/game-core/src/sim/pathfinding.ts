/** A* on undirected integer graph; heuristic = hop count 0 (Dijkstra). */
export function findPath(
  graph: Map<number, number[]>,
  start: number,
  goal: number,
): number[] | null {
  if (start === goal) return [start];
  if (!graph.has(start) || !graph.has(goal)) return null;

  const open = new Set<number>([start]);
  const came = new Map<number, number>();
  const gScore = new Map<number, number>([[start, 0]]);
  const fScore = new Map<number, number>([[start, 0]]);

  while (open.size) {
    let current = -1;
    let best = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < best) {
        best = f;
        current = id;
      }
    }
    if (current === goal) {
      const path = [current];
      while (came.has(current)) {
        current = came.get(current)!;
        path.push(current);
      }
      path.reverse();
      return path;
    }
    open.delete(current);
    for (const n of graph.get(current) ?? []) {
      const tentative = (gScore.get(current) ?? Infinity) + 1;
      if (tentative < (gScore.get(n) ?? Infinity)) {
        came.set(n, current);
        gScore.set(n, tentative);
        fScore.set(n, tentative);
        open.add(n);
      }
    }
  }
  return null;
}

export function pathLength(
  graph: Map<number, number[]>,
  start: number,
  goal: number,
): number {
  const p = findPath(graph, start, goal);
  return p ? p.length - 1 : Infinity;
}
