import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { computeStageCapacityProfile } from '../src/engineering/capacityEngine';
import {
  getSimulationExecutionCount,
  resetSimulationExecutionCount,
  runFullSimulationInWorker,
} from '../src/simulation/workerClient';
import {
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
  WorkerDefinition,
} from '../src/types/project';

function createBaseProject(overrides?: Partial<ProjectData['simulationConfig']>): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  const durationSec = overrides?.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'proj_stab',
    name: 'Stabilization Test',
    factoryName: 'Test Plant',
    industryType: 'Testing',
    description: '',
    createdAt: now,
    updatedAt: now,
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
    layoutObjects: [],
    products: [
      {
        id: 'p1',
        code: 'SKU-1',
        name: 'Product A',
        category: 'Std',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 3,
        color: '#2563EB',
        targetQuantity: overrides?.maxPlannedUnits ?? 0,
        routeStageIds: [],
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages: [],
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec,
      arrivalIntervalSec: 10,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 4219,
      shifts: [
        {
          id: 'shift_1',
          name: 'Main Shift',
          startSec: 0,
          durationSec,
          breaks: [],
        },
      ],
      maintenanceWindows: [],
      ...overrides,
    },
    scenarios: [],
  };
}

function makeMachine(
  id: string,
  stageId: string,
  procSec: number,
  opts?: Partial<LayoutObject['operations']> & { x?: number; z?: number; kind?: LayoutObject['kind'] }
): LayoutObject {
  const kind = opts?.kind ?? 'machine';
  return {
    id,
    name: id,
    kind,
    category: kind === 'conveyor' ? 'conveyor_belt' : kind === 'buffer' ? 'buffer' : 'cnc_machine',
    templateId: kind === 'conveyor' ? 'tpl_conv' : 'tpl_cnc',
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x: opts?.x ?? 5, y: 0, z: opts?.z ?? 5 },
      dimensions: { length: kind === 'conveyor' ? 6 : 2, width: 1.4, height: 1.2 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: opts?.setupTimeSec ?? 0,
      loadingTimeSec: opts?.loadingTimeSec ?? 0,
      unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
      capacity: opts?.capacity ?? 1,
      availability: opts?.availability ?? 1,
      requiredOperators: opts?.requiredOperators ?? 0,
      speedMps: opts?.speedMps,
      productSpacingM: opts?.productSpacingM,
      batchSize: opts?.batchSize,
      batchMode: opts?.batchMode,
      batchTransferTimeSec: opts?.batchTransferTimeSec,
      breakPolicy: opts?.breakPolicy,
      shiftEndPolicy: opts?.shiftEndPolicy,
      runDuringBreaks: opts?.runDuringBreaks,
      shiftId: opts?.shiftId,
      mtbfSec: opts?.mtbfSec,
      mttrSec: opts?.mttrSec,
      failureModel: opts?.failureModel,
      repairModel: opts?.repairModel,
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
    description: id,
    processingTimeSec: procSec,
    setupTimeSec: opts?.setupTimeSec ?? 0,
    loadingTimeSec: opts?.loadingTimeSec ?? 0,
    unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
    requiredWorkers: opts?.requiredWorkers ?? 0,
    requiredMachines: opts?.requiredMachines ?? 1,
    inputQty: 1,
    outputQty: 1,
    scrapRate: opts?.scrapRate ?? 0,
    reworkProbability: opts?.reworkProbability ?? 0,
    bufferCapacity: opts?.bufferCapacity ?? 100,
    predecessorIds: opts?.predecessorIds ?? [],
    successorIds: opts?.successorIds ?? [],
    assignedObjectIds: objIds,
    batchSize: opts?.batchSize,
    batchMode: opts?.batchMode,
    batchTransferTimeSec: opts?.batchTransferTimeSec,
    defectModel: opts?.defectModel,
  };
}

