import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStateTracker } from '../src/simulation/resourceStateTracker';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { ObjectRuntimeState, ProjectData } from '../src/types/project';

test('ResourceStateTracker separates unavailable off-shift/break states from idle and guarantees idempotent finalizeAt', () => {
  const tracker = new ResourceStateTracker(10800, true);
  const rt = new Map<string, ObjectRuntimeState>();
  const stateObj: ObjectRuntimeState = {
    objectId: 'm1',
    status: 'running',
    conveyorStatus: 'stopped',
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
  };
  rt.set('m1', stateObj);

  tracker.initMachine('m1', 'running', 0);
  tracker.transitionMachine('m1', 'unavailable', 3600, stateObj);

  // Repeated finalizeAt calls must remain idempotent
  tracker.finalizeAt(10800, rt);
  tracker.finalizeAt(10800, rt);
  tracker.finalizeAt(10800, rt);

  const totals = tracker.getMachineTotals('m1');
  assert.equal(totals.running, 3600);
  assert.equal(totals.unavailable, 7200);
  assert.equal(totals.idle, 0);
  assert.equal(totals.total, 10800);
  assert.equal(stateObj.unavailableTimeSec, 7200);
});

test('Scenario C1: DES assigns off-shift and break time strictly to unavailable, conserving exact horizon', () => {
  const proj: ProjectData = {
    schemaVersion: '1.0.0',
    id: 'state_acc',
    name: 'State Accounting',
    factoryName: 'Plant',
    industryType: 'Test',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    factory: {
      name: 'Floor',
      lengthM: 30,
      widthM: 15,
      heightM: 5,
      unit: 'm',
      gridSizeM: 1,
      snapToGrid: true,
      columns: [],
      openings: [],
      zones: [],
    },
    productionLines: [],
    layoutObjects: [
      {
        id: 'm1',
        name: 'CNC 1',
        kind: 'machine',
        category: 'cnc_machine',
        templateId: 'tpl_cnc',
        stageId: 'st_1',
        connectedToIds: [],
        geometry: {
          position: { x: 5, y: 0, z: 5 },
          dimensions: { length: 2, width: 1.5, height: 1.5 },
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
          requiredOperators: 0,
          shiftId: 'shift_1',
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
      },
    ],
    products: [
      {
        id: 'p1',
        code: 'P1',
        name: 'Part',
        category: 'Part',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 2,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: ['st_1'],
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages: [
      {
        id: 'st_1',
        code: 'OP-10',
        name: 'Machining',
        description: '',
        processingTimeSec: 30,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        requiredWorkers: 0,
        requiredMachines: 1,
        inputQty: 1,
        outputQty: 1,
        scrapRate: 0,
        reworkProbability: 0,
        bufferCapacity: 200,
        predecessorIds: [],
        successorIds: [],
        assignedObjectIds: ['m1'],
      },
    ],
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec: 10800,
      arrivalIntervalSec: 30,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 99,
      shifts: [
        {
          id: 'shift_1',
          name: 'Morning',
          startSec: 0,
          durationSec: 3600,
          breaks: [{ id: 'b1', name: 'Tea Break', startSec: 1800, durationSec: 600 }],
        },
        { id: 'shift_2', name: 'Afternoon', startSec: 3600, durationSec: 7200, breaks: [] },
      ],
      maintenanceWindows: [],
    },
    scenarios: [],
  };

  const eng = new DiscreteEventSimulationEngine(proj);
  const res = eng.runToCompletion();
  const rt = eng.getSnapshot().objects['m1'];
  assert.ok(rt);

  const unavail = rt.unavailableTimeSec ?? 0;
  const sum =
    rt.runningTimeSec +
    rt.idleTimeSec +
    rt.blockedTimeSec +
    rt.starvedTimeSec +
    (rt.setupTimeSec ?? 0) +
    rt.downTimeSec +
    (rt.maintenanceTimeSec ?? 0) +
    unavail;

  // Off-shift [3600..10800] (7200s) + break [1800..2400] (600s) = 7800s unavailable; 3000s scheduled
  assert.ok(Math.abs(sum - 10800) < 1e-6, `Exact conservation failed: ${sum}`);
  assert.ok(Math.abs(unavail - 7800) < 1, `Expected 7800s unavailable, got ${unavail}`);
  assert.equal(rt.idleTimeSec, 0);

  const sa = res.stageAnalytics[0];
  assert.ok(Math.abs((sa.scheduledUtilizationPct ?? 0) - 100) < 1);
  assert.ok(Math.abs((sa.calendarUtilizationPct ?? 0) - (3000 / 10800) * 100) < 0.2);
});
