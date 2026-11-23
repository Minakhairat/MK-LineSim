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

function makeConveyor(
  id: string,
  opts?: { stageId?: string; speedMps?: number; spacingM?: number; x?: number; z?: number }
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conv',
    stageId: opts?.stageId,
    connectedToIds: [],
    geometry: {
      position: { x: opts?.x ?? 10, y: 0, z: opts?.z ?? 5 },
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
      speedMps: opts?.speedMps ?? 1.0,
      productSpacingM: opts?.spacingM ?? 0.15,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
  };
}

test('Test 1: Single machine capacity calculation (60s cycle -> 60 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 60);
  const st1 = makeStage('st1', ['m1'], 60);
  const profile = computeStageCapacityProfile(st1, [m1]);
  assert.equal(profile.parallelServers, 1);
  assert.equal(profile.effectiveUnitCycleSec, 60);
  assert.equal(profile.theoreticalCapacityPerHour, 60);

  const proj = makeProject([m1], [st1], { durationSec: 3600, arrivalIntervalSec: 60 });
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.goodUnits, 60);
  assert.ok(Math.abs(res.kpis.throughputPerHour - 60) < 0.1);
});

test('Test 2: Parallel machine capacity (2 identical machines @ 60s -> 120 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 60, { x: 5, z: 5 });
  const m2 = makeMachine('m2', 'st1', 60, { x: 10, z: 5 });
  const st1 = makeStage('st1', ['m1', 'm2'], 60);
  const profile = computeStageCapacityProfile(st1, [m1, m2]);
  assert.equal(profile.parallelServers, 2);
  assert.equal(profile.effectiveUnitCycleSec, 30);
  assert.equal(profile.theoreticalCapacityPerHour, 120);

  const proj = makeProject([m1, m2], [st1], { durationSec: 3600, arrivalIntervalSec: 30 });
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  // Over [0, 3600s] with 60s machine cycle, 119 units complete and unit #120 (arriving at 3570s) is in process at horizon (finishes at 3630s)
  assert.equal(res.kpis.goodUnits, 119);
  assert.equal(res.kpis.currentWip, 1);
  assert.ok(res.kpis.throughputPerHour >= 119 && res.kpis.throughputPerHour <= 120);
});

