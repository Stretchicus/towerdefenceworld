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
  teamColor: string,
): FxSystem {
  const group = new THREE.Group();
  const up = outward.clone().normalize();
  const launch = origin.clone().addScaledVector(up, 0.08);

  type Rocket = {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    age: number;
    burstAt: number;
  };
  type Spark = {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
    color: THREE.Color;
  };

  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let spawnAcc = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const maxSparks = 400;
  const sparkPos = new Float32Array(maxSparks * 3);
  const sparkCol = new Float32Array(maxSparks * 3);
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = new THREE.PointsMaterial({
    size: 0.018,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  group.add(sparkPoints);

  const rocketGeo = new THREE.BufferGeometry();
  const maxRockets = 12;
  const rocketPos = new Float32Array(maxRockets * 3);
  rocketGeo.setAttribute("position", new THREE.BufferAttribute(rocketPos, 3));
  const rocketMat = new THREE.PointsMaterial({
    size: 0.028,
    color: teamColor,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const rocketPoints = new THREE.Points(rocketGeo, rocketMat);
  group.add(rocketPoints);

  const palette = [
    new THREE.Color(teamColor),
    new THREE.Color(teamColor).lerp(new THREE.Color("#ffffff"), 0.45),
    new THREE.Color("#ffe08a"),
    new THREE.Color("#ff6b4a"),
    new THREE.Color("#7ad7ff"),
  ];

  const tmp = new THREE.Vector3();
  const side = new THREE.Vector3();

  function spawnRocket(): void {
    if (rockets.length >= maxRockets) return;
    const speed = 0.55 + Math.random() * 0.35;
    rockets.push({
      pos: launch.clone(),
      vel: up.clone().multiplyScalar(speed),
      age: 0,
      burstAt: 0.12 + Math.random() * 0.1,
    });
  }

  function burst(at: THREE.Vector3): void {
    const n = 28 + Math.floor(Math.random() * 18);
    for (let i = 0; i < n; i++) {
      if (sparks.length >= maxSparks) sparks.shift();
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      tmp.set(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      );
      // Bias burst slightly outward from planet
      tmp.addScaledVector(up, 0.35).normalize();
      const speed = 0.18 + Math.random() * 0.28;
      const life = 0.55 + Math.random() * 0.55;
      sparks.push({
        pos: at.clone(),
        vel: tmp.multiplyScalar(speed),
        life,
        maxLife: life,
        color: palette[Math.floor(Math.random() * palette.length)]!.clone(),
      });
    }
  }

  function syncBuffers(): void {
    for (let i = 0; i < maxRockets; i++) {
      const r = rockets[i];
      const o = i * 3;
      if (r) {
        rocketPos[o] = r.pos.x;
        rocketPos[o + 1] = r.pos.y;
        rocketPos[o + 2] = r.pos.z;
      } else {
        rocketPos[o] = rocketPos[o + 1] = rocketPos[o + 2] = 0;
      }
    }
    rocketGeo.attributes.position!.needsUpdate = true;
    rocketGeo.setDrawRange(0, rockets.length);

    for (let i = 0; i < maxSparks; i++) {
      const s = sparks[i];
      const o = i * 3;
      if (s) {
        sparkPos[o] = s.pos.x;
        sparkPos[o + 1] = s.pos.y;
        sparkPos[o + 2] = s.pos.z;
        sparkCol[o] = s.color.r;
        sparkCol[o + 1] = s.color.g;
        sparkCol[o + 2] = s.color.b;
      } else {
        sparkPos[o] = sparkPos[o + 1] = sparkPos[o + 2] = 0;
        sparkCol[o] = sparkCol[o + 1] = sparkCol[o + 2] = 0;
      }
    }
    sparkGeo.attributes.position!.needsUpdate = true;
    sparkGeo.attributes.color!.needsUpdate = true;
    sparkGeo.setDrawRange(0, sparks.length);
  }

  spawnRocket();

  return {
    group,
    update(dt: number) {
      spawnAcc += dt;
      while (spawnAcc > 0.55) {
        spawnAcc -= 0.45 + Math.random() * 0.35;
        spawnRocket();
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!;
        r.age += dt;
        r.pos.addScaledVector(r.vel, dt);
        const height = r.pos.clone().sub(launch).dot(up);
        if (height >= r.burstAt || r.age > 1.4) {
          burst(r.pos);
          rockets.splice(i, 1);
        }
      }

      const gravity = -0.55;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.vel.addScaledVector(up, gravity * dt);
        // slight drag
        s.vel.multiplyScalar(1 - 0.8 * dt);
        s.pos.addScaledVector(s.vel, dt);
        // twinkle via unused side noise
        side.set(
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01,
          (Math.random() - 0.5) * 0.01,
        );
        s.pos.add(side);
      }

      const fade =
        sparks.length === 0
          ? 0.95
          : Math.min(
              1,
              sparks.reduce((a, s) => a + s.life / s.maxLife, 0) /
                Math.max(1, sparks.length),
            );
      sparkMat.opacity = 0.55 + fade * 0.4;
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
