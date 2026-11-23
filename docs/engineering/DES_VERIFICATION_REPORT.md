# MK LineSim — Phase 2: Discrete Event Simulation (DES) Engine Verification Report

**Program Phase:** Phase 2 (Discrete Event Simulation Engine Verification)  
**Target Engine:** `DiscreteEventSimulationEngine` (`src/simulation/desEngine.ts`) and supporting deterministic modules (`priorityQueue.ts`, `autoWire.ts`, `timeAuditService.ts`, `failureModels.ts`, `types/project.ts`)  
**Verification Standard:** Independent analytical closed-form calculations compared against step-by-step DES runs with continuous invariant auditing (`eng.auditInvariants()` at every popped event step).  
**OEE Boundary:** Zero modifications made to `src/engineering/oeeEngine.ts` or OEE calculation formulas.

---

## 1. Executive Summary

A full mathematical and behavioral audit of the MK LineSim Discrete Event Simulation engine was executed across all 8 required verification domains and all 7 structural invariants. Every scenario was formulated with analytically derived expectations (lead times, event timestamps, machine allocation counts, conveyor headways, blockage/starvation durations, and mass-balance totals) and audited at **every event step** (`while (eng.stepNextEvent()) assert(eng.auditInvariants().ok)`).

Inspection and verification uncovered **8 concrete DES/wiring defects** (detailed in Section 3), each fixed minimally in source code without altering existing OEE logic, determinism, or seeded Mulberry32 PRNG streams. Following all fixes:
- **Test Suite (`npm test` / `tsx --test tests/*.test.ts`):** **`80/80` passed, `0` failed, `0` skipped** (70 baseline tests + 10 comprehensive multi-case Phase 2 verification tests in `tests/desVerificationPhase2.test.ts`).
- **Type Check (`npm run lint` -> `tsc --noEmit`):** **Passed (`0` errors)**.
- **Production Bundle (`npm run build` -> `vite build`):** **Passed**.

---

## 2. Verification Coverage Across All 8 Required Domains & 7 Invariants

### 2.1 Domain Matrix & Analytical Reference Validation