test('Test 3: Sequential line bottleneck capacity (20s, 40s, 30s -> Station 2 bottleneck = 90 units/hr)', () => {
  const m1 = makeMachine('m1', 'st1', 20, { x: 4, z: 5 });
  const m2 = makeMachine('m2', 'st2', 40, { x: 10, z: 5 });
  const m3 = makeMachine('m3', 'st3', 30, { x: 16, z: 5 });
  const st1 = makeStage('st1', ['m1'], 20, { successorIds: ['st2'] });
  const st2 = makeStage('st2', ['m2'], 40, { predecessorIds: ['st1'], successorIds: ['st3'] });
  const st3 = makeStage('st3', ['m3'], 30, { predecessorIds: ['st2'] });

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

test('Test 4: Conveyor transportation capacity (1 m/s, 0.5m pitch -> 120 u/min) & zero-machine conveyor stage isolation', () => {
  const conv = makeConveyor('conv1', { stageId: 'st_conv', speedMps: 1.0, spacingM: 0.15 });
  const conv2 = makeConveyor('conv2', { stageId: 'st_conv', speedMps: 1.0, spacingM: 0.15, x: 22 });
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

  // Critical capacity engine rule: a stage with 2 conveyors and 0 processing machines must NEVER generate artificial machine capacity
  const convOnlyStage = makeStage('st_conv', ['conv1', 'conv2'], 30);
  const convProfile = computeStageCapacityProfile(convOnlyStage, [conv, conv2]);
  assert.equal(convProfile.parallelServers, 0);
  assert.equal(convProfile.conveyorChannelCount, 2);
  assert.equal(convProfile.effectiveUnitCycleSec, 0);
  assert.equal(convProfile.theoreticalCapacityPerHour, 0);
});

test('Test 5: Reliability consistency (MTBF=3600s, MTTR=180s -> Availability = 95.238%)', () => {
  const m1 = makeMachine('m1', 'st1', 30, {
    mtbfSec: 3600,
    mttrSec: 180,
    availability: 0.85, // Conflicting stale availability
  });
  const st1 = makeStage('st1', ['m1'], 30);
  const proj = makeProject([m1], [st1], { enableBreakdowns: true });

  const params = resolveObjectFailureParams(m1, proj.simulationConfig);
  const expectedAvail = 3600 / (3600 + 180);
  assert.ok(Math.abs(params.availability * 100 - 95.23809523809524) < 1e-4);
  assert.ok(Math.abs(params.availability - expectedAvail) < 1e-6);

  const issues = validateProject(proj);
  assert.ok(issues.some((i) => i.code === 'CONFLICTING_RELIABILITY_PARAMS'));
});

test('Test 6: Formal OEE calculation (100 input, 90 good -> 90% Quality, plus Availability/Performance/OEE) & missing-reference discipline', () => {
  // 4000s calendar - 0s planned = 4000s SPT; 400s unplanned -> 3600s operating (90% Availability)
  // 100 input units * 27s ideal = 2700s / 3600s (75% Performance); 90/100 good (90% Quality)
  // OEE = 90% * 75% * 90% = 60.75%
  const oee = computeOeeMetrics({
    calendarTimeSec: 4000,
    plannedDowntimeSec: 0,
    unplannedDowntimeSec: 400,
    setupTimeSec: 0,
    idealCycleTimeSec: 27,
    totalUnitsProcessed: 100,
    goodUnitsProduced: 90,
  });
  assert.equal(oee.scheduledProductionTimeSec, 4000);
  assert.equal(oee.operatingTimeSec, 3600);
  assert.ok(Math.abs(oee.availabilityPct - 90) < 1e-6);
  assert.ok(Math.abs(oee.performancePct - 75) < 1e-6);
  assert.ok(Math.abs(oee.qualityPct - 90) < 1e-6);
  assert.ok(Math.abs(oee.oeePct - 60.75) < 1e-6);

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
  assert.equal(missingRef.availabilityPct, 100);
  assert.equal(missingRef.performancePct, 0);
  assert.equal(missingRef.qualityPct, 100);
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
  assert.equal(zeroProd.availabilityPct, 100);
  assert.equal(zeroProd.performancePct, 0);
  assert.equal(zeroProd.qualityPct, 0);
  assert.equal(zeroProd.oeePct, 0);
});

test('Test 7: Shift schedule handling (8h shift - 1h planned break = 7h = 25200s)', () => {
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
        breaks: [{ id: 'b1', name: 'Meal', startSec: 14400, durationSec: 3600 }],
      },
    ],
  });

  const cal = new ResourceCalendarEngine(proj.simulationConfig, 28800);
  const metrics = cal.getObjectCalendarMetrics(m1, 28800);
  assert.equal(metrics.scheduledProductionTimeSec, 25200);
  assert.equal(metrics.breakDowntimeSec, 3600);

  const shiftAudit = computeShiftWindowAudit(proj.simulationConfig, proj.products[0], 28800, [m1]);
  assert.equal(shiftAudit.fullShiftNetSec, 25200);

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.scheduledProductionTimeSec, 25200);
  assert.equal(res.kpis.plannedDowntimeSec, 3600);
  assert.equal(res.kpis.goodUnits, 840); // 25200 / 30 = 840 units
});

