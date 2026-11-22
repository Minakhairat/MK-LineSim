import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { LayoutObject, ProjectData } from '../src/types/project';

function makeMachine(id: string, stageId: string, procSec: number, shiftId: string): LayoutObject {
  return {
    id,
    name: id,
    kind: 'machine',
    category: 'cnc_machine',
    templateId: 'tpl_cnc',
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 1.5 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 1,
      requiredOperators: 0,
      shiftId,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

test('Scenario B2: heterogeneous shift calendars yield accurate individual Resource OEE and weighted Plant OEE', () => {
  const m1 = makeMachine('m1', 'st_1', 30, 'shift_1');
  const m2 = makeMachine('m2', 'st_2', 60, 'shift_2');

  const proj: ProjectData = {
    schemaVersion: '1.0.0',
    id: 'oee_reg',
    name: 'Heterogeneous Shifts OEE',
    factoryName: 'Plant',
    industryType: 'Manufacturing',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    factory: {
      name: 'Floor',
      lengthM: 40,
      widthM: 20,
      heightM: 6,
      unit: 'm',
      gridSizeM: 1,
      snapToGrid: true,
      columns: [],
      openings: [],
      zones: [],
    },
    productionLines: [],
    layoutObjects: [m1, m2],
    products: [
      {
        id: 'p1',
        code: 'P1',
        name: 'Part',
        category: 'Unit',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 3,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: ['st_1', 'st_2'],
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages: [
      {
        id: 'st_1',
        code: 'OP-10',
        name: 'Op 1',
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
        bufferCapacity: 300,
        predecessorIds: [],
        successorIds: ['st_2'],
        assignedObjectIds: ['m1'],
      },
      {
        id: 'st_2',
        code: 'OP-20',
        name: 'Op 2',
        description: '',
        processingTimeSec: 60,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        requiredWorkers: 0,
        requiredMachines: 1,
        inputQty: 1,
        outputQty: 1,
        scrapRate: 0,
        reworkProbability: 0,
        bufferCapacity: 300,
        predecessorIds: ['st_1'],
        successorIds: [],
        assignedObjectIds: ['m2'],
      },
    ],
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec: 7200,
      arrivalIntervalSec: 30,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 404,
      shifts: [
        { id: 'shift_1', name: 'Shift 1', startSec: 0, durationSec: 3600, breaks: [] },
        { id: 'shift_2', name: 'Shift 2', startSec: 3600, durationSec: 3600, breaks: [] },
      ],
      maintenanceWindows: [],
    },
    scenarios: [],
  };

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.ok(res.resourceAnalytics && res.resourceAnalytics.length === 2);

  const r1 = res.resourceAnalytics.find((r) => r.objectId === 'm1')!;
  const r2 = res.resourceAnalytics.find((r) => r.objectId === 'm2')!;

  assert.equal(r1.shiftId, 'shift_1');
  assert.equal(r1.scheduledProductionTimeSec, 3600);
  assert.equal(r1.unavailableTimeSec, 3600);
  assert.ok(Math.abs(r1.oeePct - 100) < 0.5, `Expected M1 OEE ~100%, got ${r1.oeePct}`);

  assert.equal(r2.shiftId, 'shift_2');
  assert.equal(r2.scheduledProductionTimeSec, 3600);
  assert.equal(r2.unavailableTimeSec, 3600);
  assert.ok(Math.abs(r2.oeePct - 100) < 0.5, `Expected M2 OEE ~100%, got ${r2.oeePct}`);

  assert.ok(Math.abs((res.kpis.oeePct ?? 0) - 100) < 0.5, `Expected weighted Plant OEE ~100%, got ${res.kpis.oeePct}`);
});
