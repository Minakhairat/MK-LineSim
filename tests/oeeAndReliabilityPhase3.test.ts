import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOeeMetrics } from '../src/engineering/oeeEngine';
import {
  computeEmpiricalStats,
  computeInherentAvailability,
  computeOperationalAvailability,
  createSeededRng,
  resolveObjectFailureParams,
  sampleRepairDurationSec,
  sampleTimeToFailureSec,
} from '../src/simulation/failureModels';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { LayoutObject, ProductionStage, ProjectData, SimulationConfig } from '../src/types/project';

function makeMachine(
  id: string,
  stageId: string,
  procSec: number,
  opsOverrides: Partial<LayoutObject['operations']> = {},
  posX = 5,
  posZ = 5
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
      position: { x: posX, y: 0, z: posZ },
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
      ...opsOverrides,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

function makeConveyor(
  id: string,
  lengthM: number,
  speedMps: number,
  opsOverrides: Partial<LayoutObject['operations']> = {},
  posX = 8,
  posZ = 5
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conveyor',
    connectedToIds: [],
    geometry: {
      position: { x: posX, y: 0, z: posZ },
      dimensions: { length: lengthM, width: 0.8, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.2,
    },
    operations: {
      speedMps,
      direction: 1,
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 10,
      availability: 1,
      requiredOperators: 0,
      ...opsOverrides,
    },
    rendering: { color: '#475569', visible: true, locked: false, layer: 'conveyors' },
  };
}

function makeStage(
  id: string,
  assignedObjectIds: string[],
  procSec: number,
  overrides: Partial<ProductionStage> = {}
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
    requiredMachines: Math.max(1, assignedObjectIds.length),
    inputQty: 1,
    outputQty: 1,
    scrapRate: 0,
    reworkProbability: 0,
    bufferCapacity: 0,
    predecessorIds: [],
    successorIds: [],
    assignedObjectIds,
    ...overrides,
  };
}

function makeProject(
  objects: LayoutObject[],
  stages: ProductionStage[],
  cfgOverrides: Partial<SimulationConfig> = {},
  routeStageIds?: string[]
): ProjectData {
  const durationSec = cfgOverrides.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'phase3_oee_test',
    name: 'Phase 3 OEE Test',
    factoryName: 'Test Plant',
    industryType: 'Manufacturing',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    factory: {
      name: 'Floor',
      lengthM: 60,
      widthM: 30,
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
        name: 'Part 1',
        category: 'Unit',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 2,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: routeStageIds ?? stages.map((s) => s.id),
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
      randomSeed: 4219,
      shifts: [{ id: 's1', name: 'Day', startSec: 0, durationSec, breaks: [] }],
      maintenanceWindows: [],
      ...cfgOverrides,
    },
    scenarios: [],
  };
}

// =============================================================================
// PART 1 & 2: FORMAL OEE TIME HIERARCHY & RESOURCE OEE DIAGNOSTICS
// =============================================================================

test('Part 1 & 2: OEE time hierarchy, consistency bounds, uncapped Performance, and >100%/zero-OT anomaly flags', () => {
  // Clean calibrated nominal case
  const nominal = computeOeeMetrics({
    calendarTimeSec: 28800,
    plannedDowntimeSec: 3600,
    unplannedDowntimeSec: 1200,
    setupTimeSec: 600,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 700,
    goodUnitsProduced: 686,
  });
  assert.equal(nominal.scheduledProductionTimeSec, 25200);
  assert.equal(nominal.operatingTimeSec, 23400);
  assert.equal(nominal.timeConsistencyAnomaly, false);
  assert.equal(nominal.performanceAnomaly, false);
  assert.ok(Math.abs(nominal.availabilityPct - (23400 / 25200) * 100) < 1e-9);
  assert.ok(Math.abs(nominal.calendarAvailabilityPct - (23400 / 28800) * 100) < 1e-9);
  assert.ok(Math.abs(nominal.performancePct - ((30 * 700) / 23400) * 100) < 1e-9);
  assert.equal(nominal.rawPerformancePct, nominal.performancePct);
  assert.ok(Math.abs(nominal.qualityPct - (686 / 700) * 100) < 1e-9);
  const expectedOee =
    (nominal.availabilityPct / 100) *
    (nominal.performancePct / 100) *
    (nominal.qualityPct / 100) *
    100;
  assert.ok(Math.abs(nominal.oeePct - expectedOee) < 1e-9);

  // Over-100% performance calibration error is NEVER silently capped
  const overPerf = computeOeeMetrics({
    calendarTimeSec: 3600,
    plannedDowntimeSec: 0,
    unplannedDowntimeSec: 0,
    setupTimeSec: 0,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 180, // 5400s ideal work inside 3600s OT -> 150%!
    goodUnitsProduced: 180,
  });
  assert.equal(overPerf.performanceAnomaly, true);
  assert.ok(overPerf.performanceAnomalyReason?.includes('150.00%'));
  assert.ok(Math.abs(overPerf.rawPerformancePct - 150) < 1e-9);
  assert.ok(Math.abs(overPerf.performancePct - 150) < 1e-9, 'Performance must not be silently capped at 100%');

  // Zero Operating Time with production > 0 flags anomaly cleanly without NaN
  const zeroOtWithProd = computeOeeMetrics({
    calendarTimeSec: 3600,
    plannedDowntimeSec: 0,
    unplannedDowntimeSec: 3600,
    setupTimeSec: 0,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 10,
    goodUnitsProduced: 10,
  });
  assert.equal(zeroOtWithProd.operatingTimeSec, 0);
  assert.equal(zeroOtWithProd.availabilityPct, 0);
  assert.equal(zeroOtWithProd.performancePct, 0);
  assert.equal(zeroOtWithProd.rawPerformancePct, Number.POSITIVE_INFINITY);
  assert.equal(zeroOtWithProd.performanceAnomaly, true);
  assert.equal(zeroOtWithProd.oeePct, 0);

  // Out-of-bounds time input clamps safely and flags timeConsistencyAnomaly
  const invalidTimes = computeOeeMetrics({
    calendarTimeSec: 3600,
    plannedDowntimeSec: 4000,
    unplannedDowntimeSec: 100,
    setupTimeSec: 50,
    idealCycleTimeSec: 30,
    totalUnitsProcessed: 10,
    goodUnitsProduced: 12,
  });
  assert.equal(invalidTimes.timeConsistencyAnomaly, true);
  assert.equal(invalidTimes.scheduledProductionTimeSec, 0);
  assert.equal(invalidTimes.operatingTimeSec, 0);
});

