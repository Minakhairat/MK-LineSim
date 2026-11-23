import {
  LayoutObject,
  ProductionRoute,
  ProductionStage,
  ProjectData,
  Vec3,
  WorkerDefinition,
} from '../types/project';
import { getRotatedBounds, uid } from '../utils/units';
import { computeStationSidePlacement } from '../engineering/conveyorWorkerAssignment';

function getConveyorEndpoints(conv: LayoutObject): { entry: Vec3; exit: Vec3; ux: number; uz: number } {
  const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
  const dir = conv.operations.direction === -1 ? -1 : 1;
  const ux = Math.cos(rad) * dir;
  const uz = Math.sin(rad) * dir;
  const halfL = Math.max(0.25, conv.geometry.dimensions.length / 2 - 0.15);
  return {
    entry: {
      x: conv.geometry.position.x - ux * halfL,
      y: conv.geometry.dimensions.height,
      z: conv.geometry.position.z - uz * halfL,
    },
    exit: {
      x: conv.geometry.position.x + ux * halfL,
      y: conv.geometry.dimensions.height,
      z: conv.geometry.position.z + uz * halfL,
    },
    ux,
    uz,
  };
}

function projectProgressAlongConveyor(pos: Vec3, conv: LayoutObject): number {
  const { ux, uz } = getConveyorEndpoints(conv);
  const dx = pos.x - conv.geometry.position.x;
  const dz = pos.z - conv.geometry.position.z;
  return dx * ux + dz * uz;
}

/**
 * Rebuilds stage predecessorIds and object.connectedToIds (for stations/machines/buffers)
 * strictly from stage.successorIds so 2D/3D arrows match the Flowchart.
 */
export function syncStagePredecessorsAndObjectLinks(draft: ProjectData): void {
  const stageMap = new Map<string, ProductionStage>();
  const stageIds = new Set<string>();
  for (const st of draft.stages) {
    stageMap.set(st.id, st);
    stageIds.add(st.id);
    st.predecessorIds = [];
    st.successorIds = st.successorIds.filter((sid, idx, arr) => sid !== st.id && arr.indexOf(sid) === idx);
  }

  for (const st of draft.stages) {
    st.successorIds = st.successorIds.filter((sid) => stageIds.has(sid));
    for (const succId of st.successorIds) {
      const target = stageMap.get(succId);
      if (target && !target.predecessorIds.includes(st.id)) {
        target.predecessorIds.push(st.id);
      }
    }
  }

  // Mirror stage -> stage flowchart edges onto assigned floor objects
  // Keep geometric conveyor->conveyor links ONLY for conveyors that are not standalone flowchart stages
  const stageConveyorObjIds = new Set<string>();
  for (const st of draft.stages) {
    for (const oid of st.assignedObjectIds) {
      const obj = draft.layoutObjects.find((o) => o.id === oid);
      if (obj && obj.kind === 'conveyor') stageConveyorObjIds.add(obj.id);
    }
  }

  for (const obj of draft.layoutObjects) {
    if (obj.kind !== 'conveyor' || stageConveyorObjIds.has(obj.id)) {
      obj.connectedToIds = [];
    }
  }

  for (const st of draft.stages) {
    const nextObjIds: string[] = [];
    for (const succId of st.successorIds) {
      const succ = stageMap.get(succId);
      if (succ) {
        for (const oid of succ.assignedObjectIds) {
          if (!nextObjIds.includes(oid)) nextObjIds.push(oid);
        }
      }
    }
    for (const srcObjId of st.assignedObjectIds) {
      const srcObj = draft.layoutObjects.find((o) => o.id === srcObjId);
      if (srcObj && (srcObj.kind !== 'conveyor' || stageConveyorObjIds.has(srcObj.id))) {
        srcObj.connectedToIds = [...nextObjIds];
      }
    }
  }
}

/**
 * Ensures a product switching from 'auto' to 'manual' keeps its current entry stage
 * so editing a single downstream wire doesn't silently clear the Start connection.
 */
