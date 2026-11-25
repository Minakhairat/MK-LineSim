import {
  Dimensions3D,
  LayoutObject,
  ProductAnalytics,
  ProductDefinition,
  ProductionStage,
  ProjectData,
  ResourceOeeAnalytics,
  SimulationConfig,
  SimulationKPIs,
  StageAnalytics,
  Vec3,
  WorkerDefinition,
} from '../types/project';
import {
  computeConveyorPathTimeSec as physicsConveyorPathTimeSec,
  ConveyorMetrics,
  evaluateConveyorPhysics,
} from '../engineering/conveyorPhysics';
import {
  computeShiftAdjustedStageCapacity,
  computeStageCapacityProfile,
  isVirtualWorkstationObject,
  resolveStageBatchConfig,
  StageAssignmentMode,
  StageBatchConfig,
} from '../engineering/capacityEngine';
import {
  CardinalPlacementSide,
  computeConveyorSegmentPlacement,
  computeStationSidePlacement,
} from '../engineering/conveyorWorkerAssignment';
import { computeOeeMetrics } from '../engineering/oeeEngine';
import { ResourceCalendarEngine } from './resourceCalendar';
import { FailureModelParams, resolveObjectFailureParams } from './failureModels';

export type { ConveyorMetrics, FailureModelParams, StageBatchConfig };
export { resolveStageBatchConfig, resolveObjectFailureParams };

export interface ShiftWindowAudit {
  simTimeSec: number;
  elapsedBreakSec: number;
  activeSimTimeSec: number;
  totalShiftBreakSec: number;
  fullShiftNetSec: number;
  plannedDowntimeSec: number;
  plantMaintenanceDowntimeSec: number;
  arrivalIntervalSec: number;
  plannedUnits: number;
  plannedUnitsCap: number; // Infinity when continuous unlimited over shift
}

export interface StageTimingSummary {
  stageId: string;
  stageName: string;
  baseTaskTimeSec: number;
  setupTimeSec: number;
  batchTransferTimeSec: number;
  batchSize: number;
  batchMode: StageBatchConfig['batchMode'];
  effectiveBatchDivisor: number;
  parallelCapacity: number;
  physicalParallelCapacity: number;
  virtualParallelCapacity: number;
  stageAssignmentMode: StageAssignmentMode;
  isVirtual: boolean;
  isHeterogeneous: boolean;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
  physicalCapacityPerHour: number;
  virtualCapacityPerHour: number;
  theoreticalBatchCapacityPerHour: number;
  netScheduledSec: number;
  netProductionAfterSetupSec: number;
  shiftAdjustedCapacityUnits: number;
  shiftAdjustedDiscreteUnits: number;
  shiftAdjustedHourlyCapacity: number;
  requiredWorkers: number;
  bufferCapacity: number;
  isValid: boolean;
}

export interface ProjectTimingAudit {
  netShiftSec: number;
  arrivalIntervalSec: number;
  lineTaktTimeSec: number;
  totalTaskTimeSec: number;
  bottleneckStageId?: string;
  bottleneckStageName?: string;
  bottleneckCycleSec: number;
  theoreticalHourlyCapacity: number;
  physicalHourlyCapacity: number;
  hasVirtualStages: boolean;
  virtualStageIds: string[];
  shiftBottleneckStageId?: string;
  shiftAdjustedLineCapacityUnits: number;
  effectiveTheoreticalThroughputPerHour: number;
  lineBalanceEfficiencyPct: number;
  hasSharedResources: boolean;
  sharedResourceIds: string[];
  stages: StageTimingSummary[];
}

export function distance2D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Strictly honors user-defined arrivalIntervalSec with zero artificial 1s floor clamping.
 */
export function resolveArrivalIntervalSec(config: SimulationConfig): number {
  const raw = Number(config.arrivalIntervalSec);
  if (!Number.isFinite(raw) || raw <= 0) return 0.001;
  return raw;
}

/**
 * Computes active shift window using ResourceCalendarEngine clipped to [0, clockSec],
 * properly supporting multiple shifts, gaps, planned maintenance, and break overlaps.
 */
export function computeShiftWindowAudit(
  config: SimulationConfig,
  primaryProduct: ProductDefinition | undefined,
  clockSec: number,
  objects: LayoutObject[] = [],
  allProducts?: ProductDefinition[]
): ShiftWindowAudit {
  const fullDurationSec = Math.max(1e-6, config.durationSec || clockSec || 1e-6);
  const simTimeSec = Math.max(1e-6, clockSec || fullDurationSec);

  const calFull = new ResourceCalendarEngine(config, fullDurationSec);
  const fullPlant = calFull.getPlantCalendarMetrics(objects, fullDurationSec);

  const calElapsed = new ResourceCalendarEngine(config, Math.max(fullDurationSec, simTimeSec));
  const elapsedPlant = calElapsed.getPlantCalendarMetrics(objects, simTimeSec);

  const elapsedBreakSec = elapsedPlant.breakDowntimeSec;
  const activeSimTimeSec = Math.max(1e-6, elapsedPlant.scheduledProductionTimeSec);
  const totalShiftBreakSec = fullPlant.breakDowntimeSec;
  const fullShiftNetSec = Math.max(1e-6, fullPlant.scheduledProductionTimeSec);
  const plannedDowntimeSec = elapsedPlant.plannedDowntimeSec;
  const plantMaintenanceDowntimeSec = elapsedPlant.maintenanceDowntimeSec;
  const arrivalIntervalSec = resolveArrivalIntervalSec(config);

  const userMaxPlanned = Number(config.maxPlannedUnits);
  const productList =
    allProducts && allProducts.length > 0
      ? allProducts
      : primaryProduct
      ? [primaryProduct]
      : [];
  const totalProductTargets = productList.reduce(
    (sum, p) => sum + (Number.isFinite(Number(p.targetQuantity)) && Number(p.targetQuantity) > 0 ? Number(p.targetQuantity) : 0),
    0
  );

  let plannedUnitsCap = Infinity;
  let plannedUnits: number;

  if (Number.isFinite(userMaxPlanned) && userMaxPlanned > 0) {
    plannedUnitsCap = userMaxPlanned;
    plannedUnits = userMaxPlanned;
  } else if (totalProductTargets > 0) {
    plannedUnitsCap = totalProductTargets;
    plannedUnits = totalProductTargets;
  } else {
    plannedUnits = Math.max(1, Math.floor(fullShiftNetSec / arrivalIntervalSec));
  }

  return {
    simTimeSec,
    elapsedBreakSec,
    activeSimTimeSec,
    totalShiftBreakSec,
    fullShiftNetSec,
    plannedDowntimeSec,
    plantMaintenanceDowntimeSec,
    arrivalIntervalSec,
    plannedUnits,
    plannedUnitsCap,
  };
}

/**
 * Delegates conveyor physics evaluation to engineering/conveyorPhysics.ts.
 */
export function computeConveyorMetrics(
  conv: LayoutObject,
  prod?: ProductDefinition,
  overrideEntityLengthM?: number,
  overrideDims?: Partial<Dimensions3D>
): ConveyorMetrics {
  const mergedOverride: Partial<Dimensions3D> | undefined =
    overrideEntityLengthM !== undefined || overrideDims
      ? {
          ...overrideDims,
          ...(overrideEntityLengthM !== undefined ? { length: overrideEntityLengthM } : {}),
        }
      : undefined;
  return evaluateConveyorPhysics(conv, prod, mergedOverride);
}

/**
 * Computes exact conveyor transit time between measured path waypoints.
 */
