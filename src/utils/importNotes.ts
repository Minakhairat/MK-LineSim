import { BETA_LIMITS_AR, BETA_LIMITS_EN } from './betaLimits';
import type { LayoutObject } from '../types/project';
import { reliabilityConflict } from '../engineering/validationEngine';

// Assumptions made while importing an older or incomplete project file. Codes are stored on the project (importNotes)
// so the user can see what was filled in instead of discovering it from the results.
export type ImportNoteCode =
  | 'sim_config_defaulted'
  | 'shifts_defaulted'
  | 'routes_defaulted'
  | 'stored_results_kept'
  | 'autowired_product'
  | 'autowired_stages'
  | 'autowired_routes'
  | 'autowired_workers';

// What a Run created on its own (auto-wire) because the project had none. These are generated inputs, not user data.
export function detectAutoWireNotes(
  before: { products: Array<{ routeStageIds?: string[] }>; stages: unknown[]; workers: unknown[] },
  after: { products: Array<{ routeStageIds?: string[] }>; stages: unknown[]; workers: unknown[] }
): ImportNoteCode[] {
  const notes: ImportNoteCode[] = [];
  if (before.products.length === 0 && after.products.length > 0) notes.push('autowired_product');
  if (before.stages.length === 0 && after.stages.length > 0) notes.push('autowired_stages');
  if (
    before.products.length > 0 &&
    before.products.some((p) => !p.routeStageIds || p.routeStageIds.length === 0) &&
    after.products.some((p) => p.routeStageIds && p.routeStageIds.length > 0)
  ) {
    notes.push('autowired_routes');
  }
  if (before.workers.length === 0 && after.workers.length > 0) notes.push('autowired_workers');
  return notes;
}

export function detectImportNotes(obj: Record<string, unknown>): ImportNoteCode[] {
  const notes: ImportNoteCode[] = [];
  const sc = obj.simulationConfig as Record<string, unknown> | undefined;
  if (!sc || typeof sc !== 'object') notes.push('sim_config_defaulted');
  else if (!Array.isArray(sc.shifts)) notes.push('shifts_defaulted');
  const prods = Array.isArray(obj.products) ? (obj.products as Array<Record<string, unknown>>) : [];
  if (prods.some((p) => !Array.isArray(p.routeStageIds))) notes.push('routes_defaulted');
  if (notes.length > 0 && obj.lastSimulationResult) notes.push('stored_results_kept');
  return notes;
}

export function importNoteText(code: string, isAr: boolean): string {
  switch (code) {
    case 'sim_config_defaulted':
      return isAr
        ? 'الملف ماكانش فيه إعدادات محاكاة، فاتستخدمت الإعدادات الافتراضية (٢٨٬٨٠٠ ث، فاصل وصول ٣٥ ث، ٥٠٠ وحدة، ورديّة نهارية واحدة من غير استراحات). ادخل مدة الوردية والاستراحات وفاصل الوصول الحقيقية.'
        : 'The file had no simulation settings, so defaults were used (28,800 s, 35 s arrival interval, 500 units, one day shift with no breaks). Enter the real shift length, breaks and arrival interval.';
    case 'shifts_defaulted':
      return isAr
        ? 'الملف ماكانش فيه ورديات، فاتضافت وردية نهارية واحدة بطول المدة كاملة ومن غير استراحات. ده افتراض مش من بيانات المصنع، وبيغيّر الوقت المجدول والإتاحة وOEE. ادخل الورديات والاستراحات الحقيقية.'
        : 'The file had no shifts, so one day shift covering the full duration with no breaks was added. This is an assumption, not plant data, and it changes scheduled time, availability and OEE. Enter the real shifts and breaks.';
    case 'routes_defaulted':
      return isAr
        ? 'بعض المنتجات ماكانش ليها مسار مراحل في الملف، فبتمر على كل المراحل. راجع مسار كل منتج.'
        : 'Some products had no stage route in the file, so they run through all stages. Check each product route.';
    case 'stored_results_kept':
      return isAr
        ? 'النتائج المحفوظة في الملف اتحفظت زي ما هي ومش متحسبة تاني. شغّل المحاكاة من جديد قبل ما تعتمد على أي رقم.'
        : 'Results stored in the file were kept as they are and not recomputed. Re-run the simulation before relying on any number.';
    case 'autowired_product':
      return isAr
        ? 'المشروع ماكانش فيه منتجات، فالتشغيل عمل منتج تلقائي اسمه "Standard Product" (PRD-100، الهدف ٤٠٠ وحدة). ده مش من بياناتك. النتائج الحالية مبنية عليه، فعرّف منتجاتك الحقيقية وشغّل من جديد.'
        : 'The project had no products, so Run generated one: "Standard Product" (PRD-100, target 400 units). It is not your data, and the current results are based on it. Define your real products and run again.';
    case 'autowired_stages':
      return isAr
        ? 'المشروع ماكانش فيه مراحل إنتاج، فالتشغيل عمل مراحل تلقائية من المعدات الموجودة في التخطيط. راجع المراحل وأزمنتها قبل ما تعتمد على النتائج.'
        : 'The project had no production stages, so Run generated stages from the equipment on the floor. Check the stages and their times before relying on results.';
    case 'autowired_routes':
      return isAr
        ? 'بعض المنتجات ماكانش ليها مسار مراحل، فالتشغيل ربطها تلقائياً بالمراحل. راجع مسار كل منتج.'
        : 'Some products had no stage route, so Run assigned routes automatically. Check each product route.';
    case 'autowired_workers':
      return isAr
        ? 'فيه مراحل ماكانش ليها عمال معيّنين، فالتشغيل عمل عمال تلقائيين ليها. راجع عدد العمال وتعيينهم.'
        : 'Run generated workers for stages that had none assigned. Check worker counts and assignments.';
    default:
      return code;
  }
}

