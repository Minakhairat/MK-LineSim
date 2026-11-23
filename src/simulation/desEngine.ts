import {
  ConveyorRuntimeStatus,
  HourlyProductionPoint,
  InterruptionPolicy,
  LayoutObject,
  MachineRuntimeStatus,
  ProductAnalytics,
  ProductDefinition,
  ProductEntityState,
  ProductionStage,
  ProjectData,
  ResourceOeeAnalytics,
  ShiftEndPolicy,
  SimEvent,
  SimEventType,
  SimulationKPIs,
  SimulationResult,
  SimulationSnapshot,
  StageAnalytics,
  Vec3,
  WipTimePoint,
  WorkerAnalytics,
  WorkerDefinition,
  WorkerRuntimeState,
  ObjectRuntimeState,
} from '../types/project';
import { MinPriorityQueue } from './priorityQueue';
import {
  autoWireProjectForSimulation,
  importFlowchartToSimulationData,
  syncProductRoutes,
} from './autoWire';
import {
  buildAuditedSimulationKPIs,
  canAdmitToStageBuffer,
  computeConveyorMetrics,
  computeConveyorPathTimeSec,
  computeShiftWindowAudit,
  computeStageProcessingTimeSec,
  computeStageSetupDurationSec,
  computeWorkerTravelAudit,
  distance2D as auditDistance2D,
  resolveArrivalIntervalSec,
  resolveObjectFailureParams,
  resolveStageBatchConfig,
  StageBatchConfig,
} from './timeAuditService';
import { ResourceAvailabilityState, ResourceCalendarEngine } from './resourceCalendar';
import { ResourceStateTracker } from './resourceStateTracker';
import { sampleRepairDurationSec, sampleTimeToFailureSec } from './failureModels';
import { computeOeeMetrics } from '../engineering/oeeEngine';
import { computeStageCapacityProfile } from '../engineering/capacityEngine';

function availToMachineStatus(avail: ResourceAvailabilityState): MachineRuntimeStatus {
  if (avail.available) return 'idle';
  return avail.reason === 'maintenance' ? 'maintenance' : 'unavailable';
}

function availToConveyorStatus(avail: ResourceAvailabilityState): ConveyorRuntimeStatus {
  if (avail.available) return 'stopped';
  return 'unavailable';
}

interface InternalEvent {
  seq: number;
  timestamp: number;
  type: SimEventType;
  entityId?: string;
  stageId?: string;
  objectId?: string;
  workerId?: string;
  details: string;
  payload?: Record<string, unknown>;
}

interface ConveyorTransit {
  entityId: string;
  conveyorId: string;
  fromObjectId?: string;
  fromStageId: string;
  toStageId: string;
  startTime: number;
  endTime: number;
  waypoints: Vec3[];
  cumLengths: number[];
  totalLength: number;
  transferToken?: number;
  paused?: boolean;
  pausedAt?: number;
  pausedProgress?: number;
  remainingBeforeStartSec?: number;
  remainingTransitSec?: number;
}

interface HeldBatchItem {
  entityId: string;
  productId: string;
  arrivedAt: number;
  units: number;
}

interface PendingWalkJob {
  token: number;
  entityId: string;
  stageId: string;
  objectId: string;
  workerIds: string[];
  walkEndByWorker: Map<string, number>;
  walkRemainingByWorker: Map<string, number>;
  phase: 'setup' | 'processing';
  setupDuration: number;
  procDuration: number;
  isConveyorNode: boolean;
  workDurationSec?: number;
  dispatchDelaySec: number;
  remainingDispatchDelaySec?: number;
  startAt: number;
}

export interface DesMaterialConservationBreakdown {
  totalReleasedUnits: number;
  completedUnits: number;
  scrappedUnits: number;
  activeWipUnits: number;
  waitingInQueueUnits: number;
  batchBufferUnits: number;
  underProcessingUnits: number;
  inTransitUnits: number;
  blockedAtStationUnits: number;
  pendingArrivalUnits: number;
  absorbedChildEntities: number;
  unaccountedUnits: number;
}

export interface DesInvariantAuditResult {
  ok: boolean;
  clockSec: number;
  violations: string[];
  conservation: DesMaterialConservationBreakdown;
  deadlocks: Array<{ stageIds: string[]; objectIds: string[]; entityIds: string[] }>;
}

interface ActiveJobRecord {
  token: number;
  phase: 'setup' | 'processing';
  entityId: string;
  stageId: string;
  objectId: string;
  workerIds: string[];
  startedAt: number;
  expectedEndAt: number;
  remainingSec: number;
  totalProcSec: number;
  isConveyorNode: boolean;
  workDurationSec?: number;
  workerReleaseToken?: number;
}

interface StageAcc {
  entered: number;
  completed: number;
  batchesCompleted: number;
  scrapped: number;
  scrappedBatches: number;
  reworked: number;
  reworkCycles: number;
  reworkBatches: number;
  cycleTimeSum: number;
  waitTimeSum: number;
  queueWaitTimeSum: number;
  batchWaitTimeSum: number;
  batchWaitCount: number;
  conveyorTransitTimeSum: number;
  queueArea: number;
  lastQueueTime: number;
  maxQueue: number;
  waitingEnterTimes: Map<string, number>;
  stageEnterTimes: Map<string, number>;
  processingStartTimes: Map<string, number>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance2D(a: Vec3, b: Vec3): number {
  return auditDistance2D(a, b);
}

export class DiscreteEventSimulationEngine {
  private project: ProjectData;
  private rng: () => number;
  private queue = new MinPriorityQueue<InternalEvent>();
  private seqCounter = 0;
  private jobTokenCounter = 0;

  public clockSec = 0;
  public status: SimulationSnapshot['status'] = 'idle';
  private shiftActive = true;
  private onBreak = false;

  private calendarEngine!: ResourceCalendarEngine;
  private stateTracker!: ResourceStateTracker;

  private objectsMap = new Map<string, LayoutObject>();
  private stagesMap = new Map<string, ProductionStage>();
  private workersMap = new Map<string, WorkerDefinition>();
  private productsMap = new Map<string, ProductDefinition>();

  private objectStates = new Map<string, ObjectRuntimeState>();
  private workerStates = new Map<string, WorkerRuntimeState>();
  private workerAllocatedEntity = new Map<string, string | null>();
  private entities = new Map<string, ProductEntityState>();
  private activeEntities = new Map<string, ProductEntityState>();

  private activeJobs = new Map<string, ActiveJobRecord[]>(); // objectId -> active non-paused jobs
  private pausedJobs = new Map<string, ActiveJobRecord[]>(); // objectId -> paused jobs during down/maint/break/off-shift
  private pendingWalkJobs = new Map<string, PendingWalkJob[]>(); // objectId -> waiting for worker walk arrival
  private pausedWalkJobs = new Map<string, PendingWalkJob[]>(); // objectId -> paused walk jobs
  private validJobTokens = new Set<number>();
  private blockedEntitySet = new Set<string>();

  private stageBuffers = new Map<string, string[]>();
  private stageBatchHolders = new Map<string, HeldBatchItem[]>();
  private stageBatchConfigs = new Map<string, StageBatchConfig>();
  private stageUpstreamClosures = new Map<string, Set<string>>();
  private stageInTransitCounts = new Map<string, number>();
  private blockedOutbox = new Map<string, Array<{ entityId: string; objectId: string; nextStageId: string }>>();
  private conveyorTransits = new Map<string, ConveyorTransit>();
  private conveyorOccupancy = new Map<string, number>();
  private conveyorLastEntryTime = new Map<string, number>();
  private blockedConveyorEntities = new Map<string, string[]>(); // conveyorId -> entityIds blocked at exit
  private setupDoneObjects = new Set<string>();
  private sourceWaiting: { waiting: boolean; productId?: string; lastReleaseTime: number } | null = null;
  private sourceTimerScheduled = false;
  private lastSourceReleaseTime = -Infinity;

  // Multi-product dispatch & tracking
  private productTargetQuota = new Map<string, number>();
  private productReleasedCount = new Map<string, number>();
  private productCompletedCount = new Map<string, number>();
  private productScrappedCount = new Map<string, number>();
  private productReworkUnits = new Map<string, number>();
  private productReworkCycles = new Map<string, number>();
  private rrCursor = 0;

  private stageAcc = new Map<string, StageAcc>();
  private entityCounter = 0;
  private completedCount = 0;
  private completedBatches = 0;
  private scrappedCount = 0;
  private totalArrived = 0;

  private wipArea = 0;
  private lastWipUpdate = 0;
  private wipSeries: WipTimePoint[] = [];
  private nextSampleTime = 0;

  private eventLog: SimEvent[] = [];
  private totalEventsExecuted = 0;
  private hourlyGood = new Map<number, number>();
  private hourlyScrap = new Map<number, number>();

  constructor(project: ProjectData) {
    this.project = this.ensureRoutingReady(structuredClone(project));
    this.rng = mulberry32(this.project.simulationConfig.randomSeed || 4219);
    this.initialize();
  }

  public importFlowchartRoutes(projectSnapshot?: ProjectData): void {
    const base = structuredClone(projectSnapshot || this.project);
    const { updated } = importFlowchartToSimulationData(base);
    this.project = updated;
    this.initialize();
  }

  private ensureRoutingReady(raw: ProjectData): ProjectData {
    const isManualFlow = raw.products.some((p) => p.routingMode === 'manual');
    if (isManualFlow) {
      return importFlowchartToSimulationData(raw).updated;
    }

    const hasFloorEquip = raw.layoutObjects.some(
      (o) =>
        o.rendering.visible &&
        (o.kind === 'conveyor' || o.kind === 'workstation' || o.kind === 'machine' || o.kind === 'buffer')
    );
    if (!hasFloorEquip) {
      syncProductRoutes(raw);
      return raw;
    }
    const stageAssignedIds = new Set(raw.stages.flatMap((s) => s.assignedObjectIds));
    const hasUnlinkedStation = raw.layoutObjects.some(
      (o) =>
        o.rendering.visible &&
        (o.kind === 'workstation' || o.kind === 'machine' || o.kind === 'buffer') &&
        !stageAssignedIds.has(o.id)
    );
    const missingAutoRoutes =
      raw.stages.length === 0 ||
      raw.products.length === 0 ||
      raw.products.some((p) => p.routeStageIds.length === 0);
    const missingWorkers = raw.stages.some(
      (s) => s.requiredWorkers > 0 && !raw.workers.some((w) => w.assignedStageIds.includes(s.id))
    );

    if (hasUnlinkedStation || missingAutoRoutes || missingWorkers) {
      return autoWireProjectForSimulation(raw).updated;
    }
    syncProductRoutes(raw);
    return raw;
  }

  public initialize(): void {
    this.project = this.ensureRoutingReady(this.project);
    this.queue.clear();
    this.seqCounter = 0;
    this.jobTokenCounter = 0;
    this.clockSec = 0;
    this.status = 'idle';

    const cfg = this.project.simulationConfig;
    this.calendarEngine = new ResourceCalendarEngine(cfg, cfg.durationSec);
    this.stateTracker = new ResourceStateTracker(cfg.durationSec, false);

    this.shiftActive = this.calendarEngine.isPlantShiftActiveAt(0);
    this.onBreak = this.calendarEngine.isPlantOnBreakAt(0);

    this.objectsMap.clear();
    this.stagesMap.clear();
    this.workersMap.clear();
    this.productsMap.clear();
    this.objectStates.clear();
    this.workerStates.clear();
    this.workerAllocatedEntity.clear();
    this.entities.clear();
    this.activeEntities.clear();
    this.activeJobs.clear();
    this.pausedJobs.clear();
    this.pendingWalkJobs.clear();
    this.pausedWalkJobs.clear();
    this.validJobTokens.clear();
    this.blockedEntitySet.clear();
    this.stageBuffers.clear();
    this.stageBatchHolders.clear();
    this.stageBatchConfigs.clear();
    this.stageUpstreamClosures.clear();
    this.stageInTransitCounts.clear();
    this.blockedOutbox.clear();
    this.conveyorTransits.clear();
    this.conveyorOccupancy.clear();
    this.conveyorLastEntryTime.clear();
    this.blockedConveyorEntities.clear();
    this.setupDoneObjects.clear();
    this.sourceWaiting = null;
    this.sourceTimerScheduled = false;
    this.lastSourceReleaseTime = -Infinity;
    this.productTargetQuota.clear();
    this.productReleasedCount.clear();
    this.productCompletedCount.clear();
    this.productScrappedCount.clear();
    this.productReworkUnits.clear();
    this.productReworkCycles.clear();
    this.rrCursor = 0;
    this.stageAcc.clear();
    this.hourlyGood.clear();
    this.hourlyScrap.clear();
    this.wipSeries = [];
    this.nextSampleTime = 0;
    this.eventLog = [];
    this.totalEventsExecuted = 0;
    this.entityCounter = 0;
    this.completedCount = 0;
    this.completedBatches = 0;
    this.scrappedCount = 0;
    this.totalArrived = 0;
    this.wipArea = 0;
    this.lastWipUpdate = 0;
    this.rng = mulberry32(cfg.randomSeed || 4219);

    for (const obj of this.project.layoutObjects) {
      this.objectsMap.set(obj.id, obj);
      this.activeJobs.set(obj.id, []);
      this.pausedJobs.set(obj.id, []);
      this.pendingWalkJobs.set(obj.id, []);
      this.pausedWalkJobs.set(obj.id, []);
      if (obj.kind === 'conveyor') {
        this.conveyorOccupancy.set(obj.id, 0);
      }

      const failureParams = resolveObjectFailureParams(obj, cfg);
      const isZeroAvail = failureParams.enabled && failureParams.availability <= 0;
      const initAvail = this.calendarEngine.getObjectAvailabilityAt(obj, 0);
      const initStatus =
        isZeroAvail && initAvail.available ? 'down' : availToMachineStatus(initAvail);
      const initConvStatus = availToConveyorStatus(initAvail);
      this.stateTracker.initMachine(obj.id, initStatus, 0);
      if (obj.kind === 'conveyor') {
        this.stateTracker.initConveyor(obj.id, initConvStatus, 0);
      }

      this.objectStates.set(obj.id, {
        objectId: obj.id,
        status: initStatus,
        ...(obj.kind === 'conveyor' ? { conveyorStatus: initConvStatus } : {}),
        busyUnitIds: [],
        queueUnitIds: [],
        processedCount: 0,
        scrapCount: 0,
        runningTimeSec: 0,
        idleTimeSec: 0,
        blockedTimeSec: 0,
        starvedTimeSec: 0,
        setupTimeSec: 0,
        downTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        movingTimeSec: 0,
        stoppedTimeSec: 0,
        lastStateChangeTime: 0,
      });

      if (failureParams.enabled && failureParams.mtbfSec > 0 && failureParams.availability > 0) {
        const firstFail = sampleTimeToFailureSec(failureParams, this.rng);
        if (firstFail < cfg.durationSec) {
          this.schedule(firstFail, 'BreakdownStarted', {
            objectId: obj.id,
            stageId: obj.stageId,
            details: `Scheduled stochastic failure (${failureParams.failureModel}) on ${obj.name}`,
          });
        }
      }
    }

    for (let idx = 0; idx < this.project.stages.length; idx++) {
      const st = this.project.stages[idx];
      st.assignedObjectIds = st.assignedObjectIds.filter((oid) => this.objectsMap.has(oid));
      if (st.assignedObjectIds.length === 0) {
        const virtId = `virt_${st.id}`;
        const virtObj: LayoutObject = {
          id: virtId,
          name: st.name,
          kind: 'workstation',
          category: 'workstation',
          templateId: 'tpl_workstation',
          stageId: st.id,
          connectedToIds: [],
          geometry: {
            position: { x: 3 + (idx % 6) * 3.5, y: 0, z: 6 + Math.floor(idx / 6) * 4 },
            dimensions: { length: 1.6, width: 1.0, height: 0.9 },
            rotationDeg: 0,
            clearanceM: 0.4,
          },
          operations: {
            processingTimeSec: st.processingTimeSec,
            setupTimeSec: st.setupTimeSec,
            loadingTimeSec: st.loadingTimeSec,
            unloadingTimeSec: st.unloadingTimeSec,
            capacity: Math.max(1, st.requiredMachines || 1),
            availability: 1.0,
            requiredOperators: st.requiredWorkers,
          },
          rendering: { color: '#334155', visible: false, locked: true, layer: 'equipment' },
        };
        st.assignedObjectIds = [virtId];
        this.objectsMap.set(virtId, virtObj);
        this.activeJobs.set(virtId, []);
        this.pausedJobs.set(virtId, []);
        this.pendingWalkJobs.set(virtId, []);
        this.pausedWalkJobs.set(virtId, []);
        this.stateTracker.initMachine(virtId, 'idle', 0);
        this.objectStates.set(virtId, {
          objectId: virtId,
          status: 'idle',
          busyUnitIds: [],
          queueUnitIds: [],
          processedCount: 0,
          scrapCount: 0,
          runningTimeSec: 0,
          idleTimeSec: 0,
          blockedTimeSec: 0,
          starvedTimeSec: 0,
          setupTimeSec: 0,
          downTimeSec: 0,
          maintenanceTimeSec: 0,
          unavailableTimeSec: 0,
          lastStateChangeTime: 0,
        });
      }

      this.stagesMap.set(st.id, st);
      this.stageBuffers.set(st.id, []);
      this.stageBatchHolders.set(st.id, []);
      const assignedObjs = st.assignedObjectIds
        .map((oid) => this.objectsMap.get(oid))
        .filter((o): o is LayoutObject => Boolean(o));
      this.stageBatchConfigs.set(st.id, resolveStageBatchConfig(st, assignedObjs));
      this.stageInTransitCounts.set(st.id, 0);
      this.blockedOutbox.set(st.id, []);
      this.stageAcc.set(st.id, {
        entered: 0,
        completed: 0,
        batchesCompleted: 0,
        scrapped: 0,
        scrappedBatches: 0,
        reworked: 0,
        reworkCycles: 0,
        reworkBatches: 0,
        cycleTimeSum: 0,
        waitTimeSum: 0,
        queueWaitTimeSum: 0,
        batchWaitTimeSum: 0,
        batchWaitCount: 0,
        conveyorTransitTimeSum: 0,
        queueArea: 0,
        lastQueueTime: 0,
        maxQueue: 0,
        waitingEnterTimes: new Map(),
        stageEnterTimes: new Map(),
        processingStartTimes: new Map(),
      });
    }

    // Build transitive upstream closures for safe partial batch flushing
    for (let idx = 0; idx < this.project.stages.length; idx++) {
      const st = this.project.stages[idx];
      const closure = new Set<string>();
      const dfs = [...st.predecessorIds];
      while (dfs.length > 0) {
        const pid = dfs.pop()!;
        if (pid === st.id || closure.has(pid)) continue;
        closure.add(pid);
        const pStage = this.stagesMap.get(pid);
        if (pStage) dfs.push(...pStage.predecessorIds);
      }
      if (closure.size === 0 && idx > 0) {
        for (let k = 0; k < idx; k++) closure.add(this.project.stages[k].id);
      }
      this.stageUpstreamClosures.set(st.id, closure);
    }

    for (const w of this.project.workers) {
      this.workersMap.set(w.id, w);
      this.workerAllocatedEntity.set(w.id, null);
      const wAvail = this.calendarEngine.getWorkerAvailabilityAt(w, 0);
      const initWStatus = wAvail.available
        ? 'idle'
        : wAvail.reason === 'break'
        ? 'break'
        : 'unavailable';
      this.stateTracker.initWorker(w.id, initWStatus, 0);
      this.workerStates.set(w.id, {
        workerId: w.id,
        status: initWStatus,
        currentStationId: w.assignedTo || w.assignedStationId,
        position: { ...w.position },
        startPosition: { ...w.position },
        targetPosition: { ...w.position },
        moveStartTime: 0,
        moveEndTime: 0,
        busyTimeSec: 0,
        walkingTimeSec: 0,
        idleTimeSec: 0,
        breakTimeSec: 0,
        unavailableTimeSec: 0,
        tasksCompleted: 0,
        lastStateChangeTime: 0,
      });
    }

    const prods = this.project.products;
    for (const p of prods) {
      this.productsMap.set(p.id, p);
      this.productReleasedCount.set(p.id, 0);
      this.productCompletedCount.set(p.id, 0);
      this.productScrappedCount.set(p.id, 0);
      this.productReworkUnits.set(p.id, 0);
      this.productReworkCycles.set(p.id, 0);
    }

    const globalMax = Number(cfg.maxPlannedUnits);
    const hasGlobalMax = Number.isFinite(globalMax) && globalMax > 0;
    const sumProdTargets = prods.reduce(
      (s, p) =>
        s +
        (Number.isFinite(Number(p.targetQuantity)) && Number(p.targetQuantity) > 0
          ? Number(p.targetQuantity)
          : 0),
      0
    );
    if (hasGlobalMax && sumProdTargets !== globalMax && prods.length > 0) {
      const weights = prods.map((p) =>
        sumProdTargets > 0
          ? Math.max(0, Number(p.targetQuantity || 0))
          : Math.max(0.01, Number(p.mixWeight ?? 1))
      );
      const totalW = weights.reduce((a, b) => a + b, 0) || prods.length;
      let assigned = 0;
      for (let i = 0; i < prods.length; i++) {
        const share =
          i === prods.length - 1
            ? Math.max(0, globalMax - assigned)
            : Math.round((globalMax * weights[i]) / totalW);
        const bounded = Math.min(globalMax - assigned, Math.max(0, share));
        assigned += bounded;
        this.productTargetQuota.set(prods[i].id, bounded);
      }
    } else if (sumProdTargets > 0) {
      for (const p of prods) {
        const t = Number(p.targetQuantity || 0);
        this.productTargetQuota.set(p.id, t > 0 ? t : 0);
      }
    } else {
      for (const p of prods) {
        this.productTargetQuota.set(p.id, Infinity);
      }
    }

    // Schedule all clipped calendar transitions (shifts, breaks, planned maintenance)
    const transitions = this.calendarEngine.getCalendarTransitions(
      Array.from(this.objectsMap.values())
    );
    for (const tr of transitions) {
      if (tr.kind === 'shift_start') {
        this.schedule(tr.timestamp, 'ShiftStarted', {
          details: `Shift started: ${tr.shiftName}`,
          payload: { shiftId: tr.shiftId },
        });
      } else if (tr.kind === 'shift_end') {
        this.schedule(tr.timestamp, 'ShiftEnded', {
          details: `Shift ended: ${tr.shiftName}`,
          payload: { shiftId: tr.shiftId },
        });
      } else if (tr.kind === 'break_start') {
        this.schedule(tr.timestamp, 'MachineStopped', {
          details: `Break started: ${tr.breakName}`,
          payload: { breakStart: true, breakName: tr.breakName, shiftId: tr.shiftId },
        });
      } else if (tr.kind === 'break_end') {
        this.schedule(tr.timestamp, 'MachineStarted', {
          details: `Break ended: ${tr.breakName}`,
          payload: { breakEnd: true, breakName: tr.breakName, shiftId: tr.shiftId },
        });
      } else if (tr.kind === 'maintenance_start') {
        this.schedule(tr.timestamp, 'PlannedMaintenanceStarted', {
          objectId: tr.targetObjectId,
          details: `Planned maintenance started: ${tr.maintenanceName}`,
          payload: { maintenanceId: tr.maintenanceId, targetObjectId: tr.targetObjectId },
        });
      } else if (tr.kind === 'maintenance_end') {
        this.schedule(tr.timestamp, 'PlannedMaintenanceCompleted', {
          objectId: tr.targetObjectId,
          details: `Planned maintenance completed: ${tr.maintenanceName}`,
          payload: { maintenanceId: tr.maintenanceId, targetObjectId: tr.targetObjectId },
        });
      }
    }

    // Schedule initial product creation at t = 0 if products and stages exist
    const firstDispatch = this.selectNextDispatchProduct();
    if (firstDispatch && this.project.stages.length > 0) {
      this.sourceTimerScheduled = true;
      this.schedule(0, 'ProductCreated', {
        details: 'Initial unit release scheduled',
        payload: { productId: firstDispatch.id },
      });
    }
  }

  private getConveyorPhysicalCapacity(
    conv: LayoutObject,
    prod?: ProductDefinition,
    ent?: ProductEntityState
  ): number {
    const carrierLen =
      ent?.isBatchCarrier && ent.containerKind === 'pallet'
        ? Math.max(1.0, prod?.dimensions.length || 0.75)
        : undefined;
    const metrics = computeConveyorMetrics(conv, prod, carrierLen);
    return metrics.canFit ? metrics.physicalCapacity : 0;
  }

  private getEntityPhysicalSize(ent?: ProductEntityState): { length: number; width: number; height: number } {
    const prod = ent ? this.productsMap.get(ent.productId) : undefined;
    const baseL = Math.max(0.18, Number(prod?.dimensions.length) || 0.55);
    const baseW = Math.max(0.18, Number(prod?.dimensions.width) || 0.42);
    const baseH = Math.max(0.12, Number(prod?.dimensions.height) || 0.35);
    if (ent?.isBatchCarrier) {
      if (ent.containerKind === 'pallet') {
        return { length: Math.max(baseL, 1.05), width: Math.max(baseW, 0.85), height: Math.max(baseH, 0.95) };
      }
      if (ent.containerKind === 'carton') {
        return { length: Math.max(baseL, 0.72), width: Math.max(baseW, 0.56), height: baseH };
      }
      if (ent.containerKind === 'pack') {
        return { length: Math.max(baseL, 0.68), width: Math.max(baseW, 0.52), height: baseH };
      }
    }
    return { length: baseL, width: baseW, height: baseH };
  }