// =============================================================================
// PART 3 & 4 + 12 REQUIRED DES SCENARIOS
// =============================================================================

test('Scenario 1: Single machine with no failures yields A=100%, P=100%, Q=100%, OEE=100%', () => {
  const m1 = makeMachine('m1', 'st1', 30);
  const st1 = makeStage('st1', ['m1'], 30);
  const res = new DiscreteEventSimulationEngine(
    makeProject([m1], [st1], { durationSec: 3600, arrivalIntervalSec: 30 })
  ).runToCompletion();

  const r1 = res.resourceAnalytics![0];
  const s1 = res.stageAnalytics[0];
  assert.equal(res.kpis.goodUnits, 120);
  assert.ok(Math.abs(r1.availabilityPct - 100) < 1e-6);
  assert.ok(Math.abs(r1.performancePct - 100) < 1e-6);
  assert.ok(Math.abs(r1.qualityPct - 100) < 1e-6);
  assert.ok(Math.abs(r1.oeePct - 100) < 1e-6);
  assert.equal(r1.performanceAnomaly, false);
  assert.ok(Math.abs((s1.oeePct ?? 0) - 100) < 1e-6);
  assert.ok(Math.abs((res.kpis.oeePct ?? 0) - 100) < 1e-6);
});

test('Scenario 2: Single machine with fixed failures matches MTBF/(MTBF+MTTR) availability & exact OEE', () => {
  // MTBF = 3600s, MTTR = 180s over 37800s -> 10 failures at 3600, 7380, ...
  // Each cycle is 3600 + 180 = 3780s -> 10 exact full cycles = 36000s up, 1800s down -> A = 95.238095%
  const m1 = makeMachine('m1', 'st1', 30, {
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 3600,
    mttrSec: 180,
  });
  const st1 = makeStage('st1', ['m1'], 30, { bufferCapacity: 200 });
  const res = new DiscreteEventSimulationEngine(
    makeProject([m1], [st1], {
      durationSec: 37800,
      arrivalIntervalSec: 30,
      enableBreakdowns: true,
    })
  ).runToCompletion();

  const r1 = res.resourceAnalytics![0];
  const expectedA = computeInherentAvailability(3600, 180) * 100; // 95.2380952%
  assert.equal(r1.failureCount, 10);
  assert.ok(Math.abs(r1.unplannedDowntimeSec - 1800) < 1e-6);
  assert.ok(Math.abs(r1.availabilityPct - expectedA) < 1e-4);
  assert.ok(Math.abs((r1.inherentAvailabilityPct ?? 0) - expectedA) < 1e-6);
  assert.ok(Math.abs((r1.empiricalMtbfSec ?? 0) - 3600) < 1e-6);
  assert.ok(Math.abs((r1.empiricalMttrSec ?? 0) - 180) < 1e-6);
  assert.ok(Math.abs((res.kpis.availabilityPct ?? 0) - expectedA) < 1e-4);
  assert.equal(r1.performanceAnomaly, false);
});

