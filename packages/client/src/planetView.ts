import * as THREE from "three";

export interface CellView {
  id: number;
  sides: number;
  center: { x: number; y: number; z: number };
  vertices: { x: number; y: number; z: number }[];
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
  bods: { cellId: number; ownerId: string }[];
  players: { id: string; baseCellId: number; teamId: string; alive: boolean }[];
}

const TEAM_COLORS = ["#3dd6c6", "#f0a05a", "#7aa2ff", "#e07ad8"];

export class PlanetView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private root = new THREE.Group();
  private cellMeshes = new Map<number, THREE.Mesh>();
  private markers = new THREE.Group();
  private drag = false;
  private prevX = 0;
  private prevY = 0;
  private spherical = { theta: 0.4, phi: 0.9, radius: 4.2 };
  private selectedCell: number | null = null;
  onCellClick: ((cellId: number) => void) | null = null;

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
    this.scene.add(this.markers);
    this.updateCamera();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      this.drag = true;
      this.prevX = e.clientX;
      this.prevY = e.clientY;
    });
    window.addEventListener("pointerup", () => {
      this.drag = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.prevX;
      const dy = e.clientY - this.prevY;
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
      this.spherical.radius = Math.min(
        8,
        Math.max(2.4, this.spherical.radius + e.deltaY * 0.002),
      );
      this.updateCamera();
    });
    el.addEventListener("click", (e) => this.pick(e));

    window.addEventListener("resize", () => {
      const w = canvasParent.clientWidth;
      const h = canvasParent.clientHeight;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const hits = ray.intersectObjects([...this.cellMeshes.values()]);
    if (hits[0]) {
      const id = hits[0].object.userData.cellId as number;
      this.selectedCell = id;
      this.onCellClick?.(id);
    }
  }

  setPlanet(data: PlanetViewData): void {
    while (this.root.children.length) {
      const c = this.root.children[0]!;
      this.root.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    this.cellMeshes.clear();

    const placedIds = new Set(data.placed.map((p) => p.cellId));
    const routeIds = new Set(
      data.placed
        .filter((p) => p.connections.some(Boolean))
        .map((p) => p.cellId),
    );
    const baseSet = new Set(data.baseCellIds);

    for (const cell of data.cells) {
      const center = new THREE.Vector3(cell.center.x, cell.center.y, cell.center.z);
      const verts = cell.vertices.map(
        (v) => new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(1.002),
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

      let color = 0x1a2e3a;
      if (routeIds.has(cell.id)) color = 0x2a5a4a;
      if (placedIds.has(cell.id) && !routeIds.has(cell.id)) color = 0x243040;
      if (baseSet.has(cell.id)) color = 0x4a3a20;
      if (this.selectedCell === cell.id) color = 0x3dd6c6;

      const mat = new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        metalness: 0.15,
        roughness: 0.7,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.cellId = cell.id;
      this.root.add(mesh);
      this.cellMeshes.set(cell.id, mesh);

      // Edge lines
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
      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({
          color: 0x3dd6c6,
          transparent: true,
          opacity: 0.35,
        }),
      );
      this.root.add(edges);
    }

    // Atmosphere shell
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x3dd6c6,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
      }),
    );
    this.root.add(shell);

    this.refreshMarkers(data);
  }

  refreshMarkers(data: PlanetViewData): void {
    while (this.markers.children.length) {
      const c = this.markers.children[0]!;
      this.markers.remove(c);
    }
    const cellMap = new Map(data.cells.map((c) => [c.id, c]));
    const ownerColor = new Map<string, string>();
    data.players.forEach((p, i) => {
      ownerColor.set(p.id, TEAM_COLORS[i % TEAM_COLORS.length]!);
    });

    for (const t of data.towers) {
      const cell = cellMap.get(t.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.12, 6),
        new THREE.MeshStandardMaterial({
          color: ownerColor.get(t.ownerId) ?? "#fff",
        }),
      );
      mesh.position.set(cell.center.x, cell.center.y, cell.center.z).multiplyScalar(1.05);
      mesh.lookAt(0, 0, 0);
      mesh.rotateX(Math.PI / 2);
      this.markers.add(mesh);
    }

    for (const m of data.mines) {
      const cell = cellMap.get(m.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xf0a05a }),
      );
      mesh.position.set(cell.center.x, cell.center.y, cell.center.z).multiplyScalar(1.04);
      this.markers.add(mesh);
    }

    for (const b of data.bods) {
      const cell = cellMap.get(b.cellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshStandardMaterial({
          color: ownerColor.get(b.ownerId) ?? "#fff",
          emissive: ownerColor.get(b.ownerId) ?? "#fff",
          emissiveIntensity: 0.3,
        }),
      );
      mesh.position.set(cell.center.x, cell.center.y, cell.center.z).multiplyScalar(1.06);
      this.markers.add(mesh);
    }

    for (const p of data.players) {
      const cell = cellMap.get(p.baseCellId);
      if (!cell) continue;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.07),
        new THREE.MeshStandardMaterial({
          color: ownerColor.get(p.id) ?? "#fff",
          emissive: p.alive ? 0x222222 : 0x550000,
        }),
      );
      mesh.position.set(cell.center.x, cell.center.y, cell.center.z).multiplyScalar(1.08);
      this.markers.add(mesh);
    }
  }

  render(): void {
    this.root.rotation.y += 0.0008;
    this.renderer.render(this.scene, this.camera);
  }
}
