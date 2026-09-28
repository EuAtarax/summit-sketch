import { createAttributionFooter } from './attribution';

/** Empty app shell: header, a main area for the map/viewer, and the attribution footer. */
export function mountShell(root: HTMLElement): { main: HTMLElement } {
  const header = document.createElement('header');
  header.className = 'app-header';
  const title = document.createElement('h1');
  title.textContent = 'Summit Sketch';
  header.append(title);

  const main = document.createElement('main');
  main.className = 'app-main';
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'Pick a summit to see the view. The map is coming soon.';
  main.append(placeholder);

  root.replaceChildren(header, main, createAttributionFooter());
  return { main };
}
