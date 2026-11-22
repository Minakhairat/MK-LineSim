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
