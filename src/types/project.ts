export type MeasurementUnit = 'm' | 'cm' | 'mm';
export type AppLanguage = 'en' | 'ar';
export type AppTheme = 'light' | 'dark';

export type WorkspaceModuleId =
  | 'projects'
  | 'factory'
  | 'layout'
  | 'equipment'
  | 'products'
  | 'processes'
  | 'workforce'
  | 'simulation'
  | 'analytics'
  | 'scenarios'
  | 'reports'
  | 'validation';

export type ViewportMode = '2d' | '3d' | 'split' | 'flowchart' | 'simulation';
export type CameraPreset = 'perspective' | 'top' | 'front' | 'side';
export type VisualVariant = 'realistic' | 'engineering';

export interface Vec3 {
  x: number; // meters along factory length (0..length)
  y: number; // meters elevation (0 = floor)
  z: number; // meters along factory width (0..width)
}

export interface Dimensions3D {
  length: number; // meters (X local axis)
  width: number;  // meters (Z local axis)
  height: number; // meters (Y vertical axis)
}

export type ZoneType =
  | 'receiving'
  | 'dispatch'
  | 'raw_storage'
  | 'finished_storage'
  | 'maintenance'
  | 'employee'
  | 'safety'
  | 'pedestrian_aisle'
  | 'forklift_aisle';

export interface FactoryZone {
  id: string;
  name: string;
  type: ZoneType;
  position: Vec3; // center X, Y=0, Z
  dimensions: { length: number; width: number };
  rotationDeg: number;
  color: string;
  locked: boolean;
  visible: boolean;
}

