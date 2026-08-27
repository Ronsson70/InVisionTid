// Två saker som är lätta att tappa och svåra att upptäcka:
//
//   1. Hela kronor ska visas utan ",00" i gränssnittet, men ören ska synas när
//      de finns. Det exakta formatet med båda decimalerna finns kvar där varje
//      öre måste synas — i migreringsrapporten.
//   2. Ett konfigurerat veckomål ska alltid visa upparbetat, målbelopp och
//      kvar eller över, som egna värden och inte bara i en mening.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { oreTillText, oreTillKortText } from '../src/domain/index.mjs';
import * as L from '../src/app/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const IDAG = new Date('2026-08-27T12:00:00');
const nyState = () => skapaTestdata(IDAG);
/** sv-SE använder hårt blanksteg som tusentalsavgränsare. */
const platt = t => String(t).replace(/\s/g, ' ');

// ── 1. Beloppsformat ────────────────────────────────────────────────────────

test('hela kronor visas utan ören', () => {
  assert.equal(platt(oreTillKortText(5000000)), '50 000 kr');
  assert.equal(platt(oreTillKortText(240000)), '2 400 kr');
  assert.equal(platt(oreTillKortText(2500000)), '25 000 kr');
  assert.equal(platt(oreTillKortText(100)), '1 kr');
  assert.equal(platt(oreTillKortText(0)), '0 kr');
});

test('ören visas så snart de inte är noll', () => {
  assert.equal(platt(oreTillKortText(56650)), '566,50 kr');
  assert.equal(platt(oreTillKortText(12650)), '126,50 kr');
  assert.equal(platt(oreTillKortText(769230)), '7 692,30 kr');
  assert.equal(platt(oreTillKortText(1)), '0,01 kr');
});

test('negativa belopp följer samma regel', () => {
  assert.equal(platt(oreTillKortText(-1300)), '−13 kr');
  assert.equal(platt(oreTillKortText(-1350)), '−13,50 kr');
});

test('det exakta formatet finns kvar för avstämningar', () => {
  assert.equal(platt(oreTillText(5000000)), '50 000,00 kr');
  assert.equal(platt(oreTillText(0)), '0,00 kr');
});

test('prototypen använder kortformen som sitt beloppsformat', () => {
  assert.equal(L.belopp, oreTillKortText);
  assert.equal(platt(L.belopp(5000000)), '50 000 kr');
});

const ui = readFileSync(fileURLToPath(new URL('../src/app/ui.mjs', import.meta.url)), 'utf8');

test('gränssnittet formaterar belopp på ett enda ställe', () => {
  assert.match(ui, /const kr = ore => L\.belopp\(ore\)/);
  assert.ok(!/L\.oreTillText/.test(ui), 'ui.mjs ska inte gå förbi den gemensamma formateraren');
});

// ── Rendering mot en DOM-stubbe ─────────────────────────────────────────────
// ui.mjs är en modul och körs bara en gång. Stubbarna sätts därför FÖRE
// importen, och lyssnaren fångas en gång och återanvänds.

let html = '';
const lyssnare = {};
globalThis.document = {
  getElementById: () => ({ set innerHTML(v) { html = v; }, get innerHTML() { return html; } }),
  addEventListener: (typ, fn) => { lyssnare[typ] = fn; },
  querySelector: () => null,
};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

await import('../prototyp/ui.mjs');

const klicka = ds => lyssnare.click({
  target: { dataset: ds, classList: { contains: () => false }, closest: function () { return this; } },
});
const rendera = vy => { klicka({ vy }); return html; };

test('ingen vy visar ett helt krontal med ,00', () => {
  for (const vy of ['idag', 'vecka', 'fakturera', 'uppfoljning']) {
    const text = rendera(vy).replace(/<[^>]+>/g, ' ');
    // Ett belopp som slutar på ,00 kr betyder att kortformen missats.
    const traffar = text.match(/\d,00 kr/g) || [];
    assert.deepEqual(traffar, [], `${vy} visar ${traffar.join(', ')}`);
  }
});

test('ören visas fortfarande där de finns', () => {
  const vecka = rendera('vecka');
  assert.match(vecka, /126,50 kr/, 'resan har ören och ska visa dem');
  assert.match(platt(vecka), /20 192,27 kr/, 'fastprisandelen har ören');
});

test('leveransens besked visar beloppet i kortform', () => {
  const l = L.enstakaLeveranser(nyState()).find(x => x.id === 'lev-verkstad-2');
  const besked = L.genomforandebesked(l);
  assert.match(platt(besked), /50 000 kr/);
  assert.ok(!besked.includes(',00'), 'inget ,00 i ett besked till användaren');
});

test('underlaget till Lundify använder samma format som skärmen', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-a');
  const text = L.lundifyText(s, res.underlag);
  assert.ok(!/\d,00 kr/.test(text), 'inga ,00 i underlaget heller');
  assert.match(platt(text), /2 400 kr/, 'hela kronor utan ören');
  assert.match(text, /126,50 kr/, 'men ören där de finns');
});

// ── 2. Veckomålet ───────────────────────────────────────────────────────────

