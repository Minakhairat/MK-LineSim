import React, { useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ProductModelShape } from '../../types/project';
import { uid } from '../../utils/units';
import { getT } from '../../i18n/translations';
import { computeStageCapacityProfile } from '../../engineering/capacityEngine';

const ALL_PRODUCT_SHAPES: ProductModelShape[] = [
  'air_cooler',
  'box',
  'carton_box',
  'cylinder',
  'drum',
  'chassis',
  'appliance',
  'pallet',
  'pallet_wood',
  'pallet_plastic',
  'wrapped_pallet',
  'shrink_pack',
  'crate',
  'spool_roll',
];

const QUICK_PRODUCT_PRESETS: Array<{
  shape: ProductModelShape;
  l: number;
  w: number;
  h: number;
  weightKg: number;
  color: string;
}> = [
  { shape: 'pallet_wood', l: 1.2, w: 0.8, h: 0.85, weightKg: 420, color: '#B45309' },
  { shape: 'pallet_plastic', l: 1.2, w: 1.0, h: 0.9, weightKg: 480, color: '#1D4ED8' },
  { shape: 'wrapped_pallet', l: 1.2, w: 1.0, h: 1.15, weightKg: 540, color: '#D97706' },
  { shape: 'carton_box', l: 0.55, w: 0.4, h: 0.38, weightKg: 12, color: '#C28B53' },
  { shape: 'shrink_pack', l: 0.45, w: 0.32, h: 0.3, weightKg: 9, color: '#38BDF8' },
  { shape: 'drum', l: 0.6, w: 0.6, h: 0.9, weightKg: 210, color: '#0369A1' },
  { shape: 'air_cooler', l: 0.72, w: 0.52, h: 0.92, weightKg: 24, color: '#E2E8F0' },
];

