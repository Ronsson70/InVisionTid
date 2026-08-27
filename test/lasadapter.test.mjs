// Etapp 4B: bevis för att den verkliga förhandsgranskningen är skrivskyddad.
//
// Kraven som prövas:
//   1. endast GET tillåts
//   2. varje skrivmetod stoppas FÖRE nätverksanropet
//   3. en förhandsgranskning gör exakt noll skrivningar
//   4. källans SHA-256 är identisk före och efter körningen
//   5. rådata skrivs inte till terminal, testartefakter eller versionshanterade filer
//   6. autentiseringsuppgifter och tokens loggas aldrig
//   7. felaktig eller tvetydig filsökväg avbryter körningen
//   8. nätverksfel eller avbruten autentisering leder inte till någon skrivning

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

import {
  skapaGraphLasare, endastGet, faststallAktivFil, saneraFel,
  SkrivforsokAvvisat, OtydligKalla, TILLATNA_METODER, innehallsUrl,
} from '../src/integrations/onedrive/lasadapter.mjs';
import { skapaFillasare, hittaKandidater } from '../src/integrations/lokal/synkadfil.mjs';
import { forhandsgranskaMigrering } from '../src/data/forhandsgranskning.mjs';
import { saneradRapport, rapportText } from '../src/data/rapport.mjs';
import { checksumma } from '../src/data/backup.mjs';

const TOKEN = 'HEMLIGT-TOKEN-abc123XYZ';
const repoRot = fileURLToPath(new URL('../', import.meta.url));
const FIXTUR = join(repoRot, 'test-fixtures', 'v1-legacy.json');

/** Registrerar varje anrop, så testerna kan bevisa att inget nätverksanrop skedde. */
function spionFetch(svar = { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }) {
  const anrop = [];
  const f = async (url, init) => { anrop.push({ url, init }); return svar; };
  f.anrop = anrop;
  return f;
}

// ── Krav 1 och 2 ────────────────────────────────────────────────────────────

test('krav 1: bara GET finns i tillåtelselistan', () => {
  assert.deepEqual([...TILLATNA_METODER], ['GET']);
  assert.equal(endastGet('GET'), 'GET');
  assert.equal(endastGet('get'), 'GET');
  assert.equal(endastGet(undefined), 'GET', 'standard är GET');
});

test('krav 1: varje skrivmetod avvisas', () => {
  for (const metod of ['PUT', 'PATCH', 'POST', 'DELETE', 'put', 'Post', 'HEAD', 'OPTIONS']) {
    assert.throws(() => endastGet(metod), e => e instanceof SkrivforsokAvvisat, `${metod} ska avvisas`);
  }
});

test('krav 2: skrivmetoder stoppas innan någon nätverksbegäran skickas', () => {
  const fetch = spionFetch();
  skapaGraphLasare({ token: TOKEN, hamta: fetch });
  for (const metod of ['PUT', 'PATCH', 'POST', 'DELETE']) {
    assert.throws(() => endastGet(metod), /Ingen nätverksbegäran har gjorts/);
  }
  assert.equal(fetch.anrop.length, 0, 'inget nätverksanrop får ha skett');
});

test('krav 2: läsaren skickar alltid GET, oavsett vad den ombeds', async () => {
  const fetch = spionFetch({ ok: true, status: 200, text: async () => '{"a":1}', json: async () => ({}) });
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: fetch });
  await lasare.las();
  assert.equal(fetch.anrop.length, 1);
  assert.equal(fetch.anrop[0].init.method, 'GET');
});

test('krav 2: läsaren erbjuder ingen skrivfunktion alls', () => {
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: spionFetch() });
  for (const namn of ['skriv', 'write', 'put', 'spara', 'uppdatera', 'radera', 'delete', 'upload']) {
    assert.equal(typeof lasare[namn], 'undefined', `${namn} får inte finnas`);
  }
  assert.deepEqual(Object.keys(lasare).filter(k => typeof lasare[k] === 'function').sort(),
    ['las', 'metadata', 'toJSON']);
  assert.equal(lasare.skrivskyddad, true);
});

