// Korrigeringar efter användartestet.
//
// Ett test per rättelse, så att ingen av dem tyst kan falla tillbaka.
// Endast påhittade testdata.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as L from '../src/app/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const IDAG = new Date('2026-08-27T12:00:00');
const nyState = () => skapaTestdata(IDAG);
const dagar = (n) => {
  const d = new Date(IDAG); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// ── Idag ────────────────────────────────────────────────────────────────────

test('internt arbete visas som Inte fakturerbart, inte som noll kronor', () => {
  const s = nyState();
  const post = s.poster.find(p => p.projectId === 'u-internt');
  assert.equal(L.arEndastUppfoljning(s, post), true);
  assert.equal(L.kanIngaIFakturaunderlag(s, post), false);
  assert.equal(L.ejFakturerbarText(s, post), 'Inte fakturerbart');
});

test('fastpristid visas som Ingår i fast pris, inte som Inte fakturerbart', () => {
  const s = nyState();
  const post = s.poster.find(p => p.articleId === 'c-tid');
  assert.equal(L.ejFakturerbarText(s, post), 'Ingår i fast pris');
});

test('ideellt arbete visas också som Inte fakturerbart', () => {
  let s = nyState();
  s = { ...s, projects: s.projects.map(p => p.id === 'u-internt' ? { ...p, kind: 'voluntary' } : p) };
  const post = s.poster.find(p => p.projectId === 'u-internt');
  assert.equal(L.ejFakturerbarText(s, post), 'Inte fakturerbart');
});

test('rubriken upprepar inte samma ord två gånger', () => {
  const s = nyState();
  const internt = s.poster.find(p => p.projectId === 'u-internt');
  const rubrik = L.radrubrik(s, internt);
  assert.equal(rubrik, 'Internt bolagsarbete');
  assert.ok(!rubrik.includes('·'), 'ingen dubblering');
});

test('rubriken behåller båda namnen när de säger olika saker', () => {
  const s = nyState();
  const samtal = s.poster.find(p => p.articleId === 'a-samtal');
  assert.equal(L.radrubrik(s, samtal), 'Behandling · Samtal');
});

// ── Reseförslag ─────────────────────────────────────────────────────────────

test('en fysisk resa föreslås inte dubbelt vid samma besök', () => {
  let s = nyState();
  // Kunden får ett andra uppdrag. Arbete på båda samma dag är fortfarande
  // ETT besök och ska ge ETT reseförslag.
  s = {
    ...s,
    projects: [...s.projects,
      { id: 'u-behandling-2', name: 'Handledning', clientId: 'k-a', kind: 'billable', defaultTripKm: 23, sortOrder: 9 }],
    articles: [...s.articles,
      { id: 'a2-tim', projectId: 'u-behandling-2', name: 'Handledning', type: 'hourly', unit: 'tim',
        unitPriceOre: 95000, vatRate: 2500, vatStatus: 'reviewed', billable: true, active: true, sortOrder: 10 }],
  };
  s = L.laggTillPost(s, {
    id: 'p-annat-uppdrag', projectId: 'u-behandling-2', articleId: 'a2-tim', date: dagar(5),
    beskrivning: 'Handledning', qtyMilli: L.MILLI, seconds: 3600,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const forslag = L.saknadeResorForDag(s, dagar(5));
  assert.equal(forslag.filter(f => f.clientId === 'k-a').length, 1,
    'två uppdrag hos samma kund samma dag är ett besök');
});

test('två olika kunder samma dag är två besök och ger två förslag', () => {
  const s = nyState();
  const forslag = L.saknadeResorForDag(s, dagar(5));
  assert.equal(new Set(forslag.map(f => f.clientId)).size, forslag.length);
  assert.equal(forslag.length, 2);
});

test('en registrerad resa stoppar förslaget för hela kundbesöket', () => {
  let s = nyState();
  s = L.laggTillPost(s, {
    id: 'resa-k-a', projectId: 'u-behandling', articleId: 'a-resa-a', date: dagar(5),
    beskrivning: 'Resa', qtyMilli: 23 * L.MILLI, seconds: null,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  assert.ok(!L.saknadeResorForDag(s, dagar(5)).some(f => f.clientId === 'k-a'));
});

test('reseförslaget bär kundens namn, eftersom besöket gäller kunden', () => {
  const s = nyState();
  const forslag = L.saknadeResorForDag(s, dagar(5)).find(f => f.clientId === 'k-a');
  assert.equal(forslag.kundnamn, 'Kund A');
});

// ── Moms ────────────────────────────────────────────────────────────────────

test('momsen sätts bara på ett uttryckligt val, aldrig automatiskt', () => {
  const s = nyState();
  assert.throws(() => L.sattMoms(s, 'b-timme', null), /Välj en momssats/);
  assert.throws(() => L.sattMoms(s, 'b-timme', undefined), /Välj en momssats/);
  assert.throws(() => L.sattMoms(s, 'b-timme', 1700), /finns inte att välja/);

  const efter = L.sattMoms(s, 'b-timme', 2500);
  assert.equal(L.artikelFor(efter, 'b-timme').vatRate, 2500);
  assert.equal(L.artikelFor(efter, 'b-timme').vatStatus, 'reviewed');
  assert.equal(L.artikelFor(s, 'b-timme').vatRate, null, 'originalet är orört');
});

test('noll procent är ett giltigt val, inte ett saknat värde', () => {
  const s = nyState();
  const efter = L.sattMoms(s, 'b-timme', 0);
  assert.equal(L.artikelFor(efter, 'b-timme').vatRate, 0);
  assert.equal(L.forberedUnderlag(efter, 'k-b').ok, true);
});

test('momsspärren pekar ut vilken artikel som behöver ett val', () => {
  const s = nyState();
  assert.deepEqual(L.artiklarUtanMoms(s, 'k-b').map(a => a.name), ['Lektion']);
  assert.deepEqual(L.artiklarUtanMoms(s, 'k-a'), []);
});

test('momssatserna är ett fast urval utan förval', () => {
  assert.deepEqual(L.MOMSSATSER.map(m => m.sats), [2500, 1200, 600, 0]);
  assert.ok(!L.MOMSSATSER.some(m => m.vald || m.standard), 'ingen sats är förvald');
});

// ── Ångra och rätta ─────────────────────────────────────────────────────────

function medUnderlag(gruppId, valdaLeveranser = []) {
  let s = nyState();
  const res = L.forberedUnderlag(s, gruppId, { valdaLeveranser });
  assert.equal(res.ok, true);
  const referens = {
    id: res.underlag.id, clientId: res.grupp.clientId, period: res.grupp.period,
    nettoOre: res.underlag.nettoOre, momsOre: res.underlag.momsOre,
    attBetalaOre: res.underlag.attBetalaOre,
    invoiceNumber: null, klarmarkeradAt: null,
  };
  s = { ...s, poster: res.poster, invoiceRecords: [referens] };
  if (valdaLeveranser.length) {
    s = { ...s, deliverables: s.deliverables.map(l =>
      valdaLeveranser.includes(l.id) ? { ...l, status: 'included', invoiceRecordId: referens.id } : l) };
  }
  s = L.markeraKlart(s, referens.id, { datum: '2026-08-27' }).state;
  return { s, referens, underlag: res.underlag };
}

test('ett klarmarkerat underlag hamnar under Klart i Lundify', () => {
  const { s } = medUnderlag('k-a');
  const klara = L.klaraUnderlag(s);
  assert.equal(klara.length, 1);
  assert.equal(klara[0].kundnamn, 'Kund A');
  assert.equal(klara[0].klarmarkeradAt, '2026-08-27');
  assert.ok(!L.underlagsgrupper(s).some(g => g.clientId === 'k-a' && g.rader.length));
});

test('ångra flyttar tillbaka underlaget till Redo för Lundify', () => {
  const { s: fore, referens } = medUnderlag('k-a');

  const angrat = L.angraOverforing(fore, referens.id);
  assert.equal(angrat.ok, true);
  const s = angrat.state;

  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-a');
  assert.equal(grupp.lage, L.LAGE_REDO);
  assert.equal(grupp.rader.length, 4, 'alla poster är tillbaka');
  assert.equal(s.invoiceRecords.length, 0, 'ingen felaktig fakturamarkering blir kvar');
  assert.equal(L.klaraUnderlag(s).length, 0);
  assert.ok(s.poster.filter(p => p.projectId === 'u-behandling')
    .every(p => p.status === 'open' && !p.invoiceRecordId && !p.priceSnapshot));
});

test('ångra tar bort även ett antecknat fakturanummer', () => {
  let { s, referens } = medUnderlag('k-a');
  s = L.antecknaFakturanummer(s, referens.id, '2341').state;
  assert.equal(s.invoiceRecords[0].invoiceNumber, '2341');

  s = L.angraOverforing(s, referens.id).state;
  assert.equal(s.invoiceRecords.length, 0, 'ingen felaktig fakturamarkering blir kvar');
});

test('ångra frigör även valda leveranser', () => {
  const { s: fore, referens } = medUnderlag('k-c', ['lev-verkstad-1']);
  const s = L.angraOverforing(fore, referens.id).state;
  const lev = s.deliverables.find(l => l.id === 'lev-verkstad-1');
  assert.equal(lev.status, 'open');
  assert.equal(lev.invoiceRecordId, null);
});

test('efter ångra går posten att ändra igen', () => {
  const { s: fore, referens } = medUnderlag('k-a');
  assert.throws(() => L.andraPost(fore, 'p-1', { qtyMilli: 9000 }), /överfört/);
  const s = L.angraOverforing(fore, referens.id).state;
  assert.doesNotThrow(() => L.andraPost(s, 'p-1', { qtyMilli: 9000 }));
});

test('ångra ett underlag som inte finns ger ett begripligt besked', () => {
  const res = L.angraOverforing(nyState(), 'finns-inte');
  assert.equal(res.ok, false);
  assert.match(res.besked, /finns inte längre/);
});

test('fakturanummer krävs aldrig för att markera klart', () => {
  const { s } = medUnderlag('k-a');
  assert.equal(L.klaraUnderlag(s)[0].invoiceNumber, null);
  assert.ok(L.klaraUnderlag(s)[0].klarmarkeradAt, 'underlaget är ändå klart');
});

test('ett antecknat fakturanummer ändrar inte läget', () => {
  let { s, referens } = medUnderlag('k-a');
  const fore = L.klaraUnderlag(s)[0].klarmarkeradAt;
  s = L.antecknaFakturanummer(s, referens.id, '2341').state;
  assert.equal(L.klaraUnderlag(s)[0].klarmarkeradAt, fore);
  assert.equal(L.klaraUnderlag(s)[0].invoiceNumber, '2341');
});

// ── Tomma lägen ─────────────────────────────────────────────────────────────

test('en kund vars poster är klara visas inte som tomt underlag', () => {
  const { s } = medUnderlag('k-a');
  const kvar = L.underlagsgrupper(s).filter(g => g.clientId === 'k-a');
  assert.deepEqual(kvar, [], 'ingen tom rad och inga noll kronor');
});

test('en kund med bara en ovald leverans visar Ingen leverans vald', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-c');
  assert.equal(grupp.lage, L.LAGE_KONTROLL);
  assert.equal(grupp.atgard.besked, 'Ingen leverans vald');
  assert.equal(grupp.antalRader, 0);
  assert.equal(grupp.valbaraLeveranser, 1);
});

test('en kund med ogranskad moms hamnar under Behöver kontrolleras', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-b');
  assert.equal(grupp.lage, L.LAGE_KONTROLL);
  assert.equal(grupp.atgard.besked, 'Momsen behöver anges');
  assert.deepEqual(grupp.utanMoms.map(a => a.name), ['Lektion']);
});

test('en kund med poster att fakturera är Redo för Lundify', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-a');
  assert.equal(grupp.lage, L.LAGE_REDO);
  assert.equal(L.lagetikett(grupp.lage), 'Redo för Lundify');
});

test('kundkortet bär kund, period, sammanfattning och belopp', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-a');
  assert.equal(grupp.kundnamn, 'Kund A');
  assert.match(grupp.period, /^\d{4}-\d{2}$/);
  assert.ok(grupp.sammanfattning.length > 0);
  assert.ok(grupp.summaOre > 0);
});

// ── Underlaget ──────────────────────────────────────────────────────────────

test('underlaget anger vilken period det avser', () => {
  const res = L.forberedUnderlag(nyState(), 'k-a');
  const period = L.underlagsPeriod(res.underlag);
  assert.ok(period, 'en period ska finnas');
  assert.match(period, /^\d{4}-\d{2}-\d{2}/);
});

test('underlagets rubrik och text innehåller kunden och perioden', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-a');
  const text = L.lundifyText(s, res.underlag);
  assert.match(text, /^Underlag till Lundify – Kund A/);
  assert.match(text, /^Avser: /m);
  assert.match(text, /^Summa exklusive moms: /m);
  assert.match(text, /^Summa inklusive moms: /m);
});

