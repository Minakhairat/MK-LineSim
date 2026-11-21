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
  const { layoutObjects, products, simulationConfig } = project;
  const activeObjects = layoutObjects.filter((o) => o.rendering.visible);
  const conveyors = activeObjects.filter((o) => o.kind === 'conveyor');

  // 1. Calendar validations: overlapping shifts, overlapping breaks, breaks outside shifts, maintenance windows
  const calValidation = validateSimulationCalendars(simulationConfig);

  for (const ov of calValidation.overlappingShifts) {
    issues.push({
      id: `val_shift_overlap_${ov.a.id}_${ov.b.id}`,
      severity: 'error',
      code: 'OVERLAPPING_SHIFTS',
      message: `Shifts "${ov.a.name}" and "${ov.b.name}" overlap by ${ov.overlapSec.toFixed(0)}s.`,
      messageAr: `تتداخل الورديتان "${ov.a.name}" و"${ov.b.name}" بمقدار ${ov.overlapSec.toFixed(0)} ثانية.`,
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
      targetId: out.brk.id,
      targetType: 'shift',
    });
  }

  for (const invMaint of calValidation.invalidMaintenanceWindows) {
    issues.push({
      id: `val_maint_${invMaint.win.id}`,
      severity: 'error',
      code: 'INVALID_MAINTENANCE_WINDOW',
      message: `Planned maintenance "${invMaint.win.name}": ${invMaint.reason}`,
      messageAr: `نافذة الصيانة المخططة "${invMaint.win.name}" غير صالحة (زمن البداية أو المدة).`,
      targetId: invMaint.win.id,
      targetType: 'shift',
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
              : `عرض المنتج "${prod.name}" (${fit.productWidthM.toFixed(2)}م) يتجاوز عرض السير "${conv.name}" (${fit.beltWidthM.toFixed(2)}م).`,
          targetId: conv.id,
          targetType: 'object',
        });
      }
    }
  }

  // 3. Failure model & capacity sanity checks
  for (const obj of activeObjects) {
    if (obj.operations.availability < 0 || obj.operations.availability > 1) {
      issues.push({
        id: `val_avail_${obj.id}`,
        severity: 'error',
        code: 'INVALID_AVAILABILITY',
        message: `${obj.name} availability (${obj.operations.availability}) must be between 0 and 1.`,
        messageAr: `نسبة توفر "${obj.name}" يجب أن تكون بين 0 و 1.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      obj.operations.weibullShape !== undefined &&
      obj.operations.weibullShape <= 0
    ) {
      issues.push({
        id: `val_weibull_${obj.id}`,
        severity: 'error',
        code: 'INVALID_FAILURE_MODEL',
        message: `${obj.name} Weibull shape parameter must be > 0.`,
        messageAr: `معامل شكل Weibull للمعدة "${obj.name}" يجب أن يكون أكبر من 0.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    if (
      simulationConfig.enableBreakdowns &&
      obj.operations.mtbfSec !== undefined &&
      obj.operations.mtbfSec < 0
    ) {
      issues.push({
        id: `val_mtbf_${obj.id}`,
        severity: 'error',
        code: 'INVALID_FAILURE_MODEL',
        message: `${obj.name} MTBF cannot be negative.`,
        messageAr: `متوسط الزمن بين الأعطال MTBF للمعدة "${obj.name}" لا يمكن أن يكون سالباً.`,
        targetId: obj.id,
        targetType: 'object',
      });
    }
    for (const mw of obj.operations.plannedMaintenance || []) {
      if (mw.startSec < 0 || mw.durationSec <= 0) {
        issues.push({
          id: `val_obj_maint_${obj.id}_${mw.id}`,
          severity: 'error',
          code: 'INVALID_MAINTENANCE_WINDOW',
          message: `${obj.name} maintenance window "${mw.name}" must have start >= 0 and duration > 0.`,
          messageAr: `نافذة صيانة "${obj.name}" (${mw.name}) غير صالحة.`,
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