test('krav 1 och 2: adapterkoden innehåller ingen skrivande HTTP-metod', () => {
  const kod = readFileSync(join(repoRot, 'src', 'integrations', 'onedrive', 'lasadapter.mjs'), 'utf8');
  // De enda förekomsterna av skrivmetodernas namn ska vara i avvisningslistan i
  // testet ovan, inte i adaptern. Adaptern nämner dem bara i sitt felmeddelande.
  assert.ok(!/method:\s*['"](PUT|PATCH|POST|DELETE)/i.test(kod), 'ingen skrivande metod får sättas');
  assert.ok(/method:\s*['"]GET['"]/.test(kod), 'GET ska vara hårdkodat');
});

// ── Krav 3 och 4 ────────────────────────────────────────────────────────────

test('krav 3 och 4: en förhandsgranskning gör noll skrivningar och lämnar källan orörd', async () => {
  const lasare = skapaFillasare(FIXTUR);
  assert.equal(typeof lasare.skriv, 'undefined', 'fillasaren har ingen skrivfunktion');

  const fore = await checksumma(lasare.las());
  const f = forhandsgranskaMigrering(lasare.las(), { nu: '2026-08-27T10:00:00.000Z' });
  const efter = await checksumma(lasare.las());

  assert.equal(f.sparat, false);
  assert.equal(fore, efter, 'källans SHA-256 ska vara identisk före och efter');

  const rapport = saneradRapport(f, { checksummaFore: fore, checksummaEfter: efter });
  assert.equal(rapport.skrivningar, 0);
  assert.equal(rapport.sparat, false);
  assert.equal(rapport.kalla.oforandrad, true);
});

// ── Krav 5: rådata läcker inte ──────────────────────────────────────────────

test('krav 5: rapporten kan inte bära innehåll ur källan', () => {
  // Kanariefågel: varje textfält i den syntetiska källan bär en markör.
  const K = 'KANARIE-SKA-ALDRIG-SYNAS';
  const kalla = JSON.stringify({
    clients: [{ id: 'c1', name: K, orgNr: K, email: K, phone: K, address: K, contact: K }],
    // Projektet bär BÅDE ett timpris och en fastprisperiod, så att varje väg ut
    // ur förhandsgranskningen är befolkad: artiklar, granskningsposter och
    // bevarade fastprisperioder. En tom array kan inte läcka någonting, och ett
    // kanarietest mot en tom array bevisar därför ingenting.
    projects: [{
      id: 'p1', name: K, clientId: 'c1', hourlyRate: 12345, sessionPrice: 0,
      pricingPeriods: [{ id: 'pp1', type: 'fixed', startDate: '2026-01-01', endDate: '2026-12-31', amount: 987654 }],
    }],
    entries: [{ id: 'e1', projectId: 'p1', moment: K, note: K, seconds: 3600, date: '2026-06-01', createdAt: '2026-06-01T10:00:00.000Z' }],
    expenses: [{ id: 'x1', projectId: 'p1', amount: 999, description: K, date: '2026-06-01', createdAt: '2026-06-01T10:00:00.000Z' }],
    trips: [{ id: 't1', projectId: 'p1', km: 7, description: K, date: '2026-06-01', createdAt: '2026-06-01T10:00:00.000Z' }],
    invoices: [{ projectId: 'p1', month: '2026-06', invoicedAt: '2026-07-01' }],
    hourlyRate: 850, kmRate: 5.5,
  });

  const f = forhandsgranskaMigrering(kalla, { nu: '2026-08-27T10:00:00.000Z' });
  assert.ok(JSON.stringify(f).includes(K), 'förhandsgranskningen själv innehåller markören');

  const rapport = saneradRapport(f, { sokvag: '/en/sokvag', checksummaFore: 'a', checksummaEfter: 'a' });
  const serialiserad = JSON.stringify(rapport);
  assert.ok(!serialiserad.includes(K), 'rapporten får INTE innehålla markören');
  assert.ok(!rapportText(rapport).includes(K), 'rapporttexten får INTE innehålla markören');

  // Artikelnamnen genereras av migreringen och bär inget källinnehåll, men
  // PRISET gör det. Markörbeloppen är valda för att vara omöjliga att förväxla
  // med ett antal eller en tidsstämpel.
  //
  // Blanksteg strippas före jämförelsen: 12345 formateras som "12 345,00 kr"
  // med ett hårt blanksteg, och ett test som letar efter "12345" i den strängen
  // skulle annars aldrig hitta något och tyst sluta bevisa någonting.
  const utanBlanksteg = s => String(s).replace(/\s| | /g, '');
  for (const yta of [serialiserad, rapportText(rapport)]) {
    const platt = utanBlanksteg(yta);
    assert.ok(!platt.includes('12345'), 'timpriset ur källan får inte finnas i rapporten');
    assert.ok(!platt.includes('987654'), 'fastprisbeloppet ur källan får inte finnas i rapporten');
  }
});

test('rapportering: momsgranskningarna ligger UTANFÖR granskningskön', () => {
  const f = forhandsgranskaMigrering(readFileSync(FIXTUR, 'utf8'), { nu: '2026-08-27T10:00:00.000Z' });

  // Granskningskön är poster i reviewQueue. Momsflaggan sitter på artikeln.
  // Ingen artikel får förekomma som ref i kön, annars vore antalen överlappande
  // och summan nedan skulle dubbelräkna.
  const kon = f.resultat.reviewQueue || [];
  const artiklar = f.resultat.articles || [];
  const ogranskade = artiklar.filter(a => a.vatStatus === 'needsReview');
  assert.ok(kon.length > 0 && ogranskade.length > 0);
  assert.ok(!kon.some(k => artiklar.some(a => a.id === k.ref)), 'ingen artikel ligger i granskningskön');
  assert.ok(!kon.some(k => /moms/i.test(k.typ)), 'ingen kötyp handlar om moms');

  const r = saneradRapport(f, {});
  assert.equal(r.beslut.iGranskningskon, kon.length);
  assert.equal(r.beslut.momsUtanforGranskningskon, ogranskade.length);
  assert.equal(r.beslut.totalt, kon.length + ogranskade.length);

  const text = rapportText(r);
  assert.match(text, /moms, UTANFÖR granskningskön/);
  assert.match(text, /SUMMA beslut/);
  assert.match(text, /Momsflaggan sitter på artikeln, inte i granskningskön/);
});

test('krav 5: rapporten bär inga belopp ur källan', () => {
  const kalla = readFileSync(FIXTUR, 'utf8');
  const f = forhandsgranskaMigrering(kalla, { nu: '2026-08-27T10:00:00.000Z' });
  const text = rapportText(saneradRapport(f, {}));
  // Priserna i fixturen: 2400, 850, 350, 100000, 15000
  for (const belopp of ['2 400', '2400', '100 000', '100000', '15 000', '15000']) {
    assert.ok(!text.includes(belopp), `beloppet ${belopp} får inte finnas i rapporten`);
  }
});

test('krav 5: inga rapport- eller dataartefakter är versionshanterade', () => {
  const ignorerade = readFileSync(join(repoRot, '.gitignore'), 'utf8');
  for (const monster of ['invisiontid-data.json', 'invisiontid-backup-*.json', 'migrering-backup-*.json', '*.local.md']) {
    assert.ok(ignorerade.includes(monster), `${monster} ska vara gitignorerad`);
  }
});

// ── Krav 6: tokens loggas aldrig ────────────────────────────────────────────

test('krav 6: ett token läcker inte via objektet', () => {
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: spionFetch() });
  assert.ok(!JSON.stringify(lasare).includes(TOKEN));
  assert.equal(JSON.parse(JSON.stringify(lasare)).token, '[dolt]');
});

test('krav 6: ett token läcker inte via ett nätverksfel', async () => {
  const trasig = async () => { throw new Error(`ECONNRESET vid Bearer ${TOKEN}`); };
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: trasig });
  await assert.rejects(() => lasare.las(), e => {
    assert.ok(!e.message.includes(TOKEN), 'tokenet får inte finnas i felmeddelandet');
    assert.match(e.message, /Nätverksfel vid läsning/);
    return true;
  });
});

