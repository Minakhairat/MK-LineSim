import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { MinPriorityQueue } from '../src/simulation/priorityQueue';
import {
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
  ShiftDefinition,
  WorkerDefinition,
} from '../src/types/project';

function createBaseProject(overrides?: Partial<ProjectData['simulationConfig']>): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  const durationSec = overrides?.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'proj_des_p2',
    name: 'DES Phase 2 Verification',
    factoryName: 'Verification Plant',
    industryType: 'Verification',
    description: '',
    createdAt: now,
    updatedAt: now,
    factory: {
      name: 'Floor',
      lengthM: 80,
      widthM: 40,
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
        name: 'Product 1',
        category: 'Std',
        dimensions: { length: 0.5, width: 0.4, height: 0.3 },
        weightKg: 2,
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
      speedMultiplier: 1,
      enableBreakdowns: false,
      randomSeed: 4219,
      shifts: [
        {
          id: 'shift_default',
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
  opts?: Partial<LayoutObject['operations']> & {
    x?: number;
    z?: number;
    length?: number;
    width?: number;
    kind?: LayoutObject['kind'];
    rotationDeg?: number;
    connectedToIds?: string[];
  }
): LayoutObject {
  const kind = opts?.kind ?? 'machine';
  return {
    id,
    name: id,
    kind,
    category: kind === 'conveyor' ? 'conveyor_belt' : kind === 'buffer' ? 'buffer' : 'cnc_machine',
    templateId: kind === 'conveyor' ? 'tpl_conv' : 'tpl_cnc',
    stageId,
    connectedToIds: opts?.connectedToIds ?? [],
    geometry: {
      position: { x: opts?.x ?? 5, y: 0, z: opts?.z ?? 5 },
      dimensions: {
        length: opts?.length ?? (kind === 'conveyor' ? 10 : 2),
        width: opts?.width ?? (kind === 'conveyor' ? 0.8 : 1.4),
        height: 1.0,
      },
      rotationDeg: opts?.rotationDeg ?? 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: opts?.setupTimeSec ?? 0,
      loadingTimeSec: opts?.loadingTimeSec ?? 0,
      unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
      capacity: opts?.capacity ?? (kind === 'conveyor' ? 0 : 1),
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
      failureModel: opts?.failureModel,
      repairModel: opts?.repairModel,
      mtbfSec: opts?.mtbfSec,
      mttrSec: opts?.mttrSec,
      mttrStdDevSec: opts?.mttrStdDevSec,
      plannedMaintenance: opts?.plannedMaintenance,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: kind === 'conveyor' ? 'conveyors' : 'equipment' },
  };
}

function makeStage(
  id: string,
  assignedObjectIds: string[],
  procSec: number,
  opts?: Partial<ProductionStage>
): ProductionStage {
  return {
    id,
    code: id.toUpperCase(),
    name: opts?.name ?? id,
    description: '',
    processingTimeSec: procSec,
    setupTimeSec: opts?.setupTimeSec ?? 0,
    loadingTimeSec: opts?.loadingTimeSec ?? 0,
    unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
    requiredMachines: opts?.requiredMachines ?? Math.max(1, assignedObjectIds.length),
    requiredWorkers: opts?.requiredWorkers ?? 0,
    inputQty: opts?.inputQty ?? 1,
    outputQty: opts?.outputQty ?? 1,
    bufferCapacity: opts?.bufferCapacity ?? 10,
    scrapRate: opts?.scrapRate ?? 0,
    reworkProbability: opts?.reworkProbability ?? 0,
    defectModel: opts?.defectModel ?? 'unit',
    predecessorIds: opts?.predecessorIds ?? [],
    successorIds: opts?.successorIds ?? [],
    assignedObjectIds,
    batchSize: opts?.batchSize,
    batchMode: opts?.batchMode,
    batchTransferTimeSec: opts?.batchTransferTimeSec,
    conveyorObjectId: opts?.conveyorObjectId,
  };
}

function makeWorker(
  id: string,
  assignedStageIds: string[],
  opts?: Partial<WorkerDefinition> & { speedMps?: number }
): WorkerDefinition {
  const spd = opts?.walkingSpeedMps ?? opts?.speedMps ?? 1.5;
  return {
    id,
    label: id,
    name: id,
    walkingSpeedMps: spd,
    skillCategory: 'Assembly & Operations',
    skillLevel: 4,
    assignedStageIds,
    assignedStationId: opts?.assignedStationId,
    assignedTo: opts?.assignedTo,
    placementSide: opts?.placementSide,
    efficiencyFactor: opts?.efficiencyFactor ?? 1.0,
    position: opts?.position ?? { x: 5, y: 0, z: 5 },
    color: '#2563EB',
    shiftId: opts?.shiftId ?? 'shift_default',
    breakPolicy: opts?.breakPolicy,
    shiftEndPolicy: opts?.shiftEndPolicy,
  };
}

function runWithStepInvariants(proj: ProjectData, contextLabel: string) {
  const eng = new DiscreteEventSimulationEngine(proj);
  let steps = 0;
  let prevClock = -Infinity;
  while (eng.stepNextEvent()) {
    steps++;
    assert.ok(eng.clockSec >= prevClock - 1e-12, `${contextLabel}: non-monotonic clock ${eng.clockSec} < ${prevClock}`);
    prevClock = eng.clockSec;
    const audit = eng.auditInvariants();
    assert.equal(
      audit.ok,
      true,
      `${contextLabel} step ${steps} at t=${audit.clockSec}: ${audit.violations.join(' | ')}`
    );
  }
  const finalAudit = eng.auditInvariants();
  assert.equal(
    finalAudit.ok,
    true,
    `${contextLabel} final at t=${finalAudit.clockSec}: ${finalAudit.violations.join(' | ')}`
  );
  return { eng, result: eng.buildResult(), audit: finalAudit, steps };
}

// ============================================================================
// 1. EVENT SCHEDULING
// ============================================================================

test('Phase 2 [1. Event Scheduling]: Min-heap ordering, equal-timestamp FIFO seq, simultaneous release/alloc, 0s & 1ms events, token cancellation', () => {
  // 1A: MinPriorityQueue min-heap & FIFO seq ordering
  const pq = new MinPriorityQueue<{ timestamp: number; seq: number; label: string }>();
  pq.push({ timestamp: 10, seq: 1, label: 't10_s1' });
  pq.push({ timestamp: 5, seq: 2, label: 't5_s2' });
  pq.push({ timestamp: 5, seq: 1, label: 't5_s1' });
  pq.push({ timestamp: 10, seq: 3, label: 't10_s3' });
  pq.push({ timestamp: 0, seq: 5, label: 't0_s5' });
  pq.push({ timestamp: 0, seq: 4, label: 't0_s4' });
  pq.push({ timestamp: 5, seq: 3, label: 't5_s3' });

  const popped: string[] = [];
  while (pq.size > 0) popped.push(pq.pop()!.label);
  assert.deepEqual(popped, ['t0_s4', 't0_s5', 't5_s1', 't5_s2', 't5_s3', 't10_s1', 't10_s3']);

  // 1B: Simultaneous release and allocation + deterministic (timestamp, seq) tie-breaking
  // 2 sequential stages sharing 1 worker w1 positioned at south apron (walkTimeSec = 0):
  // - t=0: ProductCreated (U1) starts S1 [0..10], schedules ProductCreated(U2) at t=10 (seq 5) BEFORE ProcessingCompleted(U1) at t=10 (seq 9).
  // - t=10: ProductCreated(U2, seq 5) runs first, then ProcessingCompleted(U1, seq 9) releases w1 & simultaneously allocates w1 to U2 at S1 [10..20] (seq 13)!
  //         Then ProductArrived(U1, S2, seq 16) enters S2 queue.
  // - t=20: U2 finishes S1 -> releases w1 -> simultaneously allocates w1 to U1 at S2 [20..30].
  // - t=30: U1 finishes ProductCompleted at 30 -> simultaneously allocates w1 to U2 at S2 [30..40].
  // - t=40: U2 finishes ProductCompleted at 40. Zero idle gap between release and reallocation!
  const pSim = createBaseProject({ durationSec: 100, arrivalIntervalSec: 10, maxPlannedUnits: 2 });
  const m1 = makeMachine('m1', 's1', 10, { x: 5, z: 5, requiredOperators: 1 });
  const m2 = makeMachine('m2', 's2', 10, { x: 5, z: 5, requiredOperators: 1 });
  pSim.layoutObjects = [m1, m2];
  pSim.stages = [
    makeStage('s1', ['m1'], 10, { requiredWorkers: 1, successorIds: ['s2'], bufferCapacity: 5 }),
    makeStage('s2', ['m2'], 10, { requiredWorkers: 1, predecessorIds: ['s1'], bufferCapacity: 5 }),
  ];
  // Station width=1.4 -> south apron is at z = 5 + 1.4/2 + 0.55 = 6.25 (within 0.1m tolerance -> walkTimeSec = 0)
  pSim.workers = [makeWorker('w1', ['s1', 's2'], { position: { x: 5, y: 0, z: 6.25 }, walkingSpeedMps: 1e6 })];
  pSim.products[0].routeStageIds = ['s1', 's2'];

  const { eng: simEng, result: simRes } = runWithStepInvariants(pSim, 'SimultaneousWorkerReleaseAlloc');
  assert.equal(simRes.kpis.goodUnits, 2);
  const compEvents = simEng.getAllEvents().filter((e) => e.type === 'ProductCompleted');
  assert.equal(compEvents.length, 2);
  assert.ok(Math.abs(compEvents[0].timestamp - 30) < 1e-6);
  assert.ok(Math.abs(compEvents[1].timestamp - 40) < 1e-6);
  const wStarts = simEng.getAllEvents().filter((e) => e.type === 'ProcessingStarted').map((e) => e.timestamp);
  assert.deepEqual(wStarts, [0, 10, 20, 30]);

  // Verify monotonic (timestamp, seq) across every recorded DES event
  const allEvs = simEng.getAllEvents();
  for (let i = 1; i < allEvs.length; i++) {
    const prev = allEvs[i - 1];
    const curr = allEvs[i];
    const ordered =
      curr.timestamp > prev.timestamp ||
      (curr.timestamp === prev.timestamp && curr.seq > prev.seq);
    assert.equal(ordered, true, `Event ordering violation at idx ${i}`);
  }

  // 1C: Zero-duration (0s) and near-zero-duration (0.001s = 1ms) events
  const pZero = createBaseProject({ durationSec: 20, arrivalIntervalSec: 5, maxPlannedUnits: 3 });
  const mz1 = makeMachine('mz1', 'sz1', 0, { x: 2, z: 5 });
  const mz2 = makeMachine('mz2', 'sz2', 0.001, { x: 4, z: 5 });
  pZero.layoutObjects = [mz1, mz2];
  pZero.stages = [
    makeStage('sz1', ['mz1'], 0, { successorIds: ['sz2'], bufferCapacity: 5 }),
    makeStage('sz2', ['mz2'], 0.001, { predecessorIds: ['sz1'], bufferCapacity: 5 }),
  ];
  pZero.products[0].routeStageIds = ['sz1', 'sz2'];
  const { eng: zEng, result: zRes } = runWithStepInvariants(pZero, 'ZeroAndNearZeroDuration');
  assert.equal(zRes.kpis.goodUnits, 3);
  const zComps = zEng.getAllEvents().filter((e) => e.type === 'ProductCompleted');
  assert.ok(Math.abs(zComps[0].timestamp - 0.001) < 1e-9);
  assert.ok(Math.abs(zComps[1].timestamp - 5.001) < 1e-9);
  assert.ok(Math.abs(zComps[2].timestamp - 10.001) < 1e-9);

  // 1D: Event cancellation & invalidated job tokens on breakdown preemption + walk preemption
  // mTok west apron is at x = 10 - (2/2 + 0.55) = 8.45. Placing wTok at x = 3.45 -> exact 5.0m walk @ 1m/s = 5.0s.
  // Case 1 (Processing token invalidation): proc=40s, walk [0..5], proc [5..25] (would end at t=45).
  // Fixed breakdown triggers at mtbf=25s with mttr=20s (down [25..45], next failure at 45+25=70).
  // Old ProcessingCompleted at t=45 MUST be invalidated by token and ignored; resumed job finishes at 45 + 20 = 65.0s!
  const pTok = createBaseProject({
    durationSec: 100,
    arrivalIntervalSec: 10,
    maxPlannedUnits: 1,
    enableBreakdowns: true,
  });
  const mTok = makeMachine('mTok', 'sTok', 40, {
    x: 10,
    z: 5,
    requiredOperators: 1,
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 25,
    mttrSec: 20,
  });
  pTok.layoutObjects = [mTok];
  pTok.stages = [makeStage('sTok', ['mTok'], 40, { requiredWorkers: 1 })];
  pTok.workers = [makeWorker('wTok', ['sTok'], { walkingSpeedMps: 1.0, position: { x: 3.45, y: 0, z: 5 } })];
  pTok.products[0].routeStageIds = ['sTok'];

  const { eng: tokEng, result: tokRes } = runWithStepInvariants(pTok, 'TokenInvalidation');
  assert.equal(tokRes.kpis.goodUnits, 1, 'Preempted token must complete exactly once, never twice');
  const tokComps = tokEng.getAllEvents().filter((e) => e.type === 'ProductCompleted');
  assert.equal(tokComps.length, 1);
  assert.ok(
    Math.abs(tokComps[0].timestamp - 65) < 1e-6,
    `Expected resumed completion at 65s (walk 5 + proc 20 + repair 20 + rem 20), got ${tokComps[0].timestamp}`
  );

  // Case 2 (Walk-phase token invalidation): breakdown triggers mid-walk at t=3.5s during 5.0s walk!
  // Walk [0..3.5] -> paused 10s [3.5..13.5] (old ProcessingStarted at t=5s invalidated!) -> remaining walk 1.5s [13.5..15] -> proc 1s [15..16] -> finishes at 16.0s!
  const pWalkTok = createBaseProject({
    durationSec: 40,
    arrivalIntervalSec: 10,
    maxPlannedUnits: 1,
    enableBreakdowns: true,
  });
  pWalkTok.layoutObjects = [
    makeMachine('mWTok', 'sWTok', 1, {
      x: 10,
      z: 5,
      requiredOperators: 1,
      failureModel: 'fixed',
      repairModel: 'fixed',
      mtbfSec: 3.5,
      mttrSec: 10,
    }),
  ];
  pWalkTok.stages = [makeStage('sWTok', ['mWTok'], 1, { requiredWorkers: 1 })];
  pWalkTok.workers = [makeWorker('wWTok', ['sWTok'], { walkingSpeedMps: 1.0, position: { x: 3.45, y: 0, z: 5 } })];
  pWalkTok.products[0].routeStageIds = ['sWTok'];
  const { eng: wTokEng, result: wTokRes } = runWithStepInvariants(pWalkTok, 'WalkTokenInvalidation');
  assert.equal(wTokRes.kpis.goodUnits, 1);
  const wTokComps = wTokEng.getAllEvents().filter((e) => e.type === 'ProductCompleted');
  assert.equal(wTokComps.length, 1);
  assert.ok(
    Math.abs(wTokComps[0].timestamp - 16) < 1e-6,
    `Expected walk-preempted completion at 16s, got ${wTokComps[0].timestamp}`
  );
});

// ============================================================================
// 2. MATERIAL CONSERVATION
// ============================================================================

test('Phase 2 [2. Material Conservation]: Exact step-by-step audit across collect_batch, unbatch, split scrap, and rework', () => {
  // 10 units arrive every 5s. Stage1: proc 4s, collect_batch=4; Stage2: proc 6s, scrap=0.2, rework=0.2; Stage3: unbatch, proc 3s.
  // Verify auditInvariants().ok === true at EVERY event step + released == completed + scrapped + wip (and exact partition sum).
  const proj = createBaseProject({ durationSec: 300, arrivalIntervalSec: 5, maxPlannedUnits: 10, randomSeed: 777 });
  const m1 = makeMachine('m1', 's1', 4, { x: 2, z: 5 });
  const m2 = makeMachine('m2', 's2', 6, { x: 6, z: 5 });
  const m3 = makeMachine('m3', 's3', 3, { x: 10, z: 5 });
  proj.layoutObjects = [m1, m2, m3];
  proj.stages = [
    makeStage('s1', ['m1'], 4, {
      batchMode: 'collect_batch',
      batchSize: 4,
      successorIds: ['s2'],
      bufferCapacity: 8,
    }),
    makeStage('s2', ['m2'], 6, {
      scrapRate: 0.25,
      reworkProbability: 0.25,
      defectModel: 'unit',
      predecessorIds: ['s1'],
      successorIds: ['s3'],
      bufferCapacity: 8,
    }),
    makeStage('s3', ['m3'], 3, {
      batchMode: 'unbatch',
      predecessorIds: ['s2'],
      bufferCapacity: 12,
    }),
  ];
  proj.products[0].routeStageIds = ['s1', 's2', 's3'];

  const { eng, result, audit } = runWithStepInvariants(proj, 'MaterialConservationBatchScrapRework');
  assert.equal(audit.conservation.totalReleasedUnits, 10);
  assert.equal(audit.conservation.unaccountedUnits, 0);
  assert.equal(
    audit.conservation.completedUnits + audit.conservation.scrappedUnits + audit.conservation.activeWipUnits,
    10
  );
  assert.equal(result.kpis.goodUnits + result.kpis.defectiveUnits, 10);
  assert.ok(result.kpis.defectiveUnits > 0, 'Expected deterministic seed=777 to exercise unit scrap');
  assert.ok((result.kpis.reworkUnits ?? 0) > 0, 'Expected deterministic seed=777 to exercise rework');
  // Partial batch of 2 units (10 % 4 = 2) should flush automatically once upstream exhausts
  assert.ok(audit.conservation.absorbedChildEntities >= 10);
  assert.equal(eng.auditInvariants().ok, true);
});

// ============================================================================
// 3. SEQUENTIAL PRODUCTION
// ============================================================================

test('Phase 2 [3. Sequential Production]: 3 sequential stations, distinct cycles, distinct shift calendars, finite buffers, and machine breakdown', () => {
  // S1 (proc 10s), S2 (proc 25s, bottleneck), S3 (proc 15s), finite buffers buf(S2)=1, buf(S3)=1.
  // S1 & S2 active [0..300], S3 starts delayed shift at t=40 [40..300] (unavailable [0..40], creating downstream starvation/backpressure test).
  // Plus S2 has deterministic breakdown at t=100s for 20s (repairs at 120s).
  const shiftFull: ShiftDefinition = { id: 'sh_full', name: 'Full', startSec: 0, durationSec: 300, breaks: [] };
  const shiftDelayed: ShiftDefinition = { id: 'sh_del', name: 'Delayed S3', startSec: 40, durationSec: 260, breaks: [] };
  const proj = createBaseProject({
    durationSec: 300,
    arrivalIntervalSec: 10,
    maxPlannedUnits: 0,
    enableBreakdowns: true,
    shifts: [shiftFull, shiftDelayed],
  });
  const m1 = makeMachine('m1', 's1', 10, { x: 2, z: 5, shiftId: 'sh_full' });
  const m2 = makeMachine('m2', 's2', 25, {
    x: 6,
    z: 5,
    shiftId: 'sh_full',
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 100,
    mttrSec: 20,
  });
  const m3 = makeMachine('m3', 's3', 15, { x: 10, z: 5, shiftId: 'sh_del' });
  proj.layoutObjects = [m1, m2, m3];
  proj.stages = [
    makeStage('s1', ['m1'], 10, { bufferCapacity: 2, successorIds: ['s2'] }),
    makeStage('s2', ['m2'], 25, { bufferCapacity: 1, predecessorIds: ['s1'], successorIds: ['s3'] }),
    makeStage('s3', ['m3'], 15, { bufferCapacity: 1, predecessorIds: ['s2'] }),
  ];
  proj.products[0].routeStageIds = ['s1', 's2', 's3'];

  const { result } = runWithStepInvariants(proj, 'Sequential3StationsMixedShiftsBreakdown');
  const s2Analytics = result.stageAnalytics.find((s) => s.stageId === 's2')!;
  const s3Analytics = result.stageAnalytics.find((s) => s.stageId === 's3')!;
  const m1Res = result.resourceAnalytics!.find((r) => r.objectId === 'm1')!;
  const m2Res = result.resourceAnalytics!.find((r) => r.objectId === 'm2')!;
  const m3Res = result.resourceAnalytics!.find((r) => r.objectId === 'm3')!;

  assert.equal(result.kpis.bottleneckStageId, 's2');
  assert.ok(m1Res.blockedTimeSec > 0, 'Fast S1 must block upstream when S2 buffer is full');
  assert.ok(m2Res.unplannedDowntimeSec >= 20, `M2 must record breakdown downtime >= 20s, got ${m2Res.unplannedDowntimeSec}`);
  assert.ok(Math.abs(m3Res.unavailableTimeSec - 40) < 1e-6, 'M3 delayed shift must record 40s unavailable');
  assert.ok(s2Analytics.completedCount >= s3Analytics.completedCount);
  assert.ok(result.kpis.goodUnits >= 7 && result.kpis.goodUnits <= 11);
});

// ============================================================================
// 4. PARALLEL PRODUCTION
// ============================================================================

test('Phase 2 [4. Parallel Production]: Load balancing, heterogeneous cycle times, unavailable/repair failover, worker contention, capacity > 1', () => {
  // 4A: 2 identical machines (30s each), sparse arrivals every 20s for 10 units -> analytical: 5 units on M1, 5 units on M2 (load balanced)
  const pBal = createBaseProject({ durationSec: 300, arrivalIntervalSec: 20, maxPlannedUnits: 10 });
  const mBal1 = makeMachine('mBal1', 'sBal', 30, { x: 4, z: 3 });
  const mBal2 = makeMachine('mBal2', 'sBal', 30, { x: 4, z: 7 });
  pBal.layoutObjects = [mBal1, mBal2];
  pBal.stages = [makeStage('sBal', ['mBal1', 'mBal2'], 30, { requiredMachines: 2 })];
  pBal.products[0].routeStageIds = ['sBal'];

  const { result: resBal } = runWithStepInvariants(pBal, 'ParallelLoadBalance');
  const r1 = resBal.resourceAnalytics!.find((r) => r.objectId === 'mBal1')!;
  const r2 = resBal.resourceAnalytics!.find((r) => r.objectId === 'mBal2')!;
  assert.equal(resBal.kpis.goodUnits, 10);
  assert.equal(r1.processedCount, 5);
  assert.equal(r2.processedCount, 5);

  // 4B: Different machine cycle times (M_fast = 20s, M_slow = 40s), horizon 120s, arrival 1s ->
  // Analytical: in 120s, M_fast completes floor(120/20)=6 units (minus 1 arriving at t=0 finishes t=20..t=120 -> 6 units!),
  // M_slow (first unit starts at t=1) finishes at 41, 81, (next finishes 121 > 120) -> 2 units! Total = 8 units.
  const pHet = createBaseProject({ durationSec: 120, arrivalIntervalSec: 1, maxPlannedUnits: 0 });
  const mFast = makeMachine('mFast', 'sHet', 20, { x: 4, z: 3 });
  const mSlow = makeMachine('mSlow', 'sHet', 40, { x: 4, z: 7 });
  pHet.layoutObjects = [mFast, mSlow];
  pHet.stages = [makeStage('sHet', ['mSlow', 'mFast'], 0, { requiredMachines: 2, bufferCapacity: 200 })];
  pHet.products[0].routeStageIds = ['sHet'];

  const { result: resHet } = runWithStepInvariants(pHet, 'ParallelHeterogeneousCycles');
  const rFast = resHet.resourceAnalytics!.find((r) => r.objectId === 'mFast')!;
  const rSlow = resHet.resourceAnalytics!.find((r) => r.objectId === 'mSlow')!;
  assert.equal(rFast.processedCount, 6);
  assert.equal(rSlow.processedCount, 2);
  assert.equal(resHet.kpis.goodUnits, 8);

  // 4C: 1 machine unavailable (availability=0), 1 undergoing repair (mtbf=25, mttr=20), 1 healthy spare with worker contention (1 shared worker)
  // Parallel stage has mDown (avail=0), mRepair (proc=20, mtbf=25, mttr=20), mSpare (proc=20); only 1 worker wShared ->
  // Worker contention serializes work to max 1 unit at a time across active machines.
  const pFail = createBaseProject({
    durationSec: 120,
    arrivalIntervalSec: 5,
    maxPlannedUnits: 4,
    enableBreakdowns: true,
  });
  const mDown = makeMachine('mDown', 'sFail', 20, { x: 4, z: 2, availability: 0, requiredOperators: 1 });
  const mRep = makeMachine('mRep', 'sFail', 20, {
    x: 4,
    z: 5,
    requiredOperators: 1,
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 25,
    mttrSec: 20,
  });
  const mOk = makeMachine('mOk', 'sFail', 20, { x: 4, z: 8, requiredOperators: 1 });
  pFail.layoutObjects = [mDown, mRep, mOk];
  pFail.stages = [makeStage('sFail', ['mDown', 'mRep', 'mOk'], 20, { requiredMachines: 3, requiredWorkers: 1 })];
  pFail.workers = [makeWorker('wShared', ['sFail'], { position: { x: 4, y: 0, z: 5 }, speedMps: 1000 })];
  pFail.products[0].routeStageIds = ['sFail'];

  const { result: resFail } = runWithStepInvariants(pFail, 'ParallelUnavailableRepairContention');
  const rDown = resFail.resourceAnalytics!.find((r) => r.objectId === 'mDown')!;
  assert.equal(rDown.processedCount, 0);
  assert.equal(rDown.runningTimeSec, 0);
  assert.equal(resFail.kpis.goodUnits, 4);

  // 4D: Multi-capacity machine (capacity = 3, proc = 30s, arrival = 5s, 6 units)
  // Analytical: Unit 1..3 run concurrently ([0..30], [5..35], [10..40]); Unit 4..6 reuse slots at [30..60], [35..65], [40..70].
  const pCap = createBaseProject({ durationSec: 100, arrivalIntervalSec: 5, maxPlannedUnits: 6 });
  const mOven = makeMachine('mOven', 'sOven', 30, { x: 4, z: 5, capacity: 3 });
  pCap.layoutObjects = [mOven];
  pCap.stages = [makeStage('sOven', ['mOven'], 30, { bufferCapacity: 10 })];
  pCap.products[0].routeStageIds = ['sOven'];

  const { eng: capEng, result: capRes } = runWithStepInvariants(pCap, 'ParallelMultiCapacity');
  assert.equal(capRes.kpis.goodUnits, 6);
  const compCap = capEng.getAllEvents().filter((e) => e.type === 'ProductCompleted').map((e) => e.timestamp);
  assert.deepEqual(compCap, [30, 35, 40, 60, 65, 70]);
});

// ============================================================================
// 5. BUFFER LOGIC
// ============================================================================

test('Phase 2 [5. Buffer Logic]: Empty, partial, full, blocking, starvation, upstream/downstream interruptions & recovery', () => {
  // S1 (proc 10s, buf 50) -> S2 (proc 20s, finite buf = 2).
  // Arrivals every 5s: S1 outputs at 10, 20, 30, 40, 50, 60...
  // S2 starts U1 at 10 (busy 10..30). S2 buffer absorbs U2 at 20 (partial: 1/2), U3 at 30 (Wait: U1 frees S2 at 30! So U2 enters S2 at 30, U3 stays 1/2).
  // Plus add planned maintenance on S2 [40..80]: S2 stops at t=40 for 40s!
  // During 40..80: S2 buffer fills to 2/2 (FULL), S1 finishes unit -> BufferFull -> S1 becomes BLOCKED until t=80 S2 recovers!
  // Plus add upstream maintenance on S1 [150..220] while S2 finishes backlog -> S2 drains buffer & becomes STARVED until t=220 S1 resumes!
  const proj = createBaseProject({
    durationSec: 320,
    arrivalIntervalSec: 5,
    maxPlannedUnits: 0,
    maintenanceWindows: [
      { id: 'mw_down_s2', name: 'S2 Planned Stop', startSec: 40, durationSec: 40, objectId: 'm2' },
      { id: 'mw_down_s1', name: 'S1 Planned Stop', startSec: 150, durationSec: 70, objectId: 'm1' },
    ],
  });
  const m1 = makeMachine('m1', 's1', 10, { x: 2, z: 5 });
  const m2 = makeMachine('m2', 's2', 20, { x: 8, z: 5 });
  proj.layoutObjects = [m1, m2];
  proj.stages = [
    makeStage('s1', ['m1'], 10, { bufferCapacity: 50, successorIds: ['s2'] }),
    makeStage('s2', ['m2'], 20, { bufferCapacity: 2, predecessorIds: ['s1'] }),
  ];
  proj.products[0].routeStageIds = ['s1', 's2'];

  const eng = new DiscreteEventSimulationEngine(proj);
  let sawEmptyBuf = false;
  let sawPartialBuf = false;
  let sawFullBuf = false;
  let sawBlockedM1 = false;
  let sawStarvedM2 = false;
  let sawRecoveryAfterS2Maint = false;

  while (eng.stepNextEvent()) {
    const audit = eng.auditInvariants();
    assert.equal(audit.ok, true, `Buffer test at t=${audit.clockSec}: ${audit.violations.join(' | ')}`);
    const snap = eng.getSnapshot(false);
    const bufUsed = audit.conservation.waitingInQueueUnits; // includes s1 + s2; inspect exact S2 wait or events
    if (eng.clockSec === 0 && bufUsed === 0) sawEmptyBuf = true;
    const m1St = snap.objects['m1'].status;
    const m2St = snap.objects['m2'].status;
    if (m1St === 'blocked' && eng.clockSec >= 40 && eng.clockSec <= 80) sawBlockedM1 = true;
    if (m2St === 'starved' && eng.clockSec >= 180 && eng.clockSec <= 220) sawStarvedM2 = true;
    if (eng.clockSec > 80 && m1St === 'running') sawRecoveryAfterS2Maint = true;
  }
  const evs = eng.getAllEvents();
  const s2BufFullEvs = evs.filter((e) => e.type === 'BufferFull' && e.stageId === 's2');
  const s2BufRelEvs = evs.filter((e) => e.type === 'BufferReleased' && e.stageId === 's2');
  if (s2BufFullEvs.length > 0) sawFullBuf = true;
  if (s2BufRelEvs.length > 0) sawPartialBuf = true;

  assert.equal(sawEmptyBuf, true, 'Expected initial empty buffer observation');
  assert.equal(sawPartialBuf, true, 'Expected partial buffer usage & release');
  assert.equal(sawFullBuf, true, 'Expected full buffer condition on S2');
  assert.equal(sawBlockedM1, true, 'Expected upstream M1 blocking during downstream maintenance');
  assert.equal(sawStarvedM2, true, 'Expected downstream M2 starvation during extended upstream outage');
  assert.equal(sawRecoveryAfterS2Maint, true, 'Expected upstream M1 recovery when S2 buffer drained post-maintenance');
});

// ============================================================================
// 6. CONVEYOR LOGIC
// ============================================================================

test('Phase 2 [6A. Conveyor Physics]: Transit time = distance/speed, pitch, min headway, occupancy, conveyor-only without artificial proc', () => {
  // Conveyor length = 10m, speed = 2.0 m/s -> traversal = 5.0s exact.
  // Product length = 0.5m, spacing = 0.25m -> pitch = 0.75m, min headway = 0.75 / 2.0 = 0.375s, max physical cap = floor(10/0.75) = 13.
  // Arrivals every 0.2s (faster than headway 0.375s!), maxPlannedUnits = 5.
  // Verify: unit i enters at i*0.375s, exits at i*0.375s + 5.0s, zero artificial machine processing time!
  const proj = createBaseProject({ durationSec: 50, arrivalIntervalSec: 0.2, maxPlannedUnits: 5 });
  const conv = makeMachine('cOnly', 'sConv', 0, {
    kind: 'conveyor',
    x: 10,
    z: 5,
    length: 10,
    width: 1.0,
    speedMps: 2.0,
    productSpacingM: 0.25,
  });
  proj.layoutObjects = [conv];
  proj.stages = [makeStage('sConv', ['cOnly'], 0, { bufferCapacity: 20 })];
  proj.products[0].routeStageIds = ['sConv'];

  const { eng, result } = runWithStepInvariants(proj, 'ConveyorOnlyHeadwayPitchSpeed');
  assert.equal(result.kpis.goodUnits, 5);
  assert.equal(result.kpis.avgProcessingTimeSec, 0, 'Conveyor-only stage must NOT add artificial machine processing time');
  assert.ok(Math.abs((result.kpis.totalConveyorTransitTimeSec ?? 0) - 25) < 1e-6, 'Total conveyor transit must equal 5 * (10/2) = 25s');

  const procStarts = eng.getAllEvents().filter((e) => e.type === 'ProcessingStarted').map((e) => e.timestamp);
  const comps = eng.getAllEvents().filter((e) => e.type === 'ProductCompleted').map((e) => e.timestamp);
  assert.equal(procStarts.length, 5);
  assert.equal(comps.length, 5);
  for (let i = 0; i < 5; i++) {
    const expStart = i * 0.375;
    const expEnd = expStart + 5.0;
    assert.ok(Math.abs(procStarts[i] - expStart) < 1e-6, `Unit ${i + 1} entry ${procStarts[i]} != ${expStart}`);
    assert.ok(Math.abs(comps[i] - expEnd) < 1e-6, `Unit ${i + 1} exit ${comps[i]} != ${expEnd}`);
  }
});

test('Phase 2 [6B. Conveyor Merging & Blocking]: Two upstream stations merging onto shared short conveyor enforce occupancy & headway', () => {
  // Manual diamond split/merge or 2-stage flow where mA (x=2, proc 5s) and mB (x=2, proc 5s) BOTH merge onto shared transfer convC (len=1.5m, speed=1m/s) -> sOut
  // Because mA and mB are 2 parallel stations in sFeed (proc 5s, capacity 2 via 2 machines), both finish at exact t=5s and attempt transfer onto short 1.5m conveyor (physical cap = floor(1.5 / 0.75) = 2).
  // Test tighter short belt len=0.8m (cap = floor(0.8 / 0.65) = 1) with productSpacing=0.15m: only 1 can occupy belt at once, 2nd blocks until 1st completes transfer!
  const proj = createBaseProject({ durationSec: 40, arrivalIntervalSec: 0.1, maxPlannedUnits: 4 });
  const mA = makeMachine('mA', 'sFeed', 5, { x: 2, z: 3 });
  const mB = makeMachine('mB', 'sFeed', 5, { x: 2, z: 7 });
  const convShared = makeMachine('convShared', '', 0, {
    kind: 'conveyor',
    x: 4,
    z: 5,
    length: 1.0, // physical cap with 0.5m product + 0.15m spacing -> floor((1.0)/0.65) or capacity 1
    speedMps: 1.0,
    productSpacingM: 0.15,
  });
  convShared.stageId = undefined;
  const mOut = makeMachine('mOut', 'sOut', 1, { x: 6, z: 5 });
  proj.layoutObjects = [mA, mB, convShared, mOut];
  proj.stages = [
    makeStage('sFeed', ['mA', 'mB'], 5, {
      requiredMachines: 2,
      conveyorObjectId: 'convShared',
      successorIds: ['sOut'],
      bufferCapacity: 10,
    }),
    makeStage('sOut', ['mOut'], 1, {
      predecessorIds: ['sFeed'],
      conveyorObjectId: 'convShared',
      bufferCapacity: 10,
    }),
  ];
  proj.products[0].routeStageIds = ['sFeed', 'sOut'];

  const { eng, result } = runWithStepInvariants(proj, 'ConveyorMergingAndBlocking');
  assert.equal(result.kpis.goodUnits, 4);
  const fullEvs = eng.getAllEvents().filter((e) => e.type === 'BufferFull');
  assert.ok(fullEvs.length > 0, 'Short merging conveyor (cap=1) must block 2nd simultaneous machine output');
});

test('Phase 2 [6C. Conveyor Failure & Restart]: Mid-transit conveyor breakdown freezes progress, blocks upstream, and resumes accurately on repair', () => {
  // Station m1 (x=2, proc 5s) -> transfer conveyor C1 (x=7, len=10.6, speed=1m/s -> transit path 10m @ 1m/s = 10s, from x=2 to x=12) -> Station m2 (x=12, proc 5s).
  // Arrival interval = 12s, maxPlannedUnits = 2:
  //   Unit 1: m1 [0..5], enters C1 at t=5 (would exit at t=15).
  //   C1 breaks down at t=12 for mttr=20s (down [12..32]). Next breakdown at 32+12=44.
  //   Unit 1 pauses on C1 at t=12 (7s elapsed, progress = 0.7), resumes at t=32, arrives m2 at t=35, completes m2 at t=40!
  //   Unit 2 arrives at m1 at t=12, finishes m1 at t=17 (DURING C1 breakdown [12..32]!) ->
  //   INVARIANT CHECK: Unit 2 MUST block on m1 [17..32] until C1 repairs at t=32! It must NEVER transport onto broken C1!
  //   At t=32 C1 recovers -> Unit 2 unblocks from m1, enters C1 at t=32, exits C1 at t=42 (before 2nd breakdown at 44!), finishes m2 at t=47!
  const proj = createBaseProject({
    durationSec: 80,
    arrivalIntervalSec: 12,
    maxPlannedUnits: 2,
    enableBreakdowns: true,
  });
  const m1 = makeMachine('m1', 's1', 5, { x: 2, z: 5 });
  const c1 = makeMachine('c1', '', 0, {
    kind: 'conveyor',
    x: 7,
    z: 5,
    length: 10.6,
    speedMps: 1.0,
    productSpacingM: 0.2,
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 12,
    mttrSec: 20,
  });
  c1.stageId = undefined;
  const m2 = makeMachine('m2', 's2', 5, { x: 12, z: 5 });
  proj.layoutObjects = [m1, c1, m2];
  proj.stages = [
    makeStage('s1', ['m1'], 5, { conveyorObjectId: 'c1', successorIds: ['s2'], bufferCapacity: 5 }),
    makeStage('s2', ['m2'], 5, { conveyorObjectId: 'c1', predecessorIds: ['s1'], bufferCapacity: 5 }),
  ];
  proj.products[0].routeStageIds = ['s1', 's2'];

  const eng = new DiscreteEventSimulationEngine(proj);
  let checkedFrozenMidDown = false;
  let checkedUpstreamBlockedDuringDown = false;

  while (eng.stepNextEvent()) {
    const audit = eng.auditInvariants();
    assert.equal(audit.ok, true, `ConvFailure at t=${audit.clockSec}: ${audit.violations.join(' | ')}`);
    const snap = eng.getSnapshot(false);
    if (eng.clockSec >= 12 && eng.clockSec < 32) {
      assert.equal(snap.objects['c1'].status, 'down');
      const u1 = snap.products.find((p) => p.serialNumber === 1);
      if (u1 && u1.locationKind === 'conveyor') {
        assert.ok(Math.abs((u1.conveyorProgress ?? 0) - 0.7) < 1e-6, `Paused progress must freeze at 0.7, got ${u1.conveyorProgress}`);
        checkedFrozenMidDown = true;
      }
      if (eng.clockSec >= 17 && eng.clockSec < 32 && snap.objects['m1'].status === 'blocked') {
        checkedUpstreamBlockedDuringDown = true;
      }
    }
  }
  const comps = eng.getAllEvents().filter((e) => e.type === 'ProductCompleted').map((e) => e.timestamp);
  assert.equal(checkedFrozenMidDown, true, 'Must observe frozen transit mid-breakdown');
  assert.equal(checkedUpstreamBlockedDuringDown, true, 'Upstream must stay blocked while conveyor is down');
  assert.equal(comps.length, 2);
  assert.ok(Math.abs(comps[0] - 40) < 1e-6, `Expected U1 completion at 40s, got ${comps[0]}`);
  assert.ok(Math.abs(comps[1] - 47) < 1e-6, `Expected U2 completion at 47s, got ${comps[1]}`);
});

// ============================================================================
// 7. ROUTING
// ============================================================================

test('Phase 2 [7. Routing]: Multiple product routes, rework & scrap handling, repeated stage visits, routing deadlock detection', () => {
  // 7A + 7C: Multi-product distinct routes + repeated stage visit!
  // Product A: ['S1', 'S2', 'S1', 'S3'] (re-enters S1!) -> proc: 10 + 15 + 10 + 20 = 55s lead time
  // Product B: ['S1', 'S3'] (skips S2 completely!) -> proc: 10 + 20 = 30s lead time (plus waiting behind A at S1)
  const pRoute = createBaseProject({
    durationSec: 200,
    arrivalIntervalSec: 100, // plenty of spacing so 0 queue contention between A and B? Wait: release 1 of each staggered at t=0 and t=100
    maxPlannedUnits: 2,
    dispatchingRule: 'fixed_sequence',
    productSequence: ['prodA', 'prodB'],
  });
  const ms1 = makeMachine('ms1', 'S1', 10, { x: 2, z: 5 });
  const ms2 = makeMachine('ms2', 'S2', 15, { x: 6, z: 5 });
  const ms3 = makeMachine('ms3', 'S3', 20, { x: 10, z: 5 });
  pRoute.layoutObjects = [ms1, ms2, ms3];
  pRoute.stages = [
    makeStage('S1', ['ms1'], 10, { successorIds: ['S2', 'S3'], bufferCapacity: 10 }),
    makeStage('S2', ['ms2'], 15, { predecessorIds: ['S1'], successorIds: ['S1'], bufferCapacity: 10 }),
    makeStage('S3', ['ms3'], 20, { predecessorIds: ['S1', 'S2'], bufferCapacity: 10 }),
  ];
  const prodA: ProductDefinition = {
    id: 'prodA',
    code: 'A',
    name: 'Prod A Revisit',
    category: 'Std',
    dimensions: { length: 0.4, width: 0.4, height: 0.3 },
    weightKg: 2,
    color: '#2563EB',
    targetQuantity: 1,
    routeStageIds: ['S1', 'S2', 'S1', 'S3'],
    modelShape: 'box',
    routingMode: 'auto',
  };
  const prodB: ProductDefinition = {
    id: 'prodB',
    code: 'B',
    name: 'Prod B Express',
    category: 'Std',
    dimensions: { length: 0.4, width: 0.4, height: 0.3 },
    weightKg: 2,
    color: '#10B981',
    targetQuantity: 1,
    routeStageIds: ['S1', 'S3'],
    modelShape: 'box',
    routingMode: 'auto',
  };
  pRoute.products = [prodA, prodB];

  const { eng: rEng, result: rRes } = runWithStepInvariants(pRoute, 'MultiProductAndRepeatedVisit');
  assert.equal(rRes.kpis.goodUnits, 2);
  const s1Res = rRes.stageAnalytics.find((s) => s.stageId === 'S1')!;
  const s2Res = rRes.stageAnalytics.find((s) => s.stageId === 'S2')!;
  const s3Res = rRes.stageAnalytics.find((s) => s.stageId === 'S3')!;
  // Prod A visited S1 twice + S2 once + S3 once; Prod B visited S1 once + S3 once => S1=3, S2=1, S3=2
  assert.equal(s1Res.enteredCount, 3, 'S1 must be entered twice by Prod A and once by Prod B');
  assert.equal(s2Res.enteredCount, 1, 'S2 must be entered ONLY by Prod A, never Prod B');
  assert.equal(s3Res.enteredCount, 2, 'S3 must be entered once by each product');
  const comps = rEng.getAllEvents().filter((e) => e.type === 'ProductCompleted');
  assert.ok(Math.abs(comps.find((c) => c.entityId === 'unit_1')!.timestamp - 55) < 1e-6);
  assert.ok(Math.abs(comps.find((c) => c.entityId === 'unit_2')!.timestamp - 130) < 1e-6);

  // 7B: Rework & Scrap handling (reworkProb=1.0 performs max 2 rework cycles before passing, OR scrapRate=1.0 scraps all)
  const pRw = createBaseProject({ durationSec: 200, arrivalIntervalSec: 100, maxPlannedUnits: 1 });
  pRw.layoutObjects = [makeMachine('mRw', 'sRw', 10, { x: 2, z: 5 })];
  pRw.stages = [makeStage('sRw', ['mRw'], 10, { reworkProbability: 1.0, scrapRate: 0 })];
  pRw.products[0].routeStageIds = ['sRw'];
  const { eng: rwEng, result: rwRes } = runWithStepInvariants(pRw, 'ReworkRouteCycles');
  // Analytical: initial pass [0..10] -> rework #1 [10..20] -> rework #2 [20..30] (reworkCount becomes 2, max rework limit -> passes!)
  assert.equal(rwRes.kpis.goodUnits, 1);
  assert.equal(rwRes.kpis.reworkCycles, 2);
  const rwComp = rwEng.getAllEvents().find((e) => e.type === 'ProductCompleted')!;
  assert.ok(Math.abs(rwComp.timestamp - 30) < 1e-6, `Expected 30s (3 passes) after 2 rework cycles, got ${rwComp.timestamp}`);

  const pScrap = createBaseProject({ durationSec: 100, arrivalIntervalSec: 10, maxPlannedUnits: 3 });
  pScrap.layoutObjects = [makeMachine('mSc', 'sSc', 10, { x: 2, z: 5 })];
  pScrap.stages = [makeStage('sSc', ['mSc'], 10, { scrapRate: 1.0 })];
  pScrap.products[0].routeStageIds = ['sSc'];
  const { result: scRes } = runWithStepInvariants(pScrap, 'TotalScrapRoute');
  assert.equal(scRes.kpis.goodUnits, 0);
  assert.equal(scRes.kpis.defectiveUnits, 3);

  // 7D: Routing Deadlock (manual mutual cycle mA <-> mB with 0 buffers)
  // Unit 1 enters S1 at t=0 (finishes t=10 -> tries S2, wait S2 is busy!)
  // Wait: to put Unit 1 on mA and Unit 2 on mB simultaneously with manual routing, set arrivalInterval=1, S1 proc=10 -> U1 moves to S2 at t=10!
  // Then U2 enters S1 at t=10 (proc=10 -> finishes t=20). Meanwhile S2 has proc=15 -> U1 finishes S2 at t=25 -> wants S1 (which is blocked waiting on S2 with U2)! DEADLOCK!
  const pDead = createBaseProject({ durationSec: 100, arrivalIntervalSec: 1, maxPlannedUnits: 2 });
  const mD1 = makeMachine('mD1', 'sD1', 10, { x: 2, z: 5, connectedToIds: ['mD2'] });
  const mD2 = makeMachine('mD2', 'sD2', 15, { x: 6, z: 5, connectedToIds: ['mD1'] });
  pDead.layoutObjects = [mD1, mD2];
  pDead.stages = [
    makeStage('sD1', ['mD1'], 10, { bufferCapacity: 0, predecessorIds: ['sD2'], successorIds: ['sD2'] }),
    makeStage('sD2', ['mD2'], 15, { bufferCapacity: 0, predecessorIds: ['sD1'], successorIds: ['sD1'] }),
  ];
  pDead.products[0].routingMode = 'manual';
  pDead.products[0].entryStageIds = ['sD1'];
  pDead.products[0].routeStageIds = ['sD1', 'sD2'];

  const { result: dRes, audit: dAudit } = runWithStepInvariants(pDead, 'RoutingDeadlockCycle');
  assert.equal(dAudit.conservation.totalReleasedUnits, 2);
  assert.equal(dAudit.conservation.blockedAtStationUnits, 2);
  assert.equal(dRes.kpis.goodUnits, 0);
  assert.ok(dAudit.deadlocks.length >= 1, 'Invariant auditor must detect circular-wait deadlock between sD1 and sD2');
});

// ============================================================================
// 8. SIMULATION TERMINATION
// ============================================================================

test('Phase 2 [8. Simulation Termination]: Normal completion, maxPlannedUnits, horizon cutoff, empty event queue, incomplete WIP at shift end, seed determinism', () => {
  // 8A & 8B & 8D: maxPlannedUnits = 4 with proc = 15s, arrival = 5s; shift window [0..60] inside horizon 3600s ->
  // Analytical last completion: U1 [0..15], U2 [15..30], U3 [30..45], U4 [45..60]. Queue empties cleanly at t=60s (stepNextEvent returns false well before 3600s!).
  const pFin = createBaseProject({
    durationSec: 3600,
    arrivalIntervalSec: 5,
    maxPlannedUnits: 4,
    shifts: [{ id: 'shift_exact', name: 'Exact Production Shift', startSec: 0, durationSec: 60, breaks: [] }],
  });
  pFin.layoutObjects = [makeMachine('mF', 'sF', 15, { x: 2, z: 5 })];
  pFin.stages = [makeStage('sF', ['mF'], 15)];
  pFin.products[0].routeStageIds = ['sF'];

  const eng1 = new DiscreteEventSimulationEngine(pFin);
  let lastActiveClock = 0;
  while (eng1.stepNextEvent()) {
    lastActiveClock = eng1.clockSec;
    assert.equal(eng1.auditInvariants().ok, true);
  }
  assert.equal(lastActiveClock, 60, 'Event queue must exhaust naturally at t=60s when maxPlannedUnits=4 finish');
  const res1 = eng1.buildResult();
  assert.equal(res1.kpis.goodUnits, 4);
  assert.equal(res1.kpis.currentWip, 0);

  // Also test when shift covers full horizon (3600s): no active production/transport/worker events remain after t=60s
  const pLongShift = createBaseProject({
    durationSec: 3600,
    arrivalIntervalSec: 5,
    maxPlannedUnits: 4,
    shifts: [{ id: 'shift_long', name: '24h', startSec: 0, durationSec: 3600, breaks: [] }],
  });
  pLongShift.layoutObjects = [makeMachine('mL', 'sL', 15, { x: 2, z: 5 })];
  pLongShift.stages = [makeStage('sL', ['mL'], 15)];
  pLongShift.products[0].routeStageIds = ['sL'];
  const longEng = new DiscreteEventSimulationEngine(pLongShift);
  const longRes = longEng.runToCompletion();
  const nonCalendarEvents = longEng
    .getAllEvents()
    .filter((e) => e.type !== 'ShiftStarted' && e.type !== 'ShiftEnded');
  const lastProdEventTs = nonCalendarEvents[nonCalendarEvents.length - 1]?.timestamp ?? -1;
  assert.equal(lastProdEventTs, 60, 'No production/material events may occur after final unit finishes at 60s');
  assert.equal(longRes.kpis.goodUnits, 4);

  // Deterministic repeatability (fixed seeded PRNG with stochastic scrap + rework + failures)
  const pSeeded = createBaseProject({
    durationSec: 600,
    arrivalIntervalSec: 12,
    maxPlannedUnits: 25,
    randomSeed: 4219,
    enableBreakdowns: true,
  });
  pSeeded.layoutObjects = [
    makeMachine('mSeed1', 'sSeed1', 10, { x: 3, z: 5, mtbfSec: 120, mttrSec: 25, failureModel: 'exponential', repairModel: 'lognormal', mttrStdDevSec: 5 }),
    makeMachine('mSeed2', 'sSeed2', 14, { x: 8, z: 5 }),
  ];
  pSeeded.stages = [
    makeStage('sSeed1', ['mSeed1'], 10, { scrapRate: 0.15, reworkProbability: 0.2, successorIds: ['sSeed2'] }),
    makeStage('sSeed2', ['mSeed2'], 14, { predecessorIds: ['sSeed1'], bufferCapacity: 8 }),
  ];
  pSeeded.products[0].routeStageIds = ['sSeed1', 'sSeed2'];
  const runSeedA = new DiscreteEventSimulationEngine(pSeeded);
  const resSeedA = runSeedA.runToCompletion();
  const runSeedB = new DiscreteEventSimulationEngine(pSeeded);
  const resSeedB = runSeedB.runToCompletion();
  assert.deepEqual(runSeedA.getAllEvents(), runSeedB.getAllEvents(), 'Deterministic PRNG must emit bit-identical event sequences');
  assert.deepEqual(resSeedA.kpis, resSeedB.kpis, 'Deterministic PRNG must produce identical KPIs');

  // 8C: Time horizon cutoff (horizon = 50s, proc = 20s, arrival = 5s -> completes at 20, 40; U3 stops in progress at 50!)
  const pHor = createBaseProject({ durationSec: 50, arrivalIntervalSec: 5, maxPlannedUnits: 0 });
  pHor.layoutObjects = [makeMachine('mH', 'sH', 20, { x: 2, z: 5 })];
  pHor.stages = [makeStage('sH', ['mH'], 20, { bufferCapacity: 50 })];
  pHor.products[0].routeStageIds = ['sH'];
  const { eng: hEng, result: hRes, audit: hAudit } = runWithStepInvariants(pHor, 'TimeHorizonCutoff');
  assert.equal(hEng.clockSec, 50);
  assert.equal(hRes.kpis.goodUnits, 2);
  assert.ok(hAudit.conservation.activeWipUnits > 0, 'Units arrived < 50s must remain conserved as active WIP at horizon');
  assert.equal(hAudit.conservation.unaccountedUnits, 0);

  // 8E: Incomplete production at shift end (shift1: [0..50], shift2: [100..200], unit starts 0..60? Wait: proc=30, unit 2 starts at 30)
  // Policy 1: stop_immediately -> unit 2 paused at t=50 (20s done, 10s remaining), resumes at t=100, completes at t=110!
  // Policy 2: finish_current_cycle -> unit 2 finishes cycle past shift end at t=60, no new unit starts during off-shift!
  const shifts2: ShiftDefinition[] = [
    { id: 'sh1', name: 'S1', startSec: 0, durationSec: 50, breaks: [] },
    { id: 'sh2', name: 'S2', startSec: 100, durationSec: 100, breaks: [] },
  ];
  const pStop = createBaseProject({
    durationSec: 200,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 2,
    interruptionPolicy: 'stop_immediately',
    shifts: shifts2,
  });
  pStop.layoutObjects = [makeMachine('mSh', 'sSh', 30, { x: 2, z: 5, breakPolicy: 'stop_immediately', shiftEndPolicy: 'stop_immediately' })];
  pStop.stages = [makeStage('sSh', ['mSh'], 30)];
  pStop.products[0].routeStageIds = ['sSh'];
  const { eng: stEng } = runWithStepInvariants(pStop, 'ShiftEndStopImmediately');
  const stComps = stEng.getAllEvents().filter((e) => e.type === 'ProductCompleted').map((e) => e.timestamp);
  assert.deepEqual(stComps, [30, 110]);

  const pFinCyc = createBaseProject({
    durationSec: 200,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 2,
    interruptionPolicy: 'finish_current_cycle',
    shifts: shifts2,
  });
  pFinCyc.layoutObjects = [makeMachine('mFc', 'sFc', 30, { x: 2, z: 5, breakPolicy: 'finish_current_cycle', shiftEndPolicy: 'finish_current_cycle' })];
  pFinCyc.stages = [makeStage('sFc', ['mFc'], 30)];
  pFinCyc.products[0].routeStageIds = ['sFc'];
  const { eng: fcEng } = runWithStepInvariants(pFinCyc, 'ShiftEndFinishCurrentCycle');
  const fcComps = fcEng.getAllEvents().filter((e) => e.type === 'ProductCompleted').map((e) => e.timestamp);
  assert.deepEqual(fcComps, [30, 60]);
});
