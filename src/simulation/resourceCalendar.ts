import {
  LayoutObject,
  PlannedMaintenanceWindow,
  ShiftBreak,
  ShiftDefinition,
  SimulationConfig,
  WorkerDefinition,
} from '../types/project';

export interface TimeInterval {
  startSec: number;
  endSec: number;
  label?: string;
  id?: string;
}

export interface CalendarTransitionPoint {
  timestamp: number;
  kind:
    | 'shift_start'
    | 'shift_end'
    | 'break_start'
    | 'break_end'
    | 'maintenance_start'
    | 'maintenance_end';
  shiftId?: string;
  shiftName?: string;
  breakId?: string;
  breakName?: string;
  maintenanceId?: string;
  maintenanceName?: string;
  targetObjectId?: string;
}

export interface CalendarValidationResult {
  overlappingShifts: Array<{ a: ShiftDefinition; b: ShiftDefinition; overlapSec: number }>;
  overlappingBreaks: Array<{
    shift: ShiftDefinition;
    a: ShiftBreak;
    b: ShiftBreak;
    overlapSec: number;
  }>;
  breaksOutsideShift: Array<{ shift: ShiftDefinition; brk: ShiftBreak }>;
  invalidMaintenanceWindows: Array<{
    win: PlannedMaintenanceWindow;
    reason: string;
    targetId?: string;
    resourceName?: string;
  }>;
  invalidObjectShifts: Array<{ obj: LayoutObject; missingRef: string }>;
  invalidWorkerShifts: Array<{ worker: WorkerDefinition; missingRef: string }>;
  maintenanceOutsideHorizon: Array<{
    win: PlannedMaintenanceWindow;
    kind: 'outside' | 'partial';
    horizonSec: number;
    targetId?: string;
    resourceName?: string;
  }>;
  overlappingMaintenanceWindows: Array<{
    a: PlannedMaintenanceWindow;
    b: PlannedMaintenanceWindow;
    overlapSec: number;
    targetId?: string;
    resourceName?: string;
  }>;
}

export interface ResourceShiftResolution {
  status: 'unassigned' | 'matched' | 'invalid';
  shifts: ShiftDefinition[];
  missingRef?: string;
}

export interface ResourceAvailabilityState {
  available: boolean;
  reason: 'active' | 'off_shift' | 'break' | 'maintenance';
}

export interface ObjectCalendarMetrics {
  calendarTimeSec: number;
  shiftWindowSec: number;
  breakDowntimeSec: number;
  maintenanceDowntimeSec: number;
  plannedDowntimeSec: number;
  scheduledProductionTimeSec: number;
}

/**
 * Merges overlapping or adjacent time intervals into disjoint sorted intervals.
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const valid = intervals
    .filter((iv) => Number.isFinite(iv.startSec) && Number.isFinite(iv.endSec) && iv.endSec > iv.startSec)
    .map((iv) => ({ startSec: iv.startSec, endSec: iv.endSec }))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  if (valid.length === 0) return [];
  const merged: TimeInterval[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i];
    const last = merged[merged.length - 1];
    if (cur.startSec <= last.endSec + 1e-9) {
      last.endSec = Math.max(last.endSec, cur.endSec);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Clips intervals strictly to [minSec, maxSec].
 */
export function clipIntervals(
  intervals: TimeInterval[],
  minSec: number,
  maxSec: number
): TimeInterval[] {
  if (maxSec <= minSec) return [];
  const out: TimeInterval[] = [];
  for (const iv of intervals) {
    const s = Math.max(minSec, iv.startSec);
    const e = Math.min(maxSec, iv.endSec);
    if (e > s + 1e-9) {
      out.push({ ...iv, startSec: s, endSec: e });
    }
  }
  return out;
}

/**
 * Subtracts sorted/unsorted exclusion intervals from base intervals.
 */
