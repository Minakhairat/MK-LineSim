import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { applyScenarioOverrides } from '../src/simulation/workerClient';
import { resolveProductMixWeights } from '../src/simulation/timeAuditService';
import { validateProject } from '../src/simulation/validator';
import {
  formatBeltSpeed,
  isStalledResult,
  leadTimeText,
  stallLocationNames,
  uniformBufferReplacesStages,
  isEventLogTruncated,
  oeeSummaryText,
} from '../src/utils/units';

function neutralOverrides(base: any) {
  return {
    workerCount: base.workers.length,
    processingTimeScale: 1,
    conveyorSpeedMps: base.layoutObjects.find((o: any) => o.kind === 'conveyor').operations.speedMps,
    shiftDurationSec: base.simulationConfig.durationSec,
    enableBreakdowns: base.simulationConfig.enableBreakdowns,
    targetProduction: base.simulationConfig.maxPlannedUnits,
  };
}

test('Scenario with unchanged overrides keeps per-stage buffers and reproduces the baseline run', () => {
  const base: any = createDesertAirCoolerProject();
  const sc = applyScenarioOverrides(structuredClone(base), neutralOverrides(base) as any);
  assert.deepEqual(sc.stages.map((s) => s.bufferCapacity), base.stages.map((s: any) => s.bufferCapacity));
  const a: any = new DiscreteEventSimulationEngine(structuredClone(base)).runToCompletion().kpis;
  const b: any = new DiscreteEventSimulationEngine(sc).runToCompletion().kpis;
  assert.equal(b.goodUnits, a.goodUnits);
  assert.equal(b.avgLeadTimeSec, a.avgLeadTimeSec);
});

test('An explicit buffer override equal to the first stage value is honoured (applies to all stages)', () => {
  const base: any = createDesertAirCoolerProject();
  const first = base.stages[0].bufferCapacity;
  const sc = applyScenarioOverrides(structuredClone(base), { ...neutralOverrides(base), bufferCapacity: first } as any);
  assert.ok(sc.stages.every((s) => s.bufferCapacity === first));
});

test('Scenario buffer override applies to all stages and allows zero', () => {
  const base: any = createDesertAirCoolerProject();
  const sc0 = applyScenarioOverrides(structuredClone(base), { ...neutralOverrides(base), bufferCapacity: 0 } as any);
  assert.ok(sc0.stages.every((s) => s.bufferCapacity === 0));
  const sc7 = applyScenarioOverrides(structuredClone(base), { ...neutralOverrides(base), bufferCapacity: 7 } as any);
  assert.ok(sc7.stages.every((s) => s.bufferCapacity === 7));
});

test('Shortened shift: a break outside or crossing the new end does not change engine results (no clipping needed)', () => {
  const base: any = createDesertAirCoolerProject();
  for (const dur of [3600, 15300]) {
    const kpi = (clipBreaks: boolean) => {
      const q: any = structuredClone(base);
      q.simulationConfig.durationSec = dur;
      q.simulationConfig.shifts[0].durationSec = dur;
      if (clipBreaks) q.simulationConfig.shifts[0].breaks = [];
      const e: any = new DiscreteEventSimulationEngine(q);
      const r: any = e.runToCompletion();
      assert.equal(e.auditInvariants().violations.length, 0);
      assert.equal(e.auditInvariants().conservation.unaccountedUnits, 0);
      return [r.kpis.throughputPerHour, r.kpis.goodUnits ?? r.kpis.completedGoodQty];
    };
    if (dur === 3600) assert.deepEqual(kpi(false), kpi(true));
    else assert.ok(kpi(false)[0] > 0);
  }
});

test('cycleTimeMultiplier flows into theoretical capacity, performance and OEE', () => {
  const run = (m: number) => {
    const p: any = createDesertAirCoolerProject();
    p.products.forEach((x: any) => (x.cycleTimeMultiplier = m));
    p.simulationConfig.maxPlannedUnits = 0;
    p.simulationConfig.arrivalIntervalSec = 30;
    p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
    return new DiscreteEventSimulationEngine(p).runToCompletion().kpis as any;
  };
  const k1 = run(1), k2 = run(2);
  assert.ok(Math.abs(k2.theoreticalThroughputPerHour - k1.theoreticalThroughputPerHour / 2) < 1e-6);
  assert.ok(Math.abs(k2.theoreticalBottleneckCycleSec - 2 * k1.theoreticalBottleneckCycleSec) < 1e-6);
  assert.ok(k2.performancePct > 90, `performance ${k2.performancePct} should not show a false 50% loss`);
});

