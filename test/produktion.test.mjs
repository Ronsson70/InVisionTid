// Produktionskopplingen: sökvägsspärr, införande och en enda tillståndsmodell.
//
// Inga verkliga OneDrive-anrop. Graph ersätts av en stubbe som registrerar
// varje begäran, så testerna kan bevisa vad som INTE skickades.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

import {
  V1_SOKVAG, V2_SOKVAG, LASBARA, SKRIVBARA,
  kontrolleraSkrivvag, farLasas, farSkrivas, backupSokvag,
  SkrivvagAvvisad, Synkkonflikt, skapaLagring, sha256,
} from '../src/integrations/onedrive/lagring.mjs';
import { forbered, genomfor, BEKRAFTELSE, InfrandeAvbrutet } from '../src/app/infrande.mjs';
import { analysera, nystart } from '../src/domain/nystart.mjs';
import * as L from '../src/app/logik.mjs';

const repoRot = fileURLToPath(new URL('../', import.meta.url));
const NU = '2026-08-27T14:30:00.000Z';
const v1Fixtur = () => readFileSync(join(repoRot, 'test-fixtures', 'v1-legacy.json'), 'utf8');

/** Minsta giltiga v2-fil. Alla obligatoriska samlingar finns. */
const tomV2 = (extra = {}) => ({
  clients: [], projects: [], articles: [], entries: [], trips: [], expenses: [],
  deliverables: [], invoiceRecords: [], ...extra,
});

/** Graph-stubbe som registrerar varje begäran och håller filer i minnet. */
function stubbGraph(filer = {}) {
  const anrop = [];
  const lager = { ...filer };
  const eTag = t => '"' + t.length + '-' + (t.length % 97) + '"';

  const f = async (url, init = {}) => {
    const metod = init.method ?? 'GET';
    anrop.push({ url, metod });

    const m = String(url).match(/root:\/(.+?)(:\/content)?$/);
    const sokvag = m ? decodeURIComponent(m[1]) : null;
    const arInnehall = !!m?.[2];

    if (metod === 'PUT') {
      lager[sokvag] = init.body;
      return { ok: true, status: 200, json: async () => ({ id: 'id-' + sokvag }) };
    }
    if (lager[sokvag] === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (arInnehall) return { ok: true, status: 200, text: async () => lager[sokvag] };
    return {
      ok: true, status: 200,
      json: async () => ({
        id: 'id-' + sokvag, name: sokvag.split('/').pop(), size: lager[sokvag].length,
        eTag: eTag(lager[sokvag]), lastModifiedDateTime: '2026-08-11T23:47:21Z',
      }),
    };
  };
  f.anrop = anrop;
  f.lager = lager;
  return f;
}

// ── Sökvägsspärren ──────────────────────────────────────────────────────────

test('v1-filen är läsbar men aldrig skrivbar', () => {
  assert.ok(farLasas(V1_SOKVAG), 'v1 får läsas');
  assert.equal(farSkrivas(V1_SOKVAG), false, 'v1 får ALDRIG skrivas');
  assert.ok(!SKRIVBARA.includes(V1_SOKVAG));
  assert.ok(LASBARA.includes(V1_SOKVAG));
});

test('v2-filen är både läsbar och skrivbar', () => {
  assert.ok(farLasas(V2_SOKVAG));
  assert.ok(farSkrivas(V2_SOKVAG));
});

test('ett skrivförsök mot v1 avvisas', () => {
  assert.throws(() => kontrolleraSkrivvag(V1_SOKVAG), e => e instanceof SkrivvagAvvisad);
  assert.throws(() => kontrolleraSkrivvag(V1_SOKVAG), /Ingen nätverksbegäran har gjorts/);
});

test('skrivförsöket stoppas INNAN något nätverksanrop skickas', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: '{"a":1}' });
  const lagring = skapaLagring({ token: 'HEMLIG', hamta: fetch });

  await assert.rejects(() => lagring.skriv(V1_SOKVAG, '{"b":2}'), SkrivvagAvvisad);
  assert.equal(fetch.anrop.length, 0, 'inte ett enda anrop fick skickas');
  assert.equal(fetch.lager[V1_SOKVAG], '{"a":1}', 'v1 är oförändrad');
});

