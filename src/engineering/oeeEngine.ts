/**
 * Formal OEE (Overall Equipment Effectiveness) Engineering Module
 *
 * Time Hierarchy (ISO 22400 / SEMI E10 aligned):
 *   1. Calendar Time (CT)              = Total simulation/observation horizon [0, simTimeSec]
 *   2. Planned Downtime (PDT)          = Off-shift time + Scheduled Breaks + Planned Maintenance windows
 *   3. Scheduled Production Time (SPT) = max(0, CT - PDT)
 *   4. Unplanned Downtime (UDT)        = Breakdown / repair durations (and, at line level,
 *                                        failure-induced starvation, blocking, and conveyor outages) within SPT
 *   5. Setup / Changeover Time (SET)   = Setup and changeover durations within (SPT - UDT)
 *   6. Operating Time (OT)             = max(0, SPT - UDT - SET)
 *
 * Mutual Consistency Invariants:
 *   - 0 <= PDT <= CT
 *   - SPT = CT - PDT, 0 <= SPT <= CT
 *   - 0 <= UDT <= SPT
 *   - 0 <= SET <= SPT - UDT
 *   - 0 <= OT = SPT - UDT - SET <= SPT
 *
 * KPI Formulas:
 *   - Availability (%) = SPT > 0 ? (OT / SPT) * 100 : 0
 *   - Performance (%)  = (OT > 0 && IdealCycleSec > 0) ? ((IdealCycleSec * TotalCount) / OT) * 100 : 0
 *                        (NEVER silently capped at 100%; values > 100% or production at OT=0 raise performanceAnomaly)
 *   - Quality (%)      = TotalCount > 0 ? (GoodCount / TotalCount) * 100 : 0
 *   - OEE (%)          = (Availability / 100) * (Performance / 100) * (Quality / 100) * 100
 */

export interface OeeInput {
  calendarTimeSec: number;
  plannedDowntimeSec: number;
  unplannedDowntimeSec: number;
  setupTimeSec: number;
  idealCycleTimeSec: number;
  totalUnitsProcessed: number;
  goodUnitsProduced: number;
  /** Optional raw runtime (retained for interface compatibility; idealCycleTimeSec is required for OEE Performance) */
  measuredRunningTimeSec?: number;
}

export interface OeeResult {
  calendarTimeSec: number;
  plannedDowntimeSec: number;
  scheduledProductionTimeSec: number;
  unplannedDowntimeSec: number;
  setupTimeSec: number;
  operatingTimeSec: number;
  availabilityPct: number;
  calendarAvailabilityPct: number;
  /** Uncapped finite Performance (%) when OT > 0; 0 when OT = 0 (see rawPerformancePct & performanceAnomaly for OT = 0 with production) */
  performancePct: number;
  /** Exact raw (IdealCycleSec * TotalCount / OT) * 100 (Infinity when TotalCount > 0, IdealCycleSec > 0, OT <= 1e-6) */
  rawPerformancePct: number;
  performanceAnomaly: boolean;
  performanceAnomalyReason?: string;
  timeConsistencyAnomaly: boolean;
  qualityPct: number;
  oeePct: number;
}

function finiteNonNeg(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
}

const PERFORMANCE_ANOMALY_TOLERANCE_PCT = 100.05;

