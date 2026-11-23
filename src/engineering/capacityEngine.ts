import { LayoutObject, ProductionStage } from '../types/project';

export interface StageBatchConfig {
  batchSize: number;
  batchMode: 'single' | 'collect_batch' | 'unbatch';
  effectiveBatchDivisor: number;
  containerKind: 'pallet' | 'carton' | 'pack';
  isValid: boolean;
  validationError?: string;
}

export type StageAssignmentMode =
  | 'physical_machines'
  | 'virtual_workstation'
  | 'conveyor_only'
  | 'buffer_only'
  | 'unassigned'
  | 'non_processing';

export interface StageEquipmentBreakdown {
  processingServers: LayoutObject[];
  physicalProcessingServers: LayoutObject[];
  virtualProcessingServers: LayoutObject[];
  processingServerCount: number;
  physicalProcessingServerCount: number;
  virtualServerCount: number;
  processingCapacitySum: number;
  bufferStorageCapacity: number;
  bufferCapacitySum: number;
  conveyorChannelCount: number;
  conveyorTransportCapacity: number;
  conveyorCapacitySum: number;
  physicalEquipmentCount: number;
  stageAssignmentMode: StageAssignmentMode;
  isVirtual: boolean;
  isUnassigned: boolean;
  isNonProcessing: boolean;
  isValid: boolean;
  invalidEquipmentInputs: string[];
}

export interface ServerCapacityDetail {
  objectId: string;
  objectName: string;
  kind: 'machine' | 'workstation' | 'virtual';
  isVirtual: boolean;
  slotCapacity: number;
  processingTimeSec: number;
  loadingTimeSec: number;
  unloadingTimeSec: number;
  baseTaskTimeSec: number;
  setupTimeSec: number;
  batchTransferTimeSec: number;
  batchCycleTimeSec: number;
  batchSize: number;
  batchMode: StageBatchConfig['batchMode'];
  effectiveBatchDivisor: number;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
  theoreticalBatchCapacityPerHour: number;
  isValid: boolean;
  validationError?: string;
}

export interface StageCapacityProfile {
  baseTaskTimeSec: number;
  setupTimeSec: number;
  batchTransferTimeSec: number;
  batchSize: number;
  batchMode: StageBatchConfig['batchMode'];
  effectiveBatchDivisor: number;
  parallelServers: number;
  physicalProcessingServersCount: number;
  virtualServerCount: number;
  bufferStorageCapacity: number;
  conveyorChannelCount: number;
  conveyorTransportCapacity: number;
  effectiveUnitCycleSec: number;
  theoreticalCapacityPerHour: number;
  theoreticalBatchCapacityPerHour: number;
  physicalCapacityPerHour: number;
  virtualCapacityPerHour: number;
  stageAssignmentMode: StageAssignmentMode;
  isVirtual: boolean;
  isUnassigned: boolean;
  isNonProcessing: boolean;
  isHeterogeneous: boolean;
  serverProfiles: ServerCapacityDetail[];
  isValid: boolean;
  validationErrors: string[];
}

export interface BatchRunPlanOptions {
  netAvailableTimeSec: number;
  setupOccurrences?: number;
  plannedUnits?: number;
  flushPartialBatch?: boolean;
}

export interface BatchRunPlanResult {
  netAvailableTimeSec: number;
  setupTimeTotalSec: number;
  netProductionTimeSec: number;
  batchSize: number;
  batchMode: StageBatchConfig['batchMode'];
  effectiveBatchDivisor: number;
  batchCycleTimeSec: number;
  theoreticalBatchCapacityPerHour: number;
  maxFullBatchesInTime: number;
  maxUnitsInFullBatchesInTime: number;
  timeLimitedMaxUnitsContinuous: number;
  plannedUnits?: number;
  fullBatches: number;
  partialBatchUnits: number;
  hasPartialBatch: boolean;
  totalBatchesExecuted: number;
  completedUnits: number;
  unbatchedRemainderUnits: number;
  isValid: boolean;
  validationError?: string;
}

export interface ShiftCapacityOptions {
  netScheduledTimeSec: number;
  serverScheduledTimeSec?: Record<string, number>;
  setupOccurrences?: number;
}

export interface ShiftAdjustedStageCapacity {
  netScheduledTimeSec: number;
  setupTimeTotalSec: number;
  netProductionTimeSec: number;
  nominalHourlyCapacity: number;
  shiftAdjustedCapacityUnits: number;
  shiftAdjustedDiscreteUnits: number;
  shiftAdjustedHourlyCapacity: number;
  physicalShiftAdjustedCapacityUnits: number;
  virtualShiftAdjustedCapacityUnits: number;
  isValid: boolean;
  validationError?: string;
}

