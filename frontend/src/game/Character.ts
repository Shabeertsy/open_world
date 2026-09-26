import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Creates a pleated flared dress skirt geometry with natural drape and bottom hem trim.
 * Mixamo bone coordinates are in centimeters.
 */
function createPleatedSkirtGeometry(
  topRadius = 19.5,
  bottomRadius = 34,
  height = 36,
  segments = 28
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments, 5, true);
  geo.translate(0, -height / 2, 0);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const depthFrac = -y / height; // 0 at waist, 1 at bottom hem

    // Organic pleats that flare out toward the bottom
    const pleat = Math.sin(angle * 14) * (1.5 * depthFrac);
    const flare = (r + pleat) / r;
    pos.setX(i, x * flare);
    pos.setZ(i, z * flare * 1.08); // slightly deeper front-to-back drape
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates an adventurer traveler's hat tilted naturally to keep the face illuminated.
 */
function createAdventurerHat(accentHex: number): THREE.Group {
  const hatGroup = new THREE.Group();
  hatGroup.name = "AdventurerHat";

  const feltMat = new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 0.85 });
  const bandMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.6 });
  const buckleMat = new THREE.MeshStandardMaterial({ color: 0xecd16d, roughness: 0.3, metalness: 0.85 });

  // Curved brim
  const brimGeo = new THREE.CylinderGeometry(19, 19, 1.2, 24);
  const pos = brimGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (Math.abs(x) > 10) {
      pos.setY(i, pos.getY(i) + (Math.abs(x) - 10) * 0.16);
    }
  }
  brimGeo.computeVertexNormals();
  const brim = new THREE.Mesh(brimGeo, feltMat);
  brim.castShadow = true;
  hatGroup.add(brim);

  // Crown with subtle crease
  const crownGeo = new THREE.CylinderGeometry(11, 13, 11, 24);
  crownGeo.translate(0, 5.5, 0);
  const crown = new THREE.Mesh(crownGeo, feltMat);
  crown.castShadow = true;
  hatGroup.add(crown);

  // Hatband
  const bandGeo = new THREE.CylinderGeometry(13.1, 13.2, 2.5, 24);
  bandGeo.translate(0, 1.6, 0);
  const band = new THREE.Mesh(bandGeo, bandMat);
  hatGroup.add(band);

  // Polished gold buckle on hatband
  const buckleGeo = new THREE.BoxGeometry(1.2, 3.2, 0.8);
  const buckle = new THREE.Mesh(buckleGeo, buckleMat);
  buckle.position.set(13.1, 1.6, 0);
  hatGroup.add(buckle);

  // Positioned and tilted back slightly so the face stays sunlit and visible
  hatGroup.position.set(0, 17.2, 1.2);
  hatGroup.rotation.x = 0.14;
  return hatGroup;
}

/**
 * Creates an adventurer leather backpack / satchel with brass buckles and bedroll.
 */
function createBackpack(): THREE.Group {
  const packGroup = new THREE.Group();
  packGroup.name = "AdventurerPack";

  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.72 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x27170e, roughness: 0.85 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xdeb853, roughness: 0.35, metalness: 0.85 });
  const bedrollMat = new THREE.MeshStandardMaterial({ color: 0x555042, roughness: 0.9 });

  // Main pouch
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(19, 23, 10), leatherMat);
  pouch.castShadow = true;
  packGroup.add(pouch);

  // Top Flap
  const flap = new THREE.Mesh(new THREE.BoxGeometry(20, 9, 10.5), leatherMat);
  flap.position.set(0, 8, 1);
  packGroup.add(flap);

  // Shoulder straps
  const strap1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 24, 11), strapMat);
  strap1.position.set(-5.5, 0, 0);
  packGroup.add(strap1);
  const strap2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 24, 11), strapMat);
  strap2.position.set(5.5, 0, 0);
  packGroup.add(strap2);

  // Brass buckles
  const buckle1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 1.2), brassMat);
  buckle1.position.set(-5.5, 3, -5.5);
  packGroup.add(buckle1);
  const buckle2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 1.2), brassMat);
  buckle2.position.set(5.5, 3, -5.5);
  packGroup.add(buckle2);

  // Bedroll rolled on top
  const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 21, 12), bedrollMat);
  bedroll.rotation.z = Math.PI / 2;
  bedroll.position.set(0, 14.5, -1);
  packGroup.add(bedroll);

  packGroup.position.set(0, 4, -13);
  return packGroup;
}

export class Character {
  public group = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private currentAction?: THREE.AnimationAction;
  private currentActionName = "idle";

  constructor(gltfLoader: GLTFLoader, primaryColorHex: number) {
    gltfLoader.load('/Xbot.glb', (gltf) => {
      const model = gltf.scene;

      // Extract all skeleton bones
      const skeletonBones: THREE.Bone[] = [];
      model.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh && child.skeleton) {
          for (const bone of child.skeleton.bones) {
            if (!skeletonBones.includes(bone)) skeletonBones.push(bone);
          }
        }
      });

