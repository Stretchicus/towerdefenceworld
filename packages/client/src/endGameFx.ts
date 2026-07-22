import * as THREE from "three";

type FxSystem = {
  group: THREE.Group;
  update: (dt: number) => void;
  dispose: () => void;
};

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Points || obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else (mat as THREE.Material).dispose();
    }
  });
}

function makeFireworks(
  origin: THREE.Vector3,
  outward: THREE.Vector3,
  _teamColor: string,
): FxSystem {
  const group = new THREE.Group();
  const up = outward.clone().normalize();
  const launch = origin.clone().addScaledVector(up, 0.06);

  // Orthonormal frame for slight off-vertical aim
  const tangent = new THREE.Vector3();
  if (Math.abs(up.y) < 0.9) tangent.set(0, 1, 0).cross(up).normalize();
  else tangent.set(1, 0, 0).cross(up).normalize();
  const bitangent = new THREE.Vector3().copy(up).cross(tangent).normalize();

  type Mortar = {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    age: number;
  };
  type Spark = {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
    color: THREE.Color;
  };

  const mortars: Mortar[] = [];
  const sparks: Spark[] = [];
  let nextLaunch = 0.05 + Math.random() * 0.25;

  const sparkGeo = new THREE.BufferGeometry();
  const maxSparks = 700;
  const sparkPos = new Float32Array(maxSparks * 3);
  const sparkCol = new Float32Array(maxSparks * 3);
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = new THREE.PointsMaterial({
    size: 0.016,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(sparkGeo, sparkMat));

  const mortarGeo = new THREE.BufferGeometry();
  const maxMortars = 8;
  const mortarPos = new Float32Array(maxMortars * 3);
  mortarGeo.setAttribute("position", new THREE.BufferAttribute(mortarPos, 3));
  const mortarMat = new THREE.PointsMaterial({
    size: 0.022,
    color: 0xfff2c8,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(mortarGeo, mortarMat));

  const palette = [
    new THREE.Color("#ff4d6d"),
    new THREE.Color("#ff9f1c"),
    new THREE.Color("#ffe66d"),
    new THREE.Color("#7bf1a8"),
    new THREE.Color("#4cc9f0"),
    new THREE.Color("#7aa2ff"),
    new THREE.Color("#c77dff"),
    new THREE.Color("#ff6bcb"),
    new THREE.Color("#ffffff"),
  ];

  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const GRAVITY = -0.62;

  function spawnMortar(): void {
    if (mortars.length >= maxMortars) return;
    // Slight lean off vertical (8°–22°)
    const lean = (8 + Math.random() * 14) * (Math.PI / 180);
    const yaw = Math.random() * Math.PI * 2;
    dir
      .copy(up)
      .multiplyScalar(Math.cos(lean))
      .addScaledVector(tangent, Math.sin(lean) * Math.cos(yaw))
      .addScaledVector(bitangent, Math.sin(lean) * Math.sin(yaw))
      .normalize();
    // Higher apex over the castle (~0.55–0.85 world units)
    const speed = 0.82 + Math.random() * 0.28;
    mortars.push({
      pos: launch.clone().addScaledVector(
        tangent,
        (Math.random() - 0.5) * 0.02,
      ).addScaledVector(bitangent, (Math.random() - 0.5) * 0.02),
      vel: dir.clone().multiplyScalar(speed),
      age: 0,
    });
  }

  function burst(at: THREE.Vector3): void {
    // 2–3 colours per shell for a classic mortar look
    const nColors = 2 + (Math.random() < 0.45 ? 1 : 0);
    const shellColors: THREE.Color[] = [];
    const used = new Set<number>();
    while (shellColors.length < nColors) {
      const i = Math.floor(Math.random() * palette.length);
      if (used.has(i)) continue;
      used.add(i);
      shellColors.push(palette[i]!);
    }

    const count = 52 + Math.floor(Math.random() * 28);
    const shellSpeed = 0.2 + Math.random() * 0.08;
    for (let i = 0; i < count; i++) {
      if (sparks.length >= maxSparks) sparks.shift();
      // Uniform sphere shell (equal speeds → spherical burst)
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      tmp.set(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
      const speed = shellSpeed * (0.92 + Math.random() * 0.16);
      const life = 0.65 + Math.random() * 0.45;
      sparks.push({
        pos: at.clone(),
        vel: tmp.clone().multiplyScalar(speed),
        life,
        maxLife: life,
        color: shellColors[Math.floor(Math.random() * shellColors.length)]!.clone(),
      });
    }
  }

  function syncBuffers(): void {
    for (let i = 0; i < maxMortars; i++) {
      const m = mortars[i];
      const o = i * 3;
      if (m) {
        mortarPos[o] = m.pos.x;
        mortarPos[o + 1] = m.pos.y;
        mortarPos[o + 2] = m.pos.z;
      } else {
        mortarPos[o] = mortarPos[o + 1] = mortarPos[o + 2] = 0;
      }
    }
    mortarGeo.attributes.position!.needsUpdate = true;
    mortarGeo.setDrawRange(0, mortars.length);

    for (let i = 0; i < maxSparks; i++) {
      const s = sparks[i];
      const o = i * 3;
      if (s) {
        const fade = Math.max(0, s.life / s.maxLife);
        sparkPos[o] = s.pos.x;
        sparkPos[o + 1] = s.pos.y;
        sparkPos[o + 2] = s.pos.z;
        sparkCol[o] = s.color.r * fade;
        sparkCol[o + 1] = s.color.g * fade;
        sparkCol[o + 2] = s.color.b * fade;
      } else {
        sparkPos[o] = sparkPos[o + 1] = sparkPos[o + 2] = 0;
        sparkCol[o] = sparkCol[o + 1] = sparkCol[o + 2] = 0;
      }
    }
    sparkGeo.attributes.position!.needsUpdate = true;
    sparkGeo.attributes.color!.needsUpdate = true;
    sparkGeo.setDrawRange(0, sparks.length);
  }

  spawnMortar();

  return {
    group,
    update(dt: number) {
      nextLaunch -= dt;
      // Irregular cadence so several mortars overlap in flight / burst
      while (nextLaunch <= 0) {
        spawnMortar();
        nextLaunch += 0.18 + Math.random() * 0.65;
      }

      for (let i = mortars.length - 1; i >= 0; i--) {
        const m = mortars[i]!;
        m.age += dt;
        m.vel.addScaledVector(up, GRAVITY * dt);
        m.pos.addScaledVector(m.vel, dt);
        // Burst at apex (upward speed gone) after a short climb
        const climb = m.vel.dot(up);
        if ((climb <= 0.04 && m.age > 0.35) || m.age > 2.2) {
          burst(m.pos);
          mortars.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.vel.addScaledVector(up, GRAVITY * 0.55 * dt);
        s.vel.multiplyScalar(1 - 0.55 * dt);
        s.pos.addScaledVector(s.vel, dt);
      }

      syncBuffers();
    },
    dispose() {
      disposeObject(group);
    },
  };
}

function makeFlames(origin: THREE.Vector3, outward: THREE.Vector3): FxSystem {
  const group = new THREE.Group();
  const up = outward.clone().normalize();
  const base = origin.clone().addScaledVector(up, 0.02);

  type Flame = {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
    size: number;
  };

  const flames: Flame[] = [];
  const max = 120;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(max * 3);
  const colArr = new Float32Array(max * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.035,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(geo, mat));

  const orange = new THREE.Color("#ff6a1a");
  const yellow = new THREE.Color("#ffd060");
  const red = new THREE.Color("#c42810");
  const tmpC = new THREE.Color();
  const lateral = new THREE.Vector3();

  function spawn(): void {
    if (flames.length >= max) return;
    lateral.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    lateral.addScaledVector(up, -lateral.dot(up));
    if (lateral.lengthSq() < 1e-8) {
      lateral.set(1, 0, 0).addScaledVector(up, -up.x);
    }
    if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0);
    lateral.normalize();
    const offset = lateral.clone().multiplyScalar((Math.random() - 0.5) * 0.06);
    const drift = lateral.clone().multiplyScalar((Math.random() - 0.5) * 0.05);
    const life = 0.35 + Math.random() * 0.45;
    flames.push({
      pos: base.clone().add(offset),
      vel: up.clone().multiplyScalar(0.12 + Math.random() * 0.18).add(drift),
      life,
      maxLife: life,
      size: 0.02 + Math.random() * 0.02,
    });
  }

  for (let i = 0; i < 40; i++) spawn();

  return {
    group,
    update(dt: number) {
      for (let i = 0; i < 4; i++) spawn();
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i]!;
        f.life -= dt;
        if (f.life <= 0) {
          flames.splice(i, 1);
          continue;
        }
        f.pos.addScaledVector(f.vel, dt);
        f.vel.multiplyScalar(1 - 0.4 * dt);
      }

      for (let i = 0; i < max; i++) {
        const f = flames[i];
        const o = i * 3;
        if (!f) {
          posArr[o] = posArr[o + 1] = posArr[o + 2] = 0;
          colArr[o] = colArr[o + 1] = colArr[o + 2] = 0;
          continue;
        }
        posArr[o] = f.pos.x;
        posArr[o + 1] = f.pos.y;
        posArr[o + 2] = f.pos.z;
        const t = 1 - f.life / f.maxLife;
        if (t < 0.35) tmpC.copy(yellow).lerp(orange, t / 0.35);
        else tmpC.copy(orange).lerp(red, (t - 0.35) / 0.65);
        colArr[o] = tmpC.r;
        colArr[o + 1] = tmpC.g;
        colArr[o + 2] = tmpC.b;
      }
      geo.attributes.position!.needsUpdate = true;
      geo.attributes.color!.needsUpdate = true;
      geo.setDrawRange(0, flames.length);
      mat.size = 0.03 + Math.sin(performance.now() * 0.02) * 0.006;
    },
    dispose() {
      disposeObject(group);
    },
  };
}

export type CastleFxSpec = {
  origin: THREE.Vector3;
  outward: THREE.Vector3;
  mode: "win" | "lose";
  teamColor: string;
};

/** Manages looping fireworks (winners) and flames (losers) at end of match. */
export class EndGameCastleFx {
  readonly group = new THREE.Group();
  private systems: FxSystem[] = [];

  setCastles(specs: CastleFxSpec[]): void {
    this.clear();
    for (const s of specs) {
      const sys =
        s.mode === "win"
          ? makeFireworks(s.origin, s.outward, s.teamColor)
          : makeFlames(s.origin, s.outward);
      this.systems.push(sys);
      this.group.add(sys.group);
    }
  }

  update(dt: number): void {
    for (const s of this.systems) s.update(dt);
  }

  clear(): void {
    for (const s of this.systems) {
      this.group.remove(s.group);
      s.dispose();
    }
    this.systems = [];
  }
}
