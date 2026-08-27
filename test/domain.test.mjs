// Enhetstester för domänens primitiver.
//
// Acceptansfallen T1–T13 provar hela kedjan. De här testerna provar kantfallen
// under: negativ avrundning, spill, okänd moms, ogiltiga övergångar. Det är där
// felen bor som inte syns i ett gladlynt exempel.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../src/domain/index.mjs';
import { laddaV1Fixture } from './lib/pure-v1.mjs';

// ── ROUND_HALF_UP ───────────────────────────────────────────────────────────

test('roundHalfUp: halva avrundas uppåt', () => {
  assert.equal(d.roundHalfUp(2854625, 10), 285463);
  assert.equal(d.roundHalfUp(918750, 100), 9188);
  assert.equal(d.roundHalfUp(5, 10), 1);
  assert.equal(d.roundHalfUp(15, 10), 2);
});

test('roundHalfUp: halva avrundas BORT FRÅN NOLL för negativa tal', () => {
  // Math.round(-0.5) ger -0, alltså halva mot plus oändligheten.
  // På en kreditfaktura blir det fel åt fel håll.
  assert.equal(d.roundHalfUp(-5, 10), -1);
  assert.equal(d.roundHalfUp(-2854625, 10), -285463);
  assert.equal(d.roundHalfUp(-50, 100), -1);
  assert.notEqual(d.roundHalfUp(-5, 10), Math.round(-0.5));
});

test('roundHalfUp: under halva avrundas nedåt, över halva uppåt', () => {
  assert.equal(d.roundHalfUp(4, 10), 0);
  assert.equal(d.roundHalfUp(6, 10), 1);
  assert.equal(d.roundHalfUp(-6, 10), -1);
  // Noll är noll. Inget -0 får läcka ut i ett belopp.
  assert.ok(Object.is(d.roundHalfUp(-4, 10), 0), 'ska ge 0, inte -0');
  assert.ok(Object.is(d.roundHalfUp(0, 10), 0));
});

test('roundHalfUp: vägrar flyttal och ogiltig nämnare', () => {
  assert.throws(() => d.roundHalfUp(1.5, 10), TypeError);
  assert.throws(() => d.roundHalfUp(10, 0), RangeError);
  assert.throws(() => d.roundHalfUp(10, -5), RangeError);
});

test('multiplicera: fångar spill i stället för att tyst tappa precision', () => {
  assert.throws(() => d.multiplicera(Number.MAX_SAFE_INTEGER, 2), RangeError);
  assert.equal(d.multiplicera(5000000, 1000), 5000000000);
});

test('radbeloppOre: à-pris gånger kvantitet', () => {
  assert.equal(d.radbeloppOre(85000, 3000), 255000);       // 850 kr * 3 tim
  assert.equal(d.radbeloppOre(550, 230000), 126500);       // 5,50 kr * 230 km
  assert.equal(d.radbeloppOre(240000, 8000), 1920000);     // 2 400 kr * 8 pass
  assert.equal(d.radbeloppOre(35000, 12000), 420000);      // 350 kr * 12 st
});

test('radbeloppOre: kvartstimme ger exakt belopp', () => {
  assert.equal(d.radbeloppOre(85000, 250), 21250);         // 850 kr * 0,25 tim
});

test('sekunderTillTimmarMilli: sekunder blir kvantitet', () => {
  assert.equal(d.sekunderTillTimmarMilli(3600), 1000);
  assert.equal(d.sekunderTillTimmarMilli(900), 250);
  assert.equal(d.sekunderTillTimmarMilli(0), 0);
});

test('kronorTillOre: flyttalskronor blir exakta öre', () => {
  assert.equal(d.kronorTillOre(12.34), 1234);
  assert.equal(d.kronorTillOre(5.5), 550);
  assert.equal(d.kronorTillOre(2400), 240000);
  assert.throws(() => d.kronorTillOre(NaN), TypeError);
});

// ── Moms ────────────────────────────────────────────────────────────────────

