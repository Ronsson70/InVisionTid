// Regressionstester för produktionsfelet vid första införandet.
//
// Safari sa: "undefined is not an object (evaluating 's.poster.filter')"
//
// Orsaken var inte migreringen. Den räknade rätt. Orsaken var att v2-FILEN och
// appens TILLSTÅND har olika form — filen har entries, trips och expenses,
// appen har en enda lista poster — och att v2-objektet skickades rakt in i
// appen utan att översättas. Felet syntes först när vyn skulle ritas, och då
// låg backupen och v2-filen redan i OneDrive.
//
// Fixturen här har den verkliga filens struktur och exakt dess aggregat:
//
//   157 tidsposter    135 fakturamarkerade    22 öppna
//    87 resor          78 fakturamarkerade     9 öppna
//    23 fakturamarkeringar    2 vilande kunder    2 vilande uppdrag
//
// Ingen verklig kunddata, inga verkliga belopp.

import test from 'node:test';
import assert from 'node:assert/strict';

import { produktionslikV1, kontrolleraAggregat, FORVANTAT, NU }
  from '../test-fixtures/bygg-produktionslik.mjs';
import { analysera, nystart } from '../src/domain/nystart.mjs';
import {
  valideraV1, valideraV2, tillAppTillstand, franAppTillstand,
  kontrolleraForeSkrivning, OgiltigStruktur,
} from '../src/app/tillstand.mjs';
import { forbered, genomfor, jamforUrval, BEKRAFTELSE, InfrandeAvbrutet } from '../src/app/infrande.mjs';
import { V1_SOKVAG, V2_SOKVAG, skapaLagring, backupSokvag } from '../src/integrations/onedrive/lagring.mjs';
import { planeraHistorikimport } from '../src/app/historikimport.mjs';
import * as L from '../src/app/logik.mjs';

const v1text = () => JSON.stringify(produktionslikV1, null, 2);

/** Graph-stubbe. Registrerar varje begäran, håller filer i minnet. */
function stubbGraph(filer = {}) {
  const anrop = [];
  const lager = { ...filer };
  const f = async (url, init = {}) => {
    const metod = init.method ?? 'GET';
    anrop.push({ metod, url: String(url) });
    const m = String(url).match(/root:\/(.+?)(:\/content)?$/);
    const sokvag = m ? decodeURIComponent(m[1]) : null;
    if (metod === 'PUT') { lager[sokvag] = init.body; return { ok: true, status: 200, json: async () => ({}) }; }
    if (lager[sokvag] === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (m?.[2]) return { ok: true, status: 200, text: async () => lager[sokvag] };
    return {
      ok: true, status: 200,
      json: async () => ({
        id: 'i', size: Buffer.byteLength(lager[sokvag], 'utf8'), eTag: '"e"',
        lastModifiedDateTime: '2026-08-26T21:12:03Z',
      }),
    };
  };
  f.anrop = anrop; f.lager = lager;
  f.skrivningar = () => anrop.filter(a => a.metod === 'PUT').map(a => a.url);
  return f;
}

// ── Fixturen speglar verkligheten ───────────────────────────────────────────

test('fixturen har samma aggregat som den verkliga filen', () => {
  assert.deepEqual(kontrolleraAggregat(), [], 'aggregaten måste stämma exakt');
  assert.equal(produktionslikV1.entries.length, FORVANTAT.tidsposter);
  assert.equal(produktionslikV1.trips.length, FORVANTAT.resor);
  assert.equal(produktionslikV1.invoices.length, FORVANTAT.fakturamarkeringar);
});

test('fixturen har filens form: tre samlingar, aldrig en sammanslagen poster', () => {
  // Det var precis den här formen appen inte klarade.
  assert.ok(Array.isArray(produktionslikV1.entries));
  assert.ok(Array.isArray(produktionslikV1.trips));
  assert.ok(Array.isArray(produktionslikV1.expenses));
  assert.equal(produktionslikV1.poster, undefined, 'v1 har ingen poster-lista');
});

test('analysen ser 2 vilande kunder och 2 vilande uppdrag', () => {
  const a = analysera(produktionslikV1, { nu: NU });
  assert.equal(a.lamnasIArkivet.kunder, FORVANTAT.vilandeKunder);
  assert.equal(a.lamnasIArkivet.uppdrag, FORVANTAT.vilandeUppdrag);
  assert.equal(a.lamnasIArkivet.fakturamarkeringar, FORVANTAT.fakturamarkeringar);
  assert.equal(a.lamnasIArkivet.fakturerade.poster, FORVANTAT.fakturamarkeradePoster);
  assert.equal(a.lamnasIArkivet.fakturerade.resor, FORVANTAT.fakturamarkeradeResor);
});

// ── Själva felet ────────────────────────────────────────────────────────────

test('regression: v2-resultatet går att visa i appen', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });

  // Så här såg felet ut: v2-objektet rakt in i appen.
  assert.equal(v2.poster, undefined, 'v2-filen har aldrig en poster-lista');
  assert.throws(() => L.posterForDag(L.normaliseraTillstand(v2), '2026-08-01'), TypeError,
    'utan översättning kraschar appen — det var produktionsfelet');

  // Och så här ska det gå till.
  const { tillstand } = tillAppTillstand(v2);
  const s = L.normaliseraTillstand(tillstand);
  assert.ok(Array.isArray(s.poster), 'appen får sin lista');
  assert.doesNotThrow(() => L.posterForDag(s, '2026-08-01'));
  assert.doesNotThrow(() => L.veckoSammanstallning(s, 0, NU.slice(0, 10)));
});

