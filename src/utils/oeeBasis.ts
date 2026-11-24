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