function makeWorker(
  id: string,
  x: number,
  z: number,
  stageIds: string[],
  opts?: Partial<WorkerDefinition>
): WorkerDefinition {
  return {
    id,
    name: id,
    label: id,
    skillCategory: 'Operator',
    skillLevel: 3,
    walkingSpeedMps: opts?.walkingSpeedMps ?? 1.0,
    efficiencyFactor: opts?.efficiencyFactor ?? 1.0,
    assignedStageIds: stageIds,
    assignedStationId: opts?.assignedStationId,
    assignedTo: opts?.assignedTo ?? opts?.assignedStationId,
    position: { x, y: 0, z },
    rotation: 0,
    rotationDeg: 0,
    shiftId: opts?.shiftId ?? 'shift_1',
    color: '#F59E0B',
    breakPolicy: opts?.breakPolicy,
    shiftEndPolicy: opts?.shiftEndPolicy,
  };
}

// =========================================================================
// ISSUE A: Batching and Capacity Engine
// =========================================================================
test('Issue A: CapacityEngine and DES distinguish single (stale batchSize=4), collect_batch, and unbatch accurately', () => {
  // 1. Single Unit mode with stale batchSize=4 must yield 1 unit per 40s = 90 u/hr
  const mSingle = makeMachine('m_single', 'st_single', 40, { batchSize: 4, batchMode: 'single' });
  const sSingle = makeStage('st_single', ['m_single'], 40, { batchSize: 4, batchMode: 'single' });
  const capSingle = computeStageCapacityProfile(sSingle, [mSingle]);
  assert.equal(capSingle.effectiveBatchDivisor, 1);
  assert.equal(capSingle.batchSize, 1);
  assert.ok(Math.abs(capSingle.theoreticalCapacityPerHour - 90) < 1e-6);

  const projSingle = createBaseProject({ durationSec: 3600, arrivalIntervalSec: 40 });
  projSingle.layoutObjects = [mSingle];
  projSingle.stages = [sSingle];
  projSingle.products[0].routeStageIds = ['st_single'];
  const resSingle = new DiscreteEventSimulationEngine(projSingle).runToCompletion();
  assert.equal(resSingle.kpis.goodUnits, 90);

  // 2. Collect Batch mode: batchSize=4, proc=40s -> 4 units/40s = 360 u/hr
  const mCollect = makeMachine('m_col', 'st_col', 40, { batchSize: 4, batchMode: 'collect_batch' });
  const sCollect = makeStage('st_col', ['m_col'], 40, { batchSize: 4, batchMode: 'collect_batch' });
  const capCollect = computeStageCapacityProfile(sCollect, [mCollect]);
  assert.equal(capCollect.effectiveBatchDivisor, 4);
  assert.equal(capCollect.batchSize, 4);
  assert.ok(Math.abs(capCollect.theoreticalCapacityPerHour - 360) < 1e-6);

  const projCollect = createBaseProject({ durationSec: 3600, arrivalIntervalSec: 5 });
  projCollect.layoutObjects = [mCollect];
  projCollect.stages = [sCollect];
  projCollect.products[0].routeStageIds = ['st_col'];
  const resCollect = new DiscreteEventSimulationEngine(projCollect).runToCompletion();
  assert.ok(resCollect.kpis.goodUnits >= 340 && resCollect.kpis.goodUnits <= 360, `got ${resCollect.kpis.goodUnits}`);

  // 3. Mixed pipeline: Collect Batch (4u @ 20s) -> Unbatch (40s per individual unit = 90 u/hr)
  const mPack = makeMachine('m_pack', 'st_pack', 20, { batchSize: 4, batchMode: 'collect_batch', x: 4 });
  const mUnpack = makeMachine('m_unpack', 'st_unpack', 40, { batchSize: 4, batchMode: 'unbatch', x: 10 });
  const sPack = makeStage('st_pack', ['m_pack'], 20, { batchSize: 4, batchMode: 'collect_batch', successorIds: ['st_unpack'] });
  const sUnpack = makeStage('st_unpack', ['m_unpack'], 40, { batchSize: 4, batchMode: 'unbatch', predecessorIds: ['st_pack'] });

  const capUnbatch = computeStageCapacityProfile(sUnpack, [mUnpack]);
  assert.equal(capUnbatch.effectiveBatchDivisor, 1);
  assert.ok(Math.abs(capUnbatch.theoreticalCapacityPerHour - 90) < 1e-6);

  const projMixed = createBaseProject({ durationSec: 3600, arrivalIntervalSec: 5 });
  projMixed.layoutObjects = [mPack, mUnpack];
  projMixed.stages = [sPack, sUnpack];
  projMixed.products[0].routeStageIds = ['st_pack', 'st_unpack'];
  const resMixed = new DiscreteEventSimulationEngine(projMixed).runToCompletion();
  // Unbatch stage has 40s cycle per unit -> ~89 units max, NOT 360
  assert.ok(resMixed.kpis.goodUnits >= 85 && resMixed.kpis.goodUnits <= 90, `mixed good=${resMixed.kpis.goodUnits}`);
  assert.equal(resMixed.kpis.bottleneckStageId, 'st_unpack');

  // 4. Buffer & Conveyor exclusion + batchTransferTimeSec separation
  const buf = makeMachine('b1', 'st_tr', 999, { kind: 'buffer', capacity: 20 });
  const conv = makeMachine('c1', 'st_tr', 15, { kind: 'conveyor', speedMps: 1 });
  const mProc1 = makeMachine('mp1', 'st_tr', 30, { batchSize: 4, batchMode: 'collect_batch', batchTransferTimeSec: 10 });
  const mProc2 = makeMachine('mp2', 'st_tr', 30, { batchSize: 4, batchMode: 'collect_batch', batchTransferTimeSec: 10 });
  const sTr = makeStage('st_tr', ['b1', 'c1', 'mp1', 'mp2'], 30, {
    batchSize: 4,
    batchMode: 'collect_batch',
    batchTransferTimeSec: 10,
  });
  const capTr = computeStageCapacityProfile(sTr, [buf, conv, mProc1, mProc2]);
  assert.equal(capTr.parallelServers, 2); // excludes buffer & conveyor
  assert.equal(capTr.batchTransferTimeSec, 10);
  // (30 + 10) / (2 * 4) = 5s effective unit cycle -> 720 u/hr
  assert.ok(Math.abs(capTr.effectiveUnitCycleSec - 5) < 1e-6);
});