export function subtractIntervals(
  baseIntervals: TimeInterval[],
  excludeIntervals: TimeInterval[]
): TimeInterval[] {
  const base = mergeIntervals(baseIntervals);
  const excl = mergeIntervals(excludeIntervals);
  if (base.length === 0) return [];
  if (excl.length === 0) return base;

  const result: TimeInterval[] = [];
  for (const b of base) {
    let cursor = b.startSec;
    for (const ex of excl) {
      if (ex.endSec <= cursor) continue;
      if (ex.startSec >= b.endSec) break;
      if (ex.startSec > cursor) {
        result.push({ startSec: cursor, endSec: Math.min(b.endSec, ex.startSec) });
      }
      cursor = Math.max(cursor, ex.endSec);
      if (cursor >= b.endSec) break;
    }
    if (cursor < b.endSec - 1e-9) {
      result.push({ startSec: cursor, endSec: b.endSec });
    }
  }
  return result;
}

/**
 * Intersects two sets of intervals.
 */
export function intersectIntervals(aList: TimeInterval[], bList: TimeInterval[]): TimeInterval[] {
  const aMerged = mergeIntervals(aList);
  const bMerged = mergeIntervals(bList);
  const out: TimeInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < aMerged.length && j < bMerged.length) {
    const a = aMerged[i];
    const b = bMerged[j];
    const s = Math.max(a.startSec, b.startSec);
    const e = Math.min(a.endSec, b.endSec);
    if (e > s + 1e-9) {
      out.push({ startSec: s, endSec: e });
    }
    if (a.endSec < b.endSec) i++;
    else j++;
  }
  return out;
}

export function sumIntervals(intervals: TimeInterval[]): number {
  const merged = mergeIntervals(intervals);
  let total = 0;
  for (const iv of merged) {
    total += Math.max(0, iv.endSec - iv.startSec);
  }
  return total;
}

export function containsTimestamp(intervals: TimeInterval[], tSec: number): boolean {
  for (const iv of intervals) {
    if (tSec >= iv.startSec - 1e-9 && tSec < iv.endSec - 1e-9) {
      return true;
    }
  }
  return false;
}

function matchShiftsInList(
  shifts: ShiftDefinition[],
  shiftId?: string,
  scheduleName?: string
): ResourceShiftResolution {
  const cleanShiftId = shiftId?.trim() || '';
  const cleanSchedule = scheduleName?.trim() || '';

  if (!cleanShiftId && !cleanSchedule) {
    return { status: 'unassigned', shifts };
  }

  if (cleanShiftId) {
    const exactMatch = shifts.filter((s) => s.id === cleanShiftId);
    if (exactMatch.length > 0) return { status: 'matched', shifts: exactMatch };
    const lowerId = cleanShiftId.toLowerCase();
    const looseMatch = shifts.filter(
      (s) => s.id.toLowerCase() === lowerId || s.name.trim().toLowerCase() === lowerId
    );
    if (looseMatch.length > 0) return { status: 'matched', shifts: looseMatch };
    return { status: 'invalid', shifts: [], missingRef: cleanShiftId };
  }

  const lowerSched = cleanSchedule.toLowerCase();
  const schedMatch = shifts.filter(
    (s) => s.id.toLowerCase() === lowerSched || s.name.trim().toLowerCase() === lowerSched
  );
  if (schedMatch.length > 0) return { status: 'matched', shifts: schedMatch };
  return { status: 'invalid', shifts: [], missingRef: cleanSchedule };
}

/**
 * Validates shift overlaps, break overlaps, break-within-shift bounds, maintenance windows,
 * and resource/worker shift assignments.
 */
