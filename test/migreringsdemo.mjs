// Visar hela migreringsflödet mot den SYNTETISKA fixturen, i minnet.
//
//   node test/migreringsdemo.mjs
//
// Ingen verklig datafil läses. Ingen fil skrivs. "Källan" är ett objekt i minnet.
// Skriptet finns för att flödet ska gå att se, inte bara läsa om.

import { readFileSync } from 'node:fs';
import {
  forberedMigrering, genomforMigrering, aterstallMigrering, godkannande,
  checksumma, kallanArOforandrad,
} from '../src/data/index.mjs';
import { skapaMinneskalla } from './lib/minneskalla.mjs';

const NU = '2026-08-27T10:00:00.000Z';
const ravara = readFileSync(new URL('../test-fixtures/v1-legacy.json', import.meta.url), 'utf8');
const kalla = skapaMinneskalla(ravara);

const rubrik = t => console.log(`\n${t}\n${'═'.repeat(64)}`);

// ── 1. Förbered: läs, backa upp i minnet, förhandsgranska ───────────────────
rubrik('1. Förbered — läser och förhandsgranskar, sparar ingenting');
const forberedelse = await forberedMigrering({ las: kalla.las, kalla: 'syntetisk fixtur i minnet', nu: NU });
console.log(forberedelse.sammanfattning);
console.log(`\n  Backup skapad: ${forberedelse.backup.filnamn}`);
console.log(`  ${forberedelse.backup.byteLangd} byte, ${forberedelse.backup.checksumma.slice(0, 23)}…`);
console.log(`  Skrivningar till källan hittills: ${kalla.antalSkrivningar}`);

// ── 2. Vad som kräver granskning ────────────────────────────────────────────
rubrik('2. Kräver ett mänskligt beslut innan fakturering');
for (const a of forberedelse.forhandsgranskning.ogranskadMoms) {
  console.log(`  moms saknas   ${a.namn.padEnd(28)} ${a.projectId}`);
}
for (const p of forberedelse.forhandsgranskning.bevaradeFastprisperioder) {
  console.log(`  fastpris      ${p.projektnamn.padEnd(28)} ${p.beloppText}  bevarad, ej omvandlad`);
}
for (const r of forberedelse.forhandsgranskning.fakturareferenser) {
  console.log(`  fakturaref    ${(r.period + ' ' + r.id).padEnd(28)} fakturanummer: ${r.invoiceNumber ?? 'saknas'}`);
}

// ── 3. Utan godkännande händer ingenting ────────────────────────────────────
rubrik('3. Försök att genomföra utan godkännande');
const foreForsok = kalla.innehall;
try {
  await genomforMigrering(forberedelse, { sparaBackup: kalla.sparaBackup, skriv: kalla.skriv, godkant: null });
  console.log('  FEL: migreringen gick igenom utan godkännande');
} catch (e) {
  console.log(`  Avbruten i steget "${e.steg}": ${e.message}`);
  console.log(`  Skrivningar: ${kalla.antalSkrivningar}. Källan oförändrad: ${kallanArOforandrad(kalla.innehall, foreForsok)}`);
}

// ── 4. Genomför med uttryckligt godkännande ─────────────────────────────────
rubrik('4. Genomför med uttryckligt godkännande');
const originalSumma = await checksumma(ravara);
const klar = await genomforMigrering(forberedelse, {
  sparaBackup: kalla.sparaBackup,
  skriv: kalla.skriv,
  godkant: godkannande({ av: 'demo', at: NU, bekraftelse: 'JA, SKRIV' }),
});
console.log(`  Backup sparad först: ${kalla.backuper.length} st`);
console.log(`  Skrivningar till källan: ${kalla.antalSkrivningar}`);
console.log(`  Ny schemaVersion: ${JSON.parse(kalla.innehall).schemaVersion}`);
console.log(`  Godkännandet stämplat: ${JSON.parse(kalla.innehall).settings.migrationConfirmedAt}`);
console.log(`  Källans checksumma nu: ${(await checksumma(kalla.innehall)).slice(0, 23)}…`);
console.log(`  Original:              ${originalSumma.slice(0, 23)}…`);

// ── 5. Återställ ────────────────────────────────────────────────────────────
rubrik('5. Återställ från backupen');
await aterstallMigrering({
  backup: kalla.backuper[0],
  skriv: kalla.skriv,
  godkant: godkannande({ av: 'demo', at: NU, bekraftelse: 'JA, SKRIV' }),
});
const efterAterstallning = await checksumma(kalla.innehall);
console.log(`  Checksumma efter återställning: ${efterAterstallning.slice(0, 23)}…`);
console.log(`  Identisk med originalet:        ${efterAterstallning === originalSumma}`);
console.log(`  Byte för byte:                  ${kallanArOforandrad(kalla.innehall, ravara)}`);
console.log(`\n  Ingen verklig fil har lästs eller skrivits. Allt skedde i minnet.\n`);

void klar;
