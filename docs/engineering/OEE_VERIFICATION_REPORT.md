# MK LineSim — Phase 3 Verification & Statistical Validation Report

## 1. Defects Identified & Corrected

1. **Removed Silent 100% Performance Cap (`src/engineering/oeeEngine.ts`)**:
   - Eliminated `Math.min(100, ...)` from `computeOeeMetrics`. Retained exact uncapped `rawPerformancePct` and `performancePct`, raising `performanceAnomaly = true` whenever raw Performance $> 100.05\%$ or production occurs with $\text{OT} \le 10^{-6}$. Added `timeConsistencyAnomaly` and `calendarAvailabilityPct`.
2. **Heterogeneous Parallel & Shared Resource Cycle Fix (`src/simulation/desEngine.ts`)**:
   - Replaced stage harmonic `baseTaskTimeSec` fallback with per-server `ServerCapacityDetail.effectiveUnitCycleSec` lookup so fast/slow parallel resources report true 100% Performance instead of phantom $>100\%$ or $<100\%$ bias.
   - Added `objectStageProcessed` tracking (`objectId -> stageId -> exitingUnits`) so shared multi-stage machines weight their `idealCycleTimeSec` by actual work completed across stages.
3. **Capacity-Weighted Stage OEE & Stoppage Distinction (`src/simulation/desEngine.ts`, `src/simulation/resourceStateTracker.ts`)**:
   - Replaced uniform $1/N$ stage time averaging with nominal capacity-rate weights $w_r = \text{theoreticalCapacityPerHour}_r$, resolving heterogeneous parallel and mixed-shift stage Performance distortion.
   - Added timeline sweep `analyzeStageAvailabilityIntervals()` populating `completeStoppageTimeSec` vs. `partialCapacityLossTimeSec`.
4. **Propagated Line-Level Time Model (`src/simulation/resourceStateTracker.ts`, `src/simulation/desEngine.ts`, `src/simulation/timeAuditService.ts`)**:
   - Implemented `computePropagatedDowntimeSec()` capturing direct constraint-stage breakdowns, failure-induced starvation, failure-induced blocking, and upstream/downstream conveyor outages (while distinguishing normal initial pipeline fill and non-failure demand starvation).
   - Clipped unplanned downtime intervals strictly against active calendar SPT windows (`ResourceCalendarEngine.sumIntervalOverlapWithActive`) so shift-spanning repairs never double-count against planned downtime.
