import type { PlaceResult } from '../search/nominatim';

const NOT_FOUND = (q: string) =>
  `No places found for "${q}". Check the spelling or try a nearby town.`;
const SEARCH_ERROR = "Couldn't search. Check your connection and try again.";

/**
 * Search field for places and peaks. It searches on submit only (Enter or the button), never
 * while typing, as the Nominatim policy requires, and lists the results below the field.
 */
export function createSearchBar(
  parent: HTMLElement,
  search: (query: string) => Promise<PlaceResult[]>,
  onSelect: (result: PlaceResult) => void,
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

  let run = 0;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;
    const mine = ++run;
    showMessage('Searching…');
    try {
      const found = await search(query);
      if (mine !== run) return;
      if (found.length === 0) return showMessage(NOT_FOUND(query));
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
            hide();
            input.blur();
            onSelect(place);
          };
          li.append(button);
          return li;
        }),
      );
      results.hidden = false;
    } catch (err) {
      // A newer search cancelling this one is not an error.
      if (mine !== run || (err instanceof DOMException && err.name === 'AbortError')) return;
      console.error(err);
      showMessage(SEARCH_ERROR);
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      run++;
      hide();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!form.contains(e.target as Node)) hide();
  });
}