test('moms: okänd momssats är inte noll procent', () => {
  assert.throws(() => d.summera([{ nettoOre: 1000, vatRate: null }]), /okänd momssats är inte noll/i);
  assert.throws(() => d.summera([{ nettoOre: 1000, vatRate: undefined }]));
  // Noll procent är däremot ett giltigt, granskat värde.
  assert.equal(d.summera([{ nettoOre: 1000, vatRate: 0 }]).momsOre, 0);
});

test('moms: räknas på summan per momssats, inte per rad', () => {
  // Tre rader à 33,33 kr med 25 %. Per rad: 3 * 833 = 2499. På summan: 2500.
  const rader = [
    { nettoOre: 3333, vatRate: 2500 },
    { nettoOre: 3333, vatRate: 2500 },
    { nettoOre: 3334, vatRate: 2500 },
  ];
  assert.equal(d.summeraMoms(rader).momsOre, 2500);
});

test('moms: blandade satser hålls isär', () => {
  const { momsUnderlag, momsOre } = d.summeraMoms([
    { nettoOre: 1920000, vatRate: 0 },
    { nettoOre: 255000, vatRate: 2500 },
    { nettoOre: 126500, vatRate: 2500 },
  ]);
  assert.deepEqual(momsUnderlag, { 0: 1920000, 2500: 381500 });
  assert.equal(momsOre, 95375);
});

test('öresavrundning: uppåt, nedåt och exakt jämnt', () => {
  assert.deepEqual(d.oresavrundning(2396875), { avrundningOre: 25, attBetalaOre: 2396900 });
  assert.deepEqual(d.oresavrundning(1427313), { avrundningOre: -13, attBetalaOre: 1427300 });
  assert.deepEqual(d.oresavrundning(918750), { avrundningOre: 50, attBetalaOre: 918800 });
  assert.deepEqual(d.oresavrundning(6250000), { avrundningOre: 0, attBetalaOre: 6250000 });
});

test('öresavrundning: kan stängas av', () => {
  assert.deepEqual(d.oresavrundning(1427313, { avrunda: false }), { avrundningOre: 0, attBetalaOre: 1427313 });
});

// ── Artiklar ────────────────────────────────────────────────────────────────

test('artikel: trackingOnly kan aldrig vara fakturerbar', () => {
  assert.throws(
    () => d.skapaArtikel({ id: 'a', projectId: 'p', name: 'n', type: 'trackingOnly', billable: true }),
    /aldrig vara fakturerbar/
  );
  const a = d.skapaArtikel({ id: 'a', projectId: 'p', name: 'n', type: 'trackingOnly' });
  assert.equal(a.billable, false);
  assert.equal(d.arFakturerbar(a), false);
});

test('artikel: utan momssats flaggas automatiskt för granskning', () => {
  const a = d.skapaArtikel({ id: 'a', projectId: 'p', name: 'n', type: 'hourly', unitPriceOre: 85000 });
  assert.equal(a.vatRate, null);
  assert.equal(a.vatStatus, 'needsReview');
  assert.equal(a.needsReview, true);
  assert.equal(d.momsAnvandbar(a), false);
});

test('artikel: okänd typ och enhet avvisas', () => {
  assert.throws(() => d.skapaArtikel({ id: 'a', projectId: 'p', name: 'n', type: 'gissning' }), /Okänd artikeltyp/);
  assert.throws(() => d.skapaArtikel({ id: 'a', projectId: 'p', name: 'n', type: 'hourly', unit: 'famn' }), /Okänd enhet/);
});

// ── Underlag ────────────────────────────────────────────────────────────────

const granskad = { vatRate: 2500, vatStatus: 'reviewed' };
const timArtikel = d.skapaArtikel({ id: 'a1', projectId: 'p1', name: 'Tid', type: 'hourly', unitPriceOre: 85000, ...granskad });