export interface StructuralColumn {
  id: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export type WallSide = 'north' | 'south' | 'east' | 'west';
export type OpeningType = 'door' | 'window' | 'main_entrance' | 'loading_bay';

export interface WallOpening {
  id: string;
  label: string;
  type: OpeningType;
  wall: WallSide;
  offsetM: number; // distance from wall start
  widthM: number;
  heightM: number;
  sillHeightM: number;
}

export interface FactorySpec {
  name: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  unit: MeasurementUnit;
  gridSizeM: number;
  snapToGrid: boolean;
  columns: StructuralColumn[];
  openings: WallOpening[];
  zones: FactoryZone[];
}

export type ProductionLineType =
  | 'straight'
  | 'u_shaped'
  | 'l_shaped'
  | 'parallel'
  | 'loop'
  | 'custom';

export interface ProductionLine {
  id: string;
  name: string;
  type: ProductionLineType;
  totalLengthM: number;
  totalWidthM: number;
  conveyorHeightM: number;
  conveyorSpeedMps: number;
  direction: 'forward' | 'reverse';
  targetCapacityPerShift: number;
  workstationCount: number;
  workerCount: number;
  inputPoint: Vec3;
  outputPoint: Vec3;
  productId: string;
}

export type EquipmentCategory =
  | 'conveyor_belt'
  | 'roller_conveyor'
  | 'pallet_conveyor'
  | 'incline_conveyor'
  | 'assembly_table'
  | 'workstation'
  | 'injection_molding'
  | 'hydraulic_press'
  | 'cutting_machine'
  | 'laser_cutter'
  | 'cnc_machine'
  | 'welding_machine'
  | 'painting_equipment'
  | 'testing_machine'
  | 'checkweigher'
  | 'filling_machine'
  | 'labeling_machine'
  | 'packaging_machine'
  | 'stretch_wrapper_turntable'
  | 'stretch_wrapper_arm'
  | 'shrink_tunnel'
  | 'carton_sealer'
  | 'strapping_machine'
  | 'palletizer_robot'
  | 'material_handling'
  | 'storage_rack'
  | 'pallet_wood_euro'
  | 'pallet_wood_std'
  | 'pallet_wood_heavy'
  | 'pallet_plastic_euro'
  | 'pallet_plastic_heavy'
  | 'pallet_plastic_compact'
  | 'forklift'
  | 'pallet_jack'
  | 'agv_cart'
  | 'buffer';

export type LayoutObjectKind =
  | 'conveyor'
  | 'workstation'
  | 'machine'
  | 'buffer'
  | 'storage'
  | 'vehicle';

export interface GeometricProps {
  position: Vec3; // center X, floor Y, center Z
  dimensions: Dimensions3D;
  rotationDeg: number; // rotation around vertical Y axis in degrees
  clearanceM: number;  // maintenance & safety clearance around object
}

export type FailureDistributionType = 'exponential' | 'fixed' | 'weibull';
export type RepairDistributionType = 'exponential' | 'fixed' | 'triangular' | 'lognormal';
export type InterruptionPolicy = 'stop_immediately' | 'finish_current_cycle' | 'continue_during_break';
export type ShiftEndPolicy = 'stop_immediately' | 'finish_current_cycle';
export type DispatchingRule = 'fixed_sequence' | 'product_priority' | 'weighted_mix' | 'round_robin';
export type DefectModelType = 'unit' | 'batch';
export type BatchMode = 'single' | 'collect_batch' | 'unbatch';

export interface PlannedMaintenanceWindow {
  id: string;
  name: string;
  objectId?: string; // undefined = plant-wide planned maintenance
  startSec: number;
  durationSec: number;
}

export interface OperationalProps {
  processingTimeSec: number;
  setupTimeSec: number;
  loadingTimeSec: number;
  unloadingTimeSec: number;
  capacity: number; // concurrent units or buffer capacity
  availability: number; // 0..1
  requiredOperators: number;
  speedMps?: number; // for conveyors
  productSpacingM?: number; // for conveyors
  direction?: 1 | -1; // +1 forward local X, -1 reverse
  mtbfSec?: number; // mean time between failures (optional)
  mttrSec?: number; // arithmetic mean time to repair (seconds)
  mttrStdDevSec?: number; // arithmetic standard deviation of repair duration for lognormal (seconds)
  failureModel?: FailureDistributionType;
  weibullShape?: number; // k parameter for Weibull failure model (default ~1.5)
  weibullScaleSec?: number; // lambda scale parameter for Weibull
  repairModel?: RepairDistributionType;
  operatingSchedule?: string;
  shiftId?: string; // optional explicit shift ID for this equipment
  runDuringBreaks?: boolean; // automatic equipment can run through worker breaks when true
  breakPolicy?: InterruptionPolicy; // explicit interruption policy at scheduled breaks
  shiftEndPolicy?: ShiftEndPolicy; // explicit interruption policy at shift end
  plannedMaintenance?: PlannedMaintenanceWindow[];
  batchSize?: number; // number of items grouped per machine/pallet cycle (>=1)
  batchMode?: BatchMode;
  batchTransferTimeSec?: number; // optional post-processing batch transfer/pallet release delay (s)
}

export interface RenderingProps {
  color: string;
  visible: boolean;
  locked: boolean;
  layer: 'equipment' | 'conveyors' | 'buffers' | 'storage' | 'vehicles';
}

export interface LayoutObject {
  id: string;
  name: string;
  kind: LayoutObjectKind;
  category: EquipmentCategory;
  templateId: string;
  productionLineId?: string;
  stageId?: string;
  connectedToIds: string[]; // downstream connections
  geometry: GeometricProps;
  operations: OperationalProps;
  rendering: RenderingProps;
}

export interface EquipmentTemplate {
  id: string;
  name: string;
  category: EquipmentCategory;
  kind: LayoutObjectKind;
  isCustom: boolean;
  description: string;
  defaultDimensions: Dimensions3D;
  defaultClearanceM: number;
  defaultOperations: OperationalProps;
  defaultColor: string;
}

export type ProductModelShape =
  | 'air_cooler'
  | 'box'
  | 'carton_box'
  | 'cylinder'
  | 'drum'
  | 'chassis'
  | 'appliance'
  | 'pallet'
  | 'pallet_wood'
  | 'pallet_plastic'
  | 'wrapped_pallet'
  | 'shrink_pack'
  | 'crate'
  | 'spool_roll';

export interface ProductDefinition {
  id: string;
  code: string;
  name: string;
  category: string;
  dimensions: Dimensions3D;
  weightKg: number;
  color: string;
  targetQuantity: number;
  routeStageIds: string[];
  modelShape: ProductModelShape;
  routingMode?: 'auto' | 'manual';
  entryStageIds?: string[];
  priority?: number; // higher value dispatches earlier under product_priority (default 1)
  mixWeight?: number; // relative ratio under weighted_mix (default 1)
  cycleTimeMultiplier?: number; // scales stage processing time for this product (default 1)
  stageProcessingTimes?: Record<string, number>; // optional per-stage processing time override (s)
}

export interface ProductionStage {
  id: string;
  code: string;
  name: string;
  description: string;
  processingTimeSec: number;
  setupTimeSec: number;
  loadingTimeSec: number;
  unloadingTimeSec: number;
  requiredWorkers: number;
  requiredMachines: number;
  inputQty: number;
  outputQty: number;
  scrapRate: number; // 0..1
  reworkProbability: number; // 0..1
  defectModel?: DefectModelType; // 'unit' (independent per unit) or 'batch' (accept/reject batch)
  bufferCapacity: number;
  predecessorIds: string[];
  successorIds: string[];
  assignedObjectIds: string[]; // stations/machines executing this stage
  conveyorObjectId?: string;   // optional conveyor carrying units out of this stage
  flowPos?: { x: number; y: number };
  batchSize?: number; // items grouped into 1 batch/pallet per cycle (>=1)
  batchMode?: BatchMode;
  batchTransferTimeSec?: number; // optional transfer delay after batch operation (s)
}

export interface ProductionRoute {
  id: string;
  name: string;
  productId: string;
  stageIds: string[];
}

export type WorkerPlacementSide = 'north' | 'south' | 'east' | 'west' | 'custom';

export interface WorkerConveyorSegmentRef {
  objectId: string;
  segmentIndex: number;
  segmentCount: number;
  offsetRatio: number; // 0..1 along conveyor belt length
  side?: 1 | -1; // +1 or -1 perpendicular to conveyor direction
}

export interface WorkerDefinition {
  id: string;
  label: string;
  name: string;
  position: Vec3;
  rotation?: number; // orientation in degrees (-360..360), primary field synced with rotationDeg
  rotationDeg?: number; // orientation around vertical axis in degrees (-360..360)
  placementSide?: WorkerPlacementSide;
  assignedStageIds: string[];
  assignedStationId?: string;
  assignedTo?: string; // conveyor or station object ID linked to this worker
  assignedConveyorSegment?: WorkerConveyorSegmentRef;
  skillCategory: string;
  skillLevel: number; // 1..5
  efficiencyFactor: number; // 0.5..1.5
  walkingSpeedMps: number;
  shiftId: string;
  breakPolicy?: ShiftEndPolicy; // 'stop_immediately' (default) or 'finish_current_cycle'
  shiftEndPolicy?: ShiftEndPolicy;
  color: string;
}

export interface ShiftBreak {
  id: string;
  name: string;
  startSec: number; // offset from simulation start
  durationSec: number;
}

export interface ShiftDefinition {
  id: string;
  name: string;
  startSec: number;
  durationSec: number;
  breaks: ShiftBreak[];
}

export interface SimulationConfig {
  durationSec: number; // e.g., 28800 for 8-hour shift
  arrivalIntervalSec: number; // inter-arrival time of raw material / orders
  maxPlannedUnits: number; // 0 = unlimited up to shift duration / product target
  speedMultiplier: number; // 1x..200x
  enableBreakdowns: boolean;
  randomSeed: number;
  shifts: ShiftDefinition[];
  maintenanceWindows?: PlannedMaintenanceWindow[];
  dispatchingRule?: DispatchingRule;
  productSequence?: string[];
  interruptionPolicy?: ShiftEndPolicy; // global fallback for break/shift-end operations
}

// ============================================================================
// DISCRETE EVENT SIMULATION RUNTIME & RESULTS
// ============================================================================

export type SimEventType =
  | 'ProductCreated'
  | 'ProductArrived'
  | 'ProcessingStarted'
  | 'ProcessingCompleted'
  | 'WorkerAssigned'
  | 'WorkerReleased'
  | 'MachineStarted'
  | 'MachineStopped'
  | 'ProductTransferred'
  | 'BufferFull'
  | 'BufferReleased'
  | 'ShiftStarted'
  | 'ShiftEnded'
  | 'BreakdownStarted'
  | 'RepairCompleted'
  | 'PlannedMaintenanceStarted'
  | 'PlannedMaintenanceCompleted'
  | 'SetupStarted'
  | 'SetupCompleted'
  | 'ProductScrapped'
  | 'ProductCompleted';

export interface SimEvent {
  seq: number;
  timestamp: number; // seconds
  type: SimEventType;
  entityId?: string; // product instance id
  stageId?: string;
  objectId?: string; // machine / workstation / conveyor / buffer
  workerId?: string;
  details: string;
}

export type MachineRuntimeStatus =
  | 'running'
  | 'idle'
  | 'blocked'
  | 'starved'
  | 'setup'
  | 'down'
  | 'maintenance'
  | 'unavailable';
export type WorkerRuntimeStatus = 'idle' | 'walking' | 'busy' | 'break' | 'unavailable';
export type ConveyorRuntimeStatus = 'moving' | 'stopped' | 'blocked' | 'unavailable';

export interface ProductEntityState {
  id: string;
  productId: string;
  serialNumber: number;
  createdAt: number;
  completedAt?: number;
  scrapped: boolean;
  reworkCount: number;
  currentStageId?: string;
  currentObjectId?: string;
  locationKind: 'source' | 'buffer' | 'station' | 'conveyor' | 'completed' | 'scrapped';
  conveyorProgress?: number; // 0..1 along conveyor length
  worldPosition: Vec3;
  rotationDeg?: number;
  waitingTimeSec: number;
  batchQueueWaitTimeSec?: number;
  processingTimeSec: number;
  transportTimeSec: number;
  batchCount?: number; // number of individual product items carried by this entity (>=1)
  isBatchCarrier?: boolean;
  containerKind?: 'pallet' | 'carton' | 'pack';
  batchLabel?: string;
  absorbedIntoEntityId?: string;
  routeStepIndex?: number;
}

export interface ObjectRuntimeState {
  objectId: string;
  status: MachineRuntimeStatus;
  conveyorStatus?: ConveyorRuntimeStatus;
  busyUnitIds: string[];
  queueUnitIds: string[];
  processedCount: number;
  scrapCount: number;
  runningTimeSec: number;
  idleTimeSec: number;
  blockedTimeSec: number;
  starvedTimeSec: number;
  setupTimeSec?: number;
  downTimeSec: number;
  maintenanceTimeSec?: number;
  unavailableTimeSec?: number;
  movingTimeSec?: number;
  stoppedTimeSec?: number;
  lastStateChangeTime: number;
}

export interface WorkerRuntimeState {
  workerId: string;
  status: WorkerRuntimeStatus;
  currentStationId?: string;
  targetStationId?: string;
  position: Vec3;
  startPosition: Vec3;
  targetPosition: Vec3;
  moveStartTime: number;
  moveEndTime: number;
  busyTimeSec: number;
  walkingTimeSec: number;
  idleTimeSec: number;
  breakTimeSec?: number;
  unavailableTimeSec?: number;
  tasksCompleted: number;
  lastStateChangeTime: number;
}

export interface StageAnalytics {
  stageId: string;
  stageName: string;
  enteredCount: number;
  completedCount: number;
  scrapCount: number;
  reworkCount: number;
  scrappedBatches?: number;
  reworkBatches?: number;
  reworkCycles?: number;
  avgCycleTimeSec: number;
  avgWaitTimeSec: number;
  avgUnitWaitTimeSec?: number;
  avgBatchWaitTimeSec?: number;
  avgQueueWaitTimeSec?: number;
  starvedTimeSec?: number;
  blockedTimeSec?: number;
  conveyorTransitTimeSec?: number;
  avgQueueLength: number;
  maxQueueLength: number;
  utilizationPct: number;
  scheduledUtilizationPct?: number;
  calendarUtilizationPct?: number;
  blockedPct: number;
  starvedPct: number;
  idlePct?: number;
  setupPct?: number;
  downPct: number;
  maintenancePct?: number;
  unavailablePct?: number;
  calendarTimeSec?: number;
  scheduledTimeSec?: number;
  plannedDowntimeSec?: number;
  operatingTimeSec?: number;
  isBottleneck: boolean;
  availabilityPct?: number;
  performancePct?: number;
  qualityPct?: number;
  oeePct?: number;
  batchesCompleted?: number;
  batchSize?: number;
  batchMode?: BatchMode;
  configuredCycleTimeSec?: number;
  effectiveTheoreticalUnitCycleSec?: number;
  theoreticalCapacityPerHour?: number;
  actualCapacityPerHour?: number;
  cycleDeviationSec?: number;
  cycleDeviationPct?: number;
  bottleneckReasonCode?:
    | 'balanced'
    | 'user_cycle_bottleneck'
    | 'worker_walk'
    | 'worker_starvation'
    | 'downstream_blocked'
    | 'upstream_starved'
    | 'downtime'
    | 'batch_accumulation'
    | 'conveyor_saturation';
  bottleneckReasonDetail?: string;
  bottleneckReasonDetailAr?: string;
}

export interface ProductAnalytics {
  productId: string;
  productCode: string;
  productName: string;
  color: string;
  plannedQty: number;
  releasedQty: number;
  completedGoodQty: number;
  scrappedQty: number;
  wipQty: number;
  reworkUnits: number;
  reworkCycles: number;
  avgLeadTimeSec: number;
  attainmentPct: number;
}

export interface ResourceOeeAnalytics {
  objectId: string;
  objectName: string;
  kind: LayoutObjectKind;
  stageId?: string;
  shiftId?: string;
  calendarTimeSec: number;
  plannedDowntimeSec: number;
  scheduledProductionTimeSec: number;
  unplannedDowntimeSec: number;
  setupTimeSec: number;
  operatingTimeSec: number;
  runningTimeSec: number;
  idleTimeSec: number;
  blockedTimeSec: number;
  starvedTimeSec: number;
  maintenanceTimeSec: number;
  unavailableTimeSec: number;
  scheduledUtilizationPct: number;
  calendarUtilizationPct: number;
  availabilityPct: number;
  performancePct: number;
  qualityPct: number;
  oeePct: number;
  processedCount: number;
  goodCount: number;
  scrapCount: number;
  idealCycleTimeSec: number;
}

export interface WorkerAnalytics {
  workerId: string;
  workerLabel: string;
  workerName: string;
  assignedTo?: string;
  assignedToName?: string;
  assignedToKind?: LayoutObjectKind;
  assignedConveyorSegmentIndex?: number;
  shiftId?: string;
  tasksCompleted: number;
  busyTimeSec: number;
  walkingTimeSec: number;
  idleTimeSec: number;
  unavailableTimeSec: number;
  scheduledTimeSec?: number;
  workUtilizationPct?: number;
  utilizationPct: number;
}

export interface HourlyProductionPoint {
  hourIndex: number; // 1..N
  label: string;
  plannedCumulative: number;
  actualCumulative: number;
  hourlyGood: number;
  hourlyScrap: number;
  avgWip: number;
}

export interface WipTimePoint {
  timeSec: number;
  wip: number;
  completed: number;
  throughputPerHour: number;
}

export interface SimulationKPIs {
  totalPlannedProduction: number;
  actualProduction: number;
  goodUnits: number;
  defectiveUnits: number;
  productionAttainmentPct: number;
  hourlyOutput: number;
  unitsPerShift: number;

