// Fasta ersättningar: upparbetning kontra genomförande.
//
// Varje fast ersättning har en UPPARBETNINGSPERIOD. Beloppet tjänas in
// successivt över perioden, och det är den fördelningen som syns i Jobbat in.
//
// GENOMFÖRANDET är något annat: det styr faktureringen. En leverans som inte är
// genomförd kan inte tas med i ett underlag, och när den tas med används hela
// det avtalade beloppet.
//
// Det är just den skillnaden som gör att samma belopp inte kan dubbelräknas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as L from '../prototyp/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const IDAG = new Date('2026-08-27T12:00:00');
const nyState = () => skapaTestdata(IDAG);
const dagar = (n) => {
  const d = new Date(IDAG); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const iVeckan = (offset) => L.veckansDatum(offset, IDAG)[2];

// ── 50 000 kr fördelas över sin period ──────────────────────────────────────

test('50 000 kr över fyra veckor delas upp, inte allt på en vecka', () => {
  const s = nyState();
  const v1 = s.deliverables.find(l => l.id === 'lev-verkstad-1');
  assert.equal(v1.amountOre, 5000000);

  const veckoandel = L.periodandelOre(v1, L.veckansDatum(0, IDAG));
  assert.ok(veckoandel > 0, 'veckan ligger inom perioden');
  assert.ok(veckoandel < 5000000, 'men hela beloppet hamnar inte på en vecka');
  assert.equal(veckoandel, 1249997, 'ungefär en fjärdedel av 50 000 kr');
});

test('summan av alla veckor blir exakt 50 000 kr', () => {
  const s = nyState();
  const v1 = s.deliverables.find(l => l.id === 'lev-verkstad-1');
  const summa = [-2, -1, 0, 1].reduce(
    (sum, offset) => sum + L.periodandelOre(v1, L.veckansDatum(offset, IDAG)), 0);
  assert.equal(summa, 5000000, 'inte en enda öre försvinner eller tillkommer');
});

test('veckans Jobbat in innehåller andelen, inte hela beloppet', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.ok(v.delar.fastPrisAndelOre > 0);
  assert.ok(v.jobbatInOre < 5000000, 'hela verkstadsarvodet ligger inte i en vecka');
  assert.ok(!('leveransOre' in v.delar), 'det finns ingen klumpsumma');
});

// ── Genomförandet påverkar inte upparbetningen ──────────────────────────────

test('genomförandemarkeringen ändrar inte veckans Jobbat in', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG);

  s = L.markeraGenomford(s, 'lev-verkstad-2', iVeckan(0)).state;
  const efter = L.veckoSammanstallning(s, 0, IDAG);

  assert.equal(efter.jobbatInOre, fore.jobbatInOre);
  assert.equal(efter.delar.fastPrisAndelOre, fore.delar.fastPrisAndelOre);
});

test('att ångra genomförandet ändrar inte heller Jobbat in', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG).jobbatInOre;
  s = L.angraGenomford(s, 'lev-verkstad-1').state;
  assert.equal(L.veckoSammanstallning(s, 0, IDAG).jobbatInOre, fore);
});

test('genomförandedatumet styr inte vilken vecka pengarna räknas', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG).delar.fastPrisAndelOre;
  s = L.andraGenomforandedatum(s, 'lev-verkstad-1', iVeckan(-1)).state;
  assert.equal(L.veckoSammanstallning(s, 0, IDAG).delar.fastPrisAndelOre, fore,
    'perioden avgör, inte genomförandedagen');
});