export function validateSimulationCalendars(
  config: SimulationConfig,
  objects: LayoutObject[] = [],
  workers: WorkerDefinition[] = []
): CalendarValidationResult {
  const overlappingShifts: CalendarValidationResult['overlappingShifts'] = [];
  const overlappingBreaks: CalendarValidationResult['overlappingBreaks'] = [];
  const breaksOutsideShift: CalendarValidationResult['breaksOutsideShift'] = [];
  const invalidMaintenanceWindows: CalendarValidationResult['invalidMaintenanceWindows'] = [];
  const invalidObjectShifts: CalendarValidationResult['invalidObjectShifts'] = [];
  const invalidWorkerShifts: CalendarValidationResult['invalidWorkerShifts'] = [];
  const maintenanceOutsideHorizon: CalendarValidationResult['maintenanceOutsideHorizon'] = [];
  const overlappingMaintenanceWindows: CalendarValidationResult['overlappingMaintenanceWindows'] = [];

  const shifts = config.shifts || [];
  const horizonSec = Math.max(0, config.durationSec || 0);

  for (let i = 0; i < shifts.length; i++) {
    const a = shifts[i];
    const aStart = a.startSec;
    const aEnd = a.startSec + a.durationSec;

    for (let j = i + 1; j < shifts.length; j++) {
      const b = shifts[j];
      const bStart = b.startSec;
      const bEnd = b.startSec + b.durationSec;
      const overlapSec = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
      if (overlapSec > 1e-6) {
        overlappingShifts.push({ a, b, overlapSec });
      }
    }

    const breaks = a.breaks || [];
    for (let bi = 0; bi < breaks.length; bi++) {
      const brkA = breaks[bi];
      const brkAEnd = brkA.startSec + brkA.durationSec;
      if (brkA.durationSec > 0 && (brkA.startSec < aStart - 1e-6 || brkAEnd > aEnd + 1e-6)) {
        breaksOutsideShift.push({ shift: a, brk: brkA });
      }
      for (let bj = bi + 1; bj < breaks.length; bj++) {
        const brkB = breaks[bj];
        const brkBEnd = brkB.startSec + brkB.durationSec;
        const overlapSec = Math.min(brkAEnd, brkBEnd) - Math.max(brkA.startSec, brkB.startSec);
        if (overlapSec > 1e-6) {
          overlappingBreaks.push({ shift: a, a: brkA, b: brkB, overlapSec });
        }
      }
    }
  }

  const checkMaintList = (
    windows: PlannedMaintenanceWindow[],
    targetId?: string,
    resourceName?: string
  ) => {
    for (const win of windows) {
      if (win.startSec < 0 || win.durationSec <= 0) {
        invalidMaintenanceWindows.push({
          win,
          reason: 'Planned maintenance window must have non-negative start and positive duration.',
          targetId,
          resourceName,
        });
        continue;
      }
      if (horizonSec > 0) {
        if (win.startSec >= horizonSec - 1e-9) {
          maintenanceOutsideHorizon.push({
            win,
            kind: 'outside',
            horizonSec,
            targetId,
            resourceName,
          });
        } else if (win.startSec + win.durationSec > horizonSec + 1e-6) {
          maintenanceOutsideHorizon.push({
            win,
            kind: 'partial',
            horizonSec,
            targetId,
            resourceName,
          });
        }
      }
    }

    for (let i = 0; i < windows.length; i++) {
      const a = windows[i];
      if (a.startSec < 0 || a.durationSec <= 0) continue;
      for (let j = i + 1; j < windows.length; j++) {
        const b = windows[j];
        if (b.startSec < 0 || b.durationSec <= 0) continue;
        // Skip unrelated global object-scoped windows when checking global list
        if (!targetId && a.objectId && b.objectId && a.objectId !== b.objectId) continue;
        const aEnd = a.startSec + a.durationSec;
        const bEnd = b.startSec + b.durationSec;
        const overlapSec = Math.min(aEnd, bEnd) - Math.max(a.startSec, b.startSec);
        if (overlapSec > 1e-6) {
          overlappingMaintenanceWindows.push({
            a,
            b,
            overlapSec,
            targetId: targetId || a.objectId || b.objectId,
            resourceName,
          });
        }
      }
    }
  };

  checkMaintList(config.maintenanceWindows || []);

  for (const obj of objects) {
    if (!obj.rendering.visible) continue;
    const objMaint = obj.operations.plannedMaintenance || [];
    if (objMaint.length > 0) {
      checkMaintList(objMaint, obj.id, obj.name);
    }

    const res = matchShiftsInList(shifts, obj.operations.shiftId, obj.operations.operatingSchedule);
    if (res.status === 'invalid' && res.missingRef) {
      invalidObjectShifts.push({ obj, missingRef: res.missingRef });
    }
  }

  for (const worker of workers) {
    const res = matchShiftsInList(shifts, worker.shiftId, undefined);
    if (res.status === 'invalid' && res.missingRef) {
      invalidWorkerShifts.push({ worker, missingRef: res.missingRef });
    }
  }

  return {
    overlappingShifts,
    overlappingBreaks,
    breaksOutsideShift,
    invalidMaintenanceWindows,
    invalidObjectShifts,
    invalidWorkerShifts,
    maintenanceOutsideHorizon,
    overlappingMaintenanceWindows,
  };
}

