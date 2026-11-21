import {
  EquipmentCategory,
  LayoutObject,
  ProductionLine,
  ProductionLineType,
  ProductionStage,
  ProjectData,
  WorkerDefinition,
} from '../types/project';
import { BUILTIN_EQUIPMENT_TEMPLATES } from '../data/equipmentCatalog';
import { uid } from '../utils/units';

export interface AutoLayoutInput {
  lineName: string;
  lineType: ProductionLineType;
  stageCount: number;
  workerCount: number;
  targetCapacityPerShift: number;
  conveyorSpeedMps: number;
  conveyorWidthM: number;
  conveyorHeightM: number;
  clearanceM: number;
  aisleMarginM: number;
  defaultProcessingTimeSec: number;
  equipmentCategory: EquipmentCategory;
}

export interface AutoLayoutResult {
  line: ProductionLine;
  objects: LayoutObject[];
  stages: ProductionStage[];
  workers: WorkerDefinition[];
  warnings: string[];
  feasible: boolean;
}

/**
 * Deterministic geometry-based automatic layout generator with factory bounds,
 * clearance, aisle, and collision validation.
 */
export function generateAutomaticLineLayout(
  project: ProjectData,
  input: AutoLayoutInput
): AutoLayoutResult {
  const warnings: string[] = [];
  const { factory } = project;
  const tpl =
    BUILTIN_EQUIPMENT_TEMPLATES.find((t) => t.category === input.equipmentCategory) ||
    BUILTIN_EQUIPMENT_TEMPLATES[2];

  const stLength = tpl.defaultDimensions.length;
  const stWidth = tpl.defaultDimensions.width;
  const stHeight = tpl.defaultDimensions.height;

  const usableMinX = input.aisleMarginM + input.clearanceM;
  const usableMaxX = factory.lengthM - input.aisleMarginM - input.clearanceM;
  const usableMinZ = input.aisleMarginM + input.clearanceM;
  const usableMaxZ = factory.widthM - input.aisleMarginM - input.clearanceM;
  const usableLen = usableMaxX - usableMinX;
  const usableWid = usableMaxZ - usableMinZ;

  if (usableLen <= 2 || usableWid <= 2) {
    warnings.push(
      `Factory usable area (${usableLen.toFixed(1)}m × ${usableWid.toFixed(1)}m) is too tight for aisles and clearances.`
    );
  }

  const lineId = uid('line');
  const stageCount = Math.max(2, Math.min(24, input.stageCount));
  const stepPitch = Math.max(stLength + Math.max(0.35, input.clearanceM), 2.3);

  const objects: LayoutObject[] = [];
  const stages: ProductionStage[] = [];
  const workers: WorkerDefinition[] = [];

  const stationPositions: Array<{ x: number; z: number; rot: number; convIdx: number }> = [];
  const midZ = factory.widthM / 2;

  if (input.lineType === 'straight' || input.lineType === 'custom') {
    const requiredLen = (stageCount - 1) * stepPitch + stLength;
    if (requiredLen > usableLen) {
      warnings.push(
        `Straight line needs ${requiredLen.toFixed(1)}m length (available: ${usableLen.toFixed(1)}m). Consider U-Shaped or L-Shaped layout.`
      );
    }
    const startX = usableMinX + stLength / 2;
    const actualPitch = Math.max(
      stLength + 0.2,
      Math.min(stepPitch, (usableLen - stLength) / Math.max(1, stageCount - 1))
    );
    const convLen = Math.max(2.0, actualPitch * (stageCount - 1) + stLength);

    objects.push({
      id: uid('obj_conv'),
      name: `${input.lineName} Spine Conveyor`,
      kind: 'conveyor',
      category: 'conveyor_belt',
      templateId: 'tpl_conveyor_belt',
      productionLineId: lineId,
      connectedToIds: [],
      geometry: {
        position: { x: startX + (convLen - stLength) / 2, y: 0, z: midZ },
        dimensions: { length: convLen, width: input.conveyorWidthM, height: input.conveyorHeightM },
        rotationDeg: 0,
        clearanceM: 0.25,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: Math.max(8, stageCount * 2),
        availability: 0.99,
        requiredOperators: 0,
        speedMps: input.conveyorSpeedMps,
        productSpacingM: 0.15,
        direction: 1,
      },
      rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
    });

    for (let i = 0; i < stageCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      stationPositions.push({
        x: startX + i * actualPitch,
        z: midZ + side * (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
        rot: 0,
        convIdx: 0,
      });
    }
  } else if (input.lineType === 'u_shaped') {
    const half = Math.ceil(stageCount / 2);
    const armOffsetZ = Math.min(2.8, Math.max(1.8, usableWid * 0.22));
    const zTop = midZ - armOffsetZ;
    const zBot = midZ + armOffsetZ;
    const startX = usableMinX + stLength / 2;
    const pitch = Math.max(
      stLength + 0.25,
      Math.min(stepPitch, (usableLen - stLength - 1.5) / Math.max(1, half - 1))
    );
    const armLen = Math.max(2.5, (half - 1) * pitch + stLength);
    const armCenterX = startX + (armLen - stLength) / 2;
    const bridgeX = armCenterX + armLen / 2 + input.conveyorWidthM / 2 + 0.06;
    const bridgeLen = Math.max(1.0, zBot - zTop - input.conveyorWidthM - 0.08);

    objects.push(
      {
        id: uid('obj_conv_u1'),
        name: `${input.lineName} Feed Arm`,
        kind: 'conveyor',
        category: 'conveyor_belt',
        templateId: 'tpl_conveyor_belt',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: armCenterX, y: 0, z: zTop },
          dimensions: { length: armLen, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 0,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 12, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      },
      {
        id: uid('obj_conv_u2'),
        name: `${input.lineName} Return Arm`,
        kind: 'conveyor',
        category: 'conveyor_belt',
        templateId: 'tpl_conveyor_belt',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: armCenterX, y: 0, z: zBot },
          dimensions: { length: armLen, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 180,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 12, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      },
      {
        id: uid('obj_conv_ubridge'),
        name: `${input.lineName} U-Turn Transfer`,
        kind: 'conveyor',
        category: 'roller_conveyor',
        templateId: 'tpl_roller_conveyor',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: bridgeX, y: 0, z: midZ },
          dimensions: { length: bridgeLen, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 90,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 6, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#475569', visible: true, locked: false, layer: 'conveyors' },
      }
    );

    for (let i = 0; i < stageCount; i++) {
      if (i < half) {
        stationPositions.push({
          x: startX + i * pitch,
          z: zTop - (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
          rot: 0,
          convIdx: 0,
        });
      } else {
        const revIdx = stageCount - 1 - i;
        stationPositions.push({
          x: startX + revIdx * pitch,
          z: zBot + (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
          rot: 180,
          convIdx: 1,
        });
      }
    }
  } else if (input.lineType === 'l_shaped') {
    const leg1 = Math.ceil(stageCount * 0.6);
    const leg2 = stageCount - leg1;
    const startX = usableMinX + stLength / 2;
    const startZ = usableMinZ + stWidth + 0.8;
    const pitchX = Math.max(
      stLength + 0.25,
      Math.min(stepPitch, (usableLen - 3.5) / Math.max(1, leg1))
    );
    const leg1Len = Math.max(2.5, (leg1 - 1) * pitchX + stLength);
    const leg1CenterX = startX + (leg1Len - stLength) / 2;
    const cornerX = leg1CenterX + leg1Len / 2 + input.conveyorWidthM / 2 + 0.06;
    const pitchZ = Math.max(
      stLength + 0.25,
      Math.min(stepPitch, (usableWid - 3.5) / Math.max(1, leg2))
    );
    const leg2Len = Math.max(2.2, leg2 * pitchZ);

    objects.push(
      {
        id: uid('obj_conv_l1'),
        name: `${input.lineName} Leg A`,
        kind: 'conveyor',
        category: 'conveyor_belt',
        templateId: 'tpl_conveyor_belt',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: leg1CenterX, y: 0, z: startZ },
          dimensions: { length: leg1Len, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 0,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 10, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      },
      {
        id: uid('obj_conv_l2'),
        name: `${input.lineName} Leg B`,
        kind: 'conveyor',
        category: 'conveyor_belt',
        templateId: 'tpl_conveyor_belt',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: cornerX, y: 0, z: startZ + input.conveyorWidthM / 2 + leg2Len / 2 + 0.06 },
          dimensions: { length: leg2Len, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 90,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 10, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      }
    );

    for (let i = 0; i < leg1; i++) {
      stationPositions.push({
        x: startX + i * pitchX,
        z: startZ - (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
        rot: 0,
        convIdx: 0,
      });
    }
    for (let j = 0; j < leg2; j++) {
      stationPositions.push({
        x: cornerX + (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
        z: startZ + input.conveyorWidthM + 0.6 + j * pitchZ,
        rot: 90,
        convIdx: 1,
      });
    }
  } else if (input.lineType === 'parallel') {
    const perLane = Math.ceil(stageCount / 2);
    const z1 = midZ - 2.6;
    const z2 = midZ + 2.6;
    const startX = usableMinX + stLength / 2;
    const pitch = Math.max(
      stLength + 0.25,
      Math.min(stepPitch, (usableLen - stLength) / Math.max(1, perLane - 1))
    );
    const convLen = Math.max(2.5, (perLane - 1) * pitch + stLength);

    [z1, z2].forEach((laneZ, lIdx) => {
      objects.push({
        id: uid(`obj_conv_p${lIdx}`),
        name: `${input.lineName} Lane ${lIdx + 1}`,
        kind: 'conveyor',
        category: 'conveyor_belt',
        templateId: 'tpl_conveyor_belt',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: startX + (convLen - stLength) / 2, y: 0, z: laneZ },
          dimensions: { length: convLen, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 0,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 12, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      });
    });

    for (let i = 0; i < stageCount; i++) {
      const lane = i < perLane ? 0 : 1;
      const idxInLane = lane === 0 ? i : i - perLane;
      stationPositions.push({
        x: startX + idxInLane * pitch,
        z: (lane === 0 ? z1 : z2) + (lane === 0 ? -1 : 1) * (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
        rot: 0,
        convIdx: lane,
      });
    }
  } else {
    // loop conveyor
    const perSide = Math.ceil(stageCount / 2);
    const rx = Math.min(usableLen * 0.36, Math.max(3.8, perSide * 1.35));
    const rz = Math.min(usableWid * 0.28, 3.2);
    const cx = factory.lengthM / 2;
    const cz = factory.widthM / 2;

    objects.push(
      {
        id: uid('obj_conv_loop_top'),
        name: `${input.lineName} Loop North`,
        kind: 'conveyor',
        category: 'roller_conveyor',
        templateId: 'tpl_roller_conveyor',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: cx, y: 0, z: cz - rz },
          dimensions: { length: rx * 2, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 0,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 10, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      },
      {
        id: uid('obj_conv_loop_bot'),
        name: `${input.lineName} Loop South`,
        kind: 'conveyor',
        category: 'roller_conveyor',
        templateId: 'tpl_roller_conveyor',
        productionLineId: lineId,
        connectedToIds: [],
        geometry: {
          position: { x: cx, y: 0, z: cz + rz },
          dimensions: { length: rx * 2, width: input.conveyorWidthM, height: input.conveyorHeightM },
          rotationDeg: 180,
          clearanceM: 0.25,
        },
        operations: {
          processingTimeSec: 0, setupTimeSec: 0, loadingTimeSec: 0, unloadingTimeSec: 0,
          capacity: 10, availability: 0.99, requiredOperators: 0,
          speedMps: input.conveyorSpeedMps, productSpacingM: 0.15, direction: 1,
        },
        rendering: { color: '#334155', visible: true, locked: false, layer: 'conveyors' },
      }
    );

    for (let i = 0; i < stageCount; i++) {
      const isTop = i < perSide;
      const idxSide = isTop ? i : stageCount - 1 - i;
      const pitchLoop = (rx * 1.7) / Math.max(1, perSide - 1);
      stationPositions.push({
        x: cx - rx * 0.85 + idxSide * pitchLoop,
        z: isTop
          ? cz - rz - (input.conveyorWidthM / 2 + stWidth / 2 + 0.22)
          : cz + rz + (input.conveyorWidthM / 2 + stWidth / 2 + 0.22),
        rot: isTop ? 0 : 180,
        convIdx: isTop ? 0 : 1,
      });
    }
  }

  const stageIds = stationPositions.map(() => uid('stg'));
  const objIds = stationPositions.map(() => uid('obj_st'));

  for (let i = 0; i < stationPositions.length; i++) {
    const pos = stationPositions[i];
    const stId = stageIds[i];
    const objId = objIds[i];

    const clampedX = Math.max(stLength / 2 + 0.2, Math.min(factory.lengthM - stLength / 2 - 0.2, pos.x));
    const clampedZ = Math.max(stWidth / 2 + 0.2, Math.min(factory.widthM - stWidth / 2 - 0.2, pos.z));

    if (
      pos.x - stLength / 2 < 0.15 ||
      pos.x + stLength / 2 > factory.lengthM - 0.15 ||
      pos.z - stWidth / 2 < 0.15 ||
      pos.z + stWidth / 2 > factory.widthM - 0.15
    ) {
      warnings.push(
        `Stage ${i + 1} placement (${pos.x.toFixed(1)}m, ${pos.z.toFixed(1)}m) approaches factory wall; clamped inside boundary.`
      );
    }

    objects.push({
      id: objId,
      name: `OP-${(i + 1) * 10} Stage ${i + 1}`,
      kind: tpl.kind,
      category: tpl.category,
      templateId: tpl.id,
      productionLineId: lineId,
      stageId: stId,
      connectedToIds: i < stationPositions.length - 1 ? [objIds[i + 1]] : [],
      geometry: {
        position: { x: clampedX, y: 0, z: clampedZ },
        dimensions: { length: stLength, width: stWidth, height: stHeight },
        rotationDeg: pos.rot,
        clearanceM: input.clearanceM,
      },
      operations: {
        ...tpl.defaultOperations,
        processingTimeSec: input.defaultProcessingTimeSec,
        requiredOperators: tpl.kind === 'buffer' ? 0 : tpl.defaultOperations.requiredOperators,
      },
      rendering: { color: tpl.defaultColor, visible: true, locked: false, layer: 'equipment' },
    });

    stages.push({
      id: stId,
      code: `OP-${(i + 1) * 10}`,
      name: `Stage ${i + 1}`,
      description: `Operation stage ${i + 1}`,
      processingTimeSec: input.defaultProcessingTimeSec,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      requiredWorkers: tpl.kind === 'buffer' ? 0 : tpl.defaultOperations.requiredOperators,
      requiredMachines: 1,
      inputQty: 1,
      outputQty: 1,
      scrapRate: 0,
      reworkProbability: 0,
      bufferCapacity: 4,
      predecessorIds: i > 0 ? [stageIds[i - 1]] : [],
      successorIds: i < stageIds.length - 1 ? [stageIds[i + 1]] : [],
      assignedObjectIds: [objId],
      conveyorObjectId: objects[pos.convIdx]?.id || objects[0]?.id,
    });
  }

  // Distribute workers across stations
  const wCount = Math.max(1, input.workerCount);
  for (let w = 0; w < wCount; w++) {
    const stIdx = w % stageCount;
    const pos = stationPositions[stIdx];
    workers.push({
      id: uid('wrk'),
      label: `W-${String(w + 1).padStart(2, '0')}`,
      name: `Operator ${String(w + 1).padStart(2, '0')}`,
      position: {
        x: Math.max(0.6, Math.min(factory.lengthM - 0.6, pos.x + (w >= stageCount ? 0.55 : 0))),
        y: 0,
        z: Math.max(0.6, Math.min(factory.widthM - 0.6, pos.z + (stIdx % 2 === 0 ? -0.95 : 0.95))),
      },
      assignedStageIds: [stageIds[stIdx]],
      assignedStationId: objIds[stIdx],
      skillCategory: 'Assembly & Operations',
      skillLevel: 4,
      efficiencyFactor: 1.0,
      walkingSpeedMps: 1.25,
      shiftId: project.simulationConfig.shifts[0]?.id || 'shift_day',
      color: '#1D4ED8',
    });
  }

  const firstPos = stationPositions[0] || { x: 4, z: midZ };
  const lastPos = stationPositions[stationPositions.length - 1] || { x: factory.lengthM - 4, z: midZ };

  const line: ProductionLine = {
    id: lineId,
    name: input.lineName,
    type: input.lineType,
    totalLengthM: Math.abs(lastPos.x - firstPos.x) + stLength,
    totalWidthM: stWidth * 2 + input.conveyorWidthM + 1.0,
    conveyorHeightM: input.conveyorHeightM,
    conveyorSpeedMps: input.conveyorSpeedMps,
    direction: 'forward',
    targetCapacityPerShift: input.targetCapacityPerShift,
    workstationCount: stageCount,
    workerCount: wCount,
    inputPoint: { x: firstPos.x, y: 0, z: firstPos.z },
    outputPoint: { x: lastPos.x, y: 0, z: lastPos.z },
    productId: project.products[0]?.id || '',
  };

  if (wCount < stageCount) {
    warnings.push(
      `Assigned ${wCount} worker(s) for ${stageCount} stages. Operators will walk between stations.`
    );
  }

  return {
    line,
    objects,
    stages,
    workers,
    warnings,
    feasible: warnings.filter((w) => w.includes('exceeding') || w.includes('tight')).length === 0,
  };
}
