import {
  FailureDistributionType,
  LayoutObject,
  PlannedMaintenanceWindow,
  RepairDistributionType,
  SimulationConfig,
} from '../types/project';

export interface FailureModelParams {
  enabled: boolean;
  failureModel: FailureDistributionType;
  repairModel: RepairDistributionType;
  mtbfSec: number;
  /** Arithmetic mean time to repair in seconds */
  mttrSec: number;
  /** Arithmetic standard deviation of repair duration in seconds (for lognormal) */
  mttrStdDevSec: number;
  weibullShape: number;
  weibullScaleSec: number;
  availability: number;
}

/**
 * Deterministic Mulberry32 PRNG for reproducible reliability & DES sampling.
 */
export function createSeededRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lanczos approximation for Gamma(z), z > 0.
 * Used to convert target MTBF into Weibull scale parameter lambda = MTBF / Gamma(1 + 1/k).
 */
export function gammaFn(z: number): number {
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  }
  const zm1 = z - 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) {
    x += p[i] / (zm1 + i + 1);
  }
  const t = zm1 + p.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, zm1 + 0.5) * Math.exp(-t) * x;
}

/**
 * Converts arithmetic mean M > 0 and arithmetic standard deviation S >= 0
 * into log-space parameters (mu, sigma) via exact Method of Moments:
 *   sigma^2 = ln(1 + (S / M)^2)
 *   mu      = ln(M) - 0.5 * sigma^2
 */
export function lognormalParamsFromArithmeticMoments(
  meanSec: number,
  stdDevSec: number
): { mu: number; sigma: number } {
  const mean = Math.max(0.1, meanSec);
  const sd = Math.max(0, stdDevSec);
  const cvSq = (sd / mean) * (sd / mean);
  const sigmaSq = Math.log(1 + cvSq);
  const sigma = Math.sqrt(sigmaSq);
  const mu = Math.log(mean) - 0.5 * sigmaSq;
  return { mu, sigma };
}

/**
 * Resolves failure & repair distribution parameters from equipment operational properties
 * and simulation configuration.
 */
export function resolveObjectFailureParams(
  obj: LayoutObject,
  config: SimulationConfig
): FailureModelParams {
  const failureModel: FailureDistributionType = obj.operations.failureModel ?? 'exponential';
  const repairModel: RepairDistributionType = obj.operations.repairModel ?? 'exponential';
  const weibullShape = Math.max(0.2, Number(obj.operations.weibullShape ?? 1.5));

  if (!config.enableBreakdowns || (obj.kind !== 'machine' && obj.kind !== 'workstation')) {
    return {
      enabled: false,
      failureModel,
      repairModel,
      mtbfSec: 0,
      mttrSec: 0,
      mttrStdDevSec: 0,
      weibullShape,
      weibullScaleSec: 0,
      availability: 1,
    };
  }

  const avail = Math.min(1, Math.max(0.01, Number(obj.operations.availability ?? 1)));
  const rawMtbf = Number(obj.operations.mtbfSec || 0);
  const rawMttr = Number(obj.operations.mttrSec || 0);
  const rawScale = Number(obj.operations.weibullScaleSec || 0);

  let mtbfSec = 0;
  let mttrSec = 0;

  if (rawMtbf > 0 && rawMttr > 0) {
    mtbfSec = rawMtbf;
    mttrSec = rawMttr;
  } else if (avail < 0.9999) {
    mttrSec = rawMttr > 0 ? rawMttr : Math.max(10, (obj.operations.processingTimeSec || 30) * 3);
    mtbfSec =
      rawMtbf > 0 ? rawMtbf : Math.max(1, (mttrSec * avail) / Math.max(1e-4, 1 - avail));
  } else if (failureModel === 'weibull' && rawScale > 0 && rawMttr > 0) {
    mttrSec = rawMttr;
    mtbfSec = rawScale * gammaFn(1 + 1 / weibullShape);
  } else {
    return {
      enabled: false,
      failureModel,
      repairModel,
      mtbfSec: 0,
      mttrSec: 0,
      mttrStdDevSec: 0,
      weibullShape,
      weibullScaleSec: 0,
      availability: 1,
    };
  }

  const weibullScaleSec =
    rawScale > 0 ? rawScale : mtbfSec / Math.max(1e-6, gammaFn(1 + 1 / weibullShape));
  const rawStdDev = obj.operations.mttrStdDevSec;
  const mttrStdDevSec =
    rawStdDev !== undefined && Number.isFinite(Number(rawStdDev)) && Number(rawStdDev) >= 0
      ? Number(rawStdDev)
      : 0.5 * mttrSec; // Default CV = 0.5 for repair times when stdDev not explicitly provided

  return {
    enabled: true,
    failureModel,
    repairModel,
    mtbfSec,
    mttrSec,
    mttrStdDevSec,
    weibullShape,
    weibullScaleSec,
    availability: avail,
  };
}