/**
 * Independent Resource Calendar Engine.
 * Resolves shift, break, and planned maintenance calendars per resource
 * (machines, workstations, conveyors, and workers) clipped cleanly to [0, simDurationSec].
 */
export class ResourceCalendarEngine {
  private readonly simDurationSec: number;
  private readonly shifts: ShiftDefinition[];
  private readonly hasExplicitPlantShifts: boolean;
  private readonly globalMaintWindows: PlannedMaintenanceWindow[];

  constructor(config: SimulationConfig, horizonSec?: number) {
    this.simDurationSec = Math.max(1e-6, horizonSec ?? config.durationSec ?? 1e-6);
    if (config.shifts && config.shifts.length > 0) {
      this.shifts = config.shifts;
      this.hasExplicitPlantShifts = true;
    } else {
      this.hasExplicitPlantShifts = false;
      this.shifts = [
        {
          id: 'shift_default',
          name: 'Default Shift',
          startSec: 0,
          durationSec: this.simDurationSec,
          breaks: [],
        },
      ];
    }
    this.globalMaintWindows = config.maintenanceWindows || [];
  }

  public getHorizonSec(): number {
    return this.simDurationSec;
  }

  public resolveResourceShiftStatus(shiftId?: string, scheduleName?: string): ResourceShiftResolution {
    const cleanShiftId = shiftId?.trim() || '';
    const cleanSchedule = scheduleName?.trim() || '';
    if (!cleanShiftId && !cleanSchedule) {
      return { status: 'unassigned', shifts: this.shifts };
    }
    const configuredShifts = this.hasExplicitPlantShifts ? this.shifts : [];
    return matchShiftsInList(configuredShifts, cleanShiftId, cleanSchedule);
  }

  private getShiftsForResource(shiftId?: string, scheduleName?: string): ShiftDefinition[] {
    return this.resolveResourceShiftStatus(shiftId, scheduleName).shifts;
  }

  public getClippedShiftIntervals(shiftId?: string, scheduleName?: string, upToSec?: number): TimeInterval[] {
    const horizon = Math.min(this.simDurationSec, Math.max(0, upToSec ?? this.simDurationSec));
    const applicable = this.getShiftsForResource(shiftId, scheduleName);
    return mergeIntervals(
      clipIntervals(
        applicable.map((sh) => ({
          startSec: sh.startSec,
          endSec: sh.startSec + Math.max(0, sh.durationSec),
          id: sh.id,
          label: sh.name,
        })),
        0,
        horizon
      )
    );
  }

  public getClippedBreakIntervals(shiftId?: string, scheduleName?: string, upToSec?: number): TimeInterval[] {
    const horizon = Math.min(this.simDurationSec, Math.max(0, upToSec ?? this.simDurationSec));
    const applicable = this.getShiftsForResource(shiftId, scheduleName);
    const rawBreaks: TimeInterval[] = [];
    for (const sh of applicable) {
      const shStart = Math.max(0, sh.startSec);
      const shEnd = Math.min(horizon, sh.startSec + Math.max(0, sh.durationSec));
      if (shEnd <= shStart) continue;
      for (const brk of sh.breaks || []) {
        const bStart = Math.max(shStart, brk.startSec);
        const bEnd = Math.min(shEnd, brk.startSec + Math.max(0, brk.durationSec));
        if (bEnd > bStart) {
          rawBreaks.push({ startSec: bStart, endSec: bEnd, id: brk.id, label: brk.name });
        }
      }
    }
    return mergeIntervals(rawBreaks);
  }

  public getObjectMaintenanceIntervals(obj: LayoutObject, upToSec?: number): TimeInterval[] {
    const horizon = Math.min(this.simDurationSec, Math.max(0, upToSec ?? this.simDurationSec));
    const windows: PlannedMaintenanceWindow[] = [
      ...this.globalMaintWindows.filter((w) => !w.objectId || w.objectId === obj.id),
      ...(obj.operations.plannedMaintenance || []),
    ];
    return mergeIntervals(
      clipIntervals(
        windows.map((w) => ({
          startSec: w.startSec,
          endSec: w.startSec + Math.max(0, w.durationSec),
          id: w.id,
          label: w.name,
        })),
        0,
        horizon
      )
    );
  }