test('Test 8: Line OEE separates line-level Availability, Performance, and Quality from summed resource metrics', () => {
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
        stageId: 'st1',
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
        stageId: 'st2',
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
        stageId: 'st3',
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

  // Quality must equal 90/100 = 90%, NOT (100+90+90)/(100+100+90) = 96.55%
  assert.equal(kpis.qualityPct, 90);
  assert.equal(kpis.actualProduction, 100);
  assert.equal(kpis.goodUnits, 90);
  assert.equal(kpis.defectiveUnits, 10);
  // Line Availability & Performance must use line-level bottleneck/flow math:
  // A = 100%, P = (100 * 20) / 3600 = 55.56% (NOT summed resource (2000+2000+1800)/10800 = 53.70%), OEE = 50%
  assert.equal(kpis.availabilityPct, 100);
  assert.ok(kpis.performancePct !== undefined && Math.abs(kpis.performancePct - (2000 / 3600) * 100) < 0.05);
  assert.ok(kpis.oeePct !== undefined && Math.abs(kpis.oeePct - 50) < 0.05);

  // Also verify non-bottleneck downtime & faster non-bottleneck cycle do NOT corrupt line Availability or Performance
  const m1Fast = makeMachine('m1', 'st1', 10, { x: 4, z: 5, shiftId: 's1' });
  const m3Fast = makeMachine('m3', 'st3', 10, { x: 16, z: 5, shiftId: 's1' });
  const st1Fast = makeStage('st1', ['m1'], 10, { successorIds: ['st2'] });
  const st3Fast = makeStage('st3', ['m3'], 10, { predecessorIds: ['st2'] });
  const projFast = makeProject([m1Fast, m2, m3Fast], [st1Fast, st2, st3Fast]);
  const shiftAuditFast = computeShiftWindowAudit(
    projFast.simulationConfig,
    projFast.products[0],
    3600,
    [m1Fast, m2, m3Fast]
  );
  const kpisFast = buildAuditedSimulationKPIs({
    project: projFast,
    shiftAudit: shiftAuditFast,
    goodUnits: 90,
    scrappedUnits: 10,
    avgLeadTimeSec: 40,
    avgWaitingTimeSec: 0,
    avgProcessingTimeSec: 40,
    avgTransportTimeSec: 0,
    totalDowntimeSec: 900,
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
        avgCycleTimeSec: 10,
        utilizationPct: 37,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 25,
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
        utilizationPct: 55.6,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 0,
        isBottleneck: true,
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
        avgCycleTimeSec: 10,
        utilizationPct: 25,
        blockedPct: 0,
        starvedPct: 0,
        downPct: 0,
        isBottleneck: false,
      },
    ],
    resourceAnalytics: [
      {
        objectId: 'm1',
        objectName: 'm1',
        kind: 'machine',
        stageId: 'st1',
        shiftId: 's1',
        calendarTimeSec: 3600,
        plannedDowntimeSec: 0,
        scheduledProductionTimeSec: 3600,
        unplannedDowntimeSec: 900,
        setupTimeSec: 0,
        operatingTimeSec: 2700,
        runningTimeSec: 1000,
        idleTimeSec: 1700,
        starvedTimeSec: 0,
        blockedTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        scheduledUtilizationPct: 27.8,
        calendarUtilizationPct: 27.8,
        idealCycleTimeSec: 10,
        processedCount: 100,
        goodCount: 100,
        scrapCount: 0,
        availabilityPct: 75,
        performancePct: 37.0,
        qualityPct: 100,
        oeePct: 27.8,
      },
      {
        objectId: 'm2',
        objectName: 'm2',
        kind: 'machine',
        stageId: 'st2',
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
        oeePct: 50,
      },
      {
        objectId: 'm3',
        objectName: 'm3',
        kind: 'machine',
        stageId: 'st3',
        shiftId: 's1',
        calendarTimeSec: 3600,
        plannedDowntimeSec: 0,
        scheduledProductionTimeSec: 3600,
        unplannedDowntimeSec: 0,
        setupTimeSec: 0,
        operatingTimeSec: 3600,
        runningTimeSec: 900,
        idleTimeSec: 2700,
        starvedTimeSec: 0,
        blockedTimeSec: 0,
        maintenanceTimeSec: 0,
        unavailableTimeSec: 0,
        scheduledUtilizationPct: 25,
        calendarUtilizationPct: 25,
        idealCycleTimeSec: 10,
        processedCount: 90,
        goodCount: 90,
        scrapCount: 0,
        availabilityPct: 100,
        performancePct: 25,
        qualityPct: 100,
        oeePct: 25,
      },
    ],
  });
  assert.equal(kpisFast.availabilityPct, 100);
  assert.ok(kpisFast.performancePct !== undefined && Math.abs(kpisFast.performancePct - (2000 / 3600) * 100) < 0.05);
  assert.equal(kpisFast.qualityPct, 90);
  assert.ok(kpisFast.oeePct !== undefined && Math.abs(kpisFast.oeePct - 50) < 0.05);
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