  private getConveyorAxisMetrics(
    conv: LayoutObject,
    pos: Vec3
  ): { sBelt: number; perpBelt: number; beltLen: number; ux: number; uz: number; rotDeg: number } {
    const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
    const dir = conv.operations.direction === -1 ? -1 : 1;
    const ux = Math.cos(rad) * dir;
    const uz = Math.sin(rad) * dir;
    const beltLen = Math.max(0.2, Number(conv.geometry.dimensions.length) || 1);
    const dx = pos.x - conv.geometry.position.x;
    const dz = pos.z - conv.geometry.position.z;
    const along = dx * ux + dz * uz;
    const perpBelt = -dx * uz + dz * ux;
    const sBelt = Math.max(0, Math.min(beltLen, along + beltLen / 2));
    const rotDeg = (Math.atan2(uz, ux) * 180) / Math.PI;
    return { sBelt, perpBelt, beltLen, ux, uz, rotDeg };
  }

  private evalPolylineAt(
    waypoints: Vec3[],
    cumLengths: number[],
    dist: number
  ): { pos: Vec3; rotDeg: number } {
    if (waypoints.length === 0) return { pos: { x: 0, y: 0, z: 0 }, rotDeg: 0 };
    if (waypoints.length === 1) return { pos: { ...waypoints[0] }, rotDeg: 0 };
    const total = cumLengths[cumLengths.length - 1] || 0;
    const clamped = Math.max(0, Math.min(total, dist));
    let segIdx = 0;
    for (let i = 1; i < cumLengths.length; i++) {
      if (clamped <= cumLengths[i] || i === cumLengths.length - 1) {
        segIdx = i - 1;
        break;
      }
    }
    const d0 = cumLengths[segIdx];
    const d1 = cumLengths[segIdx + 1];
    const localT = d1 > d0 ? (clamped - d0) / (d1 - d0) : 0;
    const p0 = waypoints[segIdx];
    const p1 = waypoints[segIdx + 1];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const rotDeg = Math.hypot(dx, dz) > 1e-5 ? (Math.atan2(dz, dx) * 180) / Math.PI : 0;
    return {
      pos: {
        x: p0.x + dx * localT,
        y: p0.y + (p1.y - p0.y) * localT,
        z: p0.z + dz * localT,
      },
      rotDeg,
    };
  }

  private isSlotClearOfObstacles(
    wx: number,
    wz: number,
    halfL: number,
    halfW: number,
    ignoreObjIds: Set<string>
  ): boolean {
    const fLen = Math.max(4, this.project.factory.lengthM || 30);
    const fWid = Math.max(4, this.project.factory.widthM || 20);
    if (wx - halfL < 0.2 || wx + halfL > fLen - 0.2 || wz - halfW < 0.2 || wz + halfW > fWid - 0.2) {
      return false;
    }
    const rSlot = Math.max(halfL, halfW) + 0.06;
    for (const obj of this.objectsMap.values()) {
      if (!obj.rendering.visible || ignoreObjIds.has(obj.id)) continue;
      if (obj.kind === 'vehicle') continue;
      const rad = (obj.geometry.rotationDeg * Math.PI) / 180;
      const cosR = Math.cos(-rad);
      const sinR = Math.sin(-rad);
      const dx = wx - obj.geometry.position.x;
      const dz = wz - obj.geometry.position.z;
      const lx = dx * cosR - dz * sinR;
      const lz = dx * sinR + dz * cosR;
      const oHalfL = obj.geometry.dimensions.length / 2 + halfL + 0.06;
      const oHalfW = obj.geometry.dimensions.width / 2 + halfW + 0.06;
      if (Math.abs(lx) < oHalfL && Math.abs(lz) < oHalfW) {
        return false;
      }
    }
    for (const w of this.project.workers) {
      if (Math.hypot(wx - w.position.x, wz - w.position.z) < rSlot + 0.28) {
        return false;
      }
    }
    return true;
  }

  private positionStationActiveUnits(objId: string): void {
    const obj = this.objectsMap.get(objId);
    const st = this.objectStates.get(objId);
    if (!obj || !st || obj.kind === 'conveyor') return;
    const count = st.busyUnitIds.length;
    if (count === 0) return;

    const ents: ProductEntityState[] = [];
    let maxL = 0.5;
    let maxW = 0.4;
    for (const eid of st.busyUnitIds) {
      const ent = this.entities.get(eid);
      if (!ent) continue;
      ents.push(ent);
      const sz = this.getEntityPhysicalSize(ent);
      if (sz.length > maxL) maxL = sz.length;
      if (sz.width > maxW) maxW = sz.width;
    }
    if (ents.length === 0) return;

    const rad = (obj.geometry.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const stepX = maxL + 0.14;
    const stepZ = maxW + 0.14;
    const cols = ents.length === 1 ? 1 : Math.max(1, Math.min(ents.length, Math.max(2, Math.floor((obj.geometry.dimensions.length + 0.4) / stepX))));
    const rows = Math.ceil(ents.length / cols);

    for (let i = 0; i < ents.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = ents.length === 1 ? 0 : (col - (cols - 1) / 2) * stepX;
      const lz = ents.length === 1 ? 0 : (row - (rows - 1) / 2) * stepZ;
      ents[i].worldPosition = {
        x: obj.geometry.position.x + lx * cosR - lz * sinR,
        y: obj.geometry.dimensions.height,
        z: obj.geometry.position.z + lx * sinR + lz * cosR,
      };
      ents[i].rotationDeg = obj.geometry.rotationDeg;
    }
  }

  private repositionStageQueue(stageId: string): void {
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId) || [];
    const holder = this.stageBatchHolders.get(stageId) || [];
    if (!stage) return;

    const queuedIds: string[] = [];
    for (const h of holder) queuedIds.push(h.entityId);
    for (const id of buf) queuedIds.push(id);
    if (queuedIds.length === 0) return;

    const ents: ProductEntityState[] = [];
    let maxL = 0.45;
    let maxW = 0.35;
    for (const eid of queuedIds) {
      const ent = this.entities.get(eid);
      if (!ent || ent.scrapped || ent.completedAt !== undefined || ent.absorbedIntoEntityId) continue;
      ents.push(ent);
      const sz = this.getEntityPhysicalSize(ent);
      if (sz.length > maxL) maxL = sz.length;
      if (sz.width > maxW) maxW = sz.width;
    }
    if (ents.length === 0) return;

    const stepX = maxL + 0.15;
    const stepZ = maxW + 0.15;

    // 1. Dedicated buffer object assigned to stage: arrange cleanly atop the buffer deck
    const bufObj = stage.assignedObjectIds
      .map((id) => this.objectsMap.get(id))
      .find((o): o is LayoutObject => Boolean(o && o.kind === 'buffer'));
    if (bufObj) {
      const rad = (bufObj.geometry.rotationDeg * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const cols = Math.max(1, Math.floor(Math.max(bufObj.geometry.dimensions.length, stepX) / stepX));
      const rows = Math.max(1, Math.floor(Math.max(bufObj.geometry.dimensions.width, stepZ) / stepZ));
      const pageCap = cols * rows;
      for (let i = 0; i < ents.length; i++) {
        const layer = Math.floor(i / pageCap);
        const idxInPage = i % pageCap;
        const col = idxInPage % cols;
        const row = Math.floor(idxInPage / cols);
        const lx = (col - (cols - 1) / 2) * stepX;
        const lz = (row - (rows - 1) / 2) * stepZ - layer * (rows * stepZ + 0.2);
        ents[i].worldPosition = {
          x: bufObj.geometry.position.x + lx * cosR - lz * sinR,
          y: layer === 0 ? bufObj.geometry.dimensions.height : 0,
          z: bufObj.geometry.position.z + lx * sinR + lz * cosR,
        };
        ents[i].rotationDeg = bufObj.geometry.rotationDeg;
      }
      return;
    }

    const stationObj =
      stage.assignedObjectIds
        .map((id) => this.objectsMap.get(id))
        .find((o): o is LayoutObject => Boolean(o && o.kind !== 'storage' && o.kind !== 'vehicle')) ||
      this.objectsMap.get(stage.assignedObjectIds[0]);
    if (!stationObj) return;

    const rad = (stationObj.geometry.rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const rotDeg = stationObj.geometry.rotationDeg;
    const stL = stationObj.geometry.dimensions.length;
    const stW = stationObj.geometry.dimensions.width;

    // Conveyor flowchart node waiting queue: stage neatly in-line behind any pre-entry items
    if (stationObj.kind === 'conveyor') {
      const dir = stationObj.operations.direction === -1 ? -1 : 1;
      let preEntryCount = 0;
      for (const tr of this.conveyorTransits.values()) {
        if (tr.conveyorId === stationObj.id && !tr.fromObjectId && this.clockSec < tr.startTime - 1e-6) {
          preEntryCount++;
        }
      }
      for (let i = 0; i < ents.length; i++) {
        const lx = -dir * (stL / 2 + maxL / 2 + 0.25 + (preEntryCount + i) * stepX);
        ents[i].worldPosition = {
          x: stationObj.geometry.position.x + lx * cosR,
          y: 0,
          z: stationObj.geometry.position.z + lx * sinR,
        };
        ents[i].rotationDeg = rotDeg + (dir === -1 ? 180 : 0);
      }
      return;
    }

    // Determine side away from nearest conveyor so staging never overlaps conveyor belt
    let outZSign = -1;
    const convRef = stage.conveyorObjectId
      ? this.objectsMap.get(stage.conveyorObjectId)
      : this.project.layoutObjects.find((o) => o.kind === 'conveyor' && o.rendering.visible);
    if (convRef) {
      const dxC = convRef.geometry.position.x - stationObj.geometry.position.x;
      const dzC = convRef.geometry.position.z - stationObj.geometry.position.z;
      const localZC = -dxC * sinR + dzC * cosR;
      outZSign = localZC >= 0 ? -1 : 1;
    }

    // Generate clean, non-overlapping floor staging grid adjacent to the station (never stacked on machine roof!)
    const candidateOffsets: Array<{ lx: number; lz: number }> = [];
    // Bay 1: Inbound (-X) side of station (2 rows along Z extending away from conveyor)
    for (let col = 0; col < 6; col++) {
      const lx = -(stL / 2 + maxL / 2 + 0.28 + col * stepX);
      candidateOffsets.push({ lx, lz: 0 });
      candidateOffsets.push({ lx, lz: outZSign * stepZ });
      candidateOffsets.push({ lx, lz: -outZSign * stepZ });
    }
    // Bay 2: Outboard Z side (away from conveyor)
    for (let row = 0; row < 4; row++) {
      const lz = outZSign * (stW / 2 + maxW / 2 + 0.28 + row * stepZ);
      for (let col = -1; col <= 2; col++) {
        candidateOffsets.push({ lx: col * stepX, lz });
      }
    }
    // Bay 3: Opposite Z side / Downstream (+X) fallback
    for (let col = 0; col < 4; col++) {
      const lx = stL / 2 + maxL / 2 + 0.28 + col * stepX;
      candidateOffsets.push({ lx, lz: 0 });
      candidateOffsets.push({ lx, lz: outZSign * stepZ });
    }

    const ignoreSet = new Set<string>();
    const placed: Array<{ x: number; z: number }> = [];
    const halfL = maxL / 2;
    const halfW = maxW / 2;

    const noOverlapPlaced = (wx: number, wz: number): boolean =>
      placed.every((p) => Math.abs(wx - p.x) >= maxL + 0.08 || Math.abs(wz - p.z) >= maxW + 0.08);

    let candIdx = 0;
    for (let i = 0; i < ents.length; i++) {
      let chosenX: number | undefined;
      let chosenZ: number | undefined;

      while (candIdx < candidateOffsets.length) {
        const c = candidateOffsets[candIdx++];
        const wx = stationObj.geometry.position.x + c.lx * cosR - c.lz * sinR;
        const wz = stationObj.geometry.position.z + c.lx * sinR + c.lz * cosR;
        if (noOverlapPlaced(wx, wz) && this.isSlotClearOfObstacles(wx, wz, halfL, halfW, ignoreSet)) {
          chosenX = wx;
          chosenZ = wz;
          break;
        }
      }

      if (chosenX === undefined || chosenZ === undefined) {
        // Fallback outside obstacles without clipping previous slots
        const col = Math.floor(i / 2);
        const row = i % 2;
        const lx = -(stL / 2 + maxL / 2 + 0.28 + col * stepX);
        const lz = row * outZSign * stepZ;
        chosenX = stationObj.geometry.position.x + lx * cosR - lz * sinR;
        chosenZ = stationObj.geometry.position.z + lx * sinR + lz * cosR;
      }

      placed.push({ x: chosenX, z: chosenZ });
      ents[i].worldPosition = { x: chosenX, y: 0, z: chosenZ };
      ents[i].rotationDeg = rotDeg;
    }
  }

  private computeConveyorEntryDelay(
    conv: LayoutObject,
    sEnter: number,
    perpEnter: number,
    ent: ProductEntityState,
    now: number
  ): number {
    const prod = this.productsMap.get(ent.productId);
    const sz = this.getEntityPhysicalSize(ent);
    const cMetrics = computeConveyorMetrics(conv, prod, sz.length);
    const speed = cMetrics.speedMps;
    const spacing = Math.max(0.05, Number(conv.operations.productSpacingM ?? 0.15));
    const convW = Math.max(0.2, conv.geometry.dimensions.width || 0.8);
    let delay = 0;

    // Enforce global conveyor entry cadence + physical clearance against entities already on the belt
    const maxPasses = Math.max(16, this.conveyorTransits.size + 4);
    for (let pass = 0; pass < maxPasses; pass++) {
      const candidateTime = now + delay;
      let pushed = false;

      for (const tr of this.conveyorTransits.values()) {
        if (tr.conveyorId !== conv.id) continue;
        if (!tr.paused && tr.endTime <= candidateTime + 1e-4) continue;
        const otherEnt = this.entities.get(tr.entityId);
        if (!otherEnt) continue;
        const otherSz = this.getEntityPhysicalSize(otherEnt);
        const reqPitch = (sz.length + otherSz.length) / 2 + spacing;

        const span = Math.max(0.001, tr.endTime - tr.startTime);
        const effTime = tr.paused ? (tr.pausedAt ?? tr.startTime) : candidateTime;
        const tOther = Math.max(0, Math.min(1, (effTime - tr.startTime) / span));
        const { pos: posOther } = this.evalPolylineAt(tr.waypoints, tr.cumLengths, tOther * tr.totalLength);
        const axOther = this.getConveyorAxisMetrics(conv, posOther);
        if (Math.abs(axOther.perpBelt - perpEnter) > convW * 0.75) continue;

        const axEndOther = this.getConveyorAxisMetrics(
          conv,
          tr.waypoints[tr.waypoints.length - 1] || posOther
        );
        // Only conflict if other entity hasn't already exited before sEnter + reqPitch
        if (axEndOther.sBelt > sEnter - reqPitch + 0.05 && Math.abs(axOther.sBelt - sEnter) < reqPitch - 1e-4) {
          const waitUntilClear = (sEnter + reqPitch - axOther.sBelt) / speed;
          const baseShift = tr.startTime > candidateTime ? tr.startTime - candidateTime : 0;
          const extra = Math.max(0.05, baseShift + waitUntilClear);
          delay += extra;
          pushed = true;
        }
      }
      if (!pushed) break;
    }

    return delay;
  }

  private schedule(
    timestamp: number,
    type: SimEventType,
    opts: {
      entityId?: string;
      stageId?: string;
      objectId?: string;
      workerId?: string;
      details: string;
      payload?: Record<string, unknown>;
    }
  ): void {
    const clampedTime = Math.max(this.clockSec, timestamp);
    this.queue.push({
      seq: ++this.seqCounter,
      timestamp: clampedTime,
      type,
      entityId: opts.entityId,
      stageId: opts.stageId,
      objectId: opts.objectId,
      workerId: opts.workerId,
      details: opts.details,
      payload: opts.payload,
    });
  }

  private recordEvent(ev: InternalEvent): void {
    if (ev.payload?.silent === true) return;
    this.totalEventsExecuted++;
    if (this.eventLog.length < 25000) {
      this.eventLog.push({
        seq: ev.seq,
        timestamp: ev.timestamp,
        type: ev.type,
        entityId: ev.entityId,
        stageId: ev.stageId,
        objectId: ev.objectId,
        workerId: ev.workerId,
        details: ev.details,
      });
    }
  }

  private updateWipIntegral(newTime: number): void {
    const dt = Math.max(0, newTime - this.lastWipUpdate);
    const activeWip = this.getActiveWipCount();
    this.wipArea += activeWip * dt;
    this.lastWipUpdate = newTime;

    while (this.nextSampleTime <= newTime && this.nextSampleTime <= this.project.simulationConfig.durationSec) {
      const hoursElapsed = Math.max(this.nextSampleTime / 3600, 1 / 60);
      this.wipSeries.push({
        timeSec: this.nextSampleTime,
        wip: activeWip,
        completed: this.completedCount,
        throughputPerHour: this.completedCount / hoursElapsed,
      });
      this.nextSampleTime += 600;
    }
  }

  private getActiveWipCount(): number {
    let count = 0;
    for (const ent of this.activeEntities.values()) {
      if (!ent.scrapped && ent.completedAt === undefined && !ent.absorbedIntoEntityId) {
        count += ent.batchCount ?? 1;
      }
    }
    return count;
  }

  private getStageQueueUnitCount(stageId: string): number {
    const q = this.stageBuffers.get(stageId) || [];
    const h = this.stageBatchHolders.get(stageId) || [];
    let count = 0;
    for (const eid of q) {
      count += this.entities.get(eid)?.batchCount ?? 1;
    }
    for (const item of h) {
      count += item.units;
    }
    return count;
  }

  private getActiveDispatchableProducts(): ProductDefinition[] {
    return this.project.products.filter((p) => {
      const released = this.productReleasedCount.get(p.id) || 0;
      const quota = this.productTargetQuota.get(p.id) ?? Infinity;
      return released < quota;
    });
  }

  private selectNextDispatchProduct(advanceCursor = false): ProductDefinition | undefined {
    const active = this.getActiveDispatchableProducts();
    if (active.length === 0) return undefined;
    if (active.length === 1) return active[0];

    const cfg = this.project.simulationConfig;
    const rule = cfg.dispatchingRule ?? 'weighted_mix';

    if (rule === 'fixed_sequence') {
      const seqIds = cfg.productSequence && cfg.productSequence.length > 0
        ? cfg.productSequence
        : this.project.products.map((p) => p.id);
      const activeById = new Map(active.map((p) => [p.id, p]));
      const ordered = seqIds
        .map((id) => activeById.get(id))
        .filter((p): p is ProductDefinition => Boolean(p));
      for (const p of active) {
        if (!ordered.some((o) => o.id === p.id)) ordered.push(p);
      }
      // If any product in sequence has a finite quota, finish one completely before moving on
      const finiteHead = ordered.find((p) => Number.isFinite(this.productTargetQuota.get(p.id) ?? Infinity));
      if (finiteHead) return finiteHead;
      return ordered[this.totalArrived % ordered.length];
    }

    if (rule === 'product_priority') {
      const sorted = [...active].sort((a, b) => {
        const diff = Number(b.priority ?? 1) - Number(a.priority ?? 1);
        if (Math.abs(diff) > 1e-9) return diff;
        const relA = (this.productReleasedCount.get(a.id) || 0) / Math.max(0.01, Number(a.mixWeight ?? 1));
        const relB = (this.productReleasedCount.get(b.id) || 0) / Math.max(0.01, Number(b.mixWeight ?? 1));
        return relA - relB;
      });
      return sorted[0];
    }

    if (rule === 'round_robin') {
      const idx = this.rrCursor % active.length;
      if (advanceCursor) {
        this.rrCursor = (this.rrCursor + 1) % active.length;
      }
      return active[idx];
    }

    // weighted_mix: proportional deficit scheduling by mixWeight (exact ratio interleaving)
    let best = active[0];
    let lowestRatio = Infinity;
    for (const p of active) {
      const w = Math.max(0.01, Number(p.mixWeight ?? 1));
      const rel = this.productReleasedCount.get(p.id) || 0;
      const ratio = rel / w;
      if (ratio < lowestRatio - 1e-9) {
        lowestRatio = ratio;
        best = p;
      }
    }
    return best;
  }

  private getObjectBreakPolicy(obj: LayoutObject): InterruptionPolicy {
    if (obj.operations.breakPolicy) return obj.operations.breakPolicy;
    if (obj.operations.runDuringBreaks) return 'continue_during_break';
    return this.project.simulationConfig.interruptionPolicy ?? 'stop_immediately';
  }

  private getObjectShiftEndPolicy(obj: LayoutObject): ShiftEndPolicy {
    if (obj.operations.shiftEndPolicy) return obj.operations.shiftEndPolicy;
    if (obj.operations.breakPolicy === 'finish_current_cycle') return 'finish_current_cycle';
    return this.project.simulationConfig.interruptionPolicy ?? 'stop_immediately';
  }

  private getWorkerBreakPolicy(w: WorkerDefinition): ShiftEndPolicy {
    return w.breakPolicy ?? this.project.simulationConfig.interruptionPolicy ?? 'stop_immediately';
  }

  private getWorkerShiftEndPolicy(w: WorkerDefinition): ShiftEndPolicy {
    return w.shiftEndPolicy ?? w.breakPolicy ?? this.project.simulationConfig.interruptionPolicy ?? 'stop_immediately';
  }

  private isSourceStillActive(now: number): boolean {
    if (now >= this.project.simulationConfig.durationSec) return false;
    return this.getActiveDispatchableProducts().length > 0;
  }

  private resolveObjectActiveOrIdleStatus(objId: string, now: number): ObjectRuntimeState['status'] {
    const obj = this.objectsMap.get(objId);
    const st = this.objectStates.get(objId);
    if (!obj || !st) return 'idle';
    if (st.status === 'down') return 'down';

    const active = this.activeJobs.get(objId) || [];
    if (active.some((j) => j.phase === 'processing')) return 'running';
    if (active.some((j) => j.phase === 'setup')) return 'setup';

    if (st.busyUnitIds.some((id) => this.blockedEntitySet.has(id))) {
      return 'blocked';
    }

    const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);
    if (!avail.available) {
      return availToMachineStatus(avail);
    }

    if (st.busyUnitIds.length > 0) {
      // Material present at station waiting for worker arrival -> idle, NOT running/starved
      return 'idle';
    }
    return this.resolveIdleOrStarvedStatus(objId, now);
  }

  private resolveIdleOrStarvedStatus(objId: string, now: number): ObjectRuntimeState['status'] {
    const obj = this.objectsMap.get(objId);
    if (!obj) return 'idle';
    const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);
    if (!avail.available) {
      return availToMachineStatus(avail);
    }
    if (obj.kind === 'conveyor' || obj.kind === 'storage' || obj.kind === 'vehicle') {
      return 'idle';
    }
    const stageId = obj.stageId;
    const buf = stageId ? this.stageBuffers.get(stageId) : undefined;
    if (buf && buf.length > 0) {
      return 'idle';
    }
    const stage = stageId ? this.stagesMap.get(stageId) : undefined;
    const batchCfg = stageId ? this.stageBatchConfigs.get(stageId) : undefined;
    const holder = stageId ? this.stageBatchHolders.get(stageId) : undefined;
    const inTransit = stageId ? this.stageInTransitCounts.get(stageId) || 0 : 0;
    if (inTransit > 0 || (holder && holder.length > 0 && batchCfg?.batchMode === 'collect_batch')) {
      return 'starved';
    }
    const upstreamClosure = stageId ? this.stageUpstreamClosures.get(stageId) : undefined;
    let upstreamHasWork = false;
    if (upstreamClosure && upstreamClosure.size > 0) {
      for (const ent of this.activeEntities.values()) {
        if (!ent.scrapped && ent.completedAt === undefined && !ent.absorbedIntoEntityId) {
          if (ent.currentStageId && upstreamClosure.has(ent.currentStageId)) {
            upstreamHasWork = true;
            break;
          }
        }
      }
    }
    if (upstreamHasWork || this.isSourceStillActive(now)) {
      return stage ? 'starved' : 'idle';
    }
    return 'idle';
  }

  private setObjectStatus(
    objId: string,
    nextStatus: ObjectRuntimeState['status'],
    now: number
  ): void {
    const st = this.objectStates.get(objId);
    const obj = this.objectsMap.get(objId);
    if (!st) return;

    this.stateTracker.transitionMachine(objId, nextStatus, now, st);

    if (obj?.kind === 'conveyor') {
      const convNext: ConveyorRuntimeStatus =
        nextStatus === 'running'
          ? 'moving'
          : nextStatus === 'blocked'
          ? 'blocked'
          : nextStatus === 'unavailable' || nextStatus === 'maintenance' || nextStatus === 'down'
          ? 'unavailable'
          : 'stopped';
      this.stateTracker.transitionConveyor(objId, convNext, now, st);
    }
  }

  private setWorkerStatus(
    workerId: string,
    nextStatus: WorkerRuntimeState['status'],
    now: number
  ): void {
    const ws = this.workerStates.get(workerId);
    if (!ws) return;
    this.stateTracker.transitionWorker(workerId, nextStatus, now, ws);
  }