/**
 * Samples time-to-failure using configured failure distribution (fixed, exponential, or Weibull).
 */
export function sampleTimeToFailureSec(
  params: FailureModelParams,
  rng: () => number
): number {
  if (!params.enabled || params.mtbfSec <= 0) return Infinity;
  if (params.failureModel === 'fixed') {
    return Math.max(0.1, params.mtbfSec);
  }
  const u = Math.max(1e-7, Math.min(0.9999999, 1 - rng()));
  if (params.failureModel === 'weibull') {
    const k = Math.max(0.2, params.weibullShape);
    const lambda = Math.max(0.1, params.weibullScaleSec || params.mtbfSec);
    return Math.max(0.1, lambda * Math.pow(-Math.log(u), 1 / k));
  }
  return Math.max(0.1, -params.mtbfSec * Math.log(u));
}

/**
 * Samples repair duration using configured repair distribution:
 * - fixed: deterministic mttrSec
 * - triangular: symmetric [0.5*M, 1.5*M] with mode M
 * - lognormal: arithmetic mean M = mttrSec and arithmetic std dev S = mttrStdDevSec via Box-Muller
 * - exponential: memoryless rate 1/M
 */
export function sampleRepairDurationSec(
  params: FailureModelParams,
  rng: () => number
): number {
  if (!params.enabled || params.mttrSec <= 0) return 0;
  if (params.repairModel === 'fixed') {
    return Math.max(0.1, params.mttrSec);
  }
  if (params.repairModel === 'triangular') {
    const a = 0.5 * params.mttrSec;
    const b = 1.5 * params.mttrSec;
    const u = Math.max(1e-7, Math.min(0.9999999, rng()));
    if (u < 0.5) {
      return a + Math.sqrt(u * (b - a) * (params.mttrSec - a));
    }
    return b - Math.sqrt((1 - u) * (b - a) * (b - params.mttrSec));
  }
  if (params.repairModel === 'lognormal') {
    const { mu, sigma } = lognormalParamsFromArithmeticMoments(
      params.mttrSec,
      params.mttrStdDevSec
    );
    if (sigma <= 1e-9) {
      return Math.max(0.1, params.mttrSec);
    }
    const u1 = Math.max(1e-7, Math.min(0.9999999, rng()));
    const u2 = Math.max(1e-7, Math.min(0.9999999, rng()));
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0.1, Math.exp(mu + sigma * z));
  }
  const u = Math.max(1e-7, Math.min(0.9999999, 1 - rng()));
  return Math.max(0.1, -params.mttrSec * Math.log(u));
}

/**
 * Collects all planned maintenance windows applicable to an object.
 */
export function getObjectPlannedMaintenanceWindows(
  obj: LayoutObject,
  config: SimulationConfig
): PlannedMaintenanceWindow[] {
  return [
    ...(config.maintenanceWindows || []).filter((w) => !w.objectId || w.objectId === obj.id),
    ...(obj.operations.plannedMaintenance || []),
  ];
}
