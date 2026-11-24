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

// Same rule, more products and unequal mix. Default project, Packing buffer varied, arrival 60 s. Recorded:
// three products 1:1:1, batch 4: needed 3 x 3 + 1 = 10; buffer 9 stalls (0 good, stall held 9 = the buffer, so units held for a
// batch count toward buffer occupancy), buffer 10 flows (414 good). Three products, batch 3: needed 3 x 2 + 1 = 7; buffer 6 stalls, 7 flows (414).
// Two products mix 3:1, batch 4: needed 7; buffer 6 stalls (4 good before the stall), buffer 7 flows (410). The bound is a worst-case
// sufficient buffer: an unequal mix can still stall below it (it did at 5 and 6 here) but never at or above it in these runs.
test('Batch starvation bound k x (b - 1) + 1: three products and unequal mix', () => {
  const build = (weights: number[], batch: number, cap: number) => {
    const p: any = createDesertAirCoolerProject();
    const pk = p.stages.find((s: any) => s.id === 'stg_7_packing'); pk.bufferCapacity = cap; pk.batchSize = batch;
    p.products[0].mixWeight = weights[0];
    for (let i = 1; i < weights.length; i++) {
      const B = structuredClone(p.products[0]); B.id = 'p' + i; B.name = 'P' + i; B.code = 'P' + i; B.mixWeight = weights[i]; p.products.push(B);
    }
    p.simulationConfig.arrivalIntervalSec = 60;
    return p;
  };
  const cases: Array<[number[], number, number, number, number]> = [
    // weights, batch, buffer, expected good, expected stall count
    [[1, 1, 1], 4, 9, 0, 1], [[1, 1, 1], 4, 10, 414, 0],
    [[1, 1, 1], 3, 6, 0, 1], [[1, 1, 1], 3, 7, 414, 0],
    [[3, 1], 4, 6, 4, 1], [[3, 1], 4, 7, 410, 0],
  ];
  for (const [w, b, cap, good, stalls] of cases) {
    const p = build(w, b, cap); const r = run(p);
    const warned = validateProject(p).some((i: any) => String(i.id).startsWith('val_stg_batch_buffer'));
    assert.equal(r.kpis.goodUnits, good, `${w} b${b} cap${cap}`);
    assert.equal(r.stallWarnings?.length ?? 0, stalls, `${w} b${b} cap${cap}`);
    assert.equal(warned, stalls === 1, `${w} b${b} cap${cap}`);
    if (stalls === 1) assert.equal(r.stallWarnings?.[0]?.heldUnits, cap);
  }
});

// Capacity semantics at a batch-collecting stage (pre-existing behaviour, recorded, not changed). The engine admits units to a
// collect_batch stage up to max(buffer capacity, batch size), so a batch can always form (desEngine nextStagingAllowance =
// batchSize; canAdmitToStageBuffer). Single product, Packing batch 4, arrival 60 s: buffer 1, 2, 3 and 4 give identical runs
// (412 good, no stall) and a recorded maximum queue of 3 units, which is above the nominal buffer of 1 and 2. With two products and
// buffer 3 (below the batch size) the stall holds 4 units: the effective capacity is 4, not 3. So the buffer setting alone does not
// bound the units held at a batch stage; the validator bound k x (b - 1) + 1 is above the batch size whenever k >= 2.
test('Batch stage admits up to max(buffer, batch size): buffer 1 to 4 identical for one product, held 4 at buffer 3 for two', () => {
  for (const cap of [1, 2, 3, 4]) {
    const p: any = createDesertAirCoolerProject();
    const pk = p.stages.find((s: any) => s.id === 'stg_7_packing'); pk.bufferCapacity = cap; pk.batchSize = 4;
    p.simulationConfig.arrivalIntervalSec = 60;
    const r = run(p);
    const sa = r.stageAnalytics.find((x: any) => x.stageId === 'stg_7_packing');
    assert.equal(r.kpis.goodUnits, 412, `cap ${cap}`);
    assert.equal(r.stallWarnings?.length ?? 0, 0, `cap ${cap}`);
    assert.equal(sa.maxQueueLength, 3, `cap ${cap}`);
  }
  const p: any = createDesertAirCoolerProject();
  const pk = p.stages.find((s: any) => s.id === 'stg_7_packing'); pk.bufferCapacity = 3; pk.batchSize = 4;
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B'; B.code = 'B'; B.mixWeight = 1; p.products[0].mixWeight = 1; p.products.push(B);
  p.simulationConfig.arrivalIntervalSec = 60;
  const r = run(p);
  assert.equal(r.kpis.goodUnits, 0);
  assert.equal(r.stallWarnings?.[0]?.heldUnits, 4);
});