test('krav 6: saneraFel döljer Bearer-huvuden och access_token', () => {
  assert.ok(!saneraFel(`Authorization: Bearer ${TOKEN}`, [TOKEN]).includes(TOKEN));
  assert.ok(!saneraFel('...#access_token=eyJhbGciOi.abc123&x=1').includes('eyJhbGciOi'));
  assert.equal(saneraFel('vanligt fel'), 'vanligt fel');
});

test('krav 6: rapporten har ingen plats för ett token', () => {
  const f = forhandsgranskaMigrering(readFileSync(FIXTUR, 'utf8'), { nu: '2026-08-27T10:00:00.000Z' });
  const rapport = saneradRapport(f, { sokvag: '/x', token: TOKEN, Authorization: `Bearer ${TOKEN}` });
  assert.ok(!JSON.stringify(rapport).includes(TOKEN));
  assert.equal(rapport.kalla.token, undefined, 'tillåtelselistan har inget tokenfält');
});

// ── Krav 7: otydlig källa avbryter ──────────────────────────────────────────

test('krav 7: noll kandidater avbryter', () => {
  assert.throws(() => faststallAktivFil([]), e => e instanceof OtydligKalla && /Ingen kandidat/.test(e.message));
});

test('krav 7: flera kandidater avbryter utan att någon fil läses', () => {
  assert.throws(
    () => faststallAktivFil(['/a/invisiontid-data.json', '/b/invisiontid-data.json']),
    e => e instanceof OtydligKalla && /utan att någon fil läses in/.test(e.message)
  );
});

