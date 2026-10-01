/** Small helpers for building the panel without a UI framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function selectOf<T extends string>(
  options: readonly { value: T; label: string }[],
  current: T,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = el('select');
  for (const o of options) select.append(el('option', { value: o.value, textContent: o.label }));
  select.value = current;
  select.onchange = () => onChange(select.value as T);
  return select;
}

/** A labelled control with an optional one-line explanation under it. */
export function field(label: string, control: HTMLElement, help?: string): HTMLLabelElement {
  const row = el('label', { className: 'field' }, el('span', { textContent: label }), control);
  if (help) row.append(el('small', { textContent: help }));
  return row;
}

export function section(title: string, open: boolean, ...children: Node[]): HTMLDetailsElement {
  return el('details', { open }, el('summary', { textContent: title }), ...children);
}

/** A titled block of related controls (a plain heading, not collapsible). */
export function group(title: string, ...children: Node[]): HTMLElement {
  return el('section', { className: 'group' }, el('h2', { textContent: title }), ...children);
}

export interface TabItem {
  label: string;
  content: HTMLElement;
}

/** A tab strip with one visible panel at a time; arrow keys move between the tabs. */
export function tabs(items: readonly TabItem[]): HTMLElement {
  const buttons = items.map((item, i) => {
    const button = el('button', { type: 'button', className: 'tab', textContent: item.label });
    button.setAttribute('role', 'tab');
    button.id = `tab-${i}`;
    item.content.setAttribute('role', 'tabpanel');
    item.content.setAttribute('aria-labelledby', button.id);
    return button;
  });
  const select = (index: number, focus = false) => {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      items[i]!.content.hidden = i !== index;
    });
    if (focus) buttons[index]!.focus();
  };
  buttons.forEach((button, i) => {
    button.onclick = () => select(i);
    button.onkeydown = (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) select((i + step + items.length) % items.length, true);
    };
  });
  select(0);
  const strip = el('div', { className: 'tabs' }, ...buttons);
  strip.setAttribute('role', 'tablist');
  return el('div', { className: 'tabbed' }, strip, ...items.map((i) => i.content));
}

/**
 * An explanation under a control. On phones it shows one line until tapped (see camping.css);
 * tapping it again folds it.
 */
function expandable(text: string): HTMLElement {
  const small = el('small', { textContent: text });
  small.onclick = (e) => {
    e.preventDefault(); // inside a label: do not toggle the checkbox
    small.classList.toggle('expanded');
  };
  return small;
}

/** A checkbox with a label and an optional explanation. */
export function checkRow(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  help?: string,
): { node: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'checkbox', checked });
  input.onchange = () => onChange(input.checked);
  const text = el('span', {}, label);
  if (help) text.append(expandable(help));
  return { node: el('label', { className: 'check' }, input, text), input };
}

export interface SliderConfig {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  help: string;
  /** How the value is printed; defaults to the number plus `unit`. */
  format?: (value: number) => string;
}

/** A range slider with its current value and an explanation under its title. */
export function sliderRow(
  c: SliderConfig,
  onInput: (value: number) => void,
): { node: HTMLDivElement; set(value: number): void } {
  const input = el('input', {
    type: 'range',
    min: String(c.min),
    max: String(c.max),
    step: String(c.step),
    value: String(c.value),
  });
  const output = el('output');
  const format = c.format ?? ((v: number) => `${v}${c.unit}`);
  const show = () => (output.textContent = format(Number(input.value)));
  show();
  input.oninput = () => {
    show();
    onInput(Number(input.value));
  };
  const node = el(
    'div',
    { className: 'slider' },
    el('div', { className: 'slider-head' }, el('span', { textContent: c.label }), output),
    expandable(c.help),
    input,
  );
  return {
    node,
    set(value) {
      input.value = String(value);
      show();
    },
  };
}