test('Scenario 3: Two parallel machines with one unavailable yields 50% stage availability, 100% performance, partial capacity loss only', () => {
  const m1 = makeMachine('m1', 'st1', 30, { availability: 1 }, 5, 4);
  const m2 = makeMachine('m2', 'st1', 30, { availability: 0 }, 5, 8);
  const st1 = makeStage('st1', ['m1', 'm2'], 30, { requiredMachines: 2, bufferCapacity: 50 });
  const res = new DiscreteEventSimulationEngine(
    makeProject([m1, m2], [st1], {
      durationSec: 3600,
      arrivalIntervalSec: 15,
      enableBreakdowns: true,
    })
  ).runToCompletion();

  const r1 = res.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  const r2 = res.resourceAnalytics!.find((r) => r.objectId === 'm2')!;
  const s1 = res.stageAnalytics[0];

  assert.equal(r1.processedCount, 120);
  assert.ok(Math.abs(r1.availabilityPct - 100) < 1e-6);
  assert.ok(Math.abs(r1.performancePct - 100) < 1e-6);
  assert.ok(Math.abs(r1.oeePct - 100) < 1e-6);

  assert.equal(r2.processedCount, 0);
  assert.equal(r2.availabilityPct, 0);
  assert.equal(r2.oeePct, 0);

  // Stage effective ideal cycle is 15s (two 30s machines in parallel)
  assert.ok(Math.abs((s1.availabilityPct ?? 0) - 50) < 1e-6);
  assert.ok(Math.abs((s1.performancePct ?? 0) - 100) < 1e-6);
  assert.ok(Math.abs((s1.oeePct ?? 0) - 50) < 1e-6);
  assert.equal(s1.completeStoppageTimeSec, 0, 'Stage never completely stopped while M1 ran');
  assert.ok(Math.abs((s1.partialCapacityLossTimeSec ?? 0) - 3600) < 1e-6);
  assert.ok(Math.abs((res.kpis.availabilityPct ?? 0) - 50) < 1e-6);
  assert.ok(Math.abs((res.kpis.oeePct ?? 0) - 50) < 1e-6);
});

test('Scenario 3b (Heterogeneous Parallel): Fast 20s + Slow 60s unavailable eliminates phantom 150% performance', () => {
  const m1 = makeMachine('m1', 'st1', 20, { availability: 1 }, 5, 4);
  const m2 = makeMachine('m2', 'st1', 60, { availability: 0 }, 5, 8);
  const st1 = makeStage('st1', ['m1', 'm2'], 30, { requiredMachines: 2, bufferCapacity: 50 });
  const res = new DiscreteEventSimulationEngine(
    makeProject([m1, m2], [st1], {
      durationSec: 3600,
      arrivalIntervalSec: 15,
      enableBreakdowns: true,
    })
  ).runToCompletion();

  const r1 = res.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  const s1 = res.stageAnalytics[0];
  assert.equal(r1.idealCycleTimeSec, 20);
  assert.equal(r1.processedCount, 180);
  assert.ok(Math.abs(r1.performancePct - 100) < 1e-6);
  assert.equal(r1.performanceAnomaly, false);

  // Weighted by capacity: w1=180/hr, w2=60/hr -> M2 contributes 25% stage capacity loss -> Stage A=75%, Stage P=100%, Stage OEE=75%
  assert.ok(Math.abs((s1.availabilityPct ?? 0) - 75) < 1e-6);
  assert.ok(Math.abs((s1.performancePct ?? 0) - 100) < 1e-6);
  assert.ok(Math.abs((s1.oeePct ?? 0) - 75) < 1e-6);
  assert.equal(s1.performanceAnomaly, false);
});

test('Scenario 4: Two parallel machines with independent failures track partial vs complete stoppage accurately', () => {
  // M1 fails every 900s for 300s ([900..1200], [2100..2400], [3300..3600] = 900s down);
  // M2 fails every 1100s for 300s ([1100..1400], [2500..2800] = 600s down).
  // Overlap at [1100..1200] = 100s complete stoppage; non-overlapping down time = (900-100) + (600-100) = 1300s partial capacity loss.
  // Stage average down = (900 + 600) / 2 = 750s -> Stage Availability = (3600 - 750) / 3600 = 79.1667%.
  const m1 = makeMachine('m1', 'st1', 30, {
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 900,
    mttrSec: 300,
  });
  const m2 = makeMachine('m2', 'st1', 30, {
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 1100,
    mttrSec: 300,
  });
  const st1 = makeStage('st1', ['m1', 'm2'], 30, { requiredMachines: 2, bufferCapacity: 50 });
  const res = new DiscreteEventSimulationEngine(
    makeProject([m1, m2], [st1], {
      durationSec: 3600,
      arrivalIntervalSec: 15,
      enableBreakdowns: true,
    })
  ).runToCompletion();

  const r1 = res.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  const r2 = res.resourceAnalytics!.find((r) => r.objectId === 'm2')!;
  const s1 = res.stageAnalytics[0];

  assert.ok(Math.abs(r1.unplannedDowntimeSec - 900) < 1e-6);
  assert.ok(Math.abs(r2.unplannedDowntimeSec - 600) < 1e-6);
  assert.ok(Math.abs((s1.completeStoppageTimeSec ?? 0) - 100) < 1e-6);
  assert.ok(Math.abs((s1.partialCapacityLossTimeSec ?? 0) - 1300) < 1e-6);
  const expectedStageA = ((3600 - 750) / 3600) * 100;
  assert.ok(Math.abs((s1.availabilityPct ?? 0) - expectedStageA) < 1e-4);
  assert.ok(Math.abs((res.kpis.availabilityPct ?? 0) - expectedStageA) < 1e-4);
});

