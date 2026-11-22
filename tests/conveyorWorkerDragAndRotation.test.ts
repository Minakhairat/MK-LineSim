import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignWorkerToConveyorSegmentInDraft,
  computeConveyorSegmentPlacement,
  findConveyorSegmentAtPoint,
  getConveyorSegmentCount,
  normalizeRotationDeg,
  unassignWorkerFromConveyorInDraft,
} from '../src/engineering/conveyorWorkerAssignment';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { validateProject } from '../src/simulation/validator';
import { migrateProjectSchema } from '../src/storage/indexedDb';
import { ProjectData } from '../src/types/project';

test('normalizeRotationDeg wraps arbitrary angles cleanly into [-180, 180]', () => {
  assert.equal(normalizeRotationDeg(0), 0);
  assert.equal(normalizeRotationDeg(-0), 0);
  assert.equal(normalizeRotationDeg(270), -90);
  assert.equal(normalizeRotationDeg(-270), 90);
  assert.equal(normalizeRotationDeg(450), 90);
});

test('Conveyor segment placement positions worker perpendicular to segment & facing belt', () => {
  const project = createDesertAirCoolerProject();
  const conv = project.layoutObjects.find((o) => o.kind === 'conveyor');
  assert.ok(conv, 'Sample project must include a conveyor');

  const segCount = getConveyorSegmentCount(conv);
  assert.ok(segCount >= 2, 'Conveyor must split into at least 2 logical segments');

  const p0 = computeConveyorSegmentPlacement(conv, 0, segCount, 1);
  const pLast = computeConveyorSegmentPlacement(conv, segCount - 1, segCount, 1);

  assert.notDeepEqual(p0.position, pLast.position);
  assert.equal(p0.segmentIndex, 0);
  assert.equal(pLast.segmentIndex, segCount - 1);

  // Dropping over segment endpoints resolves back to matching segments
  const hit0 = findConveyorSegmentAtPoint(project.layoutObjects, p0.beltPoint.x, p0.beltPoint.z);
  const hitLast = findConveyorSegmentAtPoint(project.layoutObjects, pLast.beltPoint.x, pLast.beltPoint.z);
  assert.ok(hit0);
  assert.ok(hitLast);
  assert.equal(hit0.conveyor.id, conv.id);
  assert.equal(hit0.segmentIndex, 0);
  assert.equal(hitLast.segmentIndex, segCount - 1);
});

test('Assigning worker to conveyor segment sets assignedTo, rotation, and tracks interaction in DES', () => {
  const base = createDesertAirCoolerProject();
  // Create a clean single-conveyor test scenario where a worker inspects/works on segment 2
  const draft: ProjectData = structuredClone(base);
  const conv = draft.layoutObjects.find((o) => o.kind === 'conveyor')!;
  const worker = draft.workers[0]!;

  // Remove unrelated assignment first
  unassignWorkerFromConveyorInDraft(draft, worker.id);
  worker.assignedStageIds = [];
  assert.equal(worker.assignedTo, undefined);
  assert.equal(worker.assignedStationId, undefined);
  assert.equal(worker.assignedConveyorSegment, undefined);

  // Drop onto segment index 1 of conveyor
  const segCount = getConveyorSegmentCount(conv);
  const ok = assignWorkerToConveyorSegmentInDraft(draft, worker.id, conv.id, 1, segCount, 1);
  assert.equal(ok, true);

  // Verify explicit assignedTo & rotation fields plus synchronized legacy fields
  const assignedWorker = draft.workers[0]!;
  assert.equal(assignedWorker.assignedTo, conv.id);
  assert.equal(assignedWorker.assignedStationId, conv.id);
  assert.ok(assignedWorker.assignedConveyorSegment);
  assert.equal(assignedWorker.assignedConveyorSegment.objectId, conv.id);
  assert.equal(assignedWorker.assignedConveyorSegment.segmentIndex, 1);
  assert.equal(assignedWorker.assignedConveyorSegment.segmentCount, segCount);
  assert.equal(typeof assignedWorker.rotation, 'number');
  assert.equal(assignedWorker.rotation, assignedWorker.rotationDeg);

  // Ensure linked conveyor stage exists and passes validation for worker coverage
  const convStage = draft.stages.find((s) => s.assignedObjectIds.includes(conv.id));
  assert.ok(convStage, 'Conveyor work stage should exist or be created when assigned');
  assert.ok(assignedWorker.assignedStageIds.includes(convStage.id));

  const issues = validateProject(draft);
  const missingWorkerForConv = issues.find(
    (i) => i.code === 'INSUFFICIENT_WORKERS' && i.targetId === convStage.id
  );
  assert.equal(missingWorkerForConv, undefined);

  // Run DES for 600s on the assigned conveyor stage to verify transport-system interaction tracking
  assignedWorker.assignedStageIds = [convStage.id];
  draft.stages = [convStage];
  draft.products[0]!.routeStageIds = [convStage.id];
  draft.products[0]!.entryStageIds = [convStage.id];
  draft.products[0]!.routingMode = 'manual';
  draft.simulationConfig.durationSec = 600;
  draft.simulationConfig.arrivalIntervalSec = 30;
  draft.simulationConfig.maxPlannedUnits = 10;

  const engine = new DiscreteEventSimulationEngine(draft);
  const res = engine.runToCompletion();
  assert.ok(res.kpis.goodUnits > 0, `Line must complete units cleanly (got ${res.kpis.goodUnits})`);
  assert.ok(res.kpis.workerUtilizationPct > 0, 'Conveyor-assigned worker must log active utilization');
  const wkSnap = engine.getSnapshot().workers[assignedWorker.id];
  assert.ok(wkSnap, 'Assigned worker must appear in DES snapshot');
  assert.ok(wkSnap.busyTimeSec > 0, 'Worker assignedTo conveyor segment must accumulate busy work time');

  const wkAnalytics = res.workerAnalytics?.find((wa) => wa.workerId === assignedWorker.id);
  assert.ok(wkAnalytics, 'SimulationResult.workerAnalytics must track assigned workers');
  assert.equal(wkAnalytics.assignedTo, conv.id);
  assert.equal(wkAnalytics.assignedToKind, 'conveyor');
  assert.equal(wkAnalytics.assignedConveyorSegmentIndex, 1);
  assert.ok(wkAnalytics.tasksCompleted > 0);
  assert.ok(wkAnalytics.busyTimeSec > 0);
  assert.ok(wkAnalytics.utilizationPct > 0);
});