test('exakt 22 öppna tidsposter och 9 öppna resor väljs ut', () => {
  const { antal } = kontrolleraForeSkrivning(nystart(produktionslikV1, { nu: NU }));
  assert.equal(antal.tidsposter, 22, 'öppna tidsposter');
  assert.equal(antal.resor, 9, 'öppna resor');
  assert.equal(antal.kunder, 4, 'aktiva kunder');
  assert.equal(antal.uppdrag, 5, 'aktiva uppdrag');
  assert.equal(antal.fakturamarkeringar, 0, 'ingen historisk fakturastatus');
});

test('hela produktionslika historiken kompletterar exakt det som saknas', () => {
  const { tillstand } = tillAppTillstand(nystart(produktionslikV1, { nu: NU }));
  const plan = planeraHistorikimport(produktionslikV1, tillstand, { nu: NU });

  assert.equal(plan.antal.poster, 135, 'alla tidigare bortfiltrerade tidsposter');
  assert.equal(plan.antal.resor, 78, 'alla tidigare bortfiltrerade resor');
  assert.equal(plan.antal.utlagg, 5, 'alla gamla utlägg');
  assert.equal(plan.antal.uppdrag, 2, 'de två vilande uppdragen');
  assert.equal(plan.antal.kunder, 2, 'de två vilande kunderna');
  assert.equal(plan.tillstand.poster.length, 157 + 87 + 5, 'hela historiken plus redan öppna poster, utan dubbletter');

  const igen = planeraHistorikimport(produktionslikV1, plan.tillstand, { nu: NU });
  assert.equal(igen.antal.totalt, 0, 'andra körningen lägger inte till någonting');
});

test('hela den produktionslika historiken blir redan klar och fastpriset periodiseras', () => {
  const { tillstand } = tillAppTillstand(nystart(produktionslikV1, { nu: NU }));
  const plan = planeraHistorikimport(produktionslikV1, tillstand, { nu: NU });
  const s = L.normaliseraTillstand(plan.tillstand);

  assert.equal(plan.antal.uppdaterade, 31, 'även de 22 + 9 poster som följde med nystarten färdigmarkeras');
  assert.equal(plan.antal.fastprisperioder, 1);
  assert.ok(s.poster.every(p => p.status === 'handled' || p.status === 'historyOnly'),
    'ingen gammal post står kvar som öppen eller behöver granskas');
  assert.equal(L.underlagsgrupper(s).length, 0, 'inget gammalt kan faktureras igen');
  assert.equal(L.manadsSammanstallning(s, '2026-02').delar.fastPrisAndelOre, 368228,
    'fastpriset får en månadsandel även när tiden inte styr fördelningen');
});

