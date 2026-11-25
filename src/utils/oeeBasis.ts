// True when line OEE / Performance may use an ideal cycle from a stage that some product route skips.
// Line OEE takes its ideal cycle from the slowest stage in the whole project (timeAuditService), not from
// the stages a product actually visits. This checks only auto-mode products with a non-empty route list;
// manual-mode products follow the shared flowchart graph and are not assessed here.
export function oeeBasisUsesSkippedStage(
  products: ReadonlyArray<{ routingMode?: string; routeStageIds?: string[] }>,
  slowestStageId: string | undefined
): boolean {
  if (!slowestStageId) return false;
  return products.some(
    (p) =>
      p.routingMode !== 'manual' &&
      Array.isArray(p.routeStageIds) &&
      p.routeStageIds.length > 0 &&
      !p.routeStageIds.includes(slowestStageId)
  );
}

// One-line definition of the Performance figure, shown next to it. Describes the current calculation; it does not change it.
// Numerator uses TOTAL units (good + scrap); denominator is net operating time (scheduled time minus unplanned downtime and setup).
export function performanceDefinitionText(isAr: boolean, multiProduct: boolean): string {
  if (isAr) {
    return (
      'الأداء = زمن الدورة المثالي لأبطأ مرحلة × إجمالي الوحدات (سليمة ومعيبة) ÷ وقت التشغيل الصافي (الوقت المجدول ناقص التوقف غير المخطط والتجهيز)' +
      (multiProduct ? '، محسوب على المزيج المخطط للمنتجات مش المزيج اللي اتنفذ فعلًا' : '') +
      '. ممكن يعدي 100٪ ووقتها بيظهر تحذير.'
    );
  }
  return (
    'Performance = ideal cycle of the slowest stage × total units (good and scrap) ÷ net operating time (scheduled time minus unplanned downtime and setup)' +
    (multiProduct ? ', using the planned product mix, not the mix actually completed' : '') +
    '. It can exceed 100% and is then flagged.'
  );
}
