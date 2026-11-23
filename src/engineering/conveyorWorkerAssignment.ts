import {
  LayoutObject,
  ProductionStage,
  ProjectData,
  Vec3,
  WorkerPlacementSide,
} from '../types/project';
import { uid } from '../utils/units';

export type CardinalPlacementSide = Exclude<WorkerPlacementSide, 'custom'>;

export interface ConveyorSegmentHit {
  conveyor: LayoutObject;
  segmentIndex: number;
  segmentCount: number;
  offsetRatio: number;
  side: 1 | -1;
  distanceM: number;
}

export interface ConveyorSegmentPlacement {
  position: Vec3;
  beltPoint: Vec3;
  rotationDeg: number;
  offsetRatio: number;
  segmentIndex: number;
  segmentCount: number;
  side: 1 | -1;
}

export interface StationSidePlacement {
  position: Vec3;
  rotationDeg: number;
  side: CardinalPlacementSide;
}

export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(wrapped, -0) || Math.abs(wrapped) < 1e-6) wrapped = 0;
  return Math.round(wrapped * 100) / 100;
}

/**
 * Computes logical segment count along a conveyor belt proportional to its length.
 */
export function getConveyorSegmentCount(conv: LayoutObject): number {
  const len = Math.max(0.5, Number(conv.geometry.dimensions.length || 2));
  return Math.max(2, Math.min(8, Math.round(len / 2.2)));
}

/**
 * Resolves the world cardinal direction matching a conveyor's perpendicular side (+1 or -1).
 */
export function getConveyorCardinalSide(conv: LayoutObject, side: 1 | -1 = 1): CardinalPlacementSide {
  const rad = ((conv.geometry.rotationDeg || 0) * Math.PI) / 180;
  const dir = conv.operations.direction === -1 ? -1 : 1;
  const ux = Math.cos(rad) * dir;
  const uz = Math.sin(rad) * dir;
  const nx = -uz * side;
  const nz = ux * side;
  if (Math.abs(nx) > Math.abs(nz)) {
    return nx >= 0 ? 'east' : 'west';
  }
  return nz >= 0 ? 'south' : 'north';
}

/**
 * Converts a requested cardinal side (N/S/E/W) into the conveyor's +1 or -1 perpendicular side.
 */
export function resolveConveyorSideFromCardinal(
  conv: LayoutObject,
  cardinal: CardinalPlacementSide
): 1 | -1 {
  const rad = ((conv.geometry.rotationDeg || 0) * Math.PI) / 180;
  const dir = conv.operations.direction === -1 ? -1 : 1;
  const ux = Math.cos(rad) * dir;
  const uz = Math.sin(rad) * dir;
  const nx = -uz;
  const nz = ux;
  const tx = cardinal === 'east' ? 1 : cardinal === 'west' ? -1 : 0;
  const tz = cardinal === 'south' ? 1 : cardinal === 'north' ? -1 : 0;
  const dot = nx * tx + nz * tz;
  return dot >= 0 ? 1 : -1;
}

/**
 * Computes world floor placement & station-facing rotation for a worker standing
 * on any user-chosen cardinal side (north / south / east / west) of a station or machine.
 */