function twoProducts(rule: string, a: any, b: any, maxUnits = 0) {
  const p: any = createDesertAirCoolerProject();
  p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
  p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = 50; // avoids the mixed-SKU batch stall, tested separately
  Object.assign(p.products[0], a);
  const B = structuredClone(p.products[0]);
  B.id = 'B'; B.code = 'B'; Object.assign(B, b);
  p.products.push(B);
  p.routes.push({ ...p.routes[0], id: 'route_B', productId: 'B' });
  p.simulationConfig.maxPlannedUnits = maxUnits;
  p.simulationConfig.arrivalIntervalSec = 20;
  p.simulationConfig.dispatchingRule = rule;
  p.simulationConfig.shifts[0].breaks = [];
  return new DiscreteEventSimulationEngine(p).runToCompletion().kpis as any;
}

test('Mixed-product theoretical capacity follows the DES dispatch mix (mixWeight 3:1, cycle x1 and x2)', () => {
  // mix-average multiplier = (3*1 + 1*2)/4 = 1.25 -> 60/1.25 = 48 units/h; DES measured ~46.5 incl. start-up fill
  const k = twoProducts('weighted_mix', { mixWeight: 3, targetQuantity: 0, cycleTimeMultiplier: 1 }, { mixWeight: 1, targetQuantity: 0, cycleTimeMultiplier: 2 });
  assert.ok(Math.abs(k.theoreticalThroughputPerHour - 48) < 0.5, `theory ${k.theoreticalThroughputPerHour}`);
  assert.ok(k.throughputPerHour <= k.theoreticalThroughputPerHour + 1e-9);
  assert.ok(k.throughputPerHour > 0.9 * k.theoreticalThroughputPerHour);
});

test('Mixed-product theoretical capacity under round_robin uses equal shares (x1 and x2 -> 40 units/h)', () => {
  const k = twoProducts('round_robin', { targetQuantity: 0, cycleTimeMultiplier: 1 }, { targetQuantity: 0, cycleTimeMultiplier: 2 });
  assert.ok(Math.abs(k.theoreticalThroughputPerHour - 40) < 0.5, `theory ${k.theoreticalThroughputPerHour}`);
  assert.ok(k.throughputPerHour <= k.theoreticalThroughputPerHour + 1e-9);
});

function skuProject(k: number, packBuf: number) {
  const p: any = createDesertAirCoolerProject();
  p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
  const A = p.products[0];
  A.targetQuantity = 0;
  for (let i = 1; i < k; i++) {
    const B = structuredClone(A); B.id = 'B' + i; B.code = 'B' + i;
    p.products.push(B);
  }
  p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = packBuf;
  p.simulationConfig.maxPlannedUnits = 0;
  p.simulationConfig.arrivalIntervalSec = 20;
  p.simulationConfig.shifts[0].breaks = [];
  return p;
}

test('SKU-grouped batching: stall boundary is k*(batch-1)+1 and validation warns exactly below it', () => {
  for (const k of [2, 3, 4]) {
    const need = k * 3 + 1; // sample packing stage: batch size 4
    const low = skuProject(k, need - 1);
    const ok = skuProject(k, need);
    const eLow: any = new DiscreteEventSimulationEngine(low);
    const eOk: any = new DiscreteEventSimulationEngine(ok);
    const rLow: any = eLow.runToCompletion();
    const rOk: any = eOk.runToCompletion();
    assert.equal(rLow.kpis.completedGoodQty ?? rLow.kpis.goodUnits ?? 0, 0, `k=${k} buf=${need - 1} should stall`);
    assert.ok((rOk.kpis.completedGoodQty ?? rOk.kpis.goodUnits ?? 0) > 0, `k=${k} buf=${need} should flow`);
    assert.ok(validateProject(low).some((i) => i.code === 'BATCH_BUFFER_MAY_STALL'));
    assert.ok(!validateProject(ok).some((i) => i.code === 'BATCH_BUFFER_MAY_STALL'));
    assert.ok(eLow.auditInvariants().deadlocks.length > 0, 'stall must be reported as a deadlock');
    assert.equal(eOk.auditInvariants().deadlocks.length, 0);
  }
});

test('Single product never triggers the batch buffer warning', () => {
  assert.ok(!validateProject(skuProject(1, 4)).some((i) => i.code === 'BATCH_BUFFER_MAY_STALL'));
});

