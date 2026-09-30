import { el } from './dom';
import { STANCE_LABEL, type RuleEntry } from './rules';

/** What the "Camping rules here" section shows. */
export type RulesState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; placeName: string | null; entries: readonly RuleEntry[] };

const LEVEL_LABEL: Record<RuleEntry['level'], (r: RuleEntry) => string> = {
  country: () => 'Country',
  region: (r) => (r.country === 'CH' ? 'Canton' : r.country === 'AT' ? 'Bundesland' : 'Region'),
  commune: () => 'Commune',
};

const DISCLAIMER =
  'Not legal advice. Communes, landowners and protected areas can add rules; check locally before you pitch a tent.';

function entryNode(r: RuleEntry): HTMLElement {
  const stance = r.bivouac
    ? `${STANCE_LABEL[r.stance]}; bivouac: ${STANCE_LABEL[r.bivouac].toLowerCase()}`
    : STANCE_LABEL[r.stance];
  const node = el(
    'li',
    { className: 'rule' },
    el('strong', { textContent: `${LEVEL_LABEL[r.level](r)}: ${r.name}` }),
    el('span', { className: `rule-stance rule-${r.stance}`, textContent: stance }),
    el('p', { textContent: r.summary }),
  );
  if (r.details.length > 0) {
    node.append(el('ul', {}, ...r.details.map((d) => el('li', { textContent: d }))));
  }
  const sources = el('p', { className: 'rule-sources' }, 'Sources: ');
  r.sources.forEach((s, i) => {
    if (i > 0) sources.append(', ');
    sources.append(
      el('a', { href: s.url, target: '_blank', rel: 'noopener', textContent: s.title }),
    );
  });
  const checked =
    r.verification === 'primary'
      ? `checked in the law text on ${r.checkedOn}`
      : `from summaries that name the law, checked on ${r.checkedOn}`;
  sources.append(` (${checked}).`);
  node.append(sources);
  return node;
}

/** The content of the rules section for a state. */
export function rulesNodes(s: RulesState): Node[] {
  const note = (text: string) => el('p', { className: 'empty', textContent: text });
  switch (s.state) {
    case 'none':
      return [note('Choose a spot to see the camping rules there.')];
    case 'loading':
      return [note('Looking up the rules here...')];
    case 'failed':
      return [
        note("Couldn't look up the canton and commune. Check the rules of the area yourself."),
      ];
    case 'ready':
      if (s.entries.length === 0) {
        return [note('No camping rules recorded for this place yet. Check the local rules.')];
      }
      return [
        ...(s.placeName ? [el('p', { className: 'rule-place', textContent: s.placeName })] : []),
        el('ul', { className: 'rule-list' }, ...s.entries.map(entryNode)),
        note(DISCLAIMER),
      ];
  }
}