// Parallel machines and a consecutive repeat, weighted OEE (one fixture each, hand-derived, arrival 120 s, Packing batch 1, 27000 s operating).
// (a) Second Electrical Wiring machine; B has cycle multiplier 2. Solo bottleneck A: Motor 45 s (wiring 60/2 = 30 s), B 90 s.
//     Recorded A 101 good + 9 scrap, B 106 + 3: ideal 45x110 + 90x109 = 14760 s, good 45x101 + 90x106 = 14085 s.
//     P = 54.67%, Q = 95.43%, OEE = 52.17%.
// (b) Second machines at Motor Assembly and Electrical Wiring; B multiplier 2. A ideal 40 s (Final Assembly and Packing), B 80 s.
//     Recorded A 105 + 4, B 104 + 5: ideal 40x109 + 80x109 = 13080 s, good 40x105 + 80x104 = 12520 s. P = 48.44%, Q = 95.72%, OEE = 46.37%.
// (c) B visits Testing twice in a row (route ... Testing, Testing, Final ...), no other change. A ideal 60 s (wiring); B Testing load 2x35 = 70 s > 60, so 70 s.
//     Recorded A 100 + 10, B 107 + 3 (Testing completed 330 = 110 + 2x110): ideal 60x110 + 70x110 = 14300 s, good 60x100 + 70x107 = 13490 s.
//     P = 52.96%, Q = 94.34%, OEE = 49.96%.
function parFixture(extra: 'wiring' | 'both' | 'none', arrival = 120) {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const dup = (stageId: string, objId: string) => {
    const st = p.stages.find((s: any) => s.id === stageId); const o = p.layoutObjects.find((x: any) => x.id === objId);
    const o2 = structuredClone(o); o2.id = objId + 'b'; o2.name = o.name + ' 2'; o2.geometry.position.x += 3; o2.stageId = stageId;
    p.layoutObjects.push(o2); st.assignedObjectIds = [...st.assignedObjectIds, o2.id];
  };
  if ((extra as string) !== 'none') dup('stg_3_wiring', 'obj_st_3');
  if (extra === 'both') dup('stg_2_motor', 'obj_st_2');
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B'; B.code = 'B'; B.mixWeight = 1; B.cycleTimeMultiplier = 2;
  p.products[0].mixWeight = 1; p.products.push(B); p.simulationConfig.arrivalIntervalSec = arrival;
  return p;
}
test('Weighted OEE with parallel machines in one stage (hand-checked fixtures)', () => {
  const a = run(parFixture('wiring'));
  assert.deepEqual(a.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[101, 9], [106, 3]]);
  near(a.kpis.performancePct, (14760 / 27000) * 100); near(a.kpis.qualityPct, (14085 / 14760) * 100); near(a.kpis.oeePct, (14085 / 27000) * 100);
  const b = run(parFixture('both'));
  assert.deepEqual(b.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[105, 4], [104, 5]]);
  near(b.kpis.performancePct, (13080 / 27000) * 100); near(b.kpis.qualityPct, (12520 / 13080) * 100); near(b.kpis.oeePct, (12520 / 27000) * 100);
  assert.equal(a.kpis.oeeMixedTimeWeighted, true); assert.equal(b.kpis.oeeMixedTimeWeighted, true);
});
test('Weighted OEE with a consecutive repeat of one stage (hand-checked fixture)', () => {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const B = structuredClone(p.products[0]); B.id = 'pB'; B.name = 'B'; B.code = 'B'; B.mixWeight = 1; p.products[0].mixWeight = 1; p.products.push(B);
  const r0: string[] = [...B.routeStageIds]; const i = r0.indexOf('stg_4_testing');
  B.routeStageIds = [...r0.slice(0, i + 1), 'stg_4_testing', ...r0.slice(i + 1)];
  p.simulationConfig.arrivalIntervalSec = 120;
  const r = run(p);
  assert.deepEqual(r.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[100, 10], [107, 3]]);
  assert.equal(r.stageAnalytics.find((s: any) => s.stageId === 'stg_4_testing').completedCount, 330);
  near(r.kpis.performancePct, (14300 / 27000) * 100); near(r.kpis.qualityPct, (13490 / 14300) * 100); near(r.kpis.oeePct, (13490 / 27000) * 100);
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
});

