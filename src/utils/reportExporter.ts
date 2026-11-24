import { formatBeltSpeed, leadTimeText } from './units';
import { jsPDF } from 'jspdf';
import { ProjectData, SimulationResult } from '../types/project';
import { formatDuration } from './units';
import { downloadBlob, downloadDataUrl, rasterize2DSvgCanvas, sanitizeFilename } from './mediaCapture';

export interface PdfExportOptions {
  orientation: 'landscape' | 'portrait';
  paperSize: 'a4' | 'letter';
  isAr: boolean;
  lineOnly?: boolean;
}

const FONT_STACK = '"Segoe UI", "Tahoma", "Cairo", "IBM Plex Sans Arabic", system-ui, sans-serif';

function createReportCanvas(orientation: 'landscape' | 'portrait'): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const w = orientation === 'landscape' ? 1754 : 1240;
  const h = orientation === 'landscape' ? 1240 : 1754;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx, w, h };
}

function drawReportChrome(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: ProjectData,
  title: string,
  isAr: boolean,
  pageNum = 1,
  totalPages = 1
): number {
  ctx.save();
  // Dark slate header bar
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, 96);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, 96, w, 6);

  ctx.direction = isAr ? 'rtl' : 'ltr';
  ctx.textBaseline = 'middle';

  // Left/Right title
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${FONT_STACK}`;
  ctx.textAlign = isAr ? 'right' : 'left';
  const titleX = isAr ? w - 48 : 48;
  ctx.fillText(`MK Tech  |  MK LineSim — ${title}`, titleX, 48);

  // Date badge on opposite edge
  ctx.font = `600 18px ${FONT_STACK}`;
  ctx.fillStyle = '#cbd5e1';
  ctx.textAlign = isAr ? 'left' : 'right';
  const dateX = isAr ? 48 : w - 48;
  const dateStr = new Date().toLocaleDateString(isAr ? 'ar-EG' : 'en-US');
  ctx.fillText(`${isAr ? 'التاريخ:' : 'Date:'} ${dateStr}`, dateX, 48);

  // Sub-banner metadata
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 102, w, 54);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 156);
  ctx.lineTo(w, 156);
  ctx.stroke();

  ctx.fillStyle = '#334155';
  ctx.font = `600 19px ${FONT_STACK}`;
  ctx.textAlign = isAr ? 'right' : 'left';
  const metaText = isAr
    ? `المشروع: ${project.name}   |   المصنع: ${project.factoryName} (${project.factory.lengthM}م × ${project.factory.widthM}م × ${project.factory.heightM}م)`
    : `Project: ${project.name}   |   Factory: ${project.factoryName} (${project.factory.lengthM}m × ${project.factory.widthM}m × ${project.factory.heightM}m)`;
  ctx.fillText(metaText, titleX, 130);

  // Footer with Eng. Mina Khairat copyright & support phone
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, h - 54, w, 54);
  ctx.fillStyle = '#475569';
  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.textAlign = isAr ? 'right' : 'left';
  const copyrightText = isAr
    ? '© 2026 MK Tech — MK LineSim. جميع الحقوق محفوظة — المهندس مينا خيرت  |  01200224513'
    : '© 2026 MK Tech — MK LineSim. Eng. Mina Khairat. All Rights Reserved.  |  01200224513';
  ctx.fillText(copyrightText, titleX, h - 26);

  ctx.textAlign = isAr ? 'left' : 'right';
  ctx.fillText(
    isAr ? `صفحة ${pageNum} من ${totalPages}` : `Page ${pageNum} / ${totalPages}`,
    dateX,
    h - 26
  );

  ctx.restore();
  return 184;
}

function appendCanvasPagesToPdf(
  canvases: HTMLCanvasElement[],
  opts: PdfExportOptions,
  filename: string
): void {
  const doc = new jsPDF({
    orientation: opts.orientation,
    unit: 'mm',
    format: opts.paperSize,
  });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  canvases.forEach((canvas, idx) => {
    if (idx > 0) doc.addPage();
    const imgData = canvas.toDataURL('image/png');
    doc.addImage(imgData, 'PNG', 0, 0, pw, ph, undefined, 'FAST');
  });
  doc.save(filename);
}

function draw2DPlanOnCanvas(
  ctx: CanvasRenderingContext2D,
  project: ProjectData,
  startY: number,
  canvasW: number,
  canvasH: number,
  isAr: boolean,
  lineOnly: boolean
) {
  const fL = project.factory.lengthM;
  const fW = project.factory.widthM;
  const padX = 72;
  const availW = canvasW - padX * 2;
  const availH = canvasH - startY - 128;
  const scale = Math.min(availW / fL, availH / fW);
  const ox = (canvasW - fL * scale) / 2;
  const oy = startY + (availH - fW * scale) / 2;

  ctx.save();

  // Floor slab
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.fillRect(ox, oy, fL * scale, fW * scale);
  ctx.strokeRect(ox, oy, fL * scale, fW * scale);

  // Metric Grid
  const gStep = Math.max(0.5, project.factory.gridSizeM || 1);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  for (let gx = gStep; gx < fL; gx += gStep) {
    ctx.beginPath();
    ctx.moveTo(ox + gx * scale, oy);
    ctx.lineTo(ox + gx * scale, oy + fW * scale);
    ctx.stroke();
  }
  for (let gz = gStep; gz < fW; gz += gStep) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + gz * scale);
    ctx.lineTo(ox + fL * scale, oy + gz * scale);
    ctx.stroke();
  }

  // Zones
  if (!lineOnly) {
    for (const z of project.factory.zones) {
      if (!z.visible) continue;
      const cx = ox + z.position.x * scale;
      const cz = oy + z.position.z * scale;
      const rw = z.dimensions.length * scale;
      const rh = z.dimensions.width * scale;
      ctx.save();
      ctx.translate(cx, cz);
      ctx.rotate((z.rotationDeg * Math.PI) / 180);
      ctx.fillStyle = `${z.color || '#64748b'}22`;
      ctx.strokeStyle = z.color || '#64748b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
      ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = z.color || '#475569';
      ctx.font = `600 14px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.name, 0, 0, rw - 8);
      ctx.restore();
    }
  }

  // Flow connections & arrows
  for (const obj of project.layoutObjects) {
    if (!obj.rendering.visible) continue;
    for (const tid of obj.connectedToIds) {
      const target = project.layoutObjects.find((o) => o.id === tid && o.rendering.visible);
      if (!target) continue;
      const x1 = ox + obj.geometry.position.x * scale;
      const y1 = oy + obj.geometry.position.z * scale;
      const x2 = ox + target.geometry.position.x * scale;
      const y2 = oy + target.geometry.position.z * scale;
      ctx.save();
      ctx.strokeStyle = obj.kind === 'conveyor' ? '#16a34a' : '#dc2626';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.fillStyle = obj.kind === 'conveyor' ? '#16a34a' : '#dc2626';
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Layout Objects
  for (const obj of project.layoutObjects) {
    if (!obj.rendering.visible) continue;
    if (lineOnly && !obj.productionLineId && !obj.stageId && obj.kind !== 'conveyor') continue;
    const cx = ox + obj.geometry.position.x * scale;
    const cz = oy + obj.geometry.position.z * scale;
    const rw = Math.max(18, obj.geometry.dimensions.length * scale);
    const rh = Math.max(14, obj.geometry.dimensions.width * scale);

    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate((obj.geometry.rotationDeg * Math.PI) / 180);
    ctx.fillStyle =
      obj.kind === 'conveyor'
        ? '#334155'
        : obj.kind === 'workstation'
        ? '#1e3a8a'
        : obj.kind === 'buffer'
        ? '#0f766e'
        : obj.kind === 'storage'
        ? '#92400e'
        : '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
    ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 13px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Keep the label readable: the box keeps its true orientation, but text is never drawn upside down.
    const rotNorm = ((obj.geometry.rotationDeg % 360) + 360) % 360;
    if (rotNorm > 90 && rotNorm <= 270) ctx.rotate(Math.PI);
    {
      // Fit the label without squeezing glyphs: shrink the font, then wrap on a space, then fall back to compression.
      const maxW = rw - 6;
      const weight = '600';
      let size = 13;
      const fitOne = (t: string) => {
        size = 13;
        ctx.font = `${weight} ${size}px ${FONT_STACK}`;
        while (size > 8 && ctx.measureText(t).width > maxW) {
          size -= 1;
          ctx.font = `${weight} ${size}px ${FONT_STACK}`;
        }
        return ctx.measureText(t).width <= maxW;
      };
      if (fitOne(obj.name)) {
        ctx.fillText(obj.name, 0, 0, maxW);
      } else {
        const words = obj.name.split(' ');
        let best: [string, string] | null = null;
        let bestW = Infinity;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' ');
          const b = words.slice(i).join(' ');
          const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
          if (w < bestW) { bestW = w; best = [a, b]; }
        }
        if (best && rh >= 18) {
          size = 13;
          ctx.font = `${weight} ${size}px ${FONT_STACK}`;
          while (size > 7 && Math.max(ctx.measureText(best[0]).width, ctx.measureText(best[1]).width) > maxW) {
            size -= 1;
            ctx.font = `${weight} ${size}px ${FONT_STACK}`;
          }
          ctx.fillText(best[0], 0, -size * 0.55, maxW);
          ctx.fillText(best[1], 0, size * 0.55, maxW);
        } else {
          ctx.fillText(obj.name, 0, 0, maxW);
        }
      }
    }
    ctx.restore();
  }

  // Workers
  for (const w of project.workers) {
    const wx = ox + w.position.x * scale;
    const wz = oy + w.position.z * scale;
    ctx.beginPath();
    ctx.arc(wx, wz, Math.max(10, 0.34 * scale), 0, Math.PI * 2);
    ctx.fillStyle = w.color || '#1d4ed8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 11px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(w.label, wx, wz);
  }

  // Summary Legend bar
  ctx.direction = isAr ? 'rtl' : 'ltr';
  ctx.fillStyle = '#475569';
  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  const totalObjs = project.layoutObjects.length;
  const shownObjs = lineOnly
    ? project.layoutObjects.filter((o) => o.rendering.visible && (o.productionLineId || o.stageId || o.kind === 'conveyor')).length
    : totalObjs;
  const eqAr = lineOnly ? `معدات الخط المعروضة: ${shownObjs} من ${totalObjs} في المصنع` : `المعدات: ${totalObjs}`;
  const eqEn = lineOnly ? `Line objects shown: ${shownObjs} of ${totalObjs} in factory` : `Equipment: ${totalObjs}`;
  const summary = isAr
    ? `الأبعاد: ${fL}م × ${fW}م  ·  الشبكة: ${gStep}م  ·  ${eqAr}  ·  المراحل: ${project.stages.length}  ·  العمال: ${project.workers.length}`
    : `Dimensions: ${fL}m × ${fW}m  ·  Grid: ${gStep}m  ·  ${eqEn}  ·  Stages: ${project.stages.length}  ·  Operators: ${project.workers.length}`;
  ctx.fillText(summary, canvasW / 2, oy + fW * scale + 36);

  ctx.restore();
}

