import { EquipmentTemplate, ProjectData } from '../types/project';

const DB_NAME = 'mk_linesim_db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_EQUIPMENT = 'custom_equipment';
const STORE_META = 'app_meta';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_EQUIPMENT)) {
        db.createObjectStore(STORE_EQUIPMENT, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open request was blocked'));
  });
}

function closeDbQuietly(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Ignore close errors if connection already closed
  }
}

export async function saveProjectToDb(project: ProjectData): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
    tx.objectStore(STORE_PROJECTS).put({
      ...project,
      updatedAt: new Date().toISOString(),
    });
    tx.objectStore(STORE_META).put({ key: 'lastActiveProjectId', value: project.id });
    tx.oncomplete = () => {
      closeDbQuietly(db);
      resolve();
    };
    tx.onerror = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('Failed to save project to IndexedDB'));
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('IndexedDB save transaction aborted'));
    };
  });
}

export async function loadAllProjectsFromDb(): Promise<ProjectData[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    let settled = false;
    req.onsuccess = () => {
      settled = true;
      const raw = (req.result || []) as unknown[];
      const migrated = raw
        .map((item) => {
          try {
            return migrateProjectSchema(item);
          } catch {
            return null;
          }
        })
        .filter((p): p is ProjectData => p !== null);
      migrated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      closeDbQuietly(db);
      resolve(migrated);
    };
    req.onerror = () => {
      settled = true;
      closeDbQuietly(db);
      reject(req.error ?? new Error('Failed to load projects from IndexedDB'));
    };
    tx.oncomplete = () => {
      closeDbQuietly(db);
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      if (!settled) reject(tx.error ?? new Error('IndexedDB load transaction aborted'));
    };
  });
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(projectId);
    tx.oncomplete = () => {
      closeDbQuietly(db);
      resolve();
    };
    tx.onerror = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('Failed to delete project from IndexedDB'));
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('IndexedDB delete transaction aborted'));
    };
  });
}

export async function getLastActiveProjectId(): Promise<string | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get('lastActiveProjectId');
    let settled = false;
    req.onsuccess = () => {
      settled = true;
      const val = req.result?.value ?? null;
      closeDbQuietly(db);
      resolve(val);
    };
    req.onerror = () => {
      settled = true;
      closeDbQuietly(db);
      reject(req.error ?? new Error('Failed to read active project metadata'));
    };
    tx.oncomplete = () => {
      closeDbQuietly(db);
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      if (!settled) reject(tx.error ?? new Error('IndexedDB metadata read aborted'));
    };
  });
}

export async function saveCustomEquipmentToDb(tpl: EquipmentTemplate): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readwrite');
    tx.objectStore(STORE_EQUIPMENT).put({ ...tpl, isCustom: true });
    tx.oncomplete = () => {
      closeDbQuietly(db);
      resolve();
    };
    tx.onerror = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('Failed to save custom equipment'));
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('IndexedDB equipment save aborted'));
    };
  });
}

export async function loadCustomEquipmentFromDb(): Promise<EquipmentTemplate[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readonly');
    const req = tx.objectStore(STORE_EQUIPMENT).getAll();
    let settled = false;
    req.onsuccess = () => {
      settled = true;
      const res = (req.result || []) as EquipmentTemplate[];
      closeDbQuietly(db);
      resolve(res);
    };
    req.onerror = () => {
      settled = true;
      closeDbQuietly(db);
      reject(req.error ?? new Error('Failed to load custom equipment'));
    };
    tx.oncomplete = () => {
      closeDbQuietly(db);
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      if (!settled) reject(tx.error ?? new Error('IndexedDB equipment load aborted'));
    };
  });
}

export async function deleteCustomEquipmentFromDb(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readwrite');
    tx.objectStore(STORE_EQUIPMENT).delete(id);
    tx.oncomplete = () => {
      closeDbQuietly(db);
      resolve();
    };
    tx.onerror = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('Failed to delete custom equipment'));
    };
    tx.onabort = () => {
      closeDbQuietly(db);
      reject(tx.error ?? new Error('IndexedDB equipment delete aborted'));
    };
  });
}

