// Moms per momssats och öresavrundning.
//
// Två regler som är lätta att få fel:
//
// 1. Momsen räknas på SUMMAN per momssats, inte per rad. Räknas den per rad och
//    summeras efteråt uppstår avrundningsdrift som gör att fakturan inte stämmer
//    mot momsunderlaget.
//
// 2. Öresavrundningen sker på BRUTTO, en gång, sist. Inte på netto och inte per rad.

import { roundHalfUp, multiplicera, KRONA, PROCENT } from './pengar.mjs';

/** Momsstatus på en artikel. */
export const MOMS_GRANSKAD = 'reviewed';
export const MOMS_OGRANSKAD = 'needsReview';

/**
 * Grupperar nettobelopp per momssats.
 * @param {Array<{nettoOre:number, vatRate:number}>} rader
 * @returns {Object<string, number>} momssats → nettobelopp i öre
 */
export function momsUnderlagPerSats(rader) {
  const underlag = {};
  for (const rad of rader) {
    if (rad.vatRate === null || rad.vatRate === undefined) {
      throw new Error(
        'Rad utan momssats kan inte summeras. En okänd momssats är inte noll procent.'
      );
    }
    const nyckel = String(rad.vatRate);
    underlag[nyckel] = (underlag[nyckel] || 0) + rad.nettoOre;
  }
  return underlag;
}

/**
 * Moms för ett nettobelopp vid en given momssats.
 * 1 141 850 öre * 2500 / 10000 = 285 462,5 → ROUND_HALF_UP → 285 463
 */
export function momsForBelopp(nettoOre, vatRate) {
  return roundHalfUp(multiplicera(nettoOre, vatRate, 'moms'), PROCENT);
}

/**
 * Summerar moms över alla momssatser.
 * @returns {{momsUnderlag: Object<string,number>, momsOre: number}}
 */
export function summeraMoms(rader) {
  const momsUnderlag = momsUnderlagPerSats(rader);
  let momsOre = 0;
  for (const [sats, netto] of Object.entries(momsUnderlag)) {
    momsOre += momsForBelopp(netto, Number(sats));
  }
  return { momsUnderlag, momsOre };
}

/**
 * Öresavrundning till närmaste hela krona, ROUND_HALF_UP.
 *
 *   2 396 875 öre (23 968,75)  →  avrundning +25 öre,  att betala 23 969 kr
 *   1 427 313 öre (14 273,13)  →  avrundning −13 öre,  att betala 14 273 kr
 *     918 750 öre  (9 187,50)  →  avrundning +50 öre,  att betala  9 188 kr
 *
 * @returns {{avrundningOre:number, attBetalaOre:number}}
 */
export function oresavrundning(bruttoOre, { avrunda = true } = {}) {
  if (!avrunda) return { avrundningOre: 0, attBetalaOre: bruttoOre };
  const helaKronor = roundHalfUp(bruttoOre, KRONA);
  const attBetalaOre = multiplicera(helaKronor, KRONA, 'att betala');
  return { avrundningOre: attBetalaOre - bruttoOre, attBetalaOre };
}

/**
 * Hela summeringen från rader till att betala.
 * @param {Array<{nettoOre:number, vatRate:number}>} rader
 */
export function summera(rader, { avrunda = true } = {}) {
  const nettoOre = rader.reduce((s, r) => s + r.nettoOre, 0);
  const { momsUnderlag, momsOre } = summeraMoms(rader);
  const bruttoForeAvrundningOre = nettoOre + momsOre;
  const { avrundningOre, attBetalaOre } = oresavrundning(bruttoForeAvrundningOre, { avrunda });
  return { nettoOre, momsUnderlag, momsOre, bruttoForeAvrundningOre, avrundningOre, attBetalaOre };
}

/** Sant när artikelns momssats är granskad och får användas på en faktura. */
export function momsAnvandbar(artikel) {
  return artikel?.vatStatus === MOMS_GRANSKAD
    && artikel?.vatRate !== null
    && artikel?.vatRate !== undefined;
}