test('okända sökvägar avvisas också', () => {
  for (const vag of [
    'InVisionTid/invisiontid-data-v2-test.json',
    'InVisionTid/nagot-annat.json',
    'Dokument/invisiontid-data.json',
    '../InVisionTid/invisiontid-data.json',
    '',
  ]) {
    assert.throws(() => kontrolleraSkrivvag(vag), SkrivvagAvvisad, `${vag} ska avvisas`);
  }
});

test('backupfiler får skrivas, men bara med rätt mönster', () => {
  assert.ok(farSkrivas(backupSokvag('v1', NU)));
  assert.ok(farSkrivas(backupSokvag('v2', NU)));
  assert.equal(farSkrivas('InVisionTid/backup.json'), false);
  assert.equal(farSkrivas('InVisionTid/invisiontid-data-v3-backup-20260827-143000.json'), false);
});

test('backupnamnet bär datum och tid', () => {
  assert.equal(backupSokvag('v1', '2026-08-27T14:30:00'),
    'InVisionTid/invisiontid-data-v1-backup-20260827-143000.json');
});

test('tokenet läcker inte via lagringsobjektet', () => {
  const lagring = skapaLagring({ token: 'HEMLIGT-TOKEN-abc', hamta: stubbGraph() });
  assert.ok(!JSON.stringify(lagring).includes('HEMLIGT-TOKEN-abc'));
});

test('tidigare uppdrag läses från v1 utan en enda skrivning', async () => {
  const { skapaOneDriveLagring } = await import('../src/app/lagring-onedrive.mjs');
  const v1 = JSON.parse(v1Fixtur());
  const v2 = tomV2({
    clients: [v1.clients[0]],
    projects: [{ ...v1.projects[0], kind: 'billable', active: true }],
  });
  const fetch = stubbGraph({ [V1_SOKVAG]: JSON.stringify(v1), [V2_SOKVAG]: JSON.stringify(v2) });
  const lagring = skapaOneDriveLagring({ token: 'T', hamta: fetch, nu: () => NU });

  const s = await lagring.las();
  const tidigare = await lagring.lasTidigareUppdrag(s);

  assert.ok(tidigare.length > 0);
  assert.ok(!tidigare.some(p => p.id === v1.projects[0].id), 'redan aktivt uppdrag visas inte');
  assert.ok(fetch.anrop.every(a => a.metod === 'GET'), 'bara läsning');
  assert.equal(fetch.lager[V1_SOKVAG], JSON.stringify(v1), 'v1 är orörd');
});

test('hela gamla historiken läses skrivskyddat och fakturamarkerade poster syns', async () => {
  const { skapaOneDriveLagring } = await import('../src/app/lagring-onedrive.mjs');
  const v1text = v1Fixtur();
  const v1 = JSON.parse(v1text);
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text, [V2_SOKVAG]: JSON.stringify(tomV2()) });
  const lagring = skapaOneDriveLagring({ token: 'T', hamta: fetch, nu: () => NU });

  const arkiv = await lagring.lasArkiv();
  const rader = arkiv.manader.flatMap(m => m.rader);

  assert.equal(arkiv.totalt.tidsposter, v1.entries.length);
  assert.equal(arkiv.totalt.resor, v1.trips.length);
  assert.equal(arkiv.totalt.utlagg, v1.expenses.length);
  assert.equal(rader.length, v1.entries.length + v1.trips.length + v1.expenses.length);
  assert.ok(rader.some(r => r.gammalFakturamarkering), 'markerad historik ska visas, inte filtreras bort');
  assert.ok(fetch.anrop.every(a => a.metod === 'GET'), 'bara läsning');
  assert.equal(fetch.lager[V1_SOKVAG], v1text, 'v1 är byte-identisk');
});