test('Scenario 5: Serial line with 1 failed upstream or downstream stage propagates Line Availability loss across zero buffers', () => {
  // 5a: Upstream S1 (20s) fails 1800s ([1800..3600] via fixed MTBF=1800, MTTR=1800), S2 (30s, bottleneck), S3 (20s), buffer=0
  const m1a = makeMachine('m1', 'st1', 20, {
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 1800,
    mttrSec: 1800,
  }, 4, 5);
  const m2a = makeMachine('m2', 'st2', 30, {}, 10, 5);
  const m3a = makeMachine('m3', 'st3', 20, {}, 16, 5);
  const resUp = new DiscreteEventSimulationEngine(
    makeProject(
      [m1a, m2a, m3a],
      [
        makeStage('st1', ['m1'], 20, { successorIds: ['st2'], bufferCapacity: 50 }),
        makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], successorIds: ['st3'], bufferCapacity: 0 }),
        makeStage('st3', ['m3'], 20, { predecessorIds: ['st2'], bufferCapacity: 0 }),
      ],
      { durationSec: 3600, arrivalIntervalSec: 20, enableBreakdowns: true }
    )
  ).runToCompletion();

  // S2 itself had 0 direct failures, yet starved ~1800s because S1 broke down with 0 buffer at S2
  const st2DirectDown = resUp.stageAnalytics[1].downPct;
  assert.equal(st2DirectDown, 0);
  assert.ok(
    (resUp.kpis.availabilityPct ?? 100) < 55 && (resUp.kpis.availabilityPct ?? 0) > 45,
    `Expected propagated Line Availability ~50% when upstream S1 failed 50% with zero buffer, got ${resUp.kpis.availabilityPct}`
  );

  // 5b: Downstream S3 fails 1800s -> S2 blocks with 0 buffer -> Line Availability drops ~50%
  const m1b = makeMachine('m1', 'st1', 20, {}, 4, 5);
  const m2b = makeMachine('m2', 'st2', 30, {}, 10, 5);
  const m3b = makeMachine('m3', 'st3', 20, {
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 1800,
    mttrSec: 1800,
  }, 16, 5);
  const resDown = new DiscreteEventSimulationEngine(
    makeProject(
      [m1b, m2b, m3b],
      [
        makeStage('st1', ['m1'], 20, { successorIds: ['st2'], bufferCapacity: 50 }),
        makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], successorIds: ['st3'], bufferCapacity: 0 }),
        makeStage('st3', ['m3'], 20, { predecessorIds: ['st2'], bufferCapacity: 0 }),
      ],
      { durationSec: 3600, arrivalIntervalSec: 20, enableBreakdowns: true }
    )
  ).runToCompletion();

  assert.ok(
    (resDown.kpis.availabilityPct ?? 100) < 55 && (resDown.kpis.availabilityPct ?? 0) > 45,
    `Expected propagated Line Availability ~50% when downstream S3 failed 50% with zero buffer, got ${resDown.kpis.availabilityPct}`
  );
});

test('Scenario 6: Intermediate buffer absorbs upstream downtime and protects Line Availability', () => {
  // Fast S1 (10s) feeds slow bottleneck S2 (30s). S1 breaks down once for 600s at [1800..2400].
  // By t=1800, S1 produced ~180 parts while S2 consumed ~60 parts -> 120 parts sit in buffer (>=20 needed for 600s).
  // Compare buffer=0 (S2 starves!) vs buffer=150 (S2 runs continuously, Line A = 100%!).
  const runBuffered = (bufCap: number) => {
    const m1 = makeMachine('m1', 'st1', 10, {
      failureModel: 'fixed',
      repairModel: 'fixed',
      mtbfSec: 1800,
      mttrSec: 600,
    }, 4, 5);
    const m2 = makeMachine('m2', 'st2', 30, {}, 10, 5);
    return new DiscreteEventSimulationEngine(
      makeProject(
        [m1, m2],
        [
          makeStage('st1', ['m1'], 10, { successorIds: ['st2'], bufferCapacity: 200 }),
          makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], bufferCapacity: bufCap }),
        ],
        { durationSec: 3600, arrivalIntervalSec: 10, enableBreakdowns: true }
      )
    ).runToCompletion();
  };

  const unbuffered = runBuffered(0);
  const buffered = runBuffered(150);

  // In buffered run, S1 was down 600s (Stage 1 A = 83.33%), yet S2 produced continuously -> Line Availability = 100%!
  assert.ok((buffered.stageAnalytics[0].availabilityPct ?? 100) < 85);
  assert.ok(
    Math.abs((buffered.kpis.availabilityPct ?? 0) - 100) < 1e-4,
    `Expected buffered Line Availability 100%, got ${buffered.kpis.availabilityPct}`
  );
  assert.ok(
    (unbuffered.kpis.availabilityPct ?? 100) < 90,
    `Expected unbuffered Line Availability < 90%, got ${unbuffered.kpis.availabilityPct}`
  );
  assert.ok((buffered.kpis.availabilityPct ?? 0) > (unbuffered.kpis.availabilityPct ?? 0));
});

