import {
  HourlyProductionPoint,
  LayoutObject,
  ProductDefinition,
  ProductEntityState,
  ProductionStage,
  ProjectData,
  SimEvent,
  SimEventType,
  SimulationKPIs,
  SimulationResult,
  SimulationSnapshot,
  StageAnalytics,
  Vec3,
  WipTimePoint,
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
  computeWorkerTravelAudit,
  distance2D as auditDistance2D,
  resolveArrivalIntervalSec,
  resolveObjectFailureParams,
  resolveStageBatchConfig,
  StageBatchConfig,
} from './timeAuditService';

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
  fromStageId: string;
  toStageId: string;
  startTime: number;
  endTime: number;
  waypoints: Vec3[];
  cumLengths: number[];
  totalLength: number;
}

interface HeldBatchItem {
  entityId: string;
  arrivedAt: number;
  units: number;
}

interface StageAcc {
  entered: number;
  completed: number;
  batchesCompleted: number;
  scrapped: number;
  reworked: number;
  cycleTimeSum: number;
  waitTimeSum: number;
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

  public clockSec = 0;
  public status: SimulationSnapshot['status'] = 'idle';
  private shiftActive = true;
  private onBreak = false;

  private objectsMap = new Map<string, LayoutObject>();
  private stagesMap = new Map<string, ProductionStage>();
  private workersMap = new Map<string, WorkerDefinition>();
  private productsMap = new Map<string, ProductDefinition>();

  private objectStates = new Map<string, ObjectRuntimeState>();
  private workerStates = new Map<string, WorkerRuntimeState>();
  private workerAllocatedEntity = new Map<string, string | null>();
  private entities = new Map<string, ProductEntityState>();

  private stageBuffers = new Map<string, string[]>(); // stageId -> queued entityIds ready for machine/station
  private stageBatchHolders = new Map<string, HeldBatchItem[]>(); // stageId -> loose items accumulating into a batch/pallet
  private stageBatchConfigs = new Map<string, StageBatchConfig>();
  private stageUpstreamClosures = new Map<string, Set<string>>();
  private stageInTransitCounts = new Map<string, number>(); // stageId -> units currently in transit toward this stage
  private blockedOutbox = new Map<string, Array<{ entityId: string; objectId: string; nextStageId: string }>>();
  private conveyorTransits = new Map<string, ConveyorTransit>(); // entityId -> active transit
  private conveyorOccupancy = new Map<string, number>(); // conveyorId -> active carriers physically on belt
  private conveyorLastEntryTime = new Map<string, number>();
  private setupDoneObjects = new Set<string>();
  private sourceWaiting: { waiting: boolean; productId: string; lastReleaseTime: number } | null = null;
  private sourceTimerScheduled = false;

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

  private hourlyGood = new Map<number, number>();
  private hourlyScrap = new Map<number, number>();

  private eventLog: SimEvent[] = [];
  private totalEventsExecuted = 0;
  private nextBreakdownAt = new Map<string, number>();

  constructor(project: ProjectData) {
    this.project = this.ensureRoutingReady(structuredClone(project));
    this.rng = mulberry32(this.project.simulationConfig.randomSeed || 4219);
    this.initialize();
  }

  /**
   * Imports and binds a Flowchart project snapshot directly into the DES engine
   * and re-initializes runtime buffers, machine specs, and routes.
   */
  public importFlowchartRoutes(projectSnapshot?: ProjectData): void {
    const base = structuredClone(projectSnapshot || this.project);
    const { updated } = importFlowchartToSimulationData(base);
    this.project = updated;
    this.initialize();
  }

  private ensureRoutingReady(raw: ProjectData): ProjectData {
    const isManualFlow = raw.products.some((p) => p.routingMode === 'manual');
    if (isManualFlow) {
      // Strictly preserve user-drawn Flowchart wires & bind every node to floor equipment
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
    this.clockSec = 0;
    this.status = 'idle';
    this.shiftActive = false;
    this.onBreak = false;

    this.objectsMap.clear();
    this.stagesMap.clear();
    this.workersMap.clear();
    this.productsMap.clear();
    this.objectStates.clear();
    this.workerStates.clear();
    this.workerAllocatedEntity.clear();
    this.entities.clear();
    this.stageBuffers.clear();
    this.stageBatchHolders.clear();
    this.stageBatchConfigs.clear();
    this.stageUpstreamClosures.clear();
    this.stageInTransitCounts.clear();
    this.blockedOutbox.clear();
    this.conveyorTransits.clear();
    this.conveyorOccupancy.clear();
    this.conveyorLastEntryTime.clear();
    this.setupDoneObjects.clear();
    this.sourceWaiting = null;
    this.sourceTimerScheduled = false;
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
    this.nextBreakdownAt.clear();
    this.rng = mulberry32(this.project.simulationConfig.randomSeed || 4219);

    for (const obj of this.project.layoutObjects) {
      this.objectsMap.set(obj.id, obj);
      if (obj.kind === 'conveyor') {
        this.conveyorOccupancy.set(obj.id, 0);
      }
      this.objectStates.set(obj.id, {
        objectId: obj.id,
        status: 'idle',
        busyUnitIds: [],
        queueUnitIds: [],
        processedCount: 0,
        scrapCount: 0,
        runningTimeSec: 0,
        idleTimeSec: 0,
        blockedTimeSec: 0,
        starvedTimeSec: 0,
        downTimeSec: 0,
        lastStateChangeTime: 0,
      });

      const failureParams = resolveObjectFailureParams(obj, this.project.simulationConfig);
      if (failureParams.enabled && failureParams.mtbfSec > 0) {
        const firstFail = this.sampleExponential(failureParams.mtbfSec);
        this.nextBreakdownAt.set(obj.id, firstFail);
      }
    }

    for (let idx = 0; idx < this.project.stages.length; idx++) {
      const st = this.project.stages[idx];
      // Guarantee every stage (even virtual Flowchart-only stages) has an executable runtime slot
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
          downTimeSec: 0,
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
        reworked: 0,
        cycleTimeSum: 0,
        waitTimeSum: 0,
        queueArea: 0,
        lastQueueTime: 0,
        maxQueue: 0,
        waitingEnterTimes: new Map(),
        stageEnterTimes: new Map(),
        processingStartTimes: new Map(),
      });
    }