      // Harmonious outfit palette
      const dressCol = new THREE.Color(primaryColorHex); // e.g. rich emerald or sapphire
      const blouseCol = new THREE.Color(0xf4efe6); // crisp linen/ivory blouse
      const goldTrimCol = new THREE.Color(0xedd482); // gold embroidery trim & buttons
      const beltCol = new THREE.Color(0x281910); // rich dark leather
      const buckleCol = new THREE.Color(0xf4d360); // polished brass buckle
      const leggingsCol = new THREE.Color(0x1a1e27); // dark fitted tights/leggings
      const bootsCol = new THREE.Color(0x321e14); // rich leather adventurer boots
      const soleCol = new THREE.Color(0x101010); // durable rubber soles
      const skinCol = new THREE.Color(0xdfa57b); // warm healthy skin tone
      const lipCol = new THREE.Color(0xb56969); // soft natural lips
      const eyeCol = new THREE.Color(0x281c15); // eyebrows & eye accents
      const hairCol = new THREE.Color(0x1f1712); // rich espresso dark hair

      // Apply tailored clothing & skin vertex colors to all skinned meshes
      model.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          const geo = child.geometry;
          const pos = geo.attributes.position;
          const skinIdx = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
          const skinWt = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;

          if (pos && skinIdx && skinWt) {
            const count = pos.count;
            const colors = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
              const x = pos.getX(i);
              const y = pos.getY(i);
              const z = pos.getZ(i);

              // Find the dominant bone for this vertex
              let maxW = -1;
              let maxBoneIdx = 0;
              const wX = skinWt.getX(i);
              if (wX > maxW) { maxW = wX; maxBoneIdx = skinIdx.getX(i); }
              const wY = skinWt.getY(i);
              if (wY > maxW) { maxW = wY; maxBoneIdx = skinIdx.getY(i); }
              const wZ = skinWt.getZ(i);
              if (wZ > maxW) { maxW = wZ; maxBoneIdx = skinIdx.getZ(i); }
              const wW = skinWt.getW(i);
              if (wW > maxW) { maxW = wW; maxBoneIdx = skinIdx.getW(i); }

              const boneName = (skeletonBones[maxBoneIdx]?.name || "").toLowerCase();

              let c = dressCol;

              // 1. Shoes & Adventurer Boots
              if (boneName.includes("foot") || boneName.includes("toe") || y < 0.16) {
                if (y < 0.04) {
                  c = soleCol;
                } else if (y > 0.45) {
                  c = goldTrimCol; // boot collar trim
                } else {
                  c = bootsCol;
                }
              }
              // 2. Leggings / Tights under the skirt
              else if (boneName.includes("leg") || (boneName.includes("hips") && y < 0.98)) {
                if (y >= 0.85 && y < 0.98) {
                  c = dressCol; // upper hip dress section
                } else {
                  c = leggingsCol;
                }
              }
              // 3. Waist Leather Corset Belt & Golden Buckle
              else if (y >= 0.98 && y <= 1.05 && Math.abs(x) < 0.22) {
                if (Math.abs(x) < 0.04 && z > 0.06) {
                  c = buckleCol; // central gold buckle
                } else {
                  c = beltCol;
                }
              }
              // 4. Dress Bodice, Blouse Neckline & Gold Buttons
              else if (
                boneName.includes("spine") ||
                boneName.includes("shoulder") ||
                (boneName.includes("arm") && !boneName.includes("forearm"))
              ) {
                // Gold buttons down the front center
                if (z > 0.06 && Math.abs(x) < 0.02) {
                  c = goldTrimCol;
                }
                // Crisp ivory blouse chemise at neckline & collar
                else if (y > 1.38 && Math.abs(x) < 0.08) {
                  c = blouseCol;
                }
                // Blouse sleeve puff
                else if (boneName.includes("shoulder") || boneName.includes("arm")) {
                  c = blouseCol;
                }
                // Tailored dress bodice
                else {
                  c = dressCol;
                }
              }
              // 5. Forearms & Cuffs
              else if (boneName.includes("forearm")) {
                if (Math.abs(x) < 0.52) {
                  c = blouseCol; // blouse sleeves
                } else if (Math.abs(x) < 0.56) {
                  c = goldTrimCol; // sleeve cuff
                } else {
                  c = skinCol;
                }
              }
              // 6. Hands & Fingers
              else if (
                boneName.includes("hand") ||
                boneName.includes("finger") ||
                boneName.includes("thumb") ||
                boneName.includes("index") ||
                boneName.includes("middle") ||
                boneName.includes("ring") ||
                boneName.includes("pinky")
              ) {
                c = skinCol;
              }
              // 7. Neck & Collar
              else if (boneName.includes("neck")) {
                c = y < 1.48 ? blouseCol : skinCol;
              }
              // 8. Head (Face, Features, Hair)
              else if (boneName.includes("head")) {
                if (y > 1.68 || (z < -0.01 && y > 1.56)) {
                  c = hairCol;
                } else if (y >= 1.58 && y <= 1.63 && Math.abs(x) >= 0.03 && Math.abs(x) <= 0.08 && z > 0.06) {
                  c = eyeCol;
                } else if (y >= 1.49 && y <= 1.53 && Math.abs(x) < 0.03 && z > 0.08) {
                  c = lipCol;
                } else {
                  c = skinCol;
                }
              }

              colors[i * 3] = c.r;
              colors[i * 3 + 1] = c.g;
              colors[i * 3 + 2] = c.b;
            }

            geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            child.material = new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.72,
              metalness: 0.08,
            });
          }
        }
      });

      this.group.add(model);

      // Find key bones for accessories
      const findBone = (term: string) =>
        skeletonBones.find((b) => b.name.toLowerCase().includes(term.toLowerCase()));

      const hipsBone = findBone("hips");
      const spineBone = findBone("spine1") || findBone("spine");
      const headBone = skeletonBones.find(
        (b) => b.name.toLowerCase().includes("head") && !b.name.toLowerCase().includes("top")
      );

      // === 3D FLARED PLEATED SKIRT (Attached to Hips Bone) ===
      if (hipsBone) {
        const skirtGeo = createPleatedSkirtGeometry(19.5, 34, 36);
        const skirtMat = new THREE.MeshStandardMaterial({
          color: primaryColorHex,
          roughness: 0.75,
          side: THREE.DoubleSide,
        });
        const skirt = new THREE.Mesh(skirtGeo, skirtMat);
        skirt.name = "DressSkirt";
        skirt.position.set(0, -6, 0);
        skirt.castShadow = true;
        skirt.receiveShadow = true;
        hipsBone.add(skirt);

        // Skirt hem gold embroidery band
        const hemGeo = new THREE.CylinderGeometry(34, 34.4, 2, 28, 1, true);
        const hemMat = new THREE.MeshStandardMaterial({ color: 0xedd482, roughness: 0.5, side: THREE.DoubleSide });
        const hem = new THREE.Mesh(hemGeo, hemMat);
        hem.position.set(0, -23, 0);
        hipsBone.add(hem);

        // Leather waistband with gold buckle accent
        const waistGeo = new THREE.CylinderGeometry(19.8, 20.2, 5.5, 24);
        const waistMat = new THREE.MeshStandardMaterial({ color: 0x281910, roughness: 0.65 });
        const waist = new THREE.Mesh(waistGeo, waistMat);
        waist.name = "DressWaistband";
        waist.position.set(0, 1.5, 0);
        hipsBone.add(waist);

        // Hanging hip belt pouch
        const pouchGeo = new THREE.BoxGeometry(6, 8, 4);
        const pouchMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.7 });
        const pouch = new THREE.Mesh(pouchGeo, pouchMat);
        pouch.position.set(16, -3, 3);
        pouch.rotation.z = -0.15;
        pouch.castShadow = true;
        hipsBone.add(pouch);
      }

      // === 3D ADVENTURER HAT (Attached to Head Bone) ===
      if (headBone) {
        const hat = createAdventurerHat(primaryColorHex);
        headBone.add(hat);
      }

      // === 3D TRAVELER SATCHEL / BACKPACK (Attached to Spine Bone) ===
      if (spineBone) {
        const pack = createBackpack();
        spineBone.add(pack);
      }

      // Setup animations
      this.mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        this.actions[clip.name.toLowerCase()] = this.mixer!.clipAction(clip);
      });

      const idle = this.actions["idle"];
      if (idle) {
        idle.play();
        this.currentAction = idle;
        this.currentActionName = "idle";
      }
    });

    this.group.scale.set(0.85, 0.85, 0.85);
  }

  public update(dt: number, walking: boolean, running = false) {
    if (this.mixer) this.mixer.update(dt);
    if (!this.mixer) return;

    let targetName = "idle";
    if (walking) {
      targetName = running ? "run" : "walk";
    }

    if (!this.currentAction && this.actions["idle"]) {
      this.currentAction = this.actions["idle"];
      this.currentAction.play();
      this.currentActionName = "idle";
    }

    if (this.currentActionName !== targetName) {
      const prevAction = this.currentAction;
      const nextAction = this.actions[targetName] || this.actions["walk"] || this.actions["run"];

      if (nextAction && nextAction !== prevAction) {
        // Pacing adjustments for walking vs running
        if (targetName === "run") {
          nextAction.timeScale = 1.22;
        } else if (targetName === "walk") {
          nextAction.timeScale = 1.08;
        } else {
          nextAction.timeScale = 1.0;
        }

        nextAction.enabled = true;
        nextAction.setEffectiveTimeScale(nextAction.timeScale);
        nextAction.setEffectiveWeight(1.0);
        nextAction.reset();
        nextAction.play();

        if (prevAction) {
          nextAction.crossFadeFrom(prevAction, 0.2, true);
        }

        this.currentAction = nextAction;
        this.currentActionName = targetName;
      }
    }
  }

  public setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
  }

  public setRotation(y: number) {
    this.group.rotation.y = y;
  }
}
