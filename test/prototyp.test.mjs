// Etapp 5A: reglerna bakom användarflödena i testversionen.
//
// Testerna körs mot prototyp/logik.mjs, som i sin tur använder den testade
// domänen i src/domain. Ingen beräkning görs om i gränssnittet, och det är
// därför de här testerna räcker för att låsa fast beteendet.
//
// Testdatat är pseudonymiserat. Ingen produktionsdata rörs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

import * as L from '../prototyp/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const IDAG = new Date('2026-08-27T12:00:00');
const nyState = () => skapaTestdata(IDAG);
const dagar = (n) => {
  const d = new Date(IDAG); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// ── Scenario 1 och 2: tillfällen, resa och samtal samma dag ─────────────────

test('scenario 1 och 2: två tillfällen, en resa och ett samtal samma dag räknas var för sig', () => {
  const s = nyState();
  const poster = L.posterForDag(s, dagar(1));
  assert.equal(poster.length, 3);

  // 2 pass à 2 400 + 1 tim à 850 + 23 km à 5,50 = 4 800 + 850 + 126,50
  assert.equal(L.fakturerbartOre(s, poster), 480000 + 85000 + 12650);
});

test('en dag med både tillfälle och timarbete reduceras inte till en prismodell', () => {
  const s = nyState();
  const poster = L.posterForDag(s, dagar(1));
  const artiklar = poster.map(p => L.artikelFor(s, p.articleId).type).sort();
  assert.deepEqual(artiklar, ['hourly', 'session', 'travel']);
});

// ── Scenario 3: fastpristid ─────────────────────────────────────────────────

test('scenario 3: loggad tid på fastprisuppdrag ökar inte fakturabeloppet', () => {
  const s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');

  assert.equal(grupp.rader.length, 0, 'tiden blir ingen fakturarad');
  assert.equal(grupp.summaOre, 0);
  assert.equal(grupp.loggadTidSekunder, 6 * 3600, 'men tiden syns som loggad');
});

test('scenario 3: ett underlag utan vald leverans går inte att skapa', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-c');
  assert.equal(res.ok, false);
  assert.equal(res.besked, 'Ingen leverans vald');
});

// ── Scenario 4: uttrycklig leverans ─────────────────────────────────────────

test('scenario 4: en fastprisleverans faktureras bara när den uttryckligen väljs', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-c', { valdaLeveranser: ['lev-verkstad-1'] });
  assert.equal(res.ok, true);
  assert.equal(res.underlag.rader.length, 1);
  assert.equal(res.underlag.nettoOre, 5000000);
  assert.equal(res.underlag.attBetalaOre, 6250000);
});

test('scenario 4: en planerad leverans erbjuds inte för fakturering', () => {
  const s = nyState();
  const grupp = L.underlagsgrupper(s).find(g => g.clientId === 'k-c');
  assert.deepEqual(grupp.leveranser.map(l => l.id), ['lev-verkstad-1'], 'bara den genomförda leveransen');
});

// ── Scenario 5: ogranskad moms blockerar ────────────────────────────────────

test('scenario 5: ogranskad moms blockerar underlaget med ett begripligt besked', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-b');
  assert.equal(res.ok, false);
  assert.equal(res.besked, 'Momsen behöver anges');
  assert.deepEqual(res.artiklar, ['Lektion']);
});

test('scenario 5: beskedet innehåller inga tekniska begrepp', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-b');
  const text = res.besked + ' ' + res.artiklar.join(' ');
  for (const ord of ['vatStatus', 'needsReview', 'reviewQueue', 'clientId', 'projectId', 'articleId', 'checksum', 'migration', 'tombstone']) {
    assert.ok(!text.includes(ord), `beskedet får inte innehålla "${ord}"`);
  }
});

test('scenario 5: när momsen granskats går underlaget igenom', () => {
  const s = nyState();
  s.articles = s.articles.map(a => a.id === 'b-timme' ? { ...a, vatRate: 2500, vatStatus: 'reviewed' } : a);
  const res = L.forberedUnderlag(s, 'k-b');
  assert.equal(res.ok, true);
  assert.equal(res.underlag.nettoOre, 255000);      // 3 tim à 850
});

// ── Scenario 6: internt arbete ──────────────────────────────────────────────

test('scenario 6: internt arbete hamnar aldrig i ett fakturaunderlag', () => {
  const grupper = L.underlagsgrupper(nyState());
  assert.ok(!grupper.some(g => g.clientId === 'k-eget'), 'egna bolaget ska inte kunna faktureras');
  assert.ok(!grupper.some(g => g.rader.some(r => r.post.projectId === 'u-internt')));
});

