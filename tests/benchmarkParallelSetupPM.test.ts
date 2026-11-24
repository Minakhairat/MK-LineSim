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


function runCase(setup: number, pm: any[], T = 3600) {
  const m1 = makeMachine('m1', 'st1', 60, {}, 5, 4);
  const m2 = makeMachine('m2', 'st1', 60, {}, 5, 8);
  const st1 = makeStage('st1', ['m1', 'm2'], 60, { requiredMachines: 2, bufferCapacity: 500, setupTimeSec: setup });
  const proj: any = makeProject([m1, m2], [st1], { durationSec: T, arrivalIntervalSec: 20, enableBreakdowns: false });
  proj.simulationConfig.maintenanceWindows = pm;
  const r: any = new DiscreteEventSimulationEngine(proj).runToCompletion();
  return r;
}
// Hand derivation (observation window 3600 s, 2 identical machines, cycle 60 s, arrivals every 20 s so machine 1 starts at 0 and machine 2 at 20):
//  no setup: m1 completes at 60k (60 units), m2 at 80+60k (59 units) -> 119.
//  setup 100 s once per machine (engine semantics: setupDoneObjects, first unit only): m1 58, m2 58 -> 116; setup time total 200 s.
//  plus a plant maintenance window 1780..2080 (300 s) with pause-and-resume of a unit in process (engine semantics): 106 with setup, 109 without.
//  Availability = operating / scheduled production time, where planned maintenance is removed from scheduled time:
//  with setup + PM: (3300*2 - 200)/(3300*2) = 96.97%.
// These are consistency checks of the engine against hand calculation under the stated semantics, not external validation.
const PM = [{ id: 'pm1', name: 'PM', startSec: 1780, durationSec: 300 }];
test('Benchmark: two parallel machines, one-time setup and planned maintenance match hand derivation', () => {
  const a = runCase(0, []);
  assert.equal(a.kpis.goodUnits, 119);
  const b = runCase(100, []);
  assert.equal(b.kpis.goodUnits, 116);
  assert.equal(b.kpis.setupTimeSec, 200);
  const c = runCase(100, PM);
  assert.equal(c.kpis.goodUnits, 106);
  assert.equal(c.kpis.plannedDowntimeSec, 300);
  assert.ok(Math.abs(c.kpis.availabilityPct - (6400 / 6600) * 100) < 0.01, `A=${c.kpis.availabilityPct}`);
  const d = runCase(0, PM);
  assert.equal(d.kpis.goodUnits, 109);
  assert.ok(Math.abs(d.kpis.availabilityPct - 100) < 1e-6);
});