export function computeConveyorPathTimeSec(totalDistanceM: number, speedMps: number): number {
  return physicsConveyorPathTimeSec(totalDistanceM, speedMps);
}

/**
 * Checks stage input queue admission strictly respecting user bufferCapacity >= 0.
 * When batchSize > 1 (batch-collecting station), ensures staging admits enough loose items
 * to form at least one full batch without premature upstream deadlock.
 */
export function canAdmitToStageBuffer(
  stage: ProductionStage,
  queuedCount: number,
  inTransitCount: number,
  hasFreeDownstreamSlot: boolean,
  stagingAllowance = 1
): boolean {
  const cap = Math.max(0, Number(stage.bufferCapacity ?? 0));
  if (stagingAllowance > 1) {
    const effectiveCap = Math.max(cap, stagingAllowance);
    return queuedCount + inTransitCount < effectiveCap;
  }
  if (cap === 0) {
    return queuedCount + inTransitCount === 0 && hasFreeDownstreamSlot;
  }
  return queuedCount + inTransitCount < cap;
}

function resolveServerTiming(
  stageVal: unknown,
  stationObj: LayoutObject | undefined,
  field: 'processingTimeSec' | 'loadingTimeSec' | 'unloadingTimeSec' | 'setupTimeSec',
  stageObjects?: LayoutObject[]
): number {
  const stageNum =
    stageVal !== undefined && stageVal !== null && Number.isFinite(Number(stageVal))
      ? Math.max(0, Number(stageVal))
      : 0;
  const stHasVal = stageVal !== undefined && stageVal !== null && Number.isFinite(Number(stageVal));

  const servers = (stageObjects || []).filter(
    (o) => o.kind === 'machine' || o.kind === 'workstation'
  );
  const definedVals = new Set<number>();
  let allZeroOrMissing = true;
  for (const s of servers) {
    const raw = s.operations?.[field];
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
      const v = Number(raw);
      definedVals.add(v);
      if (v > 0) allZeroOrMissing = false;
    }
  }
  const heterogeneous = definedVals.size > 1;
  const objRaw = stationObj?.operations?.[field];
  const objPresent =
    objRaw !== undefined && objRaw !== null && Number.isFinite(Number(objRaw)) && Number(objRaw) >= 0;
  const objNum = objPresent ? Number(objRaw) : stageNum;

  if (heterogeneous) {
    return objPresent ? objNum : stageNum;
  }
  if (allZeroOrMissing && stageNum > 0) {
    return stageNum;
  }
  if (stHasVal && stageNum > 0) {
    return stageNum;
  }
  return objPresent ? objNum : stageNum;
}

/**
 * Computes setup duration adjusted by operator efficiency when setup is required.
 */
export function computeStageSetupDurationSec(
  stage: ProductionStage,
  stationObj: LayoutObject | undefined,
  workers: WorkerDefinition[],
  stageObjects?: LayoutObject[]
): number {
  const setup = resolveServerTiming(stage.setupTimeSec, stationObj, 'setupTimeSec', stageObjects);
  if (setup <= 0) return 0;
  let effSum = 0;
  for (const w of workers) {
    effSum += Math.max(0.1, Number(w.efficiencyFactor || 1));
  }
  const meanEff = workers.length > 0 ? effSum / workers.length : 1;
  return Math.max(0, setup / meanEff);
}

/**
 * Computes exact stage processing duration strictly from stage + station + operator parameters.
 */
export function computeStageProcessingTimeSec(
  stage: ProductionStage,
  stationObj: LayoutObject | undefined,
  workers: WorkerDefinition[],
  needsSetup: boolean,
  product?: ProductDefinition,
  stageObjects?: LayoutObject[]
): number {
  const prodStageOverride = product?.stageProcessingTimes?.[stage.id];
  const baseProc =
    prodStageOverride !== undefined && Number.isFinite(prodStageOverride)
      ? Math.max(0, Number(prodStageOverride))
      : resolveServerTiming(stage.processingTimeSec, stationObj, 'processingTimeSec', stageObjects);
  const cycleMult = Math.max(0.05, Number(product?.cycleTimeMultiplier ?? 1));
  const proc = baseProc * cycleMult;
  const load = resolveServerTiming(stage.loadingTimeSec, stationObj, 'loadingTimeSec', stageObjects);
  const unload = resolveServerTiming(stage.unloadingTimeSec, stationObj, 'unloadingTimeSec', stageObjects);
  const setup = needsSetup
    ? resolveServerTiming(stage.setupTimeSec, stationObj, 'setupTimeSec', stageObjects)
    : 0;

  let effSum = 0;
  for (const w of workers) {
    effSum += Math.max(0.1, Number(w.efficiencyFactor || 1));
  }
  const meanEff = workers.length > 0 ? effSum / workers.length : 1;

  return Math.max(0, (proc + load + unload + setup) / meanEff);
}

/**
 * Computes deterministic operator walk time strictly from Euclidean station-to-station distance.
 * Dedicated operators stationed at their assigned home workstation incur 0s walk delay.
 */
export function computeWorkerTravelAudit(
  worker: WorkerDefinition,
  currentPos: Vec3,
  currentStationId: string | undefined,
  targetStation: LayoutObject
): { walkTimeSec: number; targetPos: Vec3 } {
  const assignedTargetId = worker.assignedTo || worker.assignedStationId;
  let targetPos: Vec3;

  if (
    targetStation.kind === 'conveyor' &&
    worker.assignedConveyorSegment?.objectId === targetStation.id
  ) {
    const placement = computeConveyorSegmentPlacement(
      targetStation,
      worker.assignedConveyorSegment.segmentIndex,
      worker.assignedConveyorSegment.segmentCount,
      worker.assignedConveyorSegment.side ?? 1
    );
    targetPos = placement.position;
  } else if (worker.placementSide && worker.placementSide !== 'custom') {
    targetPos = computeStationSidePlacement(targetStation, worker.placementSide).position;
  } else if (worker.placementSide === 'custom' && assignedTargetId === targetStation.id) {
    return { walkTimeSec: 0, targetPos: { ...currentPos } };
  } else {
    const candidates: CardinalPlacementSide[] = ['north', 'south', 'east', 'west'];
    let bestPos = computeStationSidePlacement(targetStation, 'south').position;
    let bestDist = distance2D(currentPos, bestPos);
    for (const side of candidates) {
      const pos = computeStationSidePlacement(targetStation, side).position;
      const d = distance2D(currentPos, pos);
      if (d < bestDist) {
        bestDist = d;
        bestPos = pos;
      }
    }
    targetPos = bestPos;
  }

  const dist = distance2D(currentPos, targetPos);
  const isAtDedicatedHomeStation =
    assignedTargetId === targetStation.id &&
    (!currentStationId || currentStationId === targetStation.id) &&
    dist <= 0.85;

  if (isAtDedicatedHomeStation || dist <= 0.1) {
    return { walkTimeSec: 0, targetPos: { ...currentPos } };
  }

  const walkSpeed = Math.max(0.1, Number(worker.walkingSpeedMps || 1.25));
  return {
    walkTimeSec: dist / walkSpeed,
    targetPos,
  };
}

/**
 * Centralized industrial engineering audit delegating stage capacity math to capacityEngine.ts.
 */
/**
 * Steady-state release mix per product, mirroring how the DES dispatches units:
 * - finite quotas (maxPlannedUnits and/or targetQuantity) -> each product's quota share
 * - weighted_mix (default) -> mixWeight ratio
 * - round_robin / fixed_sequence -> equal shares
 * - product_priority -> only the highest-priority products, by mixWeight
 * The mix over a whole run is an average; a quota that exhausts early shifts the mix over time.
 */
