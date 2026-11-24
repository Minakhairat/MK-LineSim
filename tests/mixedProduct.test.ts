import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';

// Fixture: default project, Packing batch 1, arrival 120 s, product A (x1) and B (x2, 5% scrap), mix 1:1.
// Ideal cycle per product = that product's own bottleneck cycle: A 60 s, B 120 s (hand-checked: bottleneck stage has
// processing 60 s and no load/unload, so x2 gives 120 s). Counts below are the recorded counts of this fixture and run.
function fixture(mutate?: (p: any) => void) {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const B = structuredClone(p.products[0]);
  B.id = 'pB'; B.code = 'B'; B.name = 'B'; B.cycleTimeMultiplier = 2; B.scrapRate = 0.05; B.mixWeight = 1;
  p.products[0].mixWeight = 1; p.products[0].cycleTimeMultiplier = 1;
  p.products.push(B);
  p.simulationConfig.arrivalIntervalSec = 120;
  mutate?.(p);
  return p;
}
const run = (p: any) => (new DiscreteEventSimulationEngine(p) as any).runToCompletion();
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('Two auto products, full routes: Performance, Quality and OEE are time-weighted by each product ideal cycle', () => {
  const r = run(fixture());
  const [A, B] = r.productAnalytics;
  // recorded counts: A 106 good + 3 scrap, B 102 good + 7 scrap (109 each), operating time 27000 s
  assert.deepEqual([A.completedGoodQty, A.scrappedQty, B.completedGoodQty, B.scrappedQty], [106, 3, 102, 7]);
  const idealAll = 60 * 109 + 120 * 109;          // 19620 s
  const idealGood = 60 * 106 + 120 * 102;          // 18600 s
  near(r.kpis.performancePct, (idealAll / 27000) * 100);      // 72.67
  near(r.kpis.qualityPct, (idealGood / idealAll) * 100);      // 94.80
  near(r.kpis.oeePct, (idealGood / 27000) * 100);             // 68.89
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
  near(r.kpis.unitYieldPct, (208 / 218) * 100);               // 95.41 count yield kept separately
  // identity A x P x Q
  near(r.kpis.oeePct, (r.kpis.availabilityPct / 100) * (r.kpis.performancePct / 100) * (r.kpis.qualityPct / 100) * 100, 1e-6);
});

test('Two products with identical cycles: weighted and count-based Quality coincide', () => {
  const r = run(fixture((p) => { p.products[1].cycleTimeMultiplier = 1; p.simulationConfig.arrivalIntervalSec = 60; }));
  const good = r.kpis.goodUnits ?? r.kpis.goodCount; const total = r.kpis.actualProduction;
  near(r.kpis.qualityPct, (r.kpis.unitYieldPct as number), 1e-6);
  assert.ok(total > 0 && good <= total);
});

test('Out of scope stays count-based and unflagged: single product, manual routing, partial route', () => {
  const single: any = createDesertAirCoolerProject();
  assert.equal(run(single).kpis.oeeMixedTimeWeighted, undefined);
  assert.equal(run(fixture((p) => { p.products[1].routingMode = 'manual'; })).kpis.oeeMixedTimeWeighted, undefined);
  assert.equal(run(fixture((p) => { p.products[1].routeStageIds = p.products[1].routeStageIds.slice(0, 4); })).kpis.oeeMixedTimeWeighted, undefined);
});
