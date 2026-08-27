// Etapp 4A: backup, migreringsförhandsgranskning och återställning.
//
// Allt körs mot syntetiska fixtures och en källa i minnet. Ingen kod här rör
// OneDrive, localStorage, index.html eller någon verklig fil utöver den
// syntetiska test-fixtures/v1-legacy.json.
//
// Kraven som prövas, i ordning:
//   1. backup bevarar rådata byte för byte
//   2. förhandsgranskningen visar allt som ska granskas
//   3. förhandsgranskningen sparar ingenting
//   4. återställning ger tillbaka originalets checksumma exakt
//   5. avbruten eller misslyckad migrering ändrar ingen källa
//   6. upprepad migrering är idempotent
//   7. inga verkliga datafiler används
//   8. ingen koppling till index.html, localStorage eller OneDrive

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

import {
  skapaBackup, verifieraBackup, aterstallFranBackup, checksumma, backupFilnamn, likaByteForByte,
  forhandsgranskaMigrering, sammanfattning,
  forberedMigrering, genomforMigrering, aterstallMigrering, godkannande, kallanArOforandrad,
} from '../src/data/index.mjs';

import { skapaMinneskalla, skapaKallaMedTrasigBackup } from './lib/minneskalla.mjs';

const NU = '2026-08-27T10:00:00.000Z';
const FIXTUR = fileURLToPath(new URL('../test-fixtures/v1-legacy.json', import.meta.url));
const ravara = () => readFileSync(FIXTUR, 'utf8');

const JA = godkannande({ av: 'test', at: NU, bekraftelse: 'JA, SKRIV' });

/**
 * sv-SE använder ett hårt blanksteg som tusentalsavgränsare (U+00A0 eller
 * U+202F beroende på ICU-version). Testet ska pröva beloppet, inte vilket
 * mellanslagstecken körningens ICU råkar välja.
 */
const normalisera = s => String(s).replace(/[   ]/g, ' ');

/** Tar bort kommentarer, så en källkodsskanning provar kod och inte prosa. */
const utanKommentarer = kod => kod
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── Krav 1: backup byte för byte ────────────────────────────────────────────

test('krav 1: backupen bevarar rådata exakt, tecken för tecken', async () => {
  const text = ravara();
  const backup = await skapaBackup(text, { nu: NU, kalla: 'syntetisk fixtur' });
  assert.equal(backup.ravara, text);
  assert.ok(likaByteForByte(backup.ravara, text));
});

test('krav 1: backupen bevarar det JSON.parse skulle ha förstört', async () => {
  // Nyckelordning, blanksteg, talformat och Unicode-escaper överlever inte en
  // tur genom JSON.parse + JSON.stringify. Backupen sparar text, inte objekt.
  const knepig = '{\n  "b": 1,\n  "a": 2,\n  "tal": 1.50,\n  "text": "\\u00e5\\u00e4\\u00f6",\n  "tomt":   {}\n}';
  const backup = await skapaBackup(knepig, { nu: NU, kalla: 'kantfall' });

  assert.equal(backup.ravara, knepig);
  assert.notEqual(JSON.stringify(JSON.parse(knepig)), knepig, 'en tolkad kopia skulle INTE vara identisk');
  assert.equal(await aterstallFranBackup(backup), knepig);
});

test('krav 1: bytelängd räknas i UTF-8, inte i tecken', async () => {
  const backup = await skapaBackup('måndag', { nu: NU, kalla: 'tecken' });
  assert.equal(backup.teckenLangd, 6);
  assert.equal(backup.byteLangd, 7, 'å är två byte i UTF-8');
});

test('krav 1: backupen vägrar ta emot ett tolkat objekt', async () => {
  await assert.rejects(
    () => skapaBackup({ inte: 'text' }, { nu: NU, kalla: 'fel' }),
    /måste få rådata som text/
  );
});

test('krav 1: manipulerad backup upptäcks och kan inte återställas', async () => {
  const backup = await skapaBackup(ravara(), { nu: NU, kalla: 'syntetisk fixtur' });
  const manipulerad = { ...backup, ravara: backup.ravara.replace('"km": 23', '"km": 99') };

  const kontroll = await verifieraBackup(manipulerad);
  assert.equal(kontroll.giltig, false);
  assert.match(kontroll.fel.join(' '), /Checksumman stämmer inte/);
  await assert.rejects(() => aterstallFranBackup(manipulerad), /inte intakt/);
});

test('krav 1: backupens filnamn är svenskt, utan understreck och utan kolon', () => {
  const namn = backupFilnamn(NU);
  assert.match(namn, /^invisiontid-backup-[\d-T]+\.json$/);
  assert.ok(!namn.includes('_'), 'inga understreck i användarsynliga filnamn');
  assert.ok(!namn.includes(':'), 'kolon är otillåtet i filnamn på Windows');
});