export function resolveProductMixWeights(project: ProjectData): number[] {
  const prods = project.products ?? [];
  const mixW = (p: ProductDefinition) => Math.max(0.01, Number(p.mixWeight ?? 1));
  const targets = prods.map((p) => (Number(p.targetQuantity) > 0 ? Number(p.targetQuantity) : 0));
  const sumTargets = targets.reduce((a, b) => a + b, 0);
  const globalMax = Number(project.simulationConfig.maxPlannedUnits);
  if (Number.isFinite(globalMax) && globalMax > 0 && sumTargets !== globalMax) {
    return sumTargets > 0 ? targets : prods.map(mixW);
  }
  if (sumTargets > 0) return targets;
  const rule = project.simulationConfig.dispatchingRule ?? 'weighted_mix';
  if (rule === 'round_robin' || rule === 'fixed_sequence') return prods.map(() => 1);
  if (rule === 'product_priority') {
    const top = Math.max(...prods.map((p) => Number(p.priority ?? 1)));
    return prods.map((p) => (Number(p.priority ?? 1) === top ? mixW(p) : 0));
  }
  return prods.map(mixW);
}

/**
 * Returns a copy of the project whose stage/object processing times are scaled by the
 * mix-weighted product factor (cycleTimeMultiplier and per-stage overrides), so analytical
 * capacity matches what the DES executes. Weights follow resolveProductMixWeights.
 * Returns the project unchanged when every factor is 1.
 */
export function applyProductMixTimingFactors(project: ProjectData): ProjectData {
  const products = project.products ?? [];
  if (products.length === 0) return project;
  const weights = resolveProductMixWeights(project);
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (!(wSum > 0)) return project;
  const factors = new Map<string, number>();
  for (const st of project.stages) {
    const base = Number(st.processingTimeSec) || 0;
    let f = 0;
    products.forEach((p, i) => {
      const mult = Math.max(0.05, Number(p.cycleTimeMultiplier ?? 1));
      const ov = p.stageProcessingTimes?.[st.id];
      const eff = ov !== undefined && Number.isFinite(ov) && base > 0 ? (Math.max(0, Number(ov)) * mult) / base : mult;
      f += weights[i] * eff;
    });
    factors.set(st.id, f / wSum);
  }
  if ([...factors.values()].every((f) => Math.abs(f - 1) < 1e-12)) return project;
  const out: ProjectData = structuredClone(project);
  const objFactor = new Map<string, number>();
  for (const st of out.stages) {
    const f = factors.get(st.id) ?? 1;
    st.processingTimeSec = (Number(st.processingTimeSec) || 0) * f;
    for (const oid of st.assignedObjectIds) objFactor.set(oid, f);
  }
  for (const o of out.layoutObjects) {
    const f = objFactor.get(o.id);
    if (f !== undefined && o.operations && Number.isFinite(o.operations.processingTimeSec)) {
      o.operations.processingTimeSec = o.operations.processingTimeSec * f;
    }
  }
  return out;
}

/**
 * Narrow scope: with exactly one product in auto routing and a non-empty route, line-level pace metrics (ideal cycle,
 * theoretical bottleneck/throughput, line balance) use only the stages on that route. Anything else (several products,
 * manual routing, empty route) keeps the all-project-stages basis. Per-stage rows are never filtered.
 */
export function singleAutoProductRouteScope(project: ProjectData): Set<string> | null {
  const ps = project.products;
  if (!ps || ps.length !== 1) return null;
  const p = ps[0];
  if (p.routingMode === 'manual' || !Array.isArray(p.routeStageIds) || p.routeStageIds.length === 0) return null;
  const ids = new Set(p.routeStageIds);
  return project.stages.some((st) => ids.has(st.id)) ? ids : null;
}

/**
 * Scoped time-weighted OEE for several auto-routed products. Each product's ideal cycle is that product's own
 * bottleneck cycle (project audited with that product alone). Ideal work = sum(ideal_i * units_i); Performance =
 * ideal work / operating time; Quality = ideal work of good units / ideal work of all units. Returns null (no
 * correction, caller keeps the count-based figures) outside the supported scope: fewer than two products, any manual
 * routing, unknown stage ids, or counts that do not add up to the engine totals.
 * Sources (practitioner, not a standard): https://oeelab.com/oee-mixed-products
 */
export function mixedProductTimeWeightedOee(
  project: ProjectData,
  productAnalytics: ReadonlyArray<{ productId: string; completedGoodQty: number; scrappedQty: number; reworkUnits?: number }> | undefined,
  totalUnits: number
): { idealWorkSec: number; idealGoodWorkSec: number; parallelLines: number; lineStageIds?: string[][] } | null {
  const ps = project.products ?? [];
  if (ps.length < 2 || !productAnalytics || productAnalytics.length !== ps.length) return null;
  const allIds = project.stages.map((st) => st.id);
  for (const p of ps) {
    if (p.routingMode === 'manual') return null;
    const r = p.routeStageIds;
    if (Array.isArray(r) && r.length > 0) {
      // A partial route is in scope: that product's ideal cycle is the bottleneck of its own route stages (the
      // single-product audit below already scopes to the route). A stage visited twice counts twice toward its load.
      // An unknown stage id is out of scope.
      if (!r.every((id) => allIds.includes(id))) return null;
    }
  }
  // Route layout. Nested routes (each route inside the longest one) share the same stages: the original basis applies.
  // Fully disjoint routes are independent lines that run at the same time: their ideal work is divided by the number of
  // lines, because each line has its own operating time (otherwise Performance could reach 100% x lines). Any other
  // overlap (partly shared stages) is not verified: no weighted figure is produced.
  const sets = ps.map((p) => new Set<string>(Array.isArray(p.routeStageIds) && p.routeStageIds.length > 0 ? p.routeStageIds : allIds));
  const nested = sets.every((a) => sets.every((b) => [...a].every((x) => b.has(x)) || [...b].every((x) => a.has(x))));
  let parallelLines = 1;
  if (!nested) {
    const disjoint = sets.every((a, i) => sets.every((b, j) => i === j || [...a].every((x) => !b.has(x))));
    if (!disjoint) return null;
    parallelLines = sets.length;
  }
  let counted = 0;
  let idealWorkSec = 0;
  let idealGoodWorkSec = 0;
  for (const p of ps) {
    const a = productAnalytics.find((x) => x.productId === p.id);
    if (!a) return null;
    const solo: ProjectData = structuredClone(project);
    solo.products = [structuredClone(p)];
    const soloAudit = auditProjectTiming(solo);
    let ideal = soloAudit.bottleneckCycleSec;
    const route = p.routeStageIds;
    if (Array.isArray(route) && route.length > 0 && new Set(route).size !== route.length) {
      // Repeated visits: the unit needs visits x stage cycle at each stage, so the ideal cycle is the largest such load.
      const visits = new Map<string, number>();
      for (const id of route) visits.set(id, (visits.get(id) ?? 0) + 1);
      ideal = 0;
      for (const st of soloAudit.stages) {
        const v = visits.get(st.stageId) ?? 0;
        if (v > 0 && st.effectiveUnitCycleSec > 0) ideal = Math.max(ideal, st.effectiveUnitCycleSec * v);
      }
    }
    if (!(ideal > 0)) return null;
    const total = a.completedGoodQty + a.scrappedQty;
    counted += total;
    idealWorkSec += ideal * total;
    idealGoodWorkSec += ideal * a.completedGoodQty;
  }
  if (Math.abs(counted - totalUnits) > 1e-6 || !(idealWorkSec > 0)) return null;
  return { idealWorkSec, idealGoodWorkSec, parallelLines, ...(parallelLines > 1 ? { lineStageIds: sets.map((x) => [...x]) } : {}) };
}

