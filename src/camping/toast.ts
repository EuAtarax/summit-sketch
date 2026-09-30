import { el } from './dom';

/** A short message that fades in, stays `durationMs` and fades out; a new one replaces the old. */
export function createToast(parent: HTMLElement, durationMs = 3000): (text: string) => void {
  const node = el('div', { className: 'toast' });
  node.setAttribute('role', 'status');
  parent.append(node);
  let timer = 0;
  return (text) => {
    clearTimeout(timer);
    node.textContent = text;
    node.classList.add('visible');
    timer = window.setTimeout(() => node.classList.remove('visible'), durationMs);
  };
}
