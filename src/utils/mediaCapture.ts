import { ViewportMode } from '../types/project';

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sanitizeFilename(name: string): string {
  return (name || 'mk_linesim')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_');
}

function get3DCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas[data-linesim-3d="true"]');
}

function get2DSvg(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('svg[data-linesim-2d="true"]');
}

export async function rasterize2DSvgCanvas(isDark = false): Promise<HTMLCanvasElement | null> {
  const svgEl = get2DSvg();
  if (!svgEl) return null;

  const rect = svgEl.getBoundingClientRect();
  const w = Math.max(640, Math.round(rect.width * 2));
  const h = Math.max(400, Math.round(rect.height * 2));

  const cloned = svgEl.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('width', String(Math.max(320, Math.round(rect.width))));
  cloned.setAttribute('height', String(Math.max(200, Math.round(rect.height))));
  cloned.setAttribute(
    'viewBox',
    `0 0 ${Math.max(320, Math.round(rect.width))} ${Math.max(200, Math.round(rect.height))}`
  );

  // Inject solid backdrop matching theme so transparent PNG backgrounds don't turn black
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', isDark ? '#171717' : '#f5f5f5');
  cloned.insertBefore(bg, cloned.firstChild);

  const xml = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = isDark ? '#171717' : '#f5f5f5';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  if (srcW <= 0 || srcH <= 0) return;
  const scale = Math.min(dw / srcW, dh / srcH);
  const rw = srcW * scale;
  const rh = srcH * scale;
  const rx = dx + (dw - rw) / 2;
  const ry = dy + (dh - rh) / 2;
  ctx.drawImage(source, rx, ry, rw, rh);
}

export async function captureViewportPng(
  viewportMode: ViewportMode,
  capture3DPng: (() => string | null) | null,
  isDark = false
): Promise<{ dataUrl: string; suffix: string } | null> {
  if (viewportMode === '3d' || viewportMode === 'simulation') {
    const rawUrl = capture3DPng?.() || get3DCanvas()?.toDataURL('image/png') || null;
    if (!rawUrl) return null;
    return { dataUrl: rawUrl, suffix: viewportMode === 'simulation' ? 'sim_3d' : 'view_3d' };
  }

  if (viewportMode === '2d') {
    const c2d = await rasterize2DSvgCanvas(isDark);
    if (!c2d) return null;
    return { dataUrl: c2d.toDataURL('image/png'), suffix: 'layout_2d' };
  }

  if (viewportMode === 'split') {
    const c2d = await rasterize2DSvgCanvas(isDark);
    const c3dUrl = capture3DPng?.() || get3DCanvas()?.toDataURL('image/png') || null;
    let img3d: HTMLImageElement | null = null;
    if (c3dUrl) {
      img3d = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = c3dUrl;
      });
    }
    if (!c2d && !img3d) return null;

    const out = document.createElement('canvas');
    out.width = 1920;
    out.height = 960;
    const ctx = out.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = isDark ? '#0b0f17' : '#e2e8f0';
    ctx.fillRect(0, 0, out.width, out.height);

    if (c2d) {
      drawCoverImage(ctx, c2d, c2d.width, c2d.height, 0, 0, 956, 960);
    }
    if (img3d) {
      drawCoverImage(ctx, img3d, img3d.width, img3d.height, 964, 0, 956, 960);
    }
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(958, 0, 4, 960);
    return { dataUrl: out.toDataURL('image/png'), suffix: 'split_2d_3d' };
  }

  // Fallback for flowchart or any DOM workspace canvas
  const fcSvg = document.querySelector<SVGSVGElement>('svg[data-linesim-flowchart="true"]');
  if (fcSvg) {
    const rect = fcSvg.getBoundingClientRect();
    const out = document.createElement('canvas');
    out.width = Math.max(960, Math.round(rect.width));
    out.height = Math.max(540, Math.round(rect.height));
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
      ctx.fillRect(0, 0, out.width, out.height);
      const xml = new XMLSerializer().serializeToString(fcSvg);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = url;
        });
        ctx.drawImage(img, 0, 0, out.width, out.height);
      } catch {
        // ignore
      } finally {
        URL.revokeObjectURL(url);
      }
      return { dataUrl: out.toDataURL('image/png'), suffix: 'flowchart' };
    }
  }

  return null;
}

export class ViewportVideoRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private svgRefreshTimer = 0;
  private last2DCanvas: HTMLCanvasElement | null = null;
  private isDark: boolean;
  private getMode: () => ViewportMode;
  private active = false;
  private refreshing2D = false;

  constructor(getMode: () => ViewportMode, isDark = false) {
    this.getMode = getMode;
    this.isDark = isDark;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable for video capture');
    }
    this.ctx = context;
  }

  public start(): void {
    if (this.active) return;
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not supported in this browser.');
    }

    this.chunks = [];
    this.active = true;

    const refresh2D = async () => {
      if (!this.active || this.refreshing2D) return;
      const m = this.getMode();
      if (m === '2d' || m === 'split') {
        this.refreshing2D = true;
        try {
          const snap = await rasterize2DSvgCanvas(this.isDark);
          if (snap) this.last2DCanvas = snap;
        } finally {
          this.refreshing2D = false;
        }
      }
    };

    void refresh2D();
    this.svgRefreshTimer = window.setInterval(() => {
      void refresh2D();
    }, 180);

    const drawLoop = () => {
      if (!this.active) return;
      const { width: W, height: H } = this.canvas;
      const mode = this.getMode();
      const c3d = get3DCanvas();

      this.ctx.fillStyle = this.isDark ? '#0b0f17' : '#e2e8f0';
      this.ctx.fillRect(0, 0, W, H);

      if (mode === 'split') {
        if (this.last2DCanvas) {
          drawCoverImage(this.ctx, this.last2DCanvas, this.last2DCanvas.width, this.last2DCanvas.height, 0, 0, W / 2 - 2, H);
        }
        if (c3d) {
          drawCoverImage(this.ctx, c3d, c3d.width, c3d.height, W / 2 + 2, 0, W / 2 - 2, H);
        }
        this.ctx.fillStyle = '#dc2626';
        this.ctx.fillRect(W / 2 - 2, 0, 4, H);
      } else if (mode === '2d') {
        if (this.last2DCanvas) {
          drawCoverImage(this.ctx, this.last2DCanvas, this.last2DCanvas.width, this.last2DCanvas.height, 0, 0, W, H);
        }
      } else if (c3d) {
        drawCoverImage(this.ctx, c3d, c3d.width, c3d.height, 0, 0, W, H);
      }

      // Crisp MK LineSim live recording watermark
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      this.ctx.fillRect(14, H - 38, 250, 24);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.fillText('MK Tech · MK LineSim Live Capture', 24, H - 22);

      this.rafId = requestAnimationFrame(drawLoop);
    };
    drawLoop();

    const stream = this.canvas.captureStream(24);
    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
    this.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 })
      : new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        this.chunks.push(ev.data);
      }
    };
    this.mediaRecorder.start(250);
  }

  public stop(): Promise<Blob | null> {
    this.active = false;
    cancelAnimationFrame(this.rafId);
    clearInterval(this.svgRefreshTimer);

    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' });
        this.chunks = [];
        this.mediaRecorder = null;
        recorder.stream.getTracks().forEach((tr) => tr.stop());
        resolve(blob);
      };
      recorder.stop();
    });
  }
}
