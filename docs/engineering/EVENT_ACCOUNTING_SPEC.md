# MK LineSim — Phase 2: Event Scheduling, Token Lifecycle & Material/State Accounting Specification

**Program Phase:** Phase 2 (Discrete Event Simulation Engine Verification)  
**Scope:** Event scheduling semantics, deterministic priority ordering, token-based cancellation/preemption, pending-walk & conveyor-transit lifecycles, material conservation laws, resource-state conservation, and runtime invariant auditing (`src/simulation/desEngine.ts`, `src/simulation/priorityQueue.ts`, `src/simulation/resourceStateTracker.ts`, `src/simulation/resourceCalendar.ts`).  
**Boundary:** No OEE calculation modules (`src/engineering/oeeEngine.ts`) are altered in Phase 2.

---

## 1. Event Queue & Deterministic Ordering Model

The simulation clock advances strictly across discrete event timestamps in $[0, T_{\text{horizon}}]$, backed by a binary min-heap `MinPriorityQueue<InternalEvent>` (`src/simulation/priorityQueue.ts`):

- **Total Order Relation:** For any two scheduled events $e_a = (t_a, s_a)$ and $e_b = (t_b, s_b)$,
  $$e_a \prec e_b \iff (t_a < t_b) \;\lor\; (t_a = t_b \land s_a < s_b)$$
  where $t \in \mathbb{R}_{\ge 0}$ is the clamped timestamp `Math.max(this.clockSec, timestamp)` and $s = \texttt{++seqCounter} \in \mathbb{Z}_{> 0}$ is a strictly monotonic schedule sequence number.
- **Equal-Timestamp Determinism:** Multiple events scheduled at identical timestamp $t$ execute in exact FIFO insertion sequence ($s_1 < s_2 < \dots$), preventing nondeterministic heap reorderings or race conditions.
- **Zero-Duration & Near-Zero-Duration Transitions:** Zero processing delays ($0\text{ s}$) and sub-millisecond transitions ($0.001\text{ s}$) schedule legally with `timestamp >= clockSec` and preserve monotonic $(\text{timestamp}, \text{seq})$ progression.
- **Horizon & Empty-Queue Termination:**
  - `advanceTo(T)`: pops all events with `ev.timestamp <= min(T, horizon)`, updates WIP/resource/queue integrals to `min(T, horizon)`, and invokes `finalizeAt(horizon)` when `min(T, horizon) >= durationSec`.
  - `stepNextEvent()`: returns `false` and finalizes immediately at `this.clockSec` if `queue.size === 0` (natural exhaustion), or at `durationSec` if `queue.peek().timestamp > durationSec` (horizon cutoff). Both paths synchronize WIP integrals, interpolation positions, queue integrals, and state tracker closures identically.

---

## 2. Canonical Event Catalog (`SimEventType`)

