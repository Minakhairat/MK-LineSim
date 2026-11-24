# MK LineSim — OEE, Availability & Reliability Engineering Specification (Phase 3)

## 1. Formal Time Hierarchy & Downtime Classification (ISO 22400 / SEMI E10 Aligned)

Every resource, stage, and line OEE computation enforces the following strict 6-tier additive partition over the simulation horizon $[0, T_{\text{horizon}}]$:

1. **Calendar Time ($\text{CT}$)**:
   $$\text{CT} = T_{\text{horizon}} \ge 0$$
2. **Planned Downtime ($\text{PDT}$)**:
   $$\text{PDT} = T_{\text{off-shift}} + T_{\text{break}} + T_{\text{maintenance}}, \quad 0 \le \text{PDT} \le \text{CT}$$
   - **Off-shift time**: Intervals outside a resource's assigned shift schedule (`shiftId` or `operatingSchedule`).
   - **Scheduled breaks**: Break intervals within an active shift unless the equipment specifies `runDuringBreaks = true`.
   - **Planned maintenance windows**: Explicit object-level or plant-wide scheduled maintenance windows (`maintenanceWindows` / `plannedMaintenance`).
3. **Scheduled Production Time ($\text{SPT}$)**:
   $$\text{SPT} = \max(0, \text{CT} - \text{PDT})$$
4. **Unplanned Downtime ($\text{UDT}$)**:
   - At **Resource level**: Intervals where the resource is in `'down'` state due to stochastic or deterministic breakdowns, **strictly clipped to its active $\text{SPT}$ calendar intervals** so repairs spanning a shift end or maintenance window are never double-counted against $\text{SPT}$ and $\text{PDT}$.
   - At **Line level**: Constraint-stage propagated unplanned downtime within $\text{SPT}$ (Section 4).
   $$0 \le \text{UDT} \le \text{SPT}$$
5. **Setup / Changeover Time ($\text{SET}$)**:
   - Setup/changeover durations accrued within $(\text{SPT} - \text{UDT})$.
   $$0 \le \text{SET} \le \text{SPT} - \text{UDT}$$
6. **Operating Time ($\text{OT}$)**:
   $$\text{OT} = \max(0, \text{SPT} - \text{UDT} - \text{SET})$$
   Inside $\text{OT}$, resource runtime decomposes into productive `running`, `idle`, `blocked`, and `starved` states.

### Mutual Consistency Invariants (`computeOeeMetrics` in `src/engineering/oeeEngine.ts`)
- $\text{PDT} + \text{SPT} = \text{CT}$
- $\text{UDT} + \text{SET} + \text{OT} = \text{SPT}$ (when valid non-negative inputs)
- Non-conforming caller inputs (negative durations, $\text{PDT} > \text{CT}$, $\text{UDT} > \text{SPT}$, $\text{SET} > \text{SPT} - \text{UDT}$, or $\text{Good} > \text{Total}$) are clamped safely while raising `timeConsistencyAnomaly = true`.

---

## 2. Resource OEE (`ResourceOeeAnalytics`)

For any processing equipment or conveyor resource $r$:

$$\text{Availability}_r = \begin{cases} \dfrac{\text{OT}_r}{\text{SPT}_r} \times 100, & \text{SPT}_r > 10^{-6} \\ 0, & \text{otherwise} \end{cases}$$

$$\text{Calendar Availability}_r = \begin{cases} \dfrac{\text{OT}_r}{\text{CT}_r} \times 100, & \text{CT}_r > 10^{-6} \\ 0, & \text{otherwise} \end{cases}$$

$$\text{Raw Performance}_r = \begin{cases} \dfrac{C_{\text{ideal}, r} \cdot N_{\text{total}, r}}{\text{OT}_r} \times 100, & \text{OT}_r > 10^{-6}, \; C_{\text{ideal}, r} > 0, \; N_{\text{total}, r} > 0 \\ +\infty, & \text{OT}_r \le 10^{-6}, \; C_{\text{ideal}, r} > 0, \; N_{\text{total}, r} > 0 \\ 0, & \text{otherwise} \end{cases}$$

