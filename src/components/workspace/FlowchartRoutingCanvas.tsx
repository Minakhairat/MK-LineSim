import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Cpu,
  Eye,
  GitBranch,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';
import { ProductionStage } from '../../types/project';
import {
  computeFlowchartReachableStages,
  ensureManualFlowchartSeeded,
  syncProductRoutes,
  syncStagePredecessorsAndObjectLinks,
} from '../../simulation/autoWire';
import { uid } from '../../utils/units';

const NODE_W = 240;
const NODE_H = 128;
const TERM_W = 182;
const TERM_H = 92;
const CANVAS_W = 1800;
const CANVAS_H = 880;

interface WireSource {
  kind: 'start' | 'stage';
  stageId?: string;
  x: number;
  y: number;
}

interface FlowchartEdge {
  id: string;
  kind: 'entry' | 'stage' | 'finish';
  fromStageId?: string;
  toStageId?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(58, Math.abs(x2 - x1) * 0.48);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function wouldCreateCycle(
  fromId: string,
  toId: string,
  stages: ProductionStage[]
): boolean {
  if (fromId === toId) return true;
  const map = new Map(stages.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const stack = [toId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const st = map.get(cur);
    if (st) {
      for (const nxt of st.successorIds) stack.push(nxt);
    }
  }
  return false;
}

export const FlowchartRoutingCanvas: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const selection = useAppStore((s) => s.selection);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const setActiveProduct = useAppStore((s) => s.setActiveProduct);
  const selectItem = useAppStore((s) => s.selectItem);
  const startSimulation = useAppStore((s) => s.startSimulation);
  const pauseSimulation = useAppStore((s) => s.pauseSimulation);
  const setViewportMode = useAppStore((s) => s.setViewportMode);
  const importFlowchartRoute = useAppStore((s) => s.importFlowchartRoute);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);
  const setToast = useAppStore((s) => s.setToast);

  const t = getT(language);
  const isAr = language === 'ar';
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const activeProduct = project.products[0];
  const entryIds = useMemo(() => {
    if (!activeProduct) return [] as string[];
    if (activeProduct.entryStageIds) return activeProduct.entryStageIds;
    return activeProduct.routeStageIds.length > 0 ? [activeProduct.routeStageIds[0]] : [];
  }, [activeProduct]);

  const reachableIds = useMemo(
    () => new Set(computeFlowchartReachableStages(entryIds, project.stages)),
    [entryIds, project.stages]
  );

  // All linkable floor equipment (workstations, machines, buffers, AND conveyors)
  const floorResources = useMemo(
    () =>
      project.layoutObjects.filter(
        (o) =>
          o.rendering.visible &&
          (o.kind === 'workstation' ||
            o.kind === 'machine' ||
            o.kind === 'buffer' ||
            o.kind === 'conveyor')
      ),
    [project.layoutObjects]
  );

  const assignedObjectIds = useMemo(
    () => new Set(project.stages.flatMap((s) => s.assignedObjectIds)),
    [project.stages]
  );

  const unlinkedResources = useMemo(
    () => floorResources.filter((o) => !assignedObjectIds.has(o.id)),
    [floorResources, assignedObjectIds]
  );

  const conveyorsList = useMemo(
    () => project.layoutObjects.filter((o) => o.rendering.visible && o.kind === 'conveyor'),
    [project.layoutObjects]
  );

