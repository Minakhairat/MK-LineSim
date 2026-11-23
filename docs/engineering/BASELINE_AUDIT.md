# MK LineSim — Phase 0: Engineering Baseline & Repository Audit

**Program Phase:** Phase 0 (Read-Only Engineering Baseline & Repository Audit)  
**Target System:** MK LineSim (`https://github.com/Minakhairat/MK-LineSim`)  
**Stated Baseline Commit:** `dc8f6557912bf2fb8c1a78437ab331f485aea2d8`  
**Audit Date:** 2026-11-23  
**Workspace Constraints:** Read-only audit; zero application source, simulation equations, tests, or build configs were modified.

---

## 1. Baseline Identity, Version & Repository Provenance (Task 1)

| Attribute | Observed Value | Source / Command Evidence | Classification |
| :--- | :--- | :--- | :--- |
| Stated Baseline Commit | `dc8f6557912bf2fb8c1a78437ab331f485aea2d8` | User prompt baseline specification | `Design assumption` |
| Local `.git` Directory Status | `fatal: not a git repository (or any of the parent directories): .git` | `git rev-parse HEAD` in `/app/applet` | `Potential defect` — Workspace snapshot lacks `.git` metadata, so commit hash cannot be locally re-verified via `git` CLI |
| Package Name (`package.json`) | `"react-example"` | `/package.json:2` | `Confirmed defect` — Placeholder package name diverges from application branding |
| Package Version (`package.json`) | `"0.0.0"` | `/package.json:4` | `Potential defect` — Semantic version is unbumped (`0.0.0`) |
| App Metadata (`metadata.json`) | `name: "MK LineSim"` | `/metadata.json` | `Verified behavior` |
| Node.js Runtime | `v22.23.2` | `node -v` | `Verified behavior` |
| npm CLI Version | `10.9.8` | `npm -v` | `Verified behavior` |
| Lockfiles Present | `bun.lock` (`166,801` bytes); **`package-lock.json` missing** | `ls -la package-lock.json bun.lock` | `Confirmed defect` — CI uses `npm` without `package-lock.json` |

---

## 2. Build, TypeScript, Dependency & CI Inspection (Tasks 9 & 10)

### 2.1 `package.json`, Dependencies & Unused Packages
- **Scripts (`/package.json:6-13`)**:
  - `dev`: `vite --port=3000 --host=0.0.0.0`
  - `build`: `vite build`
  - `preview`: `vite preview`
  - `clean`: `rm -rf dist server.js`
  - `lint`: `tsc --noEmit`
  - `test`: `tsx --test tests/*.test.ts`
- **Unused / Orphaned Dependencies (`/package.json:15,21,32`)** [`Potential defect`]: `@google/genai` (`^2.4.0`), `express` (`^4.21.2`), and `@types/express` (`^4.17.21`) are declared in `package.json`, and `metadata.json` lists `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`, yet `grep -rnE "@google/genai|express"` across `src/` and `tests/` returned zero usages and no `server.ts` exists.
- **Lockfile / Toolchain Mismatch (`/package.json`, `/bun.lock`, `/.github/workflows/deploy.yml:28-33`)** [`Confirmed defect`]:
  - `bun.lock` (`166,801` bytes) is checked in, while `package-lock.json` is absent.
  - `.github/workflows/deploy.yml:28-33` checks `if [ -f package-lock.json ]` and falls back to `npm install --legacy-peer-deps`, causing unpinned dependency resolution on Node 20 in GitHub Actions.

### 2.2 TypeScript Configuration (`/tsconfig.json`)
- **Non-Strict Compiler Settings (`/tsconfig.json:1-28`)** [`Design assumption` / `Potential defect`]:
  - `"strict": true` is **not enabled** (`strictNullChecks`, `noImplicitAny`, `strictFunctionTypes` are inactive).
  - `"allowJs": true` (`tsconfig.json:17`) and `"skipLibCheck": true` (`tsconfig.json:13`) are enabled.
  - `"noEmit": true` (`tsconfig.json:25`) means `npm run lint` (`tsc --noEmit`) performs type-checking only and does not run ESLint.

### 2.3 Vite & PWA Configuration (`/vite.config.ts`)
- **Production Bundle & PWA (`/vite.config.ts:23-118`)** [`Verified behavior` / `Potential defect`]:
  - Uses `@vitejs/plugin-react` (`^6.1.1`), `@tailwindcss/vite` (`^4.3.3`), `vite-plugin-pwa` (`^2.0.0`, `registerType: 'autoUpdate'`, `maximumFileSizeToCacheInBytes: 8 * 1024 * 1024`), and custom `copy-unbundled-src-assets` closeBundle hook.
  - Emits deprecation warning during `vite build` because `/vite.config.ts:93` and `104` reference `__dirname` instead of `import.meta.dirname` under Vite 8.3 native config loader.
  - Emits main chunk size warning: `dist/assets/index-CVu68wF1.js` is `2,463.77 kB` (`gzip: 660.84 kB`).