// ── Krav 2: förhandsgranskningen visar allt ─────────────────────────────────

test('krav 2: förhandsgranskningen visar före- och efter-antal', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.giltig, true);
  for (const falt of ['clients', 'projects', 'entries', 'expenses', 'trips', 'invoices', 'tombstones']) {
    assert.ok(f.efter[falt] >= f.fore[falt], `${falt} får inte minska`);
  }
  assert.equal(f.fore.entries, 7);
  assert.equal(f.efter.entries, 7);
});

test('krav 2: förhandsgranskningen visar kontrollsummor som ska vara oförändrade', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.efter.sekunder, f.fore.sekunder);
  assert.equal(f.efter.km, f.fore.km);
  assert.equal(f.efter.utlaggKronor, f.fore.utlaggKronor);
  assert.deepEqual(f.avvikelser, []);
});

test('krav 2: förhandsgranskningen listar skapade artiklar med pris och momsstatus', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.skapade.artiklar, 9);
  assert.equal(f.artiklar.length, 9);
  const tillfalle = f.artiklar.find(a => a.typ === 'session');
  assert.equal(normalisera(tillfalle.prisText), '2 400,00 kr');
  assert.equal(tillfalle.moms, 'ogranskad');
  const resa = f.artiklar.find(a => a.typ === 'travel');
  assert.equal(normalisera(resa.prisText), '5,50 kr');
});

test('krav 2: förhandsgranskningen visar ogranskad moms', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.ogranskadMomsAntal, 9, 'ingen momssats finns i v1, alla måste granskas');
  assert.equal(f.ogranskadMoms.length, 9);
  assert.ok(f.ogranskadMoms.every(a => a.notis), 'varje artikel bär en notis om varför');
});

test('krav 2: förhandsgranskningen visar bevarade fastprisperioder', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.bevaradeFastprisperioder.length, 2);
  assert.ok(f.bevaradeFastprisperioder.every(p => p.omvandladTillLeverans === false));
  assert.equal(f.skapade.leveranser, 0, 'inga leveranser skapas automatiskt');
  const period = f.bevaradeFastprisperioder.find(p => p.projectId === 'p-d');
  assert.equal(normalisera(period.beloppText), '100 000,00 kr');
});

test('krav 2: förhandsgranskningen visar samtliga granskningsposter', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.granskningsposter.length, f.skapade.granskningsposter);
  assert.deepEqual(Object.keys(f.granskningsposterPerTyp).sort(), [
    'omigrerad-fakturamarkering', 'osaker-kvantitet', 'osakert-pris', 'utlagg-utan-kvitto',
  ]);
  assert.equal(f.granskningsposterPerTyp['osakert-pris'], 2);
  assert.equal(f.granskningsposterPerTyp['omigrerad-fakturamarkering'], 3);
  assert.ok(f.granskningsposter.every(k => k.beskrivning), 'varje post förklarar sig');
});

test('krav 2: fakturareferenser visas som osäkra utan fakturanummer', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.fakturareferenser.length, 3);
  assert.ok(f.fakturareferenser.every(r => r.invoiceNumber === null));
  assert.ok(f.fakturareferenser.every(r => r.needsReview === true));
  assert.ok(f.fakturareferenser.every(r => r.status === 'prepared'));
});

test('krav 2: sammanfattningen är läsbar svenska och nämner det som kräver granskning', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  const text = sammanfattning(f);
  assert.match(text, /Migreringsförhandsgranskning/);
  assert.match(text, /artiklar med ogranskad moms/);
  assert.match(text, /bevarade fastprisperioder/);
  assert.match(text, /fastpris omvandlas aldrig automatiskt/);
  assert.match(text, /Ingenting har sparats/);
});

// ── Krav 3: förhandsgranskningen sparar ingenting ───────────────────────────

test('krav 3: förhandsgranskningen skriver inte till källan', async () => {
  const kalla = skapaMinneskalla(ravara());
  const fore = kalla.innehall;

  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });

  assert.equal(forberedelse.forhandsgranskning.sparat, false);
  assert.equal(forberedelse.skrivet, false);
  assert.equal(kalla.antalSkrivningar, 0, 'ingen skrivning får ha skett');
  assert.equal(kalla.backuper.length, 0, 'inte ens backupen sparas av en förhandsgranskning');
  assert.ok(likaByteForByte(kalla.innehall, fore));
});