export function computeOeeMetrics(input: OeeInput): OeeResult {
  const rawCt = Number(input.calendarTimeSec);
  const rawPdt = Number(input.plannedDowntimeSec);
  const rawUdt = Number(input.unplannedDowntimeSec);
  const rawSet = Number(input.setupTimeSec);
  const rawTotal = Number(input.totalUnitsProcessed);
  const rawGood = Number(input.goodUnitsProduced);
  const rawCycle = Number(input.idealCycleTimeSec);

  const calendarTimeSec = finiteNonNeg(rawCt);
  const pdtInput = finiteNonNeg(rawPdt);
  const udtInput = finiteNonNeg(rawUdt);
  const setInput = finiteNonNeg(rawSet);

  const plannedDowntimeSec = Math.min(calendarTimeSec, pdtInput);
  const scheduledProductionTimeSec = Math.max(0, calendarTimeSec - plannedDowntimeSec);

  const unplannedDowntimeSec = Math.min(scheduledProductionTimeSec, udtInput);
  const remainingAfterDown = Math.max(0, scheduledProductionTimeSec - unplannedDowntimeSec);
  const setupTimeSec = Math.min(remainingAfterDown, setInput);
  const operatingTimeSec = Math.max(0, scheduledProductionTimeSec - unplannedDowntimeSec - setupTimeSec);

  const totalUnits = finiteNonNeg(rawTotal);
  const goodInput = finiteNonNeg(rawGood);
  const goodUnits = Math.min(totalUnits, goodInput);
  const idealCycleTimeSec = finiteNonNeg(rawCycle);

  const timeConsistencyAnomaly =
    !Number.isFinite(rawCt) ||
    rawCt < -1e-6 ||
    !Number.isFinite(rawPdt) ||
    rawPdt < -1e-6 ||
    !Number.isFinite(rawUdt) ||
    rawUdt < -1e-6 ||
    !Number.isFinite(rawSet) ||
    rawSet < -1e-6 ||
    pdtInput > calendarTimeSec + 1e-4 ||
    udtInput > scheduledProductionTimeSec + 1e-4 ||
    setInput > remainingAfterDown + 1e-4 ||
    goodInput > totalUnits + 1e-4;

  const availabilityPct =
    scheduledProductionTimeSec > 1e-6
      ? Math.min(100, Math.max(0, (operatingTimeSec / scheduledProductionTimeSec) * 100))
      : 0;

  const calendarAvailabilityPct =
    calendarTimeSec > 1e-6
      ? Math.min(100, Math.max(0, (operatingTimeSec / calendarTimeSec) * 100))
      : 0;

  let rawPerformancePct = 0;
  let performancePct = 0;
  let performanceAnomaly = false;
  let performanceAnomalyReason: string | undefined;

  if (idealCycleTimeSec > 0 && totalUnits > 0) {
    const idealProductionTimeSec = idealCycleTimeSec * totalUnits;
    if (operatingTimeSec > 1e-6) {
      rawPerformancePct = Math.max(0, (idealProductionTimeSec / operatingTimeSec) * 100);
      performancePct = rawPerformancePct;
      if (rawPerformancePct > PERFORMANCE_ANOMALY_TOLERANCE_PCT) {
        performanceAnomaly = true;
        performanceAnomalyReason = `Performance anomaly: raw performance ${rawPerformancePct.toFixed(2)}% exceeds 100% (ideal work ${idealProductionTimeSec.toFixed(2)}s > operating time ${operatingTimeSec.toFixed(2)}s). Check ideal cycle time calibration or shift/capacity weighting.`;
      }
    } else {
      rawPerformancePct = Number.POSITIVE_INFINITY;
      performancePct = 0;
      performanceAnomaly = true;
      performanceAnomalyReason = `Performance anomaly: ${totalUnits} units produced with ideal cycle ${idealCycleTimeSec.toFixed(2)}s while operatingTimeSec = 0s (division by zero prevented).`;
    }
  }

  const qualityPct = totalUnits > 0 ? Math.min(100, Math.max(0, (goodUnits / totalUnits) * 100)) : 0;

  const oeePct =
    scheduledProductionTimeSec > 1e-6
      ? (availabilityPct / 100) * (performancePct / 100) * (qualityPct / 100) * 100
      : 0;

  return {
    calendarTimeSec,
    plannedDowntimeSec,
    scheduledProductionTimeSec,
    unplannedDowntimeSec,
    setupTimeSec,
    operatingTimeSec,
    availabilityPct,
    calendarAvailabilityPct,
    performancePct,
    rawPerformancePct,
    performanceAnomaly,
    ...(performanceAnomalyReason ? { performanceAnomalyReason } : {}),
    timeConsistencyAnomaly,
    qualityPct,
    oeePct,
  };
}
