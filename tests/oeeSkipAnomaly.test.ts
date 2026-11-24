import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';

// Documents CURRENT behaviour, not correctness. Line OEE takes its ideal cycle from the slowest stage in the
// project (OP-30, 60 s) even when an auto route skips it, so Performance exceeds 100%.
// The engine flags this as performanceAnomaly; the Analytics UI shows a warning when the flag is set.
{
  const run = (skip: boolean) => {
    const p: any = createDesertAirCoolerProject();
    const A = p.products[0];
    A.routingMode = 'auto';
    if (skip) {
      A.routeStageIds = A.routeStageIds.filter((x: string) => x !== 'stg_3_wiring');
      A.entryStageIds = [A.routeStageIds[0]];
    }
    return (new DiscreteEventSimulationEngine(p) as any).runToCompletion().kpis;
  };
  test('OEE skipped-stage: full route has no anomaly and performance at most 100%', () => {
    const k = run(false);
    assert.equal(k.performanceAnomaly, false);
    assert.ok(k.performancePct <= 100);
  });
  // Hand-derived: single auto product skipping OP-30 (60 s): route pacemaker is OP-20 at 45 s.
  // Arrival 45 s: 583 units in the run; Performance = 45 s x units / operating time, no longer above 100%.
  test('OEE skipped-stage (scoped fix, single auto product): ideal cycle comes from the route pacemaker', () => {
    const k = run(true);
    assert.equal(k.theoreticalBottleneckStageId, 'stg_2_motor');
    assert.equal(k.theoreticalBottleneckCycleSec, 45);
    assert.equal(k.performanceAnomaly, false);
    assert.ok(k.performancePct <= 100);
  });
}

import { oeeBasisUsesSkippedStage } from '../src/utils/oeeBasis';

test('single auto product skipping OP-30 at arrival 60: Performance = 97.3 (same run, 60 s basis) x 45/60 = 72.975% (hand arithmetic; the full-route 97.8 is a different run), basis on route', () => {
  const p: any = createDesertAirCoolerProject();
  p.simulationConfig.arrivalIntervalSec = 60;
  const A = p.products[0];
  A.routingMode = 'auto';
  A.routeStageIds = A.routeStageIds.filter((x: string) => x !== 'stg_3_wiring');
  A.entryStageIds = [A.routeStageIds[0]];
  const k = (new DiscreteEventSimulationEngine(p) as any).runToCompletion().kpis;
  assert.ok(Math.abs(k.performancePct - 73.0) < 0.5, 'got ' + k.performancePct);
  assert.equal(k.theoreticalBottleneckStageId, 'stg_2_motor');
  assert.equal(oeeBasisUsesSkippedStage(p.products, k.theoreticalBottleneckStageId), false);
});

test('single auto product, full route: unchanged (Electrical Wiring 60 s, line efficiency 57.29%)', () => {
  const p: any = createDesertAirCoolerProject();
  const k = (new DiscreteEventSimulationEngine(p) as any).runToCompletion().kpis;
  assert.equal(k.theoreticalBottleneckStageId, 'stg_3_wiring');
  assert.ok(Math.abs(k.lineEfficiencyPct - 57.29) < 0.01);
});

test('two products, one skipping OP-30: still all-stages basis (unsupported case stays qualified)', () => {
  const p: any = createDesertAirCoolerProject();
  const B = structuredClone(p.products[0]);
  B.id = 'prodB'; B.code = 'B';
  p.products.push(B);
  p.products[0].routingMode = 'auto';
  p.products[0].routeStageIds = p.products[0].routeStageIds.filter((x: string) => x !== 'stg_3_wiring');
  p.products[0].entryStageIds = [p.products[0].routeStageIds[0]];
  const k = (new DiscreteEventSimulationEngine(p) as any).runToCompletion().kpis;
  assert.equal(k.theoreticalBottleneckStageId, 'stg_3_wiring');
});

test('oeeBasisUsesSkippedStage: false for full route, manual products, empty route, or no stage id', () => {
  const full = [{ routingMode: 'auto', routeStageIds: ['a', 'b'] }];
  assert.equal(oeeBasisUsesSkippedStage(full, 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage([{ routingMode: 'manual', routeStageIds: ['a'] }], 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage([{ routingMode: 'auto', routeStageIds: [] }], 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage(full, undefined), false);
  assert.equal(oeeBasisUsesSkippedStage(full, 'z'), true);
});

test('single auto product skipping OP-30: line balance hand-derived 215 / (7 x 45) = 68.25%, throughput cap uses current arrival (3600/55)', async () => {
  const { auditProjectTiming } = await import('../src/simulation/timeAuditService');
  const p: any = createDesertAirCoolerProject();
  const A = p.products[0];
  A.routingMode = 'auto';
  A.routeStageIds = A.routeStageIds.filter((x: string) => x !== 'stg_3_wiring');
  A.entryStageIds = [A.routeStageIds[0]];
  const t: any = auditProjectTiming(p);
  assert.ok(Math.abs(t.lineBalanceEfficiencyPct - (215 / 315) * 100) < 1e-6);
  assert.ok(Math.abs(t.effectiveTheoreticalThroughputPerHour - 3600 / 55) < 1e-6);
  p.simulationConfig.arrivalIntervalSec = 60;
  assert.ok(Math.abs((auditProjectTiming(p) as any).effectiveTheoreticalThroughputPerHour - 60) < 1e-6);
});
