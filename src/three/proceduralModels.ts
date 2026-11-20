import * as THREE from 'three';
import {
  EquipmentCategory,
  LayoutObject,
  ProductDefinition,
  VisualVariant,
} from '../types/project';

// Shared geometry helpers with bottom-center pivot (y = 0 at floor)

function createBoxPart(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  px: number,
  py: number,
  pz: number,
  castShadow = true
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(px, py, pz);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

function createCylinderPart(
  rt: number,
  rb: number,
  h: number,
  mat: THREE.Material,
  px: number,
  py: number,
  pz: number,
  rx = 0,
  rz = 0,
  segs = 14
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rt, rb, h, segs);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(px, py, pz);
  mesh.rotation.set(rx, 0, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildEquipmentGroup(
  obj: LayoutObject,
  variant: VisualVariant
): { group: THREE.Group; statusBeacon?: THREE.Mesh; rollerMeshes?: THREE.Mesh[] } {
  const group = new THREE.Group();
  const { length: L, width: W, height: H } = obj.geometry.dimensions;
  const baseColor = new THREE.Color(obj.rendering.color || '#334155');
  const isEng = variant === 'engineering';

  const frameMat = new THREE.MeshStandardMaterial({
    color: isEng ? 0x94a3b8 : baseColor,
    roughness: isEng ? 0.6 : 0.42,
    metalness: isEng ? 0.15 : 0.65,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: isEng ? 0x475569 : 0x1e293b,
    roughness: 0.35,
    metalness: 0.8,
  });
  const stainlessMat = new THREE.MeshStandardMaterial({
    color: isEng ? 0xcbd5e1 : 0xdbe2ea,
    roughness: 0.28,
    metalness: 0.82,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.4,
    metalness: 0.3,
  });
  const safetyYellowMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.45,
    metalness: 0.25,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: isEng ? 0xe2e8f0 : 0x64748b,
    roughness: 0.72,
    metalness: 0.15,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.36,
  });

  const beaconGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    emissive: 0x000000,
    emissiveIntensity: 0.7,
    roughness: 0.25,
    metalness: 0.1,
  });
  let statusBeacon: THREE.Mesh | undefined;
  const rollerMeshes: THREE.Mesh[] = [];

  const cat: EquipmentCategory = obj.category;

  // ─── 1. Conveyors (Belt, Roller, Heavy Pallet, Incline) ─────────────────
  if (
    cat === 'conveyor_belt' ||
    cat === 'roller_conveyor' ||
    cat === 'pallet_conveyor' ||
    cat === 'incline_conveyor'
  ) {
    const legH = Math.max(0.18, H - 0.14);
    const frameH = cat === 'pallet_conveyor' ? 0.16 : 0.12;
    const beltMat = new THREE.MeshStandardMaterial({
      color: isEng ? 0x334155 : 0x18181b,
      roughness: 0.85,
      metalness: 0.05,
    });

    if (cat === 'incline_conveyor') {
      const lowY = 0.42;
      const highY = Math.max(0.9, H);
      const midY = (lowY + highY) / 2;
      const rise = highY - lowY;
      const slopeLen = Math.hypot(L, rise);
      const tilt = Math.atan2(rise, L);

      const bedGroup = new THREE.Group();
      bedGroup.position.set(0, midY, 0);
      bedGroup.rotation.z = tilt;
      bedGroup.add(createBoxPart(slopeLen, frameH, 0.06, frameMat, 0, -0.02, -W / 2 + 0.03));
      bedGroup.add(createBoxPart(slopeLen, frameH, 0.06, frameMat, 0, -0.02, W / 2 - 0.03));
      bedGroup.add(createBoxPart(slopeLen - 0.06, 0.04, W - 0.12, beltMat, 0, 0.02, 0));
      const cleatCount = Math.max(5, Math.floor(slopeLen / 0.45));
      for (let i = 0; i < cleatCount; i++) {
        const cx = -slopeLen / 2 + 0.2 + (i / Math.max(1, cleatCount - 1)) * (slopeLen - 0.4);
        bedGroup.add(createBoxPart(0.03, 0.045, W - 0.16, safetyYellowMat, cx, 0.055, 0));
      }
      group.add(bedGroup);

      // End & middle support leg pairs reaching floor y=0
      for (const frac of [-0.42, 0, 0.42]) {
        const lx = L * frac;
        const topY = midY + Math.tan(tilt) * lx - 0.04;
        const lh = Math.max(0.25, topY);
        group.add(createBoxPart(0.06, lh, 0.06, darkSteelMat, lx, lh / 2, -W / 2 + 0.06));
        group.add(createBoxPart(0.06, lh, 0.06, darkSteelMat, lx, lh / 2, W / 2 - 0.06));
        group.add(createBoxPart(0.04, 0.04, W - 0.1, darkSteelMat, lx, 0.2, 0));
      }
      statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
      statusBeacon.position.set(L / 2 - 0.2, highY + 0.12, W / 2 - 0.06);
      group.add(statusBeacon);
    } else {
      // Flat Belt, Roller, or Heavy Pallet Roller Conveyor
      group.add(createBoxPart(L, frameH, 0.07, frameMat, 0, H - frameH / 2, -W / 2 + 0.035));
      group.add(createBoxPart(L, frameH, 0.07, frameMat, 0, H - frameH / 2, W / 2 - 0.035));

      if (cat === 'conveyor_belt') {
        group.add(createBoxPart(L - 0.08, 0.04, W - 0.14, beltMat, 0, H - 0.02, 0));
        group.add(createCylinderPart(0.06, 0.06, W - 0.06, darkSteelMat, -L / 2 + 0.05, H - 0.06, 0, Math.PI / 2));
        group.add(createCylinderPart(0.06, 0.06, W - 0.06, darkSteelMat, L / 2 - 0.05, H - 0.06, 0, Math.PI / 2));
      } else {
        const pitchTarget = cat === 'pallet_conveyor' ? 0.34 : 0.24;
        const rRadius = cat === 'pallet_conveyor' ? 0.048 : 0.032;
        const rollerMat = cat === 'pallet_conveyor' ? stainlessMat : deckMat;
        const rollerCount = Math.max(4, Math.min(48, Math.floor(L / pitchTarget)));
        const pitch = (L - 0.18) / rollerCount;
        for (let i = 0; i < rollerCount; i++) {
          const rx = -L / 2 + 0.09 + (i + 0.5) * pitch;
          const roller = createCylinderPart(rRadius, rRadius, W - 0.15, rollerMat, rx, H - rRadius, 0, Math.PI / 2, 0, 12);
          group.add(roller);
          rollerMeshes.push(roller);
        }
        if (cat === 'pallet_conveyor') {
          // Chain guard strip along front rail
          group.add(createBoxPart(L - 0.1, 0.09, 0.05, safetyYellowMat, 0, H - frameH / 2, W / 2 + 0.025));
        }
      }

      group.add(createBoxPart(0.32, 0.22, 0.24, accentMat, L / 2 - 0.35, Math.max(0.18, H - 0.18), W / 2 + 0.11));

      const legPairs = Math.max(2, Math.min(12, Math.ceil(L / 2.4) + 1));
      for (let i = 0; i < legPairs; i++) {
        const lx = -L / 2 + 0.22 + (i / (legPairs - 1)) * (L - 0.44);
        group.add(createBoxPart(0.07, legH, 0.07, darkSteelMat, lx, legH / 2, -W / 2 + 0.06));
        group.add(createBoxPart(0.07, legH, 0.07, darkSteelMat, lx, legH / 2, W / 2 - 0.06));
        group.add(createBoxPart(0.045, 0.045, W - 0.1, darkSteelMat, lx, Math.min(0.22, legH * 0.45), 0));
      }

      statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
      statusBeacon.position.set(L / 2 - 0.25, H + 0.14, W / 2 - 0.08);
      group.add(statusBeacon);
    }

  // ─── 2. Wooden Pallets (Euro 1.2x0.8, Std 1.2x1.0, Heavy 1.2x1.2) ───────
  } else if (
    cat === 'pallet_wood_euro' ||
    cat === 'pallet_wood_std' ||
    cat === 'pallet_wood_heavy'
  ) {
    const woodMain = new THREE.MeshStandardMaterial({
      color: isEng ? 0xd6b48a : new THREE.Color(obj.rendering.color || '#B45309'),
      roughness: 0.88,
      metalness: 0.02,
    });
    const woodDark = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.92,
      metalness: 0.02,
    });
    const botH = H * 0.18;
    const blockH = H * 0.48;
    const stringerH = H * 0.15;
    const slatH = H * 0.19;

    // 3 bottom runner boards along length
    for (const bz of [-W * 0.42, 0, W * 0.42]) {
      group.add(createBoxPart(L, botH, W * 0.13, woodDark, 0, botH / 2, bz));
    }
    // 9 spacer blocks (3 x 3 grid)
    const bxCoords = [-L * 0.41, 0, L * 0.41];
    const bzCoords = [-W * 0.42, 0, W * 0.42];
    for (const bx of bxCoords) {
      for (const bz of bzCoords) {
        group.add(createBoxPart(L * 0.14, blockH, W * 0.13, woodDark, bx, botH + blockH / 2, bz));
      }
    }
    // 3 transverse stringer boards along width
    const stringerY = botH + blockH + stringerH / 2;
    for (const bx of bxCoords) {
      group.add(createBoxPart(L * 0.13, stringerH, W, woodMain, bx, stringerY, 0));
    }
    // Top slatted deck boards along length
    const slatCount = cat === 'pallet_wood_heavy' ? 7 : cat === 'pallet_wood_std' ? 6 : 5;
    const slatY = botH + blockH + stringerH + slatH / 2;
    for (let i = 0; i < slatCount; i++) {
      const sz = -W * 0.42 + (i / (slatCount - 1)) * (W * 0.84);
      group.add(createBoxPart(L, slatH, (W / slatCount) * 0.68, woodMain, 0, slatY, sz));
    }

  // ─── 3. Plastic HDPE Pallets (Euro, Heavy Rackable, Compact) ─────────────
  } else if (
    cat === 'pallet_plastic_euro' ||
    cat === 'pallet_plastic_heavy' ||
    cat === 'pallet_plastic_compact'
  ) {
    const hdpeMat = new THREE.MeshStandardMaterial({
      color: isEng ? 0x60a5fa : new THREE.Color(obj.rendering.color || '#1D4ED8'),
      roughness: 0.36,
      metalness: 0.08,
    });
    const hdpeTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.42,
      metalness: 0.1,
    });
    const runnerH = H * 0.18;
    const legH = H * 0.5;
    const deckH = H * 0.32;

    // Molded perimeter bottom skids
    for (const bz of [-W * 0.42, 0, W * 0.42]) {
      group.add(createBoxPart(L, runnerH, W * 0.14, hdpeTrimMat, 0, runnerH / 2, bz));
    }
    // 9 ribbed hollow columns
    for (const bx of [-L * 0.41, 0, L * 0.41]) {
      for (const bz of [-W * 0.42, 0, W * 0.42]) {
        group.add(createBoxPart(L * 0.14, legH, W * 0.14, hdpeTrimMat, bx, runnerH + legH / 2, bz));
      }
    }
    // Molded perimeter top rim + internal grid ribs
    const topY = runnerH + legH + deckH / 2;
    group.add(createBoxPart(L, deckH, 0.07, hdpeMat, 0, topY, -W / 2 + 0.035));
    group.add(createBoxPart(L, deckH, 0.07, hdpeMat, 0, topY, W / 2 - 0.035));
    group.add(createBoxPart(0.07, deckH, W, hdpeMat, -L / 2 + 0.035, topY, 0));
    group.add(createBoxPart(0.07, deckH, W, hdpeMat, L / 2 - 0.035, topY, 0));
    const ribsX = cat === 'pallet_plastic_compact' ? 4 : 6;
    for (let i = 1; i < ribsX; i++) {
      const rx = -L / 2 + (i / ribsX) * L;
      group.add(createBoxPart(0.045, deckH * 0.85, W - 0.08, hdpeMat, rx, topY, 0));
    }
    for (let j = 1; j < 4; j++) {
      const rz = -W / 2 + (j / 4) * W;
      group.add(createBoxPart(L - 0.08, deckH * 0.85, 0.045, hdpeMat, 0, topY, rz));
    }
    if (cat === 'pallet_plastic_heavy') {
      // Visible galvanized steel reinforcement channel
      group.add(createBoxPart(L * 0.92, 0.025, 0.05, stainlessMat, 0, runnerH + legH * 0.9, 0));
    }

  // ─── 4. Stretch Wrappers (Turntable & Overhead Rotary Arm) ───────────────
  } else if (cat === 'stretch_wrapper_turntable') {
    const filmMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
    });
    // Heavy floor base plate + ramp apron
    group.add(createBoxPart(L * 0.92, 0.06, W * 0.92, darkSteelMat, 0, 0.03, 0));
    // Rotating circular turntable platter
    const platterR = Math.min(L * 0.34, W * 0.44);
    group.add(createCylinderPart(platterR, platterR + 0.02, 0.09, frameMat, -L * 0.12, 0.095, 0, 0, 0, 28));
    group.add(createCylinderPart(platterR * 0.92, platterR * 0.92, 0.015, safetyYellowMat, -L * 0.12, 0.145, 0, 0, 0, 28));
    // Vertical pre-stretch mast column
    const mastX = L * 0.34;
    group.add(createBoxPart(0.32, H - 0.08, 0.36, frameMat, mastX, H / 2, 0));
    group.add(createBoxPart(0.36, 0.08, 0.4, accentMat, mastX, H - 0.04, 0));
    // Film roll carriage & LLDPE translucent film spool
    group.add(createBoxPart(0.28, 0.68, 0.44, darkSteelMat, mastX - 0.24, H * 0.46, 0));
    group.add(createCylinderPart(0.11, 0.11, 0.52, filmMat, mastX - 0.32, H * 0.46, 0.12));
    // Control HMI panel on mast side
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0284c7, emissiveIntensity: 0.4 });
    group.add(createBoxPart(0.14, 0.38, 0.28, screenMat, mastX, H * 0.58, W * 0.24));

    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(mastX, H + 0.1, 0);
    group.add(statusBeacon);
  } else if (cat === 'stretch_wrapper_arm') {
    const filmMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
    });
    // 4-post gantry tower
    const postX = L * 0.44;
    const postZ = W * 0.44;
    for (const px of [-postX, postX]) {
      for (const pz of [-postZ, postZ]) {
        group.add(createBoxPart(0.14, H - 0.12, 0.14, frameMat, px, (H - 0.12) / 2, pz));
      }
    }
    // Top gantry frame beams
    group.add(createBoxPart(L * 0.96, 0.16, 0.18, safetyYellowMat, 0, H - 0.08, -postZ));
    group.add(createBoxPart(L * 0.96, 0.16, 0.18, safetyYellowMat, 0, H - 0.08, postZ));
    group.add(createBoxPart(0.22, 0.18, W * 0.96, darkSteelMat, 0, H - 0.08, 0));
    // Central rotary swivel + L-shaped sweeping arm + hanging film carriage
    group.add(createCylinderPart(0.24, 0.24, 0.22, accentMat, 0, H - 0.22, 0, 0, 0, 18));
    group.add(createBoxPart(L * 0.56, 0.1, 0.12, frameMat, L * 0.14, H - 0.34, 0));
    group.add(createBoxPart(0.14, H * 0.56, 0.14, darkSteelMat, L * 0.36, H * 0.58, 0));
    group.add(createCylinderPart(0.11, 0.11, 0.52, filmMat, L * 0.36, H * 0.44, 0.12));
    // Floor roller conveyor bed under rotary arm
    group.add(createBoxPart(L * 0.88, 0.34, W * 0.52, darkSteelMat, 0, 0.17, 0));

    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(postX, H + 0.1, postZ);
    group.add(statusBeacon);

  // ─── 5. Shrink Tunnel, Carton Sealer, Strapping Arch, Palletizer Robot ──
  } else if (cat === 'shrink_tunnel') {
    group.add(createBoxPart(L, 0.42, W * 0.82, darkSteelMat, 0, 0.48, 0));
    group.add(createBoxPart(0.12, 0.42, W * 0.78, darkSteelMat, -L * 0.42, 0.21, 0));
    group.add(createBoxPart(0.12, 0.42, W * 0.78, darkSteelMat, L * 0.42, 0.21, 0));
    // Thermal oven chamber housing
    group.add(createBoxPart(L * 0.62, H * 0.52, W * 0.92, stainlessMat, 0, 0.68 + H * 0.26, 0));
    // Top heater blower stack
    group.add(createCylinderPart(0.22, 0.26, 0.32, accentMat, 0, 0.68 + H * 0.52 + 0.16, 0));
    // Heat curtains at entry & exit
    group.add(createBoxPart(0.03, H * 0.34, W * 0.62, safetyYellowMat, -L * 0.31, 0.86, 0));
    group.add(createBoxPart(0.03, H * 0.34, W * 0.62, safetyYellowMat, L * 0.31, 0.86, 0));
    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(L * 0.28, H, W * 0.42);
    group.add(statusBeacon);
  } else if (cat === 'carton_sealer') {
    group.add(createBoxPart(L, 0.14, W * 0.78, darkSteelMat, 0, 0.68, 0));
    for (const lx of [-L * 0.4, L * 0.4]) {
      group.add(createBoxPart(0.08, 0.66, 0.08, darkSteelMat, lx, 0.33, -W * 0.35));
      group.add(createBoxPart(0.08, 0.66, 0.08, darkSteelMat, lx, 0.33, W * 0.35));
    }
    // Side drive belts
    group.add(createBoxPart(L * 0.65, 0.2, 0.1, safetyYellowMat, 0, 0.84, -W * 0.26));
    group.add(createBoxPart(L * 0.65, 0.2, 0.1, safetyYellowMat, 0, 0.84, W * 0.26));
    // Twin mast & top tape dispenser head
    group.add(createBoxPart(0.1, H - 0.65, 0.09, frameMat, 0, 0.65 + (H - 0.65) / 2, -W * 0.42));
    group.add(createBoxPart(0.1, H - 0.65, 0.09, frameMat, 0, 0.65 + (H - 0.65) / 2, W * 0.42));
    group.add(createBoxPart(0.32, 0.16, W * 0.9, accentMat, 0, H - 0.12, 0));
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
    group.add(createCylinderPart(0.13, 0.13, 0.08, tapeMat, 0, H + 0.04, 0, Math.PI / 2));
    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(0, H + 0.14, W * 0.42);
    group.add(statusBeacon);
  } else if (cat === 'strapping_machine') {
    group.add(createBoxPart(L * 0.86, 0.72, W * 0.74, frameMat, 0, 0.36, 0));
    // Strapping arch frame
    group.add(createBoxPart(0.12, H - 0.72, 0.1, safetyYellowMat, 0, 0.72 + (H - 0.72) / 2, -W * 0.42));
    group.add(createBoxPart(0.12, H - 0.72, 0.1, safetyYellowMat, 0, 0.72 + (H - 0.72) / 2, W * 0.42));
    group.add(createBoxPart(0.14, 0.12, W * 0.92, safetyYellowMat, 0, H - 0.06, 0));
    // Strap coil reel on side
    group.add(createCylinderPart(0.24, 0.24, 0.14, accentMat, -L * 0.45, 0.4, W * 0.34, Math.PI / 2));
    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(0, H + 0.1, W * 0.42);
    group.add(statusBeacon);
  } else if (cat === 'palletizer_robot') {
    const robotMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.35, metalness: 0.45 });
    // Bolted steel floor plinth
    group.add(createCylinderPart(0.55, 0.62, 0.26, darkSteelMat, -L * 0.15, 0.13, 0, 0, 0, 20));
    // Rotating turret
    group.add(createCylinderPart(0.36, 0.42, 0.55, robotMat, -L * 0.15, 0.54, 0, 0, 0, 18));
    // Lower arm (angled up/back)
    const lowerArm = createBoxPart(0.24, H * 0.48, 0.24, robotMat, -L * 0.22, H * 0.48, 0);
    lowerArm.rotation.z = 0.24;
    group.add(lowerArm);
    // Upper boom reaching toward pallet station
    const boom = createBoxPart(L * 0.52, 0.2, 0.2, robotMat, L * 0.05, H * 0.76, 0);
    boom.rotation.z = -0.15;
    group.add(boom);
    // Wrist & vacuum/fork gripper head
    group.add(createCylinderPart(0.09, 0.09, 0.4, darkSteelMat, L * 0.28, H * 0.58, 0));
    group.add(createBoxPart(0.68, 0.08, 0.56, darkSteelMat, L * 0.28, H * 0.4, 0));
    // Safety perimeter corner posts
    for (const pz of [-W * 0.46, W * 0.46]) {
      group.add(createBoxPart(0.08, 1.4, 0.08, safetyYellowMat, -L * 0.46, 0.7, pz));
      group.add(createBoxPart(0.08, 1.4, 0.08, safetyYellowMat, L * 0.46, 0.7, pz));
    }
    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(L * 0.46, 1.49, W * 0.46);
    group.add(statusBeacon);

  // ─── 6. Assembly Table & Workstation ────────────────────────────────────
  } else if (cat === 'assembly_table' || cat === 'workstation') {
    const topH = 0.06;
    const tableY = Math.min(H, 0.92);
    const legH = tableY - topH;

    group.add(createBoxPart(L, topH, W, deckMat, 0, tableY - topH / 2, 0));
    group.add(createBoxPart(L - 0.14, 0.03, W - 0.14, frameMat, 0, 0.22, 0));
    for (const lx of [-L / 2 + 0.06, L / 2 - 0.06]) {
      for (const lz of [-W / 2 + 0.06, W / 2 - 0.06]) {
        group.add(createBoxPart(0.06, legH, 0.06, darkSteelMat, lx, legH / 2, lz));
      }
    }
    const gantryH = 0.72;
    group.add(createBoxPart(0.05, gantryH, 0.05, darkSteelMat, -L / 2 + 0.08, tableY + gantryH / 2, -W / 2 + 0.08));
    group.add(createBoxPart(0.05, gantryH, 0.05, darkSteelMat, L / 2 - 0.08, tableY + gantryH / 2, -W / 2 + 0.08));
    group.add(createBoxPart(L - 0.1, 0.08, 0.14, frameMat, 0, tableY + gantryH, -W / 2 + 0.08));
    group.add(createBoxPart(L * 0.45, 0.08, 0.18, accentMat, 0, tableY + 0.28, -W / 2 + 0.14));

    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(L / 2 - 0.1, tableY + gantryH + 0.13, -W / 2 + 0.08);
    group.add(statusBeacon);

  // ─── 7. Heavy Storage Rack ──────────────────────────────────────────────
  } else if (cat === 'storage_rack') {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.45, metalness: 0.6 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4, metalness: 0.4 });
    const palletMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.85, metalness: 0.05 });

    for (const lx of [-L / 2 + 0.05, 0, L / 2 - 0.05]) {
      for (const lz of [-W / 2 + 0.05, W / 2 - 0.05]) {
        group.add(createBoxPart(0.08, H, 0.08, postMat, lx, H / 2, lz));
      }
    }
    const levels = 3;
    for (let lv = 0; lv < levels; lv++) {
      const ly = 0.25 + lv * ((H - 0.6) / levels);
      group.add(createBoxPart(L, 0.07, 0.05, beamMat, 0, ly, -W / 2 + 0.05));
      group.add(createBoxPart(L, 0.07, 0.05, beamMat, 0, ly, W / 2 - 0.05));
      group.add(createBoxPart(L * 0.42, 0.1, W - 0.16, palletMat, -L * 0.24, ly + 0.08, 0));
      group.add(createBoxPart(L * 0.42, 0.1, W - 0.16, palletMat, L * 0.24, ly + 0.08, 0));
      group.add(createBoxPart(L * 0.36, 0.55, W * 0.72, deckMat, -L * 0.24, ly + 0.4, 0));
      group.add(createBoxPart(L * 0.36, 0.48, W * 0.72, deckMat, L * 0.24, ly + 0.36, 0));
    }

  // ─── 8. Vehicles (Forklift, Electric Pallet Jack, Autonomous AGV) ──────
  } else if (cat === 'forklift') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.38, metalness: 0.35 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9, metalness: 0.05 });

    group.add(createBoxPart(L * 0.58, H * 0.36, W * 0.88, bodyMat, -L * 0.15, 0.22 + H * 0.18, 0));
    group.add(createBoxPart(0.1, H * 0.95, 0.1, darkSteelMat, L * 0.2, H * 0.48, -W * 0.28));
    group.add(createBoxPart(0.1, H * 0.95, 0.1, darkSteelMat, L * 0.2, H * 0.48, W * 0.28));
    group.add(createBoxPart(L * 0.44, 0.05, 0.12, darkSteelMat, L * 0.42, 0.14, -W * 0.22));
    group.add(createBoxPart(L * 0.44, 0.05, 0.12, darkSteelMat, L * 0.42, 0.14, W * 0.22));
    group.add(createBoxPart(L * 0.45, 0.06, W * 0.78, darkSteelMat, -L * 0.12, H * 0.92, 0));
    group.add(createCylinderPart(0.24, 0.24, 0.16, tireMat, L * 0.06, 0.24, -W * 0.42, Math.PI / 2));
    group.add(createCylinderPart(0.24, 0.24, 0.16, tireMat, L * 0.06, 0.24, W * 0.42, Math.PI / 2));
    group.add(createCylinderPart(0.2, 0.2, 0.14, tireMat, -L * 0.34, 0.2, -W * 0.4, Math.PI / 2));
    group.add(createCylinderPart(0.2, 0.2, 0.14, tireMat, -L * 0.34, 0.2, W * 0.4, Math.PI / 2));
  } else if (cat === 'pallet_jack') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.4, metalness: 0.3 });
    group.add(createBoxPart(L * 0.34, 0.52, W * 0.9, bodyMat, -L * 0.32, 0.32, 0));
    group.add(createBoxPart(L * 0.68, 0.08, W * 0.22, darkSteelMat, L * 0.14, 0.1, -W * 0.28));
    group.add(createBoxPart(L * 0.68, 0.08, W * 0.22, darkSteelMat, L * 0.14, 0.1, W * 0.28));
    const tiller = createCylinderPart(0.03, 0.03, H * 0.7, darkSteelMat, -L * 0.38, H * 0.68, 0, 0, 0.35);
    group.add(tiller);
    group.add(createBoxPart(0.06, 0.08, 0.28, darkSteelMat, -L * 0.48, H * 0.95, 0));
  } else if (cat === 'agv_cart') {
    const agvMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.35, metalness: 0.35 });
    const lidarMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x0284c7, emissiveIntensity: 0.35 });
    group.add(createBoxPart(L, H * 0.68, W, darkSteelMat, 0, H * 0.38, 0));
    group.add(createBoxPart(L * 0.94, H * 0.28, W * 0.94, agvMat, 0, H * 0.72, 0));
    group.add(createCylinderPart(W * 0.34, W * 0.34, 0.08, stainlessMat, 0, H * 0.94, 0, 0, 0, 20));
    group.add(createBoxPart(0.14, 0.09, 0.14, lidarMat, L * 0.45, H * 0.28, 0));

  // ─── 9. Buffer ──────────────────────────────────────────────────────────
  } else if (cat === 'buffer') {
    group.add(createBoxPart(L, 0.08, W, darkSteelMat, 0, 0.04, 0));
    group.add(createBoxPart(L - 0.1, H - 0.12, W - 0.1, deckMat, 0, (H - 0.04) / 2, 0));
    group.add(createBoxPart(L, 0.06, 0.06, accentMat, 0, H, -W / 2 + 0.04));
    group.add(createBoxPart(L, 0.06, 0.06, accentMat, 0, H, W / 2 - 0.04));

  // ─── 10. Specialized Industrial Machines & Default Fallback ─────────────
  } else {
    group.add(createBoxPart(L, H * 0.16, W, darkSteelMat, 0, H * 0.08, 0));
    group.add(createBoxPart(L * 0.82, H * 0.68, W * 0.88, frameMat, -L * 0.05, H * 0.16 + H * 0.34, 0));
    group.add(createBoxPart(L * 0.22, H * 0.62, W * 0.35, deckMat, L * 0.36, H * 0.16 + H * 0.31, W * 0.26));
    group.add(createBoxPart(L * 0.84, 0.08, W * 0.9, accentMat, -L * 0.05, H * 0.86, 0));

    if (cat === 'injection_molding') {
      group.add(createCylinderPart(0.22, 0.08, 0.45, deckMat, L * 0.25, H + 0.15, 0));
      group.add(createCylinderPart(0.11, 0.11, L * 0.45, darkSteelMat, L * 0.22, H * 0.58, 0, 0, Math.PI / 2));
    } else if (cat === 'hydraulic_press') {
      group.add(createBoxPart(L * 0.9, H * 0.22, W * 0.92, darkSteelMat, 0, H * 0.92, 0));
      group.add(createCylinderPart(0.18, 0.18, H * 0.35, accentMat, 0, H * 0.62, 0));
    } else if (cat === 'painting_equipment') {
      group.add(createCylinderPart(0.22, 0.22, 0.7, darkSteelMat, 0, H + 0.32, 0));
    } else if (cat === 'testing_machine' || cat === 'checkweigher') {
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0284c7, emissiveIntensity: 0.4 });
      group.add(createBoxPart(0.08, 0.42, 0.62, screenMat, L * 0.38, H * 0.72, 0));
    } else if (cat === 'laser_cutter') {
      const laserGlass = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.55,
      });
      group.add(createBoxPart(L * 0.55, H * 0.32, 0.04, laserGlass, -L * 0.05, H * 0.62, W * 0.45));
    } else if (cat === 'cnc_machine') {
      group.add(createBoxPart(L * 0.48, H * 0.36, 0.04, glassMat, -L * 0.08, H * 0.62, W * 0.45));
      group.add(createCylinderPart(0.12, 0.12, H * 0.35, stainlessMat, -L * 0.08, H * 0.62, 0));
    } else if (cat === 'filling_machine') {
      group.add(createCylinderPart(W * 0.34, W * 0.34, H * 0.42, glassMat, -L * 0.08, H * 0.68, 0, 0, 0, 20));
      group.add(createCylinderPart(0.24, 0.12, 0.35, stainlessMat, -L * 0.08, H + 0.08, 0));
    } else if (cat === 'labeling_machine') {
      group.add(createCylinderPart(0.16, 0.16, 0.14, safetyYellowMat, 0, H * 0.84, W * 0.36, Math.PI / 2));
      group.add(createCylinderPart(0.12, 0.12, 0.14, stainlessMat, -0.28, H * 0.84, W * 0.36, Math.PI / 2));
    }

    statusBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    statusBeacon.position.set(L * 0.36, H * 0.88 + 0.1, W * 0.26);
    group.add(statusBeacon);
  }

  return { group, statusBeacon, rollerMeshes };
}