// =========================================================================
// ISSUE B: Worker Walking Time vs. Machine Operating Time
// =========================================================================
test('Issue B: Worker walking is excluded from machine running/setup time, handles staggered & twin-slot arrivals', () => {
  // Machine centered at (5, 5), length=2 -> east standing edge at x = 6.55. Worker at (16.55, 5) -> 10.0m walk @ 1m/s = 10s
  // Use arrivalIntervalSec: 200 & maxPlannedUnits: 0 so only 1 unit arrives at t=0 and [50..120] is starved waiting for next arrival
  const proj = createBaseProject({ durationSec: 120, arrivalIntervalSec: 200, maxPlannedUnits: 0 });
  const m1 = makeMachine('m1', 'st_1', 30, { x: 5, z: 5, setupTimeSec: 10, requiredOperators: 1 });
  const st1 = makeStage('st_1', ['m1'], 30, { setupTimeSec: 10, requiredWorkers: 1 });
  const w1 = makeWorker('w1', 16.55, 5, ['st_1'], { walkingSpeedMps: 1.0 });
  proj.layoutObjects = [m1];
  proj.stages = [st1];
  proj.workers = [w1];
  proj.products[0].routeStageIds = ['st_1'];

  const eng = new DiscreteEventSimulationEngine(proj);
  const res = eng.runToCompletion();
  const events = eng.getAllEvents();

  const setupEv = events.find((e) => e.type === 'SetupStarted');
  const procEv = events.find((e) => e.type === 'ProcessingStarted');
  const doneEv = events.find((e) => e.type === 'ProcessingCompleted');
  assert.ok(Math.abs((setupEv?.timestamp ?? 0) - 10) < 1e-6, 'Setup must not start until worker finishes 10s walk');
  assert.ok(Math.abs((procEv?.timestamp ?? 0) - 20) < 1e-6, 'Processing starts after 10s walk + 10s setup');
  assert.ok(Math.abs((doneEv?.timestamp ?? 0) - 50) < 1e-6, 'Processing ends at t=50');

  const ra = res.resourceAnalytics![0];
  const wa = res.workerAnalytics![0];
  assert.ok(Math.abs(ra.setupTimeSec - 10) < 1e-6);
  assert.ok(Math.abs(ra.runningTimeSec - 30) < 1e-6);
  assert.ok(Math.abs(ra.idleTimeSec - 10) < 1e-6, 'First 10s while worker walks must be machine idle (waiting), NOT running/setup');
  assert.ok(Math.abs(ra.starvedTimeSec - 70) < 1e-6, 'Remaining [50..120] awaiting next scheduled arrival is starved');
  assert.ok(Math.abs(wa.walkingTimeSec - 10) < 1e-6);
  assert.ok(Math.abs(wa.busyTimeSec - 40) < 1e-6, 'Worker busy = 10s setup + 30s processing, excludes walking');

  // Staggered multi-worker arrival: m2 at (0,0), east edge=1.55. W1 at 6.55 (5s walk), W2 at 13.55 (12s walk) -> starts at max=12s
  const proj2 = createBaseProject({ durationSec: 120, arrivalIntervalSec: 200, maxPlannedUnits: 0 });
  const m2 = makeMachine('m2', 'st_2', 20, { x: 0, z: 0, requiredOperators: 2 });
  const st2 = makeStage('st_2', ['m2'], 20, { requiredWorkers: 2 });
  const wa2 = makeWorker('wa2', 6.55, 0, ['st_2'], { walkingSpeedMps: 1.0 });
  const wb2 = makeWorker('wb2', 13.55, 0, ['st_2'], { walkingSpeedMps: 1.0 });
  proj2.layoutObjects = [m2];
  proj2.stages = [st2];
  proj2.workers = [wa2, wb2];
  proj2.products[0].routeStageIds = ['st_2'];

  const res2 = new DiscreteEventSimulationEngine(proj2).runToCompletion();
  assert.ok(Math.abs(res2.resourceAnalytics![0].runningTimeSec - 20) < 1e-6);
  assert.ok(Math.abs(res2.resourceAnalytics![0].idleTimeSec - 12) < 1e-6);
  assert.ok(Math.abs((res2.workerAnalytics!.find((w) => w.workerId === 'wa2')?.walkingTimeSec ?? 0) - 5) < 1e-6);
  assert.ok(Math.abs((res2.workerAnalytics!.find((w) => w.workerId === 'wb2')?.walkingTimeSec ?? 0) - 12) < 1e-6);

  // Twin-slot machine (capacity=2) at (0,0), east edge=1.55: slot 1 walks 0s & runs [0, 20]; slot 2 arrives at t=10 with 15s walk -> starts at 25.
  // Between t=20 and t=25 slot 1 is done & slot 2 is STILL waiting for worker walk -> machine MUST be idle for [20, 25]!
  const proj3 = createBaseProject({ durationSec: 45, arrivalIntervalSec: 10, maxPlannedUnits: 2 });
  const m3 = makeMachine('m3', 'st_3', 20, { x: 0, z: 0, capacity: 2, requiredOperators: 1 });
  const st3 = makeStage('st_3', ['m3'], 20, { requiredWorkers: 1 });
  const w3a = makeWorker('w3a', 1.55, 0, ['st_3'], { walkingSpeedMps: 1.0 });
  const w3b = makeWorker('w3b', 16.55, 0, ['st_3'], { walkingSpeedMps: 1.0 });
  proj3.layoutObjects = [m3];
  proj3.stages = [st3];
  proj3.workers = [w3a, w3b];
  proj3.products[0].routeStageIds = ['st_3'];

  const eng3 = new DiscreteEventSimulationEngine(proj3);
  const res3 = eng3.runToCompletion();
  assert.ok(Math.abs(res3.resourceAnalytics![0].runningTimeSec - 40) < 1e-6); // [0..20] + [25..45]
  assert.ok(Math.abs(res3.resourceAnalytics![0].idleTimeSec - 5) < 1e-6); // [20..25] while unit 2 waits on w3b walk
});