export function isVirtualWorkstationObject(obj: LayoutObject): boolean {
  return Boolean(obj && obj.id.startsWith('virt_') && obj.rendering?.visible === false);
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

function checkNonNegFinite(val: unknown): { valid: boolean; present: boolean; value: number } {
  if (val === undefined || val === null) {
    return { valid: true, present: false, value: 0 };
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    return { valid: false, present: true, value: 0 };
  }
  return { valid: true, present: true, value: n };
}

function checkPosIntFinite(val: unknown): { valid: boolean; present: boolean; value: number } {
  if (val === undefined || val === null) {
    return { valid: true, present: false, value: 1 };
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return { valid: false, present: true, value: 0 };
  }
  return { valid: true, present: true, value: n };
}

function checkNonNegIntFinite(val: unknown): { valid: boolean; present: boolean; value: number } {
  if (val === undefined || val === null) {
    return { valid: true, present: false, value: 0 };
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { valid: false, present: true, value: 0 };
  }
  return { valid: true, present: true, value: n };
}

function resolveBatchConfigFromValues(
  rawBatchVal: unknown,
  rawModeVal: unknown,
  labelHint: string
): StageBatchConfig {
  const hasExplicitBatch = rawBatchVal !== undefined && rawBatchVal !== null;
  const rawBatchNum = hasExplicitBatch ? Number(rawBatchVal) : 1;
  const batchValid =
    !hasExplicitBatch || (Number.isFinite(rawBatchNum) && rawBatchNum >= 1 && Number.isInteger(rawBatchNum));

  const parsedBatch = batchValid ? Math.round(rawBatchNum) : 1;

  const batchMode: StageBatchConfig['batchMode'] =
    rawModeVal === 'collect_batch' || rawModeVal === 'unbatch' || rawModeVal === 'single'
      ? rawModeVal
      : parsedBatch > 1
      ? 'collect_batch'
      : 'single';

  // Single Unit always processes 1 unit independently regardless of stale batchSize
  const batchSize = batchMode === 'single' ? 1 : parsedBatch;
  // Only Collect Batch amortizes cycle duration across N units per cycle; Unbatch & Single run 1 unit/cycle
  const effectiveBatchDivisor = batchMode === 'collect_batch' ? batchSize : 1;

  const cat = labelHint.toLowerCase();
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
    isValid: batchValid,
    ...(!batchValid ? { validationError: `Invalid batchSize (${String(rawBatchVal)}); expected positive integer >= 1.` } : {}),
  };
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

  const rawBatch = stage.batchSize ?? procObj?.operations.batchSize;
  const rawMode = stage.batchMode ?? procObj?.operations.batchMode;
  const labelHint = `${procObj?.category || ''} ${procObj?.name || ''} ${stage.name || ''}`;
  return resolveBatchConfigFromValues(rawBatch, rawMode, labelHint);
}

function hasPositiveStageTaskTiming(stage: ProductionStage): boolean {
  const p = checkNonNegFinite(stage.processingTimeSec);
  const l = checkNonNegFinite(stage.loadingTimeSec);
  const u = checkNonNegFinite(stage.unloadingTimeSec);
  if (!p.valid || !l.valid || !u.valid) return false;
  return p.value + l.value + u.value > 0;
}

/**
 * Separates physical processing servers, virtual workstations, unassigned/non-processing stages,
 * auxiliary buffer storage capacity, and conveyor transport channels.
 * Never silently fabricates a physical machine or converts invalid <=0 machine capacity into 1.
 */
