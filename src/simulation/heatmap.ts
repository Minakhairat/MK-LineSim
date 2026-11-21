import {
  LayoutObject,
  ObjectRuntimeState,
  ProductDefinition,
  SimulationConfig,
} from '../types/project';
import { computeShiftWindowAudit } from './timeAuditService';

export type HeatmapTier = 'idle' | 'low' | 'healthy' | 'high' | 'bottleneck' | 'downtime';

export interface ObjectHeatmapMetrics {
  objectId: string;
  utilPct: number;
  downPct: number;
  blockedPct: number;
  starvedPct: number;
  tier: HeatmapTier;
  colorHex: string;
  borderHex: string;
  colorNum: number;
  isDownActive: boolean;
  isBottleneck: boolean;
  badgeText: string;
}

export interface HeatmapLegendStop {
  tier: HeatmapTier;
  colorHex: string;
}

export const HEATMAP_LEGEND_STOPS: HeatmapLegendStop[] = [
  { tier: 'low', colorHex: '#3B82F6' },
  { tier: 'healthy', colorHex: '#10B981' },
  { tier: 'high', colorHex: '#F59E0B' },
  { tier: 'bottleneck', colorHex: '#DC2626' },
  { tier: 'downtime', colorHex: '#A855F7' },
];

const TIER_STYLES: Record<HeatmapTier, { colorHex: string; borderHex: string; colorNum: number }> = {
  idle: { colorHex: '#64748B', borderHex: '#475569', colorNum: 0x64748b },
  low: { colorHex: '#3B82F6', borderHex: '#1D4ED8', colorNum: 0x3b82f6 },
  healthy: { colorHex: '#10B981', borderHex: '#047857', colorNum: 0x10b981 },
  high: { colorHex: '#F59E0B', borderHex: '#B45309', colorNum: 0xf59e0b },
  bottleneck: { colorHex: '#DC2626', borderHex: '#991B1B', colorNum: 0xdc2626 },
  downtime: { colorHex: '#A855F7', borderHex: '#DC2626', colorNum: 0xa855f7 },
};

/**
 * Computes active utilization % vs. unplanned downtime % and resolves a deterministic
 * thermal tier for an object in the 2D CAD / 3D WebGL factory viewports.
 */
export function computeObjectHeatmapMetrics(params: {
  obj: LayoutObject;
  runtime?: ObjectRuntimeState;
  clockSec: number;
  activeSimTimeSec: number;
  isStageBottleneck?: boolean;
}): ObjectHeatmapMetrics {
  const { obj, runtime, clockSec, activeSimTimeSec, isStageBottleneck = false } = params;

  if (
    clockSec <= 0 ||
    !runtime ||
    obj.kind === 'storage' ||
    obj.kind === 'vehicle'
  ) {
    const style = TIER_STYLES.idle;
    return {
      objectId: obj.id,
      utilPct: 0,
      downPct: 0,
      blockedPct: 0,
      starvedPct: 0,
      tier: 'idle',
      colorHex: style.colorHex,
      borderHex: style.borderHex,
      colorNum: style.colorNum,
      isDownActive: false,
      isBottleneck: false,
      badgeText: '0%',
    };
  }

  const dtLast = Math.max(0, clockSec - runtime.lastStateChangeTime);
  const runT = runtime.runningTimeSec + (runtime.status === 'running' ? dtLast : 0);
  const blkT = runtime.blockedTimeSec + (runtime.status === 'blocked' ? dtLast : 0);
  const downT = runtime.downTimeSec + (runtime.status === 'down' ? dtLast : 0);
  const starvedT =
    runtime.idleTimeSec +
    runtime.starvedTimeSec +
    (runtime.status === 'idle' || runtime.status === 'starved' ? dtLast : 0);

  const denom = Math.max(1e-6, activeSimTimeSec);
  const utilPct = Math.min(100, Math.max(0, (runT / denom) * 100));
  const downPct = Math.min(100, Math.max(0, (downT / denom) * 100));
  const blockedPct = Math.min(100, Math.max(0, (blkT / denom) * 100));
  const starvedPct = Math.min(100, Math.max(0, (starvedT / denom) * 100));
  const isDownActive = runtime.status === 'down';

  let tier: HeatmapTier;
  if (isDownActive || downPct >= 8 || (downPct >= 2 && downPct >= utilPct * 0.2)) {
    tier = 'downtime';
  } else if (utilPct >= 85 || isStageBottleneck) {
    tier = 'bottleneck';
  } else if (utilPct >= 65) {
    tier = 'high';
  } else if (utilPct >= 35) {
    tier = 'healthy';
  } else {
    tier = 'low';
  }

  const style = TIER_STYLES[tier];
  const badgeText =
    downPct >= 0.5
      ? `U:${utilPct.toFixed(0)}% D:${downPct.toFixed(0)}%`
      : `U:${utilPct.toFixed(0)}%`;

  return {
    objectId: obj.id,
    utilPct,
    downPct,
    blockedPct,
    starvedPct,
    tier,
    colorHex: style.colorHex,
    borderHex: style.borderHex,
    colorNum: style.colorNum,
    isDownActive,
    isBottleneck: isStageBottleneck || tier === 'bottleneck',
    badgeText,
  };
}

/**
 * Resolves active simulation window seconds once for heatmap calculations.
 */
export function resolveHeatmapActiveTimeSec(
  config: SimulationConfig,
  primaryProduct: ProductDefinition | undefined,
  clockSec: number
): number {
  if (clockSec <= 0) return 0;
  return computeShiftWindowAudit(config, primaryProduct, clockSec).activeSimTimeSec;
}