test('grunddata och arkiv delar samma enda v1-hämtning', async () => {
  const { skapaOneDriveLagring } = await import('../src/app/lagring-onedrive.mjs');
  const v1text = v1Fixtur();
  const fetch = stubbGraph({ [V1_SOKVAG]: v1text });
  const lagring = skapaOneDriveLagring({ token: 'T', hamta: fetch, nu: () => NU });

  await lagring.lasTidigareUppdrag(tomV2());
  await lagring.lasArkiv();

  const v1Anrop = fetch.anrop.filter(a => a.url.includes('invisiontid-data.json'));
  assert.equal(v1Anrop.length, 2, 'en metadata-GET och en innehålls-GET');
});

// ── Införandet ──────────────────────────────────────────────────────────────

test('förberedelsen läser v1 och skriver ingenting', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });

  const f = await forbered(lagring, { nu: NU });

  assert.equal(f.kalla.sokvag, V1_SOKVAG);
  assert.match(f.kalla.checksumma, /^sha256:/);
  assert.equal(f.kalla.byteLangd, Buffer.byteLength(v1Fixtur(), 'utf8'));
  assert.equal(f.kalla.antal.tidsposter, 7);
  assert.ok(!fetch.anrop.some(a => a.metod === 'PUT'), 'ingen skrivning');
});

test('kontrollsidan visar antal, inte kundnamn eller belopp', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const f = await forbered(skapaLagring({ token: 'T', hamta: fetch }), { nu: NU });
  const synligt = JSON.stringify({ kalla: f.kalla, forsOver: f.analys.forsOver });
  assert.ok(!synligt.includes('Kund A'), 'inga kundnamn');
  assert.ok(!/\d{4,}0\b/.test(synligt.replace(/sha256:[0-9a-f]+/, '')), 'inga prisbelopp');
});

test('en befintlig v2-fil skrivs aldrig över', async () => {
  // Kontrollen sker så sent som möjligt, sa att ett annat försök i en annan
  // flik inte hinner emellan mellan kontroll och skrivning.
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  const fore = '{"skapad-av-ett-tidigare-forsok":true}';
  fetch.lager[V2_SOKVAG] = fore;

  await assert.rejects(() => genomfor(f, lagring, { bekraftelse: BEKRAFTELSE, nu: NU }),
    e => e instanceof InfrandeAvbrutet && /bara en gång/.test(e.message));
  assert.equal(fetch.lager[V2_SOKVAG], fore, 'filen är orörd');
  assert.ok(!fetch.anrop.some(a => a.metod === 'PUT'), 'ingen skrivning alls');
});

test('utan den ordagranna bekräftelsen skrivs ingenting', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  for (const forsok of ['ja', 'JA', 'ja, skriv', 'JA SKRIV', '']) {
    await assert.rejects(() => genomfor(f, lagring, { bekraftelse: forsok, nu: NU }),
      e => e instanceof InfrandeAvbrutet && e.steg === 'bekräftelse');
  }
  assert.ok(!fetch.anrop.some(a => a.metod === 'PUT'), 'ingen skrivning');
});

test('införandet skriver backup FÖRE v2, och verifierar den', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  const resultat = await genomfor(f, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });

  const skrivningar = fetch.anrop.filter(a => a.metod === 'PUT').map(a => a.url);
  assert.equal(skrivningar.length, 2, 'exakt två skrivningar: backup och v2');
  assert.match(skrivningar[0], /invisiontid-data-v1-backup-/, 'backupen först');
  assert.match(skrivningar[1], /invisiontid-data-v2\.json/, 'sedan v2');

  assert.equal(resultat.backup.checksumma, f.kalla.checksumma, 'byte-identisk backup');
  assert.equal(resultat.backup.byteLangd, f.kalla.byteLangd);
  assert.equal(fetch.lager[resultat.backup.sokvag], v1Fixtur(), 'exakt samma text');
});

test('v1-filen är oförändrad efter införandet', async () => {
  const fore = v1Fixtur();
  const fetch = stubbGraph({ [V1_SOKVAG]: fore });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  const resultat = await genomfor(f, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });

  assert.equal(fetch.lager[V1_SOKVAG], fore, 'byte för byte oförändrad');
  assert.equal(await sha256(fetch.lager[V1_SOKVAG]), f.kalla.checksumma);
  assert.equal(resultat.v1Oforandrad, true);
  assert.ok(!fetch.anrop.some(a => a.metod === 'PUT' && a.url.includes('invisiontid-data.json:')),
    'ingen PUT mot v1-sökvägen');
});