test('varje rad i underlaget bär antal, á-pris och momssats', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-a');
  for (const rad of res.underlag.rader) {
    assert.ok(rad.datum, 'raden ska veta vilken dag den avser');
    assert.ok(rad.qtyMilli > 0);
    assert.ok(Number.isInteger(rad.unitPriceOre));
    assert.ok(rad.vatRate !== null && rad.vatRate !== undefined);
  }
});

test('momstexten skiljer noll procent från okänd moms', () => {
  assert.equal(L.momsText(0), '0 %');
  assert.equal(L.momsText(2500), '25 %');
  assert.equal(L.momsText(null), 'ej fastställd');
});

test('beskedet före klarmarkeringen säger vad som händer', () => {
  assert.equal(L.OVERFORINGSBESKED, 'Posterna flyttas från Redo för Lundify till Klart i Lundify.');
});

// ── Jobbat in ───────────────────────────────────────────────────────────────

test('jobbat in räknar tillfällen och timarbete, men inte resor', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.equal(v.delar.tillfallenOre, 480000, '2 tillfällen à 2 400');
  assert.equal(v.delar.timarbeteOre, 85000, '1 tim à 850');
  assert.equal(v.resorOre, 12650, 'resan redovisas separat');
  assert.equal(v.totaltUnderlagOre, 480000 + 85000 + 12650);
});