5. **Reliability Clamp & Telemetry Alignment (`src/simulation/desEngine.ts`, `src/simulation/failureModels.ts`)**:
   - Harmonized minimum repair duration clamp in `desEngine.ts` from `0.5s` to `0.1s` matching `failureModels.ts`.
   - Added `computeInherentAvailability`, `computeOperationalAvailability`, `computeEmpiricalStats` (Student's $t$ 95% CIs), and per-resource `failureCount`, `empiricalMtbfSec`, `empiricalMttrSec`, `inherentAvailabilityPct`.

---

## 2. Verification Scenarios Matrix (Executed in `tests/oeeAndReliabilityPhase3.test.ts`)

| # | Scenario | Key Verified Metrics & Assertions | Status |
|---|---|---|---|
| 1 | 1 machine, no failures | `A=100%`, `P=100%`, `Q=100%`, `OEE=100%`, `good=120`, `performanceAnomaly=false` | Pass |
| 2 | 1 machine, fixed failures (`MTBF=3600s, MTTR=180s`, `T=37800s`) | `failureCount=10`, `UDT=1800s`, `A=95.2381%` (`inherent=95.2381%`), `empMTBF=3600s`, `empMTTR=180s` | Pass |
| 3 | 2 parallel machines, 1 unavailable (`avail=0`) | `M1=100%`, `M2=0%`, `Stage A=50%`, `Stage P=100%`, `completeStoppage=0s`, `partialLoss=3600s` | Pass |
| 3b | Heterogeneous parallel (`M1=20s`, `M2=60s` w/ `avail=0`) | `M1 P=100%`, `Stage A=75%`, `Stage P=100%`, `Stage OEE=75%`, zero phantom `>100%` | Pass |
| 4 | 2 parallel machines, independent failures | `M1 UDT=900s`, `M2 UDT=600s`, `completeStoppage=100s`, `partialLoss=1300s`, `Stage A=79.17%` | Pass |
| 5 | Serial line (`S1->S2->S3`, `buf=0`) w/ upstream or downstream failure | Failed `S1` or `S3` (`1800s`) propagates starvation/blocking to `S2` -> `Line A ≈ 50%` | Pass |
| 6 | Serial line w/ intermediate buffer (`buf=150`) | `S1 A < 85%` decoupled by WIP inventory -> `Buffered Line A = 100%` vs `Unbuffered < 90%` | Pass |
| 7 | Non-bottleneck downtime (`S1 2x20s` 1 down -> `S2 30s`) | `Stage 1 A=50%`, yet `S2` never starves -> `Line A = 100%`, `OEE > 98%` | Pass |
| 8 | Mixed parallel shifts & shift-spanning repair (`t=3500..3800`, shift end `3600`) | `M1 UDT=100s` (clipped to SPT), `OT=3500s`, zero false `>100%` anomaly | Pass |
| 9 | Zero availability (`S1 avail=0` feeding `S2`) | `M1 A=0%, OEE=0%`, downstream cascade -> `Line A=0%, OEE=0%` | Pass |
| 10 | Zero production (`OT=30s > 0`, `good=0`) | `A=100%, P=0%, Q=0%, OEE=0%` | Pass |
| 11 | Zero operating time (100% planned maint + zero-OT unit anomaly) | `SPT=0, OT=0, A=0%, P=0%, OEE=0%`; unit test with `prod>0 & OT=0` flags `performanceAnomaly=true` | Pass |
| 12 | Scrap and rework (`scrap=10%, rework=20%`) | Rework non-double-counted, reduces Stage P; `Line Q = good/(good+scrap)`, `OEE = A*P*Q` exact | Pass |
| Ext | Conveyor outage (`avail=0`) + Shared machine (`st1=20s, st2=40s`) | Dead conveyor drives `Line A=0%`; shared machine `idealCycle ≈ 30s`, `P <= 100%`, zero anomaly | Pass |
| Ref | Default `DesertAirCooler` project baseline | Zero performance anomalies across Line, Stages, and Resources | Pass |

---

## 3. Multi-Seed Monte Carlo Statistical Validation Report

- **Reference Configuration**: Single workstation ($C = 120\text{s}$), target $\text{MTBF} = 3600\text{s}$, $\text{MTTR} = 180\text{s}$, theoretical Inherent Availability:
  $$A^* = \frac{3600}{3600 + 180} = 95.238095\%$$
- **Replication Design**: $N = 30$ independent seeds (`seed = 1000 + 37*k`) executed through `DiscreteEventSimulationEngine.runToCompletion()` across two horizons ($36{,}000\text{s}$ and $180{,}000\text{s}$) and two stochastic distribution pairs:

| Regime & Horizon ($N=30$ seeds) | Mean Operational $A_o$ | 95% Student's $t$ CI | Std Dev ($\sigma_A$) | Theoretical $A^*$ Covered? | Mean $\hat{\text{MTBF}}$ | Mean $\hat{\text{MTTR}}$ | Mean Failures |
|---|---:|---:|---:|:---:|---:|---:|---:|
| **Exp + Exp @ 36,000s** | **95.7592%** | `[95.1238%, 96.3946%]` ($\pm 0.6354\%$) | **1.7018%** | Yes | `4304.8 s` | `170.0 s` | `9.27` |
| **Exp + Exp @ 180,000s** | **95.4458%** | `[95.0489%, 95.8426%]` ($\pm 0.3968\%$) | **1.0629%** | Yes | `3715.2 s` | `173.1 s` | `47.27` |
| **Weibull ($k=2$) + LogNormal ($\sigma_{\text{rep}}=90\text{s}$) @ 180,000s** | **95.2597%** | `[95.0949%, 95.4245%]` ($\pm 0.1648\%$) | **0.4415%** | Yes | `3636.8 s` | `180.2 s` | `47.40` |

### Key Statistical Findings
1. **Unbiased Convergence & 95% CI Coverage**: All three empirical 95% confidence intervals cover the exact theoretical Inherent Availability $A^* = 95.2381\%$, with the $180{,}000\text{s}$ Weibull+LogNormal batch converging within $+0.022\%$ of $A^*$ and $+0.2\text{s}$ of target $\text{MTTR} = 180.0\text{s}$.
2. **Horizon Variance Reduction**: Increasing the horizon $5\times$ from $36{,}000\text{s}$ to $180{,}000\text{s}$ reduces operational availability standard deviation from $1.7018\%$ to $1.0629\%$ (and CI half-width from $0.6354\%$ to $0.3968\%$), eliminating short-horizon censorship bias in empirical MTBF ($4304.8\text{s} \to 3715.2\text{s}$).
3. **Standalone Distribution Audit ($N=4000$ draws)**: Fixed, Exponential, Weibull ($k=2$), Triangular, and LogNormal Method-of-Moments samplers all pass 95% CI and variance checks.

---

## 4. Modified Files

- `src/types/project.ts` — Added Phase 3 OEE anomaly, stoppage decomposition, and empirical reliability diagnostic fields.
- `src/engineering/oeeEngine.ts` — Documented 6-tier hierarchy, removed silent 100% Performance cap, added `rawPerformancePct`, `performanceAnomaly`, `timeConsistencyAnomaly`, `calendarAvailabilityPct`.
- `src/simulation/failureModels.ts` — Added `computeInherentAvailability`, `computeOperationalAvailability`, and `computeEmpiricalStats`.
- `src/simulation/resourceCalendar.ts` — Added `getObjectActiveProductionIntervals` and `sumIntervalOverlapWithActive`.
- `src/simulation/resourceStateTracker.ts` — Indexed machine intervals by ID; added `analyzeStageAvailabilityIntervals` and `computePropagatedDowntimeSec`.
- `src/simulation/timeAuditService.ts` — Integrated propagated line downtime and anomaly flags into `buildAuditedSimulationKPIs`.
- `src/simulation/desEngine.ts` — Enabled DES interval recording, failure/repair telemetry, `0.1s` repair min alignment, capacity-weighted stage OEE, per-server/shared ideal cycle resolution, SPT downtime clipping, and line constraint propagation.
- `tests/oeeAndReliabilityPhase3.test.ts` — Added 17 comprehensive OEE, reliability, 12-scenario DES, and multi-seed Monte Carlo validation tests.
- `docs/engineering/OEE_RELIABILITY_SPEC.md`, `docs/engineering/OEE_VERIFICATION_REPORT.md`, `docs/engineering/TEST_COVERAGE_MATRIX.md`.