test('misslyckad backup avbryter innan v2 skapas', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });

  // Backupskrivningen misslyckas.
  const trasig = { ...lagring, skriv: async () => { throw new Error('disken är full'); } };
  await assert.rejects(() => genomfor(f, trasig, { bekraftelse: BEKRAFTELSE, nu: NU }),
    e => e instanceof InfrandeAvbrutet && e.steg === 'backup');
  assert.equal(fetch.lager[V2_SOKVAG], undefined, 'ingen v2-fil skapades');
});

test('v2 innehåller startdata men inga fakturamarkeringar', async () => {
  const fetch = stubbGraph({ [V1_SOKVAG]: v1Fixtur() });
  const lagring = skapaLagring({ token: 'T', hamta: fetch });
  const f = await forbered(lagring, { nu: NU });
  const resultat = await genomfor(f, lagring, { bekraftelse: BEKRAFTELSE, nu: NU });

  assert.equal(resultat.data.invoiceRecords.length, 0, 'ingen historisk fakturastatus');
  assert.equal(resultat.data.invoices.length, 0);
  assert.equal(resultat.data.schemaVersion, 2);
  assert.ok(resultat.data.articles.every(a => a.vatStatus === 'needsReview'),
    'ingen momssats gissas fram');
  assert.equal(resultat.data.deliverables.length, 0, 'fastprisperioder omvandlas inte');
});

// ── Nystartens urval ────────────────────────────────────────────────────────

test('bara aktiva uppdrag och öppna poster förs över', () => {
  const v1 = JSON.parse(v1Fixtur());
  const analys = analysera(v1, { nu: '2026-04-10T00:00:00.000Z' });

  assert.equal(analys.forsOver.fakturamarkeringar, 0);
  assert.equal(analys.lamnasIArkivet.fakturamarkeringar, v1.invoices.length);
  assert.ok(analys.forsOver.oppnaPoster < v1.entries.length, 'fakturerade poster stannar');

  const v2 = nystart(v1, { nu: '2026-04-10T00:00:00.000Z' });
  assert.equal(v2.entries.length, analys.forsOver.oppnaPoster);
  assert.equal(v2.invoiceRecords.length, 0);
});

test('fastprisuppdragens tid blir trackingOnly och kan inte faktureras', () => {
  const v1 = JSON.parse(v1Fixtur());
  const v2 = nystart(v1, { nu: '2026-04-10T00:00:00.000Z' });
  const fastprisuppdrag = v2.projects.filter(p => (p.pricingPeriods || []).length).map(p => p.id);

  for (const pid of fastprisuppdrag) {
    for (const post of v2.entries.filter(e => e.projectId === pid)) {
      assert.equal(L.kanIngaIFakturaunderlag(v2Tillstand(v2), post), false,
        'tid på fastprisuppdrag får inte bli en fakturarad');
    }
  }
});

/** nystart ger v2-data; logiken vill ha samma fält den använder i appen. */
const v2Tillstand = v2 => ({ ...v2, poster: v2.entries });

test('tillfällesposter får antal 1 och måste kontrolleras', () => {
  const v1 = JSON.parse(v1Fixtur());
  const v2 = nystart(v1, { nu: '2026-04-10T00:00:00.000Z' });
  const tillfallesuppdrag = v2.projects.filter(p => p.sessionPrice > 0).map(p => p.id);

  for (const post of v2.entries.filter(e => tillfallesuppdrag.includes(e.projectId))) {
    assert.equal(post.qtyMilli, 1000, 'antal 1');
    assert.equal(post.status, 'needsReview', 'måste kontrolleras');
  }
});

