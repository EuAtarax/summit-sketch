import type { ViewTransform } from './viewTransform';

/** How a style draws peak labels. Every style must stay readable on its own background. */
export interface LabelStyle {
  fontFamily: string;
  fontWeight: number;
  /** CSS px. */
  fontPx: number;
  color: string;
  /** Stroke drawn under the text so it stays readable on any background; null for none. */
  halo: string | null;
  /** A filled chip behind the text; null for none. */
  chip: { fill: string; stroke: string | null } | null;
  leader: { color: string; width: number; dash: readonly number[] };
  uppercase: boolean;
}

/** Label box relative to the summit anchor, in CSS px (y grows downward). */
export interface LabelBox {
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/** A placed label: the peak's absolute position plus where its box sits relative to it. */
export interface LabeledPeak {
  id: number;
  name: string;
  az: number;
  angle: number;
  box: LabelBox;
}

export interface LabelMetrics {
  height: number;
  padX: number;
  /** Minimum leader length between the summit and the label box. */
  leaderMin: number;
  /** Empty space kept between neighbouring labels. */
  spacing: number;
}

export function labelMetrics(style: LabelStyle): LabelMetrics {
  return {
    height: Math.round(style.fontPx * 1.3),
    padX: Math.round(style.fontPx * 0.4),
    leaderMin: Math.round(style.fontPx * 0.5),
    spacing: 2,
  };
}

export function labelFont(style: LabelStyle): string {
  return `${style.fontWeight} ${style.fontPx}px ${style.fontFamily}`;
}

export function labelText(style: LabelStyle, name: string): string {
  return style.uppercase ? name.toUpperCase() : name;
}

/**
 * Draws the labels that touch the view. Positions come from the labels' absolute azimuth and
 * angle, so adjacent tiles and the 0/360 seam agree; labels crossing a tile edge are simply
 * clipped by the canvas and completed by the neighbouring tile.
 */
export function drawPeakLabels(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  labels: readonly LabeledPeak[] | null | undefined,
  style: LabelStyle,
): void {
  if (!labels?.length) return;
  const m = labelMetrics(style);
  ctx.save();
  ctx.font = labelFont(style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const label of labels) {
    const ax = view.azToX(label.az);
    const ay = view.angleToY(label.angle);
    const { dx, dy, w, h } = label.box;
    if (ax + dx > view.width || ax + dx + w < 0) continue;
    if (ay + dy > view.height || ay < 0) continue;
    drawLeader(ctx, style, ax + dx + w / 2, ay + dy + h, ax, ay);
    drawBoxAndText(ctx, style, m, label, ax + dx, ay + dy);
  }
  ctx.restore();
}

/** Leader from the bottom center of the box (fromX, fromY) to the summit (x, summitY). */
function drawLeader(
  ctx: CanvasRenderingContext2D,
  style: LabelStyle,
  fromX: number,
  fromY: number,
  x: number,
  summitY: number,
): void {
  ctx.strokeStyle = style.leader.color;
  ctx.lineWidth = style.leader.width;
  ctx.setLineDash([...style.leader.dash]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(x, summitY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = style.leader.color;
  ctx.beginPath();
  ctx.arc(x, summitY, style.leader.width + 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoxAndText(
  ctx: CanvasRenderingContext2D,
  style: LabelStyle,
  m: LabelMetrics,
  label: LabeledPeak,
  x: number,
  y: number,
): void {
  const { w, h } = label.box;
  if (style.chip) {
    ctx.fillStyle = style.chip.fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    if (style.chip.stroke) {
      ctx.strokeStyle = style.chip.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const text = labelText(style, label.name);
  const cx = x + w / 2;
  const cy = y + h / 2 + m.height * 0.04;
  if (style.halo) {
    ctx.strokeStyle = style.halo;
    ctx.lineWidth = Math.max(3, style.fontPx * 0.28);
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(text, cx, cy);
}