test('Scenario 7: Non-bottleneck machine downtime without starvation leaves Line Availability = 100%', () => {
  // Stage 1 has two 20s parallel machines (combined cycle 10s). M1b is permanently down (avail=0 -> Stage 1 A = 50%),
  // leaving M1a at 20s cycle feeding Bottleneck Stage 2 (30s cycle). Because 20s < 30s, S2 never starves!
  const m1a = makeMachine('m1a', 'st1', 20, { availability: 1 }, 4, 3);
  const m1b = makeMachine('m1b', 'st1', 20, { availability: 0 }, 4, 7);
  const m2 = makeMachine('m2', 'st2', 30, { availability: 1 }, 12, 5);

  const res = new DiscreteEventSimulationEngine(
    makeProject(
      [m1a, m1b, m2],
      [
        makeStage('st1', ['m1a', 'm1b'], 20, { requiredMachines: 2, successorIds: ['st2'], bufferCapacity: 50 }),
        makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], bufferCapacity: 20 }),
      ],
      { durationSec: 3600, arrivalIntervalSec: 15, enableBreakdowns: true }
    )
  ).runToCompletion();

  assert.ok(Math.abs((res.stageAnalytics[0].availabilityPct ?? 0) - 50) < 1e-6);
  assert.ok(Math.abs((res.kpis.availabilityPct ?? 0) - 100) < 1e-6);
  assert.ok(res.kpis.goodUnits >= 119);
  assert.ok((res.kpis.oeePct ?? 0) > 98);
});

test('Scenario 8: Different shifts across resources (mixed parallel + breakdown across shift end) conserve OEE bounds', () => {
  // M1 works Shift 1 [0..3600]; M2 works Full [0..7200]; M1 breaks at t=3500 for 300s (spans shift end 3600!)
  // Only [3500..3600] = 100s overlaps M1's SPT! Off-shift [3600..3800] must NOT leak into M1 UDT!
  const m1 = makeMachine('m1', 'st1', 30, {
    shiftId: 'shift_half',
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 3500,
    mttrSec: 300,
  }, 5, 3);
  const m2 = makeMachine('m2', 'st1', 30, {
    shiftId: 'shift_full',
  }, 5, 7);

  const res = new DiscreteEventSimulationEngine(
    makeProject(
      [m1, m2],
      [makeStage('st1', ['m1', 'm2'], 30, { requiredMachines: 2, bufferCapacity: 200 })],
      {
        durationSec: 7200,
        arrivalIntervalSec: 15,
        enableBreakdowns: true,
        shifts: [
          { id: 'shift_half', name: 'Half', startSec: 0, durationSec: 3600, breaks: [] },
          { id: 'shift_full', name: 'Full', startSec: 0, durationSec: 7200, breaks: [] },
        ],
      }
    )
  ).runToCompletion();

  const r1 = res.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  const r2 = res.resourceAnalytics!.find((r) => r.objectId === 'm2')!;

  assert.equal(r1.scheduledProductionTimeSec, 3600);
  assert.ok(Math.abs(r1.unplannedDowntimeSec - 100) < 1e-6, `Expected 100s in-shift UDT, got ${r1.unplannedDowntimeSec}`);
  assert.ok(Math.abs(r1.operatingTimeSec - 3500) < 1e-6);
  assert.equal(r1.performanceAnomaly, false, 'SPT clipping must prevent false >100% performance when repair crosses shift end');
  assert.ok(r1.performancePct <= 100.05);

  assert.equal(r2.scheduledProductionTimeSec, 7200);
  assert.equal(r2.unplannedDowntimeSec, 0);
  assert.ok(Math.abs(r2.availabilityPct - 100) < 1e-6);
  assert.equal(res.stageAnalytics[0].performanceAnomaly, false);
});

test('Scenario 9: Zero availability produces 0% Availability, 0% Performance, 0% Quality, 0% OEE including upstream line cascade', () => {
  const m1 = makeMachine('m1', 'st1', 20, { availability: 0 }, 4, 5);
  const m2 = makeMachine('m2', 'st2', 30, { availability: 1 }, 10, 5);
  const res = new DiscreteEventSimulationEngine(
    makeProject(
      [m1, m2],
      [
        makeStage('st1', ['m1'], 20, { successorIds: ['st2'], bufferCapacity: 5 }),
        makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], bufferCapacity: 5 }),
      ],
      { durationSec: 3600, arrivalIntervalSec: 20, enableBreakdowns: true }
    )
  ).runToCompletion();

  const r1 = res.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  assert.equal(r1.operatingTimeSec, 0);
  assert.equal(r1.availabilityPct, 0);
  assert.equal(r1.performancePct, 0);
  assert.equal(r1.oeePct, 0);

  // Upstream permanent outage means M2 (and the Line) never runs -> Line Availability = 0%, OEE = 0%
  assert.equal(res.kpis.goodUnits, 0);
  assert.ok(Math.abs(res.kpis.availabilityPct ?? -1) < 1e-6, `Expected Line Availability 0%, got ${res.kpis.availabilityPct}`);
  assert.equal(res.kpis.oeePct, 0);
});

