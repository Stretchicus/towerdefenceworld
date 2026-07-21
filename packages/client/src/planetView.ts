import * as THREE from "three";

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
    tile: { hasTowerPoint?: boolean; hasMine?: boolean };
    connections: boolean[];
  }[];
  towers: { cellId: number; ownerId: string }[];
  mines: { cellId: number }[];
  bods: {
    id: string;
    cellId: number;
    ownerId: string;
    path?: number[];
    pathIndex?: number;
    moveCooldown?: number;
  }[];
  bodMoveEveryTicks?: number;
  players: { id: string; baseCellId: number; teamId: string; alive: boolean }[];
  /** Cells where the current tile can be placed (any rotation) */
  legalCellIds?: number[];
  corridorCellIds?: number[];
  myBaseCellId?: number | null;
  interactionMode?: "placement" | "combat" | "other";
}

const TEAM_COLORS = ["#3dd6c6", "#f0a05a", "#7aa2ff", "#e07ad8"];

export class PlanetView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private root = new THREE.Group();
  private cellMeshes = new Map<number, THREE.Mesh>();
  private markers = new THREE.Group();
  private pathGroup = new THREE.Group();
  private bodGroup = new THREE.Group();
  private lastBodData: PlanetViewData | null = null;
  private lastFrameMs = performance.now();
  private localCooldownRemain = new Map<string, number>();
  private localBodPathIndex = new Map<string, number>();
  private drag = false;
  private moved = false;
  private prevX = 0;
  private prevY = 0;
  private velTheta = 0;
  private velPhi = 0;
  private spherical = { theta: 0.4, phi: 0.9, radius: 4.2 };
  private selectedCell: number | null = null;
  private spin = true;
  private interactionMode: "placement" | "combat" | "other" = "other";
  private hoverCellId: number | null = null;
  private markersKey = "";
  private routesKey = "";
  private cellCenters = new Map<number, THREE.Vector3>();
  private focusTarget: { theta: number; phi: number } | null = null;
  /** Gameplay sits on the hex surface — not the atmosphere shell */
  private static readonly SURFACE = 1.012;
  onCellClick: ((cellId: number) => void) | null = null;
  onTileRotate: ((dir: 1 | -1) => void) | null = null;
  onHoverCell: ((cellId: number | null) => void) | null = null;

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

    this.scene.add(this.root);
    this.scene.add(this.pathGroup);
    this.scene.add(this.markers);
    this.scene.add(this.bodGroup);
    this.updateCamera();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.drag = true;
      this.moved = false;
      this.focusTarget = null;
      this.prevX = e.clientX;
      this.prevY = e.clientY;
    });
    window.addEventListener("pointerup", () => {
      this.drag = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.drag) {
        this.updateHover(e);
        return;
      }
      const dx = e.clientX - this.prevX;
      const dy = e.clientY - this.prevY;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
      this.prevX = e.clientX;
      this.prevY = e.clientY;
      const sens = 0.005;
      // Grab metaphor: finger drag moves the surface with you (invert Y)
      this.velTheta = -dx * sens * 60;
      this.velPhi = -dy * sens * 60;
      this.spherical.theta -= dx * sens;
      this.spherical.phi = Math.min(
        Math.PI - 0.1,
        Math.max(0.1, this.spherical.phi - dy * sens),
      );
      this.updateCamera();
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.interactionMode === "placement" && this.onTileRotate) {
        this.onTileRotate(e.deltaY > 0 ? 1 : -1);
        return;
      }
      this.spherical.radius = Math.min(
        8,
        Math.max(2.4, this.spherical.radius + e.deltaY * 0.002),
      );
      this.updateCamera();
    });

    // Mobile: two-finger pinch zooms; two-finger twist rotates tile in placement
    let pinchStartDist = 0;
    let pinchStartAngle = 0;
    let lastTwistBucket = 0;
    el.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          const a = e.touches[0]!;
          const b = e.touches[1]!;
          pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          pinchStartAngle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
          lastTwistBucket = 0;
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
        const angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
        if (pinchStartDist > 0) {
          const scale = pinchStartDist / dist;
          this.spherical.radius = Math.min(
            8,
            Math.max(2.4, this.spherical.radius * scale),
          );
          pinchStartDist = dist;
          this.updateCamera();
        }
        if (this.interactionMode === "placement" && this.onTileRotate) {
          let delta = angle - pinchStartAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          const bucket = Math.trunc(delta / (Math.PI / 6));
          if (bucket !== lastTwistBucket) {
            this.onTileRotate(bucket > lastTwistBucket ? 1 : -1);
            lastTwistBucket = bucket;
          }
        }
      },
      { passive: false },
    );
    el.addEventListener("click", (e) => {
      if (this.moved) return;
      this.pick(e);
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

  private updateHover(e: PointerEvent | MouseEvent): void {
    const id = this.rayCell(e);
    if (id !== this.hoverCellId) {
      this.hoverCellId = id;
      this.onHoverCell?.(id);
    }
  }

  private rayCell(e: MouseEvent): number | null {
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
    ]);
    if (!hits[0]) return null;
    const id = hits[0].object.userData.cellId as number | undefined;
    return id ?? null;
  }

  private updateCamera(): void {
    const { theta, phi, radius } = this.spherical;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  /** Orbit the camera so `cellId` faces the viewer (smooth). */
  focusCell(cellId: number): void {
    const c = this.cellCenters.get(cellId);
    if (!c) return;
    const rotY = this.root.rotation.y;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const wx = c.x * cos + c.z * sin;
    const wy = c.y;
    const wz = -c.x * sin + c.z * cos;
    const len = Math.hypot(wx, wy, wz) || 1;
    const ny = wy / len;
    const targetPhi = Math.min(
      Math.PI - 0.1,
      Math.max(0.1, Math.acos(Math.min(1, Math.max(-1, ny)))),
    );
    const targetTheta = Math.atan2(wx / len, wz / len);
    this.focusTarget = { theta: targetTheta, phi: targetPhi };
    this.velTheta = 0;
    this.velPhi = 0;
    this.spin = false;
  }

  private static shortestAngle(from: number, to: number): number {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private pick(e: MouseEvent): void {
    const id = this.rayCell(e);
    if (id === null) return;
    this.selectedCell = id;
    this.onCellClick?.(id);
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length) {
      const c = group.children[0]!;
      group.remove(c);
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) {
        c.geometry.dispose();
        const mat = c.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    }
  }

  setPlanet(data: PlanetViewData): void {
    this.clearGroup(this.root);
    this.cellMeshes.clear();
    this.cellCenters.clear();
    this.interactionMode = data.interactionMode ?? "other";

    const placedMap = new Map(data.placed.map((p) => [p.cellId, p]));
    const routeIds = new Set(
      data.placed
        .filter((p) => p.connections.some(Boolean))
        .map((p) => p.cellId),
    );
    const baseSet = new Set(data.baseCellIds);
    const legalSet = new Set(data.legalCellIds ?? []);
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
        new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(1.002),
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
      if (this.selectedCell === cell.id) {
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

    const addRibbon = (points: THREE.Vector3[]) => {
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
        this.pathGroup.add(new THREE.Mesh(geo, mat));
      }
    };

    for (const placed of data.placed) {
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      for (let i = 0; i < cell.neighbors.length; i++) {
        if (!(placed.connections[i] ?? false)) continue;
        const nid = cell.neighbors[i]!;
        const nPlaced = placedMap.get(nid);
        if (!nPlaced) continue;
        const nCell = cellMap.get(nid);
        if (!nCell) continue;
        const back = nCell.neighbors.indexOf(cell.id);
        if (back < 0 || !(nPlaced.connections[back] ?? false)) continue;
        const key =
          placed.cellId < nid
            ? `${placed.cellId}:${nid}`
            : `${nid}:${placed.cellId}`;
        if (drawn.has(key)) continue;
        drawn.add(key);

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
        const cb = faceCenter(cB);
        const edge = edgeToward(cell, cB);
        const mid = edge?.mid ?? ca.clone().lerp(cb, 0.5).normalize().multiplyScalar(
          ca.length() * 0.5 + cb.length() * 0.5,
        );
        // Face centre → shared edge → neighbour centre (continuous across the join)
        addRibbon([ca, mid, cb]);
      }
    }
  }

  private static markersFingerprint(data: PlanetViewData): string {
    return [
      data.towers.map((t) => `${t.cellId}:${t.ownerId}`).join(","),
      data.mines.map((m) => m.cellId).join(","),
      data.placed
        .map((p) =>
          `${p.cellId}:${p.tile.hasTowerPoint ? 1 : 0}:${p.tile.hasMine ? 1 : 0}`,
        )
        .join(","),
      data.players.map((p) => `${p.id}:${p.baseCellId}:${p.alive}`).join(","),
      data.myBaseCellId ?? "",
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

    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const towerCells = new Set(data.towers.map((t) => t.cellId));
    const mineCells = new Set(data.mines.map((m) => m.cellId));
    const R = PlanetView.SURFACE;

    // Empty tower pads — bright cyan rings (clickable)
    for (const placed of data.placed) {
      if (!placed.tile.hasTowerPoint || towerCells.has(placed.cellId)) continue;
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.012, 8, 20),
        new THREE.MeshStandardMaterial({
          color: 0x3dd6c6,
          emissive: 0x3dd6c6,
          emissiveIntensity: 0.9,
        }),
      );
      ring.position
        .set(cell.center.x, cell.center.y, cell.center.z)
        .normalize()
        .multiplyScalar(R);
      ring.lookAt(0, 0, 0);
      ring.userData.cellId = placed.cellId;
      this.markers.add(ring);

      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.04, 16),
        new THREE.MeshStandardMaterial({
          color: 0x0a3030,
          emissive: 0x1a6060,
          emissiveIntensity: 0.6,
          side: THREE.DoubleSide,
        }),
      );
      pad.position.copy(ring.position);
      pad.lookAt(0, 0, 0);
      pad.userData.cellId = placed.cellId;
      this.markers.add(pad);
    }

    // Unclaimed mines
    for (const placed of data.placed) {
      if (!placed.tile.hasMine || mineCells.has(placed.cellId)) continue;
      const cell = cellMap.get(placed.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.035),
        new THREE.MeshStandardMaterial({
          color: 0xf0a05a,
          emissive: 0xf0a05a,
          emissiveIntensity: 0.5,
        }),
      );
      mesh.position
        .set(cell.center.x, cell.center.y, cell.center.z)
        .normalize()
        .multiplyScalar(R);
      mesh.userData.cellId = placed.cellId;
      this.markers.add(mesh);
    }

    for (const t of data.towers) {
      const cell = cellMap.get(t.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.045, 0.14, 6),
        new THREE.MeshStandardMaterial({
          color: ownerColor.get(t.ownerId) ?? "#fff",
          emissive: ownerColor.get(t.ownerId) ?? "#fff",
          emissiveIntensity: 0.35,
        }),
      );
      mesh.position
        .set(cell.center.x, cell.center.y, cell.center.z)
        .normalize()
        .multiplyScalar(R);
      mesh.lookAt(0, 0, 0);
      mesh.rotateX(Math.PI / 2);
      mesh.userData.cellId = t.cellId;
      this.markers.add(mesh);
    }

    for (const m of data.mines) {
      const cell = cellMap.get(m.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xf0a05a }),
      );
      mesh.position
        .set(cell.center.x, cell.center.y, cell.center.z)
        .normalize()
        .multiplyScalar(R);
      mesh.userData.cellId = m.cellId;
      this.markers.add(mesh);
    }

    this.syncBods(data);

    for (const p of data.players) {
      const cell = cellMap.get(p.baseCellId);
      if (!cell) continue;
      const isMine = data.myBaseCellId === p.baseCellId;
      const color = isMine ? "#e8dcc8" : (ownerColor.get(p.id) ?? "#c4b8a8");
      const emissive = isMine ? "#8a7a50" : p.alive ? 0x221810 : 0x550000;
      const castle = this.makeCastle(color, emissive, isMine ? 0.45 : 0.25);
      const outward = new THREE.Vector3(
        cell.center.x,
        cell.center.y,
        cell.center.z,
      ).normalize();
      castle.position.copy(outward).multiplyScalar(R);
      castle.scale.setScalar(0.85);
      castle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
      castle.userData.cellId = p.baseCellId;
      castle.traverse((obj) => {
        obj.userData.cellId = p.baseCellId;
      });
      this.markers.add(castle);

      if (isMine) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.11, 0.01, 8, 24),
          new THREE.MeshStandardMaterial({
            color: 0x7eb8ff,
            emissive: 0x3a80d0,
            emissiveIntensity: 0.55,
          }),
        );
        ring.position.copy(outward).multiplyScalar(R * 0.998);
        ring.lookAt(0, 0, 0);
        ring.userData.cellId = p.baseCellId;
        this.markers.add(ring);
      }
    }
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
    this.lastBodData = data;
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const seen = new Set<string>();

    for (const b of data.bods) {
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

      let mesh = this.bodGroup.children.find(
        (c) => c.userData.bodId === b.id,
      ) as THREE.Mesh | undefined;
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 10, 10),
          new THREE.MeshStandardMaterial({
            color: ownerColor.get(b.ownerId) ?? "#fff",
            emissive: ownerColor.get(b.ownerId) ?? "#fff",
            emissiveIntensity: 0.85,
          }),
        );
        mesh.userData.bodId = b.id;
        this.bodGroup.add(mesh);
      }
    }

    for (const child of [...this.bodGroup.children]) {
      const id = child.userData.bodId as string;
      if (!seen.has(id)) {
        this.bodGroup.remove(child);
        this.localCooldownRemain.delete(id);
        this.localBodPathIndex.delete(id);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    }
  }

  private placeBodMesh(
    mesh: THREE.Mesh,
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
    mesh.position.set((x / len) * s, (y / len) * s, (z / len) * s);
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;

    if (!this.drag) {
      if (this.focusTarget) {
        const k = 1 - Math.exp(-6 * dt);
        const dTheta = PlanetView.shortestAngle(
          this.spherical.theta,
          this.focusTarget.theta,
        );
        const dPhi = this.focusTarget.phi - this.spherical.phi;
        this.spherical.theta += dTheta * k;
        this.spherical.phi += dPhi * k;
        this.updateCamera();
        if (Math.abs(dTheta) + Math.abs(dPhi) < 0.01) {
          this.spherical.theta = this.focusTarget.theta;
          this.spherical.phi = this.focusTarget.phi;
          this.focusTarget = null;
          this.updateCamera();
        }
      } else {
        this.spherical.theta += this.velTheta * dt;
        this.spherical.phi = Math.min(
          Math.PI - 0.1,
          Math.max(0.1, this.spherical.phi + this.velPhi * dt),
        );
        const damp = Math.exp(-4.2 * dt);
        this.velTheta *= damp;
        this.velPhi *= damp;
        if (Math.abs(this.velTheta) + Math.abs(this.velPhi) > 0.0005) {
          this.updateCamera();
        }
      }
    }

    // Predict bod hops locally so they don't freeze at nodes waiting for 10Hz snaps
    if (this.lastBodData) {
      const period = Math.max(1, this.lastBodData.bodMoveEveryTicks ?? 10);
      const endPause = Math.max(3, Math.floor(period / 2));
      const tickHz = 10;
      const cellMap = new Map(this.lastBodData.cells.map((c) => [c.id, c]));
      for (const b of this.lastBodData.bods) {
        const mesh = this.bodGroup.children.find(
          (c) => c.userData.bodId === b.id,
        ) as THREE.Mesh | undefined;
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

    if (this.spin && !this.drag && Math.abs(this.velTheta) < 0.05) {
      this.root.rotation.y += 0.0005;
    }
    this.pathGroup.rotation.y = this.root.rotation.y;
    this.markers.rotation.y = this.root.rotation.y;
    this.bodGroup.rotation.y = this.root.rotation.y;
    this.renderer.render(this.scene, this.camera);
  }
}
