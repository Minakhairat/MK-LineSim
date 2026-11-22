import React, { useState } from 'react';
import {
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { uid } from '../../utils/units';
import { getT } from '../../i18n/translations';
import {
  getConveyorSegmentCount,
  normalizeRotationDeg,
} from '../../engineering/conveyorWorkerAssignment';

export const WorkforceModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const language = useAppStore((s) => s.language);
  const addWorker = useAppStore((s) => s.addWorker);
  const updateWorker = useAppStore((s) => s.updateWorker);
  const deleteWorker = useAppStore((s) => s.deleteWorker);
  const selectItem = useAppStore((s) => s.selectItem);
  const assignWorkerToConveyorSegment = useAppStore((s) => s.assignWorkerToConveyorSegment);
  const unassignWorkerTarget = useAppStore((s) => s.unassignWorkerTarget);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const setToast = useAppStore((s) => s.setToast);

  const t = getT(language);
  const isAr = language === 'ar';

  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [draggingWorkerId, setDraggingWorkerId] = useState<string | null>(null);
  const [hoverConvId, setHoverConvId] = useState<string | null>(null);
  const [hoverSeg, setHoverSeg] = useState<{ convId: string; segIdx: number } | null>(null);

  const conveyors = project.layoutObjects.filter(
    (o) => o.rendering.visible && o.kind === 'conveyor'
  );
  const selectedWorkerId = selection.kind === 'worker' ? selection.ids[0] : undefined;

  const extractDraggedWorkerId = (e: React.DragEvent<HTMLElement>): string | null => {
    const wid =
      e.dataTransfer.getData('application/x-linesim-worker') ||
      e.dataTransfer.getData('text/plain') ||
      draggingWorkerId;
    if (!wid || !project.workers.some((w) => w.id === wid)) return null;
    return wid;
  };

  const resolveDefaultConveyorSegment = (convId: string, segCount: number): number => {
    for (let idx = 0; idx < segCount; idx++) {
      const occupied = project.workers.some(
        (w) =>
          (w.assignedTo || w.assignedStationId) === convId &&
          (w.assignedConveyorSegment?.segmentIndex ?? 0) === idx
      );
      if (!occupied) return idx;
    }
    return 0;
  };

  const handleAutoAllocate = () => {
    if (project.stages.length === 0 || project.workers.length === 0) return;
    commitProjectEdit((draft) => {
      const sorted = [...draft.stages].sort((a, b) => b.processingTimeSec - a.processingTimeSec);
      draft.workers.forEach((w, idx) => {
        const st = sorted[idx % sorted.length];
        const stObj = draft.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
        w.assignedStageIds = [st.id];
        w.assignedTo = stObj?.id;
        w.assignedStationId = stObj?.id;
        w.assignedConveyorSegment = undefined;
        if (stObj) {
          w.position = {
            x: stObj.geometry.position.x + (idx >= sorted.length ? 0.5 : 0),
            y: 0,
            z: stObj.geometry.position.z + (idx % 2 === 0 ? -0.95 : 0.95),
          };
        }
      });
    });
    setToast(
      isAr ? 'تم توزيع العمال تلقائياً على المراحل الأعلى حملاً' : 'Auto-allocated workforce across highest-load stages',
      'success'
    );
  };

  return (
    <div className="flex flex-col gap-4 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.workforce.title} ({project.workers.length})
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleAutoAllocate}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={t.actions.balance}
          >
            <Users className="w-3 h-3" />
            <span>{t.actions.balance}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const n = project.workers.length + 1;
              const st = project.stages[0];
              const stObj = project.layoutObjects.find((o) => o.id === st?.assignedObjectIds[0]);
              const wid = uid('wrk');
              addWorker({
                id: wid,
                label: `W-${String(n).padStart(2, '0')}`,
                name: isAr ? `عامل ${String(n).padStart(2, '0')}` : `Operator ${String(n).padStart(2, '0')}`,
                position: stObj
                  ? { x: stObj.geometry.position.x, y: 0, z: stObj.geometry.position.z + 1.0 }
                  : { x: 5, y: 0, z: 10 },
                rotation: 0,
                rotationDeg: 0,
                assignedStageIds: st ? [st.id] : [],
                assignedTo: stObj?.id,
                assignedStationId: stObj?.id,
                skillCategory: isAr ? 'تجميع وتشغيل' : 'Assembly',
                skillLevel: 4,
                efficiencyFactor: 1.0,
                walkingSpeedMps: 1.25,
                shiftId: project.simulationConfig.shifts[0]?.id || 'shift_day',
                color: '#1D4ED8',
              });
              selectItem('worker', wid);
            }}
            className="flex items-center gap-1 rounded bg-neutral-900 dark:bg-neutral-100 px-2 py-1 text-[11px] font-medium text-white dark:text-neutral-900"
          >
            <Plus className="w-3 h-3" />
            <span>{t.actions.add}</span>
          </button>
        </div>
      </div>

      {/* Draggable Worker Entity List */}
      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto min-w-0">
        {project.workers.map((w) => {
          const isEditing = editingWorkerId === w.id;
          const isSelected = selectedWorkerId === w.id;
          const workerRot = w.rotation ?? w.rotationDeg ?? 0;
          const assignedTargetId = w.assignedTo || w.assignedStationId;
          const assignedObj = assignedTargetId
            ? project.layoutObjects.find((o) => o.id === assignedTargetId)
            : undefined;
          const segLabel =
            assignedObj?.kind === 'conveyor' && w.assignedConveyorSegment?.objectId === assignedObj.id
              ? ` · S${w.assignedConveyorSegment.segmentIndex + 1}`
              : '';

          return (
            <div
              key={w.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-linesim-worker', w.id);
                e.dataTransfer.setData('text/plain', w.id);
                e.dataTransfer.effectAllowed = 'move';
                setDraggingWorkerId(w.id);
                selectItem('worker', w.id);
              }}
              onDragEnd={() => {
                setDraggingWorkerId(null);
                setHoverConvId(null);
                setHoverSeg(null);
              }}
              className={`flex flex-col gap-1.5 rounded border p-2 min-w-0 transition-colors ${
                draggingWorkerId === w.id
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 opacity-80'
                  : isSelected
                  ? 'border-red-500 bg-red-50/40 dark:bg-red-950/20'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <span
                  className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 shrink-0"
                  title={t.workforce.conveyorAssignHint}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </span>
                <button
                  type="button"
                  onClick={() => selectItem('worker', w.id)}
                  className="flex-1 min-w-0 text-start hover:underline"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">
                      {w.label} · {w.name}
                    </span>
                    <span className="shrink-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1 py-0.2 font-mono-tabular text-[9px] text-neutral-600 dark:text-neutral-300">
                      {Math.round(workerRot)}°
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500 truncate">
                    {w.skillCategory} · {w.walkingSpeedMps} m/s · {w.assignedStageIds.length} {t.workforce.stagesTag}
                    {assignedObj ? ` · ${t.workforce.assignedToLabel}: ${assignedObj.name}${segLabel}` : ''}
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      selectItem('worker', w.id);
                      setEditingWorkerId(isEditing ? null : w.id);
                    }}
                    title={t.actions.edit}
                    className={`p-1 rounded border ${
                      isEditing
                        ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWorker(w.id)}
                    title={t.actions.delete}
                    className="p-1 rounded border border-neutral-200 dark:border-neutral-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="grid grid-cols-2 gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5 min-w-0">
                  <label className="col-span-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.workerName}</span>
                    <input
                      type="text"
                      value={w.name}
                      onChange={(e) => updateWorker(w.id, { name: e.target.value })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.workforce.skill}</span>
                    <input
                      type="text"
                      value={w.skillCategory}
                      onChange={(e) => updateWorker(w.id, { skillCategory: e.target.value })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.walkingSpeed}</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.3}
                      value={w.walkingSpeedMps}
                      onChange={(e) =>
                        updateWorker(w.id, { walkingSpeedMps: Math.max(0.3, Number(e.target.value)) })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.efficiencyFactor}</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.5}
                      max={1.5}
                      value={w.efficiencyFactor}
                      onChange={(e) =>
                        updateWorker(w.id, {
                          efficiencyFactor: Math.max(0.5, Math.min(1.5, Number(e.target.value))),
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.rotationDeg}</span>
                    <input
                      type="number"
                      step={5}
                      min={-360}
                      max={360}
                      value={Math.round(workerRot * 10) / 10}
                      onChange={(e) => {
                        const wrapped = normalizeRotationDeg(Number(e.target.value) || 0);
                        updateWorker(w.id, { rotation: wrapped, rotationDeg: wrapped });
                      }}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="col-span-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.shiftAssignment}</span>
                    <select
                      value={w.shiftId || ''}
                      onChange={(e) => updateWorker(w.id, { shiftId: e.target.value || undefined })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="">{t.labels.plantDefaultShift}</option>
                      {project.simulationConfig.shifts.map((sh) => (
                        <option key={sh.id} value={sh.id}>
                          {sh.name}
                        </option>
                      ))}
                      {w.shiftId && !project.simulationConfig.shifts.some((s) => s.id === w.shiftId) && (
                        <option value={w.shiftId}>{w.shiftId} (Invalid)</option>
                      )}
                    </select>
                  </label>
                  <label className="col-span-2 flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.assignedStation}</span>
                    <select
                      value={assignedTargetId || ''}
                      onChange={(e) => {
                        const stationId = e.target.value || undefined;
                        if (!stationId) {
                          unassignWorkerTarget(w.id);
                          return;
                        }
                        const picked = project.layoutObjects.find((o) => o.id === stationId);
                        if (picked?.kind === 'conveyor') {
                          assignWorkerToConveyorSegment(w.id, picked.id, 0);
                          return;
                        }
                        commitProjectEdit((draft) => {
                          const wk = draft.workers.find((item) => item.id === w.id);
                          if (!wk) return;
                          wk.assignedTo = stationId;
                          wk.assignedStationId = stationId;
                          wk.assignedConveyorSegment = undefined;
                          const stObj = draft.layoutObjects.find((o) => o.id === stationId);
                          if (!stObj) return;
                          wk.position = {
                            x: stObj.geometry.position.x,
                            y: 0,
                            z: Math.min(
                              draft.factory.widthM - 0.3,
                              stObj.geometry.position.z + stObj.geometry.dimensions.width / 2 + 0.55
                            ),
                          };
                          let stage = draft.stages.find(
                            (s) => s.assignedObjectIds.includes(stObj.id) || s.id === stObj.stageId
                          );
                          if (!stage) {
                            const sid = uid('stg');
                            const idx = draft.stages.length + 1;
                            stage = {
                              id: sid,
                              code: `OP-${idx * 10}`,
                              name: stObj.name,
                              description: stObj.name,
                              processingTimeSec: Math.max(1, stObj.operations.processingTimeSec || 15),
                              setupTimeSec: stObj.operations.setupTimeSec || 0,
                              loadingTimeSec: stObj.operations.loadingTimeSec || 0,
                              unloadingTimeSec: stObj.operations.unloadingTimeSec || 0,
                              requiredWorkers: Math.max(1, stObj.operations.requiredOperators || 1),
                              requiredMachines: 1,
                              inputQty: 1,
                              outputQty: 1,
                              scrapRate: 0,
                              reworkProbability: 0,
                              bufferCapacity: Math.max(1, stObj.operations.capacity || 5),
                              predecessorIds: [],
                              successorIds: [],
                              assignedObjectIds: [stObj.id],
                            };
                            draft.stages.push(stage);
                            stObj.stageId = sid;
                          } else if (stage.requiredWorkers <= 0) {
                            stage.requiredWorkers = 1;
                          }
                          if (stObj.operations.requiredOperators <= 0) {
                            stObj.operations.requiredOperators = 1;
                          }
                          if (!wk.assignedStageIds.includes(stage.id)) {
                            wk.assignedStageIds = [...wk.assignedStageIds, stage.id];
                          }
                        });
                      }}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="">{t.labels.unassignedStation}</option>
                      {project.layoutObjects
                        .filter(
                          (o) =>
                            o.rendering.visible &&
                            (o.kind === 'machine' || o.kind === 'workstation' || o.kind === 'conveyor')
                        )
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.kind === 'conveyor' ? `[${t.flowchart.conveyorBadge}] ` : ''}
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Drag & Drop Conveyor & Segment Assignment Board */}
      <div className="flex flex-col gap-2 rounded border border-blue-200 dark:border-blue-900/70 bg-blue-50/40 dark:bg-blue-950/15 p-2.5 min-w-0">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-semibold text-blue-900 dark:text-blue-200 text-[11px]">
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.workforce.conveyorAssignTitle}</span>
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
            {t.workforce.conveyorAssignHint}
          </div>
        </div>

        {conveyors.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 dark:border-neutral-700 p-2 text-[10px] text-neutral-500">
            {t.workforce.noConveyorsHint}
          </div>
        ) : (
          <div className="flex flex-col gap-2 min-w-0">
            {conveyors.map((conv) => {
              const segCount = getConveyorSegmentCount(conv);
              const isCardOver = hoverConvId === conv.id;
              const convWorkers = project.workers.filter(
                (w) => (w.assignedTo || w.assignedStationId) === conv.id
              );

              return (
                <div
                  key={conv.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (hoverConvId !== conv.id) setHoverConvId(conv.id);
                  }}
                  onDragLeave={() => {
                    if (hoverConvId === conv.id) setHoverConvId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const workerId = extractDraggedWorkerId(e);
                    setHoverConvId(null);
                    setHoverSeg(null);
                    setDraggingWorkerId(null);
                    if (workerId) {
                      const defaultSegIdx = resolveDefaultConveyorSegment(conv.id, segCount);
                      assignWorkerToConveyorSegment(workerId, conv.id, defaultSegIdx, segCount);
                    }
                  }}
                  className={`flex flex-col gap-1.5 rounded border p-2 min-w-0 transition-colors ${
                    isCardOver
                      ? 'border-blue-500 bg-blue-100/70 dark:bg-blue-900/40'
                      : convWorkers.length > 0
                      ? 'border-blue-300 dark:border-blue-800 bg-white dark:bg-neutral-900'
                      : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 text-[11px] font-medium">
                    <span className="truncate">{conv.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {convWorkers.length > 0 && (
                        <span className="rounded bg-blue-600/10 px-1.5 py-0.2 font-mono-tabular text-[9px] font-semibold text-blue-700 dark:text-blue-300">
                          {convWorkers.length}
                        </span>
                      )}
                      {selectedWorkerId && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetSeg = resolveDefaultConveyorSegment(conv.id, segCount);
                            assignWorkerToConveyorSegment(selectedWorkerId, conv.id, targetSeg, segCount);
                          }}
                          className="rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.2 text-[9px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                        >
                          +
                        </button>
                      )}
                      <span className="font-mono-tabular text-[10px] text-neutral-400">
                        {conv.geometry.dimensions.length.toFixed(1)}m · {segCount} {t.workforce.segmentLabel}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 min-w-0">
                    {Array.from({ length: segCount }).map((_, segIdx) => {
                      const isOver =
                        hoverSeg?.convId === conv.id && hoverSeg.segIdx === segIdx;
                      const assignedHere = convWorkers.filter(
                        (w) => (w.assignedConveyorSegment?.segmentIndex ?? 0) === segIdx
                      );
                      return (
                        <div
                          key={segIdx}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                            if (hoverConvId !== conv.id) setHoverConvId(conv.id);
                            if (hoverSeg?.convId !== conv.id || hoverSeg.segIdx !== segIdx) {
                              setHoverSeg({ convId: conv.id, segIdx });
                            }
                          }}
                          onDragLeave={() => {
                            if (hoverSeg?.convId === conv.id && hoverSeg.segIdx === segIdx) {
                              setHoverSeg(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const workerId = extractDraggedWorkerId(e);
                            setHoverConvId(null);
                            setHoverSeg(null);
                            setDraggingWorkerId(null);
                            if (workerId) {
                              assignWorkerToConveyorSegment(workerId, conv.id, segIdx, segCount);
                            }
                          }}
                          onClick={() => {
                            if (selectedWorkerId) {
                              assignWorkerToConveyorSegment(selectedWorkerId, conv.id, segIdx, segCount);
                            }
                          }}
                          className={`flex flex-col gap-1 rounded border px-1.5 py-1 min-h-[40px] cursor-pointer transition-colors ${
                            isOver
                              ? 'border-blue-500 bg-blue-100/80 dark:bg-blue-900/50'
                              : assignedHere.length > 0
                              ? 'border-blue-300 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30'
                              : 'border-dashed border-neutral-300 dark:border-neutral-700 hover:border-blue-400'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[9px] font-semibold text-neutral-500">
                            <span>
                              {t.workforce.segmentLabel} {segIdx + 1}
                            </span>
                            {assignedHere.length === 0 && (
                              <span className="text-neutral-400 font-normal">
                                {selectedWorkerId ? '+' : ''}
                              </span>
                            )}
                          </div>
                          {assignedHere.length === 0 ? (
                            <span className="text-[9px] text-neutral-400 truncate">
                              {t.workforce.clickToAssignHint}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {assignedHere.map((wk) => (
                                <span
                                  key={wk.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectItem('worker', wk.id);
                                  }}
                                  className="inline-flex items-center gap-0.5 rounded bg-blue-600 text-white px-1 py-0.2 text-[9px] font-semibold"
                                >
                                  <span>{wk.label}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      unassignWorkerTarget(wk.id);
                                    }}
                                    title={t.workforce.unassignTarget}
                                    className="hover:text-red-200"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
