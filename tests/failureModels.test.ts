import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveObjectFailureParams,
  sampleRepairDurationSec,
  sampleTimeToFailureSec,
} from '../src/simulation/failureModels';
import { LayoutObject, SimulationConfig } from '../src/types/project';

function makeMachine(ops: Partial<LayoutObject['operations']>): LayoutObject {
  return {
    id: 'm1',
    name: 'Press',
    kind: 'machine',
    category: 'hydraulic_press',
    templateId: 'tpl_press',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 2 },
      rotationDeg: 0,
      clearanceM: 0.4,
    },
    operations: {
      processingTimeSec: 30,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 0.9,
      requiredOperators: 1,
      ...ops,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

function makeCfg(enableBreakdowns = true): SimulationConfig {
  return {
    durationSec: 28800,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 0,
    speedMultiplier: 1,
    enableBreakdowns,
    randomSeed: 4219,
    shifts: [{ id: 's1', name: 'Day', startSec: 0, durationSec: 28800, breaks: [] }],
  };
}

function makeRng(seed = 12345): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('FailureModels handles fixed, exponential, and Weibull failure sampling + triangular repair', () => {
  const cfg = makeCfg(true);

  const fixedParams = resolveObjectFailureParams(
    makeMachine({ failureModel: 'fixed', repairModel: 'fixed', mtbfSec: 900, mttrSec: 120 }),
    cfg
  );
  assert.equal(fixedParams.enabled, true);
  assert.equal(sampleTimeToFailureSec(fixedParams, makeRng()), 900);
  assert.equal(sampleRepairDurationSec(fixedParams, makeRng()), 120);

  const weibullParams = resolveObjectFailureParams(
    makeMachine({
      failureModel: 'weibull',
      weibullShape: 2.0,
      repairModel: 'triangular',
      mtbfSec: 1000,
      mttrSec: 100,
    }),
    cfg
  );
  const rng = makeRng(99);
  const ttfSamples = Array.from({ length: 200 }, () => sampleTimeToFailureSec(weibullParams, rng));
  const repSamples = Array.from({ length: 200 }, () => sampleRepairDurationSec(weibullParams, rng));

  assert.ok(ttfSamples.every((v) => Number.isFinite(v) && v > 0));
  assert.ok(repSamples.every((v) => v >= 50 && v <= 150));

  const disabled = resolveObjectFailureParams(makeMachine({ availability: 0.9 }), makeCfg(false));
  assert.equal(disabled.enabled, false);
});