// (d) Same as (a) (second Wiring machine, B cycle x2, A ideal 45 s, B 90 s) but arrival 30 s so the line is not arrival-limited.
//     Recorded A 135 good + 12 scrap, B 140 + 6 (the same counts at arrival 45, 40 and 30 s: the output stops depending on arrival).
//     Ideal work 45x147 + 90x146 = 19755 s -> P 73.17%. Good 45x135 + 90x140 = 18675 s -> Q 94.53%, OEE 69.17%.
//     Traced in this run: the Motor stage (the ranked bottleneck) is 76% utilized, and so is not saturated, but the two Wiring operators
//     are about 99% busy (labour at Wiring limits output; the added machine sits mostly idle). Performance here is measured against
//     machine-based ideal cycles, so it does not show the labour limit. Not tested: whether that holds for other staffing.
test('Weighted OEE with a parallel machine when arrival no longer limits output (hand-checked; Wiring operators are the saturated resource)', () => {
  const r = run(parFixture('wiring', 30));
  assert.deepEqual(r.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[135, 12], [140, 6]]);
  near(r.kpis.performancePct, (19755 / 27000) * 100); near(r.kpis.qualityPct, (18675 / 19755) * 100); near(r.kpis.oeePct, (18675 / 27000) * 100);
  const wiringOps = r.workerAnalytics.filter((w: any) => /Wiring/.test(w.workerName));
  assert.equal(wiringOps.length, 2);
  for (const w of wiringOps) assert.ok(w.busyTimeSec / w.scheduledTimeSec > 0.98, `${w.workerName} ${w.busyTimeSec}/${w.scheduledTimeSec}`);
  const motor = r.stageAnalytics.find((x: any) => x.stageId === 'stg_2_motor');
  assert.ok(motor.utilizationPct < 80);
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
});

