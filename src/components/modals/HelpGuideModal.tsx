import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Box,
  Cpu,
  Factory,
  FileText,
  GitBranch,
  Keyboard,
  Layers,
  Package,
  Phone,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';

interface HelpGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export const HelpGuideModal: React.FC<HelpGuideModalProps> = ({ open, onClose }) => {
  const language = useAppStore((s) => s.language);
  const autoWireForSimulation = useAppStore((s) => s.autoWireForSimulation);
  const startSimulation = useAppStore((s) => s.startSimulation);
  const t = getT(language);
  const isAr = language === 'ar';

  const [tab, setTab] = useState<'quickstart' | 'modules' | 'conveyors' | 'shortcuts'>('quickstart');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4 backdrop-blur-xs">
      <div
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="MK LineSim" className="h-6 w-6 rounded" />
            <div>
              <h2 className="text-sm font-bold text-neutral-950 dark:text-white">
                {isAr ? `دليل استخدام ${t.appName}` : `${t.appName} Engineering User Guide`}
              </h2>
              <p className="text-[11px] text-neutral-500">
                {isAr
                  ? 'شرح شامل لتصميم المصنع، ربط السيور والمنتجات، وتشغيل المحاكاة الحية'
                  : 'Complete guide to factory modeling, conveyor routing, product setup & DES simulation'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={t.actions.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-5 py-2">
          {[
            {
              id: 'quickstart',
              label: isAr ? 'البدء السريع (3 خطوات)' : 'Quick Start (3 Steps)',
              icon: Sparkles,
            },
            {
              id: 'conveyors',
              label: isAr ? 'مشي المنتج على السير' : 'Conveyor & Product Flow',
              icon: PlayCircle,
            },
            {
              id: 'modules',
              label: isAr ? 'شرح كل أجزاء البرنامج' : 'All Modules Reference',
              icon: BookOpen,
            },
            {
              id: 'shortcuts',
              label: isAr ? 'اختصارات لوحة المفاتيح' : 'Keyboard Shortcuts',
              icon: Keyboard,
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id as typeof tab)}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-red-600 text-white'
                    : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 text-xs text-neutral-700 dark:text-neutral-300 space-y-4">
          {tab === 'quickstart' && (
            <div className="space-y-4">
              <div className="rounded border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 p-3.5">
                <h3 className="text-xs font-bold text-red-700 dark:text-red-400 mb-1">
                  {isAr ? 'أسرع طريقة لتشغيل محاكاة ناجحة في ثوانٍ' : 'Fastest Way to Run a Live Simulation'}
                </h3>
                <p className="text-[11px] leading-relaxed">
                  {isAr
                    ? 'برنامج MK LineSim يربط التصميم الهندسي ثنائي وثلاثي الأبعاد بمحرك محاكاة فعلي للأحداث المتقطعة (DES). اتبع الخطوات الثلاث التالية:'
                    : 'MK LineSim connects your 2D/3D layout directly to a Discrete-Event Simulation engine. Follow these 3 steps:'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-1.5">
                  <div className="text-[11px] font-bold text-red-600">
                    {isAr ? '1. صمّم أو ولّد الخط' : '1. Design or Generate Line'}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isAr
                      ? 'من تبويب "تخطيط الخط" اختر التوليد التلقائي (مستقيم، U، L، متوازي، حلقة) واضغط "توليد تخطيط صالح"، أو أضف سيور ومحطات يدوياً.'
                      : 'Open "Layout", pick Auto Generator (Straight, U, L, Parallel, Loop) and click "Generate Feasible Layout", or place conveyors & stations manually.'}
                  </p>
                </div>

                <div className="rounded border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-1.5">
                  <div className="text-[11px] font-bold text-red-600">
                    {isAr ? '2. أضف أو فعّل المنتج' : '2. Add or Activate Product'}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isAr
                      ? 'من تبويب "المنتجات" اكتب اسم المنتج وأبعاده واختر شكله 3D ثم اضغط "إضافة منتج سريع" أو "تفعيل وتشغيل المحاكاة" ليرتبط بكل مراحل الخط.'
                      : 'Open "Products", enter product name, L/W/H, and 3D shape, then click "Quick Add Product" or "Set Active & Run Simulation".'}
                  </p>
                </div>

                <div className="rounded border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-1.5">
                  <div className="text-[11px] font-bold text-red-600">
                    {isAr ? '3. اضغط ربط وتشغيل' : '3. Auto-Wire & Start'}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isAr
                      ? 'اضغط زر "بدء" في الشريط السفلي (أو "تشغيل الوردية كاملة" للتحليل الفوري). سيقوم المحرك بربط السيور والعمال تلقائياً وستشاهد المنتجات تتحرك.'
                      : 'Press "Start" in the bottom bar (or "Run Full Shift" for instant analytics). Missing routes or conveyor links are wired automatically.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3">
                <span className="text-[11px]">
                  {isAr
                    ? 'هل أضفت معدات يدوياً وتريد ربطها وتشغيلها الآن فوراً؟'
                    : 'Placed equipment manually and want to wire & run right now?'}
                </span>
                <button
                  onClick={() => {
                    autoWireForSimulation();
                    startSimulation();
                    onClose();
                  }}
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  {t.actions.quickSim}
                </button>
              </div>
            </div>
          )}

          {tab === 'conveyors' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-neutral-900 dark:text-white">
                {isAr
                  ? 'كيف يتحرك المنتج بسلاسة على أي سير (تلقائي أو يدوي)؟'
                  : 'How Products Move on Any Conveyor (Auto or Manual)'}
              </h3>
              <ul className="list-disc ps-5 space-y-2 text-[11px] leading-relaxed">
                <li>
                  <strong>{isAr ? 'الخطوط المولدة تلقائياً:' : 'Auto-Generated Lines:'}</strong>{' '}
                  {isAr
                    ? 'عند الضغط على "توليد تخطيط صالح للخط"، يقوم البرنامج بوضع السيور والمحطات والعمال وربط كل مرحلة بالسير الخاص بها وبمسار المنتج تلقائياً.'
                    : 'Clicking "Generate Feasible Layout" builds conveyors, stations, workers, stages, and assigns the active product route automatically.'}
                </li>
                <li>
                  <strong>{isAr ? 'السيور المضافة يدوياً:' : 'Manually Placed Conveyors:'}</strong>{' '}
                  {isAr
                    ? 'إذا وضعت سيراً ناقلاً فقط بدون محطات، أو وضعت سيراً مع ماكينات يدوياً، اضغط "ربط تلقائي للمحاكاة" (أو اضغط "بدء" مباشرة). سيقوم النظام بإنشاء نقطة دخول وخروج على طرفي السير وربط المنتج بها فوراً.'
                    : 'If you place a standalone conveyor or manual machines, click "Auto-Wire Line for Simulation" (or press Start directly). MK LineSim automatically creates infeed/outfeed links along the conveyor centerline so products travel across it immediately.'}
                </li>
                <li>
                  <strong>{isAr ? 'تعديل اتجاه وسرعة السير:' : 'Conveyor Direction & Speed:'}</strong>{' '}
                  {isAr
                    ? 'اضغط على أي سير في نافذة 2D أو 3D لتعديل طوله، زاوية دورانه، أو سرعته (م/ث) من لوحة الخصائص على اليمين/اليسار.'
                    : 'Click any conveyor in 2D or 3D to adjust its length, rotation angle, or belt speed (m/s) in the Properties panel.'}
                </li>
                <li>
                  <strong>{isAr ? 'مخطط مسار الإنتاج (Flowchart Routing):' : 'Interactive Flowchart Routing:'}</strong>{' '}
                  {isAr
                    ? 'افتح تبويب "مخطط المسار (Flowchart)" أعلى مساحة العمل واربط نقطة البداية بالمراحل والماكينات ونقطة النهاية بالسحب أو النقر ليتبع محرك المحاكاة مسارك المرسوم حرفياً (بما في ذلك التفرع المتوازي أو تخطي المراحل).'
                    : 'Open the "Routing Flowchart" tab at the top of the workspace and drag wires between Start, Stages, and Finish. The DES simulation executes strictly along your flowchart edges, supporting sequential lines, custom orders, or parallel branching.'}
                </li>
                <li>
                  <strong>{isAr ? 'حل تنبيهات المثلث التحذيري:' : 'Resolving Warning Triangles:'}</strong>{' '}
                  {isAr
                    ? 'إذا ظهر تنبيه (مثل خروج معدة خارج حدود المصنع أو تداخل ماكينتين)، افتح لوحة الخصائص واضغط زر "إصلاح التنبيهات تلقائياً" ليتم ضبط المواضع والمسارات بنقرة واحدة.'
                    : 'If a warning alert appears (e.g. out-of-bounds or overlapping machines), click "Auto-Fix Issues" in the Properties panel to align positions and routes in one click.'}
                </li>
              </ul>
            </div>
          )}

          {tab === 'modules' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  icon: Factory,
                  title: t.modules.factory,
                  desc: isAr
                    ? 'تحديد طول وعرض وارتفاع المصنع، وحدة القياس (m/cm/mm)، مناطق الإنتاج والممرات، الأعمدة، والأبواب.'
                    : 'Define factory length/width/height, units (m/cm/mm), zones, aisles, columns, and doors/loading bays.',
                },
                {
                  icon: Layers,
                  title: t.modules.layout,
                  desc: isAr
                    ? 'التوليد التلقائي للخطوط (مستقيم، U، L، متوازي، حلقة) أو إضافة السيور والمعدات يدوياً والربط التلقائي.'
                    : 'Auto-generate Straight, U, L, Parallel, Loop lines or place conveyors & equipment manually + Auto-Wire.',
                },
                {
                  icon: Wrench,
                  title: t.modules.equipment,
                  desc: isAr
                    ? 'مكتبة شاملة للمعدات الصناعية مع إمكانية إنشاء وحفظ معداتك الخاصة بأبعاد وأزمنة مخصصة.'
                    : 'Industrial equipment catalog plus custom equipment creator saved to your local IndexedDB library.',
                },
                {
                  icon: Package,
                  title: t.modules.products,
                  desc: isAr
                    ? 'إضافة المنتجات بأبعادها وشكلها 3D ولونها والكمية المستهدفة وتحديد مسار المراحل أو تفعيلها فوراً.'
                    : 'Add products with L/W/H, 3D shape, color, target quantity, and activate on the production line.',
                },
                {
                  icon: Cpu,
                  title: t.modules.processes,
                  desc: isAr
                    ? 'تعديل أزمنة التشغيل، عدد العمال المطلوب، سعة المخازن الوسيطة (Buffer)، ونسبة الهالك لكل مرحلة.'
                    : 'Configure processing times, required operators, WIP buffer capacity, and scrap rate per stage.',
                },
                {
                  icon: Box,
                  title: isAr ? 'العرض 2D و 3D والقياس' : '2D CAD & 3D Viewport',
                  desc: isAr
                    ? 'اسحب المعدات مباشرة في 2D، أو حرّك الكاميرا في 3D، واستخدم أداة القياس لحساب المسافات بين أي نقطتين.'
                    : 'Drag equipment directly in 2D CAD, orbit/pan in 3D, switch Realistic/Engineering styles, and measure distances.',
                },
                {
                  icon: BarChart3,
                  title: t.modules.analytics,
                  desc: isAr
                    ? 'رسوم بيانية حقيقية لمعدل الإنتاج، زمن الدورة، طوابير الانتظار، كفاءة الخط، واستغلال العمال والماكينات.'
                    : 'Real Chart.js dashboards of throughput, cycle/wait times, WIP, utilization, and bottleneck detection.',
                },
                {
                  icon: GitBranch,
                  title: t.modules.scenarios,
                  desc: isAr
                    ? 'مقارنة سيناريوهات التشغيل (تغيير عدد العمال، سرعة السير، أزمنة التشغيل) واختيار أفضل تصميم.'
                    : 'Test what-if scenarios across staffing, speed, buffer size, and shift duration via Web Worker.',
                },
                {
                  icon: FileText,
                  title: t.modules.reports,
                  desc: isAr
                    ? 'تصدير مخطط 2D PDF، تقرير KPI PDF، مقارنة السيناريوهات، صورة 3D PNG، سجل الأحداث CSV، وملف JSON.'
                    : 'Export scaled 2D PDF layouts, KPI & scenario PDFs, 3D PNG renders, CSV event traces, and JSON archives.',
                },
              ].map((m, idx) => {
                const Icon = m.icon;
                return (
                  <div
                    key={idx}
                    className="rounded border border-neutral-200 dark:border-neutral-800 p-3 flex items-start gap-2.5"
                  >
                    <Icon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-white">{m.title}</div>
                      <div className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">{m.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { key: 'Ctrl + Z', desc: isAr ? 'تراجع عن آخر تعديل' : 'Undo last layout edit' },
                { key: 'Ctrl + Y / Ctrl+Shift+Z', desc: isAr ? 'إعادة التعديل' : 'Redo layout edit' },
                { key: 'Ctrl + S', desc: isAr ? 'حفظ المشروع محلياً' : 'Save project to IndexedDB' },
                { key: 'Ctrl + C', desc: isAr ? 'نسخ العنصر المحدد' : 'Copy selected object(s)' },
                { key: 'Ctrl + V', desc: isAr ? 'لصق العنصر المنسوخ' : 'Paste copied object(s)' },
                { key: 'Delete / Backspace', desc: isAr ? 'حذف العنصر المحدد' : 'Delete selected object' },
                {
                  key: isAr ? 'سحب بالماوس (2D)' : 'Mouse Drag (2D)',
                  desc: isAr ? 'تحريك المعدات والعمال والالتقاط بالشبكة' : 'Move equipment & workers with grid snap',
                },
                {
                  key: isAr ? 'بكرة الماوس (2D/3D)' : 'Mouse Wheel (2D/3D)',
                  desc: isAr ? 'تكبير وتصغير العرض' : 'Zoom in and out smoothly',
                },
              ].map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded border border-neutral-200 dark:border-neutral-800 px-3 py-2"
                >
                  <span className="text-[11px]">{s.desc}</span>
                  <kbd className="rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 font-mono-tabular text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 font-semibold text-neutral-800 dark:text-neutral-200">
              <ShieldCheck className="w-4 h-4 text-red-600" />
              {t.copyright}
            </span>
            <a
              href="tel:01200224513"
              className="flex items-center gap-1 rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 font-mono-tabular text-[11px] font-bold text-red-700 dark:text-red-400"
              dir="ltr"
            >
              <Phone className="w-3 h-3" />
              <span>01200224513</span>
            </a>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t.actions.close}
          </button>
        </div>
      </div>
    </div>
  );
};
