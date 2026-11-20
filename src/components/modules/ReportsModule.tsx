import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import { FileDown, FileSpreadsheet, ImageDown, FileJson } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatDuration } from '../../utils/units';
import { getT } from '../../i18n/translations';

export const ReportsModule: React.FC = () => {
  const project = useAppStore((s) => s.project);
  const simSnapshot = useAppStore((s) => s.simSnapshot);
  const simAllEvents = useAppStore((s) => s.simAllEvents);
  const capture3DPng = useAppStore((s) => s.capture3DPng);
  const setToast = useAppStore((s) => s.setToast);
  const language = useAppStore((s) => s.language);

  const t = getT(language);
  const isAr = language === 'ar';

  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4');

  const result = simSnapshot.result || project.lastSimulationResult;

  const addPdfHeader = (doc: jsPDF, title: string) => {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 20, 'F');
    doc.setFillColor(220, 38, 38);
    doc.rect(0, 20, pageW, 1.5, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.text(`MK TECH  |  MK LineSim — ${title}`, 12, 12.5);
    doc.setFontSize(8.5);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, pageW - 45, 12.5);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9.5);
    doc.text(`Project: ${project.name}   |   Factory: ${project.factoryName} (${project.factory.lengthM}m × ${project.factory.widthM}m × ${project.factory.heightM}m)`, 12, 29);
  };

  const draw2DFactoryToPdf = (doc: jsPDF, startY: number, lineOnly = false) => {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - 24;
    const maxH = pageH - startY - 18;
    const scale = Math.min(maxW / project.factory.lengthM, maxH / project.factory.widthM);
    const ox = (pageW - project.factory.lengthM * scale) / 2;
    const oy = startY;

    // Floor boundary
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.rect(ox, oy, project.factory.lengthM * scale, project.factory.widthM * scale);

    if (!lineOnly) {
      for (const z of project.factory.zones) {
        if (!z.visible) continue;
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.2);
        const rx = ox + (z.position.x - z.dimensions.length / 2) * scale;
        const rz = oy + (z.position.z - z.dimensions.width / 2) * scale;
        doc.rect(rx, rz, z.dimensions.length * scale, z.dimensions.width * scale);
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(z.name, rx + 1.5, rz + 4);
      }
    }

    for (const obj of project.layoutObjects) {
      if (!obj.rendering.visible) continue;
      if (lineOnly && !obj.productionLineId) continue;
      const rx = ox + (obj.geometry.position.x - obj.geometry.dimensions.length / 2) * scale;
      const rz = oy + (obj.geometry.position.z - obj.geometry.dimensions.width / 2) * scale;
      const rw = obj.geometry.dimensions.length * scale;
      const rh = obj.geometry.dimensions.width * scale;

      doc.setFillColor(obj.kind === 'conveyor' ? 71 : 51, obj.kind === 'conveyor' ? 85 : 65, 105);
      doc.setDrawColor(15, 23, 42);
      doc.rect(rx, rz, rw, rh, 'FD');
      doc.setFontSize(6);
      doc.setTextColor(255, 255, 255);
      doc.text(obj.name.slice(0, 14), rx + 1, rz + rh / 2 + 1);
    }

    // Workers
    doc.setFillColor(29, 78, 216);
    for (const w of project.workers) {
      doc.circle(ox + w.position.x * scale, oy + w.position.z * scale, 1.3, 'F');
    }

    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8);
    doc.text(
      `Scale: 1m = ${scale.toFixed(2)}mm · Grid: ${project.factory.gridSizeM}m · ${project.layoutObjects.length} equipment objects · ${project.workers.length} operators`,
      12,
      oy + project.factory.widthM * scale + 7
    );
  };

  const export2DFactoryPdf = (lineOnly = false) => {
    const doc = new jsPDF({ orientation, unit: 'mm', format: paperSize });
    addPdfHeader(doc, lineOnly ? '2D Production Line Layout' : '2D Factory Engineering Layout');
    draw2DFactoryToPdf(doc, 36, lineOnly);
    doc.save(`${project.name.replace(/\s+/g, '_')}_${lineOnly ? 'line' : 'factory'}_2d.pdf`);
    setToast(
      isAr
        ? `تم تصدير مخطط ${lineOnly ? 'خط الإنتاج' : 'المصنع'} PDF`
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
    const doc = new jsPDF({ orientation, unit: 'mm', format: paperSize });
    addPdfHeader(doc, 'Simulation KPI & Bottleneck Report');

    const k = result.kpis;
    let y = 38;
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Executive KPI Summary (Calculated from Discrete Event Log)', 12, y);
    y += 6;

    doc.setFontSize(8.5);
    const kpiRows = [
      ['Planned Production', `${k.totalPlannedProduction} units`, 'Actual Good Units', `${k.goodUnits} units`],
      ['Defective / Scrap', `${k.defectiveUnits} units`, 'Attainment', `${k.productionAttainmentPct.toFixed(1)}%`],
      ['Throughput', `${k.hourlyOutput.toFixed(2)} units/hr`, 'Line Efficiency', `${k.lineEfficiencyPct.toFixed(1)}%`],
      ['Avg Lead Time', formatDuration(k.avgLeadTimeSec), 'Avg Cycle Time', `${k.avgCycleTimeSec.toFixed(1)} s`],
      ['Worker Utilization', `${k.workerUtilizationPct.toFixed(1)}%`, 'Machine Utilization', `${k.machineUtilizationPct.toFixed(1)}%`],
      ['Average WIP', `${k.avgWip.toFixed(2)} units`, 'Bottleneck Stage', k.bottleneckStageName || 'N/A'],
    ];

    for (const row of kpiRows) {
      doc.setTextColor(100, 116, 139);
      doc.text(row[0], 12, y);
      doc.setTextColor(15, 23, 42);
      doc.text(row[1], 56, y);
      doc.setTextColor(100, 116, 139);
      doc.text(row[2], 110, y);
      doc.setTextColor(15, 23, 42);
      doc.text(row[3], 155, y);
      y += 6;
    }

    y += 4;
    doc.setFontSize(10.5);
    doc.text('Stage Performance Breakdown', 12, y);
    y += 6;
    doc.setFontSize(8);
    doc.text('Stage | Entered | Done | Avg Cycle (s) | Avg Wait (s) | Max Q | Util % | Blocked %', 12, y);
    y += 5;

    for (const sa of result.stageAnalytics) {
      doc.text(
        `${sa.stageName.slice(0, 24).padEnd(24)} | ${sa.enteredCount} | ${sa.completedCount} | ${sa.avgCycleTimeSec.toFixed(1)}s | ${sa.avgWaitTimeSec.toFixed(1)}s | ${sa.maxQueueLength} | ${sa.utilizationPct.toFixed(1)}% | ${sa.blockedPct.toFixed(1)}% ${sa.isBottleneck ? '[BOTTLENECK]' : ''}`,
        12,
        y
      );
      y += 5;
      if (y > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 20;
      }
    }

    doc.save(`${project.name.replace(/\s+/g, '_')}_kpi_report.pdf`);
    setToast(isAr ? 'تم تصدير تقرير مؤشرات الأداء PDF' : 'Exported Simulation KPI PDF Report', 'success');
  };

  const exportScenariosPdf = () => {
    const doc = new jsPDF({ orientation, unit: 'mm', format: paperSize });
    addPdfHeader(doc, 'Scenario Comparison Report');
    let y = 40;
    doc.setFontSize(9);
    for (const sc of project.scenarios) {
      const k = sc.result?.kpis;
      doc.text(
        `${sc.name} | Workers: ${sc.overrides.workerCount} | Belt: ${sc.overrides.conveyorSpeedMps}m/s | Good: ${k ? k.goodUnits : 'Not Run'} | Attainment: ${k ? k.productionAttainmentPct.toFixed(1) + '%' : '-'} | Bottleneck: ${k?.bottleneckStageName || '-'}`,
        12,
        y
      );
      y += 7;
    }
    doc.save(`${project.name.replace(/\s+/g, '_')}_scenarios.pdf`);
    setToast(isAr ? 'تم تصدير مقارنة السيناريوهات PDF' : 'Exported Scenario Comparison PDF', 'success');
  };

  const export3DPng = () => {
    if (!capture3DPng) {
      setToast(
        isAr
          ? 'انتقل إلى العرض ثلاثي الأبعاد أو المقسم لالتقاط الصورة.'
          : 'Switch to 3D View or Split View briefly to capture the 3D WebGL frame.',
        'error'
      );
      return;
    }
    const dataUrl = capture3DPng();
    if (!dataUrl) {
      setToast(isAr ? 'تعذر التقاط صورة 3D.' : '3D capture unavailable.', 'error');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${project.name.replace(/\s+/g, '_')}_3d_factory.png`;
    a.click();
    setToast(isAr ? 'تم تصدير صورة المصنع 3D PNG' : 'Exported 3D Factory PNG Snapshot', 'success');
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
    const header = 'Seq,TimestampSec,EventType,EntityId,StageId,ObjectId,WorkerId,Details\n';
    const rows = events
      .map(
        (e) =>
          `${e.seq},${e.timestamp.toFixed(3)},${e.type},${e.entityId || ''},${e.stageId || ''},${e.objectId || ''},${e.workerId || ''},"${e.details.replace(/"/g, '""')}"`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_sim_events.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(
      isAr ? `تم تصدير ${events.length} حدث إلى ملف CSV` : `Exported ${events.length} simulation events to CSV`,
      'success'
    );
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_project.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(isAr ? 'تم تصدير أرشيف المشروع JSON' : 'Exported Project JSON', 'success');
  };

  const actions = [
    () => export2DFactoryPdf(false),
    () => export2DFactoryPdf(true),
    exportKpiPdf,
    exportScenariosPdf,
    export3DPng,
    exportEventsCsv,
    exportJson,
  ];
  const icons = [FileDown, FileDown, FileDown, FileDown, ImageDown, FileSpreadsheet, FileJson];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="mx-auto max-w-5xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {t.reports.title}
            </h2>
            <p className="text-xs text-neutral-500">{t.reports.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
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
                    <Icon className="w-4 h-4 text-red-600" />
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