### 2.4 GitHub Actions Workflow (`/.github/workflows/deploy.yml`)
- **Missing Verification Gates (`/.github/workflows/deploy.yml:17-55`)** [`Confirmed defect`]:
  - `deploy.yml` runs on push to `main` (Node `"20"`) and executes only `npm install --legacy-peer-deps` (`lines 28-33`) and `npm run build` (`line 40`), followed by GitHub Pages upload/deploy.
  - **`npm test` and `npm run lint` are completely absent from CI**, allowing failing tests or TypeScript errors to reach production deployment undetected.

### 2.5 Reproducible Commands & Observed Results (Task 10)

All commands below were actually executed in `/app/applet` during this audit:

| Step | Reproducible Command | Exit Code | Actual Observed Output Summary |
| :--- | :--- | :--- | :--- |
| Dependency Install | `npm install --legacy-peer-deps` | N/A (pre-installed in workspace; matches `deploy.yml:32`) | Workspace `node_modules` pre-populated; `package-lock.json` absent (`bun.lock` present). |
| Unit & Regression Tests | `npm test` (`tsx --test tests/*.test.ts`) | `0` (`TEST_EXIT=0`) | TAP output: `57` tests, `0` suites, `57` pass, `0` fail, `0` cancelled/skipped/todo; total duration `3802.94 ms`. |
| Type Checking | `npm run lint` (`tsc --noEmit`) | `0` (`LINT_EXIT=0`) | Clean pass with zero diagnostics (`strict: false`). |
| Production Build | `npm run build` (`vite build`) | `0` (`BUILD_EXIT=0`) | `1919` modules transformed in `1.61s`; PWA precache `21` entries (`3031.51 KiB`); generates `dist/sw.js` & `dist/workbox-7e5eb42b.js`; warns on `__dirname` (`vite.config.ts:93`) and chunk size (`dist/assets/index-CVu68wF1.js` `2,463.77 kB`). |

---

## 3. Complete Codebase & Test Inventory (Task 2)

Total tracked source and test code under `src/` and `tests/`: **64 files, 36,813 lines (`wc -l`)**.

### 3.1 Application Shell, State, Data, Storage & Infrastructure

| File Path | `wc -l` | Category | Primary Role |
| :--- | :---: | :--- | :--- |
| `/src/main.tsx` | 99 | App Entry | Mounts `App` inside `AppErrorBoundary` and registers PWA service worker (`virtual:pwa-register`). |
| `/src/App.tsx` | 968 | App Shell | Top navigation bar, workspace module router (`projects`, `factory`, `layout`, `process`, `workforce`, `analytics`, `inspector`, `scenarios`, `validation`, `reports`), toast & undo/redo wiring. |
| `/src/store/useAppStore.ts` | 1485 | State Store | Zustand global store managing `project`, edit history, `validationIssues`, interactive DES ticking (`simEngine`), Web Worker orchestration (`runFullShiftSimulation`), auto-wiring, worker side placement. |
| `/src/types/project.ts` | 828 | Data Model | Canonical TypeScript schema for `ProjectData`, `LayoutObject`, `ProductionStage`, `WorkerDefinition`, `ProductDefinition`, `SimulationConfig`, `SimulationResult`, `SimulationKPIs`, analytics & validation types. |
| `/src/storage/indexedDb.ts` | 368 | Persistence | IndexedDB (`mk_linesim_db`) CRUD for projects and custom equipment templates, plus `migrateProjectSchema`. |
| `/src/data/equipmentCatalog.ts` | 795 | Data Catalog | `BUILTIN_EQUIPMENT_TEMPLATES` defining pallets, racks, conveyors, workstations, machines, buffers, and vehicles. |
| `/src/data/sampleProject.ts` | 698 | Sample Data | `createDesertAirCoolerProject()` default 30m × 20m multi-stage Desert Air Cooler assembly line fixture. |
| `/src/i18n/translations.ts` | 1504 | Localization | Full English / Arabic (`en` / `ar`) translation dictionaries. |
| `/src/hooks/usePWAInstall.ts` | 87 | Hooks | PWA `beforeinstallprompt` installability hook. |
| `/src/three/proceduralModels.ts` | 736 | 3D Geometry | Three.js procedural mesh builders (`buildEquipmentGroup`) for factory equipment & workers. |
| `/src/utils/units.ts` | 122 | Utilities | Unit formatting (`formatDuration`, meters/feet conversions), `getRotatedBounds`, and exact 2D OBB SAT collision (`doOrientedBoxesOverlap`). |
| `/src/utils/cadExporter.ts` | 767 | Export | 2D/3D DXF CAD exporter using Three.js/OBB geometry. |
| `/src/utils/reportExporter.ts` | 613 | Export | Canvas + `jsPDF` multi-page engineering PDF report generator. |
| `/src/utils/mediaCapture.ts` | 326 | Export | 2D SVG rasterization (`rasterize2DSvgCanvas`), 3D snapshot capture, and file download helpers. |

