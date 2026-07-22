import * as THREE from "three";
import {
  DEFAULT_TOWER_VISUAL,
  normalizeTowerVisualId,
  type TowerVisualId,
} from "@tdw/game-core";

const S = 0.045; // footprint scale (matches old cone radius)

function solid(color: string, emissive = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
  });
}

function glass(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
}

function accent(team: string, towardWhite = 0.35): string {
  const c = new THREE.Color(team);
  c.lerp(new THREE.Color("#ffffff"), towardWhite);
  return `#${c.getHexString()}`;
}

function shade(team: string, mul = 0.55): string {
  const c = new THREE.Color(team);
  c.multiplyScalar(mul);
  return `#${c.getHexString()}`;
}

function addBox(
  g: THREE.Group,
  w: number,
  h: number,
  d: number,
  y: number,
  mat: THREE.Material,
  x = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function addCyl(
  g: THREE.Group,
  rTop: number,
  rBot: number,
  h: number,
  y: number,
  mat: THREE.Material,
  sides = 8,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, sides),
    mat,
  );
  m.position.y = y;
  g.add(m);
  return m;
}

function buildKeep(team: string): THREE.Group {
  const g = new THREE.Group();
  const mat = solid(team);
  const dark = solid(shade(team), 0.2);
  addBox(g, S * 1.6, S * 2.2, S * 1.6, S * 1.1, mat);
  const merlonY = S * 2.35;
  for (const [x, z] of [
    [-0.55, -0.55],
    [0.55, -0.55],
    [-0.55, 0.55],
    [0.55, 0.55],
    [0, -0.55],
    [0, 0.55],
    [-0.55, 0],
    [0.55, 0],
  ] as [number, number][]) {
    addBox(g, S * 0.35, S * 0.4, S * 0.35, merlonY, dark, x * S, z * S);
  }
  return g;
}

function buildOrb(team: string): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, S * 0.45, S * 0.55, S * 2.0, S * 1.0, solid(team), 8);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(S * 0.7, 12, 10), glass(accent(team, 0.45)));
  orb.position.y = S * 2.55;
  orb.userData.pulse = true;
  g.add(orb);
  g.userData.anim = "orb";
  return g;
}

function buildOrbit(team: string): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(S * 1.0, S * 2.8, 7),
    solid(team),
  );
  cone.position.y = S * 1.4;
  g.add(cone);
  const pivot = new THREE.Group();
  pivot.position.y = S * 2.9;
  pivot.userData.orbit = true;
  const ballMat = solid(accent(team, 0.5), 0.6);
  for (let i = 0; i < 3; i++) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(S * 0.22, 8, 6), ballMat);
    const a = (i / 3) * Math.PI * 2;
    ball.position.set(Math.cos(a) * S * 0.85, 0, Math.sin(a) * S * 0.85);
    pivot.add(ball);
  }
  g.add(pivot);
  g.userData.anim = "orbit";
  return g;
}

function buildSpire(team: string): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, S * 0.4, S * 0.5, S * 2.6, S * 1.3, solid(team), 7);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(S * 0.65, S * 1.0, 7), solid(accent(team), 0.4));
  roof.position.y = S * 3.1;
  g.add(roof);
  return g;
}

function buildDisk(team: string): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, S * 0.22, S * 0.28, S * 2.2, S * 1.1, solid(shade(team, 0.7), 0.25), 8);
  const mat = solid(team, 0.4);
  for (let i = 0; i < 3; i++) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(S * (0.9 - i * 0.12), S * (0.9 - i * 0.12), S * 0.18, 12), mat);
    disc.position.y = S * (1.6 + i * 0.55);
    g.add(disc);
  }
  return g;
}

function buildObelisk(team: string): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(S * 1.1, S * 3.0, S * 1.1), solid(team));
  m.position.y = S * 1.5;
  m.scale.set(1, 1, 1);
  // taper via second narrower top block
  g.add(m);
  addBox(g, S * 0.75, S * 0.9, S * 0.75, S * 3.2, solid(accent(team, 0.25), 0.3));
  return g;
}

function buildTwin(team: string): THREE.Group {
  const g = new THREE.Group();
  addBox(g, S * 1.8, S * 0.7, S * 1.2, S * 0.35, solid(shade(team, 0.65), 0.25));
  const barrel = solid(team, 0.4);
  for (const x of [-0.45, 0.45]) {
    const m = addCyl(g, S * 0.28, S * 0.32, S * 1.8, S * 1.4, barrel, 8);
    m.position.x = x * S;
  }
  return g;
}

function buildCrystal(team: string): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, S * 0.7, S * 0.85, S * 0.5, S * 0.25, solid(shade(team, 0.7), 0.2), 6);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(S * 0.95, 0), solid(accent(team, 0.4), 0.55));
  gem.position.y = S * 1.35;
  g.add(gem);
  return g;
}

function buildBeacon(team: string): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(S * 0.35, S * 0.5, S * 2.4, 3),
    solid(team),
  );
  shaft.position.y = S * 1.2;
  g.add(shaft);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(S * 0.45, 10, 8), solid(accent(team, 0.55), 0.85));
  lamp.position.y = S * 2.7;
  g.add(lamp);
  return g;
}

function buildBastion(team: string): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, S * 1.15, S * 1.25, S * 1.4, S * 0.7, solid(team), 6);
  addCyl(g, S * 0.55, S * 0.65, S * 0.9, S * 1.85, solid(accent(team, 0.2), 0.35), 6);
  return g;
}

const BUILDERS: Record<TowerVisualId, (team: string) => THREE.Group> = {
  keep: buildKeep,
  orb: buildOrb,
  orbit: buildOrbit,
  spire: buildSpire,
  disk: buildDisk,
  obelisk: buildObelisk,
  twin: buildTwin,
  crystal: buildCrystal,
  beacon: buildBeacon,
  bastion: buildBastion,
};

export function createTowerVisual(
  visualId: string | undefined,
  teamColor: string,
): THREE.Group {
  const id = normalizeTowerVisualId(visualId ?? DEFAULT_TOWER_VISUAL);
  const g = BUILDERS[id](teamColor);
  g.userData.visualId = id;
  g.userData.teamColor = teamColor;
  return g;
}

/** Drive orb pulse / orbit spin. `t` = seconds. */
export function tickTowerVisual(root: THREE.Object3D, t: number): void {
  const anim = root.userData.anim as string | undefined;
  if (anim === "orb") {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.pulse) {
        const s = 1 + Math.sin(t * 3.2) * 0.12;
        obj.scale.setScalar(s);
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.38 + Math.sin(t * 3.2) * 0.12;
      }
    });
  } else if (anim === "orbit") {
    root.traverse((obj) => {
      if (obj.userData.orbit) {
        obj.rotation.y = t * 2.4;
      }
    });
  }
}
