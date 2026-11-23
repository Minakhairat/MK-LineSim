# MK LineSim — Phase 1: Industrial Capacity & Cycle-Time Mathematical Specification

**Program Phase:** Phase 1 — Industrial Capacity Mathematics Verification  
**Scope:** Analytical capacity, cycle time, transportation capacity, virtual vs. physical resource separation, batch processing (including end-of-run partial batches), setup amortization, and shift-adjusted stage/line capacity equations.  
**DES Isolation Boundary:** This specification and Phase 1 implementation govern analytical capacity modules (`src/engineering/capacityEngine.ts`, `src/engineering/conveyorPhysics.ts`, `src/engineering/validationEngine.ts`, and analytical functions in `src/simulation/timeAuditService.ts`). Discrete-event simulation runtime (`src/simulation/desEngine.ts`) is **not** modified in Phase 1.

---

## 1. Fundamental Time & Rate Definitions

Let $3600\text{ s/hr}$ and $60\text{ s/min}$ denote exact unit-time conversion constants.

For any individual processing server $i$ (physical `machine` or `workstation`) assigned to a stage:
- Processing time: $t_{\text{proc}, i} \ge 0$ (s)
- Loading time: $t_{\text{load}, i} \ge 0$ (s)
- Unloading time: $t_{\text{unload}, i} \ge 0$ (s)
- Base task time per cycle:
  $$t_{\text{base}, i} = t_{\text{proc}, i} + t_{\text{load}, i} + t_{\text{unload}, i}$$
- Setup time (changeover / run-start preparation): $t_{\text{setup}, i} \ge 0$ (s)
- Batch transfer time (only when `batchMode === 'collect_batch'`): $t_{\text{transfer}, i} \ge 0$ (s), else $0$
- Discrete parallel slot capacity of server $i$: $c_i \in \mathbb{Z}_{> 0}$
- Effective batch divisor $d_i$:
  $$d_i = \begin{cases} B_i, & \text{batchMode}_i = \text{'collect\_batch'} \\ 1, & \text{batchMode}_i \in \{\text{'single'}, \text{'unbatch'}\} \end{cases}$$
  where $B_i \in \mathbb{Z}_{\ge 1}$ (`single` enforces $B_i = 1$; `unbatch` preserves incoming carrier size $B_i$ for diagnostics while processing $1$ individual unit per cycle).

Effective cycle duration per execution on server $i$:
$$t_{\text{cycle}, i} = t_{\text{base}, i} + t_{\text{transfer}, i}$$

---

## 2. Analytical Capacity Derivations (Requirements 1–8)

### Requirement 1 — Single Processing Machine
For a single machine ($c_1 = 1$, $d_1 = 1$) with $t_{\text{cycle}, 1} > 0$:
$$C_{\text{hr}} = \frac{3600}{t_{\text{cycle}, 1}} \quad [\text{units/hr}], \qquad t_{\text{unit, eff}} = t_{\text{cycle}, 1} \quad [\text{s/unit}]$$
**Reference Case:** $t_{\text{cycle}, 1} = 60\text{ s} \implies C_{\text{hr}} = \frac{3600}{60} = 60\text{ units/hr}$.

---

### Requirement 2 — Identical Parallel Machines
For $k$ independent identical machines (or one machine with $c$ identical parallel slots, total slots $P = \sum_{i=1}^{k} c_i$), each with cycle $t_{\text{cycle}} > 0$ and divisor $d = 1$:
$$C_{\text{hr}} = \sum_{i=1}^{k} c_i \cdot \frac{3600}{t_{\text{cycle}}} = P \cdot \frac{3600}{t_{\text{cycle}}}, \qquad t_{\text{unit, eff}} = \frac{3600}{C_{\text{hr}}} = \frac{t_{\text{cycle}}}{P}$$
**Reference Case:** $k = 2$, $c_1 = c_2 = 1$, $t_{\text{cycle}} = 60\text{ s} \implies C_{\text{hr}} = 60 + 60 = 120\text{ units/hr}$, $t_{\text{unit, eff}} = 30\text{ s/unit}$.

---

### Requirement 3 — Heterogeneous Parallel Machines
Independent parallel machines operate concurrently at their own individual rates. Parallel rates add linearly (equivalently, effective stage cycle time is the capacity-weighted harmonic sum):
$$C_{\text{hr}, i} = c_i \cdot \frac{3600 \cdot d_i}{t_{\text{cycle}, i}} \quad (\text{for } t_{\text{cycle}, i} > 0, \; c_i \ge 1)$$
$$C_{\text{stage, hr}} = \sum_{i \in M} C_{\text{hr}, i} = \sum_{i \in M} c_i \cdot \frac{3600 \cdot d_i}{t_{\text{cycle}, i}}$$
$$t_{\text{unit, eff, stage}} = \begin{cases} \dfrac{3600}{C_{\text{stage, hr}}}, & C_{\text{stage, hr}} > 0 \\ 0, & \text{otherwise} \end{cases}$$