// =========================================================================
// ISSUE C: Breaks, Shifts, Planned Maintenance & Horizon Conservation
// =========================================================================
test('Issue C: Interruption policies (stop_immediately, finish_current_cycle, continue_during_break) conserve exact horizon', () => {
  // Break at [1800, 2100] (300s), total shift 3600s, job starts at 1780 for 40s (1780..1820)
  // Policy 1: stop_immediately -> pauses at 1800 with 20s remaining, resumes at 2100..2120
  const projStop = createBaseProject({
    durationSec: 3600,
    arrivalIntervalSec: 2000,
    maxPlannedUnits: 2,
    shifts: [{ id: 's1', name: 'S1', startSec: 0, durationSec: 3600, breaks: [{ id: 'b1', name: 'B1', startSec: 1800, durationSec: 300 }] }],
  });
  const mStop = makeMachine('m1', 'st1', 40, { breakPolicy: 'stop_immediately', requiredOperators: 1, x: 0, z: 0 });
  const stStop = makeStage('st1', ['m1'], 40, { requiredWorkers: 1 });
  const wStop = makeWorker('w1', 0, 0, ['st1'], { breakPolicy: 'stop_immediately', shiftId: 's1' });
  projStop.layoutObjects = [mStop];
  projStop.stages = [stStop];
  projStop.workers = [wStop];
  projStop.products[0].routeStageIds = ['st1'];

  // Force unit arrival right before break by running regular 1780s interval:
  projStop.simulationConfig.arrivalIntervalSec = 1780;
  const engStop = new DiscreteEventSimulationEngine(projStop);
  const resStop = engStop.runToCompletion();
  const raStop = resStop.resourceAnalytics![0];
  const waStop = resStop.workerAnalytics![0];
  const mSum =
    raStop.runningTimeSec +
    raStop.setupTimeSec +
    raStop.idleTimeSec +
    raStop.starvedTimeSec +
    raStop.blockedTimeSec +
    raStop.unplannedDowntimeSec +
    raStop.maintenanceTimeSec +
    raStop.unavailableTimeSec;
  assert.ok(Math.abs(mSum - 3600) < 1e-6, `Machine horizon conservation failed: ${mSum}`);
  assert.equal(raStop.unavailableTimeSec, 300);
  const wSum = waStop.busyTimeSec + waStop.walkingTimeSec + waStop.idleTimeSec + waStop.unavailableTimeSec;
  assert.ok(Math.abs(wSum - 3600) < 1e-6, `Worker horizon conservation failed: ${wSum}`);
  assert.equal(waStop.unavailableTimeSec, 300);

  // Policy 2: finish_current_cycle -> job at 1780..1820 completes at 1820 without pause!
  const projFinish = structuredClone(projStop);
  projFinish.layoutObjects[0].operations.breakPolicy = 'finish_current_cycle';
  projFinish.workers[0].breakPolicy = 'finish_current_cycle';
  const engFin = new DiscreteEventSimulationEngine(projFinish);
  const resFin = engFin.runToCompletion();
  const compEvents = engFin.getAllEvents().filter((e) => e.type === 'ProcessingCompleted');
  assert.equal(compEvents[1]?.timestamp, 1820, 'Unit #2 crossing break under finish_current_cycle completes cleanly at 1820');
  assert.equal(resFin.kpis.goodUnits, 2);

  // Policy 3: continue_during_break -> machine produces all 3600s without stopping for break
  const projCont = createBaseProject({
    durationSec: 3600,
    arrivalIntervalSec: 30,
    shifts: [{ id: 's1', name: 'S1', startSec: 0, durationSec: 3600, breaks: [{ id: 'b1', name: 'B1', startSec: 1800, durationSec: 300 }] }],
  });
  projCont.layoutObjects = [makeMachine('mc', 'sc', 30, { breakPolicy: 'continue_during_break', runDuringBreaks: true })];
  projCont.stages = [makeStage('sc', ['mc'], 30)];
  projCont.products[0].routeStageIds = ['sc'];
  const resCont = new DiscreteEventSimulationEngine(projCont).runToCompletion();
  assert.equal(resCont.kpis.goodUnits, 120);
  assert.equal(resCont.resourceAnalytics![0].unavailableTimeSec, 0);
});