### 3.2 UI Modules, Panels, Modals & Workspaces (`/src/components/`)

| File Path | `wc -l` | Category | Primary Role |
| :--- | :---: | :--- | :--- |
| `/src/components/modules/ProjectsModule.tsx` | 343 | UI Module | Project creation, IndexedDB open/save/duplicate/delete, sample loader, JSON import/export. |
| `/src/components/modules/FactoryModule.tsx` | 560 | UI Module | Factory building dimensions, wall openings, zones, measurement units. |
| `/src/components/modules/LayoutEquipmentModule.tsx` | 914 | UI Module | Equipment catalog placement, automatic layout generator trigger (`generateAutomaticLineLayout`). |
| `/src/components/modules/ProductProcessWorkforceModule.tsx` | 1289 | UI Module | Product definitions, process routing, stage timing/batch parameters, `computeStageCapacityProfile` preview, conveyor/station worker assignment. |
| `/src/components/modules/WorkforceModule.tsx` | 669 | UI Module | Workforce roster, skills, efficiency, walking speed, shift assignment, conveyor/station placement controls. |
| `/src/components/modules/AnalyticsModule.tsx` | 735 | UI Module | OEE Time Hierarchy, Stage/Resource/Worker/Product KPI tables and `Chart.js` visualizations. |
| `/src/components/modules/SimulationInspectorModule.tsx` | 668 | UI Module | Event log inspector, live state breakdown, heatmap diagnostics (`heatmap.ts`). |
| `/src/components/modules/EngineeringValidationCenterModule.tsx` | 351 | UI Module | Displays `validationIssues` alongside embedded 16-case `runAllEngineeringBenchmarks()` suite runner. |
| `/src/components/modules/ScenariosModule.tsx` | 399 | UI Module | What-if scenario creation and comparison via `applyScenarioOverrides` + `runSimulationInWorker`. |
| `/src/components/modules/ReportsModule.tsx` | 228 | UI Module | Triggers PDF, CSV, and CAD exports. |
| `/src/components/workspace/Workspace2D.tsx` | 1428 | Viewport | Interactive 2D SVG CAD floor editor with drag/rotate, heatmap overlay, conveyor-worker snapping. |
| `/src/components/workspace/Workspace3D.tsx` | 946 | Viewport | Interactive Three.js WebGL 3D factory viewport with camera presets and thermal heatmap rendering. |
| `/src/components/workspace/FlowchartRoutingCanvas.tsx` | 1464 | Viewport | Visual manual flowchart node-edge editor calling `autoWire` sync/import helpers. |
| `/src/components/panels/BottomSimPanel.tsx` | 251 | Panel | Simulation playback controls (Play/Pause/Step/Reset/Full-Shift Worker Run), speed slider, clock/WIP readout. |
| `/src/components/panels/PropertiesPanel.tsx` | 1444 | Panel | Context inspector for selected object/worker/wall/stage properties. |
| `/src/components/modals/HelpGuideModal.tsx` | 366 | Modal | In-app engineering/user help modal. |
| `/src/components/pwa/OfflineIndicator.tsx` | 20 | PWA | Offline connectivity banner. |
| `/src/components/pwa/PWAInstallButton.tsx` | 113 | PWA | PWA install prompt button. |

### 3.3 Core Engineering Modules (`/src/engineering/`)

| File Path | `wc -l` | Primary Responsibility |
| :--- | :---: | :--- |
| `/src/engineering/capacityEngine.ts` | 210 | Stage batching rules (`resolveStageBatchConfig`), equipment role breakdown (`resolveStageEquipmentBreakdown`), server count (`resolveStageParallelServerCount`), analytical stage throughput (`computeStageCapacityProfile`). |
| `/src/engineering/conveyorPhysics.ts` | 111 | Physical fit guard (`LENGTH_EXCEEDS_BELT`, `WIDTH_EXCEEDS_BELT`), belt pitch, min headway, transport capacity/min & hr, finite belt capacity, path traversal duration. |
| `/src/engineering/conveyorWorkerAssignment.ts` | 437 | Angle normalization, cardinal station-side (`N/S/E/W`) and rotated conveyor-segment (`Side A/B`) geometric worker placement & segment resolution. |
| `/src/engineering/oeeEngine.ts` | 95 | Formal ISO 22400 / SEMI E10 Time Hierarchy (`CT -> PDT -> SPT -> UDT/SET -> OT`) and `A × P × Q = OEE` computation (`computeOeeMetrics`). |
| `/src/engineering/validationEngine.ts` | 301 | Shared engineering validations (`runEngineeringValidations`): calendars, conveyor-to-product physical fit, availability/MTBF/MTTR/Weibull/lognormal checks. |

### 3.4 Simulation Engine & Web Worker Modules (`/src/simulation/`, `/src/workers/`)

