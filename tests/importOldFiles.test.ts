import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { migrateProjectSchema } from '../src/storage/indexedDb';
import { autoWireProjectForSimulation } from '../src/simulation/autoWire';
import { detectAutoWireNotes, generatedInputCodes, hasStageWithoutWorker, markGeneratedInputs, resultProvenance, stampGeneratedInputs, unionProvenance } from '../src/utils/importNotes';

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

test('Import rejects explicit null or non-numeric product priority, mixWeight and cycleTimeMultiplier, but a missing key still defaults to 1', () => {
  for (const key of ['priority', 'mixWeight', 'cycleTimeMultiplier']) {
    for (const bad of [null, '', 'abc', NaN]) {
      const p = clone();
      p.products[0][key] = bad;
      assert.throws(() => migrateProjectSchema(p), new RegExp(key));
    }
    const missing = clone();
    delete missing.products[0][key];
    assert.equal((migrateProjectSchema(missing) as any).products[0][key], 1);
    const zero = clone();
    zero.products[0][key] = 0;
    assert.equal((migrateProjectSchema(zero) as any).products[0][key], 0); // explicit 0 stays 0 (the validator judges it)
    const str = clone();
    str.products[0][key] = '2';
    assert.equal((migrateProjectSchema(str) as any).products[0][key], 2);
  }
});

test('Auto-wire disclosure notes are detected for generated product, stages, routes and workers, and not for a complete project', () => {
  const full = clone();
  assert.deepEqual(detectAutoWireNotes(full, autoWireProjectForSimulation(full).updated), []);
  const noProd = clone();
  noProd.products = [];
  const wired = autoWireProjectForSimulation(noProd).updated;
  assert.deepEqual(detectAutoWireNotes(noProd, wired), ['autowired_product']);
  assert.equal(wired.products[0].name, 'Standard Product');
  const noStages = clone();
  noStages.stages = [];
  noStages.products.forEach((p: any) => { p.routeStageIds = []; });
  assert.ok(detectAutoWireNotes(noStages, autoWireProjectForSimulation(noStages).updated).includes('autowired_stages'));
});

test('Generated-input provenance lives on the entities: survives banner dismissal and a save/reload round trip, and ends when the generated items are replaced', () => {
  const noProd = clone();
  noProd.products = [];
  const wired = autoWireProjectForSimulation(noProd).updated;
  markGeneratedInputs(wired, noProd);
  assert.equal(wired.products[0].autoGenerated, true);
  assert.ok(generatedInputCodes(wired).includes('autowired_product'));
  // dismissing the banner clears importNotes only
  delete (wired as any).importNotes;
  assert.ok(generatedInputCodes(wired).includes('autowired_product'));
  // a JSON round trip through import keeps the flag
  const re: any = migrateProjectSchema(JSON.parse(JSON.stringify(wired)));
  assert.equal(re.products[0].autoGenerated, true);
  assert.ok(generatedInputCodes(re).includes('autowired_product'));
  // a complete project has no provenance, and deleting the generated product ends it
  assert.deepEqual(generatedInputCodes(clone()), []);
  re.products = re.products.filter((p: any) => !p.autoGenerated);
  assert.ok(!generatedInputCodes(re).includes('autowired_product'));
});

test('Result provenance stamp outlives deleting the generated items, and an unstamped result is unknown, never clean', () => {
  const noProd = clone();
  noProd.products = [];
  const wired = autoWireProjectForSimulation(noProd).updated;
  markGeneratedInputs(wired, noProd);
  const res: any = stampGeneratedInputs(run(wired), wired);
  assert.deepEqual(resultProvenance(res), { codes: ['autowired_product'], unknown: false });
  // delete the generated product without rerunning: the old result still carries the warning
  wired.products = wired.products.filter((p: any) => !p.autoGenerated);
  assert.deepEqual(generatedInputCodes(wired), []);
  assert.deepEqual(resultProvenance(JSON.parse(JSON.stringify(res))).codes, ['autowired_product']);
  // a result computed on a complete project is stamped clean
  const clean: any = stampGeneratedInputs(run(clone()), clone());
  assert.deepEqual(resultProvenance(clean), { codes: [], unknown: false });
  // a result with no stamp is unknown, not clean
  const legacy = JSON.parse(JSON.stringify(clean));
  delete legacy.generatedInputs;
  assert.deepEqual(resultProvenance(legacy), { codes: [], unknown: true });
  assert.equal(resultProvenance(undefined).unknown, false);
  assert.deepEqual(unionProvenance([resultProvenance(res), resultProvenance(legacy)]), { codes: ['autowired_product'], unknown: true });
});

test('A project whose stages need operators but has none is detected, and the pre-run auto-wire flags the created workers', () => {
  const p = clone();
  assert.equal(hasStageWithoutWorker(p), false);
  p.workers = [];
  assert.equal(hasStageWithoutWorker(p), true);
  const wired = autoWireProjectForSimulation(p).updated;
  assert.ok(wired.workers.length > 0);
  markGeneratedInputs(wired, p);
  assert.ok(wired.workers.every((w: any) => w.autoGenerated));
  assert.ok(generatedInputCodes(wired).includes('autowired_workers'));
  const res: any = stampGeneratedInputs(run(wired), wired);
  assert.ok(resultProvenance(res).codes.includes('autowired_workers'));
});