test('ingen dubbelräkning: perioden är enda vägen in i Jobbat in', () => {
  let s = nyState();
  const bara_period = L.veckoSammanstallning(s, 0, IDAG).jobbatInOre;

  // Markera genomförd, fakturera, markera klart. Inget av det får röra Jobbat in.
  s = L.markeraGenomford(s, 'lev-verkstad-2', iVeckan(0)).state;
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  const res = L.forberedUnderlag(s, grupp.id, { valdaLeveranser: ['lev-verkstad-1'] });
  assert.equal(res.ok, true);
  s = { ...s, poster: res.poster, deliverables: res.leveranser,
    invoiceRecords: [{ id: res.underlag.id, clientId: 'k-c', period: grupp.period,
      nettoOre: res.underlag.nettoOre, invoiceNumber: null, klarmarkeradAt: null }] };
  s = L.markeraKlart(s, res.underlag.id, { datum: dagar(0) }).state;

  assert.equal(L.veckoSammanstallning(s, 0, IDAG).jobbatInOre, bara_period,
    'fakturering lägger aldrig till något i Jobbat in');
});

// ── Specialfall ─────────────────────────────────────────────────────────────

test('en fast ersättning för en enda dag räknas helt den dagen', () => {
  const endag = {
    id: 'lev-endag', projectId: 'u-verkstad', name: 'Föreläsning',
    amountOre: 1500000, vatRate: 2500, vatStatus: 'reviewed',
    status: 'open', completedAt: iVeckan(0),
    startDate: iVeckan(0), endDate: iVeckan(0),
  };
  assert.equal(L.periodKontroll(endag).giltig, true);
  assert.equal(L.periodandelOre(endag, [iVeckan(0)]), 1500000, 'hela beloppet den dagen');
  assert.equal(L.periodandelOre(endag, L.veckansDatum(0, IDAG)), 1500000, 'och inget mer under veckan');
  assert.equal(L.periodandelOre(endag, L.veckansDatum(-1, IDAG)), 0);
});

test('saknad upparbetningsperiod blockerar upparbetningen', () => {
  const s = nyState();
  const utan = s.deliverables.find(l => l.id === 'lev-ofullstandig');
  assert.equal(L.periodKontroll(utan).giltig, false);
  assert.equal(L.periodKontroll(utan).orsak, 'Upparbetningsperioden behöver anges');

  const v = L.veckoSammanstallning(s, 0, IDAG);
  assert.ok(v.ofullstandigaPerioder.some(p => p.id === 'lev-ofullstandig'));
  assert.equal(L.periodandelOre(utan, L.veckansDatum(0, IDAG)), 0, 'inget gissas fram');
});

test('en helt saknad period ger inget belopp alls', () => {
  const utanAllt = { id: 'x', projectId: 'u-verkstad', amountOre: 5000000, status: 'open' };
  assert.equal(L.periodKontroll(utanAllt).giltig, false);
  assert.equal(L.periodandelOre(utanAllt, L.veckansDatum(0, IDAG)), 0);
});

// ── Fakturaflödet ───────────────────────────────────────────────────────────

test('en leverans som inte är genomförd kan inte tas med i underlaget', () => {
  const s = nyState();
  const planerad = s.deliverables.find(l => l.id === 'lev-verkstad-2');
  assert.equal(L.arGenomford(planerad), false);

  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  assert.ok(!grupp.leveranser.some(l => l.id === 'lev-verkstad-2'), 'erbjuds inte');
});

test('en leverans utan genomförandedatum erbjuds inte, ens om den är öppen', () => {
  const s = nyState();
  const avtal = s.deliverables.find(l => l.id === 'lev-avtal');
  assert.equal(avtal.status, 'open', 'öppen men aldrig markerad genomförd');
  assert.equal(avtal.completedAt, null);
  assert.equal(L.arGenomford(avtal), false);

  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-d');
  assert.ok(!grupp || !grupp.leveranser.some(l => l.id === 'lev-avtal'),
    'genomförandet, inte statusen, avgör om något kan faktureras');
});

test('samma leverans erbjuds så snart den markerats genomförd', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-avtal', dagar(0)).state;
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-d');
  assert.ok(grupp.leveranser.some(l => l.id === 'lev-avtal'));
});

test('en genomförd leverans kan väljas till underlaget', () => {
  const s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  assert.deepEqual(grupp.leveranser.map(l => l.id), ['lev-verkstad-1']);
});

