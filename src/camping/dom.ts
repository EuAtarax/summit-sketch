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
  if (help) text.append(el('small', { textContent: help }));
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
  /** The recommended value, shown after the explanation. */
  recommended?: number;
}

/** A range slider with its current value, an explanation and the recommended value. */
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
  const show = () => (output.textContent = `${Number(input.value)}${c.unit}`);
  show();
  input.oninput = () => {
    show();
    onInput(Number(input.value));
  };
  const help =
    c.recommended === undefined ? c.help : `${c.help} Recommended: ${c.recommended}${c.unit}.`;
  const node = el(
    'div',
    { className: 'slider' },
    el('div', { className: 'slider-head' }, el('span', { textContent: c.label }), output),
    input,
    el('small', { textContent: help }),
  );
  return {
    node,
    set(value) {
      input.value = String(value);
      show();
    },
  };
}
