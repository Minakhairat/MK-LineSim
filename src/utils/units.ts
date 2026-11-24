import { MeasurementUnit } from '../types/project';

const UNIT_FACTORS: Record<MeasurementUnit, number> = {
  m: 1,
  cm: 100,
  mm: 1000,
};

export function fromMeters(meters: number, unit: MeasurementUnit): number {
  return meters * UNIT_FACTORS[unit];
}

export function toMeters(value: number, unit: MeasurementUnit): number {
  return value / UNIT_FACTORS[unit];
}

export function formatLength(meters: number, unit: MeasurementUnit, decimals?: number): string {
  const converted = fromMeters(meters, unit);
  const dec = decimals !== undefined ? decimals : unit === 'm' ? 2 : unit === 'cm' ? 1 : 0;
  return `${converted.toFixed(dec)} ${unit}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs.toFixed(seconds % 1 !== 0 ? 1 : 0)}s`;
}

export function snapValue(val: number, step: number, enabled: boolean): number {
  if (!enabled || step <= 0) return Math.round(val * 1000) / 1000;
  return Math.round(val / step) * step;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36).slice(-4)}`;
}

export function getRotatedBounds(
  cx: number,
  cz: number,
  length: number,
  width: number,
  rotationDeg: number
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfX = (length * cos + width * sin) / 2;
  const halfZ = (length * sin + width * cos) / 2;
  return {
    minX: cx - halfX,
    maxX: cx + halfX,
    minZ: cz - halfZ,
    maxZ: cz + halfZ,
  };
}

export interface OrientedBox2D {
  cx: number;
  cz: number;
  length: number;
  width: number;
  rotationDeg: number;
}

/**
 * Exact 2D Separating Axis Theorem (SAT) overlap test for two rotated rectangles.
 * Returns true iff the oriented footprints intersect by more than `toleranceM` along every SAT axis.
 */
export function doOrientedBoxesOverlap(
  a: OrientedBox2D,
  b: OrientedBox2D,
  toleranceM = 0.08
): boolean {
  const radA = ((Number.isFinite(a.rotationDeg) ? a.rotationDeg : 0) * Math.PI) / 180;
  const radB = ((Number.isFinite(b.rotationDeg) ? b.rotationDeg : 0) * Math.PI) / 180;

  const uxA = Math.cos(radA);
  const uzA = Math.sin(radA);
  const vxA = -uzA;
  const vzA = uxA;

  const uxB = Math.cos(radB);
  const uzB = Math.sin(radB);
  const vxB = -uzB;
  const vzB = uxB;

  const hLA = Math.max(0, a.length) / 2;
  const hWA = Math.max(0, a.width) / 2;
  const hLB = Math.max(0, b.length) / 2;
  const hWB = Math.max(0, b.width) / 2;

  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;

  const axes: ReadonlyArray<readonly [number, number]> = [
    [uxA, uzA],
    [vxA, vzA],
    [uxB, uzB],
    [vxB, vzB],
  ];

  for (const [ax, az] of axes) {
    const centerDist = Math.abs(dx * ax + dz * az);
    const projA = hLA * Math.abs(uxA * ax + uzA * az) + hWA * Math.abs(vxA * ax + vzA * az);
    const projB = hLB * Math.abs(uxB * ax + uzB * az) + hWB * Math.abs(vxB * ax + vzB * az);
    const penetration = projA + projB - centerDist;
    if (penetration <= toleranceM) {
      return false;
    }
  }

  return true;
}

// ---- Stall / no-output presentation helpers ----
import type { SimulationResult } from '../types/project';

type StageLike = { id?: string; bufferCapacity: number };

/** True when the post-run check flagged a stall in the modeled flow. */
export function isStalledResult(result?: Pick<SimulationResult, 'stallWarnings'> | null): boolean {
  return !!(result && result.stallWarnings && result.stallWarnings.length > 0);
}

/** Names of the stages where the modeled flow stops. A location only, not a capacity diagnosis. */
export function stallLocationNames(result?: Pick<SimulationResult, 'stallWarnings' | 'stageAnalytics'> | null): string {
  if (!result || !isStalledResult(result)) return '';
  const ids = new Set((result.stallWarnings || []).map((w) => w.stageId));
  return result.stageAnalytics
    .filter((s) => ids.has(s.stageId))
    .map((s) => s.stageName)
    .join(', ');
}

/** A lead time of exactly 0 means no unit finished. Show a dash instead of "0s". */
export function leadTimeText(avgLeadTimeSec: number, dash = '—'): string {
  return avgLeadTimeSec > 0 ? formatDuration(avgLeadTimeSec) : dash;
}

/** True when one uniform buffer value would replace at least one stage's own buffer capacity. */
export function uniformBufferReplacesStages(stages: StageLike[], bufferCapacity: number | undefined): boolean {
  return bufferCapacity !== undefined && !stages.every((s) => s.bufferCapacity === bufferCapacity);
}

/** Belt speed with at least 2 decimals, and up to 4 when the stored value needs them. */
export function formatBeltSpeed(v: number): string {
  return Number(v.toFixed(4)) === Number(v.toFixed(2)) ? v.toFixed(2) : String(Number(v.toFixed(4)));
}

/** True when the engine executed more events than the log holds (the log keeps only the first entries). */
export function isEventLogTruncated(loggedCount: number, executedCount: number | undefined | null): boolean {
  return typeof executedCount === 'number' && Number.isFinite(executedCount) && executedCount > loggedCount;
}

/**
 * Text for the OEE summary line. With no output, P and Q are undefined: show the
 * engine's OEE value (0 because no good units) without a product of dashes.
 */
export function oeeSummaryText(
  k: { oeePct?: number; availabilityPct?: number; performancePct?: number; qualityPct?: number; actualProduction?: number },
  isAr: boolean
): string {
  const oee = (k.oeePct ?? 0).toFixed(1);
  if ((k.actualProduction ?? 0) <= 0) {
    return isAr
      ? `${oee}% (لا إنتاج: الأداء P والجودة Q غير معرّفين)`
      : `${oee}% (no output: Performance P and Quality Q are undefined)`;
  }
  return `${oee}% = A ${(k.availabilityPct ?? 0).toFixed(1)}% × P ${(k.performancePct ?? 0).toFixed(1)}% × Q ${(k.qualityPct ?? 100).toFixed(1)}%`;
}

/**
 * Stage checkbox in the Products tab. A product that is not in manual (flowchart) routing keeps its own route list and stays
 * in auto routing, with the ticked stages kept in project stage order. A product already in manual routing keeps the previous
 * behaviour (its route is rebuilt from the flowchart wiring afterwards).
 */
export function toggleStageInProductRoute(
  prod: { routingMode?: 'auto' | 'manual'; routeStageIds: string[] },
  stageIds: string[],
  stageId: string
): { routingMode: 'auto' | 'manual'; routeStageIds: string[]; entryStageIds: string[] } {
  const isManual = prod.routingMode === 'manual';
  const active = prod.routeStageIds.includes(stageId);
  const raw = active ? prod.routeStageIds.filter((x) => x !== stageId) : [...prod.routeStageIds, stageId];
  const next = isManual ? raw : stageIds.filter((id) => raw.includes(id));
  return {
    routingMode: isManual ? 'manual' : 'auto',
    routeStageIds: next,
    entryStageIds: next.length > 0 ? [next[0]] : [],
  };
}
