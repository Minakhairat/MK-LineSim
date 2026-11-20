import React, { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { MeasurementUnit, OpeningType, WallSide, ZoneType } from '../../types/project';
import { fromMeters, toMeters, uid } from '../../utils/units';
import { getT } from '../../i18n/translations';

const ZONE_COLORS: Record<ZoneType, string> = {
  receiving: '#0284C7',
  dispatch: '#059669',
  raw_storage: '#64748B',
  finished_storage: '#10B981',
  maintenance: '#DC2626',
  employee: '#4F46E5',
  safety: '#EAB308',
  pedestrian_aisle: '#16A34A',
  forklift_aisle: '#D97706',
};

export const FactoryModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const layersVisible = useAppStore((s) => s.layersVisible);
  const language = useAppStore((s) => s.language);
  const updateFactory = useAppStore((s) => s.updateFactory);
  const addZone = useAppStore((s) => s.addZone);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const selectItem = useAppStore((s) => s.selectItem);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);
  const commitProjectEdit = useAppStore((s) => s.commitProjectEdit);

  const t = getT(language);

  const [newZoneType, setNewZoneType] = useState<ZoneType>('safety');
  const [colX, setColX] = useState(15);
  const [colZ, setColZ] = useState(10);

  const [openType, setOpenType] = useState<OpeningType>('door');
  const [openWall, setOpenWall] = useState<WallSide>('south');

  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingOpenId, setEditingOpenId] = useState<string | null>(null);

  const { factory } = project;
  const unit = factory.unit;

  const handleDimChange = (field: 'lengthM' | 'widthM' | 'heightM', rawVal: number) => {
    if (Number.isNaN(rawVal) || rawVal <= 0) return;
    updateFactory({ [field]: Math.max(2, toMeters(rawVal, unit)) });
  };

  return (
    <div className="flex flex-col gap-5 p-3.5 text-xs w-full min-w-0 overflow-x-hidden">
      {/* Factory Envelope & Units */}
      <section className="flex flex-col gap-2.5 border-b border-neutral-200 dark:border-neutral-800 pb-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {t.factory.buildingEnvelope}
          </h3>
          <select
            value={unit}
            onChange={(e) => updateFactory({ unit: e.target.value as MeasurementUnit })}
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-0.5 text-[11px] font-mono-tabular shrink-0"
          >
            <option value="m">{t.factory.meters}</option>
            <option value="cm">{t.factory.centimeters}</option>
            <option value="mm">{t.factory.millimeters}</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-1.5 min-w-0">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">
              {t.labels.length} ({unit})
            </span>
            <input
              type="number"
              value={Number(fromMeters(factory.lengthM, unit).toFixed(unit === 'm' ? 2 : 0))}
              onChange={(e) => handleDimChange('lengthM', parseFloat(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">
              {t.labels.width} ({unit})
            </span>
            <input
              type="number"
              value={Number(fromMeters(factory.widthM, unit).toFixed(unit === 'm' ? 2 : 0))}
              onChange={(e) => handleDimChange('widthM', parseFloat(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] text-neutral-500 truncate">
              {t.labels.height} ({unit})
            </span>
            <input
              type="number"
              value={Number(fromMeters(factory.heightM, unit).toFixed(unit === 'm' ? 2 : 0))}
              onChange={(e) => handleDimChange('heightM', parseFloat(e.target.value))}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-1 font-mono-tabular"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 items-center pt-1 min-w-0">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[11px] text-neutral-500 truncate">{t.labels.gridSize}</span>
            <select
              value={factory.gridSizeM}
              onChange={(e) => updateFactory({ gridSizeM: Number(e.target.value) })}
              className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 font-mono-tabular"
            >
              <option value={0.25}>0.25 m</option>
              <option value={0.5}>0.50 m</option>
              <option value={1}>1.00 m</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-4 cursor-pointer min-w-0">
            <input
              type="checkbox"
              checked={factory.snapToGrid}
              onChange={(e) => updateFactory({ snapToGrid: e.target.checked })}
            />
            <span className="truncate">{t.labels.snapToGrid}</span>
          </label>
        </div>
      </section>

      {/* Functional Zones & Aisles */}
      <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.factory.zonesAisles} ({factory.zones.length})
        </h3>
        <div className="flex gap-1.5 min-w-0">
          <select
            value={newZoneType}
            onChange={(e) => setNewZoneType(e.target.value as ZoneType)}
            className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px]"
          >
            {(Object.keys(ZONE_COLORS) as ZoneType[]).map((k) => (
              <option key={k} value={k}>
                {t.factory.zones[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const color = ZONE_COLORS[newZoneType];
              const zId = uid('zone');
              addZone({
                id: zId,
                name: t.factory.zones[newZoneType],
                type: newZoneType,
                position: { x: factory.lengthM / 2, y: 0, z: factory.widthM / 2 },
                dimensions: {
                  length: newZoneType.includes('aisle') ? 10 : 4,
                  width: newZoneType.includes('aisle') ? 1.8 : 3,
                },
                rotationDeg: 0,
                color,
                locked: false,
                visible: true,
              });
              selectItem('zone', zId);
            }}
            className="flex items-center gap-1 rounded bg-neutral-900 dark:bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-white dark:text-neutral-900 shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span>{t.actions.add}</span>
          </button>
        </div>
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto min-w-0">
          {factory.zones.map((z) => {
            const isEditing = editingZoneId === z.id;
            return (
              <div
                key={z.id}
                className="flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 p-1.5 min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => selectItem('zone', z.id)}
                    className="flex-1 min-w-0 text-start hover:underline"
                  >
                    <div className="truncate font-medium">{z.name}</div>
                    <div className="text-[10px] font-mono-tabular text-neutral-500">
                      {z.dimensions.length.toFixed(1)}×{z.dimensions.width.toFixed(1)}m
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        selectItem('zone', z.id);
                        setEditingZoneId(isEditing ? null : z.id);
                      }}
                      title={t.actions.edit}
                      className={`p-1 rounded border ${
                        isEditing
                          ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                          : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300'
                      }`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteZone(z.id)}
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
                      <span className="text-[10px] text-neutral-500 truncate">{t.labels.zoneName}</span>
                      <input
                        type="text"
                        value={z.name}
                        onChange={(e) => updateZone(z.id, { name: e.target.value })}
                        className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-neutral-500 truncate">{t.labels.length} (m)</span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        value={z.dimensions.length}
                        onChange={(e) =>
                          updateZone(z.id, {
                            dimensions: { ...z.dimensions, length: Math.max(0.5, Number(e.target.value)) },
                          })
                        }
                        className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-neutral-500 truncate">{t.labels.width} (m)</span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        value={z.dimensions.width}
                        onChange={(e) =>
                          updateZone(z.id, {
                            dimensions: { ...z.dimensions, width: Math.max(0.5, Number(e.target.value)) },
                          })
                        }
                        className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 font-mono-tabular text-[11px]"
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Structural Columns */}
      <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.factory.structuralColumns} ({factory.columns.length})
        </h3>
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            type="number"
            value={colX}
            onChange={(e) => setColX(Number(e.target.value))}
            placeholder="X (m)"
            className="w-16 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
          />
          <input
            type="number"
            value={colZ}
            onChange={(e) => setColZ(Number(e.target.value))}
            placeholder="Z (m)"
            className="w-16 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono-tabular"
          />
          <button
            type="button"
            onClick={() =>
              commitProjectEdit((draft) => {
                draft.factory.columns.push({
                  id: uid('col'),
                  label: `C-${draft.factory.columns.length + 1}`,
                  x: Math.max(0.5, Math.min(draft.factory.lengthM - 0.5, colX)),
                  z: Math.max(0.5, Math.min(draft.factory.widthM - 0.5, colZ)),
                  width: 0.4,
                  depth: 0.4,
                });
              })
            }
            className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 truncate"
          >
            {t.factory.addColumn}
          </button>
        </div>
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto min-w-0">
          {factory.columns.map((c) => {
            const isEditing = editingColId === c.id;
            return (
              <div
                key={c.id}
                className="flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-[11px] min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <span className="font-mono-tabular truncate">
                    {c.label}: ({c.x}m, {c.z}m)
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingColId(isEditing ? null : c.id)}
                      title={t.actions.edit}
                      className="text-neutral-600 dark:text-neutral-300 hover:text-red-600"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProjectEdit((draft) => {
                          draft.factory.columns = draft.factory.columns.filter((x) => x.id !== c.id);
                        })
                      }
                      title={t.actions.delete}
                      className="text-red-600 hover:opacity-80"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="grid grid-cols-3 gap-1 rounded bg-neutral-50 dark:bg-neutral-950 p-1 min-w-0">
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.columns.find((x) => x.id === c.id);
                          if (target) target.label = e.target.value;
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    />
                    <input
                      type="number"
                      step={0.5}
                      value={c.x}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.columns.find((x) => x.id === c.id);
                          if (target) target.x = Math.max(0.5, Math.min(draft.factory.lengthM - 0.5, Number(e.target.value)));
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                    />
                    <input
                      type="number"
                      step={0.5}
                      value={c.z}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.columns.find((x) => x.id === c.id);
                          if (target) target.z = Math.max(0.5, Math.min(draft.factory.widthM - 0.5, Number(e.target.value)));
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Doors, Windows & Loading Bays */}
      <section className="flex flex-col gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-4 min-w-0">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">
          {t.factory.doorsWindowsBays} ({factory.openings.length})
        </h3>
        <div className="flex gap-1.5 min-w-0">
          <select
            value={openType}
            onChange={(e) => setOpenType(e.target.value as OpeningType)}
            className="flex-1 min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
          >
            <option value="door">{t.factory.door}</option>
            <option value="window">{t.factory.window}</option>
            <option value="main_entrance">{t.factory.entrance}</option>
            <option value="loading_bay">{t.factory.loadingBay}</option>
          </select>
          <select
            value={openWall}
            onChange={(e) => setOpenWall(e.target.value as WallSide)}
            className="w-20 shrink-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-1 text-[11px]"
          >
            <option value="north">{t.factory.north}</option>
            <option value="south">{t.factory.south}</option>
            <option value="east">{t.factory.east}</option>
            <option value="west">{t.factory.west}</option>
          </select>
          <button
            type="button"
            onClick={() =>
              commitProjectEdit((draft) => {
                const wallLen =
                  openWall === 'north' || openWall === 'south'
                    ? draft.factory.lengthM
                    : draft.factory.widthM;
                draft.factory.openings.push({
                  id: uid('open'),
                  label: `${openType} (${openWall})`,
                  type: openType,
                  wall: openWall,
                  offsetM: Math.max(1, wallLen / 2 - 1.5),
                  widthM: openType === 'loading_bay' ? 3.5 : openType === 'window' ? 4.0 : 2.0,
                  heightM: openType === 'window' ? 1.4 : 2.6,
                  sillHeightM: openType === 'window' ? 2.6 : 0,
                });
              })
            }
            className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
          >
            + {t.actions.add}
          </button>
        </div>

        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto min-w-0">
          {factory.openings.map((op) => {
            const isEditing = editingOpenId === op.id;
            return (
              <div
                key={op.id}
                className="flex flex-col gap-1.5 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-[11px] min-w-0"
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <span className="truncate font-medium">
                    {op.label} · {op.widthM}m
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingOpenId(isEditing ? null : op.id)}
                      title={t.actions.edit}
                      className="text-neutral-600 dark:text-neutral-300 hover:text-red-600"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitProjectEdit((draft) => {
                          draft.factory.openings = draft.factory.openings.filter((x) => x.id !== op.id);
                        })
                      }
                      title={t.actions.delete}
                      className="text-red-600 hover:opacity-80"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="grid grid-cols-3 gap-1 rounded bg-neutral-50 dark:bg-neutral-950 p-1 min-w-0">
                    <input
                      type="text"
                      value={op.label}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.openings.find((x) => x.id === op.id);
                          if (target) target.label = e.target.value;
                        })
                      }
                      className="col-span-3 w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    />
                    <select
                      value={op.wall}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.openings.find((x) => x.id === op.id);
                          if (target) target.wall = e.target.value as WallSide;
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-[10px]"
                    >
                      <option value="north">{t.factory.north}</option>
                      <option value="south">{t.factory.south}</option>
                      <option value="east">{t.factory.east}</option>
                      <option value="west">{t.factory.west}</option>
                    </select>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      value={op.offsetM}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.openings.find((x) => x.id === op.id);
                          if (target) target.offsetM = Math.max(0, Number(e.target.value));
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                      title="Offset (m)"
                    />
                    <input
                      type="number"
                      step={0.5}
                      min={0.5}
                      value={op.widthM}
                      onChange={(e) =>
                        commitProjectEdit((draft) => {
                          const target = draft.factory.openings.find((x) => x.id === op.id);
                          if (target) target.widthM = Math.max(0.5, Number(e.target.value));
                        })
                      }
                      className="w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 font-mono-tabular text-[10px]"
                      title="Width (m)"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Layer Visibility */}
      <section className="flex flex-col gap-1.5">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
          {t.factory.layerVisibility}
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(layersVisible).map(([layer, visible]) => (
            <label key={layer} className="flex items-center gap-2 cursor-pointer text-[11px] min-w-0">
              <input
                type="checkbox"
                checked={visible}
                onChange={() => toggleLayerVisibility(layer)}
              />
              <span className="truncate">{t.factory.layers[layer as keyof typeof t.factory.layers] || layer}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};