test('Buffer occupancy never exceeds capacity at saturation (in-transit slot held until arrival)', () => {
  for (const [k, buf] of [[1, 5], [2, 5], [3, 8], [4, 13]]) {
    const e: any = new DiscreteEventSimulationEngine(skuProject(k, buf));
    e.runToCompletion();
    const a = e.auditInvariants();
    assert.deepEqual(a.violations.filter((v: string) => v.includes('INV_BUFFER_OVERFLOW')), [], `k=${k} buf=${buf}`);
  }
});

test('resolveProductMixWeights agrees with the DES release split for each dispatch rule and for quotas', () => {
  const cases: Array<[string, any, any]> = [
    ['weighted_mix', { mixWeight: 3, targetQuantity: 0 }, { mixWeight: 1, targetQuantity: 0 }],
    ['round_robin', { mixWeight: 3, targetQuantity: 0 }, { mixWeight: 1, targetQuantity: 0 }],
    ['fixed_sequence', { mixWeight: 3, targetQuantity: 0 }, { mixWeight: 1, targetQuantity: 0 }],
    ['weighted_mix', { mixWeight: 1, targetQuantity: 100 }, { mixWeight: 1, targetQuantity: 300 }],
    ['round_robin', { mixWeight: 1, targetQuantity: 100 }, { mixWeight: 1, targetQuantity: 300 }],
  ];
  for (const [rule, a, b] of cases) {
    const p: any = createDesertAirCoolerProject();
    p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
    p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = 50;
    Object.assign(p.products[0], a);
    const B = structuredClone(p.products[0]); B.id = 'B'; B.code = 'B'; Object.assign(B, b);
    p.products.push(B);
    p.simulationConfig.maxPlannedUnits = 0;
    p.simulationConfig.arrivalIntervalSec = 20;
    p.simulationConfig.dispatchingRule = rule;
    p.simulationConfig.shifts[0].breaks = [];
    const r: any = new DiscreteEventSimulationEngine(p).runToCompletion();
    const rel = r.productAnalytics.map((x: any) => x.releasedQty as number);
    const w = resolveProductMixWeights(p);
    const share = rel[0] / (rel[0] + rel[1]);
    const expected = w[0] / (w[0] + w[1]);
    assert.ok(Math.abs(share - expected) < 0.03, `${rule} ${JSON.stringify([a, b])}: released ${rel} vs weights ${w}`);
  }
});

test('Manual-routing products are reported as untraced, never as an all-clear', () => {
  const p: any = skuProject(2, 5);
  p.products.forEach((pr: any) => { pr.routingMode = 'manual'; pr.entryStageIds = [p.stages[0].id]; });
  const codes = validateProject(p).map((i) => i.code);
  assert.ok(codes.includes('BATCH_BUFFER_MAY_STALL_UNTRACED'));
  assert.ok(!codes.includes('BATCH_BUFFER_MAY_STALL'));
});

{
  const mk = (buf: number) => {
    const p: any = createDesertAirCoolerProject();
    p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
    p.products[0].targetQuantity = 0;
    const B = structuredClone(p.products[0]); B.id = 'B1'; B.code = 'B1';
    p.products.push(B); p.routes.push({ ...p.routes[0], id: 'route_B1', productId: 'B1' });
    p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = buf;
    p.simulationConfig.maxPlannedUnits = 0; p.simulationConfig.arrivalIntervalSec = 20;
    p.simulationConfig.dispatchingRule = 'weighted_mix'; p.simulationConfig.shifts[0].breaks = [];
    return new DiscreteEventSimulationEngine(p).runToCompletion();
  };
  test('reports the stalled stage in the result, and nothing when the buffer is enough', () => {
    assert.ok((mk(6).stallWarnings || []).some((w) => w.stageId === 'stg_7_packing'));
    assert.equal((mk(7).stallWarnings || []).length, 0);
  });
}

