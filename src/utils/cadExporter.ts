import * as THREE from 'three';
import { ProjectData, WallOpening } from '../types/project';
import { buildEquipmentGroup } from '../three/proceduralModels';
import { downloadBlob, sanitizeFilename } from './mediaCapture';
import { BETA_LIMITS_AR, BETA_LIMITS_EN } from './betaLimits';

function fmt(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '0.0000';
}

function sanitizeCadName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[^A-Za-z0-9_.\- ]/g, '_');
  return cleaned || 'Element';
}

function rotatePoint2D(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  angleRad: number
): [number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function pushClosedPolylineDxf(
  out: string[],
  layer: string,
  points: Array<[number, number]>,
  colorCode?: number
): void {
  if (points.length < 2) return;
  out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
  if (colorCode !== undefined) out.push('62', String(colorCode));
  for (const [x, y] of points) {
    out.push('0', 'VERTEX', '8', layer, '10', fmt(x), '20', fmt(y), '30', '0.0');
  }
  out.push('0', 'SEQEND');
}

function pushRectDxf(
  out: string[],
  layer: string,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angleRad = 0,
  colorCode?: number
): void {
  const hl = length / 2;
  const hw = width / 2;
  const corners: Array<[number, number]> = [
    rotatePoint2D(cx, cy, -hl, -hw, angleRad),
    rotatePoint2D(cx, cy, hl, -hw, angleRad),
    rotatePoint2D(cx, cy, hl, hw, angleRad),
    rotatePoint2D(cx, cy, -hl, hw, angleRad),
  ];
  pushClosedPolylineDxf(out, layer, corners, colorCode);
}

function pushLineDxf(
  out: string[],
  layer: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  out.push('0', 'LINE', '8', layer, '10', fmt(x1), '20', fmt(y1), '30', '0.0', '11', fmt(x2), '21', fmt(y2), '31', '0.0');
}

function pushCircleDxf(
  out: string[],
  layer: string,
  cx: number,
  cy: number,
  radius: number
): void {
  out.push('0', 'CIRCLE', '8', layer, '10', fmt(cx), '20', fmt(cy), '30', '0.0', '40', fmt(radius));
}

function pushTextDxf(
  out: string[],
  layer: string,
  x: number,
  y: number,
  text: string,
  height = 0.25,
  rotationDeg = 0
): void {
  const safe = sanitizeCadName(text);
  out.push(
    '0',
    'TEXT',
    '8',
    layer,
    '10',
    fmt(x),
    '20',
    fmt(y),
    '30',
    '0.0',
    '40',
    fmt(height, 3),
    '50',
    fmt(rotationDeg, 2),
    '72',
    '1',
    '11',
    fmt(x),
    '21',
    fmt(y),
    '31',
    '0.0',
    '1',
    safe
  );
}

function openingCenterAndAngle(
  op: WallOpening,
  fL: number,
  fW: number
): { cx: number; cy: number; len: number; wid: number; angleRad: number } {
  const cyFromZ = (z: number) => fW - z;
  const thickness = 0.24;
  switch (op.wall) {
    case 'north':
      return { cx: op.offsetM + op.widthM / 2, cy: cyFromZ(0), len: op.widthM, wid: thickness, angleRad: 0 };
    case 'south':
      return { cx: op.offsetM + op.widthM / 2, cy: cyFromZ(fW), len: op.widthM, wid: thickness, angleRad: 0 };
    case 'west':
      return { cx: 0, cy: cyFromZ(op.offsetM + op.widthM / 2), len: thickness, wid: op.widthM, angleRad: 0 };
    case 'east':
      return { cx: fL, cy: cyFromZ(op.offsetM + op.widthM / 2), len: thickness, wid: op.widthM, angleRad: 0 };
    default:
      return { cx: op.offsetM + op.widthM / 2, cy: cyFromZ(0), len: op.widthM, wid: thickness, angleRad: 0 };
  }
}

/**
 * Generates an AutoCAD R12 (AC1009) ASCII DXF drawing in metric CAD coordinates (meters, North-up XY).
 * Compatible with AutoCAD, Autodesk Inventor (2D Sketch / DWG-DXF), and SolidWorks Drawings/Sketches.
 */
export function generate2DFactoryDxf(project: ProjectData): string {
  const fL = project.factory.lengthM;
  const fW = project.factory.widthM;
  const toCadY = (z: number) => fW - z;
  const toCadAngle = (rotDeg: number) => (-rotDeg * Math.PI) / 180;

  const lines: string[] = [];

  // DXF comment records (group code 999) must precede the first SECTION. ASCII English only: R12 DXF has no Unicode guarantee.
  lines.push('999', 'MK LineSim EXPERIMENTAL EXPORT', '999', BETA_LIMITS_EN);

  // HEADER SECTION
  lines.push(
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '6', // 6 = Meters
    '9', '$MEASUREMENT', '70', '1', // 1 = Metric
    '9', '$EXTMIN', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMAX', '10', fmt(fL), '20', fmt(fW), '30', fmt(project.factory.heightM),
    '0', 'ENDSEC'
  );

  // TABLES SECTION (LAYERS)
  const layers: Array<{ name: string; color: number }> = [
    { name: '0', color: 7 },
    { name: 'FACTORY_BOUNDARY', color: 7 },
    { name: 'ZONES', color: 8 },
    { name: 'COLUMNS', color: 9 },
    { name: 'OPENINGS', color: 5 },
    { name: 'CONVEYORS', color: 3 },
    { name: 'EQUIPMENT', color: 1 },
    { name: 'WORKERS', color: 4 },
    { name: 'FLOW_ARROWS', color: 2 },
    { name: 'TEXT_LABELS', color: 7 },
  ];

  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push('0', 'TABLE', '2', 'LAYER', '70', String(layers.length));
  for (const lay of layers) {
    lines.push(
      '0', 'LAYER',
      '2', lay.name,
      '70', '0',
      '62', String(lay.color),
      '6', 'CONTINUOUS'
    );
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');

  // ENTITIES SECTION
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  // 1. Factory Outer Perimeter
  pushClosedPolylineDxf(lines, 'FACTORY_BOUNDARY', [
    [0, 0],
    [fL, 0],
    [fL, fW],
    [0, fW],
  ]);
  pushTextDxf(
    lines,
    'TEXT_LABELS',
    fL / 2,
    fW + 0.8,
    `${project.factoryName} (${fmt(fL, 1)}m x ${fmt(fW, 1)}m x ${fmt(project.factory.heightM, 1)}m)`,
    0.45,
    0
  );

  // 2. Zones
  for (const z of project.factory.zones) {
    if (!z.visible) continue;
    const cx = z.position.x;
    const cy = toCadY(z.position.z);
    pushRectDxf(lines, 'ZONES', cx, cy, z.dimensions.length, z.dimensions.width, toCadAngle(z.rotationDeg));
    pushTextDxf(lines, 'TEXT_LABELS', cx, cy, z.name, 0.28, -z.rotationDeg);
  }

  // 3. Structural Columns
  for (const col of project.factory.columns) {
    pushRectDxf(lines, 'COLUMNS', col.x, toCadY(col.z), col.width, col.depth, 0);
  }

  // 4. Doors, Windows, Loading Bays
  for (const op of project.factory.openings) {
    const o = openingCenterAndAngle(op, fL, fW);
    pushRectDxf(lines, 'OPENINGS', o.cx, o.cy, o.len, o.wid, o.angleRad);
  }

  // 5. Layout Objects (Conveyors, Machines, Workstations, Buffers, Pallets, Storage, Vehicles)
  for (const obj of project.layoutObjects) {
    if (!obj.rendering.visible) continue;
    const layer = obj.kind === 'conveyor' ? 'CONVEYORS' : 'EQUIPMENT';
    const cx = obj.geometry.position.x;
    const cy = toCadY(obj.geometry.position.z);
    const angleRad = toCadAngle(obj.geometry.rotationDeg);

    pushRectDxf(
      lines,
      layer,
      cx,
      cy,
      obj.geometry.dimensions.length,
      obj.geometry.dimensions.width,
      angleRad
    );

    if (obj.category === 'stretch_wrapper_turntable') {
      const r = Math.min(obj.geometry.dimensions.length, obj.geometry.dimensions.width) * 0.38;
      pushCircleDxf(lines, layer, cx, cy, r);
    }

    pushTextDxf(lines, 'TEXT_LABELS', cx, cy, obj.name, 0.22, -obj.geometry.rotationDeg);
  }

  // 6. Workers
  for (const w of project.workers) {
    const wx = w.position.x;
    const wy = toCadY(w.position.z);
    pushCircleDxf(lines, 'WORKERS', wx, wy, 0.32);
    pushTextDxf(lines, 'TEXT_LABELS', wx, wy - 0.55, w.label, 0.2, 0);
  }

  // 7. Flow Arrows
  for (const obj of project.layoutObjects) {
    if (!obj.rendering.visible) continue;
    const x1 = obj.geometry.position.x;
    const y1 = toCadY(obj.geometry.position.z);
    for (const targetId of obj.connectedToIds) {
      const target = project.layoutObjects.find((o) => o.id === targetId && o.rendering.visible);
      if (!target) continue;
      const x2 = target.geometry.position.x;
      const y2 = toCadY(target.geometry.position.z);
      pushLineDxf(lines, 'FLOW_ARROWS', x1, y1, x2, y2);

      // Arrowhead legs at midpoint
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 0.32;
      const wing1 = rotatePoint2D(mx, my, -headLen, headLen * 0.45, ang);
      const wing2 = rotatePoint2D(mx, my, -headLen, -headLen * 0.45, ang);
      pushLineDxf(lines, 'FLOW_ARROWS', mx, my, wing1[0], wing1[1]);
      pushLineDxf(lines, 'FLOW_ARROWS', mx, my, wing2[0], wing2[1]);
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\r\n');
}

interface CadPartMesh {
  name: string;
  mesh: THREE.Mesh;
}

function disposeRootGroup(root: THREE.Object3D): void {
  const disposedMats = new Set<THREE.Material>();
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m && !disposedMats.has(m)) {
          disposedMats.add(m);
          m.dispose();
        }
      }
    }
  });
}

