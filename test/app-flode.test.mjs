// Kritiska klickflöden genom det verkliga produktionsgränssnittet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { skapaTestdata } from '../prototyp/testdata.mjs';

let html = '';
const lyssnare = {};
const app = {
  set innerHTML(v) { html = v; },
  get innerHTML() { return html; },
};

globalThis.document = {
  getElementById: () => app,
  addEventListener: (typ, fn) => { lyssnare[typ] = fn; },
  querySelector: () => null,
};
globalThis.window = { addEventListener() {}, location: { reload() {} }, confirm: () => true };
globalThis.setTimeout = fn => { queueMicrotask(fn); return 1; };
globalThis.clearTimeout = () => {};

const klicka = dataset => {
  const nod = { dataset, classList: { contains: () => false }, closest: () => nod };
  lyssnare.click({ target: nod });
};
const fyll = (falt, value) => lyssnare.input({ target: { dataset: { falt }, value } });
const tom = () => new Promise(resolve => setImmediate(resolve));

const { startaApp } = await import('../src/app/ui.mjs');

test('klickflöde: nytt uppdrag och ny registrering blir sparbara', async () => {
  const sparade = [];
  const lagring = { async spara(s) { sparade.push(structuredClone(s)); } };
  startaApp({ lagring, tillstand: skapaTestdata(), tidigareUppdrag: [] });

  klicka({ oppna: 'mer' });
  klicka({ oppna: 'uppdrag' });
  assert.match(html, /Aktiva uppdrag/);
  klicka({ oppna: 'nyttuppdrag' });
  klicka({ valjkund: 'k-a' });
  fyll('namn', 'Nytt kunduppdrag');
  klicka({ valjdebitering: 'hourly' });
  fyll('pris', '950');
  klicka({ valjnyvat: '2500' });
  klicka({ sparanyttuppdrag: '1' });
  await tom();

  assert.ok(sparade.at(-1).projects.some(p => p.name === 'Nytt kunduppdrag'));

  // Den registrering som fällde liveversionen måste bära sin källtyp redan
  // innan lagringen anropas.
  klicka({ oppna: 'tillfalle' });
  klicka({ spara: '1' });
  await tom();
  const ny = sparade.at(-1).poster.at(-1);
  assert.equal(ny.sourceType, 'entry');
  assert.ok(!/Kunde inte spara/.test(html));
});
