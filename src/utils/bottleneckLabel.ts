import type { SimulationResult } from '../types/project';

// The engine names the stage with the highest ranking score (utilization, setup share, queue signal, cycle pressure,
// minus blocking). That is a load ranking, not a proof that the stage limits capacity. This returns the named stage's
// measured utilization so the report can show how loaded it actually is (for example 37.5% when arrivals limit output).
export function mostLoadedUtilText(result: SimulationResult | undefined | null, isAr: boolean): string {
  const id = result?.kpis?.bottleneckStageId;
  const row = id ? result?.stageAnalytics?.find((s) => s.stageId === id) : undefined;
  if (!row || !Number.isFinite(row.utilizationPct)) return '';
  const v = row.utilizationPct.toFixed(1);
  return isAr ? ` (استغلالها ${v}%)` : ` (util ${v}%)`;
}
