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
  total: number;
}

/**
 * Tracks exact state transition timestamps and non-overlapping accumulated durations
 * for machines, workers, and conveyors, strictly bounded within [0, horizonSec].
 */
export class ResourceStateTracker {
  private readonly horizonSec: number;
  private readonly recordIntervals: boolean;

  private machineDurations = new Map<string, Omit<MachineStateTotals, 'total'>>();
  private machineCurrent = new Map<string, { state: MachineRuntimeStatus; since: number }>();

  private workerDurations = new Map<string, Omit<WorkerStateTotals, 'total'>>();
  private workerCurrent = new Map<string, { state: WorkerRuntimeStatus; since: number }>();

  private conveyorDurations = new Map<string, Omit<ConveyorStateTotals, 'total'>>();
  private conveyorCurrent = new Map<string, { state: ConveyorRuntimeStatus; since: number }>();

  private machineIntervals: StateIntervalRecord<MachineRuntimeStatus>[] = [];
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
    const t0 = Math.max(0, Math.min(this.horizonSec, startSec));
    this.machineDurations.set(id, {
      running: 0,
      idle: 0,
      blocked: 0,
      starved: 0,
      setup: 0,
      down: 0,
      maintenance: 0,
    });
    this.machineCurrent.set(id, { state: initialState, since: t0 });
  }

  public initWorker(
    id: string,
    initialState: WorkerRuntimeStatus = 'idle',
    startSec = 0
  ): void {
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
    const t0 = Math.max(0, Math.min(this.horizonSec, startSec));
    this.conveyorDurations.set(id, {
      moving: 0,
      stopped: 0,
      blocked: 0,
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
        this.machineIntervals.push({
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
      runtime.runningTimeSec = acc.running;
      runtime.idleTimeSec = acc.idle;
      runtime.blockedTimeSec = acc.blocked;
      runtime.starvedTimeSec = acc.starved;
      runtime.setupTimeSec = acc.setup;
      runtime.downTimeSec = acc.down;
      runtime.maintenanceTimeSec = acc.maintenance;
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
    }
  }

  /**
   * Closes all unfinished states cleanly up to endSec (clamped to horizonSec).
   */
  public finalizeAt(
    endSec: number,
    objectStates?: Map<string, ObjectRuntimeState>,
    workerStates?: Map<string, WorkerRuntimeState>
  ): void {
    const horizon = Math.min(this.horizonSec, Math.max(0, endSec));
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
      out.maintenance;
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
    };
    const out: ConveyorStateTotals = { ...acc, total: 0 };
    const cur = this.conveyorCurrent.get(id);
    if (cur && atSec !== undefined) {
      const clamped = this.clampTimestamp(cur.since, atSec);
      const dt = Math.max(0, clamped - cur.since);
      out[cur.state] += dt;
    }
    out.total = out.moving + out.stopped + out.blocked;
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
    return id ? this.machineIntervals.filter((i) => i.resourceId === id) : [...this.machineIntervals];
  }

  public getRecordedWorkerIntervals(id?: string): StateIntervalRecord<WorkerRuntimeStatus>[] {
    return id ? this.workerIntervals.filter((i) => i.resourceId === id) : [...this.workerIntervals];
  }

  public getRecordedConveyorIntervals(id?: string): StateIntervalRecord<ConveyorRuntimeStatus>[] {
    return id ? this.conveyorIntervals.filter((i) => i.resourceId === id) : [...this.conveyorIntervals];
  }
}
