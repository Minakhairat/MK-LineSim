import React, { useMemo, useState } from 'react';
import { AlertTriangle, Link2, Pencil, Play, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { getAllEquipmentTemplates, useAppStore } from '../../store/useAppStore';
import { EquipmentCategory, EquipmentTemplate, ProductionLineType, ProjectData } from '../../types/project';
import { generateAutomaticLineLayout } from '../../simulation/layoutGenerator';
import { getRotatedBounds, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';

type EquipFilterGroup = 'all' | 'pallets' | 'packaging' | 'conveyors' | 'machines';

function matchesFilterGroup(tpl: EquipmentTemplate, group: EquipFilterGroup): boolean {
  if (group === 'all') return true;
  const cat = tpl.category;
  if (group === 'pallets') {
    return (
      cat.startsWith('pallet_wood') ||
      cat.startsWith('pallet_plastic') ||
      cat === 'pallet_jack' ||
      cat === 'pallet_conveyor' ||
      cat === 'palletizer_robot' ||
      cat === 'storage_rack'
    );
  }
  if (group === 'packaging') {
    return (
      cat.startsWith('stretch_wrapper') ||
      cat === 'shrink_tunnel' ||
      cat === 'carton_sealer' ||
      cat === 'strapping_machine' ||
      cat === 'packaging_machine' ||
      cat === 'labeling_machine' ||
      cat === 'palletizer_robot'
    );
  }
  if (group === 'conveyors') {
    return tpl.kind === 'conveyor';
  }
  return tpl.kind === 'machine' || tpl.kind === 'workstation' || tpl.kind === 'vehicle' || tpl.kind === 'buffer';
}

function resolveKindForCategory(cat: EquipmentCategory): EquipmentTemplate['kind'] {
  if (
    cat === 'conveyor_belt' ||
    cat === 'roller_conveyor' ||
    cat === 'pallet_conveyor' ||
    cat === 'incline_conveyor'
  ) {
    return 'conveyor';
  }
  if (
    cat === 'buffer' ||
    cat.startsWith('pallet_wood') ||
    cat.startsWith('pallet_plastic')
  ) {
    return 'buffer';
  }
  if (cat === 'storage_rack') return 'storage';
  if (cat === 'forklift' || cat === 'pallet_jack' || cat === 'agv_cart') return 'vehicle';
  if (cat === 'assembly_table' || cat === 'workstation') return 'workstation';
  return 'machine';
}

function findSmartPlacement(
  project: ProjectData,
  tpl: EquipmentTemplate
): { x: number; z: number } {
  const fL = project.factory.lengthM;
  const fW = project.factory.widthM;
  const L = tpl.defaultDimensions.length;
  const W = tpl.defaultDimensions.width;

  const isOccupied = (cx: number, cz: number): boolean => {
    const ba = getRotatedBounds(cx, cz, L, W, 0);
    if (ba.minX < 0.25 || ba.maxX > fL - 0.25 || ba.minZ < 0.25 || ba.maxZ > fW - 0.25) return true;
    for (const o of project.layoutObjects) {
      if (!o.rendering.visible || o.kind === 'vehicle') continue;
      const bb = getRotatedBounds(
        o.geometry.position.x,
        o.geometry.position.z,
        o.geometry.dimensions.length,
        o.geometry.dimensions.width,
        o.geometry.rotationDeg
      );
      const ox = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
      const oz = Math.min(ba.maxZ, bb.maxZ) - Math.max(ba.minZ, bb.minZ);
      if (ox > -0.15 && oz > -0.15) return true;
    }
    return false;
  };

  // If placing a workstation/machine/buffer and a conveyor exists, align cleanly beside the conveyor
  if (tpl.kind !== 'conveyor' && tpl.kind !== 'storage' && tpl.kind !== 'vehicle') {
    const conv = project.layoutObjects.find((o) => o.kind === 'conveyor' && o.rendering.visible);
    if (conv) {
      const cLen = conv.geometry.dimensions.length;
      const cWid = conv.geometry.dimensions.width;
      const offsetZ = cWid / 2 + W / 2 + 0.24;
      const steps = Math.max(3, Math.floor(cLen / Math.max(1.5, L + 0.4)));
      for (let i = 0; i < steps; i++) {
        const frac = steps === 1 ? 0 : (i / (steps - 1)) - 0.5;
        const candX = conv.geometry.position.x + frac * Math.max(0, cLen - L - 0.6);
        for (const side of [1, -1]) {
          const candZ = conv.geometry.position.z + side * offsetZ;
          if (!isOccupied(candX, candZ)) {
            return { x: Number(candX.toFixed(2)), z: Number(candZ.toFixed(2)) };
          }
        }
      }
    }
  }

  // Fallback spiral scan around factory center
  const baseX = fL / 2;
  const baseZ = fW / 2;
  if (!isOccupied(baseX, baseZ)) return { x: baseX, z: baseZ };
  for (let r = 1.5; r < Math.max(fL, fW); r += 1.4) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const cx = baseX + Math.cos(angle) * r;
      const cz = baseZ + Math.sin(angle) * r;
      if (!isOccupied(cx, cz)) {
        return { x: Number(cx.toFixed(2)), z: Number(cz.toFixed(2)) };
      }
    }
  }
  return { x: baseX, z: baseZ };
}