test('underlag: kan förhandsgranskas med ogranskad moms men inte färdigställas', () => {
  const ogranskad = d.skapaArtikel({ id: 'a2', projectId: 'p1', name: 'Tid', type: 'hourly', unitPriceOre: 85000 });
  const poster = [{ id: 'e1', articleId: 'a2', qtyMilli: 1000, date: '2026-06-01' }];

  // Förhandsgranskning kastar på summeringen eftersom momssatsen saknas...
  assert.throws(() => d.byggUnderlag({ artiklar: [ogranskad], poster, clientId: 'k' }));

  // ...och färdigställande stoppas uttryckligen, med ett begripligt fel.
  assert.throws(
    () => d.byggUnderlag({ artiklar: [ogranskad], poster, clientId: 'k', kravGranskadMoms: true }),
    e => e.name === 'OgranskadMoms'
  );
});

test('underlag: ovalda poster lämnas orörda', () => {
  const poster = [
    { id: 'e1', articleId: 'a1', qtyMilli: 1000, date: '2026-06-01' },
    { id: 'e2', articleId: 'a1', qtyMilli: 2000, date: '2026-06-02' },
  ];
  const { underlag, poster: ut } = d.lasUnderlag({
    artiklar: [timArtikel], poster, valda: ['e1'], clientId: 'k', period: '2026-06',
  });
  assert.equal(underlag.rader.length, 1);
  assert.equal(ut.find(p => p.id === 'e1').status, 'included');
  assert.equal(ut.find(p => p.id === 'e1').invoiceRecordId, underlag.id);
  assert.equal(ut.find(p => p.id === 'e2').status, 'open');
  assert.equal(ut.find(p => p.id === 'e2').invoiceRecordId, null);
});

test('underlag: tomt underlag avvisas', () => {
  assert.throws(() => d.lasUnderlag({ artiklar: [timArtikel], poster: [], valda: [], clientId: 'k' }), /minst en post/);
});

test('underlag: okänd artikel ger ett begripligt fel', () => {
  assert.throws(
    () => d.byggUnderlag({ artiklar: [timArtikel], poster: [{ id: 'e', articleId: 'finns-inte', qtyMilli: 1000 }], clientId: 'k' }),
    /Okänd artikel: finns-inte/
  );
});

// ── Leveranser ──────────────────────────────────────────────────────────────

test('avtalstotal: flaggar skillnad utan att hitta på ett totalpris', () => {
  const flagga = d.kontrolleraAvtalstotal({ summaAvDelarOre: 6000000, tidigareUppgiftOre: 6400000 });
  assert.equal(flagga.diffOre, 400000);
  assert.equal(flagga.totalOre, null);
});

test('avtalstotal: ingen flagga när uppgifterna stämmer eller saknas', () => {
  assert.equal(d.kontrolleraAvtalstotal({ summaAvDelarOre: 6000000, tidigareUppgiftOre: 6000000 }), null);
  assert.equal(d.kontrolleraAvtalstotal({ summaAvDelarOre: 6000000 }), null);
  assert.equal(d.kontrolleraAvtalstotal(null), null);
});

// ── Fakturareferens ─────────────────────────────────────────────────────────

test('status: ett Lundify-utkast är inte en skickad faktura', () => {
  assert.equal(d.arSkickad('lundifyDraft'), false);
  assert.equal(d.arSkickad('lundifySent'), true);
  assert.equal(d.arSkickad('lundifyPaid'), true);
  assert.equal(d.arBetald('lundifySent'), false);
});

test('status: fakturanummer krävs för skickad och får inte finnas på utkast', () => {
  assert.throws(() => d.kontrolleraTillstand({ status: 'lundifySent', invoiceNumber: null }), /kräver ett verkligt fakturanummer/);
  assert.throws(() => d.kontrolleraTillstand({ status: 'lundifyDraft', invoiceNumber: '2026-118' }), /har inget fakturanummer/);
  assert.throws(() => d.kontrolleraTillstand({ status: 'prepared', invoiceNumber: '2026-118' }), /kan inte ha ett fakturanummer/);
});

test('status: otillåtna övergångar avvisas', () => {
  assert.throws(() => d.overgang('lundifyPaid', 'prepared'), /inte tillåten/);
  assert.throws(() => d.overgang('prepared', 'lundifyPaid'), /inte tillåten/);
  assert.doesNotThrow(() => d.overgang('prepared', 'lundifyDraft'));
  assert.doesNotThrow(() => d.overgang('lundifyDraft', 'lundifySent', { invoiceNumber: '2026-118' }));
});

