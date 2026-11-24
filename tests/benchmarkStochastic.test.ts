import test from 'node:test';

import assert from 'node:assert/strict';
import { computeOeeMetrics } from '../src/engineering/oeeEngine';
import {
  computeEmpiricalStats,
  computeInherentAvailability,
  computeOperationalAvailability,
  createSeededRng,
  resolveObjectFailureParams,
  sampleRepairDurationSec,
  sampleTimeToFailureSec,
} from '../src/simulation/failureModels';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { LayoutObject, ProductionStage, ProjectData, SimulationConfig } from '../src/types/project';

function makeMachine(
  id: string,
  stageId: string,
  procSec: number,
  opsOverrides: Partial<LayoutObject['operations']> = {},
  posX = 5,
  posZ = 5
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'machine',
    category: 'cnc_machine',
    templateId: 'tpl_cnc',
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x: posX, y: 0, z: posZ },
      dimensions: { length: 2, width: 1.5, height: 1.5 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 1,
      requiredOperators: 0,
      ...opsOverrides,
    },
    rendering: { color: '#334155', visible: true, locked: false, layer: 'equipment' },
  };
}

function makeConveyor(
  id: string,
  lengthM: number,
  speedMps: number,
  opsOverrides: Partial<LayoutObject['operations']> = {},
  posX = 8,
  posZ = 5
): LayoutObject {
  return {
    id,
    name: id,
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conveyor',
    connectedToIds: [],
    geometry: {
      position: { x: posX, y: 0, z: posZ },
      dimensions: { length: lengthM, width: 0.8, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.2,
    },
    operations: {
      speedMps,
      direction: 1,
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 10,
      availability: 1,
      requiredOperators: 0,
      ...opsOverrides,
    },
    rendering: { color: '#475569', visible: true, locked: false, layer: 'conveyors' },
  };
}

function makeStage(
  id: string,
  assignedObjectIds: string[],
  procSec: number,
  overrides: Partial<ProductionStage> = {}
): ProductionStage {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    description: '',
    processingTimeSec: procSec,
    setupTimeSec: 0,
    loadingTimeSec: 0,
    unloadingTimeSec: 0,
    requiredWorkers: 0,
    requiredMachines: Math.max(1, assignedObjectIds.length),
    inputQty: 1,
    outputQty: 1,
    scrapRate: 0,
    reworkProbability: 0,
    bufferCapacity: 0,
    predecessorIds: [],
    successorIds: [],
    assignedObjectIds,
    ...overrides,
  };
}

function makeProject(
  objects: LayoutObject[],
  stages: ProductionStage[],
  cfgOverrides: Partial<SimulationConfig> = {},
  routeStageIds?: string[]
): ProjectData {
  const durationSec = cfgOverrides.durationSec ?? 3600;
  return {
    schemaVersion: '1.0.0',
    id: 'phase3_oee_test',
    name: 'Phase 3 OEE Test',
    factoryName: 'Test Plant',
    industryType: 'Manufacturing',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    factory: {
      name: 'Floor',
      lengthM: 60,
      widthM: 30,
      heightM: 6,
      unit: 'm',
      gridSizeM: 1,
      snapToGrid: true,
      columns: [],
      openings: [],
      zones: [],
    },
    productionLines: [],
    layoutObjects: objects,
    products: [
      {
        id: 'p1',
        code: 'P1',
        name: 'Part 1',
        category: 'Unit',
        dimensions: { length: 0.4, width: 0.4, height: 0.3 },
        weightKg: 2,
        color: '#2563EB',
        targetQuantity: 0,
        routeStageIds: routeStageIds ?? stages.map((s) => s.id),
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages,
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec,
      arrivalIntervalSec: 30,
      maxPlannedUnits: 0,
      speedMultiplier: 100,
      enableBreakdowns: false,
      randomSeed: 4219,
      shifts: [{ id: 's1', name: 'Day', startSec: 0, durationSec, breaks: [] }],
      maintenanceWindows: [],
      ...cfgOverrides,
    },
    scenarios: [],
  };
}

// Benchmark: end-to-end engine replications with stochastic (exponential) failures and repairs.
// Reference (independent derivation): inherent availability A = MTBF / (MTBF + MTTR), here 36000/(36000+1800) = 0.952381.
// Observation window: 1200000 s per replication (about 30 failures each), machine continuously busy (arrival 250 s < cycle 300 s, so the machine is almost always busy).
// Judge: reference must lie inside the 95% CI of the replication mean (n = 30 seeds, t = 2.045), and
// good units must lie between (uptime/300 - failures) and uptime/300 (a failure can lose at most one cycle of progress).
test('Benchmark: stochastic exponential failures, 30 replications, availability and output vs analytical reference', () => {
  const n = 30;
  const T = 1200000;
  const av: number[] = [];
  const checks: string[] = [];
  const lo=1,hi=n;for (let seed = lo; seed <= hi; seed++) {
    const m1 = makeMachine('m1', 'st1', 300, { failureModel: 'exponential', repairModel: 'exponential', mtbfSec: 36000, mttrSec: 1800 });
    const st1 = makeStage('st1', ['m1'], 300, { bufferCapacity: 100000 });
    const res: any = new DiscreteEventSimulationEngine(
      makeProject([m1], [st1], { durationSec: T, arrivalIntervalSec: 250, enableBreakdowns: true, randomSeed: seed })
    ).runToCompletion();
    const r = res.resourceAnalytics[0];
    av.push(1 - r.unplannedDowntimeSec / T);
    const up = T - r.unplannedDowntimeSec;
    const good = res.kpis.goodUnits;
    if (!(good <= up / 300 + 1 && good >= up / 300 - r.failureCount - 1)) checks.push(`seed ${seed}: good ${good}, up/300 ${(up / 300).toFixed(1)}, failures ${r.failureCount}`);
  }
  const mean = av.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(av.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const half = 2.045 * sd / Math.sqrt(n);
  const ref = 3600 / 3780;
  console.log(`availability mean ${mean.toFixed(5)} +/- ${half.toFixed(5)} (ref ${ref.toFixed(5)})`);
  assert.deepEqual(checks, []);
  assert.ok(Math.abs(mean - ref) <= half, `mean ${mean} CI half-width ${half} ref ${ref}`);
});
