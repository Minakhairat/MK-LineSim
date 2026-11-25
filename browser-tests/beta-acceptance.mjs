// MK-LineSim beta acceptance run against the deployed site (manual, not part of `npm test`).
// Needs puppeteer-core and a Chrome binary:  CHROME=/usr/bin/google-chrome node browser-tests/beta-acceptance.mjs
// Optional: URL=https://minakhairat.github.io/MK-LineSim/
// It opens the built-in sample project, runs a scenario, runs the full shift, exports CSV, NOTICE, JSON and both PDFs,
// and checks the limits statement and export notices. It tests this one sample project only.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.URL || 'https://minakhairat.github.io/MK-LineSim/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const LIMITS_EN = 'Experimental version for scenario comparison. Results depend on the inputs and have not been validated against real plant output. Do not rely on them alone for client-facing figures or equipment or staffing decisions.';
const LIMITS_AR = 'نسخة تجريبية لمقارنة السيناريوهات. النتائج مبنية على المدخلات، ولم تُتحقق دقتها مقابل إنتاج مصنع حقيقي. لا تعتمد عليها وحدها لتقديم أرقام لعميل أو لاتخاذ قرارات معدات أو عمالة.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ASSERT OK' : 'ASSERT FAIL'}: ${name}${extra ? ' | ' + extra : ''}`);
  if (!ok) failed++;
};

const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'linesim-dl-'));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'linesim-prof-'));
const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: 'new', userDataDir: prof });
const pg = await browser.newPage();
await pg.setViewport({ width: 1280, height: 900 });
const cdp = await pg.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
const click = (t) => pg.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === t || b.innerText.includes(t)); if (b) { b.click(); return true; } return false; }, t);
const bodyText = () => pg.evaluate(() => document.body.innerText);
const waitFor = async (fn, ms, step = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (await pg.evaluate(fn)) return true; await sleep(step); } return false; };

await pg.goto(URL_, { waitUntil: 'networkidle0', timeout: 90000 });
await pg.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
await pg.reload({ waitUntil: 'networkidle0' });
await sleep(2000);

// 1. open: sample project loads, limits strip is visible
const strip = await pg.evaluate(() => document.querySelector('[data-testid=beta-limits]')?.innerText || '');
check('sample project is open', (await bodyText()).includes('Desert Air Cooler'));
check('limits strip shows the approved English text', strip === LIMITS_EN);

// 2. scenario: create and run one, expect a second row with a numeric good-unit count
await click('Scenarios');
await sleep(1500);
const rowsBefore = await pg.evaluate(() => document.querySelectorAll('table tbody tr').length);
await click('Create & Run Scenario');
const scenarioDone = await waitFor(() => { const rows = [...document.querySelectorAll('table tbody tr')]; return rows.length >= 2 && rows.slice(1).some((r) => /\d/.test(r.cells[3]?.innerText || '')); }, 80000);
const rowsAfter = await pg.evaluate(() => document.querySelectorAll('table tbody tr').length);
check('a scenario was created and ran to a numeric result', scenarioDone && rowsAfter === rowsBefore + 1, `rows ${rowsBefore} -> ${rowsAfter}`);

// 3. full shift on Analytics: good <= total, Performance definition shown
await click('Analytics');
await sleep(1000);
await click('Run Full 8-Hour Shift');
const shiftDone = await waitFor(() => /Restart|Re-run/i.test(document.body.innerText) || !!document.querySelector('[data-testid=performance-definition]'), 90000, 3000);
await sleep(1500);
const kpiText = await pg.evaluate(() => document.querySelector('main')?.innerText || '');
const good = Number((kpiText.match(/Good Units[^\n]*\n\s*([\d,]+)/) || [])[1]?.replace(/,/g, ''));
const total = Number((kpiText.match(/Total:\s*([\d,]+)/) || [])[1]?.replace(/,/g, ''));
check('full shift finished with good units > 0 and good <= total', shiftDone && good > 0 && total >= good, `good ${good}, total ${total}`);
const def = await pg.evaluate(() => document.querySelector('[data-testid=performance-definition]')?.innerText || '');
check('Performance definition is shown', def.includes('total units') && def.includes('net operating time'));

// 4. exports
await click('Reports');
await sleep(1500);
for (const t of ['Export Event CSV', 'Export JSON', 'Export KPI PDF', 'Export Scenarios PDF']) { await click(t); await sleep(3500); }
const files = fs.readdirSync(dl);
const find = (re) => files.find((f) => re.test(f));
const csv = find(/_sim_events\.csv$/); const note = find(/_sim_events_NOTICE\.txt$/); const json = find(/_project\.json$/);
const kpiPdf = find(/kpi.*\.pdf$/i); const scPdf = find(/scenario.*\.pdf$/i);
check('all five export files downloaded', !!(csv && note && json && kpiPdf && scPdf), files.join(', '));
const read = (f) => fs.readFileSync(path.join(dl, f), 'utf8');
if (csv) check('CSV ends with a NOTICE row carrying the limits', read(csv).includes('\nNOTICE,,,,,,,"' + LIMITS_EN));
if (note) check('NOTICE.txt carries the limits in both languages', read(note).includes(LIMITS_EN) && read(note).includes(LIMITS_AR));
if (json) {
  const j = JSON.parse(read(json));
  check('JSON has exportNotice with limits and a performance basis', j.exportNotice?.limits === LIMITS_EN && Array.isArray(j.exportNotice?.performanceDefinitions), j.exportNotice?.status);
  check('JSON keeps the numeric KPIs', typeof j.lastSimulationResult?.kpis?.performancePct === 'number');
}
for (const f of [kpiPdf, scPdf].filter(Boolean)) {
  const buf = fs.readFileSync(path.join(dl, f));
  check(`PDF ${f} is a real PDF`, buf.subarray(0, 4).toString() === '%PDF' && buf.length > 10000, `${buf.length} bytes`);
}

// 5. Arabic: limits strip switches language
await click('العربية');
await sleep(1500);
const stripAr = await pg.evaluate(() => document.querySelector('[data-testid=beta-limits]')?.innerText || '');
check('limits strip shows the approved Arabic text', stripAr === LIMITS_AR);

await browser.close();
console.log(failed === 0 ? 'ALL ASSERTS OK' : `${failed} ASSERT(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
