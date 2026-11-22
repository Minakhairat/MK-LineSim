import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCalendarEngine } from '../src/simulation/resourceCalendar';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { computeObjectHeatmapMetrics } from '../src/simulation/heatmap';
import { importFlowchartToSimulationData } from '../src/simulation/autoWire';
import { LayoutObject, ProjectData, SimulationConfig, WorkerDefinition } from '../src/types/project';

function makeMultiShiftConfig(durationSec = 10800): SimulationConfig {
  return {
    durationSec,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 0,
    speedMultiplier: 100,
    enableBreakdowns: false,
    randomSeed: 77,
    shifts: [
      { id: 'shift_1', name: 'Morning Shift', startSec: 0, durationSec: 3600, breaks: [] },
      { id: 'shift_2', name: 'Afternoon Shift', startSec: 3600, durationSec: 7200, breaks: [] },
    ],
    maintenanceWindows: [],
  };
}

function makeMachine(id: string, shiftId?: string, operatingSchedule?: string): LayoutObject {
  return {
    id,
    name: id,
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
      shiftId,
      operatingSchedule,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

test('Invalid explicit shiftId or operatingSchedule never silently falls back to plant shifts', () => {
  const cfg = makeMultiShiftConfig(10800);
  const cal = new ResourceCalendarEngine(cfg);

  const unassignedObj = makeMachine('m_unassigned', undefined, undefined);
  assert.equal(cal.resolveResourceShiftStatus(undefined, undefined).status, 'unassigned');
  assert.equal(cal.getObjectCalendarMetrics(unassignedObj).scheduledProductionTimeSec, 10800);

  const matchedObj = makeMachine('m_shift1', 'shift_1');
  assert.equal(cal.resolveResourceShiftStatus('shift_1').status, 'matched');
  assert.equal(cal.getObjectCalendarMetrics(matchedObj).scheduledProductionTimeSec, 3600);

  const badShiftObj = makeMachine('m_bad', 'missing_shift');
  assert.equal(cal.resolveResourceShiftStatus('missing_shift').status, 'invalid');
  assert.equal(cal.getObjectAvailabilityAt(badShiftObj, 100).available, false);
  assert.equal(cal.getObjectAvailabilityAt(badShiftObj, 100).reason, 'off_shift');
  assert.equal(cal.getObjectCalendarMetrics(badShiftObj).scheduledProductionTimeSec, 0);

  const badSchedObj = makeMachine('m_bad_sched', undefined, 'Night Ghost Shift');
  assert.equal(cal.resolveResourceShiftStatus(undefined, 'Night Ghost Shift').status, 'invalid');
  assert.equal(cal.getObjectCalendarMetrics(badSchedObj).scheduledProductionTimeSec, 0);
});

test('Heatmap evaluates utilization against resource-specific scheduled calendar time', () => {
  const cfg = makeMultiShiftConfig(10800);
  const mShift1 = makeMachine('m_s1', 'shift_1');

  const heat = computeObjectHeatmapMetrics({
    obj: mShift1,
    runtime: {
      objectId: 'm_s1',
      status: 'unavailable',
      conveyorStatus: 'stopped',
      busyUnitIds: [],
      queueUnitIds: [],
      processedCount: 120,
      scrapCount: 0,
      runningTimeSec: 3600,
      idleTimeSec: 0,
      blockedTimeSec: 0,
      starvedTimeSec: 0,
      setupTimeSec: 0,
      downTimeSec: 0,
      maintenanceTimeSec: 0,
      unavailableTimeSec: 7200,
      movingTimeSec: 0,
      stoppedTimeSec: 0,
      lastStateChangeTime: 10800,
    },
    clockSec: 10800,
    activeSimTimeSec: 10800,
    simulationConfig: cfg,
  });

  // 3600s running out of 3600s scheduled -> 100% scheduled util, 33.3% calendar util
  assert.ok(Math.abs(heat.utilPct - 100) < 0.01, `Expected 100% util, got ${heat.utilPct}`);
  assert.ok(Math.abs((heat.calendarUtilPct ?? 0) - 33.3333) < 0.1);
});

test('Conveyors support manual inspection/work stages and assigned workers directly in flowchart import and DES', () => {
  const conv: LayoutObject = {
    id: 'conv_work',
    name: 'Inspection Belt',
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conv',
    stageId: 'st_conv',
    connectedToIds: [],
    geometry: {
      position: { x: 8, y: 0, z: 5 },
      dimensions: { length: 4, width: 0.8, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.2,
    },
    operations: {
      processingTimeSec: 20,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 4,
      availability: 1,
      requiredOperators: 1,
      speedMps: 1.0, // transit = 4s
      productSpacingM: 0.2,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
  };
  const worker: WorkerDefinition = {
    id: 'w1',
    label: 'W-01',
    name: 'Inspector',
    position: { x: 8, y: 0, z: 6.2 },
    rotationDeg: -90,
    assignedStageIds: ['st_conv'],
    assignedStationId: 'conv_work',
    skillCategory: 'QA',
    skillLevel: 4,
    efficiencyFactor: 1.0,
    walkingSpeedMps: 2.0,
    shiftId: 'shift_1',
    color: '#1D4ED8',
  };
  const proj: ProjectData = {
    schemaVersion: '1.0.0',
    id: 'conv_work_proj',
    name: 'On-Conveyor Work',
    factoryName: 'Plant',
    industryType: 'Assembly',
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
    layoutObjects: [conv],
    products: [
      {
        id: 'p1',
        code: 'P1',
        name: 'Item',
        category: 'Unit',
        dimensions: { length: 0.5, width: 0.4, height: 0.3 },
        weightKg: 2,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: ['st_conv'],
        entryStageIds: ['st_conv'],
        modelShape: 'box',
        routingMode: 'manual',
      },
    ],
    stages: [
      {
        id: 'st_conv',
        code: 'CV-10',
        name: 'Belt Inspection',
        description: '',
        processingTimeSec: 20,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        requiredWorkers: 1,
        requiredMachines: 1,
        inputQty: 1,
        outputQty: 1,
        scrapRate: 0,
        reworkProbability: 0,
        bufferCapacity: 5,
        predecessorIds: [],
        successorIds: [],
        assignedObjectIds: ['conv_work'],
        conveyorObjectId: 'conv_work',
      },
    ],
    routes: [],
    workers: [worker],
    simulationConfig: {
      durationSec: 600,
      arrivalIntervalSec: 30,
      maxPlannedUnits: 10,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 42,
      shifts: [{ id: 'shift_1', name: 'S1', startSec: 0, durationSec: 600, breaks: [] }],
      maintenanceWindows: [],
    },
    scenarios: [],
  };

  // Importing flowchart preserves worker requirement and manual work time on conveyor
  const imported = importFlowchartToSimulationData(proj);
  assert.equal(imported.updated.stages[0].requiredWorkers, 1);
  assert.equal(imported.updated.stages[0].processingTimeSec, 20);

  // Running DES allocates worker on conveyor and takes transit (4s) + manual work (20s) >= 24s per item
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.goodUnits, 10);
  assert.ok(res.kpis.workerUtilizationPct > 0, `Expected worker assigned to conveyor to have >0% util, got ${res.kpis.workerUtilizationPct}`);
  assert.ok(res.kpis.avgLeadTimeSec >= 24, `Expected conveyor transit (4s) + work (20s) >= 24s, got ${res.kpis.avgLeadTimeSec}`);
});