| File Path | `wc -l` | Primary Responsibility |
| :--- | :---: | :--- |
| `/src/simulation/desEngine.ts` | 4691 | Event-driven DES kernel (`DiscreteEventSimulationEngine`): event queue, arrivals, batching/unbatching, worker walking/allocation, accumulating conveyors, breakdown/maintenance preemption, quality/scrap/rework, KPI/analytics aggregation. |
| `/src/simulation/timeAuditService.ts` | 808 | Shift window audit, arrival interval resolution, buffer admission guard, worker travel audit, stage setup/processing time calculation, centralized project timing audit, and final `buildAuditedSimulationKPIs` (Stage/Line OEE + bottleneck root cause). |
| `/src/simulation/resourceCalendar.ts` | 747 | `ResourceCalendarEngine`, interval algebra (`merge`, `clip`, `subtract`, `intersect`), transition schedule builder, shift/break/maintenance validation (`validateSimulationCalendars`). |
| `/src/simulation/resourceStateTracker.ts` | 362 | `ResourceStateTracker`: non-overlapping state interval accumulator bounded to `[0, horizonSec]` for machines, workers, and conveyors; idempotent `finalizeAt(horizon)`. |
| `/src/simulation/failureModels.ts` | 264 | Mulberry32 PRNG (`createSeededRng`), Lanczos `gammaFn`, Method-of-Moments lognormal converter, failure parameter resolver, failure (`fixed`, `exponential`, `weibull`) & repair (`fixed`, `triangular`, `lognormal`, `exponential`) samplers. |
| `/src/simulation/validator.ts` | 555 | Full pre-simulation validator (`validateProject`): factory bounds, OBB SAT collision, integer checks, stage/route integrity, shifts/breaks, delegating shared checks to `validationEngine.ts`. |
| `/src/simulation/autoWire.ts` | 762 | Automatic spatial conveyor/station wiring (`autoWireProjectForSimulation`) and manual flowchart graph importer (`importFlowchartToSimulationData`, `syncProductRoutes`). |
| `/src/simulation/benchmarkEngine.ts` | 1144 | 16 self-contained deterministic engineering benchmark suites (`bm_01` to `bm_16`) runnable in UI and unit tests. |
| `/src/simulation/layoutGenerator.ts` | 549 | Procedural factory layout synthesizer (`generateAutomaticLineLayout`) for supported line topologies. |
| `/src/simulation/heatmap.ts` | 165 | Resource-calendar-aware utilization/downtime thermal tier classifier for 2D/3D viewports. |
| `/src/simulation/priorityQueue.ts` | 80 | Binary min-heap (`MinPriorityQueue<T>`) ordered by `(timestamp, seq)` comparator in `desEngine.ts`. |
| `/src/simulation/workerClient.ts` | 212 | Web Worker RPC client (`runFullSimulationInWorker`, `runSimulationInWorker`, `cancelSimulationWorker`) with synchronous fallback when `Worker` is undefined, plus `applyScenarioOverrides`. |
| `/src/workers/simWorker.ts` | 126 | Dedicated Web Worker entrypoint running `validateProject` + sliced `DiscreteEventSimulationEngine.advanceTo()` passes with progress & cancellation support. |

### 3.5 Test Suite (`/tests/*.test.ts`)

14 test files (`3,646` `wc -l` total, `57` top-level `test()` cases executed by `node`/`tsx --test`; full classification in `TEST_COVERAGE_MATRIX.md`):
- `benchmarksAndRegression.test.ts` (52 lines, 2 tests)
- `capacityEngine.regression.test.ts` (172 lines, 2 tests)
- `conveyorAndOee.test.ts` (429 lines, 6 tests)
- `conveyorWorkerDragAndRotation.test.ts` (402 lines, 9 tests)
- `engineeringAuditVerification.test.ts` (874 lines, 13 tests)
- `engineeringStabilization.test.ts` (603 lines, 7 tests)
- `failureModels.test.ts` (90 lines, 1 test)
- `repairDistribution.test.ts` (99 lines, 3 tests)
- `resourceCalendar.test.ts` (151 lines, 3 tests)
- `resourceCalendarValidation.test.ts` (70 lines, 2 tests)
- `resourceOeeRegression.test.ts` (154 lines, 1 test)
- `resourceSpecificCalendar.test.ts` (244 lines, 3 tests)
- `resourceStateAccounting.test.ts` (184 lines, 2 tests)
- `resourceStateTracker.test.ts` (86 lines, 3 tests)

---

## 4. Simulation Inputs & Outputs Specification (Task 3)

### 4.1 Inputs (`ProjectData` — `/src/types/project.ts` & `ScenarioRecord['overrides']`)