function buildFactoryCadScene(project: ProjectData): { root: THREE.Group; parts: CadPartMesh[] } {
  const root = new THREE.Group();
  const parts: CadPartMesh[] = [];
  const fL = project.factory.lengthM;
  const fW = project.factory.widthM;
  const wallH = Math.min(1.4, project.factory.heightM * 0.35);
  const slabMat = new THREE.MeshBasicMaterial();

  // Factory Floor Slab (solid closed prism below y=0)
  const floorGeo = new THREE.BoxGeometry(fL, 0.16, fW);
  const floorMesh = new THREE.Mesh(floorGeo, slabMat);
  floorMesh.position.set(fL / 2, -0.08, fW / 2);
  root.add(floorMesh);
  parts.push({ name: 'Factory_Floor_Slab', mesh: floorMesh });

  // Perimeter Cutaway Walls (North, South, West, East)
  const wallSpecs: Array<[string, number, number, number, number, number]> = [
    ['Wall_North', fL, wallH, 0.2, fL / 2, 0.1],
    ['Wall_South', fL, wallH, 0.2, fL / 2, fW - 0.1],
    ['Wall_West', 0.2, wallH, fW, 0.1, fW / 2],
    ['Wall_East', 0.2, wallH, fW, fL - 0.1, fW / 2],
  ];
  for (const [wName, wl, wh, wd, wx, wz] of wallSpecs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wl, wh, wd), slabMat);
    m.position.set(wx, wh / 2, wz);
    root.add(m);
    parts.push({ name: wName, mesh: m });
  }

  // Structural Columns
  project.factory.columns.forEach((col, idx) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(col.width, project.factory.heightM, col.depth),
      slabMat
    );
    m.position.set(col.x, project.factory.heightM / 2, col.z);
    root.add(m);
    parts.push({ name: `Column_${idx + 1}`, mesh: m });
  });

  // Equipment, Conveyors, Buffers, Pallets, Racks, Vehicles
  for (const obj of project.layoutObjects) {
    if (!obj.rendering.visible) continue;
    const { group } = buildEquipmentGroup(obj, 'engineering');
    group.position.set(obj.geometry.position.x, obj.geometry.position.y, obj.geometry.position.z);
    group.rotation.y = (-obj.geometry.rotationDeg * Math.PI) / 180;
    root.add(group);
    const objGroupName = sanitizeCadName(obj.name).replace(/\s+/g, '_');
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        parts.push({ name: objGroupName, mesh: child });
      }
    });
  }

  root.updateMatrixWorld(true);
  return { root, parts };
}

