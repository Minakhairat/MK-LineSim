/**
 * Formal OEE (Overall Equipment Effectiveness) Engineering Module
 *
 * Time Hierarchy (ISO 22400 / SEMI E10 aligned):
 *   1. Calendar Time (CT)            = Total simulation horizon [0, simTimeSec]
 *   2. Planned Downtime (PDT)        = Off-shift time + Planned Maintenance + Scheduled Breaks (when resource stops)
 *   3. Scheduled Production Time (SPT) = max(0, CT - PDT)
 *   4. Unplanned Downtime (UDT)      = Breakdown / failure repair durations within SPT
 *   5. Setup Time (SET)              = Changeover / setup durations
 *   6. Operating Time (OT)           = max(0, SPT - UDT - SET)
 *
 * KPI Formulas:
 *   - Availability (%) = SPT > 0 ? (OT / SPT) * 100 : 0
 *   - Performance (%)  = (OT > 0 && IdealCycleSec > 0) ? min(100, ((IdealCycleSec * TotalCount) / OT) * 100) : (TotalCount > 0 ? 100 : 0)
 *   - Quality (%)      = TotalCount > 0 ? (GoodCount / TotalCount) * 100 : 100
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
  /** Optional raw runtime (used only when idealCycleTimeSec <= 0 as fallback rate check) */
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
  performancePct: number;
  qualityPct: number;
  oeePct: number;
}

export function computeOeeMetrics(input: OeeInput): OeeResult {
  const calendarTimeSec = Math.max(0, input.calendarTimeSec);
  const plannedDowntimeSec = Math.min(calendarTimeSec, Math.max(0, input.plannedDowntimeSec));
  const scheduledProductionTimeSec = Math.max(0, calendarTimeSec - plannedDowntimeSec);

  const unplannedDowntimeSec = Math.min(
    scheduledProductionTimeSec,
    Math.max(0, input.unplannedDowntimeSec)
  );
  const remainingAfterDown = Math.max(0, scheduledProductionTimeSec - unplannedDowntimeSec);
  const setupTimeSec = Math.min(remainingAfterDown, Math.max(0, input.setupTimeSec));
  const operatingTimeSec = Math.max(0, scheduledProductionTimeSec - unplannedDowntimeSec - setupTimeSec);

  const availabilityPct =
    scheduledProductionTimeSec > 1e-6
      ? Math.min(100, Math.max(0, (operatingTimeSec / scheduledProductionTimeSec) * 100))
      : 0;

  const totalUnits = Math.max(0, input.totalUnitsProcessed);
  const goodUnits = Math.min(totalUnits, Math.max(0, input.goodUnitsProduced));

  let performancePct = 0;
  if (operatingTimeSec > 1e-6) {
    if (input.idealCycleTimeSec > 0) {
      const idealProductionTimeSec = input.idealCycleTimeSec * totalUnits;
      performancePct = Math.min(100, Math.max(0, (idealProductionTimeSec / operatingTimeSec) * 100));
    } else if (input.measuredRunningTimeSec !== undefined) {
      performancePct = Math.min(
        100,
        Math.max(0, (input.measuredRunningTimeSec / operatingTimeSec) * 100)
      );
    } else if (totalUnits > 0) {
      performancePct = 100;
    }
  }

  const qualityPct = totalUnits > 0 ? Math.min(100, Math.max(0, (goodUnits / totalUnits) * 100)) : 100;

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
    performancePct,
    qualityPct,
    oeePct,
  };
}
