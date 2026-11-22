import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConveyorPhysics } from '../src/engineering/conveyorPhysics';
import { computeOeeMetrics } from '../src/engineering/oeeEngine';
import { computeStageCapacityProfile } from '../src/engineering/capacityEngine';
import { LayoutObject, ProductDefinition, ProductionStage } from '../src/types/project';

function makeConveyor(length: number, width: number, speedMps = 0.5, spacing = 0.2): LayoutObject {
  return {
    id: 'conv_1',
    name: 'Belt 1',
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conv',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length, width, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.2,
    },
    operations: {
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 0,
      availability: 1,
      requiredOperators: 0,
      speedMps,
      productSpacingM: spacing,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
  };
}

function makeProduct(length: number, width: number): ProductDefinition {
  return {
    id: 'p1',
    code: 'P1',
    name: 'Item',
    category: 'Unit',
    dimensions: { length, width, height: 0.4 },
    weightKg: 2,
    color: '#2563EB',
    targetQuantity: 0,
    routeStageIds: [],
    modelShape: 'box',
  };
}

test('ConveyorPhysics rejects products exceeding belt length or width without forcing capacity=1', () => {
  const conv = makeConveyor(5, 0.6, 0.5, 0.2);

  const ok = evaluateConveyorPhysics(conv, makeProduct(0.8, 0.4));
  assert.equal(ok.canFit, true);
  assert.equal(ok.physicalCapacity, 5);
  assert.equal(ok.traversalTimeSec, 10);
  assert.equal(ok.minHeadwaySec, 2);

  const tooWide = evaluateConveyorPhysics(conv, makeProduct(0.8, 0.75));
  assert.equal(tooWide.canFit, false);
  assert.equal(tooWide.physicalCapacity, 0);
  assert.equal(tooWide.fitErrorCode, 'WIDTH_EXCEEDS_BELT');

  const tooLong = evaluateConveyorPhysics(conv, makeProduct(5.5, 0.4));
  assert.equal(tooLong.canFit, false);
  assert.equal(tooLong.physicalCapacity, 0);
  assert.equal(tooLong.fitErrorCode, 'LENGTH_EXCEEDS_BELT');
});

test('OEE Engine calculates exact formal Time Hierarchy and A × P × Q', () => {
  const oee = computeOeeMetrics({
    calendarTimeSec: 28800, // 8h
    plannedDowntimeSec: 1800, // 30m break -> SPT = 27000
    unplannedDowntimeSec: 1350, // 5% of SPT
    setupTimeSec: 1350, // 5% of SPT -> OT = 24300 (Availability = 90%)
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 729, // ideal time = 21870 / 24300 = 90% Performance
    goodUnitsProduced: 656.1, // 90% Quality
  });

  assert.equal(oee.scheduledProductionTimeSec, 27000);
  assert.equal(oee.operatingTimeSec, 24300);
  assert.ok(Math.abs(oee.availabilityPct - 90) < 0.001);
  assert.ok(Math.abs(oee.performancePct - 90) < 0.001);
  assert.ok(Math.abs(oee.qualityPct - 90) < 0.001);
  assert.ok(Math.abs(oee.oeePct - 72.9) < 0.01);
});

test('CapacityEngine avoids double-counting conveyors/buffers or batch container size as parallel servers', () => {
  const stage: ProductionStage = {
    id: 'st_1',
    code: 'OP-1',
    name: 'Palletizing',
    description: '',
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
    bufferCapacity: 12,
    predecessorIds: [],
    successorIds: [],
    assignedObjectIds: ['m1'],
    batchSize: 4,
    batchMode: 'collect_batch',
  };
  const machine: LayoutObject = {
    id: 'm1',
    name: 'Palletizer',
    kind: 'machine',
    category: 'palletizer_robot',
    templateId: 'tpl_pal',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 2, height: 2 },
      rotationDeg: 0,
      clearanceM: 0.4,
    },
    operations: {
      processingTimeSec: 40,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 1,
      requiredOperators: 0,
      batchSize: 4,
      batchMode: 'collect_batch',
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
  const bufObj: LayoutObject = {
    ...makeConveyor(3, 1),
    id: 'b1',
    kind: 'buffer',
    category: 'buffer',
    operations: { ...machine.operations, capacity: 20 },
  };

  const profile = computeStageCapacityProfile(stage, [machine, bufObj]);
  assert.equal(profile.batchSize, 4);
  // Machine has capacity 1, buffer is queue storage (never a parallel machine server)
  assert.equal(profile.parallelServers, 1);
  assert.equal(profile.effectiveUnitCycleSec, 40 / 4);
});
