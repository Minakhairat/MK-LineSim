import { Dimensions3D, LayoutObject, ProductDefinition } from '../types/project';

export type ConveyorFitErrorCode = 'LENGTH_EXCEEDS_BELT' | 'WIDTH_EXCEEDS_BELT';

export interface ConveyorMetrics {
  beltLengthM: number;
  beltWidthM: number;
  speedMps: number;
  productLengthM: number;
  productWidthM: number;
  productSpacingM: number;
  pitchM: number;
  minHeadwaySec: number;
  transportCapacityPerMin: number;
  transportCapacityPerHour: number;
  physicalCapacity: number;
  traversalTimeSec: number;
  canFit: boolean;
  fitErrorCode?: ConveyorFitErrorCode;
  fitErrorMessage?: string;
}

function posFinite(val: unknown, fallback: number, minVal = 0.001): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= minVal ? n : fallback;
}

/**
 * Evaluates physical conveyor fit, headway, capacity, and traversal time.
 * Never forces physicalCapacity = 1 when a product exceeds belt length or width.
 */
export function evaluateConveyorPhysics(
  conv: LayoutObject,
  prod?: ProductDefinition,
  overrideDims?: Partial<Dimensions3D>
): ConveyorMetrics {
  const beltLengthM = posFinite(conv.geometry.dimensions.length, 0.01, 0.01);
  const beltWidthM = posFinite(conv.geometry.dimensions.width, 0.01, 0.01);
  const speedMps = posFinite(conv.operations.speedMps, 0.001, 0.001);

  const productLengthM = posFinite(
    overrideDims?.length ?? prod?.dimensions.length,
    0.5,
    0.01
  );
  const productWidthM = posFinite(
    overrideDims?.width ?? prod?.dimensions.width,
    0.4,
    0.01
  );
  const rawSpacing = Number(conv.operations.productSpacingM ?? 0.15);
  const productSpacingM = Number.isFinite(rawSpacing) ? Math.max(0, rawSpacing) : 0.15;
  const pitchM = Math.max(0.01, productLengthM + productSpacingM);

  let canFit = true;
  let fitErrorCode: ConveyorFitErrorCode | undefined;
  let fitErrorMessage: string | undefined;

  if (productLengthM > beltLengthM + 1e-6) {
    canFit = false;
    fitErrorCode = 'LENGTH_EXCEEDS_BELT';
    fitErrorMessage = `Product length (${productLengthM.toFixed(2)}m) exceeds conveyor "${conv.name}" belt length (${beltLengthM.toFixed(2)}m).`;
  } else if (productWidthM > beltWidthM + 1e-6) {
    canFit = false;
    fitErrorCode = 'WIDTH_EXCEEDS_BELT';
    fitErrorMessage = `Product width (${productWidthM.toFixed(2)}m) exceeds conveyor "${conv.name}" belt width (${beltWidthM.toFixed(2)}m).`;
  }

  let physicalCapacity = 0;
  if (canFit) {
    // Remaining usable length accommodates 1 leading product plus trailing (N-1) pitched units
    const trailingSlots = Math.floor(Math.max(0, beltLengthM - productLengthM) / pitchM);
    const physicalFitCount = 1 + trailingSlots;
    const declaredCap = Number(conv.operations.capacity || 0);
    physicalCapacity =
      Number.isFinite(declaredCap) && declaredCap > 0
        ? Math.max(1, Math.min(declaredCap, physicalFitCount))
        : physicalFitCount;
  }

  const minHeadwaySec = pitchM / speedMps;
  const transportCapacityPerMin = canFit && minHeadwaySec > 0 ? 60 / minHeadwaySec : 0;
  const transportCapacityPerHour = canFit && minHeadwaySec > 0 ? 3600 / minHeadwaySec : 0;

  return {
    beltLengthM,
    beltWidthM,
    speedMps,
    productLengthM,
    productWidthM,
    productSpacingM,
    pitchM,
    minHeadwaySec,
    transportCapacityPerMin,
    transportCapacityPerHour,
    physicalCapacity,
    traversalTimeSec: beltLengthM / speedMps,
    canFit,
    fitErrorCode,
    fitErrorMessage,
  };
}

/**
 * Computes exact conveyor transit duration from measured path distance and speed.
 */
export function computeConveyorPathTimeSec(totalDistanceM: number, speedMps: number): number {
  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) return 0;
  const spd = Number.isFinite(speedMps) ? Math.max(0.001, speedMps) : 0.001;
  return totalDistanceM / spd;
}