| Category | Event Type | State Side Effects & Conservation Transition |
| :--- | :--- | :--- |
| **Source / Material Flow** | `ProductCreated` | Releases 1 discrete item ($q = 1$) if within `plannedUnitsCap` & product quota; increments `totalArrived` and `productReleasedCount[p]`; schedules `ProductArrived` at entry stage `route[0]` ($t$) and next `ProductCreated` ($t + \Delta t_{\text{arrival}}$). |
| | `ProductArrived` | Handles `unbatch` split (spawning `batchCount` single children, marking parent `absorbedIntoEntityId`) or `collect_batch` staging (`stageBatchHolders`), or pushes `entityId` into `stageBuffers[stageId]`, then invokes `tryStartStage`. |
| | `ProductTransferred` | Decrements `stageInTransitCounts[toStageId]`; validates `token` if transferred over conveyor; decrements `conveyorOccupancy[convId]`, clears `conveyorTransits`, transitions empty conveyor to `'stopped'`/`'unavailable'`, emits `BufferReleased`, retries blocked upstream outboxes, and schedules `ProductArrived`. |
| | `ProductScrapped` | Marks entity `scrapped = true` (`batchCount` units), removes from `activeEntities`, closes stage time accounting, updates `scrappedCount` & `productScrappedCount`. |
| | `ProductCompleted` | Marks entity `completedAt = t`, moves out of `activeEntities`, updates `completedCount`, `completedBatches`, `hourlyGood`, and `productCompletedCount`. Zero double counting enforced by `completedSeen`. |
| **Processing & Setup** | `SetupStarted` | Validates `walkToken`; removes matching `PendingWalkJob`; checks machine + worker availability; inserts `ActiveJobRecord(phase='setup')`; transitions workers to `'busy'` and station to `'setup'`; schedules `SetupCompleted`. |
| | `SetupCompleted` | Validates `token`; removes active setup record; schedules immediate `ProcessingStarted` using the same machine slot and allocated workers (zero gap). |
| | `ProcessingStarted` | Validates `walkToken` (if delayed/walked); checks machine + worker availability; adds `ActiveJobRecord(phase='processing')`; transitions machine to `'running'` (conveyors to `'moving'`) and workers to `'busy'`; optionally schedules early `WorkerReleased` on conveyor inspection work. |
| | `ProcessingCompleted` | Validates `token`; releases machine slot (`busyUnitIds`) & allocated workers; calls `tryDispatchAllStages(t)` on idle/freed workers; rolls deterministic unit/batch quality (`scrapRate`, `reworkProbability`, max `2` rework loops); advances `routeStepIndex` or completes/blocks upstream. |
| **Worker Lifecycle** | `WorkerAssigned` | Binds `workerAllocatedEntity.set(workerId, entityId)`; transitions worker `'walking'` (when `walkTimeSec > 0`) or `'busy'`. Silent `walkCompletedOnly` event marks early walk completion prior to delayed dispatch (`dispatchDelay > walkTimeSec`). |
| | `WorkerReleased` | Supports both processing completion release and early conveyor-node manual work release (`earlyRelease: true`, validated via `workerReleaseToken`); frees worker (`workerAllocatedEntity.set(wid, null)`) -> `'idle'`/`'break'`/`'unavailable'`, and immediately triggers `tryDispatchAllStages(t)`. |
| **Buffers & Blocking** | `BufferFull` | Records upstream station wait inside `blockedOutbox[fromStageId]`, adds `entityId` to `blockedEntitySet`, and sets upstream object status `'blocked'` (station) or `'blocked'` on conveyor exit (`blockedConveyorEntities`). |
| | `BufferReleased` | Audit marker emitted upon queue dequeue, conveyor slot free, or blocked station release, triggering `retryBlockedUpstreamForStage` / `retryBlockedUpstreamAll`. |
| **Calendars & Reliability** | `ShiftStarted`, `ShiftEnded`, `MachineStopped`, `MachineStarted`, `PlannedMaintenanceStarted`, `PlannedMaintenanceCompleted` | Scheduled from `ResourceCalendarEngine.getCalendarTransitions()` clipped to $[0, H]$. Drives `syncResourcesToCalendar(t)` to preempt/pause or resume active jobs, pending walk jobs, and conveyor transits per object `breakPolicy` / `shiftEndPolicy` / maintenance windows. |
| | `BreakdownStarted`, `RepairCompleted` | Triggered by `FailureModel` sampler (`fixed`, `exponential`, `weibull`, or zero-availability guard). Preempts `pendingWalkJobs`, `activeJobs`, and (for conveyors) pauses active `conveyorTransits`, holds `'down'` during sampled repair duration (`fixed`, `exponential`, `triangular`, `lognormal`), and resumes + retries blocked upstreams upon `RepairCompleted`. |

---

## 3. Token-Based Preemption & Cancellation Semantics

DES cancellation never deletes elements from the middle of the heap; instead it uses monotone integer tokens (`jobTokenCounter`, `validJobTokens: Set<number>`):

1. **Pending Walk / Headway Dispatch (`PendingWalkJob`):**
   - Stores `token`, `walkEndByWorker`, `walkRemainingByWorker`, `remainingDispatchDelaySec`, `startAt`.
   - On interruption (`BreakdownStarted`, `PlannedMaintenanceStarted`, `ShiftEnded`, `MachineStopped`): `validJobTokens.delete(pj.token)`, records `remainingDispatchDelaySec = Math.max(0, pj.startAt - now)` and per-worker remaining walk time, pauses workers (`'idle'` / `'break'` / `'unavailable'`), and moves record to `pausedWalkJobs`. Stale `SetupStarted` / `ProcessingStarted` events popping later see `!validJobTokens.has(token)` and return immediately as no-ops.
   - On recovery: computes `effectiveDelay = Math.max(maxRemWalk, remainingDispatchDelaySec)`, mints a fresh `newToken`, sets `pj.startAt = now + effectiveDelay`, schedules new worker arrival & start events.
