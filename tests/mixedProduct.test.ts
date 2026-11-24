import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { validateProject } from '../src/simulation/validator';

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

// Independent lines: default project, Packing batch 1, arrival 120 s. A routes stages 1-4, B stages 5-8 (disjoint).
// Hand-checked ideal cycles: A 60 s (Electrical Wiring), B 40 s. Recorded counts: A 108 good + 4 scrap, B 109 good + 2 scrap,
// operating 27000 s. The two lines run at the same time, so ideal work is divided by 2 x 27000 s:
// ideal 60 x 112 + 40 x 111 = 11160 s, good 60 x 108 + 40 x 109 = 10840 s. P = 20.67%, Q = 97.13%, OEE = 20.07%.
// Without the division the figure would be 41.33% (and could reach 200%).
function indepFixture(routeB?: (ids: string[]) => string[]) {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const ids: string[] = p.stages.map((s: any) => s.id);
  const A = p.products[0];
  const B = structuredClone(A); B.id = 'pB'; B.name = 'B'; B.code = 'B'; B.mixWeight = 1; A.mixWeight = 1;
  A.routeStageIds = ids.slice(0, 4); B.routeStageIds = routeB ? routeB(ids) : ids.slice(4);
  p.products.push(B);
  p.simulationConfig.arrivalIntervalSec = 120;
  return p;
}
test('Independent lines (disjoint routes): ideal work is divided by the number of parallel lines', () => {
  const r = run(indepFixture());
  const [A, B] = r.productAnalytics;
  assert.deepEqual([A.completedGoodQty, A.scrappedQty, B.completedGoodQty, B.scrappedQty], [108, 4, 109, 2]);
  near(r.kpis.performancePct, (11160 / (27000 * 2)) * 100);
  near(r.kpis.qualityPct, (10840 / 11160) * 100);
  near(r.kpis.oeePct, (10840 / 54000) * 100);
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
});
test('Partly overlapping routes (neither nested nor disjoint) get no weighted figure', () => {
  const r = run(indepFixture((ids) => ids.slice(2, 6)));
  assert.equal(r.kpis.oeeMixedTimeWeighted, undefined);
});

// Independent lines with downtime (Availability below 100%): breakdowns switched on with the sample
// project's own machine failure settings (enableBreakdowns, seed 1). Recorded: A 107 good + 5 scrap, B 110 + 1, scheduled 27000 s,
// operating 22948.21 s (unplanned 4051.79 s is one project-level figure; the sample project has failures on stages of both lines, so A and P here are not per-line values).
// Hand: OEE = ideal good time / (2 lines x scheduled) = (60 x 107 + 40 x 110) / 54000 = 20.04%, whatever the operating time,
// because operating time cancels in A x P x Q. Performance = (60 x 112 + 40 x 111) / (2 x 22948.21) = 24.32%.
test('Independent lines with downtime: final OEE equals good output time over planned time of all lines', () => {
  const p = indepFixture((ids) => ids.slice(4));
  p.simulationConfig.enableBreakdowns = true; p.simulationConfig.randomSeed = 1;
  const r = run(p);
  const [A, B] = r.productAnalytics;
  assert.deepEqual([A.completedGoodQty, A.scrappedQty, B.completedGoodQty, B.scrappedQty], [107, 5, 110, 1]);
  assert.ok(r.kpis.availabilityPct < 100);
  near(r.kpis.oeePct, ((60 * 107 + 40 * 110) / 54000) * 100);
  near(r.kpis.performancePct, ((60 * 112 + 40 * 111) / (2 * r.kpis.operatingTimeSec)) * 100);
});

// Batch starvation with two products. Default project: Packing collects batches of 4 per product, arrival 60 s, mix 1:1.
// Hand rule: with k products and batch size b, the stage can hold k x (b - 1) = 2 x 3 = 6 mixed units with no complete
// batch, so the buffer must be at least k x (b - 1) + 1 = 7. Recorded runs: buffer 5 and 6 stall (0 good units, one
// batch_starved warning); buffer 7 flows (411 good units, no warning). The validator warns exactly for 5 and 6.
// This documents a detected, pre-warned stall, not an engine fix: buffer 6 still stops the line if the user runs it.
test('Batch starvation: buffer below k x (b - 1) + 1 is warned before the run and stalls; 7 flows', () => {
  const build = (cap: number) => {
    const p: any = createDesertAirCoolerProject();
    p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = cap;
    const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B'; B.code = 'B'; B.mixWeight = 1; p.products[0].mixWeight = 1;
    p.products.push(B); p.simulationConfig.arrivalIntervalSec = 60;
    return p;
  };
  const warned = (p: any) => validateProject(p).some((i: any) => String(i.id).startsWith('val_stg_batch_buffer'));
  for (const cap of [5, 6]) {
    const p = build(cap); const r = run(p);
    assert.equal(warned(p), true); assert.equal(r.kpis.goodUnits, 0);
    assert.equal(r.stallWarnings?.[0]?.kind, 'batch_starved');
  }
  const ok = build(7); const r7 = run(ok);
  assert.equal(warned(ok), false); assert.equal(r7.kpis.goodUnits, 411); assert.equal(r7.stallWarnings?.length ?? 0, 0);
});
