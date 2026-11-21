import { LayoutObject, ProductionStage } from '../types/project';

export interface StageBatchConfig {
  batchSize: number;
  batchMode: 'single' | 'collect_batch' | 'unbatch';
  containerKind: 'pallet' | 'carton' | 'pack';
}

export interface StageCapacityProfile {
  baseTaskTimeSec: number;
  setupTimeSec: number;
  batchSize: number;
  parallelServers: number;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
}

/**
 * Resolves batch grouping behavior and container kind from stage + assigned floor equipment.
 */
export function resolveStageBatchConfig(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageBatchConfig {
  const primaryObj = assignedObjects[0];
  const rawMode = stage.batchMode ?? primaryObj?.operations.batchMode;
  const rawSize = Math.max(
    1,
    Math.round(Number(stage.batchSize ?? primaryObj?.operations.batchSize ?? 1) || 1)
  );

  const cat = primaryObj?.category || '';
  const containerKind: StageBatchConfig['containerKind'] =
    cat.includes('pallet') || cat.includes('stretch_wrapper') || cat === 'material_handling'
      ? 'pallet'
      : cat.includes('shrink') || cat.includes('strapping')
      ? 'pack'
      : 'carton';

  if (rawMode === 'unbatch') {
    return { batchSize: 1, batchMode: 'unbatch', containerKind };
  }
  if (rawMode === 'single' || rawSize <= 1 || primaryObj?.kind === 'conveyor') {
    return { batchSize: 1, batchMode: 'single', containerKind };
  }
  return {
    batchSize: rawSize,
    batchMode: 'collect_batch',
    containerKind,
  };
}

/**
 * Computes true parallel server count for a stage without double-counting buffers,
 * conveyors, or batch container sizes as parallel machines.
 */
export function resolveStageParallelServerCount(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): number {
  if (assignedObjects.length === 0) {
    return Math.max(1, Number(stage.requiredMachines || 1));
  }

  let parallelServers = 0;
  for (const obj of assignedObjects) {
    if (obj.kind === 'machine' || obj.kind === 'workstation') {
      parallelServers += Math.max(1, Math.round(Number(obj.operations.capacity || 1)));
    } else {
      // Buffers and conveyors act as staging/transit channels rather than parallel machine servers
      parallelServers += 1;
    }
  }
  return Math.max(1, parallelServers);
}

/**
 * Computes deterministic theoretical stage capacity profile from configured task times,
 * true parallel server slots, and batch amortization.
 */
export function computeStageCapacityProfile(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageCapacityProfile {
  const baseTaskTimeSec =
    Math.max(0, Number(stage.processingTimeSec || 0)) +
    Math.max(0, Number(stage.loadingTimeSec || 0)) +
    Math.max(0, Number(stage.unloadingTimeSec || 0));

  const setupTimeSec = Math.max(0, Number(stage.setupTimeSec || 0));
  const batchCfg = resolveStageBatchConfig(stage, assignedObjects);
  const parallelServers = resolveStageParallelServerCount(stage, assignedObjects);

  const effectiveUnitCycleSec = baseTaskTimeSec / (parallelServers * batchCfg.batchSize);
  const theoreticalCapacityPerHour =
    effectiveUnitCycleSec > 0 ? 3600 / effectiveUnitCycleSec : 0;

  return {
    baseTaskTimeSec,
    setupTimeSec,
    batchSize: batchCfg.batchSize,
    parallelServers,
    effectiveUnitCycleSec,
    theoreticalCapacityPerHour,
  };
}