// ── Migrering ───────────────────────────────────────────────────────────────

test('migrering: kontrollsummor bevaras exakt', () => {
  const ra = laddaV1Fixture();
  const { fore, efter, avvikelser } = d.migreraSakert(ra, { nu: '2026-08-27T00:00:00.000Z' });
  assert.deepEqual(avvikelser, []);
  assert.equal(efter.sekunder, fore.sekunder);
  assert.equal(efter.km, fore.km);
  assert.equal(efter.utlaggKronor, fore.utlaggKronor);
});

test('migrering: avbryter hellre än levererar data som tappat poster', () => {
  const trasig = { entries: [{ id: 'e1', seconds: 3600, date: '2026-06-01', projectId: 'p' }], projects: [] };
  const fore = d.kontrollsummor(trasig);
  const efter = { ...fore, sekunder: 0 };
  assert.ok(d.jamforKontrollsummor(fore, efter).length > 0);
});

test('migrering: råvärden behålls orörda', () => {
  const ra = laddaV1Fixture();
  const ut = d.migreraTillV2(ra, { nu: '2026-08-27T00:00:00.000Z' });
  assert.deepEqual(ut.invoices, ra.invoices, 'gamla fakturamarkeringar behålls som råvärde');
  const p = ut.projects.find(x => x.id === 'p-d');
  assert.deepEqual(p.pricingPeriods, ra.projects.find(x => x.id === 'p-d').pricingPeriods);
  assert.equal(ut.entries.find(e => e.id === 'e-1').moment, 'Behandlingspass', 'moment behålls vid sidan av description');
});

test('migrering: tidsposter behåller seconds vid sidan av qtyMilli', () => {
  const ut = d.migreraTillV2(laddaV1Fixture(), { nu: '2026-08-27T00:00:00.000Z' });
  const e = ut.entries.find(x => x.id === 'e-3');   // 7200 s på ett timprisuppdrag
  assert.equal(e.seconds, 7200);
  assert.equal(e.qtyMilli, 2000);
});

test('migrering: tillfällesposter flaggas eftersom antalet inte går att härleda', () => {
  const ut = d.migreraTillV2(laddaV1Fixture(), { nu: '2026-08-27T00:00:00.000Z' });
  const e = ut.entries.find(x => x.id === 'e-1');   // projekt med sessionPrice
  assert.equal(e.qtyMilli, 1000);
  assert.equal(e.status, 'needsReview');
  assert.ok(ut.reviewQueue.some(k => k.typ === 'osaker-kvantitet' && k.ref === 'e-1'));
});

test('migrering: är idempotent ned på fältnivå', () => {
  const ra = laddaV1Fixture();
  const ett = d.migreraTillV2(ra, { nu: '2026-08-27T00:00:00.000Z' });
  const tva = d.migreraTillV2(structuredClone(ett), { nu: '2026-08-27T00:00:00.000Z' });
  assert.deepEqual(tva, ett);
});

test('migrering: skapar inga leveranser ur fastprisperioder', () => {
  const ut = d.migreraTillV2(laddaV1Fixture(), { nu: '2026-08-27T00:00:00.000Z' });
  assert.equal(ut.deliverables.length, 0);
  assert.equal(ut.reviewQueue.filter(k => k.typ === 'osakert-pris').length, 2);
  assert.ok(ut.reviewQueue.find(k => k.typ === 'osakert-pris').ravarde, 'råvärdet följer med granskningsposten');
});

test('migrering: loggar vad den gjorde', () => {
  const ut = d.migreraTillV2(laddaV1Fixture(), { nu: '2026-08-27T00:00:00.000Z' });
  const logg = ut.migrationLog.at(-1);
  assert.equal(logg.toVersion, 2);
  assert.equal(logg.skapade.deliverables, 0);
  assert.deepEqual(logg.avvikelser, []);
});
