// Enstaka fasta leveranser.
//
// Skillnaden mot en fastprisperiod är hela poängen:
//
//   Fastprisperiod    har start- och slutdatum, fördelas automatiskt över
//                     perioden och registreras aldrig från Idag.
//   Enstaka leverans  har ingen period. Den räknas som jobbat in den dag
//                     användaren markerar den genomförd.
//
// Samma ekonomiska åtagande får aldrig vara båda.

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

// ── Vilka leveranser som erbjuds ────────────────────────────────────────────

test('en fastprisperiod visas aldrig som en enstaka leverans', () => {
  const s = nyState();
  const enstaka = L.enstakaLeveranser(s).map(l => l.id);
  assert.ok(!enstaka.includes('lev-avtal'), 'avtalsperioden ska inte gå att markera genomförd');
  assert.ok(!enstaka.includes('lev-ofullstandig'));
  assert.deepEqual(enstaka.sort(), ['lev-verkstad-1', 'lev-verkstad-2']);
});

test('formuläret erbjuder bara leveranser som inte redan är genomförda', () => {
  const s = nyState();
  const valbara = L.enstakaLeveranser(s, { endastEjGenomforda: true }).map(l => l.id);
  assert.deepEqual(valbara, ['lev-verkstad-2'], 'Verkstad 1 är redan genomförd');
});

test('leveranser bär uppdragets namn, så listan går att förstå', () => {
  const l = L.enstakaLeveranser(nyState())[0];
  assert.equal(l.uppdragnamn, 'Verkstadsserie');
});

test('internt arbete erbjuder inga leveranser', () => {
  let s = nyState();
  s = { ...s, projects: s.projects.map(p => p.id === 'u-verkstad' ? { ...p, kind: 'internal' } : p) };
  assert.deepEqual(L.enstakaLeveranser(s), []);
});

// ── Markera genomförd ───────────────────────────────────────────────────────

test('markera leverans genomförd sätter datum och status', () => {
  const s = nyState();
  const res = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0));
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

test('en fastprisperiod kan inte markeras genomförd', () => {
  const res = L.markeraGenomford(nyState(), 'lev-avtal', dagar(0));
  assert.equal(res.ok, false);
  assert.match(res.besked, /fast pris för en avtalsperiod/);
  assert.match(res.besked, /räknas automatiskt över perioden/);
});

test('samma belopp kan inte räknas som både period och enstaka leverans', () => {
  const s = nyState();
  const avtal = s.deliverables.find(l => l.id === 'lev-avtal');

  // Perioden bidrar via fördelningen.
  const v = L.veckoSammanstallning(s, 0, IDAG);
  assert.ok(v.delar.fastPrisAndelOre > 0);

  // Och kan varken erbjudas eller markeras som enstaka.
  assert.ok(!L.enstakaLeveranser(s).some(l => l.id === avtal.id));
  assert.equal(L.markeraGenomford(s, avtal.id, dagar(0)).ok, false);

  // Även om någon skulle sätta completedAt räknas den inte som enstaka.
  const manipulerad = { ...s, deliverables: s.deliverables.map(l =>
    l.id === 'lev-avtal' ? { ...l, completedAt: iVeckan(0), status: 'open' } : l) };
  const efter = L.veckoSammanstallning(manipulerad, 0, IDAG);
  assert.equal(efter.delar.leveransOre, v.delar.leveransOre, 'perioden blir aldrig en enstaka leverans');
});

// ── Räknas i Jobbat in ──────────────────────────────────────────────────────

test('en genomförd leverans räknas i Jobbat in', () => {
  let s = nyState();
  const fore = L.veckoSammanstallning(s, 0, IDAG).delar.leveransOre;
  s = L.markeraGenomford(s, 'lev-verkstad-2', iVeckan(0)).state;
  const efter = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(efter.delar.leveransOre, fore + 5000000);
});

