import {
  ConveyorRuntimeStatus,
  MachineRuntimeStatus,
  ObjectRuntimeState,
  WorkerRuntimeState,
  WorkerRuntimeStatus,
} from '../types/project';

export interface StateIntervalRecord<S extends string = string> {
  resourceId: string;
  state: S;
  startSec: number;
  endSec: number;
}

export interface MachineStateTotals {
  running: number;
  idle: number;
  blocked: number;
  starved: number;
  setup: number;
  down: number;
  maintenance: number;
  unavailable: number;
  total: number;
}

export interface WorkerStateTotals {
  busy: number;
  walking: number;
  idle: number;
  break: number;
  unavailable: number;
  total: number;
}

export interface ConveyorStateTotals {
  moving: number;
  stopped: number;
  blocked: number;
  unavailable: number;
  total: number;
}

/**
 * Tracks exact state transition timestamps and non-overlapping accumulated durations
 * for machines, workers, and conveyors, strictly bounded within [0, horizonSec].
 */
export class ResourceStateTracker {
  private readonly horizonSec: number;
  private readonly recordIntervals: boolean;
  private finalizedHorizon: number | null = null;

  private machineDurations = new Map<string, Omit<MachineStateTotals, 'total'>>();
  private machineCurrent = new Map<string, { state: MachineRuntimeStatus; since: number }>();

  private workerDurations = new Map<string, Omit<WorkerStateTotals, 'total'>>();
  private workerCurrent = new Map<string, { state: WorkerRuntimeStatus; since: number }>();

  private conveyorDurations = new Map<string, Omit<ConveyorStateTotals, 'total'>>();
  private conveyorCurrent = new Map<string, { state: ConveyorRuntimeStatus; since: number }>();

  private machineIntervals: StateIntervalRecord<MachineRuntimeStatus>[] = [];
  private machineIntervalsById = new Map<string, StateIntervalRecord<MachineRuntimeStatus>[]>();
  private workerIntervals: StateIntervalRecord<WorkerRuntimeStatus>[] = [];
  private conveyorIntervals: StateIntervalRecord<ConveyorRuntimeStatus>[] = [];

  constructor(horizonSec: number, recordIntervals = false) {
    this.horizonSec = Math.max(0, horizonSec);
    this.recordIntervals = recordIntervals;
  }

  public initMachine(
    id: string,
    initialState: MachineRuntimeStatus = 'idle',
    startSec = 0
  ): void {
    this.finalizedHorizon = null;
    const t0 = Math.max(0, Math.min(this.horizonSec, startSec));
    this.machineDurations.set(id, {
      running: 0,
      idle: 0,
      blocked: 0,
      starved: 0,
      setup: 0,
      down: 0,
      maintenance: 0,
      unavailable: 0,
    });
    this.machineCurrent.set(id, { state: initialState, since: t0 });
    if (this.recordIntervals) {
      this.machineIntervalsById.set(id, []);
    }
  }

  public initWorker(
    id: string,
    initialState: WorkerRuntimeStatus = 'idle',
    startSec = 0
  ): void {
    this.finalizedHorizon = null;
    const t0 = Math.max(0, Math.min(this.horizonSec, startSec));
    this.workerDurations.set(id, {
      busy: 0,
      walking: 0,
      idle: 0,
      break: 0,
      unavailable: 0,
    });
    this.workerCurrent.set(id, { state: initialState, since: t0 });
  }

  public initConveyor(
    id: string,
    initialState: ConveyorRuntimeStatus = 'stopped',
    startSec = 0
  ): void {
    this.finalizedHorizon = null;
    const t0 = Math.max(0, Math.min(this.horizonSec, startSec));
    this.conveyorDurations.set(id, {
      moving: 0,
      stopped: 0,
      blocked: 0,
      unavailable: 0,
    });
    this.conveyorCurrent.set(id, { state: initialState, since: t0 });
  }

  private clampTimestamp(idTime: number, rawNow: number): number {
    return Math.min(this.horizonSec, Math.max(idTime, rawNow));
  }