**Why uniform stage-level averaging is wrong:** Copying Machine A's cycle time ($60\text{ s}$) onto Machine B ($30\text{ s}$) yields $\frac{2 \times 3600}{60} = 120\text{ u/hr}$ ($-33.33\%$ error). Copying Machine B's cycle time yields $240\text{ u/hr}$ ($+33.33\%$ error). Simple arithmetic mean cycle $\frac{60+30}{2} = 45\text{ s}$ divided by $2$ yields $22.5\text{ s} \to 160\text{ u/hr}$ ($-11.11\%$ error). Only rate addition / harmonic composition is exact.

**Reference Case:** Machine A ($t_A = 60\text{ s}, c_A = 1$) + Machine B ($t_B = 30\text{ s}, c_B = 1$):
$$C_{\text{stage, hr}} = \frac{3600}{60} + \frac{3600}{30} = 60 + 120 = 180\text{ units/hr}, \qquad t_{\text{unit, eff, stage}} = \frac{3600}{180} = 20\text{ s/unit}.$$

**Field Precedence Rule (`obj.operations` vs. `stage`):**
- If assigned physical processing servers have differing values for a timing/batch field across objects, each server **must** use its own `obj.operations` value (never overwritten by `stage.*`).
- If all assigned servers share identical zero/undefined values for a field while `stage.* > 0`, the stage setting applies uniformly.
- If `stage.*` and homogeneous `obj.operations.*` both have positive values, explicit stage edits apply uniformly when all machines are homogeneous.

---

### Requirement 4 — Sequential Stations, Line Bottleneck & Balance Efficiency
For a serial sequence of active processing stages $S_1, S_2, \dots, S_n$ with $t_{\text{unit, eff}, j} > 0$ and $C_{j} = \frac{3600}{t_{\text{unit, eff}, j}}$:
$$C_{\text{line, hr}} = \min_{j \in \{1..n\}} C_j, \qquad t_{\text{bottleneck}} = \max_{j \in \{1..n\}} t_{\text{unit, eff}, j} = \frac{3600}{C_{\text{line, hr}}}$$
$$\text{Line Balance Efficiency (\%)} = \min\!\left(100,\; \frac{\sum_{j=1}^{n} t_{\text{unit, eff}, j}}{n \cdot t_{\text{bottleneck}}} \times 100\right)$$
Conveyor-only, buffer-only, unassigned non-processing, or zero-cycle stages have $t_{\text{unit, eff}} = 0$ and **must not** be inserted as $0$ terms into the denominator $n$ of Line Balance Efficiency.

**Reference Case:** Sequential stations $[20\text{ s}, 40\text{ s}, 30\text{ s}]$:
- $C_1 = 180\text{ u/hr}$, $C_2 = 90\text{ u/hr}$, $C_3 = 120\text{ u/hr}$
- Bottleneck = Station 2 ($t_{\text{bottleneck}} = 40\text{ s}$, $C_{\text{line, hr}} = 90\text{ u/hr}$)
- Balance Efficiency = $\frac{20 + 40 + 30}{3 \times 40} \times 100\% = \frac{90}{120} \times 100\% = 75\%$.

---

### Requirement 5 — Conveyor Transportation Capacity (Independent from Processing)
A conveyor (`kind === 'conveyor'`) is strictly a material transport resource, never a processing machine server (`parallelServers = 0`, `processingCapacity = 0`).

Given valid positive belt length $L_{\text{belt}} > 0$, belt width $W_{\text{belt}} > 0$, belt speed $v > 0\text{ m/s}$, product footprint $L_{\text{prod}} > 0$, $W_{\text{prod}} > 0$, and non-negative spacing $s_{\text{gap}} \ge 0\text{ m}$:
- Geometric Fit Check:
  $$\text{canFit} \iff (L_{\text{prod}} \le L_{\text{belt}} + 10^{-6}) \;\land\; (W_{\text{prod}} \le W_{\text{belt}} + 10^{-6})$$
- Pitch & Minimum Headway:
  $$p = L_{\text{prod}} + s_{\text{gap}}, \qquad h_{\min} = \frac{p}{v}\; [\text{s/unit}]$$
