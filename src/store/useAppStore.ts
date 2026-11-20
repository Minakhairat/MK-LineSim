import { create } from 'zustand';
import {
  AppLanguage,
  AppTheme,
  CameraPreset,
  EquipmentTemplate,
  FactorySpec,
  FactoryZone,
  LayoutObject,
  ProductDefinition,
  ProductionStage,
  ProjectData,
  ScenarioRecord,
  SimEvent,
  SimulationConfig,
  SimulationResult,
  SimulationSnapshot,
  ValidationIssue,
  VisualVariant,
  ViewportMode,
  WorkerDefinition,
  WorkspaceModuleId,
} from '../types/project';
import { createDesertAirCoolerProject } from '../data/sampleProject';
import { BUILTIN_EQUIPMENT_TEMPLATES } from '../data/equipmentCatalog';
import { DiscreteEventSimulationEngine } from '../simulation/desEngine';
import { validateProject } from '../simulation/validator';
import { runSimulationInWorker } from '../simulation/workerClient';
import {
  autoFixProjectIssues,
  autoWireProjectForSimulation,
  importFlowchartToSimulationData,
  syncProductRoutes,
  syncStagePredecessorsAndObjectLinks,
} from '../simulation/autoWire';
import {
  deleteCustomEquipmentFromDb,
  deleteProjectFromDb,
  getLastActiveProjectId,
  loadAllProjectsFromDb,
  loadCustomEquipmentFromDb,
  migrateProjectSchema,
  saveCustomEquipmentToDb,
  saveProjectToDb,
} from '../storage/indexedDb';
import { uid } from '../utils/units';

interface SelectionState {
  ids: string[];
  kind: 'object' | 'worker' | 'zone' | 'stage' | null;
}

interface AppState {
  initialized: boolean;
  project: ProjectData;
  projectsList: ProjectData[];
  customEquipment: EquipmentTemplate[];
  undoStack: ProjectData[];
  redoStack: ProjectData[];
  clipboard: LayoutObject[];
  selection: SelectionState;

  activeModule: WorkspaceModuleId;
  viewportMode: ViewportMode;
  cameraPreset: CameraPreset;
  visualVariant: VisualVariant;
  measureMode: boolean;
  isFullscreen: boolean;
  layersVisible: Record<string, boolean>;

  theme: AppTheme;
  language: AppLanguage;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  lastSavedAt: string | null;
  toastMessage: { text: string; type: 'info' | 'error' | 'success' } | null;

  validationIssues: ValidationIssue[];

  // Live simulation runtime
  simEngine: DiscreteEventSimulationEngine | null;
  simSnapshot: SimulationSnapshot;
  simAllEvents: SimEvent[];
  simWorkerBusy: boolean;

  // Export capture hooks registered by 2D/3D viewports
  capture3DPng: (() => string | null) | null;
  get2DSvgElement: (() => SVGSVGElement | null) | null;

  // Lifecycle & persistence
  bootstrap: () => Promise<void>;
  setToast: (text: string, type?: 'info' | 'error' | 'success') => void;
  clearToast: () => void;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (lang: AppLanguage) => void;
  setActiveModule: (mod: WorkspaceModuleId) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  setVisualVariant: (variant: VisualVariant) => void;
  setMeasureMode: (on: boolean) => void;
  toggleFullscreen: () => void;
  setFullscreen: (on: boolean) => void;
  toggleLayerVisibility: (layer: string) => void;

  // Selection & clipboard
  selectItem: (kind: SelectionState['kind'], id: string | null, additive?: boolean) => void;
  clearSelection: () => void;
  copySelectedObjects: () => void;
  pasteClipboardObjects: () => void;
  deleteSelectedObjects: () => void;

  // Project CRUD
  saveCurrentProject: () => Promise<void>;
  createNewProject: (name: string, factoryName: string, industry: string, lengthM?: number, widthM?: number, heightM?: number) => Promise<void>;
  openProjectById: (id: string) => Promise<void>;
  duplicateProjectById: (id: string) => Promise<void>;
  renameCurrentProject: (name: string, factoryName: string, industry: string, description: string) => void;
  renameProjectById: (id: string, name: string, factoryName: string) => Promise<void>;
  deleteProjectById: (id: string) => Promise<void>;
  importProjectJson: (rawText: string) => Promise<boolean>;