export function ensureManualFlowchartSeeded(draft: ProjectData): void {
  const prod = draft.products[0];
  if (!prod) return;
  if (prod.routingMode !== 'manual') {
    const existingEntries =
      prod.entryStageIds && prod.entryStageIds.length > 0
        ? prod.entryStageIds
        : prod.routeStageIds.length > 0
        ? [prod.routeStageIds[0]]
        : draft.stages.length > 0
        ? [draft.stages[0].id]
        : [];
    prod.routingMode = 'manual';
    prod.entryStageIds = existingEntries.filter((id) => draft.stages.some((s) => s.id === id));
  } else if (!Array.isArray(prod.entryStageIds)) {
    prod.entryStageIds = prod.routeStageIds.length > 0 ? [prod.routeStageIds[0]] : [];
  }
}

/**
 * Computes reachable stage IDs in topological/BFS order starting from entryStageIds.
 */
export function computeFlowchartReachableStages(
  entryStageIds: string[],
  stages: ProductionStage[]
): string[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const ordered: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const eid of entryStageIds) {
    if (stageMap.has(eid) && !visited.has(eid)) {
      visited.add(eid);
      queue.push(eid);
    }
  }

  while (queue.length > 0) {
    const curId = queue.shift()!;
    ordered.push(curId);
    const st = stageMap.get(curId);
    if (!st) continue;
    for (const nextId of st.successorIds) {
      if (stageMap.has(nextId) && !visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }

  return ordered;
}

/**
 * Synchronizes `product.routeStageIds` and `project.routes` with the active stages.
 * Respects `routingMode === 'manual'` so user-authored flowchart routes are never overwritten.
 */
export function syncProductRoutes(draft: ProjectData): void {
  const allStageIds = draft.stages.map((s) => s.id);
  const allStageSet = new Set(allStageIds);
  const updatedRoutes: ProductionRoute[] = [];

  for (const prod of draft.products) {
    if (prod.routingMode === 'manual') {
      if (Array.isArray(prod.entryStageIds)) {
        prod.entryStageIds = prod.entryStageIds.filter((id) => allStageSet.has(id));
        prod.routeStageIds = computeFlowchartReachableStages(prod.entryStageIds, draft.stages);
      } else {
        prod.routeStageIds = prod.routeStageIds.filter((id) => allStageSet.has(id));
        prod.entryStageIds = prod.routeStageIds.length > 0 ? [prod.routeStageIds[0]] : [];
      }
    } else {
      prod.routeStageIds = prod.routeStageIds.filter((id) => allStageSet.has(id));
      if (prod.routeStageIds.length === 0) {
        prod.routeStageIds = [...allStageIds];
      } else if (allStageIds.length > prod.routeStageIds.length) {
        // Automatically append newly added floor stages in auto-routing mode
        for (const sid of allStageIds) {
          if (!prod.routeStageIds.includes(sid)) {
            prod.routeStageIds.push(sid);
          }
        }
      }
      prod.entryStageIds = prod.routeStageIds.length > 0 ? [prod.routeStageIds[0]] : [];
    }

    const existingRoute = draft.routes.find((r) => r.productId === prod.id);
    updatedRoutes.push({
      id: existingRoute?.id || uid('route'),
      name: existingRoute?.name || `${prod.code || prod.name} Route`,
      productId: prod.id,
      stageIds: [...prod.routeStageIds],
    });
  }

  draft.routes = updatedRoutes;
}

/**
 * Directly imports the user-drawn Flowchart graph (`entryStageIds` & `stages[].successorIds`),
 * binds every Flowchart node bidirectionally to its matching physical floor machine/conveyor object,
 * syncs timing/worker requirements cleanly, and ensures operators exist for active nodes.
 */
export function importFlowchartToSimulationData(project: ProjectData): {
  updated: ProjectData;
  boundNodes: number;
  repairedNodes: number;
  workersCreated: number;
} {
  const draft: ProjectData = structuredClone(project);
  let boundNodes = 0;
  let repairedNodes = 0;
  let workersCreated = 0;

  const visibleObjects = draft.layoutObjects.filter((o) => o.rendering.visible);
  const processObjects = visibleObjects.filter(
    (o) =>
      o.kind === 'workstation' ||
      o.kind === 'machine' ||
      o.kind === 'buffer' ||
      o.kind === 'conveyor'
  );
  const objById = new Map(visibleObjects.map((o) => [o.id, o]));
  const usedObjectIds = new Set<string>();

  for (const st of draft.stages) {
    // Keep only valid visible objects
    st.assignedObjectIds = st.assignedObjectIds.filter((oid) => objById.has(oid));

    if (st.assignedObjectIds.length === 0 && processObjects.length > 0) {
      // Try matching by stageId or name before picking an unassigned floor object
      const match =
        processObjects.find((o) => o.stageId === st.id) ||
        processObjects.find(
          (o) => o.name.trim().toLowerCase() === st.name.trim().toLowerCase()
        ) ||
        processObjects.find((o) => !usedObjectIds.has(o.id) && o.kind !== 'conveyor') ||
        processObjects.find((o) => !usedObjectIds.has(o.id));
      if (match) {
        st.assignedObjectIds = [match.id];
        repairedNodes++;
      }
    }

    const primaryObj = objById.get(st.assignedObjectIds[0]);
    if (primaryObj) {
      usedObjectIds.add(primaryObj.id);
      boundNodes++;
      primaryObj.stageId = st.id;

      if (primaryObj.kind === 'conveyor') {
        // Preserve user-configured manual inspection/assembly work on conveyor when set
        const stageHasWork =
          st.requiredWorkers > 0 ||
          st.processingTimeSec > 0 ||
          st.loadingTimeSec > 0 ||
          st.unloadingTimeSec > 0;
        const objHasWork =
          primaryObj.operations.requiredOperators > 0 ||
          primaryObj.operations.processingTimeSec > 0 ||
          primaryObj.operations.loadingTimeSec > 0 ||
          primaryObj.operations.unloadingTimeSec > 0;
        if (stageHasWork) {
          primaryObj.operations.processingTimeSec = Math.max(0, st.processingTimeSec);
          primaryObj.operations.setupTimeSec = Math.max(0, st.setupTimeSec);
          primaryObj.operations.loadingTimeSec = Math.max(0, st.loadingTimeSec);
          primaryObj.operations.unloadingTimeSec = Math.max(0, st.unloadingTimeSec);
          primaryObj.operations.requiredOperators = Math.max(0, st.requiredWorkers);
        } else if (objHasWork) {
          st.processingTimeSec = Math.max(0, primaryObj.operations.processingTimeSec);
          st.setupTimeSec = Math.max(0, primaryObj.operations.setupTimeSec);
          st.loadingTimeSec = Math.max(0, primaryObj.operations.loadingTimeSec);
          st.unloadingTimeSec = Math.max(0, primaryObj.operations.unloadingTimeSec);
          st.requiredWorkers = Math.max(0, primaryObj.operations.requiredOperators);
        }
        if (!primaryObj.operations.speedMps || primaryObj.operations.speedMps <= 0) {
          primaryObj.operations.speedMps = 0.08;
        }
      } else {
        // Bind stage timing & capacity cleanly onto floor machine/workstation
        primaryObj.operations.processingTimeSec = Math.max(0, st.processingTimeSec);
        primaryObj.operations.setupTimeSec = Math.max(0, st.setupTimeSec);
        primaryObj.operations.loadingTimeSec = Math.max(0, st.loadingTimeSec);
        primaryObj.operations.unloadingTimeSec = Math.max(0, st.unloadingTimeSec);
        primaryObj.operations.requiredOperators =
          primaryObj.kind === 'buffer' ? 0 : Math.max(0, st.requiredWorkers);
        if (st.batchSize !== undefined) primaryObj.operations.batchSize = st.batchSize;
        if (st.batchMode !== undefined) primaryObj.operations.batchMode = st.batchMode;
      }
    }

    if (st.bufferCapacity < 1) st.bufferCapacity = 4;
  }

  // Ensure active product preserves manual flowchart entry & reachable graph
  if (draft.products.length > 0 && draft.stages.length > 0) {
    const active = draft.products[0];
    if (active.routingMode !== 'manual') {
      active.routingMode = 'manual';
      if (!active.entryStageIds || active.entryStageIds.length === 0) {
        active.entryStageIds = [draft.stages[0].id];
      }
    }
  }

  syncStagePredecessorsAndObjectLinks(draft);
  syncProductRoutes(draft);

  // Ensure every reachable stage needing operators has workers assigned so simulation flows smoothly
  const reachable = new Set(draft.products[0]?.routeStageIds || draft.stages.map((s) => s.id));
  for (const st of draft.stages) {
    if (!reachable.has(st.id) || st.requiredWorkers <= 0) continue;
    const assigned = draft.workers.filter(
      (w) =>
        w.assignedStageIds.includes(st.id) ||
        st.assignedObjectIds.includes(w.assignedTo || w.assignedStationId || '')
    );
    const stObj = objById.get(st.assignedObjectIds[0]);
    while (assigned.length < st.requiredWorkers) {
      const n = draft.workers.length + 1;
      const defaultSide = 'south' as const;
      const placement = stObj
        ? computeStationSidePlacement(
            stObj,
            defaultSide,
            { lengthM: draft.factory.lengthM, widthM: draft.factory.widthM },
            assigned.length,
            st.requiredWorkers
          )
        : undefined;
      const newWorker: WorkerDefinition = {
        id: uid('wrk'),
        label: `W-${String(n).padStart(2, '0')}`,
        name: `Operator ${String(n).padStart(2, '0')}`,
        position: placement ? placement.position : { x: 4, y: 0, z: 10 },
        rotation: placement ? placement.rotationDeg : 0,
        rotationDeg: placement ? placement.rotationDeg : 0,
        placementSide: placement ? defaultSide : 'custom',
        assignedStageIds: [st.id],
        assignedTo: stObj?.id,
        assignedStationId: stObj?.id,
        skillCategory: 'Assembly & Operations',
        skillLevel: 4,
        efficiencyFactor: 1.0,
        walkingSpeedMps: 1.25,
        shiftId: draft.simulationConfig.shifts[0]?.id || 'shift_day',
        color: '#1D4ED8',
      };
      draft.workers.push(newWorker);
      assigned.push(newWorker);
      workersCreated++;
    }
  }

  return { updated: draft, boundNodes, repairedNodes, workersCreated };
}

/**
 * Automatically wires conveyors, workstations, machines, stages, workers,
 * and product routes so a simulation can run immediately with 1 click
 * or as soon as equipment is placed on the floor.
 * When any product is in `routingMode === 'manual'` (user Flowchart),
 * stage/product graph edges are preserved and only missing physical resources are prepared.
 */
export function autoWireProjectForSimulation(project: ProjectData, forceSequential = false): {
  updated: ProjectData;
  stagesCreated: number;
  workersCreated: number;
} {
  const draft: ProjectData = structuredClone(project);
  let stagesCreated = 0;
  let workersCreated = 0;

  if (forceSequential) {
    for (const p of draft.products) {
      p.routingMode = 'auto';
      p.entryStageIds = undefined;
    }
  }

  const preserveManualFlow = !forceSequential && draft.products.some((p) => p.routingMode === 'manual');

  // Ensure at least 1 product exists
  if (draft.products.length === 0) {
    draft.products.push({
      id: uid('prod'),
      code: 'PRD-100',
      name: 'Standard Product',
      category: 'General Assembly',
      dimensions: { length: 0.65, width: 0.45, height: 0.6 },
      weightKg: 15,
      color: '#E2E8F0',
      targetQuantity: 400,
      routeStageIds: [],
      modelShape: 'box',
      routingMode: 'auto',
    });
  }

  const conveyors = draft.layoutObjects.filter((o) => o.kind === 'conveyor' && o.rendering.visible);
  // Order conveyors into a geometric chain when multiple conveyors exist
  const orderedConveyors: LayoutObject[] = [];
  if (conveyors.length > 0) {
    const remaining = [...conveyors];
    remaining.sort((a, b) => a.geometry.position.x - b.geometry.position.x || a.geometry.position.z - b.geometry.position.z);
    let current = remaining.shift()!;
    orderedConveyors.push(current);
    while (remaining.length > 0) {
      const { exit } = getConveyorEndpoints(current);
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const { entry } = getConveyorEndpoints(remaining[i]);
        const d = Math.hypot(entry.x - exit.x, entry.z - exit.z);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      current = remaining.splice(bestIdx, 1)[0];
      orderedConveyors.push(current);
    }
    for (let i = 0; i < orderedConveyors.length; i++) {
      orderedConveyors[i].connectedToIds =
        i < orderedConveyors.length - 1 ? [orderedConveyors[i + 1].id] : [];
    }
  }

  const processObjs = draft.layoutObjects.filter(
    (o) =>
      o.rendering.visible &&
      (o.kind === 'workstation' || o.kind === 'machine' || o.kind === 'buffer')
  );

  const makeStationAtConveyorEnd = (
    conv: LayoutObject,
    end: 'infeed' | 'outfeed',
    name: string,
    objPrefix: string,
    stgId: string
  ): LayoutObject => {
    const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
    const dir = conv.operations.direction === -1 ? -1 : 1;
    const halfL = Math.max(0.4, conv.geometry.dimensions.length / 2 - 0.55);
    const sign = end === 'infeed' ? -1 : 1;
    const dx = Math.cos(rad) * dir * halfL * sign;
    const dz = Math.sin(rad) * dir * halfL * sign;
    const sideOffset = conv.geometry.dimensions.width / 2 + 0.45 + 0.25;
    const nx = -Math.sin(rad) * sideOffset;
    const nz = Math.cos(rad) * sideOffset;
    const candZ = conv.geometry.position.z + nz;
    const sideSign = candZ > draft.factory.widthM - 0.8 || candZ < 0.8 ? -1 : 1;

    return {
      id: uid(objPrefix),
      name,
      kind: 'workstation',
      category: 'assembly_table',
      templateId: 'tpl_assembly_table',
      productionLineId: conv.productionLineId,
      stageId: stgId,
      connectedToIds: [],
      geometry: {
        position: {
          x: Math.max(0.6, Math.min(draft.factory.lengthM - 0.6, conv.geometry.position.x + dx + nx * sideSign)),
          y: 0,
          z: Math.max(0.6, Math.min(draft.factory.widthM - 0.6, conv.geometry.position.z + dz + nz * sideSign)),
        },
        dimensions: { length: 1.0, width: 0.9, height: conv.geometry.dimensions.height },
        rotationDeg: conv.geometry.rotationDeg,
        clearanceM: 0.3,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 1,
        availability: 0.99,
        requiredOperators: 1,
      },
      rendering: { color: '#1E293B', visible: true, locked: false, layer: 'equipment' },
    };
  };

  if (processObjs.length === 0 && orderedConveyors.length > 0) {
    const firstConv = orderedConveyors[0];
    const lastConv = orderedConveyors[orderedConveyors.length - 1];
    const st1Id = uid('stg_in');
    const st2Id = uid('stg_out');

    const inObj = makeStationAtConveyorEnd(firstConv, 'infeed', 'Infeed Station', 'obj_in', st1Id);
    const outObj = makeStationAtConveyorEnd(lastConv, 'outfeed', 'Outfeed Station', 'obj_out', st2Id);
    inObj.connectedToIds = [outObj.id];

    draft.layoutObjects.push(inObj, outObj);
    processObjs.push(inObj, outObj);
  }

  const findNearestConv = (obj: LayoutObject): { conv: LayoutObject | undefined; convIdx: number } => {
    if (orderedConveyors.length === 0) return { conv: undefined, convIdx: 0 };
    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < orderedConveyors.length; i++) {
      const c = orderedConveyors[i];
      const d = Math.hypot(
        c.geometry.position.x - obj.geometry.position.x,
        c.geometry.position.z - obj.geometry.position.z
      );
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    return { conv: orderedConveyors[bestIdx], convIdx: bestIdx };
  };

  if (!preserveManualFlow) {
    processObjs.sort((a, b) => {
      const ca = findNearestConv(a);
      const cb = findNearestConv(b);
      if (ca.convIdx !== cb.convIdx) return ca.convIdx - cb.convIdx;
      if (ca.conv && cb.conv) {
        return (
          projectProgressAlongConveyor(a.geometry.position, ca.conv) -
          projectProgressAlongConveyor(b.geometry.position, cb.conv)
        );
      }
      return a.geometry.position.x - b.geometry.position.x || a.geometry.position.z - b.geometry.position.z;
    });
  }

  // Remove orphaned stages whose assigned objects were deleted
  draft.stages = draft.stages.filter((s) =>
    s.assignedObjectIds.some((id) => draft.layoutObjects.some((o) => o.id === id && o.rendering.visible))
  );

  // Create stages for any newly placed workstations/machines/buffers lacking a stage
  const existingAssignedObjIds = new Set(draft.stages.flatMap((s) => s.assignedObjectIds));
  for (const obj of processObjs) {
    if (existingAssignedObjIds.has(obj.id)) continue;

    const { conv: nearestConv } = findNearestConv(obj);
    const stId =
      obj.stageId && !draft.stages.some((s) => s.id === obj.stageId) ? obj.stageId : uid('stg');
    const idx = draft.stages.length + 1;
    const newStage: ProductionStage = {
      id: stId,
      code: `OP-${idx * 10}`,
      name: obj.name,
      description: `Linked operation for ${obj.name}`,
      processingTimeSec: Math.max(0, obj.operations.processingTimeSec ?? 25),
      setupTimeSec: obj.operations.setupTimeSec || 0,
      loadingTimeSec: obj.operations.loadingTimeSec || 0,
      unloadingTimeSec: obj.operations.unloadingTimeSec || 0,
      requiredWorkers:
        obj.kind === 'buffer' || obj.operations.requiredOperators === 0
          ? 0
          : Math.max(0, obj.operations.requiredOperators ?? 1),
      requiredMachines: 1,
      inputQty: 1,
      outputQty: 1,
      scrapRate: 0,
      reworkProbability: 0,
      bufferCapacity: 4,
      predecessorIds: [],
      successorIds: [],
      assignedObjectIds: [obj.id],
      conveyorObjectId: nearestConv?.id,
      ...(obj.operations.batchSize !== undefined ? { batchSize: obj.operations.batchSize } : {}),
      ...(obj.operations.batchMode !== undefined ? { batchMode: obj.operations.batchMode } : {}),
    };
    obj.stageId = stId;
    draft.stages.push(newStage);
    stagesCreated++;
  }

  if (!preserveManualFlow) {
    const stageOrderScore = (st: ProductionStage): number => {
      const obj = draft.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
      if (!obj) return 999999;
      const idx = processObjs.findIndex((p) => p.id === obj.id);
      return idx >= 0 ? idx : 999999;
    };
    draft.stages.sort((a, b) => stageOrderScore(a) - stageOrderScore(b));

    for (let i = 0; i < draft.stages.length; i++) {
      const st = draft.stages[i];
      st.predecessorIds = i > 0 ? [draft.stages[i - 1].id] : [];
      st.successorIds = i < draft.stages.length - 1 ? [draft.stages[i + 1].id] : [];

      const stObj = draft.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
      if (stObj) {
        stObj.stageId = st.id;
        const { conv } = findNearestConv(stObj);
        if (conv && (!st.conveyorObjectId || !orderedConveyors.some((c) => c.id === st.conveyorObjectId))) {
          st.conveyorObjectId = conv.id;
        }
        if (i < draft.stages.length - 1) {
          const nextObjId = draft.stages[i + 1].assignedObjectIds[0];
          stObj.connectedToIds = nextObjId ? [nextObjId] : [];
        } else {
          stObj.connectedToIds = [];
        }
      }
      if (st.bufferCapacity < 1) st.bufferCapacity = 4;
    }
  } else {
    // Manual flowchart active: only fix missing conveyor links and sync object arrows from existing stage.successorIds
    for (const st of draft.stages) {
      const stObj = draft.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
      if (stObj) {
        stObj.stageId = st.id;
        const { conv } = findNearestConv(stObj);
        if (conv && (!st.conveyorObjectId || !orderedConveyors.some((c) => c.id === st.conveyorObjectId))) {
          st.conveyorObjectId = conv.id;
        }
      }
      if (st.bufferCapacity < 1) st.bufferCapacity = 4;
    }
    syncStagePredecessorsAndObjectLinks(draft);
  }

  // Ensure every stage requiring workers has assigned workers
  for (const st of draft.stages) {
    if (st.requiredWorkers <= 0) continue;
    const assigned = draft.workers.filter((w) => w.assignedStageIds.includes(st.id));
    const stObj = draft.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
    while (assigned.length < st.requiredWorkers) {
      const n = draft.workers.length + 1;
      const defaultSide = 'south' as const;
      const placement = stObj
        ? computeStationSidePlacement(
            stObj,
            defaultSide,
            { lengthM: draft.factory.lengthM, widthM: draft.factory.widthM },
            assigned.length,
            st.requiredWorkers
          )
        : undefined;
      const newWorker: WorkerDefinition = {
        id: uid('wrk'),
        label: `W-${String(n).padStart(2, '0')}`,
        name: `Operator ${String(n).padStart(2, '0')}`,
        position: placement ? placement.position : { x: 4, y: 0, z: 10 },
        rotation: placement ? placement.rotationDeg : 0,
        rotationDeg: placement ? placement.rotationDeg : 0,
        placementSide: placement ? defaultSide : 'custom',
        assignedStageIds: [st.id],
        assignedTo: stObj?.id,
        assignedStationId: stObj?.id,
        skillCategory: 'Assembly & Operations',
        skillLevel: 4,
        efficiencyFactor: 1.0,
        walkingSpeedMps: 1.25,
        shiftId: draft.simulationConfig.shifts[0]?.id || 'shift_day',
        color: '#1D4ED8',
      };
      draft.workers.push(newWorker);
      assigned.push(newWorker);
      workersCreated++;
    }
  }

  syncProductRoutes(draft);

  return { updated: draft, stagesCreated, workersCreated };
}

/**
 * Resolves out-of-bounds, overlaps, and missing route links cleanly.
 */
export function autoFixProjectIssues(project: ProjectData): ProjectData {
  const { updated } = autoWireProjectForSimulation(project);
  const fL = updated.factory.lengthM;
  const fW = updated.factory.widthM;

  // 1. Clamp all layout objects cleanly inside factory bounds
  for (const obj of updated.layoutObjects) {
    const b = getRotatedBounds(
      obj.geometry.position.x,
      obj.geometry.position.z,
      obj.geometry.dimensions.length,
      obj.geometry.dimensions.width,
      obj.geometry.rotationDeg
    );
    const halfX = (b.maxX - b.minX) / 2;
    const halfZ = (b.maxZ - b.minZ) / 2;
    obj.geometry.position.x = Math.max(halfX + 0.1, Math.min(fL - halfX - 0.1, obj.geometry.position.x));
    obj.geometry.position.z = Math.max(halfZ + 0.1, Math.min(fW - halfZ - 0.1, obj.geometry.position.z));
    if (obj.geometry.dimensions.height > updated.factory.heightM) {
      obj.geometry.dimensions.height = Math.max(0.5, updated.factory.heightM - 0.2);
    }
    if (obj.kind === 'conveyor' && (!obj.operations.speedMps || obj.operations.speedMps <= 0)) {
      obj.operations.speedMps = 0.06;
    }
  }

  // 2. Nudge overlapping stationary machines/workstations slightly apart
  const nonConveyors = updated.layoutObjects.filter(
    (o) => o.rendering.visible && o.kind !== 'conveyor' && o.kind !== 'vehicle'
  );
  for (let i = 0; i < nonConveyors.length; i++) {
    for (let j = i + 1; j < nonConveyors.length; j++) {
      const a = nonConveyors[i];
      const b = nonConveyors[j];
      const ba = getRotatedBounds(
        a.geometry.position.x,
        a.geometry.position.z,
        a.geometry.dimensions.length,
        a.geometry.dimensions.width,
        a.geometry.rotationDeg
      );
      const bb = getRotatedBounds(
        b.geometry.position.x,
        b.geometry.position.z,
        b.geometry.dimensions.length,
        b.geometry.dimensions.width,
        b.geometry.rotationDeg
      );
      const ox = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
      const oz = Math.min(ba.maxZ, bb.maxZ) - Math.max(ba.minZ, bb.minZ);
      if (ox > 0.08 && oz > 0.08) {
        const shiftZ = b.geometry.position.z >= a.geometry.position.z ? oz + 0.25 : -(oz + 0.25);
        b.geometry.position.z = Math.max(1, Math.min(fW - 1, b.geometry.position.z + shiftZ));
      }
    }
  }

  // 3. Nudge non-conveyors clear of conveyors if overlapping
  const convList = updated.layoutObjects.filter((o) => o.rendering.visible && o.kind === 'conveyor');
  for (const obj of nonConveyors) {
    for (const conv of convList) {
      const bo = getRotatedBounds(
        obj.geometry.position.x,
        obj.geometry.position.z,
        obj.geometry.dimensions.length,
        obj.geometry.dimensions.width,
        obj.geometry.rotationDeg
      );
      const bc = getRotatedBounds(
        conv.geometry.position.x,
        conv.geometry.position.z,
        conv.geometry.dimensions.length,
        conv.geometry.dimensions.width,
        conv.geometry.rotationDeg
      );
      const ox = Math.min(bo.maxX, bc.maxX) - Math.max(bo.minX, bc.minX);
      const oz = Math.min(bo.maxZ, bc.maxZ) - Math.max(bo.minZ, bc.minZ);
      if (ox > 0.08 && oz > 0.08) {
        const shiftZ = obj.geometry.position.z >= conv.geometry.position.z ? oz + 0.22 : -(oz + 0.22);
        obj.geometry.position.z = Math.max(0.8, Math.min(fW - 0.8, obj.geometry.position.z + shiftZ));
      }
    }
  }

  return updated;
}