export function export2DFactoryCanvasPdf(project: ProjectData, opts: PdfExportOptions): void {
  const { canvas, ctx, w, h } = createReportCanvas(opts.orientation);
  const title = opts.lineOnly
    ? opts.isAr
      ? 'مخطط خط الإنتاج الهندسي (2D)'
      : '2D Production Line Engineering Layout'
    : opts.isAr
    ? 'مخطط المصنع الهندسي الكامل (2D)'
    : '2D Factory Engineering Layout';
  const startY = drawReportChrome(ctx, w, h, project, title, opts.isAr, 1, 1);
  draw2DPlanOnCanvas(ctx, project, startY, w, h, opts.isAr, Boolean(opts.lineOnly));

  const suffix = opts.lineOnly ? 'line_2d' : 'factory_2d';
  appendCanvasPagesToPdf([canvas], opts, `${sanitizeFilename(project.name)}_${suffix}.pdf`);
}

export async function export2DFactoryPng(project: ProjectData, isAr: boolean): Promise<void> {
  const liveCanvas = await rasterize2DSvgCanvas(false);
  if (liveCanvas) {
    downloadDataUrl(liveCanvas.toDataURL('image/png'), `${sanitizeFilename(project.name)}_2d_layout.png`);
    return;
  }
  const { canvas, ctx, w, h } = createReportCanvas('landscape');
  const title = isAr ? 'مخطط المصنع ثنائي الأبعاد (2D)' : '2D Factory Layout Snapshot';
  const startY = drawReportChrome(ctx, w, h, project, title, isAr, 1, 1);
  draw2DPlanOnCanvas(ctx, project, startY, w, h, isAr, false);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${sanitizeFilename(project.name)}_2d_layout.png`);
  }, 'image/png');
}

export function exportKpiCanvasPdf(
  project: ProjectData,
  result: SimulationResult,
  opts: PdfExportOptions
): void {
  const { isAr } = opts;
  const k = result.kpis;
  // A stalled run has no established bottleneck: report where the flow stops, as a location only.
  const stallIds = new Set((result.stallWarnings || []).map((w) => w.stageId));
  const stalled = stallIds.size > 0;
  const stallNames = result.stageAnalytics.filter((s) => stallIds.has(s.stageId)).map((s) => s.stageName).join(', ');
  const rows = result.stageAnalytics;

  const firstPageRowsCap = opts.orientation === 'landscape' ? 8 : 16;
  const nextPageRowsCap = opts.orientation === 'landscape' ? 14 : 24;
  const remaining = Math.max(0, rows.length - firstPageRowsCap);
  const totalPages = 1 + (remaining > 0 ? Math.ceil(remaining / nextPageRowsCap) : 0);

  const pages: HTMLCanvasElement[] = [];

  // Page 1: KPI Cards + Stage Table Head
  const p1 = createReportCanvas(opts.orientation);
  // A stalled run is not titled as a bottleneck analysis: the report shows where the flow stops.
  const title = stalled
    ? isAr
      ? 'تقرير مؤشرات الأداء وموقع التعليق (KPI)'
      : 'Simulation KPI & Stall Location Report'
    : isAr
      ? 'تقرير مؤشرات الأداء وتحليل الاختناقات (KPI)'
      : 'Simulation KPI & Bottleneck Report';
  let y = drawReportChrome(p1.ctx, p1.w, p1.h, project, title, isAr, 1, totalPages);

  const ctx = p1.ctx;
  ctx.save();
  ctx.direction = isAr ? 'rtl' : 'ltr';

  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 24px ${FONT_STACK}`;
  ctx.textAlign = isAr ? 'right' : 'left';
  const edgeX = isAr ? p1.w - 48 : 48;
  ctx.fillText(
    isAr ? 'ملخص مؤشرات الأداء المحسوبة من محرك الأحداث المتقطعة' : 'Executive KPI Summary (Measured from Discrete Event Engine)',
    edgeX,
    y + 10
  );
  y += 38;

  const kpiCards = [
    {
      label: isAr ? 'الوحدات السليمة' : 'Good Units',
      val: `${k.goodUnits}`,
      sub: isAr ? `الهالك: ${k.defectiveUnits} · الإجمالي: ${k.actualProduction}` : `Scrap: ${k.defectiveUnits} · Total: ${k.actualProduction}`,
    },
    {
      label: isAr ? 'الإنتاج المخطط ونسبة التحقق' : 'Planned & Attainment',
      val: `${k.productionAttainmentPct.toFixed(1)}%`,
      sub: isAr ? `المخطط: ${k.totalPlannedProduction} وحدة` : `Target: ${k.totalPlannedProduction} units`,
    },
    {
      label: isAr ? 'معدل الإنتاج / ساعة' : 'Throughput / Hour',
      val: `${k.hourlyOutput.toFixed(1)} ${isAr ? 'و/س' : 'u/hr'}`,
      sub: isAr ? `متوسط الدورة: ${k.avgCycleTimeSec.toFixed(1)}ث` : `Avg Cycle: ${k.avgCycleTimeSec.toFixed(1)}s`,
    },
    {
      label: stalled ? (isAr ? 'موقع التعليق' : 'Stall Location') : isAr ? 'مرحلة الاختناق' : 'Bottleneck Stage',
      val: stalled ? stallNames || 'N/A' : k.bottleneckStageName || 'N/A',
      sub: isAr ? `كفاءة الخط: ${k.lineEfficiencyPct.toFixed(1)}%` : `Line Eff: ${k.lineEfficiencyPct.toFixed(1)}%`,
    },
    {
      label: isAr ? 'متوسط زمن التسليم' : 'Avg Lead Time',
      val: leadTimeText(k.avgLeadTimeSec),
      sub: isAr ? `تشغيل: ${k.avgProcessingTimeSec.toFixed(0)}ث · انتظار: ${k.avgWaitingTimeSec.toFixed(0)}ث` : `Proc: ${k.avgProcessingTimeSec.toFixed(0)}s · Wait: ${k.avgWaitingTimeSec.toFixed(0)}s`,
    },
    {
      label: isAr ? 'استغلال العمال والماكينات' : 'Worker & Machine Util',
      val: `${k.workerUtilizationPct.toFixed(1)}% / ${k.machineUtilizationPct.toFixed(1)}%`,
      sub: isAr ? `متوسط تحت التشغيل WIP: ${k.avgWip.toFixed(1)}` : `Average WIP: ${k.avgWip.toFixed(1)} units`,
    },
  ];

  const cols = opts.orientation === 'landscape' ? 3 : 2;
  const cardGap = 18;
  const cardW = (p1.w - 96 - cardGap * (cols - 1)) / cols;
  const cardH = 104;

  kpiCards.forEach((c, idx) => {
    const colIdx = idx % cols;
    const rowIdx = Math.floor(idx / cols);
    const visualCol = isAr ? cols - 1 - colIdx : colIdx;
    const cx = 48 + visualCol * (cardW + cardGap);
    const cy = y + rowIdx * (cardH + 14);

    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeRect(cx, cy, cardW, cardH);

    const textPad = isAr ? cx + cardW - 18 : cx + 18;
    ctx.textAlign = isAr ? 'right' : 'left';
    ctx.fillStyle = '#64748b';
    ctx.font = `600 16px ${FONT_STACK}`;
    ctx.fillText(c.label, textPad, cy + 26, cardW - 32);

    ctx.fillStyle = idx === 3 ? '#dc2626' : '#0f172a';
    ctx.font = `bold 24px ${FONT_STACK}`;
    ctx.fillText(c.val, textPad, cy + 58, cardW - 32);

    ctx.fillStyle = '#475569';
    ctx.font = `500 15px ${FONT_STACK}`;
    ctx.fillText(c.sub, textPad, cy + 86, cardW - 32);
  });

  y += Math.ceil(kpiCards.length / cols) * (cardH + 14) + 28;
  ctx.restore();

  const drawStageTableSlice = (
    targetCtx: CanvasRenderingContext2D,
    pw: number,
    startTableY: number,
    slice: typeof rows
  ) => {
    targetCtx.save();
    targetCtx.direction = isAr ? 'rtl' : 'ltr';
    targetCtx.fillStyle = '#0f172a';
    targetCtx.font = `bold 22px ${FONT_STACK}`;
    targetCtx.textAlign = isAr ? 'right' : 'left';
    targetCtx.fillText(
      isAr ? 'تحليل أداء مراحل الإنتاج التفصيلي' : 'Stage Performance Breakdown',
      isAr ? pw - 48 : 48,
      startTableY
    );

    const ty = startTableY + 22;
    const tableW = pw - 96;
    const weights = [0.28, 0.09, 0.09, 0.08, 0.11, 0.11, 0.08, 0.08, 0.08];
    const headers = isAr
      ? ['المرحلة', 'الداخل', 'المكتمل', 'الهالك', 'الدورة (ث)', 'الانتظار (ث)', 'أقصى طابور', 'استغلال%', 'حجب%']
      : ['Stage', 'Entered', 'Done', 'Scrap', 'Cycle (s)', 'Wait (s)', 'Max Q', 'Util %', 'Blocked %'];

    const rowH = 44;
    // Header background
    targetCtx.fillStyle = '#0f172a';
    targetCtx.fillRect(48, ty, tableW, rowH);
    targetCtx.fillStyle = '#ffffff';
    targetCtx.font = `bold 15px ${FONT_STACK}`;
    targetCtx.textBaseline = 'middle';

    let cursorX = isAr ? pw - 48 : 48;
    headers.forEach((hdr, i) => {
      const colW = tableW * weights[i];
      if (isAr) {
        targetCtx.textAlign = i === 0 ? 'right' : 'center';
        targetCtx.fillText(hdr, i === 0 ? cursorX - 12 : cursorX - colW / 2, ty + rowH / 2, colW - 10);
        cursorX -= colW;
      } else {
        targetCtx.textAlign = i === 0 ? 'left' : 'center';
        targetCtx.fillText(hdr, i === 0 ? cursorX + 12 : cursorX + colW / 2, ty + rowH / 2, colW - 10);
        cursorX += colW;
      }
    });

    slice.forEach((sa, idx) => {
      const ry = ty + rowH * (idx + 1);
      const isBn = sa.isBottleneck && !stalled;
      targetCtx.fillStyle = isBn ? '#fef2f2' : stallIds.has(sa.stageId) ? '#fffbeb' : idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      targetCtx.fillRect(48, ry, tableW, rowH);
      targetCtx.strokeStyle = '#e2e8f0';
      targetCtx.lineWidth = 1;
      targetCtx.strokeRect(48, ry, tableW, rowH);

      const vals = [
        isBn ? `${sa.stageName} ★` : stallIds.has(sa.stageId) ? `${sa.stageName} (${isAr ? 'نقطة التعليق' : 'stall point'})` : sa.stageName,
        `${sa.enteredCount}`,
        `${sa.completedCount}`,
        `${sa.scrapCount}`,
        `${sa.avgCycleTimeSec.toFixed(1)}`,
        `${sa.avgWaitTimeSec.toFixed(1)}`,
        `${sa.maxQueueLength}`,
        `${sa.utilizationPct.toFixed(1)}%`,
        `${sa.blockedPct.toFixed(1)}%`,
      ];

      let cx = isAr ? pw - 48 : 48;
      vals.forEach((v, i) => {
        const colW = tableW * weights[i];
        targetCtx.fillStyle = i === 0 && isBn ? '#dc2626' : '#0f172a';
        targetCtx.font = i === 0 && isBn ? `bold 15px ${FONT_STACK}` : `500 15px ${FONT_STACK}`;
        if (isAr) {
          targetCtx.textAlign = i === 0 ? 'right' : 'center';
          targetCtx.fillText(v, i === 0 ? cx - 12 : cx - colW / 2, ry + rowH / 2, colW - 10);
          cx -= colW;
        } else {
          targetCtx.textAlign = i === 0 ? 'left' : 'center';
          targetCtx.fillText(v, i === 0 ? cx + 12 : cx + colW / 2, ry + rowH / 2, colW - 10);
          cx += colW;
        }
      });
    });

    targetCtx.restore();
  };

  const firstSlice = rows.slice(0, firstPageRowsCap);
  drawStageTableSlice(ctx, p1.w, y, firstSlice);

  // Modeled-flow stall notice: shown only when the post-run check flagged a stall.
  if (result.stallWarnings && result.stallWarnings.length > 0) {
    const nameOf = (id: string) => rows.find((r) => r.stageId === id)?.stageName || id;
    const names = Array.from(new Set(result.stallWarnings.map((w) => nameOf(w.stageId)))).join(', ');
    const lines = isAr
      ? [
          `تحذير: الإنتاج في النموذج بيقف عند (${names}) من نقطة معينة في التشغيل (تعليق دفعات أو انسداد متبادل)،`,
          'والأرقام اللي فوق بتعكس الوقوف ده. راجع افتراضات سعة المخزن وحجم الدفعة وخليط المنتجات.',
        ]
      : [
          `Warning: the modeled flow stops at (${names}) from some point in the run (batch stall or blocking deadlock).`,
          'The figures above reflect that stall. Review buffer capacity, batch size and product mix assumptions.',
        ];
    const boxY = y + 22 + 44 * (firstSlice.length + 1) + 24;
    const boxH = 40 + lines.length * 26;
    if (boxY + boxH < p1.h - 90) {
      ctx.save();
      ctx.direction = isAr ? 'rtl' : 'ltr';
      ctx.fillStyle = '#fffbeb';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.fillRect(48, boxY, p1.w - 96, boxH);
      ctx.strokeRect(48, boxY, p1.w - 96, boxH);
      ctx.fillStyle = '#92400e';
      ctx.font = `600 17px ${FONT_STACK}`;
      ctx.textAlign = isAr ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      lines.forEach((ln, i) => {
        ctx.fillText(ln, isAr ? p1.w - 66 : 66, boxY + 32 + i * 26, p1.w - 132);
      });
      ctx.restore();
    }
  }
  pages.push(p1.canvas);

  let offset = firstPageRowsCap;
  let pageIdx = 2;
  while (offset < rows.length) {
    const pN = createReportCanvas(opts.orientation);
    const startY = drawReportChrome(pN.ctx, pN.w, pN.h, project, title, isAr, pageIdx, totalPages);
    drawStageTableSlice(pN.ctx, pN.w, startY + 12, rows.slice(offset, offset + nextPageRowsCap));
    pages.push(pN.canvas);
    offset += nextPageRowsCap;
    pageIdx++;
  }

  appendCanvasPagesToPdf(pages, opts, `${sanitizeFilename(project.name)}_kpi_report.pdf`);
}