// =========================================================================
// ISSUE D: Single Web Worker Execution & Zero Duplicate Engine Runs
// =========================================================================
test('Issue D: runFullSimulationInWorker performs exactly 1 simulation pass and is strictly deterministic across repeated runs', async () => {
  const proj = createBaseProject({ durationSec: 1800, arrivalIntervalSec: 30, enableBreakdowns: true, randomSeed: 999 });
  proj.layoutObjects = [makeMachine('m1', 'st1', 25, { mtbfSec: 600, mttrSec: 60 })];
  proj.stages = [makeStage('st1', ['m1'], 25, { scrapRate: 0.05 })];
  proj.products[0].routeStageIds = ['st1'];

  resetSimulationExecutionCount();
  const out1 = await runFullSimulationInWorker(proj);
  assert.equal(getSimulationExecutionCount(), 1, 'Exactly one execution per request');

  const out2 = await runFullSimulationInWorker(proj);
  assert.equal(getSimulationExecutionCount(), 2, 'Two requests -> two single passes (never doubled)');

  assert.equal(out1.result.kpis.goodUnits, out2.result.kpis.goodUnits);
  assert.equal(out1.result.kpis.defectiveUnits, out2.result.kpis.defectiveUnits);
  assert.equal(out1.allEvents.length, out2.allEvents.length);
  assert.equal(out1.snapshot.status, 'completed');
});