export function auditProjectTiming(rawProject: ProjectData, simClockSec?: number): ProjectTimingAudit {
  const project = applyProductMixTimingFactors(rawProject);
  const horizonSec = simClockSec ?? project.simulationConfig.durationSec;
  const shiftAudit = computeShiftWindowAudit(
    project.simulationConfig,
    project.products[0],
    horizonSec,
    project.layoutObjects,
    project.products
  );
  const objectsMap = new Map(project.layoutObjects.map((o) => [o.id, o]));
  const calEngine = new ResourceCalendarEngine(project.simulationConfig, horizonSec);

  const stages: StageTimingSummary[] = [];
  const effectiveCycles: number[] = [];
  const virtualStageIds: string[] = [];
  const physicalObjUsageCounts = new Map<string, number>();

  let totalTaskTimeSec = 0;
  let bottleneckStageId: string | undefined;
  let bottleneckStageName: string | undefined;
  let bottleneckCycleSec = 0;
  let shiftBottleneckStageId: string | undefined;
  let minShiftCapacityUnits = Infinity;
  let maxPhysicalCycleSec = 0;
  let hasActiveProcessingStages = false;
  const routeScope = singleAutoProductRouteScope(project);

  for (const st of project.stages) {
    const inScope = !routeScope || routeScope.has(st.id);
    const seenIds = new Set<string>();
    const assignedObjs: LayoutObject[] = [];
    for (const oid of st.assignedObjectIds) {
      if (seenIds.has(oid)) continue;
      seenIds.add(oid);
      const obj = objectsMap.get(oid);
      if (obj) {
        assignedObjs.push(obj);
        if ((obj.kind === 'machine' || obj.kind === 'workstation') && !isVirtualWorkstationObject(obj)) {
          physicalObjUsageCounts.set(obj.id, (physicalObjUsageCounts.get(obj.id) ?? 0) + 1);
        }
      }
    }

    const profile = computeStageCapacityProfile(st, assignedObjs);
    const serverSchedMap: Record<string, number> = {};
    for (const sp of profile.serverProfiles) {
      const obj = objectsMap.get(sp.objectId);
      if (obj) {
        serverSchedMap[sp.objectId] = calEngine.getObjectCalendarMetrics(obj, horizonSec).scheduledProductionTimeSec;
      }
    }

    const shiftCap = computeShiftAdjustedStageCapacity(profile, {
      netScheduledTimeSec: shiftAudit.activeSimTimeSec,
      serverScheduledTimeSec: serverSchedMap,
    });

    if (inScope && profile.isValid && profile.effectiveUnitCycleSec > 0) {
      totalTaskTimeSec += (profile.baseTaskTimeSec + profile.batchTransferTimeSec) / profile.effectiveBatchDivisor;
    }

    if (inScope && profile.baseTaskTimeSec > 0 && profile.effectiveUnitCycleSec > 0 && profile.theoreticalCapacityPerHour > 0) {
      hasActiveProcessingStages = true;
      effectiveCycles.push(profile.effectiveUnitCycleSec);
      if (profile.effectiveUnitCycleSec > bottleneckCycleSec) {
        bottleneckCycleSec = profile.effectiveUnitCycleSec;
        bottleneckStageId = st.id;
        bottleneckStageName = st.name;
      }
      if (profile.isVirtual) {
        virtualStageIds.push(st.id);
      } else if (profile.physicalCapacityPerHour > 0) {
        const physUnitCycle = 3600 / profile.physicalCapacityPerHour;
        if (physUnitCycle > maxPhysicalCycleSec) {
          maxPhysicalCycleSec = physUnitCycle;
        }
      }
      if (shiftCap.shiftAdjustedCapacityUnits < minShiftCapacityUnits) {
        minShiftCapacityUnits = shiftCap.shiftAdjustedCapacityUnits;
        shiftBottleneckStageId = st.id;
      }
    }

    stages.push({
      stageId: st.id,
      stageName: st.name,
      baseTaskTimeSec: profile.baseTaskTimeSec,
      setupTimeSec: profile.setupTimeSec,
      batchTransferTimeSec: profile.batchTransferTimeSec,
      batchSize: profile.batchSize,
      batchMode: profile.batchMode,
      effectiveBatchDivisor: profile.effectiveBatchDivisor,
      parallelCapacity: profile.parallelServers,
      physicalParallelCapacity: profile.physicalProcessingServersCount,
      virtualParallelCapacity: profile.virtualServerCount,
      stageAssignmentMode: profile.stageAssignmentMode,
      isVirtual: profile.isVirtual,
      isHeterogeneous: profile.isHeterogeneous,
      effectiveUnitCycleSec: profile.effectiveUnitCycleSec,
      theoreticalCapacityPerHour: profile.theoreticalCapacityPerHour,
      physicalCapacityPerHour: profile.physicalCapacityPerHour,
      virtualCapacityPerHour: profile.virtualCapacityPerHour,
      theoreticalBatchCapacityPerHour: profile.theoreticalBatchCapacityPerHour,
      netScheduledSec: shiftCap.netScheduledTimeSec,
      netProductionAfterSetupSec: shiftCap.netProductionTimeSec,
      shiftAdjustedCapacityUnits: shiftCap.shiftAdjustedCapacityUnits,
      shiftAdjustedDiscreteUnits: shiftCap.shiftAdjustedDiscreteUnits,
      shiftAdjustedHourlyCapacity: shiftCap.shiftAdjustedHourlyCapacity,
      requiredWorkers: st.requiredWorkers,
      bufferCapacity: Math.max(0, Number(st.bufferCapacity ?? 0)),
      isValid: profile.isValid,
    });
  }

  const sharedResourceIds = Array.from(physicalObjUsageCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const lineBalanceEfficiencyPct =
    effectiveCycles.length > 0 && bottleneckCycleSec > 0
      ? Math.min(
          100,
          (effectiveCycles.reduce((a, b) => a + b, 0) /
            (effectiveCycles.length * bottleneckCycleSec)) *
            100
        )
      : 0;

  const lineTaktTimeSec =
    shiftAudit.plannedUnits > 0 ? shiftAudit.fullShiftNetSec / shiftAudit.plannedUnits : 0;
  const theoreticalHourlyCapacity =
    bottleneckCycleSec > 0 ? 3600 / bottleneckCycleSec : 0;

  const hasVirtualStages = virtualStageIds.length > 0;
  const physicalHourlyCapacity =
    !hasActiveProcessingStages || hasVirtualStages || maxPhysicalCycleSec <= 0
      ? 0
      : 3600 / maxPhysicalCycleSec;

  const shiftAdjustedLineCapacityUnits = Number.isFinite(minShiftCapacityUnits)
    ? minShiftCapacityUnits
    : 0;

  const feedRatePerHour = 3600 / shiftAudit.arrivalIntervalSec;
  const activeHours = Math.max(1e-6, shiftAudit.activeSimTimeSec / 3600);
  const demandRateCapPerHour = Number.isFinite(shiftAudit.plannedUnitsCap)
    ? shiftAudit.plannedUnitsCap / activeHours
    : Infinity;

  const effectiveTheoreticalThroughputPerHour = Math.min(
    theoreticalHourlyCapacity > 0 ? theoreticalHourlyCapacity : Infinity,
    feedRatePerHour,
    demandRateCapPerHour
  );

  return {
    netShiftSec: shiftAudit.fullShiftNetSec,
    arrivalIntervalSec: shiftAudit.arrivalIntervalSec,
    lineTaktTimeSec,
    totalTaskTimeSec,
    bottleneckStageId,
    bottleneckStageName,
    bottleneckCycleSec,
    theoreticalHourlyCapacity,
    physicalHourlyCapacity,
    hasVirtualStages,
    virtualStageIds,
    shiftBottleneckStageId,
    shiftAdjustedLineCapacityUnits,
    effectiveTheoreticalThroughputPerHour: Number.isFinite(effectiveTheoreticalThroughputPerHour)
      ? effectiveTheoreticalThroughputPerHour
      : 0,
    lineBalanceEfficiencyPct,
    hasSharedResources: sharedResourceIds.length > 0,
    sharedResourceIds,
    stages,
  };
}

/**
 * Computes audited KPIs including OEE (Availability, Performance, Quality) and
 * formal Calendar-to-Operating time hierarchy from measured runtime accumulators.
 */
export function buildAuditedSimulationKPIs(params: {
  project: ProjectData;
  shiftAudit: ShiftWindowAudit;
  goodUnits: number;
  scrappedUnits: number;
  scrappedBatches?: number;
  reworkUnits?: number;
  reworkCycles?: number;
  reworkBatches?: number;
  totalBatchesCompleted?: number;
  avgLeadTimeSec: number;
  avgWaitingTimeSec: number;
  avgUnitWaitingTimeSec?: number;
  avgBatchWaitingTimeSec?: number;
  avgQueueWaitingTimeSec?: number;
  avgProcessingTimeSec: number;
  avgTransportTimeSec: number;
  totalConveyorTransitTimeSec?: number;
  totalDowntimeSec: number;
  totalBlockedTimeSec: number;
  totalStarvedTimeSec: number;
  totalIdleTimeSec?: number;
  totalSetupTimeSec?: number;
  totalMaintenanceTimeSec?: number;
  workerUtilizationPct: number;
  machineUtilizationPct: number;
  calendarUtilizationPct?: number;
  avgWip: number;
  currentWip: number;
  avgQueueLength: number;
  avgBufferOccupancyPct: number;
  stageAnalytics: StageAnalytics[];
  resourceAnalytics?: ResourceOeeAnalytics[];
  productAnalytics?: ProductAnalytics[];
  bottleneckStageId?: string;
  bottleneckStageName?: string;
  linePropagatedDowntimeSec?: number;
}): SimulationKPIs {
  const { project, shiftAudit, goodUnits, scrappedUnits } = params;
  const timingAudit = auditProjectTiming(project, shiftAudit.simTimeSec);
  const timingByStage = new Map(timingAudit.stages.map((s) => [s.stageId, s]));
  const lineRouteScope = singleAutoProductRouteScope(project);
  const totalHours = Math.max(1e-6, shiftAudit.activeSimTimeSec / 3600);
  const actualProduction = goodUnits + scrappedUnits;
  const productionAttainmentPct =
    shiftAudit.plannedUnits > 0 ? (goodUnits / shiftAudit.plannedUnits) * 100 : 0;
  const avgCycleTimeSec = goodUnits > 0 ? shiftAudit.activeSimTimeSec / goodUnits : 0;

  const throughputPerHour = goodUnits / totalHours;
  const theoreticalThroughputPerHour = timingAudit.effectiveTheoreticalThroughputPerHour;
  const throughputVariancePct =
    theoreticalThroughputPerHour > 0
      ? ((throughputPerHour - theoreticalThroughputPerHour) / theoreticalThroughputPerHour) * 100
      : 0;

  // Enrich each StageAnalytics entry with configured vs measured cycle deviation, resource-specific OEE, and root-cause insight
  for (const sa of params.stageAnalytics) {
    const tStage = timingByStage.get(sa.stageId);
    const configuredCycleTimeSec = tStage?.baseTaskTimeSec ?? 0;
    const batchSize = Math.max(1, sa.batchSize ?? tStage?.batchSize ?? 1);
    const effectiveDivisor = sa.batchMode === 'collect_batch' ? batchSize : 1;
    const effectiveTheoreticalUnitCycleSec =
      tStage?.effectiveUnitCycleSec ?? configuredCycleTimeSec / effectiveDivisor;
    const theoreticalCapacityPerHour = tStage?.theoreticalCapacityPerHour ?? 0;

    const stageCalSec = sa.calendarTimeSec ?? shiftAudit.simTimeSec;
    const stageSchedSec = sa.scheduledTimeSec ?? shiftAudit.activeSimTimeSec;
    const stagePlannedDownSec =
      sa.plannedDowntimeSec ?? Math.max(0, stageCalSec - stageSchedSec);
    const stageHours = Math.max(1e-6, stageSchedSec / 3600);
    const actualCapacityPerHour = sa.completedCount / stageHours;

    const cycleDeviationSec =
      sa.avgCycleTimeSec > 0 || configuredCycleTimeSec > 0
        ? sa.avgCycleTimeSec - configuredCycleTimeSec
        : 0;
    const cycleDeviationPct =
      configuredCycleTimeSec > 0 ? (cycleDeviationSec / configuredCycleTimeSec) * 100 : 0;

    const stageUnplannedDownSec = (sa.downPct / 100) * stageSchedSec;
    const stageSetupSec = ((sa.setupPct ?? 0) / 100) * stageSchedSec;
    const stageGood = Math.max(0, sa.completedCount - sa.scrapCount);
    const stageOee = computeOeeMetrics({
      calendarTimeSec: stageCalSec,
      plannedDowntimeSec: stagePlannedDownSec,
      unplannedDowntimeSec: stageUnplannedDownSec,
      setupTimeSec: stageSetupSec,
      idealCycleTimeSec: effectiveTheoreticalUnitCycleSec,
      totalUnitsProcessed: sa.completedCount,
      goodUnitsProduced: stageGood,
    });
    sa.availabilityPct = stageOee.availabilityPct;
    sa.performancePct = stageOee.performancePct;
    sa.rawPerformancePct = stageOee.rawPerformancePct;
    sa.performanceAnomaly = stageOee.performanceAnomaly;
    if (stageOee.performanceAnomalyReason) {
      sa.performanceAnomalyReason = stageOee.performanceAnomalyReason;
    }
    sa.qualityPct = stageOee.qualityPct;
    sa.oeePct = stageOee.oeePct;
    sa.operatingTimeSec = stageOee.operatingTimeSec;
    sa.scheduledUtilizationPct = sa.scheduledUtilizationPct ?? sa.utilizationPct;
    sa.calendarUtilizationPct =
      sa.calendarUtilizationPct ??
      (stageCalSec > 1e-6
        ? Math.min(100, ((sa.utilizationPct / 100) * stageSchedSec * 100) / stageCalSec)
        : 0);

    let reasonCode: NonNullable<StageAnalytics['bottleneckReasonCode']> = 'balanced';
    let detailEn = '';
    let detailAr = '';

    if (sa.downPct >= 0.8) {
      reasonCode = 'downtime';
      detailEn = `Unplanned breakdowns reduced uptime by ${sa.downPct.toFixed(1)}% (effective delay vs ${configuredCycleTimeSec.toFixed(1)}s cycle).`;
      detailAr = `الأعطال العشوائية خفّضت التوفر بنسبة ${sa.downPct.toFixed(1)}% مقارنة بزمن ${configuredCycleTimeSec.toFixed(1)}ث.`;
    } else if (sa.blockedPct >= 3) {
      reasonCode = 'downstream_blocked';
      detailEn = `Blocked ${sa.blockedPct.toFixed(1)}% by saturated downstream buffer (avg queue wait ${sa.avgWaitTimeSec.toFixed(1)}s).`;
      detailAr = `محجوب بنسبة ${sa.blockedPct.toFixed(1)}% بسبب امتلاء المخزن الوسيط التالي (متوسط انتظار ${sa.avgWaitTimeSec.toFixed(1)}ث).`;
    } else if (configuredCycleTimeSec > 0 && cycleDeviationPct > 2.5) {
      reasonCode = 'worker_walk';
      detailEn = `Measured cycle ${sa.avgCycleTimeSec.toFixed(1)}s exceeded configured ${configuredCycleTimeSec.toFixed(1)}s by +${cycleDeviationSec.toFixed(1)}s (operator walk/efficiency or setup).`;
      detailAr = `الدورة المقاسة ${sa.avgCycleTimeSec.toFixed(1)}ث تجاوزت المضبوطة ${configuredCycleTimeSec.toFixed(1)}ث بفارق +${cycleDeviationSec.toFixed(1)}ث (تنقل/كفاءة العامل أو التجهيز).`;
    } else if (batchSize > 1 && sa.avgWaitTimeSec > 1) {
      reasonCode = 'batch_accumulation';
      detailEn = `Batching ${batchSize} items/cycle added ${sa.avgWaitTimeSec.toFixed(1)}s avg staging wait; unit cycle = ${effectiveTheoreticalUnitCycleSec.toFixed(1)}s.`;
      detailAr = `تجميع ${batchSize} قطع/دورة أضاف ${sa.avgWaitTimeSec.toFixed(1)}ث متوسط انتظار للتجميع؛ زمن الوحدة = ${effectiveTheoreticalUnitCycleSec.toFixed(1)}ث.`;
    } else if ((tStage?.requiredWorkers ?? 0) > 0 && sa.avgWaitTimeSec > 3 && sa.utilizationPct < 88) {
      reasonCode = 'worker_starvation';
      detailEn = `Units queued avg ${sa.avgWaitTimeSec.toFixed(1)}s waiting for shared/busy operator assignment.`;
      detailAr = `انتظرت المنتجات ${sa.avgWaitTimeSec.toFixed(1)}ث في المتوسط بانتظار توفر عامل متاح.`;
    } else if (
      sa.isBottleneck ||
      (effectiveTheoreticalUnitCycleSec >= shiftAudit.arrivalIntervalSec * 0.9 && sa.utilizationPct >= 75)
    ) {
      reasonCode = 'user_cycle_bottleneck';
      detailEn = `Pacing constraint at ${sa.utilizationPct.toFixed(1)}% util (${configuredCycleTimeSec.toFixed(1)}s cycle / ${effectiveTheoreticalUnitCycleSec.toFixed(1)}s per unit).`;
      detailAr = `نقطة اختناق تقود سرعة الخط عند استغلال ${sa.utilizationPct.toFixed(1)}% (دورة ${configuredCycleTimeSec.toFixed(1)}ث / ${effectiveTheoreticalUnitCycleSec.toFixed(1)}ث للوحدة).`;
    } else if (sa.starvedPct >= 20 && sa.avgQueueLength < 0.25 && sa.utilizationPct < 60) {
      reasonCode = 'upstream_starved';
      detailEn = `Starved ${sa.starvedPct.toFixed(1)}% waiting for upstream feed (${sa.utilizationPct.toFixed(1)}% active).`;
      detailAr = `بدون تغذية بنسبة ${sa.starvedPct.toFixed(1)}% في انتظار المرحلة السابقة (تشغيل ${sa.utilizationPct.toFixed(1)}%).`;
    } else {
      reasonCode = 'balanced';
      detailEn = `Tracks user cycle (${sa.avgCycleTimeSec.toFixed(1)}s vs ${configuredCycleTimeSec.toFixed(1)}s configured${batchSize > 1 ? `, ×${batchSize} batch` : ''}).`;
      detailAr = `مطابق لزمن المستخدم (${sa.avgCycleTimeSec.toFixed(1)}ث مقابل ${configuredCycleTimeSec.toFixed(1)}ث${batchSize > 1 ? `، دفعة ×${batchSize}` : ''}).`;
    }

    if (sa.scrapCount > 0 || sa.reworkCount > 0) {
      detailEn += ` [Losses: ${sa.scrapCount} scrap, ${sa.reworkCount} rework]`;
      detailAr += ` [الفاقد: ${sa.scrapCount} هالك، ${sa.reworkCount} إعادة]`;
    }

    sa.batchSize = batchSize;
    sa.configuredCycleTimeSec = configuredCycleTimeSec;
    sa.effectiveTheoreticalUnitCycleSec = effectiveTheoreticalUnitCycleSec;
    sa.theoreticalCapacityPerHour = theoreticalCapacityPerHour;
    sa.actualCapacityPerHour = actualCapacityPerHour;
    sa.cycleDeviationSec = cycleDeviationSec;
    sa.cycleDeviationPct = cycleDeviationPct;
    sa.bottleneckReasonCode = reasonCode;
    sa.bottleneckReasonDetail = detailEn;
    sa.bottleneckReasonDetailAr = detailAr;
  }

  // Plant-level OEE: check if active resources have resource-specific or heterogeneous shifts
  const resourceList = params.resourceAnalytics || [];
  const processingResources = resourceList.filter((r) => r.kind !== 'conveyor' || r.idealCycleTimeSec > 0 || r.processedCount > 0);
  const activeRes = processingResources.length > 0 ? processingResources : resourceList;

  const hasCustomOrHeterogeneousShifts =
    activeRes.length > 0 &&
    (activeRes.some(
      (r) =>
        Math.abs(r.scheduledProductionTimeSec - shiftAudit.activeSimTimeSec) > 1e-1 ||
        Math.abs(r.plannedDowntimeSec - shiftAudit.plannedDowntimeSec) > 1e-1
    ) ||
      activeRes.some((r) => Boolean(r.shiftId)));

  let lineOee: ReturnType<typeof computeOeeMetrics>;

  if (hasCustomOrHeterogeneousShifts) {
    const resolveStageResources = (stageId: string): ResourceOeeAnalytics[] => {
      const stageDef = project.stages.find((s) => s.id === stageId);
      const assignedIds = new Set(stageDef?.assignedObjectIds || []);
      const matched = activeRes.filter(
        (r) => r.stageId === stageId || assignedIds.has(r.objectId)
      );
      const procMatched = matched.filter(
        (r) => r.kind === 'machine' || r.kind === 'workstation'
      );
      return procMatched.length > 0 ? procMatched : matched;
    };

    const resolveStageSchedSec = (sa: StageAnalytics): number => {
      if (sa.scheduledTimeSec !== undefined && Number.isFinite(sa.scheduledTimeSec)) {
        return Math.max(0, sa.scheduledTimeSec);
      }
      const resList = resolveStageResources(sa.stageId);
      if (resList.length > 0) {
        return (
          resList.reduce((s, r) => s + r.scheduledProductionTimeSec, 0) /
          resList.length
        );
      }
      return shiftAudit.activeSimTimeSec;
    };

    // Identify the true line-level bottleneck stage (minimum scheduled capacity = SPT / effectiveUnitCycleSec)
    let bnAnalytics: StageAnalytics | undefined;
    let minShiftCapacity = Infinity;
    let maxCycleForTie = -1;
    const preferredBnId = params.bottleneckStageId || timingAudit.bottleneckStageId;

    for (const sa of params.stageAnalytics) {
      const tStage = timingByStage.get(sa.stageId);
      const unitCycle = tStage?.effectiveUnitCycleSec ?? 0;
      if (unitCycle <= 0) continue;
      if (lineRouteScope && !lineRouteScope.has(sa.stageId)) continue;
      const schedSec = resolveStageSchedSec(sa);
      const shiftCap = schedSec / unitCycle;
      const isBetter =
        shiftCap < minShiftCapacity - 1e-6 ||
        (Math.abs(shiftCap - minShiftCapacity) <= 1e-6 &&
          (unitCycle > maxCycleForTie + 1e-6 ||
            (Math.abs(unitCycle - maxCycleForTie) <= 1e-6 && sa.stageId === preferredBnId)));
      if (isBetter) {
        minShiftCapacity = shiftCap;
        maxCycleForTie = unitCycle;
        bnAnalytics = sa;
      }
    }

    if (!bnAnalytics) {
      bnAnalytics =
        params.stageAnalytics.find((s) => s.stageId === preferredBnId) ??
        params.stageAnalytics[0];
    }

    const bnResources = bnAnalytics ? resolveStageResources(bnAnalytics.stageId) : [];
    const bnTiming = bnAnalytics ? timingByStage.get(bnAnalytics.stageId) : undefined;
    const lineIdealCycleSec =
      bnTiming && bnTiming.effectiveUnitCycleSec > 0
        ? bnTiming.effectiveUnitCycleSec
        : timingAudit.bottleneckCycleSec > 0
        ? timingAudit.bottleneckCycleSec
        : 0;

    let lineCalendarSec = shiftAudit.simTimeSec;
    let linePlannedDownSec = shiftAudit.plannedDowntimeSec;
    let lineUnplannedDownSec = 0;
    let lineSetupSec = 0;

    if (bnAnalytics && bnAnalytics.scheduledTimeSec !== undefined) {
      lineCalendarSec = bnAnalytics.calendarTimeSec ?? shiftAudit.simTimeSec;
      const lineScheduledSec = Math.max(0, bnAnalytics.scheduledTimeSec);
      linePlannedDownSec =
        bnAnalytics.plannedDowntimeSec ?? Math.max(0, lineCalendarSec - lineScheduledSec);
      const fallbackUnplannedDown = (bnAnalytics.downPct / 100) * lineScheduledSec;
      lineUnplannedDownSec =
        params.linePropagatedDowntimeSec !== undefined &&
        Number.isFinite(params.linePropagatedDowntimeSec)
          ? Math.min(lineScheduledSec, Math.max(0, params.linePropagatedDowntimeSec))
          : fallbackUnplannedDown;
      lineSetupSec = ((bnAnalytics.setupPct ?? 0) / 100) * lineScheduledSec;
    } else if (bnResources.length > 0) {
      const n = bnResources.length;
      lineCalendarSec = bnResources.reduce((s, r) => s + r.calendarTimeSec, 0) / n;
      linePlannedDownSec = bnResources.reduce((s, r) => s + r.plannedDowntimeSec, 0) / n;
      const lineScheduledSec = Math.max(0, lineCalendarSec - linePlannedDownSec);
      const fallbackUnplannedDown =
        bnResources.reduce((s, r) => s + r.unplannedDowntimeSec, 0) / n;
      lineUnplannedDownSec =
        params.linePropagatedDowntimeSec !== undefined &&
        Number.isFinite(params.linePropagatedDowntimeSec)
          ? Math.min(lineScheduledSec, Math.max(0, params.linePropagatedDowntimeSec))
          : fallbackUnplannedDown;
      lineSetupSec = bnResources.reduce((s, r) => s + r.setupTimeSec, 0) / n;
    } else {
      const stageCount = Math.max(1, params.stageAnalytics.length);
      const lineScheduledSec = Math.max(1e-6, lineCalendarSec - linePlannedDownSec);
      const fallbackUnplannedDown = bnAnalytics
        ? (bnAnalytics.downPct / 100) * lineScheduledSec
        : params.totalDowntimeSec / stageCount;
      lineUnplannedDownSec =
        params.linePropagatedDowntimeSec !== undefined &&
        Number.isFinite(params.linePropagatedDowntimeSec)
          ? Math.min(lineScheduledSec, Math.max(0, params.linePropagatedDowntimeSec))
          : fallbackUnplannedDown;
      lineSetupSec = bnAnalytics
        ? ((bnAnalytics.setupPct ?? 0) / 100) * lineScheduledSec
        : (params.totalSetupTimeSec ?? 0) / stageCount;
    }

    lineOee = computeOeeMetrics({
      calendarTimeSec: lineCalendarSec,
      plannedDowntimeSec: linePlannedDownSec,
      unplannedDowntimeSec: lineUnplannedDownSec,
      setupTimeSec: lineSetupSec,
      idealCycleTimeSec: lineIdealCycleSec,
      totalUnitsProcessed: actualProduction,
      goodUnitsProduced: goodUnits,
    });
  } else {
    const preferredUniformBnId = timingAudit.bottleneckStageId || params.bottleneckStageId;
    const bnAnalytics =
      params.stageAnalytics.find((s) => s.stageId === preferredUniformBnId) ??
      params.stageAnalytics.find((s) => s.stageId === params.bottleneckStageId) ??
      params.stageAnalytics[0];
    const stageCount = Math.max(1, params.stageAnalytics.length);

    const bnMaintSec = bnAnalytics
      ? ((bnAnalytics.maintenancePct ?? 0) / 100) * shiftAudit.simTimeSec
      : (params.totalMaintenanceTimeSec ?? 0) / stageCount;
    const extraObjectMaintSec = Math.max(0, bnMaintSec - shiftAudit.plantMaintenanceDowntimeSec);
    const linePlannedDowntimeSec = Math.min(
      shiftAudit.simTimeSec,
      shiftAudit.plannedDowntimeSec + extraObjectMaintSec
    );
    const lineScheduledSec = Math.max(0, shiftAudit.simTimeSec - linePlannedDowntimeSec);

    const fallbackUnplannedDown = bnAnalytics
      ? (bnAnalytics.downPct / 100) * lineScheduledSec
      : params.totalDowntimeSec / stageCount;
    const lineUnplannedDownSec =
      params.linePropagatedDowntimeSec !== undefined &&
      Number.isFinite(params.linePropagatedDowntimeSec)
        ? Math.min(lineScheduledSec, Math.max(0, params.linePropagatedDowntimeSec))
        : fallbackUnplannedDown;
    const lineSetupSec = bnAnalytics
      ? ((bnAnalytics.setupPct ?? 0) / 100) * lineScheduledSec
      : (params.totalSetupTimeSec ?? 0) / stageCount;

    lineOee = computeOeeMetrics({
      calendarTimeSec: shiftAudit.simTimeSec,
      plannedDowntimeSec: linePlannedDowntimeSec,
      unplannedDowntimeSec: lineUnplannedDownSec,
      setupTimeSec: lineSetupSec,
      idealCycleTimeSec:
        timingAudit.bottleneckCycleSec > 0 ? timingAudit.bottleneckCycleSec : 0,
      totalUnitsProcessed: actualProduction,
      goodUnitsProduced: goodUnits,
    });
  }

  let mixedTimeWeighted = false;
  {
    const mw = mixedProductTimeWeightedOee(project, params.productAnalytics, actualProduction);
    if (mw && lineOee.operatingTimeSec > 1e-6 && lineOee.scheduledProductionTimeSec > 1e-6) {
      // Independent lines: each line's own operating time is the divisor. With equal calendars this is operating time x lines.
      // With different calendars (shifts on the objects of one line), the lines' scheduled times (mean of each line's stage
      // scheduled times) are summed and scaled by the plant availability, so a short-shift line is not credited a full shift.
      let lineFactor = mw.parallelLines;
      if (mw.parallelLines > 1 && mw.lineStageIds && lineOee.scheduledProductionTimeSec > 1e-6) {
        const perLine = mw.lineStageIds.map((ids) => {
          const t = params.stageAnalytics
            .filter((sa) => ids.includes(sa.stageId) && typeof sa.scheduledTimeSec === 'number' && Number.isFinite(sa.scheduledTimeSec))
            .map((sa) => sa.scheduledTimeSec as number);
          return t.length > 0 ? t.reduce((a, b) => a + b, 0) / t.length : NaN;
        });
        if (perLine.every((x) => Number.isFinite(x)) && Math.max(...perLine) - Math.min(...perLine) > 0.1) {
          lineFactor = perLine.reduce((a, b) => a + b, 0) / lineOee.scheduledProductionTimeSec;
        }
      }
      const perf = (mw.idealWorkSec / (lineOee.operatingTimeSec * lineFactor)) * 100;
      const qual = (mw.idealGoodWorkSec / mw.idealWorkSec) * 100;
      // Recompute the anomaly flag on the weighted figure; the old flag belonged to the mix-average basis.
      const { performanceAnomalyReason: _staleReason, ...lineOeeRest } = lineOee;
      const perfAnomaly = perf > 100.05;
      lineOee = {
        ...lineOeeRest,
        rawPerformancePct: perf,
        performancePct: perf,
        performanceAnomaly: perfAnomaly,
        ...(perfAnomaly
          ? { performanceAnomalyReason: `Performance anomaly: time-weighted performance ${perf.toFixed(2)}% exceeds 100% (ideal work ${mw.idealWorkSec.toFixed(2)}s > operating time ${(lineOee.operatingTimeSec * lineFactor).toFixed(2)}s).` }
          : {}),
        qualityPct: qual,
        oeePct: (lineOee.availabilityPct / 100) * (perf / 100) * (qual / 100) * 100,
      };
      mixedTimeWeighted = true;
    }
  }

  const lineEfficiencyPct =
    timingAudit.stages.some((s) => s.baseTaskTimeSec > 0)
      ? timingAudit.lineBalanceEfficiencyPct
      : params.avgLeadTimeSec > 0
      ? Math.min(100, (params.avgProcessingTimeSec / params.avgLeadTimeSec) * 100)
      : 0;

  const totalBatchesCompleted =
    params.totalBatchesCompleted ??
    params.stageAnalytics.reduce((sum, sa) => sum + (sa.batchesCompleted || 0), 0);
  // Units per batch at the batch stages (units processed there / batches completed there), so scrap
  // or rework elsewhere in the line does not shrink the reported batch size. Falls back to the
  // earlier good-units-per-batch figure when no batch stage reports data.
  const batchStageRows = params.stageAnalytics.filter(
    (sa) => sa.batchMode === 'collect_batch' && (sa.batchSize ?? 0) > 1 && (sa.batchesCompleted || 0) > 0
  );
  const batchStageBatches = batchStageRows.reduce((sum, sa) => sum + (sa.batchesCompleted || 0), 0);
  const batchStageUnits = batchStageRows.reduce((sum, sa) => sum + (sa.completedCount || 0), 0);
  const avgBatchSize =
    batchStageBatches > 0 && batchStageUnits > 0
      ? batchStageUnits / batchStageBatches
      : totalBatchesCompleted > 0 && goodUnits > 0
        ? goodUnits / totalBatchesCompleted
        : 1;

  const calendarUtilizationPct =
    params.calendarUtilizationPct ??
    (params.stageAnalytics.length > 0
      ? params.stageAnalytics.reduce((s, a) => s + (a.calendarUtilizationPct ?? 0), 0) /
        params.stageAnalytics.length
      : 0);

  return {
    totalPlannedProduction: shiftAudit.plannedUnits,
    actualProduction,
    goodUnits,
    defectiveUnits: scrappedUnits,
    scrappedBatches: params.scrappedBatches ?? 0,
    reworkUnits: params.reworkUnits ?? 0,
    reworkCycles: params.reworkCycles ?? 0,
    reworkBatches: params.reworkBatches ?? 0,
    productionAttainmentPct,
    hourlyOutput: throughputPerHour,
    unitsPerShift: goodUnits,
    avgCycleTimeSec,
    theoreticalTaktTimeSec: timingAudit.lineTaktTimeSec,
    avgLeadTimeSec: params.avgLeadTimeSec,
    avgWaitingTimeSec: params.avgWaitingTimeSec,
    avgUnitWaitingTimeSec: params.avgUnitWaitingTimeSec ?? params.avgWaitingTimeSec,
    avgBatchWaitingTimeSec: params.avgBatchWaitingTimeSec ?? params.avgWaitingTimeSec,
    avgQueueWaitingTimeSec: params.avgQueueWaitingTimeSec ?? params.avgWaitingTimeSec,
    avgProcessingTimeSec: params.avgProcessingTimeSec,
    avgTransportTimeSec: params.avgTransportTimeSec,
    totalConveyorTransitTimeSec: params.totalConveyorTransitTimeSec ?? 0,
    totalDowntimeSec: params.totalDowntimeSec,
    lineEfficiencyPct,
    workerUtilizationPct: params.workerUtilizationPct,
    machineUtilizationPct: params.machineUtilizationPct,
    calendarUtilizationPct,
    bottleneckStageId: params.bottleneckStageId,
    bottleneckStageName: params.bottleneckStageName,
    avgWip: params.avgWip,
    currentWip: params.currentWip,
    avgQueueLength: params.avgQueueLength,
    throughputPerHour,
    avgBufferOccupancyPct: params.avgBufferOccupancyPct,
    totalStarvedTimeSec: params.totalStarvedTimeSec,
    totalBlockedTimeSec: params.totalBlockedTimeSec,
    totalIdleTimeSec: params.totalIdleTimeSec ?? 0,
    setupTimeSec: params.totalSetupTimeSec ?? 0,
    calendarTimeSec: lineOee.calendarTimeSec,
    scheduledProductionTimeSec: lineOee.scheduledProductionTimeSec,
    plannedDowntimeSec: lineOee.plannedDowntimeSec,
    unplannedDowntimeSec: lineOee.unplannedDowntimeSec,
    operatingTimeSec: lineOee.operatingTimeSec,
    availabilityPct: lineOee.availabilityPct,
    performancePct: lineOee.performancePct,
    rawPerformancePct: lineOee.rawPerformancePct,
    performanceAnomaly: lineOee.performanceAnomaly,
    ...(lineOee.performanceAnomalyReason
      ? { performanceAnomalyReason: lineOee.performanceAnomalyReason }
      : {}),
    qualityPct: lineOee.qualityPct,
    ...(mixedTimeWeighted ? { oeeMixedTimeWeighted: true, unitYieldPct: actualProduction > 0 ? (goodUnits / actualProduction) * 100 : 0 } : {}),
    oeePct: lineOee.oeePct,
    linePropagatedDowntimeSec: lineOee.unplannedDowntimeSec,
    lineCalendarAvailabilityPct: lineOee.calendarAvailabilityPct,
    theoreticalThroughputPerHour,
    throughputVariancePct,
    theoreticalBottleneckStageId: timingAudit.bottleneckStageId,
    theoreticalBottleneckStageName: timingAudit.bottleneckStageName,
    theoreticalBottleneckCycleSec: timingAudit.bottleneckCycleSec,
    totalBatchesCompleted,
    avgBatchSize,
  };
}
