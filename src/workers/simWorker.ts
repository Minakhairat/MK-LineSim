import { DiscreteEventSimulationEngine } from '../simulation/desEngine';
import { ProjectData, SimulationResult } from '../types/project';

export interface SimWorkerRequest {
  requestId: string;
  project: ProjectData;
}

export interface SimWorkerResponse {
  requestId: string;
  ok: boolean;
  result?: SimulationResult;
  error?: string;
}

self.onmessage = (event: MessageEvent<SimWorkerRequest>) => {
  const { requestId, project } = event.data;
  try {
    const engine = new DiscreteEventSimulationEngine(project);
    const result = engine.runToCompletion();
    const response: SimWorkerResponse = {
      requestId,
      ok: true,
      result,
    };
    self.postMessage(response);
  } catch (err) {
    const response: SimWorkerResponse = {
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'Simulation worker error',
    };
    self.postMessage(response);
  }
};
