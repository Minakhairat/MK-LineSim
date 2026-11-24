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