export function resolveStageEquipmentBreakdown(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageEquipmentBreakdown {
  const uniqueObjs = dedupeObjects(assignedObjects);
  const invalidEquipmentInputs: string[] = [];

  if (uniqueObjs.length === 0) {
    const reqCheck =
      stage.requiredMachines === undefined || stage.requiredMachines === null
        ? { valid: true, present: false, value: 1 }
        : checkNonNegIntFinite(stage.requiredMachines);
    const bufCheck = checkNonNegFinite(stage.bufferCapacity);
    const buf = bufCheck.valid ? bufCheck.value : 0;

    if (!reqCheck.valid) {
      invalidEquipmentInputs.push(
        `Stage "${stage.name}" has invalid requiredMachines (${String(stage.requiredMachines)}).`
      );
    }

    const stageHasWork = hasPositiveStageTaskTiming(stage);
    const req = reqCheck.valid ? reqCheck.value : 0;

    let stageAssignmentMode: StageAssignmentMode;
    let virtualServerCount = 0;

    if (!reqCheck.valid || req === 0 || !stageHasWork) {
      stageAssignmentMode = req === 0 && stageHasWork ? 'unassigned' : 'non_processing';
      virtualServerCount = 0;
    } else {
      stageAssignmentMode = 'virtual_workstation';
      virtualServerCount = req;
    }

    const isVirtual = stageAssignmentMode === 'virtual_workstation';
    const isNonProcessing = stageAssignmentMode === 'non_processing';

    return {
      processingServers: [],
      physicalProcessingServers: [],
      virtualProcessingServers: [],
      processingServerCount: virtualServerCount,
      physicalProcessingServerCount: 0,
      virtualServerCount,
      processingCapacitySum: virtualServerCount,
      bufferStorageCapacity: buf,
      bufferCapacitySum: buf,
      conveyorChannelCount: 0,
      conveyorTransportCapacity: 0,
      conveyorCapacitySum: 0,
      physicalEquipmentCount: 0,
      stageAssignmentMode,
      isVirtual,
      isUnassigned: true,
      isNonProcessing,
      isValid: reqCheck.valid && bufCheck.valid,
      invalidEquipmentInputs,
    };
  }

  const processingServers: LayoutObject[] = [];
  const physicalProcessingServers: LayoutObject[] = [];
  const virtualProcessingServers: LayoutObject[] = [];
  let physicalProcessingServerCount = 0;
  let virtualServerCount = 0;
  let bufferStorageCapacity = 0;
  let conveyorChannelCount = 0;
  let conveyorTransportCapacity = 0;
  let nonVirtualEquipmentCount = 0;

  for (const obj of uniqueObjs) {
    const isVirtualObj = isVirtualWorkstationObject(obj);
    if (!isVirtualObj) nonVirtualEquipmentCount += 1;

    if (obj.kind === 'machine' || obj.kind === 'workstation') {
      const capCheck = checkPosIntFinite(obj.operations?.capacity);
      if (!capCheck.valid) {
        invalidEquipmentInputs.push(
          `Equipment "${obj.name}" has invalid processing capacity (${String(obj.operations?.capacity)}).`
        );
      }
      processingServers.push(obj);
      if (isVirtualObj) {
        virtualProcessingServers.push(obj);
        if (capCheck.valid) virtualServerCount += capCheck.value;
      } else {
        physicalProcessingServers.push(obj);
        if (capCheck.valid) physicalProcessingServerCount += capCheck.value;
      }
    } else if (obj.kind === 'buffer') {
      const capCheck = checkPosIntFinite(obj.operations?.capacity);
      if (!capCheck.valid) {
        invalidEquipmentInputs.push(
          `Buffer "${obj.name}" has invalid capacity (${String(obj.operations?.capacity)}).`
        );
      } else {
        bufferStorageCapacity += capCheck.value;
      }
    } else if (obj.kind === 'conveyor') {
      conveyorChannelCount += 1;
      const rawCap = obj.operations?.capacity;
      if (rawCap !== undefined && rawCap !== null) {
        const capNum = Number(rawCap);
        if (!Number.isFinite(capNum) || capNum < 0 || !Number.isInteger(capNum)) {
          invalidEquipmentInputs.push(
            `Conveyor "${obj.name}" has invalid declared capacity (${String(rawCap)}).`
          );
        } else if (capNum > 0) {
          conveyorTransportCapacity += capNum;
        }
      }
    }
  }

  const processingServerCount = physicalProcessingServerCount + virtualServerCount;

  let stageAssignmentMode: StageAssignmentMode;
  if (physicalProcessingServers.length > 0) {
    stageAssignmentMode = 'physical_machines';
  } else if (virtualProcessingServers.length > 0) {
    stageAssignmentMode = 'virtual_workstation';
  } else if (conveyorChannelCount > 0) {
    stageAssignmentMode = 'conveyor_only';
  } else if (bufferStorageCapacity > 0 || uniqueObjs.some((o) => o.kind === 'buffer')) {
    stageAssignmentMode = 'buffer_only';
  } else {
    stageAssignmentMode = 'non_processing';
  }

  const isVirtual = stageAssignmentMode === 'virtual_workstation';
  const isNonProcessing =
    stageAssignmentMode === 'non_processing' ||
    stageAssignmentMode === 'buffer_only';

  return {
    processingServers,
    physicalProcessingServers,
    virtualProcessingServers,
    processingServerCount,
    physicalProcessingServerCount,
    virtualServerCount,
    processingCapacitySum: processingServerCount,
    bufferStorageCapacity,
    bufferCapacitySum: bufferStorageCapacity,
    conveyorChannelCount,
    conveyorTransportCapacity,
    conveyorCapacitySum: conveyorTransportCapacity,
    physicalEquipmentCount: nonVirtualEquipmentCount,
    stageAssignmentMode,
    isVirtual,
    isUnassigned: physicalProcessingServers.length === 0 && virtualProcessingServers.length === 0 && nonVirtualEquipmentCount === 0,
    isNonProcessing,
    isValid: invalidEquipmentInputs.length === 0,
    invalidEquipmentInputs,
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

type NumericOpsField =
  | 'processingTimeSec'
  | 'loadingTimeSec'
  | 'unloadingTimeSec'
  | 'setupTimeSec'
  | 'batchTransferTimeSec';

function resolveTimingFieldPerServer(
  servers: LayoutObject[],
  stageValue: unknown,
  field: NumericOpsField
): { values: number[]; stageVal: number; heterogeneous: boolean; valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stageCheck = checkNonNegFinite(stageValue);
  if (!stageCheck.valid) {
    errors.push(`Stage ${field} is invalid (${String(stageValue)}).`);
  }

  const objChecks = servers.map((obj) => ({
    obj,
    check: checkNonNegFinite(obj.operations?.[field]),
  }));

  for (const entry of objChecks) {
    if (!entry.check.valid) {
      errors.push(`Equipment "${entry.obj.name}" ${field} is invalid (${String(entry.obj.operations?.[field])}).`);
    }
  }

  if (servers.length === 0) {
    return {
      values: [],
      stageVal: stageCheck.valid ? stageCheck.value : 0,
      heterogeneous: false,
      valid: stageCheck.valid,
      errors,
    };
  }

  const definedObjVals = new Set<number>();
  let allObjectsZeroOrMissing = true;
  for (const { check } of objChecks) {
    if (check.present && check.valid) {
      definedObjVals.add(check.value);
      if (check.value > 0) allObjectsZeroOrMissing = false;
    }
  }

  const heterogeneous = definedObjVals.size > 1;
  const stageNum = stageCheck.valid ? stageCheck.value : 0;

  const values = objChecks.map(({ check }) => {
    if (!check.valid) return 0;
    if (heterogeneous) {
      return check.present ? check.value : stageNum;
    }
    if (allObjectsZeroOrMissing && stageNum > 0) {
      return stageNum;
    }
    if (stageCheck.present && stageNum > 0) {
      return stageNum;
    }
    return check.value;
  });

  return {
    values,
    stageVal: stageNum,
    heterogeneous,
    valid: stageCheck.valid && objChecks.every((e) => e.check.valid),
    errors,
  };
}

/**
 * Computes deterministic theoretical stage capacity profile from configured task times,
 * true parallel machine/workstation server slots (supporting heterogeneous parallel machines),
 * virtual vs. physical resource separation, and explicit batching mode rules:
 * - Rate addition across heterogeneous servers: C_stage = sum(c_i * d_i * 3600 / t_cycle_i)
 * - collect_batch: N units per batch cycle -> (baseTaskTimeSec + batchTransferTimeSec) / (servers * N)
 * - unbatch: splits incoming carrier into individual units -> baseTaskTimeSec / servers (1 unit/cycle)
 * - single: processes 1 unit independently -> baseTaskTimeSec / servers
 */
export function computeStageCapacityProfile(
  stage: ProductionStage,
  assignedObjects: LayoutObject[]
): StageCapacityProfile {
  const uniqueObjs = dedupeObjects(assignedObjects);
  const breakdown = resolveStageEquipmentBreakdown(stage, uniqueObjs);
  const validationErrors: string[] = [...breakdown.invalidEquipmentInputs];

  const batchCfg = resolveStageBatchConfig(stage, uniqueObjs);
  if (!batchCfg.isValid && batchCfg.validationError) {
    validationErrors.push(batchCfg.validationError);
  }

  const servers = breakdown.processingServers;
  const procField = resolveTimingFieldPerServer(servers, stage.processingTimeSec, 'processingTimeSec');
  const loadField = resolveTimingFieldPerServer(servers, stage.loadingTimeSec, 'loadingTimeSec');
  const unloadField = resolveTimingFieldPerServer(servers, stage.unloadingTimeSec, 'unloadingTimeSec');
  const setupField = resolveTimingFieldPerServer(servers, stage.setupTimeSec, 'setupTimeSec');
  const transferField = resolveTimingFieldPerServer(
    servers,
    stage.batchTransferTimeSec,
    'batchTransferTimeSec'
  );

  validationErrors.push(
    ...procField.errors,
    ...loadField.errors,
    ...unloadField.errors,
    ...setupField.errors,
    ...transferField.errors
  );

  // Check if servers define heterogeneous batch configurations
  const serverBatchConfigs = servers.map((obj) => {
    const rawB = obj.operations?.batchSize ?? stage.batchSize;
    const rawM = obj.operations?.batchMode ?? stage.batchMode;
    return resolveBatchConfigFromValues(rawB, rawM, `${obj.category || ''} ${obj.name || ''} ${stage.name || ''}`);
  });
  const distinctBatchSignatures = new Set(
    serverBatchConfigs.map((bc) => `${bc.batchMode}:${bc.effectiveBatchDivisor}`)
  );
  const hasHeterogeneousBatch = distinctBatchSignatures.size > 1;

  const isStageLevelInvalid = validationErrors.length > 0 && servers.length === 0;

  if (servers.length > 0) {
    const serverProfiles: ServerCapacityDetail[] = [];
    let totalUnitCapHr = 0;
    let totalBatchCapHr = 0;
    let physicalCapHr = 0;
    let virtualCapHr = 0;
    let validSlotSum = 0;
    let weightedSetupSum = 0;
    let weightedTransferSum = 0;

    for (let i = 0; i < servers.length; i++) {
      const obj = servers[i];
      const isVirtualObj = isVirtualWorkstationObject(obj);
      const capCheck = checkPosIntFinite(obj.operations?.capacity);
      const sBatch = hasHeterogeneousBatch ? serverBatchConfigs[i] : batchCfg;
      if (hasHeterogeneousBatch && !sBatch.isValid && sBatch.validationError) {
        validationErrors.push(`Equipment "${obj.name}": ${sBatch.validationError}`);
      }

      const proc = procField.values[i] ?? 0;
      const load = loadField.values[i] ?? 0;
      const unload = unloadField.values[i] ?? 0;
      const setup = setupField.values[i] ?? 0;
      const transfer = sBatch.batchMode === 'collect_batch' ? transferField.values[i] ?? 0 : 0;

      const baseTask = proc + load + unload;
      const batchCycle = baseTask + transfer;

      const objProcValid = checkNonNegFinite(obj.operations?.processingTimeSec).valid;
      const objLoadValid = checkNonNegFinite(obj.operations?.loadingTimeSec).valid;
      const objUnloadValid = checkNonNegFinite(obj.operations?.unloadingTimeSec).valid;
      const objSetupValid = checkNonNegFinite(obj.operations?.setupTimeSec).valid;
      const objTransferValid = checkNonNegFinite(obj.operations?.batchTransferTimeSec).valid;
      const stageTimingValid =
        checkNonNegFinite(stage.processingTimeSec).valid &&
        checkNonNegFinite(stage.loadingTimeSec).valid &&
        checkNonNegFinite(stage.unloadingTimeSec).valid &&
        checkNonNegFinite(stage.setupTimeSec).valid &&
        checkNonNegFinite(stage.batchTransferTimeSec).valid;

      const serverValid =
        capCheck.valid &&
        sBatch.isValid &&
        objProcValid &&
        objLoadValid &&
        objUnloadValid &&
        objSetupValid &&
        objTransferValid &&
        stageTimingValid;

      const slotCap = capCheck.valid ? capCheck.value : 0;
      const serverUnitCapHr =
        serverValid && slotCap > 0 && batchCycle > 0
          ? slotCap * ((3600 * sBatch.effectiveBatchDivisor) / batchCycle)
          : 0;
      const serverBatchCapHr =
        serverValid && slotCap > 0 && batchCycle > 0 ? slotCap * (3600 / batchCycle) : 0;
      const serverEffUnitCycle = serverUnitCapHr > 0 ? 3600 / serverUnitCapHr : 0;

      if (serverValid && slotCap > 0) {
        validSlotSum += slotCap;
        weightedSetupSum += setup * slotCap;
        weightedTransferSum += transfer * slotCap;
        totalUnitCapHr += serverUnitCapHr;
        totalBatchCapHr += serverBatchCapHr;
        if (isVirtualObj) {
          virtualCapHr += serverUnitCapHr;
        } else {
          physicalCapHr += serverUnitCapHr;
        }
      }

      serverProfiles.push({
        objectId: obj.id,
        objectName: obj.name,
        kind: isVirtualObj ? 'virtual' : (obj.kind as 'machine' | 'workstation'),
        isVirtual: isVirtualObj,
        slotCapacity: slotCap,
        processingTimeSec: proc,
        loadingTimeSec: load,
        unloadingTimeSec: unload,
        baseTaskTimeSec: baseTask,
        setupTimeSec: setup,
        batchTransferTimeSec: transfer,
        batchCycleTimeSec: batchCycle,
        batchSize: sBatch.batchSize,
        batchMode: sBatch.batchMode,
        effectiveBatchDivisor: sBatch.effectiveBatchDivisor,
        effectiveUnitCycleSec: serverEffUnitCycle,
        theoreticalCapacityPerHour: serverUnitCapHr,
        theoreticalBatchCapacityPerHour: serverBatchCapHr,
        isValid: serverValid,
        ...(!serverValid ? { validationError: 'Invalid server capacity or timing input.' } : {}),
      });
    }

    const isValid = validationErrors.length === 0;
    const isHeterogeneous =
      procField.heterogeneous ||
      loadField.heterogeneous ||
      unloadField.heterogeneous ||
      transferField.heterogeneous ||
      hasHeterogeneousBatch ||
      new Set(serverProfiles.filter((s) => s.batchCycleTimeSec > 0).map((s) => s.batchCycleTimeSec)).size > 1;

    const parallelServers = isValid ? validSlotSum : 0;
    const theoreticalCapacityPerHour = isValid ? totalUnitCapHr : 0;
    const theoreticalBatchCapacityPerHour = isValid ? totalBatchCapHr : 0;
    const effectiveUnitCycleSec =
      theoreticalCapacityPerHour > 0 ? 3600 / theoreticalCapacityPerHour : 0;
    const batchTransferTimeSec =
      validSlotSum > 0 && isValid ? weightedTransferSum / validSlotSum : 0;
    const setupTimeSec =
      validSlotSum > 0 && isValid ? weightedSetupSum / validSlotSum : setupField.stageVal;

    // Harmonic equivalent base task time preserves exact cycle identity:
    // (baseTaskTimeSec + batchTransferTimeSec) / (parallelServers * divisor) = effectiveUnitCycleSec
    let baseTaskTimeSec = 0;
    if (isValid && serverProfiles.length > 0) {
      if (!isHeterogeneous) {
        baseTaskTimeSec = serverProfiles[0].baseTaskTimeSec;
      } else if (effectiveUnitCycleSec > 0 && parallelServers > 0) {
        baseTaskTimeSec = Math.max(
          0,
          effectiveUnitCycleSec * parallelServers * batchCfg.effectiveBatchDivisor - batchTransferTimeSec
        );
      }
    }

    const isNonProcessing =
      breakdown.isNonProcessing || (isValid && theoreticalCapacityPerHour <= 0);

    return {
      baseTaskTimeSec,
      setupTimeSec,
      batchTransferTimeSec,
      batchSize: batchCfg.batchSize,
      batchMode: batchCfg.batchMode,
      effectiveBatchDivisor: batchCfg.effectiveBatchDivisor,
      parallelServers,
      physicalProcessingServersCount: isValid ? breakdown.physicalProcessingServerCount : 0,
      virtualServerCount: isValid ? breakdown.virtualServerCount : 0,
      bufferStorageCapacity: breakdown.bufferStorageCapacity,
      conveyorChannelCount: breakdown.conveyorChannelCount,
      conveyorTransportCapacity: breakdown.conveyorTransportCapacity,
      effectiveUnitCycleSec,
      theoreticalCapacityPerHour,
      theoreticalBatchCapacityPerHour,
      physicalCapacityPerHour: isValid ? physicalCapHr : 0,
      virtualCapacityPerHour: isValid ? virtualCapHr : 0,
      stageAssignmentMode:
        isValid && theoreticalCapacityPerHour <= 0 && breakdown.stageAssignmentMode === 'physical_machines'
          ? 'non_processing'
          : breakdown.stageAssignmentMode,
      isVirtual: breakdown.isVirtual,
      isUnassigned: breakdown.isUnassigned,
      isNonProcessing,
      isHeterogeneous,
      serverProfiles,
      isValid,
      validationErrors,
    };
  }

  // Zero physical or virt_* objects passed in: either unassigned/virtual, conveyor_only, buffer_only, or non_processing
  const auxObj = uniqueObjs[0];
  const procFallback = checkNonNegFinite(auxObj?.operations?.processingTimeSec);
  const loadFallback = checkNonNegFinite(auxObj?.operations?.loadingTimeSec);
  const unloadFallback = checkNonNegFinite(auxObj?.operations?.unloadingTimeSec);
  const setupFallback = checkNonNegFinite(auxObj?.operations?.setupTimeSec);
  const transferFallback = checkNonNegFinite(auxObj?.operations?.batchTransferTimeSec);

  if (!procFallback.valid || !loadFallback.valid || !unloadFallback.valid || !setupFallback.valid || !transferFallback.valid) {
    validationErrors.push('Invalid negative or non-finite operational timing parameter.');
  }

  const rawStageBase =
    (procField.stageVal || (procFallback.valid ? procFallback.value : 0)) +
    (loadField.stageVal || (loadFallback.valid ? loadFallback.value : 0)) +
    (unloadField.stageVal || (unloadFallback.valid ? unloadFallback.value : 0));

  const setupTimeSec = setupField.stageVal || (setupFallback.valid ? setupFallback.value : 0);
  const batchTransferTimeSec =
    batchCfg.batchMode === 'collect_batch'
      ? transferField.stageVal || (transferFallback.valid ? transferFallback.value : 0)
      : 0;

  const isValid = validationErrors.length === 0 && !isStageLevelInvalid;
  const baseTaskTimeSec = isValid ? rawStageBase : 0;
  const totalCycleSec = baseTaskTimeSec + batchTransferTimeSec;

  const parallelServers = isValid ? breakdown.processingServerCount : 0;
  const virtualServerCount = isValid ? breakdown.virtualServerCount : 0;

  const virtualCycleSec =
    isValid && virtualServerCount > 0 && totalCycleSec > 0
      ? totalCycleSec / (virtualServerCount * batchCfg.effectiveBatchDivisor)
      : 0;
  const virtualCapacityPerHour = virtualCycleSec > 0 ? 3600 / virtualCycleSec : 0;
  const theoreticalBatchCapacityPerHour =
    isValid && virtualServerCount > 0 && totalCycleSec > 0
      ? (virtualServerCount * 3600) / totalCycleSec
      : 0;

  return {
    baseTaskTimeSec,
    setupTimeSec: isValid ? setupTimeSec : 0,
    batchTransferTimeSec: isValid ? batchTransferTimeSec : 0,
    batchSize: batchCfg.batchSize,
    batchMode: batchCfg.batchMode,
    effectiveBatchDivisor: batchCfg.effectiveBatchDivisor,
    parallelServers,
    physicalProcessingServersCount: 0,
    virtualServerCount,
    bufferStorageCapacity: breakdown.bufferStorageCapacity,
    conveyorChannelCount: breakdown.conveyorChannelCount,
    conveyorTransportCapacity: breakdown.conveyorTransportCapacity,
    effectiveUnitCycleSec: virtualCycleSec,
    theoreticalCapacityPerHour: virtualCapacityPerHour,
    theoreticalBatchCapacityPerHour,
    physicalCapacityPerHour: 0,
    virtualCapacityPerHour,
    stageAssignmentMode: breakdown.stageAssignmentMode,
    isVirtual: breakdown.isVirtual,
    isUnassigned: breakdown.isUnassigned,
    isNonProcessing: breakdown.isNonProcessing || totalCycleSec <= 0,
    isHeterogeneous: false,
    serverProfiles: [],
    isValid,
    validationErrors,
  };
}

/**
 * Evaluates finite-horizon batch production capacity including batch transfers,
 * setup deduction, discrete integer cycles, and end-of-run partial batches.
 */
export function computeBatchRunPlan(
  profile: StageCapacityProfile,
  options: BatchRunPlanOptions
): BatchRunPlanResult {
  const netTimeCheck = checkNonNegFinite(options.netAvailableTimeSec);
  const setupOccCheck =
    options.setupOccurrences === undefined
      ? { valid: true, present: false, value: profile.setupTimeSec > 0 ? 1 : 0 }
      : checkNonNegIntFinite(options.setupOccurrences);
  const plannedCheck =
    options.plannedUnits === undefined
      ? { valid: true, present: false, value: 0 }
      : checkNonNegIntFinite(options.plannedUnits);

  const flushPartialBatch = options.flushPartialBatch ?? true;
  const batchCycleTimeSec =
    profile.baseTaskTimeSec + (profile.batchMode === 'collect_batch' ? profile.batchTransferTimeSec : 0);

  if (!profile.isValid || !netTimeCheck.valid || !setupOccCheck.valid || !plannedCheck.valid) {
    return {
      netAvailableTimeSec: 0,
      setupTimeTotalSec: 0,
      netProductionTimeSec: 0,
      batchSize: profile.batchSize,
      batchMode: profile.batchMode,
      effectiveBatchDivisor: profile.effectiveBatchDivisor,
      batchCycleTimeSec: 0,
      theoreticalBatchCapacityPerHour: 0,
      maxFullBatchesInTime: 0,
      maxUnitsInFullBatchesInTime: 0,
      timeLimitedMaxUnitsContinuous: 0,
      ...(plannedCheck.present ? { plannedUnits: plannedCheck.value } : {}),
      fullBatches: 0,
      partialBatchUnits: 0,
      hasPartialBatch: false,
      totalBatchesExecuted: 0,
      completedUnits: 0,
      unbatchedRemainderUnits: 0,
      isValid: false,
      validationError: 'Invalid stage profile, available time, setup occurrence, or planned unit input.',
    };
  }

  const netAvailableTimeSec = netTimeCheck.value;
  const setupTimeTotalSec = Math.min(netAvailableTimeSec, setupOccCheck.value * profile.setupTimeSec);
  const netProductionTimeSec = Math.max(0, netAvailableTimeSec - setupTimeTotalSec);

  let maxFullBatchesInTime = 0;
  let maxUnitsInFullBatchesInTime = 0;

  if (profile.serverProfiles.length > 0) {
    for (const sp of profile.serverProfiles) {
      if (!sp.isValid || sp.slotCapacity <= 0 || sp.batchCycleTimeSec <= 0) continue;
      const serverProdTime = Math.max(
        0,
        netAvailableTimeSec - Math.min(netAvailableTimeSec, setupOccCheck.value * sp.setupTimeSec)
      );
      const slotBatches = Math.floor((serverProdTime + 1e-9) / sp.batchCycleTimeSec);
      const totalServerBatches = sp.slotCapacity * slotBatches;
      maxFullBatchesInTime += totalServerBatches;
      maxUnitsInFullBatchesInTime += totalServerBatches * sp.effectiveBatchDivisor;
    }
  } else if (profile.parallelServers > 0 && batchCycleTimeSec > 0) {
    const slotBatches = Math.floor((netProductionTimeSec + 1e-9) / batchCycleTimeSec);
    maxFullBatchesInTime = profile.parallelServers * slotBatches;
    maxUnitsInFullBatchesInTime = maxFullBatchesInTime * profile.effectiveBatchDivisor;
  }

  const timeLimitedMaxUnitsContinuous =
    (netProductionTimeSec * profile.theoreticalCapacityPerHour) / 3600;

  const divisor = profile.effectiveBatchDivisor;
  if (!plannedCheck.present) {
    return {
      netAvailableTimeSec,
      setupTimeTotalSec,
      netProductionTimeSec,
      batchSize: profile.batchSize,
      batchMode: profile.batchMode,
      effectiveBatchDivisor: divisor,
      batchCycleTimeSec,
      theoreticalBatchCapacityPerHour: profile.theoreticalBatchCapacityPerHour,
      maxFullBatchesInTime,
      maxUnitsInFullBatchesInTime,
      timeLimitedMaxUnitsContinuous,
      fullBatches: maxFullBatchesInTime,
      partialBatchUnits: 0,
      hasPartialBatch: false,
      totalBatchesExecuted: maxFullBatchesInTime,
      completedUnits: maxUnitsInFullBatchesInTime,
      unbatchedRemainderUnits: 0,
      isValid: true,
    };
  }

  const plannedUnits = plannedCheck.value;
  const fullDemandBatches = Math.floor(plannedUnits / divisor);
  const remainderUnits = plannedUnits % divisor;
  const hasPartialDemand = remainderUnits > 0;

  if (flushPartialBatch) {
    if (maxFullBatchesInTime >= fullDemandBatches + (hasPartialDemand ? 1 : 0)) {
      return {
        netAvailableTimeSec,
        setupTimeTotalSec,
        netProductionTimeSec,
        batchSize: profile.batchSize,
        batchMode: profile.batchMode,
        effectiveBatchDivisor: divisor,
        batchCycleTimeSec,
        theoreticalBatchCapacityPerHour: profile.theoreticalBatchCapacityPerHour,
        maxFullBatchesInTime,
        maxUnitsInFullBatchesInTime,
        timeLimitedMaxUnitsContinuous,
        plannedUnits,
        fullBatches: fullDemandBatches,
        partialBatchUnits: remainderUnits,
        hasPartialBatch: hasPartialDemand,
        totalBatchesExecuted: fullDemandBatches + (hasPartialDemand ? 1 : 0),
        completedUnits: plannedUnits,
        unbatchedRemainderUnits: 0,
        isValid: true,
      };
    }

    const fullCompleted = Math.min(maxFullBatchesInTime, fullDemandBatches);
    const completedUnits = Math.min(plannedUnits, fullCompleted * divisor);
    return {
      netAvailableTimeSec,
      setupTimeTotalSec,
      netProductionTimeSec,
      batchSize: profile.batchSize,
      batchMode: profile.batchMode,
      effectiveBatchDivisor: divisor,
      batchCycleTimeSec,
      theoreticalBatchCapacityPerHour: profile.theoreticalBatchCapacityPerHour,
      maxFullBatchesInTime,
      maxUnitsInFullBatchesInTime,
      timeLimitedMaxUnitsContinuous,
      plannedUnits,
      fullBatches: fullCompleted,
      partialBatchUnits: 0,
      hasPartialBatch: hasPartialDemand,
      totalBatchesExecuted: fullCompleted,
      completedUnits,
      unbatchedRemainderUnits: Math.max(0, plannedUnits - completedUnits),
      isValid: true,
    };
  }

  // Strict full-batch mode (no end-of-run partial batch release)
  const executedFullBatches = Math.min(maxFullBatchesInTime, fullDemandBatches);
  const completedUnits = executedFullBatches * divisor;
  return {
    netAvailableTimeSec,
    setupTimeTotalSec,
    netProductionTimeSec,
    batchSize: profile.batchSize,
    batchMode: profile.batchMode,
    effectiveBatchDivisor: divisor,
    batchCycleTimeSec,
    theoreticalBatchCapacityPerHour: profile.theoreticalBatchCapacityPerHour,
    maxFullBatchesInTime,
    maxUnitsInFullBatchesInTime,
    timeLimitedMaxUnitsContinuous,
    plannedUnits,
    fullBatches: executedFullBatches,
    partialBatchUnits: remainderUnits,
    hasPartialBatch: hasPartialDemand,
    totalBatchesExecuted: executedFullBatches,
    completedUnits,
    unbatchedRemainderUnits: Math.max(0, plannedUnits - completedUnits),
    isValid: true,
  };
}

/**
 * Computes shift-adjusted stage capacity accounting for scheduled production time,
 * per-machine setup deductions, parallel servers, and physical vs. virtual resource isolation.
 */
export function computeShiftAdjustedStageCapacity(
  profile: StageCapacityProfile,
  options: ShiftCapacityOptions
): ShiftAdjustedStageCapacity {
  const schedCheck = checkNonNegFinite(options.netScheduledTimeSec);
  const setupOccCheck =
    options.setupOccurrences === undefined
      ? undefined
      : checkNonNegIntFinite(options.setupOccurrences);

  if (!profile.isValid || !schedCheck.valid || (setupOccCheck && !setupOccCheck.valid)) {
    return {
      netScheduledTimeSec: 0,
      setupTimeTotalSec: 0,
      netProductionTimeSec: 0,
      nominalHourlyCapacity: 0,
      shiftAdjustedCapacityUnits: 0,
      shiftAdjustedDiscreteUnits: 0,
      shiftAdjustedHourlyCapacity: 0,
      physicalShiftAdjustedCapacityUnits: 0,
      virtualShiftAdjustedCapacityUnits: 0,
      isValid: false,
      validationError: 'Invalid stage profile, scheduled time, or setup count.',
    };
  }

  if (profile.serverProfiles.length > 0) {
    let shiftUnitsCont = 0;
    let shiftUnitsDisc = 0;
    let physShiftUnits = 0;
    let virtShiftUnits = 0;
    let schedSum = 0;
    let setupSum = 0;
    let prodSum = 0;
    let slotSum = 0;

    for (const sp of profile.serverProfiles) {
      if (!sp.isValid || sp.slotCapacity <= 0) continue;
      const rawServerSched = options.serverScheduledTimeSec?.[sp.objectId] ?? schedCheck.value;
      const serverSched = Number.isFinite(rawServerSched) && rawServerSched >= 0 ? rawServerSched : 0;
      const occ =
        setupOccCheck !== undefined
          ? setupOccCheck.value
          : sp.setupTimeSec > 0 && serverSched > 0
          ? 1
          : 0;
      const serverSetup = Math.min(serverSched, occ * sp.setupTimeSec);
      const serverProd = Math.max(0, serverSched - serverSetup);

      schedSum += serverSched * sp.slotCapacity;
      setupSum += serverSetup * sp.slotCapacity;
      prodSum += serverProd * sp.slotCapacity;
      slotSum += sp.slotCapacity;

      if (sp.batchCycleTimeSec > 0) {
        const cont = sp.slotCapacity * ((serverProd * sp.effectiveBatchDivisor) / sp.batchCycleTimeSec);
        const disc =
          sp.slotCapacity *
          Math.floor((serverProd + 1e-9) / sp.batchCycleTimeSec) *
          sp.effectiveBatchDivisor;
        shiftUnitsCont += cont;
        shiftUnitsDisc += disc;
        if (sp.isVirtual) {
          virtShiftUnits += cont;
        } else {
          physShiftUnits += cont;
        }
      }
    }

    const avgSched = slotSum > 0 ? schedSum / slotSum : schedCheck.value;
    const avgSetup = slotSum > 0 ? setupSum / slotSum : 0;
    const avgProd = slotSum > 0 ? prodSum / slotSum : 0;
    const shiftAdjustedHourlyCapacity = avgSched > 0 ? (shiftUnitsCont * 3600) / avgSched : 0;

    return {
      netScheduledTimeSec: avgSched,
      setupTimeTotalSec: avgSetup,
      netProductionTimeSec: avgProd,
      nominalHourlyCapacity: profile.theoreticalCapacityPerHour,
      shiftAdjustedCapacityUnits: shiftUnitsCont,
      shiftAdjustedDiscreteUnits: shiftUnitsDisc,
      shiftAdjustedHourlyCapacity,
      physicalShiftAdjustedCapacityUnits: physShiftUnits,
      virtualShiftAdjustedCapacityUnits: virtShiftUnits,
      isValid: true,
    };
  }

  // Virtual or non-processing stage without individual server entries
  const netScheduledTimeSec = schedCheck.value;
  const occ =
    setupOccCheck !== undefined
      ? setupOccCheck.value
      : profile.setupTimeSec > 0 && netScheduledTimeSec > 0
      ? 1
      : 0;
  const setupTimeTotalSec = Math.min(netScheduledTimeSec, occ * profile.setupTimeSec);
  const netProductionTimeSec = Math.max(0, netScheduledTimeSec - setupTimeTotalSec);

  const shiftAdjustedCapacityUnits =
    (netProductionTimeSec * profile.theoreticalCapacityPerHour) / 3600;
  const cyclePerBatch =
    profile.baseTaskTimeSec + (profile.batchMode === 'collect_batch' ? profile.batchTransferTimeSec : 0);
  const shiftAdjustedDiscreteUnits =
    profile.parallelServers > 0 && cyclePerBatch > 0
      ? profile.parallelServers *
        Math.floor((netProductionTimeSec + 1e-9) / cyclePerBatch) *
        profile.effectiveBatchDivisor
      : 0;
  const shiftAdjustedHourlyCapacity =
    netScheduledTimeSec > 0 ? (shiftAdjustedCapacityUnits * 3600) / netScheduledTimeSec : 0;

  return {
    netScheduledTimeSec,
    setupTimeTotalSec,
    netProductionTimeSec,
    nominalHourlyCapacity: profile.theoreticalCapacityPerHour,
    shiftAdjustedCapacityUnits,
    shiftAdjustedDiscreteUnits,
    shiftAdjustedHourlyCapacity,
    physicalShiftAdjustedCapacityUnits: 0,
    virtualShiftAdjustedCapacityUnits: profile.isVirtual ? shiftAdjustedCapacityUnits : 0,
    isValid: true,
  };
}