export function computeStationSidePlacement(
  obj: LayoutObject,
  side: CardinalPlacementSide = 'south',
  factoryBounds?: { lengthM: number; widthM: number },
  slotIndex = 0,
  totalSlots = 1
): StationSidePlacement {
  const cx = obj.geometry.position.x;
  const cz = obj.geometry.position.z;
  const halfL = Math.max(0.2, obj.geometry.dimensions.length) / 2;
  const halfW = Math.max(0.2, obj.geometry.dimensions.width) / 2;
  const rad = ((obj.geometry.rotationDeg || 0) * Math.PI) / 180;

  // Rotated axis-aligned half-extents of the equipment footprint
  const rx = Math.abs(halfL * Math.cos(rad)) + Math.abs(halfW * Math.sin(rad));
  const rz = Math.abs(halfL * Math.sin(rad)) + Math.abs(halfW * Math.cos(rad));
  const standDist = 0.55;
  const tangentShift = totalSlots > 1 ? (slotIndex - (totalSlots - 1) / 2) * 0.72 : 0;

  let wx = cx;
  let wz = cz;

  if (side === 'north') {
    wx = cx + tangentShift;
    wz = cz - rz - standDist;
  } else if (side === 'south') {
    wx = cx + tangentShift;
    wz = cz + rz + standDist;
  } else if (side === 'east') {
    wx = cx + rx + standDist;
    wz = cz + tangentShift;
  } else {
    wx = cx - rx - standDist;
    wz = cz + tangentShift;
  }

  if (factoryBounds) {
    wx = Math.max(0.25, Math.min(factoryBounds.lengthM - 0.25, wx));
    wz = Math.max(0.25, Math.min(factoryBounds.widthM - 0.25, wz));
  }

  const facingRad = Math.atan2(cz - wz, cx - wx);
  const rotationDeg = normalizeRotationDeg((facingRad * 180) / Math.PI);

  return {
    position: {
      x: Math.round(wx * 100) / 100,
      y: 0,
      z: Math.round(wz * 100) / 100,
    },
    rotationDeg,
    side,
  };
}

/**
 * Computes world floor placement & belt-facing orientation for a worker assigned to a conveyor segment.
 */
export function computeConveyorSegmentPlacement(
  conv: LayoutObject,
  segmentIndex: number,
  segmentCountInput?: number,
  side: 1 | -1 = 1,
  factoryBounds?: { lengthM: number; widthM: number }
): ConveyorSegmentPlacement {
  const segmentCount = Math.max(1, Math.round(segmentCountInput ?? getConveyorSegmentCount(conv)));
  const clampedIdx = Math.max(0, Math.min(segmentCount - 1, Math.round(segmentIndex)));
  const offsetRatio = (clampedIdx + 0.5) / segmentCount;

  const L = Math.max(0.4, conv.geometry.dimensions.length);
  const W = Math.max(0.3, conv.geometry.dimensions.width);
  const rad = ((conv.geometry.rotationDeg || 0) * Math.PI) / 180;
  const dir = conv.operations.direction === -1 ? -1 : 1;

  // Unit vector along belt & right-hand perpendicular normal
  const ux = Math.cos(rad) * dir;
  const uz = Math.sin(rad) * dir;
  const nx = -uz;
  const nz = ux;

  const alongOffset = (offsetRatio - 0.5) * L;
  const beltPoint: Vec3 = {
    x: conv.geometry.position.x + ux * alongOffset,
    y: conv.geometry.dimensions.height,
    z: conv.geometry.position.z + uz * alongOffset,
  };

  const standDist = W / 2 + 0.55;
  let wx = beltPoint.x + nx * standDist * side;
  let wz = beltPoint.z + nz * standDist * side;

  if (factoryBounds) {
    wx = Math.max(0.25, Math.min(factoryBounds.lengthM - 0.25, wx));
    wz = Math.max(0.25, Math.min(factoryBounds.widthM - 0.25, wz));
  }

  // Face directly toward the conveyor belt point
  const facingRad = Math.atan2(beltPoint.z - wz, beltPoint.x - wx);
  const rotationDeg = normalizeRotationDeg((facingRad * 180) / Math.PI);

  return {
    position: { x: Math.round(wx * 100) / 100, y: 0, z: Math.round(wz * 100) / 100 },
    beltPoint,
    rotationDeg,
    offsetRatio,
    segmentIndex: clampedIdx,
    segmentCount,
    side,
  };
}

/**
 * Finds the nearest conveyor & longitudinal segment under a 2D floor coordinate (x, z).
 */
