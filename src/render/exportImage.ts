import type { PanoramaScene } from '../horizon/scene';
import { layoutStyleLabels, type LabelCandidate } from './labelLayout';
import type { LabeledPeak } from './labels';
import type { PanoramaStyle, RenderOptions } from './style';
import { createViewTransform, wrap360 } from './viewTransform';

/** iOS Safari refuses canvases above this many pixels. */
export const EXPORT_MAX_PIXELS = 16_000_000;
/** Default resolution of the full 360 degree export. */
export const EXPORT_PX_PER_DEG = 16;
/** Strips are rendered one at a time so the main thread stays responsive. */
const STRIP_PX = 256;
const FOOTER_BACKGROUND = '#F4F6F7';
const FOOTER_INK = '#1F2A33';
const FOOTER_FONT = '"Atkinson Hyperlegible", system-ui, sans-serif';

export interface ExportPlan {
  pxPerDeg: number;
  /** Width and height of the panorama part, px. */
  width: number;
  plotHeight: number;
  footerHeight: number;
  /** Text size of the footer's main line, px. */
  footerFontPx: number;
}

/** Footer text size grows with the image so it stays legible when the image is shrunk. */
export function footerFontFor(width: number): number {
  return Math.min(48, Math.max(14, Math.round(width / 90)));
}

/**
 * Pixel size of an export. Starts from the wanted resolution and lowers it until the whole
 * image (footer included) fits the canvas pixel cap.
 */
export function planExport(
  fovDeg: number,
  angleSpanDeg: number,
  exaggeration: number,
  wantedPxPerDeg: number,
  maxPixels = EXPORT_MAX_PIXELS,
): ExportPlan {
  let pxPerDeg = wantedPxPerDeg;
  for (;;) {
    const width = Math.max(1, Math.round(fovDeg * pxPerDeg));
    const plotHeight = Math.max(1, Math.round(angleSpanDeg * pxPerDeg * exaggeration));
    const footerFontPx = footerFontFor(width);
    const footerHeight = Math.round(footerFontPx * 4.2);
    if (width * (plotHeight + footerHeight) <= maxPixels) {
      return { pxPerDeg, width, plotHeight, footerHeight, footerFontPx };
    }
    pxPerDeg *= 0.95;
  }
}

/**
 * The start azimuth for a full-circle image that cuts the fewest labels at its left and right
 * edges, preferring north. Each label occupies the azimuth range from its summit to its box.
 */
export function bestSeamAz(labels: readonly LabeledPeak[], pxPerDeg: number): number {
  const extents = labels.map((l) => {
    const ends = [0, l.box.dx / pxPerDeg, (l.box.dx + l.box.w) / pxPerDeg].map((d) => l.az + d);
    return { lo: Math.min(...ends), hi: Math.max(...ends) };
  });
  const covering = (az: number) =>
    extents.filter((e) => [az - 360, az, az + 360].some((a) => a >= e.lo && a <= e.hi)).length;
  let best = 0;
  let bestCost = Infinity;
  for (let az = 0; az < 360; az += 0.5) {
    const cost = covering(az);
    const distFromNorth = Math.min(az, 360 - az);
    if (cost < bestCost || (cost === bestCost && distFromNorth < Math.min(best, 360 - best))) {
      best = az;
      bestCost = cost;
    }
  }
  return best;
}

/** Scale (<= 1) that makes text of the given width fit into the available width. */
export function fitScale(textWidth: number, availableWidth: number): number {
  return textWidth <= availableWidth || textWidth === 0 ? 1 : availableWidth / textWidth;
}

export interface ExportRequest {
  scene: PanoramaScene;
  style: PanoramaStyle;
  opts: RenderOptions;
  exaggeration: number;
  /** Peaks to label, or null for none. */
  labelPeaks: readonly LabelCandidate[] | null;
  /** Left edge azimuth; null picks the best seam (only sensible for a full circle). */
  azStart: number | null;
  fovDeg: number;
  angleTop: number;
  angleBottom: number;
  wantedPxPerDeg: number;
  /** Footer lines: title, details, attribution. */
  footer: readonly [string, string, string];
}

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Renders the request into one canvas, strip by strip, yielding between strips so the page
 * stays responsive, and reporting progress as (strips done, strips total). The style renders
 * each strip exactly as it renders viewer tiles: from absolute azimuth and angle.
 */
export async function renderExport(
  req: ExportRequest,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const plan = planExport(
    req.fovDeg,
    req.angleTop - req.angleBottom,
    req.exaggeration,
    req.wantedPxPerDeg,
  );
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.plotHeight + plan.footerHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  const labels = req.labelPeaks
    ? layoutStyleLabels(
        req.labelPeaks,
        req.style.labelStyle,
        { pxPerDeg: plan.pxPerDeg, exaggeration: req.exaggeration, angleTop: req.angleTop },
        ctx,
      )
    : null;
  const azStart = req.azStart ?? (labels ? bestSeamAz(labels, plan.pxPerDeg) : 0);
  const opts: RenderOptions = { ...req.opts, labels };

  const strips = Math.ceil(plan.width / STRIP_PX);
  for (let i = 0; i < strips; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const x0 = i * STRIP_PX;
    const width = Math.min(STRIP_PX, plan.width - x0);
    const view = createViewTransform({
      width,
      height: plan.plotHeight,
      azStart: wrap360(azStart + x0 / plan.pxPerDeg),
      pxPerDeg: plan.pxPerDeg,
      angleAtTop: req.angleTop,
      exaggeration: req.exaggeration,
    });
    ctx.save();
    ctx.translate(x0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, width, plan.plotHeight);
    ctx.clip();
    req.style.render(ctx, req.scene, view, opts);
    ctx.restore();
    onProgress(i + 1, strips);
    await nextTurn();
  }
  drawFooter(ctx, plan, req.footer);
  return canvas;
}

/** Title, details and attribution on a plain strip under the panorama. */
function drawFooter(
  ctx: CanvasRenderingContext2D,
  plan: ExportPlan,
  lines: readonly [string, string, string],
): void {
  const top = plan.plotHeight;
  const pad = plan.footerFontPx;
  ctx.fillStyle = FOOTER_BACKGROUND;
  ctx.fillRect(0, top, plan.width, plan.footerHeight);
  ctx.fillStyle = FOOTER_INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const specs = [
    { text: lines[0], size: plan.footerFontPx * 1.15, weight: 700, y: 1.5 },
    { text: lines[1], size: plan.footerFontPx * 0.85, weight: 400, y: 2.55 },
    { text: lines[2], size: plan.footerFontPx * 0.72, weight: 400, y: 3.5 },
  ];
  for (const { text, size, weight, y } of specs) {
    ctx.font = `${weight} ${size}px ${FOOTER_FONT}`;
    const scale = fitScale(ctx.measureText(text).width, plan.width - 2 * pad);
    ctx.font = `${weight} ${size * scale}px ${FOOTER_FONT}`;
    ctx.fillText(text, pad, top + y * plan.footerFontPx);
  }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      'image/png',
    ),
  );
}
