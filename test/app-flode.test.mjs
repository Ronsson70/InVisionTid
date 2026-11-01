// Kritiska klickflöden genom det verkliga produktionsgränssnittet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { skapaTestdata } from '../prototyp/testdata.mjs';
import { planeraHistorikimport } from '../src/app/historikimport.mjs';
import { FORETAG } from '../src/app/arbetsflode.mjs';

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
  const nod = { dataset, classList: { contains: () => false }, closest: selector =>
    Object.keys(dataset).some(key => selector.includes(`[data-${key}]`)) ? nod : null };
  lyssnare.click({ target: nod });
};
const fyll = (falt, value) => {
  faltvarden.set(falt, value);
  lyssnare.input({ target: { dataset: { falt }, value } });
};
const tom = () => new Promise(resolve => setImmediate(resolve));

const { startaApp } = await import('../src/app/ui.mjs');

test('egna timmar och kundens samlade arbete registreras hos rätt fakturerande företag', async () => {
  const sparade = [];
  const s = skapaTestdata();
  s.projects.forEach(p => { p.billingCompany = FORETAG[0]; });
  s.projects.push({ id: 'kundjobb', clientId: 'k-a', name: 'Kundens städning', kind: 'billable', active: true, billingCompany: FORETAG[1] });
  s.articles.push({ id: 'stadpris', projectId: 'kundjobb', name: 'Städning', type: 'hourly', unit: 'tim', unitPriceOre: 50000, vatRate: 2500, vatStatus: 'reviewed', billable: true, active: true });
  startaApp({ tillstand: s, lagring: { async spara(s) { sparade.push(structuredClone(s)); } } });
  klicka({ vy: 'fakturera' });
  klicka({ faktureringsval: FORETAG[1] });
  assert.match(html, /timmar förs inte över automatiskt/);
  klicka({ fakturaarbete: 'tid' });
  assert.match(html, /Kundens städning/);
  assert.ok(!html.includes('data-valjuppdrag="u-a"'));
  fyll('performedBy', 'Testperson A');
  klicka({ timmar: '3' });
  klicka({ spara: '1' });
  await tom();
  assert.equal(sparade.at(-1).poster.at(-1).projectId, 'kundjobb');
  assert.equal(sparade.at(-1).poster.at(-1).performedBy, 'Testperson A');
  assert.equal(sparade.at(-1).poster.at(-1).qtyMilli, 3000);
  klicka({ fakturaarbete: 'tid' });
  fyll('performedBy', 'Testperson B');
  klicka({ timmar: '3' });
  klicka({ spara: '1' });
  await tom();
  const { underlagsgrupper } = await import('../src/app/logik.mjs');
  const kundgrupp = underlagsgrupper(sparade.at(-1)).find(g => g.billingCompany === FORETAG[1]);
  assert.equal(kundgrupp.rader.length, 2);
  assert.equal(kundgrupp.loggadTidSekunder, 21600);
  assert.equal(kundgrupp.summaOre, 300000);
  klicka({ faktureringsval: FORETAG[0] });
  klicka({ fakturaarbete: 'tid' });
  assert.ok(!html.includes('data-valjuppdrag="kundjobb"'));
  assert.match(html, /Faktureringsväg/);
  klicka({ stang: 'knapp' });
  klicka({ faktureringsval: '' });
  lyssnare.change({ target: { dataset: { filter: 'foretag' }, value: '' } });
});

test('tomt företagsurval väljer aldrig ett uppdrag från det andra företaget', async () => {
  const s = skapaTestdata();
  s.projects.forEach(p => { p.billingCompany = FORETAG[0]; });
  let sparningar = 0;
  startaApp({ tillstand: s, lagring: { async spara() { sparningar++; } } });
  klicka({ vy: 'fakturera' });
  klicka({ faktureringsval: FORETAG[1] });
  klicka({ fakturaarbete: 'tid' });
  assert.match(html, /Inget uppdrag med den här arbetstypen/);
  assert.match(html, /data-spara="1" disabled/);
  klicka({ spara: '1' });
  await tom();
  assert.equal(sparningar, 0);
  klicka({ stang: 'knapp' });
  lyssnare.change({ target: { dataset: { filter: 'foretag' }, value: '' } });
});

