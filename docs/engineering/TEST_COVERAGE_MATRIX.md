# MK LineSim — Test Coverage Matrix & Verification Gaps

**Program Phase:** Phase 0, 0.1, 0.2 & 0.2.1 (Engineering Baseline, Evidence Reconciliation & Lockfile/CI Hardening)  
**Target System:** MK LineSim (`https://github.com/Minakhairat/MK-LineSim`)  
**Execution Evidence:** `npm test` (`tsx --test tests/*.test.ts`) -> **`57/57` passed, `0` failed, `0` skipped (`3436.99 ms` post-`npm ci`, exit code `0`)**.

---

## 1. Automated Unit & Integration Test Inventory (`tests/*.test.ts`)

| Test File | `wc -l` | TAP Count | Primary Engineering Domain(s) | Key Verified Assertions & Anchors |
| :--- | :---: | :---: | :--- | :--- |
| `tests/benchmarksAndRegression.test.ts` | 52 | 2 | Full DES Suite Regression & Sample Project Migration | Executes all 16 embedded benchmarks (`runAllEngineeringBenchmarks()`) with 0 failures; validates/simulates/migrates `createDesertAirCoolerProject()`. |
| `tests/capacityEngine.regression.test.ts` | 172 | 2 | Capacity Math & DES Throughput Scaling | Scenario A1 (buffers, conveyors, storage, vehicles, duplicate IDs never inflate server count); Scenario A2 (2 true parallel machines double analytical capacity & DES throughput). |
| `tests/conveyorAndOee.test.ts` | 429 | 6 | Conveyor Physics, Accumulating DES & OEE Time Hierarchy | Physical belt fit guard (`LENGTH_EXCEEDS_BELT`, `WIDTH_EXCEEDS_BELT`), headway/capacity, `computeOeeMetrics` hierarchy, non-overlap at rapid arrivals, accumulating pitch hold behind blocked leader, multi-slot spatial separation. |
| `tests/conveyorWorkerDragAndRotation.test.ts` | 402 | 9 | Worker Ergonomics, Geometry, Accounting & Schema Migration | `normalizeRotationDeg`, perpendicular conveyor-segment worker placement, DES tracking, `rotation`/`rotationDeg` & `assignedTo`/`assignedStationId` sync, exclusion of passive belt transit & breakdown repair from worker Busy, N/S/E/W & Side B persistence, `capacity=2` `idealUnitCycleSec` amortization. |
| `tests/engineeringAuditVerification.test.ts` | 874 | 13 | Core Acceptance Suite, Line OEE, OBB SAT & Regression Fixes | Tests 1–8 (60 u/hr single, 120 u/hr parallel, 90 u/hr bottleneck, 120 u/min conveyor & 0-machine isolation, MTBF=3600/MTTR=180 availability `95.238%`, formal 90% Quality OEE, 7h shift `25200s`, heterogeneous Line OEE separation), 2D OBB SAT rotated collision, NaN/migration rejection, stage-specific bottleneck `assignedObjectIds`, `availability=0` zero-running, `Number.isInteger()` enforcement. |
| `tests/engineeringStabilization.test.ts` | 603 | 7 | Batching, Worker Walk, Interruption Policies, Worker RPC, Multi-Product, Quality | Issues A–G: `single` vs `collect_batch` vs `unbatch`; walk time excluded from machine `running`/`setup`; break interruption policies (`stop_immediately`, `finish_current_cycle`, `continue_during_break`); `runFullSimulationInWorker` single-pass determinism; SKU cycle overrides & dispatching rules; unit/batch/queue wait separation; per-unit vs per-batch scrap/rework & Mass Balance. |
| `tests/failureModels.test.ts` | 90 | 1 | Reliability Failure & Repair Samplers | `fixed`, `exponential`, and `weibull` (with `gammaFn` scale) failure sampling; `triangular` repair sampling reproducibility. |
| `tests/repairDistribution.test.ts` | 99 | 3 | Lognormal Repair Math | Method-of-Moments `(mu, sigma)` conversion; deterministic N=5000 lognormal sample mean & stdDev reproduction; degenerate `mttrStdDevSec=0` exact `mttrSec`. |
| `tests/resourceCalendar.test.ts` | 151 | 3 | Calendar Validation & Shift/Break Policies | Overlapping shifts/breaks & out-of-shift break detection; multi-shift horizon clipping & planned maintenance; `runDuringBreaks` machine continuity during worker break. |
| `tests/resourceCalendarValidation.test.ts` | 70 | 2 | Calendar Validation & Worker Schema Migration | Invalid object/worker shift IDs, partial/outside maintenance horizon, negative lognormal params; `worker.rotationDeg` migration persistence. |
| `tests/resourceOeeRegression.test.ts` | 154 | 1 | Heterogeneous Shift OEE | Scenario B2: validates individual Resource OEE against weighted/line Plant OEE under heterogeneous resource shifts. |
| `tests/resourceSpecificCalendar.test.ts` | 244 | 3 | Resource-Specific Shifts & Conveyor Manual Stages | Invalid explicit `shiftId`/`operatingSchedule` stays unavailable (no plant fallback); `heatmap.ts` per-resource denominator; manual inspection/work on conveyor stages via `importFlowchartToSimulationData` & DES. |
| `tests/resourceStateAccounting.test.ts` | 184 | 2 | State Conservation & Off-Shift/Break Attribution | `ResourceStateTracker` `unavailable` separation & idempotent `finalizeAt`; Scenario C1 DES off-shift/break horizon conservation (`total === horizon`). |
| `tests/resourceStateTracker.test.ts` | 86 | 3 | State Tracker Boundary Safety | Unfinished interval closure at horizon, non-monotonic/out-of-horizon guards, worker & conveyor state totals. |
| **Total** | **3,610 (`wc -l`)** | **57** | **10 Engineering Domains** | **57/57 passing (`0` fail, `0` skip) via `npm test`** |