function collectMeshTriangles(
  mesh: THREE.Mesh,
  factoryWidthM: number,
  scaleFactor: number
): Array<{
  n: [number, number, number];
  v0: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
}> {
  const geom = mesh.geometry;
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return [];

  const indexAttr = geom.getIndex();
  const matWorld = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  // Right-handed Z-up CAD mapping: Three(x, y, z) -> CAD(x * s, (W - z) * s, y * s)
  const toCadVec = (src: THREE.Vector3, target: THREE.Vector3) => {
    target.set(src.x * scaleFactor, (factoryWidthM - src.z) * scaleFactor, src.y * scaleFactor);
  };

  const triList: Array<{
    n: [number, number, number];
    v0: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
  }> = [];

  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
  for (let i = 0; i < triCount; i++) {
    const i0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
    const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

    a.fromBufferAttribute(posAttr, i0).applyMatrix4(matWorld);
    b.fromBufferAttribute(posAttr, i1).applyMatrix4(matWorld);
    c.fromBufferAttribute(posAttr, i2).applyMatrix4(matWorld);

    toCadVec(a, a);
    toCadVec(b, b);
    toCadVec(c, c);

    // Outward normal for CCW triangle (a, b, c): (b - a) x (c - a)
    cb.subVectors(c, a);
    ab.subVectors(b, a);
    ab.cross(cb).normalize();

    if (Number.isFinite(ab.x) && Number.isFinite(ab.y) && Number.isFinite(ab.z)) {
      triList.push({
        n: [ab.x, ab.y, ab.z],
        v0: [a.x, a.y, a.z],
        v1: [b.x, b.y, b.z],
        v2: [c.x, c.y, c.z],
      });
    }
  }
  return triList;
}

