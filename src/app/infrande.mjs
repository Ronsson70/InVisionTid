// Införandet: från v1-filen till en ny v2-fil, i sju låsta steg.
//
// v1-filen är LÄSBAR under hela förloppet och ändras aldrig. Skrivspärren i
// lagring.mjs gör det tekniskt omöjligt, inte bara osannolikt.
//
// Ordningen är inte förhandlingsbar:
//
//   1. läs v1 som råtext och räkna checksumma
//   2. visa exakt vad som finns och vad som skulle föras över
//   3. vänta på den ordagranna bekräftelsen
//   4. skriv en byte-identisk backup av v1
//   5. läs tillbaka backupen och verifiera checksumma och bytelängd
//   6. skapa v2-filen
//   7. läs tillbaka v2 och verifiera
//
// Misslyckas något steg avbryts hela införandet. v1 är då fortfarande orörd,
// eftersom ingenting någonsin skrivits till den.

import { analysera, nystart } from '../domain/nystart.mjs';
import { V1_SOKVAG, V2_SOKVAG, backupSokvag, sha256, bytesFor } from '../integrations/onedrive/lagring.mjs';

export const BEKRAFTELSE = 'JA, SKRIV';

export class InfrandeAvbrutet extends Error {
  constructor(steg, orsak) {
    super(`Införandet avbröts i steget "${steg}": ${orsak} `
      + 'Den gamla filen är oförändrad — ingenting har någonsin skrivits till den.');
    this.name = 'InfrandeAvbrutet';
    this.steg = steg;
  }
}

/**
 * Steg 1–2. Läser v1 och visar vad som finns. Skriver ingenting.
 * @returns {object} kontrolluppgifter och en sammanfattning av nystarten
 */
export async function forbered(lagring, { nu }) {
  const v2Finns = await lagring.metadata(V2_SOKVAG);
  if (v2Finns) {
    throw new InfrandeAvbrutet('kontroll',
      'Det finns redan en v2-fil. Införandet görs bara en gång.');
  }

  const v1 = await lagring.las(V1_SOKVAG);
  if (!v1) {
    throw new InfrandeAvbrutet('läsning',
      `Hittade ingen fil på ${V1_SOKVAG}.`);
  }

  let indata;
  try {
    indata = JSON.parse(v1.text);
  } catch (e) {
    throw new InfrandeAvbrutet('läsning', 'Filen är inte giltig JSON: ' + e.message);
  }

  const analys = analysera(indata, { nu });

  return {
    nu,
    // Kontrolluppgifter om källan. Inga kundnamn, inga belopp.
    kalla: {
      sokvag: V1_SOKVAG,
      driveItemId: v1.id,
      andrad: v1.andrad,
      lastSync: analys.lastSync,
      byteLangd: v1.byteLangd,
      // Graphs egen storleksuppgift, för att kunna jämföra äpplen med äpplen
      // när filen kontrolleras efteråt.
      graphByte: v1.byte,
      checksumma: v1.checksumma,
      eTag: v1.eTag,
      antal: {
        kunder: analys.kalla.clients,
        uppdrag: analys.kalla.projects,
        tidsposter: analys.kalla.entries,
        resor: analys.kalla.trips,
        utlagg: analys.kalla.expenses,
        fakturamarkeringar: analys.kalla.invoices,
      },
    },
    analys,
    ravara: v1.text,
    indata,
    bekraftat: false,
  };
}

/**
 * Steg 3–7. Kräver den ordagranna bekräftelsen.
 * Skriver backup först, verifierar den, och skapar sedan v2.
 */
export async function genomfor(forberedelse, lagring, { bekraftelse, nu }) {
  if (bekraftelse !== BEKRAFTELSE) {
    throw new InfrandeAvbrutet('bekräftelse',
      `Skriv exakt "${BEKRAFTELSE}" för att genomföra införandet.`);
  }

  // ── Steg 4: backup av v1, byte för byte ──────────────────────────────────
  const backupVag = backupSokvag('v1', nu);
  try {
    await lagring.skriv(backupVag, forberedelse.ravara);
  } catch (e) {
    throw new InfrandeAvbrutet('backup', 'Backupen kunde inte skrivas: ' + e.message);
  }

  // ── Steg 5: läs tillbaka och verifiera ───────────────────────────────────
  const kontroll = await lagring.las(backupVag);
  if (!kontroll) throw new InfrandeAvbrutet('backup', 'Backupen gick inte att läsa tillbaka.');
  if (kontroll.checksumma !== forberedelse.kalla.checksumma) {
    throw new InfrandeAvbrutet('backup',
      `Backupens checksumma stämmer inte. Väntade ${forberedelse.kalla.checksumma}, fick ${kontroll.checksumma}.`);
  }
  if (kontroll.byteLangd !== forberedelse.kalla.byteLangd) {
    throw new InfrandeAvbrutet('backup',
      `Backupens bytelängd stämmer inte. Väntade ${forberedelse.kalla.byteLangd}, fick ${kontroll.byteLangd}.`);
  }

  // ── Steg 6: skapa v2 ─────────────────────────────────────────────────────
  const v2 = nystart(forberedelse.indata, { nu });
  const text = JSON.stringify(v2, null, 2);
  const forvantad = await sha256(text);
  await lagring.skriv(V2_SOKVAG, text);

  // ── Steg 7: läs tillbaka och verifiera ───────────────────────────────────
  const tillbaka = await lagring.las(V2_SOKVAG);
  if (!tillbaka) throw new InfrandeAvbrutet('kontroll', 'v2-filen gick inte att läsa tillbaka.');
  if (tillbaka.checksumma !== forvantad) {
    throw new InfrandeAvbrutet('kontroll',
      'v2-filen på servern stämmer inte med det som skulle sparas.');
  }

  // ── v1 ska vara exakt som förut ──────────────────────────────────────────
  const v1Efter = await lagring.metadata(V1_SOKVAG);
  const v1Oforandrad = !!v1Efter
    && v1Efter.byte === forberedelse.kalla.graphByte
    && v1Efter.andrad === forberedelse.kalla.andrad;

  return {
    klart: true,
    backup: {
      sokvag: backupVag,
      checksumma: kontroll.checksumma,
      byteLangd: kontroll.byteLangd,
      identiskMedV1: true,
    },
    v2: {
      sokvag: V2_SOKVAG,
      checksumma: tillbaka.checksumma,
      byteLangd: tillbaka.byteLangd,
      eTag: tillbaka.eTag,
      id: tillbaka.id,
    },
    v1Oforandrad,
    v1Efter: v1Efter && { byte: v1Efter.byte, andrad: v1Efter.andrad },
    data: v2,
    text,
  };
}

/** Backupen som en nedladdningsbar fil, så en kopia finns utanför OneDrive. */
export function backupFilnamn(nu) {
  return backupSokvag('v1', nu).split('/').pop();
}

export { V1_SOKVAG, V2_SOKVAG, bytesFor };