test('krav 3: förhandsgranskningen ändrar inte indata', () => {
  const text = ravara();
  const indata = JSON.parse(text);
  const kopia = structuredClone(indata);
  forhandsgranskaMigrering(text, { nu: NU });
  assert.deepEqual(indata, kopia, 'indata får inte muteras');
});

// ── Krav 4: återställning ───────────────────────────────────────────────────

test('krav 4: återställning ger tillbaka originalets checksumma exakt', async () => {
  const original = ravara();
  const originalSumma = await checksumma(original);
  const kalla = skapaMinneskalla(original);

  // Migrera skarpt mot minneskällan.
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  await genomforMigrering(forberedelse, {
    sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA,
  });
  assert.notEqual(await checksumma(kalla.innehall), originalSumma, 'källan ska ha ändrats av migreringen');

  // Återställ.
  await aterstallMigrering({ backup: kalla.backuper[0], skriv: kalla.skriv, godkant: JA });

  assert.equal(await checksumma(kalla.innehall), originalSumma, 'checksumman ska återkomma exakt');
  assert.ok(likaByteForByte(kalla.innehall, original), 'och innehållet byte för byte');
});

test('krav 4: återställning kräver uttryckligt godkännande', async () => {
  const kalla = skapaMinneskalla(ravara());
  const backup = await skapaBackup(ravara(), { nu: NU, kalla: 'minne' });

  await assert.rejects(
    () => aterstallMigrering({ backup, skriv: kalla.skriv, godkant: null }),
    /uttryckligt godkännande/
  );
  assert.equal(kalla.antalSkrivningar, 0);
});

test('krav 4: godkännandet kan inte ges av misstag', () => {
  assert.throws(() => godkannande({ av: 'x', at: NU, bekraftelse: 'ja' }), /JA, SKRIV/);
  assert.throws(() => godkannande({ av: 'x', at: NU, bekraftelse: true }), /JA, SKRIV/);
  assert.throws(() => godkannande({ av: '', at: NU, bekraftelse: 'JA, SKRIV' }), /vem som godkände/);
  assert.throws(() => godkannande({ av: 'x', at: '', bekraftelse: 'JA, SKRIV' }), /när det gavs/);
});

// ── Krav 5: avbrott ändrar ingen källa ──────────────────────────────────────

test('krav 5: utan godkännande skrivs ingenting', async () => {
  const kalla = skapaMinneskalla(ravara());
  const fore = kalla.innehall;
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });

  await assert.rejects(
    () => genomforMigrering(forberedelse, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: null }),
    e => e.name === 'MigreringAvbruten' && e.steg === 'godkannande'
  );
  assert.equal(kalla.antalSkrivningar, 0);
  assert.ok(kallanArOforandrad(kalla.innehall, fore));
});

test('krav 5: om backupen inte kan sparas skrivs ingenting annat', async () => {
  const kalla = skapaKallaMedTrasigBackup(ravara());
  const fore = kalla.innehall;
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });

  await assert.rejects(
    () => genomforMigrering(forberedelse, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA }),
    e => e.name === 'MigreringAvbruten' && e.steg === 'backup' && /källan är orörd/.test(e.message)
  );
  assert.equal(kalla.antalSkrivningar, 0, 'skrivfunktionen ska aldrig ha anropats');
  assert.ok(kallanArOforandrad(kalla.innehall, fore));
});

test('krav 5: trasig JSON stoppas i förhandsgranskningen, källan är orörd', async () => {
  const trasig = '{ detta är inte json';
  const kalla = skapaMinneskalla(trasig);
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });

  assert.equal(forberedelse.kanGenomforas, false);
  assert.match(forberedelse.forhandsgranskning.fel.join(' '), /inte giltig JSON/);

  await assert.rejects(
    () => genomforMigrering(forberedelse, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA }),
    e => e.name === 'MigreringAvbruten' && e.steg === 'forhandsgranskning'
  );
  assert.equal(kalla.antalSkrivningar, 0);
  assert.ok(kallanArOforandrad(kalla.innehall, trasig));
});

test('krav 5: utan skrivfunktioner händer ingenting', async () => {
  const kalla = skapaMinneskalla(ravara());
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  await assert.rejects(
    () => genomforMigrering(forberedelse, { godkant: JA }),
    e => e.steg === 'skrivfunktioner'
  );
  assert.equal(kalla.antalSkrivningar, 0);
});

test('krav 5: en läsfunktion som ger objekt i stället för text avvisas', async () => {
  await assert.rejects(
    () => forberedMigrering({ las: async () => ({ inte: 'text' }), kalla: 'minne', nu: NU }),
    /måste returnera TEXT/
  );
});