test('jobbat in räknar inte trackingOnly-tid i fastprisuppdrag', () => {
  const s = nyState();
  const fastprispost = s.poster.find(p => p.articleId === 'c-tid');
  assert.ok(fastprispost, 'testdatat har loggad fastpristid');
  assert.equal(L.raknasSomJobbatIn(s, fastprispost), false);

  const fore = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(fore.delar.timarbeteOre + fore.delar.tillfallenOre, 565000,
    'fastpristiden ökar inte det timdebiterade');
  assert.ok(fore.arbetadTidSekunder > 0, 'men tiden syns som arbetad tid');
});

test('jobbat in räknar inte internt eller ideellt arbete', () => {
  let s = nyState();
  assert.equal(L.raknasSomJobbatIn(s, s.poster.find(p => p.projectId === 'u-internt')), false);
  const fore = L.veckoSammanstallning(s, 0, IDAG).jobbatInOre;
  s = { ...s, projects: s.projects.map(p => p.id === 'u-internt' ? { ...p, kind: 'voluntary' } : p) };
  assert.equal(L.veckoSammanstallning(s, 0, IDAG).jobbatInOre, fore, 'ideellt räknas inte heller');
});

test('en resa räknas aldrig som jobbat in', () => {
  const s = nyState();
  const resa = s.poster.find(p => p.articleId === 'a-resa-a');
  assert.ok(resa, 'testdatat har en resa');
  assert.equal(L.raknasSomJobbatIn(s, resa), false);
  assert.equal(L.arKostnadsersattning(L.artikelFor(s, resa.articleId)), true);
});

