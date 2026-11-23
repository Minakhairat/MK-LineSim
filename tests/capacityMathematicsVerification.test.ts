import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBatchRunPlan,
  computeShiftAdjustedStageCapacity,
  computeStageCapacityProfile,
  resolveStageEquipmentBreakdown,
} from '../src/engineering/capacityEngine';
import {
  computeConveyorPathTimeSec,
  evaluateConveyorPhysics,
} from '../src/engineering/conveyorPhysics';
import { auditProjectTiming } from '../src/simulation/timeAuditService';
import {
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
} from '../src/types/project';

interface VerificationRecord {
  caseName: string;
  inputs: Record<string, unknown>;
  derivation: string;
  expected: number;
  actual: number;
  absError: number;
  relError: number;
}

function assertAnalyticalMatch(
  caseName: string,
  inputs: Record<string, unknown>,
  derivation: string,
  expected: number,
  actual: number,
  tolerance = 1e-9
): VerificationRecord {
  assert.ok(Number.isFinite(actual), `[${caseName}] Actual value must be finite, got ${actual}`);
  const absError = Math.abs(actual - expected);
  const relError = expected !== 0 ? absError / Math.abs(expected) : absError;
  assert.ok(
    absError <= tolerance,
    `[${caseName}] Derivation: ${derivation} | Expected=${expected}, Actual=${actual}, AbsError=${absError}, RelError=${relError}`
  );
  return { caseName, inputs, derivation, expected, actual, absError, relError };
}

function makeMachine(
  id: string,
  stageId: string,
  procSec: number,
  opts?: Partial<LayoutObject['operations']> & { kind?: LayoutObject['kind']; visible?: boolean }
): LayoutObject {
  const kind = opts?.kind ?? 'machine';
  return {
    id,
    name: id,
    kind,
    category: kind === 'workstation' ? 'workstation' : 'cnc_machine',
    templateId: `tpl_${kind}`,
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 1.2 },
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
      shiftId: opts?.shiftId,
      batchSize: opts?.batchSize,
      batchMode: opts?.batchMode,
      batchTransferTimeSec: opts?.batchTransferTimeSec,
    },
    rendering: {
      color: '#334155',
      visible: opts?.visible ?? true,
      locked: false,
      layer: 'equipment',
    },
  };
}

function makeConveyor(
  id: string,
  lengthM: number,
  widthM: number,
  speedMps: number,
  spacingM = 0.15,
  declaredCap = 0
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conv',
    connectedToIds: [],
    geometry: {
      position: { x: 8, y: 0, z: 5 },
      dimensions: { length: lengthM, width: widthM, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.2,
    },
    operations: {
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: declaredCap,
      availability: 1,
      requiredOperators: 0,
      speedMps,
      productSpacingM: spacingM,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
  };
}

function makeProduct(lengthM: number, widthM: number): ProductDefinition {
  return {
    id: 'prod_ref',
    code: 'REF-1',
    name: 'Reference Unit',
    category: 'Standard',
    dimensions: { length: lengthM, width: widthM, height: 0.3 },
    weightKg: 2.5,
    color: '#2563EB',
    targetQuantity: 0,
    routeStageIds: [],
    modelShape: 'box',
    routingMode: 'auto',
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
    name: id,
    description: '',
    processingTimeSec: procSec,
    setupTimeSec: opts?.setupTimeSec ?? 0,
    loadingTimeSec: opts?.loadingTimeSec ?? 0,
    unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
    requiredWorkers: opts?.requiredWorkers ?? 0,
    requiredMachines: opts?.requiredMachines ?? 1,
    inputQty: 1,
    outputQty: 1,
    scrapRate: 0,
    reworkProbability: 0,
    bufferCapacity: opts?.bufferCapacity ?? 10,
    predecessorIds: opts?.predecessorIds ?? [],
    successorIds: opts?.successorIds ?? [],
    assignedObjectIds,
    batchSize: opts?.batchSize,
    batchMode: opts?.batchMode,
    batchTransferTimeSec: opts?.batchTransferTimeSec,
  };
}

function makeProject(
  objects: LayoutObject[],
  stages: ProductionStage[],
  overrides?: Partial<ProjectData['simulationConfig']>
): ProjectData {
  const durationSec = overrides?.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'proj_cap_math',
    name: 'Capacity Math Verification',
    factoryName: 'Verification Plant',
    industryType: 'Manufacturing',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    factory: {
      name: 'Hall',
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
    products: [makeProduct(0.35, 0.35)],
    stages,
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec,
      arrivalIntervalSec: 10,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 1,
      shifts: [{ id: 's1', name: 'Shift 1', startSec: 0, durationSec, breaks: [] }],
      maintenanceWindows: [],
      ...overrides,
    },
    scenarios: [],
  };
}

