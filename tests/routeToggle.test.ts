import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { syncProductRoutes } from '../src/simulation/autoWire';
import { toggleStageInProductRoute } from '../src/utils/units';

// Products-tab stage checkbox. Same sequence the app runs: updateProduct assigns the toggle result, then syncProductRoutes.
function applyToggle(p: any, stageId: string) {
  const prod = p.products[0];
  Object.assign(prod, toggleStageInProductRoute(prod, p.stages.map((s: any) => s.id), stageId));
  syncProductRoutes(p);
}

function quiet() {
  const p: any = createDesertAirCoolerProject();
  p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
  p.products[0].targetQuantity = 0;
  p.simulationConfig.maxPlannedUnits = 0;
  p.simulationConfig.arrivalIntervalSec = 100;
  p.simulationConfig.shifts[0].breaks = [];
  return p;
}

test('Auto product: unticking a stage skips it and keeps the product in auto routing', () => {
  const p = quiet();
  p.products[0].routingMode = 'auto';
  const before = p.products[0].routeStageIds.length;
  applyToggle(p, 'stg_3_wiring');
  assert.equal(p.products[0].routingMode, 'auto');
  assert.equal(p.products[0].routeStageIds.length, before - 1);
  assert.ok(!p.products[0].routeStageIds.includes('stg_3_wiring'));
  const e: any = new DiscreteEventSimulationEngine(p);
  const r: any = e.runToCompletion();
  const wiring = r.stageAnalytics.find((s: any) => s.stageId === 'stg_3_wiring');
  assert.equal(wiring.completedCount, 0, 'skipped stage must not process units');
  assert.ok(r.kpis.goodUnits > 0);
  assert.equal(e.auditInvariants().conservation.unaccountedUnits, 0);
});

test('Auto product: re-ticking restores the stage in project stage order', () => {
  const p = quiet();
  p.products[0].routingMode = 'auto';
  const original = [...p.products[0].routeStageIds];
  applyToggle(p, 'stg_3_wiring');
  applyToggle(p, 'stg_3_wiring');
  assert.deepEqual(p.products[0].routeStageIds, original);
  assert.equal(p.products[0].routingMode, 'auto');
});

test('Manual product keeps the earlier behaviour: route is rebuilt from the flowchart wiring', () => {
  const p = quiet();
  p.products[0].routingMode = 'manual';
  p.products[0].entryStageIds = [p.stages[0].id];
  syncProductRoutes(p);
  const before = [...p.products[0].routeStageIds];
  applyToggle(p, 'stg_3_wiring');
  assert.equal(p.products[0].routingMode, 'manual');
  assert.deepEqual(p.products[0].routeStageIds, before);
});

test('auto product: unticking the last remaining stage leaves the route unchanged (no silent all-stages restore)', () => {
  const p: any = createDesertAirCoolerProject();
  const ids = p.stages.map((s: any) => s.id);
  const prod = p.products[0];
  prod.routingMode = 'auto';
  prod.routeStageIds = ['stg_7_packing'];
  prod.entryStageIds = ['stg_7_packing'];
  applyToggle(p, 'stg_7_packing');
  assert.equal(p.products[0].routingMode, 'auto');
  assert.deepEqual(p.products[0].routeStageIds, ['stg_7_packing']);
  assert.ok(ids.length > 1);
});