export function buildWorkerGroup(colorHex = '#1D4ED8'): {
  group: THREE.Group;
  vestMesh: THREE.Mesh;
} {
  const group = new THREE.Group();
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.05 });
  const vestMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.65, metalness: 0.1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe2b89b, roughness: 0.75, metalness: 0.02 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.1 });

  group.add(createCylinderPart(0.075, 0.065, 0.78, pantsMat, -0.1, 0.39, 0));
  group.add(createCylinderPart(0.075, 0.065, 0.78, pantsMat, 0.1, 0.39, 0));
  const vestMesh = createBoxPart(0.38, 0.56, 0.22, vestMat, 0, 1.06, 0);
  group.add(vestMesh);
  group.add(createCylinderPart(0.055, 0.05, 0.52, vestMat, -0.25, 1.04, 0));
  group.add(createCylinderPart(0.055, 0.05, 0.52, vestMat, 0.25, 1.04, 0));
  const headGeo = new THREE.SphereGeometry(0.115, 14, 12);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 1.48, 0);
  head.castShadow = true;
  group.add(head);

  const hatGeo = new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const hat = new THREE.Mesh(hatGeo, hatMat);
  hat.position.set(0, 1.5, 0);
  hat.castShadow = true;
  group.add(hat);

  return { group, vestMesh };
}