test('Req 1: Single processing machine analytical reference verification (60s -> 60 u/hr; proc+load+unload)', () => {
  const m1 = makeMachine('m1', 'st1', 60);
  const st1 = makeStage('st1', ['m1'], 60);
  const p1 = computeStageCapacityProfile(st1, [m1]);

  assert.equal(p1.isValid, true);
  assert.equal(p1.physicalProcessingServersCount, 1);
  assert.equal(p1.virtualServerCount, 0);
  assertAnalyticalMatch(
    'Single machine 60s capacity',
    { processingTimeSec: 60, capacity: 1 },
    'C = 3600 / 60 = 60 units/hr',
    60,
    p1.theoreticalCapacityPerHour
  );
  assertAnalyticalMatch(
    'Single machine 60s unit cycle',
    { processingTimeSec: 60, capacity: 1 },
    't_eff = 60 / 1 = 60 s/unit',
    60,
    p1.effectiveUnitCycleSec
  );

  // With loading + unloading: 40s proc + 12s load + 8s unload = 60s -> 60 u/hr
  const m2 = makeMachine('m2', 'st2', 40, { loadingTimeSec: 12, unloadingTimeSec: 8 });
  const st2 = makeStage('st2', ['m2'], 40, { loadingTimeSec: 12, unloadingTimeSec: 8 });
  const p2 = computeStageCapacityProfile(st2, [m2]);
  assertAnalyticalMatch(
    'Single machine proc+load+unload=60s capacity',
    { proc: 40, load: 12, unload: 8, capacity: 1 },
    't_base = 40 + 12 + 8 = 60 s -> C = 3600 / 60 = 60 units/hr',
    60,
    p2.theoreticalCapacityPerHour
  );
});

test('Req 2: Identical parallel machines analytical reference verification (2x60s -> 120 u/hr; multi-slot workstation)', () => {
  const m1 = makeMachine('m1', 'st1', 60);
  const m2 = makeMachine('m2', 'st1', 60);
  const st1 = makeStage('st1', ['m1', 'm2'], 60);
  const profile = computeStageCapacityProfile(st1, [m1, m2]);

  assert.equal(profile.isHeterogeneous, false);
  assert.equal(profile.parallelServers, 2);
  assertAnalyticalMatch(
    '2 identical 60s machines capacity',
    { machineA_sec: 60, machineB_sec: 60 },
    'C = (3600 / 60) + (3600 / 60) = 60 + 60 = 120 units/hr',
    120,
    profile.theoreticalCapacityPerHour
  );
  assertAnalyticalMatch(
    '2 identical 60s machines effective cycle',
    { machineA_sec: 60, machineB_sec: 60 },
    't_eff = 3600 / 120 = 30 s/unit',
    30,
    profile.effectiveUnitCycleSec
  );

  // Single workstation with capacity = 2 slots at 60s each -> 120 u/hr
  const ws = makeMachine('ws1', 'st2', 60, { kind: 'workstation', capacity: 2 });
  const st2 = makeStage('st2', ['ws1'], 60);
  const pWs = computeStageCapacityProfile(st2, [ws]);
  assertAnalyticalMatch(
    'Single 2-slot workstation 60s capacity',
    { slots: 2, cycleSec: 60 },
    'C = 2 * (3600 / 60) = 120 units/hr',
    120,
    pWs.theoreticalCapacityPerHour
  );
});

