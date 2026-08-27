// Fasta leveranser och milstolpar.
//
// Varje fast ersättning har en UPPARBETNINGSPERIOD med start- och slutdatum.
// Beloppet tjänas in successivt över perioden, och det är den fördelningen som
// besvarar frågan "hur mycket har jag jobbat in den här veckan".
//
// Genomförandemarkeringen är något annat: den styr FAKTURERINGEN. En leverans
// som inte är genomförd kan inte tas med i ett underlag, och när den tas med
// används hela det avtalade beloppet.
//
// Ett arvode för en enda dag får samma start- och slutdatum och räknas helt
// den dagen.

export const LEVERANSSTATUS = /** @type {const} */ ([
  'planned',    // planerad, inte genomförd
  'open',       // genomförd och fakturerbar
  'included',   // reserverad på ett underlag
  'invoiced',   // fakturerad
]);

export function skapaLeverans(indata) {
  const {
    id, projectId, name, amountOre,
    vatRate = null,
    vatStatus = vatRate === null ? 'needsReview' : 'reviewed',
    order = 1,
    partOf = null,
    status = 'planned',
    completedAt = null,
    invoiceRecordId = null,
    priceSnapshot = null,
    needsReview = vatStatus === 'needsReview',
    reviewNote = null,
    createdAt = null,
    updatedAt = null,
  } = indata;

  if (!LEVERANSSTATUS.includes(status)) {
    throw new Error(`Okänd leveransstatus "${status}". Giltiga: ${LEVERANSSTATUS.join(', ')}`);
  }
  if (!Number.isInteger(amountOre)) {
    throw new TypeError('Leveransens belopp anges i heltal öre.');
  }

  return {
    id, projectId, name, amountOre, vatRate, vatStatus,
    order, partOf, status, completedAt, invoiceRecordId, priceSnapshot,
    needsReview, reviewNote, createdAt, updatedAt,
  };
}

// ── Fastpris upparbetas över en period ──────────────────────────────────────
//
// ALLA fasta ersättningar har en upparbetningsperiod. Ett arvode på 50 000 kr
// för ett arbete som pågår i fyra veckor tjänas in under fyra veckor, inte på
// den dag arbetet råkar bli klart.
//
// Två skilda saker som aldrig får blandas ihop:
//
//   1. UPPARBETNING. Beloppet fördelas proportionellt över periodens
//      kalenderdagar och besvarar frågan "hur mycket har jag jobbat in den här
//      veckan". En genomförandemarkering lägger ALDRIG hela beloppet ovanpå
//      en enskild vecka.
//
//   2. FAKTURERING. Genomförandemarkeringen styr fakturaflödet: en leverans
//      som inte är genomförd kan inte tas med i ett underlag, och när den tas
//      med används HELA det avtalade beloppet. Veckoandelen blir aldrig en
//      fakturarad.
//
// Fördelningen sker i heltalsöre och är deterministisk: resten läggs på
// periodens första dagar, så att summan av alla dagar blir exakt totalbeloppet.
//
// Ett arvode för en enda dag får samma start- och slutdatum och räknas då helt
// den dagen.

const DAG_MS = 86400000;
const somDatum = d => new Date(String(d) + 'T12:00:00');

/** Antal dagar i en period, båda ändpunkterna inräknade. */
export function periodDagar(startDate, endDate) {
  const start = somDatum(startDate);
  const slut = somDatum(endDate);
  if (isNaN(start.getTime()) || isNaN(slut.getTime())) return null;
  const dagar = Math.round((slut - start) / DAG_MS) + 1;
  return dagar > 0 ? dagar : null;
}

/** Sant när leveransen har någon form av upparbetningsperiod angiven. */
export const harAvtalsperiod = leverans =>
  !!(leverans && (leverans.startDate || leverans.endDate));

/**
 * Kontrollerar att upparbetningsperioden går att fördela.
 * Saknas något gissas ingenting — beloppet räknas helt enkelt inte in.
 * @returns {{giltig:boolean, orsak:string|null}}
 */
