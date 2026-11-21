import React, { useState } from 'react';
import { Flame, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatDuration, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';
import {
  computeObjectHeatmapMetrics,
  HEATMAP_LEGEND_STOPS,
  resolveHeatmapActiveTimeSec,
} from '../../simulation/heatmap';

export const SimulationInspectorModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const language = useAppStore((s) => s.language);
  const heatmapOverlayEnabled = useAppStore((s) => s.heatmapOverlayEnabled);
  const toggleHeatmapOverlay = useAppStore((s) => s.toggleHeatmapOverlay);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const selectItem = useAppStore((s) => s.selectItem);

  const t = getT(language);
  const isAr = language === 'ar';

  const [editingShift, setEditingShift] = useState(false);
  const [editingBreakId, setEditingBreakId] = useState<string | null>(null);

  const shift = project.simulationConfig.shifts[0];
  const bottleneckId = simSnapshot.result?.kpis.bottleneckStageId;
  const activeHeatWindowSec = resolveHeatmapActiveTimeSec(
    project.simulationConfig,
    project.products[0],
    simSnapshot.clockSec
  );

  const heatRows = project.layoutObjects
    .filter(
      (obj) =>
        obj.rendering.visible &&
        obj.kind !== 'storage' &&
        obj.kind !== 'vehicle'
    )
    .map((obj) => {
      const stage = project.stages.find((s) => s.assignedObjectIds.includes(obj.id) || s.id === obj.stageId);
      const isStageBn = Boolean(stage && bottleneckId === stage.id && simSnapshot.clockSec > 0);
      const metrics = computeObjectHeatmapMetrics({
        obj,
        runtime: simSnapshot.objects[obj.id],
        clockSec: simSnapshot.clockSec,
        activeSimTimeSec: activeHeatWindowSec,
        isStageBottleneck: isStageBn,
      });
      return { obj, stage, metrics };
    })
    .sort((a, b) => {
      const scoreA = a.metrics.downPct * 2 + a.metrics.utilPct + (a.metrics.isBottleneck ? 40 : 0);
      const scoreB = b.metrics.downPct * 2 + b.metrics.utilPct + (b.metrics.isBottleneck ? 40 : 0);
      return scoreB - scoreA;
    });

  return (
    <div className="flex flex-col gap-4 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
      {/* 2D/3D Utilization vs. Downtime Heatmap Overlay Control */}
      <section className="flex flex-col gap-2 rounded border border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/15 p-2.5 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flame className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {t.simInspector.heatmapTitle}
            </h3>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-neutral-600 dark:text-neutral-400">
          {t.simInspector.heatmapDesc}
        </p>

        <button
          type="button"
          onClick={toggleHeatmapOverlay}
          aria-pressed={heatmapOverlayEnabled}
          className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
            heatmapOverlayEnabled
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
          <Flame className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {heatmapOverlayEnabled ? t.simInspector.heatmapOn : t.simInspector.heatmapOff}
          </span>
        </button>

        {/* Thermal Scale Legend */}
        <div className="grid grid-cols-2 gap-1 text-[10px] pt-0.5 min-w-0">
          {HEATMAP_LEGEND_STOPS.map((stop) => (
            <div key={stop.tier} className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0 border border-black/15"
                style={{ backgroundColor: stop.colorHex }}
              />
              <span className="truncate text-neutral-700 dark:text-neutral-300">
                {t.simInspector.heatmapLegend[stop.tier]}
              </span>
            </div>
          ))}
        </div>

        {/* Per-Machine Utilization vs. Downtime Mini Matrix */}
        {simSnapshot.clockSec === 0 ? (
          <div className="text-[10px] text-neutral-500 pt-0.5">
            {t.simInspector.heatmapIdleHint}
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pt-1 min-w-0">
            {heatRows.map(({ obj, stage, metrics }) => (
              <button
                key={`heat_row_${obj.id}`}
                type="button"
                onClick={() => selectItem('object', obj.id)}
                className="flex flex-col gap-0.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-start hover:bg-neutral-50 dark:hover:bg-neutral-800/60 min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: metrics.colorHex }}
                    />
                    <span className="text-[10px] font-medium truncate">
                      {stage?.code ? `${stage.code} · ` : ''}
                      {obj.name}
                    </span>
                  </div>
                  <span className="font-mono-tabular text-[10px] font-semibold shrink-0 text-neutral-700 dark:text-neutral-200">
                    {metrics.utilPct.toFixed(0)}% / {metrics.downPct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1 w-full rounded bg-neutral-200 dark:bg-neutral-800 overflow-hidden flex">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.min(100, metrics.utilPct)}%`,
                      backgroundColor: metrics.tier === 'downtime' ? '#10B981' : metrics.colorHex,
                    }}
                  />
                  {metrics.downPct > 0 && (
                    <div
                      className="h-full bg-purple-600"
                      style={{ width: `${Math.min(100 - metrics.utilPct, metrics.downPct)}%` }}
                    />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Status Color Legend */}
      <section className="rounded border border-neutral-200 dark:border-neutral-800 p-2.5 min-w-0">
        <div className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 mb-2">
          {t.simInspector.colorKey}
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 shrink-0" />
            <span className="truncate">{t.simStatus.running}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-600 shrink-0" />
            <span className="truncate">{t.simStatus.setup}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-500 shrink-0" />
            <span className="truncate">{t.simStatus.idle}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-yellow-600 shrink-0" />
            <span className="truncate">{t.simStatus.starved}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-600 shrink-0" />
            <span className="truncate">{t.simStatus.blocked}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-violet-600 shrink-0" />
            <span className="truncate">{t.simStatus.maintenance}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-600 shrink-0" />
            <span className="truncate">{t.simStatus.down}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-600 shrink-0" />
            <span className="truncate">{t.simStatus.inProcess}</span>
          </div>
        </div>
      </section>

      {/* Shift & Breaks Config */}
      {shift && (
        <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {t.simInspector.shiftBreaks}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setEditingShift(!editingShift)}
                title={t.actions.edit}
                className={`p-1 rounded border ${
                  editingShift
                    ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                    : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  commitProjectEdit((draft) => {
                    const s0 = draft.simulationConfig.shifts[0];
                    if (s0) {
                      s0.breaks.push({
                        id: uid('brk'),
                        name: isAr ? `استراحة ${s0.breaks.length + 1}` : `Break ${s0.breaks.length + 1}`,
                        startSec: 7200,
                        durationSec: 900,
                      });
                    }
                  })
                }
                className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 text-[11px]"
              >
                <Plus className="w-3 h-3" />
                <span>{t.simInspector.addBreak}</span>
              </button>
            </div>
          </div>

          <div className="text-[11px] font-mono-tabular text-neutral-500 truncate">
            {shift.name} · {formatDuration(shift.durationSec)}
          </div>

          {editingShift && (
            <div className="grid grid-cols-2 gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5 min-w-0">
              <input
                type="text"
                value={shift.name}
                onChange={(e) =>
                  commitProjectEdit((draft) => {
                    if (draft.simulationConfig.shifts[0]) {
                      draft.simulationConfig.shifts[0].name = e.target.value;
                    }
                  })
                }
                className="col-span-2 w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
              />
              <label className="col-span-2 flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] text-neutral-500">{t.labels.shiftDurationSec}</span>
                <input
                  type="number"
                  step={600}
                  min={600}
                  value={shift.durationSec}
                  onChange={(e) =>
                    commitProjectEdit((draft) => {
                      const v = Math.max(600, Math.round(Number(e.target.value)));
                      if (draft.simulationConfig.shifts[0]) {
                        draft.simulationConfig.shifts[0].durationSec = v;
                      }
                      draft.simulationConfig.durationSec = v;
                    })
                  }
                  className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                />
              </label>
            </div>
          )}

          {shift.breaks.map((brk) => {
            const isEditingBrk = editingBreakId === brk.id;
            return (
              <div
                key={brk.id}
                className="flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-[11px] min-w-0"
              >
                <div className="flex items-center justify-between gap-1 min-w-0">
                  <span className="truncate font-medium">{brk.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono-tabular text-[10px] text-neutral-500">
                      @{formatDuration(brk.startSec)} ({Math.round(brk.durationSec / 60)}m)
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingBreakId(isEditingBrk ? null : brk.id)}
                      title={t.actions.edit}
                      className="text-neutral-600 dark:text-neutral-300 hover:text-red-600"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProjectEdit((draft) => {
                          const s0 = draft.simulationConfig.shifts[0];
                          if (s0) s0.breaks = s0.breaks.filter((b) => b.id !== brk.id);
                        })
                      }
                      title={t.actions.delete}
                      className="text-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {isEditingBrk && (
                  <div className="grid grid-cols-3 gap-1 rounded bg-neutral-50 dark:bg-neutral-950 p-1 min-w-0">
                    <input
                      type="text"
                      value={brk.name}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.simulationConfig.shifts[0]?.breaks.find((b) => b.id === brk.id);
                          if (target) target.name = e.target.value;
                        })
                      }
                      className="col-span-3 w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    />
                    <input
                      type="number"
                      step={300}
                      min={0}
                      value={brk.startSec}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.simulationConfig.shifts[0]?.breaks.find((b) => b.id === brk.id);
                          if (target) target.startSec = Math.max(0, Number(e.target.value));
                        })
                      }
                      title="Start (s)"
                      className="col-span-2 w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                    />
                    <input
                      type="number"
                      step={60}
                      min={60}
                      value={Math.round(brk.durationSec / 60)}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.simulationConfig.shifts[0]?.breaks.find((b) => b.id === brk.id);
                          if (target) target.durationSec = Math.max(60, Number(e.target.value) * 60);
                        })
                      }
                      title="Duration (min)"
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Live Station Monitor */}
      <section className="flex flex-col gap-1.5 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.simInspector.liveStations}
        </h3>
        <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto min-w-0">
          {project.stages.map((st) => {
            const objId = st.assignedObjectIds[0];
            const rt = objId ? simSnapshot.objects[objId] : undefined;
            const batchInfo = simSnapshot.stageBatches?.[st.id];
            const isBn = bottleneckId === st.id && simSnapshot.clockSec > 0;
            const stKey = (rt?.status ?? 'idle') as keyof typeof t.simStatus;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => objId && selectItem('object', objId)}
                className={`flex items-center justify-between gap-1.5 rounded border p-2 text-start transition-colors min-w-0 ${
                  isBn
                    ? 'border-red-500 bg-red-50/50 dark:bg-red-950/25'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">
                      {st.code} {st.name}
                    </span>
                    {batchInfo && batchInfo.targetBatchSize > 1 && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.2 font-mono-tabular text-[9px] font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                        {batchInfo.bufferedItems}/{batchInfo.targetBatchSize}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono-tabular text-neutral-500 truncate">
                    {t.simInspector.done}: {rt?.processedCount ?? 0} · {t.simInspector.status}:{' '}
                    {t.simStatus[stKey] || rt?.status || 'idle'}
                  </div>
                </div>
                {isBn && (
                  <span className="text-[10px] font-semibold text-red-600 shrink-0">
                    {t.labels.bottleneck}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Diagnostic Panel: Theoretical vs. Actual Throughput & Cycle Deviation Insights */}
      <section className="flex flex-col gap-2.5 border-t border-neutral-200 dark:border-neutral-800 pt-3 min-w-0">
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {t.simInspector.diagnosticsTitle}
          </h3>
          {simSnapshot.result && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold shrink-0 ${
                (simSnapshot.result.kpis.throughputVariancePct ?? 0) >= -2
                  ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                  : (simSnapshot.result.kpis.throughputVariancePct ?? 0) >= -12
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : 'bg-red-600/15 text-red-700 dark:text-red-400'
              }`}
            >
              {(simSnapshot.result.kpis.throughputVariancePct ?? 0) > 0 ? '+' : ''}
              {(simSnapshot.result.kpis.throughputVariancePct ?? 0).toFixed(1)}%
            </span>
          )}
        </div>

        {!simSnapshot.result || simSnapshot.clockSec === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 dark:border-neutral-700 p-2.5 text-[11px] text-neutral-500">
            {t.simInspector.runToDiagnose}
          </div>
        ) : (
          (() => {
            const kpis = simSnapshot.result.kpis;
            const theoRate = kpis.theoreticalThroughputPerHour ?? 0;
            const actRate = kpis.throughputPerHour ?? 0;
            const ratioPct = theoRate > 0 ? Math.min(100, Math.max(0, (actRate / theoRate) * 100)) : 100;
            const bnShifted =
              kpis.theoreticalBottleneckStageId &&
              kpis.bottleneckStageId &&
              kpis.theoreticalBottleneckStageId !== kpis.bottleneckStageId;

            const rankedStages = [...simSnapshot.result.stageAnalytics].sort((a, b) => {
              if (a.isBottleneck !== b.isBottleneck) return a.isBottleneck ? -1 : 1;
              const scoreA =
                Math.abs(a.cycleDeviationPct || 0) + a.blockedPct * 1.5 + a.downPct * 3 + (a.avgWaitTimeSec > 2 ? 10 : 0);
              const scoreB =
                Math.abs(b.cycleDeviationPct || 0) + b.blockedPct * 1.5 + b.downPct * 3 + (b.avgWaitTimeSec > 2 ? 10 : 0);
              return scoreB - scoreA;
            });

            const activeBatches = simSnapshot.stageBatches
              ? Object.values(simSnapshot.stageBatches).filter((sb) => sb.targetBatchSize > 1)
              : [];

            return (
              <div className="flex flex-col gap-2 min-w-0">
                {/* Theoretical vs Actual Throughput Comparison */}
                <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2 min-w-0">
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[10px] text-neutral-500 truncate">
                        {t.simInspector.theoreticalRate}
                      </div>
                      <div className="font-mono-tabular text-sm font-bold text-neutral-900 dark:text-neutral-100">
                        {theoRate.toFixed(1)}{' '}
                        <span className="text-[10px] font-normal text-neutral-500">
                          {t.simInspector.unitsPerHour}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-neutral-500 truncate">
                        {t.simInspector.actualRate}
                      </div>
                      <div className="font-mono-tabular text-sm font-bold text-red-600 dark:text-red-400">
                        {actRate.toFixed(1)}{' '}
                        <span className="text-[10px] font-normal text-neutral-500">
                          {t.simInspector.unitsPerHour}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        ratioPct >= 97
                          ? 'bg-emerald-600'
                          : ratioPct >= 85
                          ? 'bg-amber-500'
                          : 'bg-red-600'
                      }`}
                      style={{ width: `${ratioPct}%` }}
                    />
                  </div>
                  {(kpis.totalBatchesCompleted ?? 0) > 0 && (
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono-tabular text-neutral-500">
                      <span>{t.simInspector.batchesSummary}: {kpis.totalBatchesCompleted}</span>
                      <span>
                        {(kpis.avgBatchSize ?? 1).toFixed(1)} {t.simInspector.avgBatchItems}
                      </span>
                    </div>
                  )}
                </div>

                {/* Theoretical vs Measured Bottleneck Alignment */}
                <div
                  className={`rounded border p-2 text-[10px] min-w-0 ${
                    bnShifted
                      ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                      : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-neutral-500 dark:text-neutral-400 truncate">
                      {t.simInspector.theoreticalBottleneck}:
                    </span>
                    <span className="font-semibold truncate">
                      {kpis.theoreticalBottleneckStageName || '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="text-neutral-500 dark:text-neutral-400 truncate">
                      {t.simInspector.measuredBottleneck}:
                    </span>
                    <span className="font-semibold text-red-600 dark:text-red-400 truncate">
                      {kpis.bottleneckStageName || '—'}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] opacity-90">
                    {bnShifted ? t.simInspector.bottleneckShifted : t.simInspector.bottleneckMatched}
                  </div>
                </div>

                {/* Live Batch Staging Queues */}
                {activeBatches.length > 0 && (
                  <div className="rounded border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15 p-2 flex flex-col gap-1 min-w-0">
                    <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 truncate">
                      {t.simInspector.batchStaging}
                    </div>
                    {activeBatches.map((sb) => {
                      const st = project.stages.find((s) => s.id === sb.stageId);
                      const pct = Math.min(100, (sb.bufferedItems / Math.max(1, sb.targetBatchSize)) * 100);
                      return (
                        <div key={sb.stageId} className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center justify-between text-[10px] min-w-0">
                            <span className="truncate">{st?.code} {st?.name}</span>
                            <span className="font-mono-tabular shrink-0">
                              {sb.bufferedItems}/{sb.targetBatchSize} {t.simInspector.stagedItems}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded bg-amber-200/70 dark:bg-amber-950 overflow-hidden">
                            <div className="h-full bg-amber-600" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Per-Stage Cycle Time Deviations & Insights */}
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto min-w-0">
                  {rankedStages.map((sa) => {
                    const stDef = project.stages.find((s) => s.id === sa.stageId);
                    const objId = stDef?.assignedObjectIds[0];
                    const cfgCycle = sa.configuredCycleTimeSec ?? 0;
                    const devPct = sa.cycleDeviationPct ?? 0;
                    const hasIssue =
                      sa.isBottleneck ||
                      (sa.bottleneckReasonCode && sa.bottleneckReasonCode !== 'balanced');
                    return (
                      <button
                        key={sa.stageId}
                        type="button"
                        onClick={() => objId && selectItem('object', objId)}
                        className={`flex flex-col gap-1 rounded border p-2 text-start transition-colors min-w-0 ${
                          sa.isBottleneck
                            ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20'
                            : hasIssue
                            ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/25 dark:bg-amber-950/10'
                            : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 min-w-0 w-full">
                          <span className="font-semibold text-[11px] truncate">
                            {stDef?.code ? `${stDef.code} ` : ''}
                            {sa.stageName}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {(sa.batchSize ?? 1) > 1 && (
                              <span className="rounded bg-amber-500/15 px-1 py-0.2 font-mono-tabular text-[9px] font-semibold text-amber-700 dark:text-amber-400">
                                ×{sa.batchSize}
                              </span>
                            )}
                            {Math.abs(devPct) >= 1 && (
                              <span
                                className={`font-mono-tabular text-[10px] font-semibold ${
                                  devPct > 2.5
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                {devPct > 0 ? '+' : ''}
                                {devPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono-tabular text-neutral-600 dark:text-neutral-400">
                          <span>
                            {t.simInspector.userCycle}: {cfgCycle.toFixed(1)}s
                          </span>
                          <span>
                            {t.simInspector.measuredCycle}: {sa.avgCycleTimeSec.toFixed(1)}s
                          </span>
                          <span>
                            {t.simInspector.waitLabel}: {sa.avgWaitTimeSec.toFixed(1)}s
                          </span>
                          {sa.blockedPct >= 0.5 && (
                            <span className="text-amber-700 dark:text-amber-400">
                              {t.simInspector.blockedLabel}: {sa.blockedPct.toFixed(0)}%
                            </span>
                          )}
                        </div>

                        {(sa.bottleneckReasonDetail || sa.bottleneckReasonDetailAr) && (
                          <div className="text-[10px] leading-snug text-neutral-600 dark:text-neutral-300">
                            {isAr ? sa.bottleneckReasonDetailAr : sa.bottleneckReasonDetail}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()
        )}
      </section>
    </div>
  );
};
