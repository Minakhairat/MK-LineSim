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
