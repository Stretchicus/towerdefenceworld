export type TileShapeId = "straight" | "bend" | "split" | "cross";

const SHAPE_CONNECTIONS: Record<TileShapeId, readonly boolean[]> = {
  straight: [true, false, false, true, false, false],
  bend: [true, false, true, false, false, false],
  split: [true, false, true, false, true, false],
  cross: [true, true, true, true, false, false],
};

export function shapeConnections(id: TileShapeId): boolean[] {
  return [...SHAPE_CONNECTIONS[id]];
}