export function migrateProjectSchema(raw: unknown): ProjectData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid project JSON: expected an object.');
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.id || !obj.name || !obj.factory) {
    throw new Error('Missing required project fields (id, name, or factory).');
  }

  const factory = obj.factory as Record<string, unknown>;
  if (
    typeof factory.lengthM !== 'number' ||
    !Number.isFinite(factory.lengthM) ||
    factory.lengthM <= 0 ||
    typeof factory.widthM !== 'number' ||
    !Number.isFinite(factory.widthM) ||
    factory.widthM <= 0 ||
    typeof factory.heightM !== 'number' ||
    !Number.isFinite(factory.heightM) ||
    factory.heightM <= 0
  ) {
    throw new Error('Invalid factory dimensions.');
  }

  return {
    schemaVersion: String(obj.schemaVersion || '1.0.0'),
    id: String(obj.id),
    name: String(obj.name),
    factoryName: String(obj.factoryName || obj.name),
    industryType: String(obj.industryType || 'General Manufacturing'),
    description: String(obj.description || ''),
    createdAt: String(obj.createdAt || new Date().toISOString()),
    updatedAt: String(obj.updatedAt || new Date().toISOString()),
    factory: {
      name: String(factory.name || 'Main Hall'),
      lengthM: Number(factory.lengthM),
      widthM: Number(factory.widthM),
      heightM: Number(factory.heightM),
      unit: (factory.unit as 'm' | 'cm' | 'mm') || 'm',
      gridSizeM: Number(factory.gridSizeM || 0.5),
      snapToGrid: Boolean(factory.snapToGrid ?? true),
      columns: Array.isArray(factory.columns) ? factory.columns : [],
      openings: Array.isArray(factory.openings) ? factory.openings : [],
      zones: Array.isArray(factory.zones) ? factory.zones : [],
    },
    productionLines: Array.isArray(obj.productionLines) ? obj.productionLines : [],
    layoutObjects: Array.isArray(obj.layoutObjects)
      ? obj.layoutObjects.map((lo) => {
          const rec = lo as Record<string, unknown>;
          const ops = (rec.operations as Record<string, unknown>) || {};
          const breakPolicy =
            ops.breakPolicy === 'stop_immediately' ||
            ops.breakPolicy === 'finish_current_cycle' ||
            ops.breakPolicy === 'continue_during_break'
              ? ops.breakPolicy
              : ops.runDuringBreaks
              ? 'continue_during_break'
              : undefined;
          return {
            ...rec,
            operations: {
              ...ops,
              ...(breakPolicy ? { breakPolicy } : {}),
            },
          };
        }) as ProjectData['layoutObjects']
      : [],
    products: Array.isArray(obj.products)
      ? obj.products.map((p) => {
          const rec = p as Record<string, unknown>;
          return {
            ...rec,
            priority: rec.priority !== undefined ? Number(rec.priority) : 1,
            mixWeight: rec.mixWeight !== undefined ? Number(rec.mixWeight) : 1,
            cycleTimeMultiplier:
              rec.cycleTimeMultiplier !== undefined ? Number(rec.cycleTimeMultiplier) : 1,
          };
        }) as ProjectData['products']
      : [],
    stages: Array.isArray(obj.stages)
      ? obj.stages.map((st) => {
          const rec = st as Record<string, unknown>;
          return {
            ...rec,
            defectModel: rec.defectModel === 'batch' ? 'batch' : 'unit',
          };
        }) as ProjectData['stages']
      : [],
    routes: Array.isArray(obj.routes) ? obj.routes : [],
    workers: Array.isArray(obj.workers)
      ? obj.workers.map((w) => {
          const rec = w as Record<string, unknown>;
          const rot = Number(rec.rotation ?? rec.rotationDeg ?? 0);
          const targetId =
            typeof rec.assignedTo === 'string' && rec.assignedTo
              ? rec.assignedTo
              : typeof rec.assignedStationId === 'string' && rec.assignedStationId
              ? rec.assignedStationId
              : undefined;
          const validSides = new Set(['north', 'south', 'east', 'west', 'custom']);
          const placementSide =
            typeof rec.placementSide === 'string' && validSides.has(rec.placementSide)
              ? (rec.placementSide as ProjectData['workers'][number]['placementSide'])
              : undefined;
          const segRaw = rec.assignedConveyorSegment as Record<string, unknown> | undefined;
          const migratedSeg =
            segRaw && typeof segRaw === 'object'
              ? {
                  ...segRaw,
                  side: segRaw.side === -1 ? (-1 as const) : (1 as const),
                }
              : undefined;
          return {
            ...rec,
            rotation: rot,
            rotationDeg: rot,
            ...(placementSide ? { placementSide } : {}),
            ...(targetId ? { assignedTo: targetId, assignedStationId: targetId } : {}),
            ...(migratedSeg ? { assignedConveyorSegment: migratedSeg } : {}),
          };
        }) as ProjectData['workers']
      : [],
    simulationConfig: (() => {
      const sc = (obj.simulationConfig as ProjectData['simulationConfig']) || {
        durationSec: 28800,
        arrivalIntervalSec: 35,
        maxPlannedUnits: 500,
        speedMultiplier: 30,
        enableBreakdowns: false,
        randomSeed: 4219,
        shifts: [
          {
            id: 'shift_day',
            name: 'Day Shift',
            startSec: 0,
            durationSec: 28800,
            breaks: [],
          },
        ],
        maintenanceWindows: [],
      };
      return {
        ...sc,
        shifts: Array.isArray(sc.shifts)
          ? sc.shifts.map((sh) => ({
              ...sh,
              breaks: Array.isArray(sh.breaks) ? sh.breaks : [],
            }))
          : [],
        maintenanceWindows: Array.isArray(sc.maintenanceWindows) ? sc.maintenanceWindows : [],
      };
    })(),
    lastSimulationResult: obj.lastSimulationResult as ProjectData['lastSimulationResult'],
    scenarios: Array.isArray(obj.scenarios) ? obj.scenarios : [],
  };
}
