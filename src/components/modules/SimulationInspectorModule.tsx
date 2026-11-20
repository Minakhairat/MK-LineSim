import React, { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatDuration, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';

export const SimulationInspectorModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const language = useAppStore((s) => s.language);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const selectItem = useAppStore((s) => s.selectItem);

  const t = getT(language);
  const isAr = language === 'ar';

  const [editingShift, setEditingShift] = useState(false);
  const [editingBreakId, setEditingBreakId] = useState<string | null>(null);

  const shift = project.simulationConfig.shifts[0];
  const bottleneckId = simSnapshot.result?.kpis.bottleneckStageId;

  return (
    <div className="flex flex-col gap-4 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
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
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-500 shrink-0" />
            <span className="truncate">{t.simStatus.idle}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-600 shrink-0" />
            <span className="truncate">{t.simStatus.blocked}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-600 shrink-0" />
            <span className="truncate">{t.simStatus.down}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
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
        <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto min-w-0">
          {project.stages.map((st) => {
            const objId = st.assignedObjectIds[0];
            const rt = objId ? simSnapshot.objects[objId] : undefined;
            const isBn = bottleneckId === st.id && simSnapshot.clockSec > 0;
            const stKey = (rt?.status ?? 'idle') as keyof typeof t.simStatus;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => objId && selectItem('object', objId)}
                className={`flex items-center justify-between rounded border p-2 text-start transition-colors min-w-0 ${
                  isBn
                    ? 'border-red-500 bg-red-50/50 dark:bg-red-950/25'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {st.code} {st.name}
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
    </div>
  );
};