test('företagsfilter döljer inte äldre underlag och avslutade underlag ligger i historik', () => {
  const s = skapaTestdata();
  s.invoiceRecords.push({ id: 'gammalt-underlag', clientId: 'k-a', period: '2026-09', nettoOre: 10000, klarmarkeradAt: '2026-09-30' });
  startaApp({ lagring: { async spara() { throw new Error('Läsning ska inte skriva'); } }, tillstand: s });
  klicka({ vy: 'fakturera' });
  lyssnare.change({ target: { dataset: { filter: 'foretag' }, value: FORETAG[0] } });
  lyssnare.change({ target: { dataset: { filter: 'manad' }, value: '2026-09' } });
  assert.match(html, /underlag saknar uppgift om fakturerande företag/);
  assert.match(html, /gammalt-underlag/);
  assert.match(html, /<details class="avsnitt"><summary>Historik/);
  assert.ok(!/<details class="avsnitt" open/.test(html));
  lyssnare.change({ target: { dataset: { filter: 'foretag' }, value: '' } });
  lyssnare.change({ target: { dataset: { filter: 'manad' }, value: '' } });
});

test('underlagets skärmvy behåller ören i rader, summor och avrundning', () => {
  const s = skapaTestdata();
  s.poster = s.poster.filter(p => p.id === 'p-2').map(p => ({ ...p, status: 'included', invoiceRecordId: 'exakt-underlag' }));
  s.invoiceRecords = [{ id: 'exakt-underlag', clientId: 'k-a', period: s.poster[0].date.slice(0, 7) }];
  startaApp({ lagring: { async spara() { throw new Error('Läsning ska inte skriva'); } }, tillstand: s });
  klicka({ sparatunderlag: 'exakt-underlag' });
  assert.match(html, /126,50 kr/);
  assert.match(html, /Moms<\/span><span>31,63 kr/);
  assert.match(html, /Öresavrundning<\/span><span>−0,13 kr/);
  assert.match(html, /Inklusive moms<\/span><span>158 kr/);
  klicka({ stang: 'knapp' });
});

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
  fyll('anteckning', 'Tema: återfallsprocessen');
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