test('scenario 6: internt arbete räknas som arbetad tid men inte som fakturerbart', () => {
  const s = nyState();
  const manad = dagar(0).slice(0, 7);
  const internt = L.perKund(s, L.manadensDatum(s, manad)).find(k => k.namn === 'Eget bolag');
  assert.ok(internt, 'internt arbete syns i uppföljningen');
  assert.equal(internt.beloppOre, 0);
  assert.ok(internt.sekunder > 0);
});

// ── Scenario 7: ändra och ta bort ───────────────────────────────────────────

test('scenario 7: en post kan ändras och beloppet följer med', () => {
  let s = nyState();
  const fore = L.fakturerbartOre(s, L.posterForDag(s, dagar(1)));
  s = L.andraPost(s, 'p-1', { qtyMilli: 3 * L.MILLI });
  const efter = L.fakturerbartOre(s, L.posterForDag(s, dagar(1)));
  assert.equal(efter - fore, 240000, 'ett tillfälle till');
});

test('scenario 7: en post kan tas bort', () => {
  let s = nyState();
  const antal = s.poster.length;
  s = L.taBortPost(s, 'p-3');
  assert.equal(s.poster.length, antal - 1);
  assert.ok(!s.poster.some(p => p.id === 'p-3'));
});

test('scenario 7: en post som är överförd till Lundify kan varken ändras eller tas bort', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-a');
  assert.equal(res.ok, true);
  const efter = { ...s, poster: res.poster };
  assert.throws(() => L.andraPost(efter, 'p-1', { qtyMilli: 9000 }), /överfört/);
  assert.throws(() => L.taBortPost(efter, 'p-1'), /överfört/);
});

// ── Reseförslag ─────────────────────────────────────────────────────────────

test('reseförslag: en dag med arbete men utan resa ger ett förslag per uppdrag', () => {
  const s = nyState();
  // Den dagen finns arbete på två uppdrag, båda med standardavstånd. Två
  // uppdrag samma dag är två resor, inte en.
  const forslag = L.saknadeResorForDag(s, dagar(5));
  assert.equal(forslag.length, 2);
  assert.equal(forslag.find(f => f.projectId === 'u-behandling').km, 23);
  assert.equal(forslag.find(f => f.projectId === 'u-lektioner').km, 34);
});

test('reseförslag: en dag som redan har en resa ger inget förslag', () => {
  const s = nyState();
  assert.equal(L.saknadeResorForDag(s, dagar(1)).length, 0);
});