test('Regression: DES bottleneck uses stage-specific assignedObjectIds rather than all factory equipment', () => {
  // st1 has 1 slow machine (40s). st2 has 5 fast machines (20s -> 4s effective).
  // Previously passing all 6 layout objects to st1 diluted st1's effective cycle to 40/6 = 6.67s!
  const m1 = makeMachine('m1', 'st1', 40, { x: 4, z: 5 });
  const st2Machines = ['m2a', 'm2b', 'm2c', 'm2d', 'm2e'].map((id, idx) =>
    makeMachine(id, 'st2', 20, { x: 10 + idx * 4, z: 5 })
  );
  const st1 = makeStage('st1', ['m1'], 40, { successorIds: ['st2'] });
  const st2 = makeStage('st2', st2Machines.map((m) => m.id), 20, { predecessorIds: ['st1'] });

  const proj = makeProject([m1, ...st2Machines], [st1, st2], {
    durationSec: 3600,
    arrivalIntervalSec: 15,
  });
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.bottleneckStageId, 'st1');
});

test('Regression: Availability = 0 resource stays unavailable/down with zero operating or running time', () => {
  const m1 = makeMachine('m1', 'st1', 30, { availability: 0 });
  const st1 = makeStage('st1', ['m1'], 30);
  const proj = makeProject([m1], [st1], {
    durationSec: 3600,
    arrivalIntervalSec: 30,
    enableBreakdowns: true,
  });

  const fp = resolveObjectFailureParams(m1, proj.simulationConfig);
  assert.equal(fp.enabled, true);
  assert.equal(fp.availability, 0);

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.goodUnits, 0);
  assert.equal(res.kpis.availabilityPct, 0);
  assert.equal(res.kpis.oeePct, 0);
  const resourceAnalytics = res.resourceAnalytics ?? [];
  assert.equal(resourceAnalytics.length, 1);
  assert.equal(resourceAnalytics[0].runningTimeSec, 0);
  assert.equal(resourceAnalytics[0].operatingTimeSec, 0);
  assert.equal(resourceAnalytics[0].unplannedDowntimeSec, 3600);
  assert.equal(resourceAnalytics[0].availabilityPct, 0);
});

test('Regression: Integer validation rejects fractional discrete quantities while allowing continuous floats', () => {
  const m1 = makeMachine('m1', 'st1', 12.5, {
    capacity: 1.5,
    batchSize: 2.2,
    requiredOperators: 0.5,
    speedMps: 1.25,
    availability: 0.92,
  });
  const st1 = makeStage('st1', ['m1'], 12.5, {
    batchSize: 3.5,
    bufferCapacity: 10.5,
    requiredWorkers: 1.5,
    requiredMachines: 1.2,
    scrapRate: 0.05,
  });
  const proj = makeProject([m1], [st1], {
    durationSec: 3600,
    arrivalIntervalSec: 15.5,
    maxPlannedUnits: 10.5,
  });
  proj.products[0].targetQuantity = 25.5;
  proj.products[0].cycleTimeMultiplier = 1.15;
  proj.products[0].mixWeight = 0.75;

  const issues = validateProject(proj);
  const errorCodes = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.code));
  assert.ok(errorCodes.has('INVALID_MACHINE_CAPACITY'));
  assert.ok(errorCodes.has('INVALID_BATCH_SIZE'));
  assert.ok(errorCodes.has('INVALID_BUFFER_CAPACITY'));
  assert.ok(errorCodes.has('INVALID_RESOURCE_REQUIREMENT'));
  assert.ok(errorCodes.has('INVALID_PRODUCT_PARAMETERS'));
  assert.ok(errorCodes.has('INVALID_PLANNED_UNITS'));

  // Fix discrete integer fields while keeping continuous fractional measurements -> no validation errors
  m1.operations.capacity = 1;
  m1.operations.batchSize = 2;
  m1.operations.requiredOperators = 1;
  st1.batchSize = 3;
  st1.bufferCapacity = 10;
  st1.requiredWorkers = 1;
  st1.requiredMachines = 1;
  proj.simulationConfig.maxPlannedUnits = 10;
  proj.products[0].targetQuantity = 25;

  const cleanIssues = validateProject(proj).filter((i) => i.severity === 'error');
  assert.equal(cleanIssues.length, 0);
});