test('genomförandedatumet styr vilken vecka leveransen räknas', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', iVeckan(-1)).state;

  const denna = L.veckoSammanstallning(s, 0, IDAG).delar.leveransOre;
  const forra = L.veckoSammanstallning(s, -1, IDAG).delar.leveransOre;
  assert.equal(forra, 5000000, 'leveransen räknas veckan den genomfördes');
  assert.ok(!String(denna).includes('10000000'), 'och inte en gång till denna vecka');
});

test('en leverans räknas inte förrän den är markerad genomförd', () => {
  const s = nyState();
  const planerad = s.deliverables.find(l => l.id === 'lev-verkstad-2');
  assert.equal(L.arGenomford(planerad), false);
  const vecka = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(vecka.delar.leveransOre, 5000000, 'bara den redan genomförda Verkstad 1');
});

test('en genomförd leverans syns i Idag och Vecka', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;
  const idagsLev = L.genomfordaLeveranserForDag(s, dagar(0));
  assert.equal(idagsLev.length, 1);
  assert.equal(idagsLev[0].name, 'Verkstad 2, planerad');
  assert.equal(idagsLev[0].uppdragnamn, 'Verkstadsserie');
});

test('en fastprisperiod syns aldrig som en dagsrad', () => {
  const s = nyState();
  for (const d of L.veckansDatum(0, IDAG)) {
    assert.ok(!L.genomfordaLeveranserForDag(s, d).some(l => l.id === 'lev-avtal'));
  }
});

// ── Inte automatiskt i fakturaunderlaget ────────────────────────────────────

test('en genomförd leverans hamnar inte automatiskt i ett fakturaunderlag', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;

  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  assert.equal(grupp.lage, L.LAGE_KONTROLL, 'ligger under Behöver kontrolleras');
  assert.equal(grupp.antalRader, 0, 'ingen automatisk fakturarad');
  assert.ok(grupp.leveranser.some(l => l.id === 'lev-verkstad-2'), 'men den erbjuds');
});

test('leveransen kommer med först när användaren väljer den', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');

  const res = L.forberedUnderlag(s, grupp.id, { valdaLeveranser: ['lev-verkstad-2'] });
  assert.equal(res.ok, true);
  assert.equal(res.underlag.rader.length, 1);
  assert.equal(res.underlag.nettoOre, 5000000);
});

// ── Ändra och ångra ─────────────────────────────────────────────────────────

test('genomförandedatumet kan ändras', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', dagar(0)).state;
  const res = L.andraGenomforandedatum(s, 'lev-verkstad-2', dagar(3));
  assert.equal(res.ok, true);
  assert.equal(res.state.deliverables.find(l => l.id === 'lev-verkstad-2').completedAt, dagar(3));
});