{
  const mkQ = (tA: number, tB: number, buf: number) => {
    const p: any = createDesertAirCoolerProject();
    p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
    p.products[0].targetQuantity = tA;
    const B = structuredClone(p.products[0]); B.id = 'B1'; B.code = 'B1'; B.targetQuantity = tB;
    p.products.push(B); p.routes.push({ ...p.routes[0], id: 'route_B1', productId: 'B1' });
    p.stages.find((s: any) => s.id === 'stg_7_packing').bufferCapacity = buf;
    p.simulationConfig.maxPlannedUnits = 0; p.simulationConfig.arrivalIntervalSec = 20;
    p.simulationConfig.shifts[0].breaks = [];
    return new DiscreteEventSimulationEngine(p).runToCompletion();
  };
  test('stall with quotas used up is flagged; leftover partial batches are not', () => {
    const stalled = mkQ(6, 6, 6);
    assert.equal(stalled.kpis.goodUnits, 0);
    assert.ok((stalled.stallWarnings || []).length > 0);
    for (const [a, b, buf] of [[7, 0, 8], [3, 1, 4], [3, 1, 20], [2, 2, 4], [6, 6, 20]]) {
      assert.equal((mkQ(a, b, buf).stallWarnings || []).length, 0, `quota ${a}/${b} buf ${buf}`);
    }
  });
}

test('availability 0 with MTBF/MTTR set raises a reliability conflict warning; sample has none', async () => {
  const { runEngineeringValidations } = await import('../src/engineering/validationEngine');
  const base: any = createDesertAirCoolerProject();
  assert.equal(runEngineeringValidations(base).filter((i) => i.code === 'CONFLICTING_RELIABILITY_PARAMS').length, 0);
  const p: any = createDesertAirCoolerProject();
  p.simulationConfig.enableBreakdowns = true;
  const m = p.layoutObjects.find((o: any) => o.kind === 'machine' || o.kind === 'workstation');
  m.operations.availability = 0; m.operations.mtbfSec = 3600; m.operations.mttrSec = 300;
  assert.ok(runEngineeringValidations(p).some((i) => i.code === 'CONFLICTING_RELIABILITY_PARAMS' && i.targetId === m.id));
});

test('scenario target production 0 keeps the unlimited meaning; positive values still apply', () => {
  const p: any = createDesertAirCoolerProject();
  p.simulationConfig.maxPlannedUnits = 0;
  const ov = { workerCount: 10, processingTimeScale: 1, conveyorSpeedMps: 0.5, shiftDurationSec: 28800, enableBreakdowns: false, targetProduction: 0 } as any;
  const q = applyScenarioOverrides(p, ov);
  assert.equal(q.simulationConfig.maxPlannedUnits, 0);
  assert.ok(new DiscreteEventSimulationEngine(q).runToCompletion().kpis.goodUnits > 100);
  assert.equal(applyScenarioOverrides(p, { ...ov, targetProduction: 50 }).simulationConfig.maxPlannedUnits, 50);
});

test('avgBatchSize reports units per batch at the batch stage even with scrap', () => {
  for (const sc of [0, 0.25]) {
    const p: any = createDesertAirCoolerProject();
    p.stages.forEach((s: any) => { s.scrapRate = 0; s.reworkProbability = 0; });
    p.stages.find((s: any) => s.id === 'stg_7_packing').scrapRate = sc;
    const r: any = new DiscreteEventSimulationEngine(p).runToCompletion();
    assert.ok(Math.abs(r.kpis.avgBatchSize - 4) < 0.05, `scrap ${sc}: ${r.kpis.avgBatchSize}`);
  }
});

function twoProductProject(): any {
  const p: any = createDesertAirCoolerProject();
  const b = structuredClone(p.products[0]);
  b.id = 'B1';
  b.code = 'B1';
  p.products.push(b);
  // Packing is the batch stage (batch of 4). Give it a buffer large enough for two products, as in the audit project.
  p.stages.find((s: any) => s.name === 'Packing').bufferCapacity = 20;
  return p;
}

const stallBase: any = {
  workerCount: 10,
  processingTimeScale: 1,
  conveyorSpeedMps: 0.05,
  shiftDurationSec: 28800,
  enableBreakdowns: false,
  targetProduction: 600,
};

function run(p: any, bufferCapacity?: number) {
  const m = applyScenarioOverrides(structuredClone(p), { ...stallBase, bufferCapacity });
  return new DiscreteEventSimulationEngine(m).runToCompletion() as any;
}

test('shipped baseline scenario keeps per-stage buffers (no uniform override)', () => {
  const p: any = createDesertAirCoolerProject();
  const baseline = p.scenarios.find((s: any) => s.isBaseline);
  assert.equal(baseline.overrides.bufferCapacity, undefined);
});