type Wirable = {
  products: Array<{ id: string; routeStageIds?: string[]; autoGenerated?: boolean; routeAutoAssigned?: boolean }>;
  stages: Array<{ id: string; autoGenerated?: boolean }>;
  workers: Array<{ id: string; autoGenerated?: boolean }>;
  importNotes?: string[];
};

// A stage that needs operators but has none assigned. The engine would silently create workers for it at run time,
// so the store runs and discloses that auto-wire first instead of leaving it undisclosed inside the engine.
export function hasStageWithoutWorker(project: {
  stages: Array<{ id: string; requiredWorkers: number }>;
  workers: Array<{ assignedStageIds: string[] }>;
}): boolean {
  return project.stages.some(
    (s) => s.requiredWorkers > 0 && !project.workers.some((w) => w.assignedStageIds.includes(s.id))
  );
}

// Marks what a Run auto-wire created, on the entities themselves, so the record survives banner dismissal,
// saving, reload and export. It is removed only when the generated item is deleted or replaced.
export function markGeneratedInputs(draft: Wirable, before: Wirable): void {
  const prod = new Map(before.products.map((p) => [p.id, p]));
  const stg = new Set(before.stages.map((x) => x.id));
  const wrk = new Set(before.workers.map((x) => x.id));
  for (const p of draft.products) {
    const old = prod.get(p.id);
    if (!old) p.autoGenerated = true;
    else if ((!old.routeStageIds || old.routeStageIds.length === 0) && p.routeStageIds && p.routeStageIds.length > 0) {
      p.routeAutoAssigned = true;
    }
  }
  for (const x of draft.stages) if (!stg.has(x.id)) x.autoGenerated = true;
  for (const x of draft.workers) if (!wrk.has(x.id)) x.autoGenerated = true;
}

// Which generated-input notes currently apply to a project. Derived from the flags (plus notes saved by an earlier build).
export function generatedInputCodes(project: Wirable): ImportNoteCode[] {
  const out: ImportNoteCode[] = [];
  const legacy = new Set(project.importNotes ?? []);
  if (project.products.some((p) => p.autoGenerated) || legacy.has('autowired_product')) out.push('autowired_product');
  if (project.stages.some((x) => x.autoGenerated) || legacy.has('autowired_stages')) out.push('autowired_stages');
  if (project.products.some((p) => p.routeAutoAssigned) || legacy.has('autowired_routes')) out.push('autowired_routes');
  if (project.workers.some((x) => x.autoGenerated) || legacy.has('autowired_workers')) out.push('autowired_workers');
  return out;
}

export function isGeneratedInputCode(code: string): boolean {
  return code.startsWith('autowired_');
}

