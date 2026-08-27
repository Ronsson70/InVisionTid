// Skrivskyddad förhandsgranskning mot verklig data.
//
//   node verktyg/forhandsgranska-produktion.mjs [sökväg]
//
// Utan argument söks kandidater i de OneDrive-rötter miljön anger
// (OneDrive, OneDriveCommercial, OneDriveConsumer). Ingen sökväg är hårdkodad,
// så filen kan versionshanteras utan att röja var någons data ligger.
//
// Skriptet KAN INTE skriva. Det använder en läsare utan skrivfunktion, och
// rapporten byggs av en tillåtelselista som bara släpper igenom antal,
// tidsstämplar och enum-värden. Kundnamn, beskrivningar, belopp och rå JSON
// har ingen väg ut.
//
// Skriptet migrerar aldrig. Det finns ingen godkännandeväg här.

import { existsSync } from 'node:fs';
import { skapaFillasare, hittaKandidater, faststallAktivFil, OtydligKalla }
  from '../src/integrations/lokal/synkadfil.mjs';
import { forhandsgranskaMigrering } from '../src/data/forhandsgranskning.mjs';
import { saneradRapport, rapportText } from '../src/data/rapport.mjs';
import { checksumma, bytesFor } from '../src/data/backup.mjs';

const NU = new Date().toISOString();

function rotterUrMiljon() {
  return [process.env.OneDriveCommercial, process.env.OneDrive, process.env.OneDriveConsumer]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(existsSync);
}

let sokvag;
try {
  const angiven = process.argv[2];
  sokvag = angiven
    ? faststallAktivFil([angiven].filter(existsSync))
    : faststallAktivFil(hittaKandidater(rotterUrMiljon()));
} catch (e) {
  if (e instanceof OtydligKalla) {
    console.error('\nAvbryter utan att läsa någon fil.');
    console.error('  ' + e.message);
    console.error('\nAnge sökvägen uttryckligen om den ligger utanför en OneDrive-rot:');
    console.error('  node verktyg/forhandsgranska-produktion.mjs "<sökväg>"\n');
    process.exit(2);
  }
  throw e;
}

// ── Läs, granska, läs igen ──────────────────────────────────────────────────

const lasare = skapaFillasare(sokvag);
if (typeof lasare.skriv === 'function') {
  console.error('Läsaren har en skrivfunktion. Avbryter.');
  process.exit(3);
}

const metaFore = lasare.metadata();
const ravaraFore = lasare.las();
const summaFore = await checksumma(ravaraFore);

const forhandsgranskning = forhandsgranskaMigrering(ravaraFore, { nu: NU });

// Läs källan igen och bevisa att den är oförändrad.
const ravaraEfter = lasare.las();
const summaEfter = await checksumma(ravaraEfter);

// lastSync är en tidsstämpel, inte innehåll. Läses ut separat och skickas in
// via tillåtelselistan i stället för att plockas ur förhandsgranskningen.
let lastSync = null;
try { lastSync = JSON.parse(ravaraFore)?.lastSync ?? null; } catch { /* rapporteras som saknas */ }

const rapport = saneradRapport(forhandsgranskning, {
  sokvag,
  byte: bytesFor(ravaraFore).length,
  andrad: metaFore.andrad,
  lastSync,
  checksummaFore: summaFore,
  checksummaEfter: summaEfter,
  via: 'OneDrive-synkad kopia på disk, läst med node:fs. Inget Graph-anrop gjordes.',
});

console.log('');
console.log(rapportText(rapport));
console.log('');
console.log('  Ingen fil har skrivits, ingen backup har skapats, ingen migrering har genomförts.');
console.log('  Rapporten ovan innehåller inga kundnamn, beskrivningar eller belopp.');
console.log('');

if (!rapport.kalla.oforandrad) {
  console.error('  VARNING: källans checksumma skiljer sig före och efter. Utred innan något annat sker.');
  process.exit(4);
}
if (!rapport.giltig) process.exit(5);
