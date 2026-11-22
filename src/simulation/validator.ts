import { ProjectData, ValidationIssue } from '../types/project';
import { getRotatedBounds } from '../utils/units';
import { runEngineeringValidations } from '../engineering/validationEngine';

export function validateProject(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { factory, layoutObjects, stages, workers, products, simulationConfig } = project;

  // 1. Factory dimensions
  if (factory.lengthM <= 0 || factory.widthM <= 0 || factory.heightM <= 0) {
    issues.push({
      id: 'val_factory_dims',
      severity: 'error',
      code: 'INVALID_FACTORY_DIMENSIONS',
      message: 'Factory length, width, and height must all be greater than 0.',
      messageAr: 'يجب أن يكون طول المصنع وعرضه وارتفاعه أكبر من صفر.',
      targetType: 'factory',
    });
  }

  // 2. Layout object boundaries, dimensions & operational checks
  const activeObjects = layoutObjects.filter((o) => o.rendering.visible);
  for (const obj of activeObjects) {
    const { length, width, height } = obj.geometry.dimensions;
    if (length <= 0 || width <= 0 || height <= 0) {
      issues.push({
        id: `val_dim_${obj.id}`,
        severity: 'error',
        code: 'INVALID_DIMENSIONS',
        message: `${obj.name} has non-positive dimensions.`,
        messageAr: `أبعاد "${obj.name}" غير صالحة (يجب أن تكون أكبر من صفر).`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (height > factory.heightM) {
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

    const bounds = getRotatedBounds(
      obj.geometry.position.x,
      obj.geometry.position.z,
      length,
      width,
      obj.geometry.rotationDeg
    );

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

    if (obj.operations.processingTimeSec < 0 || obj.operations.setupTimeSec < 0) {
      issues.push({
        id: `val_negtime_${obj.id}`,
        severity: 'error',
        code: 'NEGATIVE_TIME',
        message: `${obj.name} has negative processing or setup time.`,
        messageAr: `"${obj.name}" يحتوي على زمن تشغيل أو تجهيز سالب.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (obj.kind === 'conveyor' && (!obj.operations.speedMps || obj.operations.speedMps <= 0)) {
      issues.push({
        id: `val_convspeed_${obj.id}`,
        severity: 'error',
        code: 'INVALID_CONVEYOR_SPEED',
        message: `${obj.name} must have conveyor speed > 0 m/s.`,
        messageAr: `يجب أن تكون سرعة السير "${obj.name}" أكبر من 0 م/ث.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }

    if (obj.kind === 'buffer' && obj.operations.capacity <= 0) {
      issues.push({
        id: `val_bufcap_${obj.id}`,
        severity: 'error',
        code: 'BUFFER_CAPACITY_VIOLATION',
        message: `${obj.name} buffer capacity must be at least 1.`,
        messageAr: `سعة التخزين المؤقت لـ "${obj.name}" يجب أن تكون 1 على الأقل.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
  }

  // 3. Pairwise physical collision check (ignore intentional conveyor junctions & vehicles)
  for (let i = 0; i < activeObjects.length; i++) {
    for (let j = i + 1; j < activeObjects.length; j++) {
      const a = activeObjects[i];
      const b = activeObjects[j];
      if (a.kind === 'conveyor' && b.kind === 'conveyor') continue;
      if (a.kind === 'vehicle' || b.kind === 'vehicle') continue;

      const ba = getRotatedBounds(
        a.geometry.position.x,
        a.geometry.position.z,
        a.geometry.dimensions.length,
        a.geometry.dimensions.width,
        a.geometry.rotationDeg
      );
      const bb = getRotatedBounds(
        b.geometry.position.x,
        b.geometry.position.z,
        b.geometry.dimensions.length,
        b.geometry.dimensions.width,
        b.geometry.rotationDeg
      );
      const overlapX = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
      const overlapZ = Math.min(ba.maxZ, bb.maxZ) - Math.max(ba.minZ, bb.minZ);
      if (overlapX > 0.08 && overlapZ > 0.08) {
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
    if (stage.processingTimeSec < 0) {
      issues.push({
        id: `val_stg_time_${stage.id}`,
        severity: 'error',
        code: 'NEGATIVE_STAGE_TIME',
        message: `Stage "${stage.name}" has negative processing time.`,
        messageAr: `المرحلة "${stage.name}" تحتوي على زمن تشغيل سالب.`,
        targetId: stage.id,
        targetType: 'stage',
      });
    }
    if (stage.bufferCapacity < 0) {
      issues.push({
        id: `val_stg_buf_${stage.id}`,
        severity: 'error',
        code: 'INVALID_BUFFER_CAPACITY',
        message: `Stage "${stage.name}" cannot have negative buffer capacity.`,
        messageAr: `سعة المخزن المؤقت للمرحلة "${stage.name}" لا يمكن أن تكون سالبة.`,
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
      if (prod.dimensions.length <= 0 || prod.dimensions.width <= 0 || prod.dimensions.height <= 0) {
        issues.push({
          id: `val_prod_dim_${prod.id}`,
          severity: 'error',
          code: 'INVALID_PRODUCT_DIMENSIONS',
          message: `Product "${prod.name}" dimensions must be positive.`,
          messageAr: `أبعاد المنتج "${prod.name}" يجب أن تكون موجبة.`,
          targetId: prod.id,
          targetType: 'product',
        });
      }
    }
  }

  // 6. Shift config
  if (simulationConfig.durationSec <= 0) {
    issues.push({
      id: 'val_sim_dur',
      severity: 'error',
      code: 'INVALID_SHIFT_DURATION',
      message: 'Simulation duration must be greater than 0 seconds.',
      messageAr: 'مدة المحاكاة يجب أن تكون أكبر من صفر ثانية.',
      targetType: 'shift',
    });
  }
  for (const shift of simulationConfig.shifts) {
    if (shift.durationSec <= 0) {
      issues.push({
        id: `val_shift_${shift.id}`,
        severity: 'error',
        code: 'INVALID_SHIFT_CONFIG',
        message: `Shift "${shift.name}" must have duration > 0.`,
        messageAr: `الوردية "${shift.name}" يجب أن تكون مدتها أكبر من صفر.`,
        targetType: 'shift',
      });
    }
    for (const brk of shift.breaks) {
      if (brk.durationSec < 0 || brk.startSec < 0) {
        issues.push({
          id: `val_brk_${brk.id}`,
          severity: 'error',
          code: 'INVALID_BREAK_CONFIG',
          message: `Break "${brk.name}" has negative start or duration.`,
          messageAr: `الاستراحة "${brk.name}" لها توقيت أو مدة سالبة.`,
          targetType: 'shift',
        });
      }
    }
  }

  // 7. Shared engineering checks (shift/break overlaps, maintenance, conveyor fit, failure models)
  issues.push(...runEngineeringValidations(project));

  return issues;
}