test('Req 3: Heterogeneous parallel machines sum individual rates (60s + 30s -> 180 u/hr, 20s effective cycle)', () => {
  // Case A: Stage carries stale Machine A cycle (60s) while Machine B runs 30s
  const mA = makeMachine('mA', 'st_het', 60, { capacity: 1 });
  const mB = makeMachine('mB', 'st_het', 30, { capacity: 1 });
  const stWithFirstTime = makeStage('st_het', ['mA', 'mB'], 60);
  const profA = computeStageCapacityProfile(stWithFirstTime, [mA, mB]);

  assert.equal(profA.isHeterogeneous, true);
  assert.equal(profA.serverProfiles.length, 2);
  assertAnalyticalMatch(
    'Heterogeneous 60s + 30s capacity (stage=60s)',
    { mA_sec: 60, mB_sec: 30, stageProcSec: 60 },
    'C = (3600 / 60) + (3600 / 30) = 60 + 120 = 180 units/hr',
    180,
    profA.theoreticalCapacityPerHour
  );
  assertAnalyticalMatch(
    'Heterogeneous 60s + 30s effective cycle',
    { mA_sec: 60, mB_sec: 30 },
    't_eff = (1/60 + 1/30)^-1 = 3600 / 180 = 20 s/unit',
    20,
    profA.effectiveUnitCycleSec
  );

  // Case B: Stage has 0s processing time and machines differ with slot capacities and load/unload
  // m1: (60 + 10) = 70s, cap=1 -> 3600/70 = 51.4285714286 u/hr
  // m2: (30 + 5) = 35s, cap=2 -> 2 * 3600/35 = 205.7142857143 u/hr
  // Total = 257.1428571429 u/hr -> effectiveUnitCycle = 3600 / (1800/7) = 14s
  const m1 = makeMachine('m1', 'st_het2', 60, { loadingTimeSec: 10, capacity: 1 });
  const m2 = makeMachine('m2', 'st_het2', 30, { unloadingTimeSec: 5, capacity: 2 });
  const stZero = makeStage('st_het2', ['m1', 'm2'], 0);
  const profB = computeStageCapacityProfile(stZero, [m1, m2]);

  const expectedCap = 3600 / 70 + (2 * 3600) / 35;
  assertAnalyticalMatch(
    'Heterogeneous multi-slot load/unload capacity',
    { m1: '60+10s x1', m2: '30+5s x2' },
    'C = 3600/70 + 2*(3600/35) = 1800/7 = 257.142857 units/hr',
    expectedCap,
    profB.theoreticalCapacityPerHour,
    1e-9
  );
  assertAnalyticalMatch(
    'Heterogeneous multi-slot effective cycle',
    { m1: '70s x1', m2: '35s x2' },
    't_eff = 3600 / (1800/7) = 14 s/unit',
    14,
    profB.effectiveUnitCycleSec,
    1e-9
  );
});

test('Req 4: Sequential stations bottleneck & line balance efficiency (20s, 40s, 30s -> 90 u/hr, 75%, conveyor-stage non-dilution)', () => {
  const m1 = makeMachine('m1', 'st1', 20);
  const m2 = makeMachine('m2', 'st2', 40);
  const m3 = makeMachine('m3', 'st3', 30);
  const st1 = makeStage('st1', ['m1'], 20, { successorIds: ['st2'] });
  const st2 = makeStage('st2', ['m2'], 40, { predecessorIds: ['st1'], successorIds: ['st3'] });
  const st3 = makeStage('st3', ['m3'], 30, { predecessorIds: ['st2'] });

  const proj = makeProject([m1, m2, m3], [st1, st2, st3]);
  const audit = auditProjectTiming(proj, 3600);

  assert.equal(audit.bottleneckStageId, 'st2');
  assertAnalyticalMatch(
    'Sequential 3-station line bottleneck capacity',
    { cycles: [20, 40, 30] },
    'min(180, 90, 120) = 90 u/hr at Station 2 (40s)',
    90,
    audit.theoreticalHourlyCapacity
  );
  assertAnalyticalMatch(
    'Sequential 3-station line balance efficiency',
    { cycles: [20, 40, 30], bottleneck: 40 },
    'Balance = (20 + 40 + 30) / (3 * 40) * 100 = 75%',
    75,
    audit.lineBalanceEfficiencyPct
  );

  // RISK-03 regression: adding a conveyor-only stage with manual task time must NOT push 0 into balance efficiency
  const conv = makeConveyor('c1', 6, 0.8, 1.0, 0.15);
  const stConv = makeStage('st_conv', ['c1'], 15);
  const auditWithConv = auditProjectTiming(
    makeProject([m1, m2, m3, conv], [st1, st2, st3, stConv]),
    3600
  );
  assertAnalyticalMatch(
    'Line balance unaffected by conveyor-only stage (RISK-03)',
    { cycles: [20, 40, 30], conveyorStageProc: 15 },
    'Conveyor-only effectiveUnitCycleSec=0 excluded -> Balance stays 75%',
    75,
    auditWithConv.lineBalanceEfficiencyPct
  );
});