test('ett utlägg räknas aldrig som jobbat in', () => {
  const artikel = { id: 'x', projectId: 'u-behandling', name: 'Utlägg', type: 'piece',
    unit: 'kr', unitPriceOre: 100, vatRate: 2500, vatStatus: 'reviewed', billable: true, active: true };
  let s = nyState();
  s = { ...s, articles: [...s.articles, artikel] };
  const post = { id: 'u1', projectId: 'u-behandling', articleId: 'x', date: dagar(1), qtyMilli: 100 * L.MILLI };
  assert.equal(L.raknasSomJobbatIn(s, post), false);
  assert.equal(L.arKostnadsersattning(artikel), true);
});

test('jobbat in räknar inte moms', () => {
  const s = nyState();
  const v = L.veckoSammanstallning(s, 0, IDAG);

  // Samma poster, samma vecka, men summerade rakt av utan moms.
  const veckansPoster = s.poster.filter(p => L.veckansDatum(0, IDAG).includes(p.date));
  const nettoUtanMoms = L.fakturerbartOre(s, veckansPoster.filter(p =>
    L.uppdragFor(s, p.projectId)?.kind === 'billable'));

  assert.equal(v.delar.timarbeteOre + v.delar.tillfallenOre + v.resorOre, nettoUtanMoms,
    'jobbat in bygger på nettot');

  // Och beloppet inklusive moms är ett annat, större tal.
  const underlag = L.forhandsvisa(s, 'k-a');
  assert.ok(underlag.momsOre > 0, 'det finns moms att råka räkna med');
  assert.ok(underlag.attBetalaOre > underlag.nettoOre);
});

