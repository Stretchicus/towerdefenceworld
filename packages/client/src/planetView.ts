import * as THREE from "three";
import { EndGameCastleFx, type CastleFxSpec } from "./endGameFx.js";
import { createMineVisual, createPickupOrb } from "./mineVisuals.js";
import { createTowerVisual, tickTowerVisual } from "./towerVisuals.js";

export interface CellView {
  id: number;
  sides: number;
  center: { x: number; y: number; z: number };
  vertices: { x: number; y: number; z: number }[];
  neighbors: number[];
}

export interface PlanetViewData {
  cells: CellView[];
  baseCellIds: number[];
  placed: {
    cellId: number;
    tile: {
      hasTowerPoint?: boolean;
      hasMine?: boolean;
      mineResourceId?: string;
    };
    connections: boolean[];
  }[];
  towers: { cellId: number; ownerId: string; visualId?: string; typeId?: string }[];
  mines: { cellId: number; resourceId?: string }[];
  bods: {
    id: string;
    cellId: number;
    ownerId: string;
    typeId?: string;
    hp?: number;
    maxHp?: number;
    path?: number[];
    pathIndex?: number;
    moveCooldown?: number;
    pickups?: string[];
  }[];
  bodMoveEveryTicks?: number;
  players: { id: string; baseCellId: number; teamId: string; alive: boolean }[];
  /** Cells where the current tile can be placed (any rotation) */
  legalCellIds?: number[];
  corridorCellIds?: number[];
  myBaseCellId?: number | null;
  interactionMode?: "placement" | "combat" | "other";
  /** When "ended", castles get fireworks (winners) or flames (losers). */
  phase?: string;
  winnerIds?: string[];
  /** When false, empty tower pads render dimmed (no affordable tower). */
  padsAffordable?: boolean;
  myEdgeBlocks?: { cellA: number; cellB: number }[];
}

const TEAM_COLORS = ["#3dd6c6", "#f0a05a", "#7aa2ff", "#e07ad8"];
const BOD_RADIUS = 0.055;
const Y_UP = new THREE.Vector3(0, 1, 0);
const MARKER_ROAD_PICK_TOLERANCE = 0.05;

interface CellPickHit {
  cellId: number;
  distance: number;
  isMarker: boolean;
}

interface RoadPickHit {
  cellA: number;
  cellB: number;
  distance: number;
}

export function shadeBodColor(
  ownerHex: string,
  typeId: string | undefined,
): string {
  const c = new THREE.Color(ownerHex);
  if (typeId === "grunt") {
    c.lerp(new THREE.Color("#ffffff"), 0.34);
  } else if (typeId === "bruiser") {
    c.multiplyScalar(0.62);
  }
  return `#${c.getHexString()}`;
}

function bodHpRatio(b: { hp?: number; maxHp?: number }): number {
  const max = b.maxHp ?? 1;
  const hp = b.hp ?? max;
  if (max <= 0) return 1;
  return Math.min(1, Math.max(0.06, hp / max));
}

function bodSphereGeometry(ratio: number): THREE.SphereGeometry {
  const thetaStart = (1 - ratio) * Math.PI;
  const thetaLength = ratio * Math.PI;
  return new THREE.SphereGeometry(
    BOD_RADIUS,
    12,
    10,
    0,
    Math.PI * 2,
    thetaStart,
    thetaLength,
  );
}

function bodCapRadius(ratio: number): number {
  const thetaStart = (1 - ratio) * Math.PI;
  return BOD_RADIUS * Math.sin(thetaStart);
}

function bodCapY(ratio: number): number {
  const thetaStart = (1 - ratio) * Math.PI;
  return BOD_RADIUS * Math.cos(thetaStart);
}

function bodMaterial(tint: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: tint,
    emissive: tint,
    emissiveIntensity: 0.85,
    side: THREE.DoubleSide,
  });
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

function applyBodTint(root: THREE.Object3D, tint: string): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    // Pickup orbs keep resource colours — do not recolour with team tint
    if (obj.userData.part === "pickupOrb") return;
    let p: THREE.Object3D | null = obj.parent;
    while (p) {
      if (p.userData.part === "pickups") return;
      p = p.parent;
    }
    const mat = obj.material as THREE.MeshStandardMaterial;
    mat.color.set(tint);
    mat.emissive.set(tint);
  });
}

function updateBodCap(root: THREE.Group, ratio: number): void {
  let cap = root.children.find((c) => c.userData.part === "cap") as
    | THREE.Mesh
    | undefined;
  const r = bodCapRadius(ratio);
  const y = bodCapY(ratio);
  if (r < 0.001) {
    if (cap) cap.visible = false;
    return;
  }
  if (!cap) {
    const body = root.children.find((c) => c.userData.part === "body") as
      | THREE.Mesh
      | undefined;
    const mat = body
      ? (body.material as THREE.MeshStandardMaterial).clone()
      : bodMaterial("#ffffff");
    cap = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
    cap.userData.part = "cap";
    cap.rotation.x = -Math.PI / 2;
    root.add(cap);
  } else {
    cap.visible = true;
    cap.geometry.dispose();
    cap.geometry = new THREE.CircleGeometry(r, 20);
  }
  cap.position.set(0, y, 0);
}

