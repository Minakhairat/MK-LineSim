import {
  BenchmarkCaseResult,
  BenchmarkMetricComparison,
  BenchmarkSuiteSummary,
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
} from '../types/project';
import { DiscreteEventSimulationEngine } from './desEngine';
import { validateProject } from './validator';
import { evaluateConveyorPhysics } from '../engineering/conveyorPhysics';
import { computeStageCapacityProfile } from '../engineering/capacityEngine';
import { createSeededRng, sampleRepairDurationSec } from './failureModels';

function createBenchmarkBaseProject(
  id: string,
  name: string,
  opts: {
    durationSec: number;
    arrivalIntervalSec: number;
    maxPlannedUnits?: number;
    enableBreakdowns?: boolean;
    randomSeed?: number;
    productDims?: { length: number; width: number; height: number };
  }
): ProjectData {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    schemaVersion: '1.0.0',
    id,
    name,
    factoryName: 'Benchmark Plant',
    industryType: 'Validation',
    description: name,
    createdAt: now,
    updatedAt: now,
    factory: {
      name: 'Benchmark Floor',
      lengthM: 60,
      widthM: 30,
      heightM: 8,
      unit: 'm',
      gridSizeM: 1,
      snapToGrid: true,
      columns: [],
      openings: [],
      zones: [],
    },
    productionLines: [],
    layoutObjects: [],
    products: [
      {
        id: 'prod_bm',
        code: 'BM-01',
        name: 'Benchmark Unit',
        category: 'Benchmark',
        dimensions: opts.productDims ?? { length: 0.5, width: 0.4, height: 0.4 },
        weightKg: 5,
        color: '#2563EB',
        targetQuantity: opts.maxPlannedUnits ?? 0,
        routeStageIds: [],
        modelShape: 'box',
        routingMode: 'auto',
      },
    ],
    stages: [],
    routes: [],
    workers: [],
    simulationConfig: {
      durationSec: opts.durationSec,
      arrivalIntervalSec: opts.arrivalIntervalSec,
      maxPlannedUnits: opts.maxPlannedUnits ?? 0,
      speedMultiplier: 100,
      enableBreakdowns: opts.enableBreakdowns ?? false,
      randomSeed: opts.randomSeed ?? 4219,
      shifts: [
        {
          id: 'shift_1',
          name: 'Main Shift',
          startSec: 0,
          durationSec: opts.durationSec,
          breaks: [],
        },
      ],
      maintenanceWindows: [],
    },
    scenarios: [],
  };
}

function makeStationObj(
  id: string,
  stageId: string,
  name: string,
  x: number,
  procSec: number,
  opts?: Partial<LayoutObject['operations']> & { kind?: LayoutObject['kind']; dims?: { length: number; width: number; height: number } }
): LayoutObject {
  const kind = opts?.kind ?? 'workstation';
  return {
    id,
    name,
    kind,
    category: kind === 'conveyor' ? 'conveyor_belt' : 'workstation',
    templateId: kind === 'conveyor' ? 'tpl_conveyor_belt' : 'tpl_workstation',
    stageId,
    connectedToIds: [],
    geometry: {
      position: { x, y: 0, z: 10 },
      dimensions: opts?.dims ?? { length: 2, width: 1.4, height: 1.0 },
      rotationDeg: 0,
      clearanceM: 0.3,
    },
    operations: {
      processingTimeSec: procSec,
      setupTimeSec: opts?.setupTimeSec ?? 0,
      loadingTimeSec: opts?.loadingTimeSec ?? 0,
      unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
      capacity: opts?.capacity ?? 1,
      availability: opts?.availability ?? 1.0,
      requiredOperators: opts?.requiredOperators ?? 0,
      speedMps: opts?.speedMps,
      productSpacingM: opts?.productSpacingM,
      mtbfSec: opts?.mtbfSec,
      mttrSec: opts?.mttrSec,
      failureModel: opts?.failureModel,
      repairModel: opts?.repairModel,
      shiftId: opts?.shiftId,
      runDuringBreaks: opts?.runDuringBreaks,
      plannedMaintenance: opts?.plannedMaintenance,
      batchSize: opts?.batchSize,
      batchMode: opts?.batchMode,
    },
    rendering: {
      color: '#334155',
      visible: true,
      locked: false,
      layer: kind === 'conveyor' ? 'conveyors' : 'equipment',
    },
  };
}

function makeStage(
  id: string,
  code: string,
  name: string,
  objId: string,
  procSec: number,
  opts?: Partial<ProductionStage>
): ProductionStage {
  return {
    id,
    code,
    name,
    description: name,
    processingTimeSec: procSec,
    setupTimeSec: opts?.setupTimeSec ?? 0,
    loadingTimeSec: opts?.loadingTimeSec ?? 0,
    unloadingTimeSec: opts?.unloadingTimeSec ?? 0,
    requiredWorkers: opts?.requiredWorkers ?? 0,
    requiredMachines: opts?.requiredMachines ?? 1,
    inputQty: 1,
    outputQty: 1,
    scrapRate: opts?.scrapRate ?? 0,
    reworkProbability: opts?.reworkProbability ?? 0,
    bufferCapacity: opts?.bufferCapacity ?? 25,
    predecessorIds: opts?.predecessorIds ?? [],
    successorIds: opts?.successorIds ?? [],
    assignedObjectIds: opts?.assignedObjectIds ?? [objId],
    batchSize: opts?.batchSize,
    batchMode: opts?.batchMode,
  };
}

function compareMetric(
  metric: string,
  metricAr: string,
  unit: string,
  expected: number,
  actual: number,
  toleranceAbs: number,
  tolerancePct?: number
): BenchmarkMetricComparison {
  const absError = Math.abs(actual - expected);
  const pctError =
    Math.abs(expected) > 1e-9
      ? (absError / Math.abs(expected)) * 100
      : absError > 1e-9
      ? 100
      : 0;
  const passedAbs = absError <= toleranceAbs + 1e-9;
  const passedPct = tolerancePct !== undefined ? pctError <= tolerancePct + 1e-9 : true;
  return {
    metric,
    metricAr,
    unit,
    expected: Number(expected.toFixed(4)),
    actual: Number(actual.toFixed(4)),
    absError: Number(absError.toFixed(4)),
    pctError: Number(pctError.toFixed(2)),
    toleranceAbs,
    tolerancePct,
    passed: passedAbs && passedPct,
  };
}

