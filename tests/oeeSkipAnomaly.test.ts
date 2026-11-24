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
  test('OEE skipped-stage (KNOWN LIMITATION): skipping OP-30 gives performance above 100% and sets the anomaly flag', () => {
    const k = run(true);
    assert.ok(k.performancePct > 100);
    assert.equal(k.performanceAnomaly, true);
  });
}

import { oeeBasisUsesSkippedStage } from '../src/utils/oeeBasis';

test('oeeBasisUsesSkippedStage: detects an auto route that skips the project slowest stage, even with Performance below 100%', () => {
  const p: any = createDesertAirCoolerProject();
  p.simulationConfig.arrivalIntervalSec = 60;
  const A = p.products[0];
  A.routingMode = 'auto';
  A.routeStageIds = A.routeStageIds.filter((x: string) => x !== 'stg_3_wiring');
  A.entryStageIds = [A.routeStageIds[0]];
  const k = (new DiscreteEventSimulationEngine(p) as any).runToCompletion().kpis;
  // Current behaviour: no anomaly flag and Performance below 100%, but the ideal cycle still comes from OP-30 (60 s).
  assert.equal(k.performanceAnomaly, false);
  assert.ok(k.performancePct < 100);
  assert.equal(k.theoreticalBottleneckStageId, 'stg_3_wiring');
  assert.equal(oeeBasisUsesSkippedStage(p.products, k.theoreticalBottleneckStageId), true);
});

test('oeeBasisUsesSkippedStage: false for full route, manual products, empty route, or no stage id', () => {
  const full = [{ routingMode: 'auto', routeStageIds: ['a', 'b'] }];
  assert.equal(oeeBasisUsesSkippedStage(full, 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage([{ routingMode: 'manual', routeStageIds: ['a'] }], 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage([{ routingMode: 'auto', routeStageIds: [] }], 'b'), false);
  assert.equal(oeeBasisUsesSkippedStage(full, undefined), false);
  assert.equal(oeeBasisUsesSkippedStage(full, 'z'), true);
});
