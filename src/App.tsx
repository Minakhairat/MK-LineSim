import React, { useEffect, useRef } from 'react';
import {
  Activity,
  BarChart3,
  Box,
  Camera,
  ChevronDown,
  ClipboardCheck,
  ClipboardCopy,
  ClipboardPaste,
  Columns2,
  Compass,
  Cpu,
  Download,
  Factory,
  FileText,
  FolderKanban,
  GitBranch,
  HelpCircle,
  Layers,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Package,
  Phone,
  PlayCircle,
  Redo2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sun,
  Undo2,
  Upload,
  Users,
  Video,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { getT } from './i18n/translations';
import { CameraPreset, WorkspaceModuleId } from './types/project';
import { Workspace2D } from './components/workspace/Workspace2D';
import { Workspace3D } from './components/workspace/Workspace3D';
import { FlowchartRoutingCanvas } from './components/workspace/FlowchartRoutingCanvas';
import { PropertiesPanel } from './components/panels/PropertiesPanel';
import { BottomSimPanel } from './components/panels/BottomSimPanel';
import { ProjectsModule } from './components/modules/ProjectsModule';
import { FactoryModule } from './components/modules/FactoryModule';
import { EquipmentModule, LayoutModule } from './components/modules/LayoutEquipmentModule';
import {
  ProcessesModule,
  ProductsModule,
} from './components/modules/ProductProcessWorkforceModule';
import { WorkforceModule } from './components/modules/WorkforceModule';
import { SimulationInspectorModule } from './components/modules/SimulationInspectorModule';
import { AnalyticsModule } from './components/modules/AnalyticsModule';
import { ScenariosModule } from './components/modules/ScenariosModule';
import { ReportsModule } from './components/modules/ReportsModule';
import { EngineeringValidationCenterModule } from './components/modules/EngineeringValidationCenterModule';
import { HelpGuideModal } from './components/modals/HelpGuideModal';
import {
  captureViewportPng,
  downloadBlob,
  downloadDataUrl,
  sanitizeFilename,
  ViewportVideoRecorder,
} from './utils/mediaCapture';
import { PWAInstallButton } from './components/pwa/PWAInstallButton';
import { OfflineIndicator } from './components/pwa/OfflineIndicator';

export default function App() {
  const initialized = useAppStore((s) => s.initialized);
  const project = useAppStore((s) => s.project);
  const activeModule = useAppStore((s) => s.activeModule);
  const viewportMode = useAppStore((s) => s.viewportMode);
  const cameraPreset = useAppStore((s) => s.cameraPreset);
  const visualVariant = useAppStore((s) => s.visualVariant);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const selection = useAppStore((s) => s.selection);
  const theme = useAppStore((s) => s.theme);
  const language = useAppStore((s) => s.language);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const undoCount = useAppStore((s) => s.undoStack.length);
  const redoCount = useAppStore((s) => s.redoStack.length);
  const toastMessage = useAppStore((s) => s.toastMessage);
  const validationIssues = useAppStore((s) => s.validationIssues);
  const capture3DPng = useAppStore((s) => s.capture3DPng);

  const bootstrap = useAppStore((s) => s.bootstrap);
  const setActiveModule = useAppStore((s) => s.setActiveModule);
  const setViewportMode = useAppStore((s) => s.setViewportMode);
  const setCameraPreset = useAppStore((s) => s.setCameraPreset);
  const setVisualVariant = useAppStore((s) => s.setVisualVariant);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);
  const setFullscreen = useAppStore((s) => s.setFullscreen);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const saveCurrentProject = useAppStore((s) => s.saveCurrentProject);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const copySelectedObjects = useAppStore((s) => s.copySelectedObjects);
  const pasteClipboardObjects = useAppStore((s) => s.pasteClipboardObjects);
  const deleteSelectedObjects = useAppStore((s) => s.deleteSelectedObjects);
  const importProjectJson = useAppStore((s) => s.importProjectJson);
  const exportProjectCad = useAppStore((s) => s.exportProjectCad);
  const setToast = useAppStore((s) => s.setToast);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const [sidebarDrawerOpen, setSidebarDrawerOpen] = React.useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768
  );
  const [mobilePropsOpen, setMobilePropsOpen] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [cadMenuOpen, setCadMenuOpen] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recSeconds, setRecSeconds] = React.useState(0);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cadMenuRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<ViewportVideoRecorder | null>(null);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Recording elapsed timer
  useEffect(() => {
    if (!isRecording) {
      setRecSeconds(0);
      return;
    }
    const id = window.setInterval(() => {
      setRecSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  // Ensure active video recorder is stopped cleanly on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        void recorderRef.current.stop();
        recorderRef.current = null;
      }
    };
  }, []);

  // Close CAD export dropdown on outside click
  useEffect(() => {
    if (!cadMenuOpen) return;
    const onMouseDown = (ev: MouseEvent) => {
      if (cadMenuRef.current && !cadMenuRef.current.contains(ev.target as Node)) {
        setCadMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [cadMenuOpen]);

  // Global keyboard shortcuts (including Esc to exit fullscreen or close CAD menu)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cadMenuOpen) {
        setCadMenuOpen(false);
        return;
      }
      if (e.key === 'Escape' && useAppStore.getState().isFullscreen) {
        e.preventDefault();
        setFullscreen(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentProject();
      } else if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelectedObjects();
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteClipboardObjects();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedObjects();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    undo,
    redo,
    saveCurrentProject,
    copySelectedObjects,
    pasteClipboardObjects,
    deleteSelectedObjects,
    setFullscreen,
    cadMenuOpen,
  ]);

  const t = getT(language);
  const isAr = language === 'ar';

  const navItems: Array<{ id: WorkspaceModuleId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'projects', label: t.modules.projects, icon: FolderKanban },
    { id: 'factory', label: t.modules.factory, icon: Factory },
    { id: 'layout', label: t.modules.layout, icon: Layers },
    { id: 'equipment', label: t.modules.equipment, icon: Wrench },
    { id: 'products', label: t.modules.products, icon: Package },
    { id: 'processes', label: t.modules.processes, icon: Cpu },
    { id: 'workforce', label: t.modules.workforce, icon: Users },
    { id: 'simulation', label: t.modules.simulation, icon: PlayCircle },
    { id: 'analytics', label: t.modules.analytics, icon: BarChart3 },
    { id: 'scenarios', label: t.modules.scenarios, icon: GitBranch },
    { id: 'reports', label: t.modules.reports, icon: FileText },
    { id: 'validation', label: t.modules.validation, icon: ClipboardCheck },
  ];

  const isFullPageModule =
    activeModule === 'analytics' ||
    activeModule === 'scenarios' ||
    activeModule === 'reports' ||
    activeModule === 'validation';

  const handleQuickExportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${sanitizeFilename(project.name)}_linesim.json`);
    setToast(isAr ? 'تم تصدير ملف المشروع JSON' : 'Exported Project JSON', 'success');
  };

  const handleCapturePhoto = async () => {
    const snap = await captureViewportPng(viewportMode, capture3DPng, theme === 'dark');
    if (!snap) {
      setToast(
        isAr ? 'تعذر التقاط صورة في هذا الوضع حالياً.' : 'Unable to capture snapshot in this viewport mode.',
        'error'
      );
      return;
    }
    downloadDataUrl(snap.dataUrl, `${sanitizeFilename(project.name)}_${snap.suffix}.png`);
    setToast(
      isAr ? 'تم التقاط وحفظ صورة حية عالية الدقة (PNG)' : 'Captured and downloaded live PNG snapshot',
      'success'
    );
  };

  const handleToggleRecording = async () => {
    if (isRecording && recorderRef.current) {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      setIsRecording(false);
      if (blob && blob.size > 0) {
        downloadBlob(blob, `${sanitizeFilename(project.name)}_simulation_${Date.now()}.webm`);
        setToast(
          isAr ? 'تم حفظ فيديو المحاكاة الحي (WebM)' : 'Live simulation video saved (WebM)',
          'success'
        );
      } else {
        setToast(isAr ? 'لم يتم التقاط إطارات فيديو كافية.' : 'No video frames captured.', 'error');
      }
      return;
    }

    if (viewportMode === 'flowchart') {
      setToast(
        isAr
          ? 'انتقل إلى عرض 2D أو 3D أو المحاكاة الحية لتسجيل الفيديو.'
          : 'Switch to 2D, 3D, Split, or Simulation view to record live video.',
        'info'
      );
      return;
    }

    try {
      const rec = new ViewportVideoRecorder(() => useAppStore.getState().viewportMode, theme === 'dark');
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
      setToast(
        isAr ? 'بدأ تسجيل الفيديو الحي للمحاكاة…' : 'Live video recording started…',
        'info'
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Video recording failed', 'error');
    }
  };

  if (!initialized) {
    return (
      <div className="flex h-[100dvh] w-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950 text-sm text-neutral-600 dark:text-neutral-300">
        {isAr ? 'جارٍ تحميل مساحة عمل MK LineSim…' : 'Loading MK LineSim workspace…'}
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* Top Engineering Toolbar (hidden in Fullscreen mode) */}
      {!isFullscreen && (
        <header className="pt-safe flex min-h-12 shrink-0 items-center justify-between gap-1.5 sm:gap-4 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 sm:px-3">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarDrawerOpen((v) => !v)}
              className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden shrink-0"
              title={isAr ? 'فتح/إغلاق القائمة' : 'Toggle Menu'}
              aria-label={isAr ? 'فتح/إغلاق القائمة' : 'Toggle Menu'}
            >
              <Menu className="w-4 h-4" />
            </button>
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setActiveModule('layout');
              }}
              className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 group"
              title={`${t.brand} — ${t.appName}`}
            >
              <img
                src="/favicon.svg"
                alt="MK LineSim"
                className="h-7 w-7 rounded shadow-xs shrink-0 transition-transform group-hover:scale-105"
              />
              <span className="text-xs sm:text-sm font-bold tracking-tight text-neutral-950 dark:text-white" dir="ltr">
                {t.appName}
              </span>
            </a>
            <span className="hidden md:inline text-neutral-300 dark:text-neutral-700">|</span>
            <span className="hidden lg:inline truncate text-xs font-medium text-neutral-700 dark:text-neutral-300 max-w-[200px]">
              {project.name}
            </span>
          </div>

          {/* Engineering Edit & IO Actions */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              onClick={() => saveCurrentProject()}
              title={t.actions.save}
              className="flex items-center gap-1 rounded border border-neutral-300 dark:border-neutral-700 px-2 sm:px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5 text-red-600" />
              <span className="hidden sm:inline">
                {saveStatus === 'saving' ? t.actions.saving : saveStatus === 'saved' ? t.actions.saved : t.actions.save}
              </span>
            </button>

            <button
              onClick={undo}
              disabled={undoCount === 0}
              title={`${t.actions.undo} (Ctrl+Z)`}
              className="hidden sm:inline-flex p-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-35 shrink-0"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={redoCount === 0}
              title={`${t.actions.redo} (Ctrl+Y)`}
              className="hidden sm:inline-flex p-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-35 shrink-0"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={copySelectedObjects}
              title={`${t.actions.copy} (Ctrl+C)`}
              className="hidden md:inline-flex p-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={pasteClipboardObjects}
              title={`${t.actions.paste} (Ctrl+V)`}
              className="hidden md:inline-flex p-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => importInputRef.current?.click()}
              title={t.actions.importJson}
              className="hidden md:flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t.actions.importJson}</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await importProjectJson(await f.text());
                e.target.value = '';
              }}
              className="hidden"
            />

            <button
              onClick={handleQuickExportJson}
              title={t.actions.exportJson}
              className="hidden md:flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t.actions.exportJson}</span>
            </button>

            {/* Top Toolbar CAD Export Button & Menu (DXF, STEP, STL, OBJ) */}
            <div ref={cadMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setCadMenuOpen((v) => !v)}
                title={t.actions.cadMenuTitle}
                className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  cadMenuOpen
                    ? 'border-red-600 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <Compass className="w-3.5 h-3.5 text-red-600" />
                <span className="hidden sm:inline">{t.actions.exportCad}</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {cadMenuOpen && (
                <div className="absolute end-0 top-full mt-1.5 z-50 w-64 max-w-[90vw] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-100 dark:border-neutral-800">
                    {t.actions.cadMenuTitle}
                  </div>
                  {(
                    [
                      { fmt: 'dxf', label: t.actions.exportDxf },
                      { fmt: 'step', label: t.actions.exportStep },
                      { fmt: 'stl', label: t.actions.exportStl },
                      { fmt: 'obj', label: t.actions.exportObj },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.fmt}
                      type="button"
                      onClick={() => {
                        exportProjectCad(item.fmt);
                        setCadMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-start text-xs text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <span>{item.label}</span>
                      <span className="font-mono-tabular text-[10px] font-semibold uppercase text-red-600">
                        .{item.fmt}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* In-App PWA Install Button (Desktop / Android / iPhone) */}
            <PWAInstallButton />

            <button
              onClick={() => setGuideOpen(true)}
              title={t.actions.guide}
              className="hidden sm:flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5 text-red-600" />
              <span className="hidden lg:inline">{t.actions.guide}</span>
            </button>

            <button
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
              className="rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
            >
              {language === 'en' ? 'العربية' : 'EN'}
            </button>
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              title={isAr ? 'تبديل الوضع الفاتح/الداكن' : 'Toggle Light/Dark Theme'}
              className="p-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
            >
              {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>
      )}

      {/* Main Engineering Body */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop Module Rail (docked md+) */}
        {!isFullscreen && (
          <nav className="hidden md:flex w-16 shrink-0 flex-col items-center gap-1 border-e border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 py-2 overflow-y-auto z-30">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (activeModule === item.id && !isFullPageModule) {
                      setSidebarDrawerOpen((v) => !v);
                    } else {
                      setActiveModule(item.id);
                      if (item.id === 'simulation') setViewportMode('simulation');
                      setSidebarDrawerOpen(true);
                    }
                  }}
                  className={`flex w-14 flex-col items-center gap-0.5 rounded py-1.5 px-1 text-[10px] font-medium transition-colors ${
                    active
                      ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate w-full text-center">{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Mobile / Tablet Backdrops */}
        {!isFullscreen && sidebarDrawerOpen && (
          <div
            onClick={() => setSidebarDrawerOpen(false)}
            className="fixed inset-0 top-12 z-30 bg-black/35 md:hidden"
          />
        )}
        {!isFullscreen && !isFullPageModule && mobilePropsOpen && (
          <div
            onClick={() => setMobilePropsOpen(false)}
            className="fixed inset-0 top-12 z-30 bg-black/35 lg:hidden"
          />
        )}

        {/* Mobile Full-Navigation Slide-over (Rail + Contextual Panel) */}
        {!isFullscreen && sidebarDrawerOpen && (
          <div className="fixed inset-y-0 top-12 start-0 z-40 flex max-w-[94vw] shadow-2xl md:hidden">
            <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-e border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 py-2 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                const targetIsFull =
                  item.id === 'analytics' ||
                  item.id === 'scenarios' ||
                  item.id === 'reports' ||
                  item.id === 'validation';
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveModule(item.id);
                      if (item.id === 'simulation') setViewportMode('simulation');
                      if (targetIsFull) setSidebarDrawerOpen(false);
                    }}
                    className={`flex w-14 min-h-[44px] flex-col items-center justify-center gap-0.5 rounded py-1.5 px-1 text-[10px] font-medium transition-colors ${
                      active
                        ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate w-full text-center">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <aside className="flex flex-col w-[min(18rem,calc(94vw-4rem))] border-e border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
                <h2 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                  {navItems.find((n) => n.id === activeModule)?.label}
                </h2>
                <button
                  onClick={() => setSidebarDrawerOpen(false)}
                  className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  title={t.actions.close}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Quick mobile utilities bar inside drawer (Undo, Redo, Import, Export JSON, Guide) */}
              <div className="flex items-center justify-between gap-1 border-b border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 bg-neutral-50/70 dark:bg-neutral-950/50">
                <div className="flex items-center gap-1">
                  <button
                    onClick={undo}
                    disabled={undoCount === 0}
                    title={t.actions.undo}
                    className="p-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 disabled:opacity-35"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={redo}
                    disabled={redoCount === 0}
                    title={t.actions.redo}
                    className="p-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 disabled:opacity-35"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    title={t.actions.importJson}
                    className="p-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleQuickExportJson}
                    title={t.actions.exportJson}
                    className="p-1.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => {
                    setGuideOpen(true);
                    setSidebarDrawerOpen(false);
                  }}
                  title={t.actions.guide}
                  className="flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px] font-medium"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-red-600" />
                  <span>{t.actions.guide}</span>
                </button>
              </div>

              {!isFullPageModule && (
                <>
                  {activeModule === 'projects' && <ProjectsModule />}
                  {activeModule === 'factory' && <FactoryModule />}
                  {activeModule === 'layout' && <LayoutModule />}
                  {activeModule === 'equipment' && <EquipmentModule />}
                  {activeModule === 'products' && <ProductsModule />}
                  {activeModule === 'processes' && <ProcessesModule />}
                  {activeModule === 'workforce' && <WorkforceModule />}
                  {activeModule === 'simulation' && <SimulationInspectorModule />}
                </>
              )}
            </aside>
          </div>
        )}

        {/* Desktop Left Contextual Tool Drawer (docked on md+) */}
        {!isFullscreen && !isFullPageModule && sidebarDrawerOpen && (
          <aside className="hidden md:block w-72 shrink-0 border-e border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
              <h2 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                {navItems.find((n) => n.id === activeModule)?.label}
              </h2>
              {validationIssues.length > 0 && (
                <button
                  onClick={() => {
                    clearSelection();
                    if (window.innerWidth < 1024) setMobilePropsOpen(true);
                  }}
                  title={t.labels.validation}
                  className="text-[10px] font-mono-tabular text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {validationIssues.length} {t.labels.alertsCount}
                </button>
              )}
            </div>

            {activeModule === 'projects' && <ProjectsModule />}
            {activeModule === 'factory' && <FactoryModule />}
            {activeModule === 'layout' && <LayoutModule />}
            {activeModule === 'equipment' && <EquipmentModule />}
            {activeModule === 'products' && <ProductsModule />}
            {activeModule === 'processes' && <ProcessesModule />}
            {activeModule === 'workforce' && <WorkforceModule />}
            {activeModule === 'simulation' && <SimulationInspectorModule />}
          </aside>
        )}

        {/* Central Workspace */}
        <main className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
          {isFullPageModule ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeModule === 'analytics' && <AnalyticsModule />}
              {activeModule === 'scenarios' && <ScenariosModule />}
              {activeModule === 'reports' && <ReportsModule />}
              {activeModule === 'validation' && <EngineeringValidationCenterModule />}
            </div>
          ) : (
            <>
              {/* Workspace Viewport Mode Switcher, 3D Camera, Live Capture & Fullscreen */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 sm:px-3 py-1.5">
                <div className="flex items-center gap-1 rounded bg-neutral-100 dark:bg-neutral-800 p-0.5 overflow-x-auto max-w-full">
                  {[
                    { id: '2d', label: t.views.view2d, icon: Layers },
                    { id: '3d', label: t.views.view3d, icon: Box },
                    { id: 'split', label: t.views.split, icon: Columns2 },
                    { id: 'flowchart', label: t.views.flowchart, icon: Workflow },
                    { id: 'simulation', label: t.views.liveSim, icon: Activity },
                  ].map((v) => {
                    const Icon = v.icon;
                    const active = viewportMode === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setViewportMode(v.id as typeof viewportMode)}
                        className={`flex items-center gap-1 sm:gap-1.5 rounded px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-white dark:bg-neutral-900 text-neutral-950 dark:text-white shadow-sm'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${v.id === 'flowchart' && active ? 'text-red-600' : ''}`} />
                        <span>{v.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Toolbar: 3D Camera + Capture Photo/Video + Mobile Props + Fullscreen */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {viewportMode !== '2d' && viewportMode !== 'flowchart' && (
                    <>
                      <div className="flex items-center gap-0.5 rounded border border-neutral-200 dark:border-neutral-800 p-0.5">
                        {(['perspective', 'top', 'front', 'side'] as CameraPreset[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => setCameraPreset(p)}
                            className={`rounded px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] ${
                              cameraPreset === p
                                ? 'bg-red-600 text-white font-medium'
                                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            {t.camera[p]}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          setVisualVariant(visualVariant === 'realistic' ? 'engineering' : 'realistic')
                        }
                        className="hidden sm:inline-flex rounded border border-neutral-200 dark:border-neutral-800 px-2.5 py-1 text-[11px] font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
                      >
                        {visualVariant === 'realistic' ? t.labels.realistic : t.labels.engineering}
                      </button>
                    </>
                  )}

                  {/* Capture Live Photo PNG */}
                  <button
                    type="button"
                    onClick={() => void handleCapturePhoto()}
                    title={t.actions.capturePhoto}
                    className="flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5 text-red-600" />
                    <span className="hidden md:inline">{t.actions.capturePhoto}</span>
                  </button>

                  {/* Record Live Video WebM */}
                  {viewportMode !== 'flowchart' && (
                    <button
                      type="button"
                      onClick={() => void handleToggleRecording()}
                      title={isRecording ? t.actions.stopRecording : t.actions.recordVideo}
                      className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                        isRecording
                          ? 'border-red-600 bg-red-600 text-white animate-pulse'
                          : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      {isRecording ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : (
                        <Video className="w-3.5 h-3.5 text-red-600" />
                      )}
                      <span className="hidden md:inline">
                        {isRecording ? t.actions.stopRecording : t.actions.recordVideo}
                      </span>
                      {isRecording && (
                        <span className="font-mono-tabular text-[10px]">
                          {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:
                          {String(recSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </button>
                  )}

                  {/* Mobile/Tablet Properties Drawer Button */}
                  {!isFullscreen && (
                    <button
                      type="button"
                      onClick={() => setMobilePropsOpen((v) => !v)}
                      title={t.labels.properties}
                      className={`lg:hidden flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                        selection.ids.length > 0
                          ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30'
                          : 'border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t.labels.properties}</span>
                    </button>
                  )}

                  {/* Fullscreen Toggle */}
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
                    className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                      isFullscreen
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">
                      {isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
                    </span>
                  </button>
                </div>
              </div>

              {/* Synchronized 2D / 3D / Flowchart Canvas Area */}
              <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
                {viewportMode === 'flowchart' ? (
                  <div className="w-full h-full min-w-0">
                    <FlowchartRoutingCanvas />
                  </div>
                ) : (
                  <>
                    {(viewportMode === '2d' || viewportMode === 'split') && (
                      <div
                        className={`${
                          viewportMode === 'split'
                            ? 'h-1/2 md:h-full w-full md:w-1/2 border-b md:border-b-0 md:border-e border-neutral-200 dark:border-neutral-800'
                            : 'w-full h-full'
                        } min-w-0 min-h-0`}
                      >
                        <Workspace2D />
                      </div>
                    )}
                    {(viewportMode === '3d' ||
                      viewportMode === 'split' ||
                      viewportMode === 'simulation') && (
                      <div
                        className={`${
                          viewportMode === 'split' ? 'h-1/2 md:h-full w-full md:w-1/2' : 'w-full h-full'
                        } min-w-0 min-h-0`}
                      >
                        <Workspace3D />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* Persistent Bottom Simulation Bar (hidden only when viewing Analytics/Scenarios/Reports in fullscreen) */}
          {!(isFullscreen && isFullPageModule) && <BottomSimPanel />}
        </main>

        {/* Right Contextual Properties Panel (Docked on lg+, Slide-over Drawer on Mobile/Tablet) */}
        {!isFullscreen && !isFullPageModule && (
          <>
            <div className="hidden lg:block h-full">
              <PropertiesPanel />
            </div>
            {mobilePropsOpen && (
              <div className="fixed inset-y-12 end-0 z-40 flex h-[calc(100dvh-3rem)] max-w-[88vw] shadow-2xl lg:hidden">
                <PropertiesPanel />
              </div>
            )}
          </>
        )}
      </div>

      {/* Prominent Copyright & Contact Footer Bar (hidden in Fullscreen) */}
      {!isFullscreen && (
        <footer className="pb-safe flex flex-wrap min-h-9 shrink-0 items-center justify-between gap-2 sm:gap-3 border-t-2 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 sm:px-4 py-1 text-[10px] sm:text-xs">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600 shrink-0" />
            <span className="font-semibold text-neutral-900 dark:text-white leading-snug truncate max-w-[58vw] sm:max-w-none">
              {t.copyright}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href="tel:01200224513"
              className="flex items-center gap-1 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 font-semibold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
              title={t.phoneLabel}
            >
              <Phone className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="hidden md:inline text-[11px]">{t.phoneLabel}:</span>
              <span className="font-mono-tabular font-bold tracking-wide" dir="ltr">
                {t.phoneNumber}
              </span>
            </a>
            <span className="hidden lg:inline font-mono-tabular text-[11px] font-semibold text-neutral-600 dark:text-neutral-400" dir="ltr">
              {t.brand} · {t.appName} v1.0
            </span>
          </div>
        </footer>
      )}

      <HelpGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      <OfflineIndicator />

      {/* Transient Engineering Toast Feedback */}
      {toastMessage && (
        <div
          className={`fixed bottom-16 end-3 sm:end-5 z-50 max-w-[90vw] rounded border px-3.5 py-2 text-xs font-medium shadow-md ${
            toastMessage.type === 'error'
              ? 'border-red-300 bg-red-600 text-white'
              : toastMessage.type === 'success'
              ? 'border-emerald-300 bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'border-neutral-300 bg-neutral-900 text-white'
          }`}
        >
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}
