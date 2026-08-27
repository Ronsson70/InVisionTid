// Fastpris över en avtalsperiod.
//
// Två skilda beräkningar som aldrig får blandas ihop:
//
//   1. Jobbat in — beloppet fördelas över avtalsperiodens kalenderdagar.
//   2. Fakturaunderlag — beloppet faktureras enligt avtalet, aldrig per vecka.
//
// Alla belopp i heltalsöre. Fördelningen ska vara deterministisk och summan av
// alla veckor exakt lika med periodens totalpris.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  periodDagar, periodKontroll, dagsandelOre, periodandelOre, periodensDatum,
  harAvtalsperiod, arGenomford, byggUnderlag,
} from '../src/domain/index.mjs';
import * as L from '../src/app/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const IDAG = new Date('2026-08-27T12:00:00');
const period = (startDate, endDate, amountOre = 10000000) => ({
  id: 'lev', projectId: 'p', name: 'Avtal', amountOre,
  vatRate: 2500, vatStatus: 'reviewed', status: 'open', startDate, endDate,
});

/** Kalenderveckor, måndag till söndag, som täcker ett datumintervall. */
function veckorFor(startDate, endDate) {
  const datum = periodensDatum(period(startDate, endDate));
  const veckor = new Map();
  for (const d of datum) {
    const o = new Date(d + 'T12:00:00');
    const mandag = new Date(o);
    mandag.setDate(o.getDate() + (o.getDay() === 0 ? -6 : 1 - o.getDay()));
    const nyckel = mandag.toISOString().slice(0, 10);
    if (!veckor.has(nyckel)) veckor.set(nyckel, []);
    veckor.get(nyckel).push(d);
  }
  return [...veckor.values()];
}

// ── Periodlängd ─────────────────────────────────────────────────────────────

test('periodlängd räknar båda ändpunkterna', () => {
  assert.equal(periodDagar('2026-04-01', '2026-04-01'), 1);
  assert.equal(periodDagar('2026-04-01', '2026-04-30'), 30);
  assert.equal(periodDagar('2026-04-01', '2026-06-30'), 91, 'april till juni är 91 dagar');
});

test('periodlängd hanterar månadsskifte, årsskifte och skottår', () => {
  assert.equal(periodDagar('2026-01-31', '2026-02-01'), 2);
  assert.equal(periodDagar('2026-12-30', '2027-01-02'), 4);
  assert.equal(periodDagar('2028-02-01', '2028-03-01'), 30, '2028 är skottår');
});

test('periodlängd avvisar baklänges period och skräpdatum', () => {
  assert.equal(periodDagar('2026-06-30', '2026-04-01'), null);
  assert.equal(periodDagar('inte-ett-datum', '2026-04-01'), null);
});

// ── Fördelning ──────────────────────────────────────────────────────────────

test('fast pris över flera hela veckor fördelas jämnt', () => {
  // 100 000 kr över 91 dagar. En hel vecka blir 7 692,30 kr.
  const p = period('2026-04-01', '2026-06-30');
  const helVecka = ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19'];
  assert.equal(periodandelOre(p, helVecka), 769230);
});

test('en period som börjar mitt i en vecka ger bara sina egna dagar', () => {
  // 1 april 2026 är en onsdag. Veckan 30 mars till 5 april har tre dagar utanför.
  const p = period('2026-04-01', '2026-06-30');
  const forstaVeckan = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'];
  const dagarInom = 5;
  const summa = periodandelOre(p, forstaVeckan);
  assert.equal(dagsandelOre(p, '2026-03-31'), 0, 'dagen före perioden ger noll');
  assert.ok(summa > 0 && summa < 769230, 'mindre än en hel vecka');
  // Fem dagar, varav de första bär resten på ett öre.
  assert.equal(summa, dagarInom * Math.floor(10000000 / 91) + Math.min(dagarInom, 10000000 - Math.floor(10000000 / 91) * 91));
});

test('en period som slutar mitt i en vecka ger bara sina egna dagar', () => {
  const p = period('2026-04-01', '2026-06-30');
  const sistaVeckan = ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
  assert.equal(dagsandelOre(p, '2026-07-01'), 0, 'dagen efter perioden ger noll');
  const bas = Math.floor(10000000 / 91);
  assert.equal(periodandelOre(p, sistaVeckan), 2 * bas);
});

