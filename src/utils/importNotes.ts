// Assumptions made while importing an older or incomplete project file. Codes are stored on the project (importNotes)
// so the user can see what was filled in instead of discovering it from the results.
export type ImportNoteCode = 'sim_config_defaulted' | 'shifts_defaulted' | 'routes_defaulted' | 'stored_results_kept';

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
    default:
      return code;
  }
}