| Domain | Verified Behaviors & Analytical Scenarios | Analytical Expected vs. Observed DES Result | Status |
| :--- | :--- | :--- | :---: |
| **1. Event Scheduling** | • Binary min-heap ordering on `(timestamp, seq)`<br>• Monotonic event trace `(ts_i > ts_{i-1}) ∨ (ts_i == ts_{i-1} ∧ seq_i > seq_{i-1})`<br>• Simultaneous worker release & immediate reallocation across S1 & S2<br>• `0 s` and `0.001 s` (`1 ms`) processing durations<br>• Token invalidation on **both** processing-phase and walk-phase breakdowns | • Queue pop order exact across tied timestamps<br>• Shared worker handoff starts at `[0, 10, 20, 30]` s; completions at exact `30.0 s` & `40.0 s` (zero idle gap)<br>• `0s + 0.001s` completions exact at `[0.001, 5.001, 10.001]` s<br>• Processing preemption (`walk=5, proc=40, mtbf=25, mttr=20`): `65.0 s` exact; walk preemption (`walk=5, mtbf=3.5, mttr=10, proc=1`): `16.0 s` exact | **PASS** |
| **2. Material Conservation** | • Step-by-step `auditInvariants()` at every event tick across `collect_batch` (`B=4`), partial batch auto-flush (`10 % 4 = 2`), split unit `scrapRate = 0.25`, `reworkProbability = 0.25`, and downstream `unbatch` | • `totalReleasedUnits === 10` at completion<br>• `unaccountedUnits === 0` at **every** step<br>• `completedUnits + scrappedUnits + activeWipUnits === 10` at **every** step<br>• `goodUnits + defectiveUnits === 10`, `defectiveUnits > 0`, `reworkUnits > 0`, `absorbedChildEntities >= 10` | **PASS** |
| **3. Sequential Production** | • 3 serial stages: S1 (`10s`), S2 (`25s`, bottleneck), S3 (`15s`)<br>• Distinct calendars: S1/S2 `[0..300]`, S3 delayed shift `[40..300]`<br>• Finite buffers (`buf(S2)=1`, `buf(S3)=1`)<br>• Deterministic S2 breakdown (`mtbf=100s, mttr=20s`) | • `bottleneckStageId === 's2'`<br>• `m1.blockedTimeSec > 0` (backpressure)<br>• `m2.unplannedDowntimeSec >= 20`<br>• `m3.unavailableTimeSec === 40.0 s` exact | **PASS** |
| **4. Parallel Production** | • 2 identical machines (`30s`, `arrival=20s`, `10` units) auto load balancing<br>• Heterogeneous parallel cycles (`20s` vs `40s`, `120s` horizon, `arrival=1s`)<br>• 1 machine unavailable (`availability=0`), 1 under repair (`mtbf=25, mttr=20`), 1 healthy + 1 shared worker contention<br>• Multi-capacity machine (`capacity=3`, `proc=30s`, `arrival=5s`, `6` units) | • Identical balance: `M1 = 5`, `M2 = 5` (total `10`)<br>• Heterogeneous: `M_fast = 6` (`floor(120/20)`), `M_slow = 2` (`41, 81`), total `8` exact<br>• `mDown`: `processedCount = 0`, `runningTimeSec = 0`; `4` units complete safely<br>• Multi-capacity completions: exact `[30, 35, 40, 60, 65, 70]` s | **PASS** |
| **5. Buffer Logic** | • S1 (`10s, buf=50`) -> S2 (`20s, buf=2`) with `arrival=5s`<br>• S2 planned stop `[40..80]` fills buffer -> upstream S1 blocks -> post-`80s` recovery<br>• Upstream S1 planned stop `[150..220]` -> S2 drains buffer -> `starved` state | • Observed initial empty (`0`), partial fill & release, `BufferFull` at `s2`, `m1 === 'blocked'` in `[40..80]`, `m1 === 'running'` recovery `> 80s`, `m2 === 'starved'` in `[180..220]` | **PASS** |
| **6. Conveyor Logic** | • Conveyor-only stage (`10m @ 2.0 m/s`, `pitch=0.75m`, `headway=0.375s`, `arrival=0.2s`)<br>• Merging/blocking from 2 parallel upstream feeds onto `1.0m` shared conveyor<br>• Mid-transit conveyor breakdown (`t=12..32`, `len=10.6m @ 1m/s`, U1 starts transfer at `5s`) with upstream U2 finishing at `17s` | • Conveyor-only: `avgProcessingTimeSec === 0`, `totalConveyorTransitTimeSec === 25.0 s`, entries exact `[0, 0.375, 0.75, 1.125, 1.5]` s, exits exact `[5, 5.375, 5.75, 6.125, 6.5]` s<br>• Shared merge conveyor emits `BufferFull` and preserves headway + `goodUnits = 4`<br>• Breakdown: U1 frozen at exact `conveyorProgress === 0.7`, U2 stays `'blocked'` at `m1` `[17..32]`, completes `[40, 47]` s exact | **PASS** |
| **7. Routing** | • Multi-product distinct routes + repeated stage visits (`Prod A: [S1, S2, S1, S3]`, `Prod B: [S1, S3]`)<br>• Rework cycles (`reworkProb=1.0`, capped at 2 retries -> 3 passes)<br>• Total scrap (`scrapRate=1.0`)<br>• Mutual routing deadlock cycle (`mD1 <-> mD2` with `bufferCapacity=0`, manual routing) | • Stage entries: `S1=3` (`A`x2 + `B`x1), `S2=1`, `S3=2`; completions exact `[55, 130]` s<br>• Rework: `goodUnits=1`, `reworkCycles=2`, exit `30.0 s`<br>• Scrap: `goodUnits=0`, `defectiveUnits=3`<br>• Deadlock: `blockedAtStationUnits === 2`, `goodUnits=0`, `audit.deadlocks` reports circular wait `sD1 <-> sD2` | **PASS** |
| **8. Simulation Termination** | • Natural completion & early empty queue (`maxPlannedUnits=4`, shift `[0..60]` inside `H=3600`)<br>• Long-shift zero residual production events after `t=60s`<br>• Time-horizon cutoff (`H=50s`, `proc=20s`) conserving WIP<br>• Incomplete WIP at shift end under `stop_immediately` vs `finish_current_cycle`<br>• Seed determinism (`seed=4219` with stochastic scrap, rework, exponential failure, lognormal repair) | • Early empty-queue loop stops at `lastActiveClock === 60.0 s`, `currentWip === 0`, `goodUnits === 4`<br>• Long shift: last non-calendar event timestamp === `60.0 s`<br>• Horizon `50s`: `clockSec === 50`, `goodUnits === 2`, `activeWipUnits > 0`, `unaccountedUnits === 0`<br>• Shift `[0..50]`, `[100..200]`: `stop_immediately -> [30, 110]`, `finish_current_cycle -> [30, 60]`<br>• Repeated runs produce bit-identical `SimEvent[]` and `SimulationKPIs` | **PASS** |