test('klickflöde: äldre klarmarkering får inte frigöra historiska poster', async () => {
  const s = skapaTestdata();
  s.poster[0] = { ...s.poster[0], invoiceRecordId: 'legacy', status: 'included', priceSnapshot: { unitPriceOre: 240000 } };
  s.invoiceRecords = [{ id: 'legacy', clientId: 'k-a', period: '2026-08', klarmarkeradAt: '2026-08-27' }];
  const sparade = [];
  startaApp({ tillstand: s, lagring: { async spara(x) { sparade.push(x); } } });
  klicka({ vy: 'fakturera' });
  assert.match(html, /Äldre underlag – behöver avstämmas/);
  klicka({ angra: 'legacy' });
  await tom();
  assert.equal(sparade.length, 0);
  assert.equal(s.poster[0].invoiceRecordId, 'legacy');
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
  fyll('anteckning', 'Tema: sinnesro');
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

// Det verkliga felet: Sauna hade bara en tillfällesartikel, och eftersom
// registreringsknappen Tid letar efter artiklar av typen hourly saknades
// uppdraget där helt. Hela vägen genom gränssnittet, från knapp till sparat
// tillstånd till att uppdraget dyker upp under Tid.
test('klickflöde: ett tillfällesuppdrag kan få en timartikel och syns sedan under Tid', async () => {
  const sparade = [];
  const lagring = { async spara(s) { sparade.push(structuredClone(s)); } };
  startaApp({ lagring, tillstand: skapaTestdata(), tidigareUppdrag: [] });

  klicka({ oppna: 'mer' });
  klicka({ oppna: 'uppdrag' });
  klicka({ oppna: 'nyttuppdrag' });
  klicka({ valjkund: 'k-a' });
  fyll('namn', 'Passuppdrag');
  klicka({ valjdebitering: 'session' });
  fyll('pris', '2400');
  fyll('arbetstidTimmar', '3');
  klicka({ valjnyvat: '0' });
  klicka({ sparanyttuppdrag: '1' });
  await tom();

  const projectId = sparade.at(-1).projects.find(p => p.name === 'Passuppdrag').id;
  const artiklarFore = sparade.at(-1).articles.filter(a => a.projectId === projectId);
  assert.deepEqual(artiklarFore.map(a => a.type), ['session']);

  // Uppdraget går ännu inte att välja under Tid.
  klicka({ oppna: 'tid' });
  assert.ok(!/Passuppdrag/.test(html));
  klicka({ stang: 'knapp' });

  klicka({ oppna: 'mer' });
  klicka({ oppna: 'uppdrag' });
  klicka({ redigerauppdrag: projectId });
  assert.match(html, /Lägg till artikel/);

  klicka({ valjnyartikeltyp: 'oppna' });
  klicka({ valjnyartikeltyp: 'hourly' });
  fyll('nyartikelnamn', 'Samtal');
  fyll('nyartikelpris', '850');
  klicka({ valjnyartikelmoms: '2500' });
  klicka({ sparanyartikel: projectId });
  await tom();

  const ny = sparade.at(-1).articles.find(a => a.projectId === projectId && a.type === 'hourly');
  assert.equal(ny.name, 'Samtal');
  assert.equal(ny.unitPriceOre, 85000);
  assert.equal(ny.vatRate, 2500);
  // Passen är orörda och fortfarande momsfria.
  assert.equal(sparade.at(-1).articles.find(a => a.projectId === projectId && a.type === 'session').vatRate, 0);

  // Och nu går uppdraget att välja under Tid.
  klicka({ oppna: 'tid' });
  assert.match(html, /Passuppdrag/);
});

test('Visa underlag, upprepade klick och stäng skriver inte; explicit spara skriver en gång', async () => {
  const L = await import('../src/app/logik.mjs');
  const state = skapaTestdata();
  state.projects.forEach(p => { p.billingCompany = L.FORETAG[0]; });
  const original = structuredClone(state);
  const saved = [];
  startaApp({ tillstand: state, lagring: { async spara(x) { saved.push(structuredClone(x)); } } });
  const group = L.underlagsgrupper(state).find(g => g.clientId === 'k-a');
  klicka({ underlag: group.id });
  assert.match(html, /Förhandsvisning. Ingenting har sparats eller låsts/);
  klicka({ stang: 'knapp' });
  klicka({ underlag: group.id });
  await tom();
  assert.equal(saved.length, 0); assert.deepEqual(state, original);
  klicka({ sparaforberett: '1' });
  klicka({ sparaforberett: '1' });
  await tom();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].invoiceRecords.length, original.invoiceRecords.length + 1);
  assert.match(html, /Sparat förberett/);
  klicka({ stang: 'knapp' });
  klicka({ sparatunderlag: saved[0].invoiceRecords.at(-1).id });
  await tom(); assert.equal(saved.length, 1);
});

test('kundprofil sparas endast explicit och hålls separat per fakturerande bolag', async () => {
  const sparade = [];
  const state = skapaTestdata();
  startaApp({ tillstand: state, lagring: { async spara(s) { sparade.push(structuredClone(s)); } } });
  klicka({ redigerakund: 'k-a' });
  assert.match(html, /Gemensamma faktureringsvillkor per bolag/);
  fyll('cp_0_paymentTermsDays', '10');
  fyll('cp_0_invoiceText', 'Testvillkor A');
  fyll('cp_0_travelGrouping', 'purpose');
  fyll('cp_1_paymentTermsDays', '20');
  await tom();
  assert.equal(sparade.length, 0);
  klicka({ sparakund: 'k-a' });
  await tom();
  const c = sparade.at(-1).clients.find(c => c.id === 'k-a');
  assert.equal(c.billingProfiles[FORETAG[0]].paymentTermsDays, 10);
  assert.equal(c.billingProfiles[FORETAG[1]].paymentTermsDays, 20);
  assert.equal(c.billingProfiles[FORETAG[0]].travelGrouping, 'purpose');
  assert.deepEqual(sparade.at(-1).poster, state.poster);
});

