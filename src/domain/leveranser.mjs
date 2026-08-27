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