2. **Active Processing / Setup (`ActiveJobRecord`):**
   - On interruption (`job.expectedEndAt > now + 1e-6`): invalidates `job.token` and any `job.workerReleaseToken`, sets `job.remainingSec = job.expectedEndAt - now` (and decrements `job.workDurationSec` by elapsed work), moves record to `pausedJobs`, leaving `entityId` physically held in `stState.busyUnitIds` with `stState.status = 'down' | 'maintenance' | 'unavailable'`.
   - **Boundary Rule:** Jobs with `job.expectedEndAt <= now + 1e-6` finish at exact timestamp `now` without preemption.
3. **Conveyor Transits (`ConveyorTransit`):**
   - Stores `transferToken`, `paused`, `pausedAt`, `pausedProgress`, `remainingBeforeStartSec`, `remainingTransitSec`.
   - On conveyor stoppage (`pauseConveyorTransits(convId, now)`): invalidates `tr.transferToken`, freezes `pausedProgress = (now - startTime) / (endTime - startTime)`, records `remainingBeforeStartSec` / `remainingTransitSec`, and freezes visual interpolation at `pausedAt` / `pausedProgress`.
   - On conveyor recovery (`resumeConveyorTransits(convId, now)`): checks `cState.status !== 'down'` and `calendarEngine.getObjectAvailabilityAt(conv, now).available`, shifts `[startTime, endTime]` forward, mints new `transferToken`, reschedules `ProductTransferred`, synchronizes `conveyorStatus = 'moving'`, and drains `retryBlockedUpstreamAll(now)`.

---

## 4. Material Conservation Law & Exclusive State Partition

Every released physical unit across all entities $E$ (with batch multiplier $u(e) = \max(1, e.\text{batchCount} ?? 1)$) obeys strict conservation at every simulation clock $t \in [0, H]$:

$$\sum_{e \in E \setminus E_{\text{absorbed}}} u(e) = Q_{\text{released}}(t)$$

where every non-absorbed entity $e$ belongs to **at most one** container/state and contributes exact units $u(e)$ to **exactly one** terminal or WIP partition:

$$Q_{\text{released}}(t) = \underbrace{Q_{\text{completed}}(t)}_{\texttt{completedAt} \neq \bot} + \underbrace{Q_{\text{scrapped}}(t)}_{\texttt{scrapped} = \text{true}} + \underbrace{Q_{\text{WIP}}(t)}_{\text{activeEntities}}$$

and active WIP decomposes with zero overlap (`pending + queue + batchBuffer + underProcessing + blockedAtStation + inTransit === activeWipUnits`):

$$Q_{\text{WIP}}(t) = Q_{\text{queue}}(t) + Q_{\text{batchHolder}}(t) + Q_{\text{processing}}(t) + Q_{\text{blocked}}(t) + Q_{\text{inTransit}}(t) + Q_{\text{pendingHandoff}}(t)$$

- **Batch Carrier Lifecycle:**
  - `collect_batch`: constituent singles have `absorbedIntoEntityId = carrierId`, are removed from `activeEntities` and all buffers, and transfer exact unit count $\sum u_k$ to the newly minted carrier entity (`isBatchCarrier = true`, `batchCount = K`). Total physical unit count across creation and absorption remains invariant.
  - `unbatch`: incoming carrier (`batchCount = B`) is marked `absorbedIntoEntityId = unbatchSplit:${carrier.id}`, removed from `activeEntities`, and spawns $B$ single entities (`batchCount = 1`, retaining original `productId`, `createdAt`, `routeStepIndex`).

---

## 5. Resource State Time Conservation

For every resource object $r$ (machine, workstation, conveyor) and every worker $w$, `ResourceStateTracker` maintains non-overlapping half-open intervals over $[0, T_{\text{sim}}]$ finalized idempotently via `finalizeAt(endSec)`:

