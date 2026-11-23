import { DiscreteEventSimulationEngine } from '../simulation/desEngine';
import { validateProject } from '../simulation/validator';
import { ProjectData, SimEvent, SimulationResult, SimulationSnapshot } from '../types/project';

export interface SimWorkerRunMessage {
  type?: 'run';
  requestId: string;
  project: ProjectData;
}

export interface SimWorkerCancelMessage {
  type: 'cancel';
  requestId: string;
}

export type SimWorkerRequest = SimWorkerRunMessage | SimWorkerCancelMessage;

export interface SimWorkerProgressResponse {
  type: 'progress';
  requestId: string;
  progressPct: number;
  clockSec: number;
}

export interface SimWorkerCompleteResponse {
  type?: 'complete';
  requestId: string;
  ok: boolean;
  cancelled?: boolean;
  result?: SimulationResult;
  snapshot?: SimulationSnapshot;
  allEvents?: SimEvent[];
  error?: string;
}

export type SimWorkerResponse = SimWorkerProgressResponse | SimWorkerCompleteResponse;

const cancelledRequests = new Set<string>();

function runSlicedInWorker(requestId: string, project: ProjectData): void {
  try {
    const fatalError = validateProject(project).find((i) => i.severity === 'error');
    if (fatalError) {
      cancelledRequests.delete(requestId);
      const fail: SimWorkerCompleteResponse = {
        type: 'complete',
        requestId,
        ok: false,
        error: fatalError.message,
      };
      self.postMessage(fail);
      return;
    }

    const engine = new DiscreteEventSimulationEngine(project);
    engine.status = 'running';
    const totalSec = Math.max(1e-6, project.simulationConfig.durationSec || 28800);
    const sliceSec = Math.max(60, totalSec / 20);
    let cursor = 0;

    const stepSlice = () => {
      if (cancelledRequests.has(requestId)) {
        cancelledRequests.delete(requestId);
        const res: SimWorkerCompleteResponse = {
          type: 'complete',
          requestId,
          ok: false,
          cancelled: true,
          error: 'Simulation cancelled',
        };
        self.postMessage(res);
        return;
      }

      cursor = Math.min(totalSec, cursor + sliceSec);
      engine.advanceTo(cursor);

      const progressPct = Math.min(99, Math.round((cursor / totalSec) * 100));
      const prog: SimWorkerProgressResponse = {
        type: 'progress',
        requestId,
        progressPct,
        clockSec: engine.clockSec,
      };
      self.postMessage(prog);

      if (cursor < totalSec - 1e-6) {
        setTimeout(stepSlice, 0);
      } else {
        cancelledRequests.delete(requestId);
        const result = engine.buildResult();
        const snapshot = { ...engine.getSnapshot(false), status: 'completed' as const, result };
        const allEvents = engine.getAllEvents();
        const done: SimWorkerCompleteResponse = {
          type: 'complete',
          requestId,
          ok: true,
          result,
          snapshot,
          allEvents,
        };
        self.postMessage(done);
      }
    };

    stepSlice();
  } catch (err) {
    cancelledRequests.delete(requestId);
    const fail: SimWorkerCompleteResponse = {
      type: 'complete',
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'Simulation worker error',
    };
    self.postMessage(fail);
  }
}

self.onmessage = (event: MessageEvent<SimWorkerRequest>) => {
  const data = event.data;
  if (data.type === 'cancel') {
    cancelledRequests.add(data.requestId);
    return;
  }
  runSlicedInWorker(data.requestId, data.project);
};
