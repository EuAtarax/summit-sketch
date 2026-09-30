import type { RuleEntry, RuleSource } from './types';

const CHECKED = '2026-09-30';

const ALPENVEREIN: RuleSource = {
  title: 'Österreichischer Alpenverein: Wildcampen (press release, June 2023)',
  url: 'https://www.alpenverein.at/portal/service/presse/2023/2023_06_22-Wildcampen.php',
};
const VIENNA_AT: RuleSource = {
  title: 'VIENNA.AT: "Wildcampen": Regeln und Strafen der Bundesländer',
  url: 'https://www.vienna.at/wildcampen-regeln-und-strafen-der-bundeslaender/6665732',
};

/** A Bundesland entry from the two press summaries (the Landesgesetz itself not read). */
function land(
  region: string,
  name: string,
  stance: RuleEntry['stance'],
  summary: string,
  details: string[],
): RuleEntry {
  return {
    country: 'AT',
    level: 'region',
    region,
    name,
    stance,
    summary,
    details,
    sources: [ALPENVEREIN, VIENNA_AT],
    verification: 'secondary',
    checkedOn: CHECKED,
  };
}

/** Region codes are ISO 3166-2:AT (AT-1 Burgenland ... AT-9 Wien). */
export const AT_RULES: readonly RuleEntry[] = [
  {
    country: 'AT',
    level: 'country',
    name: 'Austria',
    stance: 'local',
    summary:
      'Each Bundesland makes its own rules; nationwide, tents in forests need the owner’s consent.',
    details: [
      'Forstgesetz 1975: the free right to walk in forests does not include camping at night or pitching tents.',
      'An emergency bivouac (injury, sudden bad weather) is accepted everywhere.',
      'National parks and nature reserves ban camping under their own rules.',
    ],
    sources: [ALPENVEREIN],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  land(
    'AT-1',
    'Burgenland',
    'conditional',
    'Tents are tolerated for small groups for a few nights.',
    [
      'Fewer than 10 people and at most 3 nights; parking a motorhome in the open is not covered.',
      'Fines up to EUR 3,600.',
    ],
  ),
  land(
    'AT-2',
    'Kärnten',
    'ban',
    'Tents in the open landscape outside licensed campsites are banned.',
    ['Kärntner Naturschutzgesetz 2002.', 'Fines up to EUR 3,630.'],
  ),
  land('AT-3', 'Niederösterreich', 'ban', 'Camping outside licensed campsites is banned.', [
    'NÖ Naturschutzgesetz. One summary quotes the ban for caravans and motorhomes in the green belt; check whether it covers a tent.',
    'Fines up to EUR 14,500.',
  ]),
  land(
    'AT-4',
    'Oberösterreich',
    'conditional',
    'Hikers may pitch a tent in the alpine wasteland above the tree line, outside pastures; other camping outside campsites is banned.',
    [
      'Oberösterreichisches Tourismusgesetz (per VIENNA.AT). The Alpenverein summary knows of no regional ban; check before relying on either.',
      'Protected areas ban camping.',
    ],
  ),
  land('AT-5', 'Salzburg', 'local', 'No Land-wide ban; the communes decide.', [
    'Whether and how much to fine is up to the commune.',
    'Protected areas ban camping.',
  ]),
  land('AT-6', 'Steiermark', 'local', 'No Land-wide ban; communes can restrict.', [
    'Ask the landowner or the commune.',
    'Protected areas ban camping.',
  ]),
  {
    country: 'AT',
    level: 'region',
    region: 'AT-7',
    name: 'Tirol',
    stance: 'ban',
    bivouac: 'conditional',
    summary:
      'Camping outside campsites is banned; a bivouac in high alpine terrain above the tree line is exempt.',
    details: [
      'Tiroler Campinggesetz 2001, § 3 para. 1: camping (overnight stays in tents, vehicles and the like) outside campsites is banned, except on land a commune has opened by ordinance.',
      'The bivouac exemption covers a single makeshift night in alpine terrain on a mountain tour, planned or forced by weather, injury or darkness.',
      'A breach is an administrative offence; fines up to EUR 220, more when waste, nature or field protection laws are also broken.',
    ],
    sources: [
      {
        title: 'oesterreich.gv.at: Campen in Tirol',
        url: 'https://www.oesterreich.gv.at/de/themen/reisen_und_freizeit/freizeit-in-der-natur/campen/Seite.3390007.html',
      },
      {
        title: 'RIS: Tiroler Campinggesetz 2001 (current version)',
        url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrT&Gesetzesnummer=20000099',
      },
      VIENNA_AT,
    ],
    verification: 'primary',
    checkedOn: CHECKED,
  },
  land('AT-8', 'Vorarlberg', 'local', 'No Land-wide ban; the communes decide.', [
    'Whether and how much to fine is up to the commune.',
    'Protected areas ban camping.',
  ]),
  land('AT-9', 'Wien', 'ban', 'Camping outside official campsites is banned.', [
    'Kampierverordnung.',
    'Fines up to EUR 700.',
  ]),
];