1. **Factory Geometry (`/src/types/project.ts`)**: `factory.lengthM`, `widthM`, `heightM`, `unit` (`'m' | 'ft'`), `wallThicknessM`, `openings[]`, `zones[]`.
2. **Equipment Floor Objects (`layoutObjects: LayoutObject[]`)**:
   - Identity & Topology: `id`, `kind` (`'workstation' | 'machine' | 'conveyor' | 'buffer' | 'storage' | 'vehicle'`), `category`, `stageId`, `connectedToIds[]`, `rendering.visible`.
   - Geometry: `position {x,y,z}`, `dimensions {length,width,height}`, `rotationDeg`, `clearanceM`.
   - Operations (`operations`):
     - Timings: `processingTimeSec`, `setupTimeSec`, `loadingTimeSec`, `unloadingTimeSec`, `batchTransferTimeSec`.
     - Capacity & Batching: `capacity` (parallel slots for `machine`/`workstation`, physical cap override for `conveyor`, slots for `buffer`), `requiredOperators`, `batchSize`, `batchMode` (`'single' | 'collect_batch' | 'unbatch'`).
     - Conveyor Physics: `speedMps`, `productSpacingM`, `accumulation` (`boolean`), `workstationEnabled`.
     - Reliability: `availability` (`[0,1]`), `failureModel` (`'fixed' | 'exponential' | 'weibull'`), `mtbfSec`, `weibullShape`, `weibullScaleSec`, `repairModel` (`'fixed' | 'exponential' | 'triangular' | 'lognormal'`), `mttrSec`, `mttrStdDevSec`.
     - Calendar & Policies: `shiftId`, `operatingSchedule`, `plannedMaintenance[]`, `runDuringBreaks`, `breakPolicy` (`'stop_immediately' | 'finish_current_cycle' | 'continue_during_break'`).
3. **Production Stages (`stages: ProductionStage[]`)**:
   - `id`, `name`, `assignedObjectIds[]`, `conveyorObjectId`, `predecessorIds[]`, `successorIds[]`.
   - `processingTimeSec`, `setupTimeSec`, `loadingTimeSec`, `unloadingTimeSec`, `batchTransferTimeSec`, `batchSize`, `batchMode`.
   - `bufferCapacity`, `requiredWorkers`, `requiredMachines`, `parallelCapacity`, `scrapRate` (`[0,1]`), `reworkProbability` (`[0,1]`).
4. **Products & Routes (`products: ProductDefinition[]`)**:
   - `id`, `name`, `code`, `dimensions {length,width,height}`, `routingMode` (`'auto' | 'manual'`), `routeStageIds[]`, `entryStageIds[]`, `targetQuantity`, `mixWeight`, `cycleTimeMultiplier`, `stageProcessingTimes` (`Record<stageId, number>`), `defectModel` (`'per_unit' | 'per_batch'`).
5. **Workforce (`workers: WorkerDefinition[]`)**:
   - `id`, `position`, `rotationDeg`, `placementSide`, `assignedStageIds[]`, `assignedTo` / `assignedStationId`, `assignedConveyorSegment`, `walkingSpeedMps`, `efficiencyFactor`, `shiftId`.
6. **Simulation Config (`simulationConfig: SimulationConfig`)**:
   - `durationSec`, `speedMultiplier`, `randomSeed`, `arrivalIntervalSec`, `maxPlannedUnits`, `shifts[]` (`startSec`, `durationSec`, `breaks[]`), `maintenanceWindows[]`, `enableBreakdowns`, `breakPolicy`, `shiftEndPolicy`, `dispatchingRule` (`'round_robin' | 'weighted_mix' | 'target_quota'`), `flowchartPositions`, `scenarios[]`.

### 4.2 Outputs (`SimulationResult` & `SimulationSnapshot` — `/src/types/project.ts`, `/src/simulation/desEngine.ts:4677-4690`)

1. **`SimulationKPIs` (`44` scalar fields)**:
   - Production & Attainment: `totalPlannedProduction`, `actualProduction`, `goodUnits`, `defectiveUnits`, `scrappedBatches`, `reworkUnits`, `reworkCycles`, `reworkBatches`, `productionAttainmentPct`, `hourlyOutput`, `unitsPerShift`, `totalBatchesCompleted`, `avgBatchSize`.
   - Timing & Flow: `avgCycleTimeSec`, `theoreticalTaktTimeSec`, `avgLeadTimeSec`, `avgWaitingTimeSec`, `avgUnitWaitingTimeSec`, `avgBatchWaitingTimeSec`, `avgQueueWaitingTimeSec`, `avgProcessingTimeSec`, `avgTransportTimeSec`, `totalConveyorTransitTimeSec`.
   - Utilization & State Totals: `workerUtilizationPct`, `machineUtilizationPct`, `calendarUtilizationPct`, `totalDowntimeSec`, `totalBlockedTimeSec`, `totalStarvedTimeSec`, `totalIdleTimeSec`, `setupTimeSec`, `lineEfficiencyPct`.
   - Bottleneck & WIP: `bottleneckStageId`, `bottleneckStageName`, `theoreticalBottleneckStageId`, `theoreticalBottleneckStageName`, `theoreticalBottleneckCycleSec`, `avgWip`, `currentWip`, `avgQueueLength`, `avgBufferOccupancyPct`.
   - OEE Hierarchy & Variance: `calendarTimeSec`, `scheduledProductionTimeSec`, `plannedDowntimeSec`, `unplannedDowntimeSec`, `operatingTimeSec`, `availabilityPct`, `performancePct`, `qualityPct`, `oeePct`, `theoreticalThroughputPerHour`, `throughputPerHour`, `throughputVariancePct`.