test('Req 5: Independent conveyor transportation capacity & invalid physical input rejection', () => {
  const conv = makeConveyor('c1', 10, 0.8, 1.0, 0.15);
  const prod = makeProduct(0.35, 0.35);
  const m = evaluateConveyorPhysics(conv, prod);

  assert.equal(m.isValid, true);
  assert.equal(m.canFit, true);
  assertAnalyticalMatch(
    'Conveyor pitch',
    { prodLen: 0.35, spacing: 0.15 },
    'pitch = 0.35 + 0.15 = 0.5 m',
    0.5,
    m.pitchM
  );
  assertAnalyticalMatch(
    'Conveyor capacity per minute',
    { speedMps: 1.0, pitchM: 0.5 },
    'headway = 0.5 / 1.0 = 0.5 s -> C_min = 60 / 0.5 = 120 u/min',
    120,
    m.transportCapacityPerMin
  );
  assertAnalyticalMatch(
    'Conveyor capacity per hour',
    { speedMps: 1.0, pitchM: 0.5 },
    'C_hr = 3600 / 0.5 = 7200 u/hr',
    7200,
    m.transportCapacityPerHour
  );

  // Zero product spacing is valid physical end-to-end contact
  const touchConv = makeConveyor('c_touch', 5, 0.8, 1.0, 0);
  const touchProd = makeProduct(0.5, 0.4);
  const mTouch = evaluateConveyorPhysics(touchConv, touchProd);
  assert.equal(mTouch.isValid, true);
  assertAnalyticalMatch(
    'Conveyor zero spacing capacity per min',
    { speedMps: 1.0, prodLen: 0.5, spacing: 0 },
    'pitch = 0.5 + 0 = 0.5 m -> 60 / (0.5 / 1.0) = 120 u/min',
    120,
    mTouch.transportCapacityPerMin
  );

  // Invalid inputs MUST NOT silently coerce to 0.001 m/s or 0.01m and emit fake capacity
  const invalidSpeed = makeConveyor('c_bad_spd', 10, 0.8, 0, 0.15);
  const rBadSpd = evaluateConveyorPhysics(invalidSpeed, prod);
  assert.equal(rBadSpd.isValid, false);
  assert.equal(rBadSpd.canFit, false);
  assert.equal(rBadSpd.transportCapacityPerMin, 0);
  assert.equal(rBadSpd.transportCapacityPerHour, 0);
  assert.equal(rBadSpd.physicalCapacity, 0);
  assert.equal(rBadSpd.fitErrorCode, 'INVALID_CONVEYOR_SPEED');

  const negSpeed = makeConveyor('c_neg_spd', 10, 0.8, -1.5, 0.15);
  assert.equal(evaluateConveyorPhysics(negSpeed, prod).transportCapacityPerHour, 0);
  assert.equal(computeConveyorPathTimeSec(10, 0), 0);
  assert.equal(computeConveyorPathTimeSec(10, -2), 0);

  const negSpacing = makeConveyor('c_neg_sp', 10, 0.8, 1.0, -0.1);
  const rBadSpacing = evaluateConveyorPhysics(negSpacing, prod);
  assert.equal(rBadSpacing.isValid, false);
  assert.equal(rBadSpacing.fitErrorCode, 'INVALID_PRODUCT_SPACING');
  assert.equal(rBadSpacing.transportCapacityPerMin, 0);

  const badBelt = makeConveyor('c_bad_belt', 0, 0.8, 1.0, 0.15);
  assert.equal(evaluateConveyorPhysics(badBelt, prod).isValid, false);
  assert.equal(evaluateConveyorPhysics(badBelt, prod).transportCapacityPerHour, 0);

  const badProd = makeProduct(-0.4, 0.35);
  assert.equal(evaluateConveyorPhysics(conv, badProd).isValid, false);
  assert.equal(evaluateConveyorPhysics(conv, badProd).physicalCapacity, 0);
});

