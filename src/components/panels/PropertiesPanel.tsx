import React from 'react';
import { AlertTriangle, CheckCircle2, Lock, Trash2, Unlock, Eye, EyeOff, Wrench } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { fromMeters, toMeters } from '../../utils/units';
import { getT } from '../../i18n/translations';

export const PropertiesPanel: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const language = useAppStore((s) => s.language);
  const validationIssues = useAppStore((s) => s.validationIssues);
  const simSnapshot = useAppStore((s) => s.simSnapshot);

  const updateLayoutObject = useAppStore((s) => s.updateLayoutObject);
  const deleteLayoutObject = useAppStore((s) => s.deleteLayoutObject);
  const updateWorker = useAppStore((s) => s.updateWorker);
  const deleteWorker = useAppStore((s) => s.deleteWorker);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const updateSimConfig = useAppStore((s) => s.updateSimConfig);
  const selectItem = useAppStore((s) => s.selectItem);
  const autoFixIssues = useAppStore((s) => s.autoFixIssues);

  const t = getT(language);
  const unit = project.factory.unit;

  const selectedObj =
    selection.kind === 'object' && selection.ids[0]
      ? project.layoutObjects.find((o) => o.id === selection.ids[0])
      : undefined;

  const selectedWorker =
    selection.kind === 'worker' && selection.ids[0]
      ? project.workers.find((w) => w.id === selection.ids[0])
      : undefined;

  const selectedZone =
    selection.kind === 'zone' && selection.ids[0]
      ? project.factory.zones.find((z) => z.id === selection.ids[0])
      : undefined;

  const numInput = (
    label: string,
    valMetersOrRaw: number,
    isLength: boolean,
    onChange: (next: number) => void,
    step = 0.1,
    min = 0
  ) => {
    const displayVal = isLength ? fromMeters(valMetersOrRaw, unit) : valMetersOrRaw;
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          {label} {isLength ? `(${unit})` : ''}
        </span>
        <input
          type="number"
          step={isLength && unit !== 'm' ? 10 : step}
          min={min}
          value={Number(displayVal.toFixed(isLength && unit === 'm' ? 2 : 1))}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (Number.isNaN(parsed)) return;
            onChange(isLength ? toMeters(parsed, unit) : parsed);
          }}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs font-mono-tabular text-neutral-900 dark:text-neutral-100 focus:border-red-600 focus:outline-none"
        />
      </label>
    );
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-s border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
        <h2 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
          {t.labels.properties}
        </h2>
        <span className="text-[11px] font-mono-tabular text-neutral-500">
          {selectedObj
            ? t.equipment.categories[selectedObj.category] || selectedObj.category.replace('_', ' ')
            : selectedWorker
            ? selectedWorker.label
            : selectedZone
            ? t.factory.zones[selectedZone.type] || selectedZone.type
            : language === 'ar'
            ? 'مساحة العمل'
            : 'Workspace'}
        </span>
      </div>

      {/* Selected Equipment / Machine / Conveyor */}
      {selectedObj && (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              value={selectedObj.name}
              onChange={(e) => updateLayoutObject(selectedObj.id, { name: e.target.value })}
              className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs font-semibold text-neutral-900 dark:text-neutral-100 focus:border-red-600 focus:outline-none"
            />
            <button
              onClick={() =>
                updateLayoutObject(selectedObj.id, {
                  rendering: { ...selectedObj.rendering, locked: !selectedObj.rendering.locked },
                })
              }
              title={selectedObj.rendering.locked ? t.actions.unlock : t.actions.lock}
              className="p-1.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {selectedObj.rendering.locked ? (
                <Lock className="w-3.5 h-3.5 text-red-600" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-neutral-500" />
              )}
            </button>
            <button
              onClick={() =>
                updateLayoutObject(selectedObj.id, {
                  rendering: { ...selectedObj.rendering, visible: !selectedObj.rendering.visible },
                })
              }
              title={language === 'ar' ? 'إظهار/إخفاء العنصر' : 'Toggle Visibility'}
              className="p-1.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {selectedObj.rendering.visible ? (
                <Eye className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-neutral-400" />
              )}
            </button>
          </div>

          {/* Live simulation runtime inspection */}
          {simSnapshot.objects[selectedObj.id] && simSnapshot.clockSec > 0 && (
            <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2.5 text-xs">
              <div className="flex items-center justify-between font-medium">
                <span>{t.labels.liveStatus}</span>
                <span className="font-mono-tabular uppercase text-[11px] font-semibold text-red-600">
                  {t.simStatus[simSnapshot.objects[selectedObj.id].status as keyof typeof t.simStatus] ||
                    simSnapshot.objects[selectedObj.id].status}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] font-mono-tabular text-neutral-600 dark:text-neutral-400">
                <span>{t.labels.processed}: {simSnapshot.objects[selectedObj.id].processedCount}</span>
                <span>{t.labels.busyUnits}: {simSnapshot.objects[selectedObj.id].busyUnitIds.length}</span>
                <span>{t.labels.runTime}: {simSnapshot.objects[selectedObj.id].runningTimeSec.toFixed(0)}s</span>
                <span>{t.labels.blockedTime}: {simSnapshot.objects[selectedObj.id].blockedTimeSec.toFixed(0)}s</span>
              </div>
            </div>
          )}

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <div className="text-[11px] font-semibold text-neutral-500 mb-2">{t.labels.dimensions}</div>
            <div className="grid grid-cols-3 gap-2">
              {numInput(t.labels.length, selectedObj.geometry.dimensions.length, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: {
                    ...selectedObj.geometry,
                    dimensions: { ...selectedObj.geometry.dimensions, length: Math.max(0.2, v) },
                  },
                })
              )}
              {numInput(t.labels.width, selectedObj.geometry.dimensions.width, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: {
                    ...selectedObj.geometry,
                    dimensions: { ...selectedObj.geometry.dimensions, width: Math.max(0.2, v) },
                  },
                })
              )}
              {numInput(t.labels.height, selectedObj.geometry.dimensions.height, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: {
                    ...selectedObj.geometry,
                    dimensions: { ...selectedObj.geometry.dimensions, height: Math.max(0.2, v) },
                  },
                })
              )}
            </div>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <div className="text-[11px] font-semibold text-neutral-500 mb-2">{t.labels.positionRotation}</div>
            <div className="grid grid-cols-2 gap-2">
              {numInput(t.labels.positionX, selectedObj.geometry.position.x, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: {
                    ...selectedObj.geometry,
                    position: { ...selectedObj.geometry.position, x: v },
                  },
                })
              )}
              {numInput(t.labels.positionZ, selectedObj.geometry.position.z, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: {
                    ...selectedObj.geometry,
                    position: { ...selectedObj.geometry.position, z: v },
                  },
                })
              )}
              {numInput(
                t.labels.rotation,
                selectedObj.geometry.rotationDeg,
                false,
                (v) =>
                  updateLayoutObject(selectedObj.id, {
                    geometry: { ...selectedObj.geometry, rotationDeg: v },
                  }),
                5,
                -360
              )}
              {numInput(t.labels.clearance, selectedObj.geometry.clearanceM, true, (v) =>
                updateLayoutObject(selectedObj.id, {
                  geometry: { ...selectedObj.geometry, clearanceM: Math.max(0, v) },
                })
              )}
            </div>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <div className="text-[11px] font-semibold text-neutral-500 mb-2">{t.labels.operationalParams}</div>
            <div className="grid grid-cols-2 gap-2">
              {selectedObj.kind === 'conveyor' ? (
                <>
                  {numInput(
                    t.labels.speed,
                    selectedObj.operations.speedMps ?? 0.05,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, speedMps: Math.max(0.01, v) },
                      }),
                    0.01,
                    0.01
                  )}
                  {numInput(
                    t.labels.spacing,
                    selectedObj.operations.productSpacingM ?? 0.15,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, productSpacingM: Math.max(0.05, v) },
                      }),
                    0.05,
                    0.05
                  )}
                  <div className="col-span-2 flex flex-col gap-1 pt-1">
                    <span className="text-[11px] text-neutral-500">{t.labels.flowDirection}</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, direction: 1 },
                          })
                        }
                        className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                          (selectedObj.operations.direction ?? 1) === 1
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        → {t.labels.flowForward}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, direction: -1 },
                          })
                        }
                        className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                          selectedObj.operations.direction === -1
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        ← {t.labels.flowReverse}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {numInput(
                    t.labels.processingTime,
                    selectedObj.operations.processingTimeSec,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, processingTimeSec: Math.max(0, v) },
                      }),
                    1
                  )}
                  {numInput(
                    t.labels.setupTime,
                    selectedObj.operations.setupTimeSec ?? 0,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, setupTimeSec: Math.max(0, v) },
                      }),
                    1
                  )}
                  {numInput(
                    t.labels.loadingTime,
                    selectedObj.operations.loadingTimeSec ?? 0,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, loadingTimeSec: Math.max(0, v) },
                      }),
                    0.5
                  )}
                  {numInput(
                    t.labels.unloadingTime,
                    selectedObj.operations.unloadingTimeSec ?? 0,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, unloadingTimeSec: Math.max(0, v) },
                      }),
                    0.5
                  )}
                  {numInput(
                    t.labels.requiredWorkers,
                    selectedObj.operations.requiredOperators,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, requiredOperators: Math.max(0, Math.round(v)) },
                      }),
                    1
                  )}
                </>
              )}
              {numInput(
                t.labels.capacity,
                selectedObj.operations.capacity,
                false,
                (v) =>
                  updateLayoutObject(selectedObj.id, {
                    operations: { ...selectedObj.operations, capacity: Math.max(1, Math.round(v)) },
                  }),
                1,
                1
              )}
              {numInput(
                t.labels.availability,
                selectedObj.operations.availability,
                false,
                (v) =>
                  updateLayoutObject(selectedObj.id, {
                    operations: { ...selectedObj.operations, availability: Math.min(1, Math.max(0.1, v)) },
                  }),
                0.01,
                0.1
              )}
            </div>
          </div>

          <button
            onClick={() => deleteLayoutObject(selectedObj.id)}
            disabled={selectedObj.rendering.locked}
            className="mt-2 flex items-center justify-center gap-1.5 rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.actions.delete}</span>
          </button>
        </div>
      )}

      {/* Selected Worker */}
      {selectedWorker && (
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral-500">{t.labels.workerName}</span>
            <input
              type="text"
              value={selectedWorker.name}
              onChange={(e) => updateWorker(selectedWorker.id, { name: e.target.value })}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs font-semibold"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {numInput(t.labels.positionX, selectedWorker.position.x, true, (v) =>
              updateWorker(selectedWorker.id, { position: { ...selectedWorker.position, x: v } })
            )}
            {numInput(t.labels.positionZ, selectedWorker.position.z, true, (v) =>
              updateWorker(selectedWorker.id, { position: { ...selectedWorker.position, z: v } })
            )}
            {numInput(
              t.labels.walkingSpeed,
              selectedWorker.walkingSpeedMps,
              false,
              (v) => updateWorker(selectedWorker.id, { walkingSpeedMps: Math.max(0.3, v) }),
              0.05,
              0.3
            )}
            {numInput(
              t.labels.efficiencyFactor,
              selectedWorker.efficiencyFactor,
              false,
              (v) => updateWorker(selectedWorker.id, { efficiencyFactor: Math.max(0.5, Math.min(1.5, v)) }),
              0.05,
              0.5
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-neutral-500">{t.labels.assignedStages}</span>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-neutral-200 dark:border-neutral-800 rounded p-2">
              {project.stages.map((st) => {
                const checked = selectedWorker.assignedStageIds.includes(st.id);
                return (
                  <label key={st.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? selectedWorker.assignedStageIds.filter((id) => id !== st.id)
                          : [...selectedWorker.assignedStageIds, st.id];
                        updateWorker(selectedWorker.id, { assignedStageIds: next });
                      }}
                    />
                    <span className="truncate">{st.code} {st.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <button
            onClick={() => deleteWorker(selectedWorker.id)}
            className="flex items-center justify-center gap-1.5 rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.actions.delete}</span>
          </button>
        </div>
      )}

      {/* Selected Zone */}
      {selectedZone && (
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral-500">{t.labels.zoneName}</span>
            <input
              type="text"
              value={selectedZone.name}
              onChange={(e) => updateZone(selectedZone.id, { name: e.target.value })}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-xs font-semibold"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {numInput(t.labels.positionX, selectedZone.position.x, true, (v) =>
              updateZone(selectedZone.id, { position: { ...selectedZone.position, x: v } })
            )}
            {numInput(t.labels.positionZ, selectedZone.position.z, true, (v) =>
              updateZone(selectedZone.id, { position: { ...selectedZone.position, z: v } })
            )}
            {numInput(t.labels.length, selectedZone.dimensions.length, true, (v) =>
              updateZone(selectedZone.id, {
                dimensions: { ...selectedZone.dimensions, length: Math.max(0.5, v) },
              })
            )}
            {numInput(t.labels.width, selectedZone.dimensions.width, true, (v) =>
              updateZone(selectedZone.id, {
                dimensions: { ...selectedZone.dimensions, width: Math.max(0.5, v) },
              })
            )}
          </div>
          <button
            onClick={() => deleteZone(selectedZone.id)}
            className="flex items-center justify-center gap-1.5 rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.actions.delete}</span>
          </button>
        </div>
      )}

      {/* Nothing Selected: Simulation Quick Config + Engineering Validation */}
      {!selectedObj && !selectedWorker && !selectedZone && (
        <div className="flex flex-col gap-4 p-4">
          <div>
            <div className="text-[11px] font-semibold text-neutral-500 mb-2">{t.labels.simulationParams}</div>
            <div className="grid grid-cols-2 gap-2">
              {numInput(
                t.labels.shiftDurationSec,
                project.simulationConfig.durationSec,
                false,
                (v) => updateSimConfig({ durationSec: Math.max(60, Math.round(v)) }),
                600,
                60
              )}
              {numInput(
                t.labels.arrivalIntervalSec,
                project.simulationConfig.arrivalIntervalSec,
                false,
                (v) => updateSimConfig({ arrivalIntervalSec: Math.max(1, v) }),
                1,
                1
              )}
              {numInput(
                t.labels.plannedUnits,
                project.simulationConfig.maxPlannedUnits,
                false,
                (v) => updateSimConfig({ maxPlannedUnits: Math.max(1, Math.round(v)) }),
                10,
                1
              )}
              {numInput(
                t.labels.randomSeed,
                project.simulationConfig.randomSeed,
                false,
                (v) => updateSimConfig({ randomSeed: Math.max(1, Math.round(v)) }),
                1,
                1
              )}
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={project.simulationConfig.enableBreakdowns}
                onChange={(e) => updateSimConfig({ enableBreakdowns: e.target.checked })}
              />
              <span>{t.labels.enableBreakdowns}</span>
            </label>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-neutral-500">{t.labels.validation}</span>
              <span className="text-[11px] font-mono-tabular text-neutral-500">
                {validationIssues.length} {t.labels.issuesCount}
              </span>
            </div>

            {validationIssues.length === 0 ? (
              <div className="flex items-center gap-2 rounded border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t.labels.validationClean}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={autoFixIssues}
                  className="flex items-center justify-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{t.actions.autoFix}</span>
                </button>
                <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
                  {validationIssues.map((issue) => (
                    <button
                      key={issue.id}
                      onClick={() => {
                        if (issue.targetId && issue.targetType === 'object') {
                          selectItem('object', issue.targetId);
                        }
                      }}
                      className={`flex items-start gap-2 rounded border p-2 text-start text-[11px] transition-colors ${
                        issue.severity === 'error'
                          ? 'border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                          : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{language === 'ar' ? issue.messageAr || issue.message : issue.message}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
