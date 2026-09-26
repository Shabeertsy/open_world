import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type Position = { x: number; y: number; z: number };
type RemotePlayer = { position: Position };
export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(90, 1, 0.1, 500);
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  private remotes = new Map<string, THREE.Group>();
  private player = this.createCharacter(0xffbd59);
  private position: Position = { x: 0, y: 0, z: 0 };
  private lastSent = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.45;
  private draggingCamera = false;
  private lastPointer = { x: 0, y: 0 };
  private sky = new Sky();
  private sun = new THREE.DirectionalLight(0xffffff, 3);
  private timeOfDay = 8; // 8 AM
  private gltfLoader = new GLTFLoader();

  constructor(private container: HTMLElement, private onMove: (position: Position) => void) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog("#87ceeb", 45, 300);

    this.sky.scale.setScalar(450000);
    this.scene.add(this.sky);

    this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3b3428, 1.5));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -200;
    this.sun.shadow.camera.right = 200;
    this.sun.shadow.camera.top = 200;
    this.sun.shadow.camera.bottom = -200;
    this.sun.shadow.bias = -0.0001;
    this.scene.add(this.sun);

    this.updateSun();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: "#5d9c56", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.player.position.set(this.position.x, this.position.y, this.position.z); this.scene.add(this.player);
    this.addTrees();
    window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp); window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown); this.renderer.domElement.addEventListener("pointermove", this.pointerMove); this.renderer.domElement.addEventListener("pointerup", this.pointerUp); this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
    this.resize(); this.animate();
    this.resize(); this.animate();
  }

  private updateSun() {
    const timeAngle = ((this.timeOfDay - 6) / 12) * Math.PI;
    const phi = Math.PI / 2 - Math.sin(timeAngle) * (Math.PI / 2);
    const theta = Math.cos(timeAngle) * (Math.PI / 2);
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(300, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(sunPosition);
    this.sun.position.copy(sunPosition);
    this.sun.intensity = Math.max(0, Math.sin(timeAngle) * 3);
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
  private addTrees() {
    const treeCount = 500;
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 2);
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#795548", roughness: 0.9 });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;

    const leavesGeo = new THREE.ConeGeometry(2, 5, 8);
    const leavesMat = new THREE.MeshStandardMaterial({ color: "#246b3a", roughness: 0.8 });
    const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, treeCount);
    leavesMesh.castShadow = true;
    leavesMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * 450;
      const z = (Math.random() - 0.5) * 450;
      if (Math.abs(x) < 20 && Math.abs(z) < 20) continue; // Keep center clear

      const scale = 0.7 + Math.random() * 0.6;

      dummy.position.set(x, 1 * scale, z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 4 * scale, z);
      dummy.updateMatrix();
      leavesMesh.setMatrixAt(i, dummy.matrix);
    }

    this.scene.add(trunkMesh);
    this.scene.add(leavesMesh);
  }
  private addRock(x: number, z: number) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(Math.random() * 0.8 + 0.4), new THREE.MeshStandardMaterial({ color: "#8a9597", roughness: 0.9 }));
    rock.position.set(x, Math.random() * 0.3, z);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.castShadow = true; rock.receiveShadow = true;
    this.scene.add(rock);
  }
  private addBush(x: number, z: number) {
    const bush = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#3d8c40", roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(Math.random() * 0.5 + 0.5, 8, 8), material);
      leaf.position.set((Math.random() - 0.5) * 0.8, Math.random() * 0.5 + 0.2, (Math.random() - 0.5) * 0.8);
      leaf.castShadow = true; leaf.receiveShadow = true;
      bush.add(leaf);
    }
    bush.position.set(x, 0, z);
    this.scene.add(bush);
  }
  private addCloud(x: number, y: number, z: number) {
    const cloud = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(Math.random() * 2 + 1.5, 12, 12), material);
      puff.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 4);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    this.scene.add(cloud);
  }
  private createCharacter(color: number) {
    const character = new THREE.Group();
    const clothing = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf1c6a5, roughness: 0.9 });
    const makePart = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => { const part = new THREE.Mesh(geometry, material); part.position.set(x, y, z); part.castShadow = true; character.add(part); return part; };
    makePart(new THREE.CapsuleGeometry(0.42, 0.8, 4, 8), clothing, 0, 1.55, 0);
    makePart(new THREE.SphereGeometry(0.34, 16, 12), skin, 0, 2.55, 0);
    const leftArm = makePart(new THREE.CylinderGeometry(0.14, 0.16, 0.85, 8), clothing, -0.56, 1.62, 0) as THREE.Mesh;
    const rightArm = makePart(new THREE.CylinderGeometry(0.14, 0.16, 0.85, 8), clothing, 0.56, 1.62, 0) as THREE.Mesh;
    const leftLeg = makePart(new THREE.CylinderGeometry(0.17, 0.19, 0.95, 8), clothing, -0.22, 0.48, 0) as THREE.Mesh;
    const rightLeg = makePart(new THREE.CylinderGeometry(0.17, 0.19, 0.95, 8), clothing, 0.22, 0.48, 0) as THREE.Mesh;
    leftArm.rotation.z = -0.12; rightArm.rotation.z = 0.12;
    character.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg };
    character.scale.set(0.5, 0.5, 0.5);
    return character;
  }
  private animateCharacter(character: THREE.Group, walking: boolean) {
    const limbs = character.userData.limbs as { leftArm: THREE.Mesh; rightArm: THREE.Mesh; leftLeg: THREE.Mesh; rightLeg: THREE.Mesh };
    const swing = walking ? Math.sin(performance.now() * 0.012) * 0.48 : 0;
    limbs.leftArm.rotation.x = swing; limbs.rightArm.rotation.x = -swing;
    limbs.leftLeg.rotation.x = -swing; limbs.rightLeg.rotation.x = swing;
  }
  private keyDown = (event: KeyboardEvent) => this.keys.add(event.key.toLowerCase());
  private keyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());
  private pointerDown = (event: PointerEvent) => { this.draggingCamera = true; this.lastPointer = { x: event.clientX, y: event.clientY }; this.renderer.domElement.setPointerCapture(event.pointerId); };
  private pointerMove = (event: PointerEvent) => { if (!this.draggingCamera) return; this.cameraYaw -= (event.clientX - this.lastPointer.x) * 0.008; this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + (event.clientY - this.lastPointer.y) * 0.006, 0.12, 1.15); this.lastPointer = { x: event.clientX, y: event.clientY }; };
  private pointerUp = () => { this.draggingCamera = false; };
  private resize = () => { const { clientWidth: w, clientHeight: h } = this.container; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); };
  private animate = () => { requestAnimationFrame(this.animate); const dt = this.clock.getDelta(); this.timeOfDay += dt * 0.1; if (this.timeOfDay >= 24) this.timeOfDay = 0; this.updateSun(); const forward = new THREE.Vector2(Math.sin(this.cameraYaw), -Math.cos(this.cameraYaw)); const right = new THREE.Vector2(Math.cos(this.cameraYaw), Math.sin(this.cameraYaw)); let moveX = 0, moveZ = 0; if (this.keys.has("w")) { moveX += forward.x; moveZ += forward.y; } if (this.keys.has("s")) { moveX -= forward.x; moveZ -= forward.y; } if (this.keys.has("a")) { moveX -= right.x; moveZ -= right.y; } if (this.keys.has("d")) { moveX += right.x; moveZ += right.y; } const walking = Boolean(moveX || moveZ); if (walking) { const length = Math.hypot(moveX, moveZ); moveX /= length; moveZ /= length; this.position.x = THREE.MathUtils.clamp(this.position.x + moveX * 8 * dt, -100, 100); this.position.z = THREE.MathUtils.clamp(this.position.z + moveZ * 8 * dt, -100, 100); this.player.position.set(this.position.x, this.position.y, this.position.z); this.player.rotation.y = Math.atan2(moveX, moveZ); if (performance.now() - this.lastSent > 80) { this.lastSent = performance.now(); this.onMove(this.position); } } this.animateCharacter(this.player, walking); const horizontalDistance = Math.cos(this.cameraPitch) * 13; const target = new THREE.Vector3(this.position.x, 1, this.position.z); const desiredCamera = new THREE.Vector3(target.x - forward.x * horizontalDistance, target.y + Math.sin(this.cameraPitch) * 13, target.z - forward.y * horizontalDistance); this.camera.position.lerp(desiredCamera, 0.12); this.camera.lookAt(target); this.renderer.render(this.scene, this.camera); };
  upsertRemote(id: string, player: RemotePlayer) { let mesh = this.remotes.get(id); if (!mesh) { mesh = this.createCharacter(0x4d8dff); this.remotes.set(id, mesh); this.scene.add(mesh); } mesh.position.set(player.position.x, 0, player.position.z); }
  removeRemote(id: string) { const mesh = this.remotes.get(id); if (mesh) this.scene.remove(mesh); this.remotes.delete(id); }
  dispose() { window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp); window.removeEventListener("resize", this.resize); this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown); this.renderer.domElement.removeEventListener("pointermove", this.pointerMove); this.renderer.domElement.removeEventListener("pointerup", this.pointerUp); this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp); this.renderer.dispose(); this.container.replaceChildren(); }
}
