import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { useAppStore } from '../../store/useAppStore';
import {
  buildEquipmentGroup,
  buildProductGroup,
  buildWorkerGroup,
  disposeThreeObject,
} from '../../three/proceduralModels';
import { CameraPreset, MachineRuntimeStatus, WorkerRuntimeStatus } from '../../types/project';
import { snapValue } from '../../utils/units';
import { getT } from '../../i18n/translations';

const STATUS_COLORS: Record<MachineRuntimeStatus, number> = {
  running: 0x16a34a,
  idle: 0x64748b,
  blocked: 0xd97706,
  starved: 0xca8a04,
  down: 0xdc2626,
};

const WORKER_STATUS_COLORS: Record<WorkerRuntimeStatus, number> = {
  busy: 0x16a34a,
  walking: 0x2563eb,
  idle: 0x1d4ed8,
  break: 0x64748b,
};

const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
})();

export const Workspace3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const cameraPreset = useAppStore((s) => s.cameraPreset);
  const visualVariant = useAppStore((s) => s.visualVariant);
  const layersVisible = useAppStore((s) => s.layersVisible);
  const theme = useAppStore((s) => s.theme);
  const language = useAppStore((s) => s.language);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const t = getT(language);

  // Refs for stable WebGL loop
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const factoryGroupRef = useRef<THREE.Group | null>(null);
  const objectsGroupRef = useRef<THREE.Group | null>(null);
  const workersGroupRef = useRef<THREE.Group | null>(null);
  const productsGroupRef = useRef<THREE.Group | null>(null);
  const flowGroupRef = useRef<THREE.Group | null>(null);
  const selectionBoxRef = useRef<THREE.BoxHelper | null>(null);

  const objectMeshMap = useRef<Map<string, { group: THREE.Group; beacon?: THREE.Mesh }>>(new Map());
  const workerMeshMap = useRef<Map<string, { group: THREE.Group; vest: THREE.Mesh }>>(new Map());
  const productMeshMap = useRef<Map<string, THREE.Group>>(new Map());

  const targetCamPos = useRef<THREE.Vector3 | null>(null);
  const targetOrbitCenter = useRef<THREE.Vector3 | null>(null);

  const storeRef = useRef(useAppStore.getState());
  storeRef.current = useAppStore.getState();

  // Initialize Three.js once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = Math.max(200, container.clientWidth);
    const height = Math.max(200, container.clientHeight);

    const scene = new THREE.Scene();
    const bgHex = storeRef.current.theme === 'dark' ? 0x0b0f17 : 0xe2e8f0;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.0045);

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.2, 400);
    const fL = storeRef.current.project.factory.lengthM;
    const fW = storeRef.current.project.factory.widthM;
    camera.position.set(fL * 0.5, Math.max(16, fW * 0.95), fW * 1.45);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // Procedural Studio Environment
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // 3-point lighting rig
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.65);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.45);
    keyLight.position.set(22, 28, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -30;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xbfdbfe, 0.55);
    rimLight.position.set(-18, 14, -15);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 3;
    controls.maxDistance = 120;
    controls.target.set(fL / 2, 0.6, fW / 2);
    controls.update();

    controls.addEventListener('start', () => {
      targetCamPos.current = null;
      targetOrbitCenter.current = null;
    });

    const factoryGroup = new THREE.Group();
    const objectsGroup = new THREE.Group();
    const workersGroup = new THREE.Group();
    const productsGroup = new THREE.Group();
    const flowGroup = new THREE.Group();
    scene.add(factoryGroup, objectsGroup, workersGroup, productsGroup, flowGroup);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    factoryGroupRef.current = factoryGroup;
    objectsGroupRef.current = objectsGroup;
    workersGroupRef.current = workersGroup;
    productsGroupRef.current = productsGroup;
    flowGroupRef.current = flowGroup;

    // Register 3D PNG capture hook
    storeRef.current.register3DCapture(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });

    // Pointer raycasting & floor-plane drag
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    let draggingId: string | null = null;
    let dragKind: 'object' | 'worker' | null = null;
    let dragOffsetX = 0;
    let dragOffsetZ = 0;
    let didDragMove = false;

    const updatePointer = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const findEntityRoot = (obj: THREE.Object3D | null): { kind: 'object' | 'worker'; id: string } | null => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (cur.userData?.entityKind && cur.userData?.entityId) {
          return { kind: cur.userData.entityKind, id: cur.userData.entityId };
        }
        cur = cur.parent;
      }
      return null;
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const targets = [...objectsGroup.children, ...workersGroup.children];
      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        const found = findEntityRoot(hits[0].object);
        if (found) {
          storeRef.current.selectItem(found.kind, found.id, ev.shiftKey);
          const proj = storeRef.current.project;
          if (found.kind === 'object') {
            const lo = proj.layoutObjects.find((o) => o.id === found.id);
            if (lo && !lo.rendering.locked && raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
              draggingId = found.id;
              dragKind = 'object';
              dragOffsetX = lo.geometry.position.x - hitPoint.x;
              dragOffsetZ = lo.geometry.position.z - hitPoint.z;
              didDragMove = false;
              controls.enabled = false;
            }
          } else if (found.kind === 'worker') {
            const w = proj.workers.find((wk) => wk.id === found.id);
            if (w && raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
              draggingId = found.id;
              dragKind = 'worker';
              dragOffsetX = w.position.x - hitPoint.x;
              dragOffsetZ = w.position.z - hitPoint.z;
              didDragMove = false;
              controls.enabled = false;
            }
          }
          return;
        }
      }
      if (!ev.shiftKey) {
        storeRef.current.clearSelection();
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingId || !dragKind) return;
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
        const proj = storeRef.current.project;
        const nx = snapValue(
          Math.max(0.4, Math.min(proj.factory.lengthM - 0.4, hitPoint.x + dragOffsetX)),
          proj.factory.gridSizeM,
          proj.factory.snapToGrid
        );
        const nz = snapValue(
          Math.max(0.4, Math.min(proj.factory.widthM - 0.4, hitPoint.z + dragOffsetZ)),
          proj.factory.gridSizeM,
          proj.factory.snapToGrid
        );
        didDragMove = true;
        if (dragKind === 'object') {
          const curObj = proj.layoutObjects.find((o) => o.id === draggingId);
          if (curObj) {
            storeRef.current.updateLayoutObject(
              draggingId,
              { geometry: { ...curObj.geometry, position: { ...curObj.geometry.position, x: nx, z: nz } } },
              true
            );
          }
        } else if (dragKind === 'worker') {
          storeRef.current.updateWorker(
            draggingId,
            { position: { x: nx, y: 0, z: nz } },
            true
          );
        }
      }
    };

    const onPointerUp = () => {
      if (draggingId) {
        draggingId = null;
        dragKind = null;
        controls.enabled = true;
        if (didDragMove) {
          storeRef.current.saveCurrentProject();
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ResizeObserver for split-pane / responsive resizing
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const cw = Math.max(100, container.clientWidth);
      const ch = Math.max(100, container.clientHeight);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    });
    ro.observe(container);

    // Animation loop (paced for software GL if needed)
    let frameId = 0;
    let disposed = false;
    const timer = new THREE.Timer();
    timer.connect(document);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 75);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      timer.update();
      const delta = Math.min(0.1, timer.getDelta());

      // Advance live DES clock if running
      const st = storeRef.current;
      if (st.simSnapshot.status === 'running') {
        st.tickSimulation(delta);
      }

      // Smooth exponential camera preset transition
      if (targetCamPos.current && targetOrbitCenter.current) {
        const alpha = 1 - Math.exp(-8 * delta);
        camera.position.lerp(targetCamPos.current, alpha);
        controls.target.lerp(targetOrbitCenter.current, alpha);
        if (camera.position.distanceTo(targetCamPos.current) < 0.05) {
          targetCamPos.current = null;
          targetOrbitCenter.current = null;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      storeRef.current.register3DCapture(null);

      disposeThreeObject(scene);
      timer.dispose();
      envTex.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Theme background sync
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const bgHex = theme === 'dark' ? 0x0b0f17 : 0xe2e8f0;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.0045);
  }, [theme]);

  // Camera preset transitions
  useEffect(() => {
    const f = project.factory;
    const cx = f.lengthM / 2;
    const cz = f.widthM / 2;
    const span = Math.max(f.lengthM, f.widthM);
    const map: Record<CameraPreset, THREE.Vector3> = {
      perspective: new THREE.Vector3(cx, Math.max(15, span * 0.65), f.widthM + span * 0.45),
      top: new THREE.Vector3(cx, span * 1.15, cz + 0.01),
      front: new THREE.Vector3(cx, f.heightM * 1.4, f.widthM + span * 0.65),
      side: new THREE.Vector3(f.lengthM + span * 0.65, f.heightM * 1.4, cz),
    };
    targetCamPos.current = map[cameraPreset];
    targetOrbitCenter.current = new THREE.Vector3(cx, 0.5, cz);
  }, [cameraPreset, project.factory.lengthM, project.factory.widthM, project.factory.heightM]);

  // Sync Factory Floor, Walls, Columns, Zones (same geometry as 2D)
  useEffect(() => {
    const fg = factoryGroupRef.current;
    if (!fg) return;
    while (fg.children.length > 0) {
      const c = fg.children[0];
      fg.remove(c);
      disposeThreeObject(c);
    }

    const { lengthM: L, widthM: W, heightM: H, columns, zones, openings } = project.factory;

    // Concrete factory slab (centered at L/2, W/2 so 0..L and 0..W align 1:1 with 2D!)
    const floorGeo = new THREE.BoxGeometry(L, 0.16, W);
    const floorMat = new THREE.MeshStandardMaterial({
      color: theme === 'dark' ? 0x1e293b : 0xcbd5e1,
      roughness: 0.85,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(L / 2, -0.08, W / 2);
    floor.receiveShadow = true;
    fg.add(floor);

    // Metric grid overlay
    const gridHelper = new THREE.GridHelper(Math.max(L, W), Math.max(L, W), 0x64748b, 0x94a3b8);
    gridHelper.position.set(L / 2, 0.005, W / 2);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.25;
    fg.add(gridHelper);

    // Perimeter low architectural cutaway walls (back north wall full height, side/front cutaway for clear interior sight)
    const wallMat = new THREE.MeshStandardMaterial({
      color: theme === 'dark' ? 0x334155 : 0xf1f5f9,
      roughness: 0.78,
      metalness: 0.1,
    });
    const northWall = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, H, 0.18), wallMat);
    northWall.position.set(L / 2, H / 2, -0.09);
    northWall.receiveShadow = true;
    fg.add(northWall);

    const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, H * 0.45, W), wallMat);
    westWall.position.set(-0.09, H * 0.225, W / 2);
    fg.add(westWall);

    const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, H * 0.45, W), wallMat);
    eastWall.position.set(L + 0.09, H * 0.225, W / 2);
    fg.add(eastWall);

    // Openings markers (doors / loading bays)
    const bayMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.3 });
    for (const op of openings) {
      let ox = L / 2;
      let oz = 0;
      let bw = op.widthM;
      let bd = 0.24;
      if (op.wall === 'north') { ox = op.offsetM + op.widthM / 2; oz = -0.08; }
      else if (op.wall === 'south') { ox = op.offsetM + op.widthM / 2; oz = W + 0.08; }
      else if (op.wall === 'west') { ox = -0.08; oz = op.offsetM + op.widthM / 2; bw = 0.24; bd = op.widthM; }
      else if (op.wall === 'east') { ox = L + 0.08; oz = op.offsetM + op.widthM / 2; bw = 0.24; bd = op.widthM; }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(bw, Math.min(H, op.heightM), bd), bayMat);
      frame.position.set(ox, op.sillHeightM + Math.min(H, op.heightM) / 2, oz);
      fg.add(frame);
    }

    // Structural Columns
    if (layersVisible.columns) {
      const colMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.6 });
      for (const col of columns) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(col.width, H, col.depth), colMat);
        mesh.position.set(col.x, H / 2, col.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        fg.add(mesh);
      }
    }

    // Floor Zones
    if (layersVisible.zones) {
      for (const z of zones) {
        if (!z.visible) continue;
        const zGeo = new THREE.PlaneGeometry(z.dimensions.length, z.dimensions.width);
        const zMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(z.color),
          transparent: true,
          opacity: 0.22,
          roughness: 0.9,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const zMesh = new THREE.Mesh(zGeo, zMat);
        zMesh.rotation.x = -Math.PI / 2;
        zMesh.rotation.z = -(z.rotationDeg * Math.PI) / 180;
        zMesh.position.set(z.position.x, 0.015, z.position.z);
        fg.add(zMesh);
      }
    }
  }, [project.factory, layersVisible.columns, layersVisible.zones, theme]);

  // Sync Layout Objects (Machines, Conveyors, Workstations, Racks, Forklifts)
  useEffect(() => {
    const og = objectsGroupRef.current;
    if (!og) return;
    while (og.children.length > 0) {
      const c = og.children[0];
      og.remove(c);
      disposeThreeObject(c);
    }
    objectMeshMap.current.clear();

    for (const obj of project.layoutObjects) {
      if (!obj.rendering.visible || !layersVisible[obj.rendering.layer]) continue;
      const { group, statusBeacon } = buildEquipmentGroup(obj, visualVariant);
      group.position.set(obj.geometry.position.x, obj.geometry.position.y, obj.geometry.position.z);
      group.rotation.y = (-obj.geometry.rotationDeg * Math.PI) / 180;
      group.userData = { entityKind: 'object', entityId: obj.id };
      og.add(group);
      objectMeshMap.current.set(obj.id, { group, beacon: statusBeacon });
    }
  }, [project.layoutObjects, visualVariant, layersVisible]);

  // Sync 3D Product Flow Direction Arrows (Conveyor belts & Stage-to-Stage Routing)
  useEffect(() => {
    const flg = flowGroupRef.current;
    if (!flg) return;
    while (flg.children.length > 0) {
      const c = flg.children[0];
      flg.remove(c);
      disposeThreeObject(c);
    }

    if (layersVisible.flowArrows === false) return;

    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0x991b1b,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.2,
    });
    const entryMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      emissive: 0x15803d,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.2,
    });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xdc2626 });

    const addDirectedSegment = (
      p1: THREE.Vector3,
      p2: THREE.Vector3,
      mat: THREE.Material
    ) => {
      const dirVec = new THREE.Vector3().subVectors(p2, p1);
      const len = dirVec.length();
      if (len < 0.25) return;
      const pts = [p1, p2];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      flg.add(new THREE.Line(lineGeo, lineMat));

      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 10), mat);
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      cone.position.copy(mid);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec.normalize());
      flg.add(cone);
    };

    // 1. Directional arrows on every visible conveyor belt surface
    for (const obj of project.layoutObjects) {
      if (!obj.rendering.visible || obj.kind !== 'conveyor') continue;
      const L = obj.geometry.dimensions.length;
      const H = obj.geometry.dimensions.height;
      const dir = obj.operations.direction === -1 ? -1 : 1;
      const rad = (obj.geometry.rotationDeg * Math.PI) / 180;
      const ux = Math.cos(rad) * dir;
      const uz = Math.sin(rad) * dir;
      const count = Math.max(1, Math.min(6, Math.floor(L / 2.2)));

      for (let i = 0; i < count; i++) {
        const offset =
          count === 1 ? 0 : -L / 2 + 0.8 + (i / (count - 1)) * Math.max(0.2, L - 1.6);
        const ax = obj.geometry.position.x + Math.cos(rad) * offset;
        const az = obj.geometry.position.z + Math.sin(rad) * offset;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 8), i === 0 ? entryMat : arrowMat);
        cone.position.set(ax, H + 0.06, az);
        cone.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(ux, 0, uz).normalize()
        );
        flg.add(cone);
      }
    }

    // 2. Routing arrows along connected objects & active product stages
    const drawnPairs = new Set<string>();
    for (const obj of project.layoutObjects) {
      if (!obj.rendering.visible) continue;
      for (const tid of obj.connectedToIds) {
        const target = project.layoutObjects.find((o) => o.id === tid && o.rendering.visible);
        if (!target) continue;
        const key = `${obj.id}->${tid}`;
        drawnPairs.add(key);
        const y1 = obj.geometry.dimensions.height + 0.14;
        const y2 = target.geometry.dimensions.height + 0.14;
        addDirectedSegment(
          new THREE.Vector3(obj.geometry.position.x, y1, obj.geometry.position.z),
          new THREE.Vector3(target.geometry.position.x, y2, target.geometry.position.z),
          arrowMat
        );
      }
    }

    const activeProd = project.products[0];
    if (activeProd?.routingMode !== 'manual') {
      const routeIds = activeProd?.routeStageIds || [];
      const routeObjs: typeof project.layoutObjects = [];
      for (const sid of routeIds) {
        const st = project.stages.find((s) => s.id === sid);
        const obj = st ? project.layoutObjects.find((o) => o.id === st.assignedObjectIds[0] && o.rendering.visible) : undefined;
        if (obj) routeObjs.push(obj);
      }
      for (let i = 0; i < routeObjs.length - 1; i++) {
        const a = routeObjs[i];
        const b = routeObjs[i + 1];
        const key = `${a.id}->${b.id}`;
        if (drawnPairs.has(key)) continue;
        addDirectedSegment(
          new THREE.Vector3(a.geometry.position.x, a.geometry.dimensions.height + 0.14, a.geometry.position.z),
          new THREE.Vector3(b.geometry.position.x, b.geometry.dimensions.height + 0.14, b.geometry.position.z),
          arrowMat
        );
      }
    }
  }, [project.layoutObjects, project.stages, project.products, layersVisible.flowArrows]);

  // Sync Workers
  useEffect(() => {
    const wg = workersGroupRef.current;
    if (!wg) return;
    while (wg.children.length > 0) {
      const c = wg.children[0];
      wg.remove(c);
      disposeThreeObject(c);
    }
    workerMeshMap.current.clear();

    if (!layersVisible.workers) return;
    for (const w of project.workers) {
      const { group, vestMesh } = buildWorkerGroup(w.color);
      group.position.set(w.position.x, 0, w.position.z);
      group.userData = { entityKind: 'worker', entityId: w.id };
      wg.add(group);
      workerMeshMap.current.set(w.id, { group, vest: vestMesh });
    }
  }, [project.workers, layersVisible.workers]);

  // Sync Selection Bounding Box Highlight
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectionBoxRef.current) {
      scene.remove(selectionBoxRef.current);
      selectionBoxRef.current.dispose();
      selectionBoxRef.current = null;
    }

    if (selection.ids.length > 0) {
      const firstId = selection.ids[0];
      let targetObj: THREE.Object3D | undefined;
      if (selection.kind === 'object') targetObj = objectMeshMap.current.get(firstId)?.group;
      else if (selection.kind === 'worker') targetObj = workerMeshMap.current.get(firstId)?.group;
      if (targetObj) {
        const helper = new THREE.BoxHelper(targetObj, 0xdc2626);
        scene.add(helper);
        selectionBoxRef.current = helper;
      }
    }
  }, [selection, project.layoutObjects, project.workers]);

  // Sync Live Simulation State (status colors, worker movement, product 3D models)
  useEffect(() => {
    // Update machine beacon colors
    for (const [objId, entry] of objectMeshMap.current.entries()) {
      if (!entry.beacon) continue;
      const mat = entry.beacon.material as THREE.MeshStandardMaterial;
      const rt = simSnapshot.objects[objId];
      if (rt && simSnapshot.clockSec > 0) {
        const hex = STATUS_COLORS[rt.status] ?? 0x64748b;
        mat.color.setHex(hex);
        mat.emissive.setHex(hex);
      } else {
        mat.color.setHex(0x64748b);
        mat.emissive.setHex(0x000000);
      }
    }

    // Update worker positions & vest status colors
    for (const [wid, entry] of workerMeshMap.current.entries()) {
      const rt = simSnapshot.workers[wid];
      const mat = entry.vest.material as THREE.MeshStandardMaterial;
      if (rt && simSnapshot.clockSec > 0) {
        entry.group.position.set(rt.position.x, 0, rt.position.z);
        mat.color.setHex(WORKER_STATUS_COLORS[rt.status] ?? 0x1d4ed8);
      } else {
        const def = project.workers.find((w) => w.id === wid);
        if (def) {
          entry.group.position.set(def.position.x, 0, def.position.z);
          mat.color.set(def.color || '#1D4ED8');
        }
      }
    }

    // Sync active product entities moving on conveyors / stations
    const pg = productsGroupRef.current;
    if (!pg) return;
    const activeIds = new Set(simSnapshot.products.map((p) => p.id));
    for (const [pid, meshGroup] of productMeshMap.current.entries()) {
      if (!activeIds.has(pid)) {
        pg.remove(meshGroup);
        disposeThreeObject(meshGroup);
        productMeshMap.current.delete(pid);
      }
    }

    const defaultProd = project.products[0];
    for (const ent of simSnapshot.products) {
      let meshGroup = productMeshMap.current.get(ent.id);
      if (!meshGroup) {
        const prodDef = project.products.find((p) => p.id === ent.productId) || defaultProd;
        if (!prodDef) continue;
        meshGroup = buildProductGroup(prodDef);
        pg.add(meshGroup);
        productMeshMap.current.set(ent.id, meshGroup);
      }
      meshGroup.position.set(ent.worldPosition.x, ent.worldPosition.y, ent.worldPosition.z);
    }
  }, [simSnapshot, project.workers, project.products]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-200 dark:bg-neutral-950">
      <div ref={mountRef} className="w-full h-full" />
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded bg-neutral-900/80 px-2.5 py-1 text-[11px] font-mono-tabular text-neutral-100">
        <span>{t.labels.viewport3d}</span>
        <span aria-hidden="true">·</span>
        <span>{t.camera[cameraPreset]}</span>
        <span aria-hidden="true">·</span>
        <span>{project.factory.lengthM}m × {project.factory.widthM}m × {project.factory.heightM}m</span>
      </div>
    </div>
  );
};
