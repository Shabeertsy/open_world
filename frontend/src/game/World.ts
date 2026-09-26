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
};

/**
 * Natural Terrain Elevation Function:
 * Features rolling forested hills inland, and on the West side (x < -20) slopes down
 * into gentle sandy beach dunes, shoreline at x = -85 (y = 0), and ocean floor for x < -85.
 */
export function getTerrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const spawnWeight = Math.min(1.0, Math.max(0, (dist - 14) / 26));

  const h1 = Math.sin(x * 0.016) * Math.cos(z * 0.016) * 3.4;
  const h2 = Math.sin(x * 0.038 + 1.2) * Math.cos(z * 0.032 + 0.8) * 1.6;
  const h3 = Math.sin(x * 0.075) * Math.sin(z * 0.075) * 0.55;
  const h4 = Math.cos(x * 0.14 + z * 0.09) * 0.22;
  const inlandHills = (h1 + h2 + h3 + h4) * spawnWeight;

  // West side coastal slope down to sea level and beach
  if (x < -20) {
    const t = THREE.MathUtils.clamp((-20 - x) / 65, 0, 1);
    const smoothT = t * t * (3 - 2 * t);
    const dunes = Math.sin(z * 0.05 + x * 0.02) * 0.35;
    let coastalY = THREE.MathUtils.lerp(Math.max(0.5, inlandHills), 0.0, smoothT) + dunes * (1 - smoothT * 0.8);
    if (x < -85) {
      // Sloping ocean seabed
      const seaT = Math.min(1, (-85 - x) / 80);
      coastalY = -seaT * 6.0 + Math.sin(z * 0.04) * 0.35;
    }
    return coastalY;
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
 * 3D grass tuft geometry with 3 crossed quads in a star pattern.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const bladeGeos: THREE.BufferGeometry[] = [];
  const blades = 3;

  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI;
    const width = 0.95;
    const height = 0.8;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = width / 2;

    positions.push(-hw * cos, 0, -hw * sin);
    normals.push(0, 1, 0);
    colors.push(0.12, 0.24, 0.08);
    uvs.push(0, 0);

    positions.push(hw * cos, 0, hw * sin);
    normals.push(0, 1, 0);
    colors.push(0.12, 0.24, 0.08);
    uvs.push(1, 0);

    const curveX = cos * 0.12;
    const curveZ = sin * 0.12;
    positions.push(-hw * cos * 0.65 + curveX, height, -hw * sin * 0.65 + curveZ);
    normals.push(0, 1, 0);
    colors.push(0.52, 0.78, 0.3);
    uvs.push(0, 1);

    positions.push(hw * cos * 0.65 + curveX, height, hw * sin * 0.65 + curveZ);
    normals.push(0, 1, 0);
    colors.push(0.52, 0.78, 0.3);
    uvs.push(1, 1);

    indices.push(0, 1, 2);
    indices.push(1, 3, 2);

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
 * Procedural grass blade alpha texture.
 */
function createGrassBladeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);

  const bladePositions = [16, 42, 64, 88, 110];
  for (const bx of bladePositions) {
    const tipOffset = (Math.random() - 0.5) * 18;
    const bladeHeight = 100 + Math.random() * 24;
    const grad = ctx.createLinearGradient(0, 128, 0, 128 - bladeHeight);
    grad.addColorStop(0, "#25481a");
    grad.addColorStop(0.5, "#4c7e32");
    grad.addColorStop(1, "#8dc452");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(bx - 9, 128);
    ctx.quadraticCurveTo(bx - 3, 128 - bladeHeight * 0.6, bx + tipOffset, 128 - bladeHeight);
    ctx.quadraticCurveTo(bx + 3, 128 - bladeHeight * 0.6, bx + 9, 128);
    ctx.closePath();
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

/**
 * Wildflower geometry.
 */
function createWildflowerGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.025, 0.025, 0.55, 5);
  stem.translate(0, 0.28, 0);

  const bloom = new THREE.SphereGeometry(0.12, 6, 6);
  bloom.scale(1.2, 0.6, 1.2);
  bloom.translate(0, 0.58, 0);

  return BufferGeometryUtils.mergeGeometries([stem, bloom])!;
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
  private sun = new THREE.DirectionalLight(0xfff5b6, 3.8);
  private timeOfDay = 8.5;

  // Ocean wave animation references
  private oceanPos?: THREE.BufferAttribute;
  private oceanOrigY?: Float32Array;
  private foamMesh?: THREE.Mesh;
  private foamMat?: THREE.MeshBasicMaterial;

  constructor(
    private container: HTMLElement,
    private onMove: (position: Position) => void,
    private onNavUpdate?: (nav: NavState) => void
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog("#e2a87b", 65, 380);

    this.sky.scale.setScalar(450000);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms["turbidity"].value = 10;
    skyUniforms["rayleigh"].value = 2;
    skyUniforms["mieCoefficient"].value = 0.005;
    skyUniforms["mieDirectionalG"].value = 0.8;
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0xffdfb3, 0x4d3b2c, 1.25));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -220;
    this.sun.shadow.camera.right = 220;
    this.sun.shadow.camera.top = 220;
    this.sun.shadow.camera.bottom = -220;
    this.sun.shadow.bias = -0.0001;
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
    const sandCol = new THREE.Color(0xdfbd7a);
    const wetSandCol = new THREE.Color(0xa07f4c);
    const seaBedCol = new THREE.Color(0x483824);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      let c = grassCol;
      if (x < -88) {
        c = seaBedCol; // underwater seabed
      } else if (x < -68) {
        c = y < 0.2 ? wetSandCol : sandCol; // golden beach sand & wet tide line
      } else if (x < -38) {
        const frac = (-38 - x) / 30;
        c = grassCol.clone().lerp(sandCol, frac); // seamless grass to sand transition
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

    // 3. Add Towering Realistic Pine Forest (Inland)
    this.addTrees();

    // 4. Add Volumetric 3D Grass Tufts Across the Landscape
    this.addGrassTufts();

    // 5. Add Wild Meadow Flowers
    this.addWildflowers();

    // 6. Add Natural Boulders & Beach Rocks
    this.addRocksAndBushes();

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
    const timeAngle = ((this.timeOfDay - 6) / 12) * Math.PI;
    const phi = Math.PI / 2 - Math.sin(timeAngle) * (Math.PI / 2);
    const theta = Math.cos(timeAngle) * (Math.PI / 2);
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(300, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(sunPosition);
    this.sun.position.copy(sunPosition);
    this.sun.intensity = Math.max(0, Math.sin(timeAngle) * 3.4);
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
   * Generates the ocean on the West side (x < -80) with animated swells and beach foam.
   */
  private addWestOcean() {
    // Ocean Water Plane (Width: 240 units, Length: 600 units, Sea Level: y = 0.0)
    const oceanGeo = new THREE.PlaneGeometry(240, 600, 48, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    oceanGeo.translate(-200, 0, 0); // spans x = -80 to x = -320

    this.oceanPos = oceanGeo.attributes.position as THREE.BufferAttribute;
    this.oceanOrigY = new Float32Array(this.oceanPos.count);
    for (let i = 0; i < this.oceanPos.count; i++) {
      this.oceanOrigY[i] = this.oceanPos.getY(i);
    }

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x1b748e, // vibrant turquoise / ocean blue
      roughness: 0.08,
      metalness: 0.16,
      transparent: true,
      opacity: 0.82,
    });

    const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    oceanMesh.receiveShadow = true;
    this.scene.add(oceanMesh);

    // Shoreline surf & foam strip along x = -84
    const foamGeo = new THREE.PlaneGeometry(7, 600, 2, 60);
    foamGeo.rotateX(-Math.PI / 2);
    foamGeo.translate(-83.5, 0.05, 0);

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
        // Keep clear spawn glade AND clear West beach (x < -48)
        if (Math.hypot(x, z) < 22 || x < -48) {
          dummy.position.set(0, -999, 0);
          dummy.updateMatrix();
          trunkMesh1.setMatrixAt(i, dummy.matrix);
          leavesMesh1.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      // Check beach boundary
      if (x < -48) {
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
        if (Math.hypot(x, z) < 22 || x < -48) {
          dummy.position.set(0, -999, 0);
          dummy.updateMatrix();
          trunkMesh2.setMatrixAt(i, dummy.matrix);
          leavesMesh2.setMatrixAt(i, dummy.matrix);
          continue;
        }
      }

      if (x < -48) {
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
    }

    this.scene.add(trunkMesh1);
    this.scene.add(leavesMesh1);
    this.scene.add(trunkMesh2);
    this.scene.add(leavesMesh2);
  }

  /**
   * Adds volumetric 3D grass blade clumps (inland only, keeping sand dunes clean).
   */
  private addGrassTufts() {
    const tuftCount = 4200;
    const tuftGeo = createGrassTuftGeometry();
    const bladeTex = createGrassBladeTexture();

    const tuftMat = new THREE.MeshStandardMaterial({
      map: bladeTex,
      vertexColors: true,
      alphaTest: 0.35,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    const grassMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
    grassMesh.receiveShadow = true;
    grassMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < tuftCount; i++) {
      let x = (Math.random() - 0.5) * 380;
      let z = (Math.random() - 0.5) * 380;
      if (i < 800) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 32;
        x = Math.cos(angle) * dist;
        z = Math.sin(angle) * dist;
      }

      // Keep grass inland (off the beach)
      if (x < -50) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      const scale = 0.75 + Math.random() * 0.65;

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.1,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.1
      );
      dummy.scale.set(scale, scale * (0.8 + Math.random() * 0.4), scale);
      dummy.updateMatrix();

      grassMesh.setMatrixAt(i, dummy.matrix);
    }

    this.scene.add(grassMesh);
  }

  /**
   * Adds wild meadow flowers in inland glades.
   */
  private addWildflowers() {
    const flowerCount = 500;
    const flowerGeo = createWildflowerGeometry();

    const flowerColors = [
      new THREE.Color(0xf6d354),
      new THREE.Color(0xf5f3ee),
      new THREE.Color(0x9d7ec7),
      new THREE.Color(0xe06d6d),
    ];

    const flowerMat = new THREE.MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0.1,
    });

    const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    flowerMesh.receiveShadow = true;
    flowerMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < flowerCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 120;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      if (x < -48) {
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        flowerMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const groundY = getTerrainHeight(x, z);
      const scale = 0.8 + Math.random() * 0.6;

      dummy.position.set(x, groundY, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.15,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.15
      );
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      flowerMesh.setMatrixAt(i, dummy.matrix);
      flowerMesh.setColorAt(i, flowerColors[i % flowerColors.length]);
    }

    this.scene.add(flowerMesh);
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

      const isBeach = x < -60;
      const isWater = x < -85;

      if (Math.random() > 0.4) {
        // Rocks
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(Math.random() * 0.9 + 0.4),
          isBeach ? beachRockMat : rockMat
        );
        const groundY = getTerrainHeight(x, z);
        rock.position.set(x, groundY + (isWater ? 0.05 : 0.18), z);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
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
      }
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

  private keyDown = (event: KeyboardEvent) => this.keys.add(event.key.toLowerCase());
  private keyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());

  private pointerDown = (event: PointerEvent) => {
    this.draggingCamera = true;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    if (!this.draggingCamera) return;
    this.cameraYaw -= (event.clientX - this.lastPointer.x) * 0.008;
    this.cameraPitch = THREE.MathUtils.clamp(
      this.cameraPitch + (event.clientY - this.lastPointer.y) * 0.006,
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
    this.renderer.setSize(w, h);
  };

  private animate = () => {
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.timeOfDay += dt * 0.08;
    if (this.timeOfDay >= 24) this.timeOfDay = 0;
    this.updateSun();

    // Animate West ocean swells & shoreline foam
    if (this.oceanPos && this.oceanOrigY) {
      for (let i = 0; i < this.oceanPos.count; i++) {
        const ox = this.oceanPos.getX(i);
        const oz = this.oceanPos.getZ(i);
        const wave = Math.sin(ox * 0.12 + elapsed * 1.6) * 0.14 + Math.cos(oz * 0.08 + elapsed * 1.3) * 0.1;
        this.oceanPos.setY(i, wave);
      }
      this.oceanPos.needsUpdate = true;
    }

    if (this.foamMat && this.foamMesh) {
      this.foamMat.opacity = 0.45 + Math.sin(elapsed * 2.2) * 0.25;
      this.foamMesh.position.x = Math.sin(elapsed * 1.6) * 1.2;
    }

    const forward = new THREE.Vector2(Math.sin(this.cameraYaw), -Math.cos(this.cameraYaw));
    const right = new THREE.Vector2(Math.cos(this.cameraYaw), Math.sin(this.cameraYaw));
    let moveX = 0,
      moveZ = 0;
    if (this.keys.has("w")) {
      moveX += forward.x;
      moveZ += forward.y;
    }
    if (this.keys.has("s")) {
      moveX -= forward.x;
      moveZ -= forward.y;
    }
    if (this.keys.has("a")) {
      moveX -= right.x;
      moveZ -= right.y;
    }
    if (this.keys.has("d")) {
      moveX += right.x;
      moveZ += right.y;
    }

    const walking = Boolean(moveX || moveZ);
    if (walking) {
      const length = Math.hypot(moveX, moveZ);
      moveX /= length;
      moveZ /= length;
      this.position.x = THREE.MathUtils.clamp(this.position.x + moveX * 8.5 * dt, -200, 200);
      this.position.z = THREE.MathUtils.clamp(this.position.z + moveZ * 8.5 * dt, -200, 200);
      this.position.y = getTerrainHeight(this.position.x, this.position.z);
      this.playerRotation = Math.atan2(moveX, moveZ);
      this.player.setPosition(this.position.x, this.position.y, this.position.z);
      this.player.setRotation(this.playerRotation);
      if (performance.now() - this.lastSent > 80) {
        this.lastSent = performance.now();
        this.onMove(this.position);
      }
    } else {
      this.position.y = getTerrainHeight(this.position.x, this.position.z);
      this.player.setPosition(this.position.x, this.position.y, this.position.z);
    }

    this.player.update(dt, walking);
    this.remotes.forEach((r) => r.update(dt, false));

    // Send real-time heading & coordinates for Direction Map HUD
    if (this.onNavUpdate && performance.now() - this.lastNavSend > 40) {
      this.lastNavSend = performance.now();
      let biome = "🌿 Starter Glade";
      if (this.position.x < -80) {
        biome = "🌊 West Ocean & Shallows";
      } else if (this.position.x < -55) {
        biome = "🏖️ West Beach & Sea Shore";
      } else if (this.position.x > 25 || Math.abs(this.position.z) > 35) {
        biome = "🌲 Mountain Pine Forest";
      }

      this.onNavUpdate({
        x: this.position.x,
        z: this.position.z,
        yaw: this.cameraYaw,
        playerAngle: this.playerRotation,
        biome,
      });
    }

    // Third-person chase camera tracking the terrain elevation
    const horizontalDistance = Math.cos(this.cameraPitch) * 7.5;
    const target = new THREE.Vector3(this.position.x, this.position.y + 1.25, this.position.z);
    const desiredCamera = new THREE.Vector3(
      target.x - forward.x * horizontalDistance,
      target.y + Math.sin(this.cameraPitch) * 7.5,
      target.z - forward.y * horizontalDistance
    );
    this.camera.position.lerp(desiredCamera, 0.14);
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  };

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
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp);
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
