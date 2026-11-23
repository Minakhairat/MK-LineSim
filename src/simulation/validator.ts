import { ProjectData, ValidationIssue } from '../types/project';
import { doOrientedBoxesOverlap, getRotatedBounds } from '../utils/units';
import { runEngineeringValidations } from '../engineering/validationEngine';

function isFinitePositive(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isFiniteNonNeg(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function isPositiveInteger(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

function isNonNegInteger(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

export function validateProject(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { factory, layoutObjects, stages, workers, products, simulationConfig } = project;

  // 1. Factory dimensions
  if (
    !isFinitePositive(factory.lengthM) ||
    !isFinitePositive(factory.widthM) ||
    !isFinitePositive(factory.heightM)
  ) {
    issues.push({
      id: 'val_factory_dims',
      severity: 'error',
      code: 'INVALID_FACTORY_DIMENSIONS',
      message: 'Factory length, width, and height must all be finite numbers greater than 0.',
      messageAr: 'يجب أن يكون طول المصنع وعرضه وارتفاعه أرقاماً صالحة أكبر من صفر.',
      targetType: 'factory',
    });
  }

  const allObjectIds = new Set(layoutObjects.map((o) => o.id));
  const activeObjects = layoutObjects.filter((o) => o.rendering.visible);

  // 2. Layout object boundaries, dimensions & operational checks
  for (const obj of activeObjects) {
    const { length, width, height } = obj.geometry.dimensions;
    const { x, y, z } = obj.geometry.position;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(obj.geometry.rotationDeg)
    ) {
      issues.push({
        id: `val_pos_${obj.id}`,
        severity: 'error',
        code: 'INVALID_OBJECT_TRANSFORM',
        message: `${obj.name} has invalid (NaN/Infinite) coordinates or rotation.`,
        messageAr: `إحداثيات أو زاوية دوران "${obj.name}" غير صالحة.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (!isFinitePositive(length) || !isFinitePositive(width) || !isFinitePositive(height)) {
      issues.push({
        id: `val_dim_${obj.id}`,
        severity: 'error',
        code: 'INVALID_DIMENSIONS',
        message: `${obj.name} has non-positive or invalid dimensions.`,
        messageAr: `أبعاد "${obj.name}" غير صالحة (يجب أن تكون أكبر من صفر).`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (Number.isFinite(height) && Number.isFinite(factory.heightM) && height > factory.heightM) {
      issues.push({
        id: `val_height_${obj.id}`,
        severity: 'warning',
        code: 'EXCEEDS_CEILING_HEIGHT',
        message: `${obj.name} height (${height.toFixed(2)}m) exceeds building height (${factory.heightM.toFixed(2)}m).`,
        messageAr: `ارتفاع "${obj.name}" (${height.toFixed(2)}م) يتجاوز ارتفاع المبنى (${factory.heightM.toFixed(2)}م).`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (
      Number.isFinite(x) &&
      Number.isFinite(z) &&
      isFinitePositive(length) &&
      isFinitePositive(width) &&
      Number.isFinite(obj.geometry.rotationDeg) &&
      isFinitePositive(factory.lengthM) &&
      isFinitePositive(factory.widthM)
    ) {
      const bounds = getRotatedBounds(x, z, length, width, obj.geometry.rotationDeg);
      if (
        bounds.minX < -0.02 ||
        bounds.maxX > factory.lengthM + 0.02 ||
        bounds.minZ < -0.02 ||
        bounds.maxZ > factory.widthM + 0.02
      ) {
        issues.push({
          id: `val_oob_${obj.id}`,
          severity: 'error',
          code: 'OUT_OF_FACTORY_BOUNDS',
          message: `${obj.name} extends outside the ${factory.lengthM}m × ${factory.widthM}m factory perimeter.`,
          messageAr: `"${obj.name}" يمتد خارج حدود المصنع (${factory.lengthM}م × ${factory.widthM}م).`,
          targetId: obj.id,
          targetType: 'object',
        });
      }
    }

    if (
      !isFiniteNonNeg(obj.operations.processingTimeSec) ||
      !isFiniteNonNeg(obj.operations.setupTimeSec) ||
      !isFiniteNonNeg(obj.operations.loadingTimeSec) ||
      !isFiniteNonNeg(obj.operations.unloadingTimeSec) ||
      (obj.operations.batchTransferTimeSec !== undefined &&
        !isFiniteNonNeg(obj.operations.batchTransferTimeSec))
    ) {
      issues.push({
        id: `val_negtime_${obj.id}`,
        severity: 'error',
        code: 'NEGATIVE_TIME',
        message: `${obj.name} has negative or invalid operation timing parameters.`,
        messageAr: `"${obj.name}" يحتوي على أزمنة تشغيل أو تجهيز غير صالحة.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (obj.operations.batchSize !== undefined && !isPositiveInteger(obj.operations.batchSize)) {
      issues.push({
        id: `val_obj_batch_${obj.id}`,
        severity: 'error',
        code: 'INVALID_BATCH_SIZE',
        message: `${obj.name} batch size must be an integer >= 1.`,
        messageAr: `حجم الدفعة لـ "${obj.name}" يجب أن يكون عدداً صحيحاً 1 على الأقل.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (
      obj.operations.requiredOperators !== undefined &&
      !isNonNegInteger(obj.operations.requiredOperators)
    ) {
      issues.push({
        id: `val_obj_ops_${obj.id}`,
        severity: 'error',
        code: 'INVALID_RESOURCE_REQUIREMENT',
        message: `${obj.name} required operators must be an integer >= 0.`,
        messageAr: `عدد العمال المطلوب لـ "${obj.name}" يجب أن يكون عدداً صحيحاً >= 0.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (
      obj.kind === 'conveyor' &&
      (!isFinitePositive(obj.operations.speedMps) ||
        (obj.operations.productSpacingM !== undefined && !isFiniteNonNeg(obj.operations.productSpacingM)))
    ) {
      issues.push({
        id: `val_convspeed_${obj.id}`,
        severity: 'error',
        code: 'INVALID_CONVEYOR_SPEED',
        message: `${obj.name} must have conveyor speed > 0 m/s and non-negative spacing.`,
        messageAr: `يجب أن تكون سرعة السير "${obj.name}" أكبر من 0 م/ث وتباعد غير سالب.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (obj.kind === 'buffer' && !isPositiveInteger(obj.operations.capacity)) {
      issues.push({
        id: `val_bufcap_${obj.id}`,
        severity: 'error',
        code: 'BUFFER_CAPACITY_VIOLATION',
        message: `${obj.name} buffer capacity must be an integer >= 1.`,
        messageAr: `سعة التخزين المؤقت لـ "${obj.name}" يجب أن تكون عدداً صحيحاً 1 على الأقل.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (
      (obj.kind === 'machine' || obj.kind === 'workstation') &&
      !isPositiveInteger(obj.operations.capacity)
    ) {
      issues.push({
        id: `val_cap_${obj.id}`,
        severity: 'error',
        code: 'INVALID_MACHINE_CAPACITY',
        message: `${obj.name} processing capacity must be an integer >= 1.`,
        messageAr: `السعة التشغيلية للمحطة "${obj.name}" يجب أن تكون عدداً صحيحاً 1 على الأقل.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
  }

  // 3. Pairwise physical OBB SAT collision check (ignore intentional conveyor junctions & vehicles)
  for (let i = 0; i < activeObjects.length; i++) {
    for (let j = i + 1; j < activeObjects.length; j++) {
      const a = activeObjects[i];
      const b = activeObjects[j];
      if (a.kind === 'conveyor' && b.kind === 'conveyor') continue;
      if (a.kind === 'vehicle' || b.kind === 'vehicle') continue;

      if (
        doOrientedBoxesOverlap(
          {
            cx: a.geometry.position.x,
            cz: a.geometry.position.z,
            length: a.geometry.dimensions.length,
            width: a.geometry.dimensions.width,
            rotationDeg: a.geometry.rotationDeg,
          },
          {
            cx: b.geometry.position.x,
            cz: b.geometry.position.z,
            length: b.geometry.dimensions.length,
            width: b.geometry.dimensions.width,
            rotationDeg: b.geometry.rotationDeg,
          },
          0.08
        )
      ) {
        issues.push({
          id: `val_col_${a.id}_${b.id}`,
          severity: 'warning',
          code: 'EQUIPMENT_COLLISION',
          message: `Physical overlap detected between "${a.name}" and "${b.name}".`,
          messageAr: `يوجد تداخل في المساحة بين "${a.name}" و"${b.name}".`,
          targetId: a.id,
          targetType: 'object',
        });
      }
    }
  }

  // 4. Stages & Routing checks
  if (stages.length === 0) {
    issues.push({
      id: 'val_no_stages',
      severity: 'error',
      code: 'NO_PRODUCTION_STAGES',
      message: 'No production stages linked yet. Click "Auto-Wire Line" to connect conveyors/stations.',
      messageAr: 'لا توجد مراحل إنتاج مربوطة بعد. اضغط "ربط تلقائي للمحاكاة" لتوصيل السير والمحطات.',
      targetType: 'stage',
    });
  }

  const stageIds = new Set(stages.map((s) => s.id));
  for (const stage of stages) {
    if (
      !isFiniteNonNeg(stage.processingTimeSec) ||
      !isFiniteNonNeg(stage.setupTimeSec) ||
      !isFiniteNonNeg(stage.loadingTimeSec) ||
      !isFiniteNonNeg(stage.unloadingTimeSec) ||
      (stage.batchTransferTimeSec !== undefined && !isFiniteNonNeg(stage.batchTransferTimeSec))
    ) {
      issues.push({
        id: `val_stg_time_${stage.id}`,
        severity: 'error',
        code: 'NEGATIVE_STAGE_TIME',
        message: `Stage "${stage.name}" has negative or invalid timing values.`,
        messageAr: `المرحلة "${stage.name}" تحتوي على أزمنة تشغيل غير صالحة.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (!isNonNegInteger(stage.bufferCapacity)) {
      issues.push({
        id: `val_stg_buf_${stage.id}`,
        severity: 'error',
        code: 'INVALID_BUFFER_CAPACITY',
        message: `Stage "${stage.name}" buffer capacity must be an integer >= 0.`,
        messageAr: `سعة المخزن المؤقت للمرحلة "${stage.name}" يجب أن تكون عدداً صحيحاً >= 0.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (!isNonNegInteger(stage.requiredWorkers) || !isNonNegInteger(stage.requiredMachines)) {
      issues.push({
        id: `val_stg_req_${stage.id}`,
        severity: 'error',
        code: 'INVALID_RESOURCE_REQUIREMENT',
        message: `Stage "${stage.name}" worker and machine requirements must be integers >= 0.`,
        messageAr: `متطلبات العمال والآلات للمرحلة "${stage.name}" يجب أن تكون أعداداً صحيحة >= 0.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (stage.batchSize !== undefined && !isPositiveInteger(stage.batchSize)) {
      issues.push({
        id: `val_stg_batch_${stage.id}`,
        severity: 'error',
        code: 'INVALID_BATCH_SIZE',
        message: `Stage "${stage.name}" batch size must be an integer >= 1.`,
        messageAr: `حجم الدفعة للمرحلة "${stage.name}" يجب أن يكون عدداً صحيحاً 1 على الأقل.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    const scrap = Number(stage.scrapRate);
    const rework = Number(stage.reworkProbability);
    if (
      !Number.isFinite(scrap) ||
      !Number.isFinite(rework) ||
      scrap < 0 ||
      scrap > 1 ||
      rework < 0 ||
      rework > 1 ||
      scrap + rework > 1 + 1e-9
    ) {
      issues.push({
        id: `val_stg_qual_${stage.id}`,
        severity: 'error',
        code: 'INVALID_QUALITY_RATES',
        message: `Stage "${stage.name}" scrap + rework rates must be in [0, 1] and sum to <= 1.`,
        messageAr: `نسب الهالك وإعادة التشغيل في "${stage.name}" يجب أن تكون بين 0 و 1 وألا يتجاوز مجموعهما 1.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (stage.assignedObjectIds.length === 0) {
      issues.push({
        id: `val_stg_obj_${stage.id}`,
        severity: 'error',
        code: 'MISSING_STATION_MACHINE',
        message: `Stage "${stage.name}" has no assigned workstation or conveyor on the floor.`,
        messageAr: `المرحلة "${stage.name}" غير مربوطة بأي محطة أو سير على أرضية المصنع.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    } else if (stage.assignedObjectIds.some((oid) => !allObjectIds.has(oid))) {
      issues.push({
        id: `val_stg_missing_obj_${stage.id}`,
        severity: 'error',
        code: 'BROKEN_OBJECT_REFERENCE',
        message: `Stage "${stage.name}" references a deleted or missing floor object.`,
        messageAr: `المرحلة "${stage.name}" تشير إلى معدة غير موجودة على أرضية المصنع.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (stage.conveyorObjectId && !allObjectIds.has(stage.conveyorObjectId)) {
      issues.push({
        id: `val_stg_missing_conv_${stage.id}`,
        severity: 'error',
        code: 'BROKEN_OBJECT_REFERENCE',
        message: `Stage "${stage.name}" links to a non-existent conveyor.`,
        messageAr: `المرحلة "${stage.name}" تشير إلى سير نقل غير موجود.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    const eligibleWorkers = workers.filter(
      (w) =>
        w.assignedStageIds.includes(stage.id) ||
        stage.assignedObjectIds.includes(w.assignedTo || w.assignedStationId || '')
    );
    if (stage.requiredWorkers > 0 && eligibleWorkers.length < stage.requiredWorkers) {
      issues.push({
        id: `val_stg_wrk_${stage.id}`,
        severity: 'warning',
        code: 'INSUFFICIENT_WORKERS',
        message: `Stage "${stage.name}" requires ${stage.requiredWorkers} worker(s), but ${eligibleWorkers.length} assigned.`,
        messageAr: `المرحلة "${stage.name}" تتطلب ${stage.requiredWorkers} عامل، لكن المعين حالياً ${eligibleWorkers.length}.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }

    for (const succ of stage.successorIds) {
      if (!stageIds.has(succ)) {
        issues.push({
          id: `val_stg_succ_${stage.id}_${succ}`,
          severity: 'error',
          code: 'BROKEN_STAGE_LINK',
          message: `Stage "${stage.name}" points to a missing successor stage.`,
          messageAr: `المرحلة "${stage.name}" تشير إلى مرحلة تالية غير موجودة.`,
          targetId: stage.id,
          targetType: 'stage',
        });
      }
    }
  }

  // 5. Products & routes
  if (products.length === 0) {
    issues.push({
      id: 'val_no_products',
      severity: 'error',
      code: 'NO_PRODUCTS',
      message: 'Define at least one product with a valid production route.',
      messageAr: 'أضف منتجاً واحداً على الأقل مع مسار إنتاج صالح.',
      targetType: 'product',
    });
  } else {
    for (const prod of products) {
      if (prod.routingMode === 'manual' && (!prod.entryStageIds || prod.entryStageIds.length === 0)) {
        issues.push({
          id: `val_prod_entry_${prod.id}`,
          severity: 'error',
          code: 'MISSING_FLOWCHART_ENTRY',
          message: `Product "${prod.name}" has no entry stage connected from Start in the Flowchart.`,
          messageAr: `المنتج "${prod.name}" غير موصل بأي مرحلة بداية في مخطط التدفق (Flowchart).`,
          targetId: prod.id,
          targetType: 'product',
        });
      } else if (prod.routeStageIds.length === 0) {
        issues.push({
          id: `val_prod_route_${prod.id}`,
          severity: 'error',
          code: 'MISSING_PRODUCTION_ROUTE',
          message: `Product "${prod.name}" has an empty routing sequence.`,
          messageAr: `المنتج "${prod.name}" ليس له مسار مراحل إنتاج محدد.`,
          targetId: prod.id,
          targetType: 'product',
        });
      }
      if (
        prod.routeStageIds.some((sid) => !stageIds.has(sid)) ||
        (prod.entryStageIds && prod.entryStageIds.some((sid) => !stageIds.has(sid)))
      ) {
        issues.push({
          id: `val_prod_badroute_${prod.id}`,
          severity: 'error',
          code: 'BROKEN_ROUTE_REFERENCE',
          message: `Product "${prod.name}" references a non-existent production stage in its route.`,
          messageAr: `المنتج "${prod.name}" يشير إلى مرحلة غير موجودة في مسار إنتاجه.`,
          targetId: prod.id,
          targetType: 'product',
        });
      }
      if (
        !isFinitePositive(prod.dimensions.length) ||
        !isFinitePositive(prod.dimensions.width) ||
        !isFinitePositive(prod.dimensions.height)
      ) {
        issues.push({
          id: `val_prod_dim_${prod.id}`,
          severity: 'error',
          code: 'INVALID_PRODUCT_DIMENSIONS',
          message: `Product "${prod.name}" dimensions must be finite positive numbers.`,
          messageAr: `أبعاد المنتج "${prod.name}" يجب أن تكون أرقاماً موجبة صالحة.`,
          targetId: prod.id,
          targetType: 'product',
        });
      }
      if (
        !isNonNegInteger(prod.targetQuantity) ||
        (prod.cycleTimeMultiplier !== undefined && !isFinitePositive(prod.cycleTimeMultiplier)) ||
        (prod.mixWeight !== undefined && !isFiniteNonNeg(prod.mixWeight))
      ) {
        issues.push({
          id: `val_prod_qty_${prod.id}`,
          severity: 'error',
          code: 'INVALID_PRODUCT_PARAMETERS',
          message: `Product "${prod.name}" target quantity must be an integer >= 0, with valid mix weight and cycle multiplier.`,
          messageAr: `الكمية المستهدفة أو معامل الدورة للمنتج "${prod.name}" غير صالحة.`,
          targetId: prod.id,
          targetType: 'product',
        });
      }
    }
  }

  // 5b. Workers validation
  for (const w of workers) {
    if (
      !Number.isFinite(w.position.x) ||
      !Number.isFinite(w.position.z) ||
      !isFinitePositive(w.walkingSpeedMps) ||
      !isFinitePositive(w.efficiencyFactor)
    ) {
      issues.push({
        id: `val_wrk_param_${w.id}`,
        severity: 'error',
        code: 'INVALID_WORKER_PARAMETERS',
        message: `Worker "${w.name}" has invalid coordinates, walking speed, or efficiency factor.`,
        messageAr: `بيانات العامل "${w.name}" (الموقع أو سرعة المشي أو الكفاءة) غير صالحة.`,
        targetId: w.id,
        targetType: 'worker',
      });
    }
  }

  // 6. Shift & Simulation timing config
  if (!isFinitePositive(simulationConfig.durationSec)) {
    issues.push({
      id: 'val_sim_dur',
      severity: 'error',
      code: 'INVALID_SHIFT_DURATION',
      message: 'Simulation duration must be a finite number greater than 0 seconds.',
      messageAr: 'مدة المحاكاة يجب أن تكون أكبر من صفر ثانية.',
      targetType: 'shift',
    });
  }
  if (!isFinitePositive(simulationConfig.arrivalIntervalSec)) {
    issues.push({
      id: 'val_sim_arrival',
      severity: 'error',
      code: 'INVALID_ARRIVAL_INTERVAL',
      message: 'Arrival interval must be a finite number greater than 0 seconds.',
      messageAr: 'زمن وصول الوحدات يجب أن يكون أكبر من صفر ثانية.',
      targetType: 'shift',
    });
  }
  if (!isNonNegInteger(simulationConfig.maxPlannedUnits)) {
    issues.push({
      id: 'val_sim_planned',
      severity: 'error',
      code: 'INVALID_PLANNED_UNITS',
      message: 'Planned production units must be an integer >= 0.',
      messageAr: 'كمية الإنتاج المخططة يجب أن تكون عدداً صحيحاً >= 0.',
      targetType: 'shift',
    });
  }
  for (const shift of simulationConfig.shifts) {
    if (!isFiniteNonNeg(shift.startSec) || !isFinitePositive(shift.durationSec)) {
      issues.push({
        id: `val_shift_${shift.id}`,
        severity: 'error',
        code: 'INVALID_SHIFT_CONFIG',
        message: `Shift "${shift.name}" must have start >= 0 and duration > 0.`,
        messageAr: `الوردية "${shift.name}" يجب أن يكون وقت بدايتها >= 0 ومدتها أكبر من صفر.`,
        targetType: 'shift',
      });
    }
    for (const brk of shift.breaks) {
      if (!isFiniteNonNeg(brk.durationSec) || !isFiniteNonNeg(brk.startSec)) {
        issues.push({
          id: `val_brk_${brk.id}`,
          severity: 'error',
          code: 'INVALID_BREAK_CONFIG',
          message: `Break "${brk.name}" has negative or invalid start/duration.`,
          messageAr: `الاستراحة "${brk.name}" لها توقيت أو مدة غير صالحة.`,
          targetType: 'shift',
        });
      }
    }
  }

  // 7. Shared engineering checks (shift/break overlaps, maintenance, conveyor fit, failure models)
  issues.push(...runEngineeringValidations(project));

  return issues;
}