/**
 * Generates a Binary STL 3D model scaled in millimeters (1m = 1000mm, right-handed Z-up).
 * Directly compatible with SolidWorks, Autodesk Inventor, and AutoCAD IMPORT.
 */
export function generate3DFactoryStl(project: ProjectData): ArrayBuffer {
  const { root, parts } = buildFactoryCadScene(project);
  try {
    const allTris: Array<{
      n: [number, number, number];
      v0: [number, number, number];
      v1: [number, number, number];
      v2: [number, number, number];
    }> = [];

    for (const part of parts) {
      const tris = collectMeshTriangles(part.mesh, project.factory.widthM, 1000);
      for (const t of tris) allTris.push(t);
    }

    const byteLen = 84 + allTris.length * 50;
    const buffer = new ArrayBuffer(byteLen);
    const view = new DataView(buffer);
    const headerStr = 'MK LineSim STL (mm) EXPERIMENTAL - see companion NOTICE.txt';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 32);
    }
    view.setUint32(80, allTris.length, true);

    let offset = 84;
    for (const tri of allTris) {
      view.setFloat32(offset, tri.n[0], true);
      view.setFloat32(offset + 4, tri.n[1], true);
      view.setFloat32(offset + 8, tri.n[2], true);

      view.setFloat32(offset + 12, tri.v0[0], true);
      view.setFloat32(offset + 16, tri.v0[1], true);
      view.setFloat32(offset + 20, tri.v0[2], true);

      view.setFloat32(offset + 24, tri.v1[0], true);
      view.setFloat32(offset + 28, tri.v1[1], true);
      view.setFloat32(offset + 32, tri.v1[2], true);

      view.setFloat32(offset + 36, tri.v2[0], true);
      view.setFloat32(offset + 40, tri.v2[1], true);
      view.setFloat32(offset + 44, tri.v2[2], true);

      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }

    return buffer;
  } finally {
    disposeRootGroup(root);
  }
}