  private syncResourcesToCalendar(now: number): void {
    this.shiftActive = this.calendarEngine.isPlantShiftActiveAt(now);
    this.onBreak = this.calendarEngine.isPlantOnBreakAt(now);
    this.updateInterpolatedPositions(now);

    // First handle allocated workers whose shift/break/maintenance boundary hit
    for (const w of this.project.workers) {
      const ws = this.workerStates.get(w.id);
      if (!ws) continue;
      const allocEntId = this.workerAllocatedEntity.get(w.id);
      const wAvail = this.calendarEngine.getWorkerAvailabilityAt(w, now);

      if (allocEntId === null || allocEntId === undefined) {
        if (wAvail.available) {
          if (ws.status === 'break' || ws.status === 'unavailable') {
            this.setWorkerStatus(w.id, 'idle', now);
          }
        } else {
          const targetStatus = wAvail.reason === 'break' ? 'break' : 'unavailable';
          if (ws.status === 'idle' || ws.status === 'break' || ws.status === 'unavailable') {
            this.setWorkerStatus(w.id, targetStatus, now);
          }
        }
        continue;
      }

      if (!wAvail.available) {
        const wPolicy: ShiftEndPolicy =
          wAvail.reason === 'break'
            ? this.getWorkerBreakPolicy(w)
            : wAvail.reason === 'off_shift'
            ? this.getWorkerShiftEndPolicy(w)
            : 'stop_immediately';

        // Pause any pending walk immediately if worker goes unavailable and walk hasn't finished at now
        for (const [objId, pList] of this.pendingWalkJobs.entries()) {
          if (pList.some((pj) => pj.workerIds.includes(w.id) && pj.startAt > now + 1e-6)) {
            this.preemptPendingWalkJobsForEntity(objId, allocEntId, now);
          }
        }

        // If worker policy is stop_immediately (or maintenance), preempt their active operation if not completing at exact timestamp now
        if (wPolicy === 'stop_immediately') {
          for (const [objId, aList] of this.activeJobs.entries()) {
            const match = aList.find(
              (j) =>
                j.entityId === allocEntId &&
                j.workerIds.includes(w.id) &&
                j.expectedEndAt > now + 1e-6
            );
            if (match) {
              this.preemptSingleActiveJob(objId, match, now);
              this.setObjectStatus(objId, this.resolveObjectActiveOrIdleStatus(objId, now), now);
            }
          }
        }
      }
    }

    for (const obj of this.objectsMap.values()) {
      const st = this.objectStates.get(obj.id);
      if (!st) continue;
      const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);

      if (!avail.available && avail.reason === 'maintenance') {
        if (st.status !== 'down' && st.status !== 'maintenance') {
          this.preemptPendingWalkJobs(obj.id, now);
          this.preemptActiveJobs(obj.id, now);
          if (obj.kind === 'conveyor') {
            this.pauseConveyorTransits(obj.id, now);
          }
          this.setObjectStatus(obj.id, 'maintenance', now);
        }
      } else if (avail.available) {
        const fp = resolveObjectFailureParams(obj, this.project.simulationConfig);
        if (fp.enabled && fp.availability <= 0) {
          if (st.status !== 'down') {
            this.preemptPendingWalkJobs(obj.id, now);
            this.preemptActiveJobs(obj.id, now);
            if (obj.kind === 'conveyor') {
              this.pauseConveyorTransits(obj.id, now);
            }
            this.setObjectStatus(obj.id, 'down', now);
          }
        } else if (st.status === 'maintenance' || st.status === 'unavailable') {
          if (obj.kind === 'conveyor') {
            this.resumeConveyorTransits(obj.id, now);
          }
          this.resumePausedJobs(obj.id, now);
          this.resumePausedWalkJobs(obj.id, now);
          this.setObjectStatus(obj.id, this.resolveObjectActiveOrIdleStatus(obj.id, now), now);
          if (obj.kind === 'conveyor') {
            this.syncRecoveredConveyorState(obj.id, now);
            this.retryBlockedUpstreamAll(now);
          }
        } else {
          // Even if machine was already available, a paused job waiting on a worker may now resume
          if (obj.kind === 'conveyor') {
            this.resumeConveyorTransits(obj.id, now);
          }
          if ((this.pausedJobs.get(obj.id)?.length || 0) > 0) {
            this.resumePausedJobs(obj.id, now);
          }
          if ((this.pausedWalkJobs.get(obj.id)?.length || 0) > 0) {
            this.resumePausedWalkJobs(obj.id, now);
          }
          if ((this.activeJobs.get(obj.id)?.length || 0) === 0 && st.status !== 'down' && st.status !== 'blocked') {
            this.setObjectStatus(obj.id, this.resolveObjectActiveOrIdleStatus(obj.id, now), now);
          }
          if (obj.kind === 'conveyor') {
            this.syncRecoveredConveyorState(obj.id, now);
            this.retryBlockedUpstreamAll(now);
          }
        }
      } else {
        // Off-shift or break interruption policy
        const policy: InterruptionPolicy =
          avail.reason === 'break'
            ? this.getObjectBreakPolicy(obj)
            : this.getObjectShiftEndPolicy(obj);

        this.preemptPendingWalkJobs(obj.id, now);
        if (policy === 'stop_immediately') {
          this.preemptActiveJobs(obj.id, now);
          if (obj.kind === 'conveyor') {
            this.pauseConveyorTransits(obj.id, now);
          }
        }

        if (st.status !== 'down' && st.status !== 'blocked') {
          this.setObjectStatus(obj.id, this.resolveObjectActiveOrIdleStatus(obj.id, now), now);
        }
      }
    }
  }

  private isConveyorAvailableForTransport(conv: LayoutObject, now: number): boolean {
    const st = this.objectStates.get(conv.id);
    if (!st) return false;
    if (
      st.status === 'down' ||
      st.status === 'maintenance' ||
      st.status === 'unavailable' ||
      st.status === 'blocked'
    ) {
      return false;
    }
    const fp = resolveObjectFailureParams(conv, this.project.simulationConfig);
    if (fp.enabled && fp.availability <= 0) return false;
    return this.calendarEngine.getObjectAvailabilityAt(conv, now).available;
  }

  private syncRecoveredConveyorState(convId: string, now: number): void {
    const cState = this.objectStates.get(convId);
    const conv = this.objectsMap.get(convId);
    if (!cState || !conv || conv.kind !== 'conveyor') return;
    if (
      cState.status === 'down' ||
      cState.status === 'maintenance' ||
      cState.status === 'unavailable' ||
      cState.status === 'blocked'
    ) {
      return;
    }
    let hasActiveMovement = (this.activeJobs.get(convId)?.length || 0) > 0;
    if (!hasActiveMovement) {
      for (const tr of this.conveyorTransits.values()) {
        if (tr.conveyorId === convId && !tr.paused && tr.startTime <= now + 1e-6) {
          hasActiveMovement = true;
          break;
        }
      }
    }
    this.stateTracker.transitionConveyor(
      convId,
      hasActiveMovement ? 'moving' : 'stopped',
      now,
      cState
    );
  }

  private pauseConveyorTransits(convId: string, now: number): void {
    for (const tr of this.conveyorTransits.values()) {
      if (tr.conveyorId !== convId || tr.paused) continue;
      if (tr.endTime <= now + 1e-6) continue;
      if (tr.transferToken !== undefined) {
        this.validJobTokens.delete(tr.transferToken);
      }
      if (now < tr.startTime) {
        tr.remainingBeforeStartSec = Math.max(0, tr.startTime - now);
        tr.remainingTransitSec = Math.max(0, tr.endTime - tr.startTime);
        tr.pausedProgress = 0;
      } else {
        tr.remainingBeforeStartSec = 0;
        tr.remainingTransitSec = Math.max(0, tr.endTime - now);
        const span = tr.endTime - tr.startTime;
        tr.pausedProgress =
          span > 1e-9 ? Math.max(0, Math.min(1, (now - tr.startTime) / span)) : 1;
      }
      tr.paused = true;
      tr.pausedAt = now;
    }
  }

  private resumeConveyorTransits(convId: string, now: number): void {
    const conv = this.objectsMap.get(convId);
    const cState = this.objectStates.get(convId);
    if (!conv || !cState || cState.status === 'down') return;
    if (!this.calendarEngine.getObjectAvailabilityAt(conv, now).available) return;

    let resumedAnyTransfer = false;
    for (const tr of this.conveyorTransits.values()) {
      if (tr.conveyorId !== convId || !tr.paused) continue;
      const totalSpan = Math.max(0, tr.endTime - tr.startTime);
      const remBefore = tr.remainingBeforeStartSec ?? 0;
      const remTransit = tr.remainingTransitSec ?? totalSpan;
      if (remBefore > 1e-9) {
        tr.startTime = now + remBefore;
        tr.endTime = tr.startTime + remTransit;
      } else {
        const elapsedTransit = Math.max(0, totalSpan - remTransit);
        tr.startTime = now - elapsedTransit;
        tr.endTime = now + remTransit;
      }
      tr.paused = false;
      tr.pausedAt = undefined;
      tr.pausedProgress = undefined;
      tr.remainingBeforeStartSec = undefined;
      tr.remainingTransitSec = undefined;

      if (tr.transferToken !== undefined) {
        const newToken = ++this.jobTokenCounter;
        this.validJobTokens.add(newToken);
        tr.transferToken = newToken;
        resumedAnyTransfer = true;
        const nextStage = this.stagesMap.get(tr.toStageId);
        this.schedule(tr.endTime, 'ProductTransferred', {
          entityId: tr.entityId,
          stageId: tr.toStageId,
          objectId: convId,
          details: `${tr.entityId} resumed conveying to ${nextStage?.name || tr.toStageId}`,
          payload: { transferConveyorId: convId, token: newToken },
        });
      }
    }
    if (resumedAnyTransfer) {
      this.syncRecoveredConveyorState(convId, now);
    }
  }

  private retryBlockedUpstreamAll(now: number): void {
    const stageIds = Array.from(this.blockedOutbox.keys());
    for (const sid of stageIds) {
      const outbox = this.blockedOutbox.get(sid);
      if (outbox && outbox.length > 0) {
        this.retryBlockedUpstreamForStage(sid, now);
      }
    }
  }

  private preemptPendingWalkJobs(objId: string, now: number): void {
    const pending = this.pendingWalkJobs.get(objId);
    if (!pending || pending.length === 0) return;
    const paused = this.pausedWalkJobs.get(objId) || [];
    const completingAtNow: PendingWalkJob[] = [];
    while (pending.length > 0) {
      const pj = pending.shift()!;
      if (pj.startAt <= now + 1e-6) {
        completingAtNow.push(pj);
        continue;
      }
      this.validJobTokens.delete(pj.token);
      pj.remainingDispatchDelaySec = Math.max(0, pj.startAt - now);
      for (const wid of pj.workerIds) {
        const endAt = pj.walkEndByWorker.get(wid) ?? now;
        pj.walkRemainingByWorker.set(wid, Math.max(0, endAt - now));
        if (this.workerAllocatedEntity.get(wid) === pj.entityId) {
          const wDef = this.workersMap.get(wid);
          const wAvail = wDef
            ? this.calendarEngine.getWorkerAvailabilityAt(wDef, now)
            : { available: true, reason: 'active' as const };
          this.setWorkerStatus(
            wid,
            wAvail.available ? 'idle' : wAvail.reason === 'break' ? 'break' : 'unavailable',
            now
          );
        }
      }
      paused.push(pj);
    }
    this.pendingWalkJobs.set(objId, completingAtNow);
    this.pausedWalkJobs.set(objId, paused);
  }

  private preemptPendingWalkJobsForEntity(objId: string, entityId: string, now: number): void {
    const pending = this.pendingWalkJobs.get(objId);
    if (!pending || pending.length === 0) return;
    const paused = this.pausedWalkJobs.get(objId) || [];
    const remainingList: PendingWalkJob[] = [];
    for (const pj of pending) {
      if (pj.entityId !== entityId || pj.startAt <= now + 1e-6) {
        remainingList.push(pj);
        continue;
      }
      this.validJobTokens.delete(pj.token);
      pj.remainingDispatchDelaySec = Math.max(0, pj.startAt - now);
      for (const wid of pj.workerIds) {
        const endAt = pj.walkEndByWorker.get(wid) ?? now;
        pj.walkRemainingByWorker.set(wid, Math.max(0, endAt - now));
        if (this.workerAllocatedEntity.get(wid) === pj.entityId) {
          const wDef = this.workersMap.get(wid);
          const wAvail = wDef
            ? this.calendarEngine.getWorkerAvailabilityAt(wDef, now)
            : { available: true, reason: 'active' as const };
          this.setWorkerStatus(
            wid,
            wAvail.available ? 'idle' : wAvail.reason === 'break' ? 'break' : 'unavailable',
            now
          );
        }
      }
      paused.push(pj);
    }
    this.pendingWalkJobs.set(objId, remainingList);
    this.pausedWalkJobs.set(objId, paused);
  }

  private preemptSingleActiveJob(objId: string, job: ActiveJobRecord, now: number): void {
    if (job.expectedEndAt <= now + 1e-6) return;
    const active = this.activeJobs.get(objId);
    if (!active) return;
    const idx = active.indexOf(job);
    if (idx === -1) return;
    active.splice(idx, 1);

    this.validJobTokens.delete(job.token);
    if (job.workerReleaseToken !== undefined) {
      this.validJobTokens.delete(job.workerReleaseToken);
      job.workerReleaseToken = undefined;
    }
    const elapsed = Math.max(0, now - job.startedAt);
    job.remainingSec = Math.max(0, job.expectedEndAt - now);
    if (job.workDurationSec !== undefined) {
      job.workDurationSec = Math.max(0, job.workDurationSec - elapsed);
    }
    for (const wid of job.workerIds) {
      if (this.workerAllocatedEntity.get(wid) !== job.entityId) continue;
      const wDef = this.workersMap.get(wid);
      const wAvail = wDef
        ? this.calendarEngine.getWorkerAvailabilityAt(wDef, now)
        : { available: true, reason: 'active' as const };
      const pausedStatus = wAvail.available
        ? 'idle'
        : wAvail.reason === 'break'
        ? 'break'
        : 'unavailable';
      this.setWorkerStatus(wid, pausedStatus, now);
    }
    const paused = this.pausedJobs.get(objId) || [];
    paused.push(job);
    this.pausedJobs.set(objId, paused);
  }

  private preemptActiveJobs(objId: string, now: number): void {
    const active = this.activeJobs.get(objId);
    if (!active || active.length === 0) return;
    const copy = [...active];
    for (const job of copy) {
      if (job.expectedEndAt > now + 1e-6) {
        this.preemptSingleActiveJob(objId, job, now);
      }
    }
  }

  private areAllWorkersAvailable(workerIds: string[], now: number): boolean {
    for (const wid of workerIds) {
      const wDef = this.workersMap.get(wid);
      if (wDef && !this.calendarEngine.getWorkerAvailabilityAt(wDef, now).available) {
        return false;
      }
    }
    return true;
  }

  private resumePausedWalkJobs(objId: string, now: number): void {
    const obj = this.objectsMap.get(objId);
    const stState = this.objectStates.get(objId);
    if (!obj || !stState || stState.status === 'down') return;
    if (!this.calendarEngine.getObjectAvailabilityAt(obj, now).available) return;

    const paused = this.pausedWalkJobs.get(objId);
    if (!paused || paused.length === 0) return;

    const stillPaused: PendingWalkJob[] = [];
    const pending = this.pendingWalkJobs.get(objId) || [];

    for (const pj of paused) {
      if (!this.areAllWorkersAvailable(pj.workerIds, now)) {
        stillPaused.push(pj);
        continue;
      }
      let maxRemWalk = 0;
      for (const wid of pj.workerIds) {
        const rem = Math.max(0, pj.walkRemainingByWorker.get(wid) ?? 0);
        if (rem > maxRemWalk) maxRemWalk = rem;
        const ws = this.workerStates.get(wid);
        if (ws) {
          pj.walkEndByWorker.set(wid, now + rem);
          if (rem > 1e-6) {
            ws.startPosition = { ...ws.position };
            ws.moveStartTime = now;
            ws.moveEndTime = now + rem;
            ws.targetStationId = objId;
            this.setWorkerStatus(wid, 'walking', now);
          } else {
            ws.position = { ...ws.targetPosition };
            ws.currentStationId = objId;
          }
        }
      }
      const remHeadway = Math.max(0, pj.remainingDispatchDelaySec ?? 0);
      const effectiveDelay = Math.max(maxRemWalk, remHeadway);
      const newToken = ++this.jobTokenCounter;
      pj.token = newToken;
      pj.startAt = now + effectiveDelay;
      this.validJobTokens.add(newToken);

      for (const wid of pj.workerIds) {
        const rem = pj.walkRemainingByWorker.get(wid) ?? 0;
        if (rem > 1e-6 && rem < effectiveDelay - 1e-6) {
          this.schedule(now + rem, 'WorkerAssigned', {
            entityId: pj.entityId,
            stageId: pj.stageId,
            objectId: objId,
            workerId: wid,
            details: `Worker arrived at ${pj.stageId}`,
            payload: { walkCompletedOnly: true, silent: true, walkToken: newToken },
          });
        }
      }

      if (effectiveDelay > 1e-6) {
        pending.push(pj);
      }
      if (pj.phase === 'setup') {
        this.schedule(pj.startAt, 'SetupStarted', {
          entityId: pj.entityId,
          stageId: pj.stageId,
          objectId: objId,
          details: `${obj.name} resumed walk/setup for ${pj.entityId}`,
          payload: {
            walkToken: newToken,
            workerIds: pj.workerIds,
            setupDuration: pj.setupDuration,
            procDuration: pj.procDuration,
          },
        });
      } else {
        this.schedule(pj.startAt, 'ProcessingStarted', {
          entityId: pj.entityId,
          stageId: pj.stageId,
          objectId: objId,
          details: `${obj.name} resumed walk/processing for ${pj.entityId}`,
          payload: {
            walkToken: newToken,
            workerIds: pj.workerIds,
            procDuration: pj.procDuration,
            workDuration: pj.workDurationSec,
            isConveyorNode: pj.isConveyorNode,
          },
        });
      }
    }

    this.pausedWalkJobs.set(objId, stillPaused);
    this.pendingWalkJobs.set(objId, pending);
  }

  private resumePausedJobs(objId: string, now: number): void {
    const obj = this.objectsMap.get(objId);
    if (!obj) return;
    const stState = this.objectStates.get(objId);
    if (!stState || stState.status === 'down') return;
    const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);
    if (!avail.available) return;

    const paused = this.pausedJobs.get(objId);
    if (!paused || paused.length === 0) return;
    const active = this.activeJobs.get(objId) || [];
    const stillPaused: ActiveJobRecord[] = [];