export function periodKontroll(leverans) {
  if (!leverans?.startDate || !leverans?.endDate) {
    return { giltig: false, orsak: 'Upparbetningsperioden behöver anges' };
  }
  if (!Number.isInteger(leverans.amountOre) || leverans.amountOre <= 0) {
    return { giltig: false, orsak: 'Upparbetningsperioden behöver anges' };
  }
  if (periodDagar(leverans.startDate, leverans.endDate) === null) {
    return { giltig: false, orsak: 'Upparbetningsperioden behöver anges' };
  }
  return { giltig: true, orsak: null };
}

/**
 * Andelen av totalbeloppet som hör till EN kalenderdag, i heltalsöre.
 *
 * base = totalbelopp delat på antal dagar, avrundat nedåt. Resten fördelas med
 * ett öre var på periodens första dagar. Det gör fördelningen deterministisk
 * och får summan att stämma exakt.
 */
export function dagsandelOre(leverans, datum) {
  if (!periodKontroll(leverans).giltig) return 0;
  if (datum < leverans.startDate || datum > leverans.endDate) return 0;

  const dagar = periodDagar(leverans.startDate, leverans.endDate);
  const bas = Math.floor(leverans.amountOre / dagar);
  const rest = leverans.amountOre - bas * dagar;
  const index = Math.round((somDatum(datum) - somDatum(leverans.startDate)) / DAG_MS);
  return bas + (index < rest ? 1 : 0);
}

/** Andelen för en uppsättning datum, till exempel en kalendervecka. */
export function periodandelOre(leverans, datumLista) {
  return (datumLista || []).reduce((summa, d) => summa + dagsandelOre(leverans, d), 0);
}

/** Alla datum i perioden. Används för att bevisa att fördelningen summerar rätt. */
export function periodensDatum(leverans) {
  if (!periodKontroll(leverans).giltig) return [];
  const dagar = periodDagar(leverans.startDate, leverans.endDate);
  const start = somDatum(leverans.startDate);
  return Array.from({ length: dagar }, (_, i) => {
    const d = new Date(start.getTime() + i * DAG_MS);
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  });
}

/**
 * Sant när leveransen är genomförd och därmed får faktureras.
 * En planerad leverans är inte genomförd, oavsett datum.
 *
 * Genomförandet påverkar ALDRIG upparbetningen — den följer perioden.
 */
export const arGenomford = leverans =>
  !!leverans?.completedAt && leverans.status !== 'planned';

/** Leveranser som ännu inte fakturerats, i ordning. */
export function oppnaLeveranser(leveranser) {
  return (leveranser || [])
    .filter(l => l.status === 'planned' || l.status === 'open')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Hur många delar återstår efter att de valda har fakturerats. */
export function aterstaendeEfterVal(leveranser, valdaIds) {
  const valda = new Set(valdaIds || []);
  return (leveranser || []).filter(l => !valda.has(l.id) && l.status !== 'invoiced').length;
}

/**
 * Jämför avtalsuppgifter mot summan av delarna och flaggar en skillnad.
 * Hittar ALDRIG på ett totalpris — totalOre är null tills frågan är avgjord.
 */
export function kontrolleraAvtalstotal(avtalsuppgifter) {
  if (!avtalsuppgifter) return null;
  const { summaAvDelarOre, tidigareUppgiftOre } = avtalsuppgifter;
  if (summaAvDelarOre == null || tidigareUppgiftOre == null) return null;
  if (summaAvDelarOre === tidigareUppgiftOre) return null;
  return {
    typ: 'avtalstotal',
    diffOre: tidigareUppgiftOre - summaAvDelarOre,
    totalOre: null,          // appen gissar inte
    uppgifter: { summaAvDelarOre, tidigareUppgiftOre },
    beskrivning:
      'Summan av delarna stämmer inte med en tidigare uppgift om avtalets totalpris. '
      + 'Verifiera mot avtalet. Delfakturering kan ske under tiden.',
    severity: 'varning',
  };
}
