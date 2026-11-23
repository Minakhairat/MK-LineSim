import { LayoutObject, ProductionStage } from '../types/project';

export interface StageBatchConfig {
  batchSize: number;
  batchMode: 'single' | 'collect_batch' | 'unbatch';
  effectiveBatchDivisor: number;
  containerKind: 'pallet' | 'carton' | 'pack';
}

export interface StageEquipmentBreakdown {
  processingServers: LayoutObject[];
  processingServerCount: number;
  processingCapacitySum: number;
  bufferStorageCapacity: number;
  bufferCapacitySum: number;
  conveyorChannelCount: number;
  conveyorTransportCapacity: number;
  conveyorCapacitySum: number;
  physicalEquipmentCount: number;
}

export interface StageCapacityProfile {
  baseTaskTimeSec: number;
  setupTimeSec: number;
  batchTransferTimeSec: number;
  batchSize: number;
  batchMode: StageBatchConfig['batchMode'];
  effectiveBatchDivisor: number;
  parallelServers: number;
  bufferStorageCapacity: number;
  conveyorChannelCount: number;
  conveyorTransportCapacity: number;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
}

function dedupeObjects(assignedObjects: LayoutObject[]): LayoutObject[] {
  const seen = new Set<string>();
  const unique: LayoutObject[] = [];
  for (const obj of assignedObjects) {
    if (!obj || !obj.id || seen.has(obj.id)) continue;
    seen.add(obj.id);
    unique.push(obj);
  }
  return unique;
}

/**
 * Resolves stage batch configuration (batchSize, batchMode, effectiveBatchDivisor, containerKind)
 * without letting batch container size inflate parallel machine servers or single/unbatch throughput.
 */
export function resolveStageBatchConfig(
  stage: ProductionStage,
  assignedObjects: LayoutObject[] = []
): StageBatchConfig {
  const uniqueObjs = dedupeObjects(assignedObjects);
  const procObj = uniqueObjs.find((o) => o.kind === 'machine' || o.kind === 'workstation') ?? uniqueObjs[0];

  const rawBatch = Number(stage.batchSize ?? procObj?.operations.batchSize ?? 1);
  const parsedBatch = Number.isFinite(rawBatch) && rawBatch >= 1 ? Math.round(rawBatch) : 1;

  const rawMode = stage.batchMode ?? procObj?.operations.batchMode;
  const batchMode: StageBatchConfig['batchMode'] =
    rawMode === 'collect_batch' || rawMode === 'unbatch' || rawMode === 'single'
      ? rawMode
      : parsedBatch > 1
      ? 'collect_batch'
      : 'single';

  // Single Unit always processes 1 unit independently regardless of stale batchSize
  const batchSize = batchMode === 'single' ? 1 : parsedBatch;
  // Only Collect Batch amortizes cycle duration across N units per cycle; Unbatch & Single run 1 unit/cycle
  const effectiveBatchDivisor = batchMode === 'collect_batch' ? batchSize : 1;

  const cat = `${procObj?.category || ''} ${procObj?.name || ''} ${stage.name || ''}`.toLowerCase();
  const containerKind: StageBatchConfig['containerKind'] = cat.includes('pallet')
    ? 'pallet'
    : cat.includes('shrink') || cat.includes('stretch') || cat.includes('wrap') || cat.includes('pack')
    ? 'pack'
    : 'carton';

  return {
    batchSize,
    batchMode,
    effectiveBatchDivisor,
    containerKind,
  };
}

/**
 * Separates true processing server capacity (machines & workstations only)
 * from auxiliary buffer storage capacity and conveyor transport channels.
 */