test('genomförandet kan ångras', () => {
  let s = nyState();
  s = L.markeraGenomford(s, 'lev-verkstad-2', iVeckan(0)).state;
  const med = L.veckoSammanstallning(s, 0, IDAG).delar.leveransOre;

  const res = L.angraGenomford(s, 'lev-verkstad-2');
  assert.equal(res.ok, true);
  const l = res.state.deliverables.find(x => x.id === 'lev-verkstad-2');
  assert.equal(l.completedAt, null);
  assert.equal(L.arGenomford(l), false);
  assert.equal(L.veckoSammanstallning(res.state, 0, IDAG).delar.leveransOre, med - 5000000);
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
  s = {
    ...s, poster: res.poster, invoiceRecords: [referens],
    deliverables: s.deliverables.map(l =>
      l.id === 'lev-verkstad-1' ? { ...l, status: 'included', invoiceRecordId: referens.id } : l),
  };
  return { s: L.markeraKlart(s, referens.id, { datum: dagar(0) }).state, referens };
}

test('en leverans i ett klart underlag är låst', () => {
  const { s } = medKlartUnderlag();
  const l = s.deliverables.find(x => x.id === 'lev-verkstad-1');
  assert.equal(L.leveransArLast(l), true);
});

test('en låst leverans kan inte få nytt datum', () => {
  const { s } = medKlartUnderlag();
  const res = L.andraGenomforandedatum(s, 'lev-verkstad-1', dagar(9));
  assert.equal(res.ok, false);
  assert.match(res.besked, /Flytta tillbaka underlaget först/);
});

test('en låst leverans kan inte ångras', () => {
  const { s } = medKlartUnderlag();
  const res = L.angraGenomford(s, 'lev-verkstad-1');
  assert.equal(res.ok, false);
  assert.match(res.besked, /Flytta tillbaka underlaget först/);
});

test('efter att underlaget flyttats tillbaka går leveransen att ändra igen', () => {
  const { s: last, referens } = medKlartUnderlag();
  const s = L.angraOverforing(last, referens.id).state;
  assert.equal(L.leveransArLast(s.deliverables.find(l => l.id === 'lev-verkstad-1')), false);
  assert.equal(L.andraGenomforandedatum(s, 'lev-verkstad-1', dagar(9)).ok, true);
  assert.equal(L.angraGenomford(s, 'lev-verkstad-1').ok, true);
});

// ── Beskedet före sparande ──────────────────────────────────────────────────

test('beskedet säger både vad som räknas och vad som inte händer', () => {
  const l = L.enstakaLeveranser(nyState()).find(x => x.id === 'lev-verkstad-2');
  const besked = L.genomforandebesked(l);
  assert.match(besked, /räknas .* som Jobbat in/);
  assert.match(besked, /läggs inte automatiskt i ett fakturaunderlag/);
  // sv-SE använder hårt blanksteg som tusentalsavgränsare.
  assert.ok(besked.replace(/\s/g, '').includes('50000'), 'beloppet ska stå med');
});

// ── Inga återvändsgränder i gränssnittet ────────────────────────────────────

const ui = readFileSync(fileURLToPath(new URL('../prototyp/ui.mjs', import.meta.url)), 'utf8');

/** Kod utan kommentarer. En kommentar syns inte för användaren. */
const utanKommentarer = ui
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('ingen synlig funktion leder till en inte byggd-ruta', () => {
  for (const fras of ['inte byggd', 'inte byggt', 'ej implementerad', 'kommer senare']) {
    assert.ok(!utanKommentarer.toLowerCase().includes(fras),
      `gränssnittet får inte visa "${fras}" för användaren`);
  }
});

test('varje knapp i Mer leder till något som fungerar', () => {
  // Alla data-oppna-värden i gränssnittet måste ha ett ark som ritas.
  const oppnar = [...utanKommentarer.matchAll(/data-oppna="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(oppnar)].sort(), ['leverans', 'mer', 'resa', 'tid', 'tillfalle']);
  for (const typ of oppnar) {
    if (typ === 'mer') continue;
    const harArk = new RegExp(`ark\.typ === '${typ}'`).test(utanKommentarer)
      || /else innehall = arkRegistrering\(\)/.test(utanKommentarer);
    assert.ok(harArk, `${typ} måste öppna ett ark som är byggt`);
  }
});

test('Utlägg går inte att öppna från Mer', () => {
  assert.ok(!/data-oppna="utlagg"/.test(ui), 'ingen knapp för att registrera utlägg');
  assert.ok(!/typ === 'utlagg'/.test(ui), 'inget utläggsark');
});

test('utlägg finns kvar i modellen och räknas fortfarande', () => {
  // Bara registreringen är dold. Befintliga utlägg ska visas och summeras.
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
  assert.equal(v.utlaggOre, 25000, 'utlägget summeras');
  assert.ok(v.totaltUnderlagOre >= 25000, 'och ingår i fakturaunderlaget');
  assert.ok(ui.includes('Utlägg att ersätta'), 'och visas i rapporterna');
});