test('kvittots bildbehandling begränsar storlek, sparar arbetskopia och skickar inte bild i underlaget', async () => {
  const saved = [], calls = [];
  const state = skapaTestdata();
  const previousBitmap = globalThis.createImageBitmap;
  const previousCreate = document.createElement;
  let canvas;
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 800, close() { calls.push('close'); } });
  document.createElement = name => {
    assert.equal(name, 'canvas');
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { calls.push('draw'); } }),
      toDataURL(type, quality) { assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.8); return 'data:image/jpeg;base64,dGVzdA=='; } };
    return canvas;
  };
  try {
    startaApp({ tillstand: state, lagring: { async spara(s) { saved.push(structuredClone(s)); } } });
    klicka({ oppna: 'utlagg' });
    await lyssnare.change({ target: { dataset: { kvitto: '1' }, files: [{ type: 'image/png', size: 1000 }] } });
    assert.equal(canvas.width, 1200); assert.equal(canvas.height, 600);
    assert.deepEqual(calls, ['draw', 'close']); assert.match(html, /Kvitto att spara/);
    fyll('projectId', 'u-behandling'); fyll('description', 'Syntetiskt inköp'); fyll('gross', '125');
    fyll('receiptVat', '2500'); fyll('invoiceVat', '2500'); fyll('rebill', 'yes');
    klicka({ sparautlagg: '1' }); await tom();
    const post = saved.at(-1).poster.at(-1);
    assert.equal(post.receiptImage, 'data:image/jpeg;base64,dGVzdA==');
    assert.equal(post.qtyMilli, 100000);
    const L = await import('../src/app/logik.mjs');
    const group = L.underlagsgrupper(saved.at(-1)).find(g => g.rader.some(r => r.post.id === post.id));
    assert.ok(group);
    const preview = L.forberedUnderlag(saved.at(-1), group.id);
    assert.ok(!L.lundifyText(saved.at(-1), preview.underlag).includes('data:image'));
  } finally { globalThis.createImageBitmap = previousBitmap; document.createElement = previousCreate; }
});

test('registrerat underlag kan få spårbart rättelsebehov via UI utan att frigöra poster', async () => {
  const L = await import('../src/app/logik.mjs');
  let state = skapaTestdata(); state.projects.forEach(p => { p.billingCompany = FORETAG[0]; });
  const group = L.underlagsgrupper(state).find(g => g.clientId === 'k-a' && g.rader.length);
  const preview = L.forberedUnderlag(state, group.id);
  const prepared = L.sparaForberett(state, group.id, [], L.kontrollversion(state, preview.underlag));
  assert.equal(prepared.ok, true);
  const r = prepared.referens;
  state = L.kontrolleraDokument(prepared.state, r.id, {kind:'registered', reference:'TEST-UI-1', customerId:'TEST-C1', nettoOre:r.nettoOre, confirmed:true, invoiceDate:'2026-10-31'}).state;
  const saved=[];
  startaApp({tillstand:state,lagring:{async spara(s){saved.push(structuredClone(s));}}});
  klicka({sparatunderlag:r.id});
  assert.match(html,/Rättelsebehov för faktura TEST-UI-1/);
  fyll('rattelseorsak','Test: kontrollera antal');
  klicka({rattelsebehov:r.id}); await tom();
  assert.equal(saved.at(-1).invoiceRecords.find(x=>x.id===r.id).correctionPending,true);
  assert.deepEqual(saved.at(-1).poster,state.poster);
  assert.match(html,/Test: kontrollera antal/);
  klicka({rattelsebehov:r.id}); await tom();
  assert.equal(saved.length,1);
});