test('P2:s fastpristid blir trackingOnly och kan inte faktureras', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });
  const { tillstand } = tillAppTillstand(v2);
  const s = L.normaliseraTillstand(tillstand);

  const p2poster = s.poster.filter(p => p.projectId === 'p2' && p.sourceType === 'entry');
  assert.equal(p2poster.length, 11, 'P2 har 11 öppna tidsposter');

  for (const post of p2poster) {
    const artikel = s.articles.find(a => a.id === post.articleId);
    assert.equal(artikel.type, 'trackingOnly', 'tid på fast pris är uppföljning');
    assert.equal(L.kanIngaIFakturaunderlag(s, post), false, 'får aldrig bli en fakturarad');
  }
});

test('P3:s fem öppna tillfällen får antal 1 och måste kontrolleras', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });
  const { tillstand } = tillAppTillstand(v2);

  const p3 = tillstand.poster.filter(p => p.projectId === 'p3' && p.sourceType === 'entry');
  assert.equal(p3.length, 5, 'P3 har 5 öppna tillfällen');
  for (const post of p3) {
    assert.equal(post.qtyMilli, 1000, 'antal 1');
    assert.equal(post.status, 'needsReview', 'måste kontrolleras');
  }
});

test('round-trip mellan filens form och appens form är förlustfri', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });
  const { tillstand } = tillAppTillstand(v2);
  const tillbaka = franAppTillstand(tillstand);

  for (const samling of ['entries', 'trips', 'expenses']) {
    assert.deepEqual(tillbaka[samling], v2[samling], `${samling} överlever round-trip`);
  }
  assert.equal(tillbaka.poster, undefined, 'filen får aldrig en poster-lista');
});

// ── Validering av samlingar ─────────────────────────────────────────────────

test('saknad obligatorisk samling ger ett begripligt fel med samlingens namn', () => {
  for (const samling of ['clients', 'projects', 'entries']) {
    const trasig = { ...produktionslikV1 };
    delete trasig[samling];

    assert.throws(() => valideraV1(trasig), e => {
      assert.ok(e instanceof OgiltigStruktur);
      assert.equal(e.samling, samling, 'felet vet vilken samling det gäller');
      assert.ok(e.message.includes(`"${samling}"`), 'namnet står i beskedet');
      assert.ok(!/undefined|null|TypeError/.test(e.message), 'beskedet är på svenska, inte teknik');
      return true;
    });
  }
});

test('en samling som finns men inte är en lista avvisas', () => {
  assert.throws(() => valideraV1({ ...produktionslikV1, entries: {} }),
    e => e instanceof OgiltigStruktur && e.samling === 'entries' && /inte en lista/.test(e.message));
  assert.throws(() => valideraV1({ ...produktionslikV1, trips: 'nej' }),
    e => e instanceof OgiltigStruktur && e.samling === 'trips');
});

test('valfria samlingar hanteras uttryckligt, inte genom att döljas', () => {
  const utan = { ...produktionslikV1 };
  delete utan.trips;
  delete utan.expenses;

  const { data, saknadeValfria } = valideraV1(utan);
  assert.deepEqual(saknadeValfria, ['trips', 'expenses'],
    'att de saknades rapporteras — de tystas inte ner till []');
  assert.deepEqual(data.trips, []);
  assert.deepEqual(data.expenses, []);

  // Och nystarten fungerar ändå, med rätt antal.
  const { antal } = kontrolleraForeSkrivning(nystart(data, { nu: NU }));
  assert.equal(antal.tidsposter, 22);
  assert.equal(antal.resor, 0, 'inga resor när filen saknar dem');
});

