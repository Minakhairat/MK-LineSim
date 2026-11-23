import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStageCapacityProfile } from '../src/engineering/capacityEngine';
import { evaluateConveyorPhysics } from '../src/engineering/conveyorPhysics';
import { computeOeeMetrics } from '../src/engineering/oeeEngine';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { resolveObjectFailureParams } from '../src/simulation/failureModels';
import { ResourceCalendarEngine } from '../src/simulation/resourceCalendar';
import {
  auditProjectTiming,
  buildAuditedSimulationKPIs,
  computeShiftWindowAudit,
} from '../src/simulation/timeAuditService';
import { validateProject } from '../src/simulation/validator';
import { migrateProjectSchema } from '../src/storage/indexedDb';
import { doOrientedBoxesOverlap } from '../src/utils/units';
import {
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
} from '../src/types/project';

function makeMachine(
  id: string,
  stageId: string,
  procSec: number,
  opts?: Partial<LayoutObject['operations']> & { x?: number; z?: number; rotDeg?: number; l?: number; w?: number }
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'machine',
    category: 'cnc_machine',
    templateId: 'tpl_cnc',
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x: opts?.x ?? 5, y: 0, z: opts?.z ?? 5 },
      dimensions: { length: opts?.l ?? 2, width: opts?.w ?? 1.5, height: 1.5 },
      rotationDeg: opts?.rotDeg ?? 0,
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
      ...opts,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

function makeStage(
  id: string,
  objIds: string[],
  procSec: number,
  opts?: Partial<ProductionStage>
): ProductionStage {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    description: '',
    processingTimeSec: procSec,
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
    assignedObjectIds: objIds,
    batchSize: 1,
    batchMode: 'single',
    ...opts,
  };
}

function makeProject(
  objects: LayoutObject[],
  stages: ProductionStage[],
  simOpts?: Partial<ProjectData['simulationConfig']>
): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  const durationSec = simOpts?.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'audit_proj',
    name: 'Audit Test Project',
    factoryName: 'Audit Plant',
    industryType: 'Manufacturing',
    description: '',
    createdAt: now,
    updatedAt: now,
    factory: {
      name: 'Main Hall',
      lengthM: 40,
      widthM: 25,
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
        name: 'Product 1',
        category: 'Std',
        dimensions: { length: 0.35, width: 0.35, height: 0.3 },
        weightKg: 3,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: stages.map((s) => s.id),
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages,
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec,
      arrivalIntervalSec: 30,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 42,
      shifts: [{ id: 's1', name: 'Shift 1', startSec: 0, durationSec, breaks: [] }],
      maintenanceWindows: [],
      ...simOpts,
    },
    scenarios: [],
  };
}

test('Test 1: Single machine capacity calculation (30s cycle -> 120 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 30);
  const st1 = makeStage('st1', ['m1'], 30);
  const profile = computeStageCapacityProfile(st1, [m1]);
  assert.equal(profile.parallelServers, 1);
  assert.equal(profile.effectiveUnitCycleSec, 30);
  assert.equal(profile.theoreticalCapacityPerHour, 120);

  const proj = makeProject([m1], [st1], { durationSec: 3600, arrivalIntervalSec: 30 });
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.goodUnits, 120);
  assert.ok(Math.abs(res.kpis.throughputPerHour - 120) < 0.1);
});

test('Test 2: Parallel machine capacity (2 identical machines @ 30s -> 240 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 30, { x: 5, z: 5 });
  const m2 = makeMachine('m2', 'st1', 30, { x: 10, z: 5 });
  const st1 = makeStage('st1', ['m1', 'm2'], 30);
  const profile = computeStageCapacityProfile(st1, [m1, m2]);
  assert.equal(profile.parallelServers, 2);
  assert.equal(profile.effectiveUnitCycleSec, 15);
  assert.equal(profile.theoreticalCapacityPerHour, 240);

  const proj = makeProject([m1, m2], [st1], { durationSec: 3600, arrivalIntervalSec: 15 });
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  // Over [0, 3600s] with 30s machine cycle, 239 units complete and unit #240 (arriving at 3585s) is in process at horizon (finishes at 3615s)
  assert.equal(res.kpis.goodUnits, 239);
  assert.equal(res.kpis.currentWip, 1);
  assert.ok(res.kpis.throughputPerHour >= 239 && res.kpis.throughputPerHour <= 240);
});