// (e) Paired staffing intervention on the fixture of (d) (arrival 30 s, A ideal x1, B x2; Wiring needs 2 operators per unit).
//     Same arrival and seed, only the machine and operator counts change. Engine totals (good + scrap) and Performance:
//     1 machine, 2 Wiring operators:        294 units (A 137+10, B 140+7), P 98.00% (ideal 60 s / 120 s; hand 60x147 + 120x147 = 26460 s).
//     2 machines, 2 operators (as in d):    293 units, P 73.17%: no output gain, the Wiring operators stay about 99% busy.
//     2 machines, 4 operators:              386 units (A 184+10, B 179+13), P 96.33% (hand 45x194 + 90x192 = 26010 s), OEE 90.33%
//                                           (hand good 45x184 + 90x179 = 24390 s). Motor utilization 99.7%: the limit moved to Motor.
//     1 machine, 4 operators (extra two assigned to the same station): 294 units, the extra operators 0% busy: no gain.
//     One arrival and one staffing pattern; it shows output followed Wiring operators in this fixture, not a general rule.
function staffed(machine: boolean, extraOps: boolean) {
  const p: any = parFixture(machine ? 'wiring' : 'none' as any, 30);
  if (extraOps) {
    for (const w of p.workers.filter((x: any) => /Wiring/.test(x.name) && !/extra/.test(x.name))) {
      const w2 = structuredClone(w); w2.id = w.id + 'x'; w2.name = w.name + ' extra'; w2.label = w.label + 'x';
      if (machine) w2.assignedStationId = 'obj_st_3b';
      p.workers.push(w2);
    }
  }
  return p;
}
test('Paired staffing intervention: a second Wiring machine adds output only with its own operators (one fixture)', () => {
  const units = (r: any) => r.productAnalytics.reduce((a: number, x: any) => a + x.completedGoodQty + x.scrappedQty, 0);
  const base = run(staffed(false, false)); const machineOnly = run(staffed(true, false)); const both = run(staffed(true, true)); const opsOnly = run(staffed(false, true));
  assert.equal(units(base), 294); near(base.kpis.performancePct, (26460 / 27000) * 100);
  assert.equal(units(machineOnly), 293); near(machineOnly.kpis.performancePct, (19755 / 27000) * 100);
  assert.deepEqual(both.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[184, 10], [179, 13]]);
  near(both.kpis.performancePct, (26010 / 27000) * 100); near(both.kpis.oeePct, (24390 / 27000) * 100);
  assert.ok(both.stageAnalytics.find((x: any) => x.stageId === 'stg_2_motor').utilizationPct > 99);
  assert.equal(units(opsOnly), 294);
});

// (f) Four auto products, full routes, default project, Packing batch 1, arrival 240 s: cycle multipliers 1, 2, 1.5, 3, mix 1:1:2:1.
//     Each product's ideal cycle is 60 s x multiplier (Electrical Wiring). Recorded good + scrap: A 20+2, P1 22+0, P2 41+2, P3 20+1.
//     Ideal work = 60x(1x22 + 2x22 + 1.5x43 + 3x21) = 11610 s over 27000 s: hand P = 43.00% (total 148 units).
//     Good work = 60x(1x20 + 2x22 + 1.5x41 + 3x20) = 60 x 185.5 = 11130 s: Q = 95.87%, OEE = 41.22%.
//     One mix and one arrival only; not a claim about other product counts, mixes or saturated lines.
test('Four products with different cycles: weighted OEE equals the hand figure (one fixture)', () => {
  const p: any = createDesertAirCoolerProject();
  for (const s of p.stages) if (s.id === 'stg_7_packing') { s.batchSize = 1; s.batchMode = 'none'; }
  const mult = [1, 2, 1.5, 3], mix = [1, 1, 2, 1];
  p.products[0].mixWeight = mix[0]; p.products[0].cycleTimeMultiplier = mult[0];
  for (let i = 1; i < 4; i++) { const B = structuredClone(p.products[0]); B.id = 'p' + i; B.name = 'P' + i; B.code = 'P' + i; B.mixWeight = mix[i]; B.cycleTimeMultiplier = mult[i]; p.products.push(B); }
  p.simulationConfig.arrivalIntervalSec = 240;
  const r = run(p);
  assert.deepEqual(r.productAnalytics.map((x: any) => [x.completedGoodQty, x.scrappedQty]), [[20, 2], [22, 0], [41, 2], [20, 1]]);
  near(r.kpis.performancePct, (11610 / 27000) * 100); near(r.kpis.qualityPct, (11130 / 11610) * 100); near(r.kpis.oeePct, (11130 / 27000) * 100);
  assert.equal(r.kpis.oeeMixedTimeWeighted, true);
});