test('migrateProjectSchema synchronizes rotation <-> rotationDeg and assignedTo <-> assignedStationId', () => {
  const base = createDesertAirCoolerProject();
  const legacy: ProjectData = structuredClone(base);
  const wk0 = legacy.workers[0]!;
  delete wk0.rotation;
  delete wk0.assignedTo;
  wk0.rotationDeg = -90;
  wk0.assignedStationId = 'station_legacy_1';

  const migrated = migrateProjectSchema(legacy);
  const out0 = migrated.workers[0]!;
  assert.equal(out0.rotation, -90);
  assert.equal(out0.rotationDeg, -90);
  assert.equal(out0.assignedTo, 'station_legacy_1');
  assert.equal(out0.assignedStationId, 'station_legacy_1');
});

test('Worker Busy excludes passive belt transit & breakdowns; Walking equals distance/speed; Scheduled Util excludes breaks & plant maint', () => {
  const base = createDesertAirCoolerProject();
  const draft: ProjectData = structuredClone(base);
  const conv = draft.layoutObjects.find((o) => o.kind === 'conveyor')!;
  const worker = draft.workers[0]!;

  // Configure deterministic conveyor (4m @ 0.5 m/s => 8s passive belt transit) + 10s manual work per unit
  conv.geometry.dimensions.length = 4;
  conv.geometry.position = { x: 10, y: 0, z: 6 };
  conv.geometry.rotationDeg = 0;
  conv.operations.speedMps = 0.5;
  conv.operations.processingTimeSec = 10;
  conv.operations.loadingTimeSec = 0;
  conv.operations.unloadingTimeSec = 0;
  conv.operations.setupTimeSec = 0;
  conv.operations.requiredOperators = 1;
  conv.operations.availability = 1;

  unassignWorkerFromConveyorInDraft(draft, worker.id);
  worker.assignedStageIds = [];
  assignWorkerToConveyorSegmentInDraft(draft, worker.id, conv.id, 1, 2, 1);

  const convStage = draft.stages.find((s) => s.assignedObjectIds.includes(conv.id))!;
  convStage.processingTimeSec = 10;
  convStage.loadingTimeSec = 0;
  convStage.unloadingTimeSec = 0;
  convStage.setupTimeSec = 0;
  convStage.requiredWorkers = 1;
  convStage.scrapRate = 0;
  convStage.reworkProbability = 0;
  convStage.bufferCapacity = 20;

  // Move worker 4m away along X from their assigned segment position so first trip walks exact Euclidean 4m @ 2 m/s = 2s
  worker.walkingSpeedMps = 2.0;
  worker.position = { x: worker.position.x + 4, y: 0, z: worker.position.z };

  draft.stages = [convStage];
  draft.products[0]!.routeStageIds = [convStage.id];
  draft.products[0]!.entryStageIds = [convStage.id];
  draft.products[0]!.routingMode = 'manual';
  draft.workers = [worker];
  // 1000s horizon: 1 shift (0..1000s), 100s break (400..500s), 100s plant maintenance (700..800s) => 800s scheduled
  draft.simulationConfig = {
    durationSec: 1000,
    arrivalIntervalSec: 40,
    maxPlannedUnits: 5,
    speedMultiplier: 100,
    enableBreakdowns: false,
    randomSeed: 42,
    shifts: [
      {
        id: worker.shiftId,
        name: 'Shift 1',
        startSec: 0,
        durationSec: 1000,
        breaks: [{ id: 'b1', name: 'Break', startSec: 400, durationSec: 100 }],
      },
    ],
    maintenanceWindows: [{ id: 'pm1', name: 'Plant PM', startSec: 700, durationSec: 100 }],
  };

  const eng = new DiscreteEventSimulationEngine(draft);
  const res = eng.runToCompletion();
  const wa = res.workerAnalytics!.find((x) => x.workerId === worker.id)!;

  assert.equal(wa.tasksCompleted, 5, '5 operations completed = 5 completed tasks');
  // Busy MUST equal exact 5 * 10s = 50s (never 5 * (10s + 8s belt transit) = 90s!)
  assert.ok(
    Math.abs(wa.busyTimeSec - 50) < 0.05,
    `Busy time must be exact 50s manual work (got ${wa.busyTimeSec}s)`
  );
  // Walking MUST equal exact 4m / 2 m/s = 2s on initial walk to segment
  assert.ok(
    Math.abs(wa.walkingTimeSec - 2) < 0.05,
    `Walking time must be exact 2s for 4m @ 2m/s (got ${wa.walkingTimeSec}s)`
  );
  // Scheduled denominator MUST equal 1000s - 100s break - 100s plant maint = 800s
  assert.ok(
    Math.abs((wa.scheduledTimeSec ?? 0) - 800) < 0.05,
    `Scheduled time must be 800s after break & plant maintenance (got ${wa.scheduledTimeSec})`
  );
  assert.ok(
    Math.abs(wa.unavailableTimeSec - 200) < 0.05,
    `Break + Plant Maintenance must sum to 200s (got ${wa.unavailableTimeSec})`
  );
  const expectedUtil = ((50 + 2) / 800) * 100;
  assert.ok(
    Math.abs(wa.utilizationPct - expectedUtil) < 0.05,
    `Utilization must equal (50+2)/800 = ${expectedUtil}% (got ${wa.utilizationPct}%)`
  );
});