  public isPlantShiftActiveAt(tSec: number): boolean {
    const shifts = this.getClippedShiftIntervals();
    return containsTimestamp(shifts, tSec);
  }

  public isPlantOnBreakAt(tSec: number): boolean {
    const breaks = this.getClippedBreakIntervals();
    return containsTimestamp(breaks, tSec);
  }

  public getWorkerAvailabilityAt(worker: WorkerDefinition, tSec: number): ResourceAvailabilityState {
    const shifts = this.getClippedShiftIntervals(worker.shiftId);
    if (!containsTimestamp(shifts, tSec)) {
      return { available: false, reason: 'off_shift' };
    }
    const breaks = this.getClippedBreakIntervals(worker.shiftId);
    if (containsTimestamp(breaks, tSec)) {
      return { available: false, reason: 'break' };
    }
    return { available: true, reason: 'active' };
  }

  public getObjectAvailabilityAt(obj: LayoutObject, tSec: number): ResourceAvailabilityState {
    const shifts = this.getClippedShiftIntervals(obj.operations.shiftId, obj.operations.operatingSchedule);
    if (!containsTimestamp(shifts, tSec)) {
      return { available: false, reason: 'off_shift' };
    }
    const maint = this.getObjectMaintenanceIntervals(obj);
    if (containsTimestamp(maint, tSec)) {
      return { available: false, reason: 'maintenance' };
    }
    if (!obj.operations.runDuringBreaks) {
      const breaks = this.getClippedBreakIntervals(obj.operations.shiftId, obj.operations.operatingSchedule);
      if (containsTimestamp(breaks, tSec)) {
        return { available: false, reason: 'break' };
      }
    }
    return { available: true, reason: 'active' };
  }

  public getObjectCalendarMetrics(obj: LayoutObject, upToSec?: number): ObjectCalendarMetrics {
    const horizon = Math.min(this.simDurationSec, Math.max(0, upToSec ?? this.simDurationSec));
    const shiftIntervals = this.getClippedShiftIntervals(
      obj.operations.shiftId,
      obj.operations.operatingSchedule,
      horizon
    );
    const shiftWindowSec = sumIntervals(shiftIntervals);

    const maintIntervals = intersectIntervals(
      shiftIntervals,
      this.getObjectMaintenanceIntervals(obj, horizon)
    );
    const maintSec = sumIntervals(maintIntervals);

    const breakIntervals = obj.operations.runDuringBreaks
      ? []
      : subtractIntervals(
          intersectIntervals(
            shiftIntervals,
            this.getClippedBreakIntervals(obj.operations.shiftId, obj.operations.operatingSchedule, horizon)
          ),
          maintIntervals
        );
    const breakSec = sumIntervals(breakIntervals);

    const activeProductionIntervals = subtractIntervals(shiftIntervals, [
      ...maintIntervals,
      ...breakIntervals,
    ]);
    const scheduledProductionTimeSec = sumIntervals(activeProductionIntervals);
    const offShiftSec = Math.max(0, horizon - shiftWindowSec);
    const plannedDowntimeSec = offShiftSec + breakSec + maintSec;

    return {
      calendarTimeSec: horizon,
      shiftWindowSec,
      breakDowntimeSec: breakSec,
      maintenanceDowntimeSec: maintSec,
      plannedDowntimeSec,
      scheduledProductionTimeSec,
    };
  }