// =========================================================================
// ISSUE E: Multi-Product Dispatching, SKU Routings, Batch Isolation & ProductAnalytics
// =========================================================================
test('Issue E: Multi-product dispatching rules, SKU cycle overrides, and product-isolated batching', () => {
  // Product A (priority 1, mixWeight 3, 20s at s2, target 20) + Product B (priority 2, mixWeight 1, 40s at s2, target 20)
  const makeMultiProj = (rule: ProjectData['simulationConfig']['dispatchingRule']) => {
    const p = createBaseProject({
      durationSec: 3600,
      arrivalIntervalSec: 10,
      dispatchingRule: rule,
    });
    const m1 = makeMachine('m1', 's1', 10, { x: 4 });
    const m2 = makeMachine('m2', 's2', 10, { batchSize: 4, batchMode: 'collect_batch', x: 10 });
    const s1 = makeStage('s1', ['m1'], 10, { successorIds: ['s2'] });
    const s2 = makeStage('s2', ['m2'], 10, { batchSize: 4, batchMode: 'collect_batch', predecessorIds: ['s1'] });
    const prodA: ProductDefinition = {
      id: 'prodA',
      code: 'A',
      name: 'Product A',
      category: 'Std',
      dimensions: { length: 0.4, width: 0.4, height: 0.3 },
      weightKg: 3,
      color: '#2563EB',
      targetQuantity: 16,
      priority: 1,
      mixWeight: 3,
      cycleTimeMultiplier: 1.0,
      stageProcessingTimes: { s1: 10, s2: 12 },
      routeStageIds: ['s1', 's2'],
      modelShape: 'box',
      routingMode: 'auto',
    };
    const prodB: ProductDefinition = {
      id: 'prodB',
      code: 'B',
      name: 'Product B',
      category: 'Std',
      dimensions: { length: 0.4, width: 0.4, height: 0.3 },
      weightKg: 4,
      color: '#DC2626',
      targetQuantity: 12,
      priority: 2,
      mixWeight: 1,
      cycleTimeMultiplier: 1.5,
      stageProcessingTimes: { s1: 15, s2: 20 },
      routeStageIds: ['s1', 's2'],
      modelShape: 'box',
      routingMode: 'auto',
    };
    p.layoutObjects = [m1, m2];
    p.stages = [s1, s2];
    p.products = [prodA, prodB];
    return p;
  };

  // Fixed sequence dispatches A completely first, then B
  const engSeq = new DiscreteEventSimulationEngine(makeMultiProj('fixed_sequence'));
  const resSeq = engSeq.runToCompletion();
  const createdSeq = engSeq
    .getAllEvents()
    .filter((e) => e.type === 'ProductArrived' && e.stageId === 's1')
    .slice(0, 16);
  assert.ok(createdSeq.every((e) => e.details.includes('(A)')), 'fixed_sequence releases SKU A batch before B');
  assert.equal(resSeq.productAnalytics?.length, 2);
  assert.equal(resSeq.productAnalytics?.find((x) => x.productId === 'prodA')?.completedGoodQty, 16);
  assert.equal(resSeq.productAnalytics?.find((x) => x.productId === 'prodB')?.completedGoodQty, 12);

  // Round Robin strictly alternates A, B, A, B while quotas remain; batches at s2 (size=4) NEVER mix A and B
  const engRR = new DiscreteEventSimulationEngine(makeMultiProj('round_robin'));
  const resRR = engRR.runToCompletion();
  const rrArrivals = engRR
    .getAllEvents()
    .filter((e) => e.type === 'ProductArrived' && e.stageId === 's1')
    .slice(0, 6)
    .map((e) => (e.details.includes('(A)') ? 'A' : 'B'));
  assert.deepEqual(rrArrivals, ['A', 'B', 'A', 'B', 'A', 'B']);
  // Every product good count must be exact 16 + 12 = 28 (zero cross-SKU mixing inside batch 4 carriers)
  assert.equal(resRR.productAnalytics?.find((x) => x.productId === 'prodA')?.completedGoodQty, 16);
  assert.equal(resRR.productAnalytics?.find((x) => x.productId === 'prodB')?.completedGoodQty, 12);

  // Product Priority: higher priority number wins first (B has priority=2 > A priority=1 -> first 12 units are B)
  const engPrio = new DiscreteEventSimulationEngine(makeMultiProj('product_priority'));
  const resPrio = engPrio.runToCompletion();
  const prioFirst = engPrio
    .getAllEvents()
    .filter((e) => e.type === 'ProductArrived' && e.stageId === 's1')
    .slice(0, 12);
  assert.ok(prioFirst.every((e) => e.details.includes('(B)')), 'product_priority exhausts higher priority value (B=2 > A=1) first');
  assert.equal(resPrio.kpis.goodUnits, 28);

  // Weighted Mix 3:1 ratio: out of first 8 arrivals, expect 6 A and 2 B
  const engMix = new DiscreteEventSimulationEngine(makeMultiProj('weighted_mix'));
  const resMix = engMix.runToCompletion();
  const mixFirst8 = engMix
    .getAllEvents()
    .filter((e) => e.type === 'ProductArrived' && e.stageId === 's1')
    .slice(0, 8);
  const countA8 = mixFirst8.filter((e) => e.details.includes('(A)')).length;
  const countB8 = mixFirst8.filter((e) => e.details.includes('(B)')).length;
  assert.equal(countA8, 6, 'weighted_mix 3:1 releases 6 of A in first 8');
  assert.equal(countB8, 2, 'weighted_mix 3:1 releases 2 of B in first 8');
  assert.equal(resMix.kpis.goodUnits, 28);
});

