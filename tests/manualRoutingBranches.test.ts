import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
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


// Split-and-rejoin graph: s1 (5 s) -> A (20 s) or B (40 s) -> s4 (10 s). One machine per stage, arrivals every 5 s, 3600 s.
// Hand derivation: branch A can pass at most 3600/20 = 180 units, branch B at most 3600/40 = 90, so the line cannot exceed 270.
// The engine result is 268 (the last units are still in process at 3600 s). Consistency check under stated semantics, not external validation.
function graph(buf: number, products: number) {
  const objs = [makeMachine('m1', 's1', 5, {}, 5, 4), makeMachine('ma', 'sa', 20, {}, 10, 4), makeMachine('mb', 'sb', 40, {}, 15, 4), makeMachine('m4', 's4', 10, {}, 20, 4)];
  const stages = [
    makeStage('s1', ['m1'], 5, { successorIds: ['sa', 'sb'], bufferCapacity: 2 }),
    makeStage('sa', ['ma'], 20, { predecessorIds: ['s1'], successorIds: ['s4'], bufferCapacity: buf }),
    makeStage('sb', ['mb'], 40, { predecessorIds: ['s1'], successorIds: ['s4'], bufferCapacity: buf }),
    makeStage('s4', ['m4'], 10, { predecessorIds: ['sa', 'sb'], bufferCapacity: buf === 10 ? 10 : 2 }),
  ];
  const p: any = makeProject(objs, stages, { durationSec: 3600, arrivalIntervalSec: 5 });
  const A = p.products[0];
  A.routingMode = 'manual'; A.entryStageIds = ['s1']; A.routeStageIds = ['s1', 'sa', 's4'];
  if (products === 2) {
    const B = structuredClone(A); B.id = 'B'; B.code = 'B'; B.routeStageIds = ['s1', 'sb', 's4']; p.products.push(B);
    p.simulationConfig.dispatchingRule = 'weighted_mix';
  }
  const e: any = new DiscreteEventSimulationEngine(p);
  const r: any = e.runToCompletion();
  return { r, audit: e.auditInvariants() };
}

test('Split and rejoin with unequal branches stays within the hand bound and conserves units', () => {
  for (const buf of [0, 2, 10]) {
    const { r, audit } = graph(buf, 1);
    assert.ok(r.kpis.goodUnits <= 270, `buffer ${buf}: ${r.kpis.goodUnits} exceeds the 270 bound`);
    assert.ok(r.kpis.goodUnits >= 260, `buffer ${buf}: ${r.kpis.goodUnits} is far below the bound`);
    assert.equal(audit.conservation.unaccountedUnits, 0);
    assert.equal((audit.violations || []).length, 0);
    assert.equal((r.stallWarnings || []).length, 0);
  }
});

// KNOWN LIMITATION, NOT CORRECT BEHAVIOUR: this test records what the engine does today and must be updated if routing is fixed.
// For a product with routingMode 'manual' only the entry stage is taken from the product; the next stage is chosen from the
// shared stage graph (successorIds), not from the product's own routeStageIds. Passing here does not mean the routing is right.
// Evidence: product B declares route s1 -> sb -> s4, yet completes more than sb alone could process (3600/40 = 90).
test('Manual-routing semantics: per-product routeStageIds are not used after the entry stage', () => {
  const { r, audit } = graph(2, 2);
  const B = r.productAnalytics.find((x: any) => x.productId === 'B');
  assert.ok(B.completedGoodQty > 90, `B completed ${B.completedGoodQty}; a route confined to sb could not exceed 90`);
  assert.equal(audit.conservation.unaccountedUnits, 0);
  assert.ok(r.kpis.goodUnits <= 270);
});