  /**
   * Computes plant-wide net active production time across [0, upToSec].
   */
  public getPlantCalendarMetrics(objects: LayoutObject[], upToSec?: number): ObjectCalendarMetrics {
    const horizon = Math.min(this.simDurationSec, Math.max(0, upToSec ?? this.simDurationSec));
    const shiftIntervals = this.getClippedShiftIntervals(undefined, undefined, horizon);
    const shiftWindowSec = sumIntervals(shiftIntervals);

    const plantMaint = intersectIntervals(
      shiftIntervals,
      mergeIntervals(
        clipIntervals(
          this.globalMaintWindows
            .filter((w) => !w.objectId)
            .map((w) => ({ startSec: w.startSec, endSec: w.startSec + Math.max(0, w.durationSec) })),
          0,
          horizon
        )
      )
    );
    const maintSec = sumIntervals(plantMaint);

    const allEquipRunDuringBreaks =
      objects.length > 0 &&
      objects
        .filter((o) => o.kind !== 'storage' && o.kind !== 'vehicle')
        .every((o) => Boolean(o.operations.runDuringBreaks));

    const breakIntervals = allEquipRunDuringBreaks
      ? []
      : subtractIntervals(
          intersectIntervals(shiftIntervals, this.getClippedBreakIntervals(undefined, undefined, horizon)),
          plantMaint
        );
    const breakSec = sumIntervals(breakIntervals);

    const activeIntervals = subtractIntervals(shiftIntervals, [...plantMaint, ...breakIntervals]);
    const scheduledProductionTimeSec = sumIntervals(activeIntervals);
    const offShiftSec = Math.max(0, horizon - shiftWindowSec);
    const plannedDowntimeSec = offShiftSec + breakSec + maintSec;

    return {
      calendarTimeSec: horizon,
      shiftWindowSec,
      breakDowntimeSec: breakSec,
      maintenanceDowntimeSec: maintSec,
      plannedDowntimeSec,
      scheduledProductionTimeSec,
    };
  }

  /**
   * Collects all clipped calendar boundary events (shift, break, maintenance) in [0, horizon].
   */
  public getCalendarTransitions(objects: LayoutObject[]): CalendarTransitionPoint[] {
    const pts: CalendarTransitionPoint[] = [];
    const H = this.simDurationSec;

    for (const sh of this.shifts) {
      const sStart = Math.max(0, sh.startSec);
      const sEnd = Math.min(H, sh.startSec + Math.max(0, sh.durationSec));
      if (sEnd <= sStart) continue;
      pts.push({
        timestamp: sStart,
        kind: 'shift_start',
        shiftId: sh.id,
        shiftName: sh.name,
      });
      pts.push({
        timestamp: sEnd,
        kind: 'shift_end',
        shiftId: sh.id,
        shiftName: sh.name,
      });

      for (const brk of sh.breaks || []) {
        const bStart = Math.max(sStart, brk.startSec);
        const bEnd = Math.min(sEnd, brk.startSec + Math.max(0, brk.durationSec));
        if (bEnd <= bStart) continue;
        pts.push({
          timestamp: bStart,
          kind: 'break_start',
          shiftId: sh.id,
          shiftName: sh.name,
          breakId: brk.id,
          breakName: brk.name,
        });
        pts.push({
          timestamp: bEnd,
          kind: 'break_end',
          shiftId: sh.id,
          shiftName: sh.name,
          breakId: brk.id,
          breakName: brk.name,
        });
      }
    }

    for (const win of this.globalMaintWindows) {
      const mStart = Math.max(0, win.startSec);
      const mEnd = Math.min(H, win.startSec + Math.max(0, win.durationSec));
      if (mEnd <= mStart) continue;
      pts.push({
        timestamp: mStart,
        kind: 'maintenance_start',
        maintenanceId: win.id,
        maintenanceName: win.name,
        targetObjectId: win.objectId,
      });
      pts.push({
        timestamp: mEnd,
        kind: 'maintenance_end',
        maintenanceId: win.id,
        maintenanceName: win.name,
        targetObjectId: win.objectId,
      });
    }

    for (const obj of objects) {
      for (const win of obj.operations.plannedMaintenance || []) {
        const mStart = Math.max(0, win.startSec);
        const mEnd = Math.min(H, win.startSec + Math.max(0, win.durationSec));
        if (mEnd <= mStart) continue;
        pts.push({
          timestamp: mStart,
          kind: 'maintenance_start',
          maintenanceId: win.id,
          maintenanceName: win.name,
          targetObjectId: obj.id,
        });
        pts.push({
          timestamp: mEnd,
          kind: 'maintenance_end',
          maintenanceId: win.id,
          maintenanceName: win.name,
          targetObjectId: obj.id,
        });
      }
    }

    const order: Record<CalendarTransitionPoint['kind'], number> = {
      shift_start: 1,
      break_end: 2,
      maintenance_end: 3,
      maintenance_start: 4,
      break_start: 5,
      shift_end: 6,
    };

    return pts.sort((a, b) => a.timestamp - b.timestamp || order[a.kind] - order[b.kind]);
  }
}
