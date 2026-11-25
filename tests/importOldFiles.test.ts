import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { migrateProjectSchema } from '../src/storage/indexedDb';

const run = (p: any) => (new DiscreteEventSimulationEngine(p) as any).runToCompletion();
const clone = () => JSON.parse(JSON.stringify(createDesertAirCoolerProject()));

test('Old file whose products have no routeStageIds imports and runs the same as the full-route project', () => {
  const base = run(migrateProjectSchema(clone()));
  const old = clone();
  old.products.forEach((p: any) => { delete p.routeStageIds; });
  const r = run(migrateProjectSchema(old));
  // before the fix this threw "Cannot read properties of undefined (reading 'length')"
  assert.equal(r.kpis.goodUnits, base.kpis.goodUnits);
  assert.equal(r.kpis.actualProduction, base.kpis.actualProduction);
});

test('Old file with simulationConfig but no shifts gets one full-duration day shift instead of zero output', () => {
  const old = clone();
  delete old.simulationConfig.shifts;
  const m = migrateProjectSchema(old);
  assert.equal(m.simulationConfig.shifts.length, 1);
  assert.equal(m.simulationConfig.shifts[0].durationSec, 28800);
  const r = run(m);
  assert.equal(r.kpis.scheduledProductionTimeSec, 28800); // no breaks in the default shift
  assert.ok(r.kpis.goodUnits > 0); // before the fix: 0 good units, OEE 0 with no message
});

test('An explicit empty shifts array is kept as given (not replaced)', () => {
  const old = clone();
  old.simulationConfig.shifts = [];
  assert.equal(migrateProjectSchema(old).simulationConfig.shifts.length, 0);
});

test('Import records what was assumed (importNotes) so the UI can show it', () => {
  const full = migrateProjectSchema(clone());
  assert.equal(full.importNotes, undefined); // a complete file produces no notes
  const old = clone();
  delete old.simulationConfig.shifts;
  old.products.forEach((p: any) => { delete p.routeStageIds; });
  old.lastSimulationResult = { kpis: { goodUnits: 9999 } };
  const m: any = migrateProjectSchema(old);
  assert.deepEqual(m.importNotes, ['shifts_defaulted', 'routes_defaulted', 'stored_results_kept']);
  const noCfg = clone();
  delete noCfg.simulationConfig;
  assert.deepEqual((migrateProjectSchema(noCfg) as any).importNotes, ['sim_config_defaulted']);
  // notes survive a second migration (reload from storage) without duplicating
  assert.deepEqual((migrateProjectSchema(m) as any).importNotes, m.importNotes);
});

test('Import rejects a simulationConfig missing planned units, shift duration or arrival interval instead of loading a project that crashes the app', () => {
  for (const key of ['maxPlannedUnits', 'durationSec', 'arrivalIntervalSec', 'randomSeed']) {
    const bad = clone();
    delete bad.simulationConfig[key];
    assert.throws(() => migrateProjectSchema(bad), new RegExp(key));
    const str = clone();
    str.simulationConfig[key] = 'abc';
    assert.throws(() => migrateProjectSchema(str), new RegExp(key));
  }
  // 0 is a valid explicit value (unlimited planned units) and still imports
  const zero = clone();
  zero.simulationConfig.maxPlannedUnits = 0;
  assert.equal(migrateProjectSchema(zero).simulationConfig.maxPlannedUnits, 0);
  // a file with no simulationConfig at all keeps its existing default-plus-note behaviour
  const none = clone();
  delete none.simulationConfig;
  assert.doesNotThrow(() => migrateProjectSchema(none));
});
