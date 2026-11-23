import { ProjectData, ScenarioRecord, SimulationResult } from '../types/project';
import { DiscreteEventSimulationEngine } from './desEngine';
import type { SimWorkerRequest, SimWorkerResponse } from '../workers/simWorker';
import { computeStationSidePlacement } from '../engineering/conveyorWorkerAssignment';

let workerInstance: Worker | null = null;
const pending = new Map<
  string,
  { resolve: (res: SimulationResult) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('../workers/simWorker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (e: MessageEvent<SimWorkerResponse>) => {
        const { requestId, ok, result, error } = e.data;
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId);
        if (ok && result) entry.resolve(result);
        else entry.reject(new Error(error || 'Simulation failed'));
      };
      workerInstance.onerror = (err) => {
        for (const entry of pending.values()) {
          entry.reject(new Error(err.message || 'Worker runtime error'));
        }
        pending.clear();
        workerInstance = null;
      };
    } catch {
      return null;
    }
  }
  return workerInstance;
}

export function runSimulationInWorker(project: ProjectData): Promise<SimulationResult> {
  const worker = getWorker();
  if (!worker) {
    const engine = new DiscreteEventSimulationEngine(project);
    return Promise.resolve(engine.runToCompletion());
  }

  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(requestId, { resolve, reject });
    const req: SimWorkerRequest = { requestId, project };
    worker.postMessage(req);
  });
}

export function applyScenarioOverrides(
  baseProject: ProjectData,
  overrides: ScenarioRecord['overrides']
): ProjectData {
  const cloned: ProjectData = structuredClone(baseProject);

  // Adjust simulation duration, breakdowns, target
  cloned.simulationConfig.durationSec = Math.max(600, overrides.shiftDurationSec);
  cloned.simulationConfig.enableBreakdowns = overrides.enableBreakdowns;
  cloned.simulationConfig.maxPlannedUnits = Math.max(1, overrides.targetProduction);
  if (cloned.simulationConfig.shifts[0]) {
    cloned.simulationConfig.shifts[0].durationSec = cloned.simulationConfig.durationSec;
  }

  // Adjust processing time scale & buffer capacities
  const scale = Math.max(0.1, overrides.processingTimeScale);
  for (const st of cloned.stages) {
    st.processingTimeSec =
      st.processingTimeSec === 0 ? 0 : Math.max(0.05, Math.round(st.processingTimeSec * scale * 100) / 100);
    st.bufferCapacity = Math.max(1, overrides.bufferCapacity);
  }
  for (const obj of cloned.layoutObjects) {
    if (obj.kind === 'conveyor') {
      obj.operations.speedMps = Math.max(0.01, overrides.conveyorSpeedMps);
    } else if (obj.kind === 'machine' || obj.kind === 'workstation') {
      obj.operations.processingTimeSec =
        obj.operations.processingTimeSec === 0
          ? 0
          : Math.max(0.05, Math.round(obj.operations.processingTimeSec * scale * 100) / 100);
    }
  }

  // Adjust worker count
  const desiredWorkers = Math.max(1, Math.round(overrides.workerCount));
  if (desiredWorkers < cloned.workers.length) {
    cloned.workers = cloned.workers.slice(0, desiredWorkers);
    // Ensure remaining workers cover any orphaned stages by adding multi-stage assignments round-robin
    const coveredStages = new Set(cloned.workers.flatMap((w) => w.assignedStageIds));
    let idx = 0;
    for (const st of cloned.stages) {
      if (!coveredStages.has(st.id) && cloned.workers.length > 0) {
        const w = cloned.workers[idx % cloned.workers.length];
        if (!w.assignedStageIds.includes(st.id)) {
          w.assignedStageIds.push(st.id);
        }
        idx++;
      }
    }
  } else if (desiredWorkers > cloned.workers.length && cloned.stages.length > 0) {
    // Prioritize adding extra workers to highest processing-time stages
    const sortedStages = [...cloned.stages].sort(
      (a, b) => b.processingTimeSec - a.processingTimeSec
    );
    let extraIdx = 0;
    while (cloned.workers.length < desiredWorkers) {
      const targetStage = sortedStages[extraIdx % sortedStages.length];
      const stObj = cloned.layoutObjects.find((o) => o.id === targetStage.assignedObjectIds[0]);
      const n = cloned.workers.length + 1;
      const placement = stObj
        ? computeStationSidePlacement(stObj, 'south', {
            lengthM: cloned.factory.lengthM,
            widthM: cloned.factory.widthM,
          })
        : undefined;
      cloned.workers.push({
        id: `wrk_scen_${n}`,
        label: `W-${String(n).padStart(2, '0')}`,
        name: `Added Operator ${String(n).padStart(2, '0')}`,
        position: placement ? placement.position : { x: 5, y: 0, z: 10 },
        rotation: placement ? placement.rotationDeg : 0,
        rotationDeg: placement ? placement.rotationDeg : 0,
        placementSide: placement ? 'south' : 'custom',
        assignedStageIds: [targetStage.id],
        assignedTo: stObj?.id,
        assignedStationId: stObj?.id,
        skillCategory: 'Multi-Stage',
        skillLevel: 4,
        efficiencyFactor: 1.0,
        walkingSpeedMps: 1.25,
        shiftId: cloned.simulationConfig.shifts[0]?.id || 'shift_day',
        color: '#1D4ED8',
      });
      extraIdx++;
    }
  }

  return cloned;
}
