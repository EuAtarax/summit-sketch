import type { RuleEntry, RuleSource } from './types';

const CHECKED = '2026-09-30';

const HIKEBEAST: RuleSource = {
  title: 'Hikebeast: Wildcampen nach Kanton (reads each cantonal law collection)',
  url: 'https://hikebeast.ch/de/journal/wildcampen-kantone/',
};
const VEJ: RuleSource = {
  title: 'VEJ, SR 922.31 (Verordnung über die eidgenössischen Jagdbanngebiete)',
  url: 'https://www.fedlex.admin.ch/eli/cc/1991/1206_1206_1206/de',
};
const TCS: RuleSource = {
  title: 'TCS: Wildcampen in der Schweiz',
  url: 'https://www.tcs.ch/de/camping-reisen/camping-insider/ratgeber/reisevorbereitung/wild-campen-in-der-schweiz.php',
};

/** A canton without a general cantonal rule, as most are (from the Hikebeast survey). */
function local(
  region: string,
  name: string,
  summary: string,
  details: string[],
  extra: RuleSource[] = [],
): RuleEntry {
  return {
    country: 'CH',
    level: 'region',
    region,
    name,
    stance: 'local',
    summary,
    details,
    sources: [HIKEBEAST, ...extra],
    verification: 'secondary',
    checkedOn: CHECKED,
  };
}