test('Worker Busy excludes mid-cycle workstation breakdown repair duration', () => {
  const base = createDesertAirCoolerProject();
  const draft: ProjectData = structuredClone(base);
  const ws = draft.layoutObjects.find((o) => o.kind === 'workstation' || o.kind === 'machine')!;
  const worker = draft.workers[0]!;

  unassignWorkerFromConveyorInDraft(draft, worker.id);
  ws.operations.processingTimeSec = 20;
  ws.operations.setupTimeSec = 0;
  ws.operations.loadingTimeSec = 0;
  ws.operations.unloadingTimeSec = 0;
  ws.operations.capacity = 1;
  ws.operations.requiredOperators = 1;
  ws.operations.availability = 0.7;
  ws.operations.mtbfSec = 10;
  ws.operations.mttrSec = 50;
  ws.operations.failureModel = 'fixed';
  ws.operations.repairModel = 'fixed';

  const stg = draft.stages.find((s) => s.assignedObjectIds.includes(ws.id))!;
  stg.processingTimeSec = 20;
  stg.setupTimeSec = 0;
  stg.loadingTimeSec = 0;
  stg.unloadingTimeSec = 0;
  stg.requiredWorkers = 1;
  stg.scrapRate = 0;
  stg.reworkProbability = 0;
  stg.bufferCapacity = 10;

  worker.assignedStageIds = [stg.id];
  worker.assignedTo = ws.id;
  worker.assignedStationId = ws.id;
  worker.position = { ...ws.geometry.position };

  draft.stages = [stg];
  draft.products[0]!.routeStageIds = [stg.id];
  draft.products[0]!.entryStageIds = [stg.id];
  draft.products[0]!.routingMode = 'manual';
  draft.workers = [worker];
  draft.simulationConfig = {
    durationSec: 200,
    arrivalIntervalSec: 10,
    maxPlannedUnits: 1,
    speedMultiplier: 100,
    enableBreakdowns: true,
    randomSeed: 7,
    shifts: [{ id: worker.shiftId, name: 'Shift 1', startSec: 0, durationSec: 200, breaks: [] }],
    maintenanceWindows: [],
  };

  const eng = new DiscreteEventSimulationEngine(draft);
  const res = eng.runToCompletion();
  const wa = res.workerAnalytics!.find((x) => x.workerId === worker.id)!;
  const mach = eng.getSnapshot().objects[ws.id]!;

  assert.equal(wa.tasksCompleted, 1);
  assert.ok(mach.downTimeSec >= 50, `Machine must record breakdown downtime >= 50s (got ${mach.downTimeSec}s)`);
  assert.ok(
    Math.abs(wa.busyTimeSec - 20) < 0.05,
    `Worker busy time must equal exact 20s active work and exclude 50s repair downtime (got ${wa.busyTimeSec}s)`
  );
});

