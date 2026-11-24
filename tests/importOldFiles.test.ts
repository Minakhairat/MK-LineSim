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