test('jobbat in räknar inte rena utlägg', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG).jobbatInOre;
  s = {
    ...s,
    articles: [...s.articles, {
      id: 'a-utlagg', projectId: 'u-behandling', name: 'Vidarefakturerat utlägg',
      type: 'piece', unit: 'kr', unitPriceOre: 100, vatRate: 2500, vatStatus: 'reviewed',
      billable: true, active: true, sortOrder: 95,
    }],
  };
  s = L.laggTillPost(s, {
    id: 'p-utlagg', projectId: 'u-behandling', articleId: 'a-utlagg', date: dagar(1),
    beskrivning: 'Parkering', qtyMilli: 300 * L.MILLI, seconds: null,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const v = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(v.jobbatInOre, fore, 'utlägget ökar inte det inarbetade');
  assert.equal(v.utlaggOre, 30000, 'men redovisas separat');
  assert.equal(L.raknasSomJobbatIn(s, s.poster.find(p => p.id === 'p-utlagg')), false);
});

test('en fast ersättning räknas över sin period, inte när den genomförs', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG).delar.fastPrisAndelOre;

  // Att markera genomförd lägger inte till något i veckan.
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(1)).state;
  assert.equal(L.veckoSammanstallning(s, 0, IDAG).delar.fastPrisAndelOre, fore);
});

test('veckomålet jämförs med jobbat in och är frivilligt', () => {
  const s = nyState();
  const v = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(v.harMal, true);
  assert.equal(v.malOre, 2500000);
  assert.equal(v.kvarOre, Math.max(2500000 - v.jobbatInOre, 0));
  assert.match(L.maltext(v), /av veckans mål/);

  const u = L.veckoSammanstallning({ ...s, installningar: { veckomalOre: null } }, 0, IDAG);
  assert.equal(u.harMal, false);
  assert.equal(L.maltext(u), null, 'utan mål visas ingen måltext');
});

test('målet jämförs med jobbat in, inte med det totala underlaget', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.notEqual(v.totaltUnderlagOre, v.jobbatInOre, 'de två talen är inte samma sak');
  const forvantat = v.jobbatInOre >= v.malOre ? 0 : v.malOre - v.jobbatInOre;
  assert.equal(v.kvarOre, forvantat, 'målet räknar bara jobbat in');
});

test('appen räknar ingen lön, skatt eller budget', () => {
  const s = nyState();
  assert.deepEqual(Object.keys(s.installningar), ['veckomalOre']);
  const v = L.veckoSammanstallning(s, 0, IDAG);
  for (const falt of ['bruttolon', 'nettolon', 'skatt', 'avgifter', 'budget', 'prognos', 'loneutrymme']) {
    assert.ok(!(falt in v), `sammanställningen får inte innehålla ${falt}`);
  }
});