- Transportation Capacity (when $\text{canFit} = \text{true}$):
  $$C_{\text{trans, min}} = \frac{60}{h_{\min}} = \frac{60 \cdot v}{p}\; [\text{u/min}], \qquad C_{\text{trans, hr}} = \frac{3600}{h_{\min}} = \frac{3600 \cdot v}{p}\; [\text{u/hr}]$$
- Physical Simultaneous Belt Occupancy & Traversal Time:
  $$N_{\text{fit}} = 1 + \left\lfloor \frac{\max(0, L_{\text{belt}} - L_{\text{prod}})}{p} \right\rfloor, \qquad N_{\text{phys}} = \begin{cases} \min(N_{\text{declared}}, N_{\text{fit}}), & N_{\text{declared}} > 0 \\ N_{\text{fit}}, & \text{otherwise} \end{cases}$$
  $$t_{\text{traverse}} = \frac{L_{\text{belt}}}{v}\; [\text{s}]$$

**Reference Case:** $v = 1\text{ m/s}$, $p = L_{\text{prod}} + s_{\text{gap}} = 0.35 + 0.15 = 0.5\text{ m} \implies h_{\min} = 0.5\text{ s}$, $C_{\text{trans, min}} = \frac{60}{0.5} = 120\text{ u/min}$, $C_{\text{trans, hr}} = 7200\text{ u/hr}$.

**Invalid Physical Input Rule:** Any non-finite or physically invalid parameter ($L_{\text{belt}} \le 0$, $W_{\text{belt}} \le 0$, $v \le 0$, $L_{\text{prod}} \le 0$, $W_{\text{prod}} \le 0$, $s_{\text{gap}} < 0$, declared conveyor capacity $< 0$) **must** set `isValid = false`, `canFit = false`, and return `0` for `physicalCapacity`, `transportCapacityPerMin`, and `transportCapacityPerHour` (no silent fallback to $0.001\text{ m/s}$ or $0.01\text{ m}$).

---

### Requirement 6 — Physical Machines vs. Virtual Workstations vs. Unassigned vs. Non-Processing
Stages are explicitly classified into mutually exclusive source modes (`stageAssignmentMode`):
1. `'physical_machines'`: Stage has $\ge 1$ real physical `machine` or `workstation` (excluding synthetic `virt_*` hidden placeholders). `physicalProcessingServerCount > 0`, `virtualServerCount = 0`, `physicalCapacityPerHour = theoreticalCapacityPerHour`, `virtualCapacityPerHour = 0`.
2. `'virtual_workstation'`: Either `assignedObjects` contains only `virt_*` placeholders, OR `assignedObjects` is empty while `stage.requiredMachines >= 1` and `baseTaskTimeSec > 0`.
   - Crucially: `physicalProcessingServerCount = 0` and `physicalCapacityPerHour = 0`. Virtual capacity is reported explicitly in `virtualServerCount` and `virtualCapacityPerHour` and is **never** presented as physical equipment capacity.
3. `'conveyor_only'` / `'buffer_only'`: Assigned objects contain only transport/storage resources (`conveyor` or `buffer`), zero physical or virtual processing machines (`parallelServers = 0`, `theoreticalCapacityPerHour = 0`).
4. `'unassigned'`: `assignedObjects` is empty and `requiredMachines === 0` (when task time $> 0$). Capacity $= 0$.
5. `'non_processing'`: Stage has zero task time ($t_{\text{base}} = 0$ and no positive machine cycle) and no positive processing capacity (`theoreticalCapacityPerHour = 0`). Zero-machine or zero-task stages must never fabricate a $1$-server fallback.

---

### Requirement 7 — Batch Processing & End-of-Run Partial Batches
1. **Steady-State Rates:**
   - Batch cycle duration: $t_{\text{batchCycle}, i} = t_{\text{base}, i} + t_{\text{transfer}, i}$ (`transfer` only in `'collect_batch'`).
   - Batch capacity rate:
     $$C_{\text{batches/hr}} = \sum_{i \in M} c_i \cdot \frac{3600}{t_{\text{batchCycle}, i}}$$
   - Unit capacity rate:
     $$C_{\text{units/hr}} = \sum_{i \in M} c_i \cdot \frac{3600 \cdot d_i}{t_{\text{batchCycle}, i}}$$
