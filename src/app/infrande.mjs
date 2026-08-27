// Införandet: från v1-filen till en ny v2-fil.
//
// v1-filen är LÄSBAR under hela förloppet och ändras aldrig. Skrivspärren i
// lagring.mjs gör det tekniskt omöjligt, inte bara osannolikt.
//
// Ordningen är inte förhandlingsbar, och den är ändrad efter det första
// misslyckade försöket:
//
//   FÖRE BEKRÄFTELSEN — ingenting skrivs, någonsin
//     1. läs v1 som råtext och räkna checksumma
//     2. validera strukturen: varje samling vid namn
//     3. migrera i minnet och kontrollera hela resultatet
//     4. visa sammanfattningen
//
//   EFTER BEKRÄFTELSEN
//     5. kräv JA, SKRIV ordagrant
//     6. skriv en backup av v1 och verifiera den
//     7. skriv v2-filen
//     8. läs tillbaka v2 och verifiera
//
// Första försöket hade steg 6 före migreringen. Migreringen lyckades, men
// resultatet gick inte att visa i appen — och då låg backupen och v2-filen
// redan i OneDrive. Nu sker allt som kan misslyckas innan något skrivs.

import { analysera, nystart } from '../domain/nystart.mjs';
import { valideraV1, kontrolleraForeSkrivning, OgiltigStruktur } from './tillstand.mjs';
import {
  V1_SOKVAG, V2_SOKVAG, backupSokvag, ledigBackupSokvag, sha256, bytesFor,
} from '../integrations/onedrive/lagring.mjs';

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
 * Jämför vad analysen lovade med vad migreringen faktiskt valde ut.
 *
 * Analysen och nystarten räknar samma sak på två olika sätt. Går de isär har
 * någon ändrat den ena utan den andra, och då ska införandet stanna i stället
 * för att skriva en fil ingen kan förklara.
 *
 * @returns {string[]} avvikelser i klartext, tom lista när allt stämmer
 */
export function jamforUrval(analys, antal) {
  const avvikelser = [];
  const kolla = (vad, valtUt, oppna) => {
    if (valtUt !== oppna) avvikelser.push(`${vad}: ${valtUt} valdes ut, ${oppna} var öppna`);
  };
  kolla('tidsposter', antal.tidsposter, analys.forsOver.oppnaPoster);
  kolla('resor', antal.resor, analys.forsOver.oppnaResor);
  return avvikelser;
}

/**
 * Steg 1–4. Läser, validerar, migrerar och kontrollerar — allt i minnet.
 * Skriver ingenting, oavsett vad som händer.
 *
 * @returns {object} kontrolluppgifter, sammanfattning och ett färdigt v2-resultat
 */
export async function forbered(lagring, { nu }) {
  // ── Steg 1: läs v1 ───────────────────────────────────────────────────────
  const v1 = await lagring.las(V1_SOKVAG);
  if (!v1) {
    throw new InfrandeAvbrutet('läsning', `Hittade ingen fil på ${V1_SOKVAG}.`);
  }

  let ravaraObjekt;
  try {
    ravaraObjekt = JSON.parse(v1.text);
  } catch (e) {
    throw new InfrandeAvbrutet('läsning', 'Filen är inte giltig JSON: ' + e.message);
  }

  // ── Steg 2: validera strukturen ──────────────────────────────────────────
  let indata, saknadeIV1;
  try {
    ({ data: indata, saknadeValfria: saknadeIV1 } = valideraV1(ravaraObjekt));
  } catch (e) {
    if (e instanceof OgiltigStruktur) throw new InfrandeAvbrutet('validering', e.message);
    throw e;
  }

  const analys = analysera(indata, { nu });

  // ── Steg 3: migrera i minnet och kontrollera hela resultatet ─────────────
  let v2, kontroll;
  try {
    v2 = nystart(indata, { nu });
    kontroll = kontrolleraForeSkrivning(v2);
  } catch (e) {
    throw new InfrandeAvbrutet('migrering',
      'Den gamla filen gick att läsa, men resultatet gick inte att använda: ' + e.message);
  }

  // Det migreringen valde ut måste stämma med det analysen lovade.
  const avvikelser = jamforUrval(analys, kontroll.antal);
  if (avvikelser.length) {
    throw new InfrandeAvbrutet('kontroll',
      'Urvalet stämmer inte med analysen — ' + avvikelser.join('; ') + '.');
  }

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
      saknadeSamlingar: saknadeIV1,
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
    // Färdigt och kontrollerat. Skrivs först efter bekräftelsen.
    v2,
    tillstand: kontroll.tillstand,
    valtUt: kontroll.antal,
    ravara: v1.text,
    indata,
    bekraftat: false,
  };
}

/**
 * Steg 5–8. Kräver den ordagranna bekräftelsen.
 *
 * Allt som kunde misslyckas har redan gjort det i forbered(). Här återstår
 * bara skrivningarna, och backupen skrivs före v2.
 */
export async function genomfor(forberedelse, lagring, { bekraftelse, nu }) {
  // ── Steg 5: bekräftelsen ─────────────────────────────────────────────────
  if (bekraftelse !== BEKRAFTELSE) {
    throw new InfrandeAvbrutet('bekräftelse',
      `Skriv exakt "${BEKRAFTELSE}" för att genomföra införandet.`);
  }
  if (!forberedelse?.v2 || !forberedelse?.ravara) {
    throw new InfrandeAvbrutet('kontroll',
      'Förberedelsen är ofullständig. Ladda om sidan och börja om.');
  }

  // v2-filen får inte finnas. Kontrollen görs så sent som möjligt, så att ett
  // annat försök i en annan flik inte hinner emellan.
  if (await lagring.metadata(V2_SOKVAG)) {
    throw new InfrandeAvbrutet('kontroll',
      `Det finns redan en fil på ${V2_SOKVAG}. Införandet görs bara en gång, `
      + 'och en befintlig fil skrivs aldrig över.');
  }

  // ── Steg 6: backup av v1, byte för byte ──────────────────────────────────
  //
  // Namnet väljs så att en backup från ett tidigare försök aldrig skrivs över.
  const backupVag = await ledigBackupSokvag(lagring, 'v1', nu);
  try {
    await lagring.skriv(backupVag, forberedelse.ravara);
  } catch (e) {
    throw new InfrandeAvbrutet('backup', 'Backupen kunde inte skrivas: ' + e.message);
  }

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

  // ── Steg 7: skriv v2 ─────────────────────────────────────────────────────
  const text = JSON.stringify(forberedelse.v2, null, 2);
  const forvantad = await sha256(text);
  await lagring.skriv(V2_SOKVAG, text);

  // ── Steg 8: läs tillbaka och verifiera ───────────────────────────────────
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
    data: forberedelse.v2,
    tillstand: forberedelse.tillstand,
    text,
  };
}

/** Backupen som en nedladdningsbar fil, så en kopia finns utanför OneDrive. */
export function backupFilnamn(nu) {
  return backupSokvag('v1', nu).split('/').pop();
}

export { V1_SOKVAG, V2_SOKVAG, bytesFor };