test('en tom eller trasig fil ger ett begripligt fel', () => {
  for (const trasig of [null, undefined, [], 'text', 42]) {
    assert.throws(() => valideraV1(trasig), e => e instanceof OgiltigStruktur);
  }
});

test('valideraV2 kräver samlingarna appen läser utan att fråga', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });
  for (const samling of ['clients', 'projects', 'articles', 'entries', 'deliverables', 'invoiceRecords']) {
    const trasig = { ...v2 };
    delete trasig[samling];
    assert.throws(() => valideraV2(trasig),
      e => e instanceof OgiltigStruktur && e.samling === samling, `${samling} måste krävas`);
  }
});

// ── Införandet skriver ingenting förrän allt är kontrollerat ────────────────

test('förberedelsen validerar, migrerar och kontrollerar — utan att skriva', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const f = await forbered(skapaLagring({ token: 'T', hamta: fetch }), { nu: NU });

  assert.equal(f.valtUt.tidsposter, 22);
  assert.equal(f.valtUt.resor, 9);
  assert.ok(f.v2, 'v2 är redan uträknad i minnet');
  assert.ok(Array.isArray(f.tillstand.poster), 'och redan bevisad renderbar');
  assert.deepEqual(fetch.skrivningar(), [], 'ingenting skrivet');
});

test('inga skrivningar när migreringen kraschar', async () => {
  const trasig = { ...produktionslikV1, projects: 'inte en lista' };
  const fetch = stubbGraph({ [V1_SOKVAG]: JSON.stringify(trasig) });

  await assert.rejects(
    () => forbered(skapaLagring({ token: 'T', hamta: fetch }), { nu: NU }),
    e => e instanceof InfrandeAvbrutet && /projects/.test(e.message));

  assert.deepEqual(fetch.skrivningar(), [], 'ett fel före bekräftelsen får aldrig skriva');
  assert.equal(fetch.lager[V2_SOKVAG], undefined, 'ingen v2-fil');
});

test('ingen partiellt skapad v2-fil när något går fel efter backupen', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  // v2-skrivningen misslyckas, backupen lyckas.
  let skrivningar = 0;
  const trasig = {
    ...lagring,
    skriv: async (sokvag, text) => {
      if (++skrivningar > 1) throw new Error('nätverket bröts');
      return lagring.skriv(sokvag, text);
    },
  };

  await assert.rejects(() => genomfor(f, trasig, { bekraftelse: BEKRAFTELSE, nu: NU }));
  assert.equal(fetch.lager[V2_SOKVAG], undefined, 'ingen halv v2-fil ligger kvar');
  assert.equal(fetch.lager[V1_SOKVAG], v1text(), 'v1 är oförändrad');

  // Backupen finns kvar och är komplett.
  const backup = Object.keys(fetch.lager).find(k => k.includes('-v1-backup-'));
  assert.ok(backup, 'backupen skrevs');
  assert.equal(fetch.lager[backup], v1text(), 'och den är byte-identisk');
});

test('backupen från ett avbrutet försök skrivs aldrig över', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });

  // Ett tidigare försök har lämnat en backup i samma sekund. Namnet härleds,
  // inte gissas — tidsstämpeln är lokal tid.
  const forsta = backupSokvag('v1', NU);
  fetch.lager[forsta] = 'backup från det misslyckade försöket';

  const f = await forbered(lagring, { nu: NU });
  const resultat = await genomfor(f, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });

  assert.notEqual(resultat.backup.sokvag, forsta, 'ett nytt namn valdes');
  assert.equal(resultat.backup.sokvag, backupSokvag('v1', NU, 2),
    'suffix i stället för överskrivning');
  assert.equal(fetch.lager[forsta], 'backup från det misslyckade försöket',
    'den gamla backupen är orörd');
});

