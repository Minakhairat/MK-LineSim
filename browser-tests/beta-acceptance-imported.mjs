// Manual acceptance run against the deployed site for IMPORTED projects (not part of `npm test`).
//   CHROME=/usr/bin/google-chrome node browser-tests/beta-acceptance-imported.mjs     (optional URL=...)
// Imports two fixtures through the real file input: a project with an MTBF/MTTR conflict, and a two-product project whose
// modeled run stalls. Checks limits strip, conflict notice, stall note, JSON export notice. Desktop English only.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.URL || 'https://minakhairat.github.io/MK-LineSim/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ASSERT OK' : 'ASSERT FAIL'}: ${name}${extra ? ' | ' + extra : ''}`); if (!ok) failed++; };

async function session(fixture) {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'linesim-dl-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'linesim-prof-')) });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1280, height: 900 });
  const cdp = await pg.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await pg.goto(URL_, { waitUntil: 'networkidle0', timeout: 90000 });
  await pg.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
  await pg.reload({ waitUntil: 'networkidle0' });
  await sleep(2000);
  await (await pg.$('input[type=file]')).uploadFile(path.join(here, 'fixtures', fixture));
  await sleep(2500);
  const click = (t) => pg.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === t || b.innerText.includes(t)); if (b) { b.click(); return true; } return false; }, t);
  const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await pg.evaluate(fn)) return true; await sleep(2000); } return false; };
  return { browser, pg, dl, click, waitFor };
}
const jsonNotice = (dl) => { const f = fs.readdirSync(dl).find((x) => x.endsWith('.json')); return f ? JSON.parse(fs.readFileSync(path.join(dl, f), 'utf8')).exportNotice : null; };

// A. imported project with a reliability conflict
{
  const s = await session('conflict_single_product.json');
  check('A: limits strip visible after import', await s.pg.evaluate(() => !!document.querySelector('[data-testid=beta-limits]')));
  await s.click('Analytics'); await sleep(1000); await s.click('Run Full 8-Hour Shift');
  check('A: conflict notice appears after the run', await s.waitFor(() => !!document.querySelector('[data-testid=reliability-conflict]'), 90000));
  await s.click('Reports'); await sleep(1500); await s.click('Export JSON'); await sleep(3500);
  const n = jsonNotice(s.dl);
  check('A: JSON export has exportNotice with a Performance definition', !!n && JSON.stringify(n).includes('performanceDefinitions') && JSON.stringify(n).includes('single_product'));
  await s.browser.close();
}
// B. imported two-product project whose modeled run stalls
{
  const s = await session('stalled_two_product.json');
  await s.click('Analytics'); await sleep(1000); await s.click('Run Full 8-Hour Shift');
  const ok = await s.waitFor(() => /stalled/i.test(document.querySelector('[data-testid=oee-mixed-note]')?.innerText || ''), 90000);
  check('B: stall note says Performance and Quality are undefined', ok);
  check('B: no Performance definition caption is shown for the stalled run', await s.pg.evaluate(() => !document.querySelector('[data-testid=performance-definition]')));
  await s.click('Reports'); await sleep(1500); await s.click('Export JSON'); await sleep(3500);
  check('B: JSON export carries an exportNotice', !!jsonNotice(s.dl));
  await s.browser.close();
}
console.log(failed ? `${failed} ASSERT(S) FAILED` : 'ALL ASSERTS PASSED');
process.exit(failed ? 1 : 0);