2. **Finite-Run & Partial Batch Accounting (Horizon $T_{\text{net}}$ s, Setup $T_{\text{setup}}$ s, Optional Planned Units $Q$):**
   Let $T_{\text{prod}} = \max(0, T_{\text{net}} - T_{\text{setup}})$.
   - Maximum discrete complete batches achievable in time window $T_{\text{prod}}$:
     $$K_{\text{time}} = \sum_{i \in M} c_i \cdot \left\lfloor \frac{T_{\text{prod}}}{t_{\text{batchCycle}, i}} \right\rfloor$$
   - When `plannedUnits` $Q$ is specified ($Q \ge 0$, integer) with `batchSize` $B$:
     - Full demand batches: $K_{\text{full}} = \lfloor Q / B \rfloor$
     - Partial end-of-run remainder: $r = Q \bmod B$ (`hasPartialBatch = r > 0`)
     - Total batches needed to flush all $Q$ units: $K_{\text{req}} = K_{\text{full}} + \mathbb{I}(r > 0) = \lceil Q / B \rceil$
     - **With end-of-run partial batch flush (`flushPartialBatch = true`):**
       - If $K_{\text{time}} \ge K_{\text{req}}$: executes $K_{\text{full}}$ full batches + $(r > 0 ? 1 : 0)$ partial batch of $r$ units ($Q_{\text{done}} = Q$, $\text{WIP}_{\text{unbatched}} = 0$).
       - If $K_{\text{time}} < K_{\text{req}}$: executes $K_{\text{time}}$ full batches ($K_{\text{time}} \cdot B$ units) or final partial batch if $K_{\text{time}} = K_{\text{full}}$ and time allows; otherwise remaining units stay incomplete.
     - **Without partial batch flush (`flushPartialBatch = false`):**
       - Executes $K_{\text{done}} = \min(K_{\text{time}}, K_{\text{full}})$ full batches; $Q_{\text{done}} = K_{\text{done}} \cdot B$; stranded remainder $\text{WIP}_{\text{unbatched}} = Q - Q_{\text{done}}$.

---

### Requirement 8 — Shift-Adjusted Stage Capacity, Setup & Zero Double-Counting
1. **Zero Double-Counting:**
   - Intra-stage: Duplicate equipment IDs in `stage.assignedObjectIds` (e.g., `['m1', 'm1']`) are deduplicated once per stage.
   - Cross-stage: When `auditProjectTiming` evaluates a plant line, each physical equipment ID is tracked across stages so shared machines are flagged rather than double-counted into independent parallel pools.
2. **Shift-Adjusted Theoretical Stage Capacity:**
   For each server $i$ on a stage evaluated over horizon $[0, T_{\text{horizon}}]$:
   - Let $T_{\text{sched}, i}$ be the server's scheduled production seconds from `ResourceCalendarEngine` (accounting for assigned `shiftId`, shift breaks clipped to $[0, T_{\text{horizon}}]$, and maintenance windows).
   - For $N_{\text{setups}, i} \ge 0$ setups of duration $t_{\text{setup}, i}$ (default $N_{\text{setups}, i} = 1$ when $t_{\text{setup}, i} > 0$ and $T_{\text{sched}, i} > 0$, else $0$):
     $$T_{\text{setup, total}, i} = \min(T_{\text{sched}, i},\; N_{\text{setups}, i} \cdot t_{\text{setup}, i}), \qquad T_{\text{prod}, i} = \max(0, T_{\text{sched}, i} - T_{\text{setup, total}, i})$$
   - Continuous shift-adjusted unit capacity:
     $$Q_{\text{shift, cont}} = \sum_{i \in M} c_i \cdot \frac{T_{\text{prod}, i} \cdot d_i}{t_{\text{cycle}, i}}$$
   - Discrete full-cycle shift-adjusted unit capacity:
     $$Q_{\text{shift, discrete}} = \sum_{i \in M} c_i \cdot \left\lfloor \frac{T_{\text{prod}, i}}{t_{\text{batchCycle}, i}} \right\rfloor \cdot d_i$$
   - Shift-adjusted effective hourly capacity over stage scheduled hours:
     $$C_{\text{shift, hr}} = \begin{cases} \dfrac{Q_{\text{shift, cont}}}{T_{\text{sched, avg}} / 3600}, & T_{\text{sched, avg}} > 0 \\ 0, & \text{otherwise} \end{cases}$$

**Invalid Physical Inputs Policy:** Negative or non-finite cycle/load/unload/setup/batchTransfer times, non-positive or fractional or non-finite `capacity` ($c_i \le 0$), non-positive/fractional/non-finite `batchSize`, or negative/fractional/non-finite `requiredMachines` mark `isValid = false` and yield `0` capacity rather than clamping invalid inputs into valid positive numbers.