/**
 * Generates a grouped Wavefront OBJ 3D assembly in meters (right-handed Z-up).
 * Preserves individual named groups for machines, conveyors, walls, and columns in CAD tools.
 */
export function generate3DFactoryObj(project: ProjectData): string {
  const { root, parts } = buildFactoryCadScene(project);
  try {
    const out: string[] = [
      '# MK Tech — MK LineSim 3D CAD Assembly Export (Wavefront OBJ, Units: Meters, Z-up)',
      '# Copyright (c) 2026 Eng. Mina Khairat',
      `# Project: ${sanitizeCadName(project.name)}`,
      `# ${BETA_LIMITS_EN}`,
      `# ${BETA_LIMITS_AR}`,
      '',
    ];

    let vOffset = 1;
    let vnOffset = 1;
    let lastGroup = '';

    for (const part of parts) {
      const tris = collectMeshTriangles(part.mesh, project.factory.widthM, 1);
      if (tris.length === 0) continue;
      if (part.name !== lastGroup) {
        out.push(`o ${part.name}`, `g ${part.name}`);
        lastGroup = part.name;
      }
      for (const tri of tris) {
        out.push(`v ${fmt(tri.v0[0], 5)} ${fmt(tri.v0[1], 5)} ${fmt(tri.v0[2], 5)}`);
        out.push(`v ${fmt(tri.v1[0], 5)} ${fmt(tri.v1[1], 5)} ${fmt(tri.v1[2], 5)}`);
        out.push(`v ${fmt(tri.v2[0], 5)} ${fmt(tri.v2[1], 5)} ${fmt(tri.v2[2], 5)}`);
        out.push(`vn ${fmt(tri.n[0], 5)} ${fmt(tri.n[1], 5)} ${fmt(tri.n[2], 5)}`);
        out.push(
          `f ${vOffset}//${vnOffset} ${vOffset + 1}//${vnOffset} ${vOffset + 2}//${vnOffset}`
        );
        vOffset += 3;
        vnOffset += 1;
      }
    }

    return out.join('\n') + '\n';
  } finally {
    disposeRootGroup(root);
  }
}

