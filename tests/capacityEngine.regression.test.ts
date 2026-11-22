import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStageCapacityProfile,
  resolveStageEquipmentBreakdown,
  resolveStageParallelServerCount,
} from '../src/engineering/capacityEngine';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { LayoutObject, ProductionStage, ProjectData } from '../src/types/project';

function makeObject(
  id: string,
  kind: LayoutObject['kind'],
  capacity: number,
  procSec = 40
): LayoutObject {
  return {
    id,
    name: id,
    kind,
    category: kind === 'buffer' ? 'buffer' : kind === 'conveyor' ? 'conveyor_belt' : 'cnc_machine',
    templateId: `tpl_${kind}`,
    stageId: 'st_1',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 1.2 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity,
      availability: 1,
      requiredOperators: 0,
      speedMps: kind === 'conveyor' ? 1 : undefined,
      productSpacingM: kind === 'conveyor' ? 0.2 : undefined,
      batchSize: 4,
      batchMode: 'collect_batch',
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

function makeStage(assignedObjectIds: string[]): ProductionStage {
  return {
    id: 'st_1',
    code: 'OP-10',
    name: 'Palletizer',
    description: 'Palletizing',
    processingTimeSec: 40,
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
    assignedObjectIds,
    batchSize: 4,
    batchMode: 'collect_batch',
  };
}

function makeBaseProject(objects: LayoutObject[], stage: ProductionStage): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    schemaVersion: '1.0.0',
    id: 'cap_reg',
    name: 'Capacity Regression',
    factoryName: 'Plant',
    industryType: 'Packaging',
    description: '',
    createdAt: now,
    updatedAt: now,
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
    layoutObjects: objects,
    products: [
      {
        id: 'p1',
        code: 'P1',
        name: 'Unit',
        category: 'Box',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 3,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: [stage.id],
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages: [stage],
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec: 3600,
      arrivalIntervalSec: 1,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 101,
      shifts: [{ id: 's1', name: 'Shift 1', startSec: 0, durationSec: 3600, breaks: [] }],
      maintenanceWindows: [],
    },
    scenarios: [],
  };
}

test('Scenario A1: buffers, conveyors, storage, vehicles, and duplicate IDs never inflate parallel server count', () => {
  const m1 = makeObject('m1', 'machine', 1, 40);
  const buf = makeObject('b1', 'buffer', 20, 0);
  const conv = makeObject('c1', 'conveyor', 12, 0);
  const rack = makeObject('r1', 'storage', 50, 0);
  const agv = makeObject('v1', 'vehicle', 4, 0);

  const stage = makeStage(['m1', 'm1', 'b1', 'c1', 'r1', 'v1']);
  const objs = [m1, m1, buf, conv, rack, agv];

  const breakdown = resolveStageEquipmentBreakdown(stage, objs);
  assert.equal(breakdown.processingServers.length, 1);
  assert.equal(breakdown.processingCapacitySum, 1);
  assert.equal(breakdown.bufferCapacitySum, 20);
  assert.equal(breakdown.conveyorCapacitySum, 12);

  const parallel = resolveStageParallelServerCount(stage, objs);
  assert.equal(parallel, 1);

  const profile = computeStageCapacityProfile(stage, objs);
  assert.equal(profile.parallelServers, 1);
  assert.equal(profile.batchSize, 4);
  assert.equal(profile.effectiveUnitCycleSec, 10);
  assert.equal(profile.theoreticalCapacityPerHour, 360);

  const desRes = new DiscreteEventSimulationEngine(makeBaseProject([m1, buf, conv], makeStage(['m1', 'm1', 'b1', 'c1']))).runToCompletion();
  assert.ok(desRes.kpis.goodUnits >= 352 && desRes.kpis.goodUnits <= 360, `Expected ~356 units, got ${desRes.kpis.goodUnits}`);
});

test('Scenario A2: two true parallel machines double analytical capacity and DES throughput', () => {
  const m1 = makeObject('m1', 'machine', 1, 40);
  const m2 = makeObject('m2', 'machine', 1, 40);
  const buf = makeObject('b1', 'buffer', 20, 0);
  const stage = makeStage(['m1', 'm2', 'b1']);

  const profile = computeStageCapacityProfile(stage, [m1, m2, buf]);
  assert.equal(profile.parallelServers, 2);
  assert.equal(profile.effectiveUnitCycleSec, 5);
  assert.equal(profile.theoreticalCapacityPerHour, 720);

  const desRes = new DiscreteEventSimulationEngine(makeBaseProject([m1, m2, buf], stage)).runToCompletion();
  assert.ok(desRes.kpis.goodUnits >= 704 && desRes.kpis.goodUnits <= 720, `Expected ~712 units, got ${desRes.kpis.goodUnits}`);
});