test('nystarten dokumenterar vad som lämnades kvar', () => {
  const v2 = nystart(JSON.parse(v1Fixtur()), { nu: NU });
  assert.equal(v2.nystart.kalla, V1_SOKVAG);
  assert.equal(v2.nystart.forsOver.fakturamarkeringar, 0);
  assert.ok(v2.nystart.lamnasIArkivet.fakturamarkeringar > 0);
});

// ── Sparning och synkkonflikt ───────────────────────────────────────────────

test('en ändrad fil ger synkkonflikt i stället för överskrivning', async () => {
  const { skapaOneDriveLagring } = await import('../src/app/lagring-onedrive.mjs');
  const fetch = stubbGraph({ [V2_SOKVAG]: JSON.stringify(tomV2()) });
  const lagring = skapaOneDriveLagring({ token: 'T', hamta: fetch, nu: () => NU });

  const s = await lagring.las();

  // Någon annan skriver filen mellan läsning och sparning.
  fetch.lager[V2_SOKVAG] = JSON.stringify(tomV2({ entries: [{ id: 'annan-flik', date: '2026-08-01' }] }));
  const fore = fetch.lager[V2_SOKVAG];

  await assert.rejects(
    () => lagring.spara({ ...s, poster: [{ id: 'min', date: '2026-08-01', sourceType: 'entry' }] }),
    Synkkonflikt);
  assert.equal(fetch.lager[V2_SOKVAG], fore, 'den andra flikens data är orörd');
});

test('konfliktbeskedet är på vanlig svenska', () => {
  assert.equal(new Synkkonflikt().message,
    'Data har ändrats i en annan flik eller enhet. Ladda om innan du sparar.');
});

test('sparning gör backup, skriver och läser tillbaka', async () => {
  const { skapaOneDriveLagring } = await import('../src/app/lagring-onedrive.mjs');
  const fetch = stubbGraph({ [V2_SOKVAG]: JSON.stringify(tomV2()) });
  const lagring = skapaOneDriveLagring({ token: 'T', hamta: fetch, nu: () => NU });

  const s = await lagring.las();
  await lagring.spara({ ...s, poster: [{ id: 'ny', date: '2026-08-01', sourceType: 'entry' }] });

  const skrivningar = fetch.anrop.filter(a => a.metod === 'PUT').map(a => a.url);
  assert.equal(skrivningar.length, 2);
  assert.match(skrivningar[0], /invisiontid-data-v2-backup-/, 'backup först');
  assert.match(skrivningar[1], /invisiontid-data-v2\.json/);

  // Filen får tillbaka sin egen form: entries, inte poster.
  const sparad = JSON.parse(fetch.lager[V2_SOKVAG]);
  assert.equal(sparad.poster, undefined, 'filen har aldrig en poster-lista');
  assert.deepEqual(sparad.entries.map(e => e.id), ['ny']);
});

// ── En enda tillståndsmodell ────────────────────────────────────────────────

test('klarmarkeradAt är enda sanningskällan', () => {
  assert.equal(L.arKlartILundify({ klarmarkeradAt: '2026-08-27' }), true);
  assert.equal(L.arKlartILundify({ klarmarkeradAt: null }), false);
  assert.equal(L.arKlartILundify({ status: 'lundifySent' }), false,
    'gammal status ensam gör inte ett underlag klart');
});

test('gammal status läses en gång och styr sedan ingenting', () => {
  const gammal = { id: 'r1', status: 'lundifySent', invoiceDate: '2026-07-01', invoiceNumber: '2341' };
  const n = L.normaliseraReferens(gammal);

  assert.equal(n.klarmarkeradAt, '2026-07-01', 'härlett en gång');
  assert.equal(n.legacyStatus, 'lundifySent', 'undanlagd som legacy');
  assert.equal(n.status, undefined, 'inget parallellt fält kvar');
  assert.equal(L.arKlartILundify(n), true);
});

test('en gammal status som inte betyder klart härleder ingenting', () => {
  const n = L.normaliseraReferens({ id: 'r1', status: 'prepared' });
  assert.equal(n.klarmarkeradAt, undefined);
  assert.equal(L.arKlartILundify(n), false);
});

