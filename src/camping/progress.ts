import { el } from './dom';
import type { Progress } from './pipeline';

/**
 * Overall progress 0..1 of an analysis, or null while a stage has no countable steps (waiting
 * for the OpenStreetMap and protected-area services). The terrain download dominates; the
 * optional vegetation download comes after the terrain analysis.
 */
export function progressFraction(p: Progress): number | null {
  const share = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  switch (p.stage) {
    case 'terrain':
      return 0.05 + 0.6 * share;
    case 'analysis':
      return 0.7;
    case 'surface':
      return 0.7 + 0.15 * share;
    case 'features':
      return null;
  }
}

/** The stage in a few words, for the pill (the panel status keeps the longer wording). */
export function shortStage(p: Progress): string {
  switch (p.stage) {
    case 'terrain':
      return `Loading terrain ${p.done}/${p.total}`;
    case 'surface':
      return `Loading vegetation ${p.done}/${p.total}`;
    case 'analysis':
      return 'Analysing';
    case 'features':
      return 'Trails, water, protected areas';
  }
}

export interface ProgressBar {
  /** A fraction of the way, or null for a running animation of unknown length. */
  update(fraction: number | null): void;
  /** Fills the bar and fades it out. */
  finish(): void;
}

/** A thin bar along the top edge of the map that shows an analysis is working. */
export function createProgressBar(parent: HTMLElement): ProgressBar {
  const fill = el('div', { className: 'progress-fill' });
  const bar = el('div', { className: 'progress' }, fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Analysing');
  parent.append(bar);
  const set = (fraction: number | null) => {
    bar.classList.add('active');
    bar.classList.toggle('indeterminate', fraction === null);
    if (fraction !== null) fill.style.width = `${Math.round(fraction * 100)}%`;
  };
  return {
    update: set,
    finish() {
      bar.classList.remove('indeterminate');
      fill.style.width = '100%';
      bar.classList.remove('active');
    },
  };
}