export function findConveyorSegmentAtPoint(
  objects: LayoutObject[],
  x: number,
  z: number,
  maxLateralDistanceM = 1.15
): ConveyorSegmentHit | null {
  let best: ConveyorSegmentHit | null = null;

  for (const obj of objects) {
    if (!obj.rendering.visible || obj.kind !== 'conveyor') continue;
    const L = Math.max(0.4, obj.geometry.dimensions.length);
    const W = Math.max(0.3, obj.geometry.dimensions.width);
    const rad = ((obj.geometry.rotationDeg || 0) * Math.PI) / 180;
    const dir = obj.operations.direction === -1 ? -1 : 1;
    const ux = Math.cos(rad) * dir;
    const uz = Math.sin(rad) * dir;
    const nx = -uz;
    const nz = ux;

    const dx = x - obj.geometry.position.x;
    const dz = z - obj.geometry.position.z;
    const localAlong = dx * ux + dz * uz;
    const localLateral = dx * nx + dz * nz;

    const lateralGap = Math.abs(localLateral) - W / 2;
    if (Math.abs(localAlong) <= L / 2 + 0.45 && lateralGap <= maxLateralDistanceM) {
      const dist = Math.max(0, lateralGap);
      if (!best || dist < best.distanceM) {
        const segmentCount = getConveyorSegmentCount(obj);
        const ratio = Math.max(0, Math.min(0.9999, (localAlong + L / 2) / L));
        const segmentIndex = Math.min(segmentCount - 1, Math.floor(ratio * segmentCount));
        best = {
          conveyor: obj,
          segmentIndex,
          segmentCount,
          offsetRatio: (segmentIndex + 0.5) / segmentCount,
          side: localLateral >= 0 ? 1 : -1,
          distanceM: dist,
        };
      }
    }
  }

  return best;
}

function ensureLinkedStageForObject(
  draft: ProjectData,
  obj: LayoutObject,
  codePrefix: 'OP' | 'CV'
): ProductionStage {
  let stage: ProductionStage | undefined = draft.stages.find(
    (s) => s.assignedObjectIds.includes(obj.id) || s.id === obj.stageId
  );

  if (!stage) {
    const sid = uid('stg');
    const idx = draft.stages.length + 1;
    stage = {
      id: sid,
      code: `${codePrefix}-${idx * 10}`,
      name: obj.name,
      description: obj.name,
      processingTimeSec: Math.max(1, obj.operations.processingTimeSec || 15),
      setupTimeSec: obj.operations.setupTimeSec || 0,
      loadingTimeSec: obj.operations.loadingTimeSec || 0,
      unloadingTimeSec: obj.operations.unloadingTimeSec || 0,
      requiredWorkers: Math.max(1, obj.operations.requiredOperators || 1),
      requiredMachines: 1,
      inputQty: 1,
      outputQty: 1,
      scrapRate: 0,
      reworkProbability: 0,
      bufferCapacity: Math.max(1, obj.operations.capacity || 5),
      predecessorIds: [],
      successorIds: [],
      assignedObjectIds: [obj.id],
      ...(obj.kind === 'conveyor' ? { conveyorObjectId: obj.id } : {}),
    };
    draft.stages.push(stage);
    obj.stageId = sid;
  } else if (stage.requiredWorkers <= 0) {
    stage.requiredWorkers = 1;
  }

  if (obj.operations.requiredOperators <= 0) {
    obj.operations.requiredOperators = 1;
  }
  if (obj.kind === 'conveyor' && (obj.operations.processingTimeSec || 0) <= 0 && (stage.processingTimeSec || 0) <= 0) {
    stage.processingTimeSec = 10;
    obj.operations.processingTimeSec = 10;
  }

  return stage;
}

/**
 * Assigns a worker to a specific segment & side of a conveyor (`assignedTo` + `assignedStationId` + `assignedConveyorSegment`),
 * repositions & orients the worker alongside that segment, and ensures an interactive conveyor work stage exists for DES.
 */
