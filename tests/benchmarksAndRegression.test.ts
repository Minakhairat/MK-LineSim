import test from 'node:test';
import assert from 'node:assert/strict';
import { runAllEngineeringBenchmarks } from '../src/simulation/benchmarkEngine';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { validateProject } from '../src/simulation/validator';
import { migrateProjectSchema } from '../src/storage/indexedDb';

test('All 11 Engineering Benchmarks pass deterministic DES verification', () => {
  const summary = runAllEngineeringBenchmarks();
  assert.equal(summary.totalTests, 11);
  for (const bm of summary.results) {
    assert.equal(
      bm.passed,
      true,
      `Benchmark ${bm.id} failed: ${bm.failureReason || 'metric out of tolerance'}`
    );
  }
  assert.equal(summary.failedTests, 0);
});

test('Backward compatibility: Desert Air Cooler sample project validates, simulates, and survives JSON migration', () => {
  const sample = createDesertAirCoolerProject();
  const issues = validateProject(sample);
  const fatalErrors = issues.filter((i) => i.severity === 'error');
  assert.equal(
    fatalErrors.length,
    0,
    `Sample project had validation errors: ${fatalErrors.map((e) => e.message).join('; ')}`
  );

  const eng = new DiscreteEventSimulationEngine(sample);
  const res = eng.runToCompletion();
  assert.ok(res.kpis.goodUnits > 0, 'Expected positive good units produced');
  assert.ok((res.kpis.oeePct ?? 0) > 0 && (res.kpis.oeePct ?? 0) <= 100);
  assert.ok((res.kpis.scheduledProductionTimeSec ?? 0) > 0);

  // Strip Phase-1 optional fields to simulate legacy 1.0.0 saved JSON project
  const legacyRaw = JSON.parse(JSON.stringify(sample));
  delete legacyRaw.simulationConfig.maintenanceWindows;
  for (const obj of legacyRaw.layoutObjects) {
    delete obj.operations.failureModel;
    delete obj.operations.repairModel;
    delete obj.operations.plannedMaintenance;
    delete obj.operations.runDuringBreaks;
  }

  const migrated = migrateProjectSchema(legacyRaw);
  assert.ok(Array.isArray(migrated.simulationConfig.maintenanceWindows));
  const resMigrated = new DiscreteEventSimulationEngine(migrated).runToCompletion();
  assert.equal(resMigrated.kpis.goodUnits, res.kpis.goodUnits);
});
