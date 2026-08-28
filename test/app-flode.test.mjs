// Kritiska klickflöden genom det verkliga produktionsgränssnittet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { skapaTestdata } from '../prototyp/testdata.mjs';
import { planeraHistorikimport } from '../src/app/historikimport.mjs';

let html = '';
const lyssnare = {};
const faltvarden = new Map();
const app = {
  set innerHTML(v) { html = v; },
  get innerHTML() { return html; },
};

globalThis.document = {
  getElementById: () => app,
  addEventListener: (typ, fn) => { lyssnare[typ] = fn; },
  querySelector: valjare => {
    const match = String(valjare).match(/^\[data-falt="([^"]+)"\]$/);
    return match && faltvarden.has(match[1]) ? { value: faltvarden.get(match[1]) } : null;
  },
};
globalThis.window = { addEventListener() {}, location: { reload() {} }, confirm: () => true };
globalThis.setTimeout = fn => { queueMicrotask(fn); return 1; };
globalThis.clearTimeout = () => {};

const klicka = dataset => {
  const nod = { dataset, classList: { contains: () => false }, closest: () => nod };
  lyssnare.click({ target: nod });
};
const fyll = (falt, value) => {
  faltvarden.set(falt, value);
  lyssnare.input({ target: { dataset: { falt }, value } });
};
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

test('klickflöde: ett klart Lundify-underlag kan öppnas för rättning', async () => {
  const sparade = [];
  const id = 'underlag-att-oppna';
  const grund = skapaTestdata();
  const tillstand = {
    ...grund,
    poster: grund.poster.map(p => p.id === 'p-1'
      ? { ...p, status: 'included', invoiceRecordId: id, priceSnapshot: { unitPriceOre: 240000 } }
      : p),
    invoiceRecords: [{
      id, clientId: 'k-a', period: '2026-08', nettoOre: 480000,
      momsOre: 0, attBetalaOre: 480000, klarmarkeradAt: '2026-08-27',
    }],
  };
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand,
  });

  klicka({ vy: 'fakturera' });
  assert.match(html, /Öppna för rättning/);
  assert.match(html, /Ingenting ändras i Lundify/);
  assert.ok(!/>Ångra</.test(html), 'knappen ska säga vad den faktiskt gör');

  klicka({ vy: 'vecka' });
  klicka({ post: 'p-1' });
  assert.match(html, /data-angra="underlag-att-oppna"/,
    'den låsta raden har en direkt väg till att öppna hela underlaget');
  klicka({ angra: id });
  await tom();

  const sparat = sparade.at(-1);
  const post = sparat.poster.find(p => p.id === 'p-1');
  assert.equal(post.status, 'open');
  assert.equal(post.invoiceRecordId, null);
  assert.equal(post.priceSnapshot, null);
  assert.ok(!sparat.invoiceRecords.some(r => r.id === id));
});

test('klickflöde: hela historiken läggs in som redan klar och förblir redigerbar', async () => {
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
  assert.match(html, /Tillämpa gränsen 31 juli/);
  assert.match(html, /Tidsposter<\/span><span class="v">2/);
  klicka({ importerahistorik: '1' });
  await tom();

  assert.match(html, /till och med 31 juli är den klar i Lundify/i);
  assert.equal(sparade.at(-1).poster.filter(p => p.legacySource === 'v1-full-history').length, 3);
  assert.ok(sparade.at(-1).poster.every(p => p.legacySource !== 'v1-full-history' || p.status === 'handled'));

  // Posten finns på sitt ursprungliga datum och kan fortfarande rättas.
  klicka({ post: 'e1' });
  assert.match(html, /Redan klart i Lundify/);
  assert.match(html, /Spara ändring/);
  assert.doesNotMatch(html, /Ska faktureras|Behåll endast som historik/);
});

test('klickflöde: månadsmål och kunduppgifter sparas', async () => {
  const sparade = [];
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand: { ...skapaTestdata(), installningar: { veckomalOre: 2500000, manadsmalOre: null } },
  });

  klicka({ vy: 'uppfoljning' });
  assert.match(html, /Sätt månadsmål/);
  klicka({ oppna: 'manadsmal' });
  fyll('manadsmal', '100 000');
  klicka({ sparamanadsmal: '1' });
  await tom();
  assert.equal(sparade.at(-1).installningar.manadsmalOre, 10000000);

  klicka({ oppna: 'mer' });
  klicka({ oppna: 'kunder' });
  klicka({ redigerakund: 'k-a' });
  fyll('name', 'Kund A uppdaterad');
  fyll('contact', 'Kontaktperson');
  klicka({ valjkundstatus: 'paused' });
  klicka({ sparakund: 'k-a' });
  await tom();
  const kund = sparade.at(-1).clients.find(c => c.id === 'k-a');
  assert.equal(kund.name, 'Kund A uppdaterad');
  assert.equal(kund.contact, 'Kontaktperson');
  assert.equal(kund.status, 'paused');
});