  public transitionMachine(
    id: string,
    nextState: MachineRuntimeStatus,
    nowSec: number,
    runtime?: ObjectRuntimeState
  ): void {
    const cur = this.machineCurrent.get(id);
    const acc = this.machineDurations.get(id);
    if (!cur || !acc) return;

    const clampedNow = this.clampTimestamp(cur.since, nowSec);
    const dt = Math.max(0, clampedNow - cur.since);

    if (dt > 0) {
      acc[cur.state] += dt;
      if (this.recordIntervals) {
        const rec: StateIntervalRecord<MachineRuntimeStatus> = {
          resourceId: id,
          state: cur.state,
          startSec: cur.since,
          endSec: clampedNow,
        };
        this.machineIntervals.push(rec);
        let list = this.machineIntervalsById.get(id);
        if (!list) {
          list = [];
          this.machineIntervalsById.set(id, list);
        }
        list.push(rec);
      }
    }

    cur.state = nextState;
    cur.since = clampedNow;

    if (runtime) {
      runtime.status = nextState;
      runtime.runningTimeSec = acc.running;
      runtime.idleTimeSec = acc.idle;
      runtime.blockedTimeSec = acc.blocked;
      runtime.starvedTimeSec = acc.starved;
      runtime.setupTimeSec = acc.setup;
      runtime.downTimeSec = acc.down;
      runtime.maintenanceTimeSec = acc.maintenance;
      runtime.unavailableTimeSec = acc.unavailable;
      runtime.lastStateChangeTime = clampedNow;
    }
  }

  public transitionWorker(
    id: string,
    nextState: WorkerRuntimeStatus,
    nowSec: number,
    runtime?: WorkerRuntimeState
  ): void {
    const cur = this.workerCurrent.get(id);
    const acc = this.workerDurations.get(id);
    if (!cur || !acc) return;

    const clampedNow = this.clampTimestamp(cur.since, nowSec);
    const dt = Math.max(0, clampedNow - cur.since);

    if (dt > 0) {
      acc[cur.state] += dt;
      if (this.recordIntervals) {
        this.workerIntervals.push({
          resourceId: id,
          state: cur.state,
          startSec: cur.since,
          endSec: clampedNow,
        });
      }
    }

    cur.state = nextState;
    cur.since = clampedNow;

    if (runtime) {
      runtime.status = nextState;
      runtime.busyTimeSec = acc.busy;
      runtime.walkingTimeSec = acc.walking;
      runtime.idleTimeSec = acc.idle;
      runtime.breakTimeSec = acc.break;
      runtime.unavailableTimeSec = acc.unavailable;
      runtime.lastStateChangeTime = clampedNow;
    }
  }

  public transitionConveyor(
    id: string,
    nextState: ConveyorRuntimeStatus,
    nowSec: number,
    runtime?: ObjectRuntimeState
  ): void {
    const cur = this.conveyorCurrent.get(id);
    const acc = this.conveyorDurations.get(id);
    if (!cur || !acc) return;

    const clampedNow = this.clampTimestamp(cur.since, nowSec);
    const dt = Math.max(0, clampedNow - cur.since);

    if (dt > 0) {
      acc[cur.state] += dt;
      if (this.recordIntervals) {
        this.conveyorIntervals.push({
          resourceId: id,
          state: cur.state,
          startSec: cur.since,
          endSec: clampedNow,
        });
      }
    }

    cur.state = nextState;
    cur.since = clampedNow;

    if (runtime) {
      runtime.conveyorStatus = nextState;
      runtime.movingTimeSec = acc.moving;
      runtime.stoppedTimeSec = acc.stopped;
      runtime.unavailableTimeSec = acc.unavailable;
    }
  }

  /**
   * Closes all unfinished states cleanly up to endSec (clamped to horizonSec).
   * Strictly idempotent so repeated calls never double-count.
   */
  public finalizeAt(
    endSec: number,
    objectStates?: Map<string, ObjectRuntimeState>,
    workerStates?: Map<string, WorkerRuntimeState>
  ): void {
    const horizon = Math.min(this.horizonSec, Math.max(0, endSec));
    if (this.finalizedHorizon !== null && horizon <= this.finalizedHorizon + 1e-12) {
      return;
    }
    this.finalizedHorizon = horizon;

    for (const [id, cur] of this.machineCurrent.entries()) {
      this.transitionMachine(id, cur.state, horizon, objectStates?.get(id));
    }
    for (const [id, cur] of this.workerCurrent.entries()) {
      this.transitionWorker(id, cur.state, horizon, workerStates?.get(id));
    }
    for (const [id, cur] of this.conveyorCurrent.entries()) {
      this.transitionConveyor(id, cur.state, horizon, objectStates?.get(id));
    }
  }

