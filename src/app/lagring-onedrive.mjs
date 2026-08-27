// Appens lagring mot OneDrive.
//
// Skriver ENDAST till v2-filen. Sökvägsspärren i lagring.mjs stoppar allt
// annat innan något nätverksanrop skickas.
//
// Före varje skrivning kontrolleras att filen inte ändrats sedan den lästes.
// Har den det avbryts skrivningen — ingen sammanslagning sker automatiskt,
// eftersom en app som gissar hur två versioner ska vävas ihop förr eller
// senare gissar fel.

import {
  skapaLagring, V2_SOKVAG, backupSokvag, sha256, Synkkonflikt,
} from '../integrations/onedrive/lagring.mjs';

/**
 * @param {object} opts
 * @param {string} opts.token
 * @param {Function} [opts.hamta]  injicerad fetch, för test
 * @param {Function} [opts.nu]     tidsstämpelkälla, för test
 */
export function skapaOneDriveLagring({ token, hamta, nu = () => new Date().toISOString() }) {
  const graph = skapaLagring({ token, hamta });

  // Versionen appen läste. Grunden för konfliktkontrollen.
  let kand = { eTag: null, checksumma: null, id: null, andrad: null };

  return {
    sokvag: V2_SOKVAG,
    get version() { return { ...kand }; },

    /** Metadata för v2-filen. null när den inte finns ännu. */
    metadata: () => graph.metadata(V2_SOKVAG),

    /** Läser v2-filen. Returnerar null när den inte finns. */
    async las() {
      const fil = await graph.las(V2_SOKVAG);
      if (!fil) return null;
      kand = { eTag: fil.eTag, checksumma: fil.checksumma, id: fil.id, andrad: fil.andrad };
      return JSON.parse(fil.text);
    },

    /**
     * Sparar tillståndet.
     *
     * 1. hämta aktuell metadata
     * 2. jämför eTag med den inlästa versionen
     * 3. avvikelse → avbryt UTAN skrivning
     * 4. backup av den senaste v2-versionen
     * 5. skriv
     * 6. läs tillbaka och verifiera
     */
    async spara(tillstand) {
      const aktuell = await graph.metadata(V2_SOKVAG);
      if (!aktuell) throw new Error('v2-filen hittades inte. Ladda om sidan.');

      if (kand.eTag && aktuell.eTag && aktuell.eTag !== kand.eTag) {
        throw new Synkkonflikt();          // avbryter före varje skrivning
      }

      // Backup av den version som är på väg att ersättas.
      const tidigare = await graph.las(V2_SOKVAG);
      if (tidigare) {
        await graph.skriv(backupSokvag('v2', nu()), tidigare.text);
      }

      const text = JSON.stringify(tillstand, null, 2);
      const forvantad = await sha256(text);
      await graph.skriv(V2_SOKVAG, text, { eTag: kand.eTag });

      const tillbaka = await graph.las(V2_SOKVAG);
      if (!tillbaka || tillbaka.checksumma !== forvantad) {
        throw new Error('Filen på servern stämmer inte med det som skulle sparas. Ladda om och försök igen.');
      }
      kand = { eTag: tillbaka.eTag, checksumma: tillbaka.checksumma, id: tillbaka.id, andrad: tillbaka.andrad };
      return kand;
    },

    /** Efter införandet: sätt versionen appen ska utgå från. */
    sattVersion(version) { kand = { ...version }; },

    graph,
  };
}