  // Mutators with undo history
  commitProjectEdit: (updater: (draft: ProjectData) => void, skipHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;
  updateFactory: (partial: Partial<FactorySpec>) => void;
  addZone: (zone: FactoryZone) => void;
  updateZone: (id: string, partial: Partial<FactoryZone>) => void;
  deleteZone: (id: string) => void;
  addLayoutObject: (obj: LayoutObject) => void;
  updateLayoutObject: (id: string, partial: Partial<LayoutObject>, skipHistory?: boolean) => void;
  deleteLayoutObject: (id: string) => void;
  addProduct: (product: ProductDefinition) => void;
  updateProduct: (id: string, partial: Partial<ProductDefinition>) => void;
  deleteProduct: (id: string) => void;
  setActiveProduct: (id: string) => void;
  quickAddProductAndRun: (product: ProductDefinition, startLive?: boolean) => void;
  autoWireForSimulation: (silent?: boolean) => void;
  importFlowchartRoute: (silent?: boolean) => void;
  autoFixIssues: () => void;
  addStage: (stage: ProductionStage) => void;
  updateStage: (id: string, partial: Partial<ProductionStage>) => void;
  deleteStage: (id: string) => void;
  addWorker: (worker: WorkerDefinition) => void;
  updateWorker: (id: string, partial: Partial<WorkerDefinition>, skipHistory?: boolean) => void;
  deleteWorker: (id: string) => void;
  updateSimConfig: (partial: Partial<SimulationConfig>) => void;

  // Equipment library
  saveCustomEquipment: (tpl: EquipmentTemplate) => Promise<void>;
  deleteCustomEquipment: (id: string) => Promise<void>;

  // Simulation controls
  startSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  stopSimulation: () => void;
  resetSimulation: () => void;
  stepSimulationEvent: () => void;
  tickSimulation: (realDeltaSec: number) => void;
  runFullShiftSimulation: () => Promise<SimulationResult | null>;

  // Scenarios
  addScenario: (scen: ScenarioRecord) => void;
  updateScenario: (scenId: string, partial: Partial<ScenarioRecord>) => void;
  updateScenarioResult: (scenId: string, result: SimulationResult) => void;
  deleteScenario: (scenId: string) => void;

  // Viewport capture hooks
  register3DCapture: (fn: (() => string | null) | null) => void;
  register2DSvgGetter: (fn: (() => SVGSVGElement | null) | null) => void;
}

const initialProject = createDesertAirCoolerProject();
let autosaveTimer: number | null = null;

function makeEmptySnapshot(): SimulationSnapshot {
  return {
    status: 'idle',
    clockSec: 0,
    shiftActive: false,
    onBreak: false,
    objects: {},
    workers: {},
    products: [],
    recentEvents: [],
    totalEventsExecuted: 0,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  project: initialProject,
  projectsList: [initialProject],
  customEquipment: [],
  undoStack: [],
  redoStack: [],
  clipboard: [],
  selection: { ids: [], kind: null },

  activeModule: 'layout',
  viewportMode: 'split',
  cameraPreset: 'perspective',
  visualVariant: 'realistic',
  measureMode: false,
  isFullscreen: false,
  layersVisible: {
    zones: true,
    columns: true,
    conveyors: true,
    equipment: true,
    buffers: true,
    storage: true,
    vehicles: true,
    workers: true,
    dimensions: true,
    flowArrows: true,
  },

  theme: 'light',
  language: 'en',
  saveStatus: 'saved',
  lastSavedAt: null,
  toastMessage: null,

  validationIssues: validateProject(initialProject),

  simEngine: null,
  simSnapshot: makeEmptySnapshot(),
  simAllEvents: [],
  simWorkerBusy: false,

  capture3DPng: null,
  get2DSvgElement: null,

  bootstrap: async () => {
    try {
      const [savedProjects, customEq, lastId] = await Promise.all([
        loadAllProjectsFromDb(),
        loadCustomEquipmentFromDb(),
      getLastActiveProjectId(),
      ]);

      let activeProj: ProjectData;
      let list = savedProjects;

      if (list.length === 0) {
        activeProj = createDesertAirCoolerProject();
        await saveProjectToDb(activeProj);
        list = [activeProj];
      } else {
        activeProj = list.find((p) => p.id === lastId) || list[0];
      }

      const engine = new DiscreteEventSimulationEngine(activeProj);
      set({
        initialized: true,
        project: activeProj,
        projectsList: list,
        customEquipment: customEq,
        validationIssues: validateProject(activeProj),
        simEngine: engine,
        simSnapshot: engine.getSnapshot(),
        simAllEvents: [],
      });
    } catch {
      const fallback = createDesertAirCoolerProject();
      const engine = new DiscreteEventSimulationEngine(fallback);
      set({
        initialized: true,
        project: fallback,
        projectsList: [fallback],
        validationIssues: validateProject(fallback),
        simEngine: engine,
        simSnapshot: engine.getSnapshot(),
      });
    }
  },

  setToast: (text, type = 'info') => {
    set({ toastMessage: { text, type } });
    window.setTimeout(() => {
      if (get().toastMessage?.text === text) {
        set({ toastMessage: null });
      }
    }, 3600);
  },

  clearToast: () => set({ toastMessage: null }),

  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },

  setLanguage: (language) => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    set({ language });
  },

