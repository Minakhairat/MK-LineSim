# MK LineSim — Module Dependency Map

**Program Phase:** Phase 0 (Engineering Baseline & Repository Audit)  
**Target System:** MK LineSim (`https://github.com/Minakhairat/MK-LineSim`)  
**Focus:** Static and runtime dependency topology across `capacityEngine`, `desEngine`, `timeAuditService`, `oeeEngine`, `resourceCalendar`, `failureModels`, `validator`, and supporting layers (Task 5).

---

## 1. Layered Architecture Overview

```text
+--------------------------------------------------------------------------------------+
| Layer 4: UI, Viewports, Store & Web Worker Boundary                                  |
|  - App.tsx, AnalyticsModule, ProductProcessWorkforceModule, ScenariosModule,         |
|    EngineeringValidationCenterModule, SimulationInspectorModule, Workspace2D / 3D,   |
|    FlowchartRoutingCanvas                                                            |
|  - Zustand Store: src/store/useAppStore.ts                                           |
|  - Worker RPC & Scenario Overrides: src/simulation/workerClient.ts                   |
|  - Web Worker Thread: src/workers/simWorker.ts                                       |
+-------------------------------+--------------------------------+---------------------+
                                |                                |
                                v                                v
+---------------------------------------------------+   +------------------------------+
| Layer 3: DES Orchestration, Validation & Support  |   | Persistence, Exporters, 3D   |
|  - src/simulation/desEngine.ts                    |   |  - src/storage/indexedDb.ts  |
|  - src/simulation/timeAuditService.ts             |   |  - src/utils/cadExporter.ts  |
|  - src/simulation/autoWire.ts                     |   |  - src/utils/reportExporter  |
|  - src/simulation/validator.ts                    |   |  - src/three/proceduralModels|
|  - src/simulation/benchmarkEngine.ts              |   +------------------------------+
|  - src/simulation/heatmap.ts                      |
+--------------------+------------------------------+
                     |
                     v
+--------------------------------------------------------------------------------------+
| Layer 2: Domain Physics, Reliability, Calendar & Accounting Primitives               |
|  - src/engineering/capacityEngine.ts       - src/simulation/resourceCalendar.ts      |
|  - src/engineering/oeeEngine.ts            - src/simulation/resourceStateTracker.ts  |
|  - src/engineering/conveyorPhysics.ts      - src/simulation/failureModels.ts         |
|  - src/engineering/validationEngine.ts     - src/simulation/priorityQueue.ts         |
|  - src/engineering/conveyorWorkerAssignment.ts                                       |
+--------------------------------------------------------------------------------------+
                     |
                     v
+--------------------------------------------------------------------------------------+
| Layer 1: Schema & Pure Constants                                                     |
|  - src/types/project.ts   - src/utils/units.ts   - src/data/equipmentCatalog.ts      |
+--------------------------------------------------------------------------------------+
```

---

## 2. Explicit Static Import Matrix (Required Core Modules)

Each cell indicates direct static ES imports (`Source -> Target`) verified via `grep` across `src/`.

| Importing Module (Row) \ Target (Col) | `capacityEngine` | `oeeEngine` | `conveyorPhysics` | `validationEngine` | `conveyorWorkerAssignment` | `resourceCalendar` | `failureModels` | `resourceStateTracker` | `timeAuditService` | `desEngine` | `validator` | `autoWire` | `priorityQueue` | `units` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`src/engineering/capacityEngine.ts`** | — | | | | | | | | | | | | | |
| **`src/engineering/oeeEngine.ts`** | | — | | | | | | | | | | | | |
| **`src/engineering/conveyorPhysics.ts`** | | | — | | | | | | | | | | | |
| **`src/engineering/conveyorWorkerAssignment.ts`** | | | | | — | | | | | | | | | |
| **`src/engineering/validationEngine.ts`** | | | **X** | — | | **X** | | | | | | | | |
| **`src/simulation/resourceCalendar.ts`** | | | | | | — | | | | | | | | |
| **`src/simulation/failureModels.ts`** | | | | | | | — | | | | | | | |
| **`src/simulation/resourceStateTracker.ts`** | | | | | | | | — | | | | | | |
| **`src/simulation/timeAuditService.ts`** | **X** | **X** | **X** | | **X** | **X** | **X** | | — | | | | | |
| **`src/simulation/validator.ts`** | | | | **X** | | | | | | | — | | | **X** |
| **`src/simulation/desEngine.ts`** | **X** | **X** | *(via timeAudit)* | | *(via timeAudit)* | **X** | **X** | **X** | **X** | — | | **X** | **X** | |
| **`src/simulation/autoWire.ts`** | | | | | **X** | | | | | | | — | | |
| **`src/simulation/heatmap.ts`** | | | | | | **X** | | | **X** | | | | | |
| **`src/simulation/benchmarkEngine.ts`** | **X** | | **X** | | | | **X** | | | **X** | **X** | | | |
| **`src/simulation/workerClient.ts`** | | | | | **X** | | | | | **X** | | | | |
| **`src/workers/simWorker.ts`** | | | | | | | | | | **X** | **X** | | | |
| **`src/store/useAppStore.ts`** | | | | | **X** | | | | | **X** | **X** | **X** | | |

