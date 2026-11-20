import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Link2,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatDuration } from '../../utils/units';
import { getT } from '../../i18n/translations';

export const BottomSimPanel: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const simWorkerBusy = useAppStore((s) => s.simWorkerBusy);
  const language = useAppStore((s) => s.language);

  const startSimulation = useAppStore((s) => s.startSimulation);
  const pauseSimulation = useAppStore((s) => s.pauseSimulation);
  const resumeSimulation = useAppStore((s) => s.resumeSimulation);
  const stopSimulation = useAppStore((s) => s.stopSimulation);
  const resetSimulation = useAppStore((s) => s.resetSimulation);
  const stepSimulationEvent = useAppStore((s) => s.stepSimulationEvent);
  const runFullShiftSimulation = useAppStore((s) => s.runFullShiftSimulation);
  const updateSimConfig = useAppStore((s) => s.updateSimConfig);
  const autoWireForSimulation = useAppStore((s) => s.autoWireForSimulation);

  const [logOpen, setLogOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('ALL');

  const t = getT(language);
  const needsAutoWire =
    project.layoutObjects.some((o) => o.kind === 'conveyor' || o.kind === 'workstation' || o.kind === 'machine') &&
    (project.stages.length === 0 || (project.products[0]?.routeStageIds.length ?? 0) === 0);
  const duration = Math.max(1, project.simulationConfig.durationSec);
  const progressPct = Math.min(100, (simSnapshot.clockSec / duration) * 100);
  const kpis = simSnapshot.result?.kpis;

  const filteredEvents =
    eventFilter === 'ALL'
      ? simSnapshot.recentEvents
      : simSnapshot.recentEvents.filter((e) => e.type === eventFilter);

  return (
    <div className="flex flex-col border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* Expandable Event Log Drawer */}
      {logOpen && (
        <div className="h-44 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 flex flex-col">
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-neutral-200 dark:border-neutral-800">
            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
              {t.labels.eventLog} ({simSnapshot.totalEventsExecuted})
            </span>
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-0.5 text-[11px]"
            >
              <option value="ALL">{t.labels.allEventTypes}</option>
              <option value="ProductCreated">ProductCreated</option>
              <option value="ProductArrived">ProductArrived</option>
              <option value="WorkerAssigned">WorkerAssigned</option>
              <option value="ProcessingStarted">ProcessingStarted</option>
              <option value="ProcessingCompleted">ProcessingCompleted</option>
              <option value="ProductTransferred">ProductTransferred</option>
              <option value="BufferFull">BufferFull</option>
              <option value="BreakdownStarted">BreakdownStarted</option>
              <option value="ProductScrapped">ProductScrapped</option>
              <option value="ProductCompleted">ProductCompleted</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-1 font-mono-tabular text-[11px]">
            {filteredEvents.length === 0 ? (
              <div className="py-6 text-center text-neutral-500">
                {t.labels.noEventsYet}
              </div>
            ) : (
              [...filteredEvents].reverse().map((ev) => (
                <div
                  key={ev.seq}
                  className="grid grid-cols-[75px_150px_1fr] gap-3 py-0.5 border-b border-neutral-200/50 dark:border-neutral-800/50 text-neutral-700 dark:text-neutral-300"
                >
                  <span className="text-neutral-500">{formatDuration(ev.timestamp)}</span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">{ev.type}</span>
                  <span className="truncate">{ev.details}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Primary Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
        {/* Simulation transport buttons */}
        <div className="flex items-center gap-1.5">
          {simSnapshot.status === 'idle' || simSnapshot.status === 'completed' ? (
            <button
              onClick={startSimulation}
              className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t.actions.start}</span>
            </button>
          ) : simSnapshot.status === 'running' ? (
            <button
              onClick={pauseSimulation}
              className="flex items-center gap-1.5 rounded bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-xs font-medium text-white dark:text-neutral-900 whitespace-nowrap shrink-0"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>{t.actions.pause}</span>
            </button>
          ) : (
            <button
              onClick={resumeSimulation}
              className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t.actions.resume}</span>
            </button>
          )}

          <button
            onClick={stepSimulationEvent}
            title={t.actions.step}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            <StepForward className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.actions.step}</span>
          </button>

          <button
            onClick={stopSimulation}
            disabled={simSnapshot.status === 'idle'}
            title={t.actions.stop}
            className="p-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={resetSimulation}
            title={t.actions.reset}
            className="p-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => runFullShiftSimulation()}
            disabled={simWorkerBusy}
            className="flex items-center gap-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FastForward className="w-3.5 h-3.5 text-red-600" />
            <span>{simWorkerBusy ? t.actions.computing : t.actions.runFullShift}</span>
          </button>

          {needsAutoWire && (
            <button
              onClick={() => autoWireForSimulation()}
              className="flex items-center gap-1 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 whitespace-nowrap shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{t.actions.autoWire}</span>
            </button>
          )}

          <select
            value={project.simulationConfig.speedMultiplier}
            onChange={(e) => updateSimConfig({ speedMultiplier: Number(e.target.value) })}
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-xs font-mono-tabular"
            title={t.labels.speedMultiplier}
          >
            <option value={1}>{language === 'ar' ? '1× حقيقي' : '1× Real'}</option>
            <option value={10}>10×</option>
            <option value={30}>30×</option>
            <option value={60}>60×</option>
            <option value={150}>150×</option>
            <option value={400}>400×</option>
          </select>
        </div>

        {/* Timeline Scrub / Clock */}
        <div className="flex flex-1 items-center gap-3 min-w-[200px] max-w-md">
          <span className="text-xs font-mono-tabular text-neutral-700 dark:text-neutral-200 whitespace-nowrap">
            {formatDuration(simSnapshot.clockSec)} / {formatDuration(duration)}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-red-600 transition-all duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
            {simSnapshot.onBreak
              ? t.simStatus.onBreak
              : t.simStatus[simSnapshot.status] || simSnapshot.status}
          </span>
        </div>

        {/* Live KPI summary & Event Log Toggle */}
        <div className="flex items-center gap-4 text-xs font-mono-tabular">
          <div className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300">
            <span>
              {t.labels.good}: <strong className="text-neutral-950 dark:text-white">{kpis?.goodUnits ?? 0}</strong>
            </span>
            <span>
              {t.labels.wip}: <strong className="text-neutral-950 dark:text-white">{simSnapshot.products.length}</strong>
            </span>
            {kpis?.bottleneckStageName && (
              <span className="hidden xl:inline text-amber-700 dark:text-amber-400">
                {t.labels.bottleneck}: <strong>{kpis.bottleneckStageName}</strong>
              </span>
            )}
          </div>
          <button
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            {logOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            <span>{t.labels.events} ({simSnapshot.totalEventsExecuted})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