- **Machines / Workstations:**
  $$T_{\text{running}} + T_{\text{idle}} + T_{\text{blocked}} + T_{\text{starved}} + T_{\text{setup}} + T_{\text{down}} + T_{\text{maintenance}} + T_{\text{unavailable}} = T_{\text{sim}}$$
- **Workers:**
  $$T_{\text{busy}} + T_{\text{walking}} + T_{\text{idle}} + T_{\text{break}} + T_{\text{unavailable}} = T_{\text{sim}}$$

Worker travel (`walking`) is accounted strictly in worker `walkingTimeSec` and never credited to machine `runningTimeSec` or `setupTimeSec`.

---

## 6. Phase 2.1 Runtime Invariant Auditor Contract (`auditInvariants()`)

`DiscreteEventSimulationEngine.auditInvariants()` is a strictly **observational, side-effect-free** integrity check producing identical `SimEvent[]` traces and `SimulationKPIs` whether invoked at every popped event tick or omitted completely.

### 6.1 Exclusive WIP Partition Correction
In Phase 2.1, `DesMaterialConservationBreakdown.underProcessingUnits` reports strictly non-blocked active station units (`station_busy` minus `blockedEntitySet`), eliminating the prior overlap with `blockedAtStationUnits`. `auditInvariants()` explicitly asserts:
$$\texttt{waitingInQueueUnits} + \texttt{batchBufferUnits} + \texttt{underProcessingUnits} + \texttt{blockedAtStationUnits} + \texttt{inTransitUnits} + \texttt{pendingArrivalUnits} = \texttt{activeWipUnits}$$
while additionally exposing `reworkedActiveUnits` (subset of `activeWipUnits` currently in `reworkCount > 0`) as a diagnostic indicator.

### 6.2 Stable Invariant Violation Code Catalog