---

## 3. Root Causes Found & Exact Corrections Applied

1. **Conveyor Breakdowns Silently Ignored & Unpaused Transfers During Outages (`src/simulation/failureModels.ts`, `src/simulation/desEngine.ts`)**
   - *Cause:* `resolveObjectFailureParams` unconditionally returned `enabled: false` for all `obj.kind === 'conveyor'`, while `handleBreakdownStarted`, `handleRepairCompleted`, and `syncResourcesToCalendar` had no logic to freeze active `conveyorTransits`, invalidate `transferToken`s, block upstream transfers onto down/unavailable conveyors, or retry blocked upstreams upon conveyor recovery.
   - *Fix:* Enabled conveyor breakdown modeling when explicit positive MTBF+MTTR (or `availability <= 0`) is configured alongside `enableBreakdowns === true` (leaving nominal catalog `availability: 0.99` conveyors uninterrupted). Implemented `isConveyorAvailableForTransport`, `pauseConveyorTransits`, `resumeConveyorTransits`, `syncRecoveredConveyorState`, `retryBlockedUpstreamAll`, and paused interpolation locking inside `desEngine.ts`.

2. **Conveyor Node Polyline vs. Physical Belt Speed Mismatch (`src/simulation/desEngine.ts`)**
   - *Cause:* Conveyor flowchart nodes trimmed `halfL = beltLen / 2 - 0.15` (`9.7m` path vs `10.0m` belt traveled in `10/2 = 5.0s`), passed hardcoded `sEnter = 0` to `computeConveyorEntryDelay`, and started collision scanning at `now` instead of `Math.max(now, lastEntry + minGapSec)`, causing spurious micro-delays (`+6.75 ms` drift by unit 4) relative to theoretical `pitch / speed` headway.
   - *Fix:* Set `halfL = beltLen / 2` so polyline distance matches `beltLengthM` cleanly, passed actual `entryAx.sBelt` / `entryAx.perpBelt`, and initiated `computeConveyorEntryDelay` from `earliestEntry = Math.max(now, lastEntry + minGapSec)`.

3. **Repeated Stage Visits & Multi-Product Route Corruption (`src/types/project.ts`, `src/simulation/desEngine.ts`, `src/simulation/autoWire.ts`)**
   - *Cause:* Next-stage resolution previously searched `route.indexOf(currentStageId)`, entering an infinite loop when a route visited a stage more than once (e.g. `['S1', 'S2', 'S1', 'S3']`), and `syncProductRoutes` defaulted to appending all project stages onto distinct shorter product routes.
   - *Fix:* Added `routeStepIndex?: number` on `ProductEntityState` preserved cleanly across arrivals, batch assembly, unbatching, and completion; changed `syncProductRoutes` default `appendMissingStages = false`.

4. **User `bufferCapacity === 0` Silently Overwritten to `4` (`src/simulation/autoWire.ts`)**
   - *Cause:* Three checks (`if (st.bufferCapacity < 1) st.bufferCapacity = 4`) in `importFlowchartToSimulationData` and `autoWireProjectForSimulation` coerced explicit zero-buffer configurations (`0`) to `4`, breaking zero-buffer blocking & cyclic deadlock scenarios under manual routing.
   - *Fix:* Changed all three guards to `!Number.isFinite(st.bufferCapacity) || st.bufferCapacity < 0`.

5. **Heterogeneous Parallel Cycle Lookup & Load Balancing (`src/simulation/timeAuditService.ts`, `src/simulation/desEngine.ts`)**
   - *Cause:* `desEngine` called timing helpers without passing `stageAssignedObjs`, so heterogeneous parallel machines could fall back to a shared stage cycle, and `findAvailableStation` did not explicitly tie-break by load ratio, server cycle, and cumulative running work.
   - *Fix:* Added optional `stageObjects?: LayoutObject[]` to `resolveServerTiming`, `computeStageSetupDurationSec`, and `computeStageProcessingTimeSec`; updated `findAvailableStation` and `tryStartStage` to pass `stageAssignedObjs` and balance deterministically on `(loadRatio, serverCycle, processedCount, runningTime, idx)`.