- **No Silent Performance Cap**: `performancePct` preserves finite raw values directly (`rawPerformancePct`), never hiding calibration or model errors via `Math.min(100, ...)`. Any result with `rawPerformancePct > 100.05%` or production at $\text{OT} = 0$ flags `performanceAnomaly = true` and records `performanceAnomalyReason`.

$$\text{Quality}_r = \begin{cases} \dfrac{N_{\text{good}, r}}{N_{\text{total}, r}} \times 100, & N_{\text{total}, r} > 0 \\ 0, & \text{otherwise} \end{cases}$$

$$\text{OEE}_r = \left(\frac{\text{Availability}_r}{100}\right)\left(\frac{\text{Performance}_r}{100}\right)\left(\frac{\text{Quality}_r}{100}\right) \times 100$$

### Server-Specific & Shared-Resource Ideal Cycle Resolution
- For heterogeneous parallel machines in a stage $S$, resource $r$ uses its own per-server `effectiveUnitCycleSec` from `ServerCapacityDetail` (not the stage harmonic average).
- When a physical resource $r$ is shared across multiple stages $\{s_1, \dots, s_k\}$ processing $n_{r, s_j}$ units at each stage with unit cycle $c_{r, s_j}$:
  $$C_{\text{ideal}, r} = \frac{\sum_{j=1}^{k} n_{r, s_j} \, c_{r, s_j}}{\sum_{j=1}^{k} n_{r, s_j}}$$

---

## 3. Stage OEE (`StageAnalytics`)

Let $P_S$ be the stage's deduplicated processing servers (or assigned objects for conveyor-only stages), with nominal throughput rate weights $w_r = R_r = \text{theoreticalCapacityPerHour}_r / 3600$ (uniform weight $1$ fallback when $R_r = 0$).

- **Capacity-Weighted Time Hierarchy**:
  $$\bar{\text{X}}_S = \frac{\sum_{r \in P_S} w_r \, X_r}{\sum_{r \in P_S} w_r} \quad \text{for } X \in \{\text{CT}, \text{PDT}, \text{SPT}, \text{UDT}, \text{SET}, \text{OT}\}$$
  - For **homogeneous parallel stages**, $w_r$ cancels identically to the arithmetic average.
  - For **heterogeneous parallel stages** (e.g., 20s and 60s servers) and **mixed parallel shifts**, weighting by $w_r$ preserves exact capacity conservation: $A_S \cdot P_S = (C_{\text{ideal}, S} \cdot N_{\text{stage}}) / \text{SPT}_S$.
- **Stage Ideal Unit Cycle Time**: Harmonic parallel unit cycle $C_{\text{ideal}, S} = 1 / \sum_{r \in P_S} R_r$ (`effectiveUnitCycleSec`).
- **Complete Stoppage vs. Partial Capacity Loss** (timeline sweep in `ResourceStateTracker.analyzeStageAvailabilityIntervals`):
  - **Complete Stoppage (`completeStoppageTimeSec`)**: Total duration where at least one server in $P_S$ is in `'down' | 'maintenance'` **and** zero servers in $P_S$ remain operational.
  - **Partial Capacity Loss (`partialCapacityLossTimeSec`)**: Total duration where at least one server in $P_S$ is in `'down' | 'maintenance'` **while** at least one parallel server remains operational.

---

## 4. Production Line OEE & Propagated Line Availability

Line Availability **is never computed from unweighted averages of resource downtime**. Instead, availability loss is measured at the **structural line constraint stage** $B$:

1. **Constraint Stage Selection**:
   - Uniform-shift lines: stage $B$ minimizing nominal capacity (`auditProjectTiming().bottleneckStageId`).
   - Heterogeneous-shift lines: stage $B$ minimizing shift-adjusted capacity ($\text{SPT}_S / C_{\text{ideal}, S}$).
   - Ideal line reference cycle time: $C_{\text{line}} = C_{\text{ideal}, B}$.