export function buildProductGroup(product: ProductDefinition): THREE.Group {
  const group = new THREE.Group();
  const { length: L, width: W, height: H } = product.dimensions;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(product.color || '#E2E8F0'),
    roughness: 0.45,
    metalness: 0.15,
  });
  const grilleMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.7,
    metalness: 0.25,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.35,
    metalness: 0.2,
  });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.88, metalness: 0.02 });
  const hdpeMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.36, metalness: 0.08 });
  const cartonMat = new THREE.MeshStandardMaterial({ color: 0xc28b53, roughness: 0.8, metalness: 0.02 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.05 });

  const shape = product.modelShape;

  if (shape === 'air_cooler') {
    group.add(createBoxPart(L, H * 0.28, W, grilleMat, 0, H * 0.14, 0));
    group.add(createBoxPart(L * 0.98, H * 0.65, W * 0.98, bodyMat, 0, H * 0.28 + H * 0.325, 0));
    group.add(createBoxPart(L * 0.76, H * 0.42, 0.03, grilleMat, 0, H * 0.62, W * 0.5));
    group.add(createBoxPart(L * 0.96, H * 0.07, W * 0.96, accentMat, 0, H * 0.965, 0));
  } else if (shape === 'cylinder') {
    const r = Math.min(L, W) / 2;
    group.add(createCylinderPart(r, r, H, bodyMat, 0, H / 2, 0, 0, 0, 18));
  } else if (shape === 'drum') {
    const r = Math.min(L, W) / 2;
    const steelDrumMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(product.color || '#0369A1'),
      roughness: 0.32,
      metalness: 0.65,
    });
    group.add(createCylinderPart(r, r, H, steelDrumMat, 0, H / 2, 0, 0, 0, 20));
    group.add(createCylinderPart(r * 1.05, r * 1.05, 0.04, grilleMat, 0, H * 0.33, 0, 0, 0, 20));
    group.add(createCylinderPart(r * 1.05, r * 1.05, 0.04, grilleMat, 0, H * 0.67, 0, 0, 0, 20));
    group.add(createCylinderPart(r * 0.14, r * 0.14, 0.03, accentMat, r * 0.42, H + 0.01, 0));
  } else if (shape === 'carton_box') {
    group.add(createBoxPart(L, H, W, cartonMat, 0, H / 2, 0));
    group.add(createBoxPart(L * 0.98, 0.015, W * 0.16, tapeMat, 0, H + 0.005, 0));
    group.add(createBoxPart(0.16, 0.11, 0.015, new THREE.MeshStandardMaterial({ color: 0xf8fafc }), L * 0.18, H * 0.55, W / 2 + 0.005));
  } else if (shape === 'shrink_pack') {
    const filmMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.42,
    });
    const r = Math.min(L / 6, W / 4) * 0.85;
    for (let ix = -1; ix <= 1; ix++) {
      for (const iz of [-0.5, 0.5]) {
        group.add(createCylinderPart(r, r, H * 0.92, bodyMat, ix * (L * 0.3), H * 0.46, iz * (W * 0.44), 0, 0, 12));
      }
    }
    group.add(createBoxPart(L, H, W, filmMat, 0, H / 2, 0, false));
  } else if (shape === 'pallet_wood' || shape === 'pallet_plastic' || shape === 'wrapped_pallet' || shape === 'pallet') {
    const pMat = shape === 'pallet_plastic' ? hdpeMat : woodMat;
    const baseH = Math.min(0.15, H * 0.22);
    // Slatted pallet runner base + top deck
    group.add(createBoxPart(L, baseH * 0.45, W * 0.2, pMat, 0, baseH * 0.22, -W * 0.36));
    group.add(createBoxPart(L, baseH * 0.45, W * 0.2, pMat, 0, baseH * 0.22, W * 0.36));
    group.add(createBoxPart(L, baseH * 0.45, W, pMat, 0, baseH * 0.78, 0));

    const loadH = Math.max(0.2, H - baseH);
    const boxMat = shape === 'wrapped_pallet' ? cartonMat : bodyMat;
    // Stacked 2-layer carton load
    group.add(createBoxPart(L * 0.88, loadH * 0.48, W * 0.88, boxMat, 0, baseH + loadH * 0.24, 0));
    group.add(createBoxPart(L * 0.88, loadH * 0.48, W * 0.88, boxMat, 0, baseH + loadH * 0.74, 0));

    if (shape === 'wrapped_pallet') {
      const stretchWrapMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        roughness: 0.1,
        metalness: 0.15,
        transparent: true,
        opacity: 0.42,
      });
      group.add(createBoxPart(L * 0.93, loadH * 1.01, W * 0.93, stretchWrapMat, 0, baseH + loadH * 0.5, 0, false));
    } else {
      group.add(createBoxPart(L * 0.9, 0.03, W * 0.1, accentMat, 0, H + 0.01, 0));
    }
  } else if (shape === 'crate') {
    group.add(createBoxPart(L, H, W, woodMat, 0, H / 2, 0));
    group.add(createBoxPart(L * 1.02, 0.06, W * 1.02, grilleMat, 0, H - 0.03, 0));
    group.add(createBoxPart(L * 1.02, 0.06, W * 1.02, grilleMat, 0, 0.03, 0));
  } else if (shape === 'spool_roll') {
    const r = Math.min(L, W) / 2;
    group.add(createCylinderPart(r, r, 0.04, grilleMat, 0, 0.02, 0, 0, 0, 20));
    group.add(createCylinderPart(r * 0.76, r * 0.76, H - 0.08, bodyMat, 0, H / 2, 0, 0, 0, 20));
    group.add(createCylinderPart(r, r, 0.04, grilleMat, 0, H - 0.02, 0, 0, 0, 20));
  } else if (shape === 'chassis') {
    group.add(createBoxPart(L, H * 0.25, W * 0.16, grilleMat, 0, H * 0.35, -W * 0.38));
    group.add(createBoxPart(L, H * 0.25, W * 0.16, grilleMat, 0, H * 0.35, W * 0.38));
    group.add(createBoxPart(L * 0.16, H * 0.22, W * 0.88, bodyMat, -L * 0.3, H * 0.35, 0));
    group.add(createBoxPart(L * 0.16, H * 0.22, W * 0.88, bodyMat, L * 0.3, H * 0.35, 0));
  } else if (shape === 'appliance') {
    group.add(createBoxPart(L, H, W, bodyMat, 0, H / 2, 0));
    group.add(createBoxPart(L * 0.92, H * 0.08, 0.03, grilleMat, 0, H * 0.88, W / 2 + 0.01));
    group.add(createBoxPart(L * 0.6, 0.04, 0.03, accentMat, 0, H * 0.62, W / 2 + 0.01));
  } else {
    group.add(createBoxPart(L, H, W, bodyMat, 0, H / 2, 0));
    group.add(createBoxPart(L * 0.9, 0.04, W * 0.9, accentMat, 0, H + 0.01, 0));
  }

  return group;
}

export function disposeThreeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const anyChild = child as THREE.Mesh | THREE.Line;
    if ((anyChild as THREE.Mesh).isMesh || (anyChild as THREE.Line).isLine) {
      anyChild.geometry?.dispose();
      if (Array.isArray(anyChild.material)) {
        anyChild.material.forEach((m) => m.dispose());
      } else {
        anyChild.material?.dispose();
      }
    }
  });
}