test('summan av alla veckor blir exakt totalpriset', () => {
  for (const [start, slut, belopp] of [
    ['2026-04-01', '2026-06-30', 10000000],
    ['2026-01-01', '2026-12-31', 12345678],
    ['2026-12-15', '2027-01-15', 3333333],     // årsskifte
    ['2026-05-06', '2026-05-06', 700000],      // en enda dag
    ['2026-02-01', '2026-03-31', 99999901],    // månadsskifte, ojämnt belopp
  ]) {
    const p = period(start, slut, belopp);
    const summa = veckorFor(start, slut).reduce((s, v) => s + periodandelOre(p, v), 0);
    assert.equal(summa, belopp, `${start} till ${slut} med ${belopp} öre`);
  }
});

test('summan av alla dagar blir exakt totalpriset', () => {
  const p = period('2026-04-01', '2026-06-30', 10000001);
  const dagar = periodensDatum(p);
  assert.equal(dagar.length, 91);
  assert.equal(dagar.reduce((s, d) => s + dagsandelOre(p, d), 0), 10000001);
});

test('fördelningen sker i heltalsöre och är deterministisk', () => {
  const p = period('2026-04-01', '2026-06-30', 10000000);
  const dagar = periodensDatum(p);
  for (const d of dagar) assert.ok(Number.isInteger(dagsandelOre(p, d)), `${d} ska ge heltal`);

  // Resten läggs på periodens första dagar, alltid lika.
  const bas = Math.floor(10000000 / 91);
  assert.equal(dagsandelOre(p, '2026-04-01'), bas + 1);
  assert.equal(dagsandelOre(p, '2026-06-30'), bas);
  assert.equal(dagsandelOre(p, '2026-04-01'), dagsandelOre(p, '2026-04-01'), 'samma svar varje gång');
});

test('ett ojämnt belopp fördelas utan att en enda öre försvinner', () => {
  const p = period('2026-04-01', '2026-04-03', 100);   // 3 dagar, 100 öre
  assert.deepEqual(periodensDatum(p).map(d => dagsandelOre(p, d)), [34, 33, 33]);
  assert.equal(periodandelOre(p, periodensDatum(p)), 100);
});

// ── Ofullständiga perioder ──────────────────────────────────────────────────

test('en period utan slutdatum räknas inte in, och gissas inte', () => {
  const p = { ...period('2026-04-01', null) };
  assert.equal(periodKontroll(p).giltig, false);
  assert.equal(periodKontroll(p).orsak, 'Upparbetningsperioden behöver anges');
  assert.equal(dagsandelOre(p, '2026-04-15'), 0);
});

test('en period utan startdatum eller belopp räknas inte in', () => {
  assert.equal(periodKontroll({ ...period(null, '2026-06-30') }).giltig, false);
  assert.equal(periodKontroll({ ...period('2026-04-01', '2026-06-30', 0) }).giltig, false);
  assert.equal(periodKontroll({ ...period('2026-04-01', '2026-06-30', null) }).giltig, false);
});

test('en baklänges period räknas inte in', () => {
  assert.equal(periodKontroll(period('2026-06-30', '2026-04-01')).giltig, false);
});

test('en leverans utan datum alls är ingen avtalsperiod', () => {
  assert.equal(harAvtalsperiod({ id: 'x', amountOre: 5000000 }), false);
  assert.equal(harAvtalsperiod(period('2026-04-01', '2026-06-30')), true);
});

// ── Jobbat in ───────────────────────────────────────────────────────────────

const nyState = () => skapaTestdata(IDAG);

test('veckans jobbat in innehåller fastprisets veckoandel', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  // Kvartalsavtalet ger 7 692,30 kr och Verkstad 1 ger 12 499,97 kr.
  assert.equal(v.delar.fastPrisAndelOre, 769230 + 1249997);
  assert.equal(v.jobbatInOre,
    v.delar.timarbeteOre + v.delar.tillfallenOre + v.delar.styckOre + v.delar.fastPrisAndelOre);
  assert.ok(!('leveransOre' in v.delar), 'det finns ingen klumpsumma längre');
});

test('fastprisandelen ingår ALDRIG i fakturaunderlaget', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.ok(v.delar.fastPrisAndelOre > 0);
  assert.equal(v.totaltUnderlagOre,
    v.delar.timarbeteOre + v.delar.tillfallenOre + v.delar.styckOre + v.resorOre + v.utlaggOre);
  assert.ok(v.totaltUnderlagOre < v.jobbatInOre, 'underlaget är mindre eftersom fastpriset inte faktureras per vecka');
});