test('klickflöde: priser och en felregistrering kan rättas', async () => {
  const sparade = [];
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand: skapaTestdata(),
  });

  klicka({ oppna: 'uppdrag' });
  klicka({ redigerauppdrag: 'u-behandling' });
  fyll('artikelpris_a-tillfalle', '2 500');
  klicka({ valjuppdragsmoms: 'a-tillfalle|1200' });
  fyll('standardresaKm', '46');
  klicka({ sparauppdrag: 'u-behandling' });
  await tom();

  let senast = sparade.at(-1);
  assert.equal(senast.articles.find(a => a.id === 'a-tillfalle').unitPriceOre, 250000);
  assert.equal(senast.articles.find(a => a.id === 'a-tillfalle').vatRate, 1200);
  assert.equal(senast.projects.find(p => p.id === 'u-behandling').defaultTripKm, 46);

  klicka({ post: 'p-1' });
  klicka({ valjandringartikel: 'b-timme' });
  fyll('mangd', '2');
  fyll('datum', '2026-08-20');
  klicka({ sparaandring: 'p-1' });
  await tom();

  senast = sparade.at(-1);
  const rattad = senast.poster.find(p => p.id === 'p-1');
  assert.equal(rattad.projectId, 'u-lektioner');
  assert.equal(rattad.articleId, 'b-timme');
  assert.equal(rattad.qtyMilli, 2000);
  assert.equal(rattad.date, '2026-08-20');
  assert.equal(rattad.seconds, 7200);
});

test('klickflöde: ett vilande uppdrag kan granskas och rättas utan att aktiveras', async () => {
  const sparade = [];
  const grund = skapaTestdata();
  const tillstand = {
    ...grund,
    clients: grund.clients.map(c => c.id === 'k-d' ? { ...c, status: 'paused' } : c),
    projects: grund.projects.map(p => p.id === 'u-avtal'
      ? { ...p, active: false, archivedAt: '2026-07-31' } : p),
    deliverables: grund.deliverables.filter(l => l.id !== 'lev-ofullstandig'),
  };
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand,
  });

  klicka({ oppna: 'uppdrag' });
  assert.match(html, /Vilande uppdrag/);
  assert.match(html, /data-redigerauppdrag="u-avtal"/);
  assert.match(html, /Granska priser och perioder/);
  assert.match(html, /data-aktiverabefintligt="u-avtal"/);

  klicka({ redigerauppdrag: 'u-avtal' });
  assert.match(html, /Vilande uppdrag\./);
  assert.match(html, /utan att aktivera uppdraget/);
  assert.match(html, /Fast pris – Löpande avtal, kvartal/);
  assert.match(html, /data-falt="leveranspris_lev-avtal"/);

  fyll('leveranspris_lev-avtal', '101 000');
  klicka({ sparauppdrag: 'u-avtal' });
  await tom();

  const sparat = sparade.at(-1);
  assert.equal(sparat.projects.find(p => p.id === 'u-avtal').active, false,
    'granskning och rättning får inte återaktivera uppdraget');
  assert.equal(sparat.deliverables.find(l => l.id === 'lev-avtal').amountOre, 10100000);
});

test('klickflöde: ett Sauna-pass ger 2 400 kr och tre arbetstimmar', async () => {
  const sparade = [];
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand: skapaTestdata(),
  });

  klicka({ oppna: 'uppdrag' });
  klicka({ redigerauppdrag: 'u-behandling' });
  fyll('artikelarbete_a-tillfalle', '3');
  klicka({ sparauppdrag: 'u-behandling' });
  await tom();

  klicka({ oppna: 'tillfalle' });
  klicka({ valjuppdrag: 'u-behandling' });
  klicka({ spara: '1' });
  await tom();

  const senast = sparade.at(-1);
  const post = senast.poster.at(-1);
  const artikel = senast.articles.find(a => a.id === post.articleId);
  assert.equal(post.projectId, 'u-behandling');
  assert.equal(post.qtyMilli, 1000, 'fakturakvantiteten är fortfarande ett pass');
  assert.equal(post.seconds, 10800, 'ett pass räknas som tre arbetstimmar');
  assert.equal(artikel.unitPriceOre, 240000, 'priset är fortfarande 2 400 kr');
});

test('klickflöde: fastprisarbete kan tidsloggas med anteckning utan fakturarad', async () => {
  const sparade = [];
  startaApp({
    lagring: { async spara(s) { sparade.push(structuredClone(s)); } },
    tillstand: skapaTestdata(),
  });

  klicka({ oppna: 'tid' });
  klicka({ valjuppdrag: 'u-verkstad' });
  klicka({ timmar: '3' });
  fyll('anteckning', 'Förberedelse inför verkstad');
  klicka({ spara: '1' });
  await tom();

  const senast = sparade.at(-1);
  const post = senast.poster.at(-1);
  const artikel = senast.articles.find(a => a.id === post.articleId);
  assert.equal(post.projectId, 'u-verkstad');
  assert.equal(post.seconds, 10800);
  assert.equal(post.anteckning, 'Förberedelse inför verkstad');
  assert.equal(artikel.type, 'trackingOnly');
  assert.equal(artikel.billable, false);
});