test('Req 6: Virtual workstations, unassigned stages, and non-processing stages never masquerade as physical capacity', () => {
  // 1. Physical machine
  const mPhys = makeMachine('m1', 'st_phys', 60);
  const stPhys = makeStage('st_phys', ['m1'], 60);
  const profPhys = computeStageCapacityProfile(stPhys, [mPhys]);
  assert.equal(profPhys.stageAssignmentMode, 'physical_machines');
  assert.equal(profPhys.isVirtual, false);
  assert.equal(profPhys.physicalProcessingServersCount, 1);
  assert.equal(profPhys.virtualServerCount, 0);
  assertAnalyticalMatch(
    'Physical stage physicalCapacityPerHour',
    { type: 'physical', cycle: 60 },
    'physical = 60 u/hr, virtual = 0 u/hr',
    60,
    profPhys.physicalCapacityPerHour
  );
  assert.equal(profPhys.virtualCapacityPerHour, 0);

  // 2. Virtual workstation (unassigned stage with requiredMachines=2 & proc=60s)
  const stVirt = makeStage('st_virt', [], 60, { requiredMachines: 2 });
  const profVirt = computeStageCapacityProfile(stVirt, []);
  assert.equal(profVirt.stageAssignmentMode, 'virtual_workstation');
  assert.equal(profVirt.isVirtual, true);
  assert.equal(profVirt.isUnassigned, true);
  assert.equal(profVirt.physicalProcessingServersCount, 0);
  assert.equal(profVirt.physicalCapacityPerHour, 0);
  assert.equal(profVirt.virtualServerCount, 2);
  assertAnalyticalMatch(
    'Virtual stage virtualCapacityPerHour',
    { requiredMachines: 2, cycle: 60, assigned: 0 },
    'virtual = 2 * (3600 / 60) = 120 u/hr; physical = 0 u/hr',
    120,
    profVirt.virtualCapacityPerHour
  );

  // 3. Synthetic hidden virt_* workstation object
  const virtObj = makeMachine('virt_st_virt', 'st_virt', 60, { kind: 'workstation', capacity: 2, visible: false });
  const profVirtObj = computeStageCapacityProfile(stVirt, [virtObj]);
  assert.equal(profVirtObj.isVirtual, true);
  assert.equal(profVirtObj.physicalProcessingServersCount, 0);
  assert.equal(profVirtObj.physicalCapacityPerHour, 0);
  assert.equal(profVirtObj.virtualCapacityPerHour, 120);

  // 4. Line with 1 physical stage + 1 virtual stage must report physicalHourlyCapacity = 0
  const mixedAudit = auditProjectTiming(makeProject([mPhys], [stPhys, stVirt]), 3600);
  assert.equal(mixedAudit.hasVirtualStages, true);
  assert.deepEqual(mixedAudit.virtualStageIds, ['st_virt']);
  assert.equal(mixedAudit.physicalHourlyCapacity, 0);
  assertAnalyticalMatch(
    'Mixed physical+virtual analytical rate vs physical equipment rate',
    { phys: '60 u/hr', virt: '120 u/hr' },
    'Analytical line cap = min(60, 120) = 60 u/hr while physicalHourlyCapacity = 0',
    60,
    mixedAudit.theoreticalHourlyCapacity
  );

  // 5. Unassigned with requiredMachines = 0 -> 0 capacity (never fabricates 1 machine!)
  const stZeroReq = makeStage('st_zero', [], 60, { requiredMachines: 0 });
  const profZeroReq = computeStageCapacityProfile(stZeroReq, []);
  assert.equal(profZeroReq.stageAssignmentMode, 'unassigned');
  assert.equal(profZeroReq.parallelServers, 0);
  assert.equal(profZeroReq.theoreticalCapacityPerHour, 0);

  // 6. Explicit non-processing stage (taskTime = 0)
  const stNonProc = makeStage('st_nop', [], 0, { requiredMachines: 1 });
  const profNonProc = computeStageCapacityProfile(stNonProc, []);
  assert.equal(profNonProc.stageAssignmentMode, 'non_processing');
  assert.equal(profNonProc.isNonProcessing, true);
  assert.equal(profNonProc.parallelServers, 0);
  assert.equal(profNonProc.theoreticalCapacityPerHour, 0);
});

