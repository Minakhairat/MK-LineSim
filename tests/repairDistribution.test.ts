import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeededRng,
  lognormalParamsFromArithmeticMoments,
  resolveObjectFailureParams,
  sampleRepairDurationSec,
} from '../src/simulation/failureModels';

import { LayoutObject, SimulationConfig } from '../src/types/project';

test('Method-of-Moments converts arithmetic mean & stdDev to lognormal mu & sigma accurately', () => {
  const { mu, sigma } = lognormalParamsFromArithmeticMoments(120, 60);
  const analyticalMean = Math.exp(mu + (sigma * sigma) / 2);
  const analyticalStdDev = Math.sqrt((Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma));

  assert.ok(Math.abs(analyticalMean - 120) < 1e-6);
  assert.ok(Math.abs(analyticalStdDev - 60) < 1e-6);
});

test('Log-Normal repair sampling is deterministic, positive, and reproduces mean & stdDev over N=5000', () => {
  const machine: LayoutObject = {
    id: 'm_test',
    name: 'Test Machine',
    kind: 'machine',
    category: 'cnc_machine',
    templateId: 'tpl_cnc',
    connectedToIds: [],
    geometry: {
      position: { x: 5, y: 0, z: 5 },
      dimensions: { length: 2, width: 1.5, height: 1.5 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: 30,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 0.95,
      requiredOperators: 0,
      failureModel: 'exponential',
      repairModel: 'lognormal',
      mtbfSec: 3600,
      mttrSec: 120,
      mttrStdDevSec: 60,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
  const cfg: SimulationConfig = {
    durationSec: 28800,
    arrivalIntervalSec: 30,
    maxPlannedUnits: 0,
    speedMultiplier: 1,
    enableBreakdowns: true,
    randomSeed: 13579,
    shifts: [{ id: 's1', name: 'Day', startSec: 0, durationSec: 28800, breaks: [] }],
  };

  const params = resolveObjectFailureParams(machine, cfg);

  const rngA = createSeededRng(13579);
  const rngB = createSeededRng(13579);
  const samples: number[] = [];
  for (let i = 0; i < 5000; i++) {
    const vA = sampleRepairDurationSec(params, rngA);
    const vB = sampleRepairDurationSec(params, rngB);
    assert.equal(vA, vB);
    assert.ok(Number.isFinite(vA) && vA > 0);
    samples.push(vA);
  }

  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const variance = samples.reduce((s, x) => s + (x - mean) * (x - mean), 0) / samples.length;
  const stdDev = Math.sqrt(variance);

  assert.ok(Math.abs(mean - 120) <= 3.0, `Expected mean ~120s, got ${mean}`);
  assert.ok(Math.abs(stdDev - 60) <= 4.0, `Expected stdDev ~60s, got ${stdDev}`);
});

test('Log-Normal with mttrStdDevSec=0 returns exact deterministic mttrSec', () => {
  const rng = createSeededRng(42);
  const val = sampleRepairDurationSec(
    {
      enabled: true,
      failureModel: 'exponential',
      repairModel: 'lognormal',
      mtbfSec: 3600,
      mttrSec: 95,
      mttrStdDevSec: 0,
      weibullShape: 2,
      weibullScaleSec: 3600,
      availability: 0.95,
    },
    rng
  );
  assert.equal(val, 95);
});