export type ResultProvenance = {
  codes: ImportNoteCode[];
  unknown: boolean;
  /** Machines where the run used MTBF/MTTR instead of a conflicting stated availability. */
  reliability?: ReliabilityConflictRow[];
  /** The result carries no reliability stamp (computed before it existed): unknown, not clean. */
  reliabilityUnknown?: boolean;
};

// Stamps a freshly computed result with the generated inputs that the project had at run time.
export function stampGeneratedInputs<R extends { generatedInputs?: string[]; reliabilityConflicts?: ReliabilityConflictRow[] }>(
  result: R,
  project: Wirable & { layoutObjects?: LayoutObject[]; simulationConfig?: { enableBreakdowns?: boolean } }
): R {
  const stamped: R = { ...result, generatedInputs: generatedInputCodes(project) };
  if (project.layoutObjects && project.simulationConfig) {
    stamped.reliabilityConflicts = reliabilityConflictRows(project.layoutObjects, !!project.simulationConfig.enableBreakdowns);
  }
  return stamped;
}

export type ReliabilityConflictRow = { name: string; availabilityPct: number; derivedPct: number };

export function reliabilityConflictRows(objects: LayoutObject[], enableBreakdowns: boolean): ReliabilityConflictRow[] {
  const out: ReliabilityConflictRow[] = [];
  for (const o of objects) {
    const c = reliabilityConflict(o, enableBreakdowns);
    if (c) out.push({ name: o.name, availabilityPct: c.availability * 100, derivedPct: c.inherentAvailability * 100 });
  }
  return out;
}

export function reliabilityConflictText(rows: ReliabilityConflictRow[], isAr: boolean): string {
  // Words, not an arrow: an arrow inside right-to-left text points the wrong way on screen.
  const list = rows
    .map((r) =>
      isAr
        ? `${r.name} (مكتوب ${r.availabilityPct.toFixed(1)}%، مستخدم ${r.derivedPct.toFixed(1)}%)`
        : `${r.name} (stated ${r.availabilityPct.toFixed(1)}%, used ${r.derivedPct.toFixed(1)}%)`
    )
    .join(isAr ? '، ' : ', ');
  return isAr
    ? `في المعدات دي نسبة التوفر المكتوبة بتختلف عن MTBF/(MTBF+MTTR)، والمحاكاة استخدمت القيمة المحسوبة من MTBF وMTTR مش النسبة المكتوبة: ${list}. وحّد القيمتين ثم شغّل من جديد.`
    : `For these machines the stated availability differs from MTBF/(MTBF+MTTR), and the run used the value derived from MTBF and MTTR, not the stated availability: ${list}. Make the two consistent and run again.`;
}

// What a saved result says about its own inputs. No stamp means the result predates stamping: unknown, not clean.
export function resultProvenance(
  result: { generatedInputs?: string[]; reliabilityConflicts?: ReliabilityConflictRow[] } | undefined | null
): ResultProvenance {
  if (!result) return { codes: [], unknown: false };
  const reliabilityUnknown = !Array.isArray(result.reliabilityConflicts);
  const reliability = Array.isArray(result.reliabilityConflicts) ? result.reliabilityConflicts : [];
  if (!Array.isArray(result.generatedInputs)) return { codes: [], unknown: true, reliability, reliabilityUnknown };
  return {
    codes: result.generatedInputs.filter(isGeneratedInputCode) as ImportNoteCode[],
    unknown: false,
    reliability,
    reliabilityUnknown,
  };
}

export function unionProvenance(list: ResultProvenance[]): ResultProvenance {
  const codes = Array.from(new Set(list.flatMap((p) => p.codes))) as ImportNoteCode[];
  const byName = new Map<string, ReliabilityConflictRow>();
  for (const p of list) for (const r of p.reliability ?? []) if (!byName.has(r.name)) byName.set(r.name, r);
  return {
    codes,
    unknown: list.some((p) => p.unknown),
    reliability: Array.from(byName.values()),
    reliabilityUnknown: list.some((p) => p.reliabilityUnknown),
  };
}

export function reliabilityUnknownText(isAr: boolean): string {
  return isAr
    ? 'مش مسجّل إذا كانت نتايج محفوظة استخدمت MTBF/MTTR بدل توفر مكتوب مختلف (اتحسبت قبل ما التسجيل ده يتضاف). مش معناه إنها سليمة. صحّح الأول أي عدد عمال موسوم، وبعدين شغّل من جديد عشان تاخد إجابة مسجّلة.'
    : 'It was not recorded whether these saved results used MTBF/MTTR instead of a conflicting stated availability (they were computed before this was recorded). That does not mean they are clean. After correcting any flagged worker counts, re-run to get a recorded answer.';
}