test('Scenario 10 & 11: Zero production (with OT > 0) and Zero Operating Time (100% maintenance / setup) handle edge bounds safely', () => {
  // Scenario 10: No units arrive within 3600s (arrivalIntervalSec = 5000, maxPlannedUnits = 0) -> no parts released?
  // Wait: first arrival is at t=0 if maxPlannedUnits=0, so make machine slower? No — set arrivalInterval=5000 AND product targetQuantity=0 -> 1 unit released at t=0.
  // To guarantee exact 0 units produced in DES: set durationSec=3600 with arrivalIntervalSec=5000 AND shift starts at 0, or better yet: test computeOeeMetrics + DES with 10s horizon and 15s processingTime (1 released, 0 completed)!
  const mZeroProd = makeMachine('m1', 'st1', 60);
  const resZeroProd = new DiscreteEventSimulationEngine(
    makeProject([mZeroProd], [makeStage('st1', ['m1'], 60)], {
      durationSec: 30, // shorter than 60s cycle -> 0 completed units!
      arrivalIntervalSec: 60,
    })
  ).runToCompletion();

  assert.equal(resZeroProd.kpis.goodUnits, 0);
  assert.equal(resZeroProd.kpis.availabilityPct, 100);
  assert.equal(resZeroProd.kpis.performancePct, 0);
  assert.equal(resZeroProd.kpis.qualityPct, 0);
  assert.equal(resZeroProd.kpis.oeePct, 0);

  // Scenario 11: Zero Operating Time via 100% Planned Maintenance [0..3600]
  const mZeroOt = makeMachine('m1', 'st1', 30);
  const resZeroOt = new DiscreteEventSimulationEngine(
    makeProject([mZeroOt], [makeStage('st1', ['m1'], 30)], {
      durationSec: 3600,
      maintenanceWindows: [
        { id: 'mw1', name: 'Shutdown', startSec: 0, durationSec: 3600, objectId: 'm1' },
      ],
    })
  ).runToCompletion();

  const rZeroOt = resZeroOt.resourceAnalytics![0];
  assert.equal(rZeroOt.scheduledProductionTimeSec, 0);
  assert.equal(rZeroOt.operatingTimeSec, 0);
  assert.equal(rZeroOt.availabilityPct, 0);
  assert.equal(rZeroOt.performancePct, 0);
  assert.equal(rZeroOt.oeePct, 0);
  assert.equal(resZeroOt.kpis.availabilityPct, 0);
  assert.equal(resZeroOt.kpis.oeePct, 0);
});

test('Scenario 12: Scrap and rework preserve line quality correction, non-double-counting, and exact A*P*Q identity', () => {
  const m1 = makeMachine('m1', 'st1', 30, {}, 4, 5);
  const m2 = makeMachine('m2', 'st2', 30, {}, 10, 5);
  const res = new DiscreteEventSimulationEngine(
    makeProject(
      [m1, m2],
      [
        makeStage('st1', ['m1'], 30, {
          successorIds: ['st2'],
          bufferCapacity: 20,
          scrapRate: 0.1,
          reworkProbability: 0.2,
        }),
        makeStage('st2', ['m2'], 30, {
          predecessorIds: ['st1'],
          bufferCapacity: 20,
          scrapRate: 0.05,
        }),
      ],
      { durationSec: 7200, arrivalIntervalSec: 30, randomSeed: 9001 }
    )
  ).runToCompletion();

  const k = res.kpis;
  const expectedLineQ = (k.goodUnits / (k.goodUnits + k.defectiveUnits)) * 100;
  assert.ok(k.defectiveUnits > 0);
  assert.ok((k.reworkCycles ?? 0) > 0);
  assert.ok(Math.abs((k.qualityPct ?? 0) - expectedLineQ) < 1e-6);

  const a = (k.availabilityPct ?? 0) / 100;
  const p = (k.performancePct ?? 0) / 100;
  const q = (k.qualityPct ?? 0) / 100;
  assert.ok(Math.abs((k.oeePct ?? 0) - a * p * q * 100) < 1e-6);
  // Rework lowers stage 1 performance below 100% instead of double-counting completed units
  assert.ok((res.stageAnalytics[0].performancePct ?? 100) < 95);
  assert.equal(res.stageAnalytics[0].performanceAnomaly, false);
});

test('Conveyor failure propagation and shared multi-stage resource OEE verification', () => {
  // 1. Conveyor failure in S1 -> Conv1 -> S2: Conv1 permanently down (avail=0) starves S2 -> Line Availability = 0%
  const m1 = makeMachine('m1', 'st1', 20, {}, 2, 5);
  m1.connectedToIds = ['conv1'];
  const conv1 = makeConveyor('conv1', 4, 0.5, { availability: 0 }, 7, 5);
  conv1.connectedToIds = ['m2'];
  const m2 = makeMachine('m2', 'st2', 30, {}, 12, 5);

  const resConv = new DiscreteEventSimulationEngine(
    makeProject(
      [m1, conv1, m2],
      [
        makeStage('st1', ['m1'], 20, {
          successorIds: ['st2'],
          conveyorObjectId: 'conv1',
          bufferCapacity: 10,
        }),
        makeStage('st2', ['m2'], 30, { predecessorIds: ['st1'], bufferCapacity: 10 }),
      ],
      { durationSec: 3600, arrivalIntervalSec: 20, enableBreakdowns: true }
    )
  ).runToCompletion();

  assert.equal(resConv.kpis.goodUnits, 0);
  assert.ok(Math.abs(resConv.kpis.availabilityPct ?? -1) < 1e-6);

  // 2. Shared physical machine serving both Stage 1 (20s) and Stage 2 (40s)
  const sharedM = makeMachine('m_shared', 'st1', 20, {}, 5, 5);
  const st1Shared = makeStage('st1', ['m_shared'], 20, {
    successorIds: ['st2'],
    bufferCapacity: 50,
  });
  const st2Shared = makeStage('st2', ['m_shared'], 40, {
    predecessorIds: ['st1'],
    bufferCapacity: 50,
  });
  const resShared = new DiscreteEventSimulationEngine(
    makeProject([sharedM], [st1Shared, st2Shared], {
      durationSec: 3600,
      arrivalIntervalSec: 60,
    })
  ).runToCompletion();

  const rShared = resShared.resourceAnalytics!.find((r) => r.objectId === 'm_shared')!;
  assert.ok(rShared.idealCycleTimeSec > 25 && rShared.idealCycleTimeSec < 35, `Expected ~30s weighted cycle, got ${rShared.idealCycleTimeSec}`);
  assert.equal(rShared.performanceAnomaly, false);
  assert.ok(rShared.performancePct <= 100.05 && rShared.performancePct > 90);
});