export function resolveStageEquipmentBreakdown(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageEquipmentBreakdown {
  const uniqueObjs = dedupeObjects(assignedObjects);
  if (uniqueObjs.length === 0) {
    const req = Math.max(1, Math.round(Number(stage.requiredMachines || 1)));
    const buf = Math.max(0, Number(stage.bufferCapacity || 0));
    return {
      processingServers: [],
      processingServerCount: req,
      processingCapacitySum: req,
      bufferStorageCapacity: buf,
      bufferCapacitySum: buf,
      conveyorChannelCount: 0,
      conveyorTransportCapacity: 0,
      conveyorCapacitySum: 0,
      physicalEquipmentCount: 0,
    };
  }

  const processingServers: LayoutObject[] = [];
  let processingServerCount = 0;
  let bufferStorageCapacity = 0;
  let conveyorChannelCount = 0;
  let conveyorTransportCapacity = 0;

  for (const obj of uniqueObjs) {
    if (obj.kind === 'machine' || obj.kind === 'workstation') {
      processingServers.push(obj);
      processingServerCount += Math.max(1, Math.round(Number(obj.operations.capacity || 1)));
    } else if (obj.kind === 'buffer') {
      bufferStorageCapacity += Math.max(1, Math.round(Number(obj.operations.capacity || 1)));
    } else if (obj.kind === 'conveyor') {
      conveyorChannelCount += 1;
      conveyorTransportCapacity += Math.max(1, Math.round(Number(obj.operations.capacity || 1)));
    }
  }

  return {
    processingServers,
    processingServerCount,
    processingCapacitySum: processingServerCount,
    bufferStorageCapacity,
    bufferCapacitySum: bufferStorageCapacity,
    conveyorChannelCount,
    conveyorTransportCapacity,
    conveyorCapacitySum: conveyorTransportCapacity,
    physicalEquipmentCount: uniqueObjs.length,
  };
}

/**
 * Computes true parallel processing server count for a stage.
 * Deduplicates equipment IDs and strictly counts ONLY processing equipment
 * (`kind === 'machine'` or `kind === 'workstation'`).
 * Buffers, conveyors, storage, vehicles, and batch sizes NEVER inflate server count.
 */
export function resolveStageParallelServerCount(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): number {
  return resolveStageEquipmentBreakdown(stage, assignedObjects).processingServerCount;
}

/**
 * Computes deterministic theoretical stage capacity profile from configured task times,
 * true parallel machine/workstation server slots, and explicit batching mode rules:
 * - collect_batch: N units per batch cycle -> (baseTaskTimeSec + batchTransferTimeSec) / (servers * N)
 * - unbatch: splits incoming carrier into individual units -> baseTaskTimeSec / servers (1 unit/cycle)
 * - single: processes 1 unit independently -> baseTaskTimeSec / servers
 */
export function computeStageCapacityProfile(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageCapacityProfile {
  const uniqueObjs = dedupeObjects(assignedObjects);
  const procObj = uniqueObjs.find((o) => o.kind === 'machine' || o.kind === 'workstation') ?? uniqueObjs[0];

  const baseTaskTimeSec =
    Math.max(0, Number(stage.processingTimeSec ?? procObj?.operations.processingTimeSec ?? 0)) +
    Math.max(0, Number(stage.loadingTimeSec ?? procObj?.operations.loadingTimeSec ?? 0)) +
    Math.max(0, Number(stage.unloadingTimeSec ?? procObj?.operations.unloadingTimeSec ?? 0));

  const setupTimeSec = Math.max(0, Number(stage.setupTimeSec ?? procObj?.operations.setupTimeSec ?? 0));
  const batchCfg = resolveStageBatchConfig(stage, uniqueObjs);
  const batchTransferTimeSec =
    batchCfg.batchMode === 'collect_batch'
      ? Math.max(0, Number(stage.batchTransferTimeSec ?? procObj?.operations.batchTransferTimeSec ?? 0))
      : 0;

  const breakdown = resolveStageEquipmentBreakdown(stage, uniqueObjs);
  const parallelServers = breakdown.processingServerCount;

  const totalCycleSec = baseTaskTimeSec + batchTransferTimeSec;
  const effectiveUnitCycleSec =
    parallelServers > 0 && totalCycleSec > 0
      ? totalCycleSec / (parallelServers * batchCfg.effectiveBatchDivisor)
      : 0;
  const theoreticalCapacityPerHour =
    effectiveUnitCycleSec > 0 ? 3600 / effectiveUnitCycleSec : 0;

  return {
    baseTaskTimeSec,
    setupTimeSec,
    batchTransferTimeSec,
    batchSize: batchCfg.batchSize,
    batchMode: batchCfg.batchMode,
    effectiveBatchDivisor: batchCfg.effectiveBatchDivisor,
    parallelServers,
    bufferStorageCapacity: breakdown.bufferStorageCapacity,
    conveyorChannelCount: breakdown.conveyorChannelCount,
    conveyorTransportCapacity: breakdown.conveyorTransportCapacity,
    effectiveUnitCycleSec,
    theoreticalCapacityPerHour,
  };
}