function sanitizeStepStr(raw: string): string {
  return sanitizeCadName(raw).replace(/'/g, "''");
}

/**
 * Generates an ISO 10303-21 AP214 (.step) 3D CAD B-Rep assembly in millimeters (right-handed Z-up).
 * Emits watertight MANIFOLD_SOLID_BREP solids for the factory floor, walls, columns, conveyors, and machines.
 * Directly compatible with SolidWorks, Autodesk Inventor, AutoCAD, Fusion 360, and FreeCAD.
 */
export function generate3DFactoryStep(project: ProjectData): string {
  const { root, parts } = buildFactoryCadScene(project);
  try {
    const entities: string[] = [];
    let nextId = 1;
    const add = (body: string): number => {
      const id = nextId++;
      entities.push(`#${id} = ${body};`);
      return id;
    };

    const appCtx = add("APPLICATION_CONTEXT('automotive design')");
    add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
    const prodCtx = add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
    const safeProjName = sanitizeStepStr(project.name);
    const prod = add(`PRODUCT('${safeProjName}','${safeProjName}','MK LineSim 3D Factory CAD',(#${prodCtx}))`);
    const formCtx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
    const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
    const pd = add(`PRODUCT_DEFINITION('design','',#${pdf},#${formCtx})`);
    const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);

    const mmUnit = add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
    const radUnit = add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
    const srUnit = add('( NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.) )');
    const uncert = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-04),#${mmUnit},'distance_accuracy_value','confusion accuracy')`);
    const geomCtx = add(
      `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncert})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mmUnit},#${radUnit},#${srUnit})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`
    );

    const originPt = add("CARTESIAN_POINT('',(0.,0.,0.))");
    const axisZ = add("DIRECTION('',(0.,0.,1.))");
    const axisX = add("DIRECTION('',(1.,0.,0.))");
    const worldPlacement = add(`AXIS2_PLACEMENT_3D('',#${originPt},#${axisZ},#${axisX})`);

    const solidIds: number[] = [];
    const nameCounts = new Map<string, number>();

    const toCadMm = (src: THREE.Vector3, matWorld: THREE.Matrix4): [number, number, number] => {
      const w = src.clone().applyMatrix4(matWorld);
      return [
        w.x * 1000,
        (project.factory.widthM - w.z) * 1000,
        w.y * 1000,
      ];
    };

    const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
      a[0] - b[0],
      a[1] - b[1],
      a[2] - b[2],
    ];
    const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: [number, number, number], b: [number, number, number]): number =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (v: [number, number, number]): [number, number, number] => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    };

    const faceDefs: Array<[number, number, number, number]> = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
    ];

    for (const part of parts) {
      const geom = part.mesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox;
      if (!bb) continue;

      const dx = bb.max.x - bb.min.x;
      const dy = bb.max.y - bb.min.y;
      const dz = bb.max.z - bb.min.z;
      if (dx < 1e-4 || dy < 1e-4 || dz < 1e-4) continue;

      const cornersLocal = [
        new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
      ];
      const P = cornersLocal.map((c) => toCadMm(c, part.mesh.matrixWorld));

      // Centroid of hexahedron for guaranteed outward normal check
      const boxCenter: [number, number, number] = [0, 0, 0];
      for (const p of P) {
        boxCenter[0] += p[0] / 8;
        boxCenter[1] += p[1] / 8;
        boxCenter[2] += p[2] / 8;
      }

      const cartIds = P.map((p) => add(`CARTESIAN_POINT('',(${fmt(p[0], 3)},${fmt(p[1], 3)},${fmt(p[2], 3)}))`));
      const vpIds = cartIds.map((cid) => add(`VERTEX_POINT('',#${cid})`));
      const edgeCache = new Map<string, number>();

      const getEdgeCurve = (u: number, v: number): { edgeId: number; sameSense: boolean } => {
        const lo = Math.min(u, v);
        const hi = Math.max(u, v);
        const key = `${lo}_${hi}`;
        let edgeId = edgeCache.get(key);
        if (edgeId === undefined) {
          const dir = norm(sub(P[hi], P[lo]));
          const dirId = add(`DIRECTION('',(${fmt(dir[0], 6)},${fmt(dir[1], 6)},${fmt(dir[2], 6)}))`);
          const vecId = add(`VECTOR('',#${dirId},1.)`);
          const lineId = add(`LINE('',#${cartIds[lo]},#${vecId})`);
          edgeId = add(`EDGE_CURVE('',#${vpIds[lo]},#${vpIds[hi]},#${lineId},.T.)`);
          edgeCache.set(key, edgeId);
        }
        return { edgeId, sameSense: u === lo };
      };

      const advFaceIds: number[] = [];
      for (const rawLoop of faceDefs) {
        let loop: [number, number, number, number] = [...rawLoop];
        const fc: [number, number, number] = [
          (P[loop[0]][0] + P[loop[1]][0] + P[loop[2]][0] + P[loop[3]][0]) / 4,
          (P[loop[0]][1] + P[loop[1]][1] + P[loop[2]][1] + P[loop[3]][1]) / 4,
          (P[loop[0]][2] + P[loop[1]][2] + P[loop[2]][2] + P[loop[3]][2]) / 4,
        ];
        const e1 = sub(P[loop[1]], P[loop[0]]);
        const e2 = sub(P[loop[3]], P[loop[0]]);
        let nVec = norm(cross(e1, e2));
        if (dot(nVec, sub(fc, boxCenter)) < 0) {
          loop = [loop[0], loop[3], loop[2], loop[1]];
          nVec = [-nVec[0], -nVec[1], -nVec[2]];
        }
        const refVec = norm(sub(P[loop[1]], P[loop[0]]));

        const orientedIds: number[] = [];
        for (let k = 0; k < 4; k++) {
          const u = loop[k];
          const v = loop[(k + 1) % 4];
          const { edgeId, sameSense } = getEdgeCurve(u, v);
          orientedIds.push(add(`ORIENTED_EDGE('',*,*,#${edgeId},${sameSense ? '.T.' : '.F.'})`));
        }

        const edgeLoopId = add(`EDGE_LOOP('',(${orientedIds.map((id) => `#${id}`).join(',')}))`);
        const faceBoundId = add(`FACE_OUTER_BOUND('',#${edgeLoopId},.T.)`);
        const planeOriginId = add(`CARTESIAN_POINT('',(${fmt(P[loop[0]][0], 3)},${fmt(P[loop[0]][1], 3)},${fmt(P[loop[0]][2], 3)}))`);
        const planeNormalId = add(`DIRECTION('',(${fmt(nVec[0], 6)},${fmt(nVec[1], 6)},${fmt(nVec[2], 6)}))`);
        const planeRefId = add(`DIRECTION('',(${fmt(refVec[0], 6)},${fmt(refVec[1], 6)},${fmt(refVec[2], 6)}))`);
        const planePlacementId = add(`AXIS2_PLACEMENT_3D('',#${planeOriginId},#${planeNormalId},#${planeRefId})`);
        const planeId = add(`PLANE('',#${planePlacementId})`);
        advFaceIds.push(add(`ADVANCED_FACE('',(#${faceBoundId}),#${planeId},.T.)`));
      }

      const shellId = add(`CLOSED_SHELL('',(${advFaceIds.map((id) => `#${id}`).join(',')}))`);
      const baseName = sanitizeStepStr(part.name).replace(/\s+/g, '_');
      const count = (nameCounts.get(baseName) || 0) + 1;
      nameCounts.set(baseName, count);
      const uniqueName = count === 1 ? baseName : `${baseName}_${count}`;
      solidIds.push(add(`MANIFOLD_SOLID_BREP('${uniqueName}',#${shellId})`));
    }

    const shapeRepItems = [worldPlacement, ...solidIds].map((id) => `#${id}`).join(',');
    const shapeRep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${safeProjName}',(${shapeRepItems}),#${geomCtx})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${shapeRep})`);

    const isoTime = new Date().toISOString().replace(/\.\d+Z$/, '');
    const fileStem = `${sanitizeFilename(project.name)}_3d_cad.step`;

    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('MK Tech MK LineSim 3D Factory CAD Assembly (Millimeters, Z-up)','${BETA_LIMITS_EN}'),'2;1');`,
      `FILE_NAME('${fileStem}','${isoTime}',('Eng. Mina Khairat'),('MK Tech'),'MK LineSim STEP AP214 Exporter','MK LineSim','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      ...entities,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  } finally {
    disposeRootGroup(root);
  }
}

