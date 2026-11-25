import React, { useState } from 'react';
import { Box, Boxes, Compass, FileCode2, FileDown, FileJson, FileSpreadsheet, ImageDown, Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getT } from '../../i18n/translations';
import {
  export2DFactoryCanvasPdf,
  exportKpiCanvasPdf,
  exportScenariosCanvasPdf,
} from '../../utils/reportExporter';
import { downloadDataUrl, sanitizeFilename } from '../../utils/mediaCapture';
import { isEventLogTruncated } from '../../utils/units';
import { betaLimitsText } from '../../utils/betaLimits';
import { eventsCsvNoticeText, exportDisclosureLines, projectJsonText, resultProvenance } from '../../utils/importNotes';

export const ReportsModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const simAllEvents = useAppStore((s) => s.simAllEvents);
  const capture3DPng = useAppStore((s) => s.capture3DPng);
  const isFullscreen = useAppStore((s) => s.isFullscreen);
  const toggleFullscreen = useAppStore((s) => s.toggleFullscreen);
  const exportProjectCad = useAppStore((s) => s.exportProjectCad);
  const setToast = useAppStore((s) => s.setToast);
  const language = useAppStore((s) => s.language);

  const t = getT(language);
  const isAr = language === 'ar';

  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4');

  const result = simSnapshot.result || project.lastSimulationResult;

  const export2DFactoryPdf = (lineOnly = false) => {
    export2DFactoryCanvasPdf(project, { orientation, paperSize, isAr, lineOnly });
    setToast(
      isAr
        ? `تم تصدير مخطط ${lineOnly ? 'خط الإنتاج' : 'المصنع'} PDF بدعم اللغة العربية`
        : `Exported ${lineOnly ? 'Production Line' : 'Factory'} 2D PDF`,
      'success'
    );
  };

  const exportKpiPdf = () => {
    if (!result) {
      setToast(
        isAr ? 'قم بتشغيل المحاكاة أولاً لإصدار تقرير المؤشرات.' : 'Run a simulation first to generate KPI report.',
        'error'
      );
      return;
    }
    exportKpiCanvasPdf(project, result, { orientation, paperSize, isAr });
    setToast(
      isAr ? 'تم تصدير تقرير مؤشرات الأداء PDF باللغة العربية' : 'Exported Simulation KPI PDF Report',
      'success'
    );
  };

  const exportScenariosPdf = () => {
    exportScenariosCanvasPdf(project, { orientation, paperSize, isAr });
    setToast(
      isAr ? 'تم تصدير مقارنة السيناريوهات PDF' : 'Exported Scenario Comparison PDF',
      'success'
    );
  };

  const handleExportDxf = () => exportProjectCad('dxf');
  const handleExportStep = () => exportProjectCad('step');
  const handleExportStl = () => exportProjectCad('stl');
  const handleExportObj = () => exportProjectCad('obj');

  const export3DPng = async () => {
    const dataUrl = capture3DPng ? capture3DPng() : null;
    if (dataUrl) {
      downloadDataUrl(dataUrl, `${sanitizeFilename(project.name)}_3d_factory.png`);
      setToast(isAr ? 'تم تصدير صورة المصنع 3D PNG' : 'Exported 3D Factory PNG Snapshot', 'success');
      return;
    }
    // No live 3D canvas is available from the Reports view. Never deliver a 2D image under a 3D label.
    setToast(
      isAr
        ? 'لا يوجد عرض 3D نشط لالتقاط صورة. افتح عرض 3D أو المحاكاة واستخدم زر Photo PNG.'
        : 'No live 3D view to capture. Open the 3D or Simulation view and use Photo PNG on its toolbar.',
      'error'
    );
  };

  const exportEventsCsv = () => {
    const events = simAllEvents.length > 0 ? simAllEvents : result?.recentEvents || [];
    if (events.length === 0) {
      setToast(
        isAr ? 'شغّل المحاكاة أولاً لتصدير سجل الأحداث CSV.' : 'Run simulation first to export event log CSV.',
        'error'
      );
      return;
    }
    const header = isAr
      ? 'التسلسل,الزمن_ثانية,نوع_الحدث,معرف_المنتج,المرحلة,المعدة,العامل,التفاصيل\n'
      : 'Seq,TimestampSec,EventType,EntityId,StageId,ObjectId,WorkerId,Details\n';
    const rows = events
      .map(
        (e) =>
          `${e.seq},${e.timestamp.toFixed(3)},${e.type},${e.entityId || ''},${e.stageId || ''},${e.objectId || ''},${e.workerId || ''},"${e.details.replace(/"/g, '""')}"`
      )
      .join('\n');
    const executed = result?.totalEventsExecuted;
    const truncated = isEventLogTruncated(events.length, executed);
    const footer = truncated
      ? `\nTRUNCATED,,,,,,,"INCOMPLETE LOG: only the first ${events.length} of ${executed} executed events are recorded. Events after this point are missing. KPI totals are not affected."`
      : '';
    const noticeLines = [betaLimitsText(isAr), ...exportDisclosureLines(resultProvenance(result), isAr)];
    const noticeFooter = noticeLines
      .map((l) => `\nNOTICE,,,,,,,"${l.replace(/"/g, '""')}"`)
      .join('');
    // UTF-8 BOM ensures Microsoft Excel renders Arabic text without encoding corruption
    const blob = new Blob(['\uFEFF' + header + rows + footer + noticeFooter], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(project.name)}_sim_events.csv`;
    a.click();
    URL.revokeObjectURL(url);
    // Companion notice file so the limits are seen without opening the end of a large CSV. Some browsers ask before a second download.
    const csvName = `${sanitizeFilename(project.name)}_sim_events.csv`;
    const nb = new Blob(['\uFEFF' + eventsCsvNoticeText(resultProvenance(result), csvName)], { type: 'text/plain;charset=utf-8;' });
    const nurl = URL.createObjectURL(nb);
    const na = document.createElement('a');
    na.href = nurl;
    na.download = `${sanitizeFilename(project.name)}_sim_events_NOTICE.txt`;
    setTimeout(() => {
      na.click();
      URL.revokeObjectURL(nurl);
    }, 400);
    if (truncated) {
      setToast(
        isAr
          ? `تحذير: السجل غير كامل. تم تصدير أول ${events.length} حدث فقط من ${executed} حدث نُفّذ.`
          : `Warning: log incomplete. Exported only the first ${events.length} of ${executed} executed events.`,
        'error'
      );
      return;
    }
    setToast(
      isAr ? `تم تصدير ${events.length} حدث إلى ملف CSV (دعم Excel العربي)` : `Exported ${events.length} simulation events to CSV`,
      'success'
    );
  };

  const exportJson = () => {
    const blob = new Blob([projectJsonText(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(project.name)}_project.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(isAr ? 'تم تصدير أرشيف المشروع JSON' : 'Exported Project JSON', 'success');
  };

  const actions = [
    () => export2DFactoryPdf(false),
    () => export2DFactoryPdf(true),
    exportKpiPdf,
    exportScenariosPdf,
    handleExportDxf,
    handleExportStep,
    handleExportStl,
    handleExportObj,
    () => void export3DPng(),
    exportEventsCsv,
    exportJson,
  ];
  const icons = [
    FileDown,
    FileDown,
    FileDown,
    FileDown,
    Compass,
    FileCode2,
    Box,
    Boxes,
    ImageDown,
    FileSpreadsheet,
    FileJson,
  ];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t.reports.title}
            </h2>
            <p className="text-xs text-neutral-500">{t.reports.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5"
            >
              <option value="landscape">{t.reports.landscape}</option>
              <option value="portrait">{t.reports.portrait}</option>
            </select>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as 'a4' | 'letter')}
              className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5"
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium ${
                isFullscreen
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isFullscreen ? t.actions.exitFullscreen : t.actions.fullscreen}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.reports.cards.map((card, i) => {
            const Icon = icons[i];
            return (
              <div
                key={i}
                className="flex flex-col justify-between gap-4 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    <Icon className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{card.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">{card.desc}</p>
                </div>
                <button
                  onClick={actions[i]}
                  className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-900 dark:text-neutral-100 hover:border-red-600 hover:text-red-600 transition-colors"
                >
                  {card.btn}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
