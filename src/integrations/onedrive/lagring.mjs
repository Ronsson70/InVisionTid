// OneDrive-lagring för v2, med teknisk sökvägsspärr.
//
// Den viktigaste raden i hela filen är tillåtelselistan nedan. v1-filen är
// LÄSBAR men aldrig skrivbar. Ett skrivförsök mot den stoppas innan något
// nätverksanrop skickas — inte av en kontroll någon ska komma ihåg att göra,
// utan av en spärr all skrivning måste passera.

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Filen v1 använder. Får läsas. Får ALDRIG skrivas, flyttas eller döpas om. */
export const V1_SOKVAG = 'InVisionTid/invisiontid-data.json';

/** Filen v2 äger. Enda skrivbara datafilen. */
export const V2_SOKVAG = 'InVisionTid/invisiontid-data-v2.json';

/** Backupmappen. Skrivbar, men bara för backupfiler. */
export const BACKUP_MAPP = 'InVisionTid';

export const LASBARA = Object.freeze([V1_SOKVAG, V2_SOKVAG]);

/** Sökvägar som får skrivas. v1 finns medvetet INTE med. */
export const SKRIVBARA = Object.freeze([V2_SOKVAG]);

// Backupfiler får skapas, men bara med det här mönstret. Suffixet -2, -3 ...
// finns för att TVÅ försök samma sekund inte ska skriva över varandra: en
// backup från ett misslyckat försök är ofta den enda kopian som finns.
const BACKUP_MONSTER = /^InVisionTid\/invisiontid-data-v[12]-backup-\d{8}-\d{6}(-\d+)?\.json$/;

export class SkrivvagAvvisad extends Error {
  constructor(sokvag) {
    super(
      `Skrivning mot "${sokvag}" är avvisad. v2 får bara skriva till `
      + `"${V2_SOKVAG}" eller en backupfil. Ingen nätverksbegäran har gjorts.`
    );
    this.name = 'SkrivvagAvvisad';
    this.sokvag = sokvag;
  }
}

export class Synkkonflikt extends Error {
  constructor() {
    super('Data har ändrats i en annan flik eller enhet. Ladda om innan du sparar.');
    this.name = 'Synkkonflikt';
  }
}

/** Sant när sökvägen får läsas. */
export const farLasas = sokvag => LASBARA.includes(sokvag) || BACKUP_MONSTER.test(sokvag);

/** Sant när sökvägen får skrivas. */
export const farSkrivas = sokvag => SKRIVBARA.includes(sokvag) || BACKUP_MONSTER.test(sokvag);

/**
 * Spärren. Anropas FÖRE varje skrivande nätverksbegäran och kastar på allt
 * som inte uttryckligen är tillåtet.
 */
export function kontrolleraSkrivvag(sokvag) {
  if (!farSkrivas(sokvag)) throw new SkrivvagAvvisad(sokvag);
  return sokvag;
}

/** Backupfilnamn med tidsstämpel: invisiontid-data-v1-backup-20260827-143000.json */
export function backupSokvag(version, nu, ordning = 1) {
  const d = new Date(nu);
  const p = n => String(n).padStart(2, '0');
  const stampel = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const suffix = ordning > 1 ? `-${ordning}` : '';
  return `${BACKUP_MAPP}/invisiontid-data-${version}-backup-${stampel}${suffix}.json`;
}

/**
 * Ett backupnamn som inte redan är upptaget.
 *
 * En befintlig backup skrivs ALDRIG över. Efter ett avbrutet införande kan den
 * vara den enda kopian av den gamla filen som finns.
 *
 * @param {object} lagring  något med metadata(sokvag)
 * @returns {Promise<string>}
 */
export async function ledigBackupSokvag(lagring, version, nu, maxForsok = 50) {
  for (let ordning = 1; ordning <= maxForsok; ordning++) {
    const sokvag = backupSokvag(version, nu, ordning);
    if (!(await lagring.metadata(sokvag))) return sokvag;
  }
  throw new Error(
    `Hittade inget ledigt backupnamn för ${version} vid ${nu}. `
    + 'Ingen befintlig backup har rörts.');
}

// ── Hjälpare ────────────────────────────────────────────────────────────────

const kodare = new TextEncoder();
export const bytesFor = text => kodare.encode(text);

