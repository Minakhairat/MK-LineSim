import React from 'react';
import { AlertTriangle, CheckCircle2, Lock, Plus, Trash2, Unlock, Eye, EyeOff, Wrench } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { fromMeters, toMeters, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';
import {
  DispatchingRule,
  FailureDistributionType,
  InterruptionPolicy,
  RepairDistributionType,
  ShiftEndPolicy,
} from '../../types/project';
import {
  CardinalPlacementSide,
  getConveyorSegmentCount,
  normalizeRotationDeg,
} from '../../engineering/conveyorWorkerAssignment';

const CARDINAL_SIDE_BUTTONS: Array<{ side: CardinalPlacementSide; shortEn: string; shortAr: string }> = [
  { side: 'north', shortEn: 'N', shortAr: 'ش' },
  { side: 'south', shortEn: 'S', shortAr: 'ج' },
  { side: 'east', shortEn: 'E', shortAr: 'ق' },
  { side: 'west', shortEn: 'W', shortAr: 'غ' },
];

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
  const assignWorkerToConveyorSegment = useAppStore((s) => s.assignWorkerToConveyorSegment);
  const assignWorkerToStationSide = useAppStore((s) => s.assignWorkerToStationSide);
  const unassignWorkerTarget = useAppStore((s) => s.unassignWorkerTarget);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const updateSimConfig = useAppStore((s) => s.updateSimConfig);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const selectItem = useAppStore((s) => s.selectItem);
  const autoFixIssues = useAppStore((s) => s.autoFixIssues);

  const t = getT(language);
  const isAr = language === 'ar';
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
                  <div className="col-span-2 mt-1 border-t border-neutral-200 dark:border-neutral-800 pt-2">
                    <div className="text-[10px] font-semibold text-neutral-500 mb-1.5">
                      {t.labels.conveyorWorkTitle}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {numInput(
                        t.labels.processingTime,
                        selectedObj.operations.processingTimeSec,
                        false,
                        (v) =>
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, processingTimeSec: Math.max(0, v) },
                          }),
                        1,
                        0
                      )}
                      {numInput(
                        t.labels.requiredWorkers,
                        selectedObj.operations.requiredOperators,
                        false,
                        (v) =>
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, requiredOperators: Math.max(0, Math.round(v)) },
                          }),
                        1,
                        0
                      )}
                    </div>
                    {!project.stages.some(
                      (st) => st.assignedObjectIds.includes(selectedObj.id) || st.id === selectedObj.stageId
                    ) && (
                      <button
                        type="button"
                        onClick={() =>
                          commitProjectEdit((draft) => {
                            const conv = draft.layoutObjects.find((o) => o.id === selectedObj.id);
                            if (!conv) return;
                            const sid = uid('stg');
                            const idx = draft.stages.length + 1;
                            draft.stages.push({
                              id: sid,
                              code: `CV-${idx * 10}`,
                              name: conv.name,
                              description: isAr ? 'عملية مباشرة على السير' : 'On-conveyor work operation',
                              processingTimeSec: Math.max(0, conv.operations.processingTimeSec || 10),
                              setupTimeSec: conv.operations.setupTimeSec || 0,
                              loadingTimeSec: 0,
                              unloadingTimeSec: 0,
                              requiredWorkers: Math.max(1, conv.operations.requiredOperators || 1),
                              requiredMachines: 1,
                              inputQty: 1,
                              outputQty: 1,
                              scrapRate: 0,
                              reworkProbability: 0,
                              bufferCapacity: Math.max(1, conv.operations.capacity || 5),
                              predecessorIds: [],
                              successorIds: [],
                              assignedObjectIds: [conv.id],
                              conveyorObjectId: conv.id,
                            });
                            conv.stageId = sid;
                            conv.operations.requiredOperators = Math.max(1, conv.operations.requiredOperators || 1);
                            conv.operations.processingTimeSec = Math.max(0, conv.operations.processingTimeSec || 10);
                          })
                        }
                        className="mt-2 w-full rounded border border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-950/30 px-2 py-1 text-[11px] font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50"
                      >
                        {t.labels.syncConveyorStage}
                      </button>
                    )}
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
              {selectedObj.kind !== 'conveyor' && (
                <>
                  {numInput(
                    t.labels.batchSize,
                    selectedObj.operations.batchSize ?? 1,
                    false,
                    (v) => {
                      const nextBatch = Math.max(1, Math.round(v));
                      updateLayoutObject(selectedObj.id, {
                        operations: {
                          ...selectedObj.operations,
                          batchSize: nextBatch,
                          batchMode:
                            nextBatch > 1
                              ? selectedObj.operations.batchMode === 'unbatch'
                                ? 'collect_batch'
                                : selectedObj.operations.batchMode || 'collect_batch'
                              : 'single',
                        },
                      });
                    },
                    1,
                    1
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      {t.labels.batchMode}
                    </span>
                    <select
                      value={selectedObj.operations.batchMode || ((selectedObj.operations.batchSize ?? 1) > 1 ? 'collect_batch' : 'single')}
                      onChange={(e) => {
                        const mode = e.target.value as 'single' | 'collect_batch' | 'unbatch';
                        updateLayoutObject(selectedObj.id, {
                          operations: {
                            ...selectedObj.operations,
                            batchMode: mode,
                            batchSize:
                              mode === 'collect_batch'
                                ? Math.max(2, selectedObj.operations.batchSize ?? 4)
                                : 1,
                          },
                        });
                      }}
                      className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-900 dark:text-neutral-100 focus:border-red-600 focus:outline-none"
                    >
                      <option value="single">{t.labels.batchSingle}</option>
                      <option value="collect_batch">{t.labels.batchCollect}</option>
                      <option value="unbatch">{t.labels.batchUnbatch}</option>
                    </select>
                  </label>
                  {(selectedObj.operations.batchMode === 'collect_batch' || (selectedObj.operations.batchSize ?? 1) > 1) &&
                    numInput(
                      t.labels.batchTransferTimeSec,
                      selectedObj.operations.batchTransferTimeSec ?? 0,
                      false,
                      (v) =>
                        updateLayoutObject(selectedObj.id, {
                          operations: { ...selectedObj.operations, batchTransferTimeSec: Math.max(0, v) },
                        }),
                      1,
                      0
                    )}
                </>
              )}
            </div>
          </div>

          {selectedObj.kind !== 'storage' && selectedObj.kind !== 'vehicle' && (
            <>
              {/* Resource Shift Assignment & Break Continuity */}
              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 flex flex-col gap-2">
                <div className="text-[11px] font-semibold text-neutral-500">{t.labels.shiftAssignment}</div>
                <select
                  value={selectedObj.operations.shiftId || ''}
                  onChange={(e) =>
                    updateLayoutObject(selectedObj.id, {
                      operations: { ...selectedObj.operations, shiftId: e.target.value || undefined },
                    })
                  }
                  className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100"
                >
                  <option value="">{t.labels.plantDefaultShift}</option>
                  {project.simulationConfig.shifts.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} ({Math.round(sh.durationSec / 60)}m)
                    </option>
                  ))}
                  {selectedObj.operations.shiftId &&
                    !project.simulationConfig.shifts.some((s) => s.id === selectedObj.operations.shiftId) && (
                      <option value={selectedObj.operations.shiftId}>
                        {selectedObj.operations.shiftId} (Invalid)
                      </option>
                    )}
                </select>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-500">{t.labels.breakPolicy}</span>
                  <select
                    value={
                      selectedObj.operations.breakPolicy ??
                      (selectedObj.operations.runDuringBreaks ? 'continue_during_break' : 'stop_immediately')
                    }
                    onChange={(e) => {
                      const policy = e.target.value as InterruptionPolicy;
                      updateLayoutObject(selectedObj.id, {
                        operations: {
                          ...selectedObj.operations,
                          breakPolicy: policy,
                          runDuringBreaks: policy === 'continue_during_break',
                        },
                      });
                    }}
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px] text-neutral-900 dark:text-neutral-100"
                  >
                    <option value="stop_immediately">{t.labels.policyStopImmediately}</option>
                    <option value="finish_current_cycle">{t.labels.policyFinishCycle}</option>
                    <option value="continue_during_break">{t.labels.policyContinueBreak}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-neutral-500">{t.labels.shiftEndPolicy}</span>
                  <select
                    value={selectedObj.operations.shiftEndPolicy ?? 'stop_immediately'}
                    onChange={(e) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: {
                          ...selectedObj.operations,
                          shiftEndPolicy: e.target.value as ShiftEndPolicy,
                        },
                      })
                    }
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px] text-neutral-900 dark:text-neutral-100"
                  >
                    <option value="stop_immediately">{t.labels.policyStopImmediately}</option>
                    <option value="finish_current_cycle">{t.labels.policyFinishCycle}</option>
                  </select>
                </label>
              </div>

              {/* Failure & Repair Distributions */}
              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 flex flex-col gap-2">
                <div className="text-[11px] font-semibold text-neutral-500">{t.labels.failureModel}</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="col-span-2 flex flex-col gap-1">
                    <select
                      value={selectedObj.operations.failureModel || 'exponential'}
                      onChange={(e) =>
                        updateLayoutObject(selectedObj.id, {
                          operations: {
                            ...selectedObj.operations,
                            failureModel: e.target.value as FailureDistributionType,
                          },
                        })
                      }
                      className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100"
                    >
                      <option value="exponential">{t.labels.failureExp}</option>
                      <option value="weibull">{t.labels.failureWeibull}</option>
                      <option value="fixed">{t.labels.failureFixed}</option>
                    </select>
                  </label>
                  {numInput(
                    t.labels.mtbfSec,
                    selectedObj.operations.mtbfSec ?? 3600,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, mtbfSec: Math.max(10, v) },
                      }),
                    60,
                    10
                  )}
                  {(selectedObj.operations.failureModel || 'exponential') === 'weibull' &&
                    numInput(
                      t.labels.weibullShape,
                      selectedObj.operations.weibullShape ?? 2.0,
                      false,
                      (v) =>
                        updateLayoutObject(selectedObj.id, {
                          operations: { ...selectedObj.operations, weibullShape: Math.max(0.2, v) },
                        }),
                      0.1,
                      0.2
                    )}
                  <label className="col-span-2 flex flex-col gap-1 mt-1">
                    <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      {t.labels.repairModel}
                    </span>
                    <select
                      value={selectedObj.operations.repairModel || 'fixed'}
                      onChange={(e) =>
                        updateLayoutObject(selectedObj.id, {
                          operations: {
                            ...selectedObj.operations,
                            repairModel: e.target.value as RepairDistributionType,
                          },
                        })
                      }
                      className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100"
                    >
                      <option value="fixed">{t.labels.repairFixed}</option>
                      <option value="exponential">{t.labels.repairExp}</option>
                      <option value="lognormal">{t.labels.repairLogNormal}</option>
                    </select>
                  </label>
                  {numInput(
                    t.labels.mttrSec,
                    selectedObj.operations.mttrSec ?? 180,
                    false,
                    (v) =>
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, mttrSec: Math.max(1, v) },
                      }),
                    15,
                    1
                  )}
                  {selectedObj.operations.repairModel === 'lognormal' &&
                    numInput(
                      t.labels.mttrStdDevSec,
                      selectedObj.operations.mttrStdDevSec ?? Math.round((selectedObj.operations.mttrSec ?? 180) * 0.5),
                      false,
                      (v) =>
                        updateLayoutObject(selectedObj.id, {
                          operations: { ...selectedObj.operations, mttrStdDevSec: Math.max(0, v) },
                        }),
                      5,
                      0
                    )}
                </div>
              </div>

              {/* Resource Planned Maintenance Windows */}
              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-neutral-500">{t.labels.plannedMaintenance}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextList = [
                        ...(selectedObj.operations.plannedMaintenance || []),
                        {
                          id: uid('pm'),
                          name: `PM ${(selectedObj.operations.plannedMaintenance?.length ?? 0) + 1}`,
                          startSec: 1800,
                          durationSec: 300,
                        },
                      ];
                      updateLayoutObject(selectedObj.id, {
                        operations: { ...selectedObj.operations, plannedMaintenance: nextList },
                      });
                    }}
                    className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 text-[10px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t.labels.addMaintWindow}</span>
                  </button>
                </div>
                {(selectedObj.operations.plannedMaintenance || []).map((mw) => (
                  <div
                    key={mw.id}
                    className="grid grid-cols-2 gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5"
                  >
                    <div className="col-span-2 flex items-center gap-1">
                      <input
                        type="text"
                        value={mw.name}
                        onChange={(e) => {
                          const next = (selectedObj.operations.plannedMaintenance || []).map((item) =>
                            item.id === mw.id ? { ...item, name: e.target.value } : item
                          );
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, plannedMaintenance: next },
                          });
                        }}
                        className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = (selectedObj.operations.plannedMaintenance || []).filter(
                            (item) => item.id !== mw.id
                          );
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, plannedMaintenance: next },
                          });
                        }}
                        className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-neutral-500">{t.labels.startSec}</span>
                      <input
                        type="number"
                        min={0}
                        step={60}
                        value={mw.startSec}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          const next = (selectedObj.operations.plannedMaintenance || []).map((item) =>
                            item.id === mw.id ? { ...item, startSec: v } : item
                          );
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, plannedMaintenance: next },
                          });
                        }}
                        className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-neutral-500">{t.labels.durationSec}</span>
                      <input
                        type="number"
                        min={10}
                        step={60}
                        value={mw.durationSec}
                        onChange={(e) => {
                          const v = Math.max(10, Number(e.target.value) || 10);
                          const next = (selectedObj.operations.plannedMaintenance || []).map((item) =>
                            item.id === mw.id ? { ...item, durationSec: v } : item
                          );
                          updateLayoutObject(selectedObj.id, {
                            operations: { ...selectedObj.operations, plannedMaintenance: next },
                          });
                        }}
                        className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Assigned Workers & Side Controls directly from Station / Machine / Conveyor */}
          {(selectedObj.kind === 'machine' ||
            selectedObj.kind === 'workstation' ||
            selectedObj.kind === 'conveyor' ||
            selectedObj.kind === 'buffer') && (() => {
            const objWorkers = project.workers.filter(
              (w) => (w.assignedTo || w.assignedStationId) === selectedObj.id
            );
            const segCount =
              selectedObj.kind === 'conveyor' ? getConveyorSegmentCount(selectedObj) : 0;
            return (
              <div className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                    {t.labels.assignedWorkersOnObj} ({objWorkers.length})
                  </span>
                </div>
                {objWorkers.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {objWorkers.map((wk) => (
                      <div
                        key={wk.id}
                        className="flex flex-col gap-1 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => selectItem('worker', wk.id)}
                            className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200 hover:underline truncate"
                          >
                            {wk.label} · {wk.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => unassignWorkerTarget(wk.id)}
                            className="text-[10px] text-neutral-500 hover:text-red-600 px-1"
                          >
                            {t.workforce.unassignTarget}
                          </button>
                        </div>
                        {selectedObj.kind === 'conveyor' ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={Math.min(
                                Math.max(0, segCount - 1),
                                wk.assignedConveyorSegment?.segmentIndex ?? 0
                              )}
                              onChange={(e) =>
                                assignWorkerToConveyorSegment(
                                  wk.id,
                                  selectedObj.id,
                                  Number(e.target.value),
                                  segCount,
                                  wk.assignedConveyorSegment?.side ?? 1
                                )
                              }
                              className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                            >
                              {Array.from({ length: segCount }).map((_, idx) => (
                                <option key={idx} value={idx}>
                                  {t.workforce.segmentLabel} {idx + 1}
                                </option>
                              ))}
                            </select>
                            {([1, -1] as const).map((sVal) => {
                              const activeSide = (wk.assignedConveyorSegment?.side ?? 1) === sVal;
                              return (
                                <button
                                  key={sVal}
                                  type="button"
                                  onClick={() =>
                                    assignWorkerToConveyorSegment(
                                      wk.id,
                                      selectedObj.id,
                                      wk.assignedConveyorSegment?.segmentIndex ?? 0,
                                      segCount,
                                      sVal
                                    )
                                  }
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                    activeSide
                                      ? 'border-blue-600 bg-blue-600 text-white'
                                      : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                                  }`}
                                >
                                  {sVal === 1 ? 'A' : 'B'}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-1">
                            {CARDINAL_SIDE_BUTTONS.map((btn) => {
                              const active = (wk.placementSide || 'south') === btn.side;
                              return (
                                <button
                                  key={btn.side}
                                  type="button"
                                  onClick={() =>
                                    assignWorkerToStationSide(wk.id, selectedObj.id, btn.side)
                                  }
                                  className={`rounded border px-1 py-0.5 text-[10px] font-semibold ${
                                    active
                                      ? 'border-red-600 bg-red-600 text-white'
                                      : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                                  }`}
                                >
                                  {isAr ? btn.shortAr : btn.shortEn}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {project.workers.some((w) => (w.assignedTo || w.assignedStationId) !== selectedObj.id) && (
                  <select
                    value=""
                    onChange={(e) => {
                      const wid = e.target.value;
                      if (!wid) return;
                      if (selectedObj.kind === 'conveyor') {
                        assignWorkerToConveyorSegment(wid, selectedObj.id, 0, segCount, 1);
                      } else {
                        assignWorkerToStationSide(wid, selectedObj.id);
                      }
                    }}
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px]"
                  >
                    <option value="">
                      + {isAr ? 'تعيين عامل هنا...' : 'Assign worker here...'}
                    </option>
                    {project.workers
                      .filter((w) => (w.assignedTo || w.assignedStationId) !== selectedObj.id)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label} · {w.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            );
          })()}

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
              updateWorker(selectedWorker.id, {
                position: { ...selectedWorker.position, x: v },
                placementSide: 'custom',
              })
            )}
            {numInput(t.labels.positionZ, selectedWorker.position.z, true, (v) =>
              updateWorker(selectedWorker.id, {
                position: { ...selectedWorker.position, z: v },
                placementSide: 'custom',
              })
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

          {/* Worker Orientation (updates both rotation & rotationDeg for 2D/3D) */}
          {(() => {
            const workerRot = selectedWorker.rotation ?? selectedWorker.rotationDeg ?? 0;
            return (
              <div className="flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 p-2">
                {numInput(
                  t.labels.rotationDeg,
                  Math.round(workerRot * 10) / 10,
                  false,
                  (v) => {
                    const wrapped = normalizeRotationDeg(v);
                    updateWorker(selectedWorker.id, { rotation: wrapped, rotationDeg: wrapped });
                  },
                  5,
                  -360
                )}
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={normalizeRotationDeg(workerRot)}
                  onChange={(e) => {
                    const wrapped = normalizeRotationDeg(Number(e.target.value));
                    updateWorker(selectedWorker.id, { rotation: wrapped, rotationDeg: wrapped });
                  }}
                  aria-label={t.labels.rotationDeg}
                  className="w-full accent-red-600 cursor-pointer"
                />
                <div className="grid grid-cols-4 gap-1">
                  {[0, 90, 180, -90].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() =>
                        updateWorker(selectedWorker.id, { rotation: deg, rotationDeg: deg })
                      }
                      className={`rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] ${
                        Math.round(workerRot) === deg
                          ? 'border-red-600 bg-red-600 text-white'
                          : 'border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Worker Shift Assignment */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-neutral-500">{t.labels.shiftAssignment}</span>
            <select
              value={selectedWorker.shiftId || ''}
              onChange={(e) =>
                updateWorker(selectedWorker.id, { shiftId: e.target.value || undefined })
              }
              className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
            >
              <option value="">{t.labels.plantDefaultShift}</option>
              {project.simulationConfig.shifts.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name} ({Math.round(sh.durationSec / 60)}m)
                </option>
              ))}
              {selectedWorker.shiftId &&
                !project.simulationConfig.shifts.some((s) => s.id === selectedWorker.shiftId) && (
                  <option value={selectedWorker.shiftId}>{selectedWorker.shiftId} (Invalid)</option>
                )}
            </select>
          </label>

          {/* Worker Break & Shift-End Interruption Policies */}
          <div className="grid grid-cols-1 gap-2 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60 p-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-neutral-500">{t.labels.breakPolicy}</span>
              <select
                value={selectedWorker.breakPolicy ?? 'stop_immediately'}
                onChange={(e) =>
                  updateWorker(selectedWorker.id, { breakPolicy: e.target.value as ShiftEndPolicy })
                }
                className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px]"
              >
                <option value="stop_immediately">{t.labels.policyStopImmediately}</option>
                <option value="finish_current_cycle">{t.labels.policyFinishCycle}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-neutral-500">{t.labels.shiftEndPolicy}</span>
              <select
                value={selectedWorker.shiftEndPolicy ?? 'stop_immediately'}
                onChange={(e) =>
                  updateWorker(selectedWorker.id, { shiftEndPolicy: e.target.value as ShiftEndPolicy })
                }
                className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px]"
              >
                <option value="stop_immediately">{t.labels.policyStopImmediately}</option>
                <option value="finish_current_cycle">{t.labels.policyFinishCycle}</option>
              </select>
            </label>
          </div>

          {/* Direct Station or Conveyor Segment Assignment (assignedTo) */}
          {(() => {
            const currentTargetId = selectedWorker.assignedTo || selectedWorker.assignedStationId || '';
            const currentTargetObj = project.layoutObjects.find((o) => o.id === currentTargetId);
            const segCount =
              currentTargetObj?.kind === 'conveyor'
                ? getConveyorSegmentCount(currentTargetObj)
                : 0;
            const currentSegIdx = Math.max(
              0,
              Math.min(
                Math.max(0, segCount - 1),
                selectedWorker.assignedConveyorSegment?.segmentIndex ?? 0
              )
            );
            return (
              <div className="flex flex-col gap-1.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-neutral-500">
                    {t.labels.assignedStation}
                  </span>
                  <select
                    value={currentTargetId}
                    onChange={(e) => {
                      const stationId = e.target.value || undefined;
                      if (!stationId) {
                        unassignWorkerTarget(selectedWorker.id);
                        return;
                      }
                      const picked = project.layoutObjects.find((o) => o.id === stationId);
                      if (!picked) return;
                      if (picked.kind === 'conveyor') {
                        assignWorkerToConveyorSegment(selectedWorker.id, picked.id, 0);
                        return;
                      }
                      assignWorkerToStationSide(selectedWorker.id, picked.id);
                    }}
                    className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
                  >
                    <option value="">{t.labels.unassignedStation}</option>
                    {project.layoutObjects
                      .filter(
                        (o) =>
                          o.rendering.visible &&
                          (o.kind === 'machine' || o.kind === 'workstation' || o.kind === 'conveyor' || o.kind === 'buffer')
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.kind === 'conveyor' ? `[${t.flowchart.conveyorBadge}] ` : ''}
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>

                {currentTargetObj && currentTargetObj.kind !== 'conveyor' && (
                  <div className="flex flex-col gap-1 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                        {t.labels.workerPlacementSide}
                      </span>
                      {selectedWorker.placementSide === 'custom' && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-amber-700 dark:text-amber-400">
                          {t.labels.sideCustom}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {CARDINAL_SIDE_BUTTONS.map((btn) => {
                        const active = (selectedWorker.placementSide || 'south') === btn.side;
                        return (
                          <button
                            key={btn.side}
                            type="button"
                            onClick={() =>
                              assignWorkerToStationSide(selectedWorker.id, currentTargetObj.id, btn.side)
                            }
                            className={`rounded border px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                              active
                                ? 'border-red-600 bg-red-600 text-white'
                                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            {isAr ? btn.shortAr : btn.shortEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {currentTargetObj?.kind === 'conveyor' && segCount > 0 && (
                  <div className="flex flex-col gap-1.5 rounded border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/25 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 shrink-0">
                        {t.workforce.segmentLabel}:
                      </span>
                      <select
                        value={currentSegIdx}
                        onChange={(e) =>
                          assignWorkerToConveyorSegment(
                            selectedWorker.id,
                            currentTargetObj.id,
                            Number(e.target.value),
                            segCount,
                            selectedWorker.assignedConveyorSegment?.side ?? 1
                          )
                        }
                        className="flex-1 min-w-0 rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                      >
                        {Array.from({ length: segCount }).map((_, idx) => (
                          <option key={idx} value={idx}>
                            {t.workforce.segmentLabel} {idx + 1} / {segCount}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => unassignWorkerTarget(selectedWorker.id)}
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        {t.workforce.unassignTarget}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {([1, -1] as const).map((sVal) => {
                        const isSideActive = (selectedWorker.assignedConveyorSegment?.side ?? 1) === sVal;
                        return (
                          <button
                            key={sVal}
                            type="button"
                            onClick={() =>
                              assignWorkerToConveyorSegment(
                                selectedWorker.id,
                                currentTargetObj.id,
                                currentSegIdx,
                                segCount,
                                sVal
                              )
                            }
                            className={`rounded border px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                              isSideActive
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-blue-300 dark:border-blue-800 bg-white dark:bg-neutral-900 text-blue-800 dark:text-blue-200'
                            }`}
                          >
                            {sVal === 1 ? t.labels.conveyorSideA : t.labels.conveyorSideB}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

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

            <label className="mt-2.5 flex flex-col gap-1">
              <span className="text-[10px] font-medium text-neutral-500">{t.labels.dispatchingRule}</span>
              <select
                value={project.simulationConfig.dispatchingRule ?? 'weighted_mix'}
                onChange={(e) => updateSimConfig({ dispatchingRule: e.target.value as DispatchingRule })}
                className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
              >
                <option value="weighted_mix">{t.labels.dispatchWeightedMix}</option>
                <option value="fixed_sequence">{t.labels.dispatchFixedSequence}</option>
                <option value="product_priority">{t.labels.dispatchProductPriority}</option>
                <option value="round_robin">{t.labels.dispatchRoundRobin}</option>
              </select>
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
                        } else if (issue.targetId && issue.targetType === 'worker') {
                          selectItem('worker', issue.targetId);
                        }
                      }}
                      className={`flex items-start gap-2 rounded border p-2 text-start text-[11px] transition-colors ${
                        issue.severity === 'error'
                          ? 'border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                          : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div>{isAr ? issue.messageAr || issue.message : issue.message}</div>
                        {(issue.recommendation || issue.recommendationAr) && (
                          <div className="mt-0.5 text-[10px] opacity-85">
                            {isAr ? issue.recommendationAr || issue.recommendation : issue.recommendation}
                          </div>
                        )}
                      </div>
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
