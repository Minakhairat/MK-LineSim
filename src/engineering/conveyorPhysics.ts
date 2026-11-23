import { Dimensions3D, LayoutObject, ProductDefinition } from '../types/project';

export type ConveyorFitErrorCode =
  | 'LENGTH_EXCEEDS_BELT'
  | 'WIDTH_EXCEEDS_BELT'
  | 'INVALID_BELT_DIMENSIONS'
  | 'INVALID_CONVEYOR_SPEED'
  | 'INVALID_PRODUCT_DIMENSIONS'
  | 'INVALID_PRODUCT_SPACING'
  | 'INVALID_DECLARED_CAPACITY';

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
  isValid: boolean;
  fitErrorCode?: ConveyorFitErrorCode;
  fitErrorMessage?: string;
}

function invalidMetrics(params: {
  beltLengthM: number;
  beltWidthM: number;
  speedMps: number;
  productLengthM: number;
  productWidthM: number;
  productSpacingM: number;
  fitErrorCode: ConveyorFitErrorCode;
  fitErrorMessage: string;
}): ConveyorMetrics {
  const pitchM =
    Number.isFinite(params.productLengthM) &&
    params.productLengthM > 0 &&
    Number.isFinite(params.productSpacingM) &&
    params.productSpacingM >= 0
      ? params.productLengthM + params.productSpacingM
      : 0;
  return {
    beltLengthM: Number.isFinite(params.beltLengthM) ? params.beltLengthM : 0,
    beltWidthM: Number.isFinite(params.beltWidthM) ? params.beltWidthM : 0,
    speedMps: Number.isFinite(params.speedMps) ? params.speedMps : 0,
    productLengthM: Number.isFinite(params.productLengthM) ? params.productLengthM : 0,
    productWidthM: Number.isFinite(params.productWidthM) ? params.productWidthM : 0,
    productSpacingM: Number.isFinite(params.productSpacingM) ? params.productSpacingM : 0,
    pitchM,
    minHeadwaySec: 0,
    transportCapacityPerMin: 0,
    transportCapacityPerHour: 0,
    physicalCapacity: 0,
    traversalTimeSec: 0,
    canFit: false,
    isValid: false,
    fitErrorCode: params.fitErrorCode,
    fitErrorMessage: params.fitErrorMessage,
  };
}

/**
 * Evaluates physical conveyor fit, headway, transport capacity, and traversal time.
 * Never forces physicalCapacity = 1 when a product exceeds belt length or width,
 * and never converts invalid physical inputs (<= 0, negative spacing, or NaN) into valid capacity.
 */
export function evaluateConveyorPhysics(
  conv: LayoutObject,
  prod?: ProductDefinition,
  overrideDims?: Partial<Dimensions3D>
): ConveyorMetrics {
  const beltLengthM = Number(conv.geometry?.dimensions?.length);
  const beltWidthM = Number(conv.geometry?.dimensions?.width);
  const speedMps = Number(conv.operations?.speedMps);

  const rawProdLength =
    overrideDims?.length !== undefined
      ? overrideDims.length
      : prod !== undefined
      ? prod.dimensions?.length
      : 0.5;
  const rawProdWidth =
    overrideDims?.width !== undefined
      ? overrideDims.width
      : prod !== undefined
      ? prod.dimensions?.width
      : 0.4;
  const productLengthM = Number(rawProdLength);
  const productWidthM = Number(rawProdWidth);

  const hasExplicitSpacing =
    conv.operations?.productSpacingM !== undefined && conv.operations?.productSpacingM !== null;
  const productSpacingM = hasExplicitSpacing ? Number(conv.operations.productSpacingM) : 0.15;

  const hasDeclaredCap =
    conv.operations?.capacity !== undefined && conv.operations?.capacity !== null;
  const declaredCap = hasDeclaredCap ? Number(conv.operations.capacity) : 0;

  if (!Number.isFinite(beltLengthM) || beltLengthM <= 0 || !Number.isFinite(beltWidthM) || beltWidthM <= 0) {
    return invalidMetrics({
      beltLengthM,
      beltWidthM,
      speedMps,
      productLengthM,
      productWidthM,
      productSpacingM,
      fitErrorCode: 'INVALID_BELT_DIMENSIONS',
      fitErrorMessage: `Conveyor "${conv.name}" requires positive finite length and width dimensions.`,
    });
  }

  if (!Number.isFinite(speedMps) || speedMps <= 0) {
    return invalidMetrics({
      beltLengthM,
      beltWidthM,
      speedMps,
      productLengthM,
      productWidthM,
      productSpacingM,
      fitErrorCode: 'INVALID_CONVEYOR_SPEED',
      fitErrorMessage: `Conveyor "${conv.name}" requires a positive finite belt speed (m/s).`,
    });
  }

  if (
    !Number.isFinite(productLengthM) ||
    productLengthM <= 0 ||
    !Number.isFinite(productWidthM) ||
    productWidthM <= 0
  ) {
    return invalidMetrics({
      beltLengthM,
      beltWidthM,
      speedMps,
      productLengthM,
      productWidthM,
      productSpacingM,
      fitErrorCode: 'INVALID_PRODUCT_DIMENSIONS',
      fitErrorMessage: `Product dimensions on conveyor "${conv.name}" must be positive finite values.`,
    });
  }

  if (!Number.isFinite(productSpacingM) || productSpacingM < 0) {
    return invalidMetrics({
      beltLengthM,
      beltWidthM,
      speedMps,
      productLengthM,
      productWidthM,
      productSpacingM,
      fitErrorCode: 'INVALID_PRODUCT_SPACING',
      fitErrorMessage: `Conveyor "${conv.name}" product spacing must be a non-negative finite value.`,
    });
  }

  if (!Number.isFinite(declaredCap) || declaredCap < 0) {
    return invalidMetrics({
      beltLengthM,
      beltWidthM,
      speedMps,
      productLengthM,
      productWidthM,
      productSpacingM,
      fitErrorCode: 'INVALID_DECLARED_CAPACITY',
      fitErrorMessage: `Conveyor "${conv.name}" declared capacity must be non-negative and finite.`,
    });
  }

  const pitchM = productLengthM + productSpacingM;

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
    physicalCapacity =
      declaredCap > 0
        ? Math.max(1, Math.min(Math.floor(declaredCap), physicalFitCount))
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
    isValid: true,
    fitErrorCode,
    fitErrorMessage,
  };
}

/**
 * Computes exact conveyor transit duration from measured path distance and speed.
 * Returns 0 if distance or speed is non-positive or non-finite.
 */
export function computeConveyorPathTimeSec(totalDistanceM: number, speedMps: number): number {
  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) return 0;
  if (!Number.isFinite(speedMps) || speedMps <= 0) return 0;
  return totalDistanceM / speedMps;
}