  public getMachineTotals(id: string, atSec?: number): MachineStateTotals {
    const acc = this.machineDurations.get(id) || {
      running: 0,
      idle: 0,
      blocked: 0,
      starved: 0,
      setup: 0,
      down: 0,
      maintenance: 0,
      unavailable: 0,
    };
    const out: MachineStateTotals = { ...acc, total: 0 };
    const cur = this.machineCurrent.get(id);
    if (cur && atSec !== undefined) {
      const clamped = this.clampTimestamp(cur.since, atSec);
      const dt = Math.max(0, clamped - cur.since);
      out[cur.state] += dt;
    }
    out.total =
      out.running +
      out.idle +
      out.blocked +
      out.starved +
      out.setup +
      out.down +
      out.maintenance +
      out.unavailable;
    return out;
  }

  public getWorkerTotals(id: string, atSec?: number): WorkerStateTotals {
    const acc = this.workerDurations.get(id) || {
      busy: 0,
      walking: 0,
      idle: 0,
      break: 0,
      unavailable: 0,
    };
    const out: WorkerStateTotals = { ...acc, total: 0 };
    const cur = this.workerCurrent.get(id);
    if (cur && atSec !== undefined) {
      const clamped = this.clampTimestamp(cur.since, atSec);
      const dt = Math.max(0, clamped - cur.since);
      out[cur.state] += dt;
    }
    out.total = out.busy + out.walking + out.idle + out.break + out.unavailable;
    return out;
  }

  public getConveyorTotals(id: string, atSec?: number): ConveyorStateTotals {
    const acc = this.conveyorDurations.get(id) || {
      moving: 0,
      stopped: 0,
      blocked: 0,
      unavailable: 0,
    };
    const out: ConveyorStateTotals = { ...acc, total: 0 };
    const cur = this.conveyorCurrent.get(id);
    if (cur && atSec !== undefined) {
      const clamped = this.clampTimestamp(cur.since, atSec);
      const dt = Math.max(0, clamped - cur.since);
      out[cur.state] += dt;
    }
    out.total = out.moving + out.stopped + out.blocked + out.unavailable;
    return out;
  }

  public getMachineCurrentState(id: string): MachineRuntimeStatus | undefined {
    return this.machineCurrent.get(id)?.state;
  }

  public getWorkerCurrentState(id: string): WorkerRuntimeStatus | undefined {
    return this.workerCurrent.get(id)?.state;
  }

  public getConveyorCurrentState(id: string): ConveyorRuntimeStatus | undefined {
    return this.conveyorCurrent.get(id)?.state;
  }

  public getRecordedMachineIntervals(id?: string): StateIntervalRecord<MachineRuntimeStatus>[] {
    if (id) {
      return [...(this.machineIntervalsById.get(id) || [])];
    }
    return [...this.machineIntervals];
  }

  public getRecordedWorkerIntervals(id?: string): StateIntervalRecord<WorkerRuntimeStatus>[] {
    return id ? this.workerIntervals.filter((i) => i.resourceId === id) : [...this.workerIntervals];
  }

  public getRecordedConveyorIntervals(id?: string): StateIntervalRecord<ConveyorRuntimeStatus>[] {
    return id ? this.conveyorIntervals.filter((i) => i.resourceId === id) : [...this.conveyorIntervals];
  }

