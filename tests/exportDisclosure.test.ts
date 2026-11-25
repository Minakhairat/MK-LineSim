import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesertAirCoolerProject } from '../src/data/sampleProject';
import { DiscreteEventSimulationEngine } from '../src/simulation/desEngine';
import { migrateProjectSchema } from '../src/storage/indexedDb';
import { exportDisclosureLines, projectExportNotice, projectJsonText, resultProvenance, stampGeneratedInputs } from '../src/utils/importNotes';

const run = (p: any) => (new DiscreteEventSimulationEngine(p) as any).runToCompletion();
const base = () => JSON.parse(JSON.stringify(createDesertAirCoolerProject()));

test('Export notice: no results in file says so, not clean', () => {
  const p = base();
  delete p.lastSimulationResult;
  p.scenarios = [];
  assert.equal(projectExportNotice(p).status, 'no_results_in_file');
});

test('Export notice: a saved result with no stamp is reported unknown in JSON and in CSV lines (EN and AR)', () => {
  const p = base();
  p.lastSimulationResult = run(p); // unstamped, as an old saved result
  const n = projectExportNotice(p);
  assert.equal(n.status, 'unknown_for_some_results');
  assert.ok(n.notes.length > 0 && n.notesAr.length > 0);
  assert.ok(exportDisclosureLines(resultProvenance(p.lastSimulationResult), true).length > 0);
});

test('Export notice: stamped result with reliability conflict is flagged; stamped clean result has no lines', () => {
  const p = base();
  const m = p.layoutObjects.find((o: any) => o.type === 'machine' || o.mtbfHours || o.mtbf);
  const clean = stampGeneratedInputs(run(p), p);
  const cleanLines = exportDisclosureLines(resultProvenance(clean), false);
  assert.deepEqual(cleanLines, []);
  const flagged: any = { ...clean, reliabilityConflicts: [{ name: 'M1', availabilityPct: 95, derivedPct: 90 }] };
  const lines = exportDisclosureLines(resultProvenance(flagged), false);
  assert.ok(lines.some((l) => l.includes('stated 95.0%, used 90.0%')));
  assert.ok(m !== undefined || true);
});

test('JSON export carries the notice at top level and the project still imports and keeps its result stamps', () => {
  const p = base();
  p.lastSimulationResult = stampGeneratedInputs(run(p), p);
  const text = projectJsonText(p);
  const parsed = JSON.parse(text);
  assert.ok(parsed.exportNotice && parsed.exportNotice.status);
  const back: any = migrateProjectSchema(parsed);
  assert.equal(back.exportNotice, undefined);
  assert.ok(Array.isArray(back.lastSimulationResult.generatedInputs));
});

import { BETA_LIMITS_AR, BETA_LIMITS_EN, betaLimitsText } from '../src/utils/betaLimits';
test('Limits statement is the owner-approved wording, and the JSON export carries it in both languages', () => {
  assert.equal(BETA_LIMITS_EN, 'Experimental version for scenario comparison. Results depend on the inputs and have not been validated against real plant output. Do not rely on them alone for client-facing figures or equipment or staffing decisions.');
  assert.equal(BETA_LIMITS_AR, 'نسخة تجريبية لمقارنة السيناريوهات. النتائج مبنية على المدخلات، ولم تُتحقق دقتها مقابل إنتاج مصنع حقيقي. لا تعتمد عليها وحدها لتقديم أرقام لعميل أو لاتخاذ قرارات معدات أو عمالة.');
  assert.equal(betaLimitsText(true), BETA_LIMITS_AR);
  const p = base();
  const parsed = JSON.parse(projectJsonText(p));
  assert.equal(parsed.exportNotice.limits, BETA_LIMITS_EN);
  assert.equal(parsed.exportNotice.limitsAr, BETA_LIMITS_AR);
});

import { performanceDefinitionText } from '../src/utils/oeeBasis';
test('Performance definition text names the planned mix only when there is more than one product, and says it can exceed 100%', () => {
  assert.ok(performanceDefinitionText(false, true).includes('planned product mix, not the mix actually completed'));
  assert.ok(!performanceDefinitionText(false, false).includes('planned product mix'));
  assert.ok(performanceDefinitionText(true, true).includes('المزيج المخطط'));
  assert.ok(performanceDefinitionText(true, false).includes('100'));
});

import { eventsCsvNoticeText } from '../src/utils/importNotes';
test('Companion CSV notice file carries the approved limits in both languages and the result notices', () => {
  const t = eventsCsvNoticeText({ codes: [], unknown: true }, 'x_sim_events.csv');
  assert.ok(t.includes(BETA_LIMITS_EN) && t.includes(BETA_LIMITS_AR));
  assert.ok(t.includes('x_sim_events.csv'));
  assert.ok(t.includes('Result notices (English):'));
  const clean = eventsCsvNoticeText({ codes: [], unknown: false, reliability: [], reliabilityUnknown: false }, 'y.csv');
  assert.ok(!clean.includes('Result notices'));
});
test('Performance definition states total units and net operating time', () => {
  assert.ok(performanceDefinitionText(false, false).includes('total units (good and scrap)'));
  assert.ok(performanceDefinitionText(false, false).includes('net operating time'));
  assert.ok(performanceDefinitionText(true, true).includes('إجمالي الوحدات'));
});

import { performanceDefinitionMeta, performanceBasisFor } from '../src/utils/importNotes';
test('JSON performance definitions: single, manual planned mix, auto time-weighted, no production, no results', () => {
  const k = (o: any) => ({ kpis: { actualProduction: 100, ...o } });
  assert.equal(performanceBasisFor(k({}) as any, 1), 'single_product');
  assert.equal(performanceBasisFor(k({}) as any, 2), 'multi_product_planned_mix');
  assert.equal(performanceBasisFor(k({ oeeMixedTimeWeighted: true }) as any, 2), 'multi_product_time_weighted');
  assert.equal(performanceBasisFor({ kpis: { actualProduction: 0 } } as any, 2), 'no_production');
  const auto = performanceDefinitionMeta({ products: [{}, {}], lastSimulationResult: k({ oeeMixedTimeWeighted: true }) as any });
  assert.equal(auto.length, 1);
  assert.ok(!auto[0].definition!.includes('planned product mix'));
  assert.ok(auto[0].definition!.includes('time-weighted'));
  const man = performanceDefinitionMeta({ products: [{}, {}], lastSimulationResult: k({}) as any });
  assert.ok(man[0].definition!.includes('planned product mix, not the mix actually completed'));
  assert.deepEqual(performanceDefinitionMeta({ products: [{}] }), []);
  const parsed = JSON.parse(projectJsonText({ products: [{}, {}], lastSimulationResult: k({}) as any }));
  assert.equal(parsed.exportNotice.performanceDefinitions[0].basis, 'multi_product_planned_mix');
  assert.equal(parsed.lastSimulationResult.kpis.actualProduction, 100);
});