---

## 2. Embedded In-App Engineering Benchmark Suite (`src/simulation/benchmarkEngine.ts`)

16 deterministic scenarios executed both inside `EngineeringValidationCenterModule.tsx` and via `tests/benchmarksAndRegression.test.ts`:

| Benchmark ID | Name | Category | Verified Domain |
| :--- | :--- | :--- | :--- |
| `bm_01_single_workstation` | 01. Single Workstation Deterministic Cycle | Core DES | Baseline single-stage deterministic arrival/completion & cycle fidelity |
| `bm_02_three_serial` | 02. Three Serial Stations & Bottleneck | Flow Dynamics | Serial pacing & bottleneck identification |
| `bm_03_parallel_machines` | 03. Parallel Machine Capacity (2 Servers) | Capacity Math | Parallel workstation capacity doubling |
| `bm_04_batch_production` | 04. Batch Palletizing Collection (×4) | Batching | `collect_batch` accumulation & release |
| `bm_05_multi_shift` | 05. Multi-Shift Calendar & Off-Shift Gap | Calendars | Multi-shift transitions & off-shift idle exclusion |
| `bm_06_worker_breaks` | 06. Worker Break vs. Automatic Equipment | Calendars | Automatic machine (`runDuringBreaks`) vs break-paused operator |
| `bm_07_machine_breakdown` | 07. Breakdown Preemption & Time Conservation | Reliability | Breakdown interruption & state conservation |
| `bm_08_conveyor_capacity` | 08. Conveyor Capacity, Headway & Fit Guard | Conveyor Physics | Belt pitch, headway & fit rejection guard |
| `bm_09_zero_buffer_line` | 09. Zero-Buffer Blocking Propagation | Blocking | Direct `DES` construction (`autoWire` bypassed due to pre-linked stages) zero-buffer upstream blocking |
| `bm_10_unbalanced_line` | 10. Starvation vs. Idle Accounting | State Tracking | Unbalanced serial starvation attribution |
| `bm_11_oee_setup_maint_quality` | 11. Full OEE (Setup + Maintenance + Quality) | OEE Hierarchy | Combined setup, planned maintenance & scrap OEE hierarchy |
| `bm_12_capacity_dedup_no_buffer_inflation` | 12. Parallel Capacity Deduplication (No Buffer Inflation) | Capacity & Batching | Buffer/conveyor exclusion & ID deduplication |
| `bm_13_parallel_machines_regression` | 13. True Parallel Machines 2x Throughput Scaling | Capacity & Batching | Analytical vs DES 2x throughput parity |
| `bm_14_resource_shift_unavailable_state` | 14. Resource Shift Assignment & Unavailable State Conservation | Calendars & States | Resource-specific shift adherence & exact state sum |
| `bm_15_heterogeneous_shift_weighted_oee` | 15. Multi-Shift Heterogeneous Resource & Plant OEE | OEE Hierarchy | Heterogeneous shift Resource OEE vs Line OEE |
| `bm_16_lognormal_repair_statistics` | 16. Log-Normal Repair Time Method of Moments | Reliability Math | Lognormal repair mean & stdDev convergence |

