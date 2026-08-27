// Kritiska klickflöden genom det verkliga produktionsgränssnittet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { skapaTestdata } from '../prototyp/testdata.mjs';
import { planeraHistorikimport } from '../src/app/historikimport.mjs';

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

test('klickflöde: veckomål sparas och kontoåtgärder fungerar', async () => {
  const sparade = [];
  let synkningar = 0;
  let utloggningar = 0;
  const lagring = { async spara(s) { sparade.push(structuredClone(s)); } };
  startaApp({
    lagring,
    tillstand: { ...skapaTestdata(), installningar: { veckomalOre: null } },
    kontoNamn: 'Microsoft OneDrive',
    synkaOm: () => { synkningar++; },
    loggaUt: () => { utloggningar++; },
  });

  klicka({ vy: 'vecka' });
  assert.match(html, /Sätt veckomål/);
  klicka({ oppna: 'veckomal' });
  fyll('veckomal', '30 000');
  klicka({ sparaveckomal: '1' });
  await tom();

  assert.equal(sparade.at(-1).installningar.veckomalOre, 3000000);
  assert.match(html.replace(/[\u00a0\u202f]/g, ' '), /30 000 kr/);

  klicka({ oppna: 'konto' });
  assert.match(html, /Microsoft OneDrive/);
  klicka({ synkaom: '1' });
  assert.equal(synkningar, 1);
  klicka({ loggautapp: '1' });
  assert.equal(utloggningar, 1);
});

test('klickflöde: hela historiken läggs in och kan beslutas post för post', async () => {
  const sparade = [];
  const tillstand = skapaTestdata();
  const plan = planeraHistorikimport({
    clients: [{ id: 'c', name: 'Arkivkund' }],
    projects: [{ id: 'p', clientId: 'c', name: 'Arkivuppdrag', hourlyRate: 900 }],
    entries: [
      { id: 'e1', projectId: 'p', date: '2026-07-01', moment: 'Äldre arbete', seconds: 3600 },
      { id: 'e2', projectId: 'p', date: '2026-06-01', moment: 'Ännu äldre arbete', seconds: 1800 },
    ],
    trips: [{ id: 't1', projectId: 'p', date: '2026-06-01', description: 'Äldre resa', km: 23 }],
    invoices: [{ projectId: 'p', month: '2026-06' }],
  }, tillstand, { nu: '2026-08-27T20:00:00.000Z' });
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand,
    historikForslag: plan,
  });

  klicka({ oppna: 'mer' });
  klicka({ oppna: 'historik' });
  assert.match(html, /Lägg in hela historiken/);
  assert.match(html, /Tidsposter<\/span><span class="v">2/);
  klicka({ importerahistorik: '1' });
  await tom();

  assert.match(html, /juli 2026/);
  assert.match(html, /Arkivuppdrag · Arbetad tid/);
  assert.match(html, /Arkivkund · 1 tim/);
  assert.match(html, /Behöver granskas/);
  assert.equal(sparade.at(-1).poster.filter(p => p.legacySource === 'v1-full-history').length, 3);

  klicka({ post: 'e1' });
  assert.match(html, /Ska faktureras/);
  assert.match(html, /Redan klart i Lundify/);
  assert.match(html, /Behåll endast som historik/);
  klicka({ historikbeslut: 'e1|billable' });
  await tom();
  assert.equal(sparade.at(-1).poster.find(p => p.id === 'e1').legacyReviewStatus, 'billable');
});
