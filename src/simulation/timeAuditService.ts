import {
  Dimensions3D,
  LayoutObject,
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
  computeStageCapacityProfile,
  resolveStageBatchConfig,
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
  batchSize: number;
  parallelCapacity: number;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
  requiredWorkers: number;
  bufferCapacity: number;
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
  effectiveTheoreticalThroughputPerHour: number;
  lineBalanceEfficiencyPct: number;
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
  objects: LayoutObject[] = []
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
  const productTarget = Number(primaryProduct?.targetQuantity || 0);

  let plannedUnitsCap = Infinity;
  let plannedUnits: number;

  if (Number.isFinite(userMaxPlanned) && userMaxPlanned > 0) {
    plannedUnitsCap = userMaxPlanned;
    plannedUnits = userMaxPlanned;
  } else if (Number.isFinite(productTarget) && productTarget > 0) {
    plannedUnitsCap = productTarget;
    plannedUnits = productTarget;
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

/**
 * Computes setup duration adjusted by operator efficiency when setup is required.
 */
export function computeStageSetupDurationSec(
  stage: ProductionStage,
  stationObj: LayoutObject | undefined,
  workers: WorkerDefinition[]
): number {
  const setup = Math.max(0, Number(stage.setupTimeSec ?? stationObj?.operations.setupTimeSec ?? 0));
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
  needsSetup: boolean
): number {
  const proc = Math.max(0, Number(stage.processingTimeSec ?? stationObj?.operations.processingTimeSec ?? 0));
  const load = Math.max(0, Number(stage.loadingTimeSec ?? stationObj?.operations.loadingTimeSec ?? 0));
  const unload = Math.max(0, Number(stage.unloadingTimeSec ?? stationObj?.operations.unloadingTimeSec ?? 0));
  const setup = needsSetup
    ? Math.max(0, Number(stage.setupTimeSec ?? stationObj?.operations.setupTimeSec ?? 0))
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
export function auditProjectTiming(project: ProjectData, simClockSec?: number): ProjectTimingAudit {
  const shiftAudit = computeShiftWindowAudit(
    project.simulationConfig,
    project.products[0],
    simClockSec ?? project.simulationConfig.durationSec,
    project.layoutObjects
  );
  const objectsMap = new Map(project.layoutObjects.map((o) => [o.id, o]));

  const stages: StageTimingSummary[] = [];
  const effectiveCycles: number[] = [];
  let totalTaskTimeSec = 0;
  let bottleneckStageId: string | undefined;
  let bottleneckStageName: string | undefined;
  let bottleneckCycleSec = 0;

  for (const st of project.stages) {
    const assignedObjs = st.assignedObjectIds
      .map((oid) => objectsMap.get(oid))
      .filter((o): o is LayoutObject => Boolean(o));

    const profile = computeStageCapacityProfile(st, assignedObjs);
    totalTaskTimeSec += profile.baseTaskTimeSec / profile.batchSize;

    if (profile.baseTaskTimeSec > 0) {
      effectiveCycles.push(profile.effectiveUnitCycleSec);
      if (profile.effectiveUnitCycleSec > bottleneckCycleSec) {
        bottleneckCycleSec = profile.effectiveUnitCycleSec;
        bottleneckStageId = st.id;
        bottleneckStageName = st.name;
      }
    }

    stages.push({
      stageId: st.id,
      stageName: st.name,
      baseTaskTimeSec: profile.baseTaskTimeSec,
      batchSize: profile.batchSize,
      parallelCapacity: profile.parallelServers,
      effectiveUnitCycleSec: profile.effectiveUnitCycleSec,
      theoreticalCapacityPerHour: profile.theoreticalCapacityPerHour,
      requiredWorkers: st.requiredWorkers,
      bufferCapacity: Math.max(0, Number(st.bufferCapacity ?? 0)),
    });
  }

  const lineBalanceEfficiencyPct =
    effectiveCycles.length > 0 && bottleneckCycleSec > 0
      ? Math.min(
          100,
          (effectiveCycles.reduce((a, b) => a + b, 0) /
            (effectiveCycles.length * bottleneckCycleSec)) *
            100
        )
      : 100;

  const lineTaktTimeSec =
    shiftAudit.plannedUnits > 0 ? shiftAudit.fullShiftNetSec / shiftAudit.plannedUnits : 0;
  const theoreticalHourlyCapacity =
    bottleneckCycleSec > 0 ? 3600 / bottleneckCycleSec : 3600 / shiftAudit.arrivalIntervalSec;

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
    effectiveTheoreticalThroughputPerHour: Number.isFinite(effectiveTheoreticalThroughputPerHour)
      ? effectiveTheoreticalThroughputPerHour
      : 0,
    lineBalanceEfficiencyPct,
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
  totalBatchesCompleted?: number;
  avgLeadTimeSec: number;
  avgWaitingTimeSec: number;
  avgProcessingTimeSec: number;
  avgTransportTimeSec: number;
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
  bottleneckStageId?: string;
  bottleneckStageName?: string;
}): SimulationKPIs {
  const { project, shiftAudit, goodUnits, scrappedUnits } = params;
  const timingAudit = auditProjectTiming(project, shiftAudit.simTimeSec);
  const timingByStage = new Map(timingAudit.stages.map((s) => [s.stageId, s]));
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
    const effectiveTheoreticalUnitCycleSec =
      tStage?.effectiveUnitCycleSec ?? configuredCycleTimeSec / batchSize;
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
    const n = activeRes.length;
    const sumCT = activeRes.reduce((s, r) => s + r.calendarTimeSec, 0);
    const sumPDT = activeRes.reduce((s, r) => s + r.plannedDowntimeSec, 0);
    const sumSPT = activeRes.reduce((s, r) => s + r.scheduledProductionTimeSec, 0);
    const sumUDT = activeRes.reduce((s, r) => s + r.unplannedDowntimeSec, 0);
    const sumSET = activeRes.reduce((s, r) => s + r.setupTimeSec, 0);
    const sumOT = activeRes.reduce((s, r) => s + r.operatingTimeSec, 0);
    const sumIdealTime = activeRes.reduce(
      (s, r) => s + (r.idealCycleTimeSec > 0 ? r.idealCycleTimeSec * r.processedCount : 0),
      0
    );
    const sumTotalUnits = activeRes.reduce((s, r) => s + r.processedCount, 0);
    const sumGoodUnits = activeRes.reduce((s, r) => s + r.goodCount, 0);

    const availPct = sumSPT > 1e-6 ? Math.min(100, Math.max(0, (sumOT / sumSPT) * 100)) : 0;
    const perfPct =
      sumOT > 1e-6
        ? sumIdealTime > 0
          ? Math.min(100, Math.max(0, (sumIdealTime / sumOT) * 100))
          : sumTotalUnits > 0
          ? 100
          : 0
        : 0;
    const qualPct = sumTotalUnits > 0 ? Math.min(100, Math.max(0, (sumGoodUnits / sumTotalUnits) * 100)) : 100;
    const oeePct = sumSPT > 1e-6 ? (availPct / 100) * (perfPct / 100) * (qualPct / 100) * 100 : 0;

    lineOee = {
      calendarTimeSec: sumCT / n,
      plannedDowntimeSec: sumPDT / n,
      scheduledProductionTimeSec: sumSPT / n,
      unplannedDowntimeSec: sumUDT / n,
      setupTimeSec: sumSET / n,
      operatingTimeSec: sumOT / n,
      availabilityPct: availPct,
      performancePct: perfPct,
      qualityPct: qualPct,
      oeePct,
    };
  } else {
    const bnAnalytics =
      params.stageAnalytics.find((s) => s.stageId === (params.bottleneckStageId || timingAudit.bottleneckStageId)) ??
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
    const lineScheduledSec = Math.max(1e-6, shiftAudit.simTimeSec - linePlannedDowntimeSec);

    const lineUnplannedDownSec = bnAnalytics
      ? (bnAnalytics.downPct / 100) * lineScheduledSec
      : params.totalDowntimeSec / stageCount;
    const lineSetupSec = bnAnalytics
      ? ((bnAnalytics.setupPct ?? 0) / 100) * lineScheduledSec
      : (params.totalSetupTimeSec ?? 0) / stageCount;

    lineOee = computeOeeMetrics({
      calendarTimeSec: shiftAudit.simTimeSec,
      plannedDowntimeSec: linePlannedDowntimeSec,
      unplannedDowntimeSec: lineUnplannedDownSec,
      setupTimeSec: lineSetupSec,
      idealCycleTimeSec:
        timingAudit.bottleneckCycleSec > 0
          ? timingAudit.bottleneckCycleSec
          : shiftAudit.arrivalIntervalSec,
      totalUnitsProcessed: actualProduction,
      goodUnitsProduced: goodUnits,
    });
  }

  const lineEfficiencyPct =
    timingAudit.stages.some((s) => s.baseTaskTimeSec > 0)
      ? timingAudit.lineBalanceEfficiencyPct
      : params.avgLeadTimeSec > 0
      ? Math.min(100, (params.avgProcessingTimeSec / params.avgLeadTimeSec) * 100)
      : 100;

  const totalBatchesCompleted =
    params.totalBatchesCompleted ??
    params.stageAnalytics.reduce((sum, sa) => sum + (sa.batchesCompleted || 0), 0);
  const avgBatchSize =
    totalBatchesCompleted > 0 && goodUnits > 0 ? goodUnits / totalBatchesCompleted : 1;

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
    productionAttainmentPct,
    hourlyOutput: throughputPerHour,
    unitsPerShift: goodUnits,
    avgCycleTimeSec,
    theoreticalTaktTimeSec: timingAudit.lineTaktTimeSec,
    avgLeadTimeSec: params.avgLeadTimeSec,
    avgWaitingTimeSec: params.avgWaitingTimeSec,
    avgProcessingTimeSec: params.avgProcessingTimeSec,
    avgTransportTimeSec: params.avgTransportTimeSec,
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
    qualityPct: lineOee.qualityPct,
    oeePct: lineOee.oeePct,
    theoreticalThroughputPerHour,
    throughputVariancePct,
    theoreticalBottleneckStageId: timingAudit.bottleneckStageId,
    theoreticalBottleneckStageName: timingAudit.bottleneckStageName,
    theoreticalBottleneckCycleSec: timingAudit.bottleneckCycleSec,
    totalBatchesCompleted,
    avgBatchSize,
  };
}
