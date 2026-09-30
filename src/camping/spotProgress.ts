import L from 'leaflet';
import { el } from './dom';

export interface SpotProgress {
  /** Shows the pill under a spot, or moves it there, with a starting text. */
  start(at: L.LatLngExpression, text: string): void;
  /** A fraction of the way, or null for a running animation of unknown length. */
  update(text: string, fraction: number | null): void;
  /** Removes the pill. */
  finish(): void;
}

/**
 * A pill just under the chosen spot that shows what the analysis is doing: where the eye
 * already is after a tap, and far easier to see on a large screen than a line along the edge.
 */
export function createSpotProgress(map: L.Map): SpotProgress {
  const label = el('span', { className: 'spot-progress-label' });
  const fill = el('div', { className: 'spot-progress-fill' });
  const bar = el('div', { className: 'spot-progress-bar' }, fill);
  const pill = el('div', { className: 'spot-progress' }, label, bar);
  // The panel status (role="status") already announces the same stages.
  pill.setAttribute('aria-hidden', 'true');
  const marker = L.marker([0, 0], {
    icon: L.divIcon({ className: 'spot-progress-anchor', html: pill, iconSize: [0, 0] }),
    interactive: false,
    keyboard: false,
  });

  const update = (text: string, fraction: number | null): void => {
    label.textContent = text;
    bar.classList.toggle('indeterminate', fraction === null);
    if (fraction !== null) fill.style.width = `${Math.round(fraction * 100)}%`;
  };

  return {
    start(at, text) {
      marker.setLatLng(at);
      if (!map.hasLayer(marker)) marker.addTo(map);
      update(text, 0.03);
    },
    update,
    finish() {
      marker.remove();
    },
  };
}