test('Req 7: Batch modes (single, collect_batch, unbatch), batchTransferTimeSec, batches/hr & partial end-of-run batches', () => {
  // collect_batch: B=4, proc=30s, batchTransferTimeSec=10s -> batchCycle=40s -> 90 batches/hr -> 360 u/hr -> t_unit=10s
  const mBatch = makeMachine('mb', 'st_b', 30, {
    batchSize: 4,
    batchMode: 'collect_batch',
    batchTransferTimeSec: 10,
  });
  const stBatch = makeStage('st_b', ['mb'], 30, {
    batchSize: 4,
    batchMode: 'collect_batch',
    batchTransferTimeSec: 10,
  });
  const profBatch = computeStageCapacityProfile(stBatch, [mBatch]);

  assert.equal(profBatch.effectiveBatchDivisor, 4);
  assertAnalyticalMatch(
    'collect_batch batches per hour',
    { proc: 30, transfer: 10, batchSize: 4 },
    'batchCycle = 30 + 10 = 40 s -> C_batch = 3600 / 40 = 90 batches/hr',
    90,
    profBatch.theoreticalBatchCapacityPerHour
  );
  assertAnalyticalMatch(
    'collect_batch units per hour',
    { proc: 30, transfer: 10, batchSize: 4 },
    'C_unit = 90 * 4 = 360 units/hr',
    360,
    profBatch.theoreticalCapacityPerHour
  );
  assertAnalyticalMatch(
    'collect_batch effective unit cycle',
    { batchCycle: 40, batchSize: 4 },
    't_unit = 40 / 4 = 10 s/unit',
    10,
    profBatch.effectiveUnitCycleSec
  );

  // unbatch: carrier size=4, proc=40s, transfer=10s ignored -> divisor=1, 90 u/hr
  const mUnbatch = makeMachine('mu', 'st_u', 40, {
    batchSize: 4,
    batchMode: 'unbatch',
    batchTransferTimeSec: 10,
  });
  const stUnbatch = makeStage('st_u', ['mu'], 40, {
    batchSize: 4,
    batchMode: 'unbatch',
    batchTransferTimeSec: 10,
  });
  const profUnbatch = computeStageCapacityProfile(stUnbatch, [mUnbatch]);
  assert.equal(profUnbatch.effectiveBatchDivisor, 1);
  assert.equal(profUnbatch.batchTransferTimeSec, 0);
  assertAnalyticalMatch(
    'unbatch units per hour',
    { proc: 40, staleTransfer: 10, carrierSize: 4 },
    'C_unit = 3600 / 40 = 90 units/hr (1 unit/cycle)',
    90,
    profUnbatch.theoreticalCapacityPerHour
  );

  // Partial end-of-run batch with finite plannedUnits = 10, batchSize = 4, 3600s horizon
  const flushPlan = computeBatchRunPlan(profBatch, {
    netAvailableTimeSec: 3600,
    plannedUnits: 10,
    flushPartialBatch: true,
  });
  assert.equal(flushPlan.fullBatches, 2);
  assert.equal(flushPlan.partialBatchUnits, 2);
  assert.equal(flushPlan.hasPartialBatch, true);
  assertAnalyticalMatch(
    'Partial batch flushed executed batches (10 units, B=4)',
    { plannedUnits: 10, batchSize: 4, flushPartialBatch: true },
    'ceil(10 / 4) = 2 full + 1 partial = 3 batches',
    3,
    flushPlan.totalBatchesExecuted
  );
  assert.equal(flushPlan.completedUnits, 10);
  assert.equal(flushPlan.unbatchedRemainderUnits, 0);

  // Strict full-batch only (flushPartialBatch = false): 2 full batches (8 units), 2 stranded
  const strictPlan = computeBatchRunPlan(profBatch, {
    netAvailableTimeSec: 3600,
    plannedUnits: 10,
    flushPartialBatch: false,
  });
  assert.equal(strictPlan.totalBatchesExecuted, 2);
  assert.equal(strictPlan.completedUnits, 8);
  assert.equal(strictPlan.unbatchedRemainderUnits, 2);

  // Time-bounded discrete batch truncation (3590s @ 40s batch cycle = 89 full batches = 356 units)
  const timePlan = computeBatchRunPlan(profBatch, { netAvailableTimeSec: 3590 });
  assertAnalyticalMatch(
    'Time-bounded discrete batches in 3590s',
    { netSec: 3590, batchCycleSec: 40 },
    'floor(3590 / 40) = 89 full batches (356 units)',
    89,
    timePlan.maxFullBatchesInTime
  );
  assert.equal(timePlan.maxUnitsInFullBatchesInTime, 356);
});