test('Sample Desert Air Cooler project produces consistent OEE with zero anomalies', () => {
  const proj = createDesertAirCoolerProject();
  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  assert.equal(res.kpis.performanceAnomaly, false);
  assert.ok((res.kpis.oeePct ?? 0) > 0 && (res.kpis.oeePct ?? 0) <= 100);
  for (const sa of res.stageAnalytics) {
    assert.equal(sa.performanceAnomaly, false, `Unexpected performance anomaly on stage ${sa.stageName}`);
  }
  for (const ra of res.resourceAnalytics || []) {
    assert.equal(ra.performanceAnomaly, false, `Unexpected performance anomaly on resource ${ra.objectName}`);
  }
});

// =============================================================================
// PART 5 & 6: RELIABILITY MATH & MULTI-SEED MONTE CARLO VALIDATION
// =============================================================================

test('Part 5: Reference MTBF=3600s, MTTR=180s and all failure/repair distributions converge analytically', () => {
  const refAvail = computeInherentAvailability(3600, 180) * 100;
  assert.ok(Math.abs(refAvail - 95.238095238) < 1e-6);

  const cfg: SimulationConfig = {
    durationSec: 36000,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 0,
    speedMultiplier: 100,
    enableBreakdowns: true,
    randomSeed: 1,
    shifts: [{ id: 's1', name: 'Continuous', startSec: 0, durationSec: 36000, breaks: [] }],
  };

  // Sample N=4000 failure & repair intervals across Exponential, Weibull, Triangular, LogNormal
  const rng = createSeededRng(777);
  const expParams = resolveObjectFailureParams(
    makeMachine('m', 'st1', 30, {
      failureModel: 'exponential',
      repairModel: 'exponential',
      mtbfSec: 3600,
      mttrSec: 180,
    }),
    cfg
  );
  const weibLogParams = resolveObjectFailureParams(
    makeMachine('m', 'st1', 30, {
      failureModel: 'weibull',
      weibullShape: 2.0,
      repairModel: 'lognormal',
      mtbfSec: 3600,
      mttrSec: 180,
      mttrStdDevSec: 90,
    }),
    cfg
  );
  const triParams = resolveObjectFailureParams(
    makeMachine('m', 'st1', 30, {
      failureModel: 'fixed',
      repairModel: 'triangular',
      mtbfSec: 3600,
      mttrSec: 180,
    }),
    cfg
  );

  const expTtf = Array.from({ length: 4000 }, () => sampleTimeToFailureSec(expParams, rng));
  const expRep = Array.from({ length: 4000 }, () => sampleRepairDurationSec(expParams, rng));
  const weibTtf = Array.from({ length: 4000 }, () => sampleTimeToFailureSec(weibLogParams, rng));
  const logRep = Array.from({ length: 4000 }, () => sampleRepairDurationSec(weibLogParams, rng));
  const triRep = Array.from({ length: 4000 }, () => sampleRepairDurationSec(triParams, rng));

  const sExpTtf = computeEmpiricalStats(expTtf);
  const sExpRep = computeEmpiricalStats(expRep);
  const sWeibTtf = computeEmpiricalStats(weibTtf);
  const sLogRep = computeEmpiricalStats(logRep);
  const sTriRep = computeEmpiricalStats(triRep);

  assert.ok(sExpTtf.ci95Lower <= 3600 && 3600 <= sExpTtf.ci95Upper);
  assert.ok(sExpRep.ci95Lower <= 180 && 180 <= sExpRep.ci95Upper);
  assert.ok(Math.abs(sWeibTtf.mean - 3600) < 90, `Weibull mean=${sWeibTtf.mean}`);
  assert.ok(Math.abs(sLogRep.mean - 180) < 5 && Math.abs(sLogRep.stdDev - 90) < 6);
  assert.ok(Math.abs(sTriRep.mean - 180) < 3 && sTriRep.min >= 90 && sTriRep.max <= 270);
});

