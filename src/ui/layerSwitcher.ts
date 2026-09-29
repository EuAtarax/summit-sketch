import { MAP_LAYERS, type MapLayerId } from './mapConfig';

export interface LayerSwitcher {
  set(id: MapLayerId): void;
}

/**
 * A layers button over the map that opens a small radio menu (normal, terrain, satellite).
 * Touch targets are 44 px; Escape or a tap outside closes the menu.
 */
export function createLayerSwitcher(
  parent: HTMLElement,
  initial: MapLayerId,
  onChange: (id: MapLayerId) => void,
): LayerSwitcher {
  const wrap = document.createElement('div');
  wrap.className = 'layer-switcher';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-button';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Map layers');
  button.textContent = 'Layers';

  const menu = document.createElement('div');
  menu.className = 'layer-menu';
  menu.setAttribute('role', 'radiogroup');
  menu.setAttribute('aria-label', 'Map layer');
  menu.hidden = true;

  const options = new Map<MapLayerId, HTMLButtonElement>();
  for (const layer of MAP_LAYERS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.textContent = layer.name;
    option.onclick = () => {
      select(layer.id);
      onChange(layer.id);
      close();
    };
    options.set(layer.id, option);
    menu.append(option);
  }

  function select(id: MapLayerId) {
    for (const [optionId, option] of options) {
      option.setAttribute('aria-checked', String(optionId === id));
    }
  }

  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  button.onclick = () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  };
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      button.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!wrap.contains(e.target as Node)) close();
  });

  select(initial);
  wrap.append(button, menu);
  parent.append(wrap);
  return { set: select };
}