export function export2DFactoryDxf(project: ProjectData): void {
  const dxf = generate2DFactoryDxf(project);
  const blob = new Blob([dxf], { type: 'application/dxf;charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(project.name)}_2d_layout.dxf`);
}

export function export3DFactoryStep(project: ProjectData): void {
  const step = generate3DFactoryStep(project);
  const blob = new Blob([step], { type: 'application/step;charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(project.name)}_3d_cad_mm.step`);
}

export function cadStlNoticeText(stlFileName: string): string {
  return [`NOTICE for ${stlFileName}`, '', BETA_LIMITS_EN, BETA_LIMITS_AR, '', 'Binary STL has no room for this text beyond a short header marker, so it is in this file.', ''].join('\n');
}

export function export3DFactoryStl(project: ProjectData): void {
  const buf = generate3DFactoryStl(project);
  const blob = new Blob([buf], { type: 'model/stl' });
  const stem = `${sanitizeFilename(project.name)}_3d_cad_mm`;
  downloadBlob(blob, `${stem}.stl`);
  setTimeout(() => {
    downloadBlob(new Blob([cadStlNoticeText(`${stem}.stl`)], { type: 'text/plain;charset=utf-8' }), `${stem}_stl_NOTICE.txt`);
  }, 400);
}

export function export3DFactoryObj(project: ProjectData): void {
  const obj = generate3DFactoryObj(project);
  const blob = new Blob([obj], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(project.name)}_3d_cad.obj`);
}