6. **Preempted Walk Headway Loss & Horizon Parity in Step Mode (`src/simulation/desEngine.ts`)**
   - *Cause:* Interrupted pending walk jobs lost `remainingDispatchDelaySec` (conveyor headway delay) upon resumption; early `WorkerReleased` did not dispatch waiting stages immediately; and `stepNextEvent()` did not run full `updateWipIntegral` + `updateInterpolatedPositions` when terminating at `horizon`.
   - *Fix:* Preserved `remainingDispatchDelaySec` in `preemptPendingWalkJobs` / `preemptPendingWalkJobsForEntity` / `resumePausedWalkJobs`, invoked `tryDispatchAllStages` on early `WorkerReleased`, and aligned `stepNextEvent()` horizon finalization with `advanceTo(horizon)`.

7. **Pause-Preempted `computeConveyorEntryDelay` Bounded Passes (`src/simulation/desEngine.ts`)**
   - *Cause:* Fixed `16`-pass cap in `computeConveyorEntryDelay` could terminate prematurely on busy long belts, and paused transits used `candidateTime` rather than frozen `pausedAt`.
   - *Fix:* Expanded pass bound to `Math.max(16, this.conveyorTransits.size + 4)` and evaluated paused items at `tr.paused ? (tr.pausedAt ?? tr.startTime) : candidateTime`.

8. **Continuous Invariant Auditor (`src/simulation/desEngine.ts`: `auditInvariants()`)**
   - *Addition:* Exported `DesInvariantAuditResult` & `DesMaterialConservationBreakdown` and implemented `eng.auditInvariants()`, verifying all 7 required invariants plus circular-wait deadlock cycle detection across `blockedOutbox` at any simulation timestamp.

---

## 4. Exact Modified & Added Files

### Modified Source Files
1. `src/types/project.ts` — Added optional `routeStepIndex?: number` on `ProductEntityState`.
2. `src/simulation/autoWire.ts` — Changed `syncProductRoutes` `appendMissingStages` default to `false`; preserved explicit `bufferCapacity === 0` (`!Number.isFinite(...) || < 0`).
3. `src/simulation/timeAuditService.ts` — Added optional `stageObjects?: LayoutObject[]` parameter to `resolveServerTiming`, `computeStageSetupDurationSec`, and `computeStageProcessingTimeSec`.
4. `src/simulation/failureModels.ts` — Enabled explicit MTBF+MTTR and `availability <= 0` failure parameters on conveyors under `enableBreakdowns: true`.
5. `src/simulation/desEngine.ts` — Conveyor failure/pause/restart/blocking integration, conveyor-node length & headway alignment, `routeStepIndex` multi-visit progression, heterogeneous parallel load balancing & timing propagation, walk dispatch delay resumption, early `WorkerReleased` dispatch, `stepNextEvent()` horizon parity, and `auditInvariants()`.

### Added Verification Tests & Documentation
6. `tests/desVerificationPhase2.test.ts` — 10 comprehensive deterministic verification suites covering Domains 1–8, analytical reference validation, seed repeatability, and step-by-step `auditInvariants()` checks.
7. `docs/engineering/EVENT_ACCOUNTING_SPEC.md` — Event ordering, token lifecycle, material conservation, and state conservation specification.
8. `docs/engineering/DES_VERIFICATION_REPORT.md` — This Phase 2 verification report.

*(Zero changes to `src/engineering/oeeEngine.ts` or any OEE logic.)*

---

## 5. Actual Executed Verification Results

| Check | Command | Observed Result |
| :--- | :--- | :--- |
| **Phase 2 Test Suite** | `npx tsx --test tests/desVerificationPhase2.test.ts` | **`10/10` passed, `0` failed, `0` skipped** |
| **Full Regression Suite** | `npm test` (`tsx --test tests/*.test.ts`) | **`80/80` passed, `0` failed, `0` skipped** |
| **TypeScript Static Check** | `npm run lint` (`tsc --noEmit`) | **Passed (`exit 0`)** |
| **Production Build** | `npm run build` (`vite build`) | **Passed (`exit 0`)** |