export class PlanetView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  /** Free-spinning globe — tiles, roads, markers, bods all live here */
  private readonly pivot = new THREE.Group();
  private root = new THREE.Group();
  private cellMeshes = new Map<number, THREE.Mesh>();
  private markers = new THREE.Group();
  private pathGroup = new THREE.Group();
  private bodGroup = new THREE.Group();
  private tileDragGhost = new THREE.Group();
  private readonly endGameFx = new EndGameCastleFx();
  private lastBodData: PlanetViewData | null = null;
  private lastFrameMs = performance.now();
  private localCooldownRemain = new Map<string, number>();
  private localBodPathIndex = new Map<string, number>();
  private pointerMode: "idle" | "orbit" | "draggingTile" = "idle";
  private tileDragPointerId: number | null = null;
  /** When true (your placement turn), the current tile follows the cursor — no grab needed. */
  private tileHoldEnabled = false;
  private secondTouch:
    | { pointerId: number; startX: number; startY: number; moved: boolean }
    | null = null;
  private moved = false;
  private prevX = 0;
  private prevY = 0;
  private cameraRadius = 4.2;
  private spinVel = new THREE.Vector3();
  private focusQuat: THREE.Quaternion | null = null;
  private selectedCell: number | null = null;
  private spin = true;
  private interactionMode: "placement" | "combat" | "other" = "other";
  private hoverCellId: number | null = null;
  private legalCellIds = new Set<number>();
  private placementConnections: boolean[] = [];
  private placementRotation = 0;
  private markersKey = "";
  private routesKey = "";
  private cellCenters = new Map<number, THREE.Vector3>();
  private lastCells = new Map<number, CellView>();
  private static readonly _proj = new THREE.Vector3();
  private static readonly _out = new THREE.Vector3();
  private static readonly _toCam = new THREE.Vector3();
  /** Gameplay sits on the hex surface — not the atmosphere shell */
  private static readonly SURFACE = 1.012;
  /** Must match vertex scale used when building cell meshes in setPlanet */
  private static readonly FACE_SCALE = 1.002;
  private static readonly Y_UP = new THREE.Vector3(0, 1, 0);
  private static readonly Z_UP = new THREE.Vector3(0, 0, 1);

  /** Flat on the cell face (torus / disc default axis is +Z). */
  private cellFlatQuat(outward: THREE.Vector3): THREE.Quaternion {
    return new THREE.Quaternion().setFromUnitVectors(
      PlanetView.Z_UP,
      outward,
    );
  }

  /** Pose on the flat cell face (not the radial sphere bump), so props sit on the tile. */
  private cellFacePose(
    cell: CellView,
    lift = 0.003,
  ): {
    pos: THREE.Vector3;
    outward: THREE.Vector3;
    quat: THREE.Quaternion;
  } {
    const face = new THREE.Vector3();
    for (const v of cell.vertices) {
      face.x += v.x;
      face.y += v.y;
      face.z += v.z;
    }
    const n = cell.vertices.length || 1;
    // Same radial scale as the rendered hex rim so props aren't buried under the mesh
    face.multiplyScalar(PlanetView.FACE_SCALE / n);
    const outward = face.clone().normalize();
    const pos = face.clone().addScaledVector(outward, lift);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      PlanetView.Y_UP,
      outward,
    );
    return { pos, outward, quat };
  }
  private static readonly _q = new THREE.Quaternion();
  private static readonly _axis = new THREE.Vector3();
  private static readonly _v = new THREE.Vector3();
  onCellClick: ((cellId: number) => void) | null = null;
  onTileDrop: ((cellId: number, rotation: number) => void) | null = null;
  onTileRotateRequest: ((dir: 1 | -1) => void) | null = null;
  onHoverCell: ((cellId: number | null) => void) | null = null;
  onRoadEdgeClick: ((cellA: number, cellB: number) => void) | null = null;

  constructor(canvasParent: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      50,
      canvasParent.clientWidth / Math.max(1, canvasParent.clientHeight),
      0.1,
      100,
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(canvasParent.clientWidth, canvasParent.clientHeight);
    canvasParent.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x88aacc, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
    sun.position.set(3, 4, 2);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x3dd6c6, 0.35);
    rim.position.set(-2, -1, -3);
    this.scene.add(rim);

    this.pivot.add(this.root);
    this.pivot.add(this.pathGroup);
    this.pivot.add(this.markers);
    this.pivot.add(this.bodGroup);
    this.pivot.add(this.tileDragGhost);
    this.pivot.add(this.endGameFx.group);
    this.scene.add(this.pivot);
    this.updateCamera();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || e.button !== 0 || this.pointerMode !== "idle") return;
      this.pointerMode = "orbit";
      this.moved = false;
      this.focusQuat = null;
      this.spinVel.set(0, 0, 0);
      this.prevX = e.clientX;
      this.prevY = e.clientY;
    });
    window.addEventListener("pointerdown", (e) => {
      if (
        (this.pointerMode === "draggingTile" || this.tileHoldEnabled) &&
        e.pointerType === "touch" &&
        e.pointerId !== this.tileDragPointerId &&
        !this.secondTouch
      ) {
        this.secondTouch = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      }
    });
    window.addEventListener("pointerup", (e) => {
      if (
        this.secondTouch?.pointerId === e.pointerId
      ) {
        const rotate =
          !this.secondTouch.moved &&
          this.hoverCellId !== null &&
          this.legalCellIds.has(this.hoverCellId);
        this.secondTouch = null;
        if (rotate) this.onTileRotateRequest?.(1);
        return;
      }
      if (
        this.pointerMode === "draggingTile" &&
        e.pointerId === this.tileDragPointerId
      ) {
        this.finishTileDrag(e);
        return;
      }
      if (this.pointerMode === "orbit") this.pointerMode = "idle";
    });
    window.addEventListener("pointercancel", (e) => {
      if (this.secondTouch?.pointerId === e.pointerId) {
        this.secondTouch = null;
        return;
      }
      if (
        this.pointerMode === "draggingTile" &&
        e.pointerId === this.tileDragPointerId
      ) {
        this.cancelTileDrag();
        return;
      }
      if (this.pointerMode === "orbit") this.pointerMode = "idle";
    });
    el.addEventListener("pointermove", (e) => {
      if (this.pointerMode === "draggingTile") return;
      if (this.pointerMode !== "orbit") {
        this.updateHover(e);
        if (this.tileHoldEnabled) this.redrawTileDragGhost();
        return;
      }
      const dx = e.clientX - this.prevX;
      const dy = e.clientY - this.prevY;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
      this.prevX = e.clientX;
      this.prevY = e.clientY;
      this.applyTrackballDrag(dx, dy);
    });
    window.addEventListener("pointermove", (e) => {
      if (this.secondTouch?.pointerId === e.pointerId) {
        if (
          Math.hypot(
            e.clientX - this.secondTouch.startX,
            e.clientY - this.secondTouch.startY,
          ) > 8
        ) {
          this.secondTouch.moved = true;
        }
        return;
      }
      if (
        this.pointerMode !== "draggingTile" ||
        e.pointerId !== this.tileDragPointerId
      ) {
        return;
      }
      this.updateHover(e);
      this.redrawTileDragGhost();
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.cameraRadius = Math.min(
        8,
        Math.max(2.4, this.cameraRadius + e.deltaY * 0.002),
      );
      this.updateCamera();
    });

    // Mobile: two-finger pinch zooms. Tile rotation uses a second-finger tap.
    let pinchStartDist = 0;
    el.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          const a = e.touches[0]!;
          const b = e.touches[1]!;
          pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (this.pointerMode === "orbit") this.pointerMode = "idle";
        }
      },
      { passive: true },
    );
    el.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const a = e.touches[0]!;
        const b = e.touches[1]!;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchStartDist > 0) {
          const scale = pinchStartDist / dist;
          this.cameraRadius = Math.min(
            8,
            Math.max(2.4, this.cameraRadius * scale),
          );
          pinchStartDist = dist;
          this.updateCamera();
        }
      },
      { passive: false },
    );
    el.addEventListener("click", (e) => {
      if (this.moved) return;
      this.pick(e);
    });
    el.addEventListener("contextmenu", (e) => {
      if (this.interactionMode !== "placement") return;
      e.preventDefault();
      this.updateHover(e);
      if (
        this.hoverCellId !== null &&
        this.legalCellIds.has(this.hoverCellId)
      ) {
        this.onTileRotateRequest?.(1);
      }
    });

    window.addEventListener("resize", () => {
      const w = canvasParent.clientWidth;
      const h = canvasParent.clientHeight;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  setSpin(on: boolean): void {
    this.spin = on;
  }

  /** Hold the current tile under the cursor on your placement turn. */
  setTileHoldEnabled(on: boolean): void {
    this.tileHoldEnabled = on;
    if (!on) {
      if (this.pointerMode === "draggingTile") this.cancelTileDrag();
      else this.clearGroup(this.tileDragGhost);
      return;
    }
    this.redrawTileDragGhost();
  }

  beginTileDrag(e: PointerEvent): void {
    if (
      this.interactionMode !== "placement" ||
      this.pointerMode !== "idle" ||
      this.legalCellIds.size === 0 ||
      this.placementConnections.length === 0 ||
      e.button !== 0
    ) {
      return;
    }
    this.pointerMode = "draggingTile";
    this.tileDragPointerId = e.pointerId;
    this.secondTouch = null;
    this.focusQuat = null;
    this.spinVel.set(0, 0, 0);
    this.updateHover(e);
    this.redrawTileDragGhost();
  }

  setPlacementPreview(connections: boolean[], rotation: number): void {
    this.placementConnections = [...connections];
    this.placementRotation = rotation;
    if (this.pointerMode === "draggingTile" || this.tileHoldEnabled) {
      this.redrawTileDragGhost();
    }
  }

  private finishTileDrag(e: PointerEvent): void {
    this.updateHover(e);
    const cellId = this.hoverCellId;
    const canDrop = cellId !== null && this.legalCellIds.has(cellId);
    const rotation = this.placementRotation;
    this.cancelTileDrag();
    if (canDrop) this.onTileDrop?.(cellId, rotation);
  }

  private cancelTileDrag(): void {
    this.pointerMode = "idle";
    this.tileDragPointerId = null;
    this.secondTouch = null;
    if (!this.tileHoldEnabled) this.clearGroup(this.tileDragGhost);
    else this.redrawTileDragGhost();
  }

  private redrawTileDragGhost(): void {
    this.clearGroup(this.tileDragGhost);
    const cellId = this.hoverCellId;
    const holding =
      this.pointerMode === "draggingTile" || this.tileHoldEnabled;
    if (
      !holding ||
      cellId === null ||
      !this.legalCellIds.has(cellId) ||
      this.placementConnections.length === 0
    ) {
      return;
    }
    const cell = this.lastCells.get(cellId);
    if (!cell || cell.vertices.length < 3) return;
    const sides = cell.vertices.length;
    const rotation = ((this.placementRotation % sides) + sides) % sides;
    const center = new THREE.Vector3(
      cell.center.x,
      cell.center.y,
      cell.center.z,
    ).multiplyScalar(1.012);
    const positions: number[] = [];
    for (let i = 0; i < sides; i++) {
      const source = (i - rotation + sides) % sides;
      if (!this.placementConnections[source]) continue;
      const a = cell.vertices[i]!;
      const b = cell.vertices[(i + 1) % sides]!;
      const edge = new THREE.Vector3(
        (a.x + b.x) * 0.5,
        (a.y + b.y) * 0.5,
        (a.z + b.z) * 0.5,
      ).multiplyScalar(1.012);
      positions.push(center.x, center.y, center.z, edge.x, edge.y, edge.z);
    }
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const ghost = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xffe566,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      }),
    );
    ghost.renderOrder = 20;
    this.tileDragGhost.add(ghost);
  }

  /** Rotate the globe so drag follows the finger (trackball / free spin). */
  private applyTrackballDrag(dx: number, dy: number): void {
    const sens = 0.005;
    // Camera-fixed view: right = +X, up = +Y. Grab: surface moves with finger.
    const qx = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      dy * sens,
    );
    const qy = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      dx * sens,
    );
    this.pivot.quaternion.premultiply(qy).premultiply(qx);
    this.spinVel.set(dy * sens * 55, dx * sens * 55, 0);
  }

  private updateHover(e: PointerEvent | MouseEvent): void {
    const id = this.rayCell(e);
    if (id !== this.hoverCellId) {
      this.hoverCellId = id;
      this.onHoverCell?.(id);
    }
  }

  private rayCell(e: MouseEvent): number | null {
    return this.rayCellHit(e)?.cellId ?? null;
  }

  private rayCellHit(e: MouseEvent): CellPickHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const hits = ray.intersectObjects([
      ...this.cellMeshes.values(),
      ...this.markers.children,
    ], true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      let cellId: number | undefined;
      let isMarker = false;
      while (object) {
        if (object === this.markers) isMarker = true;
        if (cellId === undefined && typeof object.userData.cellId === "number") {
          cellId = object.userData.cellId;
        }
        object = object.parent;
      }
      if (cellId !== undefined) {
        return { cellId, distance: hit.distance, isMarker };
      }
    }
    return null;
  }

  private rayRoadEdge(
    e: MouseEvent,
  ): RoadPickHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const hit = ray.intersectObjects(this.pathGroup.children)[0];
    const edge = hit?.object.userData.roadEdge as
      | { cellA: number; cellB: number }
      | undefined;
    return edge && hit ? { ...edge, distance: hit.distance } : null;
  }

  private updateCamera(): void {
    this.camera.position.set(0, 0, this.cameraRadius);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);
  }

  /** Spin the globe so `cellId` faces the camera (smooth). */
  focusCell(cellId: number): void {
    const c = this.cellCenters.get(cellId);
    if (!c) return;
    const local = PlanetView._v.copy(c).normalize();
    const world = local.clone().applyQuaternion(this.pivot.quaternion);
    const towardCam = new THREE.Vector3(0, 0, 1);
    const align = new THREE.Quaternion().setFromUnitVectors(world, towardCam);
    this.focusQuat = align.multiply(this.pivot.quaternion);
    this.spinVel.set(0, 0, 0);
    this.spin = false;
  }

  /**
   * Project a cell face point to viewport-local CSS pixels.
   * `visible` is false when behind the globe or off the canvas.
   */
  projectCellToViewport(
    cellId: number,
    lift = 0.05,
  ): { x: number; y: number; visible: boolean } | null {
    const cell = this.lastCells.get(cellId);
    if (!cell) return null;
    const { pos, outward } = this.cellFacePose(cell, lift);
    this.pivot.updateMatrixWorld(true);
    PlanetView._proj.copy(pos).applyMatrix4(this.pivot.matrixWorld);
    PlanetView._out.copy(outward).transformDirection(this.pivot.matrixWorld);
    PlanetView._toCam
      .copy(this.camera.position)
      .sub(PlanetView._proj)
      .normalize();
    const facing = PlanetView._out.dot(PlanetView._toCam) > 0.12;
    PlanetView._proj.project(this.camera);
    const el = this.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const x = (PlanetView._proj.x * 0.5 + 0.5) * w;
    const y = (-PlanetView._proj.y * 0.5 + 0.5) * h;
    const onScreen =
      PlanetView._proj.z < 1 &&
      x > -40 &&
      y > -40 &&
      x < w + 40 &&
      y < h + 40;
    return { x, y, visible: facing && onScreen };
  }

  private pick(e: MouseEvent): void {
    const cellHit = this.rayCellHit(e);
    if (this.interactionMode === "combat") {
      const edge = this.rayRoadEdge(e);
      const cellWins =
        edge !== null &&
        cellHit !== null &&
        (cellHit.distance <= edge.distance ||
          (cellHit.isMarker &&
            cellHit.distance <= edge.distance + MARKER_ROAD_PICK_TOLERANCE));
      if (edge && !cellWins) {
        this.onRoadEdgeClick?.(edge.cellA, edge.cellB);
        return;
      }
    }
    if (!cellHit) return;
    if (this.interactionMode === "placement") {
      this.selectedCell = cellHit.cellId;
      if (this.legalCellIds.has(cellHit.cellId)) {
        this.onTileDrop?.(cellHit.cellId, this.placementRotation);
        return;
      }
    }
    this.onCellClick?.(cellHit.cellId);
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const c = group.children[0]!;
      group.remove(c);
      c.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
    }
  }

  setPlanet(data: PlanetViewData): void {
    this.clearGroup(this.root);
    this.cellMeshes.clear();
    this.cellCenters.clear();
    this.lastCells.clear();
    this.interactionMode = data.interactionMode ?? "other";
    this.legalCellIds = new Set(
      this.interactionMode === "placement" ? (data.legalCellIds ?? []) : [],
    );
    if (this.interactionMode !== "placement") {
      this.selectedCell = null;
      this.tileHoldEnabled = false;
      if (this.pointerMode === "draggingTile") this.cancelTileDrag();
      else this.clearGroup(this.tileDragGhost);
    }

    const placedMap = new Map(data.placed.map((p) => [p.cellId, p]));
    const routeIds = new Set(
      data.placed
        .filter((p) => p.connections.some(Boolean))
        .map((p) => p.cellId),
    );
    const baseSet = new Set(data.baseCellIds);
    const legalSet = new Set(
      this.interactionMode === "placement" ? (data.legalCellIds ?? []) : [],
    );
    const corridorSet = new Set(data.corridorCellIds ?? []);
    const myBase = data.myBaseCellId ?? null;
    const towerOccupied = new Set(data.towers.map((t) => t.cellId));

    for (const cell of data.cells) {
      const center = new THREE.Vector3(
        cell.center.x,
        cell.center.y,
        cell.center.z,
      );
      const verts = cell.vertices.map((v) =>
        new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(PlanetView.FACE_SCALE),
      );
      if (verts.length < 3) continue;

      const geo = new THREE.BufferGeometry();
      const positions: number[] = [];
      const c = center.clone().multiplyScalar(0.98);
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i]!;
        const b = verts[(i + 1) % verts.length]!;
        positions.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
      }
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geo.computeVertexNormals();

      let color = 0x152430;
      let emissive = 0x000000;
      let emissiveIntensity = 0;
      if (corridorSet.has(cell.id) && !routeIds.has(cell.id) && !baseSet.has(cell.id)) {
        color = 0x243038;
        emissive = 0x152028;
        emissiveIntensity = 0.15;
      }
      if (routeIds.has(cell.id)) {
        color = 0x2a3840;
        emissive = 0x1a2828;
        emissiveIntensity = 0.12;
      }
      if (baseSet.has(cell.id)) {
        // Stone plinth under the castle (not team/castle colours)
        color = myBase === cell.id ? 0x3d4f5c : 0x4a4038;
        emissive = myBase === cell.id ? 0x203040 : 0x2a2018;
        emissiveIntensity = 0.22;
      }
      if (legalSet.has(cell.id)) {
        color = 0x4dffb0;
        emissive = 0x00ff88;
        emissiveIntensity = 0.85;
      }
      if (
        this.interactionMode === "placement" &&
        this.selectedCell === cell.id
      ) {
        color = 0x3dd6c6;
        emissive = 0x3dd6c6;
        emissiveIntensity = 0.5;
      }

      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        flatShading: true,
        metalness: 0.1,
        roughness: 0.65,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.cellId = cell.id;
      this.root.add(mesh);
      this.cellMeshes.set(cell.id, mesh);
      this.cellCenters.set(cell.id, center.clone());
      this.lastCells.set(cell.id, cell);

      const edgePos: number[] = [];
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i]!;
        const b = verts[(i + 1) % verts.length]!;
        edgePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(edgePos, 3),
      );
      this.root.add(
        new THREE.LineSegments(
          edgeGeo,
          new THREE.LineBasicMaterial({
            color: legalSet.has(cell.id)
              ? 0xa8ffd0
              : routeIds.has(cell.id)
                ? 0x4a5a50
                : 0x3dd6c6,
            transparent: true,
            opacity: legalSet.has(cell.id)
              ? 1
              : routeIds.has(cell.id)
                ? 0.35
                : 0.15,
          }),
        ),
      );

      void placedMap;
      void towerOccupied;
    }

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x3dd6c6,
        transparent: true,
        opacity: 0.05,
        side: THREE.BackSide,
      }),
    );
    this.root.add(shell);

    this.markersKey = "";
    this.routesKey = "";
    this.refreshMarkers(data, true);
  }

  /**
   * Continuous road ribbons: one strip per link from face-centre → shared
   * edge mid → neighbour face-centre (same path bods travel), so joins meet.
   */
  private drawRoutes(data: PlanetViewData): void {
    this.clearGroup(this.pathGroup);
    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const placedMap = new Map(data.placed.map((p) => [p.cellId, p]));
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a7a68,
      emissive: 0x2a3428,
      emissiveIntensity: 0.25,
      metalness: 0.05,
      roughness: 0.9,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const halfW = 0.016;
    const lift = 0.0015;
    const drawn = new Set<string>();

    const faceCenter = (raw: THREE.Vector3): THREE.Vector3 => {
      const n = raw.clone().normalize();
      return raw.clone().multiplyScalar(0.98).addScaledVector(n, lift);
    };

    const faceVert = (raw: THREE.Vector3): THREE.Vector3 => {
      const n = raw.clone().normalize();
      return raw.clone().multiplyScalar(1.002).addScaledVector(n, lift);
    };

    /** Edge of `cell` whose midpoint aims most toward `toward` (neighbor centre) */
    const edgeToward = (
      cell: CellView,
      toward: THREE.Vector3,
    ): { a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3 } | null => {
      if (cell.vertices.length < 3) return null;
      const c = new THREE.Vector3(cell.center.x, cell.center.y, cell.center.z);
      const dir = toward.clone().sub(c);
      let bestI = 0;
      let bestDot = -Infinity;
      for (let i = 0; i < cell.vertices.length; i++) {
        const va = cell.vertices[i]!;
        const vb = cell.vertices[(i + 1) % cell.vertices.length]!;
        const mid = new THREE.Vector3(
          (va.x + vb.x) * 0.5,
          (va.y + vb.y) * 0.5,
          (va.z + vb.z) * 0.5,
        );
        const d = mid.clone().sub(c);
        const dot = d.dot(dir);
        if (dot > bestDot) {
          bestDot = dot;
          bestI = i;
        }
      }
      const va = cell.vertices[bestI]!;
      const vb = cell.vertices[(bestI + 1) % cell.vertices.length]!;
      const a = faceVert(new THREE.Vector3(va.x, va.y, va.z));
      const b = faceVert(new THREE.Vector3(vb.x, vb.y, vb.z));
      return { a, b, mid: a.clone().add(b).multiplyScalar(0.5) };
    };

    const addRibbon = (
      points: THREE.Vector3[],
      roadEdge: { cellA: number; cellB: number },
    ) => {
      if (points.length < 2) return;
      for (let s = 0; s < points.length - 1; s++) {
        const p0 = points[s]!;
        const p1 = points[s + 1]!;
        const along = p1.clone().sub(p0);
        if (along.lengthSq() < 1e-14) continue;
        // Width vector: perpendicular to segment, in a plane tangent-ish to the sphere
        const radial = p0.clone().add(p1).normalize();
        let side = new THREE.Vector3().crossVectors(along, radial);
        if (side.lengthSq() < 1e-14) {
          side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0));
        }
        if (side.lengthSq() < 1e-14) {
          side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(1, 0, 0));
        }
        side.normalize().multiplyScalar(halfW);

        const i0 = p0.clone().add(side);
        const i1 = p0.clone().sub(side);
        const o0 = p1.clone().add(side);
        const o1 = p1.clone().sub(side);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [
              i0.x, i0.y, i0.z,
              i1.x, i1.y, i1.z,
              o0.x, o0.y, o0.z,
              i1.x, i1.y, i1.z,
              o1.x, o1.y, o1.z,
              o0.x, o0.y, o0.z,
            ],
            3,
          ),
        );
        geo.computeVertexNormals();
        const ribbon = new THREE.Mesh(geo, mat);
        ribbon.userData.roadEdge = roadEdge;
        this.pathGroup.add(ribbon);
      }
    };

    for (const placed of data.placed) {
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      for (let i = 0; i < cell.neighbors.length; i++) {
        if (!(placed.connections[i] ?? false)) continue;
        const nid = cell.neighbors[i]!;
        const nCell = cellMap.get(nid);
        if (!nCell) continue;
        const nPlaced = placedMap.get(nid);
        const cA = new THREE.Vector3(
          cell.center.x,
          cell.center.y,
          cell.center.z,
        );
        const cB = new THREE.Vector3(
          nCell.center.x,
          nCell.center.y,
          nCell.center.z,
        );
        const ca = faceCenter(cA);
        const edge = edgeToward(cell, cB);
        const mid =
          edge?.mid ??
          ca
            .clone()
            .lerp(faceCenter(cB), 0.5)
            .normalize()
            .multiplyScalar(ca.length());

        if (!nPlaced) {
          // Open stub: show road from face centre to the join edge
          const stubKey = `${placed.cellId}>${nid}`;
          if (drawn.has(stubKey)) continue;
          drawn.add(stubKey);
          addRibbon([ca, mid], {
            cellA: Math.min(placed.cellId, nid),
            cellB: Math.max(placed.cellId, nid),
          });
          continue;
        }

        const back = nCell.neighbors.indexOf(cell.id);
        if (back < 0 || !(nPlaced.connections[back] ?? false)) continue;
        const key =
          placed.cellId < nid
            ? `${placed.cellId}:${nid}`
            : `${nid}:${placed.cellId}`;
        if (drawn.has(key)) continue;
        drawn.add(key);

        const cb = faceCenter(cB);
        addRibbon([ca, mid, cb], {
          cellA: Math.min(placed.cellId, nid),
          cellB: Math.max(placed.cellId, nid),
        });
      }
    }
  }

  private static markersFingerprint(data: PlanetViewData): string {
    return [
      data.towers
        .map((t) => `${t.cellId}:${t.ownerId}:${t.visualId ?? ""}`)
        .join(","),
      data.placed
        .map(
          (p) =>
            `${p.cellId}:${p.tile.hasTowerPoint ? 1 : 0}:${p.tile.hasMine ? 1 : 0}:${p.tile.mineResourceId ?? ""}`,
        )
        .join(","),
      data.players.map((p) => `${p.id}:${p.baseCellId}:${p.alive}`).join(","),
      data.myBaseCellId ?? "",
      data.phase ?? "",
      (data.winnerIds ?? []).join(","),
      data.padsAffordable === false ? "0" : "1",
      (data.myEdgeBlocks ?? [])
        .map(({ cellA, cellB }) => `${cellA}:${cellB}`)
        .sort()
        .join(","),
    ].join("|");
  }

  private static routesFingerprint(data: PlanetViewData): string {
    return data.placed
      .map((p) => `${p.cellId}:${p.connections.map((c) => (c ? 1 : 0)).join("")}`)
      .join(";");
  }

  refreshMarkers(data: PlanetViewData, force = false): void {
    const routesKey = PlanetView.routesFingerprint(data);
    if (force || routesKey !== this.routesKey) {
      this.drawRoutes(data);
      this.routesKey = routesKey;
    }

    const key = PlanetView.markersFingerprint(data);
    if (!force && key === this.markersKey) {
      this.syncBods(data);
      return;
    }
    this.markersKey = key;
    this.clearGroup(this.markers);
    this.endGameFx.clear();

    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    for (const c of data.cells) this.lastCells.set(c.id, c);
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const towerCells = new Set(data.towers.map((t) => t.cellId));
    const padsAffordable = data.padsAffordable !== false;
    const padEmissive = padsAffordable ? 0.75 : 0.2;
    const padRingEmissive = padsAffordable ? 1.15 : 0.25;
    const padColor = padsAffordable ? 0x145050 : 0x0a2020;
    const padRingColor = padsAffordable ? 0x7bffe8 : 0x2a5050;

    for (const { cellA, cellB } of data.myEdgeBlocks ?? []) {
      const a = cellMap.get(cellA);
      const b = cellMap.get(cellB);
      if (!a || !b) continue;
      const midpoint = new THREE.Vector3(
        a.center.x + b.center.x,
        a.center.y + b.center.y,
        a.center.z + b.center.z,
      ).normalize();
      const outward = midpoint.clone();
      midpoint.multiplyScalar(1.026);
      const flatQuat = this.cellFlatQuat(outward);
      const material = new THREE.MeshStandardMaterial({
        color: 0xff3048,
        emissive: 0xaa0018,
        emissiveIntensity: 1.1,
        roughness: 0.45,
        metalness: 0.1,
        depthTest: false,
      });
      const sign = new THREE.Group();
      sign.position.copy(midpoint);
      sign.quaternion.copy(flatQuat);
      sign.renderOrder = 30;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.047, 0.009, 10, 28),
        material,
      );
      const slash = new THREE.Mesh(
        new THREE.BoxGeometry(0.078, 0.012, 0.008),
        material.clone(),
      );
      slash.rotation.z = Math.PI / 4;
      slash.position.z = 0.002;
      sign.add(ring, slash);
      this.markers.add(sign);
    }

    // Empty tower pads — raised cyan plinth + ring (must lie flat on the face)
    for (const placed of data.placed) {
      if (!placed.tile.hasTowerPoint || towerCells.has(placed.cellId)) continue;
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      const { pos, quat, outward } = this.cellFacePose(cell, 0.006);
      const flatQuat = this.cellFlatQuat(outward);

      const plinthMat = new THREE.MeshStandardMaterial({
        color: padColor,
        emissive: 0x3dd6c6,
        emissiveIntensity: padEmissive,
        metalness: 0.2,
        roughness: 0.45,
        transparent: !padsAffordable,
        opacity: padsAffordable ? 1 : 0.45,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.055, 0.016, 20),
        plinthMat,
      );
      plinth.position.copy(pos).addScaledVector(outward, 0.008);
      plinth.quaternion.copy(quat);
      plinth.userData.cellId = placed.cellId;
      this.markers.add(plinth);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.01, 10, 28),
        new THREE.MeshStandardMaterial({
          color: padRingColor,
          emissive: 0x3dd6c6,
          emissiveIntensity: padRingEmissive,
          metalness: 0.15,
          roughness: 0.35,
          transparent: !padsAffordable,
          opacity: padsAffordable ? 1 : 0.4,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      ring.position.copy(pos).addScaledVector(outward, 0.018);
      ring.quaternion.copy(flatQuat);
      ring.userData.cellId = placed.cellId;
      this.markers.add(ring);

      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.038, 20),
        new THREE.MeshStandardMaterial({
          color: 0x0a2828,
          emissive: 0x1a6060,
          emissiveIntensity: padsAffordable ? 0.85 : 0.2,
          side: THREE.DoubleSide,
          transparent: !padsAffordable,
          opacity: padsAffordable ? 1 : 0.4,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      pad.position.copy(pos).addScaledVector(outward, 0.017);
      pad.quaternion.copy(flatQuat);
      pad.userData.cellId = placed.cellId;
      this.markers.add(pad);
    }

    // Neutral resource mines (from placed tiles)
    for (const placed of data.placed) {
      if (!placed.tile.hasMine) continue;
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      const rid = placed.tile.mineResourceId ?? "stone";
      const mine = createMineVisual(rid);
      const { pos, quat } = this.cellFacePose(cell, 0.004);
      mine.position.copy(pos);
      mine.quaternion.copy(quat);
      mine.userData.cellId = placed.cellId;
      mine.traverse((obj) => {
        obj.userData.cellId = placed.cellId;
      });
      this.markers.add(mine);
    }

    for (const t of data.towers) {
      const cell = cellMap.get(t.cellId);
      if (!cell) continue;
      const team = ownerColor.get(t.ownerId) ?? "#ffffff";
      const mesh = createTowerVisual(t.visualId, team);
      const { pos, quat } = this.cellFacePose(cell);
      mesh.position.copy(pos);
      mesh.quaternion.copy(quat);
      mesh.userData.cellId = t.cellId;
      mesh.userData.towerAnim = true;
      this.markers.add(mesh);
    }

    this.syncBods(data);

    const ended = data.phase === "ended";
    const winners = new Set(data.winnerIds ?? []);
    const fxSpecs: CastleFxSpec[] = [];

    for (const p of data.players) {
      const cell = cellMap.get(p.baseCellId);
      if (!cell) continue;
      const isMine = data.myBaseCellId === p.baseCellId;
      const isWinner = ended && winners.has(p.id);
      const isBurning = ended && !isWinner;
      const team = ownerColor.get(p.id) ?? "#c4b8a8";
      const color = isBurning
        ? "#3a1a12"
        : isMine
          ? "#e8dcc8"
          : team;
      const emissive = isBurning
        ? 0xaa2808
        : isMine
          ? "#8a7a50"
          : p.alive
            ? 0x221810
            : 0x550000;
      const emissiveIntensity = isBurning ? 0.9 : isMine ? 0.45 : 0.25;
      const castle = this.makeCastle(color, emissive, emissiveIntensity);
      const { pos, quat, outward } = this.cellFacePose(cell, 0.004);
      castle.position.copy(pos);
      castle.scale.setScalar(0.85);
      castle.quaternion.copy(quat);
      castle.userData.cellId = p.baseCellId;
      castle.traverse((obj) => {
        obj.userData.cellId = p.baseCellId;
      });
      this.markers.add(castle);

      if (ended) {
        fxSpecs.push({
          origin: pos.clone(),
          outward: outward.clone(),
          mode: isWinner ? "win" : "lose",
          teamColor: team,
        });
      }

      if (isMine && !isBurning) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.11, 0.01, 8, 24),
          new THREE.MeshStandardMaterial({
            color: 0x7eb8ff,
            emissive: 0x3a80d0,
            emissiveIntensity: 0.55,
          }),
        );
        ring.position.copy(pos).addScaledVector(outward, 0.008);
        ring.quaternion.copy(quat);
        ring.rotateX(Math.PI / 2);
        ring.userData.cellId = p.baseCellId;
        this.markers.add(ring);
      }
    }

    this.endGameFx.setCastles(fxSpecs);
  }

  /** Low-poly castle: keep + corner towers + battlements */
  private makeCastle(
    color: string | number,
    emissive: string | number,
    emissiveIntensity: number,
  ): THREE.Group {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity,
      flatShading: true,
      metalness: 0.15,
      roughness: 0.7,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x4a3030,
      emissive: emissive,
      emissiveIntensity: emissiveIntensity * 0.35,
      flatShading: true,
    });
    const g = new THREE.Group();
    const s = 0.045;

    const keep = new THREE.Mesh(new THREE.BoxGeometry(s * 1.6, s * 1.8, s * 1.6), mat);
    keep.position.y = s * 0.9;
    g.add(keep);

    const gate = new THREE.Mesh(new THREE.BoxGeometry(s * 0.45, s * 0.7, s * 0.25), mat);
    gate.position.set(0, s * 0.35, s * 0.85);
    g.add(gate);

    const towerOffsets: [number, number][] = [
      [-0.95, -0.95],
      [0.95, -0.95],
      [-0.95, 0.95],
      [0.95, 0.95],
    ];
    for (const [tx, tz] of towerOffsets) {
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(s * 0.35, s * 0.4, s * 2.2, 6),
        mat,
      );
      tower.position.set(tx * s, s * 1.1, tz * s);
      g.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(s * 0.45, s * 0.7, 6), roofMat);
      roof.position.set(tx * s, s * 2.4, tz * s);
      g.add(roof);
    }

    // Battlements on keep
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        if (Math.abs(i) + Math.abs(j) !== 2 && Math.abs(i) !== 1 && Math.abs(j) !== 1) {
          /* keep corners + mid edges */
        }
        if (Math.abs(i) === 1 && Math.abs(j) === 1) continue; // corners owned by towers
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(s * 0.35, s * 0.35, s * 0.35), mat);
        merlon.position.set(i * s * 0.7, s * 2.0, j * s * 0.7);
        g.add(merlon);
      }
    }

    return g;
  }

  /** Create/update bod meshes; motion predicted smoothly in render() */
  private syncBods(data: PlanetViewData): void {
    this.lastBodData = data.phase === "ended" ? { ...data, bods: [] } : data;
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const seen = new Set<string>();
    const bods = data.phase === "ended" ? [] : data.bods;

    for (const b of bods) {
      seen.add(b.id);
      const serverIdx = b.pathIndex ?? 0;
      const serverCd = b.moveCooldown ?? 0;
      let localIdx = this.localBodPathIndex.get(b.id);
      let localCd = this.localCooldownRemain.get(b.id);

      if (localIdx === undefined || localCd === undefined) {
        localIdx = serverIdx;
        localCd = serverCd;
      } else if (serverIdx > localIdx) {
        // Server moved further along the path — catch up
        localIdx = serverIdx;
        localCd = serverCd;
      } else if (serverIdx < localIdx) {
        // Local prediction ahead of snapshot — allow 1 hop lead, else resync
        if (localIdx - serverIdx > 1) {
          localIdx = serverIdx;
          localCd = serverCd;
        }
      } else {
        // Same hop: never rewind progress (lower cd = further along)
        localCd = Math.min(localCd, serverCd);
      }

      this.localBodPathIndex.set(b.id, localIdx);
      this.localCooldownRemain.set(b.id, localCd);

      let root = this.bodGroup.children.find(
        (c) => c.userData.bodId === b.id,
      ) as THREE.Group | undefined;
      const ratio = bodHpRatio(b);
      const base = ownerColor.get(b.ownerId) ?? "#ffffff";
      const tint = shadeBodColor(base, b.typeId);
      if (!root) {
        root = new THREE.Group();
        root.userData.bodId = b.id;
        const body = new THREE.Mesh(bodSphereGeometry(ratio), bodMaterial(tint));
        body.userData.part = "body";
        root.add(body);
        root.userData.hpRatio = ratio;
        root.userData.typeId = b.typeId;
        this.bodGroup.add(root);
        updateBodCap(root, ratio);
      } else {
        const prev = root.userData.hpRatio as number | undefined;
        if (prev === undefined || Math.abs(prev - ratio) > 0.02) {
          const body = root.children.find((c) => c.userData.part === "body") as
            | THREE.Mesh
            | undefined;
          if (body) {
            body.geometry.dispose();
            body.geometry = bodSphereGeometry(ratio);
          }
          updateBodCap(root, ratio);
          root.userData.hpRatio = ratio;
        }
        applyBodTint(root, tint);
        root.userData.typeId = b.typeId;
      }
      this.syncBodPickups(root, b.pickups ?? []);
    }

    for (const child of [...this.bodGroup.children]) {
      const id = child.userData.bodId as string;
      if (!seen.has(id)) {
        this.bodGroup.remove(child);
        this.localCooldownRemain.delete(id);
        this.localBodPathIndex.delete(id);
        disposeObject3D(child);
      }
    }
  }

  private syncBodPickups(root: THREE.Group, pickups: string[]): void {
    let ring = root.children.find((c) => c.userData.part === "pickups") as
      | THREE.Group
      | undefined;
    if (!ring) {
      ring = new THREE.Group();
      ring.userData.part = "pickups";
      root.add(ring);
    }
    const key = pickups.join(",");
    if (ring.userData.pickupKey === key) return;
    ring.userData.pickupKey = key;
    while (ring.children.length) {
      const c = ring.children[0]!;
      ring.remove(c);
      disposeObject3D(c);
    }
    pickups.forEach((rid, i) => {
      const orb = createPickupOrb(rid);
      orb.userData.pickupIndex = i;
      orb.userData.pickupCount = pickups.length;
      ring!.add(orb);
    });
  }

  private tickBodPickups(tSec: number): void {
    for (const root of this.bodGroup.children) {
      const ring = root.children.find((c) => c.userData.part === "pickups");
      if (!ring) continue;
      const n = Math.max(1, ring.children.length);
      for (const orb of ring.children) {
        const i = (orb.userData.pickupIndex as number) ?? 0;
        const angle = tSec * 2.2 + (i / n) * Math.PI * 2;
        const radius = 0.078 + (i % 3) * 0.012;
        orb.position.set(
          Math.cos(angle) * radius,
          0.028 + Math.sin(tSec * 3 + i) * 0.01,
          Math.sin(angle) * radius,
        );
      }
    }
  }

  private placeBodMesh(
    root: THREE.Object3D,
    b: PlanetViewData["bods"][number],
    cellMap: Map<number, CellView>,
    period: number,
    pathIndex: number,
    cooldown: number,
  ): void {
    const path = b.path ?? [b.cellId];
    const idx = Math.max(0, Math.min(pathIndex, path.length - 1));
    const fromId = path[idx] ?? b.cellId;
    const toId = path[idx + 1] ?? fromId;
    const from = cellMap.get(fromId);
    const to = cellMap.get(toId);
    if (!from) return;

    const traveling = idx < path.length - 1;
    const t = traveling ? 1 - Math.max(0, Math.min(1, cooldown / period)) : 1;
    const ax = from.center.x;
    const ay = from.center.y;
    const az = from.center.z;
    const bx = to?.center.x ?? ax;
    const by = to?.center.y ?? ay;
    const bz = to?.center.z ?? az;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const len = Math.hypot(x, y, z) || 1;
    const s = PlanetView.SURFACE;
    const ox = x / len;
    const oy = y / len;
    const oz = z / len;
    root.position.set(ox * s, oy * s, oz * s);
    root.quaternion.setFromUnitVectors(Y_UP, new THREE.Vector3(ox, oy, oz));
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;

    if (this.pointerMode === "idle") {
      if (this.focusQuat) {
        const k = 1 - Math.exp(-6 * dt);
        this.pivot.quaternion.slerp(this.focusQuat, k);
        if (this.pivot.quaternion.angleTo(this.focusQuat) < 0.01) {
          this.pivot.quaternion.copy(this.focusQuat);
          this.focusQuat = null;
        }
      } else if (this.spinVel.lengthSq() > 1e-6) {
        if (Math.abs(this.spinVel.x) > 1e-5) {
          PlanetView._q.setFromAxisAngle(
            PlanetView._axis.set(1, 0, 0),
            this.spinVel.x * dt,
          );
          this.pivot.quaternion.premultiply(PlanetView._q);
        }
        if (Math.abs(this.spinVel.y) > 1e-5) {
          PlanetView._q.setFromAxisAngle(
            PlanetView._axis.set(0, 1, 0),
            this.spinVel.y * dt,
          );
          this.pivot.quaternion.premultiply(PlanetView._q);
        }
        this.spinVel.multiplyScalar(Math.exp(-3.2 * dt));
      } else if (this.spin) {
        PlanetView._q.setFromAxisAngle(PlanetView._axis.set(0, 1, 0), 0.0005);
        this.pivot.quaternion.premultiply(PlanetView._q);
      }
    }

    // Predict bod hops locally so they don't freeze at nodes waiting for 10Hz snaps
    if (this.lastBodData && this.lastBodData.phase !== "ended") {
      const period = Math.max(1, this.lastBodData.bodMoveEveryTicks ?? 10);
      const endPause = Math.max(3, Math.floor(period / 2));
      const tickHz = 10;
      const cellMap = new Map(this.lastBodData.cells.map((c) => [c.id, c]));
      for (const b of this.lastBodData.bods) {
        const mesh = this.bodGroup.children.find(
          (c) => c.userData.bodId === b.id,
        );
        if (!mesh) continue;
        const path = b.path ?? [b.cellId];
        let idx = this.localBodPathIndex.get(b.id) ?? b.pathIndex ?? 0;
        let remain =
          this.localCooldownRemain.get(b.id) ?? b.moveCooldown ?? period;

        remain -= dt * tickHz;
        // Chain into the next hop immediately (no pause at the node)
        while (remain <= 0 && idx < path.length - 1) {
          idx += 1;
          remain += idx < path.length - 1 ? period : endPause;
        }
        if (remain < 0) remain = 0;

        this.localBodPathIndex.set(b.id, idx);
        this.localCooldownRemain.set(b.id, remain);
        this.placeBodMesh(mesh, b, cellMap, period, idx, remain);
      }
    }

    const tSec = now / 1000;
    for (const child of this.markers.children) {
      if (child.userData.towerAnim) tickTowerVisual(child, tSec);
    }
    this.tickBodPickups(tSec);

    this.endGameFx.update(dt);

    this.renderer.render(this.scene, this.camera);
  }
}
