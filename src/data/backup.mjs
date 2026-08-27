// Backup av rådata, byte för byte.
//
// Backupen sparar RÅTEXTEN, inte ett tolkat objekt. Skälet är att JSON.parse följt
// av JSON.stringify inte ger tillbaka samma byte: nyckelordning, blanksteg,
// talformat och Unicode-escaper kan alla ändras. En backup som återställer
// "samma data" men inte samma byte är inte en backup, det är en tolkning.
//
// Modulen skriver ingenting någonstans. Den tar emot text och returnerar text.
// Var backupen hamnar bestämmer anroparen.

/** Backupformatets version. Ändras bara om strukturen nedan ändras. */
export const BACKUP_VERSION = 1;

const kodare = new TextEncoder();

/** UTF-8-byte för en sträng. Textens längd i tecken räcker inte — å, ä och ö är två byte. */
export function bytesFor(text) {
  return kodare.encode(text);
}

/** SHA-256 som hexsträng. Finns både i Node 18+ och i webbläsaren. */
export async function checksumma(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytesFor(text));
  return 'sha256:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Filnamn för en backup. Svenska tecken bevaras, inga understreck, och inga
 * kolon eftersom Windows inte tillåter dem i filnamn.
 */
export function backupFilnamn(nu, { prefix = 'invisiontid-backup' } = {}) {
  const stampel = String(nu).replace(/:/g, '-').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
  return `${prefix}-${stampel}.json`;
}

/**
 * Skapar en backup av rådata.
 *
 * @param {string} ravara  filens innehåll som text, exakt som den lästes
 * @param {object} opts
 * @param {string} opts.nu      ISO-tidsstämpel, skickas in så funktionen förblir ren
 * @param {string} opts.kalla   var rådata kom ifrån, för spårbarhet
 * @param {string} [opts.etikett]
 */
export async function skapaBackup(ravara, { nu, kalla, etikett = null } = {}) {
  if (typeof ravara !== 'string') {
    throw new TypeError(
      'Backupen måste få rådata som text. Ett tolkat objekt kan inte bevaras byte för byte.'
    );
  }
  if (!nu) throw new Error('Backupen kräver en tidsstämpel.');
  if (!kalla) throw new Error('Backupen kräver en källa, så det går att se vad den är en backup av.');

  const bytes = bytesFor(ravara);
  return {
    backupVersion: BACKUP_VERSION,
    skapad: nu,
    kalla,
    etikett,
    filnamn: backupFilnamn(nu),
    byteLangd: bytes.length,
    teckenLangd: ravara.length,
    checksumma: await checksumma(ravara),
    ravara,                     // orörd text
  };
}

/**
 * Kontrollerar att backupen är intakt.
 * @returns {{giltig:boolean, fel:string[], checksumma:string, byteLangd:number}}
 */
export async function verifieraBackup(backup) {
  const fel = [];
  if (!backup || typeof backup !== 'object') {
    return { giltig: false, fel: ['Backupen saknas eller är inte ett objekt.'], checksumma: null, byteLangd: 0 };
  }
  if (backup.backupVersion !== BACKUP_VERSION) {
    fel.push(`Okänd backupversion ${backup.backupVersion}, förväntade ${BACKUP_VERSION}.`);
  }
  if (typeof backup.ravara !== 'string') {
    fel.push('Backupen innehåller ingen rådata som text.');
    return { giltig: false, fel, checksumma: null, byteLangd: 0 };
  }

  const bytes = bytesFor(backup.ravara);
  const summa = await checksumma(backup.ravara);

  if (summa !== backup.checksumma) {
    fel.push(`Checksumman stämmer inte. Sparad ${backup.checksumma}, beräknad ${summa}.`);
  }
  if (bytes.length !== backup.byteLangd) {
    fel.push(`Bytelängden stämmer inte. Sparad ${backup.byteLangd}, beräknad ${bytes.length}.`);
  }

  return { giltig: fel.length === 0, fel, checksumma: summa, byteLangd: bytes.length };
}

/**
 * Hämtar rådata ur en backup. Verifierar först och vägrar leverera trasig data.
 * @returns {Promise<string>} exakt samma text som backades upp
 */
export async function aterstallFranBackup(backup) {
  const kontroll = await verifieraBackup(backup);
  if (!kontroll.giltig) {
    throw new Error('Backupen är inte intakt och kan inte återställas: ' + kontroll.fel.join(' '));
  }
  return backup.ravara;
}

/**
 * Jämför två textinnehåll byte för byte.
 * Används för att bevisa att en källa är oförändrad efter ett avbrott.
 */
export function likaByteForByte(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = bytesFor(a);
  const bb = bytesFor(b);
  if (ba.length !== bb.length) return false;
  for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return false;
  return true;
}
