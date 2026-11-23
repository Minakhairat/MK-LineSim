import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import {
  LayoutObject,
  ProductionStage,
  ProjectData,
  WorkerDefinition,
} from '../src/types/project';

function createBaseProject(overrides?: Partial<ProjectData['simulationConfig']>): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  const durationSec = overrides?.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'proj_des_p2_1',
    name: 'DES Phase 2.1 Invariant Audit Verification',
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
    rendering: {
      color: '#334155',
      visible: true,
      locked: false,
      layer: kind === 'conveyor' ? 'conveyors' : 'equipment',
    },
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
  opts?: Partial<WorkerDefinition>
): WorkerDefinition {
  return {
    id,
    label: id,
    name: id,
    walkingSpeedMps: opts?.walkingSpeedMps ?? 1.5,
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

function runWithStepInvariants(proj: ProjectData, label: string) {
  const eng = new DiscreteEventSimulationEngine(proj);
  let steps = 0;
  while (eng.stepNextEvent()) {
    steps++;
    const audit = eng.auditInvariants();
    assert.equal(
      audit.ok,
      true,
      `${label} step ${steps} at t=${audit.clockSec}: ${audit.violations.join(' | ')}`
    );
    const c = audit.conservation;
    assert.equal(
      c.waitingInQueueUnits +
        c.batchBufferUnits +
        c.underProcessingUnits +
        c.blockedAtStationUnits +
        c.inTransitUnits +
        c.pendingArrivalUnits,
      c.activeWipUnits,
      `${label} step ${steps} WIP buckets must partition activeWipUnits exclusively`
    );
    assert.equal(
      c.completedUnits + c.scrappedUnits + c.activeWipUnits,
      c.totalReleasedUnits,
      `${label} step ${steps} material conservation identity`
    );
  }
  const finalAudit = eng.auditInvariants();
  assert.equal(
    finalAudit.ok,
    true,
    `${label} final at t=${finalAudit.clockSec}: ${finalAudit.violations.join(' | ')}`
  );
  return { eng, result: eng.buildResult(), audit: finalAudit, steps };
}

function cloneProjectForFaultInjection(eng: DiscreteEventSimulationEngine): any {
  // Helper exposing private state purely inside controlled negative test injections
  return eng as any;
}

// ============================================================================
// FINDING 1: BUFFER OCCUPANCY VALIDATION (POSITIVE + NEGATIVE)
// ============================================================================

test('Phase 2.1 [Finding 1]: Buffer occupancy invariants (empty, partial, exact-cap, overflow, zero-cap, unbounded Infinity, batch carrier/absorbed children)', () => {
  // 1A. Finite buffer cap=2: empty (0), partial (1), exact-at-cap (2), recovery after downstream stop
  const pFin = createBaseProject({ durationSec: 180, arrivalIntervalSec: 5, maxPlannedUnits: 6 });
  pFin.simulationConfig.maintenanceWindows = [
    { id: 'mw_s2', name: 'Stop S2', startSec: 15, durationSec: 35, objectId: 'm2' },
  ];
  const m1 = makeMachine('m1', 's1', 5, { x: 2 });
  const m2 = makeMachine('m2', 's2', 15, { x: 8 });
  pFin.layoutObjects = [m1, m2];
  pFin.stages = [
    makeStage('s1', ['m1'], 5, { bufferCapacity: 10, successorIds: ['s2'] }),
    makeStage('s2', ['m2'], 15, { bufferCapacity: 2, predecessorIds: ['s1'] }),
  ];
  pFin.products[0].routeStageIds = ['s1', 's2'];

  const engFin = new DiscreteEventSimulationEngine(pFin);
  let sawEmpty = false;
  let sawPartial = false;
  let sawExactAtCap = false;
  while (engFin.stepNextEvent()) {
    const audit = engFin.auditInvariants();
    assert.equal(audit.ok, true, `FiniteBuf at t=${audit.clockSec}: ${audit.violations.join(' | ')}`);
    const qLen = (engFin as any).stageBuffers.get('s2').length as number;
    if (qLen === 0) sawEmpty = true;
    if (qLen === 1) sawPartial = true;
    if (qLen === 2) sawExactAtCap = true;
  }
  assert.ok(sawEmpty && sawPartial && sawExactAtCap, 'Must observe empty (0), partial (1), and exact-cap (2) states cleanly');
  assert.equal(engFin.buildResult().kpis.goodUnits, 6);

  // 1B. Negative injection: Finite buffer overflow (buf.length > stage.bufferCapacity)
  const engOverflow = new DiscreteEventSimulationEngine(pFin);
  engOverflow.advanceTo(25);
  const privOv = cloneProjectForFaultInjection(engOverflow);
  const s2Buf: string[] = privOv.stageBuffers.get('s2');
  const s2Stage: ProductionStage = privOv.stagesMap.get('s2');
  // Create a synthetic active entity inside s2's buffer beyond capacity=2
  const bogusId = 'fault_overflow_unit';
  privOv.entities.set(bogusId, {
    id: bogusId,
    productId: 'p1',
    serialNumber: 999,
    createdAt: 0,
    scrapped: false,
    reworkCount: 0,
    currentStageId: 's2',
    locationKind: 'buffer',
    worldPosition: { x: 8, y: 0, z: 5 },
    waitingTimeSec: 0,
    processingTimeSec: 0,
    transportTimeSec: 0,
    batchCount: 1,
  });
  privOv.activeEntities.set(bogusId, privOv.entities.get(bogusId));
  privOv.totalArrived += 1;
  privOv.productReleasedCount.set('p1', (privOv.productReleasedCount.get('p1') || 0) + 1);
  while (s2Buf.length <= s2Stage.bufferCapacity) {
    if (s2Buf.length === s2Stage.bufferCapacity) {
      s2Buf.push(bogusId);
    } else {
      const filler = `fault_fill_${s2Buf.length}`;
      privOv.entities.set(filler, {
        ...privOv.entities.get(bogusId),
        id: filler,
        serialNumber: 990 + s2Buf.length,
      });
      privOv.activeEntities.set(filler, privOv.entities.get(filler));
      privOv.totalArrived += 1;
      privOv.productReleasedCount.set('p1', (privOv.productReleasedCount.get('p1') || 0) + 1);
      s2Buf.push(filler);
    }
  }
  const auditOv = engOverflow.auditInvariants();
  assert.equal(auditOv.ok, false);
  assert.ok(
    auditOv.violations.some((v) => v.includes('[INV_BUFFER_OVERFLOW]')),
    `Expected [INV_BUFFER_OVERFLOW], got: ${auditOv.violations.join(' | ')}`
  );

  // 1C. Negative injection: Invalid negative / NaN bufferCapacity
  const engBadCap = new DiscreteEventSimulationEngine(pFin);
  cloneProjectForFaultInjection(engBadCap).stagesMap.get('s2').bufferCapacity = -2;
  const auditBadCap = engBadCap.auditInvariants();
  assert.equal(auditBadCap.ok, false);
  assert.ok(
    auditBadCap.violations.some((v) => v.includes('[INV_BUFFER_INVALID_CAPACITY]')),
    `Expected [INV_BUFFER_INVALID_CAPACITY], got: ${auditBadCap.violations.join(' | ')}`
  );

  // 1D. Zero-capacity buffer: valid flow vs invalid stored item
  const pZero = createBaseProject({ durationSec: 120, arrivalIntervalSec: 5, maxPlannedUnits: 4 });
  const z1 = makeMachine('z1', 'sz1', 5, { x: 2 });
  const z2 = makeMachine('z2', 'sz2', 15, { x: 8 });
  pZero.layoutObjects = [z1, z2];
  pZero.stages = [
    makeStage('sz1', ['z1'], 5, { bufferCapacity: 5, successorIds: ['sz2'] }),
    makeStage('sz2', ['z2'], 15, { bufferCapacity: 0, predecessorIds: ['sz1'] }),
  ];
  pZero.products[0].routeStageIds = ['sz1', 'sz2'];
  const { audit: zAudit, result: zRes } = runWithStepInvariants(pZero, 'ZeroCapacityBuffer');
  assert.equal(zAudit.ok, true);
  assert.equal(zRes.kpis.goodUnits, 4);

  const engZeroFault = new DiscreteEventSimulationEngine(pZero);
  engZeroFault.advanceTo(10);
  const privZ = cloneProjectForFaultInjection(engZeroFault);
  const zBuf: string[] = privZ.stageBuffers.get('sz2');
  const zFake = {
    id: 'z_illegal',
    productId: 'p1',
    serialNumber: 555,
    createdAt: 0,
    scrapped: false,
    reworkCount: 0,
    currentStageId: 'sz2',
    locationKind: 'buffer',
    worldPosition: { x: 8, y: 0, z: 5 },
    waitingTimeSec: 0,
    processingTimeSec: 0,
    transportTimeSec: 0,
    batchCount: 1,
  };
  privZ.entities.set('z_illegal', zFake);
  privZ.activeEntities.set('z_illegal', zFake);
  privZ.totalArrived += 1;
  privZ.productReleasedCount.set('p1', (privZ.productReleasedCount.get('p1') || 0) + 1);
  zBuf.push('z_illegal');
  const auditZFault = engZeroFault.auditInvariants();
  assert.equal(auditZFault.ok, false);
  assert.ok(
    auditZFault.violations.some((v) => v.includes('[INV_BUFFER_ZERO_CAP_OCCUPIED]')),
    `Expected [INV_BUFFER_ZERO_CAP_OCCUPIED], got: ${auditZFault.violations.join(' | ')}`
  );

  // 1E. Unbounded Infinity buffer preserves Infinity through initialization & allows > 10 queued units without overflow
  const pInf = createBaseProject({ durationSec: 200, arrivalIntervalSec: 1, maxPlannedUnits: 14 });
  const i1 = makeMachine('i1', 'si1', 2, { x: 2 });
  const i2 = makeMachine('i2', 'si2', 20, { x: 8 });
  pInf.layoutObjects = [i1, i2];
  pInf.stages = [
    makeStage('si1', ['i1'], 2, { bufferCapacity: Infinity, successorIds: ['si2'] }),
    makeStage('si2', ['i2'], 20, { bufferCapacity: Infinity, predecessorIds: ['si1'] }),
  ];
  pInf.products[0].routeStageIds = ['si1', 'si2'];
  const engInf = new DiscreteEventSimulationEngine(pInf);
  assert.equal(
    cloneProjectForFaultInjection(engInf).stagesMap.get('si2').bufferCapacity,
    Infinity,
    'Unbounded bufferCapacity: Infinity must not be overwritten to 4'
  );
  let maxInfQ = 0;
  while (engInf.stepNextEvent()) {
    const a = engInf.auditInvariants();
    assert.equal(a.ok, true, `InfinityBuf at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    maxInfQ = Math.max(maxInfQ, cloneProjectForFaultInjection(engInf).stageBuffers.get('si2').length);
  }
  assert.ok(maxInfQ >= 8, `Expected unbounded queue >= 8 items without blocking, got ${maxInfQ}`);

  // 1F. Batch carrier & absorbed children in buffer: carrier = 1 slot, absorbed child rejected if injected into buffer
  const pBatch = createBaseProject({ durationSec: 120, arrivalIntervalSec: 2, maxPlannedUnits: 4 });
  const mb = makeMachine('mb', 'sb', 10, { batchMode: 'collect_batch', batchSize: 4 });
  pBatch.layoutObjects = [mb];
  pBatch.stages = [
    makeStage('sb', ['mb'], 10, { batchMode: 'collect_batch', batchSize: 4, bufferCapacity: 4 }),
  ];
  pBatch.products[0].routeStageIds = ['sb'];
  const engBatch = new DiscreteEventSimulationEngine(pBatch);
  engBatch.advanceTo(20);
  const privB = cloneProjectForFaultInjection(engBatch);
  const absorbed = Array.from(privB.entities.values()).find((e: any) => Boolean(e.absorbedIntoEntityId)) as any;
  assert.ok(absorbed, 'Expected absorbed child entities after batch carrier assembly');
  privB.stageBuffers.get('sb').push(absorbed.id);
  const auditBatchFault = engBatch.auditInvariants();
  assert.equal(auditBatchFault.ok, false);
  assert.ok(
    auditBatchFault.violations.some((v) => v.includes('[INV_BUFFER_STALE_ENTITY]')),
    `Expected [INV_BUFFER_STALE_ENTITY], got: ${auditBatchFault.violations.join(' | ')}`
  );
});

// ============================================================================
// FINDING 2: RESOURCE CAPACITY & REFERENCE INVARIANTS (POSITIVE + NEGATIVE)
// ============================================================================

test('Phase 2.1 [Finding 2]: Resource capacity, duplicate slot, invalid references, unavailable processing, and simultaneous release/realloc', () => {
  // 2A. Valid capacity=2 multi-slot & simultaneous release/reallocation at exact timestamps
  const pMulti = createBaseProject({ durationSec: 120, arrivalIntervalSec: 10, maxPlannedUnits: 4 });
  const mCap2 = makeMachine('mCap2', 'sCap2', 20, { capacity: 2 });
  pMulti.layoutObjects = [mCap2];
  pMulti.stages = [makeStage('sCap2', ['mCap2'], 20, { bufferCapacity: 10 })];
  pMulti.products[0].routeStageIds = ['sCap2'];
  const { result: resCap2 } = runWithStepInvariants(pMulti, 'MultiCapacityValid');
  assert.equal(resCap2.kpis.goodUnits, 4);

  // 2B. Negative injection: capacity overflow (busyUnitIds > capacity)
  const engCapOv = new DiscreteEventSimulationEngine(pMulti);
  engCapOv.advanceTo(15); // 2 units active on capacity=2
  const privOv = cloneProjectForFaultInjection(engCapOv);
  const stOv = privOv.objectStates.get('mCap2');
  const thirdEnt = {
    id: 'cap_overflow_3',
    productId: 'p1',
    serialNumber: 903,
    createdAt: 15,
    scrapped: false,
    reworkCount: 0,
    currentStageId: 'sCap2',
    locationKind: 'station',
    worldPosition: { x: 5, y: 0, z: 5 },
    waitingTimeSec: 0,
    processingTimeSec: 0,
    transportTimeSec: 0,
    batchCount: 1,
  };
  privOv.entities.set(thirdEnt.id, thirdEnt);
  privOv.activeEntities.set(thirdEnt.id, thirdEnt);
  privOv.totalArrived += 1;
  privOv.productReleasedCount.set('p1', (privOv.productReleasedCount.get('p1') || 0) + 1);
  stOv.busyUnitIds.push(thirdEnt.id);
  const aOv = engCapOv.auditInvariants();
  assert.equal(aOv.ok, false);
  assert.ok(aOv.violations.some((v) => v.includes('[INV_RESOURCE_CAPACITY_OVERFLOW]')));

  // 2C. Negative injection: duplicate slot in busyUnitIds
  const engDup = new DiscreteEventSimulationEngine(pMulti);
  engDup.advanceTo(5); // 1 unit busy
  const privDup = cloneProjectForFaultInjection(engDup);
  const stDup = privDup.objectStates.get('mCap2');
  stDup.busyUnitIds.push(stDup.busyUnitIds[0]);
  const aDup = engDup.auditInvariants();
  assert.equal(aDup.ok, false);
  assert.ok(aDup.violations.some((v) => v.includes('[INV_RESOURCE_DUPLICATE_SLOT]')));

  // 2D. Negative injection: invalid resource capacity (capacity <= 0) & invalid references
  const engBadRef = new DiscreteEventSimulationEngine(pMulti);
  engBadRef.advanceTo(5);
  const privRef = cloneProjectForFaultInjection(engBadRef);
  privRef.objectsMap.get('mCap2').operations.capacity = 0;
  privRef.stagesMap.get('sCap2').assignedObjectIds.push('non_existent_machine');
  const aRef = engBadRef.auditInvariants();
  assert.equal(aRef.ok, false);
  assert.ok(aRef.violations.some((v) => v.includes('[INV_RESOURCE_INVALID_CAPACITY]')));
  assert.ok(aRef.violations.some((v) => v.includes('[INV_INVALID_REFERENCE]')));

  // 2E. Negative injection: processing active job on down/under-repair resource
  const engDown = new DiscreteEventSimulationEngine(pMulti);
  engDown.advanceTo(5); // job expectedEndAt = 20 > 5
  const privDown = cloneProjectForFaultInjection(engDown);
  privDown.objectStates.get('mCap2').status = 'down';
  const aDown = engDown.auditInvariants();
  assert.equal(aDown.ok, false);
  assert.ok(aDown.violations.some((v) => v.includes('[INV_RESOURCE_UNAVAILABLE_ACTIVE]')));
});

// ============================================================================
// FINDING 3: WORKER ALLOCATION, STATUS & WALK PREEMPTION INVARIANTS
// ============================================================================

test('Phase 2.1 [Finding 3]: Worker conflict, same-timestamp reassignment, stale allocation, status mismatch, and walk preemption delay', () => {
  // 3A. Positive: worker release & immediate same-timestamp reassignment across S1 -> S2 + mid-walk breakdown preemption
  const pWalk = createBaseProject({ durationSec: 120, arrivalIntervalSec: 30, maxPlannedUnits: 2, enableBreakdowns: true });
  const mw1 = makeMachine('mw1', 'sw1', 10, {
    x: 5,
    z: 5,
    requiredOperators: 1,
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 3.5,
    mttrSec: 10,
  });
  const mw2 = makeMachine('mw2', 'sw2', 10, { x: 11, z: 5, requiredOperators: 1 });
  const wShared = makeWorker('wShared', ['sw1', 'sw2'], {
    position: { x: 5, y: 0, z: 12.5 }, // 7.5m @ 1.5m/s = 5.0s walk to mw1
    walkingSpeedMps: 1.5,
  });
  pWalk.layoutObjects = [mw1, mw2];
  pWalk.stages = [
    makeStage('sw1', ['mw1'], 10, { requiredWorkers: 1, successorIds: ['sw2'], bufferCapacity: 5 }),
    makeStage('sw2', ['mw2'], 10, { requiredWorkers: 1, predecessorIds: ['sw1'], bufferCapacity: 5 }),
  ];
  pWalk.workers = [wShared];
  pWalk.products[0].routeStageIds = ['sw1', 'sw2'];

  const engWalk = new DiscreteEventSimulationEngine(pWalk);
  let sawPausedWalk = false;
  while (engWalk.stepNextEvent()) {
    const a = engWalk.auditInvariants();
    assert.equal(a.ok, true, `WorkerWalk at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    const pw = cloneProjectForFaultInjection(engWalk).pausedWalkJobs.get('mw1') || [];
    if (pw.length > 0) sawPausedWalk = true;
  }
  assert.equal(sawPausedWalk, true, 'Must observe preempted walking job with preserved delay');
  assert.equal(engWalk.buildResult().kpis.goodUnits, 2);

  // 3B. Negative injection: omit remainingDispatchDelaySec on pausedWalkJobs
  const engBadWalk = new DiscreteEventSimulationEngine(pWalk);
  engBadWalk.advanceTo(4); // during mw1 down [3.5 .. 13.5], walk is in pausedWalkJobs
  const privBw = cloneProjectForFaultInjection(engBadWalk);
  const pausedWList = privBw.pausedWalkJobs.get('mw1');
  assert.ok(pausedWList && pausedWList.length === 1);
  pausedWList[0].remainingDispatchDelaySec = undefined;
  const aBw = engBadWalk.auditInvariants();
  assert.equal(aBw.ok, false);
  assert.ok(aBw.violations.some((v) => v.includes('[INV_WALK_MISSING_REMAINING_DELAY]')));

  // 3C. Negative injection: worker conflicting simultaneous jobs & stale post-completion allocation & status mismatch
  const pSimple = createBaseProject({ durationSec: 120, arrivalIntervalSec: 10, maxPlannedUnits: 2 });
  const ms1 = makeMachine('ms1', 'ss1', 10, { x: 2, requiredOperators: 1 });
  const ms2 = makeMachine('ms2', 'ss2', 10, { x: 8, requiredOperators: 1 });
  const w1 = makeWorker('w1', ['ss1', 'ss2'], { position: { x: 2, y: 0, z: 5 } });
  pSimple.layoutObjects = [ms1, ms2];
  pSimple.stages = [
    makeStage('ss1', ['ms1'], 10, { requiredWorkers: 1, successorIds: ['ss2'], bufferCapacity: 5 }),
    makeStage('ss2', ['ms2'], 10, { requiredWorkers: 1, predecessorIds: ['ss1'], bufferCapacity: 5 }),
  ];
  pSimple.workers = [w1];
  pSimple.products[0].routeStageIds = ['ss1', 'ss2'];

  const engConflict = new DiscreteEventSimulationEngine(pSimple);
  engConflict.advanceTo(5); // U1 active at ms1 with w1
  const privCon = cloneProjectForFaultInjection(engConflict);
  const jobAt1 = privCon.activeJobs.get('ms1')[0];
  // Inject a second active job on ms2 also claiming w1
  privCon.activeJobs.get('ms2').push({
    ...jobAt1,
    token: 9999,
    objectId: 'ms2',
    stageId: 'ss2',
  });
  privCon.objectStates.get('ms2').busyUnitIds.push(jobAt1.entityId);
  const aCon = engConflict.auditInvariants();
  assert.equal(aCon.ok, false);
  assert.ok(aCon.violations.some((v) => v.includes('[INV_WORKER_CONFLICT]')));

  // Stale worker allocation after job completion + status mismatch
  const engStaleW = new DiscreteEventSimulationEngine(pSimple);
  engStaleW.runToCompletion();
  const privSw = cloneProjectForFaultInjection(engStaleW);
  privSw.workerAllocatedEntity.set('w1', 'unit_1'); // unit_1 already completed!
  privSw.workerStates.get('w1').status = 'walking';
  const aSw = engStaleW.auditInvariants();
  assert.equal(aSw.ok, false);
  assert.ok(aSw.violations.some((v) => v.includes('[INV_WORKER_STALE_ALLOCATION]')));
  assert.ok(aSw.violations.some((v) => v.includes('[INV_WORKER_STATUS_MISMATCH]')));
});

// ============================================================================
// FINDING 4: CONVEYOR CAPACITY, HEADWAY, PAUSED STATE, & CONVEYOR-ONLY STAGES
// ============================================================================

test('Phase 2.1 [Finding 4]: Conveyor capacity, headway/pitch, unavailable transport, paused state consistency, and conveyor-only purity', () => {
  // 4A. Positive: Conveyor breakdown mid-transit + repair + restart + headway competition + conveyor-only stage
  const pConv = createBaseProject({
    durationSec: 100,
    arrivalIntervalSec: 1,
    maxPlannedUnits: 3,
    enableBreakdowns: true,
  });
  const cNode = makeMachine('cNode', 'sConv', 0, {
    kind: 'conveyor',
    x: 6,
    z: 5,
    length: 6.0, // physical cap floor(6.0 / 0.65) = 9
    speedMps: 1.0,
    productSpacingM: 0.15,
    failureModel: 'fixed',
    repairModel: 'fixed',
    mtbfSec: 4,
    mttrSec: 10,
  });
  pConv.layoutObjects = [cNode];
  pConv.stages = [makeStage('sConv', ['cNode'], 0, { bufferCapacity: 10 })];
  pConv.products[0].routeStageIds = ['sConv'];

  const engConv = new DiscreteEventSimulationEngine(pConv);
  let sawPausedTransit = false;
  while (engConv.stepNextEvent()) {
    const a = engConv.auditInvariants();
    assert.equal(a.ok, true, `ConvPhase2_1 at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    for (const tr of cloneProjectForFaultInjection(engConv).conveyorTransits.values()) {
      if (tr.paused) sawPausedTransit = true;
    }
  }
  assert.equal(sawPausedTransit, true, 'Must observe paused conveyor transit during breakdown');
  const convRes = engConv.buildResult();
  assert.equal(convRes.kpis.goodUnits, 3);
  assert.equal(convRes.kpis.avgProcessingTimeSec, 0);
  assert.equal(convRes.stageAnalytics[0].conveyorTransitTimeSec, 18);

  // 4B. Negative injection: corrupt pausedProgress on paused transit & unpaused transit on down conveyor
  const engBadPaused = new DiscreteEventSimulationEngine(pConv);
  engBadPaused.advanceTo(5); // during down [4..14]
  const privBp = cloneProjectForFaultInjection(engBadPaused);
  const firstTr = Array.from(privBp.conveyorTransits.values())[0] as any;
  assert.equal(firstTr.paused, true);
  firstTr.pausedProgress = 0.99; // corrupt mismatch with pausedAt!
  const aBp = engBadPaused.auditInvariants();
  assert.equal(aBp.ok, false);
  assert.ok(aBp.violations.some((v) => v.includes('[INV_CONVEYOR_PAUSED_STATE_INVALID]')));

  // Unpaused on down conveyor
  firstTr.paused = false;
  firstTr.pausedAt = undefined;
  firstTr.pausedProgress = undefined;
  firstTr.remainingTransitSec = undefined;
  firstTr.remainingBeforeStartSec = undefined;
  const aDownTr = engBadPaused.auditInvariants();
  assert.equal(aDownTr.ok, false);
  assert.ok(aDownTr.violations.some((v) => v.includes('[INV_CONVEYOR_UNAVAILABLE_TRANSIT]')));

  // 4C. Negative injection: conveyor occupancy overflow, occupancy mismatch, headway violation, artificial machine job on conveyor
  const pHead = createBaseProject({ durationSec: 40, arrivalIntervalSec: 0.2, maxPlannedUnits: 3 });
  const cShort = makeMachine('cShort', 'sShort', 0, {
    kind: 'conveyor',
    x: 4,
    z: 5,
    length: 1.3, // pitch = 0.5 + 0.15 = 0.65 -> physicalCap = 2
    speedMps: 1.0,
    productSpacingM: 0.15,
  });
  pHead.layoutObjects = [cShort];
  pHead.stages = [makeStage('sShort', ['cShort'], 0, { bufferCapacity: 10 })];
  pHead.products[0].routeStageIds = ['sShort'];

  const engHead = new DiscreteEventSimulationEngine(pHead);
  engHead.advanceTo(0.8); // U1 started at 0, U2 started at 0.65
  const privH = cloneProjectForFaultInjection(engHead);
  const activeTrs = Array.from(privH.conveyorTransits.values()) as any[];
  assert.ok(activeTrs.length === 2);
  // Corrupt U2 startTime to overlap U1 within headway < 0.65s
  activeTrs[1].startTime = activeTrs[0].startTime + 0.1;
  // Inject a 3rd entity onto cap=2 conveyor + mismatch occupancy
  const thirdConvEnt = {
    id: 'conv_overflow_3',
    productId: 'p1',
    serialNumber: 777,
    createdAt: 0.8,
    scrapped: false,
    reworkCount: 0,
    currentStageId: 'sShort',
    locationKind: 'conveyor',
    worldPosition: { x: 4, y: 1, z: 5 },
    waitingTimeSec: 0,
    processingTimeSec: 0,
    transportTimeSec: 0,
    batchCount: 1,
  };
  privH.entities.set(thirdConvEnt.id, thirdConvEnt);
  privH.activeEntities.set(thirdConvEnt.id, thirdConvEnt);
  privH.totalArrived += 1;
  privH.productReleasedCount.set('p1', (privH.productReleasedCount.get('p1') || 0) + 1);
  privH.objectStates.get('cShort').busyUnitIds.push(thirdConvEnt.id);
  privH.conveyorTransits.set(thirdConvEnt.id, {
    ...activeTrs[0],
    entityId: thirdConvEnt.id,
    startTime: 0.75,
    endTime: 2.05,
  });
  privH.conveyorOccupancy.set('cShort', 5); // mismatched (5 vs 3) AND > physical cap (2)!
  // Also inject artificial non-conveyor job onto conveyor-only stage
  privH.activeJobs.get('cShort').push({
    token: 8888,
    phase: 'processing',
    entityId: thirdConvEnt.id,
    stageId: 'sShort',
    objectId: 'cShort',
    workerIds: [],
    startedAt: 0.8,
    expectedEndAt: 5.0,
    remainingSec: 4.2,
    totalProcSec: 4.2,
    isConveyorNode: false,
  });

  const aHead = engHead.auditInvariants();
  assert.equal(aHead.ok, false);
  assert.ok(aHead.violations.some((v) => v.includes('[INV_CONVEYOR_HEADWAY_VIOLATION]')));
  assert.ok(aHead.violations.some((v) => v.includes('[INV_CONVEYOR_OCCUPANCY_MISMATCH]')));
  assert.ok(aHead.violations.some((v) => v.includes('[INV_CONVEYOR_OCCUPANCY_OVERFLOW]')));
  assert.ok(aHead.violations.some((v) => v.includes('[INV_CONVEYOR_ARTIFICIAL_PROCESSING]')));
});

// ============================================================================
// FINDING 5: MATERIAL CONSERVATION EXCLUSIVE PARTITION & CORRUPTION INJECTION
// ============================================================================

test('Phase 2.1 [Finding 5]: Exclusive material conservation across scrap, rework, batch carriers, unbatch, horizon cutoff, plus lost/duplicate/multi-loc faults', () => {
  // 5A. Complex pipeline verifying exact exclusive accounting across rework, scrap, batching, unbatching, & horizon WIP
  const pComplex = createBaseProject({ durationSec: 110, arrivalIntervalSec: 4, maxPlannedUnits: 10 });
  const mc1 = makeMachine('mc1', 'sc1', 3, { batchMode: 'collect_batch', batchSize: 4, x: 2 });
  const mc2 = makeMachine('mc2', 'sc2', 8, { x: 7 });
  const mc3 = makeMachine('mc3', 'sc3', 4, { batchMode: 'unbatch', batchSize: 4, x: 12 });
  pComplex.layoutObjects = [mc1, mc2, mc3];
  pComplex.stages = [
    makeStage('sc1', ['mc1'], 3, {
      batchMode: 'collect_batch',
      batchSize: 4,
      bufferCapacity: 8,
      successorIds: ['sc2'],
    }),
    makeStage('sc2', ['mc2'], 8, {
      scrapRate: 0.25,
      reworkProbability: 0.25,
      defectModel: 'unit',
      bufferCapacity: 8,
      predecessorIds: ['sc1'],
      successorIds: ['sc3'],
    }),
    makeStage('sc3', ['mc3'], 4, {
      batchMode: 'unbatch',
      batchSize: 4,
      bufferCapacity: 12,
      predecessorIds: ['sc2'],
    }),
  ];
  pComplex.products[0].routeStageIds = ['sc1', 'sc2', 'sc3'];

  const { audit: finalComp } = runWithStepInvariants(pComplex, 'ComplexMaterialConservation');
  assert.equal(finalComp.conservation.totalReleasedUnits, 10);
  assert.equal(finalComp.conservation.unaccountedUnits, 0);
  assert.ok(finalComp.conservation.absorbedChildEntities >= 8);

  // 5B. Verify rework intermediate active tracking (reworkedActiveUnits > 0 during active rework)
  const pRw = createBaseProject({ durationSec: 60, arrivalIntervalSec: 100, maxPlannedUnits: 1 });
  const mrw = makeMachine('mrw', 'srw', 10, { x: 2 });
  pRw.layoutObjects = [mrw];
  pRw.stages = [makeStage('srw', ['mrw'], 10, { reworkProbability: 1.0, bufferCapacity: 5 })];
  pRw.products[0].routeStageIds = ['srw'];
  const engRw = new DiscreteEventSimulationEngine(pRw);
  let sawActiveRework = false;
  while (engRw.stepNextEvent()) {
    const a = engRw.auditInvariants();
    assert.equal(a.ok, true, `ReworkConservation at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    if (a.conservation.reworkedActiveUnits > 0) sawActiveRework = true;
  }
  assert.equal(sawActiveRework, true, 'Must observe reworked active units cleanly tracked in conservation');
  assert.equal(engRw.buildResult().kpis.goodUnits, 1);

  // 5C. Negative injection 1: Lost unit (material conservation violation)
  const engLost = new DiscreteEventSimulationEngine(pComplex);
  engLost.advanceTo(40);
  const privL = cloneProjectForFaultInjection(engLost);
  const victim = Array.from(privL.activeEntities.values())[0] as any;
  assert.ok(victim);
  privL.entities.delete(victim.id);
  privL.activeEntities.delete(victim.id);
  // Also purge from stageBuffers / busyUnitIds so reference check is clean or check unaccountedUnits
  const aLost = engLost.auditInvariants();
  assert.equal(aLost.ok, false);
  assert.ok(aLost.violations.some((v) => v.includes('[INV_MATERIAL_CONSERVATION]')));

  // 5D. Negative injection 2: Phantom / double-counted completion & completed entity still in activeEntities
  const engDupComp = new DiscreteEventSimulationEngine(pComplex);
  engDupComp.runToCompletion();
  const privDc = cloneProjectForFaultInjection(engDupComp);
  privDc.completedCount += 1;
  const anyComp = Array.from(privDc.entities.values()).find((e: any) => e.completedAt !== undefined) as any;
  assert.ok(anyComp);
  privDc.activeEntities.set(anyComp.id, anyComp);
  const aDc = engDupComp.auditInvariants();
  assert.equal(aDc.ok, false);
  assert.ok(aDc.violations.some((v) => v.includes('[INV_MATERIAL_CONSERVATION]')));

  // 5E. Negative injection 3: Entity occupying multiple physical locations simultaneously (queue AND busyUnitIds)
  const engMultiLoc = new DiscreteEventSimulationEngine(pRw);
  engMultiLoc.advanceTo(5); // unit_1 is in mrw.busyUnitIds
  const privMl = cloneProjectForFaultInjection(engMultiLoc);
  privMl.stageBuffers.get('srw').push('unit_1');
  const aMl = engMultiLoc.auditInvariants();
  assert.equal(aMl.ok, false);
  assert.ok(aMl.violations.some((v) => v.includes('[INV_ENTITY_MULTI_LOCATION]')));
});

// ============================================================================
// FINDING 6: DEADLOCK DETECTION VS TEMPORARY BLOCKING, PURITY, & DETERMINISM
// ============================================================================

test('Phase 2.1 [Finding 6]: Circular deadlock detection (incl. multi-edge branches), non-cyclic temporary blocking, side-effect-free audit purity, and determinism', () => {
  // 6A. True circular deadlock S1 <-> S2 with bufferCapacity=0
  const pDead = createBaseProject({ durationSec: 60, arrivalIntervalSec: 1, maxPlannedUnits: 2 });
  const md1 = makeMachine('md1', 'sd1', 10, { x: 2 });
  const md2 = makeMachine('md2', 'sd2', 15, { x: 8 });
  pDead.layoutObjects = [md1, md2];
  pDead.stages = [
    makeStage('sd1', ['md1'], 10, { bufferCapacity: 0, predecessorIds: ['sd2'], successorIds: ['sd2'] }),
    makeStage('sd2', ['md2'], 15, { bufferCapacity: 0, predecessorIds: ['sd1'], successorIds: ['sd1'] }),
  ];
  pDead.products = [
    {
      ...pDead.products[0],
      id: 'p_dead1',
      routingMode: 'manual',
      targetQuantity: 1,
      entryStageIds: ['sd1'],
      routeStageIds: ['sd1', 'sd2'],
    },
    {
      ...pDead.products[0],
      id: 'p_dead2',
      code: 'SKU-2',
      routingMode: 'manual',
      targetQuantity: 1,
      entryStageIds: ['sd2'],
      routeStageIds: ['sd2', 'sd1'],
    },
  ];
  const { audit: deadAudit } = runWithStepInvariants(pDead, 'DeadlockCycle');
  assert.ok(deadAudit.deadlocks.length >= 1, 'Expected circular wait deadlock sd1 <-> sd2');
  assert.deepEqual([...deadAudit.deadlocks[0].stageIds].sort(), ['sd1', 'sd2']);

  // 6B. Multi-edge blockedOutbox branch: non-cyclic edge added first must NOT hide real cyclic edge from same stage!
  const engMultiEdge = new DiscreteEventSimulationEngine(pDead);
  engMultiEdge.advanceTo(5); // run partway, then inject extra non-cyclic blocked edge before sd1 -> sd2
  // Run to deadlock first, then prepend a non-cyclic stage sd3 edge from md1's outbox
  engMultiEdge.runToCompletion();
  const privMe = cloneProjectForFaultInjection(engMultiEdge);
  const md3 = makeMachine('md3', 'sd3', 10, { x: 14 });
  privMe.objectsMap.set('md3', md3);
  privMe.stagesMap.set('sd3', makeStage('sd3', ['md3'], 10, { bufferCapacity: 0 }));
  // Reconstruct blockedOutbox insertion order so non-cyclic target 'sd3' appears BEFORE cyclic 'sd2'
  const origEntries = Array.from(privMe.blockedOutbox.entries()) as Array<[string, any[]]>;
  privMe.blockedOutbox.clear();
  privMe.blockedOutbox.set('sd3', [{ entityId: 'unit_1', objectId: 'md1', nextStageId: 'sd3' }]);
  for (const [k, v] of origEntries) {
    privMe.blockedOutbox.set(k, v);
  }
  const meAudit = engMultiEdge.auditInvariants();
  assert.ok(
    meAudit.deadlocks.some((d) => d.stageIds.includes('sd1') && d.stageIds.includes('sd2')),
    'Multi-edge DFS must still find sd1 <-> sd2 deadlock even when non-cyclic sd1 -> sd3 is checked first'
  );

  // 6C. Temporary downstream blocking (non-cyclic) MUST report deadlocks.length === 0 & recover cleanly
  const pTempBlock = createBaseProject({ durationSec: 120, arrivalIntervalSec: 5, maxPlannedUnits: 4 });
  pTempBlock.simulationConfig.maintenanceWindows = [
    { id: 'mw_tb', name: 'Down S2', startSec: 12, durationSec: 25, objectId: 'mt2' },
  ];
  const mt1 = makeMachine('mt1', 'st1', 5, { x: 2 });
  const mt2 = makeMachine('mt2', 'st2', 10, { x: 8 });
  pTempBlock.layoutObjects = [mt1, mt2];
  pTempBlock.stages = [
    makeStage('st1', ['mt1'], 5, { bufferCapacity: 10, successorIds: ['st2'] }),
    makeStage('st2', ['mt2'], 10, { bufferCapacity: 0, predecessorIds: ['st1'] }),
  ];
  pTempBlock.products[0].routeStageIds = ['st1', 'st2'];
  const engTb = new DiscreteEventSimulationEngine(pTempBlock);
  let sawTemporaryBlock = false;
  while (engTb.stepNextEvent()) {
    const a = engTb.auditInvariants();
    assert.equal(a.ok, true, `TempBlock at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    assert.equal(a.deadlocks.length, 0, `Temporary blocking at t=${a.clockSec} must NOT report deadlock`);
    if (a.conservation.blockedAtStationUnits > 0) sawTemporaryBlock = true;
  }
  assert.equal(sawTemporaryBlock, true, 'Expected temporary station blocking during S2 maintenance');
  assert.equal(engTb.buildResult().kpis.goodUnits, 4, 'Must recover and complete all 4 units after maintenance');

  // 6D. Side-effect-free audit purity & deterministic seed repeatability
  const pPurity = createBaseProject({
    durationSec: 240,
    arrivalIntervalSec: 6,
    maxPlannedUnits: 12,
    enableBreakdowns: true,
    randomSeed: 7741,
  });
  const mp1 = makeMachine('mp1', 'sp1', 5, {
    x: 2,
    failureModel: 'exponential',
    repairModel: 'lognormal',
    mtbfSec: 35,
    mttrSec: 10,
    mttrStdDevSec: 3,
  });
  const cp1 = makeMachine('cp1', '', 0, {
    kind: 'conveyor',
    x: 6,
    z: 5,
    length: 6,
    speedMps: 1.5,
    productSpacingM: 0.2,
  });
  const mp2 = makeMachine('mp2', 'sp2', 7, { x: 10, scrapRate: 0.1 } as any);
  pPurity.layoutObjects = [mp1, cp1, mp2];
  pPurity.stages = [
    makeStage('sp1', ['mp1'], 5, { conveyorObjectId: 'cp1', successorIds: ['sp2'], bufferCapacity: 6 }),
    makeStage('sp2', ['mp2'], 7, {
      conveyorObjectId: 'cp1',
      predecessorIds: ['sp1'],
      scrapRate: 0.1,
      reworkProbability: 0.15,
      bufferCapacity: 6,
    }),
  ];
  pPurity.products[0].routeStageIds = ['sp1', 'sp2'];

  // Baseline run with ZERO auditInvariants() calls
  const engBaseline = new DiscreteEventSimulationEngine(pPurity);
  const resBaseline = engBaseline.runToCompletion();
  const eventsBaseline = engBaseline.getAllEvents();

  // Audited run calling auditInvariants() after EVERY event step
  const engAudited = new DiscreteEventSimulationEngine(pPurity);
  const stepAudits: string[] = [];
  while (engAudited.stepNextEvent()) {
    const a = engAudited.auditInvariants();
    assert.equal(a.ok, true, `Purity run step at t=${a.clockSec}: ${a.violations.join(' | ')}`);
    stepAudits.push(JSON.stringify(a));
  }
  const resAudited = engAudited.buildResult();
  const eventsAudited = engAudited.getAllEvents();

  assert.deepEqual(resAudited.kpis, resBaseline.kpis, 'Calling auditInvariants() at every step must NOT alter KPIs');
  assert.deepEqual(eventsAudited, eventsBaseline, 'Calling auditInvariants() at every step must NOT alter SimEvent[]');

  // Second audited run must be bit-identical
  const engRepeat = new DiscreteEventSimulationEngine(pPurity);
  const repeatAudits: string[] = [];
  while (engRepeat.stepNextEvent()) {
    repeatAudits.push(JSON.stringify(engRepeat.auditInvariants()));
  }
  assert.deepEqual(repeatAudits, stepAudits, 'Seed determinism must produce identical audit snapshots across runs');
});