test('krav 5: en genomförd förberedelse kan inte köras en gång till', async () => {
  const kalla = skapaMinneskalla(ravara());
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  const klar = await genomforMigrering(forberedelse, {
    sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA,
  });
  await assert.rejects(
    () => genomforMigrering(klar, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA }),
    /redan genomförd/
  );
  assert.equal(kalla.antalSkrivningar, 1);
});

// ── Krav 6: idempotens ──────────────────────────────────────────────────────

test('krav 6: förhandsgranskningen bevisar idempotens innan den godkänns', () => {
  const f = forhandsgranskaMigrering(ravara(), { nu: NU });
  assert.equal(f.idempotent, true);
});

test('krav 6: en andra migrering av redan migrerad data skapar inga dubbletter', async () => {
  const kalla = skapaMinneskalla(ravara());

  const forsta = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  await genomforMigrering(forsta, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA });
  const efterForsta = kalla.innehall;

  const andra = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  assert.equal(andra.forhandsgranskning.redanMigrerad, true);
  await genomforMigrering(andra, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA });

  const a = JSON.parse(efterForsta);
  const b = JSON.parse(kalla.innehall);
  for (const falt of ['articles', 'deliverables', 'invoiceRecords', 'reviewQueue', 'entries', 'trips', 'expenses']) {
    assert.equal((b[falt] || []).length, (a[falt] || []).length, `${falt} får inte växa`);
  }
});

test('krav 6: migreringen förlorar ingenting genom en tur via text', async () => {
  const kalla = skapaMinneskalla(ravara());
  const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'minne', nu: NU });
  await genomforMigrering(forberedelse, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: JA });

  const original = JSON.parse(ravara());
  const ut = JSON.parse(kalla.innehall);
  assert.equal(ut.entries.length, original.entries.length);
  assert.equal(ut.trips.length, original.trips.length);
  assert.equal(ut.expenses.length, original.expenses.length);
  assert.equal(Object.keys(ut.deletedIds).length, Object.keys(original.deletedIds).length);
  assert.deepEqual(ut.invoices, original.invoices, 'råvärdet behålls orört');
  assert.equal(ut.settings.migrationConfirmedAt, NU, 'godkännandet stämplas i datat');
});

// ── Krav 7 och 8: ingen koppling till verkliga lager ────────────────────────

const repoRot = fileURLToPath(new URL('../', import.meta.url));

function samlaKallfiler(katalog, ut = []) {
  for (const namn of readdirSync(katalog)) {
    const full = join(katalog, namn);
    if (statSync(full).isDirectory()) samlaKallfiler(full, ut);
    else if (extname(namn) === '.mjs') ut.push(full);
  }
  return ut;
}

test('krav 7 och 8: src/ rör varken OneDrive, localStorage, nätverk eller filsystem', () => {
  const filer = samlaKallfiler(join(repoRot, 'src'));
  assert.ok(filer.length > 0);
  const forbjudet = /localStorage|sessionStorage|indexedDB|graph\.microsoft\.com|\bfetch\s*\(|XMLHttpRequest|node:fs|readFileSync|writeFileSync/;
  for (const fil of filer) {
    const rel = fil.slice(repoRot.length).replaceAll('\\', '/');
    assert.ok(!forbjudet.test(utanKommentarer(readFileSync(fil, 'utf8'))), `${rel} får inte känna till något lagringslager`);
  }
});

test('krav 7: inga verkliga datafiler används i testerna', () => {
  const filer = [
    ...samlaKallfiler(join(repoRot, 'test')),
    ...samlaKallfiler(join(repoRot, 'src')),
  ];
  // Enda tillåtna datafilen är den syntetiska fixturen. Mönstret letar efter
  // SÖKVÄGAR och FILNAMN, inte efter produktnamn — "OneDrive" i en testrubrik är
  // prosa, medan "me/drive/root" är en verklig adress. Delarna sätts ihop så att
  // den här filen inte flaggar sig själv.
  const misstankt = new RegExp([
    'invisiontid' + '-data',
    'me/drive' + '/root',
    'IN ' + 'VISION',
    'Produkter/' + 'InVisionTid',
  ].join('|'));
  for (const fil of filer) {
    const rel = fil.slice(repoRot.length).replaceAll('\\', '/');
    const text = utanKommentarer(readFileSync(fil, 'utf8'));
    assert.ok(!misstankt.test(text), `${rel} refererar till en verklig datafil`);
  }
});

test('krav 8: index.html och test.html är oberörda av den nya koden', () => {
  const filer = samlaKallfiler(join(repoRot, 'src'));
  for (const fil of filer) {
    assert.ok(!utanKommentarer(readFileSync(fil, 'utf8')).includes('index.html'), `${fil} refererar till index.html`);
  }
});