function runTimedCase(
  meta: {
    id: string;
    name: string;
    nameAr: string;
    category: string;
    categoryAr: string;
    description: string;
    descriptionAr: string;
    verificationTier?: 'des' | 'math';
    engineeringConcept?: string;
    engineeringConceptAr?: string;
    inputSummary?: string;
    inputSummaryAr?: string;
    explanation?: string;
    explanationAr?: string;
  },
  fn: () => { metrics: BenchmarkMetricComparison[]; failureReason?: string }
): BenchmarkCaseResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const { metrics, failureReason } = fn();
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const passed = !failureReason && metrics.every((m) => m.passed);
    return {
      verificationTier: 'des',
      ...meta,
      passed,
      executionMs: Number(Math.max(0.01, t1 - t0).toFixed(2)),
      metrics,
      failureReason:
        failureReason ||
        (!passed
          ? `Failed metric(s): ${metrics
              .filter((m) => !m.passed)
              .map((m) => `${m.metric} (exp=${m.expected}, act=${m.actual})`)
              .join(', ')}`
          : undefined),
    };
  } catch (err) {
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      ...meta,
      passed: false,
      executionMs: Number(Math.max(0.01, t1 - t0).toFixed(2)),
      metrics: [],
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function runAllEngineeringBenchmarks(): BenchmarkSuiteSummary {
  const suiteStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const results: BenchmarkCaseResult[] = [];

  // 1. Single Workstation Steady-State Throughput
  results.push(
    runTimedCase(
      {
        id: 'bm_01_single_workstation',
        name: '01. Single Workstation Deterministic Cycle',
        nameAr: '01. محطة عمل منفردة بزمن دورة ثابت',
        category: 'Core DES',
        categoryAr: 'محاكاة أساسية',
        description: '1 workstation (30s proc, 30s arrival, 3600s) must produce 120 units at 100% util and 30s lead time.',
        descriptionAr: 'محطة واحدة بزمن تشغيل 30ث وفاصل دخول 30ث خلال 3600ث يجب أن تنتج 120 وحدة باستغلال 100%.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm1', 'Single Workstation', {
          durationSec: 3600,
          arrivalIntervalSec: 30,
        });
        proj.layoutObjects.push(makeStationObj('obj_1', 'st_1', 'Station 1', 5, 30));
        proj.stages.push(makeStage('st_1', 'S1', 'Station 1', 'obj_1', 30));
        proj.products[0].routeStageIds = ['st_1'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        return {
          metrics: [
            compareMetric('Good Units', 'الوحدات السليمة', 'units', 120, res.kpis.goodUnits, 0),
            compareMetric('Throughput', 'الإنتاجية', 'u/hr', 120, res.kpis.throughputPerHour, 0.5),
            compareMetric('Avg Lead Time', 'متوسط زمن التسليم', 's', 30, res.kpis.avgLeadTimeSec, 0.1),
            compareMetric('Utilization', 'نسبة الاستغلال', '%', 100, res.kpis.machineUtilizationPct, 0.5),
            compareMetric('OEE', 'مؤشر OEE', '%', 100, res.kpis.oeePct ?? 0, 0.5),
          ],
        };
      }
    )
  );

  // 2. Three Serial Stations With Bottleneck
  results.push(
    runTimedCase(
      {
        id: 'bm_02_three_serial',
        name: '02. Three Serial Stations & Bottleneck',
        nameAr: '02. ثلاث محطات متسلسلة وتحديد الاختناق',
        category: 'Flow Dynamics',
        categoryAr: 'ديناميكا التدفق',
        description: 'Serial stations [20s, 40s, 25s] over 3600s: Stage 2 (40s) governs throughput (~88 units completed).',
        descriptionAr: 'ثلاث محطات متسلسلة [20، 40، 25 ث]: المرحلة الثانية (40ث) تقود الاختناق بإنتاج 88 وحدة.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm2', 'Three Serial Stations', {
          durationSec: 3600,
          arrivalIntervalSec: 20,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'St 1 (20s)', 5, 20),
          makeStationObj('obj_2', 'st_2', 'St 2 (40s)', 12, 40),
          makeStationObj('obj_3', 'st_3', 'St 3 (25s)', 19, 25)
        );
        proj.stages.push(
          makeStage('st_1', 'S1', 'Stage 1', 'obj_1', 20, { bufferCapacity: 200, successorIds: ['st_2'] }),
          makeStage('st_2', 'S2', 'Stage 2', 'obj_2', 40, { bufferCapacity: 200, predecessorIds: ['st_1'], successorIds: ['st_3'] }),
          makeStage('st_3', 'S3', 'Stage 3', 'obj_3', 25, { bufferCapacity: 200, predecessorIds: ['st_2'] })
        );
        proj.products[0].routeStageIds = ['st_1', 'st_2', 'st_3'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const st2 = res.stageAnalytics.find((s) => s.stageId === 'st_2');
        return {
          metrics: [
            compareMetric('Good Units (incl. 85s warmup)', 'الوحدات السليمة', 'units', 88, res.kpis.goodUnits, 1),
            compareMetric('Bottleneck Stage Match (Stage 2)', 'تطابق مرحلة الاختناق', 'bool', 1, res.kpis.bottleneckStageId === 'st_2' ? 1 : 0, 0),
            compareMetric('Stage 2 Utilization', 'استغلال المرحلة 2', '%', 99.4, st2?.utilizationPct ?? 0, 1.5),
          ],
        };
      }
    )
  );

  // 3. Parallel Machines
  results.push(
    runTimedCase(
      {
        id: 'bm_03_parallel_machines',
        name: '03. Parallel Machine Capacity (2 Servers)',
        nameAr: '03. ماكينات متوازية (سعة 2 وحدة)',
        category: 'Capacity Math',
        categoryAr: 'حساب السعة',
        description: 'Stage with capacity=2 and 60s cycle matches 30s arrival stream with 0s queue wait.',
        descriptionAr: 'محطة بسعة تشغيل متزامن 2 وزمن دورة 60ث تواكب دخولاً كل 30ث دون أي طوابير انتظار.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm3', 'Parallel Capacity', {
          durationSec: 3600,
          arrivalIntervalSec: 30,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'Twin Cell', 6, 60, { capacity: 2 })
        );
        proj.stages.push(makeStage('st_1', 'S1', 'Twin Cell Stage', 'obj_1', 60));
        proj.products[0].routeStageIds = ['st_1'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const sa = res.stageAnalytics[0];
        return {
          metrics: [
            compareMetric('Good Units', 'الوحدات السليمة', 'units', 119, res.kpis.goodUnits, 1),
            compareMetric('Avg Wait Time', 'متوسط زمن الانتظار', 's', 0, sa?.avgWaitTimeSec ?? 99, 0.1),
            compareMetric('Effective Unit Cycle', 'زمن الوحدة الفعلي', 's', 30, sa?.effectiveTheoreticalUnitCycleSec ?? 0, 0.1),
          ],
        };
      }
    )
  );

  // 4. Batch Production (Pallet / Carton Collection)
  results.push(
    runTimedCase(
      {
        id: 'bm_04_batch_production',
        name: '04. Batch Palletizing Collection (×4)',
        nameAr: '04. تجميع الباليتات بالدفعات (4 قطع)',
        category: 'Batching',
        categoryAr: 'التشغيل المجمع',
        description: 'Stage collects 4 units/pallet and processes batch in 40s (effective unit cycle = 10s).',
        descriptionAr: 'تجميع 4 وحدات لكل باليتة وتشغيلها في 40ث (متوسط زمن الوحدة النظري 10ث).',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm4', 'Batch Production', {
          durationSec: 3600,
          arrivalIntervalSec: 15,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'Palletizer', 6, 40, {
            batchSize: 4,
            batchMode: 'collect_batch',
          })
        );
        proj.stages.push(
          makeStage('st_1', 'S1', 'Palletizer', 'obj_1', 40, {
            batchSize: 4,
            batchMode: 'collect_batch',
            bufferCapacity: 20,
          })
        );
        proj.products[0].routeStageIds = ['st_1'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const sa = res.stageAnalytics[0];
        return {
          metrics: [
            compareMetric('Batches Completed', 'الدفعات المكتملة', 'batches', 59, sa?.batchesCompleted ?? 0, 1),
            compareMetric('Good Units', 'الوحدات السليمة', 'units', 236, res.kpis.goodUnits, 4),
            compareMetric('Avg Batch Size', 'متوسط حجم الدفعة', 'u/batch', 4, res.kpis.avgBatchSize ?? 0, 0.1),
            compareMetric('Effective Unit Cycle', 'زمن الوحدة الفعلي', 's', 10, sa?.effectiveTheoreticalUnitCycleSec ?? 0, 0.1),
          ],
        };
      }
    )
  );

  // 5. Multi-Shift With Off-Shift Gap
  results.push(
    runTimedCase(
      {
        id: 'bm_05_multi_shift',
        name: '05. Multi-Shift Calendar & Off-Shift Gap',
        nameAr: '05. تعدد الورديات والفجوات الزمنية',
        category: 'Calendars',
        categoryAr: 'تقاويم الموارد',
        description: 'Two 3600s shifts separated by 3600s off-shift gap inside 10800s horizon.',
        descriptionAr: 'ورديتان كل منهما 3600ث بينهما فترة توقف 3600ث داخل أفق 10800ث.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm5', 'Multi-Shift', {
          durationSec: 10800,
          arrivalIntervalSec: 60,
        });
        proj.simulationConfig.shifts = [
          { id: 'sh_1', name: 'Morning', startSec: 0, durationSec: 3600, breaks: [] },
          { id: 'sh_2', name: 'Evening', startSec: 7200, durationSec: 3600, breaks: [] },
        ];
        proj.layoutObjects.push(makeStationObj('obj_1', 'st_1', 'Cell 1', 5, 60));
        proj.stages.push(makeStage('st_1', 'S1', 'Cell 1', 'obj_1', 60));
        proj.products[0].routeStageIds = ['st_1'];

        const eng = new DiscreteEventSimulationEngine(proj);
        const res = eng.runToCompletion();
        const midGapCompletes = eng
          .getAllEvents()
          .filter((e) => e.type === 'ProductCompleted' && e.timestamp > 3660 && e.timestamp < 7200).length;

        return {
          metrics: [
            compareMetric('Calendar Time', 'الوقت التقويمي', 's', 10800, res.kpis.calendarTimeSec ?? 0, 0.1),
            compareMetric('Scheduled Production Time', 'وقت الإنتاج المجدول', 's', 7200, res.kpis.scheduledProductionTimeSec ?? 0, 0.1),
            compareMetric('Planned Downtime', 'التوقف المخطط', 's', 3600, res.kpis.plannedDowntimeSec ?? 0, 0.1),
            compareMetric('Good Units Produced', 'الوحدات المنتجة', 'units', 120, res.kpis.goodUnits, 2),
            compareMetric('Completions Inside Off-Shift Gap', 'إنتاج أثناء توقف الوردية', 'units', 0, midGapCompletes, 0),
          ],
        };
      }
    )
  );

  // 6. Worker Breaks vs. Automatic Machine Running During Breaks
  results.push(
    runTimedCase(
      {
        id: 'bm_06_worker_breaks',
        name: '06. Worker Break vs. Automatic Equipment',
        nameAr: '06. استراحة العامل مقابل الماكينة الأوتوماتيكية',
        category: 'Calendars',
        categoryAr: 'تقاويم الموارد',
        description: 'Manual worker stops for 600s break while automatic downstream machine (runDuringBreaks=true) keeps running.',
        descriptionAr: 'توقف العامل للاستراحة 600ث بينما تستمر الماكينة الأوتوماتيكية في التشغيل.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm6', 'Worker Break Isolation', {
          durationSec: 3600,
          arrivalIntervalSec: 15,
        });
        proj.simulationConfig.shifts = [
          {
            id: 'sh_1',
            name: 'Day',
            startSec: 0,
            durationSec: 3600,
            breaks: [{ id: 'b1', name: 'Tea Break', startSec: 1800, durationSec: 600 }],
          },
        ];
        const manualObj = makeStationObj('obj_man', 'st_man', 'Manual Bench', 4, 15, {
          requiredOperators: 1,
          runDuringBreaks: false,
        });
        const autoObj = makeStationObj('obj_auto', 'st_auto', 'Auto Oven', 12, 25, {
          requiredOperators: 0,
          runDuringBreaks: true,
        });
        proj.layoutObjects.push(manualObj, autoObj);
        proj.stages.push(
          makeStage('st_man', 'S1', 'Manual', 'obj_man', 15, {
            requiredWorkers: 1,
            bufferCapacity: 100,
            successorIds: ['st_auto'],
          }),
          makeStage('st_auto', 'S2', 'Automatic', 'obj_auto', 25, {
            requiredWorkers: 0,
            bufferCapacity: 100,
            predecessorIds: ['st_man'],
          })
        );
        proj.workers.push({
          id: 'w_1',
          label: 'OP-1',
          name: 'Operator 1',
          position: { x: 4, y: 0, z: 11.2 },
          assignedStageIds: ['st_man'],
          assignedStationId: 'obj_man',
          skillCategory: 'Assembly',
          skillLevel: 3,
          efficiencyFactor: 1,
          walkingSpeedMps: 1.25,
          shiftId: 'sh_1',
          color: '#2563EB',
        });
        proj.products[0].routeStageIds = ['st_man', 'st_auto'];

        const eng = new DiscreteEventSimulationEngine(proj);
        const res = eng.runToCompletion();
        const snap = eng.getSnapshot();
        const workerBreakSec = snap.workers['w_1']?.breakTimeSec ?? 0;
        const autoCompletedDuringBreak = eng
          .getAllEvents()
          .filter(
            (e) =>
              e.type === 'ProcessingCompleted' &&
              e.objectId === 'obj_auto' &&
              e.timestamp > 1800 &&
              e.timestamp <= 2400
          ).length;
        const manualCompleted = res.stageAnalytics.find((s) => s.stageId === 'st_man')?.completedCount ?? 0;

        return {
          metrics: [
            compareMetric('Worker Break Time', 'زمن استراحة العامل', 's', 600, workerBreakSec, 20),
            compareMetric('Manual Units (3000s net)', 'إنتاج المحطة اليدوية', 'units', 200, manualCompleted, 2),
            compareMetric('Auto Units Completed During Break', 'إنتاج الماكينة الآلية وقت الراحة', 'units', 24, autoCompletedDuringBreak, 1),
          ],
        };
      }
    )
  );

  // 7. Fixed Failure & Repair Preemption + Time Conservation
  results.push(
    runTimedCase(
      {
        id: 'bm_07_machine_breakdown',
        name: '07. Breakdown Preemption & Time Conservation',
        nameAr: '07. الأعطال واستئناف التشغيل وحفظ الأزمنة',
        category: 'Reliability',
        categoryAr: 'الاعتمادية والأعطال',
        description: 'Fixed failure MTBF=900s, MTTR=100s over 3000s yields 300s unplanned downtime and exact state sum=3000s.',
        descriptionAr: 'عطل دوري كل 900ث بزمن إصلاح 100ث خلال 3000ث يحقق 300ث توقف وتطابق مجموع الحالات = 3000ث.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm7', 'Deterministic Failure', {
          durationSec: 3000,
          arrivalIntervalSec: 30,
          enableBreakdowns: true,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'Press', 5, 30, {
            failureModel: 'fixed',
            mtbfSec: 900,
            repairModel: 'fixed',
            mttrSec: 100,
            availability: 0.9,
          })
        );
        proj.stages.push(makeStage('st_1', 'S1', 'Press', 'obj_1', 30, { bufferCapacity: 100 }));
        proj.products[0].routeStageIds = ['st_1'];

        const eng = new DiscreteEventSimulationEngine(proj);
        const res = eng.runToCompletion();
        const stState = eng.getSnapshot().objects['obj_1'];
        const stateSum =
          (stState?.runningTimeSec ?? 0) +
          (stState?.idleTimeSec ?? 0) +
          (stState?.blockedTimeSec ?? 0) +
          (stState?.starvedTimeSec ?? 0) +
          (stState?.setupTimeSec ?? 0) +
          (stState?.downTimeSec ?? 0) +
          (stState?.maintenanceTimeSec ?? 0) +
          (stState?.unavailableTimeSec ?? 0);

        return {
          metrics: [
            compareMetric('Unplanned Downtime', 'التوقف غير المخطط', 's', 300, res.kpis.unplannedDowntimeSec ?? 0, 1),
            compareMetric('Availability', 'نسبة التوفر', '%', 90, res.kpis.availabilityPct ?? 0, 0.2),
            compareMetric('State Sum Conservation', 'تطابق مجموع أزمنة الحالات', 's', 3000, stateSum, 0.01),
            compareMetric('Good Units (2700s/30s)', 'الوحدات المنتجة', 'units', 90, res.kpis.goodUnits, 1),
          ],
        };
      }
    )
  );

  // 8. Conveyor Capacity, Headway & Dimensional Rejection
  results.push(
    runTimedCase(
      {
        id: 'bm_08_conveyor_capacity',
        name: '08. Conveyor Capacity, Headway & Fit Guard',
        nameAr: '08. سعة السير الناقل وفحص أبعاد المنتج',
        category: 'Conveyor Physics',
        categoryAr: 'فيزياء السيور',
        description: 'Validates capacity = 5 on 5m×0.6m belt with 0.8m×0.4m product & 0.2m gap, and rejects oversized products.',
        descriptionAr: 'حساب السعة الفعلية 5 وحدات على سير 5م وفحص رفض المنتجات الأكبر من طول أو عرض السير.',
      },
      () => {
        const conv = makeStationObj('conv_1', 'st_1', 'Main Belt', 6, 0, {
          kind: 'conveyor',
          dims: { length: 5, width: 0.6, height: 0.8 },
          speedMps: 0.5,
          productSpacingM: 0.2,
          capacity: 0,
        });
        const fitProd: ProductDefinition = {
          id: 'p_fit',
          code: 'FIT',
          name: 'Standard Box',
          category: 'Test',
          dimensions: { length: 0.8, width: 0.4, height: 0.3 },
          weightKg: 4,
          color: '#2563EB',
          targetQuantity: 0,
          routeStageIds: ['st_1'],
          modelShape: 'box',
        };
        const mFit = evaluateConveyorPhysics(conv, fitProd);

        const projBad = createBenchmarkBaseProject('bm8', 'Oversized Conveyor Fit', {
          durationSec: 600,
          arrivalIntervalSec: 10,
          productDims: { length: 0.8, width: 0.9, height: 0.3 },
        });
        projBad.layoutObjects.push(conv);
        projBad.stages.push(makeStage('st_1', 'S1', 'Belt Stage', 'conv_1', 0));
        projBad.products[0].routeStageIds = ['st_1'];
        const mBad = evaluateConveyorPhysics(conv, projBad.products[0]);
        const issues = validateProject(projBad);
        const hasFitError = issues.some((i) => i.code === 'CONVEYOR_PRODUCT_FIT_ERROR');

        return {
          metrics: [
            compareMetric('Physical Capacity', 'السعة الفعلية للسير', 'units', 5, mFit.physicalCapacity, 0),
            compareMetric('Traversal Time', 'زمن العبور', 's', 10, mFit.traversalTimeSec, 0.01),
            compareMetric('Min Headway', 'الفاصل الزمني الأدنى', 's', 2, mFit.minHeadwaySec, 0.01),
            compareMetric('Oversized Product Rejected (cap=0)', 'رفض المنتج الزائد عن العرض', 'units', 0, mBad.physicalCapacity, 0),
            compareMetric('Validator Emits CONVEYOR_PRODUCT_FIT_ERROR', 'تحذير التجاوز الهندسي', 'bool', 1, hasFitError ? 1 : 0, 0),
          ],
        };
      }
    )
  );

  // 9. Zero-Buffer Blocking Propagation
  results.push(
    runTimedCase(
      {
        id: 'bm_09_zero_buffer_line',
        name: '09. Zero-Buffer Blocking Propagation',
        nameAr: '09. انتشار الحجب في خطوط بدون مخازن وسيطة',
        category: 'Blocking',
        categoryAr: 'اختناق وحجب',
        description: '3 serial stations [30s, 60s, 30s] with bufferCapacity=0 forces blocking backpressure on Stage 1.',
        descriptionAr: 'خط [30، 60، 30 ث] بسعة تخزين صفرية يجب أن يسبب حجباً واضحاً للمرحلة الأولى.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm9', 'Zero Buffer Blocking', {
          durationSec: 3600,
          arrivalIntervalSec: 30,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'St 1', 4, 30),
          makeStationObj('obj_2', 'st_2', 'St 2 (Slow)', 9, 60),
          makeStationObj('obj_3', 'st_3', 'St 3', 14, 30)
        );
        proj.stages.push(
          makeStage('st_1', 'S1', 'Stage 1', 'obj_1', 30, { bufferCapacity: 0, successorIds: ['st_2'] }),
          makeStage('st_2', 'S2', 'Stage 2', 'obj_2', 60, { bufferCapacity: 0, predecessorIds: ['st_1'], successorIds: ['st_3'] }),
          makeStage('st_3', 'S3', 'Stage 3', 'obj_3', 30, { bufferCapacity: 0, predecessorIds: ['st_2'] })
        );
        proj.products[0].routeStageIds = ['st_1', 'st_2', 'st_3'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const st1 = res.stageAnalytics.find((s) => s.stageId === 'st_1');
        const st2 = res.stageAnalytics.find((s) => s.stageId === 'st_2');
        return {
          metrics: [
            compareMetric('Stage 1 Blocked %', 'نسبة حجب المرحلة 1', '%', 48, st1?.blockedPct ?? 0, 5),
            compareMetric('Stage 2 Max Queue (0 buffer)', 'أقصى طابور للمرحلة 2', 'units', 0, st2?.maxQueueLength ?? 99, 0),
            compareMetric('Good Units', 'الوحدات السليمة', 'units', 58, res.kpis.goodUnits, 2),
          ],
        };
      }
    )
  );

  // 10. Unbalanced Line Starvation vs. Idle Separation
  results.push(
    runTimedCase(
      {
        id: 'bm_10_unbalanced_line',
        name: '10. Starvation vs. Idle Accounting',
        nameAr: '10. فصل وقت نقص التغذية عن الخمول',
        category: 'State Tracking',
        categoryAr: 'تتبع الحالات',
        description: 'Stage 1 (60s) feeding Stage 2 (20s) leaves Stage 2 actively starved ~66% rather than generic idle.',
        descriptionAr: 'تغذية مرحلة 20ث من مرحلة 60ث يسجل ~66% وقت نقص تغذية وليس خمولا عاماً.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm10', 'Unbalanced Starvation', {
          durationSec: 3600,
          arrivalIntervalSec: 30,
        });
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'Slow Feeder (60s)', 4, 60),
          makeStationObj('obj_2', 'st_2', 'Fast Finisher (20s)', 10, 20)
        );
        proj.stages.push(
          makeStage('st_1', 'S1', 'Feeder', 'obj_1', 60, { bufferCapacity: 100, successorIds: ['st_2'] }),
          makeStage('st_2', 'S2', 'Finisher', 'obj_2', 20, { bufferCapacity: 100, predecessorIds: ['st_1'] })
        );
        proj.products[0].routeStageIds = ['st_1', 'st_2'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const st2 = res.stageAnalytics.find((s) => s.stageId === 'st_2');
        return {
          metrics: [
            compareMetric('Stage 2 Utilization', 'تشغيل المرحلة 2', '%', 32.8, st2?.utilizationPct ?? 0, 1.5),
            compareMetric('Stage 2 Starved %', 'نسبة نقص التغذية', '%', 67.2, st2?.starvedPct ?? 0, 2.0),
            compareMetric('Good Units', 'الوحدات السليمة', 'units', 59, res.kpis.goodUnits, 1),
          ],
        };
      }
    )
  );

  // 11. OEE With Setup, Planned Maintenance & Quality Loss
  results.push(
    runTimedCase(
      {
        id: 'bm_11_oee_setup_maint_quality',
        name: '11. Full OEE (Setup + Maintenance + Quality)',
        nameAr: '11. معادلة OEE الكاملة (تجهيز + صيانة + جودة)',
        category: 'OEE Hierarchy',
        categoryAr: 'حسابات OEE',
        description: 'Verifies setupTime, plannedMaintenance window, scrap quality loss, and exact OEE = A × P × Q identity.',
        descriptionAr: 'التحقق من زمن التجهيز والصيانة المخططة والهالك وتطابق معادلة OEE = التوفر × الأداء × الجودة.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm11', 'OEE Verification', {
          durationSec: 3600,
          arrivalIntervalSec: 25,
          randomSeed: 777,
        });
        proj.simulationConfig.maintenanceWindows = [
          { id: 'mw_1', name: 'PM Filter Clean', startSec: 1800, durationSec: 300 },
        ];
        proj.layoutObjects.push(
          makeStationObj('obj_1', 'st_1', 'CNC Cell', 5, 25, { setupTimeSec: 300 })
        );
        proj.stages.push(
          makeStage('st_1', 'S1', 'CNC Stage', 'obj_1', 25, {
            setupTimeSec: 300,
            scrapRate: 0.1,
            bufferCapacity: 200,
          })
        );
        proj.products[0].routeStageIds = ['st_1'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const k = res.kpis;
        const productOee =
          ((k.availabilityPct ?? 0) / 100) *
          ((k.performancePct ?? 0) / 100) *
          ((k.qualityPct ?? 100) / 100) *
          100;

        return {
          metrics: [
            compareMetric('Planned Downtime (PM)', 'الصيانة المخططة', 's', 300, k.plannedDowntimeSec ?? 0, 0.5),
            compareMetric('Setup Time', 'وقت التجهيز', 's', 300, k.setupTimeSec ?? 0, 0.5),
            compareMetric('Scheduled Production Time', 'وقت الإنتاج المجدول', 's', 3300, k.scheduledProductionTimeSec ?? 0, 0.5),
            compareMetric('Operating Time', 'وقت التشغيل الصافي', 's', 3000, k.operatingTimeSec ?? 0, 1),
            compareMetric('OEE = A × P × Q Identity', 'تطابق معادلة OEE', '%', productOee, k.oeePct ?? 0, 0.05),
          ],
        };
      }
    )
  );

  // 12. Capacity Engine Deduplication & Buffer/Conveyor Non-Inflation (Scenario A1)
  results.push(
    runTimedCase(
      {
        id: 'bm_12_capacity_dedup_no_buffer_inflation',
        name: '12. Parallel Capacity Deduplication (No Buffer Inflation)',
        nameAr: '12. منع تضخيم السعة الموازية بالمخازن والسيور والتكرار',
        category: 'Capacity & Batching',
        categoryAr: 'السعة والتجميع',
        description:
          'Single machine (cap=1) paired with buffer (cap=20), conveyor, and duplicate object ID keeps parallelServers=1 and batch=4 amortized cycle=10s.',
        descriptionAr:
          'ماكينة واحدة (سعة 1) مع بفر (سعة 20) وسير ومعرف مكرر تحافظ على عدد خوادم موازية = 1 ودورة مكافئة للوحدة 10 ث.',
        verificationTier: 'des',
        engineeringConcept: 'Parallel Machine Server Count vs. Buffer Queue Capacity',
        engineeringConceptAr: 'فصل عدد الخوادم الموازية للماكينة عن سعة المخزن الوسيط',
        inputSummary: '1 machine (cap=1, 40s, batch=4) + buffer (cap=20) + conveyor + duplicate ID, 3600s shift',
        inputSummaryAr: 'ماكينة (سعة 1، 40ث، دفعة 4) + بفر (سعة 20) + سير + معرف مكرر، وردية 3600ث',
        explanation:
          'Only unique machine/workstation resources count as parallel servers. Effective unit cycle = 40 / (1 * 4) = 10 s (360 u/hr).',
        explanationAr:
          'تُحتسب فقط الماكينات/محطات العمل الفريدة كخوادم موازية. الزمن المكافئ للوحدة = 40 / (1 × 4) = 10 ث (360 وحدة/ساعة).',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm12', 'Capacity Non-Inflation', {
          durationSec: 3600,
          arrivalIntervalSec: 1,
        });
        const m1 = makeStationObj('m1', 'st_1', 'Palletizer 1', 5, 40, {
          capacity: 1,
          batchSize: 4,
          batchMode: 'collect_batch',
        });
        m1.kind = 'machine';
        const buf: LayoutObject = {
          ...makeStationObj('b1', 'st_1', 'Staging Buffer', 3, 0, { capacity: 20 }),
          kind: 'buffer',
          category: 'buffer',
        };
        const conv = makeStationObj('c1', 'st_1', 'Feed Belt', 8, 0, {
          kind: 'conveyor',
          capacity: 10,
          speedMps: 1.0,
        });
        proj.layoutObjects.push(m1, buf, conv);
        const st = makeStage('st_1', 'S1', 'Palletizing', 'm1', 40, {
          assignedObjectIds: ['m1', 'm1', 'b1', 'c1'],
          batchSize: 4,
          batchMode: 'collect_batch',
          bufferCapacity: 200,
        });
        proj.stages.push(st);
        proj.products[0].routeStageIds = ['st_1'];

        const profile = computeStageCapacityProfile(st, [m1, m1, buf, conv]);
        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();

        return {
          metrics: [
            compareMetric('Parallel Server Count', 'عدد الخوادم الموازية', 'servers', 1, profile.parallelServers, 0),
            compareMetric('Effective Unit Cycle', 'الزمن المكافئ للوحدة', 's', 10, profile.effectiveUnitCycleSec, 0.01),
            compareMetric('Theoretical Throughput', 'الإنتاجية النظرية', 'u/hr', 360, profile.theoreticalCapacityPerHour, 0.1),
            compareMetric('DES Measured Good Units', 'الوحدات المنتجة بالمحاكاة', 'units', 356, res.kpis.goodUnits, 4),
          ],
        };
      }
    )
  );

  // 13. Parallel Machines Linear Scaling Regression (Scenario A2)
  results.push(
    runTimedCase(
      {
        id: 'bm_13_parallel_machines_regression',
        name: '13. True Parallel Machines 2x Throughput Scaling',
        nameAr: '13. التضاعف الفعلي للإنتاجية مع ماكينتين متوازيتين',
        category: 'Capacity & Batching',
        categoryAr: 'السعة والتجميع',
        description:
          '2 identical parallel machines (cap=1 each, 40s, batch=4) plus buffer doubles throughput to 720 u/hr analytical and ~712 units in 3600s DES.',
        descriptionAr:
          'ماكينتان متوازيتان (سعة 1 لكل منهما، 40ث، دفعة 4) مع بفر تضاعف الإنتاجية النظرية إلى 720 و/س والمحاكاة إلى ~712 وحدة.',
        verificationTier: 'des',
        engineeringConcept: 'Identical Parallel Server Scaling',
        engineeringConceptAr: 'تدرج السعة الموازية للماكينات المتطابقة',
        inputSummary: '2 parallel machines (cap=1 each, 40s, batch=4) + buffer (cap=20), 3600s shift',
        inputSummaryAr: 'ماكينتان متوازيتان (سعة 1 لكل منهما، 40ث، دفعة 4) + بفر (سعة 20)، وردية 3600ث',
        explanation:
          'Distinct assigned machines sum to parallelServers=2 -> effectiveUnitCycle = 40 / (2 * 4) = 5s -> 720 u/hr.',
        explanationAr:
          'تُجمع الماكينات الفريدة لتعطي 2 خادم موازي، فيصبح الزمن المكافئ 40 / (2 × 4) = 5 ث (720 وحدة/ساعة).',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm13', 'Parallel 2-Machine Scaling', {
          durationSec: 3600,
          arrivalIntervalSec: 1,
        });
        const m1 = makeStationObj('m1', 'st_1', 'Palletizer A', 5, 40, {
          capacity: 1,
          batchSize: 4,
          batchMode: 'collect_batch',
        });
        m1.kind = 'machine';
        const m2 = makeStationObj('m2', 'st_1', 'Palletizer B', 7, 40, {
          capacity: 1,
          batchSize: 4,
          batchMode: 'collect_batch',
        });
        m2.kind = 'machine';
        const buf: LayoutObject = {
          ...makeStationObj('b1', 'st_1', 'Buffer', 3, 0, { capacity: 20 }),
          kind: 'buffer',
          category: 'buffer',
        };
        proj.layoutObjects.push(m1, m2, buf);
        const st = makeStage('st_1', 'S1', 'Parallel Palletizing', 'm1', 40, {
          assignedObjectIds: ['m1', 'm2', 'b1'],
          batchSize: 4,
          batchMode: 'collect_batch',
          bufferCapacity: 200,
        });
        proj.stages.push(st);
        proj.products[0].routeStageIds = ['st_1'];

        const profile = computeStageCapacityProfile(st, [m1, m2, buf]);
        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();

        return {
          metrics: [
            compareMetric('Parallel Server Count', 'عدد الخوادم الموازية', 'servers', 2, profile.parallelServers, 0),
            compareMetric('Effective Unit Cycle', 'الزمن المكافئ للوحدة', 's', 5, profile.effectiveUnitCycleSec, 0.01),
            compareMetric('Theoretical Throughput', 'الإنتاجية النظرية', 'u/hr', 720, profile.theoreticalCapacityPerHour, 0.1),
            compareMetric('DES Measured Good Units', 'الوحدات المنتجة بالمحاكاة', 'units', 712, res.kpis.goodUnits, 8),
          ],
        };
      }
    )
  );

  // 14. Resource-Specific Shift & Unavailable State Conservation (Scenario B1 + C1)
  results.push(
    runTimedCase(
      {
        id: 'bm_14_resource_shift_unavailable_state',
        name: '14. Resource Shift Assignment & Unavailable State Conservation',
        nameAr: '14. وردية المعدة المخصصة وحفظ حالة عدم التوفر',
        category: 'Calendars & States',
        categoryAr: 'التقاويم والحالات',
        description:
          'Machine assigned exclusively to Shift 1 (3600s) inside a 10800s 2-shift plant tracks 7200s strictly as unavailable (0s false idle), yielding 100% scheduled util & 33.3% calendar util.',
        descriptionAr:
          'ماكينة معينة للوردية الأولى (3600ث) ضمن أفق 10800ث تسجل 7200ث كغير متاح (0ث خمول زائف) بنسبة تشغيل مجدول 100% وتقويمي 33.3%.',
        verificationTier: 'des',
        engineeringConcept: 'Scheduled Utilization (OT/SPT) vs. Calendar Utilization (OT/CT)',
        engineeringConceptAr: 'فصل الاستغلال المجدول (OT/SPT) عن الاستغلال التقويمي (OT/CT) وتصنيف خارج الوردية',
        inputSummary: 'Horizon=10800s; Shift1=[0..3600], Shift2=[3600..10800]; Machine assigned to Shift1, 30s cycle',
        inputSummaryAr: 'أفق 10800ث؛ الوردية1 [0..3600]، الوردية2 [3600..10800]؛ الماكينة على الوردية1 بدورة 30ث',
        explanation:
          'Off-shift time is classified as unavailableTimeSec (7200s), keeping idleTimeSec=0 and resource OEE=100% on its 3600s scheduled window.',
        explanationAr:
          'يُصنف الوقت خارج الوردية كعدم توفر (7200ث) بدون أي خمول زائف، وتصل كفاءة المعدة المجدولة OEE إلى 100% في نافذتها.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm14', 'Resource Shift & Unavailable', {
          durationSec: 10800,
          arrivalIntervalSec: 30,
        });
        proj.simulationConfig.shifts = [
          { id: 'shift_1', name: 'Shift 1', startSec: 0, durationSec: 3600, breaks: [] },
          { id: 'shift_2', name: 'Shift 2', startSec: 3600, durationSec: 7200, breaks: [] },
        ];
        const m1 = makeStationObj('m1', 'st_1', 'CNC Shift-1', 5, 30, { shiftId: 'shift_1' });
        m1.kind = 'machine';
        proj.layoutObjects.push(m1);
        proj.stages.push(makeStage('st_1', 'S1', 'Machining', 'm1', 30, { bufferCapacity: 200 }));
        proj.products[0].routeStageIds = ['st_1'];

        const eng = new DiscreteEventSimulationEngine(proj);
        const res = eng.runToCompletion();
        const rt = eng.getSnapshot().objects['m1'];
        const ra = res.resourceAnalytics?.find((r) => r.objectId === 'm1');
        const stateSum =
          (rt?.runningTimeSec ?? 0) +
          (rt?.idleTimeSec ?? 0) +
          (rt?.blockedTimeSec ?? 0) +
          (rt?.starvedTimeSec ?? 0) +
          (rt?.setupTimeSec ?? 0) +
          (rt?.downTimeSec ?? 0) +
          (rt?.maintenanceTimeSec ?? 0) +
          (rt?.unavailableTimeSec ?? 0);

        return {
          metrics: [
            compareMetric('Unavailable Time (Off-Shift)', 'زمن خارج الوردية', 's', 7200, rt?.unavailableTimeSec ?? 0, 0.5),
            compareMetric('False Idle Time', 'زمن الخمول', 's', 0, rt?.idleTimeSec ?? 0, 0.5),
            compareMetric('Scheduled Utilization (OT/SPT)', 'الاستغلال المجدول', '%', 100, ra?.scheduledUtilizationPct ?? 0, 0.5),
            compareMetric('Calendar Utilization (OT/CT)', 'الاستغلال التقويمي', '%', 33.3333, ra?.calendarUtilizationPct ?? 0, 0.2),
            compareMetric('Resource OEE (Scheduled)', 'OEE الماكينة', '%', 100, ra?.oeePct ?? 0, 0.5),
            compareMetric('Exact State Conservation Sum', 'تطابق مجموع الحالات', 's', 10800, stateSum, 0.01),
          ],
        };
      }
    )
  );

  // 15. Heterogeneous Multi-Shift Resource & Weighted Plant OEE (Scenario B2)
  results.push(
    runTimedCase(
      {
        id: 'bm_15_heterogeneous_shift_weighted_oee',
        name: '15. Multi-Shift Heterogeneous Resource & Plant OEE',
        nameAr: '15. حساب OEE الموزون للماكينات مختلفة الورديات',
        category: 'OEE Hierarchy',
        categoryAr: 'حسابات OEE',
        description:
          'Machine A runs Shift 1 [0..3600s] @ 30s (120 units) feeding Buffer -> Machine B runs Shift 2 [3600..7200s] @ 60s (60 units). Both achieve 100% individual OEE and 100% scheduled-time weighted Plant OEE.',
        descriptionAr:
          'الماكينة A تعمل بالوردية 1 [0..3600ث] بدورة 30ث لتغذية الماكينة B بالوردية 2 [3600..7200ث] بدورة 60ث؛ تحقق كل معدة 100% OEE ومعدل المصنع الموزون 100%.',
        verificationTier: 'des',
        engineeringConcept: 'Weighted Multi-Shift Resource OEE Aggregation',
        engineeringConceptAr: 'تجميع مؤشر OEE الموزون حسب وقت الإنتاج المجدول لكل مورد',
        inputSummary: '7200s horizon; M1 Shift1 (3600s, 30s/u) -> M2 Shift2 (3600s, 60s/u)',
        inputSummaryAr: 'أفق 7200ث؛ الماكينة 1 وردية1 (3600ث، 30ث) -> الماكينة 2 وردية2 (3600ث، 60ث)',
        explanation:
          'Evaluating each resource against its own shift calendar eliminates cross-shift dilution, giving 100% OEE for M1, M2, and Plant.',
        explanationAr:
          'تقييم كل معدة وفق تقويمها الخاص يمنع تخفيف الكفاءة خارج ورديتها ويحقق 100% للمعدتين والمصنع.',
      },
      () => {
        const proj = createBenchmarkBaseProject('bm15', 'Heterogeneous Shift Weighted OEE', {
          durationSec: 7200,
          arrivalIntervalSec: 30,
        });
        proj.simulationConfig.shifts = [
          { id: 'shift_1', name: 'Shift 1', startSec: 0, durationSec: 3600, breaks: [] },
          { id: 'shift_2', name: 'Shift 2', startSec: 3600, durationSec: 3600, breaks: [] },
        ];
        const m1 = makeStationObj('m1', 'st_1', 'Prep Press', 5, 30, { shiftId: 'shift_1' });
        m1.kind = 'machine';
        const m2 = makeStationObj('m2', 'st_2', 'Cure Oven', 12, 60, { shiftId: 'shift_2' });
        m2.kind = 'machine';
        proj.layoutObjects.push(m1, m2);
        proj.stages.push(
          makeStage('st_1', 'S1', 'Prep', 'm1', 30, { bufferCapacity: 300, successorIds: ['st_2'] }),
          makeStage('st_2', 'S2', 'Cure', 'm2', 60, { bufferCapacity: 300, predecessorIds: ['st_1'] })
        );
        proj.products[0].routeStageIds = ['st_1', 'st_2'];

        const res = new DiscreteEventSimulationEngine(proj).runToCompletion();
        const r1 = res.resourceAnalytics?.find((r) => r.objectId === 'm1');
        const r2 = res.resourceAnalytics?.find((r) => r.objectId === 'm2');

        return {
          metrics: [
            compareMetric('Machine 1 OEE', 'OEE الماكينة 1', '%', 100, r1?.oeePct ?? 0, 0.5),
            compareMetric('Machine 2 OEE', 'OEE الماكينة 2', '%', 100, r2?.oeePct ?? 0, 0.5),
            compareMetric('Weighted Plant OEE', 'OEE المصنع الموزون', '%', 100, res.kpis.oeePct ?? 0, 0.5),
            compareMetric('Line Good Units (M2 Exit)', 'الوحدات النهائية', 'units', 60, res.kpis.goodUnits, 1),
          ],
        };
      }
    )
  );

  // 16. Log-Normal Repair Distribution Method-of-Moments Statistical Verification
  results.push(
    runTimedCase(
      {
        id: 'bm_16_lognormal_repair_statistics',
        name: '16. Log-Normal Repair Time Method of Moments',
        nameAr: '16. التحقق الإحصائي لتوزيع إصلاح Log-Normal',
        category: 'Reliability Math',
        categoryAr: 'رياضيات الأعطال',
        description:
          '5,000 seeded Box-Muller samples from LogNormal(mean=120s, stdDev=60s) converge accurately to arithmetic target mean and standard deviation.',
        descriptionAr:
          'توليد 5,000 عينة بذرية لتوزيع Log-Normal بمتوسط 120ث وانحراف معياري 60ث ومطابقتها حسابياً.',
        verificationTier: 'math',
        engineeringConcept: 'Method of Moments Parameterization + Box-Muller Transform',
        engineeringConceptAr: 'تحويل العزوم الحسابية وتوليد التوزيع اللوغاريتمي الطبيعي',
        inputSummary: 'N=5000 seeded samples, target arithmetic MTTR mean=120s, stdDev=60s',
        inputSummaryAr: '5000 عينة ببذرة ثابتة، متوسط MTTR المستهدف 120ث، الانحراف المعياري 60ث',
        explanation:
          'Verifies sigma^2 = ln(1 + (sd/mean)^2) and mu = ln(mean) - sigma^2/2 yield exact empirical mean and standard deviation.',
        explanationAr:
          'التحقق من تطابق المتوسط والانحراف المعياري التجريبيين مع القيم النظرية المحددة بدون قيم سالبة.',
      },
      () => {
        const rng = createSeededRng(202604);
        const N = 5000;
        let sum = 0;
        let sumSq = 0;
        let invalidCount = 0;
        for (let i = 0; i < N; i++) {
          const val = sampleRepairDurationSec(
            {
              enabled: true,
              failureModel: 'exponential',
              repairModel: 'lognormal',
              mtbfSec: 3600,
              mttrSec: 120,
              mttrStdDevSec: 60,
              weibullShape: 2,
              weibullScaleSec: 3600,
              availability: 0.95,
            },
            rng
          );
          if (!Number.isFinite(val) || val <= 0) invalidCount++;
          sum += val;
          sumSq += val * val;
        }
        const mean = sum / N;
        const variance = Math.max(0, sumSq / N - mean * mean);
        const stdDev = Math.sqrt(variance);

        return {
          metrics: [
            compareMetric('Empirical Sample Mean', 'المتوسط التجريبي للعينات', 's', 120, mean, 3.0),
            compareMetric('Empirical Sample Std Dev', 'الانحراف المعياري التجريبي', 's', 60, stdDev, 4.0),
            compareMetric('Invalid / Non-Positive Samples', 'العينات غير الصالحة', 'count', 0, invalidCount, 0),
          ],
        };
      }
    )
  );

  const suiteEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const passedTests = results.filter((r) => r.passed).length;

  return {
    ranAt: new Date().toISOString(),
    totalTests: results.length,
    passedTests,
    failedTests: results.length - passedTests,
    totalExecutionMs: Number(Math.max(0.01, suiteEnd - suiteStart).toFixed(2)),
    results,
  };
}
