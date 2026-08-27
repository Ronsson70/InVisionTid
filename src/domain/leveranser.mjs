// Fasta leveranser och milstolpar.
//
// Fastpris fördelas ALDRIG över kalenderdagar, veckor eller månader. En verkstad
// är genomförd eller inte. En förstudiedel är levererad eller inte. Det var v1:s
// dagfördelning som gjorde intäkten synlig i fel period.
//
// Undantaget är avtal som uttryckligen är periodiserad månadsersättning. Då skapas
// en leverans per månad med order som löpnummer, inte en dagfördelning.

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

// ── Fastpris över en avtalsperiod ───────────────────────────────────────────
//
// Två skilda saker som aldrig får blandas ihop:
//
//   1. UPPARBETNING. Ett fast pris för april–juni tjänas in successivt. För
//      frågan "hur mycket har jag jobbat in den här veckan" fördelas beloppet
//      proportionellt över periodens kalenderdagar.
//
//   2. FAKTURERING. Beloppet faktureras enligt avtalet, vid leverans eller
//      betalningstillfälle. Den veckofördelade andelen blir ALDRIG en
//      fakturarad. Den finns bara som upparbetning.
//
// Fördelningen sker i heltalsöre och är deterministisk: resten läggs på
// periodens första dagar, så att summan av alla dagar blir exakt totalbeloppet.

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

/** Sant när leveransen är ett fast pris för en avtalad tidsperiod. */
export const harAvtalsperiod = leverans =>
  !!(leverans && (leverans.startDate || leverans.endDate));

/**
 * Kontrollerar att en avtalsperiod går att fördela.
 * Saknas något gissas ingenting — beloppet räknas helt enkelt inte in.
 * @returns {{giltig:boolean, orsak:string|null}}
 */
export function periodKontroll(leverans) {
  if (!leverans?.startDate || !leverans?.endDate) {
    return { giltig: false, orsak: 'Fastprisperioden behöver kompletteras' };
  }
  if (!Number.isInteger(leverans.amountOre) || leverans.amountOre <= 0) {
    return { giltig: false, orsak: 'Fastprisperioden behöver kompletteras' };
  }
  if (periodDagar(leverans.startDate, leverans.endDate) === null) {
    return { giltig: false, orsak: 'Fastprisperioden behöver kompletteras' };
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
 * Sant när en enstaka leverans UTAN avtalsperiod är genomförd.
 * En planerad leverans är inte genomförd, oavsett datum.
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