test('Part 6: Multi-seed Monte Carlo validation (30 seeds × 2 horizons) verifies convergence, 95% CIs, and horizon variance reduction', () => {
  const THEORETICAL_A_PCT = computeInherentAvailability(3600, 180) * 100; // 95.238095%
  const NUM_SEEDS = 30;
  const HORIZONS = [36000, 180000] as const;

  const runBatch = (
    horizonSec: number,
    failureModel: 'exponential' | 'weibull',
    repairModel: 'exponential' | 'lognormal'
  ) => {
    const availPctSamples: number[] = [];
    const empMtbfSamples: number[] = [];
    const empMttrSamples: number[] = [];
    const failCountSamples: number[] = [];

    for (let s = 0; s < NUM_SEEDS; s++) {
      const seed = 1000 + s * 37;
      const m1 = makeMachine('m1', 'st1', 120, {
        failureModel,
        repairModel,
        weibullShape: 2.0,
        mtbfSec: 3600,
        mttrSec: 180,
        mttrStdDevSec: 90,
      });
      const proj = makeProject([m1], [makeStage('st1', ['m1'], 120, { bufferCapacity: 2000 })], {
        durationSec: horizonSec,
        arrivalIntervalSec: 120,
        enableBreakdowns: true,
        randomSeed: seed,
      });
      const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
      const r1 = res.resourceAnalytics![0];

      const aoPct =
        computeOperationalAvailability(r1.operatingTimeSec, r1.scheduledProductionTimeSec) * 100;
      availPctSamples.push(aoPct);
      failCountSamples.push(r1.failureCount ?? 0);
      if (r1.empiricalMtbfSec !== undefined && Number.isFinite(r1.empiricalMtbfSec)) {
        empMtbfSamples.push(r1.empiricalMtbfSec);
      }
      if (r1.empiricalMttrSec !== undefined && Number.isFinite(r1.empiricalMttrSec)) {
        empMttrSamples.push(r1.empiricalMttrSec);
      }
    }

    return {
      avail: computeEmpiricalStats(availPctSamples),
      mtbf: computeEmpiricalStats(empMtbfSamples),
      mttr: computeEmpiricalStats(empMttrSamples),
      failures: computeEmpiricalStats(failCountSamples),
    };
  };

  const expShort = runBatch(HORIZONS[0], 'exponential', 'exponential');
  const expLong = runBatch(HORIZONS[1], 'exponential', 'exponential');
  const weibLogLong = runBatch(HORIZONS[1], 'weibull', 'lognormal');

  console.log('[MonteCarlo Reference A* = 95.238095%, MTBF=3600s, MTTR=180s]');
  console.log(
    `EXP+EXP @ 36,000s (N=30): A=${expShort.avail.mean.toFixed(4)}% ± ${expShort.avail.ci95HalfWidth.toFixed(4)}% [CI ${expShort.avail.ci95Lower.toFixed(4)}..${expShort.avail.ci95Upper.toFixed(4)}], sd=${expShort.avail.stdDev.toFixed(4)}%, MTBF=${expShort.mtbf.mean.toFixed(1)}s, MTTR=${expShort.mttr.mean.toFixed(1)}s, fails=${expShort.failures.mean.toFixed(2)}`
  );
  console.log(
    `EXP+EXP @ 180,000s (N=30): A=${expLong.avail.mean.toFixed(4)}% ± ${expLong.avail.ci95HalfWidth.toFixed(4)}% [CI ${expLong.avail.ci95Lower.toFixed(4)}..${expLong.avail.ci95Upper.toFixed(4)}], sd=${expLong.avail.stdDev.toFixed(4)}%, MTBF=${expLong.mtbf.mean.toFixed(1)}s, MTTR=${expLong.mttr.mean.toFixed(1)}s, fails=${expLong.failures.mean.toFixed(2)}`
  );
  console.log(
    `WEIB(k=2)+LOGN @ 180,000s (N=30): A=${weibLogLong.avail.mean.toFixed(4)}% ± ${weibLogLong.avail.ci95HalfWidth.toFixed(4)}% [CI ${weibLogLong.avail.ci95Lower.toFixed(4)}..${weibLogLong.avail.ci95Upper.toFixed(4)}], sd=${weibLogLong.avail.stdDev.toFixed(4)}%, MTBF=${weibLogLong.mtbf.mean.toFixed(1)}s, MTTR=${weibLogLong.mttr.mean.toFixed(1)}s, fails=${weibLogLong.failures.mean.toFixed(2)}`
  );

  // 1. Theoretical Availability 95.238095% lies close to sample mean and inside (or right on) 95% CI
  assert.ok(Math.abs(expLong.avail.mean - THEORETICAL_A_PCT) < 0.6);
  assert.ok(
    expLong.avail.ci95Lower - 0.1 <= THEORETICAL_A_PCT &&
      THEORETICAL_A_PCT <= expLong.avail.ci95Upper + 0.1
  );
  assert.ok(Math.abs(weibLogLong.avail.mean - THEORETICAL_A_PCT) < 0.5);

  // 2. Empirical MTTR converges closely around 180s
  assert.ok(Math.abs(expLong.mttr.mean - 180) < 20);
  assert.ok(Math.abs(weibLogLong.mttr.mean - 180) < 12);

  // 3. Horizon convergence: longer horizon strictly reduces standard deviation & 95% CI width
  assert.ok(
    expLong.avail.stdDev < expShort.avail.stdDev,
    `Expected long-horizon stdDev (${expLong.avail.stdDev}) < short-horizon stdDev (${expShort.avail.stdDev})`
  );
  assert.ok(expLong.avail.ci95HalfWidth < expShort.avail.ci95HalfWidth);
});
