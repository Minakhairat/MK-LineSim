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
    req.onerror = () => reject(req.error);
  });
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllProjectsFromDb(): Promise<ProjectData[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => {
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
      resolve(migrated);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLastActiveProjectId(): Promise<string | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get('lastActiveProjectId');
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCustomEquipmentToDb(tpl: EquipmentTemplate): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readwrite');
    tx.objectStore(STORE_EQUIPMENT).put({ ...tpl, isCustom: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCustomEquipmentFromDb(): Promise<EquipmentTemplate[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readonly');
    const req = tx.objectStore(STORE_EQUIPMENT).getAll();
    req.onsuccess = () => resolve((req.result || []) as EquipmentTemplate[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomEquipmentFromDb(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EQUIPMENT, 'readwrite');
    tx.objectStore(STORE_EQUIPMENT).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    typeof factory.widthM !== 'number' ||
    typeof factory.heightM !== 'number'
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
    layoutObjects: Array.isArray(obj.layoutObjects) ? obj.layoutObjects : [],
    products: Array.isArray(obj.products) ? obj.products : [],
    stages: Array.isArray(obj.stages) ? obj.stages : [],
    routes: Array.isArray(obj.routes) ? obj.routes : [],
    workers: Array.isArray(obj.workers) ? obj.workers : [],
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