  avgCycleTimeSec: number;
  theoreticalTaktTimeSec: number;
  avgLeadTimeSec: number;
  avgWaitingTimeSec: number;
  avgUnitWaitingTimeSec?: number;
  avgBatchWaitingTimeSec?: number;
  avgQueueWaitingTimeSec?: number;
  avgProcessingTimeSec: number;
  avgTransportTimeSec: number;
  totalConveyorTransitTimeSec?: number;
  totalDowntimeSec: number;

  lineEfficiencyPct: number;
  workerUtilizationPct: number;
  machineUtilizationPct: number;
  calendarUtilizationPct?: number;
  bottleneckStageId?: string;
  bottleneckStageName?: string;

  avgWip: number;
  currentWip: number;
  avgQueueLength: number;
  throughputPerHour: number;
  avgBufferOccupancyPct: number;
  totalStarvedTimeSec: number;
  totalBlockedTimeSec: number;
  totalIdleTimeSec?: number;
  setupTimeSec?: number;
  calendarTimeSec?: number;
  scheduledProductionTimeSec?: number;
  plannedDowntimeSec?: number;
  unplannedDowntimeSec?: number;
  operatingTimeSec?: number;
  availabilityPct?: number;
  performancePct?: number;
  qualityPct?: number;
  oeePct?: number;
  theoreticalThroughputPerHour?: number;
  throughputVariancePct?: number;
  theoreticalBottleneckStageId?: string;
  theoreticalBottleneckStageName?: string;
  theoreticalBottleneckCycleSec?: number;
  totalBatchesCompleted?: number;
  avgBatchSize?: number;
  scrappedBatches?: number;
  reworkUnits?: number;
  reworkCycles?: number;
  reworkBatches?: number;
}

export interface SimulationResult {
  completedAtWallTime: string;
  simTimeSec: number;
  kpis: SimulationKPIs;
  stageAnalytics: StageAnalytics[];
  resourceAnalytics?: ResourceOeeAnalytics[];
  workerAnalytics?: WorkerAnalytics[];
  productAnalytics?: ProductAnalytics[];
  hourlySeries: HourlyProductionPoint[];
  wipSeries: WipTimePoint[];
  recentEvents: SimEvent[];
  totalEventsExecuted: number;
}

export interface StageBatchSnapshot {
  stageId: string;
  bufferedItems: number;
  targetBatchSize: number;
  activeBatchEntities: number;
}

export interface SimulationSnapshot {
  status: 'idle' | 'running' | 'paused' | 'completed';
  clockSec: number;
  shiftActive: boolean;
  onBreak: boolean;
  objects: Record<string, ObjectRuntimeState>;
  workers: Record<string, WorkerRuntimeState>;
  products: ProductEntityState[];
  stageBatches?: Record<string, StageBatchSnapshot>;
  recentEvents: SimEvent[];
  totalEventsExecuted: number;
  result?: SimulationResult;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  isBaseline: boolean;
  overrides: {
    workerCount: number;
    processingTimeScale: number; // 1.0 = 100%
    conveyorSpeedMps: number;
    bufferCapacity: number;
    shiftDurationSec: number;
    enableBreakdowns: boolean;
    targetProduction: number;
  };
  result?: SimulationResult;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  messageAr?: string;
  recommendation?: string;
  recommendationAr?: string;
  resourceName?: string;
  targetId?: string;
  targetType?: 'factory' | 'object' | 'stage' | 'worker' | 'product' | 'shift';
}

export interface ProjectData {
  schemaVersion: string;
  id: string;
  name: string;
  factoryName: string;
  industryType: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  factory: FactorySpec;
  productionLines: ProductionLine[];
  layoutObjects: LayoutObject[];
  products: ProductDefinition[];
  stages: ProductionStage[];
  routes: ProductionRoute[];
  workers: WorkerDefinition[];
  simulationConfig: SimulationConfig;
  lastSimulationResult?: SimulationResult;
  scenarios: ScenarioRecord[];
}

export interface BenchmarkMetricComparison {
  metric: string;
  metricAr?: string;
  unit: string;
  expected: number;
  actual: number;
  absError: number;
  pctError: number;
  toleranceAbs: number;
  tolerancePct?: number;
  passed: boolean;
}

export interface BenchmarkCaseResult {
  id: string;
  name: string;
  nameAr: string;
  category: string;
  categoryAr: string;
  description: string;
  descriptionAr: string;
  verificationTier?: 'math' | 'des';
  engineeringConcept?: string;
  engineeringConceptAr?: string;
  inputSummary?: string;
  inputSummaryAr?: string;
  explanation?: string;
  explanationAr?: string;
  passed: boolean;
  executionMs: number;
  metrics: BenchmarkMetricComparison[];
  failureReason?: string;
}

export interface BenchmarkSuiteSummary {
  ranAt: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalExecutionMs: number;
  results: BenchmarkCaseResult[];
}