test('Test 3: Bottleneck line capacity (20s, 40s, 25s -> 40s bottleneck = 90 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 20, { x: 4, z: 5 });
  const m2 = makeMachine('m2', 'st2', 40, { x: 10, z: 5 });
  const m3 = makeMachine('m3', 'st3', 25, { x: 16, z: 5 });
  const st1 = makeStage('st1', ['m1'], 20, { successorIds: ['st2'] });
  const st2 = makeStage('st2', ['m2'], 40, { predecessorIds: ['st1'], successorIds: ['st3'] });
  const st3 = makeStage('st3', ['m3'], 25, { predecessorIds: ['st2'] });

  const proj = makeProject([m1, m2, m3], [st1, st2, st3], {
    durationSec: 3600,
    arrivalIntervalSec: 10,
  });

  const timing = auditProjectTiming(proj, 3600);
  assert.equal(timing.bottleneckStageId, 'st2');
  assert.equal(timing.bottleneckCycleSec, 40);
  assert.equal(timing.theoreticalHourlyCapacity, 90);

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.bottleneckStageId, 'st2');
  assert.ok(res.kpis.goodUnits >= 88 && res.kpis.goodUnits <= 90, `Got ${res.kpis.goodUnits}`);
});

test('Test 4: Conveyor transportation capacity (1 m/s, 0.5m pitch -> 120 u/min = 7200 u/hr)', () => {
  const conv: LayoutObject = {
    id: 'conv1',
    name: 'Transfer Belt',
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conv',
    connectedToIds: [],
    geometry: {
      position: { x: 10, y: 0, z: 5 },
      dimensions: { length: 10, width: 0.8, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 0,
      availability: 1,
      requiredOperators: 0,
      speedMps: 1.0,
      productSpacingM: 0.15,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
  };
  const prod: ProductDefinition = {
    id: 'p1',
    code: 'P1',
    name: 'Box',
    category: 'Std',
    dimensions: { length: 0.35, width: 0.35, height: 0.3 },
    weightKg: 2,
    color: '#2563EB',
    targetQuantity: 0,
    routeStageIds: [],
    modelShape: 'box',
  };

  const metrics = evaluateConveyorPhysics(conv, prod);
  assert.equal(metrics.canFit, true);
  assert.ok(Math.abs(metrics.pitchM - 0.5) < 1e-6);
  assert.ok(Math.abs(metrics.minHeadwaySec - 0.5) < 1e-6);
  assert.ok(Math.abs(metrics.transportCapacityPerMin - 120) < 1e-6);
  assert.ok(Math.abs(metrics.transportCapacityPerHour - 7200) < 1e-6);
});

test('Test 5: Reliability consistency (MTBF=3600s, MTTR=180s -> Availability = 95.24%)', () => {
  const m1 = makeMachine('m1', 'st1', 30, {
    mtbfSec: 3600,
    mttrSec: 180,
    availability: 0.85, // Conflicting stale availability
  });
  const st1 = makeStage('st1', ['m1'], 30);
  const proj = makeProject([m1], [st1], { enableBreakdowns: true });

  const params = resolveObjectFailureParams(m1, proj.simulationConfig);
  const expectedAvail = 3600 / (3600 + 180);
  assert.ok(Math.abs(params.availability - expectedAvail) < 1e-6);

  const issues = validateProject(proj);
  assert.ok(issues.some((i) => i.code === 'CONFLICTING_RELIABILITY_PARAMS'));
});

test('Test 6: Formal OEE calculation & missing-reference discipline', () => {
  const oee = computeOeeMetrics({
    calendarTimeSec: 28800,
    plannedDowntimeSec: 1800,
    unplannedDowntimeSec: 1350,
    setupTimeSec: 0,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 769.5,
    goodUnitsProduced: 692.55,
  });
  assert.equal(oee.scheduledProductionTimeSec, 27000);
  assert.equal(oee.operatingTimeSec, 25650);
  assert.ok(Math.abs(oee.availabilityPct - 95) < 1e-6);
  assert.ok(Math.abs(oee.performancePct - 90) < 1e-6);
  assert.ok(Math.abs(oee.qualityPct - 90) < 1e-6);
  assert.ok(Math.abs(oee.oeePct - 76.95) < 1e-6);

  // Missing ideal cycle time must NEVER fabricate 100% Performance
  const missingRef = computeOeeMetrics({
    calendarTimeSec: 3600,
    plannedDowntimeSec: 0,
    unplannedDowntimeSec: 0,
    setupTimeSec: 0,
    idealCycleTimeSec: 0,
    totalUnitsProcessed: 50,
    goodUnitsProduced: 50,
    measuredRunningTimeSec: 3600,
  });
  assert.equal(missingRef.performancePct, 0);
  assert.equal(missingRef.oeePct, 0);

  // Zero produced units must NEVER fabricate 100% Quality
  const zeroProd = computeOeeMetrics({
    calendarTimeSec: 3600,
    plannedDowntimeSec: 0,
    unplannedDowntimeSec: 0,
    setupTimeSec: 0,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 0,
    goodUnitsProduced: 0,
  });
  assert.equal(zeroProd.qualityPct, 0);
});

test('Test 7: Shift schedule handling (8h shift - 30m break = 27000s = 450 min)', () => {
  const m1 = makeMachine('m1', 'st1', 30);
  const st1 = makeStage('st1', ['m1'], 30);
  const proj = makeProject([m1], [st1], {
    durationSec: 28800,
    arrivalIntervalSec: 30,
    shifts: [
      {
        id: 's1',
        name: 'Day',
        startSec: 0,
        durationSec: 28800,
        breaks: [{ id: 'b1', name: 'Meal', startSec: 14400, durationSec: 1800 }],
      },
    ],
  });

  const cal = new ResourceCalendarEngine(proj.simulationConfig, 28800);
  const metrics = cal.getObjectCalendarMetrics(m1, 28800);
  assert.equal(metrics.scheduledProductionTimeSec, 27000);
  assert.equal(metrics.breakDowntimeSec, 1800);

  const shiftAudit = computeShiftWindowAudit(proj.simulationConfig, proj.products[0], 28800, [m1]);
  assert.equal(shiftAudit.fullShiftNetSec, 27000);

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.scheduledProductionTimeSec, 27000);
  assert.equal(res.kpis.plannedDowntimeSec, 1800);
  assert.equal(res.kpis.goodUnits, 900); // 27000 / 30 = 900 units
});

test('Test 8: Line quality separates line output yield from individual station summation even on heterogeneous shifts', () => {
  const m1 = makeMachine('m1', 'st1', 20, { x: 4, z: 5, shiftId: 's1' });
  const m2 = makeMachine('m2', 'st2', 20, { x: 10, z: 5, shiftId: 's1' });
  const m3 = makeMachine('m3', 'st3', 20, { x: 16, z: 5, shiftId: 's1' });
  const st1 = makeStage('st1', ['m1'], 20, { successorIds: ['st2'] });
  const st2 = makeStage('st2', ['m2'], 20, { predecessorIds: ['st1'], successorIds: ['st3'], scrapRate: 0.1 });
  const st3 = makeStage('st3', ['m3'], 20, { predecessorIds: ['st2'] });
  const proj = makeProject([m1, m2, m3], [st1, st2, st3]);

  const shiftAudit = computeShiftWindowAudit(proj.simulationConfig, proj.products[0], 3600, [m1, m2, m3]);
  const kpis = buildAuditedSimulationKPIs({
    project: proj,
    shiftAudit,
    goodUnits: 90,
    scrappedUnits: 10,
    avgLeadTimeSec: 60,
    avgWaitingTimeSec: 0,
    avgProcessingTimeSec: 60,
    avgTransportTimeSec: 0,
    totalDowntimeSec: 0,
    totalBlockedTimeSec: 0,
    totalStarvedTimeSec: 0,
    workerUtilizationPct: 0,
    machineUtilizationPct: 80,
    avgWip: 0,
    currentWip: 0,
    avgQueueLength: 0,
    avgBufferOccupancyPct: 0,
    stageAnalytics: [
      {
        stageId: 'st1',
        stageName: 'st1',
        enteredCount: 100,
        completedCount: 100,
        scrapCount: 0,
        reworkCount: 0,
        avgQueueLength: 0,
        maxQueueLength: 0,
        avgWaitTimeSec: 0,
        avgCycleTimeSec: 20,
        utilizationPct: 80,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 0,
        isBottleneck: false,
      },
      {
        stageId: 'st2',
        stageName: 'st2',
        enteredCount: 100,
        completedCount: 100,
        scrapCount: 10,
        reworkCount: 0,
        avgQueueLength: 0,
        maxQueueLength: 0,
        avgWaitTimeSec: 0,
        avgCycleTimeSec: 20,
        utilizationPct: 80,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 0,
        isBottleneck: false,
      },
      {
        stageId: 'st3',
        stageName: 'st3',
        enteredCount: 90,
        completedCount: 90,
        scrapCount: 0,
        reworkCount: 0,
        avgQueueLength: 0,
        maxQueueLength: 0,
        avgWaitTimeSec: 0,
        avgCycleTimeSec: 20,
        utilizationPct: 80,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 0,
        isBottleneck: false,
      },
    ],
    // Force the custom-shift aggregation branch too
    resourceAnalytics: [
      {
        objectId: 'm1',
        objectName: 'm1',
        kind: 'machine',
        shiftId: 's1',
        calendarTimeSec: 3600,
        plannedDowntimeSec: 0,
        scheduledProductionTimeSec: 3600,
        unplannedDowntimeSec: 0,
        setupTimeSec: 0,
        operatingTimeSec: 3600,
        runningTimeSec: 2000,
        idleTimeSec: 1600,
        starvedTimeSec: 0,
        blockedTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        scheduledUtilizationPct: 55.6,
        calendarUtilizationPct: 55.6,
        idealCycleTimeSec: 20,
        processedCount: 100,
        goodCount: 100,
        scrapCount: 0,
        availabilityPct: 100,
        performancePct: 55.6,
        qualityPct: 100,
        oeePct: 55.6,
      },
      {
        objectId: 'm2',
        objectName: 'm2',
        kind: 'machine',
        shiftId: 's1',
        calendarTimeSec: 3600,
        plannedDowntimeSec: 0,
        scheduledProductionTimeSec: 3600,
        unplannedDowntimeSec: 0,
        setupTimeSec: 0,
        operatingTimeSec: 3600,
        runningTimeSec: 2000,
        idleTimeSec: 1600,
        starvedTimeSec: 0,
        blockedTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        scheduledUtilizationPct: 55.6,
        calendarUtilizationPct: 55.6,
        idealCycleTimeSec: 20,
        processedCount: 100,
        goodCount: 90,
        scrapCount: 10,
        availabilityPct: 100,
        performancePct: 55.6,
        qualityPct: 90,
        oeePct: 50.0,
      },
      {
        objectId: 'm3',
        objectName: 'm3',
        kind: 'machine',
        shiftId: 's1',
        calendarTimeSec: 3600,
        plannedDowntimeSec: 0,
        scheduledProductionTimeSec: 3600,
        unplannedDowntimeSec: 0,
        setupTimeSec: 0,
        operatingTimeSec: 3600,
        runningTimeSec: 1800,
        idleTimeSec: 1800,
        starvedTimeSec: 0,
        blockedTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        scheduledUtilizationPct: 50,
        calendarUtilizationPct: 50,
        idealCycleTimeSec: 20,
        processedCount: 90,
        goodCount: 90,
        scrapCount: 0,
        availabilityPct: 100,
        performancePct: 50,
        qualityPct: 100,
        oeePct: 50,
      },
    ],
  });

  // Must equal 90/100 = 90%, NOT (100+90+90)/(100+100+90) = 96.55%
  assert.equal(kpis.qualityPct, 90);
  assert.equal(kpis.actualProduction, 100);
  assert.equal(kpis.goodUnits, 90);
  assert.equal(kpis.defectiveUnits, 10);
});

test('Audit Part 4: Exact 2D OBB SAT collision prevents false positives on rotated non-overlapping equipment', () => {
  // Two 6m x 0.8m beams rotated +45 deg parallel to each other with ~1.56m perpendicular separation:
  // Their axis-aligned bounding boxes (AABBs) overlap heavily, yet true OBBs do NOT touch!
  const overlapFalsePositiveCheck = doOrientedBoxesOverlap(
    { cx: 10, cz: 10, length: 6, width: 0.8, rotationDeg: 45 },
    { cx: 12.2, cz: 10, length: 6, width: 0.8, rotationDeg: 45 },
    0.08
  );
  assert.equal(overlapFalsePositiveCheck, false);

  // Move them close enough to genuinely intersect
  const trueCollision = doOrientedBoxesOverlap(
    { cx: 10, cz: 10, length: 6, width: 0.8, rotationDeg: 45 },
    { cx: 10.6, cz: 10, length: 6, width: 0.8, rotationDeg: 45 },
    0.08
  );
  assert.equal(trueCollision, true);

  const mA = makeMachine('mA', 'st1', 20, { x: 10, z: 10, l: 6, w: 0.8, rotDeg: 45 });
  const mB = makeMachine('mB', 'st1', 20, { x: 12.2, z: 10, l: 6, w: 0.8, rotDeg: 45 });
  const projClean = makeProject([mA, mB], [makeStage('st1', ['mA', 'mB'], 20)]);
  const cleanIssues = validateProject(projClean).filter((i) => i.code === 'EQUIPMENT_COLLISION');
  assert.equal(cleanIssues.length, 0);

  mB.geometry.position.x = 10.6;
  const hitIssues = validateProject(projClean).filter((i) => i.code === 'EQUIPMENT_COLLISION');
  assert.equal(hitIssues.length, 1);
});

test('Audit Part 3 & 5: Strict validation rejects NaN/invalid parameters and migration rejects non-finite factory dims', () => {
  const m1 = makeMachine('m1', 'st1', 30);
  const st1 = makeStage('st1', ['m1'], 30, { scrapRate: 0.6, reworkProbability: 0.5 });
  const proj = makeProject([m1], [st1], { arrivalIntervalSec: Number.NaN });
  m1.operations.capacity = 0;

  const issues = validateProject(proj);
  const codes = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.code));
  assert.ok(codes.has('INVALID_QUALITY_RATES'));
  assert.ok(codes.has('INVALID_ARRIVAL_INTERVAL'));
  assert.ok(codes.has('INVALID_MACHINE_CAPACITY'));

  assert.throws(() =>
    migrateProjectSchema({
      id: 'bad',
      name: 'Bad',
      factory: { lengthM: Number.NaN, widthM: 10, heightM: 4 },
    })
  );
});