export function assignWorkerToConveyorSegmentInDraft(
  draft: ProjectData,
  workerId: string,
  conveyorId: string,
  segmentIndex: number,
  segmentCountInput?: number,
  side?: 1 | -1
): boolean {
  const wk = draft.workers.find((w) => w.id === workerId);
  const conv = draft.layoutObjects.find((o) => o.id === conveyorId && o.kind === 'conveyor');
  if (!wk || !conv) return false;

  const currentTargetId = wk.assignedTo || wk.assignedStationId;
  const chosenSide: 1 | -1 =
    side ??
    (currentTargetId === conveyorId ? wk.assignedConveyorSegment?.side : undefined) ??
    1;

  const placement = computeConveyorSegmentPlacement(
    conv,
    segmentIndex,
    segmentCountInput,
    chosenSide,
    {
      lengthM: draft.factory.lengthM,
      widthM: draft.factory.widthM,
    }
  );

  wk.assignedTo = conv.id;
  wk.assignedStationId = conv.id;
  wk.assignedConveyorSegment = {
    objectId: conv.id,
    segmentIndex: placement.segmentIndex,
    segmentCount: placement.segmentCount,
    offsetRatio: placement.offsetRatio,
    side: chosenSide,
  };
  wk.placementSide = getConveyorCardinalSide(conv, chosenSide);
  wk.position = placement.position;
  wk.rotation = placement.rotationDeg;
  wk.rotationDeg = placement.rotationDeg;

  const stage = ensureLinkedStageForObject(draft, conv, 'CV');
  if (!wk.assignedStageIds.includes(stage.id)) {
    wk.assignedStageIds = [...wk.assignedStageIds, stage.id];
  }

  return true;
}

/**
 * Assigns a worker to a station/machine (or conveyor) on any user-chosen cardinal side
 * (`north` / `south` / `east` / `west`) without forcing South placement.
 */
export function assignWorkerToStationSideInDraft(
  draft: ProjectData,
  workerId: string,
  stationId: string,
  side?: CardinalPlacementSide
): boolean {
  const wk = draft.workers.find((w) => w.id === workerId);
  const obj = draft.layoutObjects.find((o) => o.id === stationId);
  if (!wk || !obj) return false;

  if (obj.kind === 'conveyor') {
    const convSide: 1 | -1 = side
      ? resolveConveyorSideFromCardinal(obj, side)
      : wk.assignedConveyorSegment?.objectId === obj.id
      ? wk.assignedConveyorSegment.side ?? 1
      : 1;
    const segIdx =
      wk.assignedConveyorSegment?.objectId === obj.id
        ? wk.assignedConveyorSegment.segmentIndex
        : 0;
    return assignWorkerToConveyorSegmentInDraft(
      draft,
      workerId,
      obj.id,
      segIdx,
      wk.assignedConveyorSegment?.segmentCount,
      convSide
    );
  }

  const chosenSide: CardinalPlacementSide =
    side ?? (wk.placementSide && wk.placementSide !== 'custom' ? wk.placementSide : 'south');

  wk.assignedTo = obj.id;
  wk.assignedStationId = obj.id;
  wk.assignedConveyorSegment = undefined;
  wk.placementSide = chosenSide;

  // Spread peers assigned to the same station and same side cleanly along the edge
  const peersOnSameSide = draft.workers.filter(
    (peer) =>
      (peer.assignedTo || peer.assignedStationId) === obj.id &&
      (peer.placementSide && peer.placementSide !== 'custom' ? peer.placementSide : 'south') === chosenSide
  );
  const totalSlots = Math.max(1, peersOnSameSide.length);
  peersOnSameSide.forEach((peer, slotIndex) => {
    const placement = computeStationSidePlacement(
      obj,
      chosenSide,
      { lengthM: draft.factory.lengthM, widthM: draft.factory.widthM },
      slotIndex,
      totalSlots
    );
    peer.position = placement.position;
    peer.rotation = placement.rotationDeg;
    peer.rotationDeg = placement.rotationDeg;
    peer.placementSide = chosenSide;
  });

  const stage = ensureLinkedStageForObject(draft, obj, 'OP');
  if (!wk.assignedStageIds.includes(stage.id)) {
    wk.assignedStageIds = [...wk.assignedStageIds, stage.id];
  }

  return true;
}

/**
 * Removes worker's `assignedTo` / `assignedStationId` / segment link cleanly.
 */
export function unassignWorkerFromConveyorInDraft(draft: ProjectData, workerId: string): boolean {
  const wk = draft.workers.find((w) => w.id === workerId);
  if (!wk) return false;
  wk.assignedTo = undefined;
  wk.assignedStationId = undefined;
  wk.assignedConveyorSegment = undefined;
  return true;
}
