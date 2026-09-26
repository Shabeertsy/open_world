import * as THREE from "three";

type Position = { x: number; y: number; z: number };
type RemotePlayer = { position: Position };
export class World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
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

  constructor(private container: HTMLElement, private onMove: (position: Position) => void) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#87bfe8");
    this.scene.fog = new THREE.Fog("#87bfe8", 45, 180);
    this.scene.add(new THREE.HemisphereLight(0xdff4ff, 0x415b38, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(20, 30, 10); sun.castShadow = true; this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#5d9c56", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.player.position.set(this.position.x, this.position.y, this.position.z); this.scene.add(this.player);
    for (let i = -3; i <= 3; i++) this.addLandmark(i * 13, (i % 2 ? 12 : -15));
    for (let i = 0; i < 30; i++) this.addRock((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
    for (let i = 0; i < 40; i++) this.addBush((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
    for (let i = 0; i < 15; i++) this.addCloud((Math.random() - 0.5) * 100, 15 + Math.random() * 10, (Math.random() - 0.5) * 100);
    window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp); window.addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown); this.renderer.domElement.addEventListener("pointermove", this.pointerMove); this.renderer.domElement.addEventListener("pointerup", this.pointerUp); this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
    this.resize(); this.animate();
  }

  private addLandmark(x: number, z: number) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, 2), new THREE.MeshStandardMaterial({ color: "#795548" })); trunk.position.y = 1; trunk.castShadow = true; trunk.receiveShadow = true;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 8), new THREE.MeshStandardMaterial({ color: "#246b3a" })); leaves.position.y = 4; leaves.castShadow = true; leaves.receiveShadow = true;
    tree.add(trunk, leaves); tree.position.set(x, 0, z); this.scene.add(tree);
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
  private animate = () => { requestAnimationFrame(this.animate); const dt = this.clock.getDelta(); const forward = new THREE.Vector2(Math.sin(this.cameraYaw), -Math.cos(this.cameraYaw)); const right = new THREE.Vector2(Math.cos(this.cameraYaw), Math.sin(this.cameraYaw)); let moveX = 0, moveZ = 0; if (this.keys.has("w")) { moveX += forward.x; moveZ += forward.y; } if (this.keys.has("s")) { moveX -= forward.x; moveZ -= forward.y; } if (this.keys.has("a")) { moveX -= right.x; moveZ -= right.y; } if (this.keys.has("d")) { moveX += right.x; moveZ += right.y; } const walking = Boolean(moveX || moveZ); if (walking) { const length = Math.hypot(moveX, moveZ); moveX /= length; moveZ /= length; this.position.x = THREE.MathUtils.clamp(this.position.x + moveX * 8 * dt, -100, 100); this.position.z = THREE.MathUtils.clamp(this.position.z + moveZ * 8 * dt, -100, 100); this.player.position.set(this.position.x, this.position.y, this.position.z); this.player.rotation.y = Math.atan2(moveX, moveZ); if (performance.now() - this.lastSent > 80) { this.lastSent = performance.now(); this.onMove(this.position); } } this.animateCharacter(this.player, walking); const horizontalDistance = Math.cos(this.cameraPitch) * 13; const target = new THREE.Vector3(this.position.x, 1, this.position.z); const desiredCamera = new THREE.Vector3(target.x - forward.x * horizontalDistance, target.y + Math.sin(this.cameraPitch) * 13, target.z - forward.y * horizontalDistance); this.camera.position.lerp(desiredCamera, 0.12); this.camera.lookAt(target); this.renderer.render(this.scene, this.camera); };
  upsertRemote(id: string, player: RemotePlayer) { let mesh = this.remotes.get(id); if (!mesh) { mesh = this.createCharacter(0x4d8dff); this.remotes.set(id, mesh); this.scene.add(mesh); } mesh.position.set(player.position.x, 0, player.position.z); }
  removeRemote(id: string) { const mesh = this.remotes.get(id); if (mesh) this.scene.remove(mesh); this.remotes.delete(id); }
  dispose() { window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp); window.removeEventListener("resize", this.resize); this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown); this.renderer.domElement.removeEventListener("pointermove", this.pointerMove); this.renderer.domElement.removeEventListener("pointerup", this.pointerUp); this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp); this.renderer.dispose(); this.container.replaceChildren(); }
}
