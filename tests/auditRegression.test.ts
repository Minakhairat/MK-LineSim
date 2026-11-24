import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { applyScenarioOverrides } from '../src/simulation/workerClient';
import { resolveProductMixWeights } from '../src/simulation/timeAuditService';
import { validateProject } from '../src/simulation/validator';

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
