export type ExportKind = '360' | 'view';

export interface ExportChoice {
  kind: ExportKind;
  title: string;
  /** Pixel size hint, e.g. "5760 x 640 px". */
  detail: string;
}

export interface ExportSheet {
  /** Opens the sheet with the available choices. */
  open(choices: readonly ExportChoice[]): void;
  /** Shows rendering progress (strips done of total). */
  progress(done: number, total: number): void;
  /** Shows an error message with a retry action. */
  error(message: string, retry: () => void): void;
  close(): void;
}

/**
 * Bottom sheet for exporting: pick what to export, watch progress, cancel. The actual
 * rendering is driven by the callbacks so the sheet stays a plain view.
 */
export function createExportSheet(
  parent: HTMLElement,
  handlers: { onChoose: (kind: ExportKind) => void; onCancel: () => void },
): ExportSheet {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.hidden = true;
  const sheet = document.createElement('div');
  sheet.className = 'export-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Export image');
  backdrop.append(sheet);
  parent.append(backdrop);

  const heading = (text: string) => {
    const h = document.createElement('h3');
    h.textContent = text;
    return h;
  };

  const cancel = () => {
    handlers.onCancel();
    close();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cancel();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });

  function close() {
    backdrop.hidden = true;
    sheet.replaceChildren();
  }

  function cancelButton(label = 'Cancel'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary-button';
    b.textContent = label;
    b.onclick = cancel;
    return b;
  }

  return {
    open(choices) {
      const buttons = choices.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'export-choice';
        const t = document.createElement('strong');
        t.textContent = c.title;
        const d = document.createElement('span');
        d.textContent = c.detail;
        b.append(t, d);
        b.onclick = () => handlers.onChoose(c.kind);
        return b;
      });
      sheet.replaceChildren(heading('Export image'), ...buttons, cancelButton('Close'));
      backdrop.hidden = false;
      buttons[0]?.focus();
    },
    progress(done, total) {
      const text = document.createElement('p');
      text.setAttribute('role', 'status');
      text.textContent = `Rendering ${done}/${total}`;
      const bar = document.createElement('div');
      bar.className = 'progress';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round((done / total) * 100)}%`;
      bar.append(fill);
      sheet.replaceChildren(heading('Exporting'), text, bar, cancelButton());
    },
    error(message, retry) {
      const text = document.createElement('p');
      text.setAttribute('role', 'alert');
      text.textContent = message;
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'primary-button';
      again.textContent = 'Try again';
      again.onclick = retry;
      sheet.replaceChildren(heading('Export failed'), text, again, cancelButton('Close'));
      again.focus();
    },
    close,
  };
}