test('uniform buffer override replaces per-stage buffers, and the helper detects it', () => {
  const p = twoProductProject();
  const packing = p.stages.find((s: any) => s.bufferCapacity === 20);
  assert.ok(packing, 'sample has a stage with buffer 20');
  assert.equal(uniformBufferReplacesStages(p.stages, undefined), false);
  assert.equal(uniformBufferReplacesStages(p.stages, 4), true);
  const m = applyScenarioOverrides(structuredClone(p), { ...stallBase, bufferCapacity: 4 });
  assert.ok(m.stages.every((s: any) => s.bufferCapacity === 4));
  const same = applyScenarioOverrides(structuredClone(p), { ...stallBase, bufferCapacity: undefined });
  assert.equal(same.stages.find((s: any) => s.id === packing.id)!.bufferCapacity, 20);
});

test('two-product batch stage: uniform buffer 4 is flagged as a stall, per-stage buffers flow', () => {
  const p = twoProductProject();
  const stalled = run(p, 4);
  assert.equal(isStalledResult(stalled), true);
  assert.equal(stalled.kpis.goodUnits, 0);
  assert.equal(stallLocationNames(stalled), 'Packing');
  assert.equal(leadTimeText(stalled.kpis.avgLeadTimeSec), '—');
  const ok = run(p, undefined);
  assert.equal(isStalledResult(ok), false);
  assert.ok(ok.kpis.goodUnits > 0);
  assert.equal(stallLocationNames(ok), '');
  assert.notEqual(leadTimeText(ok.kpis.avgLeadTimeSec), '—');
});

test('presentation helpers', () => {
  assert.equal(leadTimeText(0), '—');
  assert.equal(leadTimeText(0, '-'), '-');
  assert.notEqual(leadTimeText(61), '—');
  assert.equal(formatBeltSpeed(0.05), '0.05');
  assert.equal(formatBeltSpeed(0.0500534), '0.0501');
  assert.equal(formatBeltSpeed(0.0534), '0.0534');
  assert.equal(isStalledResult(undefined), false);
  assert.equal(isStalledResult({ stallWarnings: [] } as any), false);
});

test('OEE summary text: no output explains undefined P and Q; output keeps the A x P x Q line; engine value untouched', () => {
  const none = oeeSummaryText({ oeePct: 0, availabilityPct: 100, performancePct: 0, qualityPct: 0, actualProduction: 0 }, false);
  assert.match(none, /^0\.0% \(no output/);
  assert.ok(!none.includes('—'));
  const ar = oeeSummaryText({ oeePct: 0, actualProduction: 0 }, true);
  assert.ok(ar.includes('لا إنتاج'));
  const some = oeeSummaryText({ oeePct: 45, availabilityPct: 90, performancePct: 80, qualityPct: 62.5, actualProduction: 10 }, false);
  assert.equal(some, '45.0% = A 90.0% × P 80.0% × Q 62.5%');
});

test('Event log truncation: engine caps the log at 25,000 entries and the helper detects it', () => {
  assert.equal(isEventLogTruncated(100, 100), false);
  assert.equal(isEventLogTruncated(25000, 26448), true);
  assert.equal(isEventLogTruncated(5, undefined), false);
  const base: any = createDesertAirCoolerProject();
  const e: any = new DiscreteEventSimulationEngine(structuredClone(base));
  const r: any = e.runToCompletion();
  const logged = e.getAllEvents().length;
  assert.equal(logged, Math.min(25000, r.totalEventsExecuted));
  assert.equal(isEventLogTruncated(logged, r.totalEventsExecuted), r.totalEventsExecuted > 25000);
});

test('A hidden layout object that a stage uses is still checked for bad dimensions', () => {
  const p: any = createDesertAirCoolerProject();
  const oid = p.stages[0].assignedObjectIds[0];
  const o = p.layoutObjects.find((x: any) => x.id === oid);
  o.geometry.dimensions.length = 0;
  o.rendering.visible = false;
  const codes = validateProject(p).filter((i: any) => i.severity === 'error').map((i: any) => i.code);
  assert.ok(codes.includes('INVALID_DIMENSIONS'));
  const q: any = createDesertAirCoolerProject();
  const unused = q.layoutObjects.find((x: any) => !q.stages.some((s: any) => s.assignedObjectIds.includes(x.id) || s.conveyorObjectId === x.id));
  if (unused) {
    unused.geometry.dimensions.length = 0;
    unused.rendering.visible = false;
    assert.equal(validateProject(q).filter((i: any) => i.severity === 'error').length, 0);
  }
});
