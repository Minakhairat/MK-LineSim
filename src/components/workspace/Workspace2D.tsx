import React, { useEffect, useRef, useState } from 'react';
import { Flame, Maximize2, Ruler, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { fromMeters, snapValue } from '../../utils/units';
import { LayoutObject, MachineRuntimeStatus } from '../../types/project';
import { getT } from '../../i18n/translations';
import {
  computeObjectHeatmapMetrics,
  HEATMAP_LEGEND_STOPS,
  resolveHeatmapActiveTimeSec,
} from '../../simulation/heatmap';
import {
  computeConveyorSegmentPlacement,
  findConveyorSegmentAtPoint,
  getConveyorSegmentCount,
  normalizeRotationDeg,
} from '../../engineering/conveyorWorkerAssignment';

const STATUS_RING: Record<MachineRuntimeStatus, string> = {
  running: '#16A34A',
  idle: '#64748B',
  blocked: '#D97706',
  starved: '#CA8A04',
  setup: '#0284C7',
  down: '#DC2626',
  maintenance: '#7C3AED',
  unavailable: '#94A3B8',
};

type DragState =
  | { mode: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number }
  | { mode: 'move_obj'; id: string; startWorldX: number; startWorldZ: number; origX: number; origZ: number }
  | { mode: 'move_worker'; id: string; startWorldX: number; startWorldZ: number; origX: number; origZ: number }
  | { mode: 'move_zone'; id: string; startWorldX: number; startWorldZ: number; origX: number; origZ: number }
  | { mode: 'rotate_obj'; id: string; cx: number; cz: number }
  | { mode: 'rotate_worker'; id: string; cx: number; cz: number }
  | { mode: 'resize_obj'; id: string; origL: number; origW: number; cx: number; cz: number; rotDeg: number };

export const Workspace2D: React.FC = () => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const project = useAppStore((s) => s.project);
  const selection = useAppStore((s) => s.selection);
  const activeModule = useAppStore((s) => s.activeModule);
  const layersVisible = useAppStore((s) => s.layersVisible);
  const measureMode = useAppStore((s) => s.measureMode);
  const heatmapOverlayEnabled = useAppStore((s) => s.heatmapOverlayEnabled);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const language = useAppStore((s) => s.language);
  const t = getT(language);

  const selectItem = useAppStore((s) => s.selectItem);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const updateLayoutObject = useAppStore((s) => s.updateLayoutObject);
  const updateWorker = useAppStore((s) => s.updateWorker);
  const assignWorkerToConveyorSegment = useAppStore((s) => s.assignWorkerToConveyorSegment);
  const updateZone = useAppStore((s) => s.updateZone);
  const saveCurrentProject = useAppStore((s) => s.saveCurrentProject);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const register2DSvgGetter = useAppStore((s) => s.register2DSvgGetter);

  // pxPerMeter & pan offset
  const [pxPerM, setPxPerM] = useState(28);
  const [pan, setPan] = useState({ x: 48, y: 48 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragHoverConv, setDragHoverConv] = useState<{ id: string; segIdx: number } | null>(null);
  const [measurePts, setMeasurePts] = useState<{ a: { x: number; z: number } | null; b: { x: number; z: number } | null }>({
    a: null,
    b: null,
  });
  const [cursorMeters, setCursorMeters] = useState<{ x: number; z: number } | null>(null);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; scale: number; midX: number; midY: number; panX: number; panY: number } | null>(null);

  const fitView = () => {
    const el = containerRef.current;
    if (!el) return;
    const pad = el.clientWidth < 640 ? 28 : 80;
    const cw = Math.max(80, el.clientWidth - pad);
    const ch = Math.max(80, el.clientHeight - pad);
    const scale = Math.max(8, Math.min(80, Math.min(cw / project.factory.lengthM, ch / project.factory.widthM)));
    setPxPerM(scale);
    setPan({
      x: (el.clientWidth - project.factory.lengthM * scale) / 2,
      y: (el.clientHeight - project.factory.widthM * scale) / 2,
    });
  };

  useEffect(() => {
    fitView();
    register2DSvgGetter(() => svgRef.current);
    return () => register2DSvgGetter(null);
  }, [project.id]);

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, z: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - pan.x) / pxPerM,
      z: (sy - pan.y) / pxPerM,
    };
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = Math.max(6, Math.min(120, pxPerM * factor));
    const ratio = nextScale / pxPerM;
    setPan({
      x: mx - (mx - pan.x) * ratio,
      y: my - (my - pan.y) * ratio,
    });
    setPxPerM(nextScale);
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        pinchStartRef.current = { dist: Math.max(10, dist), scale: pxPerM, midX, midY, panX: pan.x, panY: pan.y };
        setDrag(null);
      }
      return;
    }

    const world = clientToWorld(e.clientX, e.clientY);

    if (measureMode) {
      if (!measurePts.a || (measurePts.a && measurePts.b)) {
        setMeasurePts({ a: world, b: null });
      } else {
        setMeasurePts({ a: measurePts.a, b: world });
      }
      return;
    }

    if (e.button === 1 || e.button === 2 || e.target === svgRef.current || (e.target as Element).getAttribute('data-bg') === 'true') {
      if (e.button === 0 && !e.shiftKey) {
        clearSelection();
      }
      setDrag({
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        const factor = dist / pinchStartRef.current.dist;
        const nextScale = Math.max(6, Math.min(120, pinchStartRef.current.scale * factor));
        const ratio = nextScale / pinchStartRef.current.scale;
        setPan({
          x: midX - (pinchStartRef.current.midX - pinchStartRef.current.panX) * ratio,
          y: midY - (pinchStartRef.current.midY - pinchStartRef.current.panY) * ratio,
        });
        setPxPerM(nextScale);
      }
      return;
    }

    const world = clientToWorld(e.clientX, e.clientY);
    setCursorMeters(world);

    if (!drag) return;
    const { gridSizeM, snapToGrid, lengthM, widthM } = project.factory;

    if (drag.mode === 'pan') {
      setPan({
        x: drag.origPanX + (e.clientX - drag.startClientX),
        y: drag.origPanY + (e.clientY - drag.startClientY),
      });
    } else if (drag.mode === 'move_obj') {
      const dx = world.x - drag.startWorldX;
      const dz = world.z - drag.startWorldZ;
      const obj = project.layoutObjects.find((o) => o.id === drag.id);
      if (!obj || obj.rendering.locked) return;
      const nx = snapValue(Math.max(0, Math.min(lengthM, drag.origX + dx)), gridSizeM, snapToGrid);
      const nz = snapValue(Math.max(0, Math.min(widthM, drag.origZ + dz)), gridSizeM, snapToGrid);
      updateLayoutObject(
        drag.id,
        { geometry: { ...obj.geometry, position: { ...obj.geometry.position, x: nx, z: nz } } },
        true
      );
    } else if (drag.mode === 'move_worker') {
      const dx = world.x - drag.startWorldX;
      const dz = world.z - drag.startWorldZ;
      const nx = snapValue(Math.max(0.2, Math.min(lengthM - 0.2, drag.origX + dx)), gridSizeM, snapToGrid);
      const nz = snapValue(Math.max(0.2, Math.min(widthM - 0.2, drag.origZ + dz)), gridSizeM, snapToGrid);
      updateWorker(drag.id, { position: { x: nx, y: 0, z: nz } }, true);
      const nearConv = findConveyorSegmentAtPoint(project.layoutObjects, nx, nz, 0.9);
      setDragHoverConv(nearConv ? { id: nearConv.conveyor.id, segIdx: nearConv.segmentIndex } : null);
    } else if (drag.mode === 'move_zone') {
      const dx = world.x - drag.startWorldX;
      const dz = world.z - drag.startWorldZ;
      const z = project.factory.zones.find((item) => item.id === drag.id);
      if (!z || z.locked) return;
      const nx = snapValue(Math.max(0, Math.min(lengthM, drag.origX + dx)), gridSizeM, snapToGrid);
      const nz = snapValue(Math.max(0, Math.min(widthM, drag.origZ + dz)), gridSizeM, snapToGrid);
      updateZone(drag.id, { position: { x: nx, y: 0, z: nz } });
    } else if (drag.mode === 'rotate_obj') {
      const obj = project.layoutObjects.find((o) => o.id === drag.id);
      if (!obj || obj.rendering.locked) return;
      const angleRad = Math.atan2(world.z - drag.cz, world.x - drag.cx);
      let deg = Math.round(((angleRad * 180) / Math.PI + 90) / 5) * 5;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      updateLayoutObject(drag.id, { geometry: { ...obj.geometry, rotationDeg: deg } }, true);
    } else if (drag.mode === 'rotate_worker') {
      const angleRad = Math.atan2(world.z - drag.cz, world.x - drag.cx);
      const step = e.shiftKey ? 1 : 5;
      const rawDeg = (angleRad * 180) / Math.PI;
      const deg = normalizeRotationDeg(Math.round(rawDeg / step) * step);
      updateWorker(drag.id, { rotation: deg, rotationDeg: deg }, true);
    } else if (drag.mode === 'resize_obj') {
      const obj = project.layoutObjects.find((o) => o.id === drag.id);
      if (!obj || obj.rendering.locked) return;
      const rad = (-drag.rotDeg * Math.PI) / 180;
      const dx = world.x - drag.cx;
      const dz = world.z - drag.cz;
      const localX = Math.abs(dx * Math.cos(rad) - dz * Math.sin(rad));
      const localZ = Math.abs(dx * Math.sin(rad) + dz * Math.cos(rad));
      const nextL = Math.max(0.4, snapValue(localX * 2, 0.1, true));
      const nextW = Math.max(0.3, snapValue(localZ * 2, 0.1, true));
      updateLayoutObject(
        drag.id,
        { geometry: { ...obj.geometry, dimensions: { ...obj.geometry.dimensions, length: nextL, width: nextW } } },
        true
      );
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (e) {
      pointersRef.current.delete(e.pointerId);
    } else {
      pointersRef.current.clear();
    }
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    setDragHoverConv(null);
    if (drag && drag.mode !== 'pan') {
      saveCurrentProject();
    }
    setDrag(null);
  };

  const { factory } = project;
  const fL = factory.lengthM;
  const fW = factory.widthM;
  const unit = factory.unit;

  const activeHeatWindowSec = heatmapOverlayEnabled
    ? resolveHeatmapActiveTimeSec(project.simulationConfig, project.products[0], simSnapshot.clockSec)
    : 0;
  const bottleneckStageId = simSnapshot.result?.kpis.bottleneckStageId;

  const renderObjectGlyph = (obj: LayoutObject) => {
    const { length: L, width: W } = obj.geometry.dimensions;
    const isSelected = selection.kind === 'object' && selection.ids.includes(obj.id);
    const rt = simSnapshot.objects[obj.id];
    const simActive = simSnapshot.clockSec > 0;
    const statusColor = rt && simActive ? STATUS_RING[rt.status] : undefined;
    const isBottleneck = bottleneckStageId === obj.stageId && simActive;
    const heat =
      heatmapOverlayEnabled && obj.kind !== 'storage' && obj.kind !== 'vehicle'
        ? computeObjectHeatmapMetrics({
            obj,
            runtime: rt,
            clockSec: simSnapshot.clockSec,
            activeSimTimeSec: activeHeatWindowSec,
            simulationConfig: project.simulationConfig,
            isStageBottleneck: isBottleneck,
          })
        : null;

    return (
      <g
        key={obj.id}
        transform={`translate(${obj.geometry.position.x}, ${obj.geometry.position.z}) rotate(${obj.geometry.rotationDeg})`}
        onPointerDown={(e) => {
          if (measureMode) return;
          e.stopPropagation();
          selectItem('object', obj.id, e.shiftKey);
          if (!obj.rendering.locked && e.button === 0) {
            const world = clientToWorld(e.clientX, e.clientY);
            setDrag({
              mode: 'move_obj',
              id: obj.id,
              startWorldX: world.x,
              startWorldZ: world.z,
              origX: obj.geometry.position.x,
              origZ: obj.geometry.position.z,
            });
          }
        }}
        className="cursor-move"
      >
        {/* Maintenance clearance dashed envelope */}
        {layersVisible.dimensions && obj.geometry.clearanceM > 0 && (
          <rect
            x={-L / 2 - obj.geometry.clearanceM}
            y={-W / 2 - obj.geometry.clearanceM}
            width={L + obj.geometry.clearanceM * 2}
            height={W + obj.geometry.clearanceM * 2}
            fill="none"
            stroke="#94A3B8"
            strokeWidth={1 / pxPerM}
            strokeDasharray={`${3 / pxPerM} ${3 / pxPerM}`}
            opacity={0.45}
          />
        )}

        {/* Heatmap outer thermal glow aura */}
        {heat && (
          <rect
            x={-L / 2 - 0.16}
            y={-W / 2 - 0.16}
            width={L + 0.32}
            height={W + 0.32}
            rx={0.12}
            fill={heat.colorHex}
            fillOpacity={heat.tier === 'idle' ? 0.1 : 0.22}
            stroke={heat.borderHex}
            strokeWidth={1.6 / pxPerM}
          />
        )}

        {/* Bottleneck warning halo */}
        {isBottleneck && (
          <rect
            x={-L / 2 - 0.22}
            y={-W / 2 - 0.22}
            width={L + 0.44}
            height={W + 0.44}
            rx={0.12}
            fill="none"
            stroke="#DC2626"
            strokeWidth={3 / pxPerM}
          />
        )}

        {/* Main body */}
        <rect
          x={-L / 2}
          y={-W / 2}
          width={L}
          height={W}
          rx={0.06}
          fill={heat ? heat.colorHex : obj.rendering.color || '#334155'}
          fillOpacity={heat ? (heat.tier === 'idle' ? 0.42 : 0.72) : 0.88}
          stroke={isSelected ? '#DC2626' : heat ? heat.borderHex : statusColor || '#0F172A'}
          strokeWidth={(isSelected || statusColor || heat ? 2.5 : 1.2) / pxPerM}
        />

        {/* Downtime Hotspot Hazard Stripes when heatmap active */}
        {heat && heat.tier === 'downtime' && (
          <rect
            x={-L / 2}
            y={-W / 2}
            width={L}
            height={W}
            rx={0.06}
            fill="url(#heatmap-downtime-hatch)"
            opacity={0.55}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Category-specific engineering details */}
        {obj.kind === 'conveyor' && (() => {
          const dir = obj.operations.direction === -1 ? -1 : 1;
          const arrowCount = Math.max(1, Math.min(8, Math.floor(L / 1.8)));
          const segCount = getConveyorSegmentCount(obj);
          const showSegments =
            activeModule === 'workforce' ||
            dragHoverConv?.id === obj.id ||
            isSelected ||
            project.workers.some((w) => (w.assignedTo || w.assignedStationId) === obj.id);
          return (
            <>
              <line
                x1={-L / 2 + 0.15}
                y1={0}
                x2={L / 2 - 0.15}
                y2={0}
                stroke="#E2E8F0"
                strokeWidth={1.2 / pxPerM}
                strokeDasharray={`${0.35} ${0.25}`}
              />
              {showSegments &&
                Array.from({ length: segCount }).map((_, segIdx) => {
                  const segWidth = L / segCount;
                  const segStart = (-L / 2 + segIdx * segWidth) * dir;
                  const xLeft = dir === 1 ? segStart : segStart - segWidth;
                  const isHoveredSeg =
                    dragHoverConv?.id === obj.id && dragHoverConv.segIdx === segIdx;
                  const hasAssignedWorker = project.workers.some(
                    (w) =>
                      (w.assignedTo || w.assignedStationId) === obj.id &&
                      (w.assignedConveyorSegment?.segmentIndex ?? 0) === segIdx
                  );
                  return (
                    <g key={`seg_${segIdx}`} style={{ pointerEvents: 'none' }}>
                      {(isHoveredSeg || hasAssignedWorker) && (
                        <rect
                          x={xLeft + 0.04}
                          y={-W / 2 + 0.04}
                          width={Math.max(0.1, segWidth - 0.08)}
                          height={Math.max(0.1, W - 0.08)}
                          fill={isHoveredSeg ? '#38BDF8' : '#2563EB'}
                          fillOpacity={isHoveredSeg ? 0.35 : 0.22}
                          stroke={isHoveredSeg ? '#0284C7' : '#60A5FA'}
                          strokeWidth={(isHoveredSeg ? 1.8 : 1.1) / pxPerM}
                        />
                      )}
                      {segIdx > 0 && (
                        <line
                          x1={segStart}
                          y1={-W / 2}
                          x2={segStart}
                          y2={W / 2}
                          stroke="#94A3B8"
                          strokeWidth={1 / pxPerM}
                          strokeDasharray={`${0.12} ${0.1}`}
                        />
                      )}
                      <text
                        x={xLeft + segWidth / 2}
                        y={-W / 2 + 0.16}
                        textAnchor="middle"
                        fontSize={0.18}
                        fill={isHoveredSeg ? '#E0F2FE' : '#CBD5E1'}
                        fontWeight={700}
                      >
                        S{segIdx + 1}
                      </text>
                    </g>
                  );
                })}
              {(obj.category === 'roller_conveyor' || obj.category === 'pallet_conveyor') &&
                Array.from({ length: Math.min(40, Math.max(3, Math.floor(L / (obj.category === 'pallet_conveyor' ? 0.42 : 0.35)))) }).map((_, idx, arr) => {
                  const rx = -L / 2 + ((idx + 0.5) / arr.length) * L;
                  return (
                    <line
                      key={idx}
                      x1={rx}
                      y1={-W / 2 + 0.06}
                      x2={rx}
                      y2={W / 2 - 0.06}
                      stroke={obj.category === 'pallet_conveyor' ? '#F59E0B' : '#CBD5E1'}
                      strokeWidth={(obj.category === 'pallet_conveyor' ? 1.4 : 0.8) / pxPerM}
                    />
                  );
                })}
              {/* Repeating directional flow chevrons along conveyor belt */}
              {Array.from({ length: arrowCount }).map((_, idx) => {
                const cx =
                  arrowCount === 1
                    ? 0
                    : -L / 2 + 0.55 + (idx / (arrowCount - 1)) * Math.max(0.2, L - 1.1);
                return (
                  <polygon
                    key={`conv_arr_${idx}`}
                    points={`${cx - 0.18 * dir},${-W * 0.24} ${cx + 0.16 * dir},0 ${cx - 0.18 * dir},${W * 0.24} ${cx - 0.06 * dir},0`}
                    fill="#EF4444"
                    fillOpacity={0.92}
                  />
                );
              })}
              {/* Entry & Exit endpoint flow indicators */}
              <circle
                cx={(-L / 2 + 0.12) * dir}
                cy={0}
                r={0.09}
                fill="#16A34A"
                stroke="#FFFFFF"
                strokeWidth={0.8 / pxPerM}
              />
              <polygon
                points={`${(L / 2 - 0.36) * dir},${-W * 0.28} ${(L / 2 - 0.08) * dir},0 ${(L / 2 - 0.36) * dir},${W * 0.28}`}
                fill="#DC2626"
                stroke="#FFFFFF"
                strokeWidth={0.7 / pxPerM}
              />
            </>
          );
        })()}

        {/* Wooden & Plastic Pallets 2D Slatted / Waffle Grid Glyphs */}
        {(obj.category.startsWith('pallet_wood') || obj.category.startsWith('pallet_plastic')) && (
          <>
            {[-0.36, -0.18, 0, 0.18, 0.36].map((frac, idx) => (
              <line
                key={`slat_${idx}`}
                x1={-L / 2 + 0.05}
                y1={frac * W}
                x2={L / 2 - 0.05}
                y2={frac * W}
                stroke={obj.category.startsWith('pallet_plastic') ? '#93C5FD' : '#FDE68A'}
                strokeWidth={1.2 / pxPerM}
                opacity={0.75}
              />
            ))}
            {obj.category.startsWith('pallet_plastic') &&
              [-0.3, 0, 0.3].map((frac, idx) => (
                <line
                  key={`rib_${idx}`}
                  x1={frac * L}
                  y1={-W / 2 + 0.05}
                  x2={frac * L}
                  y2={W / 2 - 0.05}
                  stroke="#93C5FD"
                  strokeWidth={1 / pxPerM}
                  opacity={0.6}
                />
              ))}
          </>
        )}

        {/* Stretch Wrapper Turntable / Rotary Arm CAD Footprint */}
        {(obj.category === 'stretch_wrapper_turntable' || obj.category === 'stretch_wrapper_arm') && (
          <>
            <circle
              cx={obj.category === 'stretch_wrapper_turntable' ? -L * 0.12 : 0}
              cy={0}
              r={Math.min(L * 0.34, W * 0.42)}
              fill="none"
              stroke="#38BDF8"
              strokeWidth={1.5 / pxPerM}
              strokeDasharray={`${0.18} ${0.12}`}
            />
            {obj.category === 'stretch_wrapper_turntable' && (
              <rect
                x={L * 0.22}
                y={-0.18}
                width={0.28}
                height={0.36}
                fill="#EF4444"
                stroke="#FFFFFF"
                strokeWidth={0.8 / pxPerM}
              />
            )}
          </>
        )}

        {/* Robotic Palletizer Reach Envelope */}
        {obj.category === 'palletizer_robot' && (
          <>
            <circle
              cx={-L * 0.15}
              cy={0}
              r={Math.min(L, W) * 0.44}
              fill="none"
              stroke="#F59E0B"
              strokeWidth={1.4 / pxPerM}
              strokeDasharray={`${0.2} ${0.15}`}
            />
            <line
              x1={-L * 0.15}
              y1={0}
              x2={L * 0.28}
              y2={0}
              stroke="#F97316"
              strokeWidth={2.2 / pxPerM}
            />
          </>
        )}

        {obj.kind === 'storage' && (
          <>
            <line x1={-L / 2} y1={-W / 2} x2={L / 2} y2={W / 2} stroke="#CBD5E1" strokeWidth={0.9 / pxPerM} />
            <line x1={-L / 2} y1={W / 2} x2={L / 2} y2={-W / 2} stroke="#CBD5E1" strokeWidth={0.9 / pxPerM} />
          </>
        )}

        {obj.kind === 'vehicle' && (
          <>
            <rect x={L * 0.22} y={-W * 0.3} width={L * 0.28} height={W * 0.16} fill="#94A3B8" />
            <rect x={L * 0.22} y={W * 0.14} width={L * 0.28} height={W * 0.16} fill="#94A3B8" />
          </>
        )}

        {/* Label */}
        <text
          x={0}
          y={heat ? -0.14 : 0.05}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.max(0.24, Math.min(0.42, W * 0.38))}
          fill="#F8FAFC"
          fontWeight={600}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {obj.name.length > 22 ? `${obj.name.slice(0, 20)}…` : obj.name}
        </text>

        {/* Heatmap U% / D% compact pill readout */}
        {heat && (
          <g transform={`translate(0, ${Math.min(W * 0.28, 0.26)})`} style={{ pointerEvents: 'none' }}>
            <rect
              x={-Math.max(0.55, Math.min(L * 0.44, 0.95))}
              y={-0.16}
              width={Math.max(1.1, Math.min(L * 0.88, 1.9))}
              height={0.32}
              rx={0.08}
              fill="#0F172A"
              fillOpacity={0.86}
              stroke={heat.colorHex}
              strokeWidth={1 / pxPerM}
            />
            <text
              x={0}
              y={0.02}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.max(0.18, Math.min(0.24, W * 0.24))}
              fill="#F8FAFC"
              fontWeight={700}
              style={{ userSelect: 'none' }}
            >
              {heat.badgeText}
            </text>
          </g>
        )}

        {/* Live status badge if simulating */}
        {statusColor && (
          <circle
            cx={L / 2 - 0.16}
            cy={-W / 2 + 0.16}
            r={0.11}
            fill={statusColor}
            stroke="#FFFFFF"
            strokeWidth={1.2 / pxPerM}
          />
        )}

        {/* Rotation & Resize Handles when Selected */}
        {isSelected && !obj.rendering.locked && (
          <>
            <line x1={0} y1={-W / 2} x2={0} y2={-W / 2 - 0.55} stroke="#DC2626" strokeWidth={1.5 / pxPerM} />
            <circle
              cx={0}
              cy={-W / 2 - 0.6}
              r={0.16}
              fill="#DC2626"
              stroke="#FFFFFF"
              strokeWidth={1.5 / pxPerM}
              className="cursor-grab"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({
                  mode: 'rotate_obj',
                  id: obj.id,
                  cx: obj.geometry.position.x,
                  cz: obj.geometry.position.z,
                });
              }}
            />
            <rect
              x={L / 2 - 0.14}
              y={W / 2 - 0.14}
              width={0.28}
              height={0.28}
              fill="#DC2626"
              stroke="#FFFFFF"
              strokeWidth={1.5 / pxPerM}
              className="cursor-nwse-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({
                  mode: 'resize_obj',
                  id: obj.id,
                  origL: L,
                  origW: W,
                  cx: obj.geometry.position.x,
                  cz: obj.geometry.position.z,
                  rotDeg: obj.geometry.rotationDeg,
                });
              }}
            />
          </>
        )}
      </g>
    );
  };

  // Ruler ticks every 2m (or 5m when zoomed out)
  const tickStep = pxPerM < 14 ? 5 : 2;
  const xTicks = [];
  for (let x = 0; x <= fL; x += tickStep) xTicks.push(x);
  const zTicks = [];
  for (let z = 0; z <= fW; z += tickStep) zTicks.push(z);

  const measureDist =
    measurePts.a && measurePts.b
      ? Math.hypot(measurePts.b.x - measurePts.a.x, measurePts.b.z - measurePts.a.z)
      : null;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 select-none">
      {/* Compact 2D HUD toolbar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/95 px-2 py-1 shadow-sm max-w-[calc(100%-1.5rem)]">
        <span className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 px-1 hidden sm:inline">
          {t.labels.viewport2d}
        </span>
        <button
          onClick={() => setPxPerM((s) => Math.min(120, s * 1.18))}
          title="+"
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setPxPerM((s) => Math.max(6, s * 0.85))}
          title="-"
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={fitView}
          title={t.actions.fitView}
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => {
            setMeasureMode(!measureMode);
            setMeasurePts({ a: null, b: null });
          }}
          title={t.actions.measure}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            measureMode
              ? 'bg-red-600 text-white'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
          }`}
        >
          <Ruler className="w-3.5 h-3.5" />
          <span>{t.actions.measure}</span>
        </button>
      </div>

      {/* Live coordinate readout */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded bg-white/90 dark:bg-neutral-900/90 border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[11px] font-mono-tabular text-neutral-700 dark:text-neutral-300">
        <span>
          {t.labels.scale}: {pxPerM.toFixed(0)} px/m · {t.labels.unit}: {unit}
        </span>
        {cursorMeters && (
          <span>
            X: {fromMeters(cursorMeters.x, unit).toFixed(unit === 'm' ? 2 : 0)} {unit} · Z:{' '}
            {fromMeters(cursorMeters.z, unit).toFixed(unit === 'm' ? 2 : 0)} {unit}
          </span>
        )}
        {measureDist !== null && (
          <span className="text-red-600 dark:text-red-400 font-semibold">
            {t.labels.measured}: {fromMeters(measureDist, unit).toFixed(2)} {unit}
          </span>
        )}
      </div>

      {/* 2D Heatmap Legend HUD when enabled */}
      {heatmapOverlayEnabled && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-2 rounded bg-white/95 dark:bg-neutral-900/95 border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[10px] shadow-sm max-w-[60%]">
          <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
            <Flame className="w-3 h-3" />
            {t.simInspector.heatmapOn}
          </span>
          {HEATMAP_LEGEND_STOPS.map((stop) => (
            <span key={stop.tier} className="inline-flex items-center gap-1 text-neutral-700 dark:text-neutral-200">
              <span
                className="h-2 w-2 rounded-sm border border-black/15"
                style={{ backgroundColor: stop.colorHex }}
              />
              {t.simInspector.heatmapLegend[stop.tier]}
            </span>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        data-linesim-2d="true"
        className="w-full h-full cursor-crosshair touch-none"
        style={{ touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={(e) => {
          if (
            !e.dataTransfer.types.includes('application/x-linesim-worker') &&
            !e.dataTransfer.types.includes('text/plain')
          ) {
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const world = clientToWorld(e.clientX, e.clientY);
          const hit = findConveyorSegmentAtPoint(project.layoutObjects, world.x, world.z, 1.35);
          setDragHoverConv(hit ? { id: hit.conveyor.id, segIdx: hit.segmentIndex } : null);
        }}
        onDragLeave={() => setDragHoverConv(null)}
        onDrop={(e) => {
          const workerId =
            e.dataTransfer.getData('application/x-linesim-worker') ||
            e.dataTransfer.getData('text/plain');
          setDragHoverConv(null);
          if (!workerId || !project.workers.some((w) => w.id === workerId)) return;
          e.preventDefault();
          const world = clientToWorld(e.clientX, e.clientY);
          const hit = findConveyorSegmentAtPoint(project.layoutObjects, world.x, world.z, 1.35);
          if (hit) {
            assignWorkerToConveyorSegment(
              workerId,
              hit.conveyor.id,
              hit.segmentIndex,
              hit.segmentCount,
              hit.side
            );
          } else {
            const clampedX = Math.max(0.25, Math.min(fL - 0.25, world.x));
            const clampedZ = Math.max(0.25, Math.min(fW - 0.25, world.z));
            updateWorker(workerId, { position: { x: clampedX, y: 0, z: clampedZ } });
            selectItem('worker', workerId);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="heatmap-downtime-hatch"
            width="0.28"
            height="0.28"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="0.12" height="0.28" fill="#DC2626" />
          </pattern>
          <marker
            id="flow-arrow-red"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#DC2626" />
          </marker>
          <marker
            id="flow-arrow-emerald"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#16A34A" />
          </marker>
        </defs>
        <rect data-bg="true" x="0" y="0" width="100%" height="100%" fill="transparent" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${pxPerM})`}>
          {/* Factory floor slab */}
          <rect
            data-bg="true"
            x={0}
            y={0}
            width={fL}
            height={fW}
            fill="#FFFFFF"
            className="dark:fill-neutral-950"
            stroke="#0F172A"
            strokeWidth={3 / pxPerM}
          />

          {/* Grid lines */}
          {layersVisible.grid !== false && (
            <>
              {Array.from({ length: Math.floor(fL / Math.max(0.1, factory.gridSizeM)) + 1 }).map((_, idx) => {
                const gx = idx * factory.gridSizeM;
                const major = Math.abs(gx % 5) < 0.001;
                return (
                  <line
                    key={`gx_${idx}`}
                    x1={gx}
                    y1={0}
                    x2={gx}
                    y2={fW}
                    stroke={major ? '#CBD5E1' : '#E2E8F0'}
                    strokeWidth={(major ? 1 : 0.5) / pxPerM}
                    opacity={0.75}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}
              {Array.from({ length: Math.floor(fW / Math.max(0.1, factory.gridSizeM)) + 1 }).map((_, idx) => {
                const gz = idx * factory.gridSizeM;
                const major = Math.abs(gz % 5) < 0.001;
                return (
                  <line
                    key={`gz_${idx}`}
                    x1={0}
                    y1={gz}
                    x2={fL}
                    y2={gz}
                    stroke={major ? '#CBD5E1' : '#E2E8F0'}
                    strokeWidth={(major ? 1 : 0.5) / pxPerM}
                    opacity={0.75}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}
            </>
          )}

          {/* Factory Zones */}
          {layersVisible.zones &&
            factory.zones
              .filter((z) => z.visible)
              .map((z) => {
                const isSel = selection.kind === 'zone' && selection.ids.includes(z.id);
                return (
                  <g
                    key={z.id}
                    transform={`translate(${z.position.x}, ${z.position.z}) rotate(${z.rotationDeg})`}
                    onPointerDown={(e) => {
                      if (measureMode) return;
                      e.stopPropagation();
                      selectItem('zone', z.id);
                      if (!z.locked) {
                        const world = clientToWorld(e.clientX, e.clientY);
                        setDrag({
                          mode: 'move_zone',
                          id: z.id,
                          startWorldX: world.x,
                          startWorldZ: world.z,
                          origX: z.position.x,
                          origZ: z.position.z,
                        });
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <rect
                      x={-z.dimensions.length / 2}
                      y={-z.dimensions.width / 2}
                      width={z.dimensions.length}
                      height={z.dimensions.width}
                      fill={z.color}
                      fillOpacity={0.14}
                      stroke={isSel ? '#DC2626' : z.color}
                      strokeWidth={(isSel ? 2 : 1.2) / pxPerM}
                      strokeDasharray={`${4 / pxPerM} ${3 / pxPerM}`}
                    />
                    <text
                      x={0}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={0.36}
                      fill={z.color}
                      fontWeight={600}
                      style={{ pointerEvents: 'none' }}
                    >
                      {z.name}
                    </text>
                  </g>
                );
              })}

          {/* Wall Openings (Doors / Windows / Loading Bays) */}
          {factory.openings.map((op) => {
            let rx = 0;
            let ry = 0;
            let rw = op.widthM;
            let rh = 0.25;
            if (op.wall === 'north') { rx = op.offsetM; ry = -0.12; }
            else if (op.wall === 'south') { rx = op.offsetM; ry = fW - 0.12; }
            else if (op.wall === 'west') { rx = -0.12; ry = op.offsetM; rw = 0.25; rh = op.widthM; }
            else if (op.wall === 'east') { rx = fL - 0.12; ry = op.offsetM; rw = 0.25; rh = op.widthM; }
            return (
              <rect
                key={op.id}
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                fill={op.type === 'window' ? '#38BDF8' : '#D97706'}
                stroke="#0F172A"
                strokeWidth={0.8 / pxPerM}
              />
            );
          })}

          {/* Structural Columns */}
          {layersVisible.columns &&
            factory.columns.map((col) => (
              <rect
                key={col.id}
                x={col.x - col.width / 2}
                y={col.z - col.depth / 2}
                width={col.width}
                height={col.depth}
                fill="#475569"
                stroke="#0F172A"
                strokeWidth={1 / pxPerM}
              />
            ))}

          {/* Visual Product Flow Direction & Route Arrows */}
          {layersVisible.flowArrows !== false && (() => {
            const activeProd = project.products[0];
            const isManualFlow = activeProd?.routingMode === 'manual';
            const routeIds = activeProd?.routeStageIds || [];
            const routeCoords: Array<{ x: number; z: number; id: string }> = [];
            for (const sid of routeIds) {
              const st = project.stages.find((s) => s.id === sid);
              const obj = st ? project.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]) : undefined;
              if (obj && obj.rendering.visible) {
                routeCoords.push({ x: obj.geometry.position.x, z: obj.geometry.position.z, id: obj.id });
              }
            }

            const renderFlowArrow = (
              key: string,
              x1: number,
              z1: number,
              x2: number,
              z2: number,
              color = '#DC2626',
              marker = 'url(#flow-arrow-red)'
            ) => {
              const dx = x2 - x1;
              const dz = z2 - z1;
              const dist = Math.hypot(dx, dz);
              if (dist < 0.25) return null;
              const ux = dx / dist;
              const uz = dz / dist;
              const mx = (x1 + x2) / 2;
              const mz = (z1 + z2) / 2;
              const ang = (Math.atan2(dz, dx) * 180) / Math.PI;
              return (
                <g key={key} style={{ pointerEvents: 'none' }}>
                  <line
                    x1={x1 + ux * 0.35}
                    y1={z1 + uz * 0.35}
                    x2={x2 - ux * 0.4}
                    y2={z2 - uz * 0.4}
                    stroke={color}
                    strokeWidth={2 / pxPerM}
                    strokeDasharray={`${0.28} ${0.18}`}
                    opacity={0.78}
                    markerEnd={marker}
                  />
                  <polygon
                    transform={`translate(${mx}, ${mz}) rotate(${ang})`}
                    points="-0.16,-0.13 0.22,0 -0.16,0.13 -0.05,0"
                    fill={color}
                    opacity={0.95}
                  />
                </g>
              );
            };

            return (
              <g style={{ pointerEvents: 'none' }}>
                {project.layoutObjects.map((obj) =>
                  obj.connectedToIds.map((targetId) => {
                    const target = project.layoutObjects.find((o) => o.id === targetId);
                    if (!target) return null;
                    return renderFlowArrow(
                      `conn_${obj.id}->${targetId}`,
                      obj.geometry.position.x,
                      obj.geometry.position.z,
                      target.geometry.position.x,
                      target.geometry.position.z,
                      obj.kind === 'conveyor' ? '#16A34A' : '#DC2626',
                      obj.kind === 'conveyor' ? 'url(#flow-arrow-emerald)' : 'url(#flow-arrow-red)'
                    );
                  })
                )}
                {!isManualFlow &&
                  routeCoords.length >= 2 &&
                  routeCoords.slice(0, -1).map((pt, idx) => {
                    const nextPt = routeCoords[idx + 1];
                    const srcObj = project.layoutObjects.find((o) => o.id === pt.id);
                    if (srcObj?.connectedToIds.includes(nextPt.id)) return null;
                    return renderFlowArrow(
                      `route_${pt.id}->${nextPt.id}`,
                      pt.x,
                      pt.z,
                      nextPt.x,
                      nextPt.z,
                      '#DC2626',
                      'url(#flow-arrow-red)'
                    );
                  })}
              </g>
            );
          })()}

          {/* Layout Objects (Conveyors, Machines, Workstations, Buffers, Racks, Vehicles) */}
          {project.layoutObjects
            .filter((o) => o.rendering.visible && layersVisible[o.rendering.layer])
            .sort((a, b) => (a.kind === 'conveyor' ? -1 : b.kind === 'conveyor' ? 1 : 0))
            .map(renderObjectGlyph)}

          {/* Worker -> Assigned Conveyor Segment Tethers */}
          {layersVisible.workers &&
            project.workers.map((w) => {
              const targetId = w.assignedTo || w.assignedStationId;
              if (!targetId) return null;
              const conv = project.layoutObjects.find((o) => o.id === targetId && o.kind === 'conveyor');
              if (!conv) return null;
              const isSel = selection.kind === 'worker' && selection.ids.includes(w.id);
              if (!isSel && activeModule !== 'workforce') return null;
              const segIdx = w.assignedConveyorSegment?.segmentIndex ?? 0;
              const segCount = w.assignedConveyorSegment?.segmentCount ?? getConveyorSegmentCount(conv);
              const placement = computeConveyorSegmentPlacement(conv, segIdx, segCount);
              return (
                <g key={`tether_${w.id}`} style={{ pointerEvents: 'none' }}>
                  <line
                    x1={w.position.x}
                    y1={w.position.z}
                    x2={placement.beltPoint.x}
                    y2={placement.beltPoint.z}
                    stroke="#2563EB"
                    strokeWidth={1.6 / pxPerM}
                    strokeDasharray={`${0.14} ${0.1}`}
                  />
                  <circle
                    cx={placement.beltPoint.x}
                    cy={placement.beltPoint.z}
                    r={0.11}
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth={0.9 / pxPerM}
                  />
                </g>
              );
            })}

          {/* Workers (clickable & rotatable directly in 2D) */}
          {layersVisible.workers &&
            project.workers.map((w) => {
              const rt = simSnapshot.workers[w.id];
              const wx = rt && simSnapshot.clockSec > 0 ? rt.position.x : w.position.x;
              const wz = rt && simSnapshot.clockSec > 0 ? rt.position.z : w.position.z;
              const wRot = w.rotation ?? w.rotationDeg ?? 0;
              const isSel = selection.kind === 'worker' && selection.ids.includes(w.id);
              const statusFill =
                rt && simSnapshot.clockSec > 0
                  ? rt.status === 'busy'
                    ? '#16A34A'
                    : rt.status === 'walking'
                    ? '#2563EB'
                    : rt.status === 'break'
                    ? '#64748B'
                    : '#1D4ED8'
                  : w.color || '#1D4ED8';

              return (
                <g
                  key={w.id}
                  transform={`translate(${wx}, ${wz})`}
                  onPointerDown={(e) => {
                    if (measureMode) return;
                    e.stopPropagation();
                    selectItem('worker', w.id);
                    const world = clientToWorld(e.clientX, e.clientY);
                    setDrag({
                      mode: 'move_worker',
                      id: w.id,
                      startWorldX: world.x,
                      startWorldZ: world.z,
                      origX: w.position.x,
                      origZ: w.position.z,
                    });
                  }}
                  className="cursor-pointer"
                >
                  {/* Generous transparent hit target so workers are always easy to click in 2D */}
                  <circle r={0.46} fill="transparent" />

                  {isSel && (
                    <circle
                      r={0.44}
                      fill="none"
                      stroke="#DC2626"
                      strokeWidth={1.6 / pxPerM}
                      strokeDasharray={`${0.12} ${0.08}`}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  <g transform={`rotate(${wRot})`}>
                    <circle
                      r={0.32}
                      fill={statusFill}
                      stroke={isSel ? '#DC2626' : '#FFFFFF'}
                      strokeWidth={(isSel ? 2.5 : 1.5) / pxPerM}
                    />
                    <polygon
                      points="0.28,-0.12 0.45,0 0.28,0.12"
                      fill="#FACC15"
                      stroke="#0F172A"
                      strokeWidth={0.8 / pxPerM}
                    />
                    {isSel && (
                      <>
                        <line
                          x1={0.32}
                          y1={0}
                          x2={0.74}
                          y2={0}
                          stroke="#DC2626"
                          strokeWidth={1.6 / pxPerM}
                        />
                        <circle
                          cx={0.82}
                          cy={0}
                          r={0.14}
                          fill="#DC2626"
                          stroke="#FFFFFF"
                          strokeWidth={1.4 / pxPerM}
                          className="cursor-grab"
                          onPointerDown={(e) => {
                            if (measureMode) return;
                            e.stopPropagation();
                            selectItem('worker', w.id);
                            setDrag({
                              mode: 'rotate_worker',
                              id: w.id,
                              cx: wx,
                              cz: wz,
                            });
                          }}
                        />
                      </>
                    )}
                  </g>

                  <text
                    y={0.04}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={0.22}
                    fill="#FFFFFF"
                    fontWeight={700}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {w.label}
                  </text>

                  {isSel && (
                    <text
                      y={-0.55}
                      textAnchor="middle"
                      fontSize={0.22}
                      fill="#DC2626"
                      fontWeight={700}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {Math.round(wRot)}°
                    </text>
                  )}
                </g>
              );
            })}

          {/* Live Simulated Products & Grouped Pallet/Batch Carriers in transit / stations */}
          {simSnapshot.products.map((ent) => {
            const pDef = project.products.find((p) => p.id === ent.productId) || project.products[0];
            const isBatch = Boolean(ent.isBatchCarrier && (ent.batchCount ?? 1) > 1);
            const isPallet = ent.containerKind === 'pallet';
            const pw = isBatch
              ? isPallet
                ? 0.96
                : 0.76
              : Math.max(0.32, Math.min(0.85, pDef?.dimensions.length || 0.58));
            const pd = isBatch
              ? isPallet
                ? 0.78
                : 0.58
              : Math.max(0.24, Math.min(0.65, pDef?.dimensions.width || 0.42));
            const fillColor = isBatch
              ? isPallet
                ? '#B45309'
                : '#D97706'
              : ent.locationKind === 'conveyor'
              ? '#DC2626'
              : '#2563EB';
            return (
              <g
                key={ent.id}
                transform={`translate(${ent.worldPosition.x}, ${ent.worldPosition.z})`}
                style={{ pointerEvents: 'none' }}
              >
                {isBatch && (
                  <rect
                    x={-pw / 2 - 0.05}
                    y={-pd / 2 - 0.05}
                    width={pw + 0.1}
                    height={pd + 0.1}
                    rx={0.07}
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth={1.6 / pxPerM}
                  />
                )}
                <rect
                  x={-pw / 2}
                  y={-pd / 2}
                  width={pw}
                  height={pd}
                  rx={0.05}
                  fill={fillColor}
                  stroke="#FFFFFF"
                  strokeWidth={1.3 / pxPerM}
                />
                <text
                  y={0.04}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={isBatch ? 0.2 : 0.19}
                  fill="#FFFFFF"
                  fontWeight={700}
                >
                  {isBatch ? ent.batchLabel || `×${ent.batchCount}` : `#${ent.serialNumber}`}
                </text>
              </g>
            );
          })}

          {/* Factory Dimension Annotations & Rulers */}
          {layersVisible.dimensions && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Top width ruler */}
              {xTicks.map((x) => (
                <g key={`xt_${x}`} transform={`translate(${x}, -0.45)`}>
                  <line x1={0} y1={0.15} x2={0} y2={0.45} stroke="#475569" strokeWidth={1 / pxPerM} />
                  <text x={0} y={0} textAnchor="middle" fontSize={0.34} fill="#475569">
                    {fromMeters(x, unit).toFixed(unit === 'm' ? 0 : 0)}
                    {unit}
                  </text>
                </g>
              ))}
              {/* Left height ruler */}
              {zTicks.map((z) => (
                <g key={`zt_${z}`} transform={`translate(-0.55, ${z})`}>
                  <line x1={0.25} y1={0} x2={0.55} y2={0} stroke="#475569" strokeWidth={1 / pxPerM} />
                  <text x={0.15} y={0.08} textAnchor="end" fontSize={0.34} fill="#475569">
                    {fromMeters(z, unit).toFixed(0)}
                    {unit}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* Active Measurement Line */}
          {measurePts.a && (
            <g style={{ pointerEvents: 'none' }}>
              <circle cx={measurePts.a.x} cy={measurePts.a.z} r={0.18} fill="#DC2626" />
              {measurePts.b && (
                <>
                  <line
                    x1={measurePts.a.x}
                    y1={measurePts.a.z}
                    x2={measurePts.b.x}
                    y2={measurePts.b.z}
                    stroke="#DC2626"
                    strokeWidth={2 / pxPerM}
                    strokeDasharray={`${0.25} ${0.15}`}
                  />
                  <circle cx={measurePts.b.x} cy={measurePts.b.z} r={0.18} fill="#DC2626" />
                </>
              )}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};
