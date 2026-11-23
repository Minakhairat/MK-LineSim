import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConveyorPhysics } from '../src/engineering/conveyorPhysics';
import { computeOeeMetrics } from '../src/engineering/oeeEngine';
import { computeStageCapacityProfile } from '../src/engineering/capacityEngine';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { LayoutObject, ProductDefinition, ProductEntityState, ProductionStage } from '../src/types/project';

function countPhysicalOverlaps(products: ProductEntityState[], pDef: ProductDefinition): number {
  let overlaps = 0;
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i];
      const b = products[j];
      const dy = Math.abs(a.worldPosition.y - b.worldPosition.y);
      if (dy >= 0.35) continue;
      const saL = a.isBatchCarrier
        ? a.containerKind === 'pallet'
          ? Math.max(pDef.dimensions.length, 1.05)
          : a.containerKind === 'pack'
          ? Math.max(pDef.dimensions.length, 0.68)
          : Math.max(pDef.dimensions.length, 0.72)
        : Math.max(0.2, pDef.dimensions.length);
      const saW = a.isBatchCarrier
        ? a.containerKind === 'pallet'
          ? Math.max(pDef.dimensions.width, 0.85)
          : a.containerKind === 'pack'
          ? Math.max(pDef.dimensions.width, 0.52)
          : Math.max(pDef.dimensions.width, 0.56)
        : Math.max(0.2, pDef.dimensions.width);
      const sbL = b.isBatchCarrier
        ? b.containerKind === 'pallet'
          ? Math.max(pDef.dimensions.length, 1.05)
          : b.containerKind === 'pack'
          ? Math.max(pDef.dimensions.length, 0.68)
          : Math.max(pDef.dimensions.length, 0.72)
        : Math.max(0.2, pDef.dimensions.length);
      const sbW = b.isBatchCarrier
        ? b.containerKind === 'pallet'
          ? Math.max(pDef.dimensions.width, 0.85)
          : b.containerKind === 'pack'
          ? Math.max(pDef.dimensions.width, 0.52)
          : Math.max(pDef.dimensions.width, 0.56)
        : Math.max(0.2, pDef.dimensions.width);
      const ra = ((a.rotationDeg || 0) * Math.PI) / 180;
      const rb = ((b.rotationDeg || 0) * Math.PI) / 180;
      const axExtX = Math.abs(Math.cos(ra)) * saL + Math.abs(Math.sin(ra)) * saW;
      const axExtZ = Math.abs(Math.sin(ra)) * saL + Math.abs(Math.cos(ra)) * saW;
      const bxExtX = Math.abs(Math.cos(rb)) * sbL + Math.abs(Math.sin(rb)) * sbW;
      const bxExtZ = Math.abs(Math.sin(rb)) * sbL + Math.abs(Math.cos(rb)) * sbW;
      const dx = Math.abs(a.worldPosition.x - b.worldPosition.x);
      const dz = Math.abs(a.worldPosition.z - b.worldPosition.z);
      if (dx < (axExtX + bxExtX) / 2 - 0.02 && dz < (axExtZ + bxExtZ) / 2 - 0.02) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

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

test('DES enforces zero physical product overlap on baseline and rapid arrival rates', () => {
  for (const intervalSec of [55, 15]) {
    const project = createDesertAirCoolerProject();
    project.simulationConfig.arrivalIntervalSec = intervalSec;
    const engine = new DiscreteEventSimulationEngine(project);
    const prodDef = project.products[0];

    let maxUnitsObserved = 0;
    for (let t = 2; t <= 1200; t += 2) {
      engine.advanceTo(t);
      const snap = engine.getSnapshot();
      maxUnitsObserved = Math.max(maxUnitsObserved, snap.products.length);
      const overlaps = countPhysicalOverlaps(snap.products, prodDef);
      assert.equal(
        overlaps,
        0,
        `Detected ${overlaps} overlapping product pairs at t=${t}s (interval=${intervalSec}s)`
      );
    }
    assert.ok(maxUnitsObserved > 5, 'Expected multiple simultaneous units moving/queued');
  }
});