---

## 3. Domain Coverage Summary & Missing Verification Matrix (Tasks 7 & 8)

| Engineering / Software Domain | Current Coverage Status | Classification | Identified Missing Verification Gaps |
| :--- | :---: | :--- | :--- |
| **1. Capacity & Batching** | High (`10+` tests + 4 benchmarks) | `Verified behavior` / `Missing verification` | Missing test for `batchSize > 1` with `stage.requiredMachines = 0` unassigned fallback (`capacityEngine.ts:100`), and missing check for manual-work-on-conveyor (`baseTaskTimeSec > 0`, `parallelServers = 0`) effect on `auditProjectTiming.lineBalanceEfficiencyPct`. |
| **2. Core DES Flow & Blocking** | High (`12+` tests + 4 benchmarks) | `Verified behavior` / `Missing verification` | Missing test verifying `bufferCapacity = 0` survives `importFlowchartToSimulationData` / `autoWireProjectForSimulation` / `useAppStore.startSimulation` (currently fails due to `RISK-02`: `bufferCapacity < 1 -> 4`); missing non-linear manual flowchart DAGs (parallel split/merge routing, rework loops, unreachable nodes). |
| **3. Conveyor Physics & Ergonomics** | High (`12+` tests + 1 benchmark) | `Verified behavior` / `Missing verification` | Missing multi-conveyor chained junctions, 90°/270° rotated conveyors with non-accumulating vs accumulating transitions, and `workstationEnabled` conveyor inspection stops under breakdowns/breaks. |
| **4. OEE Hierarchy (Resource/Stage/Line)** | High (`8+` tests + 2 benchmarks) | `Verified behavior` / `Missing verification` | Missing Stage OEE test with heterogeneous parallel machines inside a **single stage** (`RISK-09`); missing multi-product Line OEE with differing `cycleTimeMultiplier` / `stageProcessingTimes` (`RISK-04`); missing `avgBatchSize` verification when downstream stage produces scrap (`RISK-10`). |
| **5. Calendars, Shifts & Maintenance** | High (`8+` tests + 4 benchmarks) | `Verified behavior` / `Missing verification` | Missing overnight/boundary shift spanning horizon end clipping for per-resource shift assignments; missing `shiftEndPolicy` variations (`finish_in_progress` vs `hard_stop`) in DES. |
| **6. Reliability & Failure/Repair Models** | Medium-High (`6` tests + 2 benchmarks) | `Verified behavior` / `Missing verification` | Missing test for `availability = 0` combined with stale `mtbfSec > 0 && mttrSec > 0` (`RISK-06`); missing DES end-to-end statistical convergence check for `weibull` and `exponential` repair/failure under shifts and breaks. |
| **7. Quality, Scrap & Rework** | Medium (`2` tests + 1 benchmark) | `Verified behavior` / `Missing verification` | Missing multi-pass / bounded max rework loop test; missing `defectModel: 'per_batch'` combined with `unbatch` downstream stations. |
| **8. Validation & Schema Migration** | Medium (`5` tests) | `Verified behavior` / `Missing verification` | Missing test for hidden object (`rendering.visible === false`) referenced by `stage.assignedObjectIds` (`RISK-07`); missing full negative-case coverage for all error codes in `validator.ts` (`NO_PRODUCTION_STAGES`, `BROKEN_STAGE_LINK`, `INVALID_CONVEYOR_SPEED`, `BUFFER_CAPACITY_VIOLATION`, `MISSING_FLOWCHART_ENTRY`) and `applyScenarioOverrides` (`workerClient.ts`). |
| **9. Web Worker Execution (`simWorker.ts`)** | Low (`1` fallback test) | `Missing verification` | `workerClient.ts` executes synchronous fallback in Node (`Worker === undefined`); real Web Worker sliced `advanceTo()` (20 slices + progress + cancellation + `validateProject` gate) has **zero** automated verification against `runToCompletion()`. |
| **10. Procedural Layout, Exports & Storage** | None (`0` tests) | `Missing verification` | Zero unit/integration tests for `layoutGenerator.ts`, `indexedDb.ts` (save/load/corruption handling), `cadExporter.ts` (DXF output), `reportExporter.ts` (PDF generation), or `mediaCapture.ts`. |
| **11. UI, Store (`useAppStore`) & E2E Browser** | None (`0` tests) | `Missing verification` | Zero automated React/DOM component tests, Zustand store action tests, 2D SVG / 3D Three.js viewport rendering tests, or Playwright/Cypress browser E2E tests. |
| **12. CI Verification Gates** | Local `npm ci --legacy-peer-deps`, `lint`, `test`, `build` pass; remote CI runner pending | `Verified behavior` (workflow config & local parity) / `Missing verification` (remote GitHub Actions run) | Phase 0.2 hardened `/.github/workflows/deploy.yml` to enforce `npm ci --legacy-peer-deps` (no fallback), `npm run lint`, and `npm test` before `npm run build` and Pages deployment. Live execution on GitHub Actions (`ubuntu-latest`, Node `"20"`) has not yet been triggered remotely. |