  setActiveModule: (activeModule) => set({ activeModule }),
  setViewportMode: (viewportMode) => set({ viewportMode }),
  setCameraPreset: (cameraPreset) => set({ cameraPreset }),
  setVisualVariant: (visualVariant) => set({ visualVariant }),
  setMeasureMode: (measureMode) => set({ measureMode }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
  toggleLayerVisibility: (layer) =>
    set((s) => ({
      layersVisible: { ...s.layersVisible, [layer]: !s.layersVisible[layer] },
    })),

  selectItem: (kind, id, additive = false) => {
    if (!id || !kind) {
      set({ selection: { ids: [], kind: null } });
      return;
    }
    set((s) => {
      if (additive && s.selection.kind === kind) {
        const exists = s.selection.ids.includes(id);
        const ids = exists ? s.selection.ids.filter((x) => x !== id) : [...s.selection.ids, id];
        return { selection: { kind: ids.length > 0 ? kind : null, ids } };
      }
      return { selection: { kind, ids: [id] } };
    });
  },

  clearSelection: () => set({ selection: { ids: [], kind: null } }),

  copySelectedObjects: () => {
    const { selection, project, setToast } = get();
    if (selection.kind !== 'object' || selection.ids.length === 0) return;
    const copied = project.layoutObjects.filter((o) => selection.ids.includes(o.id));
    set({ clipboard: structuredClone(copied) });
    setToast(`Copied ${copied.length} object(s)`, 'info');
  },

  pasteClipboardObjects: () => {
    const { clipboard, commitProjectEdit, setToast } = get();
    if (clipboard.length === 0) return;
    const newIds: string[] = [];
    commitProjectEdit((draft) => {
      for (const item of clipboard) {
        const clone = structuredClone(item);
        clone.id = uid('obj');
        clone.name = `${item.name} (Copy)`;
        clone.geometry.position.x = Math.min(draft.factory.lengthM - 1, clone.geometry.position.x + 1.0);
        clone.geometry.position.z = Math.min(draft.factory.widthM - 1, clone.geometry.position.z + 1.0);
        clone.connectedToIds = [];
        clone.stageId = undefined;
        draft.layoutObjects.push(clone);
        newIds.push(clone.id);
      }
    });
    set({ selection: { kind: 'object', ids: newIds } });
    setToast(`Pasted ${newIds.length} object(s)`, 'success');
  },

  deleteSelectedObjects: () => {
    const { selection, commitProjectEdit, clearSelection } = get();
    if (selection.ids.length === 0) return;
    if (selection.kind === 'object') {
      commitProjectEdit((draft) => {
        draft.layoutObjects = draft.layoutObjects.filter(
          (o) => !selection.ids.includes(o.id) || o.rendering.locked
        );
        for (const st of draft.stages) {
          st.assignedObjectIds = st.assignedObjectIds.filter((id) => !selection.ids.includes(id));
        }
        draft.stages = draft.stages.filter((st) => st.assignedObjectIds.length > 0);
        syncProductRoutes(draft);
      });
      clearSelection();
    } else if (selection.kind === 'worker') {
      commitProjectEdit((draft) => {
        draft.workers = draft.workers.filter((w) => !selection.ids.includes(w.id));
      });
      clearSelection();
    } else if (selection.kind === 'zone') {
      commitProjectEdit((draft) => {
        draft.factory.zones = draft.factory.zones.filter((z) => !selection.ids.includes(z.id));
      });
      clearSelection();
    }
  },

  saveCurrentProject: async () => {
    const { project, projectsList } = get();
    set({ saveStatus: 'saving' });
    const updated = { ...project, updatedAt: new Date().toISOString() };
    await saveProjectToDb(updated);
    const nextList = [updated, ...projectsList.filter((p) => p.id !== updated.id)];
    set({
      project: updated,
      projectsList: nextList,
      saveStatus: 'saved',
      lastSavedAt: updated.updatedAt,
    });
  },

  createNewProject: async (name, factoryName, industry, lengthM = 30, widthM = 20, heightM = 5) => {
    const now = new Date().toISOString();
    const newProj: ProjectData = {
      schemaVersion: '1.0.0',
      id: uid('proj'),
      name: name.trim() || 'Untitled Factory Project',
      factoryName: factoryName.trim() || 'New Manufacturing Plant',
      industryType: industry.trim() || 'Discrete Manufacturing',
      description: 'New digital factory workspace.',
      createdAt: now,
      updatedAt: now,
      factory: {
        name: factoryName.trim() || 'Main Production Hall',
        lengthM: Math.max(5, lengthM),
        widthM: Math.max(5, widthM),
        heightM: Math.max(3, heightM),
        unit: 'm',
        gridSizeM: 0.5,
        snapToGrid: true,
        columns: [],
        openings: [
          {
            id: uid('open'),
            label: 'Main Entrance',
            type: 'main_entrance',
            wall: 'south',
            offsetM: Math.max(2, lengthM / 2 - 1.2),
            widthM: 2.4,
            heightM: 2.6,
            sillHeightM: 0,
          },
        ],
        zones: [],
      },
      productionLines: [],
      layoutObjects: [],
      products: [
        {
          id: uid('prod'),
          code: 'PRD-100',
          name: 'Standard Assembly Unit',
          category: 'Manufactured Goods',
          dimensions: { length: 0.6, width: 0.5, height: 0.5 },
          weightKg: 12,
          color: '#CBD5E1',
          targetQuantity: 300,
          routeStageIds: [],
          modelShape: 'box',
        },
      ],
      stages: [],
      routes: [],
      workers: [],
      simulationConfig: {
        durationSec: 28800,
        arrivalIntervalSec: 40,
        maxPlannedUnits: 300,
        speedMultiplier: 30,
        enableBreakdowns: false,
        randomSeed: 4219,
        shifts: [
          {
            id: 'shift_1',
            name: 'Day Shift (8h)',
            startSec: 0,
            durationSec: 28800,
            breaks: [{ id: 'brk_1', name: 'Mid-Shift Break', startSec: 14400, durationSec: 1800 }],
          },
        ],
      },
      scenarios: [],
    };
    await saveProjectToDb(newProj);
    const engine = new DiscreteEventSimulationEngine(newProj);
    set((s) => ({
      project: newProj,
      projectsList: [newProj, ...s.projectsList],
      undoStack: [],
      redoStack: [],
      selection: { ids: [], kind: null },
      validationIssues: validateProject(newProj),
      simEngine: engine,
      simSnapshot: engine.getSnapshot(),
      simAllEvents: [],
      saveStatus: 'saved',
    }));
  },

  openProjectById: async (id) => {
    const target = get().projectsList.find((p) => p.id === id);
    if (!target) return;
    await saveProjectToDb(target);
    const engine = new DiscreteEventSimulationEngine(target);
    set({
      project: structuredClone(target),
      undoStack: [],
      redoStack: [],
      selection: { ids: [], kind: null },
      validationIssues: validateProject(target),
      simEngine: engine,
      simSnapshot: engine.getSnapshot(),
      simAllEvents: [],
    });
  },

  duplicateProjectById: async (id) => {
    const src = get().projectsList.find((p) => p.id === id);
    if (!src) return;
    const now = new Date().toISOString();
    const copy: ProjectData = {
      ...structuredClone(src),
      id: uid('proj'),
      name: `${src.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    await saveProjectToDb(copy);
    set((s) => ({ projectsList: [copy, ...s.projectsList] }));
    get().setToast(`Duplicated "${src.name}"`, 'success');
  },

  renameCurrentProject: (name, factoryName, industryType, description) => {
    get().commitProjectEdit((draft) => {
      draft.name = name;
      draft.factoryName = factoryName;
      draft.industryType = industryType;
      draft.description = description;
    });
  },

  renameProjectById: async (id, name, factoryName) => {
    const trimmedName = name.trim();
    const trimmedFactory = factoryName.trim();
    if (!trimmedName) return;
    if (get().project.id === id) {
      get().commitProjectEdit((draft) => {
        draft.name = trimmedName;
        if (trimmedFactory) draft.factoryName = trimmedFactory;
      });
      await get().saveCurrentProject();
      return;
    }
    const target = get().projectsList.find((p) => p.id === id);
    if (!target) return;
    const updated: ProjectData = {
      ...structuredClone(target),
      name: trimmedName,
      factoryName: trimmedFactory || target.factoryName,
      updatedAt: new Date().toISOString(),
    };
    await saveProjectToDb(updated);
    set((s) => ({
      projectsList: s.projectsList.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deleteProjectById: async (id) => {
    const { projectsList, project } = get();
    if (projectsList.length <= 1) {
      get().setToast('Cannot delete the only project in workspace.', 'error');
      return;
    }
    await deleteProjectFromDb(id);
    const remaining = projectsList.filter((p) => p.id !== id);
    if (project.id === id) {
      const nextProj = remaining[0];
      const engine = new DiscreteEventSimulationEngine(nextProj);
      set({
        project: nextProj,
        projectsList: remaining,
        validationIssues: validateProject(nextProj),
        simEngine: engine,
        simSnapshot: engine.getSnapshot(),
      });
    } else {
      set({ projectsList: remaining });
    }
  },

  importProjectJson: async (rawText) => {
    try {
      const parsed = JSON.parse(rawText);
      const migrated = migrateProjectSchema(parsed);
      migrated.id = uid('proj');
      migrated.updatedAt = new Date().toISOString();
      await saveProjectToDb(migrated);
      const engine = new DiscreteEventSimulationEngine(migrated);
      set((s) => ({
        project: migrated,
        projectsList: [migrated, ...s.projectsList],
        undoStack: [],
        redoStack: [],
        selection: { ids: [], kind: null },
        validationIssues: validateProject(migrated),
        simEngine: engine,
        simSnapshot: engine.getSnapshot(),
      }));
      get().setToast(`Imported project "${migrated.name}"`, 'success');
      return true;
    } catch (err) {
      get().setToast(err instanceof Error ? err.message : 'Invalid project JSON file', 'error');
      return false;
    }
  },

  commitProjectEdit: (updater, skipHistory = false) => {
    const prev = get().project;
    const next = structuredClone(prev);
    updater(next);
    next.updatedAt = new Date().toISOString();

    const issues = validateProject(next);
    const shouldRefreshIdleEngine = get().simSnapshot.status === 'idle' || get().simSnapshot.clockSec === 0;
    const nextEngine = shouldRefreshIdleEngine ? new DiscreteEventSimulationEngine(next) : null;

    set((s) => ({
      project: next,
      undoStack: skipHistory ? s.undoStack : [...s.undoStack.slice(-39), prev],
      redoStack: skipHistory ? s.redoStack : [],
      validationIssues: issues,
      saveStatus: 'unsaved',
      ...(nextEngine
        ? {
            simEngine: nextEngine,
            simSnapshot: nextEngine.getSnapshot(),
            simAllEvents: [],
          }
        : {}),
    }));

    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      get().saveCurrentProject();
    }, 900);
  },

  undo: () => {
    const { undoStack, project, redoStack, simSnapshot } = get();
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const shouldRefresh = simSnapshot.status === 'idle' || simSnapshot.clockSec === 0;
    const nextEngine = shouldRefresh ? new DiscreteEventSimulationEngine(previous) : null;
    set({
      project: previous,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, project],
      validationIssues: validateProject(previous),
      saveStatus: 'unsaved',
      ...(nextEngine
        ? {
            simEngine: nextEngine,
            simSnapshot: nextEngine.getSnapshot(),
            simAllEvents: [],
          }
        : {}),
    });
  },

  redo: () => {
    const { redoStack, project, undoStack, simSnapshot } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const shouldRefresh = simSnapshot.status === 'idle' || simSnapshot.clockSec === 0;
    const nextEngine = shouldRefresh ? new DiscreteEventSimulationEngine(next) : null;
    set({
      project: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, project],
      validationIssues: validateProject(next),
      saveStatus: 'unsaved',
      ...(nextEngine
        ? {
            simEngine: nextEngine,
            simSnapshot: nextEngine.getSnapshot(),
            simAllEvents: [],
          }
        : {}),
    });
  },

  updateFactory: (partial) =>
    get().commitProjectEdit((draft) => {
      Object.assign(draft.factory, partial);
    }),

  addZone: (zone) =>
    get().commitProjectEdit((draft) => {
      draft.factory.zones.push(zone);
    }),

  updateZone: (id, partial) =>
    get().commitProjectEdit((draft) => {
      const z = draft.factory.zones.find((item) => item.id === id);
      if (z) Object.assign(z, partial);
    }),

  deleteZone: (id) =>
    get().commitProjectEdit((draft) => {
      draft.factory.zones = draft.factory.zones.filter((z) => z.id !== id);
    }),

  addLayoutObject: (obj) =>
    get().commitProjectEdit((draft) => {
      draft.layoutObjects.push(obj);
      if (
        obj.kind === 'conveyor' ||
        obj.kind === 'workstation' ||
        obj.kind === 'machine' ||
        obj.kind === 'buffer'
      ) {
        const { updated } = autoWireProjectForSimulation(draft);
        Object.assign(draft, updated);
      }
    }),

  updateLayoutObject: (id, partial, skipHistory = false) =>
    get().commitProjectEdit((draft) => {
      const obj = draft.layoutObjects.find((o) => o.id === id);
      if (!obj) return;
      const prevDir = obj.operations.direction;
      if (partial.geometry) obj.geometry = { ...obj.geometry, ...partial.geometry };
      if (partial.operations) obj.operations = { ...obj.operations, ...partial.operations };
      if (partial.rendering) obj.rendering = { ...obj.rendering, ...partial.rendering };
      const { geometry: _g, operations: _o, rendering: _r, ...rest } = partial;
      Object.assign(obj, rest);

      // Propagate floor equipment operational parameters bidirectionally to linked stage(s)
      if (partial.operations && obj.kind !== 'conveyor') {
        for (const st of draft.stages) {
          if (st.assignedObjectIds.includes(obj.id) || obj.stageId === st.id) {
            if (partial.operations.processingTimeSec !== undefined) {
              st.processingTimeSec = partial.operations.processingTimeSec;
            }
            if (partial.operations.setupTimeSec !== undefined) {
              st.setupTimeSec = partial.operations.setupTimeSec;
            }
            if (partial.operations.loadingTimeSec !== undefined) {
              st.loadingTimeSec = partial.operations.loadingTimeSec;
            }
            if (partial.operations.unloadingTimeSec !== undefined) {
              st.unloadingTimeSec = partial.operations.unloadingTimeSec;
            }
            if (partial.operations.requiredOperators !== undefined) {
              st.requiredWorkers = partial.operations.requiredOperators;
            }
          }
        }
      }

      if (obj.kind === 'conveyor' && partial.operations?.direction !== undefined && partial.operations.direction !== prevDir) {
        const isManual = draft.products.some((p) => p.routingMode === 'manual');
        if (isManual) {
          syncStagePredecessorsAndObjectLinks(draft);
        } else {
          const { updated } = autoWireProjectForSimulation(draft);
          Object.assign(draft, updated);
        }
      }
    }, skipHistory),

  deleteLayoutObject: (id) =>
    get().commitProjectEdit((draft) => {
      draft.layoutObjects = draft.layoutObjects.filter((o) => o.id !== id);
      for (const st of draft.stages) {
        st.assignedObjectIds = st.assignedObjectIds.filter((oid) => oid !== id);
      }
      draft.stages = draft.stages.filter((st) => st.assignedObjectIds.length > 0);
      syncProductRoutes(draft);
    }),

  addProduct: (product) =>
    get().commitProjectEdit((draft) => {
      const next = structuredClone(product);
      if (next.routeStageIds.length === 0 && draft.stages.length > 0) {
        next.routeStageIds = draft.stages.map((s) => s.id);
      }
      draft.products.unshift(next);
      syncProductRoutes(draft);
      draft.simulationConfig.maxPlannedUnits = Math.max(1, next.targetQuantity || 300);
    }),

  updateProduct: (id, partial) =>
    get().commitProjectEdit((draft) => {
      const p = draft.products.find((item) => item.id === id);
      if (p) {
        Object.assign(p, partial);
        if (partial.routeStageIds !== undefined || partial.entryStageIds !== undefined || partial.routingMode !== undefined) {
          syncProductRoutes(draft);
        }
      }
    }),

  deleteProduct: (id) =>
    get().commitProjectEdit((draft) => {
      draft.products = draft.products.filter((p) => p.id !== id);
    }),

  setActiveProduct: (id) => {
    const { commitProjectEdit, setToast, language } = get();
    commitProjectEdit((draft) => {
      const idx = draft.products.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const [picked] = draft.products.splice(idx, 1);
        if (picked.routeStageIds.length === 0 && draft.stages.length > 0) {
          picked.routeStageIds = draft.stages.map((s) => s.id);
        }
        draft.products.unshift(picked);
        draft.simulationConfig.maxPlannedUnits = Math.max(1, picked.targetQuantity || 300);
      }
    });
    const active = get().project.products[0];
    if (active) {
      setToast(
        language === 'ar'
          ? `تم تفعيل المنتج "${active.name}" على خط الإنتاج`
          : `Activated "${active.name}" as active line product`,
        'success'
      );
    }
  },

  quickAddProductAndRun: (product, startLive = true) => {
    const { commitProjectEdit, startSimulation, language, setToast } = get();
    commitProjectEdit((draft) => {
      const next = structuredClone(product);
      draft.products.unshift(next);
      const wired = autoWireProjectForSimulation(draft).updated;
      wired.products[0].routeStageIds = wired.stages.map((s) => s.id);
      wired.simulationConfig.maxPlannedUnits = Math.max(1, wired.products[0].targetQuantity || 300);
      Object.assign(draft, wired);
    });
    setToast(
      language === 'ar'
        ? `تم إضافة المنتج "${product.name}" وربطه بجميع المراحل`
        : `Added "${product.name}" and assigned it to all line stages`,
      'success'
    );
    if (startLive) {
      startSimulation();
    }
  },

  autoWireForSimulation: (silent = false) => {
    const { project, commitProjectEdit, setToast, language } = get();
    const res = autoWireProjectForSimulation(project, true);
    commitProjectEdit((draft) => {
      Object.assign(draft, res.updated);
    });
    if (!silent) {
      setToast(
        language === 'ar'
          ? `تم ربط الخط والمراحل (${res.updated.stages.length} مرحلة، ${res.updated.workers.length} عامل) وجاهز للمحاكاة`
          : `Auto-wired ${res.updated.stages.length} stage(s) and ${res.updated.workers.length} worker(s) for simulation`,
        'success'
      );
    }
  },

  importFlowchartRoute: (silent = false) => {
    const { project, commitProjectEdit, setToast, language } = get();
    const res = importFlowchartToSimulationData(project);
    commitProjectEdit((draft) => {
      Object.assign(draft, res.updated);
    });
    const engine = new DiscreteEventSimulationEngine(res.updated);
    engine.importFlowchartRoutes(res.updated);
    set({
      simEngine: engine,
      simSnapshot: engine.getSnapshot(),
      simAllEvents: [],
    });
    if (!silent) {
      setToast(
        language === 'ar'
          ? `تم استيراد مسار الفلوتشارت وربط ${res.boundNodes} عقدة بمعدات المصنع (${res.repairedNodes} تم إصلاحها)`
          : `Imported Flowchart routes: ${res.boundNodes} node(s) bound to floor equipment (${res.repairedNodes} repaired)`,
        'success'
      );
    }
  },

  autoFixIssues: () => {
    const { project, commitProjectEdit, setToast, language } = get();
    const fixed = autoFixProjectIssues(project);
    commitProjectEdit((draft) => {
      Object.assign(draft, fixed);
    });
    const remaining = validateProject(fixed).length;
    setToast(
      language === 'ar'
        ? remaining === 0
          ? 'تم إصلاح جميع التنبيهات الهندسية بنجاح'
          : `تم التنظيم، متبقي ${remaining} تنبيه`
        : remaining === 0
        ? 'All engineering validation alerts resolved'
        : `Cleaned up layout (${remaining} alert(s) remaining)`,
      remaining === 0 ? 'success' : 'info'
    );
  },

  addStage: (stage) =>
    get().commitProjectEdit((draft) => {
      draft.stages.push(stage);
      const active = draft.products[0];
      if (active && active.routingMode !== 'manual' && !active.routeStageIds.includes(stage.id)) {
        active.routeStageIds.push(stage.id);
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    }),

  updateStage: (id, partial) =>
    get().commitProjectEdit((draft) => {
      const s = draft.stages.find((item) => item.id === id);
      if (!s) return;
      Object.assign(s, partial);
      // Synchronize operational parameters bidirectionally onto assigned floor objects
      for (const oid of s.assignedObjectIds) {
        const obj = draft.layoutObjects.find((o) => o.id === oid);
        if (!obj || obj.kind === 'conveyor') continue;
        if (partial.processingTimeSec !== undefined) obj.operations.processingTimeSec = partial.processingTimeSec;
        if (partial.setupTimeSec !== undefined) obj.operations.setupTimeSec = partial.setupTimeSec;
        if (partial.loadingTimeSec !== undefined) obj.operations.loadingTimeSec = partial.loadingTimeSec;
        if (partial.unloadingTimeSec !== undefined) obj.operations.unloadingTimeSec = partial.unloadingTimeSec;
        if (partial.requiredWorkers !== undefined) obj.operations.requiredOperators = partial.requiredWorkers;
      }
      if (partial.successorIds !== undefined || partial.assignedObjectIds !== undefined) {
        syncStagePredecessorsAndObjectLinks(draft);
        syncProductRoutes(draft);
      }
    }),

  deleteStage: (id) =>
    get().commitProjectEdit((draft) => {
      draft.stages = draft.stages.filter((s) => s.id !== id);
      for (const s of draft.stages) {
        s.predecessorIds = s.predecessorIds.filter((x) => x !== id);
        s.successorIds = s.successorIds.filter((x) => x !== id);
      }
      for (const p of draft.products) {
        p.routeStageIds = p.routeStageIds.filter((x) => x !== id);
        if (p.entryStageIds) {
          p.entryStageIds = p.entryStageIds.filter((x) => x !== id);
        }
      }
      syncStagePredecessorsAndObjectLinks(draft);
      syncProductRoutes(draft);
    }),

  addWorker: (worker) =>
    get().commitProjectEdit((draft) => {
      draft.workers.push(worker);
    }),

  updateWorker: (id, partial, skipHistory = false) =>
    get().commitProjectEdit((draft) => {
      const w = draft.workers.find((item) => item.id === id);
      if (w) Object.assign(w, partial);
    }, skipHistory),

  deleteWorker: (id) =>
    get().commitProjectEdit((draft) => {
      draft.workers = draft.workers.filter((w) => w.id !== id);
    }),

  updateSimConfig: (partial) =>
    get().commitProjectEdit((draft) => {
      Object.assign(draft.simulationConfig, partial);
    }),

  saveCustomEquipment: async (tpl) => {
    await saveCustomEquipmentToDb(tpl);
    set((s) => ({
      customEquipment: [tpl, ...s.customEquipment.filter((e) => e.id !== tpl.id)],
    }));
    get().setToast(`Saved "${tpl.name}" to Personal Library`, 'success');
  },

  deleteCustomEquipment: async (id) => {
    await deleteCustomEquipmentFromDb(id);
    set((s) => ({
      customEquipment: s.customEquipment.filter((e) => e.id !== id),
    }));
  },

  startSimulation: () => {
    let { project, validationIssues, setToast, language, commitProjectEdit } = get();

    // Auto-wire seamlessly only when not in manual Flowchart mode
    const isManualFlow = project.products[0]?.routingMode === 'manual';
    if (isManualFlow) {
      const imported = importFlowchartToSimulationData(project).updated;
      commitProjectEdit((draft) => {
        Object.assign(draft, imported);
      });
      project = get().project;
      validationIssues = get().validationIssues;
    } else {
      const hasFloorEquip = project.layoutObjects.some(
        (o) => o.rendering.visible && (o.kind === 'conveyor' || o.kind === 'workstation' || o.kind === 'machine')
      );
      if (
        hasFloorEquip &&
        (project.stages.length === 0 ||
          project.products.length === 0 ||
          project.products[0].routeStageIds.length === 0)
      ) {
        const wired = autoWireProjectForSimulation(project).updated;
        commitProjectEdit((draft) => {
          Object.assign(draft, wired);
        });
        project = get().project;
        validationIssues = get().validationIssues;
      }
    }

    const errors = validationIssues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      const msg = language === 'ar' ? errors[0].messageAr || errors[0].message : errors[0].message;
      setToast(
        language === 'ar' ? `لا يمكن بدء المحاكاة: ${msg}` : `Cannot start simulation: ${msg}`,
        'error'
      );
      return;
    }
    const engine = new DiscreteEventSimulationEngine(project);
    engine.status = 'running';
    const snap = engine.getSnapshot();
    set({
      simEngine: engine,
      simSnapshot: { ...snap, status: 'running' },
      simAllEvents: engine.getAllEvents(),
    });
  },

  pauseSimulation: () => {
    const { simEngine } = get();
    if (!simEngine) return;
    simEngine.status = 'paused';
    set({ simSnapshot: { ...simEngine.getSnapshot(), status: 'paused' } });
  },

  resumeSimulation: () => {
    const { simEngine } = get();
    if (!simEngine) return;
    if (simEngine.status === 'completed') return;
    simEngine.status = 'running';
    set({ simSnapshot: { ...simEngine.getSnapshot(), status: 'running' } });
  },

  stopSimulation: () => {
    const { simEngine } = get();
    if (!simEngine) return;
    simEngine.status = 'completed';
    const result = simEngine.buildResult();
    const snap = simEngine.getSnapshot();
    set((s) => ({
      simSnapshot: { ...snap, status: 'completed', result },
      simAllEvents: simEngine.getAllEvents(),
      project: { ...s.project, lastSimulationResult: result },
    }));
  },

  resetSimulation: () => {
    const { project } = get();
    const engine = new DiscreteEventSimulationEngine(project);
    set({
      simEngine: engine,
      simSnapshot: engine.getSnapshot(),
      simAllEvents: [],
    });
  },

  stepSimulationEvent: () => {
    let { simEngine, project } = get();
    if (!simEngine) {
      simEngine = new DiscreteEventSimulationEngine(project);
    }
    const stepped = simEngine.stepNextEvent();
    simEngine.status = stepped ? 'paused' : 'completed';
    const snap = simEngine.getSnapshot();
    set({
      simEngine,
      simSnapshot: { ...snap, status: simEngine.status },
      simAllEvents: simEngine.getAllEvents(),
    });
  },

  tickSimulation: (realDeltaSec) => {
    const { simEngine, project } = get();
    if (!simEngine || simEngine.status !== 'running') return;
    const speed = Math.max(1, project.simulationConfig.speedMultiplier || 30);
    const targetSec = simEngine.clockSec + realDeltaSec * speed;
    simEngine.advanceTo(targetSec);
    const snap = simEngine.getSnapshot();
    if (snap.status === 'completed') {
      const result = simEngine.buildResult();
      set((s) => ({
        simSnapshot: { ...snap, result },
        simAllEvents: simEngine.getAllEvents(),
        project: { ...s.project, lastSimulationResult: result },
      }));
      saveProjectToDb({ ...get().project, lastSimulationResult: result });
    } else {
      set({
        simSnapshot: snap,
        simAllEvents: simEngine.getAllEvents(),
      });
    }
  },

  runFullShiftSimulation: async () => {
    let { project, validationIssues, setToast, language, commitProjectEdit } = get();

    const isManualFlow = project.products[0]?.routingMode === 'manual';
    if (isManualFlow) {
      const imported = importFlowchartToSimulationData(project).updated;
      commitProjectEdit((draft) => {
        Object.assign(draft, imported);
      });
      project = get().project;
      validationIssues = get().validationIssues;
    } else {
      const hasFloorEquip = project.layoutObjects.some(
        (o) => o.rendering.visible && (o.kind === 'conveyor' || o.kind === 'workstation' || o.kind === 'machine')
      );
      if (
        hasFloorEquip &&
        (project.stages.length === 0 ||
          project.products.length === 0 ||
          project.products[0].routeStageIds.length === 0)
      ) {
        const wired = autoWireProjectForSimulation(project).updated;
        commitProjectEdit((draft) => {
          Object.assign(draft, wired);
        });
        project = get().project;
        validationIssues = get().validationIssues;
      }
    }

    const errors = validationIssues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      const msg = language === 'ar' ? errors[0].messageAr || errors[0].message : errors[0].message;
      setToast(
        language === 'ar' ? `خطأ في التحقق: ${msg}` : `Validation error: ${msg}`,
        'error'
      );
      return null;
    }
    set({ simWorkerBusy: true });
    try {
      const result = await runSimulationInWorker(project);
      // Also run local engine to completion so live state/events mirror the full shift
      const engine = new DiscreteEventSimulationEngine(project);
      engine.runToCompletion();
      const snap = engine.getSnapshot();
      set((s) => ({
        simWorkerBusy: false,
        simEngine: engine,
        simSnapshot: { ...snap, status: 'completed', result },
        simAllEvents: engine.getAllEvents(),
        project: { ...s.project, lastSimulationResult: result },
      }));
      await saveProjectToDb(get().project);
      setToast(
        language === 'ar'
          ? `اكتملت محاكاة الوردية: ${result.kpis.goodUnits} وحدة سليمة (${result.kpis.productionAttainmentPct.toFixed(1)}% تحقق)`
          : `Shift simulation complete: ${result.kpis.goodUnits} good units (${result.kpis.productionAttainmentPct.toFixed(1)}% attainment)`,
        'success'
      );
      return result;
    } catch (err) {
      set({ simWorkerBusy: false });
      setToast(err instanceof Error ? err.message : 'Simulation failed', 'error');
      return null;
    }
  },

  addScenario: (scen) =>
    get().commitProjectEdit((draft) => {
      draft.scenarios.push(scen);
    }),

  updateScenario: (scenId, partial) =>
    get().commitProjectEdit((draft) => {
      const sc = draft.scenarios.find((s) => s.id === scenId);
      if (sc) Object.assign(sc, partial);
    }),

  updateScenarioResult: (scenId, result) =>
    get().commitProjectEdit((draft) => {
      const sc = draft.scenarios.find((s) => s.id === scenId);
      if (sc) sc.result = result;
    }, true),

  deleteScenario: (scenId) =>
    get().commitProjectEdit((draft) => {
      draft.scenarios = draft.scenarios.filter((s) => s.id !== scenId);
    }),

  register3DCapture: (fn) => set({ capture3DPng: fn }),
  register2DSvgGetter: (fn) => set({ get2DSvgElement: fn }),
}));

export function getAllEquipmentTemplates(custom: EquipmentTemplate[]): EquipmentTemplate[] {
  return [...custom, ...BUILTIN_EQUIPMENT_TEMPLATES];
}