2. **Propagated Unplanned Downtime ($\text{UDT}_{\text{line}}$)**:
   Via an exact event-interval timeline sweep (`ResourceStateTracker.computePropagatedDowntimeSec`) masked to active calendar windows $W_r \subseteq [0, \text{SPT}_r]$, each target resource $r \in P_B$ accumulates mutually exclusive unplanned downtime over segment $[t_k, t_{k+1}]$ whenever:
   - $r$ is directly `'down'`, OR
   - $r$ is `'blocked'` while any downstream stage machine or connected downstream conveyor is `'down'`, OR
   - $r$ is `'starved'` (after entering initial production $t \ge t_{\text{firstWork}, r}$) while any upstream stage machine or connected upstream conveyor is `'down'`, OR
   - $r$ is still in startup `'idle' | 'starved'` ($t < t_{\text{firstWork}, r}$) while an entire upstream parallel group or required upstream conveyor is `'down'` (`anyUpGroupFullyDown`).

   The weighted stage average $\text{UDT}_{\text{line}}$ then feeds `computeOeeMetrics`:
   - $\text{Availability}_{\text{line}} = \text{OT}_{\text{line}} / \text{SPT}_{\text{line}} \times 100$
   - $\text{Performance}_{\text{line}} = (C_{\text{line}} \cdot (\text{Good}_{\text{final}} + \text{Scrap}_{\text{total}})) / \text{OT}_{\text{line}} \times 100$
   - $\text{Quality}_{\text{line}} = \text{Good}_{\text{final}} / (\text{Good}_{\text{final}} + \text{Scrap}_{\text{total}}) \times 100$ (preserving existing line quality correction)
   - $\text{OEE}_{\text{line}} = A_{\text{line}} \cdot P_{\text{line}} \cdot Q_{\text{line}}$

### Validity Assumptions & Documented Limitations
1. **Conveyor & Multi-Hop Topology**: Propagated starvation/blocking covers transitive stage closures (`stageUpstreamClosures`), `stage.conveyorObjectId`, and `connectedToIds` conveyor graphs. Unlinked floating conveyors with breakdowns enabled should be connected via stages, `conveyorObjectId`, or `connectedToIds` to participate in line-level propagation.
2. **Multiple Bottleneck Switching**: During non-stationary failures, dynamic bottlenecks may shift transiently; `UDT_line` anchors at the structural capacity constraint $B$ and captures upstream/downstream outages through failure-induced starvation/blocking on $B$, while reporting dynamic stage-level propagated downtime on every `StageAnalytics.propagatedDownTimeSec`.
3. **Shift-Spanning Repairs**: Active repairs initiated inside $\text{SPT}$ continue counting time to completion in wall clock while OEE $\text{UDT}$ clips strictly to $\text{SPT}$ windows (preventing double-counting against off-shift $\text{PDT}$).
4. **Shared Multi-Stage Resources at Stage Level**: When a single machine serves multiple sequential stages, each stage's `Performance` reflects its fraction of that machine's operating time (summing to $\le 100\%$ across shared stages), while the resource's own `ResourceOeeAnalytics.performancePct` reflects total ideal work across all stages.

---

## 5. Reliability Models (`src/simulation/failureModels.ts`)

- **Inherent Availability**:
  $$A_i = \frac{\text{MTBF}}{\text{MTBF} + \text{MTTR}}$$
  (e.g., $\text{MTBF} = 3600\text{s}, \text{MTTR} = 180\text{s} \implies A_i = \frac{3600}{3780} = 95.238095\%$).
- **Operational Availability**:
  $$A_o = \frac{\text{Operating Time}}{\text{Scheduled Production Time}}$$
- **Empirical Telemetry per Resource**:
  - $\hat{\text{MTBF}} = \frac{\text{SPT} - \text{UDT}}{N_{\text{failures}}}$ (operating uptime on test per observed failure)
  - $\hat{\text{MTTR}} = \text{mean}(\text{completed repair durations})$ (falling back to $\text{UDT} / N_{\text{failures}}$ when censored at horizon)
- **Failure Distributions**: `fixed`, `exponential`, `weibull` (with Lanczos $\Gamma(1 + 1/k)$ scale conversion $\lambda = \text{MTBF} / \Gamma(1 + 1/k)$).
- **Repair Distributions**: `fixed`, `exponential`, `triangular` ($[0.5\text{M}, 1.5\text{M}]$), `lognormal` (exact Method-of-Moments $\sigma^2 = \ln(1 + (\text{SD}/M)^2)$, $\mu = \ln(M) - \sigma^2/2$). Minimum repair clamp harmonized at `0.1s` across `failureModels.ts` and `desEngine.ts`.