---

## 4. CI Verification Stages & Scope Boundaries (Phase 0.2)

1. **Deterministic Dependency Install (`npm ci --legacy-peer-deps`)**:
   - Consumes `/package-lock.json` (`lockfileVersion: 3`, `652` entries matching `package.json`) with the unpinned `|| npm install` fallback removed.
   - `--legacy-peer-deps` is retained solely because `vite@8.3.8` declares `peerOptional esbuild@"^0.27.0 || ^0.28.0"` against `devDependencies.esbuild: "^0.25.0"` in `package.json`.
2. **Static TypeScript Check (`npm run lint` -> `tsc --noEmit`)**:
   - Verifies compile-time TypeScript consistency across `src/` and `tests/` (`exit 0`).
   - **Boundary:** Executes `tsc --noEmit` with `"strict": false` (`tsconfig.json`) — it does **not** run ESLint or style/lint rule sets.
3. **Automated Software Regression & Engineering Tests (`npm test` -> `tsx --test tests/*.test.ts`)**:
   - Executes all `57` Node/`tsx` tests (`0` fail, `0` skip) covering unit/regression logic and the 16 embedded benchmarks.
   - **Boundary:** Passing `npm test` verifies existing software regression checks only; it does **not** establish complete physical/real-world simulation validity, Web Worker sliced execution parity (`simWorker.ts`), DOM/UI component behavior, or WebGL/CAD rendering.
4. **Production Bundle & PWA Verification (`npm run build` -> `vite build`)**:
   - Verifies Vite client + worker bundling and `vite-plugin-pwa` Service Worker generation (`dist/sw.js`).
5. **Automated Browser / E2E Testing**:
   - Remains **`0` tests (`Missing verification`)**; UI and browser workflows are not covered by CI gates.