export const CH_RULES: readonly RuleEntry[] = [
  {
    country: 'CH',
    level: 'country',
    name: 'Switzerland',
    stance: 'local',
    summary:
      'No federal law bans tents in general; cantons, communes and landowners decide, and federal protected areas ban camping.',
    details: [
      'Federal hunting-ban areas (Jagdbanngebiete): free tenting and camping is banned; only official campsites may be used, and cantons can grant exceptions (VEJ Art. 5 para. 1 lit. e). The fine is CHF 150.',
      'Swiss National Park: closed away from the marked paths; no camping.',
      'Wildlife quiet zones and nature reserves: their own ordinances usually ban camping, often only in certain seasons. The map flags the federal inventories.',
      'Above the tree line and outside protected areas, a single night by a small group is widely tolerated in practice. This is custom, not a right.',
    ],
    sources: [VEJ, HIKEBEAST, TCS],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  local('AG', 'Aargau', 'No cantonal rule on tents outside campsites.', [
    'A single night in a vehicle on a public car park without a posted ban is tolerated; this does not cover pitching a tent in the open landscape.',
  ]),
  local('AR', 'Appenzell Ausserrhoden', 'No cantonal rule on camping.', [
    'Communes, landowners and the Säntis hunting-ban area decide.',
  ]),
  local('AI', 'Appenzell Innerrhoden', 'No cantonal camping fine since 2005.', [
    'The penalty articles of the camping ordinance were repealed in 2005.',
    'The legal way is the consent of the landowner or the alp tenant.',
  ]),
  local('BL', 'Basel-Landschaft', 'No general cantonal rule; the nature reserves ban camping.', [
    'About 120 reserve ordinances each ban camping, with fines up to CHF 100,000 in severe cases.',
  ]),
  {
    ...local('BS', 'Basel-Stadt', 'A tent on public ground needs a permit.', [
      'Public ground may only be used beyond the common use with a permit (special use of the Allmend). The canton has no campsite.',
    ]),
    stance: 'permit',
  },
  local('BE', 'Bern', 'No cantonal ban; several communes have strict bans of their own.', [
    'Lauterbrunnen, Grindelwald and Kandersteg ban tents (see the commune entries).',
  ]),
  local('FR', 'Fribourg', 'No general cantonal rule; some reserves ban camping.', [
    'The Vanil-Noir reserve bans camping.',
  ]),
  local('GE', 'Geneva', 'No general ban; tents are banned in forests.', [
    'The forest law bans tents in forests, with fines up to CHF 60,000.',
  ]),
  local('GL', 'Glarus', 'No cantonal rule on camping.', [
    'Lighting fires is the bigger risk: the forest law sets fines up to CHF 20,000.',
  ]),
  local('GR', 'Graubünden', 'No cantonal ban; many communes ban camping themselves.', [
    'Silvaplana fines up to CHF 30,000 through its building law.',
  ]),
  local('JU', 'Jura', 'No general cantonal rule; some reserves ban camping.', [
    'The Gruère reserve ordinance (2024) bans camping in all forms; the Doubs reserve has a CHF 100 fine.',
  ]),
  local('LU', 'Lucerne', 'No rule for a single tent night; the nature reserves ban camping.', [
    'The planning and building law (§ 174) only covers land use from 30 days on.',
  ]),
  local('NE', 'Neuchâtel', 'No general ban; the Creux du Van area has strict rules.', [
    'A 2023 plan names a perimeter at Creux du Van where bivouacking is permitted; elsewhere there it is restricted.',
  ]),
  local('NW', 'Nidwalden', 'No general rule; tents are banned in listed moors and dry meadows.', [
    'The biotope ordinance lists the protected moor and dry-meadow areas.',
  ]),
  {
    country: 'CH',
    level: 'region',
    region: 'OW',
    name: 'Obwalden',
    stance: 'conditional',
    summary:
      'Camping outside licensed sites is banned, but the camping law permits a single night if no public or private interests are harmed.',
    details: [
      'Gesetz über das Campieren (GDB 971.4), in force since 1 March 2015: Art. 6 bans camping outside licensed sites; Art. 8 permits a single night without a permit, at your own risk.',
      'Camping operators asked in 2015 to remove Art. 8; check the current version of the law.',
    ],
    sources: [
      HIKEBEAST,
      {
        title: 'Kanton Obwalden: report on two motions to change the camping law (2015)',
        url: 'https://www.ow.ch/_doc/71450',
      },
    ],
    // The official 2015 report confirms Art. 8; the current law text was not read.
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  local('SH', 'Schaffhausen', 'No cantonal rule on camping.', [
    'The towns run permit systems with fines up to CHF 1,000.',
  ]),
  local('SZ', 'Schwyz', 'No general ban; nine named reserves ban camping.', [
    'Camping in the nine reserves (including the Rothenthurm moorland) is fined CHF 150; elsewhere communal protection ordinances decide.',
  ]),
  local('SO', 'Solothurn', 'No cantonal rule on camping.', []),
  local('SG', 'St. Gallen', 'No cantonal ban; communal bans are fined CHF 80.', [
    'Bad Ragaz explicitly exempts a single occasional tent.',
  ]),
  {
    country: 'CH',
    level: 'region',
    region: 'TI',
    name: 'Ticino',
    stance: 'ban',
    bivouac: 'conditional',
    summary:
      'Camping is only permitted on authorized campsites; the law exempts a tent for a mountain bivouac.',
    details: [
      'Legge sui campeggi (943.100) Art. 2: camping only in authorized areas; para. 2 exempts pitching a tent for a bivouac in the mountains.',
      'Outside the exemption the commune fines CHF 50 to 10,000.',
    ],
    sources: [
      {
        title: 'Legge sui campeggi del 26 gennaio 2004 (RL 943.100)',
        url: 'https://m3.ti.ch/CAN/RLeggi/public/index.php/raccolta-leggi/pdfatto/atto/631',
      },
      HIKEBEAST,
    ],
    verification: 'primary',
    checkedOn: CHECKED,
  },
  local('TG', 'Thurgau', 'No cantonal rule on camping; the communes decide.', []),
  local('UR', 'Uri', 'No cantonal ban.', [
    'On land of the Korporation Uri a single night is permitted in advance by the corporation.',
  ]),
  local('VD', 'Vaud', 'No cantonal rule on camping outside campsites; the communes decide.', [
    'The camping law only regulates campsites; the nature protection law has no camping rule.',
  ]),
  local('VS', 'Valais', 'No cantonal ban; some communes ban camping.', [
    'An often-quoted cantonal ban is not in force. Zermatt and four communes above Lake Geneva have bans.',
  ]),
  local('ZG', 'Zug', 'No general rule; camping is fined only in nature protection zones.', []),
  local('ZH', 'Zurich', 'No general rule; protection ordinances ban camping in their zones.', [
    'Fines under the protection ordinances reach CHF 50,000.',
  ]),
  // Communes with their own rules, as far as known. Most communes have not been surveyed.
  {
    country: 'CH',
    level: 'commune',
    region: 'BE',
    commune: 'Lauterbrunnen',
    name: 'Lauterbrunnen',
    stance: 'ban',
    summary: 'The commune bans wild camping.',
    details: ['Fines up to CHF 5,000 since 1 January 2025.'],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  {
    country: 'CH',
    level: 'commune',
    region: 'BE',
    commune: 'Grindelwald',
    name: 'Grindelwald',
    stance: 'ban',
    bivouac: 'ban',
    summary: 'The commune bans camping, above the tree line too.',
    details: [],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  {
    country: 'CH',
    level: 'commune',
    region: 'BE',
    commune: 'Kandersteg',
    name: 'Kandersteg',
    stance: 'ban',
    summary: 'The commune bans tents outside campsites.',
    details: ['Communal regulation, Art. 7.'],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  {
    country: 'CH',
    level: 'commune',
    region: 'GR',
    commune: 'Silvaplana',
    name: 'Silvaplana',
    stance: 'ban',
    summary: 'The commune bans camping outside campsites.',
    details: ['Fines up to CHF 30,000 under the communal building law.'],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  {
    country: 'CH',
    level: 'commune',
    region: 'VS',
    commune: 'Zermatt',
    name: 'Zermatt',
    stance: 'ban',
    summary: 'The commune bans camping outside campsites.',
    details: ['Communal police regulation, Art. 43; fines around CHF 200.'],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
  {
    country: 'CH',
    level: 'commune',
    region: 'SG',
    commune: 'Bad Ragaz',
    name: 'Bad Ragaz',
    stance: 'conditional',
    summary: 'The communal ban on camping exempts a single occasional tent.',
    details: [],
    sources: [HIKEBEAST],
    verification: 'secondary',
    checkedOn: CHECKED,
  },
];