export const ProductsModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const quickAddProductAndRun = useAppStore((s) => s.quickAddProductAndRun);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const deleteProduct = useAppStore((s) => s.deleteProduct);
  const setActiveProduct = useAppStore((s) => s.setActiveProduct);
  const startSimulation = useAppStore((s) => s.startSimulation);
  const setViewportMode = useAppStore((s) => s.setViewportMode);

  const t = getT(language);
  const isAr = language === 'ar';

  const [newName, setNewName] = useState('');
  const [newL, setNewL] = useState(0.65);
  const [newW, setNewW] = useState(0.45);
  const [newH, setNewH] = useState(0.55);
  const [newQty, setNewQty] = useState(400);
  const [newShape, setNewShape] = useState<ProductModelShape>('box');
  const [newColor, setNewColor] = useState('#CBD5E1');
  const [editingProdId, setEditingProdId] = useState<string | null>(null);

  const handleQuickAdd = (runNow: boolean) => {
    const idx = project.products.length + 1;
    const label = newName.trim() || (isAr ? `منتج جديد ${idx}` : `Product Variant ${idx}`);
    quickAddProductAndRun(
      {
        id: uid('prod'),
        code: `PRD-${100 + idx}`,
        name: label,
        category: isAr ? 'منتج تصنيعي' : 'Manufactured Assembly',
        dimensions: {
          length: Math.max(0.1, newL),
          width: Math.max(0.1, newW),
          height: Math.max(0.1, newH),
        },
        weightKg: 15,
        color: newColor,
        targetQuantity: Math.max(1, newQty),
        routeStageIds: project.stages.map((s) => s.id),
        modelShape: newShape,
      },
      runNow
    );
    setNewName('');
  };

  return (
    <div className="flex flex-col gap-4 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
      {/* Quick Add Product & Instant Wire */}
      <section className="flex flex-col gap-2 rounded border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/15 p-2.5 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {t.products.addProduct}
          </h3>
        </div>
        <input
          type="text"
          placeholder={t.products.productName}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
        />
        <div className="grid grid-cols-3 gap-1.5 min-w-0">
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">{t.labels.length} (m)</span>
            <input
              type="number"
              step={0.05}
              min={0.1}
              value={newL}
              onChange={(e) => setNewL(Number(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">{t.labels.width} (m)</span>
            <input
              type="number"
              step={0.05}
              min={0.1}
              value={newW}
              onChange={(e) => setNewW(Number(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">{t.labels.height} (m)</span>
            <input
              type="number"
              step={0.05}
              min={0.1}
              value={newH}
              onChange={(e) => setNewH(Number(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 font-mono-tabular"
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-1.5 items-end min-w-0">
          <label className="flex flex-col gap-0.5 col-span-2 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">{t.products.shape3d}</span>
            <select
              value={newShape}
              onChange={(e) => setNewShape(e.target.value as ProductModelShape)}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
            >
              {ALL_PRODUCT_SHAPES.map((shapeKey) => (
                <option key={shapeKey} value={shapeKey}>
                  {t.products.shapes[shapeKey]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">{t.products.targetQty}</span>
            <input
              type="number"
              min={1}
              value={newQty}
              onChange={(e) => setNewQty(Number(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 font-mono-tabular"
            />
          </label>
        </div>

        {/* Quick Industrial Product Presets */}
        <div className="flex flex-col gap-1 min-w-0 pt-0.5">
          <span className="text-[10px] font-medium text-neutral-500 truncate">
            {t.products.quickPresets}
          </span>
          <div className="flex flex-wrap gap-1">
            {QUICK_PRODUCT_PRESETS.map((preset) => (
              <button
                key={preset.shape}
                type="button"
                onClick={() => {
                  setNewName(t.products.shapes[preset.shape]);
                  setNewL(preset.l);
                  setNewW(preset.w);
                  setNewH(preset.h);
                  setNewShape(preset.shape);
                  setNewColor(preset.color);
                }}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-700 dark:text-neutral-200 hover:border-red-500 hover:text-red-600 transition-colors"
              >
                {t.products.shapes[preset.shape]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 min-w-0">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-0.5"
          />
          <button
            type="button"
            onClick={() => handleQuickAdd(false)}
            className="flex flex-1 min-w-[78px] items-center justify-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.actions.add}</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickAdd(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-red-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-red-700"
          >
            <Play className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t.products.applyAndSimulate}</span>
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.products.title} ({project.products.length})
        </h3>
        <button
          type="button"
          onClick={() => setViewportMode('flowchart')}
          className="flex items-center gap-1 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 max-w-full"
        >
          <Workflow className="w-3 h-3 shrink-0" />
          <span className="truncate">{t.flowchart.openEditorBtn}</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 min-w-0">
        {project.products.map((prod, idx) => {
          const isEditing = editingProdId === prod.id;
          return (
            <div
              key={prod.id}
              className={`flex flex-col gap-2 rounded border p-2.5 min-w-0 ${
                idx === 0
                  ? 'border-red-500 bg-red-50/20 dark:bg-red-950/10'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    type="text"
                    value={prod.name}
                    onChange={(e) => updateProduct(prod.id, { name: e.target.value })}
                    className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-semibold text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingProdId(isEditing ? null : prod.id)}
                    title={t.actions.edit}
                    className={`p-1 rounded border shrink-0 ${
                      isEditing
                        ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                        : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={project.products.length <= 1}
                    onClick={() => deleteProduct(prod.id)}
                    title={t.actions.delete}
                    className="p-1 rounded border border-neutral-200 dark:border-neutral-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-35 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <span className="text-[10px] font-mono-tabular text-neutral-500 truncate">
                    {prod.code} · {prod.weightKg}kg
                  </span>
                  {idx === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      {isAr ? 'المنتج النشط' : 'Active'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProduct(prod.id);
                        startSimulation();
                      }}
                      className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 shrink-0"
                    >
                      {isAr ? 'تفعيل وتشغيل' : 'Activate'}
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="grid grid-cols-3 gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5 min-w-0">
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.products.productCode}</span>
                    <input
                      type="text"
                      value={prod.code}
                      onChange={(e) => updateProduct(prod.id, { code: e.target.value })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">kg</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={prod.weightKg}
                      onChange={(e) => updateProduct(prod.id, { weightKg: Math.max(0.1, Number(e.target.value)) })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{isAr ? 'اللون' : 'Color'}</span>
                    <input
                      type="color"
                      value={prod.color}
                      onChange={(e) => updateProduct(prod.id, { color: e.target.value })}
                      className="h-6 w-full cursor-pointer rounded border border-neutral-300 dark:border-neutral-700 bg-transparent p-0.5"
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5 min-w-0">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.labels.length} (m)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    value={prod.dimensions.length}
                    onChange={(e) =>
                      updateProduct(prod.id, {
                        dimensions: { ...prod.dimensions, length: Math.max(0.05, Number(e.target.value)) },
                      })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.labels.width} (m)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    value={prod.dimensions.width}
                    onChange={(e) =>
                      updateProduct(prod.id, {
                        dimensions: { ...prod.dimensions, width: Math.max(0.05, Number(e.target.value)) },
                      })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.labels.height} (m)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    value={prod.dimensions.height}
                    onChange={(e) =>
                      updateProduct(prod.id, {
                        dimensions: { ...prod.dimensions, height: Math.max(0.05, Number(e.target.value)) },
                      })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-1.5 min-w-0">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.products.shape3d}</span>
                  <select
                    value={prod.modelShape}
                    onChange={(e) => updateProduct(prod.id, { modelShape: e.target.value as ProductModelShape })}
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
                  >
                    {ALL_PRODUCT_SHAPES.map((shapeKey) => (
                      <option key={shapeKey} value={shapeKey}>
                        {t.products.shapes[shapeKey]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.products.targetQty}</span>
                  <input
                    type="number"
                    min={1}
                    value={prod.targetQuantity}
                    onChange={(e) => updateProduct(prod.id, { targetQuantity: Math.max(1, Number(e.target.value)) })}
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-medium text-neutral-500 truncate">
                    {t.products.routeStages} ({prod.routeStageIds.length} {t.projects.stagesLabel})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateProduct(prod.id, {
                        routingMode: 'auto',
                        routeStageIds: project.stages.map((s) => s.id),
                        entryStageIds: project.stages[0] ? [project.stages[0].id] : [],
                      })
                    }
                    className="text-[10px] font-medium text-red-600 hover:underline shrink-0"
                  >
                    {t.products.selectAllStages}
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-neutral-200 dark:border-neutral-800 rounded p-1.5">
                  {project.stages.map((st) => {
                    const active = prod.routeStageIds.includes(st.id);
                    return (
                      <label key={st.id} className="flex items-center gap-2 text-[11px] cursor-pointer min-w-0">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => {
                            const next = active
                              ? prod.routeStageIds.filter((x) => x !== st.id)
                              : [...prod.routeStageIds, st.id];
                            updateProduct(prod.id, {
                              routingMode: 'manual',
                              routeStageIds: next,
                              entryStageIds: next.length > 0 ? [next[0]] : [],
                            });
                          }}
                        />
                        <span className="truncate">
                          {st.code} {st.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const BULK_CATEGORY_SET = new Set<string>([
  'pallet_wood_euro',
  'pallet_wood_std',
  'pallet_wood_heavy',
  'pallet_plastic_euro',
  'pallet_plastic_heavy',
  'pallet_plastic_compact',
  'packaging_machine',
  'stretch_wrapper_turntable',
  'stretch_wrapper_arm',
  'shrink_tunnel',
  'carton_sealer',
  'strapping_machine',
  'palletizer_robot',
  'material_handling',
]);

export const ProcessesModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const language = useAppStore((s) => s.language);
  const addStage = useAppStore((s) => s.addStage);
  const updateStage = useAppStore((s) => s.updateStage);
  const deleteStage = useAppStore((s) => s.deleteStage);
  const setViewportMode = useAppStore((s) => s.setViewportMode);

  const t = getT(language);
  const isAr = language === 'ar';

  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const stationsAndConveyors = project.layoutObjects.filter(
    (o) =>
      o.rendering.visible &&
      (o.kind === 'workstation' || o.kind === 'machine' || o.kind === 'buffer' || o.kind === 'conveyor')
  );
  const conveyors = project.layoutObjects.filter((o) => o.rendering.visible && o.kind === 'conveyor');

  const isBulkOrPackingStage = (st: (typeof project.stages)[number]) => {
    if ((st.batchSize ?? 1) > 1 || st.batchMode === 'collect_batch' || st.batchMode === 'unbatch') {
      return true;
    }
    for (const oid of st.assignedObjectIds) {
      const obj = project.layoutObjects.find((o) => o.id === oid);
      if (obj && BULK_CATEGORY_SET.has(obj.category)) return true;
    }
    return /pack|pallet|wrap|shrink|strap|carton|تغليف|تعبئة|باليت|رص/i.test(st.name);
  };

  const bulkStages = project.stages.filter(isBulkOrPackingStage);
  const nonBulkStages = project.stages.filter((st) => {
    if (isBulkOrPackingStage(st)) return false;
    const primaryObj = project.layoutObjects.find((o) => o.id === st.assignedObjectIds[0]);
    return primaryObj?.kind !== 'conveyor';
  });

  return (
    <div className="flex flex-col gap-4 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
      <button
        type="button"
        onClick={() => setViewportMode('flowchart')}
        className="flex items-center justify-center gap-1.5 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50"
      >
        <Workflow className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{t.flowchart.openEditorBtn}</span>
      </button>

      {/* Batching Controls Section */}
      <section className="flex flex-col gap-2.5 rounded border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/15 p-2.5 min-w-0">
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Boxes className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {t.processes.batchingControls} ({bulkStages.length})
            </h3>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-neutral-600 dark:text-neutral-400">
          {t.processes.batchingDesc}
        </p>

        {nonBulkStages.length > 0 && (
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-400 truncate">
              {t.processes.addBulkStage}
            </span>
            <select
              value=""
              onChange={(e) => {
                const sid = e.target.value;
                if (!sid) return;
                const target = project.stages.find((s) => s.id === sid);
                if (!target) return;
                updateStage(sid, {
                  batchSize: Math.max(4, target.batchSize ?? 4),
                  batchMode: 'collect_batch',
                });
              }}
              className="w-full min-w-0 rounded border border-amber-300 dark:border-amber-800 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
            >
              <option value="">{t.processes.selectStagePrompt}</option>
              {nonBulkStages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.code} {st.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {bulkStages.length === 0 ? (
          <div className="rounded border border-dashed border-amber-300/80 dark:border-amber-900/50 p-2 text-[10px] text-neutral-600 dark:text-neutral-400">
            {t.processes.noBulkStages}
          </div>
        ) : (
          <div className="flex flex-col gap-2 min-w-0">
            {bulkStages.map((st) => {
              const assignedObjs = st.assignedObjectIds
                .map((oid) => project.layoutObjects.find((o) => o.id === oid))
                .filter((o): o is NonNullable<typeof o> => Boolean(o));
              const primaryObj = assignedObjs[0];
              const capProfile = computeStageCapacityProfile(st, assignedObjs);
              const batchSize = capProfile.batchSize;
              const batchMode = capProfile.batchMode;
              const effUnitCycle = capProfile.effectiveUnitCycleSec;
              const bulkHourlyRate = capProfile.theoreticalCapacityPerHour;

              return (
                <div
                  key={`batch_ctrl_${st.id}`}
                  className="flex flex-col gap-2 rounded border border-amber-300/70 dark:border-amber-900/50 bg-white dark:bg-neutral-900 p-2 min-w-0"
                >
                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[11px] text-neutral-900 dark:text-neutral-100 truncate">
                        {st.code} {st.name}
                      </div>
                      {primaryObj && (
                        <div className="text-[10px] text-neutral-500 truncate">
                          {primaryObj.name}
                        </div>
                      )}
                    </div>
                    {(batchSize > 1 || batchMode !== 'single') && (
                      <button
                        type="button"
                        onClick={() => updateStage(st.id, { batchSize: 1, batchMode: 'single' })}
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 font-mono-tabular text-[10px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
                        title={t.labels.batchSingle}
                      >
                        {t.processes.resetSingle}
                      </button>
                    )}
                  </div>

                  {/* Pallet / Batch Group Size */}
                  <div className="grid grid-cols-2 gap-1.5 min-w-0">
                    <label className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-neutral-500 truncate">
                        {t.processes.palletGroupSize}
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={batchSize}
                        onChange={(e) => {
                          const next = Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1)));
                          updateStage(st.id, {
                            batchSize: next,
                            batchMode:
                              next > 1
                                ? batchMode === 'unbatch'
                                  ? 'collect_batch'
                                  : batchMode === 'single'
                                  ? 'collect_batch'
                                  : batchMode
                                : 'single',
                          });
                        }}
                        className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-neutral-500 truncate">
                        {t.labels.batchMode}
                      </span>
                      <select
                        value={batchMode}
                        onChange={(e) => {
                          const mode = e.target.value as 'single' | 'collect_batch' | 'unbatch';
                          updateStage(st.id, {
                            batchMode: mode,
                            batchSize: mode === 'collect_batch' ? Math.max(2, batchSize) : 1,
                          });
                        }}
                        className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-1 text-[10px]"
                      >
                        <option value="collect_batch">{t.labels.batchCollect}</option>
                        <option value="single">{t.labels.batchSingle}</option>
                        <option value="unbatch">{t.labels.batchUnbatch}</option>
                      </select>
                    </label>
                  </div>

                  {/* Quick Pallet Size Chips */}
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {[1, 4, 6, 8, 12, 24].map((presetSize) => (
                      <button
                        key={presetSize}
                        type="button"
                        onClick={() =>
                          updateStage(st.id, {
                            batchSize: presetSize,
                            batchMode: presetSize > 1 ? 'collect_batch' : 'single',
                          })
                        }
                        className={`rounded border px-1.5 py-0.5 font-mono-tabular text-[10px] transition-colors ${
                          batchSize === presetSize
                            ? 'border-amber-600 bg-amber-600 text-white font-semibold'
                            : 'border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-amber-500'
                        }`}
                      >
                        ×{presetSize}
                      </button>
                    ))}
                  </div>

                  {/* Packing Cycle Adjustment */}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">
                      {t.processes.packingCycleAdj}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={st.processingTimeSec}
                        onChange={(e) =>
                          updateStage(st.id, { processingTimeSec: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-16 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 font-mono-tabular text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateStage(st.id, { processingTimeSec: Math.max(1, Math.round(st.processingTimeSec - 5)) })
                        }
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 font-mono-tabular text-[10px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        -5s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateStage(st.id, { processingTimeSec: Math.max(1, Math.round(st.processingTimeSec + 5)) })
                        }
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 font-mono-tabular text-[10px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        +5s
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateStage(st.id, {
                            processingTimeSec: Math.max(1, Number((st.processingTimeSec * 0.8).toFixed(1))),
                          })
                        }
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 font-mono-tabular text-[10px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        ×0.8
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateStage(st.id, {
                            processingTimeSec: Math.max(1, Number((st.processingTimeSec * 1.25).toFixed(1))),
                          })
                        }
                        className="rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 font-mono-tabular text-[10px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        ×1.25
                      </button>
                    </div>
                  </div>

                  {/* Effective Unit Amortization Readout */}
                  <div className="flex items-center justify-between gap-2 rounded bg-amber-50/70 dark:bg-amber-950/30 px-2 py-1 text-[10px] font-mono-tabular text-amber-900 dark:text-amber-300">
                    <span className="truncate">
                      {t.processes.effectiveUnitCycle}: {effUnitCycle.toFixed(1)}s
                    </span>
                    <span className="shrink-0 font-semibold">
                      {t.processes.bulkCapacity}: {bulkHourlyRate.toFixed(0)} {t.simInspector.unitsPerHour}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.processes.title} ({project.stages.length})
        </h3>
        <button
          type="button"
          onClick={() => {
            const idx = project.stages.length + 1;
            const prev = project.stages[project.stages.length - 1];
            addStage({
              id: uid('stg'),
              code: `OP-${idx * 10}`,
              name: isAr ? `مرحلة ${idx}` : `Stage ${idx}`,
              description: isAr ? 'مرحلة تشغيل إنتاجية' : 'Production operation stage',
              processingTimeSec: 35,
              setupTimeSec: 0,
              loadingTimeSec: 0,
              unloadingTimeSec: 0,
              requiredWorkers: 1,
              requiredMachines: 1,
              inputQty: 1,
              outputQty: 1,
              scrapRate: 0,
              reworkProbability: 0,
              bufferCapacity: 4,
              predecessorIds: prev ? [prev.id] : [],
              successorIds: [],
              assignedObjectIds: stationsAndConveyors[0] ? [stationsAndConveyors[0].id] : [],
            });
          }}
          className="flex items-center gap-1 rounded bg-neutral-900 dark:bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-neutral-900 shrink-0"
        >
          <Plus className="w-3 h-3" />
          <span>{t.processes.addStage}</span>
        </button>
      </div>

      <div className="flex flex-col gap-2.5 min-w-0">
        {project.stages.map((st) => {
          const isEditing = editingStageId === st.id;
          return (
            <div
              key={st.id}
              className="flex flex-col gap-2 rounded border border-neutral-200 dark:border-neutral-800 p-2.5 min-w-0"
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <input
                  type="text"
                  value={st.name}
                  onChange={(e) => updateStage(st.id, { name: e.target.value })}
                  className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-0.5 font-semibold"
                />
                {(st.batchSize ?? 1) > 1 && st.batchMode !== 'single' && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono-tabular text-[10px] font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                    ×{st.batchSize}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setEditingStageId(isEditing ? null : st.id)}
                  title={t.actions.edit}
                  className={`p-1 rounded border shrink-0 ${
                    isEditing
                      ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteStage(st.id)}
                  title={t.actions.delete}
                  className="p-1 rounded border border-neutral-200 dark:border-neutral-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {isEditing && (
                <div className="grid grid-cols-2 gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-1.5 min-w-0">
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.code}</span>
                    <input
                      type="text"
                      value={st.code}
                      onChange={(e) => updateStage(st.id, { code: e.target.value })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.setupSec}</span>
                    <input
                      type="number"
                      min={0}
                      value={st.setupTimeSec}
                      onChange={(e) => updateStage(st.id, { setupTimeSec: Math.max(0, Number(e.target.value)) })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.loadSec}</span>
                    <input
                      type="number"
                      min={0}
                      value={st.loadingTimeSec}
                      onChange={(e) => updateStage(st.id, { loadingTimeSec: Math.max(0, Number(e.target.value)) })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.unloadSec}</span>
                    <input
                      type="number"
                      min={0}
                      value={st.unloadingTimeSec}
                      onChange={(e) => updateStage(st.id, { unloadingTimeSec: Math.max(0, Number(e.target.value)) })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.reworkPct}</span>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      max={50}
                      value={Number((st.reworkProbability * 100).toFixed(1))}
                      onChange={(e) =>
                        updateStage(st.id, {
                          reworkProbability: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)),
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.processes.conveyorLink}</span>
                    <select
                      value={st.conveyorObjectId || ''}
                      onChange={(e) => updateStage(st.id, { conveyorObjectId: e.target.value || undefined })}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    >
                      <option value="">{t.processes.unassigned}</option>
                      {conveyors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.batchSize}</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={st.batchSize ?? 1}
                      onChange={(e) => {
                        const nextBatch = Math.max(1, Math.round(Number(e.target.value)));
                        updateStage(st.id, {
                          batchSize: nextBatch,
                          batchMode:
                            nextBatch > 1
                              ? st.batchMode === 'unbatch'
                                ? 'collect_batch'
                                : st.batchMode || 'collect_batch'
                              : 'single',
                        });
                      }}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] text-neutral-500 truncate">{t.labels.batchMode}</span>
                    <select
                      value={st.batchMode || ((st.batchSize ?? 1) > 1 ? 'collect_batch' : 'single')}
                      onChange={(e) => {
                        const mode = e.target.value as 'single' | 'collect_batch' | 'unbatch';
                        updateStage(st.id, {
                          batchMode: mode,
                          batchSize: mode === 'collect_batch' ? Math.max(2, st.batchSize ?? 4) : 1,
                        });
                      }}
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    >
                      <option value="single">{t.labels.batchSingle}</option>
                      <option value="collect_batch">{t.labels.batchCollect}</option>
                      <option value="unbatch">{t.labels.batchUnbatch}</option>
                    </select>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5 min-w-0">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.processes.procSec}</span>
                  <input
                    type="number"
                    min={0}
                    value={st.processingTimeSec}
                    onChange={(e) => updateStage(st.id, { processingTimeSec: Math.max(0, Number(e.target.value)) })}
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.processes.workers}</span>
                  <input
                    type="number"
                    min={0}
                    value={st.requiredWorkers}
                    onChange={(e) =>
                      updateStage(st.id, { requiredWorkers: Math.max(0, Math.round(Number(e.target.value))) })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.processes.bufferCap}</span>
                  <input
                    type="number"
                    min={1}
                    value={st.bufferCapacity}
                    onChange={(e) =>
                      updateStage(st.id, { bufferCapacity: Math.max(1, Math.round(Number(e.target.value))) })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5 min-w-0">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.processes.scrapPct}</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={50}
                    value={Number((st.scrapRate * 100).toFixed(1))}
                    onChange={(e) =>
                      updateStage(st.id, { scrapRate: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)) })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] text-neutral-500 truncate">{t.processes.station}</span>
                  <select
                    value={st.assignedObjectIds[0] || ''}
                    onChange={(e) =>
                      updateStage(st.id, { assignedObjectIds: e.target.value ? [e.target.value] : [] })
                    }
                    className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
                  >
                    <option value="">{t.processes.unassigned}</option>
                    {stationsAndConveyors.map((obj) => (
                      <option key={obj.id} value={obj.id}>
                        {obj.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { WorkforceModule } from './WorkforceModule';