2. **Granular Analytics Arrays**:
   - `stageAnalytics: StageAnalytics[]` (counts, wait/cycle components, `%` state shares, stage OEE `A/P/Q/OEE`, bottleneck flags & `bottleneckReasonCode`).
   - `resourceAnalytics: ResourceOeeAnalytics[]` (per-machine/workstation/active-conveyor calendar, state totals, `idealCycleTimeSec`, individual `A/P/Q/OEE`).
   - `workerAnalytics: WorkerAnalytics[]` (`busyTimeSec`, `walkingTimeSec`, `idleTimeSec`, `unavailableTimeSec`, `scheduledTimeSec`, `workUtilizationPct`, `utilizationPct`).
   - `productAnalytics: ProductAnalytics[]` (`plannedQty`, `releasedQty`, `completedGoodQty`, `scrappedQty`, `wipQty`, `reworkUnits`, `reworkCycles`, `avgLeadTimeSec`, `attainmentPct`).
3. **Time-Series, Events & Live Snapshot**:
   - `hourlySeries: HourlyProductionPoint[]`, `wipSeries: WipTimePoint[]`, `recentEvents` (last 150 events in `SimulationResult`; full event log via `getAllEvents()`), `totalEventsExecuted`.
   - `SimulationSnapshot`: live `clockSec`, `objectStates`, `workerStates`, `activeEntities`, `stageQueueLengths`, `completedUnits`, `scrappedUnits`, `wipCount`.

---

## 5. Engineering KPIs & Source Equations (Task 4)

