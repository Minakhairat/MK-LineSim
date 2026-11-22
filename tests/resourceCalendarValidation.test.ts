import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSimulationCalendars } from '../src/simulation/resourceCalendar';
import { runEngineeringValidations } from '../src/engineering/validationEngine';
import { migrateProjectSchema } from '../src/storage/indexedDb';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';

test('Calendar & validation engine catch invalid object/worker shifts, maintenance outside/partial horizon, overlaps, and invalid lognormal params', () => {
  const proj = createDesertAirCoolerProject();
  proj.simulationConfig.durationSec = 3600;
  proj.simulationConfig.shifts = [
    { id: 'shift_day', name: 'Day', startSec: 0, durationSec: 3600, breaks: [] },
  ];

  // Invalid shift assignment on equipment and worker
  proj.layoutObjects[0].operations.shiftId = 'shift_ghost';
  proj.workers[0].shiftId = 'worker_ghost_shift';
  proj.workers[0].rotationDeg = 135;

  // Invalid lognormal repair stdDev
  proj.layoutObjects[1].operations.repairModel = 'lognormal';
  proj.layoutObjects[1].operations.mttrSec = 100;
  proj.layoutObjects[1].operations.mttrStdDevSec = -10;

  // Planned maintenance outside horizon, partial overhang, and overlapping windows
  proj.simulationConfig.maintenanceWindows = [
    { id: 'pm_out', name: 'Beyond Horizon', startSec: 4000, durationSec: 300 },
    { id: 'pm_part', name: 'Partial Overhang', startSec: 3400, durationSec: 500 },
  ];
  proj.layoutObjects[0].operations.plannedMaintenance = [
    { id: 'pm_a', name: 'PM A', startSec: 1000, durationSec: 400 },
    { id: 'pm_b', name: 'PM B', startSec: 1200, durationSec: 400 },
  ];

  const calRes = validateSimulationCalendars(proj.simulationConfig, proj.layoutObjects, proj.workers);
  assert.equal(calRes.invalidObjectShifts.length, 1);
  assert.equal(calRes.invalidWorkerShifts.length, 1);
  assert.equal(calRes.maintenanceOutsideHorizon.length, 2);
  assert.equal(calRes.overlappingMaintenanceWindows.length, 1);

  const issues = runEngineeringValidations(proj);
  const codes = new Set(issues.map((i) => i.code));
  assert.ok(codes.has('INVALID_RESOURCE_SHIFT'));
  assert.ok(codes.has('INVALID_WORKER_SHIFT'));
  assert.ok(codes.has('MAINTENANCE_OUTSIDE_HORIZON'));
  assert.ok(codes.has('MAINTENANCE_PARTIALLY_CLIPPED'));
  assert.ok(codes.has('OVERLAPPING_MAINTENANCE_WINDOWS'));
  assert.ok(codes.has('INVALID_REPAIR_MODEL'));

  // All new calendar validation issues include actionable bilingual recommendations
  for (const code of [
    'INVALID_RESOURCE_SHIFT',
    'INVALID_WORKER_SHIFT',
    'MAINTENANCE_OUTSIDE_HORIZON',
    'OVERLAPPING_MAINTENANCE_WINDOWS',
  ]) {
    const issue = issues.find((i) => i.code === code)!;
    assert.ok(issue.recommendation && issue.recommendationAr, `Missing recommendation for ${code}`);
  }
});

test('Worker rotationDeg survives project schema migration and defaults cleanly', () => {
  const proj = createDesertAirCoolerProject();
  proj.workers[0].rotationDeg = -45;
  delete (proj.workers[1] as { rotationDeg?: number }).rotationDeg;

  const migrated = migrateProjectSchema(JSON.parse(JSON.stringify(proj)));
  assert.equal(migrated.workers[0].rotationDeg, -45);
  assert.equal(migrated.workers[1].rotationDeg, 0);
});