test('fakturaunderlaget använder HELA det avtalade beloppet', () => {
  const s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  const res = L.forberedUnderlag(s, grupp.id, { valdaLeveranser: ['lev-verkstad-1'] });

  assert.equal(res.ok, true);
  assert.equal(res.underlag.rader.length, 1);
  assert.equal(res.underlag.nettoOre, 5000000, 'hela 50 000 kr, inte en veckoandel');
  assert.equal(res.underlag.attBetalaOre, 6250000);
});

test('veckofördelningen skapar aldrig automatiska fakturarader', () => {
  const s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  assert.equal(grupp.antalRader, 0, 'ingen automatisk rad ur upparbetningen');
  assert.equal(grupp.lage, L.LAGE_KONTROLL, 'leveransen måste väljas');
});

test('dagens fakturaunderlag innehåller inte leveransbelopp', () => {
  const s = nyState();
  const dagen = L.fakturaunderlagForDag(s, dagar(3));
  assert.ok(dagen.leveranser.some(l => l.id === 'lev-verkstad-1'), 'leveransen syns som händelse');
  assert.equal(dagen.beloppOre, 0, 'men bidrar inte med något belopp den dagen');
});

// ── Markera genomförd ───────────────────────────────────────────────────────

test('alla fasta ersättningar kan markeras genomförda', () => {
  // Även ett löpande avtal måste markeras genomfört för att kunna faktureras.
  const enstaka = L.enstakaLeveranser(nyState()).map(l => l.id).sort();
  assert.deepEqual(enstaka, ['lev-avtal', 'lev-ofullstandig', 'lev-verkstad-1', 'lev-verkstad-2']);
});

test('formuläret erbjuder bara det som inte redan är genomfört', () => {
  const kvar = L.enstakaLeveranser(nyState(), { endastEjGenomforda: true }).map(l => l.id).sort();
  assert.deepEqual(kvar, ['lev-avtal', 'lev-ofullstandig', 'lev-verkstad-2']);
  assert.ok(!kvar.includes('lev-verkstad-1'), 'Verkstad 1 är redan genomförd');
});

test('markera genomförd sätter datum och status', () => {
  const res = L.markeraGenomford(nyState(), 'lev-verkstad-2', dagar(0));
  assert.equal(res.ok, true);
  const l = res.state.deliverables.find(x => x.id === 'lev-verkstad-2');
  assert.equal(l.completedAt, dagar(0));
  assert.equal(L.arGenomford(l), true);
});

test('markera genomförd kräver ett datum', () => {
  const res = L.markeraGenomford(nyState(), 'lev-verkstad-2', null);
  assert.equal(res.ok, false);
  assert.match(res.besked, /Välj vilken dag/);
});

test('internt arbete erbjuder inga leveranser', () => {
  let s = nyState();
  s = { ...s, projects: s.projects.map(p => ({ ...p, kind: 'internal' })) };
  assert.deepEqual(L.enstakaLeveranser(s), []);
});

test('genomförandet kan ångras', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;
  const res = L.angraGenomford(s, 'lev-verkstad-2');
  assert.equal(res.ok, true);
  const l = res.state.deliverables.find(x => x.id === 'lev-verkstad-2');
  assert.equal(l.completedAt, null);
  assert.equal(L.arGenomford(l), false);
});

test('en ångrad leverans erbjuds igen i formuläret', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;
  assert.ok(!L.enstakaLeveranser(s, { endastEjGenomforda: true }).some(l => l.id === 'lev-verkstad-2'));
  s = L.angraGenomford(s, 'lev-verkstad-2').state;
  assert.ok(L.enstakaLeveranser(s, { endastEjGenomforda: true }).some(l => l.id === 'lev-verkstad-2'));
});

// ── Låsning efter Klart i Lundify ───────────────────────────────────────────

