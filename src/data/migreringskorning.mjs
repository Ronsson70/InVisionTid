// Migreringskörning: förbered, granska, godkänn, genomför, återställ.
//
// Modulen känner inte till OneDrive, localStorage eller filsystemet. Läsning och
// skrivning skickas in som funktioner. Det är därför den kan testas fullständigt
// mot syntetiska fixtures, och det är därför en bugg här inte kan nå
// produktionsdata av misstag.
//
// Ordningen är inte förhandlingsbar:
//
//   1. läs rådata som text
//   2. skriv backup av RÅDATA, orörd
//   3. verifiera backupen
//   4. migrera i minnet
//   5. kontrollsummor
//   6. visa och vänta på uttryckligt godkännande
//   7. först då skriv
//
// Varje steg som misslyckas avbryter innan skrivningen. Källan lämnas orörd.

import { skapaBackup, verifieraBackup, aterstallFranBackup, likaByteForByte } from './backup.mjs';
import { forhandsgranskaMigrering, sammanfattning } from './forhandsgranskning.mjs';

export class MigreringAvbruten extends Error {
  constructor(orsak, steg) {
    super(orsak);
    this.name = 'MigreringAvbruten';
    this.steg = steg;
  }
}

/**
 * Steg 1–5. Läser, backar upp i minnet och förhandsgranskar.
 * Skriver ingenting. Går alltid att köra utan risk.
 *
 * @param {object} opts
 * @param {() => Promise<string>|string} opts.las  returnerar rådata som TEXT
 * @param {string} opts.kalla                      vad som lästes, för spårbarhet
 * @param {string} opts.nu                         ISO-tidsstämpel
 */
export async function forberedMigrering({ las, kalla, nu }) {
  if (typeof las !== 'function') throw new TypeError('forberedMigrering kräver en läsfunktion.');
  if (!kalla) throw new Error('forberedMigrering kräver en källa.');
  if (!nu) throw new Error('forberedMigrering kräver en tidsstämpel.');

  const ravara = await las();
  if (typeof ravara !== 'string') {
    throw new TypeError(
      'Läsfunktionen måste returnera TEXT, inte ett tolkat objekt. '
      + 'Backupen kan bara bevara byte om den får byte.'
    );
  }

  const backup = await skapaBackup(ravara, { nu, kalla, etikett: 'före migrering till schemaVersion 2' });
  const kontroll = await verifieraBackup(backup);
  if (!kontroll.giltig) {
    throw new MigreringAvbruten('Backupen kunde inte verifieras: ' + kontroll.fel.join(' '), 'backup');
  }

  const forhandsgranskning = forhandsgranskaMigrering(ravara, { nu });

  return {
    kalla,
    nu,
    ravara,
    backup,
    forhandsgranskning,
    kanGenomforas: forhandsgranskning.giltig,
    sammanfattning: sammanfattning(forhandsgranskning),
    skrivet: false,
  };
}

/** Godkännandet måste vara uttryckligt och bära vem som godkände och när. */
export function godkannande({ av, at, bekraftelse }) {
  if (!av) throw new Error('Godkännandet måste bära vem som godkände.');
  if (!at) throw new Error('Godkännandet måste bära när det gavs.');
  if (bekraftelse !== 'JA, SKRIV') {
    throw new Error(
      'Godkännandet kräver den ordagranna bekräftelsen "JA, SKRIV". '
      + 'Det ska inte gå att råka godkänna en migrering.'
    );
  }
  return { av, at, bekraftelse };
}

/**
 * Steg 6–7. Skriver backupen och därefter det migrerade resultatet.
 *
 * Skrivfunktionerna skickas in. Utan dem händer ingenting.
 *
 * @param {object} forberedelse   resultatet från forberedMigrering
 * @param {object} opts
 * @param {(backup:object) => Promise<void>} opts.sparaBackup
 * @param {(text:string) => Promise<void>} opts.skriv   tar emot färdig JSON-TEXT
 * @param {object} opts.godkant   objektet från godkannande()
 */
export async function genomforMigrering(forberedelse, { sparaBackup, skriv, godkant }) {
  if (!forberedelse || forberedelse.skrivet) {
    throw new MigreringAvbruten('Förberedelsen saknas eller är redan genomförd.', 'forberedelse');
  }
  if (!godkant || godkant.bekraftelse !== 'JA, SKRIV') {
    throw new MigreringAvbruten(
      'Migreringen kräver ett uttryckligt godkännande. Ingenting har skrivits.', 'godkannande'
    );
  }
  if (!forberedelse.kanGenomforas) {
    throw new MigreringAvbruten(
      'Förhandsgranskningen är underkänd: ' + forberedelse.forhandsgranskning.fel.join(' ')
      + ' Ingenting har skrivits.', 'forhandsgranskning'
    );
  }
  if (typeof sparaBackup !== 'function' || typeof skriv !== 'function') {
    throw new MigreringAvbruten(
      'Både sparaBackup och skriv måste anges. En migrering utan backup genomförs inte.', 'skrivfunktioner'
    );
  }

  // Backupen först. Misslyckas den skrivs ingenting annat.
  try {
    await sparaBackup(forberedelse.backup);
  } catch (e) {
    throw new MigreringAvbruten(
      'Backupen kunde inte sparas: ' + e.message + ' Migreringen avbryts, källan är orörd.', 'backup'
    );
  }

  const resultat = {
    ...forberedelse.forhandsgranskning.resultat,
    settings: {
      ...forberedelse.forhandsgranskning.resultat.settings,
      migrationConfirmedAt: godkant.at,
    },
  };
  const text = JSON.stringify(resultat, null, 2);

  await skriv(text);

  return {
    ...forberedelse,
    skrivet: true,
    godkant,
    skriventText: text,
    backupFilnamn: forberedelse.backup.filnamn,
  };
}

/**
 * Återställning. Verifierar backupen och skriver tillbaka rådata byte för byte.
 * Kräver samma uttryckliga godkännande som en migrering.
 */
export async function aterstallMigrering({ backup, skriv, godkant }) {
  if (!godkant || godkant.bekraftelse !== 'JA, SKRIV') {
    throw new MigreringAvbruten(
      'Återställningen kräver ett uttryckligt godkännande. Ingenting har skrivits.', 'godkannande'
    );
  }
  if (typeof skriv !== 'function') {
    throw new MigreringAvbruten('Återställningen kräver en skrivfunktion.', 'skrivfunktioner');
  }

  const ravara = await aterstallFranBackup(backup);   // kastar om backupen är trasig
  await skriv(ravara);

  return { aterstallt: true, byteLangd: backup.byteLangd, checksumma: backup.checksumma, at: godkant.at };
}

/**
 * Bevisar att en källa är oförändrad. Används efter ett avbrott.
 * @returns {boolean}
 */
export function kallanArOforandrad(fore, efter) {
  return likaByteForByte(fore, efter);
}