test('Req 8: Stage capacity (proc+load+unload, setup, shift-adjusted capacity, no double-counting, invalid input guard)', () => {
  // 2 parallel machines: 30s proc + 10s load + 20s unload = 60s cycle, setup = 600s
  // Over 3600s net scheduled shift: each machine has 3600 - 600 = 3000s prod -> 2 * (3000/60) = 100 units
  const m1 = makeMachine('m1', 'st1', 30, { loadingTimeSec: 10, unloadingTimeSec: 20, setupTimeSec: 600 });
  const m2 = makeMachine('m2', 'st1', 30, { loadingTimeSec: 10, unloadingTimeSec: 20, setupTimeSec: 600 });
  const st1 = makeStage('st1', ['m1', 'm1', 'm2', 'm1'], 30, {
    loadingTimeSec: 10,
    unloadingTimeSec: 20,
    setupTimeSec: 600,
  });

  // Duplicate IDs must not double count
  const breakdown = resolveStageEquipmentBreakdown(st1, [m1, m1, m2, m1]);
  assert.equal(breakdown.processingServerCount, 2);

  const profile = computeStageCapacityProfile(st1, [m1, m1, m2, m1]);
  assertAnalyticalMatch(
    'Nominal parallel capacity with proc+load+unload & dedup',
    { proc: 30, load: 10, unload: 20, duplicateInputIds: 4, uniqueMachines: 2 },
    'C_nom = 2 * (3600 / (30 + 10 + 20)) = 120 units/hr',
    120,
    profile.theoreticalCapacityPerHour
  );

  const shiftCap = computeShiftAdjustedStageCapacity(profile, {
    netScheduledTimeSec: 3600,
    setupOccurrences: 1,
  });
  assertAnalyticalMatch(
    'Shift-adjusted capacity after setup deduction',
    { scheduledSec: 3600, setupPerMachine: 600, cycleSec: 60, machines: 2 },
    'Q_shift = 2 * ((3600 - 600) / 60) = 100 units/shift',
    100,
    shiftCap.shiftAdjustedCapacityUnits
  );
  assertAnalyticalMatch(
    'Shift-adjusted effective hourly rate',
    { Q_shift: 100, scheduledHours: 1 },
    'C_shift_hr = 100 / 1 = 100 units/hr',
    100,
    shiftCap.shiftAdjustedHourlyCapacity
  );

  // Cross-stage shared machine detection in auditProjectTiming (zero silent double-counting across stages)
  const sharedAudit = auditProjectTiming(
    makeProject(
      [m1],
      [
        makeStage('s_a', ['m1'], 30, { loadingTimeSec: 10, unloadingTimeSec: 20 }),
        makeStage('s_b', ['m1'], 30, { loadingTimeSec: 10, unloadingTimeSec: 20 }),
      ]
    ),
    3600
  );
  assert.equal(sharedAudit.hasSharedResources, true);
  assert.deepEqual(sharedAudit.sharedResourceIds, ['m1']);

  // Invalid physical inputs in capacity engine MUST return 0 capacity and isValid = false
  const zeroCapMachine = makeMachine('m_zero', 'st_bad', 30, { capacity: 0 });
  const profZeroCap = computeStageCapacityProfile(makeStage('st_bad', ['m_zero'], 30), [zeroCapMachine]);
  assert.equal(profZeroCap.isValid, false);
  assert.equal(profZeroCap.theoreticalCapacityPerHour, 0);

  const negProcStage = makeStage('st_neg', ['m1'], -30, { loadingTimeSec: 10 });
  const profNegProc = computeStageCapacityProfile(negProcStage, [m1]);
  assert.equal(profNegProc.isValid, false);
  assert.equal(profNegProc.theoreticalCapacityPerHour, 0);

  const badBatchStage = makeStage('st_bad_b', ['m1'], 30, { batchMode: 'collect_batch', batchSize: -4 });
  const profBadBatch = computeStageCapacityProfile(badBatchStage, [m1]);
  assert.equal(profBadBatch.isValid, false);
  assert.equal(profBadBatch.theoreticalCapacityPerHour, 0);
});