export function unknownProvenanceText(isAr: boolean): string {
  return isAr
    ? 'مصدر المدخلات لنتيجة محفوظة من قبل تسجيل المصدر غير معروف. ماتفترضش إنها اتشغلت على مدخلاتك. شغّل المحاكاة من جديد.'
    : 'These saved results were computed before input provenance was recorded, so it is unknown whether they used generated inputs. Do not assume they used your own inputs. Re-run the simulation.';
}

// Plain-text disclosure lines for data exports (CSV, JSON). Same facts the PDFs and screens show:
// generated inputs, MTBF/MTTR-over-stated-availability, and "no stamp = unknown, not clean".
export function exportDisclosureLines(prov: ResultProvenance, isAr: boolean): string[] {
  const lines: string[] = [];
  if (prov.unknown) lines.push(unknownProvenanceText(isAr));
  if (prov.codes.length > 0) {
    const names: Record<string, [string, string]> = {
      autowired_product: ['product (Standard Product, PRD-100)', 'منتج (Standard Product, PRD-100)'],
      autowired_stages: ['production stages', 'مراحل إنتاج'],
      autowired_routes: ['product routes', 'مسارات المنتجات'],
      autowired_workers: ['workers', 'عمال'],
    };
    const list = prov.codes.map((c) => (names[c] ? names[c][isAr ? 1 : 0] : c)).join(isAr ? '، ' : ', ');
    lines.push(
      isAr
        ? `مدخلات اتعملت تلقائياً وليست من بيانات المستخدم: ${list}. النتائج مبنية عليها.`
        : `Generated inputs, not user data: ${list}. These results are based on them.`
    );
  }
  if ((prov.reliability ?? []).length > 0) lines.push(reliabilityConflictText(prov.reliability ?? [], isAr));
  if (prov.reliabilityUnknown) lines.push(reliabilityUnknownText(isAr));
  return lines;
}

type ResultLike = { generatedInputs?: string[]; reliabilityConflicts?: ReliabilityConflictRow[] };

// Top-level notice written into a project JSON export. Covers every result the file carries.
// Import ignores this key; the stamps inside each result are what persist.
export function projectExportNotice(project: { lastSimulationResult?: ResultLike; scenarios?: { result?: ResultLike }[] }) {
  const results: ResultLike[] = [];
  if (project.lastSimulationResult) results.push(project.lastSimulationResult);
  for (const sc of project.scenarios ?? []) if (sc.result) results.push(sc.result);
  if (results.length === 0) {
    return { status: 'no_results_in_file' as const, notes: [] as string[], notesAr: [] as string[] };
  }
  const prov = unionProvenance(results.map((r) => resultProvenance(r)));
  const notes = exportDisclosureLines(prov, false);
  const notesAr = exportDisclosureLines(prov, true);
  const status = prov.unknown || prov.reliabilityUnknown ? 'unknown_for_some_results' : notes.length > 0 ? 'flags_present' : 'recorded_no_flags';
  return { status, notes, notesAr };
}

export function projectJsonText(project: { lastSimulationResult?: ResultLike; scenarios?: { result?: ResultLike }[] }): string {
  return JSON.stringify({ exportNotice: { limits: BETA_LIMITS_EN, limitsAr: BETA_LIMITS_AR, ...projectExportNotice(project) }, ...project }, null, 2);
}

// Companion text file for the event-log CSV: same notices as the CSV's end-of-file NOTICE rows, in both languages,
// in a file a person opens first. The CSV itself stays a plain event table.
export function eventsCsvNoticeText(prov: ResultProvenance, csvFileName: string): string {
  const en = exportDisclosureLines(prov, false);
  const ar = exportDisclosureLines(prov, true);
  return [
    `NOTICE for ${csvFileName}`,
    '',
    BETA_LIMITS_EN,
    BETA_LIMITS_AR,
    '',
    ...(en.length > 0 ? ['Result notices (English):', ...en.map((l) => '- ' + l), '', 'ملاحظات النتيجة (عربي):', ...ar.map((l) => '- ' + l), ''] : []),
    'The same notices are also written as NOTICE rows at the end of the CSV file.',
    '',
  ].join('\n');
}
