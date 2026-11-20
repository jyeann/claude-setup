// About: attribution, licence, privacy and the scenario file format.
import { h, icon } from './shell.js';

const ATTRIBUTION = "Incident Simulator teaches reliability patterns using the guides in ByteByteGo's system-design-101. We link to the guides and wrote every scenario, debrief and label ourselves; we copied no guide text or images. system-design-101 is licensed CC BY-NC-ND 4.0, so this project is for non-commercial use.";

const SCHEMA = [
  ['id', 'string, lowercase letters, digits and hyphens, up to 40, equals the file name', 'Route and incident id'],
  ['title', 'non-empty string, up to 300 characters', 'Row title, play heading'],
  ['difficulty', 'integer 1 to 3', 'Difficulty 2 of 3'],
  ['summary', 'non-empty string, up to 160 characters', 'Board row'],
  ['budget', 'integer 1 to 12', 'Pager lamps'],
  ['seed', 'integer 0 to 4294967295', 'Standard seed'],
  ['topology', 'nodes and edges from the known node list', 'System map'],
  ['alerts, logs, faults', 'engine-defined, checked by the shared validator', 'Pages, logs, the incident itself'],
  ['actions', 'known action ids with effects per node', 'Action panel'],
  ['hint', 'non-empty string', 'Hint dialog'],
  ['rootCause', 'non-empty string', 'Debrief'],
  ['concept', 'non-empty string, our own words', 'Debrief'],
  ['harmfulWhy', 'object: fix id to explanation', 'Why that step hurt'],
  ['optimalPath', 'non-empty list of fix ids with a node', 'Optimal lane'],
  ['guideUrl', 'starts with https://bytebytego.com/guides/ and is on the allow-list', 'Guide link'],
];

const ext = (href, text, testid) => h('a', {
  class: 'btn btn-link', href, target: '_blank', rel: 'noopener noreferrer', testid,
}, [text, ' ', icon('ic-external', 'icon'), h('span', { class: 'ext', text: '(opens in new tab)' })]);

export function mountAbout(root, app) {
  const table = h('table', { class: 'schema' }, [
    h('thead', null, h('tr', null, ['Field', 'Rule', 'Shown as'].map((t) => h('th', { scope: 'col', text: t })))),
    h('tbody', null, SCHEMA.map((r) => h('tr', null, r.map((c) => h('td', { text: c }))))),
  ]);
  root.append(h('div', { class: 'page', testid: 'about-view' }, [
    h('h1', { text: 'About' }),
    h('div', { class: 'prose' }, [
      h('p', { testid: 'attribution-text', text: ATTRIBUTION }),
      h('div', { class: 'btn-row' }, [
        ext('https://github.com/ByteByteGoHq/system-design-101', 'ByteByteGo system-design-101 on GitHub', 'attribution-link'),
        ext('https://creativecommons.org/licenses/by-nc-nd/4.0/', 'CC BY-NC-ND 4.0', 'license-link'),
      ]),
      h('p', { testid: 'about-privacy', text: 'No accounts, no tracking, no network calls while you play. Progress stays in this browser.' }),
    ]),
    h('section', { class: 'panel', testid: 'schema-docs', 'aria-labelledby': 'schema-title' }, [
      h('div', { class: 'panel-head' }, h('h2', { id: 'schema-title', text: 'Scenario file format' })),
      h('p', { class: 'hint', text: 'Drop a JSON file into the scenarios folder and restart the server. Problems are listed on the incident board with the file and field.' }),
      h('div', { class: 'table-wrap' }, table),
    ]),
  ]));
  app.shell.setTitle('About - incident-sim');
  return { destroy() {} };
}