export async function sha256(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytesFor(text));
  return 'sha256:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const metaUrl = sokvag => `${GRAPH}/me/drive/root:/${sokvag}`;
const innehallUrl = sokvag => `${GRAPH}/me/drive/root:/${sokvag}:/content`;

function saneraFel(text, token) {
  let ut = String(text ?? '');
  if (token && token.length >= 8) ut = ut.split(token).join('[dolt]');
  return ut.replace(/Bearer\s+[\w.\-~+/]+=*/gi, 'Bearer [dolt]');
}

/**
 * Skapar en lagring bunden till ett token.
 * @param {object} opts
 * @param {string} opts.token
 * @param {Function} [opts.hamta] injicerad fetch, för test
 */
export function skapaLagring({ token, hamta }) {
  if (!token) throw new Error('Lagringen kräver ett åtkomsttoken.');
  const dorr = hamta ?? globalThis.fetch;

  async function anrop(url, init = {}) {
    let svar;
    try {
      svar = await dorr(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
      });
    } catch (e) {
      const fel = new Error('Nätverksfel: ' + saneraFel(e?.message, token));
      fel.name = 'Natverksfel';
      throw fel;
    }
    if (svar.status === 401) {
      const fel = new Error('Inloggningen har gått ut. Logga in igen.');
      fel.name = 'Utloggad';
      throw fel;
    }
    return svar;
  }

  /** Metadata utan att hämta innehållet. null när filen inte finns. */
  async function metadata(sokvag) {
    if (!farLasas(sokvag)) throw new Error(`Läsning mot "${sokvag}" är inte tillåten.`);
    const svar = await anrop(metaUrl(sokvag));
    if (svar.status === 404) return null;
    if (!svar.ok) throw new Error(`Graph svarade ${svar.status} vid metadataläsning.`);
    const d = await svar.json();
    return {
      id: d.id,
      namn: d.name,
      sokvag,
      byte: d.size,
      eTag: d.eTag ?? null,
      cTag: d.cTag ?? null,
      andrad: d.lastModifiedDateTime ?? null,
      nedladdningsUrl: d['@microsoft.graph.downloadUrl'] ?? null,
    };
  }

  /**
   * Läser en fil som RÅTEXT.
   *
   * Hämtar först metadata och använder @microsoft.graph.downloadUrl.
   * /content svarar med en omdirigering till en annan domän, vilket en
   * webbläsare inte alltid får följa med Authorization-huvudet kvar.
   * Nedladdnings-URL:en är förauktoriserad och behöver inget huvud alls.
   */
  async function las(sokvag) {
    const meta = await metadata(sokvag);
    if (!meta) return null;                     // 404: filen finns inte

    let text = null;
    if (meta.nedladdningsUrl) {
      const svar = await dorr(meta.nedladdningsUrl);   // förauktoriserad, inget token
      if (svar.ok) text = await svar.text();
    }
    if (text === null) {
      const svar = await anrop(innehallUrl(sokvag));
      if (!svar.ok) throw new Error(`Graph svarade ${svar.status} vid läsning.`);
      text = await svar.text();
    }

    return { ...meta, text, checksumma: await sha256(text), byteLangd: bytesFor(text).length };
  }

  /**
   * Skriver RÅTEXT till en tillåten sökväg.
   *
   * If-Match skickas när en eTag är känd, så Graph kan avvisa skrivningen om
   * filen ändrats. 412 behandlas som synkkonflikt. Villkoret är ett extra
   * skydd ovanpå eTag-jämförelsen i sparaV2 — inte i stället för den.
   */
  async function skriv(sokvag, text, { eTag = null } = {}) {
    kontrolleraSkrivvag(sokvag);                 // kastar FÖRE anropet

    const huvuden = { 'Content-Type': 'application/json' };
    if (eTag) huvuden['If-Match'] = eTag;

    const svar = await anrop(innehallUrl(sokvag), { method: 'PUT', headers: huvuden, body: text });
    if (svar.status === 412) throw new Synkkonflikt();
    if (!svar.ok) throw new Error(`Graph svarade ${svar.status} vid skrivning.`);
    return await svar.json();
  }

  return {
    metadata, las, skriv,
    V1_SOKVAG, V2_SOKVAG,
    toJSON: () => ({ lasbara: LASBARA, skrivbara: SKRIVBARA, token: '[dolt]' }),
  };
}
