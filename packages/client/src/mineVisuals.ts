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

/** Low-poly mine heap + floating resource icon. */
export function createMineVisual(resourceId: string): THREE.Group {
  const color = resourceColor(resourceId);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.1,
  });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.04, 0.022, 6),
    mat,
  );
  base.position.y = 0.011;
  g.add(base);
  const pile = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.036, 6), mat);
  pile.position.y = 0.038;
  g.add(pile);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: iconTexture(resourceId),
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.055, 0.055, 0.055);
  sprite.position.y = 0.085;
  g.add(sprite);

  g.userData.mineResourceId = resourceId;
  return g;
}

export function createPickupOrb(resourceId: string): THREE.Mesh {
  const color = resourceColor(resourceId);
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 8),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.9,
      roughness: 0.35,
    }),
  );
}
