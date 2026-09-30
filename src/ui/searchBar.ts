import type { PlaceResult } from '../search/nominatim';

const NOT_FOUND = (q: string) =>
  `No places found for "${q}". Check the spelling or try a nearby town.`;
const SEARCH_ERROR = "Couldn't search. Check your connection and try again.";

/** Suggestions start at this many characters and wait for a pause in typing. */
const MIN_SUGGEST_CHARS = 3;
const SUGGEST_DELAY_MS = 250;

/**
 * Search field for places and peaks. `search` runs on submit only (Enter or the button), as the
 * Nominatim policy requires. An optional `suggest` source that allows type-ahead (not
 * Nominatim) lists matches while typing, from MIN_SUGGEST_CHARS characters on.
 */
export function createSearchBar(
  parent: HTMLElement,
  search: (query: string) => Promise<PlaceResult[]>,
  onSelect: (result: PlaceResult) => void,
  suggest?: (query: string, signal: AbortSignal) => Promise<PlaceResult[]>,
): void {
  const form = document.createElement('form');
  form.className = 'search';
  form.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.name = 'q';
  input.placeholder = 'Search a place or peak';
  input.autocomplete = 'off';
  input.enterKeyHint = 'search';
  input.setAttribute('aria-label', 'Search a place or peak');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'search-submit';
  submit.setAttribute('aria-label', 'Search');
  submit.textContent = '→';

  const results = document.createElement('ul');
  results.className = 'search-results';
  results.hidden = true;
  results.setAttribute('aria-live', 'polite');

  form.append(input, submit, results);
  parent.append(form);

  const showMessage = (text: string) => {
    const li = document.createElement('li');
    li.className = 'search-message';
    li.textContent = text;
    results.replaceChildren(li);
    results.hidden = false;
  };

  const hide = () => {
    results.hidden = true;
    results.replaceChildren();
  };

  const showPlaces = (found: PlaceResult[]) => {
    results.replaceChildren(
      ...found.map((place) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const title = document.createElement('strong');
        title.textContent = place.name;
        const detail = document.createElement('span');
        detail.textContent = place.description;
        button.append(title, detail);
        button.onclick = () => {
          run++;
          hide();
          input.blur();
          onSelect(place);
        };
        li.append(button);
        return li;
      }),
    );
    results.hidden = false;
  };

  /** Bumped by every new search, suggestion round or close, so late answers are dropped. */
  let run = 0;
  const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(suggestTimer);
    suggestAbort?.abort();
    const query = input.value.trim();
    if (query.length < 2) return;
    const mine = ++run;
    showMessage('Searching…');
    try {
      const found = await search(query);
      if (mine !== run) return;
      if (found.length === 0) return showMessage(NOT_FOUND(query));
      showPlaces(found);
    } catch (err) {
      // A newer search cancelling this one is not an error.
      if (mine !== run || isAbort(err)) return;
      console.error(err);
      showMessage(SEARCH_ERROR);
    }
  });

  let suggestTimer = 0;
  let suggestAbort: AbortController | null = null;
  if (suggest) {
    input.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestAbort?.abort();
      const query = input.value.trim();
      if (query.length < MIN_SUGGEST_CHARS) {
        run++;
        hide();
        return;
      }
      suggestTimer = window.setTimeout(async () => {
        const mine = ++run;
        const controller = (suggestAbort = new AbortController());
        try {
          const found = await suggest(query, controller.signal);
          if (mine !== run) return;
          if (found.length === 0) return showMessage(NOT_FOUND(query));
          showPlaces(found);
        } catch (err) {
          // Suggestions are best effort: a failure just leaves the list as it was.
          if (mine !== run || isAbort(err)) return;
          console.error(err);
        }
      }, SUGGEST_DELAY_MS);
    });
  }

  // Arrow keys move between the field and the listed places.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...results.querySelectorAll('button')];
    if (buttons.length === 0) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    if (next < 0) input.focus();
    else buttons[Math.min(next, buttons.length - 1)]!.focus();
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      run++;
      clearTimeout(suggestTimer);
      hide();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!form.contains(e.target as Node)) hide();
  });
}