test('användarläget kan inte få två olika svar', () => {
  // En referens där gammal status och klarmarkeradAt säger emot varandra.
  const motsagelse = { id: 'r1', clientId: 'k', status: 'prepared', klarmarkeradAt: '2026-08-27', nettoOre: 100 };
  const n = L.normaliseraReferens(motsagelse);
  assert.equal(n.status, undefined, 'motsägelsen kan inte överleva inläsningen');

  const s = { poster: [], deliverables: [], projects: [], clients: [], articles: [], invoiceRecords: [n] };
  assert.equal(L.klaraUnderlag(s).length, 1, 'klarmarkeradAt vinner');
  assert.equal(L.arKlartILundify(n), true);
});

test('normaliseringen körs på hela tillståndet vid start', () => {
  const s = L.normaliseraTillstand({
    invoiceRecords: [
      { id: 'a', status: 'lundifyPaid', invoiceDate: '2026-06-01' },
      { id: 'b', status: 'prepared' },
    ],
  });
  assert.equal(s.invoiceRecords[0].klarmarkeradAt, '2026-06-01');
  assert.equal(s.invoiceRecords[1].klarmarkeradAt, undefined);
  assert.ok(s.invoiceRecords.every(r => r.status === undefined));
});

// ── Produktionspaketet ──────────────────────────────────────────────────────

function appfiler() {
  const rot = join(repoRot, 'src', 'app');
  return readdirSync(rot).map(n => join(rot, n))
    .filter(f => statSync(f).isFile() && extname(f) === '.mjs');
}

test('produktionsappen importerar aldrig testdata', () => {
  const filer = [...appfiler(), join(repoRot, 'index.html')];
  for (const fil of filer) {
    const kod = readFileSync(fil, 'utf8');
    assert.ok(!/from ['"].*testdata\.mjs['"]/.test(kod), `${fil} importerar testdata`);
    assert.ok(!/skapaTestdata/.test(kod), `${fil} anropar skapaTestdata`);
    assert.ok(!/prototyp\//.test(kod), `${fil} importerar från prototypen`);
  }
});

test('produktionssidan har varken testbanderoll eller väg till testdata', () => {
  const html = readFileSync(join(repoRot, 'index.html'), 'utf8');
  assert.ok(!/Testversion med påhittade data/.test(html));
  assert.ok(!/Börja om/.test(html));
  assert.match(html, /src\/app\/start\.mjs/, 'startar produktionsappen');
});

test('produktionsappen innehåller inga tokens eller privata sökvägar', () => {
  // Mönstret letar efter SÖKVÄGAR, inte efter ord. Produktnamnet "In Vision Tid"
  // står i rubriken på varje sida och är inte en sökväg — därför krävs en
  // katalogseparator. Delarna sätts ihop, annars flaggar filen sig själv.
  const SEP = '[' + '\\\\' + '/]';
  const privatSokvag = new RegExp([
    'C:' + SEP + 'Users', '/Users/' + 'ronne', 'One' + 'Drive' + SEP + 'InVisionTid',
    'One' + 'Drive -',
    'IN ' + 'VISION' + SEP,
    'Produkter' + SEP + 'InVisionTid',
  ].join('|'), 'i');

  for (const fil of [...appfiler(), join(repoRot, 'index.html')]) {
    const kod = readFileSync(fil, 'utf8');
    assert.ok(!/eyJ[A-Za-z0-9_-]{10}/.test(kod), `${fil} innehåller ett token`);
    assert.ok(!privatSokvag.test(kod), `${fil} innehåller en privat sökväg`);
  }
});

test('den gamla appen är arkiverad som text och kan inte köras', () => {
  const arkiv = join(repoRot, 'arkiv', 'v1-app.txt');
  assert.ok(statSync(arkiv).isFile());
  const kod = readFileSync(arkiv, 'utf8');
  assert.ok(kod.includes('oneDriveWrite'), 'den gamla koden finns kvar som referens');
  // Ingen .html i arkivet, så webbläsaren kör den inte.
  const filer = readdirSync(join(repoRot, 'arkiv'));
  assert.ok(!filer.some(n => extname(n) === '.html'), 'arkivet innehåller ingen körbar sida');
});
