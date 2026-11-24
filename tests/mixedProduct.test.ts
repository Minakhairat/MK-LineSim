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

test('Out of scope stays count-based and unflagged: single product, manual routing, manual routing', () => {
  const single: any = createDesertAirCoolerProject();
  assert.equal(run(single).kpis.oeeMixedTimeWeighted, undefined);
  assert.equal(run(fixture((p) => { p.products[1].routingMode = 'manual'; })).kpis.oeeMixedTimeWeighted, undefined);
});

// Live-like fixture (default project, second product x2, Packing single-item, arrival default). Recorded counts:
// A 137 good + 10 scrap, B 140 good + 7 scrap (147 each), operating 27000 s. Hand: ideal work (60+120) x 147 = 26460 s,
// good 60 x 137 + 120 x 140 = 25020 s. P = 98.00%, Q = 94.56%. Unit yield (277/294) = 94.22% is a different number.
// Regression: the anomaly flag from the old mix-average basis must not survive (P is below 100%).
test('Weighted case below 100% Performance carries no stale anomaly flag', () => {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B'; B.cycleTimeMultiplier = 2; p.products.push(B);
  const r = run(p);
  const [A2, B2] = r.productAnalytics;
  assert.deepEqual([A2.completedGoodQty, A2.scrappedQty, B2.completedGoodQty, B2.scrappedQty], [137, 10, 140, 7]);
  near(r.kpis.performancePct, (26460 / 27000) * 100);
  near(r.kpis.qualityPct, (25020 / 26460) * 100);
  near(r.kpis.unitYieldPct, (277 / 294) * 100);
  assert.equal(r.kpis.performanceAnomaly, false);
  assert.equal(r.kpis.performanceAnomalyReason, undefined);
});

// Partial route. Default project, Packing single-item, arrival 120 s, A full route, B skips stage 3 (wiring, 60 s, the slowest).
// Ideal cycle = bottleneck of the product's own route: A 60 s (wiring), B 45 s (motor). Recorded counts of this run:
// A 105 good + 6 scrap, B 108 good + 2 scrap (stage 3 completed 110 units: only A's 111 minus one still in process), operating 27000 s.
// Hand: ideal work = 60 x 111 + 45 x 110 = 11610 s; ideal good = 60 x 105 + 45 x 108 = 11160 s.
// P = 11610/27000 = 43.00%, Q = 11160/11610 = 96.12%, OEE = 11160/27000 = 41.33%. The count-based basis gave P 49.11% and OEE 47.33%.
test('Partial route: each product ideal cycle comes from its own route stages', () => {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B';
  B.routeStageIds = B.routeStageIds.filter((id: string) => id !== 'stg_3_wiring');
  p.products[0].mixWeight = 1; B.mixWeight = 1;
  p.products.push(B);
  p.simulationConfig.arrivalIntervalSec = 120;
  const r = run(p);
  const [A, Bq] = r.productAnalytics;
  assert.deepEqual([A.completedGoodQty, A.scrappedQty, Bq.completedGoodQty, Bq.scrappedQty], [105, 6, 108, 2]);
  const idealAll = 60 * 111 + 45 * 110;
  const idealGood = 60 * 105 + 45 * 108;
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
  near(r.kpis.performancePct, (idealAll / 27000) * 100);
  near(r.kpis.qualityPct, (idealGood / idealAll) * 100);
  near(r.kpis.oeePct, (idealGood / 27000) * 100);
});

// Repeated visit. Default project, Packing single-item, arrival 120 s, A full route, B visits Testing twice (route: stages 1-5, Testing again, 6-8).
// Ideal cycle: A 60 s (wiring). B: Testing is visited twice, load 2 x 35 = 70 s, which exceeds wiring 60 s, so B ideal = 70 s.
// Recorded counts: A 107 good + 4 scrap, B 98 good + 11 scrap (Testing completed 325 = A 111-ish + B twice), operating 27000 s.
// Hand: ideal work = 60 x 111 + 70 x 109 = 14290 s; ideal good = 60 x 107 + 70 x 98 = 13280 s.
// P = 14290/27000 = 52.93%, Q = 13280/14290 = 92.93%, OEE = 13280/27000 = 49.19%. The count-based basis gave OEE 45.56%.
test('Repeated visit: a stage visited twice counts twice toward the product ideal cycle', () => {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B';
  const r0 = B.routeStageIds; B.routeStageIds = [...r0.slice(0, 5), 'stg_4_testing', ...r0.slice(5)];
  p.products[0].mixWeight = 1; B.mixWeight = 1; p.products.push(B);
  p.simulationConfig.arrivalIntervalSec = 120;
  const r = run(p);
  const [A, Bq] = r.productAnalytics;
  assert.deepEqual([A.completedGoodQty, A.scrappedQty, Bq.completedGoodQty, Bq.scrappedQty], [107, 4, 98, 11]);
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
  near(r.kpis.performancePct, (14290 / 27000) * 100);
  near(r.kpis.qualityPct, (13280 / 14290) * 100);
  near(r.kpis.oeePct, (13280 / 27000) * 100);
});