test('krav 7: exakt en kandidat godtas', () => {
  assert.equal(faststallAktivFil(['/a/invisiontid-data.json']), '/a/invisiontid-data.json');
});

test('krav 7: en sökväg som inte finns avbryter före läsning', () => {
  assert.throws(() => skapaFillasare(join(repoRot, 'finns-inte.json')), e => e instanceof OtydligKalla);
  assert.throws(() => skapaFillasare(''), e => e instanceof OtydligKalla);
  assert.throws(() => skapaFillasare(repoRot), /inte en fil/);
});

test('krav 7: hittaKandidater letar bara på appens egen sökväg', () => {
  const kandidater = hittaKandidater([join(repoRot, 'finns-inte'), join(repoRot, 'inte-heller')]);
  assert.deepEqual(kandidater, []);
});

// ── Krav 8: fel leder inte till skrivning ───────────────────────────────────

test('krav 8: nätverksfel ger inget anrop som kan skriva', async () => {
  const fetch = spionFetch();
  const trasig = async (u, i) => { fetch.anrop.push({ url: u, init: i }); throw new Error('ECONNRESET'); };
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: trasig });
  await assert.rejects(() => lasare.las());
  assert.equal(fetch.anrop.length, 1);
  assert.equal(fetch.anrop[0].init.method, 'GET', 'även det misslyckade anropet var en GET');
});

test('krav 8: avbruten autentisering ger ett tydligt fel och ingen skrivning', async () => {
  const fetch = spionFetch({ ok: false, status: 401, text: async () => '', json: async () => ({}) });
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: fetch });
  await assert.rejects(() => lasare.las(), /Inloggningen har gått ut eller saknar behörighet/);
  assert.ok(fetch.anrop.every(a => a.init.method === 'GET'));
});

test('krav 8: 404 behandlas som otydlig källa, inte som tom fil', async () => {
  const fetch = spionFetch({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
  const lasare = skapaGraphLasare({ token: TOKEN, hamta: fetch });
  await assert.rejects(() => lasare.las(), e => e instanceof OtydligKalla);
});

test('krav 8: ett fel mitt i en förhandsgranskning lämnar källan orörd', async () => {
  const lasare = skapaFillasare(FIXTUR);
  const fore = await checksumma(lasare.las());
  try {
    forhandsgranskaMigrering(null, { nu: '2026-08-27T10:00:00.000Z' });
  } catch { /* förväntat */ }
  assert.equal(await checksumma(lasare.las()), fore);
});

// ── Gränsen mellan lagren ───────────────────────────────────────────────────

function samlaKallfiler(katalog, ut = []) {
  for (const namn of readdirSync(katalog)) {
    const full = join(katalog, namn);
    if (statSync(full).isDirectory()) samlaKallfiler(full, ut);
    else if (extname(namn) === '.mjs') ut.push(full);
  }
  return ut;
}

test('gräns: src/integrations får röra nätverk och filsystem, men bara läsande', () => {
  const filer = samlaKallfiler(join(repoRot, 'src', 'integrations'));
  assert.ok(filer.length > 0);
  const skrivande = /writeFile|appendFile|createWriteStream|localStorage\.setItem|\.rm\(|unlink/;
  for (const fil of filer) {
    const rel = fil.slice(repoRot.length).replaceAll('\\', '/');
    assert.ok(!skrivande.test(readFileSync(fil, 'utf8')), `${rel} får inte kunna skriva`);
  }
});

test('gräns: appens Graph-sökväg i adaptern stämmer med den i index.html', () => {
  const html = readFileSync(join(repoRot, 'index.html'), 'utf8');
  const url = innehallsUrl('invisiontid-data.json');
  const iApp = html.includes('me/drive/root:/InVisionTid/${ONEDRIVE_FILENAME}:/content');
  assert.ok(iApp, 'index.html ska använda den sökväg adaptern härletts ur');
  assert.match(url, /me\/drive\/root:\/InVisionTid\/invisiontid-data\.json:\/content$/);
});