export const LayoutModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const customEquipment = useAppStore((s) => s.customEquipment);
  const language = useAppStore((s) => s.language);
  const addLayoutObject = useAppStore((s) => s.addLayoutObject);
  const deleteLayoutObject = useAppStore((s) => s.deleteLayoutObject);
  const selectItem = useAppStore((s) => s.selectItem);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);
  const setToast = useAppStore((s) => s.setToast);
  const autoWireForSimulation = useAppStore((s) => s.autoWireForSimulation);
  const startSimulation = useAppStore((s) => s.startSimulation);
  const layersVisible = useAppStore((s) => s.layersVisible);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);
  const updateFactory = useAppStore((s) => s.updateFactory);

  const t = getT(language);
  const isAr = language === 'ar';

  const [mode, setMode] = useState<'manual' | 'auto'>('auto');

  // Auto layout generator form state
  const [lineName, setLineName] = useState('Assembly Line 02');
  const [lineType, setLineType] = useState<ProductionLineType>('u_shaped');
  const [stageCount, setStageCount] = useState(6);
  const [workerCount, setWorkerCount] = useState(8);
  const [capacity, setCapacity] = useState(450);
  const [convSpeed, setConvSpeed] = useState(0.06);
  const [convWidth, setConvWidth] = useState(0.8);
  const [clearance, setClearance] = useState(0.6);
  const [aisleMargin, setAisleMargin] = useState(2.2);
  const [procTime, setProcTime] = useState(35);
  const [eqCat, setEqCat] = useState<EquipmentCategory>('workstation');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const [toolboxQuery, setToolboxQuery] = useState('');
  const [toolboxGroup, setToolboxGroup] = useState<EquipFilterGroup>('all');

  const templates = getAllEquipmentTemplates(customEquipment);
  const filteredToolboxTemplates = useMemo(() => {
    const q = toolboxQuery.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (!matchesFilterGroup(tpl, toolboxGroup)) return false;
      if (!q) return true;
      const localized = (t.equipment.categories[tpl.category] || tpl.name).toLowerCase();
      return localized.includes(q) || tpl.name.toLowerCase().includes(q) || tpl.category.toLowerCase().includes(q);
    });
  }, [templates, toolboxGroup, toolboxQuery, t.equipment.categories]);

  const handlePlaceTemplate = (tpl: EquipmentTemplate) => {
    const id = uid('obj');
    const layer =
      tpl.kind === 'conveyor'
        ? 'conveyors'
        : tpl.kind === 'buffer'
        ? 'buffers'
        : tpl.kind === 'storage'
        ? 'storage'
        : tpl.kind === 'vehicle'
        ? 'vehicles'
        : 'equipment';

    const displayName = tpl.isCustom ? tpl.name : t.equipment.categories[tpl.category] || tpl.name;
    const pos = findSmartPlacement(project, tpl);

    addLayoutObject({
      id,
      name: displayName,
      kind: tpl.kind,
      category: tpl.category,
      templateId: tpl.id,
      connectedToIds: [],
      geometry: {
        position: { x: pos.x, y: 0, z: pos.z },
        dimensions: { ...tpl.defaultDimensions },
        rotationDeg: 0,
        clearanceM: tpl.defaultClearanceM,
      },
      operations: { ...tpl.defaultOperations },
      rendering: {
        color: tpl.defaultColor,
        visible: true,
        locked: false,
        layer,
      },
    });
    selectItem('object', id);
    setToast(
      isAr
        ? `تم وضع "${displayName}" وربطه بمسار المنتج تلقائياً`
        : `Placed ${displayName} and auto-linked to product route`,
      'success'
    );
  };

  const handleAutoGenerate = () => {
    const res = generateAutomaticLineLayout(project, {
      lineName,
      lineType,
      stageCount,
      workerCount,
      targetCapacityPerShift: capacity,
      conveyorSpeedMps: convSpeed,
      conveyorWidthM: convWidth,
      conveyorHeightM: 0.85,
      clearanceM: clearance,
      aisleMarginM: aisleMargin,
      defaultProcessingTimeSec: procTime,
      equipmentCategory: eqCat,
    });
    setGenWarnings(res.warnings);

    commitProjectEdit((draft) => {
      if (replaceExisting) {
        draft.productionLines = [res.line];
        draft.layoutObjects = [
          ...draft.layoutObjects.filter((o) => o.kind === 'storage' || o.kind === 'vehicle'),
          ...res.objects,
        ];
        draft.stages = res.stages;
        draft.workers = res.workers;
        if (draft.products[0]) {
          draft.products[0].routeStageIds = res.stages.map((s) => s.id);
          draft.products[0].targetQuantity = capacity;
        }
      } else {
        draft.productionLines.push(res.line);
        draft.layoutObjects.push(...res.objects);
        draft.stages.push(...res.stages);
        draft.workers.push(...res.workers);
      }
      draft.simulationConfig.maxPlannedUnits = capacity;
    });
    setToast(
      res.feasible
        ? isAr
          ? `تم توليد تخطيط الخط (${res.stages.length} مرحلة، ${res.workers.length} عامل)`
          : `Generated ${lineType} layout (${res.stages.length} stages, ${res.workers.length} workers)`
        : isAr
        ? 'تم توليد التخطيط مع بعض الملاحظات الهندسية بالأسفل'
        : 'Layout generated with constraint warnings — inspect warnings below',
      res.feasible ? 'success' : 'info'
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-neutral-100 dark:bg-neutral-800 p-1">
        <button
          onClick={() => setMode('auto')}
          className={`rounded py-1.5 text-xs font-medium transition-colors ${
            mode === 'auto'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
              : 'text-neutral-600 dark:text-neutral-400'
          }`}
        >
          {t.layout.autoGenerator}
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`rounded py-1.5 text-xs font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
              : 'text-neutral-600 dark:text-neutral-400'
          }`}
        >
          {t.layout.manualToolbox}
        </button>
      </div>

      {mode === 'auto' ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500">{t.layout.lineName}</span>
            <input
              type="text"
              value={lineName}
              onChange={(e) => setLineName(e.target.value)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500">{t.layout.lineGeometryType}</span>
            <select
              value={lineType}
              onChange={(e) => setLineType(e.target.value as ProductionLineType)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1"
            >
              <option value="straight">{t.layout.straight}</option>
              <option value="u_shaped">{t.layout.u_shaped}</option>
              <option value="l_shaped">{t.layout.l_shaped}</option>
              <option value="parallel">{t.layout.parallel}</option>
              <option value="loop">{t.layout.loop}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-neutral-500">{t.layout.primaryEquipment}</span>
            <select
              value={eqCat}
              onChange={(e) => setEqCat(e.target.value as EquipmentCategory)}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1"
            >
              <option value="workstation">{t.equipment.categories.workstation}</option>
              <option value="assembly_table">{t.equipment.categories.assembly_table}</option>
              <option value="injection_molding">{t.equipment.categories.injection_molding}</option>
              <option value="hydraulic_press">{t.equipment.categories.hydraulic_press}</option>
              <option value="cutting_machine">{t.equipment.categories.cutting_machine}</option>
              <option value="welding_machine">{t.equipment.categories.welding_machine}</option>
              <option value="testing_machine">{t.equipment.categories.testing_machine}</option>
              <option value="packaging_machine">{t.equipment.categories.packaging_machine}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.stagesCount}</span>
              <input
                type="number"
                min={2}
                max={20}
                value={stageCount}
                onChange={(e) => setStageCount(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.workersCount}</span>
              <input
                type="number"
                min={1}
                max={40}
                value={workerCount}
                onChange={(e) => setWorkerCount(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.targetShift}</span>
              <input
                type="number"
                min={10}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.cycleStage}</span>
              <input
                type="number"
                min={2}
                value={procTime}
                onChange={(e) => setProcTime(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.beltSpeed}</span>
              <input
                type="number"
                step={0.01}
                min={0.01}
                value={convSpeed}
                onChange={(e) => setConvSpeed(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-500">{t.layout.clearanceM}</span>
              <input
                type="number"
                step={0.1}
                min={0.2}
                value={clearance}
                onChange={(e) => setClearance(Number(e.target.value))}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            <span>{t.layout.replaceExisting}</span>
          </label>
          <button
            onClick={handleAutoGenerate}
            className="flex items-center justify-center gap-1.5 rounded bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>{t.actions.generateLayout}</span>
          </button>

          {genWarnings.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              {genWarnings.map((w, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2.5 text-[11px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
            {t.layout.toolboxTip}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => autoWireForSimulation()}
              className="flex items-center justify-center gap-1.5 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{t.actions.autoWire}</span>
            </button>
            <button
              onClick={() => {
                autoWireForSimulation(true);
                startSimulation();
              }}
              className="flex items-center justify-center gap-1.5 rounded bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t.actions.quickSim}</span>
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute top-2 start-2 pointer-events-none" />
            <input
              type="text"
              value={toolboxQuery}
              onChange={(e) => setToolboxQuery(e.target.value)}
              placeholder={t.equipment.searchEquipment}
              className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 ps-7 pe-2 py-1 text-[11px]"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['all', isAr ? 'الكل' : 'All'],
                ['pallets', isAr ? 'باليتات' : 'Pallets'],
                ['packaging', isAr ? 'تغليف واستريتش' : 'Packaging'],
                ['conveyors', isAr ? 'سيور' : 'Conveyors'],
                ['machines', isAr ? 'ماكينات' : 'Machines'],
              ] as Array<[EquipFilterGroup, string]>
            ).map(([gid, label]) => (
              <button
                key={gid}
                type="button"
                onClick={() => setToolboxGroup(gid)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                  toolboxGroup === gid
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto">
            {filteredToolboxTemplates.map((tpl) => {
              const title = tpl.isCustom
                ? tpl.name
                : t.equipment.categories[tpl.category] || tpl.name;
              return (
                <button
                  key={tpl.id}
                  onClick={() => handlePlaceTemplate(tpl)}
                  className="flex items-center justify-between rounded border border-neutral-200 dark:border-neutral-800 p-2 text-start hover:border-red-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {title}
                    </div>
                    <div className="text-[10px] font-mono-tabular text-neutral-500">
                      {tpl.defaultDimensions.length}×{tpl.defaultDimensions.width}×{tpl.defaultDimensions.height}m
                    </div>
                  </div>
                  <Plus className="w-3.5 h-3.5 shrink-0 text-red-600" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grid Settings Section */}
      <section className="flex flex-col gap-2.5 border-t border-neutral-200 dark:border-neutral-800 pt-3 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.layout.gridSettings}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 rounded border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <input
              type="checkbox"
              checked={layersVisible.grid !== false}
              onChange={() => toggleLayerVisibility('grid')}
            />
            <span className="text-[11px] font-medium truncate">{t.layout.showGrid}</span>
          </label>
          <label className="flex items-center gap-2 rounded border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <input
              type="checkbox"
              checked={project.factory.snapToGrid}
              onChange={(e) => updateFactory({ snapToGrid: e.target.checked })}
            />
            <span className="text-[11px] font-medium truncate">{t.layout.snapToGrid}</span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-500">{t.layout.gridSpacing}</span>
          <div className="flex items-center gap-1">
            {[0.25, 0.5, 1, 2].map((stepVal) => (
              <button
                key={stepVal}
                type="button"
                onClick={() => updateFactory({ gridSizeM: stepVal })}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono-tabular border transition-colors ${
                  Math.abs(project.factory.gridSizeM - stepVal) < 0.001
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {stepVal}m
              </button>
            ))}
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={project.factory.gridSizeM}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v) && v >= 0.1) {
                  updateFactory({ gridSizeM: Math.min(10, v) });
                }
              }}
              className="w-14 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-[11px] font-mono-tabular text-end"
            />
          </div>
        </div>
      </section>

      {/* Placed Floor Equipment List (Edit / Select & Delete) */}
      <section className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-3 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.layout.placedObjects} ({project.layoutObjects.length})
        </h3>
        {project.layoutObjects.length === 0 ? (
          <div className="text-[11px] text-neutral-500">{t.layout.noPlacedObjects}</div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto min-w-0">
            {project.layoutObjects.map((obj) => (
              <div
                key={obj.id}
                className="flex items-center justify-between gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 min-w-0"
              >
                <button
                  type="button"
                  onClick={() => selectItem('object', obj.id)}
                  className="flex-1 min-w-0 text-start hover:underline"
                >
                  <div className="font-medium truncate">{obj.name}</div>
                  <div className="text-[10px] font-mono-tabular text-neutral-500 truncate">
                    {obj.geometry.dimensions.length.toFixed(1)}×{obj.geometry.dimensions.width.toFixed(1)}m · ({obj.geometry.position.x.toFixed(1)}, {obj.geometry.position.z.toFixed(1)})
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => selectItem('object', obj.id)}
                    title={t.actions.edit}
                    className="p-1 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={obj.rendering.locked}
                    onClick={() => deleteLayoutObject(obj.id)}
                    title={t.actions.delete}
                    className="p-1 rounded border border-neutral-200 dark:border-neutral-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-35"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export const EquipmentModule: React.FC = () => {
  const customEquipment = useAppStore((s) => s.customEquipment);
  const language = useAppStore((s) => s.language);
  const saveCustomEquipment = useAppStore((s) => s.saveCustomEquipment);
  const deleteCustomEquipment = useAppStore((s) => s.deleteCustomEquipment);
  const addLayoutObject = useAppStore((s) => s.addLayoutObject);
  const project = useAppStore((s) => s.project);
  const selectItem = useAppStore((s) => s.selectItem);

  const t = getT(language);

  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [name, setName] = useState(language === 'ar' ? 'خلية تجميع مخصصة' : 'Custom Assembly Cell');
  const [cat, setCat] = useState<EquipmentCategory>('workstation');
  const [L, setL] = useState(2.2);
  const [W, setW] = useState(1.2);
  const [H, setH] = useState(1.4);
  const [procTime, setProcTime] = useState(40);
  const [ops, setOps] = useState(1);
  const [libQuery, setLibQuery] = useState('');
  const [libGroup, setLibGroup] = useState<EquipFilterGroup>('all');

  const isAr = language === 'ar';
  const allTemplates = getAllEquipmentTemplates(customEquipment);
  const filteredLibrary = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    return allTemplates.filter((tpl) => {
      if (!matchesFilterGroup(tpl, libGroup)) return false;
      if (!q) return true;
      const localized = (t.equipment.categories[tpl.category] || tpl.name).toLowerCase();
      return localized.includes(q) || tpl.name.toLowerCase().includes(q) || tpl.category.toLowerCase().includes(q);
    });
  }, [allTemplates, libGroup, libQuery, t.equipment.categories]);

  const handleSaveCustom = async () => {
    const kind = resolveKindForCategory(cat);

    await saveCustomEquipment({
      id: editingTplId || uid('tpl_custom'),
      name: name.trim() || 'Custom Equipment',
      category: cat,
      kind,
      isCustom: true,
      description: 'User-defined custom industrial equipment template.',
      defaultDimensions: { length: L, width: W, height: H },
      defaultClearanceM: 0.6,
      defaultOperations: {
        processingTimeSec: procTime,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 1,
        availability: 0.98,
        requiredOperators: ops,
        speedMps: kind === 'conveyor' ? 0.12 : undefined,
        productSpacingM: kind === 'conveyor' ? 0.15 : undefined,
      },
      defaultColor: '#334155',
    });
    setEditingTplId(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
          {t.equipment.createCustom}
        </h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.equipment.equipmentName}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as EquipmentCategory)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1"
        >
          {(Object.keys(t.equipment.categories) as EquipmentCategory[]).map((key) => (
            <option key={key} value={key}>
              {t.equipment.categories[key]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1.5">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.length} (m)</span>
            <input
              type="number"
              step={0.1}
              value={L}
              onChange={(e) => setL(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.width} (m)</span>
            <input
              type="number"
              step={0.1}
              value={W}
              onChange={(e) => setW(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.labels.height} (m)</span>
            <input
              type="number"
              step={0.1}
              value={H}
              onChange={(e) => setH(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.equipment.procTime}</span>
            <input
              type="number"
              value={procTime}
              onChange={(e) => setProcTime(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-neutral-500">{t.equipment.operators}</span>
            <input
              type="number"
              min={0}
              value={ops}
              onChange={(e) => setOps(Number(e.target.value))}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleSaveCustom}
            className="flex-1 rounded bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
          >
            {editingTplId ? t.actions.saveChanges : t.equipment.savePersonal}
          </button>
          {editingTplId && (
            <button
              type="button"
              onClick={() => setEditingTplId(null)}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5 text-[11px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {t.actions.cancel}
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
          {t.equipment.libraryTitle} ({filteredLibrary.length}/{allTemplates.length})
        </h3>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute top-2 start-2 pointer-events-none" />
          <input
            type="text"
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            placeholder={t.equipment.searchEquipment}
            className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 ps-7 pe-2 py-1 text-[11px]"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['all', isAr ? 'الكل' : 'All'],
              ['pallets', isAr ? 'باليتات' : 'Pallets'],
              ['packaging', isAr ? 'تغليف' : 'Packaging'],
              ['conveyors', isAr ? 'سيور' : 'Conveyors'],
              ['machines', isAr ? 'ماكينات' : 'Machines'],
            ] as Array<[EquipFilterGroup, string]>
          ).map(([gid, label]) => (
            <button
              key={gid}
              type="button"
              onClick={() => setLibGroup(gid)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                libGroup === gid
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto">
          {filteredLibrary.map((tpl) => {
            const title = tpl.isCustom
              ? `${tpl.name} ${t.equipment.customTag}`
              : t.equipment.categories[tpl.category] || tpl.name;
            return (
              <div
                key={tpl.id}
                className="flex items-center justify-between gap-2 rounded border border-neutral-200 dark:border-neutral-800 p-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{title}</div>
                  <div className="text-[10px] font-mono-tabular text-neutral-500">
                    {tpl.defaultDimensions.length}×{tpl.defaultDimensions.width}×{tpl.defaultDimensions.height}m ·{' '}
                    {tpl.defaultOperations.processingTimeSec}s
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const id = uid('obj');
                      const pos = findSmartPlacement(project, tpl);
                      addLayoutObject({
                        id,
                        name: tpl.isCustom ? tpl.name : t.equipment.categories[tpl.category] || tpl.name,
                        kind: tpl.kind,
                        category: tpl.category,
                        templateId: tpl.id,
                        connectedToIds: [],
                        geometry: {
                          position: { x: pos.x, y: 0, z: pos.z },
                          dimensions: { ...tpl.defaultDimensions },
                          rotationDeg: 0,
                          clearanceM: tpl.defaultClearanceM,
                        },
                        operations: { ...tpl.defaultOperations },
                        rendering: {
                          color: tpl.defaultColor,
                          visible: true,
                          locked: false,
                          layer: tpl.kind === 'conveyor' ? 'conveyors' : 'equipment',
                        },
                      });
                      selectItem('object', id);
                    }}
                    className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-[10px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {t.actions.place}
                  </button>
                  {tpl.isCustom && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTplId(tpl.id);
                          setName(tpl.name);
                          setCat(tpl.category);
                          setL(tpl.defaultDimensions.length);
                          setW(tpl.defaultDimensions.width);
                          setH(tpl.defaultDimensions.height);
                          setProcTime(tpl.defaultOperations.processingTimeSec);
                          setOps(tpl.defaultOperations.requiredOperators);
                        }}
                        title={t.actions.edit}
                        className="p-1 text-neutral-600 dark:text-neutral-300 hover:text-red-600"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCustomEquipment(tpl.id)}
                        title={t.actions.delete}
                        className="p-1 text-red-600 hover:opacity-80"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