test('en veckofördelad fastprisandel blir aldrig en fakturarad', () => {
  const s = nyState();
  const underlag = byggUnderlag({
    artiklar: s.articles,
    poster: s.poster.filter(p => p.projectId === 'u-avtal'),
    leveranser: s.deliverables,
    valdaLeveranser: [],                 // inget valt
    clientId: 'k-d',
  });
  assert.equal(underlag.rader.length, 0, 'ingen automatisk veckofaktura');
  assert.equal(underlag.nettoOre, 0);
});

test('när avtalet faktureras dubbelräknas inte upparbetningen', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG);

  // Avtalet faktureras. Upparbetningen ska vara oförändrad.
  s = { ...s, deliverables: s.deliverables.map(l =>
    l.id === 'lev-avtal' ? { ...l, status: 'invoiced', invoiceRecordId: 'r1' } : l) };
  const efter = L.veckoSammanstallning(s, 0, IDAG);

  assert.equal(efter.delar.fastPrisAndelOre, fore.delar.fastPrisAndelOre);
  assert.equal(efter.jobbatInOre, fore.jobbatInOre, 'beloppet läggs inte på en gång till');
});

test('en ofullständig period flaggas i stället för att räknas', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.equal(v.ofullstandigaPerioder.length, 1);
  assert.equal(v.ofullstandigaPerioder[0].orsak, 'Upparbetningsperioden behöver anges');
  assert.equal(v.ofullstandigaPerioder[0].namn, 'Avtal utan slutdatum');
});

test('trackingOnly-tid läggs inte ovanpå den fördelade fastprissumman', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG);

  // Sex timmar loggas på avtalsuppdraget. Beloppet ska inte röra sig.
  s = {
    ...s,
    articles: [...s.articles, {
      id: 'a-avtal-tid', projectId: 'u-avtal', name: 'Nedlagd tid', type: 'trackingOnly',
      unit: 'tim', unitPriceOre: 0, vatRate: 2500, vatStatus: 'reviewed',
      billable: false, active: true, sortOrder: 80,
    }],
  };
  s = L.laggTillPost(s, {
    id: 'p-avtal-tid', projectId: 'u-avtal', articleId: 'a-avtal-tid',
    date: L.veckansDatum(0, IDAG)[1], beskrivning: 'Arbete', qtyMilli: 6 * L.MILLI,
    seconds: 21600, status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const efter = L.veckoSammanstallning(s, 0, IDAG);

  assert.equal(efter.jobbatInOre, fore.jobbatInOre, 'ingen extra intäkt');
  assert.equal(efter.arbetadTidSekunder, fore.arbetadTidSekunder + 21600, 'men tiden syns');
});

test('moms räknas inte in i jobbat in', () => {
  const s = nyState();
  const v = L.veckoSammanstallning(s, 0, IDAG);
  const veckan = L.veckansDatum(0, IDAG);
  const summaAvPerioder = s.deliverables
    .filter(l => periodKontroll(l).giltig)
    .reduce((sum, l) => sum + periodandelOre(l, veckan), 0);
  assert.ok(s.deliverables.every(l => l.vatRate === 2500), 'det finns moms att råka räkna med');
  // Andelarna är exakt veckans del av nettobeloppen, utan påslag.
  assert.equal(v.delar.fastPrisAndelOre, summaAvPerioder);
});

// ── Upparbetning kontra genomförande ────────────────────────────────────────

test('en genomförandemarkering ändrar inte veckans jobbat in', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG);

  s = L.markeraGenomford(s, 'lev-verkstad-2', L.veckansDatum(0, IDAG)[2]).state;
  const efter = L.veckoSammanstallning(s, 0, IDAG);

  assert.equal(efter.jobbatInOre, fore.jobbatInOre,
    'hela beloppet läggs aldrig ovanpå veckan');
  assert.equal(efter.delar.fastPrisAndelOre, fore.delar.fastPrisAndelOre);
});

test('en avtalsperiod räknas varje vecka den pågår', () => {
  const s = nyState();
  const denna = L.veckoSammanstallning(s, 0, IDAG);
  const forra = L.veckoSammanstallning(s, -1, IDAG);
  assert.ok(denna.delar.fastPrisAndelOre > 0);
  assert.ok(forra.delar.fastPrisAndelOre > 0, 'perioden pågår även föregående vecka');
});

test('utanför alla perioder ger fastpriset ingenting', () => {
  const s = nyState();
  assert.equal(L.veckoSammanstallning(s, 40, IDAG).delar.fastPrisAndelOre, 0);
});
