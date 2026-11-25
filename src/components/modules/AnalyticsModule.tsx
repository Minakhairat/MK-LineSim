import { leadTimeText, oeeSummaryText } from '../../utils/units';
import { performanceDefinitionText } from '../../utils/oeeBasis';
import React, { useEffect, useRef } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Maximize2, Minimize2, Play } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { GeneratedInputsStrip, ImportNotesBanner, ReliabilityConflictStrip } from '../ImportNotesBanner';
import { generatedInputCodes, resultProvenance } from '../../utils/importNotes';
import { formatDuration } from '../../utils/units';
import { oeeBasisUsesSkippedStage } from '../../utils/oeeBasis';
import { mostLoadedUtilText } from '../../utils/bottleneckLabel';
import { getT } from '../../i18n/translations';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler
);

export const AnalyticsModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const runFullShiftSimulation = useAppStore((s) => s.runFullShiftSimulation);
  const simWorkerBusy = useAppStore((s) => s.simWorkerBusy);
  const theme = useAppStore((s) => s.theme);
  const language = useAppStore((s) => s.language);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);

  const t = getT(language);
  const isAr = language === 'ar';
  const result = simSnapshot.result || project.lastSimulationResult;

  const hourlyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const utilCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!result) return;
    const textColor = theme === 'dark' ? '#CBD5E1' : '#334155';
    const gridColor = theme === 'dark' ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)';

    const charts: Chart[] = [];

    if (hourlyCanvasRef.current) {
      charts.push(
        new Chart(hourlyCanvasRef.current, {
          type: 'bar',
          data: {
            labels: result.hourlySeries.map((h) => h.label),
            datasets: [
              {
                label: isAr ? 'الإنتاج التراكمي الفعلي (سليم)' : 'Actual Cumulative (Good)',
                data: result.hourlySeries.map((h) => h.actualCumulative),
                backgroundColor: '#DC2626',
              },
              {
                label: isAr ? 'الإنتاج التراكمي المخطط' : 'Planned Cumulative',
                data: result.hourlySeries.map((h) => h.plannedCumulative),
                backgroundColor: theme === 'dark' ? '#475569' : '#94A3B8',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
            scales: {
              x: { ticks: { color: textColor }, grid: { color: gridColor } },
              y: { ticks: { color: textColor }, grid: { color: gridColor } },
            },
          },
        })
      );
    }

    if (stageCanvasRef.current) {
      charts.push(
        new Chart(stageCanvasRef.current, {
          type: 'bar',
          data: {
            labels: result.stageAnalytics.map((s) => s.stageName),
            datasets: [
              {
                label: isAr ? 'متوسط زمن الدورة (ث)' : 'Measured Avg Cycle Time (s)',
                data: result.stageAnalytics.map((s) => Number(s.avgCycleTimeSec.toFixed(1))),
                backgroundColor: result.stageAnalytics.map((s) =>
                  s.isBottleneck && !(result.stallWarnings && result.stallWarnings.length > 0) ? '#DC2626' : '#1E293B'
                ),
              },
              {
                label: isAr ? 'متوسط زمن الانتظار (ث)' : 'Measured Avg Wait (s)',
                data: result.stageAnalytics.map((s) => Number(s.avgWaitTimeSec.toFixed(1))),
                backgroundColor: '#D97706',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
            scales: {
              x: { ticks: { color: textColor }, grid: { color: gridColor } },
              y: { ticks: { color: textColor }, grid: { color: gridColor } },
            },
          },
        })
      );
    }

    if (utilCanvasRef.current) {
      charts.push(
        new Chart(utilCanvasRef.current, {
          type: 'bar',
          data: {
            labels: result.stageAnalytics.map((s) => s.stageName),
            datasets: [
              {
                label: isAr ? 'تشغيل %' : 'Running %',
                data: result.stageAnalytics.map((s) => Number(s.utilizationPct.toFixed(1))),
                backgroundColor: '#16A34A',
              },
              {
                label: isAr ? 'تجهيز %' : 'Setup %',
                data: result.stageAnalytics.map((s) => Number((s.setupPct ?? 0).toFixed(1))),
                backgroundColor: '#0284C7',
              },
              {
                label: isAr ? 'حجب %' : 'Blocked %',
                data: result.stageAnalytics.map((s) => Number(s.blockedPct.toFixed(1))),
                backgroundColor: '#D97706',
              },
              {
                label: isAr ? 'نقص تغذية %' : 'Starved %',
                data: result.stageAnalytics.map((s) => Number(s.starvedPct.toFixed(1))),
                backgroundColor: '#CA8A04',
              },
              {
                label: isAr ? 'خمول %' : 'Idle %',
                data: result.stageAnalytics.map((s) => Number((s.idlePct ?? 0).toFixed(1))),
                backgroundColor: '#64748B',
              },
              {
                label: isAr ? 'عطل / صيانة %' : 'Down / Maint %',
                data: result.stageAnalytics.map((s) =>
                  Number((s.downPct + (s.maintenancePct ?? 0)).toFixed(1))
                ),
                backgroundColor: '#DC2626',
              },
              {
                label: isAr ? 'خارج الوردية %' : 'Unavailable %',
                data: result.stageAnalytics.map((s) => Number((s.unavailablePct ?? 0).toFixed(1))),
                backgroundColor: '#94A3B8',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
            scales: {
              x: { stacked: true, ticks: { color: textColor }, grid: { color: gridColor } },
              y: { stacked: true, max: 100, ticks: { color: textColor }, grid: { color: gridColor } },
            },
          },
        })
      );
    }

    if (wipCanvasRef.current) {
      charts.push(
        new Chart(wipCanvasRef.current, {
          type: 'line',
          data: {
            labels: result.wipSeries.map((w) => formatDuration(w.timeSec)),
            datasets: [
              {
                label: isAr ? 'المنتجات تحت التشغيل (WIP)' : 'WIP (Active Units)',
                data: result.wipSeries.map((w) => w.wip),
                borderColor: '#DC2626',
                backgroundColor: 'rgba(220, 38, 38, 0.12)',
                fill: true,
                tension: 0.2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
            scales: {
              x: { ticks: { color: textColor, maxTicksLimit: 8 }, grid: { color: gridColor } },
              y: { ticks: { color: textColor }, grid: { color: gridColor } },
            },
          },
        })
      );
    }

    return () => {
      charts.forEach((c) => c.destroy());
    };
  }, [result, theme, isAr]);

  const stallIdSet = new Set((result?.stallWarnings || []).map((w) => w.stageId));
  const stalledRun = stallIdSet.size > 0;
  const stallLocationNames = (result?.stageAnalytics || [])
    .filter((s) => stallIdSet.has(s.stageId))
    .map((s) => s.stageName)
    .join(', ');

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <ImportNotesBanner />
        <GeneratedInputsStrip />
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {t.analytics.noResultsTitle}
        </h3>
        <p className="max-w-md text-xs text-neutral-600 dark:text-neutral-400">
          {t.analytics.noResultsDesc}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => runFullShiftSimulation()}
            disabled={simWorkerBusy}
            className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
          >
            <Play className="w-4 h-4" />
            <span>{simWorkerBusy ? t.actions.computing : t.analytics.runShiftBtn}</span>
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4 text-red-600" /> : <Maximize2 className="w-4 h-4" />}
            <span>{isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}</span>
          </button>
        </div>
      </div>
    );
  }

  const k = result.kpis;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t.analytics.title}
            </h2>
            <p className="text-xs text-neutral-500 font-mono-tabular">
              {t.analytics.subtitlePrefix} {result.totalEventsExecuted.toLocaleString()}{' '}
              {t.analytics.subtitleMid} {formatDuration(result.simTimeSec)} {t.analytics.subtitleSuffix}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runFullShiftSimulation()}
              disabled={simWorkerBusy}
              className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{simWorkerBusy ? t.actions.computing : t.analytics.rerunBtn}</span>
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium ${
                isFullscreen
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}</span>
            </button>
          </div>
        </div>

        <ImportNotesBanner />
        <GeneratedInputsStrip provenance={
            simSnapshot.result && !simSnapshot.result.generatedInputs
              ? { codes: generatedInputCodes(project), unknown: false } // live in-progress result of the current project
              : resultProvenance(result)
          } />
        <ReliabilityConflictStrip provenance={simSnapshot.result && !simSnapshot.result.generatedInputs ? undefined : resultProvenance(result)} />

        {/* Structured KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: t.analytics.cards.goodUnits,
              val: `${k.goodUnits}`,
              sub: isAr
                ? `الهالك: ${k.defectiveUnits} · إعادة: ${k.reworkUnits ?? 0} · الإجمالي: ${k.actualProduction}`
                : `Scrap: ${k.defectiveUnits} · Rework: ${k.reworkUnits ?? 0} · Total: ${k.actualProduction}`,
            },
            {
              label: t.analytics.cards.planned,
              val: `${k.totalPlannedProduction}`,
              sub: `${t.labels.attainment}: ${k.productionAttainmentPct.toFixed(1)}%`,
            },
            {
              label: t.analytics.cards.throughput,
              val: `${k.hourlyOutput.toFixed(1)} ${isAr ? 'وحدة/س' : 'u/hr'}`,
              sub: isAr
                ? `الدورة: ${k.avgCycleTimeSec.toFixed(1)}ث · التاكت: ${k.theoreticalTaktTimeSec.toFixed(1)}ث`
                : `Avg Cycle: ${k.avgCycleTimeSec.toFixed(1)}s · Takt (Est): ${k.theoreticalTaktTimeSec.toFixed(1)}s`,
            },
            {
              label: stalledRun ? (isAr ? 'موقع التعليق' : 'Stall Location') : t.analytics.cards.bottleneck,
              val: stalledRun ? stallLocationNames || 'N/A' : k.bottleneckStageName || 'N/A',
              sub: stalledRun
                ? isAr
                  ? `كفاءة الخط: ${k.lineEfficiencyPct.toFixed(1)}% · متوسط WIP: ${k.avgWip.toFixed(1)}`
                  : `Line Eff: ${k.lineEfficiencyPct.toFixed(1)}% · Avg WIP: ${k.avgWip.toFixed(1)}`
                : isAr
                  ? `الأكثر تحميلًا${mostLoadedUtilText(result, true)}: ترتيب مش اختبار سعة`
                  : `Most-loaded stage${mostLoadedUtilText(result, false)}: a ranking, not a capacity test`,
            },
            {
              label: t.analytics.cards.leadTime,
              val: leadTimeText(k.avgLeadTimeSec),
              sub: isAr
                ? `تشغيل: ${k.avgProcessingTimeSec.toFixed(0)}ث · انتظار وحدة: ${(k.avgUnitWaitingTimeSec ?? k.avgWaitingTimeSec).toFixed(0)}ث`
                : `Proc: ${k.avgProcessingTimeSec.toFixed(0)}s · Unit Wait: ${(k.avgUnitWaitingTimeSec ?? k.avgWaitingTimeSec).toFixed(0)}s`,
            },
            {
              label: t.analytics.cards.transportTime,
              val: `${k.avgTransportTimeSec.toFixed(1)}s`,
              sub: isAr ? 'زمن النقل المحسوب من طول/سرعة السير' : 'Conveyor transit derived from L/v',
            },
            {
              label: t.analytics.cards.workerUtil,
              val: `${k.workerUtilizationPct.toFixed(1)}%`,
              sub: isAr ? `${project.workers.length} عامل نشط` : `${project.workers.length} operators active`,
            },
            {
              label: t.analytics.cards.machineUtil,
              val: `${k.machineUtilizationPct.toFixed(1)}%`,
              sub: isAr
                ? `تقويمي: ${(k.calendarUtilizationPct ?? k.machineUtilizationPct).toFixed(1)}% · حجب: ${formatDuration(k.totalBlockedTimeSec)}`
                : `Cal: ${(k.calendarUtilizationPct ?? k.machineUtilizationPct).toFixed(1)}% · Blk: ${formatDuration(k.totalBlockedTimeSec)}`,
            },
          ].map((item, idx) => (
            <div
              key={idx}
              className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5"
            >
              <div className="text-[11px] font-medium text-neutral-500">{item.label}</div>
              <div className="mt-1 text-lg font-semibold font-mono-tabular text-neutral-900 dark:text-neutral-100 truncate">
                {item.val}
              </div>
              <div className="mt-1 text-[11px] font-mono-tabular text-neutral-500 break-words">{item.sub}</div>
            </div>
          ))}
        </div>

        {/* OEE & Formal Time Accounting Hierarchy */}
        <section className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-2.5 mb-3">
            <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {t.analytics.oeeSectionTitle}
            </h3>
            <span className="text-[11px] font-mono-tabular text-neutral-500">
              {t.labels.oee}:{' '}
              <bdi dir="ltr">
                {oeeSummaryText(k, language === 'ar')}
              </bdi>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-neutral-100 dark:border-neutral-800">
            <div>
              <div className="text-[11px] text-neutral-500">{t.labels.oee}</div>
              <div className="text-base font-semibold font-mono-tabular text-red-600 dark:text-red-400">
                {(k.oeePct ?? 0).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">{t.labels.availability}</div>
              <div className="text-base font-semibold font-mono-tabular text-neutral-900 dark:text-neutral-100">
                {(k.availabilityPct ?? 0).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">{t.labels.performance}</div>
              <div className="text-base font-semibold font-mono-tabular text-neutral-900 dark:text-neutral-100">
                {(k.actualProduction ?? 0) > 0 ? `${(k.performancePct ?? 0).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">{t.labels.quality}</div>
              <div className="text-base font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400">
                {(k.actualProduction ?? 0) > 0 ? `${(k.qualityPct ?? 100).toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>
          {!k.oeeMixedTimeWeighted && (k.actualProduction ?? 0) > 0 && (
            <div data-testid="performance-definition" className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {performanceDefinitionText(language === 'ar', project.products.length > 1)}
            </div>
          )}
          {!k.oeeMixedTimeWeighted && oeeBasisUsesSkippedStage(project.products, k.theoreticalBottleneckStageId) && (
            <div
              role="note"
              data-testid="oee-basis-warning"
              className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {language === 'ar'
                ? 'تنبيه: في منتج مساره بيتخطى أبطأ مرحلة في المشروع. OEE والأداء والاختناق النظري والإنتاجية النظرية وكفاءة الخط بتتحسب على كل مراحل المشروع مش على المسار ده، فممكن تبقى مبالغ فيها أو تشاور على مرحلة المسار بيتخطاها، حتى لو الأداء أقل من ١٠٠٪. في حالة العينة بس: مرحلة ٦٠ ث متخطاة وبعدها ٤٥ ث، الإنتاجية النظرية فضلت ٦٠/ساعة وحساب بسيط لمسار واحد (٣٦٠٠÷٤٥) يدّي ٨٠/ساعة، وده مش متحقق لتعدد المنتجات أو التوازي. الاختناق المقاس في بطاقة Bottleneck Stage جاي من التشغيل ومنفصل. ما تعتمدش على القيم دي قبل مراجعة الأساس.'
                : 'Note: a product route skips the slowest stage in the project. Line OEE, Performance, theoretical bottleneck, theoretical throughput and line efficiency are computed over all project stages, not that route, so they may be overstated or name a stage the route skips, even when Performance is below 100%. Sample case only: with a 60 s stage skipped and a 45 s next-slowest stage, theoretical throughput stays at 60/h while simple single-route arithmetic (3600/45) gives 80/h, not validated for multi-product or parallel capacity. The measured Bottleneck Stage comes from the run and is separate. Do not rely on these values until the basis is checked.'}
            </div>
          )}
          {project.products.length > 1 && (
            <div
              role="note"
              data-testid="oee-mixed-note"
              className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {stalledRun
                ? (k.actualProduction ?? 0) > 0
                  ? language === 'ar'
                    ? 'أكتر من منتج: التشغيل اتعلّق في النموذج. Performance وQuality وOEE المعروضة محسوبة من الوحدات القليلة اللي خلصت قبل التعليق بس، فمش مقياس للمصنع ومش لازم تتقارن بأي رقم. راجع تحذير التعليق فوق، وده مش قياس من مصنع حقيقي.'
                    : 'More than one product: the modeled run stalled. The Performance, Quality and OEE shown are computed from the few units that finished before the stall, so they are not a plant measure and should not be compared with other figures. See the stall warning above. This is a model result, not a measurement from a real plant.'
                  : language === 'ar'
                  ? 'أكتر من منتج: التشغيل اتعلّق في النموذج، فـPerformance وQuality مش معرّفين وOEE المعروض مش مقياس للمصنع. راجع تحذير التعليق فوق، وده مش قياس من مصنع حقيقي.'
                  : 'More than one product: the modeled run stalled, so Performance and Quality are undefined and the OEE shown is not a plant measure. See the stall warning above. This is a model result, not a measurement from a real plant.'
                : k.oeeMixedTimeWeighted
                ? language === 'ar'
                  ? `أكتر من منتج (حالات مجرّبة: كل المنتجات تلقائي وكل منتج بمساره الخاص، والمرحلة المتكررة بتتحسب مرة لكل زيارة): Performance وQuality وOEE محسوبين بزمن الدورة المثالي لكل منتج (موزونين بالزمن). نسبة الوحدات السليمة بالعدد: ${(k.unitYieldPct ?? 0).toFixed(1)}٪ (مقياس منفصل). التوجيه اليدوي خارج النطاق ده ولسه بالعدد، والمنتجات على خطوط منفصلة تماما: الشغل المثالي بيتقسم على عدد الخطوط × زمن التشغيل المشترك، يعني إجمالي زمن الإنتاج السليم على إجمالي الزمن المخطط، بافتراض إن كل خط له نفس زمن التشغيل؛ OEE النهائي سليم بالمعنى ده، لكن تقسيم Availability وPerformance ببيستخدم زمن تشغيل واحد على مستوى المشروع مش لكل خط، فمش أرقام لكل خط لوحده (حالة واحدة مجرّبة، قاعدة تجميع من ممارسين مش معيار، والخطوط بتقاويم مختلفة مش متحقق منها: المدقق في البرنامج بيرفض الورديات المتداخلة، فالحالة دي ماقدرتش تتشغّل في البرنامج)، والمسارات اللي بتشترك في بعض المراحل بس مش متحقق منها، والماكينات المتوازية في مرحلة والتكرار المتتالي اتجرّب كل واحد منهم على مثال واحد بس.`
                  : `More than one product (tested cases: all products auto-routed, each over its own route; a repeated stage counts once per visit; a route nested inside another): Performance, Quality and OEE are weighted by each product's own ideal cycle (time-weighted). Unit yield by count: ${(k.unitYieldPct ?? 0).toFixed(1)}% (a separate metric). Manual routing is outside this scope and stays count-based; products on fully separate lines: ideal work is divided by the number of lines times the shared operating time, i.e. total good output time over total planned time, assuming every line has the same operating time; final OEE is exact in that sense, but the Availability and Performance split uses one project-level operating time, not one per line, so it is not a per-line figure (one tested case, a practitioner roll-up rule, not a standard; lines with different calendars are not verified: the app's validator rejects overlapping shifts, so that case could not be run in the app); routes that share only some stages are not verified; parallel machines in one stage and a consecutive repeat were each checked on one fixture only.`
                : language === 'ar'
                ? 'تنبيه (أكتر من منتج): Quality هنا نسبة وحدات سليمة على إجمالي الوحدات (عدد)، ومش موزونة بزمن الدورة المثالي لكل منتج. لو المنتجات دورتها مختلفة، فالهالك في المنتج الأبطأ بيكلّف وقت خط أكتر، فـQuality وOEE ممكن يبقوا أعلى من النسخة الموزونة. الأداء بيستخدم متوسط زمن دورة واحد للمزيج مش لكل منتج. نسبة الوحدات السليمة نفسها مقياس منفصل وصحيح كعدد.' + (project.products.some((p) => p.routingMode === 'manual') ? ' سبب الأساس ده: في منتج واحد على الأقل بتوجيه يدوي، والتوجيه اليدوي ماشي على الرسم المشترك ومالوش مسار خاص، فزمن الدورة المثالي لكل منتج مش معرّف. ماتقارنش الـOEE ده بـOEE موزون بالزمن من منتجات بتوجيه تلقائي.' : '')
                : 'Note (more than one product): Quality here is good units divided by total units (a count), not weighted by each product\'s ideal cycle, and Performance uses one mix-average ideal cycle rather than one per product. When products have different cycle times, scrap on the slower product costs more line time, so Quality and OEE can read higher than a time-weighted figure. Unit yield itself is a valid separate count metric.' + (project.products.some((p) => p.routingMode === 'manual') ? ' Why this basis: at least one product uses manual routing, which follows the shared route graph and has no route of its own, so a per-product ideal cycle is not defined. Do not compare this OEE with a time-weighted one from auto-routed products.' : '')}
            </div>
          )}
          {k.performanceAnomaly && (
            <div
              role="alert"
              data-testid="oee-anomaly-warning"
              className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {language === 'ar'
                ? 'تحذير: الأداء أعلى من ١٠٠٪، وده بيتعلّم كحالة شاذة. زمن الدورة المثالي في OEE الخط ممكن يتاخد من أبطأ مرحلة في المشروع حتى لو مفيش منتج بيعدّي عليها (مثلاً مرحلة متخطاة)، فالأداء وOEE هنا ممكن يبقوا مبالغ فيهم. ما تعتمدش عليهم للتشغيل ده قبل مراجعة أساس زمن الدورة المثالي.'
                : 'Warning: Performance is above 100%, which the OEE check flags as an anomaly. Line OEE takes its ideal cycle from the slowest stage in the project, even when no product visits that stage (for example, a skipped stage), so OEE and Performance here may be overstated. Do not rely on them for this run until the ideal-cycle basis is checked.'}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.calendarTime}</div>
              <div className="font-mono-tabular font-semibold text-neutral-800 dark:text-neutral-200">
                {formatDuration(k.calendarTimeSec ?? result.simTimeSec)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.plannedDowntime}</div>
              <div className="font-mono-tabular font-semibold text-neutral-800 dark:text-neutral-200">
                {formatDuration(k.plannedDowntimeSec ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.scheduledTime}</div>
              <div className="font-mono-tabular font-semibold text-neutral-800 dark:text-neutral-200">
                {formatDuration(k.scheduledProductionTimeSec ?? result.simTimeSec)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.unplannedDowntime}</div>
              <div className="font-mono-tabular font-semibold text-red-600 dark:text-red-400">
                {formatDuration(k.unplannedDowntimeSec ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.setupTimeLabel}</div>
              <div className="font-mono-tabular font-semibold text-sky-700 dark:text-sky-400">
                {formatDuration(k.setupTimeSec ?? 0)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-neutral-500">{t.labels.operatingTime}</div>
              <div className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                {formatDuration(k.operatingTimeSec ?? result.simTimeSec)}
              </div>
            </div>
          </div>
        </section>

        {/* Charts 2x2 Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
              {t.analytics.charts.plannedVsActual}
            </h3>
            <div className="h-56">
              <canvas ref={hourlyCanvasRef} />
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
              {stalledRun
                ? isAr
                  ? 'زمن الدورة والانتظار لكل مرحلة (تعليق: لا يوجد اختناق مُحدد)'
                  : 'Stage Cycle & Waiting Time (stalled run: no bottleneck marked)'
                : t.analytics.charts.stageCycleWait}
            </h3>
            <div className="h-56">
              <canvas ref={stageCanvasRef} />
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
              {t.analytics.charts.resourceUtil}
            </h3>
            <div className="h-56">
              <canvas ref={utilCanvasRef} />
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
              {t.analytics.charts.wipShift}
            </h3>
            <div className="h-56">
              <canvas ref={wipCanvasRef} />
            </div>
          </div>
        </div>

        {/* Stage Breakdown Table */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
          <table className="w-full text-start text-xs font-mono-tabular">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-medium text-start">{t.analytics.table.stage}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.entered}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.completed}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.scrap}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.reworkUnits}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.avgCycle}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.avgWait}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.avgBatchWait}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.maxQueue}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.schedUtil}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.calUtil}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.setup}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.blocked}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.starved}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.idle}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.maint}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.unavail}</th>
                <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.oee}</th>
              </tr>
            </thead>
            <tbody>
              {result.stageAnalytics.map((sa) => (
                <tr
                  key={sa.stageId}
                  className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                >
                  <td className="px-4 py-2 font-sans font-medium text-neutral-900 dark:text-neutral-100">
                    {sa.stageName}
                    {sa.isBottleneck && !stalledRun && (
                      <span className="ms-2 text-[10px] font-semibold text-red-600">
                        {t.labels.bottleneck}
                      </span>
                    )}
                    {stalledRun && stallIdSet.has(sa.stageId) && (
                      <span className="ms-2 text-[10px] font-semibold text-amber-700">
                        {isAr ? 'نقطة التعليق' : 'Stall point'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">{sa.enteredCount}</td>
                  <td className="px-3 py-2 text-end">{sa.completedCount}</td>
                  <td className="px-3 py-2 text-end">{sa.scrapCount}</td>
                  <td className="px-3 py-2 text-end text-amber-700 dark:text-amber-400">
                    {sa.reworkCount}
                  </td>
                  <td className="px-3 py-2 text-end">{sa.avgCycleTimeSec.toFixed(1)}</td>
                  <td className="px-3 py-2 text-end">
                    {(sa.avgUnitWaitTimeSec ?? sa.avgWaitTimeSec).toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-end text-neutral-500">
                    {(sa.avgBatchWaitTimeSec ?? sa.avgWaitTimeSec).toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-end">{sa.maxQueueLength}</td>
                  <td className="px-3 py-2 text-end font-semibold text-emerald-700 dark:text-emerald-400">
                    {(sa.scheduledUtilizationPct ?? sa.utilizationPct).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-end">
                    {(sa.calendarUtilizationPct ?? sa.utilizationPct).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-end">{(sa.setupPct ?? 0).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-end">{sa.blockedPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-end">{sa.starvedPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-end">{(sa.idlePct ?? 0).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-end">{(sa.maintenancePct ?? 0).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-end text-neutral-500">
                    {(sa.unavailablePct ?? 0).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-end font-semibold text-neutral-900 dark:text-neutral-100">
                    {(sa.oeePct ?? 0).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Multi-Product Output & Attainment Breakdown */}
        {result.productAnalytics && result.productAnalytics.length > 0 && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {t.analytics.table.productAnalyticsTitle}
            </div>
            <table className="w-full text-start text-xs font-mono-tabular">
              <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-start">{t.analytics.table.productCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.plannedCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.entered}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.goodCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.scrap}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.reworkUnits}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.wipCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.leadTimeCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.labels.attainment}</th>
                </tr>
              </thead>
              <tbody>
                {result.productAnalytics.map((pa) => (
                  <tr
                    key={pa.productId}
                    className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className="px-4 py-2 font-sans font-medium text-neutral-900 dark:text-neutral-100">
                      <span className="font-mono-tabular text-[10px] text-neutral-500 me-1.5">
                        {pa.productCode}
                      </span>
                      {pa.productName}
                    </td>
                    <td className="px-3 py-2 text-end">{pa.plannedQty}</td>
                    <td className="px-3 py-2 text-end">{pa.releasedQty}</td>
                    <td className="px-3 py-2 text-end font-semibold text-emerald-700 dark:text-emerald-400">
                      {pa.completedGoodQty}
                    </td>
                    <td className="px-3 py-2 text-end text-red-600 dark:text-red-400">
                      {pa.scrappedQty}
                    </td>
                    <td className="px-3 py-2 text-end text-amber-700 dark:text-amber-400">
                      {pa.reworkUnits}
                    </td>
                    <td className="px-3 py-2 text-end">{pa.wipQty}</td>
                    <td className="px-3 py-2 text-end">{leadTimeText(pa.avgLeadTimeSec)}</td>
                    <td className="px-3 py-2 text-end font-semibold">
                      {pa.attainmentPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Resource-Level OEE & Calendar Accounting Breakdown */}
        {result.resourceAnalytics && result.resourceAnalytics.length > 0 && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {t.analytics.table.resourceOeeTitle}
            </div>
            <table className="w-full text-start text-xs font-mono-tabular">
              <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-start">{t.analytics.table.resourceCol}</th>
                  <th className="px-3 py-2.5 font-medium text-start">{t.analytics.table.shiftCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.labels.scheduledTime}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.labels.operatingTime}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.labels.unavailableTime}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.schedUtil}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.calUtil}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.avail}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.perf}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.qual}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.oee}</th>
                </tr>
              </thead>
              <tbody>
                {result.resourceAnalytics.map((ra) => (
                  <tr
                    key={ra.objectId}
                    className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className="px-4 py-2 font-sans font-medium text-neutral-900 dark:text-neutral-100">
                      {ra.objectName}
                    </td>
                    <td className="px-3 py-2 font-sans text-[11px] text-neutral-500">
                      {ra.shiftId || t.labels.plantDefaultShift}
                    </td>
                    <td className="px-3 py-2 text-end">{formatDuration(ra.scheduledProductionTimeSec)}</td>
                    <td className="px-3 py-2 text-end">{formatDuration(ra.operatingTimeSec)}</td>
                    <td className="px-3 py-2 text-end text-neutral-500">
                      {formatDuration(ra.unavailableTimeSec)}
                    </td>
                    <td className="px-3 py-2 text-end font-semibold text-emerald-700 dark:text-emerald-400">
                      {ra.scheduledUtilizationPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-end">{ra.calendarUtilizationPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-end">{ra.availabilityPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-end">{ra.performancePct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-end">{ra.qualityPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-end font-semibold text-red-600 dark:text-red-400">
                      {ra.oeePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Workforce & Conveyor Assignment Analysis (assignedTo) */}
        {result.workerAnalytics && result.workerAnalytics.length > 0 && (
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
            <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {t.analytics.table.workerAnalyticsTitle}
            </div>
            <table className="w-full text-start text-xs font-mono-tabular">
              <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-start">{t.analytics.table.workerCol}</th>
                  <th className="px-3 py-2.5 font-medium text-start">{t.analytics.table.assignedToCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.tasksCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.busyCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.walkingCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.idleCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.scheduledCol}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t.analytics.table.utilizationCol}</th>
                </tr>
              </thead>
              <tbody>
                {result.workerAnalytics.map((wa) => {
                  const isConv = wa.assignedToKind === 'conveyor';
                  const schedSec =
                    wa.scheduledTimeSec ??
                    wa.busyTimeSec + wa.walkingTimeSec + wa.idleTimeSec;
                  return (
                    <tr
                      key={wa.workerId}
                      className="border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                    >
                      <td className="px-4 py-2 font-sans font-medium text-neutral-900 dark:text-neutral-100">
                        {wa.workerLabel} · {wa.workerName}
                      </td>
                      <td className="px-3 py-2 font-sans text-[11px]">
                        {wa.assignedToName ? (
                          <span className="inline-flex items-center gap-1.5">
                            {isConv && (
                              <span className="rounded bg-blue-600/15 px-1.5 py-0.2 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                {t.analytics.table.conveyorTag}
                                {wa.assignedConveyorSegmentIndex !== undefined
                                  ? ` S${wa.assignedConveyorSegmentIndex + 1}`
                                  : ''}
                              </span>
                            )}
                            <span className="text-neutral-800 dark:text-neutral-200">{wa.assignedToName}</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">{t.analytics.table.unassignedLabel}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-end">{wa.tasksCompleted}</td>
                      <td className="px-3 py-2 text-end">{formatDuration(wa.busyTimeSec)}</td>
                      <td className="px-3 py-2 text-end">{formatDuration(wa.walkingTimeSec)}</td>
                      <td className="px-3 py-2 text-end text-neutral-500">
                        {formatDuration(wa.idleTimeSec)}
                      </td>
                      <td className="px-3 py-2 text-end text-neutral-600 dark:text-neutral-400">
                        {formatDuration(schedSec)}
                      </td>
                      <td className="px-3 py-2 text-end font-semibold text-emerald-700 dark:text-emerald-400">
                        {wa.utilizationPct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60 px-4 py-2 text-[10px] text-neutral-500 leading-relaxed">
              {t.analytics.table.workerMetricsNote}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