    while (paused.length > 0) {
      const job = paused.shift()!;
      const activeWorkerIds = job.workerIds.filter(
        (wid) => this.workerAllocatedEntity.get(wid) === job.entityId
      );
      if (!this.areAllWorkersAvailable(activeWorkerIds, now)) {
        stillPaused.push(job);
        continue;
      }

      const newToken = ++this.jobTokenCounter;
      job.token = newToken;
      job.startedAt = now;
      job.expectedEndAt = now + job.remainingSec;
      this.validJobTokens.add(newToken);

      for (const wid of activeWorkerIds) {
        this.setWorkerStatus(wid, 'busy', now);
      }
      job.workerIds = activeWorkerIds;
      active.push(job);

      if (job.phase === 'setup') {
        this.setObjectStatus(objId, 'setup', now);
        this.schedule(job.expectedEndAt, 'SetupCompleted', {
          entityId: job.entityId,
          stageId: job.stageId,
          objectId: job.objectId,
          details: `${obj.name} resumed setup for ${job.entityId}`,
          payload: {
            token: newToken,
            workerIds: activeWorkerIds,
            procDuration: job.totalProcSec,
            setupDuration: job.remainingSec,
          },
        });
      } else {
        this.setObjectStatus(objId, 'running', now);
        let completionWorkerIds = activeWorkerIds;
        if (
          job.isConveyorNode &&
          activeWorkerIds.length > 0 &&
          job.workDurationSec !== undefined &&
          job.workDurationSec < job.remainingSec - 1e-6
        ) {
          const releaseToken = ++this.jobTokenCounter;
          this.validJobTokens.add(releaseToken);
          job.workerReleaseToken = releaseToken;
          completionWorkerIds = [];
          this.schedule(now + job.workDurationSec, 'WorkerReleased', {
            entityId: job.entityId,
            stageId: job.stageId,
            objectId: job.objectId,
            details: `Conveyor manual work resumed & completed at ${job.stageId}`,
            payload: {
              token: releaseToken,
              earlyRelease: true,
              workerIds: activeWorkerIds,
            },
          });
        }
        this.schedule(job.expectedEndAt, 'ProcessingCompleted', {
          entityId: job.entityId,
          stageId: job.stageId,
          objectId: job.objectId,
          details: `${job.entityId} resumed and completed operation at ${job.stageId}`,
          payload: {
            token: newToken,
            workerIds: completionWorkerIds,
            procDuration: job.totalProcSec,
          },
        });
      }
    }
    this.pausedJobs.set(objId, stillPaused);
    this.activeJobs.set(objId, active);
  }

  private updateQueueIntegral(stageId: string, now: number): void {
    const acc = this.stageAcc.get(stageId);
    if (!acc) return;
    const dt = Math.max(0, now - acc.lastQueueTime);
    const qUnits = this.getStageQueueUnitCount(stageId);
    acc.queueArea += qUnits * dt;
    acc.lastQueueTime = now;
    if (dt > 1e-9 && qUnits > acc.maxQueue) acc.maxQueue = qUnits;
  }

  public advanceTo(targetTimeSec: number): void {
    const horizon = Math.min(targetTimeSec, this.project.simulationConfig.durationSec);
    while (this.queue.size > 0) {
      const next = this.queue.peek()!;
      if (next.timestamp > horizon) break;
      const ev = this.queue.pop()!;
      this.processEvent(ev);
    }

    this.updateWipIntegral(horizon);
    this.clockSec = horizon;
    this.updateInterpolatedPositions(horizon);

    if (horizon >= this.project.simulationConfig.durationSec && this.status !== 'completed') {
      this.finalizeAt(horizon);
    }
  }

  public stepNextEvent(): boolean {
    if (this.queue.size === 0) {
      this.updateWipIntegral(this.clockSec);
      this.updateInterpolatedPositions(this.clockSec);
      this.finalizeAt(this.clockSec);
      return false;
    }
    const next = this.queue.peek()!;
    if (next.timestamp > this.project.simulationConfig.durationSec) {
      const horizon = this.project.simulationConfig.durationSec;
      this.updateWipIntegral(horizon);
      this.clockSec = horizon;
      this.updateInterpolatedPositions(horizon);
      this.finalizeAt(horizon);
      return false;
    }
    const ev = this.queue.pop()!;
    this.processEvent(ev);
    this.updateWipIntegral(ev.timestamp);
    this.clockSec = ev.timestamp;
    this.updateInterpolatedPositions(ev.timestamp);
    return true;
  }

  public runToCompletion(): SimulationResult {
    this.status = 'running';
    this.advanceTo(this.project.simulationConfig.durationSec);
    return this.buildResult();
  }

  private finalizeAt(endSec: number): void {
    this.stateTracker.finalizeAt(endSec, this.objectStates, this.workerStates);
    for (const stageId of this.stageAcc.keys()) {
      this.updateQueueIntegral(stageId, endSec);
    }
    this.updateWipIntegral(endSec);
    this.status = 'completed';
  }

  private updateInterpolatedPositions(now: number): void {
    // 1. Group active conveyor transits by conveyorId to enforce physical belt pitch & accumulation
    const transitsByConv = new Map<string, ConveyorTransit[]>();
    for (const tr of this.conveyorTransits.values()) {
      const list = transitsByConv.get(tr.conveyorId) || [];
      list.push(tr);
      transitsByConv.set(tr.conveyorId, list);
    }

    for (const [convId, list] of transitsByConv.entries()) {
      const conv = this.objectsMap.get(convId);
      const spacing = Math.max(0.05, Number(conv?.operations.productSpacingM ?? 0.15));
      const convW = Math.max(0.2, conv?.geometry.dimensions.width || 0.8);

      const waitingPreEntry: Array<{ tr: ConveyorTransit; ent: ProductEntityState }> = [];
      const activeOnBelt: Array<{
        tr: ConveyorTransit;
        ent: ProductEntityState;
        rawDist: number;
        sBelt: number;
        sEntry: number;
        perpBelt: number;
        len: number;
      }> = [];

      for (const tr of list) {
        const ent = this.entities.get(tr.entityId);
        if (!ent) continue;
        const effNow = tr.paused ? (tr.pausedAt ?? tr.startTime) : now;
        if (effNow < tr.startTime - 1e-6) {
          waitingPreEntry.push({ tr, ent });
          continue;
        }
        const span = Math.max(0.001, tr.endTime - tr.startTime);
        const t = tr.paused && tr.pausedProgress !== undefined
          ? tr.pausedProgress
          : Math.max(0, Math.min(1, (effNow - tr.startTime) / span));
        const rawDist = t * tr.totalLength;
        const { pos } = this.evalPolylineAt(tr.waypoints, tr.cumLengths, rawDist);
        const sz = this.getEntityPhysicalSize(ent);
        if (conv) {
          const ax = this.getConveyorAxisMetrics(conv, pos);
          const axEntry = this.getConveyorAxisMetrics(conv, tr.waypoints[0] || pos);
          activeOnBelt.push({
            tr,
            ent,
            rawDist,
            sBelt: ax.sBelt,
            sEntry: axEntry.sBelt,
            perpBelt: ax.perpBelt,
            len: sz.length,
          });
        } else {
          const evalRes = this.evalPolylineAt(tr.waypoints, tr.cumLengths, rawDist);
          ent.conveyorProgress = t;
          ent.worldPosition = evalRes.pos;
          ent.rotationDeg = evalRes.rotDeg;
        }
      }

      // Position waiting pre-entry items neatly off the belt so they never collide with passing belt units
      waitingPreEntry.sort((a, b) => a.tr.startTime - b.tr.startTime);
      for (let wi = 0; wi < waitingPreEntry.length; wi++) {
        const { tr, ent } = waitingPreEntry[wi];
        const p0 = tr.waypoints[0] || ent.worldPosition;
        const p1 = tr.waypoints[1] || p0;
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const dLen = Math.hypot(dx, dz);
        const ux = dLen > 1e-5 ? dx / dLen : 1;
        const uz = dLen > 1e-5 ? dz / dLen : 0;
        const sz = this.getEntityPhysicalSize(ent);
        const fromObj = tr.fromObjectId ? this.objectsMap.get(tr.fromObjectId) : undefined;
        ent.conveyorProgress = 0;

        if (fromObj && fromObj.kind !== 'conveyor') {
          // Hold at sending station's output apron facing belt merge point (clear of conveyor belt!)
          const toConvDx = p0.x - fromObj.geometry.position.x;
          const toConvDz = p0.z - fromObj.geometry.position.z;
          const distToBelt = Math.hypot(toConvDx, toConvDz);
          const nx = distToBelt > 1e-5 ? toConvDx / distToBelt : 0;
          const nz = distToBelt > 1e-5 ? toConvDz / distToBelt : 1;
          const convHalfW = (conv?.geometry.dimensions.width || 0.8) / 2;
          const itemCrossHalf = sz.width / 2;
          const maxOutDist = Math.max(0, distToBelt - convHalfW - itemCrossHalf - 0.06);
          const minClearStation = fromObj.geometry.dimensions.width / 2 + itemCrossHalf + 0.06;
          const apronStep = Math.min(
            maxOutDist,
            Math.max(minClearStation, distToBelt * 0.48)
          );
          const staggerAlong = wi * (Math.max(sz.length, sz.width) + 0.14);
          ent.worldPosition = {
            x: fromObj.geometry.position.x + nx * apronStep - nz * staggerAlong,
            y: fromObj.geometry.dimensions.height,
            z: fromObj.geometry.position.z + nz * apronStep + nx * staggerAlong,
          };
          ent.rotationDeg = fromObj.geometry.rotationDeg;
        } else {
          const offsetBack = sz.length / 2 + 0.28 + wi * (sz.length + spacing);
          ent.worldPosition = {
            x: p0.x - ux * offsetBack,
            y: Math.max(0, p0.y - 0.02),
            z: p0.z - uz * offsetBack,
          };
          ent.rotationDeg = dLen > 1e-5 ? (Math.atan2(dz, dx) * 180) / Math.PI : conv?.geometry.rotationDeg ?? 0;
        }
      }

      if (conv && (activeOnBelt.length > 0 || (this.blockedConveyorEntities.get(convId)?.length || 0) > 0)) {
        // Position any blocked entities waiting at the conveyor exit cleanly bumper-to-bumper
        const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
        const dir = conv.operations.direction === -1 ? -1 : 1;
        const ux = Math.cos(rad) * dir;
        const uz = Math.sin(rad) * dir;
        const beltLen = Math.max(0.2, Number(conv.geometry.dimensions.length) || 1);
        const rotDeg = (Math.atan2(uz, ux) * 180) / Math.PI;

        const leaders: Array<{ sBelt: number; perpBelt: number; len: number }> = [];
        const blockedIds = this.blockedConveyorEntities.get(convId) || [];
        let blockedCursorS = beltLen - 0.15;
        for (const bId of blockedIds) {
          const bEnt = this.entities.get(bId);
          if (!bEnt) continue;
          const bSz = this.getEntityPhysicalSize(bEnt);
          const sPos = Math.max(bSz.length / 2, blockedCursorS - bSz.length / 2);
          const alongFromCenter = sPos - beltLen / 2;
          bEnt.worldPosition = {
            x: conv.geometry.position.x + ux * alongFromCenter,
            y: conv.geometry.dimensions.height,
            z: conv.geometry.position.z + uz * alongFromCenter,
          };
          bEnt.rotationDeg = rotDeg;
          bEnt.conveyorProgress = 1;
          leaders.push({ sBelt: sPos, perpBelt: 0, len: bSz.length });
          blockedCursorS = sPos - bSz.length / 2 - spacing;
        }

        // Accumulating conveyor clamping from downstream to upstream
        activeOnBelt.sort((a, b) => b.sBelt - a.sBelt || a.tr.startTime - b.tr.startTime);
        for (const item of activeOnBelt) {
          let clampedS = item.sBelt;
          for (const ld of leaders) {
            if (Math.abs(item.perpBelt - ld.perpBelt) > convW * 0.75) continue;
            const reqPitch = (item.len + ld.len) / 2 + spacing;
            const maxAllowedS = ld.sBelt - reqPitch;
            if (clampedS > maxAllowedS) {
              clampedS = Math.max(item.sEntry, maxAllowedS);
            }
          }
          const deltaBack = Math.max(0, item.sBelt - clampedS);
          const actualDist = Math.max(0, item.rawDist - deltaBack);
          const evalRes = this.evalPolylineAt(item.tr.waypoints, item.tr.cumLengths, actualDist);
          item.ent.conveyorProgress = item.tr.totalLength > 0 ? actualDist / item.tr.totalLength : 1;
          item.ent.worldPosition = evalRes.pos;
          item.ent.rotationDeg = evalRes.rotDeg;
          leaders.push({ sBelt: clampedS, perpBelt: item.perpBelt, len: item.len });
        }
      }
    }

    // Position any blocked conveyor exit entities even if no moving transits remain on that conveyor
    for (const [convId, blockedIds] of this.blockedConveyorEntities.entries()) {
      if (transitsByConv.has(convId) || blockedIds.length === 0) continue;
      const conv = this.objectsMap.get(convId);
      if (!conv) continue;
      const spacing = Math.max(0.05, Number(conv.operations.productSpacingM ?? 0.15));
      const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
      const dir = conv.operations.direction === -1 ? -1 : 1;
      const ux = Math.cos(rad) * dir;
      const uz = Math.sin(rad) * dir;
      const beltLen = Math.max(0.2, Number(conv.geometry.dimensions.length) || 1);
      const rotDeg = (Math.atan2(uz, ux) * 180) / Math.PI;
      let cursorS = beltLen - 0.15;
      for (const bId of blockedIds) {
        const bEnt = this.entities.get(bId);
        if (!bEnt) continue;
        const bSz = this.getEntityPhysicalSize(bEnt);
        const sPos = Math.max(bSz.length / 2, cursorS - bSz.length / 2);
        const alongFromCenter = sPos - beltLen / 2;
        bEnt.worldPosition = {
          x: conv.geometry.position.x + ux * alongFromCenter,
          y: conv.geometry.dimensions.height,
          z: conv.geometry.position.z + uz * alongFromCenter,
        };
        bEnt.rotationDeg = rotDeg;
        bEnt.conveyorProgress = 1;
        cursorS = sPos - bSz.length / 2 - spacing;
      }
    }

    for (const ws of this.workerStates.values()) {
      if (ws.status === 'walking' && ws.moveEndTime > ws.moveStartTime) {
        const t = Math.max(
          0,
          Math.min(1, (now - ws.moveStartTime) / (ws.moveEndTime - ws.moveStartTime))
        );
        ws.position = {
          x: ws.startPosition.x + (ws.targetPosition.x - ws.startPosition.x) * t,
          y: 0,
          z: ws.startPosition.z + (ws.targetPosition.z - ws.startPosition.z) * t,
        };
      }
    }
  }

  private resumeWaitingSourceIfReady(now: number): void {
    if (this.sourceWaiting?.waiting && !this.sourceTimerScheduled) {
      const interval = resolveArrivalIntervalSec(this.project.simulationConfig);
      const readyAt = Math.max(now, this.sourceWaiting.lastReleaseTime + interval);
      if (readyAt < this.project.simulationConfig.durationSec) {
        this.sourceTimerScheduled = true;
        this.schedule(readyAt, 'ProductCreated', {
          details: 'Resumed unit release after calendar/buffer opened',
          payload: { productId: this.sourceWaiting.productId },
        });
      }
    }
  }

  private processEvent(ev: InternalEvent): void {
    this.clockSec = ev.timestamp;
    this.updateWipIntegral(ev.timestamp);
    this.recordEvent(ev);

    switch (ev.type) {
      case 'ShiftStarted':
      case 'ShiftEnded':
      case 'MachineStopped':
      case 'MachineStarted':
      case 'PlannedMaintenanceStarted':
      case 'PlannedMaintenanceCompleted': {
        this.syncResourcesToCalendar(ev.timestamp);
        if (
          ev.type === 'ShiftStarted' ||
          ev.type === 'MachineStarted' ||
          ev.type === 'PlannedMaintenanceCompleted'
        ) {
          this.tryDispatchAllStages(ev.timestamp);
          this.resumeWaitingSourceIfReady(ev.timestamp);
        }
        break;
      }
      case 'ProductCreated': {
        this.handleProductCreated(ev);
        break;
      }
      case 'ProductArrived': {
        this.handleProductArrived(ev);
        break;
      }
      case 'SetupStarted': {
        this.handleSetupStarted(ev);
        break;
      }
      case 'SetupCompleted': {
        this.handleSetupCompleted(ev);
        break;
      }
      case 'ProcessingStarted': {
        this.handleProcessingStarted(ev);
        break;
      }
      case 'ProcessingCompleted': {
        this.handleProcessingCompleted(ev);
        break;
      }
      case 'ProductTransferred': {
        this.handleProductTransferred(ev);
        break;
      }
      case 'BufferReleased': {
        if (ev.stageId) {
          this.retryBlockedUpstreamForStage(ev.stageId, ev.timestamp);
          this.tryStartStage(ev.stageId, ev.timestamp);
        }
        this.resumeWaitingSourceIfReady(ev.timestamp);
        break;
      }
      case 'BreakdownStarted': {
        this.handleBreakdownStarted(ev);
        break;
      }
      case 'RepairCompleted': {
        this.handleRepairCompleted(ev);
        break;
      }
      case 'WorkerAssigned': {
        if (ev.payload?.walkCompletedOnly === true && ev.workerId) {
          const walkToken = ev.payload?.walkToken as number | undefined;
          if (walkToken !== undefined && !this.validJobTokens.has(walkToken)) break;
          const ws = this.workerStates.get(ev.workerId);
          if (
            ws &&
            ws.status === 'walking' &&
            (!ev.entityId || this.workerAllocatedEntity.get(ev.workerId) === ev.entityId)
          ) {
            ws.position = { ...ws.targetPosition };
            ws.currentStationId = ev.objectId;
            ws.targetStationId = undefined;
            const wDef = this.workersMap.get(ev.workerId);
            const wAvail = wDef
              ? this.calendarEngine.getWorkerAvailabilityAt(wDef, ev.timestamp)
              : { available: true, reason: 'active' as const };
            this.setWorkerStatus(
              ev.workerId,
              wAvail.available ? 'idle' : wAvail.reason === 'break' ? 'break' : 'unavailable',
              ev.timestamp
            );
          }
        }
        break;
      }
      case 'WorkerReleased': {
        if (ev.payload?.earlyRelease === true) {
          const token = ev.payload?.token as number | undefined;
          if (token !== undefined) {
            if (!this.validJobTokens.has(token)) break;
            this.validJobTokens.delete(token);
          }
          const workerIds = (ev.payload?.workerIds as string[]) || [];
          const stageName = (ev.stageId && this.stagesMap.get(ev.stageId)?.name) || ev.stageId || '';
          this.releaseAllocatedWorkers(
            workerIds,
            ev.entityId,
            ev.stageId,
            ev.objectId,
            stageName,
            ev.timestamp,
            false
          );
          this.tryDispatchAllStages(ev.timestamp);
        }
        break;
      }
      default:
        break;
    }
  }

  private pickBestBranchStage(candidateIds: string[]): string | undefined {
    const valid = candidateIds.filter((id) => this.stagesMap.has(id));
    if (valid.length === 0) return undefined;
    if (valid.length === 1) return valid[0];

    let bestId = valid[0];
    let bestScore = Infinity;
    for (const sid of valid) {
      const st = this.stagesMap.get(sid)!;
      const buf = this.stageBuffers.get(sid) || [];
      const inTransit = this.stageInTransitCounts.get(sid) || 0;
      const hasFreeStation = Boolean(this.findAvailableStation(st, undefined, this.clockSec));
      const cap = Math.max(1, st.bufferCapacity);
      const fullness = (buf.length + inTransit) / cap;
      const score = (hasFreeStation ? 0 : 10) + fullness + (buf.length + inTransit) * 0.05;
      if (score < bestScore) {
        bestScore = score;
        bestId = sid;
      }
    }
    return bestId;
  }

  private canAcceptSourceRelease(firstStage: ProductionStage, now: number): boolean {
    if (firstStage.assignedObjectIds.length > 0) {
      return firstStage.assignedObjectIds.some((oid) => {
        const obj = this.objectsMap.get(oid);
        return Boolean(obj && this.calendarEngine.getObjectAvailabilityAt(obj, now).available);
      });
    }
    return (
      this.calendarEngine.isPlantShiftActiveAt(now) &&
      !this.calendarEngine.isPlantOnBreakAt(now)
    );
  }

  private handleProductCreated(ev: InternalEvent): void {
    this.sourceTimerScheduled = false;
    const cfg = this.project.simulationConfig;
    if (ev.timestamp >= cfg.durationSec) {
      this.sourceWaiting = null;
      return;
    }

    const waitingProd =
      this.sourceWaiting?.waiting && this.sourceWaiting.productId
        ? this.productsMap.get(this.sourceWaiting.productId)
        : undefined;
    const product =
      waitingProd &&
      (this.productReleasedCount.get(waitingProd.id) || 0) <
        (this.productTargetQuota.get(waitingProd.id) ?? Infinity)
        ? waitingProd
        : this.selectNextDispatchProduct(false);

    if (!product) {
      this.sourceWaiting = null;
      return;
    }

    const entryCandidates =
      product.routingMode === 'manual'
        ? product.entryStageIds && product.entryStageIds.length > 0
          ? product.entryStageIds
          : product.routeStageIds.slice(0, 1)
        : product.routeStageIds.slice(0, 1);

    const firstStageId = this.pickBestBranchStage(entryCandidates);
    if (!firstStageId) return;
    const firstStage = this.stagesMap.get(firstStageId);
    if (!firstStage) return;

    const firstBuffer = this.stageBuffers.get(firstStageId)!;
    const firstBatchHolder = this.stageBatchHolders.get(firstStageId) || [];
    const firstBatchCfg = this.stageBatchConfigs.get(firstStageId);
    const inTransitToFirst = this.stageInTransitCounts.get(firstStageId) || 0;
    const firstObj = this.objectsMap.get(firstStage.assignedObjectIds[0]);
    const freeFirstStation = this.findAvailableStation(firstStage, product, ev.timestamp);
    const hasFreeFirstSlot =
      Boolean(freeFirstStation) &&
      (firstStage.requiredWorkers <= 0 ||
        Boolean(
          freeFirstStation &&
            this.findAvailableWorkers(firstStage, freeFirstStation, firstStage.requiredWorkers, ev.timestamp)
        ));
    const entryConveyorFull =
      firstObj?.kind === 'conveyor' &&
      (this.conveyorOccupancy.get(firstObj.id) || 0) >=
        this.getConveyorPhysicalCapacity(firstObj, product);

    const firstStagingAllowance =
      firstBatchCfg?.batchMode === 'collect_batch' ? firstBatchCfg.batchSize : 1;

    if (
      !canAdmitToStageBuffer(
        firstStage,
        firstBuffer.length + firstBatchHolder.length,
        inTransitToFirst,
        hasFreeFirstSlot,
        firstStagingAllowance
      ) ||
      entryConveyorFull
    ) {
      this.sourceWaiting = {
        waiting: true,
        productId: product.id,
        lastReleaseTime: this.lastSourceReleaseTime,
      };
      return;
    }

    if (this.canAcceptSourceRelease(firstStage, ev.timestamp)) {
      if ((cfg.dispatchingRule ?? 'weighted_mix') === 'round_robin') {
        this.selectNextDispatchProduct(true);
      }
      this.sourceWaiting = null;
      this.lastSourceReleaseTime = ev.timestamp;
      this.entityCounter++;
      this.totalArrived++;
      this.productReleasedCount.set(
        product.id,
        (this.productReleasedCount.get(product.id) || 0) + 1
      );
      const entId = `unit_${this.entityCounter}`;
      const convObj =
        firstObj?.kind === 'conveyor'
          ? firstObj
          : firstStage.conveyorObjectId
          ? this.objectsMap.get(firstStage.conveyorObjectId)
          : undefined;
      let startPos: Vec3 = firstObj
        ? {
            x: firstObj.geometry.position.x - firstObj.geometry.dimensions.length / 2,
            y: firstObj.geometry.dimensions.height,
            z: firstObj.geometry.position.z,
          }
        : { x: 0, y: 0, z: 0 };
      if (convObj && convObj.kind === 'conveyor') {
        const rad = (convObj.geometry.rotationDeg * Math.PI) / 180;
        const dir = convObj.operations.direction === -1 ? -1 : 1;
        const halfL = Math.max(0.05, convObj.geometry.dimensions.length / 2 - 0.15);
        startPos = {
          x: convObj.geometry.position.x - Math.cos(rad) * dir * halfL,
          y: convObj.geometry.dimensions.height,
          z: convObj.geometry.position.z - Math.sin(rad) * dir * halfL,
        };
      }

      const entity: ProductEntityState = {
        id: entId,
        productId: product.id,
        serialNumber: this.entityCounter,
        createdAt: ev.timestamp,
        scrapped: false,
        reworkCount: 0,
        currentStageId: firstStageId,
        routeStepIndex: 0,
        locationKind: 'source',
        worldPosition: startPos,
        waitingTimeSec: 0,
        batchQueueWaitTimeSec: 0,
        processingTimeSec: 0,
        transportTimeSec: 0,
        batchCount: 1,
      };
      this.entities.set(entId, entity);
      this.activeEntities.set(entId, entity);

      this.schedule(ev.timestamp, 'ProductArrived', {
        entityId: entId,
        stageId: firstStageId,
        details: `Unit #${this.entityCounter} (${product.code}) arrived at ${firstStage.name}`,
      });
    } else {
      this.sourceWaiting = {
        waiting: true,
        productId: product.id,
        lastReleaseTime: this.lastSourceReleaseTime,
      };
      return;
    }

    const nextInterval = resolveArrivalIntervalSec(cfg);
    if (
      ev.timestamp + nextInterval < cfg.durationSec &&
      !this.sourceTimerScheduled &&
      this.getActiveDispatchableProducts().length > 0
    ) {
      this.sourceTimerScheduled = true;
      this.schedule(ev.timestamp + nextInterval, 'ProductCreated', {
        details: 'Next raw material unit release',
      });
    }
  }

  private assembleBatchCarrier(
    stageId: string,
    items: HeldBatchItem[],
    batchCfg: StageBatchConfig,
    now: number
  ): void {
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId);
    const acc = this.stageAcc.get(stageId);
    if (!stage || !buf || !acc || items.length === 0) return;

    this.updateQueueIntegral(stageId, now);

    let totalUnits = 0;
    let weightedCreated = 0;
    let weightedWait = 0;
    let weightedProc = 0;
    let weightedTrans = 0;
    let firstChild: ProductEntityState | undefined;

    for (const item of items) {
      const cEnt = this.entities.get(item.entityId);
      if (!cEnt) continue;
      if (!firstChild) firstChild = cEnt;
      const u = item.units;
      const stagingWait = Math.max(0, now - item.arrivedAt);
      acc.waitTimeSum += stagingWait * u;
      totalUnits += u;
      weightedCreated += cEnt.createdAt * u;
      weightedWait += (cEnt.waitingTimeSec + stagingWait) * u;
      weightedProc += cEnt.processingTimeSec * u;
      weightedTrans += cEnt.transportTimeSec * u;
    }

    if (!firstChild || totalUnits === 0) return;

    const prefix =
      batchCfg.containerKind === 'pallet'
        ? 'PAL'
        : batchCfg.containerKind === 'pack'
        ? 'PAK'
        : 'CTN';

    this.entityCounter++;
    const carrierId = `batch_${this.entityCounter}`;
    const stationObj = this.objectsMap.get(stage.assignedObjectIds[0]);
    const carrier: ProductEntityState = {
      id: carrierId,
      productId: firstChild.productId,
      serialNumber: this.entityCounter,
      createdAt: weightedCreated / totalUnits,
      scrapped: false,
      reworkCount: 0,
      currentStageId: stageId,
      routeStepIndex: firstChild.routeStepIndex ?? 0,
      locationKind: 'buffer',
      worldPosition: stationObj
        ? {
            x: stationObj.geometry.position.x - 0.5,
            y: stationObj.geometry.dimensions.height + 0.05,
            z: stationObj.geometry.position.z,
          }
        : { ...firstChild.worldPosition },
      waitingTimeSec: weightedWait / totalUnits,
      processingTimeSec: weightedProc / totalUnits,
      transportTimeSec: weightedTrans / totalUnits,
      batchCount: totalUnits,
      isBatchCarrier: true,
      containerKind: batchCfg.containerKind,
      batchLabel: `${prefix}×${totalUnits}`,
    };

    for (const item of items) {
      const cEnt = this.entities.get(item.entityId);
      if (cEnt) {
        cEnt.absorbedIntoEntityId = carrierId;
        this.activeEntities.delete(cEnt.id);
      }
    }

    this.entities.set(carrierId, carrier);
    this.activeEntities.set(carrierId, carrier);
    buf.push(carrierId);
    this.repositionStageQueue(stageId);
    acc.waitingEnterTimes.set(carrierId, now);
    acc.stageEnterTimes.set(carrierId, now);
    this.tryStartStage(stageId, now);
  }

  private tryFlushPartialBatchesIfExhausted(now: number): void {
    const sourceDone =
      !this.calendarEngine.isPlantShiftActiveAt(now) ||
      this.getActiveDispatchableProducts().length === 0;
    if (!sourceDone) return;

    for (const stage of this.project.stages) {
      const holder = this.stageBatchHolders.get(stage.id);
      const batchCfg = this.stageBatchConfigs.get(stage.id);
      if (!holder || holder.length === 0 || !batchCfg || batchCfg.batchMode !== 'collect_batch') {
        continue;
      }

      const upstreamSet = this.stageUpstreamClosures.get(stage.id);
      const hasInTransitToStage = (this.stageInTransitCounts.get(stage.id) || 0) > 0;
      if (hasInTransitToStage) continue;

      let upstreamBusy = false;
      if (upstreamSet && upstreamSet.size > 0) {
        for (const ent of this.activeEntities.values()) {
          if (!ent.scrapped && ent.completedAt === undefined && !ent.absorbedIntoEntityId) {
            if (ent.currentStageId && upstreamSet.has(ent.currentStageId)) {
              upstreamBusy = true;
              break;
            }
          }
        }
        if (!upstreamBusy) {
          for (const tr of this.conveyorTransits.values()) {
            if (tr.toStageId === stage.id || upstreamSet.has(tr.toStageId) || upstreamSet.has(tr.fromStageId)) {
              upstreamBusy = true;
              break;
            }
          }
        }
      }
      if (upstreamBusy) continue;

      // Flush remaining held items grouped strictly by productId so distinct SKUs never mix
      const byProduct = new Map<string, HeldBatchItem[]>();
      const allPopped = holder.splice(0, holder.length);
      for (const item of allPopped) {
        const list = byProduct.get(item.productId) || [];
        list.push(item);
        byProduct.set(item.productId, list);
      }
      for (const group of byProduct.values()) {
        this.assembleBatchCarrier(stage.id, group, batchCfg, now);
      }
    }
  }

  private handleProductArrived(ev: InternalEvent): void {
    const entId = ev.entityId;
    const stageId = ev.stageId;
    if (!entId || !stageId) return;
    const ent = this.entities.get(entId);
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId);
    const acc = this.stageAcc.get(stageId);
    if (!ent || !stage || !buf || !acc) return;

    this.updateQueueIntegral(stageId, ev.timestamp);

    const incomingUnits = Math.max(1, ent.batchCount ?? 1);
    const batchCfg = this.stageBatchConfigs.get(stageId);
    const stationObj = this.objectsMap.get(stage.assignedObjectIds[0]);

    ent.currentStageId = stageId;
    ent.locationKind = 'buffer';

    const isReworkLoop = acc.stageEnterTimes.has(entId);
    if (!isReworkLoop) {
      acc.entered += incomingUnits;
    }

    if (!isReworkLoop && batchCfg?.batchMode === 'unbatch' && incomingUnits > 1) {
      ent.absorbedIntoEntityId = `${entId}_unbatched`;
      this.activeEntities.delete(entId);
      for (let i = 0; i < incomingUnits; i++) {
        this.entityCounter++;
        const childId = `unit_${this.entityCounter}`;
        const child: ProductEntityState = {
          id: childId,
          productId: ent.productId,
          serialNumber: this.entityCounter,
          createdAt: ent.createdAt,
          scrapped: false,
          reworkCount: 0,
          currentStageId: stageId,
          routeStepIndex: ent.routeStepIndex ?? 0,
          locationKind: 'buffer',
          worldPosition: stationObj
            ? {
                x: stationObj.geometry.position.x - 0.65 + (i % 3) * 0.28,
                y: stationObj.geometry.dimensions.height + 0.05,
                z: stationObj.geometry.position.z + (i >= 3 ? 0.25 : -0.25),
              }
            : { ...ent.worldPosition },
          waitingTimeSec: ent.waitingTimeSec,
          batchQueueWaitTimeSec: ent.batchQueueWaitTimeSec ?? 0,
          processingTimeSec: ent.processingTimeSec,
          transportTimeSec: ent.transportTimeSec,
          batchCount: 1,
        };
        this.entities.set(childId, child);
        this.activeEntities.set(childId, child);
        buf.push(childId);
        acc.waitingEnterTimes.set(childId, ev.timestamp);
        acc.stageEnterTimes.set(childId, ev.timestamp);
      }
      this.repositionStageQueue(stageId);
      this.tryStartStage(stageId, ev.timestamp);
      return;
    }

    if (
      !isReworkLoop &&
      batchCfg?.batchMode === 'collect_batch' &&
      batchCfg.batchSize > 1 &&
      incomingUnits < batchCfg.batchSize
    ) {
      const holder = this.stageBatchHolders.get(stageId)!;
      holder.push({
        entityId: entId,
        productId: ent.productId,
        arrivedAt: ev.timestamp,
        units: incomingUnits,
      });
      this.repositionStageQueue(stageId);

      // Group strictly by ent.productId so different SKUs are never fused into one batch
      let sameProdUnits = 0;
      for (const h of holder) {
        if (h.productId === ent.productId) sameProdUnits += h.units;
      }
      while (sameProdUnits >= batchCfg.batchSize) {
        const picked: HeldBatchItem[] = [];
        let pickedUnits = 0;
        for (let hi = 0; hi < holder.length && pickedUnits < batchCfg.batchSize; ) {
          if (holder[hi].productId === ent.productId) {
            const [item] = holder.splice(hi, 1);
            picked.push(item);
            pickedUnits += item.units;
          } else {
            hi++;
          }
        }
        sameProdUnits -= pickedUnits;
        this.assembleBatchCarrier(stageId, picked, batchCfg, ev.timestamp);
      }

      if (holder.length > 0) {
        this.tryFlushPartialBatchesIfExhausted(ev.timestamp);
      }
      this.repositionStageQueue(stageId);
      return;
    }

    buf.push(entId);
    acc.waitingEnterTimes.set(entId, ev.timestamp);
    if (!acc.stageEnterTimes.has(entId)) {
      acc.stageEnterTimes.set(entId, ev.timestamp);
    }

    this.repositionStageQueue(stageId);
    this.tryStartStage(stageId, ev.timestamp);
  }

  private findAvailableStation(
    stage: ProductionStage,
    prod?: ProductDefinition,
    now = this.clockSec,
    ent?: ProductEntityState
  ): LayoutObject | undefined {
    const seen = new Set<string>();
    const uniqueObjs: LayoutObject[] = [];
    for (const objId of stage.assignedObjectIds) {
      if (seen.has(objId)) continue;
      seen.add(objId);
      const obj = this.objectsMap.get(objId);
      if (obj) uniqueObjs.push(obj);
    }

    const processingServers = uniqueObjs.filter(
      (o) => o.kind === 'machine' || o.kind === 'workstation'
    );
    const conveyorNodes = uniqueObjs.filter((o) => o.kind === 'conveyor');
    const candidates =
      processingServers.length > 0
        ? processingServers
        : conveyorNodes.length > 0
        ? conveyorNodes
        : uniqueObjs.filter((o) => o.kind !== 'storage' && o.kind !== 'vehicle');

    const eligible: Array<{
      obj: LayoutObject;
      loadRatio: number;
      serverCycle: number;
      processedCount: number;
      runningTime: number;
      idx: number;
    }> = [];

    for (let idx = 0; idx < candidates.length; idx++) {
      const obj = candidates[idx];
      const st = this.objectStates.get(obj.id);
      if (!st) continue;
      if (st.status === 'down' || st.status === 'blocked' || st.status === 'maintenance') continue;
      const fp = resolveObjectFailureParams(obj, this.project.simulationConfig);
      if (fp.enabled && fp.availability <= 0) continue;
      const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);
      if (!avail.available) continue;

      const cap =
        obj.kind === 'conveyor'
          ? this.getConveyorPhysicalCapacity(obj, prod, ent)
          : Math.max(1, obj.operations.capacity);
      if (cap <= 0) continue;
      if (st.busyUnitIds.length < cap) {
        const serverCycle =
          obj.kind === 'conveyor'
            ? computeConveyorMetrics(obj, prod).traversalTimeSec
            : computeStageProcessingTimeSec(stage, obj, [], false, prod, uniqueObjs);
        const runningTime = this.stateTracker.getMachineTotals(obj.id, now).running;
        eligible.push({
          obj,
          loadRatio: st.busyUnitIds.length / cap,
          serverCycle,
          processedCount: st.processedCount,
          runningTime,
          idx,
        });
      }
    }

    if (eligible.length === 0) return undefined;
    eligible.sort((a, b) => {
      if (Math.abs(a.loadRatio - b.loadRatio) > 1e-9) return a.loadRatio - b.loadRatio;
      if (Math.abs(a.serverCycle - b.serverCycle) > 1e-9) return a.serverCycle - b.serverCycle;
      if (a.processedCount !== b.processedCount) return a.processedCount - b.processedCount;
      if (Math.abs(a.runningTime - b.runningTime) > 1e-9) return a.runningTime - b.runningTime;
      return a.idx - b.idx;
    });
    return eligible[0].obj;
  }

  private findAvailableWorkers(
    stage: ProductionStage,
    stationObj: LayoutObject,
    count: number,
    now = this.clockSec
  ): WorkerDefinition[] | null {
    if (count <= 0) return [];
    const candidates: Array<{ worker: WorkerDefinition; dist: number; directMatch: boolean }> = [];

    for (const w of this.project.workers) {
      const ws = this.workerStates.get(w.id);
      if (!ws || ws.status !== 'idle') continue;
      if (this.workerAllocatedEntity.get(w.id) !== null) continue;
      if (!this.calendarEngine.getWorkerAvailabilityAt(w, now).available) continue;

      const assignedTargetId = w.assignedTo || w.assignedStationId;
      const assignedToStage =
        w.assignedStageIds.includes(stage.id) || assignedTargetId === stationObj.id;
      if (!assignedToStage) continue;

      const dist = distance2D(ws.position, stationObj.geometry.position);
      candidates.push({ worker: w, dist, directMatch: assignedTargetId === stationObj.id });
    }

    if (candidates.length < count) return null;
    candidates.sort((a, b) => {
      if (a.directMatch !== b.directMatch) return a.directMatch ? -1 : 1;
      return a.dist - b.dist;
    });
    return candidates.slice(0, count).map((c) => c.worker);
  }

  private tryDispatchAllStages(now: number): void {
    for (const st of this.project.stages) {
      this.tryStartStage(st.id, now);
    }
  }

  private tryStartStage(stageId: string, now: number): void {
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId);
    const acc = this.stageAcc.get(stageId);
    if (!stage || !buf || !acc || buf.length === 0) return;

    const stageAssignedObjs = stage.assignedObjectIds
      .map((oid) => this.objectsMap.get(oid))
      .filter((o): o is LayoutObject => Boolean(o));

    while (buf.length > 0) {
      const nextEnt = this.entities.get(buf[0]);
      const nextProd = nextEnt ? this.productsMap.get(nextEnt.productId) : undefined;
      const stationObj = this.findAvailableStation(stage, nextProd, now, nextEnt);
      if (!stationObj) break;

      const hasConveyorWork =
        stationObj.kind === 'conveyor' &&
        (stage.requiredWorkers > 0 ||
          (stage.processingTimeSec || 0) > 0 ||
          (stage.loadingTimeSec || 0) > 0 ||
          (stage.unloadingTimeSec || 0) > 0);
      const neededWorkers =
        stationObj.kind === 'conveyor' && !hasConveyorWork
          ? 0
          : Math.max(0, stage.requiredWorkers);
      const chosenWorkers = this.findAvailableWorkers(stage, stationObj, neededWorkers, now);
      if (!chosenWorkers) break;

      this.updateQueueIntegral(stageId, now);
      const entId = buf.shift()!;
      const ent = this.entities.get(entId);
      if (!ent) {
        this.repositionStageQueue(stageId);
        continue;
      }
      this.repositionStageQueue(stageId);

      const waitStart = acc.waitingEnterTimes.get(entId);
      const unitCount = Math.max(1, ent.batchCount ?? 1);
      if (waitStart !== undefined) {
        const waitDt = Math.max(0, now - waitStart);
        ent.waitingTimeSec += waitDt;
        ent.batchQueueWaitTimeSec = (ent.batchQueueWaitTimeSec || 0) + waitDt;
        acc.waitTimeSum += waitDt * unitCount;
        acc.queueWaitTimeSum += waitDt * unitCount;
        acc.batchWaitTimeSum += waitDt;
        acc.batchWaitCount += 1;
        acc.waitingEnterTimes.delete(entId);
      }

      const stState = this.objectStates.get(stationObj.id)!;
      stState.busyUnitIds.push(entId);

      // Conveyor Flowchart Node: animate product gliding across the conveyor belt (+ optional manual work/workers on belt)
      if (stationObj.kind === 'conveyor') {
        const needsSetup =
          hasConveyorWork &&
          !this.setupDoneObjects.has(stationObj.id) &&
          (stage.setupTimeSec || 0) > 0;
        if (needsSetup) this.setupDoneObjects.add(stationObj.id);
        const convWorkSec = hasConveyorWork
          ? computeStageProcessingTimeSec(stage, stationObj, chosenWorkers, needsSetup, nextProd, stageAssignedObjs)
          : 0;
        const activeWorkers = convWorkSec > 0 ? chosenWorkers : [];

        const rad = (stationObj.geometry.rotationDeg * Math.PI) / 180;
        const dir = stationObj.operations.direction === -1 ? -1 : 1;
        const ux = Math.cos(rad) * dir;
        const uz = Math.sin(rad) * dir;
        const prod = this.productsMap.get(ent.productId);
        const carrierLen =
          ent.isBatchCarrier && ent.containerKind === 'pallet'
            ? Math.max(1.0, prod?.dimensions.length || 0.75)
            : undefined;
        const convMetrics = computeConveyorMetrics(stationObj, prod, carrierLen);
        const beltLen = convMetrics.beltLengthM;
        const speed = convMetrics.speedMps;
        const beltTime = convMetrics.traversalTimeSec;
        const totalConvNodeSec = beltTime + convWorkSec;
        const minGapSec = convMetrics.minHeadwaySec;
        const halfL = beltLen / 2;
        const pEntry: Vec3 = {
          x: stationObj.geometry.position.x - ux * halfL,
          y: stationObj.geometry.dimensions.height,
          z: stationObj.geometry.position.z - uz * halfL,
        };
        const pExit: Vec3 = {
          x: stationObj.geometry.position.x + ux * halfL,
          y: stationObj.geometry.dimensions.height,
          z: stationObj.geometry.position.z + uz * halfL,
        };

        let maxWalkTime = 0;
        const workerIds: string[] = [];
        const walkByWorker = new Map<string, number>();
        const walkEndByWorker = new Map<string, number>();
        const walkRemainingByWorker = new Map<string, number>();
        for (const w of activeWorkers) {
          workerIds.push(w.id);
          this.workerAllocatedEntity.set(w.id, entId);
          const ws = this.workerStates.get(w.id)!;
          const { walkTimeSec, targetPos } = computeWorkerTravelAudit(
            w,
            ws.position,
            ws.currentStationId,
            stationObj
          );
          walkByWorker.set(w.id, walkTimeSec);
          walkEndByWorker.set(w.id, now + walkTimeSec);
          walkRemainingByWorker.set(w.id, walkTimeSec);
          if (walkTimeSec > maxWalkTime) maxWalkTime = walkTimeSec;

          if (walkTimeSec > 0) {
            ws.startPosition = { ...ws.position };
            ws.targetPosition = targetPos;
            ws.moveStartTime = now;
            ws.moveEndTime = now + walkTimeSec;
            ws.targetStationId = stationObj.id;
            this.setWorkerStatus(w.id, 'walking', now);
          } else {
            ws.targetPosition = { ...ws.position };
            ws.currentStationId = stationObj.id;
          }

          this.schedule(now, 'WorkerAssigned', {
            entityId: entId,
            stageId,
            objectId: stationObj.id,
            workerId: w.id,
            details: `${w.label} assigned to conveyor stage ${stage.name}${walkTimeSec > 0 ? ` (walk ${walkTimeSec.toFixed(1)}s)` : ''}`,
          });
        }

        const lastEntry = this.conveyorLastEntryTime.get(stationObj.id) ?? -Infinity;
        const earliestEntry = Math.max(now, lastEntry + minGapSec);
        const entryAx = this.getConveyorAxisMetrics(stationObj, pEntry);
        const mergeClearDelay = this.computeConveyorEntryDelay(
          stationObj,
          entryAx.sBelt,
          entryAx.perpBelt,
          ent,
          earliestEntry
        );
        const entryDelay = Math.max(0, earliestEntry + mergeClearDelay - now);
        const dispatchDelay = Math.max(entryDelay, maxWalkTime);
        this.conveyorLastEntryTime.set(stationObj.id, now + dispatchDelay);

        let walkToken: number | undefined;
        if (dispatchDelay > 1e-6) {
          walkToken = ++this.jobTokenCounter;
          this.validJobTokens.add(walkToken);
          const pendingList = this.pendingWalkJobs.get(stationObj.id) || [];
          pendingList.push({
            token: walkToken,
            entityId: entId,
            stageId,
            objectId: stationObj.id,
            workerIds,
            walkEndByWorker,
            walkRemainingByWorker,
            phase: 'processing',
            setupDuration: 0,
            procDuration: totalConvNodeSec,
            isConveyorNode: true,
            workDurationSec: convWorkSec,
            dispatchDelaySec: dispatchDelay,
            startAt: now + dispatchDelay,
          });
          this.pendingWalkJobs.set(stationObj.id, pendingList);
        }

        for (const w of activeWorkers) {
          const wt = walkByWorker.get(w.id) ?? 0;
          if (wt > 0 && wt < dispatchDelay - 1e-6) {
            this.schedule(now + wt, 'WorkerAssigned', {
              entityId: entId,
              stageId,
              objectId: stationObj.id,
              workerId: w.id,
              details: `${w.label} arrived at conveyor`,
              payload: { walkCompletedOnly: true, silent: true, walkToken },
            });
          } else if (wt <= 0 && dispatchDelay <= 1e-6) {
            this.setWorkerStatus(w.id, 'busy', now);
          }
        }

        // Only set conveyor moving immediately if zero walk/entry dispatch delay and already starting at now
        if (dispatchDelay <= 1e-6) {
          this.setObjectStatus(stationObj.id, 'running', now);
        } else if ((this.activeJobs.get(stationObj.id)?.length || 0) === 0) {
          this.setObjectStatus(stationObj.id, 'idle', now);
        }

        const startAt = now + dispatchDelay;
        const endAt = startAt + totalConvNodeSec;
        ent.locationKind = 'conveyor';
        ent.currentObjectId = stationObj.id;
        ent.worldPosition = { ...pEntry };
        ent.rotationDeg = (Math.atan2(uz, ux) * 180) / Math.PI;
        ent.transportTimeSec += beltTime + dispatchDelay;
        acc.conveyorTransitTimeSum += beltTime * unitCount;

        const pathLen = Math.max(0.05, 2 * halfL);
        this.conveyorOccupancy.set(stationObj.id, (this.conveyorOccupancy.get(stationObj.id) || 0) + 1);
        this.conveyorTransits.set(entId, {
          entityId: entId,
          conveyorId: stationObj.id,
          fromStageId: stageId,
          toStageId: stageId,
          startTime: startAt,
          endTime: endAt,
          waypoints: [pEntry, pExit],
          cumLengths: [0, pathLen],
          totalLength: pathLen,
        });

        this.schedule(startAt, 'ProcessingStarted', {
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          details: `${stationObj.name} conveying ${entId} (${beltLen.toFixed(1)}m @ ${speed} m/s = ${beltTime.toFixed(1)}s${convWorkSec > 0 ? ` + work ${convWorkSec.toFixed(1)}s` : ''})`,
          payload: {
            walkToken,
            workerIds,
            procDuration: totalConvNodeSec,
            workDuration: convWorkSec,
            isConveyorNode: true,
          },
        });
        this.schedule(now, 'BufferReleased', {
          stageId,
          details: `Queue slot freed at ${stage.name}`,
        });
        continue;
      }

      ent.locationKind = 'station';
      ent.currentObjectId = stationObj.id;
      this.positionStationActiveUnits(stationObj.id);

      let maxWalkTime = 0;
      const workerIds: string[] = [];
      const walkByWorker = new Map<string, number>();
      const walkEndByWorker = new Map<string, number>();
      const walkRemainingByWorker = new Map<string, number>();

      for (const w of chosenWorkers) {
        workerIds.push(w.id);
        this.workerAllocatedEntity.set(w.id, entId);
        const ws = this.workerStates.get(w.id)!;
        const { walkTimeSec, targetPos } = computeWorkerTravelAudit(
          w,
          ws.position,
          ws.currentStationId,
          stationObj
        );
        walkByWorker.set(w.id, walkTimeSec);
        walkEndByWorker.set(w.id, now + walkTimeSec);
        walkRemainingByWorker.set(w.id, walkTimeSec);
        if (walkTimeSec > maxWalkTime) maxWalkTime = walkTimeSec;

        if (walkTimeSec > 0) {
          ws.startPosition = { ...ws.position };
          ws.targetPosition = targetPos;
          ws.moveStartTime = now;
          ws.moveEndTime = now + walkTimeSec;
          ws.targetStationId = stationObj.id;
          this.setWorkerStatus(w.id, 'walking', now);
        } else {
          ws.targetPosition = { ...ws.position };
          ws.currentStationId = stationObj.id;
        }

        this.schedule(now, 'WorkerAssigned', {
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          workerId: w.id,
          details: `${w.label} assigned to ${stage.name}${walkTimeSec > 0 ? ` (walk ${walkTimeSec.toFixed(1)}s)` : ''}`,
        });
      }

      const needsSetup = !this.setupDoneObjects.has(stationObj.id) && (stage.setupTimeSec || 0) > 0;
      if (needsSetup) this.setupDoneObjects.add(stationObj.id);
      const setupSec = needsSetup ? computeStageSetupDurationSec(stage, stationObj, chosenWorkers, stageAssignedObjs) : 0;
      const procBase = computeStageProcessingTimeSec(stage, stationObj, chosenWorkers, false, nextProd, stageAssignedObjs);
      const startAt = now + maxWalkTime;

      let walkToken: number | undefined;
      if (maxWalkTime > 1e-6) {
        walkToken = ++this.jobTokenCounter;
        this.validJobTokens.add(walkToken);
        const pendingList = this.pendingWalkJobs.get(stationObj.id) || [];
        pendingList.push({
          token: walkToken,
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          workerIds,
          walkEndByWorker,
          walkRemainingByWorker,
          phase: setupSec > 0 ? 'setup' : 'processing',
          setupDuration: setupSec,
          procDuration: procBase,
          isConveyorNode: false,
          dispatchDelaySec: maxWalkTime,
          startAt,
        });
        this.pendingWalkJobs.set(stationObj.id, pendingList);
      }

      for (const w of chosenWorkers) {
        const wt = walkByWorker.get(w.id) ?? 0;
        if (wt > 0 && wt < maxWalkTime - 1e-6) {
          this.schedule(now + wt, 'WorkerAssigned', {
            entityId: entId,
            stageId,
            objectId: stationObj.id,
            workerId: w.id,
            details: `${w.label} arrived at ${stage.name}`,
            payload: { walkCompletedOnly: true, silent: true, walkToken },
          });
        } else if (wt <= 0 && maxWalkTime <= 1e-6) {
          this.setWorkerStatus(w.id, 'busy', now);
        }
      }

      if (setupSec > 0) {
        // Machine transitions to 'setup' ONLY at startAt when worker arrives (or immediately if walk == 0)
        if (maxWalkTime <= 1e-6) {
          this.setObjectStatus(stationObj.id, 'setup', now);
        } else if ((this.activeJobs.get(stationObj.id)?.length || 0) === 0) {
          this.setObjectStatus(stationObj.id, 'idle', now);
        }
        this.schedule(startAt, 'SetupStarted', {
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          details: `${stationObj.name} setup started (${setupSec.toFixed(1)}s) for ${entId}`,
          payload: { walkToken, workerIds, setupDuration: setupSec, procDuration: procBase },
        });
      } else {
        // Machine transitions to 'running' ONLY at startAt when worker arrives (or immediately if walk == 0)
        if (maxWalkTime <= 1e-6) {
          this.setObjectStatus(stationObj.id, 'running', now);
        } else if ((this.activeJobs.get(stationObj.id)?.length || 0) === 0) {
          this.setObjectStatus(stationObj.id, 'idle', now);
        }
        this.schedule(startAt, 'ProcessingStarted', {
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          details: `${stationObj.name} started processing ${entId}`,
          payload: { walkToken, workerIds, procDuration: procBase },
        });
      }

      this.schedule(now, 'BufferReleased', {
        stageId,
        details: `Queue slot freed at ${stage.name}`,
      });
    }
  }

  private handleSetupStarted(ev: InternalEvent): void {
    const objId = ev.objectId;
    const stageId = ev.stageId;
    const entityId = ev.entityId;
    if (!objId || !stageId || !entityId) return;

    const walkToken = ev.payload?.walkToken as number | undefined;
    if (walkToken !== undefined) {
      if (!this.validJobTokens.has(walkToken)) return;
      this.validJobTokens.delete(walkToken);
      const pending = this.pendingWalkJobs.get(objId) || [];
      this.pendingWalkJobs.set(
        objId,
        pending.filter((pj) => pj.token !== walkToken)
      );
    }

    const workerIds = (ev.payload?.workerIds as string[]) || [];
    const setupDuration = Math.max(0, Number(ev.payload?.setupDuration ?? 0));
    const procDuration = Math.max(0, Number(ev.payload?.procDuration ?? 0));

    const obj = this.objectsMap.get(objId);
    const stState = this.objectStates.get(objId);
    const objAvail = obj
      ? this.calendarEngine.getObjectAvailabilityAt(obj, ev.timestamp)
      : { available: true, reason: 'active' as const };
    const workersOk = this.areAllWorkersAvailable(workerIds, ev.timestamp);

    const token = ++this.jobTokenCounter;
    this.validJobTokens.add(token);
    const job: ActiveJobRecord = {
      token,
      phase: 'setup',
      entityId,
      stageId,
      objectId: objId,
      workerIds,
      startedAt: ev.timestamp,
      expectedEndAt: ev.timestamp + setupDuration,
      remainingSec: setupDuration,
      totalProcSec: procDuration,
      isConveyorNode: false,
    };

    if (
      (stState && (stState.status === 'down' || stState.status === 'maintenance')) ||
      !objAvail.available ||
      !workersOk
    ) {
      for (const wid of workerIds) {
        const ws = this.workerStates.get(wid);
        const wDef = this.workersMap.get(wid);
        if (ws && wDef) {
          ws.position = { ...ws.targetPosition };
          ws.currentStationId = objId;
          const wa = this.calendarEngine.getWorkerAvailabilityAt(wDef, ev.timestamp);
          this.setWorkerStatus(
            wid,
            wa.available ? 'idle' : wa.reason === 'break' ? 'break' : 'unavailable',
            ev.timestamp
          );
        }
      }
      const paused = this.pausedJobs.get(objId) || [];
      paused.push(job);
      this.pausedJobs.set(objId, paused);
      return;
    }

    for (const wid of workerIds) {
      const ws = this.workerStates.get(wid);
      if (ws) {
        ws.position = { ...ws.targetPosition };
        ws.currentStationId = objId;
        this.setWorkerStatus(wid, 'busy', ev.timestamp);
      }
    }

    this.setObjectStatus(objId, 'setup', ev.timestamp);

    const list = this.activeJobs.get(objId) || [];
    list.push(job);
    this.activeJobs.set(objId, list);

    this.schedule(ev.timestamp + setupDuration, 'SetupCompleted', {
      entityId,
      stageId,
      objectId: objId,
      details: `${objId} setup completed (${setupDuration.toFixed(1)}s)`,
      payload: { token, workerIds, procDuration, setupDuration },
    });
  }

  private handleSetupCompleted(ev: InternalEvent): void {
    const token = ev.payload?.token as number | undefined;
    if (token !== undefined) {
      if (!this.validJobTokens.has(token)) return;
      this.validJobTokens.delete(token);
    }
    if (ev.objectId && token !== undefined) {
      const list = this.activeJobs.get(ev.objectId) || [];
      this.activeJobs.set(
        ev.objectId,
        list.filter((j) => j.token !== token)
      );
    }

    const workerIds = (ev.payload?.workerIds as string[]) || [];
    const procDuration = Math.max(0, Number(ev.payload?.procDuration ?? 0));

    this.schedule(ev.timestamp, 'ProcessingStarted', {
      entityId: ev.entityId,
      stageId: ev.stageId,
      objectId: ev.objectId,
      details: `${ev.objectId} started processing ${ev.entityId}`,
      payload: { workerIds, procDuration },
    });
  }

  private handleProcessingStarted(ev: InternalEvent): void {
    const objId = ev.objectId;
    const walkToken = ev.payload?.walkToken as number | undefined;
    if (walkToken !== undefined && objId) {
      if (!this.validJobTokens.has(walkToken)) return;
      this.validJobTokens.delete(walkToken);
      const pending = this.pendingWalkJobs.get(objId) || [];
      this.pendingWalkJobs.set(
        objId,
        pending.filter((pj) => pj.token !== walkToken)
      );
    }

    const workerIds = (ev.payload?.workerIds as string[]) || [];
    const procDuration = Math.max(0, Number(ev.payload?.procDuration ?? 0));
    const isConveyorNode = Boolean(ev.payload?.isConveyorNode);
    const workDuration = Math.max(0, Number(ev.payload?.workDuration ?? procDuration));

    const obj = objId ? this.objectsMap.get(objId) : undefined;
    const stState = objId ? this.objectStates.get(objId) : undefined;
    const objAvail = obj
      ? this.calendarEngine.getObjectAvailabilityAt(obj, ev.timestamp)
      : { available: true, reason: 'active' as const };
    const workersOk = this.areAllWorkersAvailable(workerIds, ev.timestamp);

    const token = ++this.jobTokenCounter;
    this.validJobTokens.add(token);

    let completionWorkerIds = workerIds;
    let workerReleaseToken: number | undefined;
    const hasEarlyConveyorRelease =
      isConveyorNode && workerIds.length > 0 && workDuration < procDuration - 1e-6;

    if (hasEarlyConveyorRelease) {
      workerReleaseToken = ++this.jobTokenCounter;
      this.validJobTokens.add(workerReleaseToken);
      completionWorkerIds = [];
    }

    if (objId && ev.entityId && ev.stageId) {
      const job: ActiveJobRecord = {
        token,
        phase: 'processing',
        entityId: ev.entityId,
        stageId: ev.stageId,
        objectId: objId,
        workerIds,
        startedAt: ev.timestamp,
        expectedEndAt: ev.timestamp + procDuration,
        remainingSec: procDuration,
        totalProcSec: procDuration,
        isConveyorNode,
        ...(isConveyorNode ? { workDurationSec: workDuration, workerReleaseToken } : {}),
      };
      if (
        (stState && (stState.status === 'down' || stState.status === 'maintenance')) ||
        !objAvail.available ||
        !workersOk
      ) {
        for (const wid of workerIds) {
          const ws = this.workerStates.get(wid);
          const wDef = this.workersMap.get(wid);
          if (ws && wDef) {
            ws.position = { ...ws.targetPosition };
            ws.currentStationId = objId;
            const wa = this.calendarEngine.getWorkerAvailabilityAt(wDef, ev.timestamp);
            this.setWorkerStatus(
              wid,
              wa.available ? 'idle' : wa.reason === 'break' ? 'break' : 'unavailable',
              ev.timestamp
            );
          }
        }
        const paused = this.pausedJobs.get(objId) || [];
        paused.push(job);
        this.pausedJobs.set(objId, paused);
        return;
      }

      if (ev.entityId && ev.stageId) {
        const acc = this.stageAcc.get(ev.stageId);
        if (acc) {
          acc.processingStartTimes.set(ev.entityId, ev.timestamp);
        }
      }
      for (const wid of workerIds) {
        const ws = this.workerStates.get(wid);
        if (ws) {
          ws.position = { ...ws.targetPosition };
          ws.currentStationId = objId;
          this.setWorkerStatus(wid, 'busy', ev.timestamp);
        }
      }

      this.setObjectStatus(objId, 'running', ev.timestamp);
      const list = this.activeJobs.get(objId) || [];
      list.push(job);
      this.activeJobs.set(objId, list);
      if (isConveyorNode && ev.stageId) {
        this.repositionStageQueue(ev.stageId);
      }
    }

    if (hasEarlyConveyorRelease && workerReleaseToken !== undefined) {
      this.schedule(ev.timestamp + workDuration, 'WorkerReleased', {
        entityId: ev.entityId,
        stageId: ev.stageId,
        objectId: ev.objectId,
        details: `Conveyor manual work completed at ${ev.stageId}`,
        payload: {
          token: workerReleaseToken,
          earlyRelease: true,
          workerIds,
        },
      });
    }

    this.schedule(ev.timestamp + procDuration, 'ProcessingCompleted', {
      entityId: ev.entityId,
      stageId: ev.stageId,
      objectId: ev.objectId,
      details: `${ev.entityId} completed operation at ${ev.stageId}`,
      payload: {
        token,
        workerIds: completionWorkerIds,
        procDuration,
        workDuration: ev.payload?.workDuration,
      },
    });
  }

  private releaseAllocatedWorkers(
    workerIds: string[],
    entityId: string | undefined,
    stageId: string | undefined,
    objectId: string | undefined,
    stageName: string,
    timestamp: number,
    emitReleaseEvent: boolean
  ): void {
    for (const wid of workerIds) {
      if (entityId && this.workerAllocatedEntity.get(wid) !== entityId) continue;
      this.workerAllocatedEntity.set(wid, null);
      const ws = this.workerStates.get(wid);
      const wDef = this.workersMap.get(wid);
      if (ws) {
        ws.tasksCompleted++;
        const wAvail = wDef
          ? this.calendarEngine.getWorkerAvailabilityAt(wDef, timestamp)
          : { available: true, reason: 'active' as const };
        const nextWStatus = wAvail.available
          ? 'idle'
          : wAvail.reason === 'break'
          ? 'break'
          : 'unavailable';
        this.setWorkerStatus(wid, nextWStatus, timestamp);
      }
      if (emitReleaseEvent) {
        this.schedule(timestamp, 'WorkerReleased', {
          entityId,
          stageId,
          objectId,
          workerId: wid,
          details: `Worker ${wid} released from ${stageName}`,
        });
      }
    }
  }

  private handleBreakdownStarted(ev: InternalEvent): void {
    const objId = ev.objectId;
    if (!objId) return;
    const obj = this.objectsMap.get(objId);
    const stState = this.objectStates.get(objId);
    if (!obj || !stState) return;
    if (stState.status === 'down') return;

    const failureParams = resolveObjectFailureParams(obj, this.project.simulationConfig);
    if (!failureParams.enabled) return;

    // Only breakdown during active shift/operating periods (not while in planned maintenance)
    if (stState.status === 'maintenance') {
      const retryAt = ev.timestamp + Math.max(10, sampleTimeToFailureSec(failureParams, this.rng));
      if (retryAt < this.project.simulationConfig.durationSec) {
        this.schedule(retryAt, 'BreakdownStarted', {
          objectId: objId,
          stageId: obj.stageId,
          details: `Deferred stochastic failure check on ${obj.name}`,
        });
      }
      return;
    }

    const avail = this.calendarEngine.getObjectAvailabilityAt(obj, ev.timestamp);
    if (!avail.available) {
      const nextTry = ev.timestamp + Math.max(60, sampleTimeToFailureSec(failureParams, this.rng));
      if (nextTry < this.project.simulationConfig.durationSec) {
        this.schedule(nextTry, 'BreakdownStarted', {
          objectId: objId,
          stageId: obj.stageId,
          details: `Scheduled stochastic failure on ${obj.name}`,
        });
      }
      return;
    }

    this.preemptPendingWalkJobs(objId, ev.timestamp);
    this.preemptActiveJobs(objId, ev.timestamp);
    if (obj.kind === 'conveyor') {
      this.pauseConveyorTransits(objId, ev.timestamp);
    }
    this.setObjectStatus(objId, 'down', ev.timestamp);

    const repairDur = sampleRepairDurationSec(failureParams, this.rng);
    if (!Number.isFinite(repairDur)) return;
    const boundedRepairDur = Math.max(0.5, repairDur);
    this.schedule(ev.timestamp + boundedRepairDur, 'RepairCompleted', {
      objectId: objId,
      stageId: ev.stageId || obj.stageId,
      details: `Repair completed on ${obj.name} after ${boundedRepairDur.toFixed(1)}s (${failureParams.repairModel})`,
    });
  }

  private handleRepairCompleted(ev: InternalEvent): void {
    const objId = ev.objectId;
    if (!objId) return;
    const obj = this.objectsMap.get(objId);

    if (obj) {
      const failureParams = resolveObjectFailureParams(obj, this.project.simulationConfig);
      if (failureParams.enabled && failureParams.mtbfSec > 0) {
        const nextFail = ev.timestamp + sampleTimeToFailureSec(failureParams, this.rng);
        if (nextFail < this.project.simulationConfig.durationSec) {
          this.schedule(nextFail, 'BreakdownStarted', {
            objectId: objId,
            stageId: obj.stageId,
            details: `Next scheduled stochastic failure on ${obj.name}`,
          });
        }
      }
    }

    const stState = this.objectStates.get(objId);
    if (stState) {
      const avail = obj ? this.calendarEngine.getObjectAvailabilityAt(obj, ev.timestamp) : { available: true, reason: 'active' as const };
      if (!avail.available) {
        this.setObjectStatus(objId, availToMachineStatus(avail), ev.timestamp);
        return;
      }
      this.setObjectStatus(objId, this.resolveIdleOrStarvedStatus(objId, ev.timestamp), ev.timestamp);
      if (obj?.kind === 'conveyor') {
        this.resumeConveyorTransits(objId, ev.timestamp);
      }
      this.resumePausedJobs(objId, ev.timestamp);
      this.resumePausedWalkJobs(objId, ev.timestamp);
      this.setObjectStatus(objId, this.resolveObjectActiveOrIdleStatus(objId, ev.timestamp), ev.timestamp);
      if (obj?.kind === 'conveyor') {
        this.syncRecoveredConveyorState(objId, ev.timestamp);
      }
    }

    const stgId = ev.stageId || obj?.stageId;
    if (stgId) {
      this.retryBlockedUpstreamForStage(stgId, ev.timestamp);
      this.tryStartStage(stgId, ev.timestamp);
    }
    if (obj?.kind === 'conveyor') {
      this.retryBlockedUpstreamAll(ev.timestamp);
    }
    this.tryDispatchAllStages(ev.timestamp);
    this.resumeWaitingSourceIfReady(ev.timestamp);
  }

  private handleProcessingCompleted(ev: InternalEvent): void {
    const token = ev.payload?.token as number | undefined;
    if (token !== undefined) {
      if (!this.validJobTokens.has(token)) return;
      this.validJobTokens.delete(token);
      if (ev.objectId) {
        const list = this.activeJobs.get(ev.objectId) || [];
        this.activeJobs.set(
          ev.objectId,
          list.filter((j) => j.token !== token)
        );
      }
    }

    const entId = ev.entityId;
    const stageId = ev.stageId;
    const objId = ev.objectId;
    if (!entId || !stageId || !objId) return;

    const ent = this.entities.get(entId);
    const stage = this.stagesMap.get(stageId);
    const stState = this.objectStates.get(objId);
    const acc = this.stageAcc.get(stageId);
    if (!ent || !stage || !stState || !acc) return;

    const procDuration = Number(ev.payload?.procDuration ?? stage.processingTimeSec);
    const convWorkDuration = Number(ev.payload?.workDuration ?? 0);
    const activeTr = this.conveyorTransits.get(entId);
    const objRef = this.objectsMap.get(objId);
    if (activeTr) {
      this.conveyorTransits.delete(entId);
      ent.conveyorProgress = 1;
      if (convWorkDuration > 0) {
        ent.processingTimeSec += convWorkDuration;
      }
    } else {
      ent.processingTimeSec += procDuration;
    }

    const releaseConveyorSlotIfAny = () => {
      if (objRef?.kind === 'conveyor') {
        const bList = this.blockedConveyorEntities.get(objRef.id);
        if (bList) {
          const filtered = bList.filter((id) => id !== entId);
          if (filtered.length > 0) this.blockedConveyorEntities.set(objRef.id, filtered);
          else this.blockedConveyorEntities.delete(objRef.id);
        }
        this.conveyorOccupancy.set(
          objRef.id,
          Math.max(0, (this.conveyorOccupancy.get(objRef.id) || 1) - 1)
        );
        ent.conveyorProgress = undefined;
      }
    };

    // Release workers respecting each worker's individual shift/break calendar
    const workerIds = (ev.payload?.workerIds as string[]) || [];
    this.releaseAllocatedWorkers(
      workerIds,
      entId,
      stageId,
      objId,
      stage.name,
      ev.timestamp,
      true
    );

    const unitCount = Math.max(1, ent.batchCount ?? 1);
    const procStart = acc.processingStartTimes.get(entId);
    const enterTime = acc.stageEnterTimes.get(entId);
    if (procStart !== undefined) {
      acc.cycleTimeSum += Math.max(0, ev.timestamp - procStart);
      acc.processingStartTimes.delete(entId);
    } else if (enterTime !== undefined) {
      acc.cycleTimeSum += Math.max(0, ev.timestamp - enterTime);
    }
    acc.stageEnterTimes.delete(entId);

    // Defect sampling: explicit unit-level (binomial) vs batch-level (whole batch accept/reject)
    const defectModel = stage.defectModel ?? 'unit';
    let scrappedInBatch = 0;
    let reworkInBatch = 0;
    let goodInBatch = 0;

    if (defectModel === 'batch' || unitCount === 1) {
      if (stage.scrapRate > 0 && this.rng() < stage.scrapRate) {
        scrappedInBatch = unitCount;
      } else if (stage.reworkProbability > 0 && ent.reworkCount < 2 && this.rng() < stage.reworkProbability) {
        reworkInBatch = unitCount;
      } else {
        goodInBatch = unitCount;
      }
    } else {
      for (let i = 0; i < unitCount; i++) {
        if (stage.scrapRate > 0 && this.rng() < stage.scrapRate) {
          scrappedInBatch++;
        } else if (
          stage.reworkProbability > 0 &&
          ent.reworkCount < 2 &&
          this.rng() < stage.reworkProbability
        ) {
          reworkInBatch++;
        } else {
          goodInBatch++;
        }
      }
    }

    // Only units exiting stage (good + final scrap) count toward completedCount; rework is NOT double-counted
    const exitingUnits = goodInBatch + scrappedInBatch;
    if (exitingUnits > 0) {
      stState.processedCount += exitingUnits;
      acc.completed += exitingUnits;
      acc.batchesCompleted++;
    }

    const hourBucket = Math.floor(ev.timestamp / 3600) + 1;

    if (scrappedInBatch > 0) {
      stState.scrapCount += scrappedInBatch;
      acc.scrapped += scrappedInBatch;
      if (scrappedInBatch === unitCount && (ent.isBatchCarrier || unitCount > 1)) {
        acc.scrappedBatches++;
      }
      this.scrappedCount += scrappedInBatch;
      this.productScrappedCount.set(
        ent.productId,
        (this.productScrappedCount.get(ent.productId) || 0) + scrappedInBatch
      );
      this.hourlyScrap.set(hourBucket, (this.hourlyScrap.get(hourBucket) || 0) + scrappedInBatch);

      if (goodInBatch === 0 && reworkInBatch === 0) {
        ent.scrapped = true;
        ent.locationKind = 'scrapped';
        this.activeEntities.delete(entId);
      } else {
        this.entityCounter++;
        const scrapRecordId = `scrap_${this.entityCounter}`;
        this.entities.set(scrapRecordId, {
          ...ent,
          id: scrapRecordId,
          serialNumber: this.entityCounter,
          scrapped: true,
          locationKind: 'scrapped',
          batchCount: scrappedInBatch,
          isBatchCarrier: scrappedInBatch > 1 && Boolean(ent.isBatchCarrier),
        });
      }
      this.schedule(ev.timestamp, 'ProductScrapped', {
        entityId: entId,
        stageId,
        objectId: objId,
        details: `${ent.batchLabel || entId} (${scrappedInBatch}/${unitCount}u) scrapped at ${stage.name}`,
      });
    }

    if (reworkInBatch > 0) {
      acc.reworked += reworkInBatch;
      acc.reworkCycles += 1;
      if (unitCount > 1 || ent.isBatchCarrier) {
        acc.reworkBatches += 1;
      }
      this.productReworkUnits.set(
        ent.productId,
        (this.productReworkUnits.get(ent.productId) || 0) + reworkInBatch
      );
      this.productReworkCycles.set(
        ent.productId,
        (this.productReworkCycles.get(ent.productId) || 0) + 1
      );

      if (goodInBatch === 0 && scrappedInBatch === 0) {
        ent.reworkCount++;
        acc.stageEnterTimes.set(entId, ev.timestamp);
        this.schedule(ev.timestamp, 'ProductArrived', {
          entityId: entId,
          stageId,
          details: `${ent.batchLabel || entId} (${reworkInBatch}u) routed for rework at ${stage.name}`,
        });
      } else {
        this.entityCounter++;
        const rwId = `rework_${this.entityCounter}`;
        const rwEnt: ProductEntityState = {
          ...ent,
          id: rwId,
          serialNumber: this.entityCounter,
          reworkCount: ent.reworkCount + 1,
          locationKind: 'buffer',
          batchCount: reworkInBatch,
          isBatchCarrier: reworkInBatch > 1 && Boolean(ent.isBatchCarrier),
          batchLabel:
            reworkInBatch > 1 && ent.isBatchCarrier
              ? `${ent.batchLabel?.split('×')[0] || 'BAT'}×${reworkInBatch}`
              : undefined,
        };
        this.entities.set(rwId, rwEnt);
        this.activeEntities.set(rwId, rwEnt);
        acc.stageEnterTimes.set(rwId, ev.timestamp);
        this.schedule(ev.timestamp, 'ProductArrived', {
          entityId: rwId,
          stageId,
          details: `${rwId} (${reworkInBatch}u split rework) routed at ${stage.name}`,
        });
      }
    }

    if (goodInBatch === 0) {
      if (scrappedInBatch > 0 && reworkInBatch > 0) {
        ent.absorbedIntoEntityId = `${entId}_split`;
        this.activeEntities.delete(entId);
      }
      releaseConveyorSlotIfAny();
      stState.busyUnitIds = stState.busyUnitIds.filter((id) => id !== entId);
      this.positionStationActiveUnits(objId);
      this.setObjectStatus(objId, this.resolveObjectActiveOrIdleStatus(objId, ev.timestamp), ev.timestamp);
      this.tryFlushPartialBatchesIfExhausted(ev.timestamp);
      this.retryBlockedUpstreamForStage(stageId, ev.timestamp);
      this.tryDispatchAllStages(ev.timestamp);
      return;
    }

    // Update surviving entity batchCount cleanly if batch experienced partial scrap/rework
    if (goodInBatch !== unitCount) {
      ent.batchCount = goodInBatch;
      if (ent.isBatchCarrier) {
        const prefix =
          ent.containerKind === 'pallet' ? 'PAL' : ent.containerKind === 'pack' ? 'PAK' : 'CTN';
        ent.batchLabel = `${prefix}×${goodInBatch}`;
      }
    }

    const prod = this.productsMap.get(ent.productId);
    let nextStageId: string | undefined;
    if (prod?.routingMode === 'manual') {
      const branchCandidates = stage.successorIds.filter(
        (sid) => this.stagesMap.has(sid) && sid !== stageId
      );
      nextStageId = this.pickBestBranchStage(branchCandidates);
    } else {
      const routeIds = prod?.routeStageIds || this.project.stages.map((s) => s.id);
      const rawStepIdx = ent.routeStepIndex;
      const currentIdx =
        rawStepIdx !== undefined &&
        rawStepIdx >= 0 &&
        rawStepIdx < routeIds.length &&
        routeIds[rawStepIdx] === stageId
          ? rawStepIdx
          : routeIds.indexOf(stageId);
      if (currentIdx >= 0) {
        if (currentIdx + 1 < routeIds.length) {
          nextStageId = routeIds[currentIdx + 1];
          ent.routeStepIndex = currentIdx + 1;
        } else {
          nextStageId = undefined;
        }
      } else {
        nextStageId = this.pickBestBranchStage(stage.successorIds);
      }
    }

    if (!nextStageId) {
      releaseConveyorSlotIfAny();
      stState.busyUnitIds = stState.busyUnitIds.filter((id) => id !== entId);
      this.positionStationActiveUnits(objId);
      ent.completedAt = ev.timestamp;
      ent.locationKind = 'completed';
      this.activeEntities.delete(entId);
      this.completedCount += goodInBatch;
      this.productCompletedCount.set(
        ent.productId,
        (this.productCompletedCount.get(ent.productId) || 0) + goodInBatch
      );
      if (ent.isBatchCarrier) this.completedBatches++;
      this.hourlyGood.set(hourBucket, (this.hourlyGood.get(hourBucket) || 0) + goodInBatch);

      this.setObjectStatus(objId, this.resolveObjectActiveOrIdleStatus(objId, ev.timestamp), ev.timestamp);
      this.schedule(ev.timestamp, 'ProductCompleted', {
        entityId: entId,
        stageId,
        objectId: objId,
        details: `${ent.batchLabel || entId} (${goodInBatch}u) completed (${this.completedCount} total good units)`,
      });
      this.schedule(ev.timestamp, 'BufferReleased', {
        stageId,
        details: `Exit capacity freed at ${stage.name}`,
      });
      this.tryDispatchAllStages(ev.timestamp);
      return;
    }

    const transferred = this.attemptTransferToNextStage(entId, stageId, objId, nextStageId, ev.timestamp);
    if (transferred) {
      this.retryBlockedUpstreamForStage(stageId, ev.timestamp);
    }
    this.tryDispatchAllStages(ev.timestamp);
  }

  private attemptTransferToNextStage(
    entId: string,
    fromStageId: string,
    fromObjId: string,
    nextStageId: string,
    now: number
  ): boolean {
    const nextStage = this.stagesMap.get(nextStageId);
    const nextBuf = this.stageBuffers.get(nextStageId);
    const nextBatchHolder = this.stageBatchHolders.get(nextStageId) || [];
    const nextBatchCfg = this.stageBatchConfigs.get(nextStageId);
    const fromState = this.objectStates.get(fromObjId);
    if (!nextStage || !nextBuf || !fromState) return false;

    const pendingInTransit = this.stageInTransitCounts.get(nextStageId) || 0;
    const effectiveBufferUsed = nextBuf.length + nextBatchHolder.length + pendingInTransit;
    const nextBufferCap = Math.max(0, Number(nextStage.bufferCapacity ?? 0));

    const fromObj = this.objectsMap.get(fromObjId);
    const toObj = this.objectsMap.get(nextStage.assignedObjectIds[0]);
    const ent = this.entities.get(entId);
    const prod = ent ? this.productsMap.get(ent.productId) : undefined;
    const freeDestStation = this.findAvailableStation(nextStage, prod, now, ent);
    const hasFreeDestSlot =
      Boolean(freeDestStation) &&
      (nextStage.requiredWorkers <= 0 ||
        Boolean(
          freeDestStation &&
            this.findAvailableWorkers(nextStage, freeDestStation, nextStage.requiredWorkers, now)
        ));
    const nextConvFull =
      toObj?.kind === 'conveyor' &&
      (this.conveyorOccupancy.get(toObj.id) || 0) + pendingInTransit >=
        this.getConveyorPhysicalCapacity(toObj, prod, ent);

    const explicitConveyorStage = fromObj?.kind === 'conveyor' || toObj?.kind === 'conveyor';
    const rawStartCheck: Vec3 = fromObj
      ? { x: fromObj.geometry.position.x, y: fromObj.geometry.dimensions.height, z: fromObj.geometry.position.z }
      : { x: 0, y: 0, z: 0 };
    const fromStage = this.stagesMap.get(fromStageId);
    const allConveyors = this.project.layoutObjects.filter(
      (o) => o.kind === 'conveyor' && o.rendering.visible
    );
    const findNearestConveyor = (pos: Vec3, preferredId?: string): LayoutObject | undefined => {
      if (allConveyors.length === 0) return undefined;
      if (preferredId) {
        const pref = this.objectsMap.get(preferredId);
        if (pref && pref.kind === 'conveyor') return pref;
      }
      let best = allConveyors[0];
      let bestD = Infinity;
      for (const c of allConveyors) {
        const d = distance2D(pos, c.geometry.position);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    };

    const getConvEnd = (c: LayoutObject, isExit: boolean): Vec3 => {
      const rad = (c.geometry.rotationDeg * Math.PI) / 180;
      const dir = c.operations.direction === -1 ? -1 : 1;
      const halfL = Math.max(0.25, c.geometry.dimensions.length / 2 - 0.15);
      const sign = isExit ? 1 : -1;
      return {
        x: c.geometry.position.x + Math.cos(rad) * dir * halfL * sign,
        y: c.geometry.dimensions.height,
        z: c.geometry.position.z + Math.sin(rad) * dir * halfL * sign,
      };
    };

    const rawStart: Vec3 =
      fromObj?.kind === 'conveyor'
        ? getConvEnd(fromObj, true)
        : rawStartCheck;
    const rawEnd: Vec3 =
      toObj?.kind === 'conveyor'
        ? getConvEnd(toObj, false)
        : toObj
        ? { x: toObj.geometry.position.x, y: toObj.geometry.dimensions.height, z: toObj.geometry.position.z }
        : rawStart;

    const fromConv = explicitConveyorStage ? undefined : findNearestConveyor(rawStart, fromStage?.conveyorObjectId);
    const toConv = explicitConveyorStage ? undefined : findNearestConveyor(rawEnd, nextStage.conveyorObjectId);

    const transferConvCandidate = fromConv;
    const transferConvFull =
      transferConvCandidate?.kind === 'conveyor' &&
      (this.conveyorOccupancy.get(transferConvCandidate.id) || 0) >=
        this.getConveyorPhysicalCapacity(transferConvCandidate, prod, ent);

    const transferConvUnavailable =
      (transferConvCandidate?.kind === 'conveyor' &&
        (transferConvCandidate.operations.speedMps || 0) > 0 &&
        !this.isConveyorAvailableForTransport(transferConvCandidate, now)) ||
      (toConv?.kind === 'conveyor' &&
        toConv.id !== transferConvCandidate?.id &&
        (toConv.operations.speedMps || 0) > 0 &&
        !this.isConveyorAvailableForTransport(toConv, now));

    const nextStagingAllowance =
      nextBatchCfg?.batchMode === 'collect_batch' ? nextBatchCfg.batchSize : 1;

    if (
      !canAdmitToStageBuffer(
        nextStage,
        nextBuf.length + nextBatchHolder.length,
        pendingInTransit,
        hasFreeDestSlot,
        nextStagingAllowance
      ) ||
      nextConvFull ||
      transferConvFull ||
      transferConvUnavailable
    ) {
      this.blockedEntitySet.add(entId);
      if (fromObj?.kind === 'conveyor') {
        const bList = this.blockedConveyorEntities.get(fromObj.id) || [];
        if (!bList.includes(entId)) {
          bList.push(entId);
          this.blockedConveyorEntities.set(fromObj.id, bList);
        }
      }
      this.setObjectStatus(fromObjId, 'blocked', now);
      const outbox = this.blockedOutbox.get(nextStageId) || [];
      if (!outbox.some((item) => item.entityId === entId)) {
        outbox.push({ entityId: entId, objectId: fromObjId, nextStageId });
        this.blockedOutbox.set(nextStageId, outbox);
      }
      this.schedule(now, 'BufferFull', {
        entityId: entId,
        stageId: nextStageId,
        objectId: fromObjId,
        details: transferConvUnavailable
          ? `Transfer conveyor unavailable for ${nextStage.name}; upstream blocked`
          : `${nextStage.name} buffer full (${effectiveBufferUsed}/${nextBufferCap}); upstream blocked`,
      });
      return false;
    }

    this.blockedEntitySet.delete(entId);
    if (fromObj?.kind === 'conveyor') {
      const bList = this.blockedConveyorEntities.get(fromObj.id);
      if (bList) {
        const filtered = bList.filter((id) => id !== entId);
        if (filtered.length > 0) this.blockedConveyorEntities.set(fromObj.id, filtered);
        else this.blockedConveyorEntities.delete(fromObj.id);
      }
      this.conveyorOccupancy.set(
        fromObj.id,
        Math.max(0, (this.conveyorOccupancy.get(fromObj.id) || 1) - 1)
      );
      if (ent) ent.conveyorProgress = undefined;
    }
    this.stageInTransitCounts.set(nextStageId, pendingInTransit + 1);

    fromState.busyUnitIds = fromState.busyUnitIds.filter((id) => id !== entId);
    this.positionStationActiveUnits(fromObjId);
    this.setObjectStatus(fromObjId, this.resolveObjectActiveOrIdleStatus(fromObjId, now), now);

    if (!ent) {
      this.stageInTransitCounts.set(nextStageId, Math.max(0, pendingInTransit));
      return false;
    }

    const projectOntoConveyor = (pos: Vec3, conv: LayoutObject): Vec3 => {
      const rad = (conv.geometry.rotationDeg * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uz = Math.sin(rad);
      const dx = pos.x - conv.geometry.position.x;
      const dz = pos.z - conv.geometry.position.z;
      const halfL = Math.max(0.2, conv.geometry.dimensions.length / 2 - 0.15);
      const proj = Math.max(-halfL, Math.min(halfL, dx * ux + dz * uz));
      return {
        x: conv.geometry.position.x + ux * proj,
        y: conv.geometry.dimensions.height,
        z: conv.geometry.position.z + uz * proj,
      };
    };

    let transportTime = 1.6;
    if (fromConv && fromConv.operations.speedMps && fromConv.operations.speedMps > 0) {
      const pStart = projectOntoConveyor(rawStart, fromConv);
      const pEnd = toConv ? projectOntoConveyor(rawEnd, toConv) : projectOntoConveyor(rawEnd, fromConv);

      const waypoints: Vec3[] = [pStart];
      if (toConv && toConv.id !== fromConv.id) {
        const bridge = allConveyors.find(
          (c) =>
            c.id !== fromConv.id &&
            c.id !== toConv.id &&
            fromConv.productionLineId &&
            c.productionLineId === fromConv.productionLineId
        );
        if (bridge) {
          waypoints.push({
            x: bridge.geometry.position.x,
            y: bridge.geometry.dimensions.height,
            z: fromConv.geometry.position.z,
          });
          waypoints.push({
            x: bridge.geometry.position.x,
            y: bridge.geometry.dimensions.height,
            z: toConv.geometry.position.z,
          });
        } else {
          waypoints.push(getConvEnd(fromConv, true));
          const visited = new Set<string>([fromConv.id]);
          let cursor: LayoutObject | undefined = fromConv;
          let steps = 0;
          while (cursor && cursor.id !== toConv.id && steps < 8) {
            steps++;
            const nextConvId: string | undefined = cursor.connectedToIds.find(
              (cid) => !visited.has(cid) && allConveyors.some((c) => c.id === cid)
            );
            if (!nextConvId) break;
            const nextConv = this.objectsMap.get(nextConvId);
            if (!nextConv) break;
            visited.add(nextConv.id);
            if (nextConv.id === toConv.id) break;
            waypoints.push(getConvEnd(nextConv, false));
            waypoints.push(getConvEnd(nextConv, true));
            cursor = nextConv;
          }
          waypoints.push(getConvEnd(toConv, false));
        }
      }
      waypoints.push(pEnd);

      const cumLengths = [0];
      let totalLen = 0;
      for (let i = 1; i < waypoints.length; i++) {
        totalLen += distance2D(waypoints[i - 1], waypoints[i]);
        cumLengths.push(totalLen);
      }
      const entSz = this.getEntityPhysicalSize(ent);
      const carrierLen =
        ent.isBatchCarrier && ent.containerKind === 'pallet'
          ? Math.max(1.0, prod?.dimensions.length || 0.75)
          : entSz.length;
      const cMetrics = computeConveyorMetrics(fromConv, prod, carrierLen);
      transportTime = computeConveyorPathTimeSec(totalLen, cMetrics.speedMps);

      const minGapSec = cMetrics.minHeadwaySec;
      const laneKey = `${fromConv.id}:${fromStageId}`;
      const lastEntry = this.conveyorLastEntryTime.get(laneKey) ?? -Infinity;
      const earliestEntry = Math.max(now, lastEntry + minGapSec);
      const entryAx = this.getConveyorAxisMetrics(fromConv, pStart);
      const mergeDelay = this.computeConveyorEntryDelay(
        fromConv,
        entryAx.sBelt,
        entryAx.perpBelt,
        ent,
        earliestEntry
      );
      const entryDelay = Math.max(0, earliestEntry + mergeDelay - now);
      this.conveyorLastEntryTime.set(laneKey, now + entryDelay);

      const fromStageAcc = this.stageAcc.get(fromStageId);
      const fromBatchCfg = this.stageBatchConfigs.get(fromStageId);
      const batchTransferSec =
        fromBatchCfg?.batchMode === 'collect_batch'
          ? Math.max(0, Number(fromStage?.batchTransferTimeSec ?? fromObj?.operations.batchTransferTimeSec ?? 0))
          : 0;

      const startTime = now + entryDelay + batchTransferSec;
      const endTime = startTime + transportTime;
      const unitCount = Math.max(1, ent.batchCount ?? 1);
      const transferToken = ++this.jobTokenCounter;
      this.validJobTokens.add(transferToken);

      ent.locationKind = 'conveyor';
      ent.currentObjectId = fromConv.id;
      ent.transportTimeSec += transportTime + entryDelay + batchTransferSec;
      if (fromStageAcc) {
        fromStageAcc.conveyorTransitTimeSum += transportTime * unitCount;
      }
      this.conveyorOccupancy.set(fromConv.id, (this.conveyorOccupancy.get(fromConv.id) || 0) + 1);
      this.stateTracker.transitionConveyor(fromConv.id, 'moving', now, this.objectStates.get(fromConv.id));
      this.conveyorTransits.set(entId, {
        entityId: entId,
        conveyorId: fromConv.id,
        fromObjectId: fromObjId,
        fromStageId,
        toStageId: nextStageId,
        startTime,
        endTime,
        waypoints,
        cumLengths,
        totalLength: totalLen,
        transferToken,
      });

      this.schedule(endTime, 'ProductTransferred', {
        entityId: entId,
        stageId: nextStageId,
        objectId: fromConv.id,
        details: `${entId} conveyed to ${nextStage.name} (${totalLen.toFixed(2)}m @ ${cMetrics.speedMps} m/s = ${transportTime.toFixed(2)}s)`,
        payload: { transferConveyorId: fromConv.id, token: transferToken },
      });
      return true;
    }

    const fromBatchCfg = this.stageBatchConfigs.get(fromStageId);
    const batchTransferSec =
      fromBatchCfg?.batchMode === 'collect_batch'
        ? Math.max(0, Number(fromStage?.batchTransferTimeSec ?? fromObj?.operations.batchTransferTimeSec ?? 0))
        : 0;
    ent.transportTimeSec += batchTransferSec;
    ent.locationKind = 'station';
    ent.currentObjectId = fromObjId;
    this.schedule(now + batchTransferSec, 'ProductTransferred', {
      entityId: entId,
      stageId: nextStageId,
      details: `${entId} transferred to ${nextStage.name}${batchTransferSec > 0 ? ` (batch transfer ${batchTransferSec.toFixed(1)}s)` : ''}`,
    });
    return true;
  }

  private handleProductTransferred(ev: InternalEvent): void {
    const token = ev.payload?.token as number | undefined;
    if (token !== undefined) {
      if (!this.validJobTokens.has(token)) return;
      this.validJobTokens.delete(token);
    }
    if (!ev.entityId || !ev.stageId) return;
    const prevTransitCount = this.stageInTransitCounts.get(ev.stageId) || 0;
    this.stageInTransitCounts.set(ev.stageId, Math.max(0, prevTransitCount - 1));
    const transferConvId = ev.payload?.transferConveyorId as string | undefined;
    if (transferConvId) {
      const nextOcc = Math.max(0, (this.conveyorOccupancy.get(transferConvId) || 1) - 1);
      this.conveyorOccupancy.set(transferConvId, nextOcc);
      if (nextOcc === 0) {
        const cState = this.objectStates.get(transferConvId);
        const cObj = this.objectsMap.get(transferConvId);
        if (cState && cState.busyUnitIds.length === 0) {
          const convNext = cObj
            ? availToConveyorStatus(this.calendarEngine.getObjectAvailabilityAt(cObj, ev.timestamp))
            : 'stopped';
          this.stateTracker.transitionConveyor(transferConvId, convNext, ev.timestamp, cState);
        }
      }
      this.schedule(ev.timestamp, 'BufferReleased', {
        stageId: ev.stageId,
        details: `Transfer conveyor slot freed`,
      });
      this.retryBlockedUpstreamAll(ev.timestamp);
    }
    this.conveyorTransits.delete(ev.entityId);
    const ent = this.entities.get(ev.entityId);
    if (ent) {
      ent.conveyorProgress = undefined;
    }
    this.schedule(ev.timestamp, 'ProductArrived', {
      entityId: ev.entityId,
      stageId: ev.stageId,
      details: `${ev.entityId} arrived at ${this.stagesMap.get(ev.stageId)?.name || ev.stageId}`,
    });
  }

  private retryBlockedUpstreamForStage(stageId: string, now: number): void {
    const outbox = this.blockedOutbox.get(stageId);
    if (!outbox || outbox.length === 0) return;
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId);
    const holder = this.stageBatchHolders.get(stageId) || [];
    const batchCfg = this.stageBatchConfigs.get(stageId);
    if (!stage || !buf) return;

    while (outbox.length > 0) {
      const inTransit = this.stageInTransitCounts.get(stageId) || 0;
      const freeSt = this.findAvailableStation(stage, undefined, now);
      const hasFreeSlot =
        Boolean(freeSt) &&
        (stage.requiredWorkers <= 0 ||
          Boolean(freeSt && this.findAvailableWorkers(stage, freeSt, stage.requiredWorkers, now)));
      const stagingAllowance =
        batchCfg?.batchMode === 'collect_batch' ? batchCfg.batchSize : 1;
      if (
        !canAdmitToStageBuffer(
          stage,
          buf.length + holder.length,
          inTransit,
          hasFreeSlot,
          stagingAllowance
        )
      ) {
        break;
      }
      const item = outbox[0];
      const fromStage = Array.from(this.stagesMap.values()).find((s) =>
        s.assignedObjectIds.includes(item.objectId)
      );
      if (!fromStage) {
        outbox.shift();
        continue;
      }
      const transferred = this.attemptTransferToNextStage(
        item.entityId,
        fromStage.id,
        item.objectId,
        item.nextStageId,
        now
      );
      if (!transferred) break;
      outbox.shift();
      this.retryBlockedUpstreamForStage(fromStage.id, now);
      this.tryStartStage(fromStage.id, now);
    }
  }

  public getSnapshot(includeResult = true): SimulationSnapshot {
    this.updateInterpolatedPositions(this.clockSec);
    const objects: Record<string, ObjectRuntimeState> = {};
    for (const [k, v] of this.objectStates.entries()) {
      const totals = this.stateTracker.getMachineTotals(k, this.clockSec);
      const convTotals =
        this.objectsMap.get(k)?.kind === 'conveyor'
          ? this.stateTracker.getConveyorTotals(k, this.clockSec)
          : undefined;
      objects[k] = {
        ...v,
        runningTimeSec: totals.running,
        idleTimeSec: totals.idle,
        blockedTimeSec: totals.blocked,
        starvedTimeSec: totals.starved,
        setupTimeSec: totals.setup,
        downTimeSec: totals.down,
        maintenanceTimeSec: totals.maintenance,
        unavailableTimeSec: totals.unavailable,
        ...(convTotals
          ? {
              movingTimeSec: convTotals.moving,
              stoppedTimeSec: convTotals.stopped,
              unavailableTimeSec: convTotals.unavailable,
            }
          : {}),
        busyUnitIds: [...v.busyUnitIds],
        queueUnitIds: [...v.queueUnitIds],
      };
    }
    const workers: Record<string, WorkerRuntimeState> = {};
    for (const [k, v] of this.workerStates.entries()) {
      const wt = this.stateTracker.getWorkerTotals(k, this.clockSec);
      workers[k] = {
        ...v,
        busyTimeSec: wt.busy,
        walkingTimeSec: wt.walking,
        idleTimeSec: wt.idle,
        breakTimeSec: wt.break,
        unavailableTimeSec: wt.unavailable,
        position: { ...v.position },
      };
    }
    const products: ProductEntityState[] = [];
    for (const ent of this.activeEntities.values()) {
      if (!ent.scrapped && ent.completedAt === undefined && !ent.absorbedIntoEntityId) {
        products.push({ ...ent, worldPosition: { ...ent.worldPosition } });
      }
    }

    const stageBatches: NonNullable<SimulationSnapshot['stageBatches']> = {};
    for (const st of this.project.stages) {
      const cfg = this.stageBatchConfigs.get(st.id);
      const holder = this.stageBatchHolders.get(st.id) || [];
      const buf = this.stageBuffers.get(st.id) || [];
      const bufferedItems = holder.reduce((s, item) => s + item.units, 0);
      const activeBatchEntities = buf.filter((id) => this.entities.get(id)?.isBatchCarrier).length;
      if ((cfg && cfg.batchSize > 1) || bufferedItems > 0 || activeBatchEntities > 0) {
        stageBatches[st.id] = {
          stageId: st.id,
          bufferedItems,
          targetBatchSize: cfg?.batchSize ?? 1,
          activeBatchEntities,
        };
      }
    }

    return {
      status: this.status,
      clockSec: this.clockSec,
      shiftActive: this.shiftActive,
      onBreak: this.onBreak,
      objects,
      workers,
      products,
      stageBatches,
      recentEvents: this.eventLog.slice(-150),
      totalEventsExecuted: this.totalEventsExecuted,
      result:
        includeResult && (this.status === 'completed' || this.clockSec > 0)
          ? this.buildResult()
          : undefined,
    };
  }

  public getAllEvents(): SimEvent[] {
    return this.eventLog;
  }

  public auditInvariants(): DesInvariantAuditResult {
    const violations: string[] = [];
    const now = this.clockSec;

    // 1. Check queues & occupancy non-negative
    for (const [sid, buf] of this.stageBuffers.entries()) {
      if (buf.length < 0) violations.push(`Negative queue length at stage ${sid}`);
      const inTr = this.stageInTransitCounts.get(sid) || 0;
      if (inTr < 0) violations.push(`Negative in-transit count (${inTr}) at stage ${sid}`);
    }
    for (const [cid, occ] of this.conveyorOccupancy.entries()) {
      if (occ < 0) violations.push(`Negative conveyor occupancy (${occ}) on ${cid}`);
    }

    // 2. Check resource capacity overflow, duplicate busy IDs, and unavailable resource processing
    const entityLocationSets = new Map<string, string[]>();
    const recordLoc = (entId: string, label: string) => {
      const list = entityLocationSets.get(entId) || [];
      list.push(label);
      entityLocationSets.set(entId, list);
    };

    for (const [objId, st] of this.objectStates.entries()) {
      const obj = this.objectsMap.get(objId);
      const uniqueBusy = new Set(st.busyUnitIds);
      if (uniqueBusy.size !== st.busyUnitIds.length) {
        violations.push(`Duplicate entity in busyUnitIds on ${objId}`);
      }
      for (const eid of st.busyUnitIds) {
        recordLoc(eid, obj?.kind === 'conveyor' ? `conveyor_busy:${objId}` : `station_busy:${objId}`);
      }
      if (obj && obj.kind !== 'conveyor') {
        const cap = Math.max(1, obj.operations.capacity);
        if (st.busyUnitIds.length > cap) {
          violations.push(`Capacity overflow on ${objId}: ${st.busyUnitIds.length} > ${cap}`);
        }
      }

      const activeList = this.activeJobs.get(objId) || [];
      const nonCompletingActive = activeList.filter((j) => j.expectedEndAt > now + 1e-6);
      const pendingList = this.pendingWalkJobs.get(objId) || [];
      if (activeList.length > st.busyUnitIds.length) {
        violations.push(`Active jobs (${activeList.length}) exceed busyUnitIds (${st.busyUnitIds.length}) on ${objId}`);
      }

      if (
        st.status === 'down' ||
        st.status === 'maintenance' ||
        st.status === 'unavailable'
      ) {
        if (nonCompletingActive.length > 0) {
          violations.push(`Active processing (${nonCompletingActive.length}) on ${st.status} resource ${objId} at t=${now}`);
        }
        if (pendingList.length > 0) {
          violations.push(`Pending walk jobs (${pendingList.length}) on ${st.status} resource ${objId} at t=${now}`);
        }
      }
      if (obj && nonCompletingActive.length > 0) {
        const fp = resolveObjectFailureParams(obj, this.project.simulationConfig);
        if (fp.enabled && fp.availability <= 0) {
          violations.push(`Processing on zero-availability resource ${objId} at t=${now}`);
        }
        const avail = this.calendarEngine.getObjectAvailabilityAt(obj, now);
        if (!avail.available) {
          const policy =
            avail.reason === 'break'
              ? this.getObjectBreakPolicy(obj)
              : avail.reason === 'off_shift'
              ? this.getObjectShiftEndPolicy(obj)
              : 'stop_immediately';
          if (policy === 'stop_immediately') {
            violations.push(`Processing on unavailable resource ${objId} (${avail.reason}) under stop_immediately at t=${now}`);
          }
        }
      }
    }

    // 3. Check conveyor transits, occupancy parity, and unavailable conveyor transport
    const convActualCount = new Map<string, number>();
    for (const [eid, tr] of this.conveyorTransits.entries()) {
      convActualCount.set(tr.conveyorId, (convActualCount.get(tr.conveyorId) || 0) + 1);
      const convObj = this.objectsMap.get(tr.conveyorId);
      const convState = this.objectStates.get(tr.conveyorId);
      // Only check unavailability if transit wasn't already recorded as conveyorNode busy
      if (tr.transferToken !== undefined) {
        recordLoc(eid, `transfer_conveyor:${tr.conveyorId}`);
      }
      if (!tr.paused && now >= tr.startTime - 1e-6) {
        if (
          convState &&
          (convState.status === 'down' ||
            convState.status === 'maintenance' ||
            convState.status === 'unavailable')
        ) {
          violations.push(
            `Unpaused transportation of ${eid} on ${convState.status} conveyor ${tr.conveyorId} at t=${now}`
          );
        }
        if (convObj) {
          const fp = resolveObjectFailureParams(convObj, this.project.simulationConfig);
          if (fp.enabled && fp.availability <= 0) {
            violations.push(`Transportation on zero-availability conveyor ${tr.conveyorId} at t=${now}`);
          }
        }
      }
    }
    for (const [cid, bList] of this.blockedConveyorEntities.entries()) {
      for (const bid of bList) {
        if (!this.conveyorTransits.has(bid)) {
          convActualCount.set(cid, (convActualCount.get(cid) || 0) + 1);
        }
      }
    }
    for (const [cid, occ] of this.conveyorOccupancy.entries()) {
      const actual = convActualCount.get(cid) || 0;
      if (occ !== actual) {
        violations.push(`Conveyor ${cid} occupancy (${occ}) != actual transit/blocked entities (${actual})`);
      }
      const cObj = this.objectsMap.get(cid);
      if (cObj && occ > 0) {
        // Max capacity check against smallest carrier/entity on belt (pallet carrierLen >= 1m has fewer slots than 0.5m units)
        let capMax = this.getConveyorPhysicalCapacity(cObj, this.project.products[0]);
        for (const tr of this.conveyorTransits.values()) {
          if (tr.conveyorId === cid) {
            const trEnt = this.entities.get(tr.entityId);
            const trProd = trEnt ? this.productsMap.get(trEnt.productId) : undefined;
            capMax = Math.max(capMax, this.getConveyorPhysicalCapacity(cObj, trProd, trEnt));
          }
        }
        if (occ > capMax) {
          violations.push(`Conveyor ${cid} occupancy overflow: ${occ} > ${capMax}`);
        }
      }
    }

    // 4. Check stage buffers and batch holders
    for (const [sid, buf] of this.stageBuffers.entries()) {
      const seen = new Set<string>();
      for (const eid of buf) {
        if (seen.has(eid)) violations.push(`Duplicate entity ${eid} in queue for stage ${sid}`);
        seen.add(eid);
        recordLoc(eid, `queue:${sid}`);
      }
    }
    for (const [sid, holder] of this.stageBatchHolders.entries()) {
      const seen = new Set<string>();
      for (const h of holder) {
        if (seen.has(h.entityId)) violations.push(`Duplicate entity ${h.entityId} in batch holder for stage ${sid}`);
        seen.add(h.entityId);
        recordLoc(h.entityId, `batch_holder:${sid}`);
      }
    }

    // 5. Check worker conflict / double-allocation invariant
    const workerJobs = new Map<string, string[]>();
    const addWorkerJob = (wid: string, tag: string) => {
      const list = workerJobs.get(wid) || [];
      list.push(tag);
      workerJobs.set(wid, list);
    };
    for (const [objId, jobs] of this.activeJobs.entries()) {
      for (const j of jobs) {
        for (const wid of j.workerIds) addWorkerJob(wid, `active:${objId}:${j.entityId}`);
      }
    }
    for (const [objId, pJobs] of this.pendingWalkJobs.entries()) {
      for (const pj of pJobs) {
        for (const wid of pj.workerIds) addWorkerJob(wid, `pending_walk:${objId}:${pj.entityId}`);
      }
    }
    for (const [objId, jobs] of this.pausedJobs.entries()) {
      for (const j of jobs) {
        for (const wid of j.workerIds) addWorkerJob(wid, `paused:${objId}:${j.entityId}`);
      }
    }
    for (const [objId, pJobs] of this.pausedWalkJobs.entries()) {
      for (const pj of pJobs) {
        for (const wid of pj.workerIds) addWorkerJob(wid, `paused_walk:${objId}:${pj.entityId}`);
      }
    }
    for (const [wid, tags] of workerJobs.entries()) {
      if (tags.length > 1) {
        violations.push(`Worker ${wid} allocated to simultaneous conflicting jobs: ${tags.join(', ')}`);
      }
    }
    for (const [wid, allocEnt] of this.workerAllocatedEntity.entries()) {
      const tags = workerJobs.get(wid) || [];
      const entityHeldInStationBusy =
        allocEnt !== null &&
        Array.from(this.objectStates.values()).some((st) => st.busyUnitIds.includes(allocEnt));
      if (allocEnt !== null && tags.length === 0 && !entityHeldInStationBusy) {
        violations.push(`Worker ${wid} still marked allocated to ${allocEnt} with no active/paused/dispatched job`);
      }
      if (allocEnt === null && tags.length > 0) {
        violations.push(`Worker ${wid} has job allocation (${tags.join(', ')}) but workerAllocatedEntity is null`);
      }
    }

    // 6. Full Material Conservation & No-Double-Completion Check
    let completedUnits = 0;
    let scrappedUnits = 0;
    let activeWipUnits = 0;
    let waitingInQueueUnits = 0;
    let batchBufferUnits = 0;
    let underProcessingUnits = 0;
    let inTransitUnits = 0;
    let blockedAtStationUnits = 0;
    let pendingArrivalUnits = 0;
    let absorbedChildEntities = 0;
    const completedSeen = new Set<string>();
    const activeWipSeen = new Set<string>();

    for (const ent of this.entities.values()) {
      if (ent.absorbedIntoEntityId) {
        absorbedChildEntities++;
        if (this.activeEntities.has(ent.id)) {
          violations.push(`Absorbed entity ${ent.id} still present in activeEntities`);
        }
        const locs = entityLocationSets.get(ent.id);
        if (locs && locs.length > 0) {
          violations.push(`Absorbed entity ${ent.id} still occupies container: ${locs.join(', ')}`);
        }
        continue;
      }

      const units = Math.max(1, ent.batchCount ?? 1);
      if (ent.completedAt !== undefined) {
        if (completedSeen.has(ent.id)) {
          violations.push(`Completed entity ${ent.id} counted twice`);
        }
        completedSeen.add(ent.id);
        if (ent.scrapped) {
          violations.push(`Entity ${ent.id} is both completed and scrapped`);
        }
        if (ent.completedAt < ent.createdAt - 1e-9) {
          violations.push(`Entity ${ent.id} completedAt (${ent.completedAt}) < createdAt (${ent.createdAt})`);
        }
        if (this.activeEntities.has(ent.id)) {
          violations.push(`Completed entity ${ent.id} still in activeEntities`);
        }
        const locs = entityLocationSets.get(ent.id);
        if (locs && locs.length > 0) {
          violations.push(`Completed entity ${ent.id} still in container: ${locs.join(', ')}`);
        }
        completedUnits += units;
        continue;
      }

      if (ent.scrapped) {
        if (this.activeEntities.has(ent.id)) {
          violations.push(`Scrapped entity ${ent.id} still in activeEntities`);
        }
        const locs = entityLocationSets.get(ent.id);
        if (locs && locs.length > 0) {
          violations.push(`Scrapped entity ${ent.id} still in container: ${locs.join(', ')}`);
        }
        scrappedUnits += units;
        continue;
      }

      // Active WIP entity
      activeWipSeen.add(ent.id);
      activeWipUnits += units;
      if (!this.activeEntities.has(ent.id)) {
        violations.push(`Active entity ${ent.id} missing from activeEntities`);
      }

      const locs = entityLocationSets.get(ent.id) || [];
      if (locs.length > 1) {
        violations.push(`Entity ${ent.id} in multiple places simultaneously: ${locs.join(', ')}`);
      }
      if (locs.length === 1) {
        const loc = locs[0];
        if (loc.startsWith('queue:')) {
          waitingInQueueUnits += units;
        } else if (loc.startsWith('batch_holder:')) {
          batchBufferUnits += units;
        } else if (loc.startsWith('transfer_conveyor:') || loc.startsWith('conveyor_busy:')) {
          inTransitUnits += units;
        } else if (loc.startsWith('station_busy:')) {
          if (this.blockedEntitySet.has(ent.id)) {
            blockedAtStationUnits += units;
          } else {
            underProcessingUnits += units;
          }
        }
      } else {
        // In immediate zero-duration handoff or batch-transferring between stages (ProductArrived/ProductTransferred in queue)
        pendingArrivalUnits += units;
      }
    }

    for (const [eid, ent] of this.activeEntities.entries()) {
      if (!activeWipSeen.has(eid)) {
        violations.push(`activeEntities contains stale entry ${eid} (completed=${ent.completedAt}, scrapped=${ent.scrapped}, absorbed=${ent.absorbedIntoEntityId})`);
      }
    }

    if (completedUnits !== this.completedCount) {
      violations.push(`completedUnits (${completedUnits}) !== completedCount (${this.completedCount})`);
    }
    if (scrappedUnits !== this.scrappedCount) {
      violations.push(`scrappedUnits (${scrappedUnits}) !== scrappedCount (${this.scrappedCount})`);
    }
    const accountedTotal = completedUnits + scrappedUnits + activeWipUnits;
    const unaccountedUnits = this.totalArrived - accountedTotal;
    if (unaccountedUnits !== 0) {
      violations.push(
        `Material conservation violated: released=${this.totalArrived}, completed=${completedUnits}, scrapped=${scrappedUnits}, wip=${activeWipUnits}, diff=${unaccountedUnits}`
      );
    }

    let prodRelSum = 0;
    let prodCompSum = 0;
    let prodScrapSum = 0;
    for (const v of this.productReleasedCount.values()) prodRelSum += v;
    for (const v of this.productCompletedCount.values()) prodCompSum += v;
    for (const v of this.productScrappedCount.values()) prodScrapSum += v;
    if (prodRelSum !== this.totalArrived) {
      violations.push(`Per-product released sum (${prodRelSum}) !== totalArrived (${this.totalArrived})`);
    }
    if (prodCompSum !== this.completedCount) {
      violations.push(`Per-product completed sum (${prodCompSum}) !== completedCount (${this.completedCount})`);
    }
    if (prodScrapSum !== this.scrappedCount) {
      violations.push(`Per-product scrapped sum (${prodScrapSum}) !== scrappedCount (${this.scrappedCount})`);
    }

    // 7. Routing / circular wait deadlock detection across blockedOutbox
    const waitGraph = new Map<string, { nextStageId: string; objectId: string; entityId: string }>();
    for (const [nextSid, items] of this.blockedOutbox.entries()) {
      for (const item of items) {
        const fromStage = Array.from(this.stagesMap.values()).find((s) =>
          s.assignedObjectIds.includes(item.objectId)
        );
        if (fromStage && !waitGraph.has(fromStage.id)) {
          waitGraph.set(fromStage.id, {
            nextStageId: nextSid,
            objectId: item.objectId,
            entityId: item.entityId,
          });
        }
      }
    }
    const deadlocks: Array<{ stageIds: string[]; objectIds: string[]; entityIds: string[] }> = [];
    const seenCycleKeys = new Set<string>();
    for (const startSid of waitGraph.keys()) {
      const path: string[] = [];
      const visitedIdx = new Map<string, number>();
      let cur: string | undefined = startSid;
      while (cur && !visitedIdx.has(cur)) {
        visitedIdx.set(cur, path.length);
        path.push(cur);
        cur = waitGraph.get(cur)?.nextStageId;
      }
      if (cur && visitedIdx.has(cur)) {
        const cycle = path.slice(visitedIdx.get(cur)!);
        const key = [...cycle].sort().join('|');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          deadlocks.push({
            stageIds: cycle,
            objectIds: cycle.map((s) => waitGraph.get(s)!.objectId),
            entityIds: cycle.map((s) => waitGraph.get(s)!.entityId),
          });
        }
      }
    }

    return {
      ok: violations.length === 0,
      clockSec: now,
      violations,
      conservation: {
        totalReleasedUnits: this.totalArrived,
        completedUnits,
        scrappedUnits,
        activeWipUnits,
        waitingInQueueUnits,
        batchBufferUnits,
        underProcessingUnits: underProcessingUnits + blockedAtStationUnits,
        inTransitUnits,
        blockedAtStationUnits,
        pendingArrivalUnits,
        absorbedChildEntities,
        unaccountedUnits,
      },
      deadlocks,
    };
  }

  public buildResult(): SimulationResult {
    const shiftAudit = computeShiftWindowAudit(
      this.project.simulationConfig,
      this.project.products[0],
      this.clockSec || this.project.simulationConfig.durationSec,
      this.project.layoutObjects,
      this.project.products
    );
    const simTime = shiftAudit.simTimeSec;
    const planned = shiftAudit.plannedUnits;

    const good = this.completedCount;
    const scrap = this.scrappedCount;

    let leadSum = 0;
    let waitSum = 0;
    let batchQueueWaitEntitySum = 0;
    let procSum = 0;
    let transSum = 0;
    let finishedCount = 0;
    let finishedBatchEntities = 0;
    for (const ent of this.entities.values()) {
      if (ent.completedAt !== undefined && !ent.absorbedIntoEntityId) {
        const u = Math.max(1, ent.batchCount ?? 1);
        finishedCount += u;
        finishedBatchEntities++;
        leadSum += (ent.completedAt - ent.createdAt) * u;
        waitSum += ent.waitingTimeSec * u;
        batchQueueWaitEntitySum += ent.batchQueueWaitTimeSec ?? ent.waitingTimeSec;
        procSum += ent.processingTimeSec * u;
        transSum += ent.transportTimeSec * u;
      }
    }

    const avgLeadTimeSec = finishedCount > 0 ? leadSum / finishedCount : 0;
    const avgWaitingTimeSec = finishedCount > 0 ? waitSum / finishedCount : 0;
    const avgUnitWaitingTimeSec = avgWaitingTimeSec;
    const avgProcessingTimeSec = finishedCount > 0 ? procSum / finishedCount : 0;
    const avgTransportTimeSec = finishedCount > 0 ? transSum / finishedCount : 0;

    const stageAnalytics: StageAnalytics[] = [];
    let bottleneckStageId: string | undefined;
    let bottleneckStageName: string | undefined;
    let highestUtilOrWait = -1;

    let totalBlocked = 0;
    let totalStarved = 0;
    let totalIdle = 0;
    let totalSetup = 0;
    let totalDowntime = 0;
    let totalMaintenance = 0;
    let sumBufferOcc = 0;
    let sumCalendarUtil = 0;
    let totalScrappedBatches = 0;
    let totalReworkUnits = 0;
    let totalReworkCycles = 0;
    let totalReworkBatches = 0;
    let totalConveyorTransitTimeSec = 0;
    let stageBatchWaitWeightedSum = 0;
    let stageBatchWaitCountSum = 0;
    let stageQueueWaitWeightedSum = 0;
    let stageEnteredSum = 0;

    const resolveStageObjects = (stage: ProductionStage): LayoutObject[] =>
      stage.assignedObjectIds
        .map((oid) => this.objectsMap.get(oid))
        .filter((o): o is LayoutObject => Boolean(o));

    const stageCapacityProfiles = new Map<string, ReturnType<typeof computeStageCapacityProfile>>();
    const maxStageEffectiveCycle = this.project.stages.reduce((mx, candidate) => {
      const cp = computeStageCapacityProfile(candidate, resolveStageObjects(candidate));
      stageCapacityProfiles.set(candidate.id, cp);
      return Math.max(mx, cp.effectiveUnitCycleSec);
    }, 0);

    for (const st of this.project.stages) {
      const acc = this.stageAcc.get(st.id)!;
      const objIds = Array.from(new Set(st.assignedObjectIds));
      let runT = 0;
      let blkT = 0;
      let starvedT = 0;
      let idleT = 0;
      let setupT = 0;
      let downT = 0;
      let maintT = 0;
      let unavailT = 0;
      let stageScheduledSum = 0;
      let stageCalendarSum = 0;
      let stagePlannedDownSum = 0;

      for (const oid of objIds) {
        const totals = this.stateTracker.getMachineTotals(oid, simTime);
        const obj = this.objectsMap.get(oid);
        runT += totals.running;
        blkT += totals.blocked;
        starvedT += totals.starved;
        idleT += totals.idle;
        setupT += totals.setup;
        downT += totals.down;
        maintT += totals.maintenance;
        unavailT += totals.unavailable;

        if (obj) {
          const cal = this.calendarEngine.getObjectCalendarMetrics(obj, simTime);
          stageCalendarSum += cal.calendarTimeSec;
          stageScheduledSum += cal.scheduledProductionTimeSec;
          stagePlannedDownSum += cal.plannedDowntimeSec;
        } else {
          stageCalendarSum += simTime;
          stageScheduledSum += shiftAudit.activeSimTimeSec;
          stagePlannedDownSum += shiftAudit.plannedDowntimeSec;
        }
      }

      const objCount = Math.max(1, objIds.length);
      const avgCalSec = stageCalendarSum > 0 ? stageCalendarSum / objCount : simTime;
      const avgSchedSec = stageScheduledSum / objCount;
      const avgPlannedDownSec = stagePlannedDownSum / objCount;

      const scheduledUtilizationPct =
        stageScheduledSum > 1e-6 ? Math.min(100, (runT / stageScheduledSum) * 100) : 0;
      const utilPct = scheduledUtilizationPct;
      const calendarUtilizationPct =
        stageCalendarSum > 1e-6 ? Math.min(100, (runT / stageCalendarSum) * 100) : 0;
      const denom = Math.max(1e-6, stageScheduledSum || objCount * shiftAudit.activeSimTimeSec);
      const blkPct = stageScheduledSum > 1e-6 ? Math.min(100, (blkT / denom) * 100) : 0;
      const starvedPct = stageScheduledSum > 1e-6 ? Math.min(100, (starvedT / denom) * 100) : 0;
      const idlePct = stageScheduledSum > 1e-6 ? Math.min(100, (idleT / denom) * 100) : 0;
      const setupPct = stageScheduledSum > 1e-6 ? Math.min(100, (setupT / denom) * 100) : 0;
      const downPct = stageScheduledSum > 1e-6 ? Math.min(100, (downT / denom) * 100) : 0;
      const calDenom = Math.max(1e-6, stageCalendarSum || objCount * simTime);
      const maintenancePct = Math.min(100, (maintT / calDenom) * 100);
      const unavailablePct = Math.min(100, (unavailT / calDenom) * 100);

      sumCalendarUtil += calendarUtilizationPct;
      totalBlocked += blkT;
      totalStarved += starvedT;
      totalIdle += idleT;
      totalSetup += setupT;
      totalDowntime += downT;
      totalMaintenance += maintT;
      totalScrappedBatches += acc.scrappedBatches;
      totalReworkUnits += acc.reworked;
      totalReworkCycles += acc.reworkCycles;
      totalReworkBatches += acc.reworkBatches;
      totalConveyorTransitTimeSec += acc.conveyorTransitTimeSum;
      stageBatchWaitWeightedSum += acc.batchWaitTimeSum;
      stageBatchWaitCountSum += acc.batchWaitCount;
      stageQueueWaitWeightedSum += acc.queueWaitTimeSum;
      stageEnteredSum += acc.entered;

      const dtQ = Math.max(0, simTime - acc.lastQueueTime);
      const curQ = this.getStageQueueUnitCount(st.id);
      const avgQueue = (acc.queueArea + curQ * dtQ) / simTime;
      sumBufferOcc += st.bufferCapacity > 0 ? Math.min(100, (avgQueue / st.bufferCapacity) * 100) : 0;

      const avgStageCycle = acc.batchesCompleted > 0 ? acc.cycleTimeSum / acc.batchesCompleted : 0;
      const avgUnitWait = acc.entered > 0 ? acc.waitTimeSum / acc.entered : 0;
      const avgBatchWait =
        acc.batchWaitCount > 0 ? acc.batchWaitTimeSum / acc.batchWaitCount : avgUnitWait;
      const avgQueueWait =
        acc.entered > 0 ? acc.queueWaitTimeSum / acc.entered : avgUnitWait;

      const stageProfile =
        stageCapacityProfiles.get(st.id) ??
        computeStageCapacityProfile(st, resolveStageObjects(st));
      const cyclePressureBonus =
        maxStageEffectiveCycle > 0
          ? (stageProfile.effectiveUnitCycleSec / maxStageEffectiveCycle) *
            8 *
            Math.min(1, (utilPct + setupPct) / 100)
          : 0;
      const stTaskTime =
        (st.processingTimeSec || 0) + (st.loadingTimeSec || 0) + (st.unloadingTimeSec || 0);
      const effectiveQueueSignal = blkPct < 20 ? Math.min(25, avgQueue * 0.5) : 0;
      const bottleneckScore =
        stTaskTime > 0
          ? utilPct + setupPct + effectiveQueueSignal + cyclePressureBonus - blkPct * 0.25
          : utilPct * 0.1;
      if (bottleneckScore > highestUtilOrWait) {
        highestUtilOrWait = bottleneckScore;
        bottleneckStageId = st.id;
        bottleneckStageName = st.name;
      }

      const bCfg = this.stageBatchConfigs.get(st.id);

      stageAnalytics.push({
        stageId: st.id,
        stageName: st.name,
        enteredCount: acc.entered,
        completedCount: acc.completed,
        scrapCount: acc.scrapped,
        scrappedBatches: acc.scrappedBatches,
        reworkCount: acc.reworked,
        reworkCycles: acc.reworkCycles,
        reworkBatches: acc.reworkBatches,
        avgCycleTimeSec: avgStageCycle,
        avgWaitTimeSec: avgUnitWait,
        avgUnitWaitTimeSec: avgUnitWait,
        avgBatchWaitTimeSec: avgBatchWait,
        avgQueueWaitTimeSec: avgQueueWait,
        starvedTimeSec: starvedT,
        blockedTimeSec: blkT,
        conveyorTransitTimeSec: acc.conveyorTransitTimeSum,
        avgQueueLength: avgQueue,
        maxQueueLength: acc.maxQueue,
        utilizationPct: utilPct,
        scheduledUtilizationPct,
        calendarUtilizationPct,
        unavailablePct,
        blockedPct: blkPct,
        starvedPct,
        idlePct,
        setupPct,
        downPct,
        maintenancePct,
        calendarTimeSec: avgCalSec,
        scheduledTimeSec: avgSchedSec,
        plannedDowntimeSec: avgPlannedDownSec,
        isBottleneck: false,
        batchesCompleted: acc.batchesCompleted,
        batchSize: bCfg?.batchSize ?? 1,
        batchMode: bCfg?.batchMode ?? 'single',
      });
    }

    for (const sa of stageAnalytics) {
      if (sa.stageId === bottleneckStageId) sa.isBottleneck = true;
    }

    // Build per-resource OEE analytics using each resource's individual assigned shift/maintenance calendar
    const stageByObjId = new Map<string, ProductionStage>();
    for (const st of this.project.stages) {
      for (const oid of st.assignedObjectIds) {
        if (!stageByObjId.has(oid)) stageByObjId.set(oid, st);
      }
    }

    const resourceAnalytics: ResourceOeeAnalytics[] = [];
    for (const obj of this.objectsMap.values()) {
      if (obj.kind === 'storage' || obj.kind === 'vehicle' || obj.kind === 'buffer') continue;
      if (!obj.rendering.visible && !stageByObjId.has(obj.id)) continue;

      const st = stageByObjId.get(obj.id);
      const stState = this.objectStates.get(obj.id);
      const totals = this.stateTracker.getMachineTotals(obj.id, simTime);
      const convTotals =
        obj.kind === 'conveyor' ? this.stateTracker.getConveyorTotals(obj.id, simTime) : undefined;
      const cal = this.calendarEngine.getObjectCalendarMetrics(obj, simTime);
      const shiftRes = this.calendarEngine.resolveResourceShiftStatus(
        obj.operations.shiftId,
        obj.operations.operatingSchedule
      );

      const objCap =
        obj.kind === 'machine' || obj.kind === 'workstation'
          ? Math.max(1, Math.round(Number(obj.operations.capacity || 1)))
          : 1;
      let idealUnitCycleSec = 0;
      if (st) {
        const assignedObjs = st.assignedObjectIds
          .map((id) => this.objectsMap.get(id))
          .filter((o): o is LayoutObject => Boolean(o));
        const profile = computeStageCapacityProfile(st, assignedObjs);
        idealUnitCycleSec =
          profile.baseTaskTimeSec > 0
            ? (profile.baseTaskTimeSec + profile.batchTransferTimeSec) /
              (objCap * profile.effectiveBatchDivisor)
            : 0;
      } else {
        const opTask =
          (obj.operations.processingTimeSec || 0) +
          (obj.operations.loadingTimeSec || 0) +
          (obj.operations.unloadingTimeSec || 0);
        const bDiv =
          obj.operations.batchMode === 'collect_batch'
            ? Math.max(1, obj.operations.batchSize || 1)
            : 1;
        idealUnitCycleSec = opTask > 0 ? opTask / (objCap * bDiv) : 0;
      }

      const processed = stState?.processedCount ?? 0;
      const scrapRes = stState?.scrapCount ?? 0;
      const goodRes = Math.max(0, processed - scrapRes);
      const runTime =
        totals.running > 0 ? totals.running : convTotals?.moving ?? totals.running;
      const unavailTime =
        totals.unavailable > 0 ? totals.unavailable : convTotals?.unavailable ?? totals.unavailable;

      const resOee = computeOeeMetrics({
        calendarTimeSec: cal.calendarTimeSec,
        plannedDowntimeSec: cal.plannedDowntimeSec,
        unplannedDowntimeSec: totals.down,
        setupTimeSec: totals.setup,
        idealCycleTimeSec: idealUnitCycleSec,
        totalUnitsProcessed: processed,
        goodUnitsProduced: goodRes,
        measuredRunningTimeSec: runTime,
      });

      const schedUtilPct =
        cal.scheduledProductionTimeSec > 1e-6
          ? Math.min(100, (runTime / cal.scheduledProductionTimeSec) * 100)
          : 0;
      const calUtilPct =
        cal.calendarTimeSec > 1e-6 ? Math.min(100, (runTime / cal.calendarTimeSec) * 100) : 0;

      resourceAnalytics.push({
        objectId: obj.id,
        objectName: obj.name,
        kind: obj.kind,
        stageId: st?.id || obj.stageId,
        shiftId: obj.operations.shiftId || obj.operations.operatingSchedule,
        calendarTimeSec: resOee.calendarTimeSec,
        plannedDowntimeSec: resOee.plannedDowntimeSec,
        scheduledProductionTimeSec: resOee.scheduledProductionTimeSec,
        unplannedDowntimeSec: resOee.unplannedDowntimeSec,
        setupTimeSec: resOee.setupTimeSec,
        operatingTimeSec: resOee.operatingTimeSec,
        runningTimeSec: runTime,
        idleTimeSec: totals.idle,
        starvedTimeSec: totals.starved,
        blockedTimeSec: totals.blocked,
        maintenanceTimeSec: totals.maintenance,
        unavailableTimeSec: unavailTime,
        scheduledUtilizationPct: schedUtilPct,
        calendarUtilizationPct: calUtilPct,
        idealCycleTimeSec: idealUnitCycleSec,
        processedCount: processed,
        goodCount: goodRes,
        scrapCount: scrapRes,
        availabilityPct: resOee.availabilityPct,
        performancePct: resOee.performancePct,
        qualityPct: resOee.qualityPct,
        oeePct: resOee.oeePct,
      });
    }

    // Worker utilization & per-worker assignedTo analysis across each worker's individual scheduled calendar window
    let workerActiveRatioSum = 0;
    const workerAnalytics: WorkerAnalytics[] = [];
    for (const w of this.project.workers) {
      const wt = this.stateTracker.getWorkerTotals(w.id, simTime);
      const ws = this.workerStates.get(w.id);
      const wSched = Math.max(0, wt.busy + wt.walking + wt.idle);
      const utilRatio = wSched > 1e-6 ? Math.min(1, (wt.busy + wt.walking) / wSched) : 0;
      const workUtilRatio = wSched > 1e-6 ? Math.min(1, wt.busy / wSched) : 0;
      workerActiveRatioSum += utilRatio;

      const assignedTo = w.assignedTo || w.assignedStationId;
      const targetObj = assignedTo ? this.objectsMap.get(assignedTo) : undefined;
      const segIdx =
        targetObj?.kind === 'conveyor' && w.assignedConveyorSegment?.objectId === targetObj.id
          ? w.assignedConveyorSegment.segmentIndex
          : undefined;

      workerAnalytics.push({
        workerId: w.id,
        workerLabel: w.label,
        workerName: w.name,
        assignedTo,
        assignedToName: targetObj?.name,
        assignedToKind: targetObj?.kind,
        assignedConveyorSegmentIndex: segIdx,
        shiftId: w.shiftId,
        tasksCompleted: ws?.tasksCompleted ?? 0,
        busyTimeSec: wt.busy,
        walkingTimeSec: wt.walking,
        idleTimeSec: wt.idle,
        unavailableTimeSec: wt.unavailable + wt.break,
        scheduledTimeSec: wSched,
        workUtilizationPct: workUtilRatio * 100,
        utilizationPct: utilRatio * 100,
      });
    }
    const workerUtilizationPct =
      this.project.workers.length > 0
        ? Math.min(100, (workerActiveRatioSum / this.project.workers.length) * 100)
        : 0;

    const machineUtilizationPct =
      stageAnalytics.length > 0
        ? stageAnalytics.reduce((a, b) => a + b.utilizationPct, 0) / stageAnalytics.length
        : 0;

    const calendarUtilizationPct =
      stageAnalytics.length > 0 ? sumCalendarUtil / stageAnalytics.length : 0;

    const avgWip = this.wipArea / simTime;
    const avgQueueLength =
      stageAnalytics.length > 0
        ? stageAnalytics.reduce((a, b) => a + b.avgQueueLength, 0) / stageAnalytics.length
        : 0;
    const avgBufferOccupancyPct =
      stageAnalytics.length > 0 ? sumBufferOcc / stageAnalytics.length : 0;

    const totalHourCount = Math.max(1, Math.ceil(simTime / 3600));
    const hourlySeries: HourlyProductionPoint[] = [];
    let cumActual = 0;
    for (let h = 1; h <= totalHourCount; h++) {
      const hGood = this.hourlyGood.get(h) || 0;
      const hScrap = this.hourlyScrap.get(h) || 0;
      cumActual += hGood;
      const plannedCum = Math.round(
        (planned * Math.min(h * 3600, simTime)) / Math.max(1, this.project.simulationConfig.durationSec)
      );
      hourlySeries.push({
        hourIndex: h,
        label: `Hr ${h}`,
        plannedCumulative: plannedCum,
        actualCumulative: cumActual,
        hourlyGood: hGood,
        hourlyScrap: hScrap,
        avgWip: avgWip,
      });
    }

    // Per-product WIP, lead time, and analytics breakdown
    const wipByProduct = new Map<string, number>();
    const leadSumByProduct = new Map<string, number>();
    const leadQtyByProduct = new Map<string, number>();
    for (const ent of this.entities.values()) {
      if (ent.absorbedIntoEntityId) continue;
      const qty = Math.max(1, ent.batchCount ?? 1);
      if (!ent.scrapped && ent.completedAt === undefined) {
        wipByProduct.set(ent.productId, (wipByProduct.get(ent.productId) || 0) + qty);
      } else if (!ent.scrapped && ent.completedAt !== undefined) {
        const lead = Math.max(0, ent.completedAt - ent.createdAt);
        leadSumByProduct.set(ent.productId, (leadSumByProduct.get(ent.productId) || 0) + lead * qty);
        leadQtyByProduct.set(ent.productId, (leadQtyByProduct.get(ent.productId) || 0) + qty);
      }
    }

    const productAnalytics: ProductAnalytics[] = this.project.products.map((p) => {
      const quota = this.productTargetQuota.get(p.id);
      const releasedQty = this.productReleasedCount.get(p.id) || 0;
      const completedGoodQty = this.productCompletedCount.get(p.id) || 0;
      const scrappedQty = this.productScrappedCount.get(p.id) || 0;
      const wipQty = wipByProduct.get(p.id) || 0;
      const reworkUnits = this.productReworkUnits.get(p.id) || 0;
      const reworkCycles = this.productReworkCycles.get(p.id) || 0;
      const leadQty = leadQtyByProduct.get(p.id) || 0;
      const avgLeadTimeSec = leadQty > 0 ? (leadSumByProduct.get(p.id) || 0) / leadQty : 0;
      const plannedQty =
        quota !== undefined && Number.isFinite(quota) && quota > 0
          ? quota
          : p.targetQuantity > 0
          ? p.targetQuantity
          : releasedQty;
      const attainmentPct = plannedQty > 0 ? (completedGoodQty / plannedQty) * 100 : 0;

      return {
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        color: p.color,
        plannedQty,
        releasedQty,
        completedGoodQty,
        scrappedQty,
        wipQty,
        reworkUnits,
        reworkCycles,
        avgLeadTimeSec,
        attainmentPct,
      };
    });

    const avgBatchWaitingTimeSec =
      finishedBatchEntities > 0
        ? batchQueueWaitEntitySum / finishedBatchEntities
        : stageBatchWaitCountSum > 0
        ? stageBatchWaitWeightedSum / stageBatchWaitCountSum
        : avgUnitWaitingTimeSec;
    const avgQueueWaitingTimeSec =
      stageEnteredSum > 0 ? stageQueueWaitWeightedSum / stageEnteredSum : avgUnitWaitingTimeSec;

    const kpis = buildAuditedSimulationKPIs({
      project: this.project,
      shiftAudit,
      goodUnits: good,
      scrappedUnits: scrap,
      scrappedBatches: totalScrappedBatches,
      reworkUnits: totalReworkUnits,
      reworkCycles: totalReworkCycles,
      reworkBatches: totalReworkBatches,
      totalBatchesCompleted: this.completedBatches,
      avgLeadTimeSec,
      avgWaitingTimeSec,
      avgUnitWaitingTimeSec,
      avgBatchWaitingTimeSec,
      avgQueueWaitingTimeSec,
      avgProcessingTimeSec,
      avgTransportTimeSec,
      totalConveyorTransitTimeSec,
      totalDowntimeSec: totalDowntime,
      totalBlockedTimeSec: totalBlocked,
      totalStarvedTimeSec: totalStarved,
      totalIdleTimeSec: totalIdle,
      totalSetupTimeSec: totalSetup,
      totalMaintenanceTimeSec: totalMaintenance,
      workerUtilizationPct,
      machineUtilizationPct,
      calendarUtilizationPct,
      avgWip,
      currentWip: this.getActiveWipCount(),
      avgQueueLength,
      avgBufferOccupancyPct,
      stageAnalytics,
      resourceAnalytics,
      productAnalytics,
      bottleneckStageId,
      bottleneckStageName,
    });

    return {
      completedAtWallTime: new Date().toISOString(),
      simTimeSec: simTime,
      kpis,
      stageAnalytics,
      resourceAnalytics,
      workerAnalytics,
      productAnalytics,
      hourlySeries,
      wipSeries: this.wipSeries,
      recentEvents: this.eventLog.slice(-150),
      totalEventsExecuted: this.totalEventsExecuted,
    };
  }
}