| Domain | Violation Code | Enforced Condition |
| :--- | :--- | :--- |
| **Buffer & Queue** | `[INV_BUFFER_INVALID_CAPACITY]` | Stage `bufferCapacity` must be a non-negative `number` (`>= 0` or `Infinity`, never `NaN`/negative). |
| | `[INV_BUFFER_ZERO_CAP_OCCUPIED]` | Non-`collect_batch` stage with `bufferCapacity === 0` must hold `0` queued and `0` held entities between steps. |
| | `[INV_BUFFER_OVERFLOW]` | When finite, `stageBuffers[sid].length + stageBatchHolders[sid].length <= effectiveCap`, where `effectiveCap = max(bufferCapacity, batchSize)` for `collect_batch` and `bufferCapacity` otherwise. Unbounded `Infinity` buffers bypass upper-bound rejection (preserved in `autoWire.ts`). |
| | `[INV_BUFFER_DUPLICATE_ENTITY]` | No `entityId` appears more than once in `stageBuffers[sid]` or `stageBatchHolders[sid]`. |
| | `[INV_BUFFER_STALE_ENTITY]` | Neither `stageBuffers` nor `stageBatchHolders` may hold absorbed (`absorbedIntoEntityId`), `completedAt !== undefined`, or `scrapped` entities. |
| | `[INV_BUFFER_NEGATIVE_IN_TRANSIT]` | `stageInTransitCounts[sid] >= 0`. |
| **Resource & References** | `[INV_RESOURCE_INVALID_CAPACITY]` | Machines/workstations require finite `capacity >= 1`; buffers require non-`NaN` `capacity >= 0`. |
| | `[INV_RESOURCE_CAPACITY_OVERFLOW]` | `objectStates[objId].busyUnitIds.length <= obj.operations.capacity`. |
| | `[INV_RESOURCE_DUPLICATE_SLOT]` | No duplicate `entityId` in `busyUnitIds` or duplicate active/paused job entries per object. |
| | `[INV_RESOURCE_STALE_ENTITY]` | `busyUnitIds`, jobs, or `blockedOutbox` cannot retain terminal or absorbed entities. |
| | `[INV_JOB_BUSY_MISMATCH]` | `activeJobs.length <= busyUnitIds.length`, and every active/paused/walk job entity must occupy `busyUnitIds`. |
| | `[INV_RESOURCE_UNAVAILABLE_ACTIVE]` | Non-completing active jobs (`expectedEndAt > now + 1e-6`) and pending walks (`startAt > now + 1e-6`) cannot execute on `'down'`, `'maintenance'`, `'unavailable'`, zero-availability, or `stop_immediately` off-shift/break resources. |
| | `[INV_INVALID_REFERENCE]` | All stage/object/worker/entity IDs across maps (`assignedObjectIds`, `conveyorObjectId`, `predecessorIds`, `successorIds`, `objectStates`, `workerAllocatedEntity`, `conveyorTransits`, `blockedOutbox`) must resolve cleanly. |
| **Worker Lifecycle** | `[INV_WORKER_CONFLICT]` | A worker cannot belong to more than one job across `activeJobs`, `pendingWalkJobs`, `pausedJobs`, and `pausedWalkJobs`. |
| | `[INV_WORKER_STALE_ALLOCATION]` | `workerAllocatedEntity[wid]` cannot point to a terminal/absorbed entity or an entity with no job/slot. |
| | `[INV_WORKER_ALLOCATION_MISMATCH]` | `workerAllocatedEntity[wid]` must match assigned job entity (`null` iff idle/unassigned). |
| | `[INV_WORKER_STATUS_MISMATCH]` | `'walking'` requires an active `pending_walk` job & entity allocation; `'busy'` requires consistent active job (or zero-gap `SetupCompleted` handoff). |
| | `[INV_WALK_MISSING_REMAINING_DELAY]` | `pausedWalkJobs` entries must preserve finite `remainingDispatchDelaySec >= 0` and per-worker `walkRemainingByWorker >= 0`. |
| **Conveyor** | `[INV_CONVEYOR_NEGATIVE_OCCUPANCY]` | `conveyorOccupancy[cid] >= 0`. |
| | `[INV_CONVEYOR_OCCUPANCY_MISMATCH]` | `conveyorOccupancy[cid]` equals exact count of distinct entities in `conveyorTransits` + `blockedConveyorEntities`. |
| | `[INV_CONVEYOR_OCCUPANCY_OVERFLOW]` | Conveyor occupancy never exceeds `getConveyorPhysicalCapacity`. |
| | `[INV_CONVEYOR_STALE_ENTITY]` | Transits and `blockedConveyorEntities` hold active non-absorbed WIP only. |
| | `[INV_CONVEYOR_TRANSIT_INVALID_TIMING]` | `startTime`, `endTime` finite with `endTime >= startTime - 1e-9`. |
| | `[INV_CONVEYOR_PAUSED_STATE_INVALID]` | Paused transits retain valid `pausedAt`, `pausedProgress` matching `(pausedAt - startTime)/(endTime - startTime)` in `[0,1]`, and non-negative remaining times; unpaused transits retain none. |
| | `[INV_CONVEYOR_UNAVAILABLE_TRANSIT]` | No unpaused movement (`now >= startTime - 1e-6 && endTime > now + 1e-6`) on `'down'`, `'maintenance'`, `'unavailable'`, zero-availability, or `stop_immediately` unavailable conveyors. |
| | `[INV_CONVEYOR_HEADWAY_VIOLATION]` | Same-entry transits respect `gap >= minHeadwaySec - 1e-3`; downstream merges respect spatial pitch `>= (lenA+lenB)/2 + spacing - 0.02`. |
| | `[INV_CONVEYOR_ARTIFICIAL_PROCESSING]` | Conveyors hold `isConveyorNode === true` jobs only; conveyor-only stages forbid worker allocations or `workDurationSec > 0`. |
| **Conservation & Deadlock** | `[INV_MATERIAL_CONSERVATION]` | Total released = completed + scrapped + WIP; WIP buckets partition `activeWipUnits`; `completedCount`/`scrappedCount`/per-product maps stay exact. |
| | `[INV_DUPLICATE_COMPLETION]` | No completed entity ID counted more than once. |
| | `[INV_ENTITY_MULTI_LOCATION]` | Every active non-absorbed entity occupies at most one container. |
| | `deadlocks[]` (Multi-edge DFS) | Circular wait cycle detection across full `Map<fromStageId, WaitEdge[]>` adjacency of `blockedOutbox`; non-cyclic temporary blocking yields `[]`. |

