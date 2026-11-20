import { ProjectData, LayoutObject, ProductionStage, WorkerDefinition } from '../types/project';

export function createDesertAirCoolerProject(): ProjectData {
  const now = new Date().toISOString();

  // Factory: 30m x 20m x 5m
  // Main 18m conveyor runs from X=5.5m to X=23.5m along Z=10.0m (center of factory)
  // Conveyor dimensions: 18m length, 0.8m width, 0.85m height, speed 0.05 m/s
  const mainConveyorId = 'obj_conv_main';

  const stageSpecs: Array<{
    id: string;
    code: string;
    name: string;
    desc: string;
    time: number;
    x: number;
    z: number;
    category: LayoutObject['category'];
    kind: LayoutObject['kind'];
    templateId: string;
    workers: number;
    bufferCap: number;
    scrapRate: number;
  }> = [
    {
      id: 'stg_1_base',
      code: 'OP-10',
      name: 'Base Assembly',
      desc: 'Mount caster wheels, water basin, and structural frame base.',
      time: 30,
      x: 6.2,
      z: 8.6,
      category: 'assembly_table',
      kind: 'workstation',
      templateId: 'tpl_assembly_table',
      workers: 1,
      bufferCap: 4,
      scrapRate: 0.005,
    },
    {
      id: 'stg_2_motor',
      code: 'OP-20',
      name: 'Motor Assembly',
      desc: 'Install blower fan motor, pump housing, and mounting brackets.',
      time: 45,
      x: 8.5,
      z: 11.4,
      category: 'workstation',
      kind: 'workstation',
      templateId: 'tpl_workstation',
      workers: 1,
      bufferCap: 4,
      scrapRate: 0.005,
    },
    {
      id: 'stg_3_wiring',
      code: 'OP-30',
      name: 'Electrical Wiring',
      desc: 'Wire control switchboard, float valve sensor, and power harness.',
      time: 60,
      x: 11.0,
      z: 8.6,
      category: 'workstation',
      kind: 'workstation',
      templateId: 'tpl_workstation',
      workers: 2,
      bufferCap: 5,
      scrapRate: 0.01,
    },
    {
      id: 'stg_4_testing',
      code: 'OP-40',
      name: 'Testing',
      desc: 'Dielectric hi-pot test, motor current draw, and pump flow check.',
      time: 35,
      x: 13.5,
      z: 11.4,
      category: 'testing_machine',
      kind: 'machine',
      templateId: 'tpl_testing_machine',
      workers: 1,
      bufferCap: 4,
      scrapRate: 0.015,
    },
    {
      id: 'stg_5_final',
      code: 'OP-50',
      name: 'Final Assembly',
      desc: 'Fit honeycomb cooling pads, side louvers, and top cover.',
      time: 40,
      x: 16.0,
      z: 8.6,
      category: 'assembly_table',
      kind: 'workstation',
      templateId: 'tpl_assembly_table',
      workers: 2,
      bufferCap: 4,
      scrapRate: 0.005,
    },
    {
      id: 'stg_6_qc',
      code: 'OP-60',
      name: 'Quality Inspection',
      desc: 'Visual finish audit, airflow verification, and serial barcode tagging.',
      time: 30,
      x: 18.5,
      z: 11.4,
      category: 'workstation',
      kind: 'workstation',
      templateId: 'tpl_workstation',
      workers: 1,
      bufferCap: 4,
      scrapRate: 0.01,
    },
    {
      id: 'stg_7_packing',
      code: 'OP-70',
      name: 'Packing',
      desc: 'Protective corner foam, corrugated carton, and strapping.',
      time: 40,
      x: 20.9,
      z: 8.6,
      category: 'packaging_machine',
      kind: 'machine',
      templateId: 'tpl_packaging_machine',
      workers: 1,
      bufferCap: 5,
      scrapRate: 0.002,
    },
    {
      id: 'stg_8_handling',
      code: 'OP-80',
      name: 'Finished Product Handling',
      desc: 'Palletize finished air coolers for dispatch staging.',
      time: 25,
      x: 23.2,
      z: 11.4,
      category: 'material_handling',
      kind: 'machine',
      templateId: 'tpl_material_handling',
      workers: 1,
      bufferCap: 6,
      scrapRate: 0,
    },
  ];

  // Build conveyor segments (8 linked segments along the 18m spine so products travel accurately)
  // Plus a single visual/logical main conveyor representation? Better: represent the 18m conveyor as
  // 7 inter-stage conveyor transfer segments totaling 18m, OR 1 main 18m conveyor + stage stations along it!
  // Let's keep the exact 18m x 0.8m x 0.85m main conveyor object at X=14.5m, Z=10.0m (spanning X=5.5..23.5m)
  // so inspecting it shows 18.0m x 0.80m x 0.85m at 0.05 m/s! And in DES, transfer time between stage i and i+1
  // uses distance along the conveyor divided by mainConveyor.operations.speedMps!
  const mainConveyor: LayoutObject = {
    id: mainConveyorId,
    name: 'Main Assembly Belt Conveyor (18m)',
    kind: 'conveyor',
    category: 'conveyor_belt',
    templateId: 'tpl_conveyor_belt',
    productionLineId: 'line_main',
    connectedToIds: [],
    geometry: {
      position: { x: 14.5, y: 0, z: 10.0 },
      dimensions: { length: 18.0, width: 0.8, height: 0.85 },
      rotationDeg: 0,
      clearanceM: 0.4,
    },
    operations: {
      processingTimeSec: 0,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 20,
      availability: 0.99,
      requiredOperators: 0,
      speedMps: 0.05,
      productSpacingM: 0.15,
      direction: 1,
    },
    rendering: {
      color: '#334155',
      visible: true,
      locked: false,
      layer: 'conveyors',
    },
  };

  const stationObjects: LayoutObject[] = stageSpecs.map((s, idx) => ({
    id: `obj_st_${idx + 1}`,
    name: `${s.code} ${s.name}`,
    kind: s.kind,
    category: s.category,
    templateId: s.templateId,
    productionLineId: 'line_main',
    stageId: s.id,
    connectedToIds: idx < stageSpecs.length - 1 ? [`obj_st_${idx + 2}`] : [],
    geometry: {
      position: { x: s.x, y: 0, z: s.z },
      dimensions:
        s.category === 'testing_machine'
          ? { length: 1.8, width: 1.1, height: 1.75 }
          : s.category === 'packaging_machine'
          ? { length: 1.9, width: 1.2, height: 1.5 }
          : s.category === 'material_handling'
          ? { length: 1.6, width: 1.2, height: 1.25 }
          : { length: 1.8, width: 0.95, height: 0.88 },
      rotationDeg: 0,
      clearanceM: 0.5,
    },
    operations: {
      processingTimeSec: s.time,
      setupTimeSec: 0,
      loadingTimeSec: 0,
      unloadingTimeSec: 0,
      capacity: 1,
      availability: 0.98,
      requiredOperators: s.workers,
      mtbfSec: 18000,
      mttrSec: 300,
    },
    rendering: {
      color:
        s.category === 'testing_machine'
          ? '#1E293B'
          : s.category === 'packaging_machine'
          ? '#3F3F46'
          : '#27272A',
      visible: true,
      locked: false,
      layer: 'equipment',
    },
  }));

  // Auxiliary factory floor equipment: Raw racks, Finished racks, Forklift
  const auxObjects: LayoutObject[] = [
    {
      id: 'obj_rack_raw_1',
      name: 'Raw Components Rack A',
      kind: 'storage',
      category: 'storage_rack',
      templateId: 'tpl_storage_rack',
      connectedToIds: [],
      geometry: {
        position: { x: 2.8, y: 0, z: 4.0 },
        dimensions: { length: 3.6, width: 1.2, height: 3.4 },
        rotationDeg: 90,
        clearanceM: 0.4,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 16,
        availability: 1,
        requiredOperators: 0,
      },
      rendering: {
        color: '#475569',
        visible: true,
        locked: false,
        layer: 'storage',
      },
    },
    {
      id: 'obj_rack_raw_2',
      name: 'Raw Components Rack B',
      kind: 'storage',
      category: 'storage_rack',
      templateId: 'tpl_storage_rack',
      connectedToIds: [],
      geometry: {
        position: { x: 2.8, y: 0, z: 9.0 },
        dimensions: { length: 3.6, width: 1.2, height: 3.4 },
        rotationDeg: 90,
        clearanceM: 0.4,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 16,
        availability: 1,
        requiredOperators: 0,
      },
      rendering: {
        color: '#475569',
        visible: true,
        locked: false,
        layer: 'storage',
      },
    },
    {
      id: 'obj_rack_fin_1',
      name: 'Finished Goods Rack A',
      kind: 'storage',
      category: 'storage_rack',
      templateId: 'tpl_storage_rack',
      connectedToIds: [],
      geometry: {
        position: { x: 27.4, y: 0, z: 5.0 },
        dimensions: { length: 3.6, width: 1.2, height: 3.4 },
        rotationDeg: 90,
        clearanceM: 0.4,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 16,
        availability: 1,
        requiredOperators: 0,
      },
      rendering: {
        color: '#475569',
        visible: true,
        locked: false,
        layer: 'storage',
      },
    },
    {
      id: 'obj_rack_fin_2',
      name: 'Finished Goods Rack B',
      kind: 'storage',
      category: 'storage_rack',
      templateId: 'tpl_storage_rack',
      connectedToIds: [],
      geometry: {
        position: { x: 27.4, y: 0, z: 10.0 },
        dimensions: { length: 3.6, width: 1.2, height: 3.4 },
        rotationDeg: 90,
        clearanceM: 0.4,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 16,
        availability: 1,
        requiredOperators: 0,
      },
      rendering: {
        color: '#475569',
        visible: true,
        locked: false,
        layer: 'storage',
      },
    },
    {
      id: 'obj_forklift_1',
      name: 'Dispatch Forklift FL-01',
      kind: 'vehicle',
      category: 'forklift',
      templateId: 'tpl_forklift',
      connectedToIds: [],
      geometry: {
        position: { x: 26.2, y: 0, z: 15.2 },
        dimensions: { length: 2.4, width: 1.15, height: 2.1 },
        rotationDeg: 180,
        clearanceM: 0.6,
      },
      operations: {
        processingTimeSec: 0,
        setupTimeSec: 0,
        loadingTimeSec: 0,
        unloadingTimeSec: 0,
        capacity: 1,
        availability: 0.98,
        requiredOperators: 1,
      },
      rendering: {
        color: '#DC2626',
        visible: true,
        locked: false,
        layer: 'vehicles',
      },
    },
  ];

  const stages: ProductionStage[] = stageSpecs.map((s, idx) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    description: s.desc,
    processingTimeSec: s.time,
    setupTimeSec: 0,
    loadingTimeSec: 0,
    unloadingTimeSec: 0,
    requiredWorkers: s.workers,
    requiredMachines: 1,
    inputQty: 1,
    outputQty: 1,
    scrapRate: s.scrapRate,
    reworkProbability: idx === 3 || idx === 5 ? 0.02 : 0,
    bufferCapacity: s.bufferCap,
    predecessorIds: idx > 0 ? [stageSpecs[idx - 1].id] : [],
    successorIds: idx < stageSpecs.length - 1 ? [stageSpecs[idx + 1].id] : [],
    assignedObjectIds: [`obj_st_${idx + 1}`],
    conveyorObjectId: mainConveyorId,
  }));

  // 10 Workers assigned across the 8 stations (Stage 3 & Stage 5 get 2 workers each to balance 60s & 40s ops)
  const workerAssignments: Array<{ stageIdx: number; label: string; name: string; skill: string; dz: number }> = [
    { stageIdx: 0, label: 'W-01', name: 'Operator 01 (Base)', skill: 'Mechanical Assembly', dz: -0.9 },
    { stageIdx: 1, label: 'W-02', name: 'Operator 02 (Motor)', skill: 'Motor Fitment', dz: 0.9 },
    { stageIdx: 2, label: 'W-03', name: 'Operator 03 (Wiring A)', skill: 'Electrical', dz: -0.9 },
    { stageIdx: 2, label: 'W-04', name: 'Operator 04 (Wiring B)', skill: 'Electrical', dz: 0.9 },
    { stageIdx: 3, label: 'W-05', name: 'Operator 05 (Testing)', skill: 'QA & Electrical Test', dz: 0.9 },
    { stageIdx: 4, label: 'W-06', name: 'Operator 06 (Final A)', skill: 'Mechanical Assembly', dz: -0.9 },
    { stageIdx: 4, label: 'W-07', name: 'Operator 07 (Final B)', skill: 'Mechanical Assembly', dz: 0.9 },
    { stageIdx: 5, label: 'W-08', name: 'Operator 08 (QC)', skill: 'Quality Inspection', dz: 0.9 },
    { stageIdx: 6, label: 'W-09', name: 'Operator 09 (Packing)', skill: 'Packaging', dz: -0.9 },
    { stageIdx: 7, label: 'W-10', name: 'Operator 10 (Handling)', skill: 'Material Handling', dz: 0.9 },
  ];

  const workers: WorkerDefinition[] = workerAssignments.map((wa, idx) => {
    const st = stageSpecs[wa.stageIdx];
    const objId = `obj_st_${wa.stageIdx + 1}`;
    const offsetX = wa.label.includes('B') ? 0.55 : 0;
    return {
      id: `wrk_${idx + 1}`,
      label: wa.label,
      name: wa.name,
      position: {
        x: st.x + offsetX,
        y: 0,
        z: st.z + (wa.dz > 0 ? 0.95 : -0.95),
      },
      assignedStageIds: [st.id],
      assignedStationId: objId,
      skillCategory: wa.skill,
      skillLevel: 4,
      efficiencyFactor: 1.0,
      walkingSpeedMps: 1.25,
      shiftId: 'shift_day',
      color: '#1D4ED8',
    };
  });

  return {
    schemaVersion: '1.0.0',
    id: 'proj_desert_air_cooler_v1',
    name: 'Desert Air Cooler Assembly Line',
    factoryName: 'MK Climate Systems — Plant 01',
    industryType: 'HVAC & Evaporative Cooling Appliances',
    description:
      'Acceptance baseline digital twin: 30m × 20m × 5m assembly facility featuring an 18m manual assembly conveyor line, 8 sequential production stages, 10 operators, and finite inter-stage buffers.',
    createdAt: now,
    updatedAt: now,
    factory: {
      name: 'Assembly Hall A',
      lengthM: 30,
      widthM: 20,
      heightM: 5,
      unit: 'm',
      gridSizeM: 0.5,
      snapToGrid: true,
      columns: [
        { id: 'col_1', label: 'C-A1', x: 10, z: 5, width: 0.4, depth: 0.4 },
        { id: 'col_2', label: 'C-A2', x: 20, z: 5, width: 0.4, depth: 0.4 },
        { id: 'col_3', label: 'C-B1', x: 10, z: 15, width: 0.4, depth: 0.4 },
        { id: 'col_4', label: 'C-B2', x: 20, z: 15, width: 0.4, depth: 0.4 },
      ],
      openings: [
        {
          id: 'open_main',
          label: 'Main Entrance',
          type: 'main_entrance',
          wall: 'south',
          offsetM: 14,
          widthM: 2.4,
          heightM: 2.6,
          sillHeightM: 0,
        },
        {
          id: 'open_recv',
          label: 'Receiving Bay',
          type: 'loading_bay',
          wall: 'west',
          offsetM: 14,
          widthM: 3.5,
          heightM: 3.4,
          sillHeightM: 0,
        },
        {
          id: 'open_disp',
          label: 'Dispatch Bay',
          type: 'loading_bay',
          wall: 'east',
          offsetM: 14,
          widthM: 3.5,
          heightM: 3.4,
          sillHeightM: 0,
        },
        {
          id: 'open_win1',
          label: 'North Clerestory 1',
          type: 'window',
          wall: 'north',
          offsetM: 6,
          widthM: 4.5,
          heightM: 1.4,
          sillHeightM: 2.8,
        },
        {
          id: 'open_win2',
          label: 'North Clerestory 2',
          type: 'window',
          wall: 'north',
          offsetM: 19.5,
          widthM: 4.5,
          heightM: 1.4,
          sillHeightM: 2.8,
        },
      ],
      zones: [
        {
          id: 'zone_recv',
          name: 'Material Receiving',
          type: 'receiving',
          position: { x: 2.8, y: 0, z: 15.8 },
          dimensions: { length: 4.4, width: 4.6 },
          rotationDeg: 0,
          color: '#0284C7',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_raw',
          name: 'Raw Material Storage',
          type: 'raw_storage',
          position: { x: 2.8, y: 0, z: 6.8 },
          dimensions: { length: 4.4, width: 10.6 },
          rotationDeg: 0,
          color: '#64748B',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_disp',
          name: 'Finished Goods Dispatch',
          type: 'dispatch',
          position: { x: 27.2, y: 0, z: 15.8 },
          dimensions: { length: 4.4, width: 4.6 },
          rotationDeg: 0,
          color: '#059669',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_fin',
          name: 'Finished Product Storage',
          type: 'finished_storage',
          position: { x: 27.2, y: 0, z: 7.2 },
          dimensions: { length: 4.4, width: 10.2 },
          rotationDeg: 0,
          color: '#10B981',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_forklift',
          name: 'Forklift Aisle',
          type: 'forklift_aisle',
          position: { x: 15.0, y: 0, z: 15.2 },
          dimensions: { length: 19.0, width: 2.6 },
          rotationDeg: 0,
          color: '#D97706',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_ped',
          name: 'Pedestrian Walkway',
          type: 'pedestrian_aisle',
          position: { x: 15.0, y: 0, z: 17.6 },
          dimensions: { length: 19.0, width: 1.4 },
          rotationDeg: 0,
          color: '#16A34A',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_maint',
          name: 'Maintenance Bay',
          type: 'maintenance',
          position: { x: 9.0, y: 0, z: 2.2 },
          dimensions: { length: 5.0, width: 2.8 },
          rotationDeg: 0,
          color: '#DC2626',
          locked: false,
          visible: true,
        },
        {
          id: 'zone_emp',
          name: 'Operator Rest & Briefing Area',
          type: 'employee',
          position: { x: 21.0, y: 0, z: 2.2 },
          dimensions: { length: 5.0, width: 2.8 },
          rotationDeg: 0,
          color: '#4F46E5',
          locked: false,
          visible: true,
        },
      ],
    },
    productionLines: [
      {
        id: 'line_main',
        name: 'Cooler Line 01',
        type: 'straight',
        totalLengthM: 18.0,
        totalWidthM: 4.2,
        conveyorHeightM: 0.85,
        conveyorSpeedMps: 0.05,
        direction: 'forward',
        targetCapacityPerShift: 600,
        workstationCount: 8,
        workerCount: 10,
        inputPoint: { x: 5.5, y: 0, z: 10.0 },
        outputPoint: { x: 23.5, y: 0, z: 10.0 },
        productId: 'prod_desert_cooler',
      },
    ],
    layoutObjects: [mainConveyor, ...stationObjects, ...auxObjects],
    products: [
      {
        id: 'prod_desert_cooler',
        code: 'DAC-4500',
        name: 'Desert Air Cooler 45L',
        category: 'Evaporative Air Coolers',
        dimensions: { length: 0.75, width: 0.45, height: 1.1 },
        weightKg: 24.5,
        color: '#E2E8F0',
        targetQuantity: 600,
        routeStageIds: stages.map((s) => s.id),
        modelShape: 'air_cooler',
      },
    ],
    stages,
    routes: [
      {
        id: 'route_cooler_std',
        name: 'Standard Cooler Assembly Route',
        productId: 'prod_desert_cooler',
        stageIds: stages.map((s) => s.id),
      },
    ],
    workers,
    simulationConfig: {
      durationSec: 28800, // 8 hours
      arrivalIntervalSec: 55, // balanced with bottleneck cycle time to keep realistic WIP
      maxPlannedUnits: 600,
      speedMultiplier: 30,
      enableBreakdowns: false,
      randomSeed: 4219,
      shifts: [
        {
          id: 'shift_day',
          name: 'Day Shift A (08:00 - 16:00)',
          startSec: 0,
          durationSec: 28800,
          breaks: [
            {
              id: 'brk_mid',
              name: 'Mid-Shift Break (30 min)',
              startSec: 14400,
              durationSec: 1800,
            },
          ],
        },
      ],
    },
    scenarios: [
      {
        id: 'scen_baseline',
        name: 'Baseline — 10 Operators, 0.05 m/s Belt',
        description: 'Initial acceptance configuration for Desert Air Cooler line.',
        createdAt: now,
        isBaseline: true,
        overrides: {
          workerCount: 10,
          processingTimeScale: 1.0,
          conveyorSpeedMps: 0.05,
          bufferCapacity: 4,
          shiftDurationSec: 28800,
          enableBreakdowns: false,
          targetProduction: 600,
        },
      },
    ],
  };
}