test('ett konfigurerat veckomål ger alla tre värdena', () => {
  const v = L.veckoSammanstallning(nyState(), 0, IDAG);
  assert.equal(v.harMal, true);
  assert.equal(typeof v.jobbatInOre, 'number', 'upparbetat');
  assert.equal(typeof v.malOre, 'number', 'målbelopp');
  assert.equal(typeof v.kvarOre, 'number', 'kvar till målet');
  assert.equal(typeof v.overskjutandeOre, 'number', 'eller över målet');
  assert.equal(v.kvarOre + v.jobbatInOre >= v.malOre, true);
});

test('kvar och över målet utesluter varandra', () => {
  const s = nyState();

  const nattMal = L.veckoSammanstallning(s, 0, IDAG);
  assert.equal(nattMal.naddMal, true, 'testdatat ligger över målet');
  assert.equal(nattMal.kvarOre, 0);
  assert.ok(nattMal.overskjutandeOre > 0);

  const hogtMal = L.veckoSammanstallning(
    { ...s, installningar: { veckomalOre: 100000000 } }, 0, IDAG);
  assert.equal(hogtMal.naddMal, false);
  assert.ok(hogtMal.kvarOre > 0);
  assert.equal(hogtMal.overskjutandeOre, 0);
});

test('måltexten säger både hur mycket och hur långt kvar', () => {
  const s = nyState();

  const under = L.maltext(L.veckoSammanstallning(
    { ...s, installningar: { veckomalOre: 100000000 } }, 0, IDAG));
  assert.match(under, /av veckans mål/);
  assert.match(under, /kvar\./);

  const over = L.maltext(L.veckoSammanstallning(s, 0, IDAG));
  assert.match(over, /Målet är nått/);
  assert.match(over, /över\./, 'även hur mycket över');
});

test('veckovyn visar upparbetat, mål och kvar som egna värden', () => {
  const vecka = rendera('vecka');
  assert.match(vecka, />Upparbetat</);
  assert.match(vecka, />Veckans mål</);
  assert.match(vecka, />Över målet<|>Kvar till målet</);
  assert.match(vecka, /class="matare"/, 'och en enkel mätare');
  assert.match(vecka, /class="malrader malruta"/, 'värdena står i en egen ruta');
});

test('utan mål visas ingen målruta och inget påhittat mål', () => {
  const utanMal = L.veckoSammanstallning(
    { ...nyState(), installningar: { veckomalOre: null } }, 0, IDAG);
  assert.equal(utanMal.harMal, false);
  assert.equal(L.maltext(utanMal), null);
  assert.equal(utanMal.kvarOre, 0);
  assert.equal(utanMal.overskjutandeOre, 0);
  assert.equal(utanMal.procent, null);
  // Huvudtalet visas alltid, mål eller inte.
  assert.match(rendera('vecka'), /Jobbat in denna vecka/);
});

test('veckomålet kan ställas in och tas bort utan att ändra övrig data', () => {
  const fore = { ...nyState(), installningar: { veckomalOre: null } };
  const medMal = L.sattVeckomal(fore, '25 000');

  assert.equal(medMal.installningar.veckomalOre, 2500000);
  assert.deepEqual(medMal.poster, fore.poster, 'registreringarna påverkas inte');
  assert.equal(L.taBortVeckomal(medMal).installningar.veckomalOre, null);
});

test('veckomålet accepterar svenska decimaler men aldrig tomt eller negativt belopp', () => {
  const s = nyState();
  assert.equal(L.sattVeckomal(s, '12 345,50').installningar.veckomalOre, 1234550);
  for (const ogiltigt of ['', '0', '-1', 'text']) {
    assert.throws(() => L.sattVeckomal(s, ogiltigt), /större än noll/);
  }
});

// ── 3. Månadsmål och kalenderperiod ────────────────────────────────────────

test('månadsmålet använder samma enkla regler som veckomålet', () => {
  const fore = { ...nyState(), installningar: { veckomalOre: 2500000, manadsmalOre: null } };
  const medMal = L.sattManadsmal(fore, '100 000');
  const manad = L.manadsSammanstallning(medMal, '2026-08');

  assert.equal(medMal.installningar.manadsmalOre, 10000000);
  assert.equal(manad.malOre, 10000000);
  assert.equal(manad.harMal, true);
  assert.match(L.maltext(manad, 'månadens'), /av månadens mål/);
  assert.equal(L.taBortManadsmal(medMal).installningar.manadsmalOre, null);
  assert.deepEqual(medMal.poster, fore.poster, 'registreringarna påverkas inte');
});

test('månadens datum innehåller varje kalenderdag även utan registreringar', () => {
  assert.equal(L.manadensDatum(nyState(), '2026-02').length, 28);
  assert.equal(L.manadensDatum(nyState(), '2028-02').length, 29);
  assert.deepEqual(L.manadensDatum(nyState(), '2026-04').slice(0, 2), ['2026-04-01', '2026-04-02']);
  assert.equal(L.manadensDatum(nyState(), 'fel').length, 0);
});

test('en fastprisperiod räknas för hela månaden även när månaden saknar tidsposter', () => {
  const s = {
    ...nyState(), poster: [], invoiceRecords: [],
    deliverables: [{
      id: 'fast', projectId: 'u-verkstad', name: 'Fast april', amountOre: 3000000,
      startDate: '2026-04-01', endDate: '2026-04-30', status: 'invoiced', completedAt: '2026-04-30',
    }],
  };
  const m = L.manadsSammanstallning(s, '2026-04');
  assert.equal(m.delar.fastPrisAndelOre, 3000000);
  assert.equal(m.jobbatInOre, 3000000);
});