| KPI / Analytical Output | Exact Formula / Logic | Source File & Lines | Classification |
| :--- | :--- | :--- | :--- |
| **Stage Base Task Time** | `max(0, proc) + max(0, load) + max(0, unload)` (preferring `stage.*` else primary processing `obj.operations.*`) | `src/engineering/capacityEngine.ts:173-176` | `Verified behavior` |
| **Effective Batch Divisor** | `batchMode === 'collect_batch' ? max(1, round(batchSize)) : 1` (`single` forces `batchSize = 1`; `unbatch` preserves carrier size but processes 1/cycle) | `src/engineering/capacityEngine.ts:52-87` | `Verified behavior` |
| **Parallel Server Count** | `sum(max(1, round(obj.capacity)))` strictly for `kind === 'machine' \|\| 'workstation'`; `0` if only conveyors/buffers assigned; fallback `max(1, round(stage.requiredMachines \|\| 1))` when `assignedObjects.length === 0` | `src/engineering/capacityEngine.ts:94-144` | `Verified behavior` (empty-array fallback is `Design assumption`) |
| **Stage Effective Unit Cycle & Hourly Capacity** | `effectiveUnitCycleSec = (parallelServers > 0 && totalCycle > 0) ? (baseTask + batchTransfer) / (parallelServers * divisor) : 0`; `capPerHr = effectiveUnitCycleSec > 0 ? 3600 / effectiveUnitCycleSec : 0` | `src/engineering/capacityEngine.ts:188-194` | `Verified behavior` |
| **Conveyor Fit, Headway & Transport Capacity** | `canFit = (prodL <= beltL + 1e-6) && (prodW <= beltW + 1e-6)`; `pitch = max(0.01, prodL + spacing)`; `minHeadway = pitch / speed`; `capPerMin = 60 / minHeadway`; `capPerHr = 3600 / minHeadway`; `physicalCap = min(declaredCap \|\| Inf, 1 + floor((beltL - prodL)/pitch))` | `src/engineering/conveyorPhysics.ts:59-97` | `Verified behavior` |
| **Line Balance Efficiency (%)** | `min(100, (sum(effectiveCycles) / (effectiveCycles.length * bottleneckCycleSec)) * 100)` across stages with `baseTaskTimeSec > 0` | `src/simulation/timeAuditService.ts:349-379` | `Potential defect` (`0` pushed when conveyor-only stage has `baseTaskTimeSec > 0`) |
| **Theoretical Bottleneck Cycle & Capacity** | `bottleneckCycleSec = max(profile.effectiveUnitCycleSec)` for `baseTaskTimeSec > 0`; `theoreticalHourlyCapacity = 3600 / bottleneckCycleSec`; `effectiveTheoreticalThroughputPerHour = min(theoreticalHourlyCapacity, 3600/arrivalInterval, plannedUnitsCap/activeHours)` | `src/simulation/timeAuditService.ts:349-396` | `Potential defect` (product-agnostic; misses `cycleTimeMultiplier` / `stageProcessingTimes`) |
| **OEE Time Hierarchy & A / P / Q / OEE (%)** | `SPT = max(0, CT - PDT)`; `OT = max(0, SPT - min(SPT, UDT) - min(rem, SET))`; `A = OT/SPT * 100`; `P = min(100, (idealCycle * totalCount / OT) * 100)`; `Q = goodCount / totalCount * 100`; `OEE = A * P * Q / 10000` | `src/engineering/oeeEngine.ts:48-95` | `Verified behavior` (upper `100%` clamp on `P` is `Design assumption`) |
| **Stage-Level OEE** | Uses pooled `downPct` / `setupPct` applied to `avgSchedSec = stageScheduledSum / objCount`, with `idealCycleTimeSec = profile.effectiveUnitCycleSec` and `totalUnitsProcessed = sa.completedCount` | `src/simulation/desEngine.ts:4275-4290`, `src/simulation/timeAuditService.ts:478-511` | `Potential defect` (uniform average across heterogeneous parallel machines) |
| **Line-Level OEE (Homogeneous vs Heterogeneous)** | Selects bottleneck stage (heterogeneous uses min `schedSec / effectiveUnitCycleSec`), derives `lineCalendar`, `linePDT`, `lineUDT`, `lineSET`, `lineIdealCycleSec` (`bottleneckCycleSec`), and evaluates against actual line `actualProduction` and `goodUnits` | `src/simulation/timeAuditService.ts:578-731` | `Design assumption` / `Potential defect` (bottleneck-derived `Availability`, ignores multi-product cycle scaling) |
| **Resource-Level OEE (`resourceAnalytics`)** | Per machine/workstation/active conveyor using object's own calendar (`cal.calendarTimeSec`, `cal.plannedDowntimeSec`), tracker `totals.down`, `totals.setup`, `processed`, `good`, and `idealUnitCycleSec = totalStageCycle / (objCap * effectiveBatchDivisor)` | `src/simulation/desEngine.ts:4400-4498` | `Verified behavior` |
| **DES Bottleneck Composite Score** | If `stTaskTime > 0`: `utilPct + setupPct + effectiveQueueSignal + cyclePressureBonus - blkPct * 0.25`; else `utilPct * 0.1` | `src/simulation/desEngine.ts:4324-4344` | `Potential defect` (`stTaskTime` omits object-level fallback) |
| **Worker Utilization (%)** | `workerScheduled = wt.busy + wt.walking + wt.idle`; `util = (wt.busy + wt.walking) / workerScheduled`; `workUtil = wt.busy / workerScheduled`; plant KPI = mean `util * 100` across workers | `src/simulation/desEngine.ts:4500-4540` | `Verified behavior` |
| **Lead, Queue Wait, Batch Wait & Transport Time** | Tracked per finished entity (`completedAt - createdAt`, `unitWaitTimeSum`, `batchWaitTimeSum`, `stageAcc.queueWaitTimeSum / entered`, `conveyorTransitTimeSum`) | `src/simulation/desEngine.ts:4317-4323, 4630-4675` | `Verified behavior` |
| **Average Batch Size KPI** | `totalBatchesCompleted > 0 && goodUnits > 0 ? goodUnits / totalBatchesCompleted : 1` | `src/simulation/timeAuditService.ts:740-744` | `Potential defect` (excludes `scrappedUnits` from numerator) |
| **Inherent & Sampled Reliability** | Precedence: `(rawMtbf>0 && rawMttr>0)` > `(weibull && rawScale>0 && rawMttr>0)` > `(avail<=0)` > `(avail<0.9999)`; `mttrStdDevSec` defaults to `0.5 * mttrSec` | `src/simulation/failureModels.ts:121-185` | `Design assumption` / `Potential defect` (conflicts when `avail === 0` with stale `mtbf > 0`) |

---

## 6. Implicit Assumptions, Fallback Behaviors & Virtual Resources (Task 6)

