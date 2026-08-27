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
  skapaLagring, V1_SOKVAG, V2_SOKVAG, ledigBackupSokvag, sha256, Synkkonflikt,
} from '../integrations/onedrive/lagring.mjs';
import { tillAppTillstand, franAppTillstand } from './tillstand.mjs';
import { tidigareUppdragFranV1 } from './uppdrag.mjs';
import { byggArkiv } from './arkiv.mjs';

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
  let v1Lasning = null;

  // Grunddata och historik kommer ur samma skrivskyddade fil. Löftet cachas så
  // att appstarten bara behöver hämta filen en gång.
  const lasV1 = async () => {
    if (!v1Lasning) v1Lasning = graph.las(V1_SOKVAG);
    const fil = await v1Lasning;
    return fil ? JSON.parse(fil.text) : null;
  };

  return {
    sokvag: V2_SOKVAG,
    get version() { return { ...kand }; },

    /** Metadata för v2-filen. null när den inte finns ännu. */
    metadata: () => graph.metadata(V2_SOKVAG),

    /**
     * Läser v2-filen och ger tillbaka APPENS tillstånd, inte filens form.
     *
     * Filen har entries, trips och expenses. Appen har poster. Översättningen
     * sker här och ingen annanstans — att skicka filobjektet rakt in i appen
     * var precis det som fällde första införandet.
     *
     * Returnerar null när filen inte finns. Kastar OgiltigStruktur när den
     * finns men inte går att använda.
     */
    async las() {
      const fil = await graph.las(V2_SOKVAG);
      if (!fil) return null;
      const { tillstand } = tillAppTillstand(JSON.parse(fil.text));
      kand = { eTag: fil.eTag, checksumma: fil.checksumma, id: fil.id, andrad: fil.andrad };
      return tillstand;
    },

    /**
     * Läser endast grunddata för uppdrag som stannade i v1-arkivet.
     * V1-filen ändras aldrig och ingen historik returneras till appen.
     */
    async lasTidigareUppdrag(tillstand) {
      const data = await lasV1();
      if (!data) return [];
      return tidigareUppdragFranV1(data, tillstand, { nu: nu() });
    },

    /** Hela v1-historiken som en ren, skrivskyddad läsmodell. */
    async lasArkiv() {
      const data = await lasV1();
      return data ? byggArkiv(data) : byggArkiv({});
    },

    /**
     * Sparar tillståndet.
     *
     * 1. hämta aktuell metadata
     * 2. jämför eTag med den inlästa versionen
     * 3. avvikelse → avbryt UTAN skrivning
     * 4. översätt tillbaka till filens form
     * 5. backup av den senaste v2-versionen
     * 6. skriv
     * 7. läs tillbaka och verifiera
     */
    async spara(tillstand) {
      const aktuell = await graph.metadata(V2_SOKVAG);
      if (!aktuell) throw new Error('v2-filen hittades inte. Ladda om sidan.');

      if (kand.eTag && aktuell.eTag && aktuell.eTag !== kand.eTag) {
        throw new Synkkonflikt();          // avbryter före varje skrivning
      }

      // Filens form återställs innan något skrivs. Går inte det ska det
      // upptäckas här, före backupen — inte halvvägs genom en skrivning.
      const fil = franAppTillstand(tillstand);

      // Backup av den version som är på väg att ersättas. En befintlig backup
      // skrivs aldrig över.
      const tidigare = await graph.las(V2_SOKVAG);
      if (tidigare) {
        await graph.skriv(await ledigBackupSokvag(graph, 'v2', nu()), tidigare.text);
      }

      const text = JSON.stringify(fil, null, 2);
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