    // Build transitive upstream closures for safe end-of-order partial batch flushing
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
      this.workerStates.set(w.id, {
        workerId: w.id,
        status: 'idle',
        currentStationId: w.assignedStationId,
        position: { ...w.position },
        startPosition: { ...w.position },
        targetPosition: { ...w.position },
        moveStartTime: 0,
        moveEndTime: 0,
        busyTimeSec: 0,
        walkingTimeSec: 0,
        idleTimeSec: 0,
        tasksCompleted: 0,
        lastStateChangeTime: 0,
      });
    }

    for (const p of this.project.products) {
      this.productsMap.set(p.id, p);
    }

    // Schedule shifts & breaks
    const cfg = this.project.simulationConfig;
    if (cfg.shifts.length === 0) {
      this.schedule(0, 'ShiftStarted', { details: 'Default shift started' });
      this.schedule(cfg.durationSec, 'ShiftEnded', { details: 'Default shift ended' });
    } else {
      for (const sh of cfg.shifts) {
        this.schedule(sh.startSec, 'ShiftStarted', {
          details: `Shift started: ${sh.name}`,
          payload: { shiftId: sh.id },
        });
        this.schedule(Math.min(cfg.durationSec, sh.startSec + sh.durationSec), 'ShiftEnded', {
          details: `Shift ended: ${sh.name}`,
          payload: { shiftId: sh.id },
        });
        for (const brk of sh.breaks) {
          if (brk.startSec < cfg.durationSec) {
            this.schedule(brk.startSec, 'MachineStopped', {
              details: `Break started: ${brk.name}`,
              payload: { breakStart: true, breakName: brk.name },
            });
            const endBrk = Math.min(cfg.durationSec, brk.startSec + brk.durationSec);
            this.schedule(endBrk, 'MachineStarted', {
              details: `Break ended: ${brk.name}`,
              payload: { breakEnd: true, breakName: brk.name },
            });
          }
        }
      }
    }

    // Schedule initial product creation at t = 0 if products and stages exist
    if (this.project.products.length > 0 && this.project.stages.length > 0) {
      this.sourceTimerScheduled = true;
      this.schedule(0, 'ProductCreated', {
        details: 'Initial unit release scheduled',
        payload: { productId: this.project.products[0].id },
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
    return computeConveyorMetrics(conv, prod, carrierLen).physicalCapacity;
  }

  private sampleExponential(mean: number): number {
    const u = Math.max(1e-6, 1 - this.rng());
    return -mean * Math.log(u);
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
    for (const ent of this.entities.values()) {
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

  private setObjectStatus(objId: string, nextStatus: ObjectRuntimeState['status'], now: number): void {
    const st = this.objectStates.get(objId);
    if (!st) return;
    const dt = Math.max(0, now - st.lastStateChangeTime);
    if (st.status === 'running') st.runningTimeSec += dt;
    else if (st.status === 'idle') st.idleTimeSec += dt;
    else if (st.status === 'blocked') st.blockedTimeSec += dt;
    else if (st.status === 'starved') st.starvedTimeSec += dt;
    else if (st.status === 'down') st.downTimeSec += dt;
    st.status = nextStatus;
    st.lastStateChangeTime = now;
  }

  private setWorkerStatus(
    workerId: string,
    nextStatus: WorkerRuntimeState['status'],
    now: number
  ): void {
    const ws = this.workerStates.get(workerId);
    if (!ws) return;
    const dt = Math.max(0, now - ws.lastStateChangeTime);
    if (ws.status === 'busy') ws.busyTimeSec += dt;
    else if (ws.status === 'walking') ws.walkingTimeSec += dt;
    else if (ws.status === 'idle') ws.idleTimeSec += dt;
    ws.status = nextStatus;
    ws.lastStateChangeTime = now;
  }

  private updateQueueIntegral(stageId: string, now: number): void {
    const acc = this.stageAcc.get(stageId);
    if (!acc) return;
    const dt = Math.max(0, now - acc.lastQueueTime);
    const qUnits = this.getStageQueueUnitCount(stageId);
    acc.queueArea += qUnits * dt;
    acc.lastQueueTime = now;
    if (qUnits > acc.maxQueue) acc.maxQueue = qUnits;
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
      this.finalizeAt(this.clockSec);
      return false;
    }
    const next = this.queue.peek()!;
    if (next.timestamp > this.project.simulationConfig.durationSec) {
      this.finalizeAt(this.project.simulationConfig.durationSec);
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
    for (const objId of this.objectStates.keys()) {
      const st = this.objectStates.get(objId)!;
      this.setObjectStatus(objId, st.status, endSec);
    }
    for (const wid of this.workerStates.keys()) {
      const ws = this.workerStates.get(wid)!;
      this.setWorkerStatus(wid, ws.status, endSec);
    }
    for (const stageId of this.stageAcc.keys()) {
      this.updateQueueIntegral(stageId, endSec);
    }
    this.updateWipIntegral(endSec);
    this.status = 'completed';
  }

  private updateInterpolatedPositions(now: number): void {
    for (const tr of this.conveyorTransits.values()) {
      const ent = this.entities.get(tr.entityId);
      if (!ent) continue;
      const span = Math.max(0.001, tr.endTime - tr.startTime);
      const t = Math.max(0, Math.min(1, (now - tr.startTime) / span));
      ent.conveyorProgress = t;
      const targetDist = t * tr.totalLength;
      const pts = tr.waypoints;
      if (pts.length >= 2) {
        let segIdx = 0;
        for (let i = 1; i < tr.cumLengths.length; i++) {
          if (targetDist <= tr.cumLengths[i] || i === tr.cumLengths.length - 1) {
            segIdx = i - 1;
            break;
          }
        }
        const d0 = tr.cumLengths[segIdx];
        const d1 = tr.cumLengths[segIdx + 1];
        const localT = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
        const p0 = pts[segIdx];
        const p1 = pts[segIdx + 1];
        ent.worldPosition = {
          x: p0.x + (p1.x - p0.x) * localT,
          y: p0.y + (p1.y - p0.y) * localT,
          z: p0.z + (p1.z - p0.z) * localT,
        };
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

  private processEvent(ev: InternalEvent): void {
    this.clockSec = ev.timestamp;
    this.updateWipIntegral(ev.timestamp);
    this.recordEvent(ev);

    switch (ev.type) {
      case 'ShiftStarted': {
        this.shiftActive = true;
        this.onBreak = false;
        this.tryDispatchAllStages(ev.timestamp);
        break;
      }
      case 'ShiftEnded': {
        this.shiftActive = false;
        break;
      }
      case 'MachineStopped': {
        if (ev.payload?.breakStart) {
          this.onBreak = true;
          for (const wid of this.workerStates.keys()) {
            const ws = this.workerStates.get(wid)!;
            if (ws.status === 'idle') {
              this.setWorkerStatus(wid, 'break', ev.timestamp);
            }
          }
        }
        break;
      }
      case 'MachineStarted': {
        if (ev.payload?.breakEnd) {
          this.onBreak = false;
          for (const wid of this.workerStates.keys()) {
            const ws = this.workerStates.get(wid)!;
            if (ws.status === 'break') {
              this.setWorkerStatus(wid, 'idle', ev.timestamp);
            }
          }
          this.tryDispatchAllStages(ev.timestamp);
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
        if (this.sourceWaiting?.waiting && !this.sourceTimerScheduled) {
          const interval = resolveArrivalIntervalSec(this.project.simulationConfig);
          const readyAt = Math.max(ev.timestamp, this.sourceWaiting.lastReleaseTime + interval);
          if (readyAt < this.project.simulationConfig.durationSec) {
            this.sourceTimerScheduled = true;
            this.schedule(readyAt, 'ProductCreated', {
              details: 'Resumed raw unit release after downstream slot opened',
              payload: { productId: this.sourceWaiting.productId },
            });
          }
        }
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
      const hasFreeStation = Boolean(this.findAvailableStation(st));
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

  private handleProductCreated(ev: InternalEvent): void {
    this.sourceTimerScheduled = false;
    const cfg = this.project.simulationConfig;
    const product =
      this.productsMap.get(String(ev.payload?.productId || '')) || this.project.products[0];
    if (!product) return;

    const shiftAudit = computeShiftWindowAudit(cfg, product, ev.timestamp);
    if (Number.isFinite(shiftAudit.plannedUnitsCap) && this.totalArrived >= shiftAudit.plannedUnitsCap) {
      this.sourceWaiting = null;
      return;
    }
    if (ev.timestamp >= cfg.durationSec) {
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

    // Respect finite buffer + in-transit capacity AND conveyor physical capacity dynamically
    const firstBuffer = this.stageBuffers.get(firstStageId)!;
    const firstBatchHolder = this.stageBatchHolders.get(firstStageId) || [];
    const firstBatchCfg = this.stageBatchConfigs.get(firstStageId);
    const inTransitToFirst = this.stageInTransitCounts.get(firstStageId) || 0;
    const firstObj = this.objectsMap.get(firstStage.assignedObjectIds[0]);
    const freeFirstStation = this.findAvailableStation(firstStage, product);
    const hasFreeFirstSlot =
      Boolean(freeFirstStation) &&
      (firstStage.requiredWorkers <= 0 ||
        Boolean(
          freeFirstStation &&
            this.findAvailableWorkers(firstStage, freeFirstStation, firstStage.requiredWorkers)
        ));
    const entryConveyorFull =
      firstObj?.kind === 'conveyor' &&
      (this.conveyorOccupancy.get(firstObj.id) || 0) >= this.getConveyorPhysicalCapacity(firstObj, product);

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
      // Wait reactively for BufferReleased instead of polling & piling phantom WIP
      this.sourceWaiting = {
        waiting: true,
        productId: product.id,
        lastReleaseTime: this.sourceWaiting?.lastReleaseTime ?? ev.timestamp,
      };
      return;
    }

    if (this.shiftActive && !this.onBreak) {
      this.sourceWaiting = null;
      this.entityCounter++;
      this.totalArrived++;
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
        locationKind: 'source',
        worldPosition: startPos,
        waitingTimeSec: 0,
        processingTimeSec: 0,
        transportTimeSec: 0,
        batchCount: 1,
      };
      this.entities.set(entId, entity);

      this.schedule(ev.timestamp, 'ProductArrived', {
        entityId: entId,
        stageId: firstStageId,
        details: `Unit #${this.entityCounter} (${product.code}) arrived at ${firstStage.name}`,
      });
    } else {
      this.sourceWaiting = {
        waiting: true,
        productId: product.id,
        lastReleaseTime: ev.timestamp,
      };
    }

    const nextInterval = shiftAudit.arrivalIntervalSec;
    if (ev.timestamp + nextInterval < cfg.durationSec && !this.sourceTimerScheduled) {
      this.sourceTimerScheduled = true;
      this.schedule(ev.timestamp + nextInterval, 'ProductCreated', {
        details: 'Next raw material unit release',
        payload: { productId: product.id },
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
      }
    }

    this.entities.set(carrierId, carrier);
    buf.push(carrierId);
    acc.waitingEnterTimes.set(carrierId, now);
    acc.stageEnterTimes.set(carrierId, now);
    this.tryStartStage(stageId, now);
  }

  private tryFlushPartialBatchesIfExhausted(now: number): void {
    const primaryProduct = this.project.products[0];
    const shiftAudit = computeShiftWindowAudit(this.project.simulationConfig, primaryProduct, now);
    const sourceDone =
      !this.shiftActive ||
      (Number.isFinite(shiftAudit.plannedUnitsCap) && this.totalArrived >= shiftAudit.plannedUnitsCap);
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
        for (const ent of this.entities.values()) {
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

      const popped = holder.splice(0, holder.length);
      this.assembleBatchCarrier(stage.id, popped, batchCfg, now);
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

    // Only increment entered if this entity wasn't already counted via rework/batch creation at this stage
    const isReworkLoop = acc.stageEnterTimes.has(entId);
    if (!isReworkLoop) {
      acc.entered += incomingUnits;
    }

    // Case 1: Unbatch carrier back into individual units
    if (!isReworkLoop && batchCfg?.batchMode === 'unbatch' && incomingUnits > 1) {
      ent.absorbedIntoEntityId = `${entId}_unbatched`;
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
          locationKind: 'buffer',
          worldPosition: stationObj
            ? {
                x: stationObj.geometry.position.x - 0.65 + (i % 3) * 0.28,
                y: stationObj.geometry.dimensions.height + 0.05,
                z: stationObj.geometry.position.z + (i >= 3 ? 0.25 : -0.25),
              }
            : { ...ent.worldPosition },
          waitingTimeSec: ent.waitingTimeSec,
          processingTimeSec: ent.processingTimeSec,
          transportTimeSec: ent.transportTimeSec,
          batchCount: 1,
        };
        this.entities.set(childId, child);
        buf.push(childId);
        acc.waitingEnterTimes.set(childId, ev.timestamp);
        acc.stageEnterTimes.set(childId, ev.timestamp);
      }
      this.tryStartStage(stageId, ev.timestamp);
      return;
    }

    // Case 2: Collect loose items into grouped pallet/carton/pack carrier
    if (
      !isReworkLoop &&
      batchCfg?.batchMode === 'collect_batch' &&
      batchCfg.batchSize > 1 &&
      incomingUnits < batchCfg.batchSize
    ) {
      const holder = this.stageBatchHolders.get(stageId)!;
      holder.push({ entityId: entId, arrivedAt: ev.timestamp, units: incomingUnits });
      if (stationObj) {
        const idx = holder.length - 1;
        ent.worldPosition = {
          x: stationObj.geometry.position.x - 0.55 + (idx % 3) * 0.3,
          y: stationObj.geometry.dimensions.height + 0.05,
          z: stationObj.geometry.position.z + (Math.floor(idx / 3) - 0.5) * 0.28,
        };
      }

      let heldUnits = holder.reduce((sum, item) => sum + item.units, 0);
      while (heldUnits >= batchCfg.batchSize) {
        const picked: HeldBatchItem[] = [];
        let pickedUnits = 0;
        while (holder.length > 0 && pickedUnits < batchCfg.batchSize) {
          const head = holder.shift()!;
          picked.push(head);
          pickedUnits += head.units;
        }
        heldUnits -= pickedUnits;
        this.assembleBatchCarrier(stageId, picked, batchCfg, ev.timestamp);
      }

      if (holder.length > 0) {
        this.tryFlushPartialBatchesIfExhausted(ev.timestamp);
      }
      return;
    }

    // Case 3: Single-unit processing OR already-formed batch carrier >= stage targetBatchSize
    buf.push(entId);
    acc.waitingEnterTimes.set(entId, ev.timestamp);
    if (!acc.stageEnterTimes.has(entId)) {
      acc.stageEnterTimes.set(entId, ev.timestamp);
    }

    if (stationObj) {
      const idx = buf.length - 1;
      ent.worldPosition = {
        x: stationObj.geometry.position.x - 0.65 + (idx % 3) * 0.28,
        y: stationObj.geometry.dimensions.height + 0.05,
        z: stationObj.geometry.position.z + (idx >= 3 ? 0.25 : -0.25),
      };
    }

    this.tryStartStage(stageId, ev.timestamp);
  }

  private findAvailableStation(stage: ProductionStage, prod?: ProductDefinition): LayoutObject | undefined {
    for (const objId of stage.assignedObjectIds) {
      const obj = this.objectsMap.get(objId);
      const st = this.objectStates.get(objId);
      if (!obj || !st) continue;
      if (st.status === 'down' || st.status === 'blocked') continue;
      const cap =
        obj.kind === 'conveyor'
          ? this.getConveyorPhysicalCapacity(obj, prod)
          : Math.max(1, obj.operations.capacity);
      if (st.busyUnitIds.length < cap) {
        return obj;
      }
    }
    return undefined;
  }

  private findAvailableWorkers(stage: ProductionStage, stationObj: LayoutObject, count: number): WorkerDefinition[] | null {
    if (count <= 0) return [];
    const candidates: Array<{ worker: WorkerDefinition; dist: number; directMatch: boolean }> = [];

    for (const w of this.project.workers) {
      const ws = this.workerStates.get(w.id);
      if (!ws || ws.status !== 'idle') continue;
      if (this.workerAllocatedEntity.get(w.id) !== null) continue;

      const assignedToStage =
        w.assignedStageIds.includes(stage.id) || w.assignedStationId === stationObj.id;
      if (!assignedToStage) continue;

      const dist = distance2D(ws.position, stationObj.geometry.position);
      candidates.push({ worker: w, dist, directMatch: w.assignedStationId === stationObj.id });
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
    if (!this.shiftActive || this.onBreak) return;
    const stage = this.stagesMap.get(stageId);
    const buf = this.stageBuffers.get(stageId);
    const acc = this.stageAcc.get(stageId);
    if (!stage || !buf || !acc || buf.length === 0) return;

    while (buf.length > 0) {
      const nextEnt = this.entities.get(buf[0]);
      const nextProd = nextEnt ? this.productsMap.get(nextEnt.productId) : undefined;
      const stationObj = this.findAvailableStation(stage, nextProd);
      if (!stationObj) break;

      const neededWorkers = stationObj.kind === 'conveyor' ? 0 : Math.max(0, stage.requiredWorkers);
      const chosenWorkers = this.findAvailableWorkers(stage, stationObj, neededWorkers);
      if (!chosenWorkers) break;

      this.updateQueueIntegral(stageId, now);
      const entId = buf.shift()!;
      const ent = this.entities.get(entId);
      if (!ent) continue;

      const waitStart = acc.waitingEnterTimes.get(entId);
      if (waitStart !== undefined) {
        const waitDt = Math.max(0, now - waitStart);
        ent.waitingTimeSec += waitDt;
        acc.waitTimeSum += waitDt;
        acc.waitingEnterTimes.delete(entId);
      }

      // Reserve machine/station capacity
      const stState = this.objectStates.get(stationObj.id)!;
      stState.busyUnitIds.push(entId);
      this.setObjectStatus(stationObj.id, 'running', now);

      // Conveyor Flowchart Node: animate product gliding across the conveyor belt
      if (stationObj.kind === 'conveyor') {
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
        const minGapSec = convMetrics.minHeadwaySec;
        const halfL = Math.max(0.05, beltLen / 2 - Math.min(0.15, beltLen * 0.2));
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

        const lastEntry = this.conveyorLastEntryTime.get(stationObj.id) ?? -Infinity;
        const entryDelay = Math.max(0, lastEntry + minGapSec - now);
        this.conveyorLastEntryTime.set(stationObj.id, now + entryDelay);

        const startAt = now + entryDelay;
        const endAt = startAt + beltTime;
        ent.locationKind = 'conveyor';
        ent.currentObjectId = stationObj.id;
        ent.worldPosition = { ...pEntry };
        ent.transportTimeSec += beltTime + entryDelay;

        this.conveyorOccupancy.set(stationObj.id, (this.conveyorOccupancy.get(stationObj.id) || 0) + 1);
        this.conveyorTransits.set(entId, {
          entityId: entId,
          conveyorId: stationObj.id,
          fromStageId: stageId,
          toStageId: stageId,
          startTime: startAt,
          endTime: endAt,
          waypoints: [pEntry, pExit],
          cumLengths: [0, beltLen],
          totalLength: beltLen,
        });

        this.schedule(startAt, 'ProcessingStarted', {
          entityId: entId,
          stageId,
          objectId: stationObj.id,
          details: `${stationObj.name} conveying ${entId} (${beltLen.toFixed(1)}m @ ${speed} m/s = ${beltTime.toFixed(1)}s)`,
          payload: { workerIds: [], procDuration: beltTime, isConveyorNode: true },
        });
        this.schedule(now, 'BufferReleased', {
          stageId,
          details: `Queue slot freed at ${stage.name}`,
        });
        continue;
      }

      ent.locationKind = 'station';
      ent.currentObjectId = stationObj.id;
      ent.worldPosition = {
        x: stationObj.geometry.position.x,
        y: stationObj.geometry.dimensions.height,
        z: stationObj.geometry.position.z,
      };

      // Reserve workers & calculate deterministic walking time via timeAuditService
      let maxWalkTime = 0;
      const workerIds: string[] = [];

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
          this.setWorkerStatus(w.id, 'busy', now);
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
      const setupSec = needsSetup ? (stage.setupTimeSec || 0) : 0;
      const procBase = computeStageProcessingTimeSec(stage, stationObj, chosenWorkers, needsSetup);
      const startAt = now + maxWalkTime;

      this.schedule(startAt, 'ProcessingStarted', {
        entityId: entId,
        stageId,
        objectId: stationObj.id,
        details: `${stationObj.name} started processing ${entId}${setupSec > 0 ? ` (incl. ${setupSec}s setup)` : ''}`,
        payload: { workerIds, procDuration: procBase },
      });

      this.schedule(now, 'BufferReleased', {
        stageId,
        details: `Queue slot freed at ${stage.name}`,
      });
    }
  }

  private handleProcessingStarted(ev: InternalEvent): void {
    const workerIds = (ev.payload?.workerIds as string[]) || [];
    const procDuration = Math.max(0, Number(ev.payload?.procDuration ?? 0));
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
        ws.currentStationId = ev.objectId;
        this.setWorkerStatus(wid, 'busy', ev.timestamp);
      }
    }

    if (ev.objectId) {
      const nextFail = this.nextBreakdownAt.get(ev.objectId);
      const obj = this.objectsMap.get(ev.objectId);
      if (nextFail !== undefined && obj && ev.timestamp >= nextFail) {
        const failureParams = resolveObjectFailureParams(obj, this.project.simulationConfig);
        if (failureParams.enabled && failureParams.mttrSec > 0) {
          const repairDur = Math.max(1, this.sampleExponential(failureParams.mttrSec));
          this.schedule(ev.timestamp, 'BreakdownStarted', {
            objectId: ev.objectId,
            stageId: ev.stageId,
            details: `Unplanned breakdown on ${obj.name} (est. repair ${repairDur.toFixed(1)}s)`,
            payload: {
              repairDur,
              deferredCompletion: {
                entityId: ev.entityId,
                stageId: ev.stageId,
                objectId: ev.objectId,
                workerIds,
                procDuration,
              },
            },
          });
          return;
        }
      }
    }

    this.schedule(ev.timestamp + procDuration, 'ProcessingCompleted', {
      entityId: ev.entityId,
      stageId: ev.stageId,
      objectId: ev.objectId,
      details: `${ev.entityId} completed operation at ${ev.stageId}`,
      payload: { workerIds, procDuration },
    });
  }

  private handleBreakdownStarted(ev: InternalEvent): void {
    const objId = ev.objectId;
    if (!objId) return;
    const obj = this.objectsMap.get(objId);
    this.setObjectStatus(objId, 'down', ev.timestamp);
    const repairDur = Math.max(0, Number(ev.payload?.repairDur ?? obj?.operations.mttrSec ?? 0));

    this.schedule(ev.timestamp + repairDur, 'RepairCompleted', {
      objectId: objId,
      stageId: ev.stageId,
      details: `Repair completed on ${obj?.name || objId}`,
      payload: ev.payload,
    });
  }

  private handleRepairCompleted(ev: InternalEvent): void {
    const objId = ev.objectId;
    if (!objId) return;
    const obj = this.objectsMap.get(objId);
    if (obj) {
      const failureParams = resolveObjectFailureParams(obj, this.project.simulationConfig);
      if (failureParams.enabled && failureParams.mtbfSec > 0) {
        this.nextBreakdownAt.set(
          objId,
          ev.timestamp + this.sampleExponential(failureParams.mtbfSec)
        );
      }
    }

    const deferred = ev.payload?.deferredCompletion as
      | {
          entityId?: string;
          stageId?: string;
          objectId?: string;
          workerIds?: string[];
          procDuration?: number;
        }
      | undefined;

    if (deferred && deferred.entityId) {
      const resumedDur = Math.max(0, Number(deferred.procDuration ?? 0));
      this.setObjectStatus(objId, 'running', ev.timestamp);
      this.schedule(ev.timestamp + resumedDur, 'ProcessingCompleted', {
        entityId: deferred.entityId,
        stageId: deferred.stageId,
        objectId: deferred.objectId,
        details: `${deferred.entityId} resumed and completed after repair`,
        payload: { workerIds: deferred.workerIds || [], procDuration: resumedDur },
      });
    } else {
      this.setObjectStatus(objId, 'idle', ev.timestamp);
      if (ev.stageId) this.tryStartStage(ev.stageId, ev.timestamp);
    }
  }

  private handleProcessingCompleted(ev: InternalEvent): void {
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
    const activeTr = this.conveyorTransits.get(entId);
    if (activeTr) {
      this.conveyorTransits.delete(entId);
      this.conveyorOccupancy.set(
        activeTr.conveyorId,
        Math.max(0, (this.conveyorOccupancy.get(activeTr.conveyorId) || 1) - 1)
      );
      ent.conveyorProgress = undefined;
    } else {
      ent.processingTimeSec += procDuration;
    }

    // Release workers immediately when processing finishes
    const workerIds = (ev.payload?.workerIds as string[]) || [];
    for (const wid of workerIds) {
      this.workerAllocatedEntity.set(wid, null);
      const ws = this.workerStates.get(wid);
      if (ws) {
        ws.tasksCompleted++;
        this.setWorkerStatus(wid, this.onBreak ? 'break' : 'idle', ev.timestamp);
      }
      this.schedule(ev.timestamp, 'WorkerReleased', {
        entityId: entId,
        stageId,
        objectId: objId,
        workerId: wid,
        details: `Worker ${wid} released from ${stage.name}`,
      });
    }

    const unitCount = Math.max(1, ent.batchCount ?? 1);
    stState.processedCount += unitCount;
    acc.completed += unitCount;
    acc.batchesCompleted++;
    const procStart = acc.processingStartTimes.get(entId);
    const enterTime = acc.stageEnterTimes.get(entId);
    if (procStart !== undefined) {
      acc.cycleTimeSum += Math.max(0, ev.timestamp - procStart);
      acc.processingStartTimes.delete(entId);
    } else if (enterTime !== undefined) {
      acc.cycleTimeSum += Math.max(0, ev.timestamp - enterTime);
    }
    acc.stageEnterTimes.delete(entId);

    // Check scrap / rework
    if (stage.scrapRate > 0 && this.rng() < stage.scrapRate) {
      stState.busyUnitIds = stState.busyUnitIds.filter((id) => id !== entId);
      stState.scrapCount += unitCount;
      acc.scrapped += unitCount;
      ent.scrapped = true;
      ent.locationKind = 'scrapped';
      this.scrappedCount += unitCount;
      const hourBucket = Math.floor(ev.timestamp / 3600) + 1;
      this.hourlyScrap.set(hourBucket, (this.hourlyScrap.get(hourBucket) || 0) + unitCount);

      this.setObjectStatus(objId, stState.busyUnitIds.length > 0 ? 'running' : 'idle', ev.timestamp);
      this.schedule(ev.timestamp, 'ProductScrapped', {
        entityId: entId,
        stageId,
        objectId: objId,
        details: `${ent.batchLabel || entId} (${unitCount}u) scrapped at ${stage.name}`,
      });
      this.tryFlushPartialBatchesIfExhausted(ev.timestamp);
      this.tryDispatchAllStages(ev.timestamp);
      return;
    }

    if (stage.reworkProbability > 0 && ent.reworkCount < 2 && this.rng() < stage.reworkProbability) {
      stState.busyUnitIds = stState.busyUnitIds.filter((id) => id !== entId);
      ent.reworkCount++;
      acc.reworked += unitCount;
      acc.stageEnterTimes.set(entId, ev.timestamp);
      this.setObjectStatus(objId, stState.busyUnitIds.length > 0 ? 'running' : 'idle', ev.timestamp);
      this.schedule(ev.timestamp, 'ProductArrived', {
        entityId: entId,
        stageId,
        details: `${ent.batchLabel || entId} routed for rework at ${stage.name}`,
      });
      this.retryBlockedUpstreamForStage(stageId, ev.timestamp);
      this.tryDispatchAllStages(ev.timestamp);
      return;
    }

    // Determine next stage strictly from user Flowchart DAG (or linear route in auto mode)
    const prod = this.productsMap.get(ent.productId);
    let nextStageId: string | undefined;
    if (prod?.routingMode === 'manual') {
      const branchCandidates = stage.successorIds.filter(
        (sid) => this.stagesMap.has(sid) && sid !== stageId
      );
      nextStageId = this.pickBestBranchStage(branchCandidates);
    } else {
      const routeIds = prod?.routeStageIds || this.project.stages.map((s) => s.id);
      const currentIdx = routeIds.indexOf(stageId);
      nextStageId =
        currentIdx >= 0 && currentIdx + 1 < routeIds.length
          ? routeIds[currentIdx + 1]
          : this.pickBestBranchStage(stage.successorIds);
    }

    if (!nextStageId) {
      // Completed final stage!
      stState.busyUnitIds = stState.busyUnitIds.filter((id) => id !== entId);
      ent.completedAt = ev.timestamp;
      ent.locationKind = 'completed';
      this.completedCount += unitCount;
      if (ent.isBatchCarrier) this.completedBatches++;
      const hourBucket = Math.floor(ev.timestamp / 3600) + 1;
      this.hourlyGood.set(hourBucket, (this.hourlyGood.get(hourBucket) || 0) + unitCount);

      this.setObjectStatus(objId, stState.busyUnitIds.length > 0 ? 'running' : 'idle', ev.timestamp);
      this.schedule(ev.timestamp, 'ProductCompleted', {
        entityId: entId,
        stageId,
        objectId: objId,
        details: `${ent.batchLabel || entId} (${unitCount}u) completed (${this.completedCount} total good units)`,
      });
      this.schedule(ev.timestamp, 'BufferReleased', {
        stageId,
        details: `Exit capacity freed at ${stage.name}`,
      });
      this.tryDispatchAllStages(ev.timestamp);
      return;
    }

    // Attempt transfer to next stage (respecting user queue bufferCapacity >= 0!)
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

    // Also inspect if destination stage is an explicit conveyor or transfer conveyor that is saturated
    const fromObj = this.objectsMap.get(fromObjId);
    const toObj = this.objectsMap.get(nextStage.assignedObjectIds[0]);
    const ent = this.entities.get(entId);
    const prod = ent ? this.productsMap.get(ent.productId) : undefined;
    const freeDestStation = this.findAvailableStation(nextStage, prod);
    const hasFreeDestSlot =
      Boolean(freeDestStation) &&
      (nextStage.requiredWorkers <= 0 ||
        Boolean(
          freeDestStation &&
            this.findAvailableWorkers(nextStage, freeDestStation, nextStage.requiredWorkers)
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
    const transferConvCandidate = explicitConveyorStage
      ? undefined
      : (fromStage?.conveyorObjectId
          ? this.objectsMap.get(fromStage.conveyorObjectId)
          : allConveyors.reduce<LayoutObject | undefined>((best, c) => {
              if (!best) return c;
              return distance2D(rawStartCheck, c.geometry.position) <
                distance2D(rawStartCheck, best.geometry.position)
                ? c
                : best;
            }, undefined));

    const transferConvFull =
      transferConvCandidate?.kind === 'conveyor' &&
      (this.conveyorOccupancy.get(transferConvCandidate.id) || 0) >=
        this.getConveyorPhysicalCapacity(transferConvCandidate, prod, ent);

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
      transferConvFull
    ) {
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
        details: `${nextStage.name} buffer full (${effectiveBufferUsed}/${nextBufferCap}); upstream blocked`,
      });
      return false;
    }

    // Reserve transit slot in destination stage so simultaneous upstream units can't overfill buffer
    this.stageInTransitCounts.set(nextStageId, pendingInTransit + 1);

    // Free upstream station
    fromState.busyUnitIds = fromState.busyUnitIds.filter((id) => id !== entId);
    this.setObjectStatus(
      fromObjId,
      fromState.busyUnitIds.length > 0 ? 'running' : 'idle',
      now
    );

    if (!ent) {
      this.stageInTransitCounts.set(nextStageId, Math.max(0, pendingInTransit));
      return false;
    }

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
        : fromObj
        ? { x: fromObj.geometry.position.x, y: fromObj.geometry.dimensions.height, z: fromObj.geometry.position.z }
        : ent.worldPosition;
    const rawEnd: Vec3 =
      toObj?.kind === 'conveyor'
        ? getConvEnd(toObj, false)
        : toObj
        ? { x: toObj.geometry.position.x, y: toObj.geometry.dimensions.height, z: toObj.geometry.position.z }
        : rawStart;

    const fromConv = explicitConveyorStage ? undefined : findNearestConveyor(rawStart, fromStage?.conveyorObjectId);
    const toConv = explicitConveyorStage ? undefined : findNearestConveyor(rawEnd, nextStage.conveyorObjectId);

    let transportTime = 1.6;
    if (fromConv && fromConv.operations.speedMps && fromConv.operations.speedMps > 0) {
      const speed = fromConv.operations.speedMps;
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
      const carrierLen =
        ent.isBatchCarrier && ent.containerKind === 'pallet'
          ? Math.max(1.0, prod?.dimensions.length || 0.75)
          : undefined;
      const cMetrics = computeConveyorMetrics(fromConv, prod, carrierLen);
      transportTime = computeConveyorPathTimeSec(totalLen, cMetrics.speedMps);

      const minGapSec = cMetrics.minHeadwaySec;
      const laneKey = `${fromConv.id}:${fromStageId}`;
      const lastEntry = this.conveyorLastEntryTime.get(laneKey) ?? -Infinity;
      const entryDelay = Math.max(0, lastEntry + minGapSec - now);
      this.conveyorLastEntryTime.set(laneKey, now + entryDelay);

      const startTime = now + entryDelay;
      const endTime = startTime + transportTime;

      ent.locationKind = 'conveyor';
      ent.currentObjectId = fromConv.id;
      ent.transportTimeSec += transportTime + entryDelay;
      this.conveyorOccupancy.set(fromConv.id, (this.conveyorOccupancy.get(fromConv.id) || 0) + 1);
      this.conveyorTransits.set(entId, {
        entityId: entId,
        conveyorId: fromConv.id,
        fromStageId,
        toStageId: nextStageId,
        startTime,
        endTime,
        waypoints,
        cumLengths,
        totalLength: totalLen,
      });

      this.schedule(endTime, 'ProductTransferred', {
        entityId: entId,
        stageId: nextStageId,
        objectId: fromConv.id,
        details: `${entId} conveyed to ${nextStage.name} (${totalLen.toFixed(2)}m @ ${cMetrics.speedMps} m/s = ${transportTime.toFixed(2)}s)`,
        payload: { transferConveyorId: fromConv.id },
      });
      return true;
    }

    // Direct zero-assumption stage-to-stage handoff when no physical conveyor bridges the stages
    ent.locationKind = 'station';
    ent.currentObjectId = fromObjId;
    this.schedule(now, 'ProductTransferred', {
      entityId: entId,
      stageId: nextStageId,
      details: `${entId} transferred to ${nextStage.name}`,
    });
    return true;
  }

  private handleProductTransferred(ev: InternalEvent): void {
    if (!ev.entityId || !ev.stageId) return;
    const prevTransitCount = this.stageInTransitCounts.get(ev.stageId) || 0;
    this.stageInTransitCounts.set(ev.stageId, Math.max(0, prevTransitCount - 1));
    const transferConvId = ev.payload?.transferConveyorId as string | undefined;
    if (transferConvId) {
      this.conveyorOccupancy.set(
        transferConvId,
        Math.max(0, (this.conveyorOccupancy.get(transferConvId) || 1) - 1)
      );
      this.schedule(ev.timestamp, 'BufferReleased', {
        stageId: ev.stageId,
        details: `Transfer conveyor slot freed`,
      });
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
      const freeSt = this.findAvailableStation(stage);
      const hasFreeSlot =
        Boolean(freeSt) &&
        (stage.requiredWorkers <= 0 ||
          Boolean(freeSt && this.findAvailableWorkers(stage, freeSt, stage.requiredWorkers)));
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

  public getSnapshot(): SimulationSnapshot {
    this.updateInterpolatedPositions(this.clockSec);
    const objects: Record<string, ObjectRuntimeState> = {};
    for (const [k, v] of this.objectStates.entries()) {
      objects[k] = { ...v, busyUnitIds: [...v.busyUnitIds], queueUnitIds: [...v.queueUnitIds] };
    }
    const workers: Record<string, WorkerRuntimeState> = {};
    for (const [k, v] of this.workerStates.entries()) {
      workers[k] = { ...v, position: { ...v.position } };
    }
    const products: ProductEntityState[] = [];
    for (const ent of this.entities.values()) {
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
      result: this.status === 'completed' || this.clockSec > 0 ? this.buildResult() : undefined,
    };
  }

  public getAllEvents(): SimEvent[] {
    return this.eventLog;
  }

  public buildResult(): SimulationResult {
    const shiftAudit = computeShiftWindowAudit(
      this.project.simulationConfig,
      this.project.products[0],
      this.clockSec || this.project.simulationConfig.durationSec
    );
    const simTime = shiftAudit.simTimeSec;
    const activeSimTime = shiftAudit.activeSimTimeSec;
    const planned = shiftAudit.plannedUnits;

    const good = this.completedCount;
    const scrap = this.scrappedCount;

    // Lead, wait, processing, transport averages weighted across completed unit equivalents
    let leadSum = 0;
    let waitSum = 0;
    let procSum = 0;
    let transSum = 0;
    let finishedCount = 0;
    for (const ent of this.entities.values()) {
      if (ent.completedAt !== undefined && !ent.absorbedIntoEntityId) {
        const u = Math.max(1, ent.batchCount ?? 1);
        finishedCount += u;
        leadSum += (ent.completedAt - ent.createdAt) * u;
        waitSum += ent.waitingTimeSec * u;
        procSum += ent.processingTimeSec * u;
        transSum += ent.transportTimeSec * u;
      }
    }

    const avgLeadTimeSec = finishedCount > 0 ? leadSum / finishedCount : 0;
    const avgWaitingTimeSec = finishedCount > 0 ? waitSum / finishedCount : 0;
    const avgProcessingTimeSec = finishedCount > 0 ? procSum / finishedCount : 0;
    const avgTransportTimeSec = finishedCount > 0 ? transSum / finishedCount : 0;

    // Stage analytics & bottleneck detection
    const stageAnalytics: StageAnalytics[] = [];
    let bottleneckStageId: string | undefined;
    let bottleneckStageName: string | undefined;
    let highestUtilOrWait = -1;

    let totalBlocked = 0;
    let totalStarved = 0;
    let totalDowntime = 0;
    let sumBufferOcc = 0;

    for (const st of this.project.stages) {
      const acc = this.stageAcc.get(st.id)!;
      const objIds = st.assignedObjectIds;
      let runT = 0;
      let blkT = 0;
      let downT = 0;
      let idleT = 0;
      for (const oid of objIds) {
        const os = this.objectStates.get(oid);
        if (!os) continue;
        const dtLast = Math.max(0, simTime - os.lastStateChangeTime);
        runT += os.runningTimeSec + (os.status === 'running' ? dtLast : 0);
        blkT += os.blockedTimeSec + (os.status === 'blocked' ? dtLast : 0);
        downT += os.downTimeSec + (os.status === 'down' ? dtLast : 0);
        idleT += os.idleTimeSec + (os.status === 'idle' ? dtLast : 0);
      }
      const denom = Math.max(1e-6, objIds.length * activeSimTime);
      const utilPct = Math.min(100, (runT / denom) * 100);
      const blkPct = Math.min(100, (blkT / denom) * 100);
      const downPct = Math.min(100, (downT / denom) * 100);
      const starvedPct = Math.max(0, Math.min(100, (idleT / denom) * 100));

      totalBlocked += blkT;
      totalDowntime += downT;
      totalStarved += idleT;

      const dtQ = Math.max(0, simTime - acc.lastQueueTime);
      const curQ = this.getStageQueueUnitCount(st.id);
      const avgQueue = (acc.queueArea + curQ * dtQ) / simTime;
      sumBufferOcc += st.bufferCapacity > 0 ? Math.min(100, (avgQueue / st.bufferCapacity) * 100) : 0;

      // Average measured cycle duration per batch/operation cycle so it aligns 1:1 with configuredCycleTimeSec
      const avgStageCycle = acc.batchesCompleted > 0 ? acc.cycleTimeSum / acc.batchesCompleted : 0;
      const avgStageWait = acc.entered > 0 ? acc.waitTimeSum / acc.entered : 0;

      const stTaskTime =
        (st.processingTimeSec || 0) + (st.loadingTimeSec || 0) + (st.unloadingTimeSec || 0);
      const bottleneckScore =
        stTaskTime > 0 ? utilPct + blkPct * 0.25 + avgQueue * 5 : utilPct * 0.1;
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
        reworkCount: acc.reworked,
        avgCycleTimeSec: avgStageCycle,
        avgWaitTimeSec: avgStageWait,
        avgQueueLength: avgQueue,
        maxQueueLength: acc.maxQueue,
        utilizationPct: utilPct,
        blockedPct: blkPct,
        starvedPct,
        downPct,
        isBottleneck: false,
        batchesCompleted: acc.batchesCompleted,
        batchSize: bCfg?.batchSize ?? 1,
      });
    }

    for (const sa of stageAnalytics) {
      if (sa.stageId === bottleneckStageId) sa.isBottleneck = true;
    }

    // Worker utilization across active shift time
    let workerBusySum = 0;
    let workerWalkSum = 0;
    for (const ws of this.workerStates.values()) {
      const dtLast = Math.max(0, simTime - ws.lastStateChangeTime);
      workerBusySum += ws.busyTimeSec + (ws.status === 'busy' ? dtLast : 0);
      workerWalkSum += ws.walkingTimeSec + (ws.status === 'walking' ? dtLast : 0);
    }
    const workerCount = Math.max(1, this.project.workers.length);
    const workerUtilizationPct = Math.min(
      100,
      ((workerBusySum + workerWalkSum) / (workerCount * activeSimTime)) * 100
    );

    const machineUtilizationPct =
      stageAnalytics.length > 0
        ? stageAnalytics.reduce((a, b) => a + b.utilizationPct, 0) / stageAnalytics.length
        : 0;

    const avgWip = this.wipArea / simTime;
    const avgQueueLength =
      stageAnalytics.length > 0
        ? stageAnalytics.reduce((a, b) => a + b.avgQueueLength, 0) / stageAnalytics.length
        : 0;
    const avgBufferOccupancyPct =
      stageAnalytics.length > 0 ? sumBufferOcc / stageAnalytics.length : 0;

    // Hourly series
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

    const kpis = buildAuditedSimulationKPIs({
      project: this.project,
      shiftAudit,
      goodUnits: good,
      scrappedUnits: scrap,
      totalBatchesCompleted: this.completedBatches,
      avgLeadTimeSec,
      avgWaitingTimeSec,
      avgProcessingTimeSec,
      avgTransportTimeSec,
      totalDowntimeSec: totalDowntime,
      totalBlockedTimeSec: totalBlocked,
      totalStarvedTimeSec: totalStarved,
      workerUtilizationPct,
      machineUtilizationPct,
      avgWip,
      currentWip: this.getActiveWipCount(),
      avgQueueLength,
      avgBufferOccupancyPct,
      stageAnalytics,
      bottleneckStageId,
      bottleneckStageName,
    });

    return {
      completedAtWallTime: new Date().toISOString(),
      simTimeSec: simTime,
      kpis,
      stageAnalytics,
      hourlySeries,
      wipSeries: this.wipSeries,
      recentEvents: this.eventLog.slice(-150),
      totalEventsExecuted: this.totalEventsExecuted,
    };
  }
}