  private buildTimelineSegmentsForIds(
    resourceIds: string[],
    horizonSec: number
  ): {
    timelines: Map<string, StateIntervalRecord<MachineRuntimeStatus>[]>;
    boundaries: number[];
  } {
    const H = Math.max(0, Math.min(this.horizonSec, horizonSec));
    const timelines = new Map<string, StateIntervalRecord<MachineRuntimeStatus>[]>();
    const boundarySet = new Set<number>([0, H]);

    for (const id of resourceIds) {
      if (timelines.has(id)) continue;
      const recorded = this.machineIntervalsById.get(id) || [];
      const list: StateIntervalRecord<MachineRuntimeStatus>[] = [];
      for (const iv of recorded) {
        if (iv.endSec <= 0 || iv.startSec >= H) continue;
        const s = Math.max(0, iv.startSec);
        const e = Math.min(H, iv.endSec);
        if (e > s + 1e-12) {
          list.push({ resourceId: id, state: iv.state, startSec: s, endSec: e });
          boundarySet.add(s);
          boundarySet.add(e);
        }
      }
      const cur = this.machineCurrent.get(id);
      if (cur && cur.since < H - 1e-12) {
        const s = Math.max(0, cur.since);
        list.push({ resourceId: id, state: cur.state, startSec: s, endSec: H });
        boundarySet.add(s);
      }
      timelines.set(id, list);
    }

    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);
    return { timelines, boundaries };
  }

  /**
   * Distinguishes complete stage interruption (all servers stopped while >=1 is down/maintenance)
   * from partial capacity loss (>=1 server down/maintenance while >=1 remains operational).
   */
  public analyzeStageAvailabilityIntervals(
    resourceIds: string[],
    horizonSec = this.horizonSec
  ): {
    completeStoppageTimeSec: number;
    partialCapacityLossTimeSec: number;
  } {
    const uniqueIds = Array.from(new Set(resourceIds)).filter((id) => this.machineCurrent.has(id));
    if (uniqueIds.length === 0 || horizonSec <= 1e-9) {
      return { completeStoppageTimeSec: 0, partialCapacityLossTimeSec: 0 };
    }
    const { timelines, boundaries } = this.buildTimelineSegmentsForIds(uniqueIds, horizonSec);
    const cursors = new Map<string, number>();
    for (const id of uniqueIds) cursors.set(id, 0);

    let completeStoppageTimeSec = 0;
    let partialCapacityLossTimeSec = 0;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const a = boundaries[i];
      const b = boundaries[i + 1];
      const dt = b - a;
      if (dt <= 1e-12) continue;
      const mid = 0.5 * (a + b);

      let anyDownOrMaint = false;
      let operationalCount = 0;

      for (const id of uniqueIds) {
        const list = timelines.get(id) || [];
        let idx = cursors.get(id) || 0;
        while (idx < list.length && list[idx].endSec <= mid) {
          idx++;
        }
        cursors.set(id, idx);
        const state: MachineRuntimeStatus =
          idx < list.length && list[idx].startSec <= mid ? list[idx].state : 'idle';
        if (state === 'down' || state === 'maintenance') {
          anyDownOrMaint = true;
        }
        if (state !== 'down' && state !== 'maintenance' && state !== 'unavailable') {
          operationalCount++;
        }
      }

      if (anyDownOrMaint) {
        if (operationalCount === 0) {
          completeStoppageTimeSec += dt;
        } else {
          partialCapacityLossTimeSec += dt;
        }
      }
    }

    return { completeStoppageTimeSec, partialCapacityLossTimeSec };
  }

  /**
   * Computes capacity-weighted propagated unplanned downtime (direct breakdowns +
   * failure-induced starvation + failure-induced blocking + upstream-dead startup blockage)
   * on a stage's processing resources, bounded strictly within each resource's SPT.
   */
  public computePropagatedDowntimeSec(params: {
    targetResources: Array<{ id: string; weight: number }>;
    upstreamServerGroups: string[][];
    downstreamServerGroups: string[][];
    horizonSec?: number;
    scheduledWindowsById?: Map<string, Array<{ startSec: number; endSec: number }>>;
  }): {
    weightedPropagatedDowntimeSec: number;
    perResourceDowntimeSec: Record<string, number>;
  } {
    const horizonSec = params.horizonSec ?? this.horizonSec;
    const validTargets = params.targetResources.filter((r) => this.machineCurrent.has(r.id));
    if (validTargets.length === 0 || horizonSec <= 1e-9) {
      return { weightedPropagatedDowntimeSec: 0, perResourceDowntimeSec: {} };
    }

    const upstreamFlat = Array.from(new Set(params.upstreamServerGroups.flat())).filter((id) =>
      this.machineCurrent.has(id)
    );
    const downstreamFlat = Array.from(new Set(params.downstreamServerGroups.flat())).filter((id) =>
      this.machineCurrent.has(id)
    );
    const allIds = Array.from(
      new Set([...validTargets.map((t) => t.id), ...upstreamFlat, ...downstreamFlat])
    );

    const { timelines, boundaries } = this.buildTimelineSegmentsForIds(allIds, horizonSec);
    if (params.scheduledWindowsById) {
      const extra = new Set<number>(boundaries);
      for (const target of validTargets) {
        const wins = params.scheduledWindowsById.get(target.id);
        if (!wins) continue;
        for (const w of wins) {
          const ws = Math.max(0, Math.min(horizonSec, w.startSec));
          const we = Math.max(0, Math.min(horizonSec, w.endSec));
          if (we > ws + 1e-12) {
            extra.add(ws);
            extra.add(we);
          }
        }
      }
      boundaries.splice(0, boundaries.length, ...Array.from(extra).sort((a, b) => a - b));
    }

    const isWithinScheduledWindow = (targetId: string, mid: number): boolean => {
      const wins = params.scheduledWindowsById?.get(targetId);
      if (!wins) return true;
      for (const w of wins) {
        if (mid >= w.startSec && mid <= w.endSec) return true;
      }
      return false;
    };

    const cursors = new Map<string, number>();
    for (const id of allIds) cursors.set(id, 0);

    // Earliest timestamp each target resource first enters active work (excludes initial pipeline fill idle/starved before first unit arrives)
    const firstWorkTimeByTarget = new Map<string, number>();
    for (const t of validTargets) {
      const ivs = timelines.get(t.id) || [];
      let firstWork = Infinity;
      for (const iv of ivs) {
        if (iv.state === 'running' || iv.state === 'setup' || iv.state === 'blocked') {
          firstWork = iv.startSec;
          break;
        }
      }
      firstWorkTimeByTarget.set(t.id, firstWork);
    }

    const downSumByTarget = new Map<string, number>();
    const sptSumByTarget = new Map<string, number>();
    const setupSumByTarget = new Map<string, number>();
    for (const t of validTargets) {
      downSumByTarget.set(t.id, 0);
      sptSumByTarget.set(t.id, 0);
      setupSumByTarget.set(t.id, 0);
    }

    const stateAt = (id: string, mid: number): MachineRuntimeStatus => {
      const list = timelines.get(id) || [];
      let idx = cursors.get(id) || 0;
      while (idx < list.length && list[idx].endSec <= mid) {
        idx++;
      }
      cursors.set(id, idx);
      return idx < list.length && list[idx].startSec <= mid ? list[idx].state : 'idle';
    };

    const upGroupsClean = params.upstreamServerGroups
      .map((grp) => Array.from(new Set(grp)).filter((id) => this.machineCurrent.has(id)))
      .filter((grp) => grp.length > 0);
    const downGroupsClean = params.downstreamServerGroups
      .map((grp) => Array.from(new Set(grp)).filter((id) => this.machineCurrent.has(id)))
      .filter((grp) => grp.length > 0);

    for (let i = 0; i < boundaries.length - 1; i++) {
      const a = boundaries[i];
      const b = boundaries[i + 1];
      const dt = b - a;
      if (dt <= 1e-12) continue;
      const mid = 0.5 * (a + b);

      let anyUpDown = false;
      let anyUpGroupFullyDown = false;
      for (const grp of upGroupsClean) {
        let allDown = true;
        for (const uid of grp) {
          if (stateAt(uid, mid) === 'down') {
            anyUpDown = true;
          } else {
            allDown = false;
          }
        }
        if (allDown) anyUpGroupFullyDown = true;
      }

      let anyDownstreamDown = false;
      for (const grp of downGroupsClean) {
        for (const did of grp) {
          if (stateAt(did, mid) === 'down') {
            anyDownstreamDown = true;
            break;
          }
        }
        if (anyDownstreamDown) break;
      }

      for (const target of validTargets) {
        const s = stateAt(target.id, mid);
        if (s === 'unavailable' || s === 'maintenance' || !isWithinScheduledWindow(target.id, mid)) {
          continue;
        }

        sptSumByTarget.set(target.id, (sptSumByTarget.get(target.id) || 0) + dt);
        if (s === 'setup') {
          setupSumByTarget.set(target.id, (setupSumByTarget.get(target.id) || 0) + dt);
        }

        const firstWork = firstWorkTimeByTarget.get(target.id) ?? Infinity;
        const isPropagatedDown =
          s === 'down' ||
          (s === 'blocked' && anyDownstreamDown) ||
          (mid >= firstWork
            ? s === 'starved' && anyUpDown
            : (s === 'starved' || s === 'idle') && anyUpGroupFullyDown);

        if (isPropagatedDown) {
          downSumByTarget.set(target.id, (downSumByTarget.get(target.id) || 0) + dt);
        }
      }
    }

    const perResourceDowntimeSec: Record<string, number> = {};
    let weightSum = 0;
    let weightedDownSum = 0;

    for (const target of validTargets) {
      const maxDown = Math.max(
        0,
        (sptSumByTarget.get(target.id) || 0) - (setupSumByTarget.get(target.id) || 0)
      );
      const boundedDown = Math.min(maxDown, downSumByTarget.get(target.id) || 0);
      perResourceDowntimeSec[target.id] = boundedDown;
      const w = target.weight > 0 ? target.weight : 1;
      weightSum += w;
      weightedDownSum += w * boundedDown;
    }

    return {
      weightedPropagatedDowntimeSec: weightSum > 0 ? weightedDownSum / weightSum : 0,
      perResourceDowntimeSec,
    };
  }
}