### Circularity Check
- **Result (`Verified behavior`)**: **Zero circular dependencies** exist among `/src/engineering/*` and `/src/simulation/*`.
- Note cross-folder bridge (`Design assumption`): `src/engineering/validationEngine.ts:2` imports upward into `src/simulation/resourceCalendar.ts` (`validateSimulationCalendars`), while `src/simulation/validator.ts:3` imports `src/engineering/validationEngine.ts`. Acyclic, though layer boundaries between `engineering/` and `simulation/` are bidirectional at the package level.

---

## 3. Detailed Module-to-Module Runtime Contracts

### 3.1 `capacityEngine.ts` Consumers
- **`timeAuditService.ts:21-24, 346`**: `auditProjectTiming()` iterates `project.stages`, resolves `assignedObjectIds` against `project.layoutObjects`, and calls `computeStageCapacityProfile(st, assignedObjs)` to obtain `baseTaskTimeSec`, `batchSize`, `parallelServers`, `effectiveUnitCycleSec`, and `theoreticalCapacityPerHour`.
- **`desEngine.ts:52, 473, 4231, 4326, 4425`**:
  - `initialize()` calls `resolveStageBatchConfig(st, assignedObjs)` (`via timeAuditService.ts:45` re-export) to configure batch holding/unbatching rules (`stageBatchConfigs`).
  - `buildResult()` calls `computeStageCapacityProfile(candidate, resolveStageObjects(candidate))` for bottleneck `cyclePressureBonus` (`lines 4230-4234`) and per-resource `idealUnitCycleSec` (`line 4425`).
- **`ProductProcessWorkforceModule.tsx:15`**: Displays real-time analytical stage capacity previews directly in the UI.
- **`benchmarkEngine.ts:13`**: Directly asserts `computeStageCapacityProfile` in capacity/batching benchmarks (`bm_03`, `bm_04`, `bm_12`, `bm_13`).

### 3.2 `oeeEngine.ts` Consumers
- **`timeAuditService.ts:30, 499, 689, 721`**: `buildAuditedSimulationKPIs` calls `computeOeeMetrics`:
  - Once per stage (`StageAnalytics`: `line 499`) using `idealCycleTimeSec = effectiveTheoreticalUnitCycleSec` and stage-averaged `calendarTimeSec`, `plannedDowntimeSec`, `unplannedDowntimeSec`, `setupTimeSec`.
  - Once for line-level KPIs (`lines 689` heterogeneous branch, `line 721` homogeneous branch) using bottleneck timing/downtime and line `goodUnits` / `actualProduction`.
- **`desEngine.ts:51, 4451`**: `buildResult()` calls `computeOeeMetrics` directly for every non-storage/non-vehicle/non-buffer resource (`ResourceOeeAnalytics`) using `cal.calendarTimeSec`, `cal.plannedDowntimeSec`, `totals.down`, `totals.setup`, `idealUnitCycleSec`, `processed`, `goodRes`.

### 3.3 `resourceCalendar.ts` Consumers
- **`desEngine.ts:48, 299`**: Instantiates `new ResourceCalendarEngine(cfg, cfg.durationSec)` to drive shift start/end, break start/end, maintenance start/end events, per-object/per-worker availability checks, interruption policies, and `getObjectCalendarMetrics`.
- **`timeAuditService.ts:31, 105, 108`**: `computeShiftWindowAudit()` instantiates `ResourceCalendarEngine` for both full shift horizon (`fullDurationSec`) and current clock (`simTimeSec`) to compute `plannedUnits`, `activeSimTimeSec`, `fullShiftNetSec`, and `plannedDowntimeSec`.
- **`validationEngine.ts:2, 17`**: Calls `validateSimulationCalendars(simulationConfig, layoutObjects, workers)` for shift/break overlaps, out-of-shift breaks, maintenance bounds/overlaps, and invalid `shiftId`/`operatingSchedule` references.
- **`heatmap.ts:7, 102-104`**: Instantiates `ResourceCalendarEngine` per object so live 2D/3D heatmaps normalize object utilization against its own `scheduledProductionTimeSec` rather than only global plant active time.