// =========================================================================
// ISSUE F: Batch Waiting Time & Queue/Conveyor Wait Analytics
// =========================================================================
test('Issue F: Unit-weighted wait vs batch wait vs queue wait and conveyor transit separation', () => {
  // Stage 1 packs 4 units; Stage 2 processes each 4-unit batch in 40s.
  // Batch 1 starts immediately at Stage 2 -> 0s wait; Batch 2 arrives at t=20 & starts at t=40 -> 20s wait (4 units)
  const proj = createBaseProject({ durationSec: 200, arrivalIntervalSec: 1, maxPlannedUnits: 8 });
  const m1 = makeMachine('m1', 's1', 2, { batchSize: 4, batchMode: 'collect_batch', x: 4 });
  const m2 = makeMachine('m2', 's2', 40, { x: 10 });
  const s1 = makeStage('s1', ['m1'], 2, { batchSize: 4, batchMode: 'collect_batch', successorIds: ['s2'] });
  const s2 = makeStage('s2', ['m2'], 40, { predecessorIds: ['s1'] });
  proj.layoutObjects = [m1, m2];
  proj.stages = [s1, s2];
  proj.products[0].routeStageIds = ['s1', 's2'];

  const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
  const sa2 = res.stageAnalytics.find((s) => s.stageId === 's2')!;
  // Batch 1 arrives at s2 around t=6s -> waits 0s. Batch 2 arrives around t=12s -> waits until t=46s (~34s)
  assert.ok(sa2.avgBatchWaitTimeSec! > 15, `expected batch wait ~17s, got ${sa2.avgBatchWaitTimeSec}`);
  assert.ok(
    Math.abs((sa2.avgUnitWaitTimeSec ?? 0) - (sa2.avgBatchWaitTimeSec ?? 0)) < 1e-6,
    'Uniform 4-unit batches share exact unit-weighted and batch average wait'
  );
  assert.equal(res.kpis.totalConveyorTransitTimeSec, 0, 'Non-conveyor line records 0 conveyor transit');
});