test('reseförslag: flera arbetsposter på SAMMA uppdrag samma dag ger ändå ett förslag', () => {
  let s = nyState();
  const fore = L.saknadeResorForDag(s, dagar(5)).length;
  s = L.laggTillPost(s, {
    id: 'extra', projectId: 'u-behandling', articleId: 'a-samtal', date: dagar(5),
    beskrivning: 'Samtal', qtyMilli: L.MILLI, seconds: 3600,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const efter = L.saknadeResorForDag(s, dagar(5));
  assert.equal(efter.length, fore, 'en post till på samma uppdrag ger inget extra förslag');
  assert.equal(efter.filter(f => f.projectId === 'u-behandling').length, 1);
});

test('reseförslag: när resan registrerats försvinner förslaget för det uppdraget', () => {
  let s = nyState();
  s = L.laggTillPost(s, {
    id: 'resa-extra', projectId: 'u-behandling', articleId: 'a-resa-a', date: dagar(5),
    beskrivning: 'Resa', qtyMilli: 23 * L.MILLI, seconds: null,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  const kvar = L.saknadeResorForDag(s, dagar(5));
  assert.ok(!kvar.some(f => f.projectId === 'u-behandling'));
  assert.ok(kvar.some(f => f.projectId === 'u-lektioner'), 'det andra uppdraget flaggas fortfarande');
});

test('reseförslag: uppdrag utan standardavstånd föreslår ingenting', () => {
  const s = nyState();
  assert.equal(L.saknadeResorForDag(s, dagar(3)).length, 0, 'verkstadsuppdraget har inget standardavstånd');
});

// ── Senast använt ───────────────────────────────────────────────────────────

test('senast använt uppdrag visas först', () => {
  const s = nyState();
  const forTillfalle = L.uppdragEfterSenast(s, ['session']);
  assert.equal(forTillfalle[0].id, 'u-behandling');
  const forResa = L.uppdragEfterSenast(s, ['travel']);
  assert.equal(forResa[0].id, 'u-behandling');
});

test('endast uppdrag som har arbetstypen erbjuds', () => {
  const s = nyState();
  const forTillfalle = L.uppdragEfterSenast(s, ['session']).map(p => p.id);
  assert.deepEqual(forTillfalle, ['u-behandling'], 'bara behandlingsuppdraget har tillfällen');
});

// ── Fakturering och Lundify ─────────────────────────────────────────────────

test('fakturering: underlagen grupperas per kund och faktureringsmånad', () => {
  const grupper = L.underlagsgrupper(nyState());
  assert.deepEqual([...new Set(grupper.map(g => g.kundnamn))].sort(), ['Kund A', 'Kund B', 'Kund C']);
  assert.ok(grupper.every(g => /^\d{4}-\d{2}$/.test(g.period)), 'varje grupp har en månad');
  assert.ok(grupper.every(g => g.id === g.clientId + '|' + g.period));
});

test('fakturering: flera uppdrag hos samma kund blir separata rader i samma underlag', () => {
  let s = nyState();
  s = {
    ...s,
    projects: [...s.projects,
      { id: 'u-extra', name: 'Handledning', clientId: 'k-a', kind: 'billable', defaultTripKm: null, sortOrder: 9 }],
    articles: [...s.articles,
      { id: 'a-extra', projectId: 'u-extra', name: 'Handledning', type: 'hourly', unit: 'tim',
        unitPriceOre: 95000, vatRate: 2500, vatStatus: 'reviewed', billable: true, active: true, sortOrder: 10 }],
  };
  const dag = s.poster.find(p => p.id === 'p-1').date;
  s = L.laggTillPost(s, {
    id: 'p-extra', projectId: 'u-extra', articleId: 'a-extra', date: dag,
    beskrivning: 'Handledning', qtyMilli: 2 * L.MILLI, seconds: 7200,
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });

  const grupper = L.underlagsgrupper(s).filter(g => g.clientId === 'k-a');
  assert.equal(grupper.length, 1, 'samma kund och månad ger ETT underlag');
  assert.deepEqual(grupper[0].uppdrag.sort(), ['Behandling', 'Handledning']);
  assert.equal(grupper[0].rader.length, 5, 'men fem separata fakturarader');
});

test('fakturering: resor ligger sist bland raderna', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-a');
  assert.equal(grupp.rader.at(-1).artikel.type, 'travel');
});

test('fakturering: sammanfattningen slår ihop rader med samma artikel', () => {
  const grupp = L.underlagsgrupper(nyState()).find(g => g.clientId === 'k-a');
  const antal = (grupp.sammanfattning.match(/behandlingstillfälle/g) || []).length;
  assert.equal(antal, 1, 'artikelnamnet ska inte upprepas');
});

test('fakturering: blandad moms summeras rätt hela vägen till att betala', () => {
  const s = nyState();
  const res = L.forberedUnderlag(s, 'k-a');
  // netto 4 800 + 2 400 + 850 + 126,50 = 8 176,50
  assert.equal(res.underlag.nettoOre, 817650);
  // 0 % på 7 200, 25 % på 976,50 → 244,125 → ROUND_HALF_UP 244,13
  assert.equal(res.underlag.momsOre, 24413);
  assert.equal(res.underlag.bruttoForeAvrundningOre, 842063);
  assert.equal(res.underlag.attBetalaOre, 842100);
});

test('Lundify: tre synliga lägen, inga tekniska statusar', () => {
  assert.deepEqual(L.LAGEN.map(l => l.id), ['behover-kontrolleras', 'redo', 'klart']);
  assert.deepEqual(L.LAGEN.map(l => l.etikett),
    ['Behöver kontrolleras', 'Redo för Lundify', 'Klart i Lundify']);
  const etiketter = L.LAGEN.map(l => l.etikett).join(' ').toLowerCase();
  for (const tekniskt of ['prepared', 'draft', 'sent', 'skickad', 'betal']) {
    assert.ok(!etiketter.includes(tekniskt), tekniskt + ' ska inte visas för användaren');
  }
});

test('Lundify: ett underlag kan markeras klart utan fakturanummer', () => {
  const s = { ...nyState(), invoiceRecords: [{ id: 'r1', clientId: 'k-a', period: '2026-08', nettoOre: 100, invoiceNumber: null, klarmarkeradAt: null }] };
  const res = L.markeraKlart(s, 'r1', { datum: '2026-08-27' });
  assert.equal(res.ok, true);
  assert.equal(res.state.invoiceRecords[0].klarmarkeradAt, '2026-08-27');
  assert.equal(res.state.invoiceRecords[0].invoiceNumber, null, 'inget nummer krävs');
});

test('Lundify: fakturanummer är frivilligt och kan tas bort', () => {
  let s = { ...nyState(), invoiceRecords: [{ id: 'r1', clientId: 'k-a', period: '2026-08', nettoOre: 100, invoiceNumber: null, klarmarkeradAt: '2026-08-27' }] };
  s = L.antecknaFakturanummer(s, 'r1', ' 2341 ').state;
  assert.equal(s.invoiceRecords[0].invoiceNumber, '2341');
  assert.equal(s.invoiceRecords[0].klarmarkeradAt, '2026-08-27', 'läget ändras inte av anteckningen');

  s = L.antecknaFakturanummer(s, 'r1', '').state;
  assert.equal(s.invoiceRecords[0].invoiceNumber, null, 'tomt tar bort anteckningen');
  assert.equal(s.invoiceRecords[0].klarmarkeradAt, '2026-08-27', 'underlaget är fortfarande klart');
});

test('Lundify: appen har inget läge för betald faktura', () => {
  const etiketter = L.LAGEN.map(l => l.etikett).join(' ').toLowerCase();
  assert.ok(!etiketter.includes('betal'), 'utan koppling till Lundify vet appen inte om något är betalt');
});

// ── Uppföljning ─────────────────────────────────────────────────────────────

test('uppföljning: tid och kronor hålls isär i EN sammanställning', () => {
  const s = nyState();
  const m = L.manadsSammanstallning(s, dagar(0).slice(0, 7));
  assert.equal(typeof m.arbetadTidSekunder, 'number');
  assert.equal(typeof m.jobbatInOre, 'number');
  assert.equal(typeof m.redoForLundifyOre, 'number');
  assert.equal(m.klartILundifyOre, 0, 'inget är klart i Lundify från början');
  assert.equal(typeof L.uppfoljning, 'undefined', 'den parallella beräkningen finns inte kvar');
});

// ── Gränssnittets språk ─────────────────────────────────────────────────────

function samlaProtofiler() {
  const rot = fileURLToPath(new URL('../prototyp/', import.meta.url));
  return readdirSync(rot).map(n => join(rot, n))
    .filter(f => statSync(f).isFile() && ['.mjs', '.html'].includes(extname(f)));
}

test('gränssnittet visar inga tekniska begrepp för användaren', () => {
  // Fältnamnen finns i koden, men får inte stå i text som användaren läser.
  const FORBJUDNA = ['reviewQueue', 'vatStatus', 'needsReview', 'tombstone', 'checksum', 'schemaVersion', 'migration'];
  for (const fil of samlaProtofiler()) {
    const kod = readFileSync(fil, 'utf8');
    // Plocka ut text mellan taggar och i svenska strängar som visas.
    const synligText = [
      ...kod.matchAll(/>([^<>{}]{4,})</g),
      ...kod.matchAll(/visa\('([^']+)'\)/g),
      ...kod.matchAll(/besked:\s*'([^']+)'/g),
    ].map(m => m[1]).join(' ');
    for (const ord of FORBJUDNA) {
      assert.ok(!synligText.includes(ord), `${fil.split(/[\\/]/).pop()} visar "${ord}" för användaren`);
    }
  }
});

test('gränssnittet räknar inte om belopp på egen hand', () => {
  const ui = readFileSync(fileURLToPath(new URL('../prototyp/ui.mjs', import.meta.url)), 'utf8');
  // Ingen egen moms- eller prisaritmetik i vylagret.
  assert.ok(!/\*\s*0\.25|\*\s*1\.25|vatRate\s*\/\s*100\s*\*/.test(ui), 'moms får inte räknas i gränssnittet');
  assert.ok(!/unitPriceOre\s*\*/.test(ui), 'radbelopp får inte räknas i gränssnittet');
  assert.ok(ui.includes("from './logik.mjs'"), 'gränssnittet ska använda den gemensamma logiken');
});

test('testversionen rör aldrig produktionsappens lagringsnyckel', () => {
  for (const fil of samlaProtofiler()) {
    const kod = readFileSync(fil, 'utf8');
    assert.ok(!/'invisiontid-data'|"invisiontid-data"/.test(kod), 'produktionsnyckeln får inte förekomma');
    assert.ok(!/graph\.microsoft\.com/.test(kod), 'ingen Graph-koppling i testversionen');
  }
});