test('återförsök efter avbrutet införande fungerar', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });

  // Försök 1: fel bekräftelse.
  const f1 = await forbered(lagring, { nu: NU });
  await assert.rejects(() => genomfor(f1, lagring, { bekraftelse: 'ja', nu: NU }));
  assert.deepEqual(fetch.skrivningar(), [], 'inget skrevs');

  // Försök 2: samma sida, rätt bekräftelse.
  const f2 = await forbered(lagring, { nu: NU });
  const resultat = await genomfor(f2, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });

  assert.equal(resultat.klart, true);
  assert.equal(resultat.v1Oforandrad, true);
  assert.equal(fetch.lager[V1_SOKVAG], v1text(), 'v1 är fortfarande orörd');

  // Och appen kan starta på resultatet.
  const s = L.normaliseraTillstand(resultat.tillstand);
  assert.equal(s.poster.filter(p => p.sourceType === 'entry').length, 22);
  assert.doesNotThrow(() => L.posterForDag(s, '2026-08-01'));
});

test('ett tredje försök vägrar när v2-filen redan finns', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });

  const f1 = await forbered(lagring, { nu: NU });
  await genomfor(f1, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });
  const efter = fetch.lager[V2_SOKVAG];

  const f2 = await forbered(lagring, { nu: NU });
  await assert.rejects(() => genomfor(f2, lagring, { bekraftelse: BEKRAFTELSE, nu: NU }),
    e => e instanceof InfrandeAvbrutet && /bara en gång/.test(e.message));

  assert.equal(fetch.lager[V2_SOKVAG], efter, 'den befintliga v2-filen är orörd');
});

test('appens tillstånd har bara EN sanning om varje rad', () => {
  const v2 = nystart(produktionslikV1, { nu: NU });
  const { tillstand } = tillAppTillstand(v2);

  // Raderna ligger i poster. Ligger källsamlingarna kvar bredvid har appen två
  // versioner av samma rad, och den ena blir tyst inaktuell vid varje ändring.
  for (const samling of ['entries', 'trips', 'expenses']) {
    assert.equal(tillstand[samling], undefined,
      `${samling} får inte ligga kvar vid sidan av poster`);
  }
  assert.equal(tillstand.poster.length, 31, '22 tidsposter + 9 resor');
});

test('urvalet jämförs mot analysen, och avvikelser namnges', () => {
  const analys = { forsOver: { oppnaPoster: 22, oppnaResor: 9 } };

  assert.deepEqual(jamforUrval(analys, { tidsposter: 22, resor: 9 }), [],
    'stämmer det säger kontrollen ingenting');

  const avvikelser = jamforUrval(analys, { tidsposter: 21, resor: 9 });
  assert.equal(avvikelser.length, 1);
  assert.match(avvikelser[0], /tidsposter: 21 valdes ut, 22 var öppna/);

  assert.equal(jamforUrval(analys, { tidsposter: 20, resor: 4 }).length, 2,
    'båda avvikelserna rapporteras, inte bara den första');
});

test('urvalet måste stämma med analysen, annars avbryts allt', async () => {
  // Analysen lovar 22 öppna poster. Skulle migreringen välja ut något annat
  // ska införandet stanna, inte skriva en fil ingen kan förklara.
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const f = await forbered(skapaLagring({ token: 'T', hamta: fetch }), { nu: NU });
  assert.equal(f.valtUt.tidsposter, f.analys.forsOver.oppnaPoster);
  assert.equal(f.valtUt.resor, f.analys.forsOver.oppnaResor);
});

// ── Kontrollsidan visar struktur, aldrig innehåll ───────────────────────────

test('kontrolluppgifterna innehåller inga namn eller belopp', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text() });
  const f = await forbered(skapaLagring({ token: 'T', hamta: fetch }), { nu: NU });

  const synligt = JSON.stringify({ kalla: f.kalla, valtUt: f.valtUt, forsOver: f.analys.forsOver });
  for (const kund of produktionslikV1.clients) {
    assert.ok(!synligt.includes(kund.name), 'inga kundnamn');
  }
  for (const uppdrag of produktionslikV1.projects) {
    assert.ok(!synligt.includes(uppdrag.name), 'inga uppdragsnamn');
  }
});
