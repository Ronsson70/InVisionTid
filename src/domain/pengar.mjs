// Pengar och kvantiteter som heltal. Inga flyttal, någonsin.
//
//   Belopp     heltal ÖRE                        2 400 kr = 240000
//   Kvantitet  heltal TUSENDELAR av enheten      3 tim = 3000, 15 min = 250
//   Momssats   heltal HUNDRADELS PROCENT         25 % = 2500, 0 % = 0
//
// Skälet är inte pedanteri. 11 418,50 kr med 25 % moms ger exakt 2 854,625 kr,
// alltså ett halvt öre. Med flyttal beror utfallet på hur talet råkar
// representeras. Med heltal är det bestämt.

/** 1 krona i öre. */
export const KRONA = 100;
/** 1 enhet i milli-units. */
export const MILLI = 1000;
/** 100 % i hundradels procent. */
export const PROCENT = 10000;

const MAX = Number.MAX_SAFE_INTEGER;

function kravHeltal(varde, namn) {
  if (!Number.isInteger(varde)) {
    throw new TypeError(`${namn} måste vara ett heltal, fick ${JSON.stringify(varde)}`);
  }
  if (!Number.isSafeInteger(varde)) {
    throw new RangeError(`${namn} ligger utanför säkert heltalsintervall: ${varde}`);
  }
  return varde;
}

/**
 * Division med ROUND_HALF_UP, alltså avrundning BORT FRÅN NOLL vid exakt halva.
 *
 *   roundHalfUp(2854625, 10)  →  285463     (halva uppåt)
 *   roundHalfUp(-2854625, 10) →  -285463    (halva bort från noll, inte mot noll)
 *
 * Math.round duger inte: Math.round(-0.5) ger -0, alltså halva mot plus
 * oändligheten. På en kreditfaktura blir det fel åt fel håll.
 *
 * @param {number} taljare heltal
 * @param {number} namnare positivt heltal
 * @returns {number} heltal
 */
export function roundHalfUp(taljare, namnare) {
  kravHeltal(taljare, 'täljare');
  kravHeltal(namnare, 'nämnare');
  if (namnare <= 0) throw new RangeError(`nämnaren måste vara positiv, fick ${namnare}`);

  const negativ = taljare < 0;
  const belopp = negativ ? -taljare : taljare;

  const kvot = Math.floor(belopp / namnare);
  const rest = belopp - kvot * namnare;
  const avrundad = rest * 2 >= namnare ? kvot + 1 : kvot;

  // Normalisera bort -0. Ett negativt nollbelopp har ingen mening i en faktura,
  // och det överlever varken JSON eller en strikt jämförelse på ett vettigt sätt.
  const resultat = negativ ? -avrundad : avrundad;
  return resultat === 0 ? 0 : resultat;
}

/** Multiplikation med kontroll att produkten ryms i ett säkert heltal. */
export function multiplicera(a, b, sammanhang = 'produkt') {
  kravHeltal(a, `${sammanhang}, första faktorn`);
  kravHeltal(b, `${sammanhang}, andra faktorn`);
  const produkt = a * b;
  if (!Number.isSafeInteger(produkt)) {
    throw new RangeError(
      `${sammanhang} överskrider säkert heltalsintervall: ${a} * ${b}. `
      + `Största säkra heltal är ${MAX}.`
    );
  }
  return produkt;
}

/**
 * Radbelopp i öre: à-pris gånger kvantitet.
 * 850,00 kr/tim * 3 tim  →  multiplicera(85000, 3000) / 1000  →  255000 öre
 */
export function radbeloppOre(unitPriceOre, qtyMilli) {
  return roundHalfUp(multiplicera(unitPriceOre, qtyMilli, 'radbelopp'), MILLI);
}

/** Öre till kronor som svensk text: 2396900 → "23 969,00 kr" */
export function oreTillText(ore, { visaEnhet = true } = {}) {
  kravHeltal(ore, 'belopp i öre');
  const negativ = ore < 0;
  const belopp = negativ ? -ore : ore;
  const kronor = Math.floor(belopp / KRONA);
  const rest = belopp - kronor * KRONA;
  const text = `${kronor.toLocaleString('sv-SE')},${String(rest).padStart(2, '0')}`;
  return `${negativ ? '−' : ''}${text}${visaEnhet ? ' kr' : ''}`;
}

/** Kvantitet till text med enhet: 3000, 'tim' → "3 tim". 2500, 'tim' → "2,5 tim" */
export function kvantitetTillText(qtyMilli, unit) {
  kravHeltal(qtyMilli, 'kvantitet');
  const negativ = qtyMilli < 0;
  const varde = negativ ? -qtyMilli : qtyMilli;
  const heltal = Math.floor(varde / MILLI);
  const rest = varde - heltal * MILLI;
  const tecken = negativ ? '−' : '';
  if (rest === 0) return `${tecken}${heltal.toLocaleString('sv-SE')}${unit ? ' ' + unit : ''}`;
  const decimaler = String(rest).padStart(3, '0').replace(/0+$/, '');
  return `${tecken}${heltal.toLocaleString('sv-SE')},${decimaler}${unit ? ' ' + unit : ''}`;
}

/** Sekunder till kvantitet i milli-timmar. 3600 s → 1000. 900 s → 250. */
export function sekunderTillTimmarMilli(sekunder) {
  kravHeltal(sekunder, 'sekunder');
  return roundHalfUp(multiplicera(sekunder, MILLI, 'sekunder till timmar'), 3600);
}

/** Kronor med decimaler till öre. Enda stället där ett flyttal får komma in. */
export function kronorTillOre(kronor) {
  if (typeof kronor !== 'number' || !Number.isFinite(kronor)) {
    throw new TypeError(`belopp i kronor måste vara ett ändligt tal, fick ${JSON.stringify(kronor)}`);
  }
  // Multiplicera först, avrunda sedan. 12.34 * 100 blir 1233.9999… i flyttal.
  return Math.round(kronor * KRONA);
}