### 3.4 `failureModels.ts` Consumers
- **`timeAuditService.ts:32, 35`**: Imports and re-exports `FailureModelParams` and `resolveObjectFailureParams`.
- **`desEngine.ts:44, 50, 367, 400`**: Calls `resolveObjectFailureParams(obj, cfg)` at initialization, marks `availability <= 0` machines as `'down'` initially (`lines 368-371`), and schedules failures/repairs via `sampleTimeToFailureSec` and `sampleRepairDurationSec` using DES's internal `mulberry32` PRNG (`lines 152-160`).
- **Note on PRNG duplication (`Design assumption`)**: `failureModels.ts:26` defines `createSeededRng` (Mulberry32), and `desEngine.ts:152` defines a second local copy `mulberry32`.
- **`benchmarkEngine.ts:14`**: Directly exercises `createSeededRng` and `sampleRepairDurationSec` in `bm_16_lognormal_repair_statistics`.

### 3.5 `validator.ts` & `validationEngine.ts` Consumers
- **`validator.ts:3, 552`**: `validateProject(project)` performs layout/factory/stage/product/worker/shift checks (`lines 21-549`) and appends `runEngineeringValidations(project)` (`line 552`).
- **UI & Execution Callers**:
  - `useAppStore.ts:27, 1248, 1398`: Runs `validateProject` on project mutations and strictly before `startSimulation()` and `runFullShiftSimulation()`.
  - `simWorker.ts:2, 42`: Re-runs `validateProject(project)` inside the Web Worker thread before constructing `DiscreteEventSimulationEngine`; aborts with `ok: false` if any `severity === 'error'` issue exists.
  - `benchmarkEngine.ts:11`: Validates benchmark fixtures and backward-compatibility project models.
- **Bypass Path (`Potential defect`)**: Direct callers of `new DiscreteEventSimulationEngine(project)` (including `workerClient.ts:103` when `Worker` is unavailable in Node/unit tests or non-worker environments, and `useAppStore.ts:1299` `resetSimulation`) do **not** run `validateProject`, relying instead on `ensureRoutingReady` + virtual workstation creation (`desEngine.ts:414-465`).

### 3.6 `desEngine.ts` Internal State & Pipeline Flow

```text
ProjectData
  │
  ├─► [Constructor] ensureRoutingReady() ──► autoWire.ts (manual import OR autoWireProjectForSimulation)
  │
  ├─► [initialize()]
  │     ├─► ResourceCalendarEngine (shifts, breaks, maintenance transitions)
  │     ├─► ResourceStateTracker (machines, workers, conveyors bounded to [0, durationSec])
  │     ├─► failureModels.resolveObjectFailureParams() ─► BreakdownStarted queue
  │     ├─► virtual workstations ('virt_' + stage.id) if assignedObjectIds resolves empty
  │     └─► capacityEngine.resolveStageBatchConfig()
  │
  ├─► [advanceTo(targetSec)] MinPriorityQueue<InternalEvent>
  │     ├─► Arrivals (resolveArrivalIntervalSec, dispatchingRule, quota/mix)
  │     ├─► Buffer / Batching (canAdmitToStageBuffer, stageBatchHolders)
  │     ├─► Operators & Travel (computeWorkerTravelAudit, walk vs pause/resume)
  │     ├─► Conveyors (computeConveyorMetrics, accumulating pitch & path time)
  │     └─► Scrap / Rework & Sink Completion
  │
  └─► [buildResult()]
        ├─► ResourceStateTracker.finalizeAt(simTime)
        ├─► Stage bottleneck heuristic (computeStageCapacityProfile + empirical util/wait)
        ├─► Per-resource OEE (oeeEngine.computeOeeMetrics)
        └─► timeAuditService.buildAuditedSimulationKPIs() ──► SimulationResult
```

### 3.7 UI & Store Entry Points into Engineering/Simulation
- **Direct Simulation/Engineering Imports in Components**:
  - `ProductProcessWorkforceModule.tsx` -> `capacityEngine` (`computeStageCapacityProfile`), `conveyorWorkerAssignment`
  - `EngineeringValidationCenterModule.tsx` -> `benchmarkEngine` (`runAllEngineeringBenchmarks`)
  - `ScenariosModule.tsx` -> `workerClient` (`applyScenarioOverrides`, `runSimulationInWorker`)
  - `LayoutEquipmentModule.tsx` -> `layoutGenerator` (`generateAutomaticLineLayout`)
  - `SimulationInspectorModule.tsx`, `Workspace2D.tsx`, `Workspace3D.tsx` -> `heatmap` (`computeObjectHeatmapMetrics`, `resolveHeatmapActiveTimeSec`)
  - `FlowchartRoutingCanvas.tsx` -> `autoWire`
  - `WorkforceModule.tsx`, `PropertiesPanel.tsx` -> `conveyorWorkerAssignment`
- **All other simulation triggers** (`BottomSimPanel.tsx`, `AnalyticsModule.tsx`, `ReportsModule.tsx`, `App.tsx`) go exclusively through Zustand (`useAppStore.ts`).