| ID | Mechanism | Exact Behavior & Fallback Trigger | Affected File(s) & Lines | Classification |
| :--- | :--- | :--- | :--- | :--- |
| ASM-01 | Virtual DES Workstation Synthesis | When `st.assignedObjectIds` is empty (or none exist in `objectsMap`), `DES` fabricates an invisible `workstation` (`id: 'virt_' + st.id`, `visible: false`, `capacity: max(1, st.requiredMachines \|\| 1)`, `availability: 1.0`). | `src/simulation/desEngine.ts:413-465` | `Design assumption` (diverges from `validator.ts:331-340`, which rejects empty `assignedObjectIds`) |
| ASM-02 | Virtual Capacity Server Fallback | `resolveStageEquipmentBreakdown` returns `processingServerCount = max(1, round(stage.requiredMachines \|\| 1))` when `assignedObjects.length === 0`. | `src/engineering/capacityEngine.ts:99-113` | `Design assumption` |
| ASM-03 | DES Constructor Auto-Mutation & `bufferCapacity` Clamping | `DES` constructor calls `ensureRoutingReady` on a clone: manual mode forces `importFlowchartToSimulationData`; auto mode with unlinked objects/routes/workers calls `autoWireProjectForSimulation` (can create `'Infeed Station'`, `'Outfeed Station'`, `'PRD-100'`, and workers). Both `autoWire` paths overwrite `st.bufferCapacity < 1` to `4`. | `src/simulation/desEngine.ts:240-288`, `src/simulation/autoWire.ts:296,610,623` | `Confirmed defect` / `Design assumption` (`useAppStore.ts:1221-1244, 1370-1394` mutates live store project before validation, silently erasing intentional `bufferCapacity = 0`) |
| ASM-04 | Conveyor Minimum Default Speed | `importFlowchartToSimulationData` sets `speedMps = 0.08` if missing or `<= 0`. `evaluateConveyorPhysics` falls back `beltLengthM`/`beltWidthM` to `0.01`, `speedMps` to `0.001`, product `length/width` to `0.5/0.4`, `productSpacingM` to `0.15`. | `src/simulation/autoWire.ts:280-282`, `src/engineering/conveyorPhysics.ts:37-52` | `Design assumption` |
| ASM-05 | Arrival Interval Floor | `resolveArrivalIntervalSec` returns `0.001` if `<= 0` or non-finite. | `src/simulation/timeAuditService.ts:85-89` | `Design assumption` |
| ASM-06 | Zero/Invalid Factor Clamps in Task & Travel Audit | `worker.efficiencyFactor || 1` clamped `>= 0.1` (so `0` silently becomes `1`); `product.cycleTimeMultiplier ?? 1` clamped `>= 0.05`; `worker.walkingSpeedMps || 1.25` clamped `>= 0.1`; `dist <= 0.85` at home station forces `walkTimeSec = 0`. | `src/simulation/timeAuditService.ts:219,244,254,305-314` | `Design assumption` |
| ASM-07 | Batch Staging Override of Small Buffers | `canAdmitToStageBuffer` sets `effectiveCap = max(cap, stagingAllowance)` whenever `stagingAllowance > 1`, bypassing small `stage.bufferCapacity` (including `0`) to prevent batch-collection deadlock. | `src/simulation/timeAuditService.ts:189-205` | `Design assumption` |
| ASM-08 | Implicit Synthetic MTTR & `0.5 * MTTR` CV | When `0 < avail < 0.9999` and neither `mtbfSec` nor `mttrSec` is specified, `failureModels` invents `mttrSec = max(10, baseProc * 3)` (default `baseProc = 30`). Unset `mttrStdDevSec` defaults to `0.5 * mttrSec`. `weibullShape` defaults to `1.5`, clamped `>= 0.2`. | `src/simulation/failureModels.ts:92-93,146-173` | `Design assumption` |
| ASM-09 | Performance Capped at `100%` | `computeOeeMetrics` clamps `performancePct <= 100`, masking potential ideal-cycle vs measured-output discrepancies above 100%. | `src/engineering/oeeEngine.ts:73` | `Design assumption` |
| ASM-10 | Scenario Override Clamps & Single-Shift Mutation | `applyScenarioOverrides` forces `durationSec >= 600`, `bufferCapacity >= 1`, `desiredWorkers >= 1`, updates only `shifts[0].durationSec` (leaving subsequent shifts/breaks intact), and truncates/synthesizes workers. | `src/simulation/workerClient.ts:125-211` | `Potential defect` |
| ASM-11 | Corrupted Saved Project Silent Drop | `loadAllProjectsFromDb` catches `migrateProjectSchema` errors and silently filters corrupted entries (`null`) without user notification. | `src/storage/indexedDb.ts:71-79` | `Design assumption` / `Potential defect` |

---

## 7. Automated Browser & End-to-End Testing Status (Task 11)

- **Observed Status**: **Zero automated browser, DOM, WebGL/2D canvas, Web Worker integration, or end-to-end (E2E) tests exist in this repository.** (`Missing verification`)
- **Evidence**:
  - `grep -rnE "playwright|cypress|puppeteer|@testing-library" src tests package.json` returned **0 matches**.
  - All `57` executed tests in `/tests/*.test.ts` run under Node/`tsx --test`, where `typeof Worker === 'undefined'` causes `workerClient.ts:36,102-109` to bypass real browser `Worker` (`src/workers/simWorker.ts`) execution and fall back to synchronous main-thread `DiscreteEventSimulationEngine`.
  - No UI module (`src/components/**`), `useAppStore.ts`, `indexedDb.ts` (real browser IDB), `cadExporter.ts`, or `reportExporter.ts` has automated behavioral or E2E test coverage.