export function exportScenariosCanvasPdf(project: ProjectData, opts: PdfExportOptions): void {
  const { isAr } = opts;
  const { canvas, ctx, w, h } = createReportCanvas(opts.orientation);
  const title = isAr ? 'تقرير مقارنة السيناريوهات التشغيلية' : 'What-If Scenario Comparison Report';
  const startY = drawReportChrome(ctx, w, h, project, title, isAr, 1, 1);

  ctx.save();
  ctx.direction = isAr ? 'rtl' : 'ltr';
  const tableW = w - 96;
  const weights = [0.26, 0.08, 0.1, 0.11, 0.11, 0.11, 0.1, 0.13];
  const headers = isAr
    ? ['السيناريو', 'العمال', 'السير م/ث', 'سليم', 'التحقق%', 'زمن التسليم', 'استغلال%', 'الاختناق']
    : ['Scenario', 'Workers', 'Belt m/s', 'Good', 'Attain %', 'Lead Time', 'Worker %', 'Bottleneck'];

  const rowH = 48;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(48, startY, tableW, rowH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 16px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';

  let cursorX = isAr ? w - 48 : 48;
  headers.forEach((hdr, i) => {
    const colW = tableW * weights[i];
    if (isAr) {
      ctx.textAlign = i === 0 ? 'right' : 'center';
      ctx.fillText(hdr, i === 0 ? cursorX - 12 : cursorX - colW / 2, startY + rowH / 2, colW - 10);
      cursorX -= colW;
    } else {
      ctx.textAlign = i === 0 ? 'left' : 'center';
      ctx.fillText(hdr, i === 0 ? cursorX + 12 : cursorX + colW / 2, startY + rowH / 2, colW - 10);
      cursorX += colW;
    }
  });

  project.scenarios.slice(0, 18).forEach((sc, idx) => {
    const ry = startY + rowH * (idx + 1);
    const k = sc.result?.kpis;
    ctx.fillStyle = sc.isBaseline ? '#fef2f2' : idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(48, ry, tableW, rowH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(48, ry, tableW, rowH);

    const stallFlag = sc.result?.stallWarnings && sc.result.stallWarnings.length > 0;
    const vals = [
      stallFlag ? `${sc.name} ${isAr ? '[تعليق مرصود]' : '[stall flagged]'}` : sc.name,
      `${sc.overrides.workerCount}`,
      formatBeltSpeed(sc.overrides.conveyorSpeedMps),
      k ? `${k.goodUnits}` : isAr ? 'لم يعمل' : 'Not Run',
      k ? `${k.productionAttainmentPct.toFixed(1)}%` : '-',
      k ? leadTimeText(k.avgLeadTimeSec, '-') : '-',
      k ? `${k.workerUtilizationPct.toFixed(1)}%` : '-',
      stallFlag ? (isAr ? 'غير محدد (تعليق)' : 'n/a (stall)') : k?.bottleneckStageName || '-',
    ];

    let cx = isAr ? w - 48 : 48;
    vals.forEach((v, i) => {
      const colW = tableW * weights[i];
      ctx.fillStyle = '#0f172a';
      ctx.font = i === 0 ? `bold 15px ${FONT_STACK}` : `500 15px ${FONT_STACK}`;
      const x = isAr ? (i === 0 ? cx - 12 : cx - colW / 2) : i === 0 ? cx + 12 : cx + colW / 2;
      ctx.textAlign = isAr ? (i === 0 ? 'right' : 'center') : i === 0 ? 'left' : 'center';
      if (i === 0) {
        // Scenario names wrap to at most two lines instead of being squeezed into one; a name longer than two lines ends with an ellipsis.
        ctx.font = `bold 14px ${FONT_STACK}`;
        const maxW = colW - 24;
        const words = v.split(/\s+/);
        const lines: string[] = [];
        let cur = '';
        for (const wd of words) {
          const t = cur ? `${cur} ${wd}` : wd;
          if (cur && ctx.measureText(t).width > maxW) {
            lines.push(cur);
            cur = wd;
          } else cur = t;
        }
        if (cur) lines.push(cur);
        if (lines.length > 2) {
          let last = lines.slice(1).join(' ');
          while (last.length > 1 && ctx.measureText(`${last}\u2026`).width > maxW) last = last.slice(0, -1);
          lines.length = 1;
          lines.push(`${last}\u2026`);
        }
        if (lines.length === 1) ctx.fillText(lines[0], x, ry + rowH / 2, maxW);
        else lines.forEach((ln, li) => ctx.fillText(ln, x, ry + rowH / 2 + (li === 0 ? -9 : 9), maxW));
      } else {
        ctx.fillText(v, x, ry + rowH / 2, colW - 10);
      }
      cx += isAr ? -colW : colW;
    });
  });

  ctx.restore();
  appendCanvasPagesToPdf([canvas], opts, `${sanitizeFilename(project.name)}_scenarios.pdf`);
}