// =========================================================================
// ISSUE G: Quality, Scrap & Rework Sampling + Mass Balance Conservation
// =========================================================================
test('Issue G: Defect sampling (unit vs batch), rework non-double-counting, seed determinism, and strict Mass Balance', () => {
  // 1. defectModel = 'unit' over batchSize = 10 -> partial batch survival across batches
  const projUnit = createBaseProject({ durationSec: 1000, arrivalIntervalSec: 1, maxPlannedUnits: 100, randomSeed: 1234 });
  projUnit.layoutObjects = [
    makeMachine('m1', 's1', 5, { batchSize: 10, batchMode: 'collect_batch', x: 4 }),
    makeMachine('m2', 's2', 10, { x: 10 }),
  ];
  projUnit.stages = [
    makeStage('s1', ['m1'], 5, { batchSize: 10, batchMode: 'collect_batch', successorIds: ['s2'] }),
    makeStage('s2', ['m2'], 10, { scrapRate: 0.2, reworkProbability: 0.1, defectModel: 'unit', predecessorIds: ['s1'] }),
  ];
  projUnit.products[0].routeStageIds = ['s1', 's2'];

  const resUnitA = new DiscreteEventSimulationEngine(projUnit).runToCompletion();
  const resUnitB = new DiscreteEventSimulationEngine(projUnit).runToCompletion();
  assert.equal(resUnitA.kpis.goodUnits, resUnitB.kpis.goodUnits, 'Identical randomSeed produces bit-exact quality counts');
  assert.equal(resUnitA.kpis.defectiveUnits, resUnitB.kpis.defectiveUnits);
  assert.equal(resUnitA.kpis.reworkUnits, resUnitB.kpis.reworkUnits);

  const saUnit = resUnitA.stageAnalytics.find((s) => s.stageId === 's2')!;
  // Partial unit scrapping should NOT scrap all batches whole: scrappedBatches * 10 < scrapCount (most scrap happens partially)
  assert.ok(resUnitA.kpis.defectiveUnits > 0, 'Unit-level scrap occurred');
  assert.ok((saUnit.scrappedBatches ?? 0) * 10 < saUnit.scrapCount, 'Unit mode preserves surviving units in partial batches');
  assert.ok((saUnit.reworkCycles ?? 0) > 0 && saUnit.reworkCount > 0, 'Rework loops recorded separately');
  // Mass Balance Check: Good + Scrap + Active WIP === Created (100)
  const totalUnitMass = resUnitA.kpis.goodUnits + resUnitA.kpis.defectiveUnits + resUnitA.kpis.currentWip;
  assert.equal(totalUnitMass, 100, `Mass balance conserved: ${totalUnitMass} === 100`);

  // 2. defectModel = 'batch' -> strictly whole-batch accept or scrap
  const projBatch = structuredClone(projUnit);
  projBatch.stages[1].defectModel = 'batch';
  projBatch.stages[1].reworkProbability = 0;
  projBatch.stages[1].scrapRate = 0.3;
  const resBatch = new DiscreteEventSimulationEngine(projBatch).runToCompletion();
  const saBatch = resBatch.stageAnalytics.find((s) => s.stageId === 's2')!;
  assert.equal(saBatch.scrapCount, (saBatch.scrappedBatches ?? 0) * 10, 'Batch mode scraps whole batches only');
  assert.equal(
    resBatch.kpis.goodUnits + resBatch.kpis.defectiveUnits + resBatch.kpis.currentWip,
    100,
    'Mass balance strictly conserved under batch defect mode'
  );

  // 3. Single-unit rework loop does NOT inflate completedCount (each unit exits stage ONCE)
  const projRw = createBaseProject({ durationSec: 1200, arrivalIntervalSec: 20, maxPlannedUnits: 30, randomSeed: 77 });
  projRw.layoutObjects = [makeMachine('m1', 's1', 10)];
  projRw.stages = [makeStage('s1', ['m1'], 10, { scrapRate: 0, reworkProbability: 0.3 })];
  projRw.products[0].routeStageIds = ['s1'];
  const resRw = new DiscreteEventSimulationEngine(projRw).runToCompletion();
  assert.equal(resRw.kpis.goodUnits, 30);
  assert.equal(resRw.stageAnalytics[0].completedCount, 30, 'Reworked units must NOT be double-counted into completedCount');
  assert.ok((resRw.kpis.reworkCycles ?? 0) > 0);
});
