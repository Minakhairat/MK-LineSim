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
  physicalCapacity: number;
  traversalTimeSec: number;
  canFit: boolean;
  fitErrorCode?: ConveyorFitErrorCode;
  fitErrorMessage?: string;
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
  const beltLengthM = Math.max(0.01, Number(conv.geometry.dimensions.length) || 0.01);
  const beltWidthM = Math.max(0.01, Number(conv.geometry.dimensions.width) || 0.01);
  const speedMps = Math.max(0.001, Number(conv.operations.speedMps) || 0.001);

  const productLengthM = Math.max(
    0.01,
    overrideDims?.length ?? (Number(prod?.dimensions.length) || 0.5)
  );
  const productWidthM = Math.max(
    0.01,
    overrideDims?.width ?? (Number(prod?.dimensions.width) || 0.4)
  );
  const productSpacingM = Math.max(0, Number(conv.operations.productSpacingM ?? 0.15));
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
      declaredCap > 0 ? Math.max(1, Math.min(declaredCap, physicalFitCount)) : physicalFitCount;
  }

  return {
    beltLengthM,
    beltWidthM,
    speedMps,
    productLengthM,
    productWidthM,
    productSpacingM,
    pitchM,
    minHeadwaySec: pitchM / speedMps,
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
  if (totalDistanceM <= 0) return 0;
  return totalDistanceM / Math.max(0.001, speedMps);
}