function medKlartUnderlag() {
  let s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  const res = L.forberedUnderlag(s, grupp.id, { valdaLeveranser: ['lev-verkstad-1'] });
  assert.equal(res.ok, true);
  const referens = { id: res.underlag.id, clientId: 'k-c', period: grupp.period,
    nettoOre: res.underlag.nettoOre, invoiceNumber: null, klarmarkeradAt: null };
  s = { ...s, poster: res.poster, deliverables: res.leveranser, invoiceRecords: [referens] };
  return { s: L.markeraKlart(s, referens.id, { datum: dagar(0) }).state, referens };
}

test('en leverans i ett klart underlag är låst', () => {
  const { s } = medKlartUnderlag();
  assert.equal(L.leveransArLast(s.deliverables.find(x => x.id === 'lev-verkstad-1')), true);
});

test('en låst leverans kan varken få nytt datum eller ångras', () => {
  const { s } = medKlartUnderlag();
  assert.match(L.andraGenomforandedatum(s, 'lev-verkstad-1', dagar(9)).besked, /Flytta tillbaka underlaget först/);
  assert.match(L.angraGenomford(s, 'lev-verkstad-1').besked, /Flytta tillbaka underlaget först/);
});

test('efter att underlaget flyttats tillbaka går leveransen att ändra igen', () => {
  const { s: last, referens } = medKlartUnderlag();
  const s = L.angraOverforing(last, referens.id).state;
  assert.equal(L.leveransArLast(s.deliverables.find(l => l.id === 'lev-verkstad-1')), false);
  assert.equal(L.andraGenomforandedatum(s, 'lev-verkstad-1', dagar(9)).ok, true);
});

test('en låst leverans ändrar inte heller Jobbat in', () => {
  const fore = L.veckoSammanstallning(nyState(), 0, IDAG).jobbatInOre;
  const { s } = medKlartUnderlag();
  assert.equal(L.veckoSammanstallning(s, 0, IDAG).jobbatInOre, fore);
});

// ── Beskedet före sparande ──────────────────────────────────────────────────

test('beskedet säger att beloppet upparbetas, inte att det läggs på veckan', () => {
  const l = L.enstakaLeveranser(nyState()).find(x => x.id === 'lev-verkstad-2');
  const besked = L.genomforandebesked(l);
  assert.match(besked, /tjänas in över upparbetningsperioden/);
  assert.match(besked, /påverkar inte veckans Jobbat in/);
  assert.match(besked, /kan tas med i ett fakturaunderlag/);
  assert.ok(besked.replace(/\s/g, '').includes('50000'), 'beloppet ska stå med');
});

// ── Inga återvändsgränder i gränssnittet ────────────────────────────────────

const ui = readFileSync(fileURLToPath(new URL('../prototyp/ui.mjs', import.meta.url)), 'utf8');
const utanKommentarer = ui
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('ingen synlig funktion leder till en inte byggd-ruta', () => {
  for (const fras of ['inte byggd', 'inte byggt', 'ej implementerad', 'kommer senare']) {
    assert.ok(!utanKommentarer.toLowerCase().includes(fras),
      `gränssnittet får inte visa "${fras}" för användaren`);
  }
});

test('Utlägg går inte att öppna från Mer', () => {
  assert.ok(!/data-oppna="utlagg"/.test(ui));
  assert.ok(!/typ === 'utlagg'/.test(ui));
});

test('utlägg finns kvar i modellen och räknas fortfarande', () => {
  let s = nyState();
  s = {
    ...s,
    articles: [...s.articles, {
      id: 'a-utl', projectId: 'u-behandling', name: 'Vidarefakturerat utlägg',
      type: 'piece', unit: 'kr', unitPriceOre: 100, vatRate: 2500, vatStatus: 'reviewed',
      billable: true, active: true, sortOrder: 95,
    }],
  };
  s = L.laggTillPost(s, {
    id: 'p-utl', projectId: 'u-behandling', articleId: 'a-utl', date: iVeckan(0),
    beskrivning: 'Parkering', qtyMilli: 250 * L.MILLI, seconds: null,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const v = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(v.utlaggOre, 25000);
  assert.ok(ui.includes('Utlägg att ersätta'), 'och visas i rapporterna');
});