test('DES accumulating conveyor holds trailing units at physical pitch behind blocked leader with rotated heading', () => {
  const project = createDesertAirCoolerProject();
  const prod = { ...makeProduct(0.75, 0.45), routeStageIds: ['stg_c', 'stg_m'] };
  const conv = makeConveyor(6, 0.9, 0.5, 0.25);
  conv.id = 'conv_rot';
  conv.stageId = 'stg_c';
  conv.geometry.position = { x: 10, y: 0, z: 8 };
  conv.geometry.rotationDeg = 90; // belt moves along +Z
  conv.connectedToIds = ['mach_slow'];

  const slowMachine: LayoutObject = {
    id: 'mach_slow',
    name: 'Slow Press',
    kind: 'machine',
    category: 'cnc_machine',
    templateId: 'tpl_m',
    stageId: 'stg_m',
    connectedToIds: [],
    geometry: {
      position: { x: 10, y: 0, z: 12.2 },
      dimensions: { length: 1.6, width: 1.2, height: 1.0 },
      rotationDeg: 90,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: 60,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 1,
      requiredOperators: 0,
    },
    rendering: { color: '#475569', visible: true, locked: false, layer: 'equipment' },
  };

  project.products = [prod];
  project.workers = [];
  project.layoutObjects = [conv, slowMachine];
  project.stages = [
    {
      id: 'stg_c',
      code: 'OP-C',
      name: 'Infeed Belt',
      description: '',
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      requiredWorkers: 0,
      requiredMachines: 0,
      inputQty: 1,
      outputQty: 1,
      scrapRate: 0,
      reworkProbability: 0,
      bufferCapacity: 10,
      predecessorIds: [],
      successorIds: ['stg_m'],
      assignedObjectIds: ['conv_rot'],
      batchSize: 1,
      batchMode: 'single',
    },
    {
      id: 'stg_m',
      code: 'OP-M',
      name: 'Bottleneck Machine',
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
      bufferCapacity: 0,
      predecessorIds: ['stg_c'],
      successorIds: [],
      assignedObjectIds: ['mach_slow'],
      batchSize: 1,
      batchMode: 'single',
    },
  ];
  project.routes = [{ id: 'r1', name: 'Route 1', productId: prod.id, stageIds: ['stg_c', 'stg_m'] }];
  project.simulationConfig.arrivalIntervalSec = 3;
  project.simulationConfig.durationSec = 180;
  project.simulationConfig.enableBreakdowns = false;

  const engine = new DiscreteEventSimulationEngine(project);
  let sawAccumulation = false;
  for (let t = 5; t <= 120; t += 1) {
    engine.advanceTo(t);
    const snap = engine.getSnapshot();
    assert.equal(countPhysicalOverlaps(snap.products, prod), 0, `Overlap on accumulated conveyor at t=${t}s`);

    const onBelt = snap.products
      .filter((p) => p.locationKind === 'conveyor' && p.currentObjectId === 'conv_rot')
      .sort((a, b) => a.worldPosition.z - b.worldPosition.z);

    if (onBelt.length >= 3) {
      sawAccumulation = true;
      for (const item of onBelt) {
        assert.ok(Math.abs((item.rotationDeg ?? 0) - 90) < 1, 'Rotated 90deg conveyor must orient product heading');
      }
      for (let i = 1; i < onBelt.length; i++) {
        const pitchZ = onBelt[i].worldPosition.z - onBelt[i - 1].worldPosition.z;
        assert.ok(
          pitchZ >= 0.75 + 0.25 - 0.02,
          `Accumulated pitchZ=${pitchZ.toFixed(3)}m is smaller than item+spacing (1.0m) at t=${t}s`
        );
      }
    }
  }
  assert.ok(sawAccumulation, 'Expected 3+ items to accumulate cleanly behind blocked conveyor exit');
});

test('DES multi-slot station and queue buffer avoid stacking and maintain distinct slots as items advance', () => {
  const project = createDesertAirCoolerProject();
  const prod = { ...makeProduct(0.6, 0.45), routeStageIds: ['stg_multi'] };
  const multiStation: LayoutObject = {
    id: 'ws_multi',
    name: 'Multi Bench',
    kind: 'workstation',
    category: 'workstation',
    templateId: 'tpl_ws',
    stageId: 'stg_multi',
    connectedToIds: [],
    geometry: {
      position: { x: 10, y: 0, z: 10 },
      dimensions: { length: 2.6, width: 1.5, height: 0.9 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: 20,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 4,
      availability: 1,
      requiredOperators: 0,
    },
    rendering: { color: '#2563EB', visible: true, locked: false, layer: 'equipment' },
  };

  project.products = [prod];
  project.workers = [];
  project.layoutObjects = [multiStation];
  project.stages = [
    {
      id: 'stg_multi',
      code: 'OP-4X',
      name: '4-Slot Station',
      description: '',
      processingTimeSec: 20,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      requiredWorkers: 0,
      requiredMachines: 1,
      inputQty: 1,
      outputQty: 1,
      scrapRate: 0,
      reworkProbability: 0,
      bufferCapacity: 6,
      predecessorIds: [],
      successorIds: [],
      assignedObjectIds: ['ws_multi'],
      batchSize: 1,
      batchMode: 'single',
    },
  ];
  project.routes = [];
  project.simulationConfig.arrivalIntervalSec = 1;
  project.simulationConfig.durationSec = 120;
  project.simulationConfig.enableBreakdowns = false;

  const engine = new DiscreteEventSimulationEngine(project);
  let sawMultiActive = false;
  let sawQueued = false;

  for (let t = 1; t <= 60; t += 1) {
    engine.advanceTo(t);
    const snap = engine.getSnapshot();
    assert.equal(countPhysicalOverlaps(snap.products, prod), 0, `Multi-slot overlap at t=${t}s`);

    const onBench = snap.products.filter((p) => p.locationKind === 'station');
    const inQueue = snap.products.filter((p) => p.locationKind === 'buffer');
    if (onBench.length === 4) sawMultiActive = true;
    if (inQueue.length >= 3) sawQueued = true;
  }

  assert.ok(sawMultiActive, 'Expected 4 concurrent units positioned cleanly on multi-slot bench');
  assert.ok(sawQueued, 'Expected queued items staged cleanly around multi-slot bench');
});