  // Compute deterministic default positions for stages missing `flowPos`
  const nodePositions = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>();
    const stages = project.stages;
    const depthMap = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = entryIds.map((id) => ({ id, depth: 0 }));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const prev = depthMap.get(id) ?? -1;
      if (depth > prev) depthMap.set(id, depth);
      if (visited.has(id) && depth <= prev) continue;
      visited.add(id);
      const st = stages.find((s) => s.id === id);
      if (st) {
        for (const sid of st.successorIds) {
          queue.push({ id: sid, depth: depth + 1 });
        }
      }
    }

    const colBuckets = new Map<number, number>();
    stages.forEach((st, idx) => {
      if (st.flowPos) {
        posMap.set(st.id, st.flowPos);
        return;
      }
      const col = depthMap.has(st.id) ? depthMap.get(st.id)! : Math.floor(idx / 3);
      const row = colBuckets.get(col) ?? 0;
      colBuckets.set(col, row + 1);
      posMap.set(st.id, {
        x: 270 + col * 290,
        y: 80 + row * 165,
      });
    });
    return posMap;
  }, [project.stages, entryIds]);

  const startNodePos = useMemo(() => ({ x: 32, y: 245 }), []);
  const finishNodePos = useMemo(() => {
    let maxRight = 880;
    for (const p of nodePositions.values()) {
      maxRight = Math.max(maxRight, p.x + NODE_W + 96);
    }
    return { x: Math.min(CANVAS_W - TERM_W - 28, maxRight), y: 245 };
  }, [nodePositions]);

  const [draggingNode, setDraggingNode] = useState<{
    stageId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [liveDragPos, setLiveDragPos] = useState<{ stageId: string; x: number; y: number } | null>(null);

  const [wiringFrom, setWiringFrom] = useState<WireSource | null>(null);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const getPos = useCallback(
    (stageId: string) => {
      if (liveDragPos && liveDragPos.stageId === stageId) {
        return { x: liveDragPos.x, y: liveDragPos.y };
      }
      return nodePositions.get(stageId) || { x: 280, y: 120 };
    },
    [liveDragPos, nodePositions]
  );

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const el = canvasRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left + el.scrollLeft) / zoom,
        y: (clientY - rect.top + el.scrollTop) / zoom,
      };
    },
    [zoom]
  );

  // Cancel wiring on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWiringFrom(null);
        setCursorPt(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Global pointer tracking for dragging stage cards & previewing wires
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingNode) {
        const dx = (e.clientX - draggingNode.startClientX) / zoom;
        const dy = (e.clientY - draggingNode.startClientY) / zoom;
        const nx = Math.max(228, Math.min(CANVAS_W - NODE_W - 220, draggingNode.origX + dx));
        const ny = Math.max(24, Math.min(CANVAS_H - NODE_H - 24, draggingNode.origY + dy));
        setLiveDragPos({ stageId: draggingNode.stageId, x: Math.round(nx), y: Math.round(ny) });
      }
      if (wiringFrom) {
        setCursorPt(clientToCanvas(e.clientX, e.clientY));
      }
    };

    const onUp = () => {
      if (draggingNode) {
        const finalPos = liveDragPos;
        const sid = draggingNode.stageId;
        setDraggingNode(null);
        setLiveDragPos(null);
        if (finalPos && finalPos.stageId === sid) {
          commitProjectEdit((draft) => {
            const st = draft.stages.find((s) => s.id === sid);
            if (st) st.flowPos = { x: finalPos.x, y: finalPos.y };
          });
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingNode, liveDragPos, wiringFrom, clientToCanvas, commitProjectEdit, zoom]);

  const completeWireToStage = useCallback(
    (targetStageId: string) => {
      if (!wiringFrom || !activeProduct) return;

      if (wiringFrom.kind === 'start') {
        commitProjectEdit((draft) => {
          ensureManualFlowchartSeeded(draft);
          const prod = draft.products[0];
          if (!prod) return;
          prod.routingMode = 'manual';
          const entries = new Set(prod.entryStageIds || []);
          entries.add(targetStageId);
          prod.entryStageIds = Array.from(entries);
          syncStagePredecessorsAndObjectLinks(draft);
          syncProductRoutes(draft);
        });
        setToast(t.flowchart.connectedEntry, 'success');
      } else if (wiringFrom.kind === 'stage' && wiringFrom.stageId) {
        const fromId = wiringFrom.stageId;
        if (fromId === targetStageId || wouldCreateCycle(fromId, targetStageId, project.stages)) {
          setToast(t.flowchart.cycleBlocked, 'error');
        } else {
          commitProjectEdit((draft) => {
            ensureManualFlowchartSeeded(draft);
            const src = draft.stages.find((s) => s.id === fromId);
            if (src && !src.successorIds.includes(targetStageId)) {
              src.successorIds.push(targetStageId);
            }
            syncStagePredecessorsAndObjectLinks(draft);
            syncProductRoutes(draft);
          });
          setToast(t.flowchart.connectedStages, 'success');
        }
      }

      setWiringFrom(null);
      setCursorPt(null);
    },
    [wiringFrom, activeProduct, project.stages, commitProjectEdit, setToast, t.flowchart]
  );

  const completeWireToFinish = useCallback(() => {
    if (!wiringFrom || wiringFrom.kind !== 'stage' || !wiringFrom.stageId) {
      setWiringFrom(null);
      setCursorPt(null);
      return;
    }
    const fromId = wiringFrom.stageId;
    commitProjectEdit((draft) => {
      ensureManualFlowchartSeeded(draft);
      const src = draft.stages.find((s) => s.id === fromId);
      if (src) {
        src.successorIds = [];
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
    setToast(t.flowchart.connectedFinish, 'success');
    setWiringFrom(null);
    setCursorPt(null);
  }, [wiringFrom, commitProjectEdit, setToast, t.flowchart]);

  const removeEdge = (edge: FlowchartEdge) => {
    if (edge.kind === 'finish') return;
    commitProjectEdit((draft) => {
      ensureManualFlowchartSeeded(draft);
      const prod = draft.products[0];
      if (edge.kind === 'entry' && edge.toStageId && prod) {
        prod.entryStageIds = (prod.entryStageIds || []).filter((id) => id !== edge.toStageId);
      } else if (edge.kind === 'stage' && edge.fromStageId && edge.toStageId) {
        const src = draft.stages.find((s) => s.id === edge.fromStageId);
        if (src) {
          src.successorIds = src.successorIds.filter((id) => id !== edge.toStageId);
        }
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
  };

  const handleAutoArrange = () => {
    commitProjectEdit((draft) => {
      const entries = draft.products[0]?.entryStageIds || (draft.stages[0] ? [draft.stages[0].id] : []);
      const depthMap = new Map<string, number>();
      const queue = entries.map((id) => ({ id, d: 0 }));
      const visited = new Set<string>();
      while (queue.length > 0) {
        const item = queue.shift()!;
        depthMap.set(item.id, Math.max(depthMap.get(item.id) ?? 0, item.d));
        if (visited.has(item.id)) continue;
        visited.add(item.id);
        const st = draft.stages.find((s) => s.id === item.id);
        if (st) {
          for (const sid of st.successorIds) queue.push({ id: sid, d: item.d + 1 });
        }
      }
      const colCounts = new Map<number, number>();
      draft.stages.forEach((st, idx) => {
        const col = depthMap.has(st.id) ? depthMap.get(st.id)! : Math.floor(idx / 3);
        const row = colCounts.get(col) ?? 0;
        colCounts.set(col, row + 1);
        st.flowPos = {
          x: Math.min(CANVAS_W - NODE_W - 220, 265 + col * 290),
          y: 65 + row * 162,
        };
      });
    });
  };

  const handleChainSequentially = () => {
    commitProjectEdit((draft) => {
      const prod = draft.products[0];
      if (!prod) return;
      prod.routingMode = 'manual';
      prod.entryStageIds = draft.stages.length > 0 ? [draft.stages[0].id] : [];
      draft.stages.forEach((st, idx) => {
        st.successorIds = idx < draft.stages.length - 1 ? [draft.stages[idx + 1].id] : [];
        st.flowPos = {
          x: Math.min(CANVAS_W - NODE_W - 220, 265 + (idx % 4) * 285),
          y: 90 + Math.floor(idx / 4) * 175,
        };
      });
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
    setToast(t.flowchart.chainedAll, 'success');
  };

  const handleClearWires = () => {
    commitProjectEdit((draft) => {
      const prod = draft.products[0];
      if (prod) {
        prod.routingMode = 'manual';
        prod.entryStageIds = [];
        prod.routeStageIds = [];
      }
      for (const st of draft.stages) {
        st.predecessorIds = [];
        st.successorIds = [];
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
    setToast(t.flowchart.clearedWires, 'info');
  };

  const handleAddFloorObjectNode = (objId?: string) => {
    const targetObj = objId
      ? floorResources.find((o) => o.id === objId)
      : unlinkedResources[0] || floorResources[0];

    const idx = project.stages.length + 1;
    const newId = uid('stg');
    const col = (idx - 1) % 3;
    const row = Math.floor((idx - 1) / 3);
    const isConv = targetObj?.kind === 'conveyor';

    commitProjectEdit((draft) => {
      ensureManualFlowchartSeeded(draft);
      draft.stages.push({
        id: newId,
        code: isConv ? `CNV-${idx * 10}` : `OP-${idx * 10}`,
        name: targetObj ? targetObj.name : isAr ? `مرحلة ${idx}` : `Stage ${idx}`,
        description: isConv
          ? isAr
            ? 'مرحلة سير ناقل في مخطط التدفق'
            : 'Conveyor belt transfer node in Flowchart'
          : isAr
          ? 'مرحلة مضافة عبر مخطط التدفق'
          : 'Stage created in Flowchart editor',
        processingTimeSec: isConv ? 0 : targetObj?.operations.processingTimeSec || 25,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        requiredWorkers: isConv || targetObj?.kind === 'buffer' ? 0 : 1,
        requiredMachines: 1,
        inputQty: 1,
        outputQty: 1,
        scrapRate: isConv ? 0 : 0.005,
        reworkProbability: 0,
        bufferCapacity: isConv ? 12 : 4,
        predecessorIds: [],
        successorIds: [],
        assignedObjectIds: targetObj ? [targetObj.id] : [],
        flowPos: { x: 265 + col * 285, y: 80 + row * 165 },
      });
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
    if (objId) {
      setToast(t.flowchart.addedResource, 'success');
    }
  };

  const handleDeleteStageNode = (stageId: string) => {
    if (editingStageId === stageId) setEditingStageId(null);
    commitProjectEdit((draft) => {
      ensureManualFlowchartSeeded(draft);
      draft.stages = draft.stages.filter((x) => x.id !== stageId);
      for (const s of draft.stages) {
        s.successorIds = s.successorIds.filter((x) => x !== stageId);
      }
      for (const pr of draft.products) {
        if (pr.entryStageIds) {
          pr.entryStageIds = pr.entryStageIds.filter((x) => x !== stageId);
        }
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    });
  };

  // Build renderable edges
  const edges = useMemo(() => {
    const list: FlowchartEdge[] = [];
    for (const eid of entryIds) {
      const st = project.stages.find((s) => s.id === eid);
      if (!st) continue;
      const p = getPos(eid);
      list.push({
        id: `entry__${eid}`,
        kind: 'entry',
        toStageId: eid,
        x1: startNodePos.x + TERM_W,
        y1: startNodePos.y + TERM_H / 2,
        x2: p.x,
        y2: p.y + NODE_H / 2,
      });
    }

    for (const st of project.stages) {
      const p1 = getPos(st.id);
      for (const sid of st.successorIds) {
        const target = project.stages.find((s) => s.id === sid);
        if (!target) continue;
        const p2 = getPos(sid);
        list.push({
          id: `stg__${st.id}__${sid}`,
          kind: 'stage',
          fromStageId: st.id,
          toStageId: sid,
          x1: p1.x + NODE_W,
          y1: p1.y + NODE_H / 2,
          x2: p2.x,
          y2: p2.y + NODE_H / 2,
        });
      }

      if (reachableIds.has(st.id) && st.successorIds.length === 0) {
        list.push({
          id: `fin__${st.id}`,
          kind: 'finish',
          fromStageId: st.id,
          x1: p1.x + NODE_W,
          y1: p1.y + NODE_H / 2,
          x2: finishNodePos.x,
          y2: finishNodePos.y + TERM_H / 2,
        });
      }
    }
    return list;
  }, [entryIds, project.stages, getPos, startNodePos, finishNodePos, reachableIds]);

  const editingStage = editingStageId
    ? project.stages.find((s) => s.id === editingStageId)
    : undefined;

  const isSimRunning = simSnapshot.status === 'running';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-100 dark:bg-neutral-950">
      {/* Flowchart Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-900 dark:text-white whitespace-nowrap shrink-0">
            <GitBranch className="w-4 h-4 text-red-600" />
            <span>{t.flowchart.title}</span>
          </div>

          {project.products.length > 0 && (
            <select
              value={activeProduct?.id || ''}
              onChange={(e) => setActiveProduct(e.target.value)}
              className="max-w-[180px] rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1 text-xs font-medium text-neutral-800 dark:text-neutral-200"
            >
              {project.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          )}

          <span className="hidden xl:inline text-[11px] text-neutral-500 truncate">
            {activeProduct?.routingMode === 'manual' ? t.flowchart.modeManual : t.flowchart.modeAuto}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.1).toFixed(2))))}
              className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-1.5 text-[11px] font-mono-tabular hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
              className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => handleAddFloorObjectNode()}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-red-600" />
            <span>{t.flowchart.addNode}</span>
          </button>

          <button
            onClick={handleAutoArrange}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{t.flowchart.autoArrange}</span>
          </button>

          <button
            onClick={handleChainSequentially}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            <Link2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{t.flowchart.chainAll}</span>
          </button>

          <button
            onClick={handleClearWires}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            <Unlink className="w-3.5 h-3.5 text-amber-600" />
            <span>{t.flowchart.clearWires}</span>
          </button>

          <button
            onClick={() => importFlowchartRoute(false)}
            className="flex items-center gap-1 rounded border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-2.5 py-1 text-xs font-medium text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.actions.importFlowchart}</span>
          </button>

          <button
            onClick={() => {
              if (isSimRunning) {
                pauseSimulation();
              } else {
                startSimulation();
              }
            }}
            className="flex items-center gap-1 rounded border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isSimRunning ? t.actions.pause : t.flowchart.runFlow}</span>
          </button>

          <button
            onClick={() => {
              startSimulation();
              setViewportMode('split');
            }}
            className="flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap shrink-0"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{t.flowchart.simulateAndWatch}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
            className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}</span>
          </button>
        </div>
      </div>

      {/* Hint Banner */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 px-3 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span className="truncate">
            {wiringFrom ? t.flowchart.wiringActiveHint : t.flowchart.hint}
          </span>
        </div>
        <div className="font-mono-tabular shrink-0 text-[11px] text-neutral-500">
          {reachableIds.size}/{project.stages.length} {t.flowchart.activeNodes}
          {simSnapshot.clockSec > 0 && (
            <span className="ms-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              · {t.labels.good}: {simSnapshot.products.filter((p) => p.locationKind === 'completed').length}
            </span>
          )}
        </div>
      </div>

      {/* Main Split: Unlinked Floor Equipment & Conveyors Tray + Flowchart Canvas */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Resource Tray: Add Conveyors & Floor Machines directly into Flowchart */}
        <aside className="flex w-52 shrink-0 flex-col border-e border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="border-b border-neutral-200 dark:border-neutral-800 px-3 py-2 text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
            {t.flowchart.floorResources} ({unlinkedResources.length})
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
            {unlinkedResources.length === 0 ? (
              <div className="rounded border border-dashed border-neutral-200 dark:border-neutral-800 p-2.5 text-[11px] text-neutral-500 leading-relaxed">
                {t.flowchart.allPlacedInFlow}
              </div>
            ) : (
              unlinkedResources.map((obj) => {
                const isConv = obj.kind === 'conveyor';
                return (
                  <button
                    key={obj.id}
                    type="button"
                    onClick={() => handleAddFloorObjectNode(obj.id)}
                    className="flex flex-col gap-1 rounded border border-neutral-200 dark:border-neutral-800 p-2 text-start hover:border-red-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          isConv
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                            : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                        }`}
                      >
                        {isConv ? t.flowchart.conveyorBadge : t.flowchart.stationBadge}
                      </span>
                      <Plus className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    </div>
                    <div className="text-[11px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {obj.name}
                    </div>
                    <div className="text-[10px] font-mono-tabular text-neutral-500">
                      {isConv
                        ? `${obj.geometry.dimensions.length.toFixed(1)}m · ${(obj.operations.speedMps ?? 0.06).toFixed(2)} m/s`
                        : `${obj.operations.processingTimeSec}s · ${obj.operations.requiredOperators} ${t.flowchart.workersShort}`}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Interactive Flowchart Canvas (LTR internal coordinates for clean left-to-right wiring) */}
        <div
          ref={canvasRef}
          dir="ltr"
          onClick={() => {
            if (wiringFrom) {
              setWiringFrom(null);
              setCursorPt(null);
            }
          }}
          className="relative flex-1 overflow-auto bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:20px_20px]"
        >
          <div
            className="relative select-none origin-top-left"
            style={{
              width: CANVAS_W * zoom,
              height: CANVAS_H * zoom,
            }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: `scale(${zoom})`,
              }}
            >
              {/* SVG Wires Layer */}
              <svg
                width={CANVAS_W}
                height={CANVAS_H}
                className="absolute inset-0 pointer-events-none"
              >
                <defs>
                  <marker
                    id="fc-arrow-red"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6.5"
                    markerHeight="6.5"
                    orient="auto"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#DC2626" />
                  </marker>
                  <marker
                    id="fc-arrow-green"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6.5"
                    markerHeight="6.5"
                    orient="auto"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
                  </marker>
                  <marker
                    id="fc-arrow-slate"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                  </marker>
                </defs>

                {edges.map((edge) => {
                  const pathD = buildBezierPath(edge.x1, edge.y1, edge.x2, edge.y2);
                  const mx = (edge.x1 + edge.x2) / 2;
                  const my = (edge.y1 + edge.y2) / 2;
                  const isHovered = hoveredEdgeId === edge.id;
                  const stroke =
                    edge.kind === 'entry'
                      ? '#16A34A'
                      : edge.kind === 'finish'
                      ? '#475569'
                      : '#DC2626';
                  const marker =
                    edge.kind === 'entry'
                      ? 'url(#fc-arrow-green)'
                      : edge.kind === 'finish'
                      ? 'url(#fc-arrow-slate)'
                      : 'url(#fc-arrow-red)';

                  return (
                    <g
                      key={edge.id}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId(null)}
                      className={edge.kind !== 'finish' ? 'pointer-events-auto cursor-pointer' : ''}
                    >
                      {edge.kind !== 'finish' && (
                        <path
                          d={pathD}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={16}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEdge(edge);
                          }}
                        />
                      )}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isHovered ? 3.8 : 2.6}
                        strokeDasharray={
                          isSimRunning ? '8 5' : edge.kind === 'finish' ? '6 4' : undefined
                        }
                        markerEnd={marker}
                      >
                        {isSimRunning && (
                          <animate
                            attributeName="stroke-dashoffset"
                            from="26"
                            to="0"
                            dur="0.7s"
                            repeatCount="indefinite"
                          />
                        )}
                      </path>
                      {edge.kind !== 'finish' && (
                        <g
                          transform={`translate(${mx}, ${my})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEdge(edge);
                          }}
                        >
                          <circle
                            r={isHovered ? 11 : 8.5}
                            fill={isHovered ? '#DC2626' : '#FFFFFF'}
                            stroke={stroke}
                            strokeWidth={1.6}
                          />
                          <text
                            x={0}
                            y={0.5}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={11}
                            fontWeight={700}
                            fill={isHovered ? '#FFFFFF' : stroke}
                          >
                            ×
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {wiringFrom && cursorPt && (
                  <path
                    d={buildBezierPath(wiringFrom.x, wiringFrom.y, cursorPt.x, cursorPt.y)}
                    fill="none"
                    stroke="#DC2626"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    markerEnd="url(#fc-arrow-red)"
                  />
                )}
              </svg>

              {/* START Terminal Node */}
              <div
                style={{
                  left: startNodePos.x,
                  top: startNodePos.y,
                  width: TERM_W,
                  height: TERM_H,
                }}
                className="absolute rounded-md border-2 border-emerald-600 bg-white dark:bg-neutral-900 shadow-md flex flex-col justify-between p-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {t.flowchart.startNode}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div className="text-xs font-semibold text-neutral-900 dark:text-white truncate" dir={isAr ? 'rtl' : 'ltr'}>
                  {activeProduct ? `${activeProduct.code} · ${activeProduct.name}` : t.flowchart.rawMaterial}
                </div>
                <div className="text-[10px] text-neutral-500 font-mono-tabular">
                  {entryIds.length} {t.flowchart.linkedPaths}
                </div>

                <button
                  type="button"
                  title={t.flowchart.portOutTip}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const pt = {
                      kind: 'start' as const,
                      x: startNodePos.x + TERM_W,
                      y: startNodePos.y + TERM_H / 2,
                    };
                    setWiringFrom(pt);
                    setCursorPt({ x: pt.x + 20, y: pt.y });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const pt = {
                      kind: 'start' as const,
                      x: startNodePos.x + TERM_W,
                      y: startNodePos.y + TERM_H / 2,
                    };
                    setWiringFrom(pt);
                    setCursorPt({ x: pt.x + 20, y: pt.y });
                  }}
                  className={`absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-2 border-white dark:border-neutral-900 shadow transition-transform hover:scale-125 ${
                    wiringFrom?.kind === 'start' ? 'bg-red-600 scale-125' : 'bg-emerald-600'
                  }`}
                />
              </div>

              {/* Stage & Conveyor Nodes */}
              {project.stages.map((st) => {
                const p = getPos(st.id);
                const isReachable = reachableIds.has(st.id);
                const isEntry = entryIds.includes(st.id);
                const assignedObj = project.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
                const isConveyorNode = assignedObj?.kind === 'conveyor';
                const rt = assignedObj ? simSnapshot.objects[assignedObj.id] : undefined;
                const liveBusy = rt?.busyUnitIds.length ?? 0;
                const liveDone = rt?.processedCount ?? 0;
                const isSelected =
                  (selection.kind === 'stage' && selection.ids.includes(st.id)) ||
                  (selection.kind === 'object' && assignedObj && selection.ids.includes(assignedObj.id));

                return (
                  <div
                    key={st.id}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (wiringFrom && wiringFrom.stageId !== st.id) {
                        completeWireToStage(st.id);
                        return;
                      }
                      if (assignedObj) selectItem('object', assignedObj.id);
                    }}
                    onPointerUp={(e) => {
                      if (wiringFrom && wiringFrom.stageId !== st.id) {
                        e.stopPropagation();
                        completeWireToStage(st.id);
                      }
                    }}
                    className={`absolute rounded-md border-2 bg-white dark:bg-neutral-900 shadow-sm transition-shadow flex flex-col justify-between ${
                      wiringFrom && wiringFrom.stageId !== st.id
                        ? 'ring-2 ring-emerald-400/50 hover:border-emerald-500'
                        : isSelected
                        ? 'border-red-600 shadow-md'
                        : isReachable
                        ? isConveyorNode
                          ? 'border-sky-600 dark:border-sky-500'
                          : 'border-neutral-800 dark:border-neutral-600'
                        : 'border-dashed border-amber-500/80 opacity-85'
                    }`}
                  >
                    {/* Node Drag Header */}
                    <div
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest('button,select')) return;
                        e.stopPropagation();
                        setDraggingNode({
                          stageId: st.id,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origX: p.x,
                          origY: p.y,
                        });
                      }}
                      className={`flex items-center justify-between gap-1 rounded-t px-2.5 py-1.5 cursor-grab active:cursor-grabbing ${
                        !isReachable
                          ? 'bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200'
                          : isConveyorNode
                          ? 'bg-sky-700 text-white'
                          : 'bg-neutral-900 text-white dark:bg-neutral-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono-tabular text-[10px] font-bold text-red-300 shrink-0">
                          {st.code}
                        </span>
                        <span className="text-[11px] font-semibold truncate" dir={isAr ? 'rtl' : 'ltr'}>
                          {st.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isEntry && (
                          <span className="text-[9px] font-bold uppercase px-1 rounded bg-emerald-500/25 text-emerald-200">
                            IN
                          </span>
                        )}
                        <span className="text-[9px] uppercase opacity-80">
                          {isConveyorNode ? t.flowchart.conveyorBadge : ''}
                        </span>
                      </div>
                    </div>

                    {/* Body: Linked Floor Equipment + Parameters */}
                    <div className="px-2.5 py-1.5 flex flex-col gap-1.5 text-[11px]" dir={isAr ? 'rtl' : 'ltr'}>
                      <select
                        value={st.assignedObjectIds[0] || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const objId = e.target.value;
                          commitProjectEdit((draft) => {
                            const target = draft.stages.find((x) => x.id === st.id);
                            const pickedObj = draft.layoutObjects.find((o) => o.id === objId);
                            if (target) {
                              target.assignedObjectIds = objId ? [objId] : [];
                              if (pickedObj?.kind === 'conveyor') {
                                target.requiredWorkers = 0;
                                target.processingTimeSec = 0;
                              }
                            }
                            syncStagePredecessorsAndObjectLinks(draft);
                          });
                        }}
                        className="w-full min-w-0 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-1.5 py-0.5 text-[10px] font-medium text-neutral-800 dark:text-neutral-200"
                      >
                        <option value="">{t.processes.unassigned}</option>
                        {floorResources.map((obj) => (
                          <option key={obj.id} value={obj.id}>
                            {obj.kind === 'conveyor' ? `[${t.flowchart.conveyorBadge}] ` : ''}
                            {obj.name}
                          </option>
                        ))}
                      </select>

                      {/* Live simulation status + operational readout */}
                      <div className="flex items-center justify-between text-[10px] font-mono-tabular text-neutral-600 dark:text-neutral-400">
                        {isConveyorNode && assignedObj ? (
                          <span>
                            {assignedObj.geometry.dimensions.length.toFixed(1)}m ·{' '}
                            {(assignedObj.operations.speedMps ?? 0.06).toFixed(2)}m/s
                          </span>
                        ) : (
                          <span>
                            {st.processingTimeSec}s · {st.requiredWorkers} {t.flowchart.workersShort} · Buf {st.bufferCapacity}
                          </span>
                        )}
                        {simSnapshot.clockSec > 0 && (
                          <span
                            className={`font-semibold ${
                              liveBusy > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {t.flowchart.liveWip}:{liveBusy} | {liveDone}
                          </span>
                        )}
                      </div>

                      {/* Edit & Delete action bar */}
                      <div className="flex items-center justify-between border-t border-neutral-100 dark:border-neutral-800 pt-1">
                        <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                          <Cpu className="w-3 h-3" />
                          {rt
                            ? t.simStatus[rt.status as keyof typeof t.simStatus] || rt.status
                            : isConveyorNode
                            ? t.flowchart.conveyorBadge
                            : t.flowchart.stationBadge}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingStageId(st.id);
                            }}
                            title={t.actions.edit}
                            className="p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteStageNode(st.id);
                            }}
                            title={t.actions.delete}
                            className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Input Port (Left) */}
                    <button
                      type="button"
                      title={t.flowchart.portInTip}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wiringFrom && wiringFrom.stageId !== st.id) {
                          completeWireToStage(st.id);
                        }
                      }}
                      onPointerUp={(e) => {
                        if (wiringFrom && wiringFrom.stageId !== st.id) {
                          e.stopPropagation();
                          completeWireToStage(st.id);
                        }
                      }}
                      className={`absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-2 border-white dark:border-neutral-900 shadow transition-transform hover:scale-125 ${
                        wiringFrom && wiringFrom.stageId !== st.id
                          ? 'bg-emerald-500 ring-2 ring-emerald-400/70 scale-115'
                          : 'bg-neutral-500'
                      }`}
                    />

                    {/* Output Port (Right) */}
                    <button
                      type="button"
                      title={t.flowchart.portOutTip}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const pt = {
                          kind: 'stage' as const,
                          stageId: st.id,
                          x: p.x + NODE_W,
                          y: p.y + NODE_H / 2,
                        };
                        setWiringFrom(pt);
                        setCursorPt({ x: pt.x + 20, y: pt.y });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const pt = {
                          kind: 'stage' as const,
                          stageId: st.id,
                          x: p.x + NODE_W,
                          y: p.y + NODE_H / 2,
                        };
                        setWiringFrom(pt);
                        setCursorPt({ x: pt.x + 20, y: pt.y });
                      }}
                      className={`absolute -right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-2 border-white dark:border-neutral-900 shadow transition-transform hover:scale-125 ${
                        wiringFrom?.stageId === st.id ? 'bg-amber-500 scale-125' : 'bg-red-600'
                      }`}
                    />
                  </div>
                );
              })}

              {/* FINISH Terminal Node */}
              <div
                style={{
                  left: finishNodePos.x,
                  top: finishNodePos.y,
                  width: TERM_W,
                  height: TERM_H,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (wiringFrom?.kind === 'stage') completeWireToFinish();
                }}
                onPointerUp={(e) => {
                  if (wiringFrom?.kind === 'stage') {
                    e.stopPropagation();
                    completeWireToFinish();
                  }
                }}
                className={`absolute rounded-md border-2 bg-white dark:bg-neutral-900 shadow-md flex flex-col justify-between p-2.5 ${
                  wiringFrom?.kind === 'stage'
                    ? 'border-red-600 ring-2 ring-red-400/40'
                    : 'border-neutral-800 dark:border-neutral-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                    {t.flowchart.finishNode}
                  </span>
                </div>
                <div className="text-xs font-semibold text-neutral-900 dark:text-white truncate" dir={isAr ? 'rtl' : 'ltr'}>
                  {t.flowchart.finishedGoods}
                </div>
                <div className="text-[10px] text-neutral-500 font-mono-tabular">
                  {project.stages.filter((s) => reachableIds.has(s.id) && s.successorIds.length === 0).length}{' '}
                  {t.flowchart.exitCount}
                </div>

                <button
                  type="button"
                  title={t.flowchart.finishNode}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (wiringFrom?.kind === 'stage') completeWireToFinish();
                  }}
                  className={`absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full border-2 border-white dark:border-neutral-900 shadow transition-transform hover:scale-125 ${
                    wiringFrom?.kind === 'stage' ? 'bg-red-600 scale-125' : 'bg-neutral-700'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Inline Node Editor Modal */}
          {editingStage && (
            <div
              dir={isAr ? 'rtl' : 'ltr'}
              onClick={(e) => e.stopPropagation()}
              className="fixed bottom-12 right-8 z-30 w-80 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3.5 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-2 mb-2.5">
                <span className="font-bold text-neutral-900 dark:text-white">
                  {t.flowchart.editNode} · {editingStage.code}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingStageId(null)}
                  className="p-0.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.code}</span>
                  <input
                    type="text"
                    value={editingStage.code}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.code = e.target.value;
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.equipment.equipmentName}</span>
                  <input
                    type="text"
                    value={editingStage.name}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.name = e.target.value;
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.procSec}</span>
                  <input
                    type="number"
                    min={0}
                    value={editingStage.processingTimeSec}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.processingTimeSec = Math.max(0, Number(e.target.value));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.workers}</span>
                  <input
                    type="number"
                    min={0}
                    value={editingStage.requiredWorkers}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.requiredWorkers = Math.max(0, Math.round(Number(e.target.value)));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.bufferCap}</span>
                  <input
                    type="number"
                    min={1}
                    value={editingStage.bufferCapacity}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.bufferCapacity = Math.max(1, Math.round(Number(e.target.value)));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.scrapPct}</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={50}
                    value={Number((editingStage.scrapRate * 100).toFixed(1))}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.scrapRate = Math.max(0, Math.min(0.5, Number(e.target.value) / 100));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.setupSec}</span>
                  <input
                    type="number"
                    min={0}
                    value={editingStage.setupTimeSec}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.setupTimeSec = Math.max(0, Number(e.target.value));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.loadSec}</span>
                  <input
                    type="number"
                    min={0}
                    value={editingStage.loadingTimeSec}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.loadingTimeSec = Math.max(0, Number(e.target.value));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-500">{t.processes.unloadSec}</span>
                  <input
                    type="number"
                    min={0}
                    value={editingStage.unloadingTimeSec}
                    onChange={(e) =>
                      commitProjectEdit((draft) => {
                        const s = draft.stages.find((x) => x.id === editingStage.id);
                        if (s) s.unloadingTimeSec = Math.max(0, Number(e.target.value));
                      })
                    }
                    className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-0.5 mb-2.5">
                <span className="text-[10px] text-neutral-500">{t.processes.conveyorLink}</span>
                <select
                  value={editingStage.conveyorObjectId || ''}
                  onChange={(e) =>
                    commitProjectEdit((draft) => {
                      const s = draft.stages.find((x) => x.id === editingStage.id);
                      if (s) s.conveyorObjectId = e.target.value || undefined;
                    })
                  }
                  className="min-w-0 w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-1.5 py-1 text-[11px]"
                >
                  <option value="">{t.processes.unassigned}</option>
                  {conveyorsList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.geometry.dimensions.length.toFixed(1)}m)
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => handleDeleteStageNode(editingStage.id)}
                  className="rounded border border-red-200 dark:border-red-900 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  {t.actions.delete}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingStageId(null)}
                  className="rounded bg-neutral-900 dark:bg-neutral-100 px-3 py-1 text-[11px] font-medium text-white dark:text-neutral-900"
                >
                  {t.actions.close}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
