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
  private drag = false;
  private moved = false;
  private prevX = 0;
  private prevY = 0;
  private spherical = { theta: 0.4, phi: 0.9, radius: 4.2 };
  private selectedCell: number | null = null;
  private spin = true;
  private interactionMode: "placement" | "combat" | "other" = "other";
  private hoverCellId: number | null = null;
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
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi = Math.min(
        Math.PI - 0.1,
        Math.max(0.1, this.spherical.phi + dy * 0.005),
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

    this.drawRoutes(data);
    this.refreshMarkers(data);
  }

  /** Thick glowing arcs between connected route cells */
  private drawRoutes(data: PlanetViewData): void {
    this.clearGroup(this.pathGroup);
    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const placedMap = new Map(data.placed.map((p) => [p.cellId, p]));
    const drawn = new Set<string>();

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

        const a = new THREE.Vector3(
          cell.center.x,
          cell.center.y,
          cell.center.z,
        ).multiplyScalar(1.04);
        const b = new THREE.Vector3(
          nCell.center.x,
          nCell.center.y,
          nCell.center.z,
        ).multiplyScalar(1.04);
        const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(1.08);

        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 8, 0.01, 5, false),
          new THREE.MeshStandardMaterial({
            color: 0x5a6a58,
            emissive: 0x2a3a28,
            emissiveIntensity: 0.12,
            metalness: 0.05,
            roughness: 0.85,
            transparent: true,
            opacity: 0.55,
          }),
        );
        this.pathGroup.add(tube);
      }
    }
  }

  refreshMarkers(data: PlanetViewData): void {
    this.clearGroup(this.markers);
    this.drawRoutes(data);

    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const towerCells = new Set(data.towers.map((t) => t.cellId));
    const mineCells = new Set(data.mines.map((m) => m.cellId));

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
        .multiplyScalar(1.055);
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
        .multiplyScalar(1.05);
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
        .multiplyScalar(1.06);
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
        .multiplyScalar(1.045);
      mesh.userData.cellId = m.cellId;
      this.markers.add(mesh);
    }

    this.syncBods(data);

    for (const p of data.players) {
      const cell = cellMap.get(p.baseCellId);
      if (!cell) continue;
      const isMine = data.myBaseCellId === p.baseCellId;
      // Castles: cream stone for you, team colour for others — never match plinth
      const color = isMine ? "#e8dcc8" : (ownerColor.get(p.id) ?? "#c4b8a8");
      const emissive = isMine ? "#8a7a50" : p.alive ? 0x221810 : 0x550000;
      const castle = this.makeCastle(color, emissive, isMine ? 0.45 : 0.25);
      const outward = new THREE.Vector3(
        cell.center.x,
        cell.center.y,
        cell.center.z,
      ).normalize();
      // Sit on the pentagon surface (not floating in space)
      castle.position.copy(outward).multiplyScalar(1.02);
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
        ring.position.copy(outward).multiplyScalar(1.018);
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

  /** Create/update bod meshes; positions lerped along path edges */
  private syncBods(data: PlanetViewData): void {
    this.lastBodData = data;
    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });
    const period = Math.max(1, data.bodMoveEveryTicks ?? 10);
    const seen = new Set<string>();

    for (const b of data.bods) {
      seen.add(b.id);
      this.localCooldownRemain.set(b.id, b.moveCooldown ?? 0);
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
      this.placeBodMesh(mesh, b, cellMap, period, b.moveCooldown ?? 0);
    }

    for (const child of [...this.bodGroup.children]) {
      const id = child.userData.bodId as string;
      if (!seen.has(id)) {
        this.bodGroup.remove(child);
        this.localCooldownRemain.delete(id);
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
    cooldown: number,
  ): void {
    const path = b.path ?? [b.cellId];
    const idx = b.pathIndex ?? 0;
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
    const s = 1.08;
    mesh.position.set((x / len) * s, (y / len) * s, (z / len) * s);
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;

    // Smooth bod travel between server snapshots (~10Hz)
    if (this.lastBodData) {
      const period = Math.max(1, this.lastBodData.bodMoveEveryTicks ?? 10);
      const tickHz = 10;
      const cellMap = new Map(this.lastBodData.cells.map((c) => [c.id, c]));
      for (const b of this.lastBodData.bods) {
        const mesh = this.bodGroup.children.find(
          (c) => c.userData.bodId === b.id,
        ) as THREE.Mesh | undefined;
        if (!mesh) continue;
        let remain = this.localCooldownRemain.get(b.id);
        if (remain === undefined) remain = b.moveCooldown ?? 0;
        if ((b.pathIndex ?? 0) < (b.path?.length ?? 1) - 1) {
          remain = Math.max(0, remain - dt * tickHz);
          this.localCooldownRemain.set(b.id, remain);
        }
        this.placeBodMesh(mesh, b, cellMap, period, remain);
      }
    }

    if (this.spin) this.root.rotation.y += 0.0005;
    this.pathGroup.rotation.y = this.root.rotation.y;
    this.markers.rotation.y = this.root.rotation.y;
    this.bodGroup.rotation.y = this.root.rotation.y;
    this.renderer.render(this.scene, this.camera);
  }
}
