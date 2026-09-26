import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Character } from "./Character";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

type Position = { x: number; y: number; z: number };
type RemotePlayer = { position: Position };
export type NavState = {
  x: number;
  z: number;
  yaw: number;
  playerAngle: number;
  biome: string;
  isRunning?: boolean;
};

export type BarType = "bronze" | "silver" | "gold";

export type CollectibleBar = {
  id: string;
  type: BarType;
  x: number;
  z: number;
  y: number;
  mesh: THREE.Group;
  collected: boolean;
  respawnTime: number;
};

export type ExchangeBooth = {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
};

/**
 * Checks whether a given (x, z) coordinate lies inside the Highland Road corridor
 * or within the Pinehaven City terrace and building grounds.
 */
export function isRoadOrCity(x: number, z: number): boolean {
  // Road corridor at x ≈ 92, running from z = -125 to z = 38, width ~8.5m
  if (Math.abs(x - 92) < 4.25 && z >= -125 && z <= 38) {
    return true;
  }
  // Pinehaven City leveled terrace and surrounding grounds
  const dx = x - 96;
  const dz = z - 66;
  if (dx * dx + dz * dz < 42 * 42) {
    return true;
  }
  return false;
}

/**
 * Natural Terrain Elevation Function:
 * Features rolling forested hills inland, and on the West side (x < -20) slopes down
 * into gentle sandy beach dunes, shoreline at x = -85 (y = 0), and ocean floor for x < -85.
 * On the East side, smooths the Highland Road corridor at x ≈ 92 and Pinehaven City terrace at (96, 66).
 */
export function getTerrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const spawnWeight = Math.min(1.0, Math.max(0, (dist - 14) / 26));

  const h1 = Math.sin(x * 0.016) * Math.cos(z * 0.016) * 3.4;
  const h2 = Math.sin(x * 0.038 + 1.2) * Math.cos(z * 0.032 + 0.8) * 1.6;
  const h3 = Math.sin(x * 0.075) * Math.sin(z * 0.075) * 0.55;
  const h4 = Math.cos(x * 0.14 + z * 0.09) * 0.22;
  const inlandHills = (h1 + h2 + h3 + h4) * spawnWeight;

  // West side expansive coastal slope and wide sandy beach down to shoreline at x = -82
  if (x < -18) {
    if (x < -82) {
      // Sloping ocean seabed underwater
      const seaT = Math.min(1, (-82 - x) / 75);
      return -seaT * 6.5 + Math.sin(z * 0.03) * 0.25;
    }
    // Expansive wide sandy beach & coastal dunes from x = -18 to -82 (64 meters of pure beach!)
    const frac = (-18 - x) / 64; // 0 at x = -18, 1 at x = -82
    const smoothFrac = frac * frac * (3 - 2 * frac);
    const dunes = Math.sin(z * 0.06 + x * 0.03) * 0.22;
    // Beach height slopes smoothly from inland hills down to +0.22m at the water edge
    const beachBaseY = THREE.MathUtils.lerp(Math.max(1.8, inlandHills), 0.22, smoothFrac);
    return Math.max(0.16, beachBaseY + dunes * (1 - smoothFrac * 0.7));
  }

  // Pinehaven City leveled terrace at (96, 66)
  const cityDist = Math.hypot(x - 96, z - 66);
  if (cityDist < 44) {
    const cityTerraceY = 3.6;
    if (cityDist <= 30) {
      return cityTerraceY;
    }
    const t = (cityDist - 30) / 14;
    const smoothT = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(cityTerraceY, inlandHills, smoothT);
  }

  // Highland Road corridor along X ≈ 92, from Z = -125 to Z = 38
  const roadDistX = Math.abs(x - 92);
  if (roadDistX < 4.8 && z >= -125 && z <= 38) {
    const baseCenter =
      (Math.sin(92 * 0.016) * Math.cos(z * 0.016) * 3.4 +
        Math.sin(92 * 0.038 + 1.2) * Math.cos(z * 0.032 + 0.8) * 1.6 +
        Math.sin(92 * 0.075) * Math.sin(z * 0.075) * 0.55 +
        Math.cos(92 * 0.14 + z * 0.09) * 0.22);

    let roadCenterY = baseCenter;
    if (z > 18) {
      const blendCity = Math.min(1, Math.max(0, (z - 18) / 20));
      roadCenterY = THREE.MathUtils.lerp(baseCenter, 3.6, blendCity * blendCity * (3 - 2 * blendCity));
    }

    if (roadDistX <= 2.6) {
      return roadCenterY;
    }
    const t = (roadDistX - 2.6) / 2.2;
    const smoothT = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(roadCenterY, inlandHills, smoothT);
  }

  return inlandHills;
}

/**
 * Multi-layer procedural ground textures:
 * Color map, tactile bump map, and roughness map with soil, pebbles, moss, and grass blades.
 */
function createGroundTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colCanvas = document.createElement("canvas");
  colCanvas.width = size;
  colCanvas.height = size;
  const colCtx = colCanvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext("2d")!;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext("2d")!;

  colCtx.fillStyle = "#3d2b1c";
  colCtx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = "#808080";
  bumpCtx.fillRect(0, 0, size, size);
  roughCtx.fillStyle = "#cccccc";
  roughCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 45; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 35 + Math.random() * 85;
    const grad = colCtx.createRadialGradient(x, y, 4, x, y, rad);
    grad.addColorStop(0, "rgba(50, 78, 35, 0.88)");
    grad.addColorStop(0.65, "rgba(66, 100, 44, 0.65)");
    grad.addColorStop(1, "rgba(61, 43, 28, 0.0)");
    colCtx.fillStyle = grad;
    colCtx.beginPath();
    colCtx.arc(x, y, rad, 0, Math.PI * 2);
    colCtx.fill();
  }

  for (let i = 0; i < 3400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3.5 + Math.random() * 8.5;
    const angle = (Math.random() - 0.5) * 1.3;
    const brightness = 60 + Math.random() * 85;
    const r = Math.floor(brightness * 0.65);
    const g = Math.floor(brightness * 1.25);
    const b = Math.floor(brightness * 0.55);

    colCtx.strokeStyle = `rgb(${r},${g},${b})`;
    colCtx.lineWidth = 1 + Math.random() * 1.6;
    colCtx.beginPath();
    colCtx.moveTo(x, y);
    colCtx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
    colCtx.stroke();

    const bumpVal = Math.min(255, Math.floor(brightness * 1.45));
    bumpCtx.strokeStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
    bumpCtx.lineWidth = 1.3;
    bumpCtx.beginPath();
    bumpCtx.moveTo(x, y);
    bumpCtx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
    bumpCtx.stroke();
  }

  for (let i = 0; i < 700; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const pr = 1 + Math.random() * 2.6;
    const isPebble = Math.random() > 0.6;
    if (isPebble) {
      colCtx.fillStyle = "#78746c";
      bumpCtx.fillStyle = "#ffffff";
      roughCtx.fillStyle = "#777777";
    } else {
      colCtx.fillStyle = "#2c1b10";
      bumpCtx.fillStyle = "#383838";
      roughCtx.fillStyle = "#eeeeee";
    }
    colCtx.beginPath();
    colCtx.arc(x, y, pr, 0, Math.PI * 2);
    colCtx.fill();
    bumpCtx.beginPath();
    bumpCtx.arc(x, y, pr, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(24, 24);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(24, 24);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(24, 24);

  return { map, bumpMap, roughnessMap };
}

/**
 * Procedural ripple beach sand texture with wind-blown dune ripples, warm golden grains, and fine pebbles.
 */
function createSandTexture(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colCanvas = document.createElement("canvas");
  colCanvas.width = size;
  colCanvas.height = size;
  const colCtx = colCanvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext("2d")!;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext("2d")!;

  // Warm golden sunlit sand base
  colCtx.fillStyle = "#edd9a2";
  colCtx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = "#808080";
  bumpCtx.fillRect(0, 0, size, size);
  roughCtx.fillStyle = "#e0e0e0";
  roughCtx.fillRect(0, 0, size, size);

  // Soft organic wind-blown sand ripples
  for (let y = 0; y < size; y += 14) {
    const amplitude = 3.5 + Math.sin(y * 0.05) * 2;
    colCtx.fillStyle = "rgba(252, 236, 188, 0.45)";
    colCtx.beginPath();
    colCtx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) {
      const cy = y + Math.sin(x * 0.08 + y * 0.02) * amplitude;
      colCtx.lineTo(x, cy);
    }
    colCtx.lineTo(size, y + 7);
    colCtx.lineTo(0, y + 7);
    colCtx.fill();

    colCtx.fillStyle = "rgba(200, 168, 114, 0.35)";
    colCtx.beginPath();
    colCtx.moveTo(0, y + 7);
    for (let x = 0; x <= size; x += 16) {
      const cy = y + 7 + Math.sin(x * 0.08 + y * 0.02) * amplitude;
      colCtx.lineTo(x, cy);
    }
    colCtx.lineTo(size, y + 11);
    colCtx.lineTo(0, y + 11);
    colCtx.fill();

    bumpCtx.fillStyle = "#a8a8a8";
    bumpCtx.fillRect(0, y, size, 4);
    bumpCtx.fillStyle = "#555555";
    bumpCtx.fillRect(0, y + 6, size, 4);
  }

  // Golden quartz and mineral grains
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 0.6 + Math.random() * 1.5;
    const isBright = Math.random() > 0.4;
    colCtx.fillStyle = isBright ? "rgba(255, 248, 225, 0.65)" : "rgba(182, 146, 92, 0.4)";
    colCtx.beginPath();
    colCtx.arc(x, y, rad, 0, Math.PI * 2);
    colCtx.fill();

    bumpCtx.fillStyle = isBright ? "#ffffff" : "#404040";
    bumpCtx.beginPath();
    bumpCtx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
    bumpCtx.fill();
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 32);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(6, 32);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(6, 32);

  return { map, bumpMap, roughnessMap };
}

/**
 * Procedural weathered cobblestone textures for Highland Road and Pinehaven City plaza.
 */
function createCobblestoneTexture(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colCanvas = document.createElement("canvas");
  colCanvas.width = size;
  colCanvas.height = size;
  const colCtx = colCanvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext("2d")!;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext("2d")!;

  // Dark mortar base
  colCtx.fillStyle = "#26221d";
  colCtx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = "#222222";
  bumpCtx.fillRect(0, 0, size, size);
  roughCtx.fillStyle = "#e0e0e0";
  roughCtx.fillRect(0, 0, size, size);

  // Cobblestone stone blocks with staggered rows and rounded edges
  const rows = 16;
  const cols = 16;
  const stoneW = size / cols;
  const stoneH = size / rows;

  for (let r = 0; r < rows; r++) {
    const offsetX = r % 2 === 0 ? 0 : stoneW * 0.5;
    for (let c = -1; c <= cols; c++) {
      const sx = c * stoneW + offsetX + 2;
      const sy = r * stoneH + 2;
      const sw = stoneW - 4;
      const sh = stoneH - 4;

      // Realistic granite / slate tone variation
      const baseTone = 112 + Math.floor(Math.random() * 46);
      const rVal = Math.floor(baseTone * 0.96);
      const gVal = Math.floor(baseTone * 0.92);
      const bVal = Math.floor(baseTone * 0.86);

      colCtx.fillStyle = `rgb(${rVal},${gVal},${bVal})`;
      colCtx.beginPath();
      colCtx.roundRect(sx, sy, sw, sh, 3.5);
      colCtx.fill();

      // Bump height on stone face
      bumpCtx.fillStyle = "#d8d8d8";
      bumpCtx.beginPath();
      bumpCtx.roundRect(sx + 1, sy + 1, sw - 2, sh - 2, 2.5);
      bumpCtx.fill();

      // Roughness texture
      roughCtx.fillStyle = "#7c7c7c";
      roughCtx.beginPath();
      roughCtx.roundRect(sx, sy, sw, sh, 3.5);
      roughCtx.fill();
    }
  }

  // Micro-texture grit & pebble speckles
  for (let i = 0; i < 900; i++) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const pRad = 0.8 + Math.random() * 1.5;
    colCtx.fillStyle = Math.random() > 0.5 ? "rgba(32,28,24,0.35)" : "rgba(210,205,190,0.3)";
    colCtx.beginPath();
    colCtx.arc(px, py, pRad, 0, Math.PI * 2);
    colCtx.fill();
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 28);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(4, 28);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(4, 28);

  return { map, bumpMap, roughnessMap };
}

/**
 * Procedural clock face texture with Roman numerals and clock hands.
 */
function createClockTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Clock dial face
  ctx.fillStyle = "#fcf8eb";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();

  // Brass/bronze outer rim
  ctx.strokeStyle = "#c59b27";
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.strokeStyle = "#241f17";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Roman numerals
  ctx.fillStyle = "#1e1a14";
  ctx.font = "bold 22px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r = size / 2 - 26;
    ctx.fillText(numerals[i], size / 2 + Math.cos(angle) * r, size / 2 + Math.sin(angle) * r);
  }

  // Hour & Minute hands pointing to 10:10
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";

  const hAngle = ((10 + 10 / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2);
  ctx.lineTo(size / 2 + Math.cos(hAngle) * 52, size / 2 + Math.sin(hAngle) * 52);
  ctx.stroke();

  const mAngle = (10 / 60) * Math.PI * 2 - Math.PI / 2;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2);
  ctx.lineTo(size / 2 + Math.cos(mAngle) * 78, size / 2 + Math.sin(mAngle) * 78);
  ctx.stroke();

  // Center bronze pivot
  ctx.fillStyle = "#c59b27";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 7, 0, Math.PI * 2);
  ctx.fill();

  return new THREE.CanvasTexture(canvas);
}

/**
 * Procedural wooden sign board texture with crisp engraved lettering.
 */
function createSignTexture(text: string, bgColor = "#382414", textColor = "#f4deb4"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = 2;
  for (let y = 14; y < 128; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y + (Math.random() - 0.5) * 4);
    ctx.lineTo(512, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }

  ctx.strokeStyle = "#1e1309";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 504, 120);

  ctx.fillStyle = textColor;
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, 256, 64);

  return new THREE.CanvasTexture(canvas);
}

/**
 * 3D grass tuft geometry with 4 crossed planes and realistic outward flare.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const bladeGeos: THREE.BufferGeometry[] = [];
  const blades = 4;

  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI;
    const width = 0.65;
    const height = 0.44;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = width / 2;

    // Normal vector pointing UP for uniform ambient skylight and sunlight
    const nx = 0;
    const ny = 1;
    const nz = 0;

    // Row 0: Roots (y = 0) - compact cluster at soil level
    const rootW = hw * 0.35;
    positions.push(-rootW * cos, 0, -rootW * sin);
    normals.push(nx, ny, nz);
    colors.push(0.12, 0.24, 0.08); // Earthy root
    uvs.push(0, 0);

    positions.push(rootW * cos, 0, rootW * sin);
    normals.push(nx, ny, nz);
    colors.push(0.12, 0.24, 0.08);
    uvs.push(1, 0);

    // Row 1: Mid-stem (y = height * 0.48) - natural spread
    const midW = hw * 0.78;
    const midY = height * 0.48;
    positions.push(-midW * cos, midY, -midW * sin);
    normals.push(nx, ny, nz);
    colors.push(0.35, 0.60, 0.18); // Fresh meadow green
    uvs.push(0, 0.5);

    positions.push(midW * cos, midY, midW * sin);
    normals.push(nx, ny, nz);
    colors.push(0.35, 0.60, 0.18);
    uvs.push(1, 0.5);

    // Row 2: Tips (y = height) - natural outward flare and lean
    const tipW = hw * 1.15;
    const lean = 0.045;
    const tipX = -sin * lean;
    const tipZ = cos * lean;

    positions.push(-tipW * cos + tipX, height, -tipW * sin + tipZ);
    normals.push(nx, ny, nz);
    colors.push(0.68, 0.88, 0.30); // Bright sunlit tip
    uvs.push(0, 1);

    positions.push(tipW * cos + tipX, height, tipW * sin + tipZ);
    normals.push(nx, ny, nz);
    colors.push(0.68, 0.88, 0.30);
    uvs.push(1, 1);

    // Quad 1: lower half
    indices.push(0, 1, 2);
    indices.push(1, 3, 2);
    // Quad 2: upper half
    indices.push(2, 3, 4);
    indices.push(3, 5, 4);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    bladeGeos.push(geo);
  }

  return BufferGeometryUtils.mergeGeometries(bladeGeos)!;
}

/**
 * Procedural realistic grass blade alpha texture.
 * Generates delicate, curving blades with subtle gradients and highlights.
 */
function createGrassBladeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);

  // 12 varied, organic curved grass blades for full, lush coverage
  const blades = [
    { x: 12, w: 9, h: 195, bend: -18 },
    { x: 32, w: 11, h: 235, bend: -10 },
    { x: 54, w: 10, h: 215, bend: -20 },
    { x: 76, w: 12, h: 248, bend: -4 },
    { x: 100, w: 13, h: 255, bend: 6 },
    { x: 124, w: 12, h: 252, bend: -8 },
    { x: 148, w: 13, h: 255, bend: 8 },
    { x: 172, w: 11, h: 245, bend: 16 },
    { x: 194, w: 10, h: 220, bend: 22 },
    { x: 216, w: 11, h: 238, bend: 10 },
    { x: 234, w: 10, h: 205, bend: 20 },
    { x: 248, w: 8, h: 175, bend: 14 },
  ];

  for (const b of blades) {
    const tipX = b.x + b.bend;
    const tipY = 256 - b.h;
    const baseHW = b.w * 0.5;

    // Organic botanical vertical gradient
    const grad = ctx.createLinearGradient(b.x, 256, tipX, tipY);
    grad.addColorStop(0, "#1a3812");    // Deep earthy root
    grad.addColorStop(0.35, "#38681c"); // Moist stalk
    grad.addColorStop(0.7, "#5ea028");  // Rich vibrant meadow green
    grad.addColorStop(0.92, "#9ed440"); // Sun-kissed golden green tip
    grad.addColorStop(1, "#c2e862");    // Bright feather tip highlight

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(b.x - baseHW, 256);
    const midY = 256 - b.h * 0.55;
    const midLeftX = b.x - baseHW * 0.7 + b.bend * 0.45;
    ctx.quadraticCurveTo(midLeftX, midY, tipX, tipY);
    const midRightX = b.x + baseHW * 0.7 + b.bend * 0.45;
    ctx.quadraticCurveTo(midRightX, midY, b.x + baseHW, 256);
    ctx.closePath();
    ctx.fill();

    // Subtle natural center rib highlight
    ctx.strokeStyle = "rgba(200, 245, 120, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(b.x, 252);
    ctx.quadraticCurveTo(b.x + b.bend * 0.45, midY, tipX, tipY + 4);
    ctx.stroke();
  }

  // Add subtle seed / wild stalk heads to 3 central taller blades
  const seedIndices = [4, 5, 6];
  for (const idx of seedIndices) {
    const sb = blades[idx];
    const tipX = sb.x + sb.bend;
    const tipY = 256 - sb.h;
    ctx.fillStyle = "rgba(242, 228, 155, 0.9)";
    ctx.beginPath();
    ctx.ellipse(tipX, tipY + 2, 2.4, 4.5, (sb.bend * Math.PI) / 180, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Realistic small woodland mushroom geometry.
 * Proportionate (8-12cm tall), sitting nestled naturally in the grass.
 */
function createWildflowerGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.11, 6);
  stem.translate(0, 0.055, 0);

  const cap = new THREE.SphereGeometry(0.048, 8, 6);
  cap.scale(1.15, 0.55, 1.15);
  cap.translate(0, 0.11, 0);

  return BufferGeometryUtils.mergeGeometries([stem, cap])!;
}

/**
 * Procedural Bark Texture.
 */
function createBarkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3c2517";
  ctx.fillRect(0, 0, 256, 512);

  for (let i = 0; i < 480; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 512;
    const w = 1.2 + Math.random() * 3.0;
    const h = 20 + Math.random() * 85;
    const shade = (Math.random() - 0.5) * 45;
    const r = Math.max(22, Math.min(88, 58 + shade));
    const g = Math.max(14, Math.min(60, 38 + shade * 0.7));
    const b = Math.max(8, Math.min(38, 24 + shade * 0.5));
    ctx.fillStyle = `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
    ctx.fillRect(x, y, w, h);
  }

  const mossGrad = ctx.createLinearGradient(0, 512, 0, 410);
  mossGrad.addColorStop(0, "rgba(48, 70, 28, 0.5)");
  mossGrad.addColorStop(1, "rgba(48, 70, 28, 0.0)");
  ctx.fillStyle = mossGrad;
  ctx.fillRect(0, 410, 256, 102);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 8);
  return tex;
}

/**
 * Procedural Needle Texture.
 */
function createNeedleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1e4226";
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const angle = (Math.random() - 0.5) * 0.9;
    const len = 5 + Math.random() * 9;
    const colVal = 44 + Math.random() * 56;
    ctx.strokeStyle = `rgb(${Math.floor(colVal * 0.62)}, ${Math.floor(colVal * 1.32)}, ${Math.floor(colVal * 0.68)})`;
    ctx.lineWidth = 1 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/**
 * Towering pine tree foliage geometry.
 */
function createRealisticPineFoliage(
  tiers = 12,
  baseRadius = 6.8,
  totalHeight = 32,
  startHeight = 5.2
): THREE.BufferGeometry {
  const tierGeos: THREE.BufferGeometry[] = [];

  for (let t = 0; t < tiers; t++) {
    const frac = t / (tiers - 1);
    const tierBaseY = startHeight + frac * (totalHeight - startHeight - 2.8);
    const tierHeight = 4.2 * Math.pow(1.0 - frac * 0.46, 0.85);
    const tierRadius = baseRadius * Math.pow(1.0 - frac * 0.84, 0.95);
    const lobes = 10 + (t % 3) * 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const apexIdx = 0;
    positions.push(0, tierBaseY + tierHeight, 0);
    normals.push(0, 1, 0);
    colors.push(0.24 + frac * 0.08, 0.48 + frac * 0.08, 0.24 + frac * 0.05);
    uvs.push(0.5, 1);

    const bottomCenterIdx = 1;
    positions.push(0, tierBaseY + tierHeight * 0.16, 0);
    normals.push(0, -1, 0);
    colors.push(0.07, 0.14, 0.08);
    uvs.push(0.5, 0);

    const numPoints = lobes * 2;
    const ringStartIdx = 2;

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2 + t * 0.65;
      const isTip = i % 2 === 0;
      const r = isTip ? tierRadius * 1.18 : tierRadius * 0.72;
      const droop = isTip ? 0.85 * (1.0 - frac * 0.38) : 0.28;
      const px = Math.cos(angle) * r;
      const pz = Math.sin(angle) * r;
      const py = tierBaseY - droop;

      positions.push(px, py, pz);

      const nx = (px / r) * 0.85;
      const nz = (pz / r) * 0.85;
      const ny = 0.52;
      const len = Math.hypot(nx, ny, nz);
      normals.push(nx / len, ny / len, nz / len);

      if (isTip) {
        colors.push(0.23 + frac * 0.13, 0.47 + frac * 0.14, 0.23 + frac * 0.09);
      } else {
        colors.push(0.11 + frac * 0.05, 0.24 + frac * 0.06, 0.12 + frac * 0.04);
      }
      uvs.push(Math.cos(angle) * 0.5 + 0.5, Math.sin(angle) * 0.5 + 0.5);
    }

    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      indices.push(apexIdx, ringStartIdx + i, ringStartIdx + next);
      indices.push(bottomCenterIdx, ringStartIdx + next, ringStartIdx + i);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    tierGeos.push(geo);
  }

  return BufferGeometryUtils.mergeGeometries(tierGeos)!;
}

/**
 * Realistic trunk geometry with flared root buttresses.
 */
function createRealisticTrunkGeometry(height = 32, baseRadius = 0.92, topRadius = 0.12): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topRadius, baseRadius, height, 12, 12);
  geo.translate(0, height / 2, 0);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    const z = pos.getZ(i);

    if (y < 4.0) {
      const flare = Math.pow((4.0 - y) / 4.0, 2) * 0.65;
      const angle = Math.atan2(z, x);
      const buttress = Math.cos(angle * 4) * 0.22 + 0.22;
      const r = Math.hypot(x, z);
      if (r > 0.001) {
        const factor = 1 + (flare + buttress * flare) / r;
        pos.setX(i, x * factor);
        pos.setZ(i, z * factor);
      }
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private gltfLoader = new GLTFLoader();
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  private remotes = new Map<string, Character>();
  private player = new Character(this.gltfLoader, 0x1f527a); // Sapphire blue adventurer dress
  private position: Position = { x: 0, y: 0, z: 0 };
  private playerRotation = 0;
  private lastSent = 0;
  private lastNavSend = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.32;
  private draggingCamera = false;
  private lastPointer = { x: 0, y: 0 };
  private sky = new Sky();
  private sun = new THREE.DirectionalLight(0xfff7e6, 3.2);
  private timeOfDay = 11.5; // Always daytime (bright midday sun)

  // Ocean & environment references
  private oceanMesh?: THREE.Mesh;
  private foamMesh?: THREE.Mesh;
  private foamMat?: THREE.MeshBasicMaterial;
  private grassTimeUniform = { value: 0 };
  private colliders: Array<{ x: number; z: number; radius: number }> = [];
  private virtualJoystick = { x: 0, y: 0 };
  private velocityY = 0;
  private isGrounded = true;
  public isRunningMobile = false;
  private isRunToggled = false;

  // Collectibles & OP Token Exchange System
  private bars: CollectibleBar[] = [];
  private exchangeBooths: ExchangeBooth[] = [];
  private currentNearBooth: ExchangeBooth | null = null;
  private audioCtx?: AudioContext;

  // Cached vector references for zero-garbage animation loop
  private camTarget = new THREE.Vector3();
  private desiredCamPos = new THREE.Vector3();

  public getIsRunning(): boolean {
    const isShift = this.keys.has("shift") || this.keys.has("shiftleft") || this.keys.has("shiftright");
    return isShift || this.isRunToggled || this.isRunningMobile;
  }

  public setRunning(running: boolean) {
    this.isRunningMobile = running;
    this.isRunToggled = running;
  }

  public toggleRunning(): boolean {
    this.isRunToggled = !this.isRunToggled;
    this.isRunningMobile = this.isRunToggled;
    return this.isRunToggled;
  }

  constructor(
    private container: HTMLElement,
    private onMove: (position: Position) => void,
    private onNavUpdate?: (nav: NavState) => void,
    private onCollectBar?: (type: BarType) => void,
    private onNearExchange?: (booth: ExchangeBooth | null) => void
  ) {
    // Native pixel ratio for crystal-clear sharpness — cap at 3 to exclude absurd 4K phones
    // Fog drawn closer on mobile to offset the extra fillrate cost of high DPR
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 3.0 : 2.0));
    this.renderer.shadowMap.enabled = !isMobile; // shadows OFF on mobile — biggest perf gain
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // cheapest if enabled on desktop
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.LinearToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    container.appendChild(this.renderer.domElement);

    // Fog: shorter draw distance on mobile offsets cost of native DPR fillrate
    this.scene.fog = new THREE.Fog("#cce6f4", 80, isMobile ? 260 : 480);

    this.sky.scale.setScalar(450000);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms["turbidity"].value = 1.8;
    skyUniforms["rayleigh"].value = 0.8;
    skyUniforms["mieCoefficient"].value = 0.002;
    skyUniforms["mieDirectionalG"].value = 0.85;
    this.scene.add(this.sky);

    // Bright natural skylight — boosted for mobile screen brightness
    this.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x5a7a35, 2.2));

    // Crisp directional sun shadow map (1024x1024 for peak FPS)
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512); // reduced from 1024 — halves shadow map memory
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);

    this.updateSun();

    // 1. Realistic Terrain with Rolling Inland Hills and West Coast Sandy Beach
    const { map, bumpMap, roughnessMap } = createGroundTextures();
    const groundGeo = new THREE.PlaneGeometry(500, 500, 160, 160);
    groundGeo.rotateX(-Math.PI / 2);

    const pos = groundGeo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);

    const grassCol = new THREE.Color(0x4a7333);
    const goldenSandCol = new THREE.Color(0xf6dc9d); // radiant sunlit golden beach sand
    const duneSandCol = new THREE.Color(0xe7c88a);   // upper coastal sand dunes
    const wetSandCol = new THREE.Color(0xbba06c);    // wet tide line sand
    const seaBedCol = new THREE.Color(0x354032);     // deep ocean floor

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      let c = grassCol;
      if (x < -84) {
        c = seaBedCol; // underwater seabed
      } else if (x < -78) {
        const frac = (-78 - x) / 6;
        c = wetSandCol.clone().lerp(seaBedCol, frac * 0.7); // wet shoreline sand
      } else if (x < -28) {
        // Expansive pure golden beach sand! (over 50 meters wide)
        const duneT = (-28 - x) / 50;
        c = duneSandCol.clone().lerp(goldenSandCol, Math.sin(duneT * Math.PI));
      } else if (x < -18) {
        // Smooth transition from grass into sand dunes
        const frac = (-18 - x) / 10;
        c = grassCol.clone().lerp(duneSandCol, frac);
      } else if (isRoadOrCity(x, z)) {
        c = new THREE.Color(0x6e685f); // weathered stone earth base under road and city
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    groundGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      map,
      vertexColors: true,
      bumpMap,
      bumpScale: 0.08,
      roughnessMap,
      roughness: 0.88,
      metalness: 0.06,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Initial player placement on terrain
    this.position.y = getTerrainHeight(this.position.x, this.position.z);
    this.player.setPosition(this.position.x, this.position.y, this.position.z);
    this.scene.add(this.player.group);

    // 2. Add West Side Sea Shore & Animated Ocean Water
    this.addWestOcean();

    // 2b. Add Expansive Golden Beach Sand Dunes
    this.addBeachSand();

    // 3. Add Towering Realistic Pine Forest (Inland)
    this.addTrees();

    // 4. Add Volumetric 3D Grass Tufts Across the Landscape
    this.addGrassTufts();

    // 5. Add Wild Meadow Flowers
    this.addWildflowers();

    // 6. Add Natural Boulders & Beach Rocks
    this.addRocksAndBushes();

    // 7. Add Highland Road East of Alpine Grove
    this.addRoad();

    // 8. Add Pinehaven Small City
    this.addCity();

    // 9. Add Collectible Gold, Silver, and Bronze Bars across the island
    this.addCollectibleBars();

    // 10. Add OP Token Exchange Merchant Booths in key locations
    this.addExchangeBooths();

    // Sky clouds
    for (let i = 0; i < 32; i++) {
      this.addCloud((Math.random() - 0.5) * 450, 45 + Math.random() * 22, (Math.random() - 0.5) * 450);
    }

    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);

    this.resize();
    this.animate();
  }

  private updateSun() {
    // Constant glorious daytime sun (11:30 AM high sun angle)
    const timeAngle = ((this.timeOfDay - 6) / 12) * Math.PI;
    const phi = Math.PI / 2 - Math.sin(timeAngle) * (Math.PI / 2.2);
    const theta = Math.cos(timeAngle) * (Math.PI / 2.3);
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(300, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(sunPosition);
    this.sun.position.copy(sunPosition);
    this.sun.intensity = 4.5;
  }

  public loadModel(path: string, position: Position, scale = 1) {
    this.gltfLoader.load(path, (gltf) => {
      const model = gltf.scene;
      model.position.set(position.x, position.y, position.z);
      model.scale.setScalar(scale);
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.scene.add(model);
    });
  }

  /**
   * Generates the ocean on the West side (x < -82) with animated swells and beach foam.
   */
  private addWestOcean() {
    // Ocean Water Plane (Width: 260 units, Length: 600 units, Sea Level: y = 0.0)
    const oceanGeo = new THREE.PlaneGeometry(260, 600, 16, 16);
    oceanGeo.rotateX(-Math.PI / 2);
    oceanGeo.translate(-212, 0, 0); // spans x = -82 to x = -342

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x1b748e, // vibrant turquoise / ocean blue
      roughness: 0.08,
      metalness: 0.16,
      transparent: true,
      opacity: 0.82,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);

    // Shoreline surf & foam strip along x = -82
    const foamGeo = new THREE.PlaneGeometry(6, 600, 2, 24);
    foamGeo.rotateX(-Math.PI / 2);
    foamGeo.translate(-82.0, 0.06, 0);

    this.foamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });
    this.foamMesh = new THREE.Mesh(foamGeo, this.foamMat);
    this.scene.add(this.foamMesh);
  }

  /**
   * Adds a dedicated 3D sandy beach overlay mesh along the West Coast (x = -84 to x = -26).
   * Spans the entire length of the island with warm golden sand ripples and zero grass textures.
   */
  private addBeachSand() {
    const xMin = -84;
    const xMax = -26; // 58 meters wide pristine sandy beach!
    const zMin = -245;
    const zMax = 245;
    const xSteps = 32;
    const zSteps = 80;

    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const drySand = new THREE.Color(0xf6dc9d);
    const wetSand = new THREE.Color(0xbfa36e);
    const duneSand = new THREE.Color(0xe7c88a);

    for (let iz = 0; iz <= zSteps; iz++) {
      const fz = iz / zSteps;
      const z = THREE.MathUtils.lerp(zMin, zMax, fz);
      for (let ix = 0; ix <= xSteps; ix++) {
        const fx = ix / xSteps;
        const x = THREE.MathUtils.lerp(xMin, xMax, fx);
        const y = getTerrainHeight(x, z) + 0.038;
        positions.push(x, y, z);
        uvs.push(fx * 6, fz * 32);

        // Color gradient from wet shoreline sand to warm dry dune sand
        let col = drySand;
        if (x < -78) {
          const t = (-78 - x) / 6;
          col = drySand.clone().lerp(wetSand, t * 0.85);
        } else if (x > -35) {
          const t = (x - (-35)) / 9;
          col = drySand.clone().lerp(duneSand, t);
        }
        colors.push(col.r, col.g, col.b);
      }
    }

    for (let iz = 0; iz < zSteps; iz++) {
      for (let ix = 0; ix < xSteps; ix++) {
        const a = iz * (xSteps + 1) + ix;
        const b = (iz + 1) * (xSteps + 1) + ix;
        const c = (iz + 1) * (xSteps + 1) + (ix + 1);
        const d = iz * (xSteps + 1) + (ix + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const sandGeo = new THREE.BufferGeometry();
    sandGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    sandGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    sandGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    sandGeo.setIndex(indices);
    sandGeo.computeVertexNormals();

    const { map: sandMap, bumpMap: sandBump, roughnessMap: sandRough } = createSandTexture();
    const sandMat = new THREE.MeshStandardMaterial({
      map: sandMap,
      vertexColors: true,
      bumpMap: sandBump,
      bumpScale: 0.065,
      roughnessMap: sandRough,
      roughness: 0.88,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const sandMesh = new THREE.Mesh(sandGeo, sandMat);
    sandMesh.receiveShadow = true;
    this.scene.add(sandMesh);
  }

  /**
   * Generates a realistic, towering conifer forest seated accurately on inland terrain elevation.
   * Keeps the West beach (x < -50) clear for ocean views.
   */
  private addTrees() {
    const barkTex = createBarkTexture();
    const needleTex = createNeedleTexture();

    const trunkMat = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.9,
      metalness: 0.05,
    });

    const leavesMat = new THREE.MeshStandardMaterial({
      map: needleTex,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    // Variety 1: Towering Mountain Pines (height ~32)
    const treeCount1 = 360;
    const trunkGeo1 = createRealisticTrunkGeometry(32, 0.92, 0.12);
    const leavesGeo1 = createRealisticPineFoliage(12, 6.8, 32, 5.2);

    const trunkMesh1 = new THREE.InstancedMesh(trunkGeo1, trunkMat, treeCount1);
    trunkMesh1.castShadow = true;
    trunkMesh1.receiveShadow = true;

    const leavesMesh1 = new THREE.InstancedMesh(leavesGeo1, leavesMat, treeCount1);
    leavesMesh1.castShadow = true;
    leavesMesh1.receiveShadow = true;

    // Variety 2: Lush Forest Spruces (height ~26)
    const treeCount2 = 290;
    const trunkGeo2 = createRealisticTrunkGeometry(26, 0.88, 0.14);
    const leavesGeo2 = createRealisticPineFoliage(10, 7.2, 26, 4.2);

    const trunkMesh2 = new THREE.InstancedMesh(trunkGeo2, trunkMat, treeCount2);
    trunkMesh2.castShadow = true;
    trunkMesh2.receiveShadow = true;

    const leavesMesh2 = new THREE.InstancedMesh(leavesGeo2, leavesMat, treeCount2);
    leavesMesh2.castShadow = true;
    leavesMesh2.receiveShadow = true;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < treeCount1; i++) {
      let x: number, z: number;
      if (i < 24) {
        const angle = (i / 24) * Math.PI * 2;
        const dist = 26 + Math.random() * 12;
        x = Math.cos(angle) * dist;
        z = Math.sin(angle) * dist;
      } else {
        x = (Math.random() - 0.5) * 450;
        z = (Math.random() - 0.5) * 450;
        // Keep clear spawn glade AND clear wide West beach (x < -22)
        if (Math.hypot(x, z) < 22 || x < -22) {
          dummy.position.set(0, -999, 0);
          dummy.updateMatrix();
          trunkMesh1.setMatrixAt(i, dummy.matrix);
          leavesMesh1.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      // Check beach boundary and road / city boundaries
      if (x < -22 || isRoadOrCity(x, z)) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        trunkMesh1.setMatrixAt(i, dummy.matrix);
        leavesMesh1.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      const scaleY = 0.92 + Math.random() * 0.46;
      const scaleXZ = scaleY * (0.88 + Math.random() * 0.24);

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.04,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.04
      );
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();

      trunkMesh1.setMatrixAt(i, dummy.matrix);
      leavesMesh1.setMatrixAt(i, dummy.matrix);
      this.colliders.push({ x, z, radius: 0.95 * scaleXZ });
    }

    for (let i = 0; i < treeCount2; i++) {
      let x: number, z: number;
      if (i < 18) {
        const angle = ((i + 0.5) / 18) * Math.PI * 2;
        const dist = 32 + Math.random() * 14;
        x = Math.cos(angle) * dist;
        z = Math.sin(angle) * dist;
      } else {
        x = (Math.random() - 0.5) * 450;
        z = (Math.random() - 0.5) * 450;
        if (Math.hypot(x, z) < 22 || x < -22 || isRoadOrCity(x, z)) {
          dummy.position.set(0, -999, 0);
          dummy.updateMatrix();
          trunkMesh2.setMatrixAt(i, dummy.matrix);
          leavesMesh2.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      if (x < -22 || isRoadOrCity(x, z)) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        trunkMesh2.setMatrixAt(i, dummy.matrix);
        leavesMesh2.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      const scaleY = 0.9 + Math.random() * 0.42;
      const scaleXZ = scaleY * (0.9 + Math.random() * 0.22);

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.05,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.05
      );
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();

      trunkMesh2.setMatrixAt(i, dummy.matrix);
      leavesMesh2.setMatrixAt(i, dummy.matrix);
      this.colliders.push({ x, z, radius: 0.9 * scaleXZ });
    }

    this.scene.add(trunkMesh1);
    this.scene.add(leavesMesh1);
    this.scene.add(trunkMesh2);
    this.scene.add(leavesMesh2);
  }

  /**
   * Adds volumetric, natural 3D grass tufts (inland only, keeping sand dunes clean).
   */
  private addGrassTufts() {
    const tuftCount = 14000;
    const tuftGeo = createGrassTuftGeometry();
    const bladeTex = createGrassBladeTexture();

    const tuftMat = new THREE.MeshStandardMaterial({
      map: bladeTex,
      vertexColors: true,
      alphaTest: 0.24,
      roughness: 0.55,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    // Vertex shader breeze animation
    tuftMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGrassTime = this.grassTimeUniform;
      shader.vertexShader = `
        uniform float uGrassTime;
        ${shader.vertexShader}
      `;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        // Gentle organic wind breeze swaying only upper portion of blades
        float breeze = sin(uGrassTime * 2.2 + position.x * 2.4 + position.z * 1.8) * 0.038 * (uv.y * uv.y);
        float gust = cos(uGrassTime * 1.4 + position.x * 1.2 + position.z * 2.8) * 0.02 * (uv.y * uv.y);
        transformed.x += breeze + gust;
        transformed.z += breeze * 0.6;
        `
      );
    };

    const grassMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
    // Tree and player shadows fall across the grass
    grassMesh.receiveShadow = true;
    // Grass does not cast shadows on itself to prevent harsh pitch-black shadow artifacts
    grassMesh.castShadow = false;

    // Organic color palette for natural instance variation
    const palette = [
      new THREE.Color(0x82b845), // Lush meadow green
      new THREE.Color(0x98c74e), // Fresh spring green
      new THREE.Color(0x6ca335), // Deep rich forest green
      new THREE.Color(0x8fae48), // Warm meadow fescue
      new THREE.Color(0xa5be52), // Golden sunlit glade
    ];
    const instCol = new THREE.Color();

    const dummy = new THREE.Object3D();
    for (let i = 0; i < tuftCount; i++) {
      let x = (Math.random() - 0.5) * 380;
      let z = (Math.random() - 0.5) * 380;

      // Heavy lush density in the starter glade around spawn
      if (i < 7500) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 55;
        x = Math.cos(angle) * dist;
        z = Math.sin(angle) * dist;
      }

      // Keep grass inland (off the wide sandy beach) and off road/city
      if (x < -24 || isRoadOrCity(x, z)) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      // Knee/shin height scale: natural, lush, clearly visible
      const scale = 0.85 + Math.random() * 0.38;

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.12,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.12
      );
      dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.25), scale);
      dummy.updateMatrix();

      grassMesh.setMatrixAt(i, dummy.matrix);

      // Subtle instance color variance
      const base = palette[Math.floor(Math.random() * palette.length)];
      const hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl);
      instCol.setHSL(
        hsl.h + (Math.random() - 0.5) * 0.03,
        hsl.s + (Math.random() - 0.5) * 0.08,
        hsl.l + (Math.random() - 0.5) * 0.06
      );
      grassMesh.setColorAt(i, instCol);
    }

    if (grassMesh.instanceColor) {
      grassMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(grassMesh);
  }

  /**
   * Adds sparse, realistic woodland mushrooms near forest trees (not dominating the open field).
   */
  private addWildflowers() {
    const mushroomCount = 45;
    const mushroomGeo = createWildflowerGeometry();

    const mushroomColors = [
      new THREE.Color(0xd9b37a), // Warm tan chanterelle
      new THREE.Color(0xb8503b), // Forest russet
      new THREE.Color(0x8a6245), // Earthy woodland brown
      new THREE.Color(0xe6d4b8), // Soft cream cap
    ];

    const mushroomMat = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.05,
    });

    const mushroomMesh = new THREE.InstancedMesh(mushroomGeo, mushroomMat, mushroomCount);
    mushroomMesh.receiveShadow = true;
    mushroomMesh.castShadow = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < mushroomCount; i++) {
      // Scatter sparsely in forest zones, away from immediate spawn center
      const angle = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * 95;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      if (x < -24 || isRoadOrCity(x, z)) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        mushroomMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      // Realistic small mushroom scale: 6cm to 10cm tall
      const scale = 0.55 + Math.random() * 0.35;

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.18,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.18
      );
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      mushroomMesh.setMatrixAt(i, dummy.matrix);
      mushroomMesh.setColorAt(i, mushroomColors[i % mushroomColors.length]);
    }

    if (mushroomMesh.instanceColor) {
      mushroomMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(mushroomMesh);
  }

  /**
   * Adds boulders, beach rocks, and inland bushes.
   */
  private addRocksAndBushes() {
    const rockMat = new THREE.MeshStandardMaterial({ color: "#7a8284", roughness: 0.9 });
    const beachRockMat = new THREE.MeshStandardMaterial({ color: "#8a7e6b", roughness: 0.75 }); // coastal smoothed rocks

    for (let i = 0; i < 240; i++) {
      const x = (Math.random() - 0.5) * 450;
      const z = (Math.random() - 0.5) * 450;
      if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
      if (isRoadOrCity(x, z)) continue;

      const isBeach = x < -24;
      const isWater = x < -82;

      if (Math.random() > 0.4) {
        // Rocks
        const rockRadius = Math.random() * 0.9 + 0.4;
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(rockRadius),
          isBeach ? beachRockMat : rockMat
        );
        const groundY = getTerrainHeight(x, z);
        rock.position.set(x, groundY + (isWater ? 0.05 : 0.18), z);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
        this.colliders.push({ x, z, radius: rockRadius * 0.85 });
      } else if (!isBeach) {
        // Inland bushes only
        const bush = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({ color: "#37733a", roughness: 0.85 });
        for (let j = 0; j < 4; j++) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(Math.random() * 0.5 + 0.5, 8, 8), material);
          leaf.position.set(
            (Math.random() - 0.5) * 0.8,
            Math.random() * 0.5 + 0.2,
            (Math.random() - 0.5) * 0.8
          );
          leaf.castShadow = true;
          leaf.receiveShadow = true;
          bush.add(leaf);
        }
        const groundY = getTerrainHeight(x, z);
        bush.position.set(x, groundY, z);
        this.scene.add(bush);
        this.colliders.push({ x, z, radius: 0.75 });
      }
    }
  }

  /**
   * Registers a grid of solid circle colliders covering a rectangular building footprint.
   * Completely blocks the player from entering or passing through the walls.
   */
  private addBoxCollider(cx: number, cz: number, width: number, depth: number) {
    const radius = 0.95;
    const step = 1.35;
    const halfW = width / 2;
    const halfD = depth / 2;
    for (let ox = -halfW + 0.6; ox <= halfW - 0.6 + 0.01; ox += step) {
      for (let oz = -halfD + 0.6; oz <= halfD - 0.6 + 0.01; oz += step) {
        this.colliders.push({ x: cx + ox, z: cz + oz, radius });
      }
    }
  }

  /**
   * Adds the Highland Road running parallel to the beach on the east side of Alpine Grove.
   * Features paved cobblestone ribbon, stone curbstones, wooden lantern posts, and junction signpost.
   */
  private addRoad() {
    const zMin = -120;
    const zMax = 38;
    const roadW = 4.8;
    const halfW = roadW / 2;
    const zSteps = 70;
    const xSteps = 4;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= zSteps; iz++) {
      const fz = iz / zSteps;
      const z = THREE.MathUtils.lerp(zMin, zMax, fz);
      for (let ix = 0; ix <= xSteps; ix++) {
        const fx = ix / xSteps;
        const x = 92 - halfW + fx * roadW;
        const y = getTerrainHeight(x, z) + 0.045;
        positions.push(x, y, z);
        uvs.push(fx * 4, fz * 28);
      }
    }

    for (let iz = 0; iz < zSteps; iz++) {
      for (let ix = 0; ix < xSteps; ix++) {
        const a = iz * (xSteps + 1) + ix;
        const b = (iz + 1) * (xSteps + 1) + ix;
        const c = (iz + 1) * (xSteps + 1) + (ix + 1);
        const d = iz * (xSteps + 1) + (ix + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();

    const { map: cobbleMap, bumpMap: cobbleBump, roughnessMap: cobbleRough } = createCobblestoneTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: cobbleMap,
      bumpMap: cobbleBump,
      bumpScale: 0.07,
      roughnessMap: cobbleRough,
      roughness: 0.85,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    // Stone curbstones along both edges of the road (InstancedMesh for peak 60FPS performance)
    const curbGeo = new THREE.BoxGeometry(0.24, 0.16, 2.8);
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x6e6b66, roughness: 0.9 });
    const curbCount = (Math.floor((37 - (-118.5)) / 2.9) + 1) * 2;
    const curbMesh = new THREE.InstancedMesh(curbGeo, curbMat, curbCount + 4);
    curbMesh.receiveShadow = true;
    const dummyCurb = new THREE.Object3D();
    let curbIdx = 0;
    for (let z = -118.5; z <= 37; z += 2.9) {
      for (const side of [-1, 1]) {
        const cx = 92 + side * (halfW + 0.1);
        const cy = getTerrainHeight(cx, z) + 0.08;
        dummyCurb.position.set(cx, cy, z);
        dummyCurb.updateMatrix();
        curbMesh.setMatrixAt(curbIdx++, dummyCurb.matrix);
      }
    }
    curbMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(curbMesh);

    // Wooden lantern posts spaced along the road
    const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8);
    const beamGeo = new THREE.BoxGeometry(0.12, 0.12, 0.85);
    const lanternGlassGeo = new THREE.BoxGeometry(0.26, 0.35, 0.26);
    const lanternRoofGeo = new THREE.ConeGeometry(0.24, 0.2, 4);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.5, metalness: 0.7 });
    const lanternGlassMat = new THREE.MeshStandardMaterial({
      color: 0xffd54f,
      emissive: 0xff9900,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    });

    const lanternZCoords = [-108, -88, -68, -48, -28, -8, 12, 30];
    lanternZCoords.forEach((lz, idx) => {
      const isLeft = idx % 2 === 0;
      const lx = isLeft ? 88.8 : 95.2;
      const ly = getTerrainHeight(lx, lz);

      const postGroup = new THREE.Group();
      postGroup.position.set(lx, ly, lz);

      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.y = 1.7;
      post.castShadow = true;
      post.receiveShadow = true;
      postGroup.add(post);

      const beam = new THREE.Mesh(beamGeo, woodMat);
      beam.position.set(isLeft ? 0.35 : -0.35, 3.25, 0);
      beam.castShadow = true;
      postGroup.add(beam);

      const glass = new THREE.Mesh(lanternGlassGeo, lanternGlassMat);
      glass.position.set(isLeft ? 0.65 : -0.65, 2.85, 0);
      postGroup.add(glass);

      const roof = new THREE.Mesh(lanternRoofGeo, ironMat);
      roof.position.set(isLeft ? 0.65 : -0.65, 3.12, 0);
      roof.rotation.y = Math.PI / 4;
      postGroup.add(roof);

      this.scene.add(postGroup);
      this.colliders.push({ x: lx, z: lz, radius: 0.4 });
    });

    // Waypoint signpost at junction near Alpine Grove (Z ≈ -50)
    const signpostGroup = new THREE.Group();
    const spX = 88.6;
    const spZ = -50;
    const spY = getTerrainHeight(spX, spZ);
    signpostGroup.position.set(spX, spY, spZ);

    const sPost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.5, 8), woodMat);
    sPost.position.y = 1.25;
    sPost.castShadow = true;
    signpostGroup.add(sPost);

    const alpineSignTex = createSignTexture("← ALPINE GROVE", "#2d1e12", "#e8d8bd");
    const signBoardGeo1 = new THREE.BoxGeometry(0.06, 0.3, 1.3);
    const signMat1 = new THREE.MeshStandardMaterial({ map: alpineSignTex, roughness: 0.8 });
    const board1 = new THREE.Mesh(signBoardGeo1, signMat1);
    board1.position.set(-0.35, 2.1, 0);
    signpostGroup.add(board1);

    const citySignTex = createSignTexture("↓ PINEHAVEN CITY", "#2d1e12", "#ffd700");
    const signBoardGeo2 = new THREE.BoxGeometry(1.3, 0.3, 0.06);
    const signMat2 = new THREE.MeshStandardMaterial({ map: citySignTex, roughness: 0.8 });
    const board2 = new THREE.Mesh(signBoardGeo2, signMat2);
    board2.position.set(0, 1.65, 0.35);
    signpostGroup.add(board2);

    this.scene.add(signpostGroup);
    this.colliders.push({ x: spX, z: spZ, radius: 0.5 });
  }

  /**
   * Helper to construct a medieval timber-frame building with stone base, plaster walls,
   * wooden beams, windows, pitched roof, chimney, doors, and solid obstacle colliders.
   */
  private createTimberBuilding(options: {
    cx: number;
    cz: number;
    width: number;
    depth: number;
    stories: 1 | 2;
    roofColor?: number;
    roofPitch?: number;
    chimneySide?: "west" | "east" | "north" | "south" | "none";
    doorSide?: "north" | "south" | "east" | "west";
    porch?: { side: "north" | "south" | "east" | "west"; width: number; depth: number };
    awning?: { side: "north" | "south" | "east" | "west"; color: number; width: number };
    signText?: string;
  }): THREE.Group {
    const {
      cx,
      cz,
      width,
      depth,
      stories,
      roofColor = 0x2e3640,
      roofPitch = 2.4,
      chimneySide = "west",
      doorSide = "south",
      porch,
      awning,
      signText,
    } = options;

    const group = new THREE.Group();
    const cityGroundY = 3.6;
    group.position.set(cx, cityGroundY, cz);

    const stoneBaseMat = new THREE.MeshStandardMaterial({ color: 0x6e6b66, roughness: 0.9 });
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xe5e1d7, roughness: 0.94 });
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.72 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x462d1a, roughness: 0.8 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xffdf7a,
      emissive: 0xff9900,
      emissiveIntensity: 0.65,
      roughness: 0.3,
    });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });

    // 1. Stone foundation base
    const baseHeight = 0.55;
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.15, baseHeight, depth + 0.15), stoneBaseMat);
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Ground Floor walls
    const floor1H = 2.8;
    const floor1Mesh = new THREE.Mesh(new THREE.BoxGeometry(width, floor1H, depth), plasterMat);
    floor1Mesh.position.y = baseHeight + floor1H / 2;
    floor1Mesh.castShadow = true;
    floor1Mesh.receiveShadow = true;
    group.add(floor1Mesh);

    // Corner vertical timber posts (4 corners)
    const postGeo = new THREE.BoxGeometry(0.2, floor1H, 0.2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, timberMat);
        post.position.set(sx * (width / 2 - 0.08), baseHeight + floor1H / 2, sz * (depth / 2 - 0.08));
        post.castShadow = true;
        group.add(post);
      }
    }

    // Mid-wall horizontal timber plate
    const plateZGeo = new THREE.BoxGeometry(width + 0.04, 0.12, 0.12);
    for (const sz of [-1, 1]) {
      const plate = new THREE.Mesh(plateZGeo, timberMat);
      plate.position.set(0, baseHeight + floor1H * 0.55, sz * (depth / 2 + 0.01));
      group.add(plate);
    }

    let topY = baseHeight + floor1H;

    // 3. Second Floor (if 2 stories) with overhanging jetty
    if (stories === 2) {
      const jettyH = 0.22;
      const jettyMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.45, jettyH, depth + 0.45), timberMat);
      jettyMesh.position.y = topY + jettyH / 2;
      jettyMesh.castShadow = true;
      group.add(jettyMesh);

      const floor2H = 2.6;
      const floor2Mesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.35, floor2H, depth + 0.35), plasterMat);
      floor2Mesh.position.y = topY + jettyH + floor2H / 2;
      floor2Mesh.castShadow = true;
      floor2Mesh.receiveShadow = true;
      group.add(floor2Mesh);

      // Upper corner posts
      const upperPostGeo = new THREE.BoxGeometry(0.2, floor2H, 0.2);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const post = new THREE.Mesh(upperPostGeo, timberMat);
          post.position.set(sx * ((width + 0.35) / 2 - 0.08), topY + jettyH + floor2H / 2, sz * ((depth + 0.35) / 2 - 0.08));
          post.castShadow = true;
          group.add(post);
        }
      }

      topY += jettyH + floor2H;
    }

    // 4. Pitched Gable Roof
    const roofOverhangW = (stories === 2 ? width + 0.35 : width) + 0.7;
    const roofOverhangD = (stories === 2 ? depth + 0.35 : depth) + 0.7;
    const roofGeo = new THREE.ConeGeometry(roofOverhangW * 0.75, roofPitch, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.0, 1.0, roofOverhangD / roofOverhangW);

    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.y = topY + roofPitch / 2;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    group.add(roofMesh);

    // 5. Chimney
    if (chimneySide !== "none") {
      const chimH = topY + roofPitch * 0.85;
      const chimMesh = new THREE.Mesh(new THREE.BoxGeometry(0.85, chimH, 0.85), stoneBaseMat);
      let chimX = 0;
      let chimZ = 0;
      if (chimneySide === "west") chimX = -width / 2 + 0.3;
      else if (chimneySide === "east") chimX = width / 2 - 0.3;
      else if (chimneySide === "north") chimZ = -depth / 2 + 0.3;
      else if (chimneySide === "south") chimZ = depth / 2 - 0.3;

      chimMesh.position.set(chimX, chimH / 2, chimZ);
      chimMesh.castShadow = true;
      group.add(chimMesh);

      // Terracotta flue pot on top
      const potMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 8), roofMat);
      potMesh.position.set(chimX, chimH + 0.22, chimZ);
      group.add(potMesh);
    }

    // 6. Front Oak Door
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.08), doorMat);
    const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.4), stoneBaseMat);
    if (doorSide === "south") {
      doorMesh.position.set(0, baseHeight + 1.0, depth / 2 + 0.04);
      stepMesh.position.set(0, 0.08, depth / 2 + 0.2);
    } else if (doorSide === "north") {
      doorMesh.position.set(0, baseHeight + 1.0, -depth / 2 - 0.04);
      stepMesh.position.set(0, 0.08, -depth / 2 - 0.2);
    } else if (doorSide === "east") {
      doorMesh.rotation.y = Math.PI / 2;
      doorMesh.position.set(width / 2 + 0.04, baseHeight + 1.0, 0);
      stepMesh.position.set(width / 2 + 0.2, 0.08, 0);
    } else if (doorSide === "west") {
      doorMesh.rotation.y = Math.PI / 2;
      doorMesh.position.set(-width / 2 - 0.04, baseHeight + 1.0, 0);
      stepMesh.position.set(-width / 2 - 0.2, 0.08, 0);
    }
    group.add(doorMesh);
    group.add(stepMesh);

    // 7. Glowing Windows
    const winGeo = new THREE.BoxGeometry(0.8, 1.05, 0.06);
    const winTrimGeo = new THREE.BoxGeometry(0.9, 1.15, 0.04);
    const flowerBoxGeo = new THREE.BoxGeometry(0.9, 0.2, 0.25);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });

    const addWindow = (wx: number, wy: number, wz: number, rotY = 0, withFlowers = false) => {
      const win = new THREE.Mesh(winGeo, windowMat);
      win.position.set(wx, wy, wz);
      win.rotation.y = rotY;
      group.add(win);

      const trim = new THREE.Mesh(winTrimGeo, timberMat);
      trim.position.set(wx, wy, wz);
      trim.rotation.y = rotY;
      group.add(trim);

      if (withFlowers) {
        const box = new THREE.Mesh(flowerBoxGeo, timberMat);
        box.position.set(wx, wy - 0.6, wz + (rotY === 0 ? 0.12 : 0));
        box.rotation.y = rotY;
        group.add(box);

        const blossoms = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.2), flowerMat);
        blossoms.position.set(wx, wy - 0.48, wz + (rotY === 0 ? 0.12 : 0));
        blossoms.rotation.y = rotY;
        group.add(blossoms);
      }
    };

    // Ground floor windows
    if (doorSide === "south") {
      addWindow(-width * 0.28, baseHeight + 1.4, depth / 2 + 0.03);
      addWindow(width * 0.28, baseHeight + 1.4, depth / 2 + 0.03);
      addWindow(0, baseHeight + 1.4, -depth / 2 - 0.03);
    } else if (doorSide === "east") {
      addWindow(width / 2 + 0.03, baseHeight + 1.4, -depth * 0.26, Math.PI / 2);
      addWindow(width / 2 + 0.03, baseHeight + 1.4, depth * 0.26, Math.PI / 2);
      addWindow(-width / 2 - 0.03, baseHeight + 1.4, 0, Math.PI / 2);
    } else if (doorSide === "west") {
      addWindow(-width / 2 - 0.03, baseHeight + 1.4, -depth * 0.26, Math.PI / 2);
      addWindow(-width / 2 - 0.03, baseHeight + 1.4, depth * 0.26, Math.PI / 2);
      addWindow(width / 2 + 0.03, baseHeight + 1.4, 0, Math.PI / 2);
    }

    // Upper floor windows with flower boxes if 2 stories
    if (stories === 2) {
      const upperY = topY - 1.3;
      if (doorSide === "south" || doorSide === "north") {
        addWindow(-width * 0.28, upperY, (depth + 0.35) / 2 + 0.03, 0, true);
        addWindow(width * 0.28, upperY, (depth + 0.35) / 2 + 0.03, 0, true);
      } else {
        addWindow((width + 0.35) / 2 + 0.03, upperY, 0, Math.PI / 2, true);
        addWindow(-(width + 0.35) / 2 - 0.03, upperY, 0, Math.PI / 2, true);
      }
    }

    // 8. Front Porch (if requested)
    if (porch) {
      const pGroup = new THREE.Group();
      const pDeck = new THREE.Mesh(new THREE.BoxGeometry(porch.width, 0.2, porch.depth), timberMat);
      pDeck.position.y = 0.1;
      pGroup.add(pDeck);

      // Support posts
      const pPostGeo = new THREE.BoxGeometry(0.14, 2.5, 0.14);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(pPostGeo, timberMat);
        post.position.set(sx * (porch.width / 2 - 0.12), 1.25, porch.depth / 2 - 0.12);
        pGroup.add(post);
      }

      // Porch roof
      const pRoof = new THREE.Mesh(new THREE.BoxGeometry(porch.width + 0.3, 0.15, porch.depth + 0.3), roofMat);
      pRoof.position.set(0, 2.55, 0);
      pRoof.rotation.x = 0.08;
      pGroup.add(pRoof);

      // Wooden bench on porch
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.4), timberMat);
      bench.position.set(-porch.width * 0.25, 0.35, 0);
      pGroup.add(bench);

      if (porch.side === "east") {
        pGroup.rotation.y = Math.PI / 2;
        pGroup.position.set(width / 2 + porch.depth / 2, 0, 0);
      } else if (porch.side === "south") {
        pGroup.position.set(0, 0, depth / 2 + porch.depth / 2);
      }
      group.add(pGroup);
    }

    // 9. Merchant Awning (if requested)
    if (awning) {
      const aGroup = new THREE.Group();
      const awningW = awning.width;
      const awningD = 2.4;
      const canvasMat = new THREE.MeshStandardMaterial({ color: awning.color, roughness: 0.85, side: THREE.DoubleSide });

      const canopyMesh = new THREE.Mesh(new THREE.PlaneGeometry(awningW, awningD), canvasMat);
      canopyMesh.position.set(0, 2.4, awningD / 2);
      canopyMesh.rotation.x = Math.PI / 2 + 0.3;
      aGroup.add(canopyMesh);

      // Wooden display table under awning
      const tableMesh = new THREE.Mesh(new THREE.BoxGeometry(awningW * 0.85, 0.8, 0.85), timberMat);
      tableMesh.position.set(0, 0.4, awningD * 0.45);
      aGroup.add(tableMesh);

      // Crates of produce on display
      const crateGeo = new THREE.BoxGeometry(0.5, 0.35, 0.5);
      const crateMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
      for (let c = -1; c <= 1; c++) {
        const crate = new THREE.Mesh(crateGeo, crateMat);
        crate.position.set(c * 0.65, 0.98, awningD * 0.45);
        aGroup.add(crate);
      }

      if (awning.side === "west") {
        aGroup.rotation.y = -Math.PI / 2;
        aGroup.position.set(-width / 2, 0, 0);
      } else if (awning.side === "south") {
        aGroup.position.set(0, 0, depth / 2);
      }
      group.add(aGroup);
    }

    // 10. Hanging Sign (if requested)
    if (signText) {
      const signTex = createSignTexture(signText, "#26170d", "#ffd700");
      const signGroup = new THREE.Group();
      const sMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.05), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }));
      sMesh.position.set(0, -0.25, 0);
      signGroup.add(sMesh);

      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.08), ironMat);
      bracket.position.set(0.4, 0, 0);
      signGroup.add(bracket);

      signGroup.position.set(width / 2 + 0.4, baseHeight + 2.4, depth * 0.3);
      group.add(signGroup);
    }

    this.scene.add(group);

    // Register solid building colliders so player cannot walk through walls
    const collWidth = width + (porch ? porch.depth * 0.75 : 0);
    this.addBoxCollider(cx, cz, collWidth, depth);

    return group;
  }

  /**
   * Helper to construct an active marketplace stall with wooden trestle counter,
   * cloth canopy, wares on display, and solid obstacle colliders.
   */
  private createMarketStall(options: {
    cx: number;
    cz: number;
    canopyColor: number;
    wares: "bakery" | "produce" | "potions" | "textiles";
    rotY?: number;
  }) {
    const { cx, cz, canopyColor, wares, rotY = 0 } = options;
    const stall = new THREE.Group();
    const cityGroundY = 3.6;
    stall.position.set(cx, cityGroundY, cz);
    stall.rotation.y = rotY;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a321e, roughness: 0.85 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.8, side: THREE.DoubleSide });

    // Counter table
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 1.2), woodMat);
    table.position.y = 0.425;
    table.castShadow = true;
    table.receiveShadow = true;
    stall.add(table);

    // 4 Corner awning poles
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.3, 6);
    for (const sx of [-1.05, 1.05]) {
      for (const sz of [-0.5, 0.5]) {
        const pole = new THREE.Mesh(poleGeo, woodMat);
        pole.position.set(sx, 1.15, sz);
        stall.add(pole);
      }
    }

    // Slanted cloth canopy
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), canopyMat);
    canopy.position.set(0, 2.35, 0);
    canopy.rotation.x = Math.PI / 2 + 0.15;
    canopy.castShadow = true;
    stall.add(canopy);

    // Wares on counter
    if (wares === "bakery") {
      const breadGeo = new THREE.BoxGeometry(0.35, 0.18, 0.22);
      const breadMat = new THREE.MeshStandardMaterial({ color: 0xd49b4b, roughness: 0.9 });
      for (let i = -2; i <= 2; i++) {
        const bread = new THREE.Mesh(breadGeo, breadMat);
        bread.position.set(i * 0.4, 0.95, (Math.random() - 0.5) * 0.4);
        stall.add(bread);
      }
    } else if (wares === "produce") {
      const appleGeo = new THREE.SphereGeometry(0.09, 6, 6);
      const appleMat1 = new THREE.MeshStandardMaterial({ color: 0xdc2626 });
      const appleMat2 = new THREE.MeshStandardMaterial({ color: 0x84cc16 });
      for (let i = 0; i < 12; i++) {
        const apple = new THREE.Mesh(appleGeo, i % 2 === 0 ? appleMat1 : appleMat2);
        apple.position.set((Math.random() - 0.5) * 1.8, 0.94, (Math.random() - 0.5) * 0.6);
        stall.add(apple);
      }
    } else if (wares === "potions") {
      const flaskGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.28, 6);
      const pColors = [0x22c55e, 0x3b82f6, 0xef4444, 0xa855f7];
      for (let i = -3; i <= 3; i++) {
        const pMat = new THREE.MeshStandardMaterial({
          color: pColors[Math.abs(i) % pColors.length],
          emissive: pColors[Math.abs(i) % pColors.length],
          emissiveIntensity: 0.6,
          roughness: 0.2,
        });
        const flask = new THREE.Mesh(flaskGeo, pMat);
        flask.position.set(i * 0.3, 0.98, 0.1);
        stall.add(flask);
      }
    } else if (wares === "textiles") {
      const boltGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.65, 8);
      boltGeo.rotateZ(Math.PI / 2);
      const bColors = [0x9333ea, 0xd97706, 0x0284c7, 0xe11d48];
      for (let i = 0; i < 4; i++) {
        const bMat = new THREE.MeshStandardMaterial({ color: bColors[i], roughness: 0.75 });
        const bolt = new THREE.Mesh(boltGeo, bMat);
        bolt.position.set((i - 1.5) * 0.45, 0.95, 0);
        stall.add(bolt);
      }
    }

    this.scene.add(stall);
    this.addBoxCollider(cx, cz, 2.5, 1.4);
  }

  /**
   * Adds the picturesque mountain settlement of Pinehaven City at (X = 96, Z = 66).
   * Features City Gate, central cobblestone plaza, Town Hall & clock watchtower,
   * The Whispering Pine Tavern, Blacksmith, Merchant Guild, cottages, central fountain,
   * marketplace stalls, street lanterns, and solid colliders.
   */
  private addCity() {
    const cityGroundY = 3.6;
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6e6b66, roughness: 0.9 });
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.5, metalness: 0.6 });

    // 1. City Entrance Archway / Gate at (X = 92, Z = 36)
    const gateGroup = new THREE.Group();
    gateGroup.position.set(92, cityGroundY, 36);

    // Left and Right Stone Watch-Pillars
    const pillarGeo = new THREE.BoxGeometry(1.6, 5.5, 1.6);
    const pillarCapGeo = new THREE.ConeGeometry(1.3, 1.0, 4);
    pillarCapGeo.rotateY(Math.PI / 4);

    for (const px of [-3.2, 3.2]) {
      const pillar = new THREE.Mesh(pillarGeo, stoneMat);
      pillar.position.set(px, 2.75, 0);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      gateGroup.add(pillar);

      const cap = new THREE.Mesh(pillarCapGeo, stoneMat);
      cap.position.set(px, 6.0, 0);
      gateGroup.add(cap);

      // Emissive Lantern on inner side of pillar
      const lanternMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.4, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffa000, emissiveIntensity: 0.95 })
      );
      lanternMesh.position.set(px > 0 ? px - 0.9 : px + 0.9, 3.8, 0);
      gateGroup.add(lanternMesh);

      this.colliders.push({ x: 92 + px, z: 36, radius: 1.15 });
    }

    // Heavy arched timber lintel beam
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.65, 0.65), timberMat);
    lintel.position.set(0, 4.8, 0);
    lintel.castShadow = true;
    gateGroup.add(lintel);

    // Welcoming city crest shield / sign: "PINEHAVEN"
    const gateSignTex = createSignTexture("PINEHAVEN", "#26160b", "#facc15");
    const gateSign = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.8, 0.08),
      new THREE.MeshStandardMaterial({ map: gateSignTex, roughness: 0.75 })
    );
    gateSign.position.set(0, 5.65, 0);
    gateGroup.add(gateSign);

    // Low perimeter stone retaining walls extending east and west from the gate
    const wallGeo = new THREE.BoxGeometry(12.0, 1.1, 0.6);
    const wallWest = new THREE.Mesh(wallGeo, stoneMat);
    wallWest.position.set(-10.0, 0.55, 0);
    gateGroup.add(wallWest);

    const wallEast = new THREE.Mesh(wallGeo, stoneMat);
    wallEast.position.set(10.0, 0.55, 0);
    gateGroup.add(wallEast);

    this.scene.add(gateGroup);
    this.addBoxCollider(92 - 10, 36, 12, 0.7);
    this.addBoxCollider(92 + 10, 36, 12, 0.7);

    // 2. Central Town Plaza Cobblestone Terrace Paving
    const { map: plazaCobbleMap, bumpMap: plazaCobbleBump, roughnessMap: plazaCobbleRough } = createCobblestoneTexture();
    const plazaPavingGeo = new THREE.CylinderGeometry(18.5, 18.5, 0.08, 16);
    const plazaPavingMat = new THREE.MeshStandardMaterial({
      map: plazaCobbleMap,
      bumpMap: plazaCobbleBump,
      bumpScale: 0.07,
      roughnessMap: plazaCobbleRough,
      roughness: 0.85,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const plazaPaving = new THREE.Mesh(plazaPavingGeo, plazaPavingMat);
    plazaPaving.position.set(96, cityGroundY + 0.04, 66);
    plazaPaving.receiveShadow = true;
    this.scene.add(plazaPaving);

    // Paved connector boulevard from Gate (92, 36) to Plaza (96, 50)
    const aveGeo = new THREE.PlaneGeometry(6.2, 14);
    aveGeo.rotateX(-Math.PI / 2);
    const aveMesh = new THREE.Mesh(aveGeo, plazaPavingMat);
    aveMesh.position.set(93.8, cityGroundY + 0.045, 43);
    aveMesh.rotation.y = 0.15;
    aveMesh.receiveShadow = true;
    this.scene.add(aveMesh);

    // 3. Central Town Fountain at (X = 96, Z = 66)
    const fountainGroup = new THREE.Group();
    fountainGroup.position.set(96, cityGroundY, 66);

    // Outer octagonal stone basin
    const basinGeo = new THREE.CylinderGeometry(2.8, 2.9, 0.85, 8);
    const basinMesh = new THREE.Mesh(basinGeo, stoneMat);
    basinMesh.position.y = 0.425;
    basinMesh.castShadow = true;
    basinMesh.receiveShadow = true;
    fountainGroup.add(basinMesh);

    // Translucent shimmering blue water pool
    const waterGeo = new THREE.CylinderGeometry(2.45, 2.45, 0.08, 16);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.12,
      transparent: true,
      opacity: 0.85,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = 0.65;
    fountainGroup.add(waterMesh);

    // Center carved stone pedestal and upper basin
    const centerPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.2, 8), stoneMat);
    centerPillar.position.y = 1.1;
    fountainGroup.add(centerPillar);

    const upperBasin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.0, 0.4, 8), stoneMat);
    upperBasin.position.y = 2.2;
    fountainGroup.add(upperBasin);

    const upperWater = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.05, 8), waterMat);
    upperWater.position.y = 2.38;
    fountainGroup.add(upperWater);

    const fountainFinial = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), stoneMat);
    fountainFinial.position.y = 2.75;
    fountainGroup.add(fountainFinial);

    this.scene.add(fountainGroup);
    this.colliders.push({ x: 96, z: 66, radius: 2.95 });

    // Wooden benches facing the fountain
    const benchGeo = new THREE.BoxGeometry(2.0, 0.45, 0.5);
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.85 });
    const bench1 = new THREE.Mesh(benchGeo, benchMat);
    bench1.position.set(96, cityGroundY + 0.25, 61.6);
    this.scene.add(bench1);

    const bench2 = new THREE.Mesh(benchGeo, benchMat);
    bench2.position.set(96, cityGroundY + 0.25, 70.4);
    this.scene.add(bench2);

    // 4. Plaza Cast-Iron Ornate Lampposts (4 cardinal corners of the square)
    const lampCoords = [
      { x: 88, z: 54 },
      { x: 104, z: 54 },
      { x: 88, z: 78 },
      { x: 104, z: 78 },
    ];
    lampCoords.forEach((lp) => {
      const lampGroup = new THREE.Group();
      lampGroup.position.set(lp.x, cityGroundY, lp.z);

      const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.6, 8), ironMat);
      lampBase.position.y = 0.3;
      lampGroup.add(lampBase);

      const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), ironMat);
      lampPole.position.y = 1.9;
      lampPole.castShadow = true;
      lampGroup.add(lampPole);

      const lampHousing = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.5, 0.38),
        new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffa000, emissiveIntensity: 0.95 })
      );
      lampHousing.position.y = 3.4;
      lampGroup.add(lampHousing);

      const lampRoof = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 4), ironMat);
      lampRoof.position.y = 3.8;
      lampRoof.rotation.y = Math.PI / 4;
      lampGroup.add(lampRoof);

      this.scene.add(lampGroup);
      this.colliders.push({ x: lp.x, z: lp.z, radius: 0.45 });
    });

    // 5. Town Hall & Clock Watchtower at (X = 96, Z = 92)
    this.createTimberBuilding({
      cx: 96,
      cz: 92,
      width: 14.0,
      depth: 9.0,
      stories: 2,
      roofColor: 0x222a35,
      roofPitch: 3.2,
      chimneySide: "east",
      doorSide: "north",
    });

    // Watchtower attached to the front of Town Hall at (96, 88.5)
    const towerGroup = new THREE.Group();
    towerGroup.position.set(96, cityGroundY, 88.5);

    // Stone tower shaft rising 14m tall
    const towerShaft = new THREE.Mesh(new THREE.BoxGeometry(4.0, 14.0, 4.0), stoneMat);
    towerShaft.position.y = 7.0;
    towerShaft.castShadow = true;
    towerShaft.receiveShadow = true;
    towerGroup.add(towerShaft);

    // Clock face dial on the north face of the tower
    const clockTex = createClockTexture();
    const clockDial = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 24),
      new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.4 })
    );
    clockDial.position.set(0, 11.8, -2.02);
    clockDial.rotation.y = Math.PI;
    towerGroup.add(clockDial);

    // Open belfry chamber on top (Y = 14m to 17m)
    const belfryFloor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.35, 4.4), stoneMat);
    belfryFloor.position.y = 14.2;
    towerGroup.add(belfryFloor);

    // 4 Belfry corner pillars
    const belfryPillarGeo = new THREE.BoxGeometry(0.4, 2.6, 0.4);
    for (const bx of [-1.7, 1.7]) {
      for (const bz of [-1.7, 1.7]) {
        const bp = new THREE.Mesh(belfryPillarGeo, stoneMat);
        bp.position.set(bx, 15.5, bz);
        towerGroup.add(bp);
      }
    }

    // Bronze Bell hanging inside belfry
    const bellMat = new THREE.MeshStandardMaterial({ color: 0xcd7f32, metalness: 0.8, roughness: 0.3 });
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.65, 0.8, 12), bellMat);
    bell.position.set(0, 15.6, 0);
    towerGroup.add(bell);

    // Tower Spire Roof reaching Y = 23m
    const spireGeo = new THREE.ConeGeometry(2.6, 6.2, 4);
    spireGeo.rotateY(Math.PI / 4);
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x3d665b, roughness: 0.6, metalness: 0.3 });
    const spire = new THREE.Mesh(spireGeo, spireMat);
    spire.position.y = 19.8;
    spire.castShadow = true;
    towerGroup.add(spire);

    // Weather-vane on spire peak
    const vane = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), ironMat);
    vane.position.y = 23.3;
    towerGroup.add(vane);

    this.scene.add(towerGroup);
    this.addBoxCollider(96, 88.5, 4.0, 4.0);

    // 6. The Whispering Pine Tavern & Inn at (X = 82, Z = 56) (faces East into plaza)
    this.createTimberBuilding({
      cx: 82,
      cz: 56,
      width: 9.0,
      depth: 8.5,
      stories: 2,
      roofColor: 0x7c3826,
      roofPitch: 2.8,
      chimneySide: "west",
      doorSide: "east",
      porch: { side: "east", width: 6.5, depth: 2.6 },
      signText: "THE WHISPERING PINE",
    });

    // 7. The Stoneforge Blacksmith at (X = 81, Z = 74) (faces East into plaza)
    this.createTimberBuilding({
      cx: 81,
      cz: 74,
      width: 8.0,
      depth: 7.5,
      stories: 1,
      roofColor: 0x374151,
      roofPitch: 2.2,
      chimneySide: "south",
      doorSide: "east",
      signText: "STONEFORGE",
    });

    // Blacksmith front open workshop lean-to
    const forgeGroup = new THREE.Group();
    forgeGroup.position.set(86.5, cityGroundY, 74);

    // Oak tree stump with heavy iron anvil
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.6, 8), timberMat);
    stump.position.y = 0.3;
    forgeGroup.add(stump);

    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.6), ironMat);
    anvil.position.y = 0.75;
    forgeGroup.add(anvil);

    // Quench water barrel
    const quenchBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.8, 8), timberMat);
    quenchBarrel.position.set(0, 0.4, 1.4);
    forgeGroup.add(quenchBarrel);

    // Stone hearth with glowing coal embers
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), stoneMat);
    hearth.position.set(0, 0.3, -1.4);
    forgeGroup.add(hearth);

    const coals = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.15, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xff3b11 })
    );
    coals.position.set(0, 0.65, -1.4);
    forgeGroup.add(coals);

    this.scene.add(forgeGroup);
    this.addBoxCollider(86.5, 74, 1.8, 3.5);

    // 8. Pinehaven Merchant Guild & General Store at (X = 111, Z = 56) (faces West into plaza)
    this.createTimberBuilding({
      cx: 111,
      cz: 56,
      width: 9.0,
      depth: 8.0,
      stories: 2,
      roofColor: 0x222a35,
      roofPitch: 2.8,
      chimneySide: "east",
      doorSide: "west",
      awning: { side: "west", color: 0xb91c1c, width: 6.2 },
      signText: "GENERAL STORE",
    });

    // 9. Apothecary & Herbalist Shop at (X = 111, Z = 74) (faces West into plaza)
    this.createTimberBuilding({
      cx: 111,
      cz: 74,
      width: 8.0,
      depth: 7.2,
      stories: 2,
      roofColor: 0x7c3826,
      roofPitch: 2.6,
      chimneySide: "east",
      doorSide: "west",
      signText: "APOTHECARY",
    });

    // 10. Residential Cottages
    // North-West Cottage
    this.createTimberBuilding({
      cx: 84,
      cz: 42,
      width: 7.5,
      depth: 6.5,
      stories: 1,
      roofColor: 0x543b27,
      roofPitch: 2.3,
      chimneySide: "west",
      doorSide: "south",
    });

    // North-East Cottage
    this.createTimberBuilding({
      cx: 108,
      cz: 42,
      width: 7.5,
      depth: 6.5,
      stories: 1,
      roofColor: 0x543b27,
      roofPitch: 2.3,
      chimneySide: "east",
      doorSide: "south",
    });

    // South-West Cottage
    this.createTimberBuilding({
      cx: 84,
      cz: 90,
      width: 7.5,
      depth: 6.5,
      stories: 1,
      roofColor: 0x2e3640,
      roofPitch: 2.3,
      chimneySide: "west",
      doorSide: "north",
    });

    // South-East Cottage
    this.createTimberBuilding({
      cx: 108,
      cz: 90,
      width: 7.5,
      depth: 6.5,
      stories: 1,
      roofColor: 0x7c3826,
      roofPitch: 2.3,
      chimneySide: "east",
      doorSide: "north",
    });

    // 11. 4 Marketplace Stalls in Central Plaza
    this.createMarketStall({ cx: 91, cz: 59, canopyColor: 0x2563eb, wares: "bakery" });
    this.createMarketStall({ cx: 101, cz: 59, canopyColor: 0xdc2626, wares: "produce" });
    this.createMarketStall({ cx: 91, cz: 73, canopyColor: 0x16a34a, wares: "potions" });
    this.createMarketStall({ cx: 101, cz: 73, canopyColor: 0x7c3aed, wares: "textiles" });

    // 12. Cargo Barrels & Shipping Crates in Alleys
    const barrelGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.85, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85 });
    const crateGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x82542a, roughness: 0.88 });

    const propLocations = [
      { x: 86.8, z: 61.2 },
      { x: 86.8, z: 62.0 },
      { x: 105.2, z: 61.5 },
      { x: 105.2, z: 62.3 },
      { x: 87.2, z: 84.5 },
      { x: 104.8, z: 84.5 },
    ];
    propLocations.forEach((prop, i) => {
      if (i % 2 === 0) {
        const b = new THREE.Mesh(barrelGeo, barrelMat);
        b.position.set(prop.x, cityGroundY + 0.425, prop.z);
        b.castShadow = true;
        this.scene.add(b);
      } else {
        const cr = new THREE.Mesh(crateGeo, crateMat);
        cr.position.set(prop.x, cityGroundY + 0.35, prop.z);
        cr.castShadow = true;
        this.scene.add(cr);
      }
      this.colliders.push({ x: prop.x, z: prop.z, radius: 0.45 });
    });
  }

  /**
   * Adds collectible Gold, Silver, and Bronze bars scattered across landmarks and nature.
   */
  private addCollectibleBars() {
    const ingotGeo = new THREE.BoxGeometry(0.52, 0.18, 0.26);

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.16,
      metalness: 0.95,
      emissive: 0xffa000,
      emissiveIntensity: 0.35,
    });
    const silverMat = new THREE.MeshStandardMaterial({
      color: 0xdfdfdf,
      roughness: 0.18,
      metalness: 0.92,
      emissive: 0x8899aa,
      emissiveIntensity: 0.25,
    });
    const bronzeMat = new THREE.MeshStandardMaterial({
      color: 0xcd7f32,
      roughness: 0.24,
      metalness: 0.88,
      emissive: 0x8b4513,
      emissiveIntensity: 0.25,
    });

    const ringGeo = new THREE.TorusGeometry(0.34, 0.022, 6, 20);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
    });

    const goldLocations: Array<[number, number]> = [
      [96, 68], // Pinehaven central fountain basin
      [96, 92], // Pinehaven Town Hall portico
      [92, 38], // City Gate entrance
      [-65, 0], // West Golden Beach dunes
      [-72, -45], // Western Shore ocean edge
      [42, -55], // Deep Alpine Pine Grove clearing
      [68, -80], // High eastern mountain ridge
      [8, 22], // Starter Glade ancient grove
      [92, -112], // Far Northern Highland Highway terminus
      [-35, 60], // Southern beach palm oasis
    ];

    const silverLocations: Array<[number, number]> = [
      [92, -85], [92, -55], [92, -20], [92, 10], // Along Highway
      [82, 58], [110, 62], [84, 82], [108, 80], // Pinehaven alleys
      [-48, -25], [-55, 30], [-42, 85], [-60, -70], // Beach dunes
      [22, -15], [35, 25], [15, -45], [55, 10], // Forests & glades
    ];

    const bronzeLocations: Array<[number, number]> = [
      [2, 6], [12, -8], [-5, 15], [-12, -12], // Near spawn
      [-28, -10], [-32, 20], [-26, -50], [-30, 45], // Edge of beach
      [-45, -90], [-52, -120], [-40, 110], [-50, 130], // Shore dunes
      [30, -30], [25, 40], [45, 20], [18, 65], // Meadows
      [88, -95], [96, -70], [88, -40], [96, -5], // Highway grass
      [78, 68], [114, 70], [90, 52], [102, 52], // Pinehaven perimeter
    ];

    const createBarMesh = (type: BarType) => {
      const group = new THREE.Group();
      const mat = type === "gold" ? goldMat : type === "silver" ? silverMat : bronzeMat;
      const bar = new THREE.Mesh(ingotGeo, mat);
      bar.castShadow = true;
      group.add(bar);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      return group;
    };

    let idCount = 0;
    const addBars = (locs: Array<[number, number]>, type: BarType) => {
      locs.forEach(([x, z]) => {
        const y = getTerrainHeight(x, z);
        const mesh = createBarMesh(type);
        mesh.position.set(x, y + 0.35, z);
        this.scene.add(mesh);

        this.bars.push({
          id: `bar_${type}_${++idCount}`,
          type,
          x,
          z,
          y,
          mesh,
          collected: false,
          respawnTime: 0,
        });
      });
    };

    addBars(goldLocations, "gold");
    addBars(silverLocations, "silver");
    addBars(bronzeLocations, "bronze");
  }

  /**
   * Adds OP Token Exchange Merchant Kiosks in 4 major island landmarks.
   */
  private addExchangeBooths() {
    const boothConfigs: Array<{ id: string; name: string; x: number; z: number }> = [
      { id: "booth_pinehaven", name: "Pinehaven Market Exchange", x: 88, z: 72 },
      { id: "booth_highway", name: "Highland Highway Waypoint", x: 88.5, z: -46 },
      { id: "booth_beach", name: "West Beach Outpost", x: -44, z: 12 },
      { id: "booth_glade", name: "Starter Glade Oasis", x: 12, z: 12 },
    ];

    const counterGeo = new THREE.BoxGeometry(2.4, 1.0, 1.2);
    const counterMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.8 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x221307, roughness: 0.6 });
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8);
    const awningGeo = new THREE.ConeGeometry(1.6, 0.8, 4);
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x7e22ce, roughness: 0.65 }); // Royal purple canopy
    const signMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });

    // Brass Scale on counter
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.9, roughness: 0.2 });
    const scaleBaseGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.35, 12);
    const scaleArmGeo = new THREE.BoxGeometry(0.65, 0.04, 0.04);
    const scalePanGeo = new THREE.CylinderGeometry(0.14, 0.08, 0.06, 12);

    boothConfigs.forEach((cfg) => {
      const y = getTerrainHeight(cfg.x, cfg.z);
      const group = new THREE.Group();
      group.position.set(cfg.x, y, cfg.z);

      // Counter
      const counter = new THREE.Mesh(counterGeo, counterMat);
      counter.position.y = 0.5;
      counter.castShadow = true;
      counter.receiveShadow = true;
      group.add(counter);

      const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.4), topMat);
      top.position.y = 1.05;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      // Canopy Posts
      const post1 = new THREE.Mesh(postGeo, counterMat);
      post1.position.set(-1.1, 1.8, 0.5);
      group.add(post1);
      const post2 = new THREE.Mesh(postGeo, counterMat);
      post2.position.set(1.1, 1.8, 0.5);
      group.add(post2);

      // Awning
      const awning = new THREE.Mesh(awningGeo, awningMat);
      awning.position.set(0, 2.8, 0);
      awning.rotation.y = Math.PI / 4;
      awning.scale.set(1.2, 0.7, 0.9);
      group.add(awning);

      // Brass Scale
      const scaleBase = new THREE.Mesh(scaleBaseGeo, brassMat);
      scaleBase.position.set(-0.55, 1.25, 0);
      group.add(scaleBase);
      const scaleArm = new THREE.Mesh(scaleArmGeo, brassMat);
      scaleArm.position.set(-0.55, 1.45, 0);
      group.add(scaleArm);
      const pan1 = new THREE.Mesh(scalePanGeo, brassMat);
      pan1.position.set(-0.82, 1.38, 0);
      group.add(pan1);
      const pan2 = new THREE.Mesh(scalePanGeo, brassMat);
      pan2.position.set(-0.28, 1.38, 0);
      group.add(pan2);

      // Glowing "OP" Sign
      const signMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.1), signMat);
      signMesh.position.set(0, 2.35, 0.55);
      group.add(signMesh);

      // Spinning Gold OP Coin Token on top
      const coinGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.08, 20);
      const coinMesh = new THREE.Mesh(coinGeo, brassMat);
      coinMesh.rotation.x = Math.PI / 2;
      coinMesh.position.set(0, 3.3, 0);
      coinMesh.name = "spinningCoin";
      group.add(coinMesh);

      this.scene.add(group);
      this.colliders.push({ x: cfg.x, z: cfg.z, radius: 1.4 });

      this.exchangeBooths.push({
        id: cfg.id,
        name: cfg.name,
        x: cfg.x,
        z: cfg.z,
        y,
      });
    });
  }

  /**
   * Synthesizes audio feedback for bar collection using Web Audio API.
   */
  public playPickupSound(type: BarType | "exchange") {
    try {
      if (!this.audioCtx) {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtxClass) this.audioCtx = new AudioCtxClass();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === "exchange") {
        // Cheerful coin shower arpeggio (C5 -> E5 -> G5 -> C6)
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.07);
        osc.frequency.setValueAtTime(783.99, now + 0.14);
        osc.frequency.setValueAtTime(1046.5, now + 0.21);
        gain.gain.setValueAtTime(0.24, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
        osc.start(now);
        osc.stop(now + 0.53);
      } else if (type === "gold") {
        // High sparkling bell chord (659Hz -> 880Hz -> 1318Hz)
        osc.type = "triangle";
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.setValueAtTime(880.0, now + 0.08);
        osc.frequency.setValueAtTime(1318.5, now + 0.16);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
        osc.start(now);
        osc.stop(now + 0.45);
      } else if (type === "silver") {
        // Crisp silver bell chime (587Hz -> 880Hz)
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880.0, now + 0.07);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      } else {
        // Warm bronze bell (440Hz -> 554Hz)
        osc.type = "sine";
        osc.frequency.setValueAtTime(440.0, now);
        osc.frequency.setValueAtTime(554.37, now + 0.06);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.29);
      }
    } catch {
      // Audio not supported or blocked
    }
  }

  private addCloud(x: number, y: number, z: number) {
    const cloud = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
    });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(Math.random() * 2 + 1.5, 12, 12), material);
      puff.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 4);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    this.scene.add(cloud);
  }

  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (event.code === "Space" || key === " ") {
      event.preventDefault();
      this.jump();
    } else if (key === "r") {
      this.toggleRunning();
    }
  };
  private keyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());

  public setJoystickInput(x: number, y: number) {
    this.virtualJoystick.x = THREE.MathUtils.clamp(x, -1, 1);
    this.virtualJoystick.y = THREE.MathUtils.clamp(y, -1, 1);
  }

  public jump() {
    if (this.isGrounded) {
      this.velocityY = 9.2;
      this.isGrounded = false;
    }
  }

  private pointerDown = (event: PointerEvent) => {
    this.draggingCamera = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    if (!this.draggingCamera) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    // Higher sensitivity on mobile touch (pointer type = touch/pen) vs mouse
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    const yawSens = isTouch ? 0.055 : 0.008;
    const pitchSens = isTouch ? 0.040 : 0.006;
    this.cameraYaw -= dx * yawSens;
    this.cameraPitch = THREE.MathUtils.clamp(
      this.cameraPitch + dy * pitchSens,
      0.08,
      1.1
    );
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private pointerUp = () => {
    this.draggingCamera = false;
  };

  private resize = () => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 3.0 : 2.0));
    this.renderer.setSize(w, h);
  };

  private animate = () => {
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Constant bright sunny daytime (never transitions to night)
    this.grassTimeUniform.value = elapsed;

    // Gentle shoreline surf & ocean breathing (zero CPU overhead)
    if (this.oceanMesh) {
      this.oceanMesh.position.y = Math.sin(elapsed * 1.2) * 0.05;
    }
    if (this.foamMat && this.foamMesh) {
      this.foamMat.opacity = 0.45 + Math.sin(elapsed * 2.0) * 0.25;
      this.foamMesh.position.x = Math.sin(elapsed * 1.4) * 0.4;
    }

    // Reuse pre-allocated vectors — avoids GC churn every frame
    const sinYaw = Math.sin(this.cameraYaw);
    const cosYaw = Math.cos(this.cameraYaw);
    const forward = new THREE.Vector2(sinYaw, -cosYaw);
    const right = new THREE.Vector2(cosYaw, sinYaw);
    let moveX = 0,
      moveZ = 0;

    // Keyboard WASD / Arrow keys
    if (this.keys.has("w") || this.keys.has("arrowup")) {
      moveX += forward.x;
      moveZ += forward.y;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      moveX -= forward.x;
      moveZ -= forward.y;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      moveX -= right.x;
      moveZ -= right.y;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      moveX += right.x;
      moveZ += right.y;
    }

    // Virtual Joystick input (y: positive = forward, x: positive = right)
    if (Math.abs(this.virtualJoystick.x) > 0.05 || Math.abs(this.virtualJoystick.y) > 0.05) {
      moveX += right.x * this.virtualJoystick.x + forward.x * this.virtualJoystick.y;
      moveZ += right.y * this.virtualJoystick.x + forward.y * this.virtualJoystick.y;
    }

    const walking = Boolean(moveX || moveZ);
    const isShift = this.keys.has("shift") || this.keys.has("shiftleft") || this.keys.has("shiftright");
    const isRunning = isShift || this.isRunToggled || this.isRunningMobile;
    const speed = isRunning ? 15.5 : 6.8; // 6.8 m/s walk, 15.5 m/s brisk run (fast & responsive)

    if (walking) {
      const length = Math.hypot(moveX, moveZ);
      moveX /= length;
      moveZ /= length;
      const stepX = THREE.MathUtils.clamp(this.position.x + moveX * speed * dt, -200, 200);
      const stepZ = THREE.MathUtils.clamp(this.position.z + moveZ * speed * dt, -200, 200);

      // Block player from passing through solid obstacles (trees, boulders, rocks, bushes)
      const resolved = this.resolveCollisions(stepX, stepZ);
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      this.playerRotation = Math.atan2(moveX, moveZ);
      this.player.setRotation(this.playerRotation);
      if (performance.now() - this.lastSent > 80) {
        this.lastSent = performance.now();
        this.onMove(this.position);
      }
    }

    // Vertical Jump & Gravity physics
    const groundY = getTerrainHeight(this.position.x, this.position.z);
    const GRAVITY = 26.0;

    if (!this.isGrounded || this.position.y > groundY + 0.01) {
      this.velocityY -= GRAVITY * dt;
      this.position.y += this.velocityY * dt;

      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.velocityY = 0;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }
    } else {
      this.position.y = groundY;
      this.velocityY = 0;
      this.isGrounded = true;
    }

    this.player.setPosition(this.position.x, this.position.y, this.position.z);
    this.player.update(dt, walking, isRunning);
    this.remotes.forEach((r) => r.update(dt, false));

    // 1. Animate collectible bars — throttle animation to every 2nd frame for mobile perf
    const now = performance.now();
    this.frameCount = (this.frameCount ?? 0) + 1;
    const animateBars = this.frameCount % 2 === 0;
    for (let i = 0; i < this.bars.length; i++) {
      const bar = this.bars[i];
      if (bar.collected) {
        if (now > bar.respawnTime) {
          bar.collected = false;
          bar.mesh.visible = true;
        }
      } else {
        if (animateBars) {
          bar.mesh.rotation.y += dt * 3.6; // 2x per-update = same visual speed at half freq
          bar.mesh.position.y = bar.y + 0.35 + Math.sin(elapsed * 2.8 + bar.x) * 0.08;
        }
        const d = Math.hypot(this.position.x - bar.x, this.position.z - bar.z);
        if (d < 1.7) {
          bar.collected = true;
          bar.mesh.visible = false;
          bar.respawnTime = now + 75000;
          this.playPickupSound(bar.type);
          if (this.onCollectBar) {
            this.onCollectBar(bar.type);
          }
        }
      }
    }

    // 2. Check proximity to OP Token exchange merchant booths
    let nearBooth: ExchangeBooth | null = null;
    for (let i = 0; i < this.exchangeBooths.length; i++) {
      const b = this.exchangeBooths[i];
      if (Math.hypot(this.position.x - b.x, this.position.z - b.z) < 3.4) {
        nearBooth = b;
        break;
      }
    }
    if (nearBooth !== this.currentNearBooth) {
      this.currentNearBooth = nearBooth;
      if (this.onNearExchange) {
        this.onNearExchange(nearBooth);
      }
    }

    // Send real-time heading & coordinates for Direction Map HUD (throttled to 80ms for peak FPS)
    if (this.onNavUpdate && performance.now() - this.lastNavSend > 80) {
      this.lastNavSend = performance.now();
      let biome = "Starter Glade";
      if (Math.hypot(this.position.x - 96, this.position.z - 66) < 38) {
        biome = "Pinehaven City";
      } else if (Math.abs(this.position.x - 92) < 5.5 && this.position.z >= -120 && this.position.z <= 40) {
        biome = "Highland Highway";
      } else if (this.position.x < -82) {
        biome = "West Ocean & Shallows";
      } else if (this.position.x < -24) {
        biome = "Golden Beach & Dunes";
      } else if (this.position.x > 25 && this.position.z < 10 && this.position.z > -90) {
        biome = "Alpine Pine Grove";
      } else if (this.position.x > 25 || Math.abs(this.position.z) > 35) {
        biome = "Mountain Pine Forest";
      }

      this.onNavUpdate({
        x: this.position.x,
        z: this.position.z,
        yaw: this.cameraYaw,
        playerAngle: this.playerRotation,
        biome,
        isRunning,
      });
    }

    // Third-person chase camera tracking with responsive frame-independent lerp (no rubber-band delay)
    const horizontalDistance = Math.cos(this.cameraPitch) * 7.5;
    this.camTarget.set(this.position.x, this.position.y + 1.25, this.position.z);
    this.desiredCamPos.set(
      this.camTarget.x - forward.x * horizontalDistance,
      this.camTarget.y + Math.sin(this.cameraPitch) * 7.5,
      this.camTarget.z - forward.y * horizontalDistance
    );
    this.camera.position.lerp(this.desiredCamPos, Math.min(1.0, dt * 14));
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Resolves circle-circle collisions against solid obstacles (trees, boulders, rocks, bushes).
   * Blocks the player and enables smooth sliding along obstacle surfaces.
   */
  private resolveCollisions(nextX: number, nextZ: number, playerRadius = 0.42): { x: number; z: number } {
    let px = nextX;
    let pz = nextZ;

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.colliders.length; i++) {
        const col = this.colliders[i];
        const dx = px - col.x;
        const dz = pz - col.z;
        const minDist = playerRadius + col.radius;

        if (Math.abs(dx) > minDist || Math.abs(dz) > minDist) continue;

        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist && distSq > 0.00001) {
          const dist = Math.sqrt(distSq);
          const push = minDist - dist;
          px += (dx / dist) * push;
          pz += (dz / dist) * push;
        }
      }
    }

    return { x: px, z: pz };
  }

  upsertRemote(id: string, player: RemotePlayer) {
    let char = this.remotes.get(id);
    if (!char) {
      char = new Character(this.gltfLoader, 0x933a3a);
      this.remotes.set(id, char);
      this.scene.add(char.group);
    }
    const groundY = getTerrainHeight(player.position.x, player.position.z);
    char.setPosition(player.position.x, groundY, player.position.z);
  }

  removeRemote(id: string) {
    const char = this.remotes.get(id);
    if (char) this.scene.remove(char.group);
    this.remotes.delete(id);
  }

  dispose() {
    this.colliders = [];
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp);
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => {});
    }
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
