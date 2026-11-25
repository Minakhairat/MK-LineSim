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
        ? 'المشروع ماكانش فيه عمال، فالتشغيل عمل عمال تلقائيين. راجع عدد العمال وتعيينهم.'
        : 'The project had no workers, so Run generated workers. Check worker counts and assignments.';
    default:
      return code;
  }
}
