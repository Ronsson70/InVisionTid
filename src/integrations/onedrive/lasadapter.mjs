// Skrivskyddad läsadapter mot Microsoft Graph.
//
// Adaptern har INGEN skrivfunktion. Det finns ingen att anropa av misstag, ingen
// flagga att sätta fel och ingen parameter som råkar bli 'PUT'. Varje HTTP-metod
// utom GET avvisas innan någon nätverksbegäran skickas.
//
// Modulen ligger i src/integrations/ och inte i src/domain/ eller src/data/, som
// förblir fria från nätverk, lagring och filsystem.

export const GRAPH_BAS = 'https://graph.microsoft.com/v1.0';

/** Enda tillåtna HTTP-metoden. Listan är inte konfigurerbar. */
export const TILLATNA_METODER = Object.freeze(['GET']);

export class SkrivforsokAvvisat extends Error {
  constructor(metod) {
    super(
      `Metoden ${metod} är avvisad. Läsadaptern är skrivskyddad och skickar bara GET. `
      + 'Ingen nätverksbegäran har gjorts.'
    );
    this.name = 'SkrivforsokAvvisat';
    this.metod = metod;
  }
}

export class OtydligKalla extends Error {
  constructor(meddelande) { super(meddelande); this.name = 'OtydligKalla'; }
}

/**
 * Grinden. Anropas FÖRE varje nätverksbegäran och kastar på allt utom GET.
 * Exporteras så att testerna kan pröva den direkt.
 */
export function endastGet(metod) {
  const normaliserad = String(metod ?? 'GET').toUpperCase();
  if (!TILLATNA_METODER.includes(normaliserad)) throw new SkrivforsokAvvisat(normaliserad);
  return normaliserad;
}

/** Graph-sökvägen appen faktiskt använder. Härledd ur index.html, inte gissad. */
export function innehallsUrl(filnamn, { mapp = 'InVisionTid' } = {}) {
  return `${GRAPH_BAS}/me/drive/root:/${mapp}/${filnamn}:/content`;
}

/** Metadata-URL för samma fil, för ändringsdatum och storlek. */
export function metadataUrl(filnamn, { mapp = 'InVisionTid' } = {}) {
  return `${GRAPH_BAS}/me/drive/root:/${mapp}/${filnamn}`;
}

/**
 * Tar bort allt som kan vara en hemlighet ur ett felmeddelande.
 * Ett token får aldrig hamna i en logg, ett testutfall eller en rapport.
 */
export function saneraFel(text, hemligheter = []) {
  let ut = String(text ?? '');
  for (const h of hemligheter) {
    if (h && String(h).length >= 4) ut = ut.split(String(h)).join('[dolt]');
  }
  return ut
    .replace(/Bearer\s+[\w.\-~+/]+=*/gi, 'Bearer [dolt]')
    .replace(/access_token=[\w.\-~+/]+=*/gi, 'access_token=[dolt]');
}

/**
 * Skapar en skrivskyddad läsare.
 *
 * @param {object} opts
 * @param {string} opts.token          åtkomsttoken, lämnar aldrig modulen
 * @param {Function} [opts.hamta]      injicerad fetch, för test
 * @param {string} [opts.filnamn]
 * @param {string} [opts.mapp]
 * @returns {{las:Function, metadata:Function, url:string}}  ingen skrivfunktion finns
 */
export function skapaGraphLasare({ token, hamta, filnamn = 'invisiontid-data.json', mapp = 'InVisionTid' }) {
  if (!token) throw new Error('Läsaren kräver ett åtkomsttoken.');
  const dorr = hamta ?? globalThis.fetch;
  if (typeof dorr !== 'function') throw new Error('Ingen fetch tillgänglig.');

  /** All nätverkstrafik går genom den här funktionen, och den grindas. */
  async function begar(url, metod = 'GET') {
    endastGet(metod);                       // kastar FÖRE anropet
    let svar;
    try {
      svar = await dorr(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new Error('Nätverksfel vid läsning: ' + saneraFel(e?.message, [token]));
    }
    if (svar.status === 401) throw new Error('Inloggningen har gått ut eller saknar behörighet.');
    if (svar.status === 404) throw new OtydligKalla('Filen finns inte på den angivna sökvägen.');
    if (!svar.ok) throw new Error(`Graph svarade ${svar.status} vid läsning.`);
    return svar;
  }

  return {
    skrivskyddad: true,
    url: innehallsUrl(filnamn, { mapp }),

    /** Filens innehåll som RÅTEXT. */
    las: async () => (await begar(innehallsUrl(filnamn, { mapp }))).text(),

    /** Filens metadata: namn, storlek, ändringsdatum. */
    metadata: async () => {
      const data = await (await begar(metadataUrl(filnamn, { mapp }))).json();
      return {
        namn: data.name,
        sokvag: data.parentReference?.path ? `${data.parentReference.path}/${data.name}` : null,
        byte: data.size,
        andrad: data.lastModifiedDateTime,
      };
    },

    /** Så att ett token aldrig kan läcka via en slarvig loggning av objektet. */
    toJSON: () => ({ skrivskyddad: true, url: innehallsUrl(filnamn, { mapp }), token: '[dolt]' }),
  };
}

/**
 * Fastställer den aktiva filen bland kandidater.
 * Noll eller flera kandidater är ett stopp, inte ett val.
 */
export function faststallAktivFil(kandidater) {
  const lista = (kandidater || []).filter(Boolean);
  if (lista.length === 0) {
    throw new OtydligKalla('Ingen kandidat hittades på den sökväg appen använder. Körningen avbryts.');
  }
  if (lista.length > 1) {
    throw new OtydligKalla(
      `${lista.length} kandidater pekar på samma logiska fil. Vilken som är aktiv går inte att avgöra. `
      + 'Körningen avbryts utan att någon fil läses in.'
    );
  }
  return lista[0];
}
