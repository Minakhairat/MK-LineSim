import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ResourceCalendarEngine,
  validateSimulationCalendars,
} from '../src/simulation/resourceCalendar';
import { LayoutObject, SimulationConfig, WorkerDefinition } from '../src/types/project';

function makeBaseConfig(overrides?: Partial<SimulationConfig>): SimulationConfig {
  return {
    durationSec: 28800,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 0,
    speedMultiplier: 1,
    enableBreakdowns: false,
    randomSeed: 4219,
    shifts: [
      {
        id: 'sh_1',
        name: 'Day Shift',
        startSec: 0,
        durationSec: 28800,
        breaks: [{ id: 'b1', name: 'Lunch', startSec: 14400, durationSec: 1800 }],
      },
    ],
    maintenanceWindows: [],
    ...overrides,
  };
}

function makeObj(overrides?: Partial<LayoutObject['operations']>): LayoutObject {
  return {
    id: 'obj_1',
    name: 'Oven 1',
    kind: 'machine',
    category: 'workstation',
    templateId: 'tpl_ws',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 1.2 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: 30,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 1,
      requiredOperators: 1,
      ...overrides,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

test('ResourceCalendarEngine detects overlapping shifts, overlapping breaks, and breaks outside shift', () => {
  const cfg = makeBaseConfig({
    shifts: [
      {
        id: 'sh_1',
        name: 'Shift A',
        startSec: 0,
        durationSec: 14400,
        breaks: [
          { id: 'b1', name: 'Break 1', startSec: 3600, durationSec: 900 },
          { id: 'b2', name: 'Break 2', startSec: 4000, durationSec: 900 },
          { id: 'b3', name: 'Break Outside', startSec: 14000, durationSec: 900 },
        ],
      },
      {
        id: 'sh_2',
        name: 'Shift B',
        startSec: 12000,
        durationSec: 14400,
        breaks: [],
      },
    ],
    maintenanceWindows: [{ id: 'mw_bad', name: 'Invalid PM', startSec: -10, durationSec: 0 }],
  });

  const validation = validateSimulationCalendars(cfg);
  assert.equal(validation.overlappingShifts.length, 1);
  assert.equal(validation.overlappingShifts[0].overlapSec, 2400);
  assert.equal(validation.overlappingBreaks.length, 1);
  assert.equal(validation.overlappingBreaks[0].overlapSec, 500);
  assert.equal(validation.breaksOutsideShift.length, 1);
  assert.equal(validation.invalidMaintenanceWindows.length, 1);
});

test('ResourceCalendarEngine handles multiple shifts, horizon clipping, and planned maintenance', () => {
  const cfg = makeBaseConfig({
    durationSec: 10800,
    shifts: [
      { id: 'sh_1', name: 'Shift 1', startSec: 0, durationSec: 3600, breaks: [] },
      { id: 'sh_2', name: 'Shift 2', startSec: 7200, durationSec: 7200, breaks: [] }, // clipped at 10800
    ],
    maintenanceWindows: [{ id: 'mw_1', name: 'PM', startSec: 1800, durationSec: 300 }],
  });

  const cal = new ResourceCalendarEngine(cfg);
  const obj = makeObj();
  const metrics = cal.getObjectCalendarMetrics(obj);

  assert.equal(metrics.calendarTimeSec, 10800);
  assert.equal(metrics.shiftWindowSec, 7200);
  assert.equal(metrics.maintenanceDowntimeSec, 300);
  assert.equal(metrics.plannedDowntimeSec, 3900); // 3600 off-shift + 300 maintenance
  assert.equal(metrics.scheduledProductionTimeSec, 6900);
  assert.equal(cal.getObjectAvailabilityAt(obj, 1900).reason, 'maintenance');
  assert.equal(cal.getObjectAvailabilityAt(obj, 5000).reason, 'off_shift');
  assert.equal(cal.getObjectAvailabilityAt(obj, 8000).available, true);
});

test('Automatic machine with runDuringBreaks continues operating during worker break', () => {
  const cfg = makeBaseConfig({
    durationSec: 3600,
    shifts: [
      {
        id: 'sh_1',
        name: 'Shift 1',
        startSec: 0,
        durationSec: 3600,
        breaks: [{ id: 'b1', name: 'Coffee Break', startSec: 1800, durationSec: 600 }],
      },
    ],
  });
  const cal = new ResourceCalendarEngine(cfg);
  const autoMachine = makeObj({ runDuringBreaks: true });
  const manualMachine = makeObj({ runDuringBreaks: false });
  const worker: WorkerDefinition = {
    id: 'w1',
    label: 'OP-1',
    name: 'Operator 1',
    position: { x: 0, y: 0, z: 0 },
    assignedStageIds: [],
    skillCategory: 'General',
    skillLevel: 3,
    efficiencyFactor: 1,
    walkingSpeedMps: 1.25,
    shiftId: 'sh_1',
    color: '#2563EB',
  };

  assert.equal(cal.getWorkerAvailabilityAt(worker, 2000).available, false);
  assert.equal(cal.getWorkerAvailabilityAt(worker, 2000).reason, 'break');
  assert.equal(cal.getObjectAvailabilityAt(manualMachine, 2000).available, false);
  assert.equal(cal.getObjectAvailabilityAt(autoMachine, 2000).available, true);
});
