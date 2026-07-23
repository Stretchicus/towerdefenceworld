import * as THREE from "three";
import { resourceColor, resourceIconSvg } from "./resourceIcons.js";

const iconCache = new Map<string, THREE.Texture>();

function iconTexture(resourceId: string): THREE.Texture {
  const hit = iconCache.get(resourceId);
  if (hit) return hit;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Draw fallback disc immediately; SVG loads async into same texture
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = `#${resourceColor(resourceId).toString(16).padStart(6, "0")}`;
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(resourceId, tex);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    tex.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16">${resourceIconSvg(
      resourceId,
    ).replace(/<\/?svg[^>]*>/g, "")}</svg>`,
  )}`;
  return tex;
}

/**
 * Mine-shaft headframe: timber A-frame tower with a winding wheel on top,
 * accented in the mine's resource colour.
 */
export function createMineVisual(resourceId: string): THREE.Group {
  const accent = resourceColor(resourceId);
  const g = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({
    color: 0x6b4a2e,
    emissive: 0x2a1810,
    emissiveIntensity: 0.25,
    flatShading: true,
    roughness: 0.9,
    metalness: 0.05,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: 0x4a321f,
    emissive: 0x1a1008,
    emissiveIntensity: 0.2,
    flatShading: true,
    roughness: 0.92,
    metalness: 0.05,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8a9098,
    emissive: 0x22262c,
    emissiveIntensity: 0.2,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.55,
    flatShading: true,
    roughness: 0.45,
    metalness: 0.2,
  });

  // Plinth / shaft mouth
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.034, 0.01, 8),
    woodDark,
  );
  base.position.y = 0.005;
  g.add(base);
  const mouth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.006, 8),
    new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      emissive: accent,
      emissiveIntensity: 0.15,
      flatShading: true,
      roughness: 1,
    }),
  );
  mouth.position.y = 0.012;
  g.add(mouth);

  // A-frame legs (two pairs, front/back)
  const legH = 0.078;
  const legGeo = new THREE.BoxGeometry(0.007, legH, 0.007);
  const legSpread = 0.028;
  const legInset = 0.016;
  for (const z of [-legInset, legInset]) {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(side * legSpread * 0.35, legH * 0.5 + 0.01, z);
      leg.rotation.z = side * 0.28;
      g.add(leg);
    }
  }

  // Cross braces
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.005, 0.005), woodDark);
  brace.position.set(0, 0.038, 0);
  g.add(brace);
  const brace2 = brace.clone();
  brace2.position.y = 0.058;
  g.add(brace2);

  // Head platform / axle beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.008, 0.018), wood);
  beam.position.y = 0.09;
  g.add(beam);

  // Winding wheel (rim + hub + spokes) — resource-coloured rim
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.108, 0);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0035, 6, 16),
    accentMat,
  );
  rim.rotation.y = Math.PI / 2;
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8), metal);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);
  for (let i = 0; i < 6; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.0022, 0.0022), metal);
    spoke.rotation.z = (i / 6) * Math.PI;
    wheel.add(spoke);
  }
  // Small axle ends
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 6), metal);
  axle.rotation.z = Math.PI / 2;
  wheel.add(axle);
  g.add(wheel);

  // Resource bucket hanging under the beam
  const bucket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.007, 0.012, 6),
    accentMat,
  );
  bucket.position.set(0, 0.055, 0);
  g.add(bucket);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0012, 0.0012, 0.028, 4),
    metal,
  );
  cable.position.set(0, 0.072, 0);
  g.add(cable);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: iconTexture(resourceId),
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.048, 0.048, 0.048);
  sprite.position.y = 0.145;
  g.add(sprite);

  g.userData.mineResourceId = resourceId;
  return g;
}

export function createPickupOrb(resourceId: string): THREE.Mesh {
  const color = resourceColor(resourceId);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 10, 10),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.15,
      roughness: 0.3,
      metalness: 0.15,
    }),
  );
  orb.userData.part = "pickupOrb";
  orb.userData.resourceId = resourceId;
  return orb;
}
