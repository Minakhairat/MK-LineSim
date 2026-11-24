import { LayoutObject, ProductDefinition, ProjectData, ValidationIssue } from '../types/project';
import { validateSimulationCalendars } from '../simulation/resourceCalendar';
import { evaluateConveyorPhysics } from './conveyorPhysics';

/**
 * Shared Engineering Validation Engine.
 * Validates calendars (overlapping shifts/breaks, bounds, planned maintenance),
 * physical conveyor-to-product fit (length & width), and failure/capacity configs.
 */
export function runEngineeringValidations(project: ProjectData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { layoutObjects, products, simulationConfig, workers } = project;
  const activeObjects = layoutObjects.filter((o) => o.rendering.visible);
  const conveyors = activeObjects.filter((o) => o.kind === 'conveyor');

  // 1. Calendar validations: overlapping shifts, overlapping breaks, breaks outside shifts, maintenance windows, invalid resource/worker shift IDs
  const calValidation = validateSimulationCalendars(simulationConfig, layoutObjects, workers);

  for (const ov of calValidation.overlappingShifts) {
    issues.push({
      id: `val_shift_overlap_${ov.a.id}_${ov.b.id}`,
      severity: 'error',
      code: 'OVERLAPPING_SHIFTS',
      message: `Shifts "${ov.a.name}" and "${ov.b.name}" overlap by ${ov.overlapSec.toFixed(0)}s.`,
      messageAr: `تتداخل الورديتان "${ov.a.name}" و"${ov.b.name}" بمقدار ${ov.overlapSec.toFixed(0)} ثانية.`,
      recommendation: `Adjust shift start/duration boundaries so "${ov.a.name}" and "${ov.b.name}" do not overlap.`,
      recommendationAr: `اضبط بداية ومدة الورديتين "${ov.a.name}" و"${ov.b.name}" لمنع التداخل.`,
      resourceName: ov.a.name,
      targetId: ov.a.id,
      targetType: 'shift',
    });
  }

  for (const ob of calValidation.overlappingBreaks) {
    issues.push({
      id: `val_brk_overlap_${ob.a.id}_${ob.b.id}`,
      severity: 'error',
      code: 'OVERLAPPING_BREAKS',
      message: `Breaks "${ob.a.name}" and "${ob.b.name}" in shift "${ob.shift.name}" overlap by ${ob.overlapSec.toFixed(0)}s.`,
      messageAr: `تتداخل الاستراحتان "${ob.a.name}" و"${ob.b.name}" في الوردية "${ob.shift.name}" بمقدار ${ob.overlapSec.toFixed(0)} ثانية.`,
      recommendation: `Separate break intervals inside shift "${ob.shift.name}".`,
      recommendationAr: `افصل أوقات الاستراحة داخل الوردية "${ob.shift.name}".`,
      resourceName: ob.shift.name,
      targetId: ob.a.id,
      targetType: 'shift',
    });
  }

  for (const out of calValidation.breaksOutsideShift) {
    issues.push({
      id: `val_brk_bounds_${out.shift.id}_${out.brk.id}`,
      severity: 'warning',
      code: 'BREAK_OUTSIDE_SHIFT',
      message: `Break "${out.brk.name}" extends outside shift "${out.shift.name}" boundaries.`,
      messageAr: `الاستراحة "${out.brk.name}" تمتد خارج حدود الوردية "${out.shift.name}".`,
      recommendation: `Keep break "${out.brk.name}" inside [${out.shift.startSec}s, ${out.shift.startSec + out.shift.durationSec}s].`,
      recommendationAr: `اجعل الاستراحة "${out.brk.name}" ضمن حدود الوردية.`,
      resourceName: out.shift.name,
      targetId: out.brk.id,
      targetType: 'shift',
    });
  }

  for (const invMaint of calValidation.invalidMaintenanceWindows) {
    issues.push({
      id: `val_maint_${invMaint.win.id}`,
      severity: 'error',
      code: 'INVALID_MAINTENANCE_WINDOW',
      message: `Planned maintenance "${invMaint.win.name}"${invMaint.resourceName ? ` on "${invMaint.resourceName}"` : ''}: ${invMaint.reason}`,
      messageAr: `نافذة الصيانة المخططة "${invMaint.win.name}"${invMaint.resourceName ? ` للمعدة "${invMaint.resourceName}"` : ''} غير صالحة (زمن البداية أو المدة).`,
      recommendation: 'Set start time >= 0 and duration > 0 seconds.',
      recommendationAr: 'اضبط زمن البداية ليكون >= 0 والمدة أكبر من صفر.',
      resourceName: invMaint.resourceName || invMaint.win.name,
      targetId: invMaint.targetId || invMaint.win.id,
      targetType: invMaint.targetId ? 'object' : 'shift',
    });
  }

  for (const outMaint of calValidation.maintenanceOutsideHorizon) {
    issues.push({
      id: `val_maint_horizon_${outMaint.targetId || 'global'}_${outMaint.win.id}`,
      severity: outMaint.kind === 'outside' ? 'error' : 'warning',
      code: outMaint.kind === 'outside' ? 'MAINTENANCE_OUTSIDE_HORIZON' : 'MAINTENANCE_PARTIALLY_CLIPPED',
      message:
        outMaint.kind === 'outside'
          ? `Planned maintenance "${outMaint.win.name}" (${outMaint.win.startSec}s) starts at or after simulation horizon (${outMaint.horizonSec}s).`
          : `Planned maintenance "${outMaint.win.name}" extends past simulation horizon (${outMaint.horizonSec}s) and will be clipped.`,
      messageAr:
        outMaint.kind === 'outside'
          ? `نافذة الصيانة المخططة "${outMaint.win.name}" (${outMaint.win.startSec}ث) تقع خارج أفق المحاكاة (${outMaint.horizonSec}ث).`
          : `نافذة الصيانة المخططة "${outMaint.win.name}" تتجاوز أفق المحاكاة (${outMaint.horizonSec}ث) وسيتم قصها عند نهاية المحاكاة.`,
      recommendation: `Adjust maintenance window "${outMaint.win.name}" to occur within [0, ${outMaint.horizonSec}s] or extend simulation duration.`,
      recommendationAr: `عدّل نافذة الصيانة "${outMaint.win.name}" لتقع ضمن [0, ${outMaint.horizonSec}ث] أو زد مدة المحاكاة.`,
      resourceName: outMaint.resourceName || outMaint.win.name,
      targetId: outMaint.targetId || outMaint.win.id,
      targetType: outMaint.targetId ? 'object' : 'shift',
    });
  }

  for (const ovMaint of calValidation.overlappingMaintenanceWindows) {
    issues.push({
      id: `val_maint_overlap_${ovMaint.targetId || 'global'}_${ovMaint.a.id}_${ovMaint.b.id}`,
      severity: 'warning',
      code: 'OVERLAPPING_MAINTENANCE_WINDOWS',
      message: `Planned maintenance windows "${ovMaint.a.name}" and "${ovMaint.b.name}"${ovMaint.resourceName ? ` on "${ovMaint.resourceName}"` : ''} overlap by ${ovMaint.overlapSec.toFixed(0)}s (merged union will be used).`,
      messageAr: `تتداخل نافذتا الصيانة "${ovMaint.a.name}" و"${ovMaint.b.name}"${ovMaint.resourceName ? ` للمعدة "${ovMaint.resourceName}"` : ''} بمقدار ${ovMaint.overlapSec.toFixed(0)} ثانية (سيتم دمجهما دون ازدواجية).`,
      recommendation: 'Adjust or consolidate overlapping maintenance intervals.',
      recommendationAr: 'عدّل أو ادمج فترات الصيانة المتداخلة لتجنب التكرار.',
      resourceName: ovMaint.resourceName || ovMaint.a.name,
      targetId: ovMaint.targetId || ovMaint.a.id,
      targetType: ovMaint.targetId ? 'object' : 'shift',
    });
  }

  for (const invObjShift of calValidation.invalidObjectShifts) {
    issues.push({
      id: `val_obj_shift_${invObjShift.obj.id}`,
      severity: 'error',
      code: 'INVALID_RESOURCE_SHIFT',
      message: `Equipment "${invObjShift.obj.name}" references non-existent shift "${invObjShift.missingRef}". Resource will remain unavailable unless assigned to a valid shift or plant default.`,
      messageAr: `المعدة "${invObjShift.obj.name}" تشير إلى وردية غير موجودة "${invObjShift.missingRef}". ستبقى المعدة غير متاحة حتى يتم ربطها بوردية صالحة أو تركها على افتراضي المصنع.`,
      recommendation: `Assign "${invObjShift.obj.name}" to an existing shift ID or clear its shift assignment to follow plant-wide shifts.`,
      recommendationAr: `اربط "${invObjShift.obj.name}" بوردية موجودة أو اترك الحقل فارغاً لاتباع ورديات المصنع.`,
      resourceName: invObjShift.obj.name,
      targetId: invObjShift.obj.id,
      targetType: 'object',
    });
  }

  for (const invWrkShift of calValidation.invalidWorkerShifts) {
    issues.push({
      id: `val_wrk_shift_${invWrkShift.worker.id}`,
      severity: 'error',
      code: 'INVALID_WORKER_SHIFT',
      message: `Worker "${invWrkShift.worker.name}" references non-existent shift "${invWrkShift.missingRef}".`,
      messageAr: `العامل "${invWrkShift.worker.name}" مرتبط بوردية غير موجودة "${invWrkShift.missingRef}".`,
      recommendation: `Reassign worker "${invWrkShift.worker.name}" to an existing shift in Simulation Config.`,
      recommendationAr: `أعد تعيين العامل "${invWrkShift.worker.name}" إلى وردية صالحة.`,
      resourceName: invWrkShift.worker.name,
      targetId: invWrkShift.worker.id,
      targetType: 'worker',
    });
  }

  // 2. Conveyor physical fit (length & width) against products
  for (const conv of conveyors) {
    for (const prod of products) {
      const fit = evaluateConveyorPhysics(conv, prod);
      if (!fit.canFit) {
        issues.push({
          id: `val_conv_fit_${conv.id}_${prod.id}`,
          severity: 'error',
          code: 'CONVEYOR_PRODUCT_FIT_ERROR',
          message:
            fit.fitErrorMessage ||
            `Product "${prod.name}" does not physically fit on conveyor "${conv.name}".`,
          messageAr:
            fit.fitErrorCode === 'LENGTH_EXCEEDS_BELT'
              ? `طول المنتج "${prod.name}" (${fit.productLengthM.toFixed(2)}م) يتجاوز طول السير "${conv.name}" (${fit.beltLengthM.toFixed(2)}م).`
              : fit.fitErrorCode === 'WIDTH_EXCEEDS_BELT'
              ? `عرض المنتج "${prod.name}" (${fit.productWidthM.toFixed(2)}م) يتجاوز عرض السير "${conv.name}" (${fit.beltWidthM.toFixed(2)}م).`
              : `معاملات السير أو المنتج على "${conv.name}" غير صالحة فيزيائياً.`,
          recommendation: `Widen or lengthen conveyor "${conv.name}" or adjust product "${prod.name}" dimensions.`,
          recommendationAr: `قم بزيادة عرض أو طول السير "${conv.name}" أو تعديل أبعاد المنتج "${prod.name}".`,
          resourceName: conv.name,
          targetId: conv.id,
          targetType: 'object',
        });
      }
    }
  }

  // 3. Failure model & capacity sanity checks
  for (const obj of activeObjects) {
    const avail = obj.operations.availability;
    if (!Number.isFinite(avail) || avail < 0 || avail > 1) {
      issues.push({
        id: `val_avail_${obj.id}`,
        severity: 'error',
        code: 'INVALID_AVAILABILITY',
        message: `${obj.name} availability (${avail}) must be between 0 and 1.`,
        messageAr: `نسبة توفر "${obj.name}" يجب أن تكون بين 0 و 1.`,
        resourceName: obj.name,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      obj.operations.weibullShape !== undefined &&
      (!Number.isFinite(obj.operations.weibullShape) || obj.operations.weibullShape <= 0)
    ) {
      issues.push({
        id: `val_weibull_${obj.id}`,
        severity: 'error',
        code: 'INVALID_FAILURE_MODEL',
        message: `${obj.name} Weibull shape parameter must be > 0.`,
        messageAr: `معامل شكل Weibull للمعدة "${obj.name}" يجب أن يكون أكبر من 0.`,
        resourceName: obj.name,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      obj.operations.mtbfSec !== undefined &&
      (!Number.isFinite(obj.operations.mtbfSec) || obj.operations.mtbfSec < 0)
    ) {
      issues.push({
        id: `val_mtbf_${obj.id}`,
        severity: 'error',
        code: 'INVALID_FAILURE_MODEL',
        message: `${obj.name} MTBF cannot be negative or invalid.`,
        messageAr: `متوسط الزمن بين الأعطال MTBF للمعدة "${obj.name}" لا يمكن أن يكون سالباً.`,
        resourceName: obj.name,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      obj.operations.mttrSec !== undefined &&
      (!Number.isFinite(obj.operations.mttrSec) || obj.operations.mttrSec < 0)
    ) {
      issues.push({
        id: `val_mttr_${obj.id}`,
        severity: 'error',
        code: 'INVALID_REPAIR_MODEL',
        message: `${obj.name} MTTR cannot be negative or invalid.`,
        messageAr: `متوسط زمن الإصلاح MTTR للمعدة "${obj.name}" لا يمكن أن يكون سالباً.`,
        resourceName: obj.name,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      simulationConfig.enableBreakdowns &&
      (obj.kind === 'machine' || obj.kind === 'workstation') &&
      Number.isFinite(avail) &&
      avail >= 0 &&
      avail < 0.9999 &&
      obj.operations.mtbfSec !== undefined &&
      obj.operations.mtbfSec > 0 &&
      obj.operations.mttrSec !== undefined &&
      obj.operations.mttrSec > 0
    ) {
      const inherentAvail =
        obj.operations.mtbfSec / (obj.operations.mtbfSec + obj.operations.mttrSec);
      if (Math.abs(avail - inherentAvail) > 0.02) {
        issues.push({
          id: `val_rel_conflict_${obj.id}`,
          severity: 'warning',
          code: 'CONFLICTING_RELIABILITY_PARAMS',
          message: `${obj.name} availability (${(avail * 100).toFixed(1)}%) conflicts with MTBF/(MTBF+MTTR) = ${(inherentAvail * 100).toFixed(1)}%; simulation uses ${(inherentAvail * 100).toFixed(1)}%.`,
          messageAr: `نسبة توفر "${obj.name}" (${(avail * 100).toFixed(1)}%) تتعارض مع التوفر المحسوب من MTBF/MTTR (${(inherentAvail * 100).toFixed(1)}%)؛ ستعتمد المحاكاة التوفر المشتق.`,
          recommendation: `Align availability to ${(inherentAvail * 100).toFixed(2)}% or update MTBF/MTTR values consistently.`,
          recommendationAr: `وافق قيمة التوفر مع ${(inherentAvail * 100).toFixed(2)}% أو حدّث قيم MTBF و MTTR.`,
          resourceName: obj.name,
          targetId: obj.id,
          targetType: 'object',
        });
      }
    }
    if (obj.operations.repairModel === 'lognormal') {
      const meanMttr = obj.operations.mttrSec ?? 0;
      const stdMttr = obj.operations.mttrStdDevSec;
      if (simulationConfig.enableBreakdowns && (!Number.isFinite(meanMttr) || meanMttr <= 0)) {
        issues.push({
          id: `val_mttr_lognorm_${obj.id}`,
          severity: 'error',
          code: 'INVALID_REPAIR_MODEL',
          message: `${obj.name} uses lognormal repair distribution so MTTR mean must be > 0.`,
          messageAr: `المعدة "${obj.name}" تستخدم توزيع Lognormal للإصلاح لذا يجب أن يكون متوسط MTTR أكبر من 0.`,
          recommendation: 'Set Mean MTTR > 0s for lognormal repair distribution.',
          recommendationAr: 'اضبط متوسط MTTR أكبر من صفر لتوزيع Lognormal.',
          resourceName: obj.name,
          targetId: obj.id,
          targetType: 'object',
        });
      }
      if (stdMttr !== undefined && (!Number.isFinite(stdMttr) || stdMttr < 0)) {
        issues.push({
          id: `val_mttr_std_${obj.id}`,
          severity: 'error',
          code: 'INVALID_REPAIR_MODEL',
          message: `${obj.name} repair standard deviation cannot be negative.`,
          messageAr: `الانحراف المعياري لزمن الإصلاح للمعدة "${obj.name}" لا يمكن أن يكون سالباً.`,
          recommendation: 'Set repair time standard deviation >= 0s.',
          recommendationAr: 'اضبط الانحراف المعياري لزمن الإصلاح >= 0 ثانية.',
          resourceName: obj.name,
          targetId: obj.id,
          targetType: 'object',
        });
      }
    }
  }

  return issues;
}

/**
 * Helper to check if a single conveyor fits a product cleanly.
 */
export function checkConveyorProductFit(conv: LayoutObject, prod?: ProductDefinition) {
  return evaluateConveyorPhysics(conv, prod);
}
