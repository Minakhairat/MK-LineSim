import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Play,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';
import { runAllEngineeringBenchmarks } from '../../simulation/benchmarkEngine';
import { BenchmarkSuiteSummary } from '../../types/project';

type FilterMode = 'all' | 'passed' | 'failed';

export const EngineeringValidationCenterModule: React.FC = () => {
  const validationIssues = useAppStore((s) => s.validationIssues);
  const language = useAppStore((s) => s.language);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);

  const t = getT(language);
  const isAr = language === 'ar';

  const [summary, setSummary] = useState<BenchmarkSuiteSummary>(() => runAllEngineeringBenchmarks());
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const handleRerun = () => {
    const next = runAllEngineeringBenchmarks();
    setSummary(next);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredResults = useMemo(() => {
    if (filter === 'passed') return summary.results.filter((r) => r.passed);
    if (filter === 'failed') return summary.results.filter((r) => !r.passed);
    return summary.results;
  }, [summary.results, filter]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-6">
        {/* Top Section Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t.validationCenter.title}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500 max-w-3xl">
              {t.validationCenter.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRerun}
              className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t.validationCenter.rerunAll}</span>
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                isFullscreen
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
              </span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">{t.validationCenter.totalTests}</div>
            <div className="mt-1 text-xl font-semibold font-mono-tabular text-neutral-900 dark:text-neutral-100">
              {summary.totalTests}
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">{t.validationCenter.passedTests}</div>
            <div className="mt-1 text-xl font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400">
              {summary.passedTests}
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">{t.validationCenter.failedTests}</div>
            <div
              className={`mt-1 text-xl font-semibold font-mono-tabular ${
                summary.failedTests > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-neutral-900 dark:text-neutral-100'
              }`}
            >
              {summary.failedTests}
            </div>
          </div>
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5">
            <div className="text-[11px] font-medium text-neutral-500">{t.validationCenter.execTime}</div>
            <div className="mt-1 text-xl font-semibold font-mono-tabular text-neutral-900 dark:text-neutral-100">
              {summary.totalExecutionMs.toFixed(1)} ms
            </div>
          </div>
        </div>

        {/* Active Project Engineering Audit */}
        <section className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-neutral-100 dark:border-neutral-800">
            <h3 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {t.validationCenter.projectAuditTitle}
            </h3>
            <span className="text-[11px] font-mono-tabular text-neutral-500">
              {validationIssues.length} {t.labels.issuesCount}
            </span>
          </div>
          {validationIssues.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t.validationCenter.projectClean}</span>
            </div>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
              {validationIssues.map((issue) => (
                <div key={issue.id} className="flex items-start gap-2.5 py-2 text-xs">
                  {issue.severity === 'error' ? (
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
                      <span>{issue.code}</span>
                      {issue.resourceName && (
                        <span className="text-[10px] font-normal text-neutral-500">· {issue.resourceName}</span>
                      )}
                    </div>
                    <div className="text-neutral-700 dark:text-neutral-300">
                      {isAr && issue.messageAr ? issue.messageAr : issue.message}
                    </div>
                    {(issue.recommendation || issue.recommendationAr) && (
                      <div className="mt-0.5 text-[11px] text-neutral-500">
                        {t.labels.recommendation}: {isAr && issue.recommendationAr ? issue.recommendationAr : issue.recommendation}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Segmented Filter Control */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1">
            {(
              [
                { id: 'all', label: `${t.validationCenter.filterAll} (${summary.totalTests})` },
                { id: 'passed', label: `${t.validationCenter.filterPassed} (${summary.passedTests})` },
                { id: 'failed', label: `${t.validationCenter.filterFailed} (${summary.failedTests})` },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilter(btn.id)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === btn.id
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-mono-tabular text-neutral-500">
            {new Date(summary.ranAt).toLocaleTimeString()}
          </span>
        </div>

        {/* Benchmark Cases Table */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-800">
          {filteredResults.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-500">
              {t.validationCenter.noMatchingTests}
            </div>
          ) : (
            filteredResults.map((bm) => {
              const isExpanded = expandedIds[bm.id] ?? !bm.passed;
              return (
                <div key={bm.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleExpand(bm.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                          <span>{isAr ? bm.nameAr : bm.name}</span>
                          <span className="text-[11px] font-normal text-neutral-400">·</span>
                          <span className="text-[11px] font-normal text-neutral-500">
                            {isAr ? bm.categoryAr : bm.category}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono-tabular text-[10px] font-medium ${
                              bm.verificationTier === 'math'
                                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {bm.verificationTier === 'math'
                              ? t.validationCenter.tierMath
                              : t.validationCenter.tierDes}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-neutral-500">
                          {isAr ? bm.descriptionAr : bm.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-mono-tabular text-[11px] text-neutral-500">
                        {bm.executionMs.toFixed(1)} ms
                      </span>
                      <span
                        className={`flex items-center gap-1 font-mono-tabular text-[11px] font-semibold ${
                          bm.passed
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {bm.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {bm.passed ? t.validationCenter.statusPass : t.validationCenter.statusFail}
                        </span>
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60 px-4 py-3 overflow-x-auto">
                      {(bm.engineeringConcept || bm.inputSummary || bm.explanation) && (
                        <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5 text-[11px]">
                          {(bm.engineeringConcept || bm.engineeringConceptAr) && (
                            <div>
                              <span className="font-semibold text-neutral-500">{t.validationCenter.concept}: </span>
                              <span className="text-neutral-800 dark:text-neutral-200">
                                {isAr ? bm.engineeringConceptAr || bm.engineeringConcept : bm.engineeringConcept}
                              </span>
                            </div>
                          )}
                          {(bm.inputSummary || bm.inputSummaryAr) && (
                            <div>
                              <span className="font-semibold text-neutral-500">{t.validationCenter.inputs}: </span>
                              <span className="font-mono-tabular text-neutral-800 dark:text-neutral-200">
                                {isAr ? bm.inputSummaryAr || bm.inputSummary : bm.inputSummary}
                              </span>
                            </div>
                          )}
                          {(bm.explanation || bm.explanationAr) && (
                            <div>
                              <span className="font-semibold text-neutral-500">{t.validationCenter.explanation}: </span>
                              <span className="text-neutral-800 dark:text-neutral-200">
                                {isAr ? bm.explanationAr || bm.explanation : bm.explanation}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {bm.failureReason && (
                        <div className="mb-2 text-[11px] font-mono-tabular text-red-600 dark:text-red-400">
                          {bm.failureReason}
                        </div>
                      )}
                      <table className="w-full text-xs font-mono-tabular">
                        <thead className="border-b border-neutral-200 dark:border-neutral-800 text-[10px] text-neutral-500">
                          <tr>
                            <th className="py-1.5 text-start font-medium">{t.validationCenter.colMetric}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colExpected}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colActual}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colAbsErr}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colPctErr}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colTolerance}</th>
                            <th className="py-1.5 text-end font-medium">{t.validationCenter.colStatus}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200/70 dark:divide-neutral-800/70">
                          {bm.metrics.map((m, idx) => (
                            <tr key={idx}>
                              <td className="py-1.5 font-sans font-medium text-neutral-800 dark:text-neutral-200">
                                {isAr && m.metricAr ? m.metricAr : m.metric}{' '}
                                <span className="text-[10px] text-neutral-400">({m.unit})</span>
                              </td>
                              <td className="py-1.5 text-end">{m.expected}</td>
                              <td className="py-1.5 text-end font-semibold text-neutral-900 dark:text-neutral-100">
                                {m.actual}
                              </td>
                              <td className="py-1.5 text-end">{m.absError}</td>
                              <td className="py-1.5 text-end">{m.pctError.toFixed(2)}%</td>
                              <td className="py-1.5 text-end text-neutral-500">±{m.toleranceAbs}</td>
                              <td
                                className={`py-1.5 text-end font-semibold ${
                                  m.passed
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                {m.passed ? t.validationCenter.statusPass : t.validationCenter.statusFail}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
