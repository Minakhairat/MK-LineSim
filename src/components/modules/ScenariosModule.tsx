import { formatBeltSpeed, leadTimeText, uniformBufferReplacesStages, isValidScenarioWorkerCount, scenarioWorkerCountUnreliable, scenarioWorkerMismatchNotice } from '../../utils/units';
import { GeneratedInputsStrip, ReliabilityConflictStrip } from '../ImportNotesBanner';
import { resultProvenance, unionProvenance } from '../../utils/importNotes';
import React, { useState } from 'react';
import { Copy, Maximize2, Minimize2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { applyScenarioOverrides, runSimulationInWorker } from '../../simulation/workerClient';
import { validateProject } from '../../simulation/validator';
import { ScenarioRecord } from '../../types/project';
import { formatDuration, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';

export const ScenariosModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const addScenario = useAppStore((s) => s.addScenario);
  const updateScenario = useAppStore((s) => s.updateScenario);
  const updateScenarioResult = useAppStore((s) => s.updateScenarioResult);
  const deleteScenario = useAppStore((s) => s.deleteScenario);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);
  const setToast = useAppStore((s) => s.setToast);

  const t = getT(language);
  const isAr = language === 'ar';

  const [name, setName] = useState(
    isAr ? 'سيناريو: +2 عامل وسير أسرع' : 'What-If: +2 Operators & Faster Belt'
  );
  const [workerCount, setWorkerCount] = useState(project.workers.length + 2);
  const [procScale, setProcScale] = useState(0.9);
  const [convSpeed, setConvSpeed] = useState(
    project.layoutObjects.find((o) => o.kind === 'conveyor')?.operations.speedMps || 0.08
  );
  const [bufferCap, setBufferCap] = useState(project.stages[0]?.bufferCapacity ?? 5);
  // Only an explicit edit of the buffer field overrides per-stage buffers; untouched = keep each stage's own.
  const [bufferTouched, setBufferTouched] = useState(false);
  const [shiftSec, setShiftSec] = useState(project.simulationConfig.durationSec);
  const [enableBreakdowns, setEnableBreakdowns] = useState(project.simulationConfig.enableBreakdowns);
  const [targetProd, setTargetProd] = useState(project.simulationConfig.maxPlannedUnits);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // The Workers field declares a minimum of 1 and the engine clamps lower values to 1, so a 0 or a fraction would
  // run with a different worker count than the row shows. Refuse it instead of running with a changed input.
  const rejectBadWorkerCount = (n: unknown): boolean => {
    if (isValidScenarioWorkerCount(n)) return false;
    setToast(
      isAr
        ? 'عدد العمال لازم يكون رقم صحيح ١ أو أكتر. السيناريو ما اتشغّلش.'
        : 'Worker count must be a whole number of 1 or more. The scenario was not run.',
      'error'
    );
    return true;
  };

  const handleCreateOrSaveAndRun = async () => {
    const cleanName =
      name.trim() ||
      (isAr ? `سيناريو ${project.scenarios.length + 1}` : `Scenario ${project.scenarios.length + 1}`);
    const overrides = {
      workerCount,
      processingTimeScale: procScale,
      conveyorSpeedMps: convSpeed,
      bufferCapacity: bufferTouched ? bufferCap : undefined,
      shiftDurationSec: shiftSec,
      enableBreakdowns,
      targetProduction: targetProd,
    };

    if (rejectBadWorkerCount(workerCount)) return;

    if (editingScenarioId) {
      const existing = project.scenarios.find((s) => s.id === editingScenarioId);
      if (existing) {
        const updatedScen: ScenarioRecord = {
          ...existing,
          name: cleanName,
          description: `Workers=${workerCount}, CycleScale=${procScale}x, Belt=${convSpeed}m/s, Buffer=${bufferTouched ? bufferCap : 'per-stage'}`,
          overrides,
        };
        updateScenario(editingScenarioId, {
          name: updatedScen.name,
          description: updatedScen.description,
          overrides: updatedScen.overrides,
        });
        setEditingScenarioId(null);
        await handleRunScenario(updatedScen);
        return;
      }
    }

    const scen: ScenarioRecord = {
      id: uid('scen'),
      name: cleanName,
      description: `Workers=${workerCount}, CycleScale=${procScale}x, Belt=${convSpeed}m/s, Buffer=${bufferTouched ? bufferCap : 'per-stage'}`,
      createdAt: new Date().toISOString(),
      isBaseline: false,
      overrides,
    };
    addScenario(scen);
    await handleRunScenario(scen);
  };

  const handleRunScenario = async (scen: ScenarioRecord) => {
    if (!scen.isBaseline && rejectBadWorkerCount(scen.overrides.workerCount)) return;
    setRunningId(scen.id);
    try {
      const modifiedProject = applyScenarioOverrides(project, scen.overrides);
      const scenarioErrors = validateProject(modifiedProject).filter((i) => i.severity === 'error');
      if (scenarioErrors.length > 0) {
        const first = scenarioErrors[0];
        setToast(
          isAr
            ? `خطأ في التحقق: ${first.messageAr || first.message}`
            : `Validation error: ${first.message}`,
          'error'
        );
        return;
      }
      const res = await runSimulationInWorker(modifiedProject);
      updateScenarioResult(scen.id, res);
      if (res.stallWarnings && res.stallWarnings.length > 0) {
        setToast(
          isAr
            ? `تحذير: السيناريو "${scen.name}" انتهى بتعليق في النموذج (دفعات أو انسداد). راجع افتراضات المخزن وحجم الدفعة وخليط المنتجات.`
            : `Warning: scenario "${scen.name}" ended with a stall in the modeled flow (batch or blocking). Review the buffer, batch size and product mix assumptions.`,
          'error'
        );
        return;
      }
      setToast(
        isAr
          ? `تم تشغيل "${scen.name}": ${res.kpis.goodUnits} وحدة سليمة`
          : `Scenario "${scen.name}" simulated: ${res.kpis.goodUnits} good units`,
        'success'
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Scenario run failed', 'error');
    } finally {
      setRunningId(null);
    }
  };

  const baselineResult = project.scenarios.find((s) => s.isBaseline)?.result || project.lastSimulationResult;

  const recommendations: string[] = [];
  const baselineStalled = !!(baselineResult && baselineResult.stallWarnings && baselineResult.stallWarnings.length > 0);
  if (baselineResult && baselineStalled) {
    // A stalled run has measured zero utilization downstream of the stall point. That is a symptom of the stall,
    // not evidence that a station is slow, so no bottleneck, buffer or staffing recommendation is derived from it.
    const nm = new Map(project.stages.map((s) => [s.id, s.name]));
    const names = Array.from(new Set(baselineResult.stallWarnings!.map((w) => nm.get(w.stageId) || w.stageId))).join(', ');
    recommendations.push(
      isAr
        ? `نتيجة خط الأساس انتهت بتعليق في النموذج عند (${names}). أرقام الاستغلال والاختناق في هذه النتيجة أعراض للتعليق وليست دليلاً على بطء محطة، لذلك لا تُستنتج منها توصيات سعة أو عمالة. راجع أولاً سعة المخزن وحجم الدفعة وخليط المنتجات.`
        : `The baseline run ended in a modeled stall at (${names}). Utilization and bottleneck figures from this run are symptoms of the stall, not evidence that a station is slow, so no capacity or staffing recommendations are derived from it. Review buffer capacity, batch size and product mix assumptions first.`
    );
  } else if (baselineResult) {
    const b = baselineResult.kpis;
    const bn = baselineResult.stageAnalytics.find((s) => s.isBottleneck);
    if (bn) {
      recommendations.push(
        isAr
          ? `الاختناق الرئيسي: مرحلة "${bn.stageName}" تعمل بنسبة استغلال ${bn.utilizationPct.toFixed(1)}% وبمتوسط انتظار ${bn.avgWaitTimeSec.toFixed(1)} ثانية وأقصى طابور ${bn.maxQueueLength} وحدة.`
          : `Primary Bottleneck: "${bn.stageName}" operates at ${bn.utilizationPct.toFixed(1)}% utilization with average wait ${bn.avgWaitTimeSec.toFixed(1)}s and max queue ${bn.maxQueueLength} units.`
      );
    }
    if (b.totalBlockedTimeSec > 300) {
      recommendations.push(
        isAr
          ? `فاقد الحجب والانتظار المرتفع (${formatDuration(b.totalBlockedTimeSec)}): زيادة سعة المخزن الوسيط (Buffer) أو تسريع مرحلة الاختناق سيقلل توقف المراحل السابقة.`
          : `High Blocking Loss (${formatDuration(b.totalBlockedTimeSec)}): Increasing inter-stage buffer capacity or speeding up downstream bottleneck stage will reduce upstream blocking.`
      );
    }
    if (b.workerUtilizationPct > 85) {
      recommendations.push(
        isAr
          ? `ضغط عمالة مرتفع (${b.workerUtilizationPct.toFixed(1)}%): إضافة 1–2 عامل عند مرحلة الاختناق سيرفع نسبة تحقيق المستهدف من ${b.productionAttainmentPct.toFixed(1)}%.`
          : `High Operator Load (${b.workerUtilizationPct.toFixed(1)}%): Adding 1–2 operators at the bottleneck stage can raise shift attainment from ${b.productionAttainmentPct.toFixed(1)}%.`
      );
    }
    if (b.avgTransportTimeSec > b.avgProcessingTimeSec * 0.4) {
      recommendations.push(
        isAr
          ? `تأثير زمن النقل على السير: النقل يستهلك ${b.avgTransportTimeSec.toFixed(1)} ث لكل منتج. رفع سرعة السير أو تقليل المسافات بين المحطات يخفض زمن التسليم.`
          : `Conveyor Transit Share: Transport consumes ${b.avgTransportTimeSec.toFixed(1)}s per unit. Increasing belt speed or tightening station spacing lowers lead time.`
      );
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t.scenarios.title}
            </h2>
            <p className="text-xs text-neutral-500">{t.scenarios.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium shrink-0 ${
              isFullscreen
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}</span>
          </button>
        </div>

        {/* Scenario Builder */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
            {t.scenarios.builderTitle}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.scenarioName}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.workerCount}</span>
              <input
                type="number"
                min={1}
                value={workerCount}
                onChange={(e) => setWorkerCount(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.procScale}</span>
              <input
                type="number"
                step={0.05}
                min={0.3}
                max={2.5}
                value={procScale}
                onChange={(e) => setProcScale(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.convSpeed}</span>
              <input
                type="number"
                step={0.01}
                min={0.01}
                value={convSpeed}
                onChange={(e) => setConvSpeed(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.bufferCap}</span>
              <input
                type="number"
                min={0}
                value={bufferCap}
                onChange={(e) => {
                  setBufferCap(Number(e.target.value));
                  setBufferTouched(true);
                }}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
              {bufferTouched && uniformBufferReplacesStages(project.stages, bufferCap) && (
                <span className="text-[10px] leading-tight text-amber-700 dark:text-amber-400">
                  {isAr
                    ? `تنبيه: هذه القيمة تُطبَّق على كل المراحل وتستبدل سعات المخزن الخاصة بكل مرحلة (${Math.min(...project.stages.map((s) => s.bufferCapacity))}–${Math.max(...project.stages.map((s) => s.bufferCapacity))}). اتركها بدون تعديل للإبقاء على القيم الأصلية.`
                    : `Applies one value to every stage and replaces each stage's own buffer (${Math.min(...project.stages.map((s) => s.bufferCapacity))}–${Math.max(...project.stages.map((s) => s.bufferCapacity))} now). Leave it untouched to keep per-stage values.`}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.shiftDur}</span>
              <input
                type="number"
                step={1800}
                min={1800}
                value={shiftSec}
                onChange={(e) => setShiftSec(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.scenarios.targetUnits}</span>
              <input
                type="number"
                min={10}
                value={targetProd}
                onChange={(e) => setTargetProd(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 font-mono-tabular"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={enableBreakdowns}
                onChange={(e) => setEnableBreakdowns(e.target.checked)}
              />
              <span>{t.scenarios.includeBreakdowns}</span>
            </label>
            <div className="flex items-center gap-2">
              {editingScenarioId && (
                <button
                  type="button"
                  onClick={() => setEditingScenarioId(null)}
                  className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t.actions.cancel}
                </button>
              )}
              <button
                type="button"
                onClick={handleCreateOrSaveAndRun}
                className="flex items-center gap-1.5 rounded bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{editingScenarioId ? t.actions.saveChanges : t.scenarios.createRunBtn}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Rule-Based Engineering Insights */}
        {recommendations.length > 0 && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
              {t.scenarios.insightsTitle}
            </h3>
            <ul className="flex flex-col gap-1.5 text-xs text-neutral-700 dark:text-neutral-300 list-disc ps-4">
              {recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        <GeneratedInputsStrip
          provenance={unionProvenance(project.scenarios.filter((sc) => sc.result).map((sc) => resultProvenance(sc.result)))}
          perRow
        />
        <ReliabilityConflictStrip
          provenance={unionProvenance(project.scenarios.filter((sc) => sc.result).map((sc) => resultProvenance(sc.result)))}
          perRow
        />
        {project.scenarios.some((sc) => scenarioWorkerCountUnreliable(sc)) && (
          <div
            role="note"
            data-testid="workers-not-as-run-note"
            className="w-full max-w-3xl text-start rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-red-900"
          >
            {scenarioWorkerMismatchNotice(isAr)}
          </div>
        )}

        {/* Comparison Table */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
          <table className="w-full text-start text-xs font-mono-tabular">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-medium text-start">{t.scenarios.colScenario}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colWorkers}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colBelt}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colGood}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colAttain}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colLead}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colWip}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colWorkerUtil}</th>
                <th className="px-3 py-2.5 font-medium text-start">{t.scenarios.colBottleneck}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.scenarios.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {project.scenarios.map((sc) => {
                const k = sc.result?.kpis;
                const rowProv = resultProvenance(sc.result);
                return (
                  <tr
                    key={sc.id}
                    className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className="px-4 py-2.5 font-sans font-medium text-neutral-900 dark:text-neutral-100">
                      {sc.name}
                      {sc.overrides.bufferCapacity !== undefined &&
                        uniformBufferReplacesStages(project.stages, sc.overrides.bufferCapacity) && (
                          <span
                            className="ms-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800"
                            title={isAr ? 'سعة مخزن موحدة تستبدل قيم المراحل الأصلية' : 'One buffer value replaces each stage\'s own buffer capacity'}
                          >
                            {isAr ? `مخزن موحد ${sc.overrides.bufferCapacity}` : `Uniform buffer ${sc.overrides.bufferCapacity}`}
                          </span>
                        )}
                      {(rowProv.unknown || rowProv.codes.length > 0) && (
                        <span
                          data-testid="row-provenance"
                          className="ms-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800"
                        >
                          {rowProv.unknown
                            ? isAr ? 'مصدر المدخلات غير معروف' : 'Provenance unknown'
                            : isAr ? 'مدخلات مولّدة تلقائياً' : 'Generated inputs'}
                        </span>
                      )}
                      {(rowProv.reliability?.length ?? 0) > 0 || rowProv.reliabilityUnknown ? (
                        <span
                          data-testid="row-reliability"
                          className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                          title={
                            (rowProv.reliability?.length ?? 0) > 0
                              ? isAr ? 'التشغيل استخدم MTBF/MTTR بدل التوفر المكتوب لمعدة أو أكتر.' : 'The run used MTBF/MTTR instead of the stated availability for one or more machines.'
                              : isAr ? 'مش مسجّل إذا كان التشغيل استخدم MTBF/MTTR بدل توفر مكتوب مختلف.' : 'It was not recorded whether the run used MTBF/MTTR instead of a conflicting stated availability.'
                          }
                        >
                          {(rowProv.reliability?.length ?? 0) > 0
                            ? isAr ? 'استُخدم MTBF/MTTR' : 'MTBF/MTTR used'
                            : isAr ? 'التوفر غير مسجّل' : 'Reliability unknown'}
                        </span>
                      ) : null}
                      {scenarioWorkerCountUnreliable(sc) && (
                        <span
                          data-testid="row-workers-unreliable"
                          className="ms-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800"
                          title={isAr ? 'عدد العمال المحفوظ مش رقم صحيح ١ أو أكتر، والمحرك شغّل بعدد تاني غير المكتوب. ما تعتمدش على الصف ده.' : 'The saved worker count is not a whole number of 1 or more, so the engine ran a different count than the one shown. Do not rely on this row.'}
                        >
                          {isAr ? 'عدد العمال مش زي المشغَّل' : 'Workers not as run'}
                        </span>
                      )}
                      {sc.result?.stallWarnings && sc.result.stallWarnings.length > 0 && (
                        <span
                          className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                          title={isAr ? 'النموذج توقف عند نقطة ما أثناء التشغيل. الأرقام تعكس هذا التوقف.' : 'The modeled flow stops at some point in the run. The figures reflect that stall.'}
                        >
                          {isAr ? 'تعليق مرصود' : 'Stall flagged'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-end">{sc.overrides.workerCount}</td>
                    <td className="px-3 py-2.5 text-end">{formatBeltSpeed(sc.overrides.conveyorSpeedMps)}</td>
                    <td className="px-3 py-2.5 text-end font-semibold">{k ? k.goodUnits : '—'}</td>
                    <td className="px-3 py-2.5 text-end">
                      {k ? `${k.productionAttainmentPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-end">{k ? leadTimeText(k.avgLeadTimeSec) : '—'}</td>
                    <td className="px-3 py-2.5 text-end">{k ? k.avgWip.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2.5 text-end">
                      {k ? `${k.workerUtilizationPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-sans text-neutral-600 dark:text-neutral-400">
                      {sc.result?.stallWarnings && sc.result.stallWarnings.length > 0
                        ? isAr ? 'غير محدد (تعليق)' : 'n/a (stall)'
                        : k?.bottleneckStageName || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-end">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleRunScenario(sc)}
                          disabled={runningId === sc.id}
                          title={t.actions.start}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-red-600"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingScenarioId(sc.id);
                            setName(sc.name);
                            setWorkerCount(sc.overrides.workerCount);
                            setProcScale(sc.overrides.processingTimeScale);
                            setConvSpeed(sc.overrides.conveyorSpeedMps);
                            setBufferCap(sc.overrides.bufferCapacity ?? project.stages[0]?.bufferCapacity ?? 5);
                            setBufferTouched(sc.overrides.bufferCapacity !== undefined);
                            setShiftSec(sc.overrides.shiftDurationSec);
                            setEnableBreakdowns(sc.overrides.enableBreakdowns);
                            setTargetProd(sc.overrides.targetProduction);
                          }}
                          title={t.actions.edit}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            addScenario({
                              ...structuredClone(sc),
                              id: uid('scen'),
                              isBaseline: false,
                              name: `${sc.name} (${isAr ? 'نسخة' : 'Copy'})`,
                            })
                          }
                          title={t.actions.duplicate}
                          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {project.scenarios.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (editingScenarioId === sc.id) setEditingScenarioId(null);
                              deleteScenario(sc.id);
                            }}
                            title={t.actions.delete}
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950 text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
