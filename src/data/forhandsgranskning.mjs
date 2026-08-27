// Migreringsförhandsgranskning.
//
// Kör migreringen HELT I MINNET och beskriver vad den skulle göra. Modulen har
// ingen möjlighet att spara någonting: den importerar inget som kan skriva, tar
// emot text och returnerar ett objekt. Att den inte sparar är alltså en egenskap
// hos konstruktionen, inte en regel någon måste komma ihåg.

import { migreraTillV2, kontrollsummor, jamforKontrollsummor } from '../domain/migrering.mjs';
import { oreTillText } from '../domain/pengar.mjs';

/**
 * En underkänd förhandsgranskning har SAMMA form som en godkänd, bara tom.
 * Annars måste varje anropare komma ihåg att kontrollera giltig först, och den
 * som glömmer får en krasch i stället för ett besked.
 */
function underkand(fel, fore = null) {
  return {
    giltig: false, fel, redanMigrerad: false, idempotent: false,
    fore, efter: null, avvikelser: [],
    skapade: { artiklar: 0, leveranser: 0, fakturareferenser: 0, granskningsposter: 0 },
    artiklar: [],
    ogranskadMoms: [], ogranskadMomsAntal: 0,
    bevaradeFastprisperioder: [],
    fakturareferenser: [],
    granskningsposter: [], granskningsposterPerTyp: {},
    resultat: null,
    sparat: false,
  };
}

/**
 * @param {string} ravara  rådata som text, exakt som den lästes
 * @param {object} opts
 * @param {string} opts.nu ISO-tidsstämpel
 * @returns {object} förhandsgranskning. Inget sparas.
 */
export function forhandsgranskaMigrering(ravara, { nu } = {}) {
  if (typeof ravara !== 'string') {
    throw new TypeError('Förhandsgranskningen arbetar på rådata som text.');
  }
  if (!nu) throw new Error('Förhandsgranskningen kräver en tidsstämpel.');

  let indata;
  try {
    indata = JSON.parse(ravara);
  } catch (e) {
    return underkand(['Rådata är inte giltig JSON och kan inte migreras: ' + e.message]);
  }

  const redanMigrerad = (indata?.schemaVersion || 0) >= 2;
  const fore = kontrollsummor(indata);

  let resultat;
  try {
    resultat = migreraTillV2(indata, { nu });
  } catch (e) {
    return underkand(['Migreringen kunde inte genomföras: ' + e.message], fore);
  }

  const efter = kontrollsummor(resultat);
  const avvikelser = jamforKontrollsummor(fore, efter);

  // Idempotens provas här, inte bara i testerna. En andra körning i minnet får
  // inte skapa någonting nytt.
  const andraKorningen = migreraTillV2(structuredClone(resultat), { nu });
  const idempotent =
    (andraKorningen.articles || []).length === (resultat.articles || []).length
    && (andraKorningen.deliverables || []).length === (resultat.deliverables || []).length
    && (andraKorningen.invoiceRecords || []).length === (resultat.invoiceRecords || []).length
    && (andraKorningen.reviewQueue || []).length === (resultat.reviewQueue || []).length
    && (andraKorningen.entries || []).length === (resultat.entries || []).length;

  const artiklar = resultat.articles || [];
  const ogranskadMoms = artiklar.filter(a => a.vatStatus !== 'reviewed' || a.vatRate === null);

  const bevaradeFastprisperioder = [];
  for (const p of resultat.projects || []) {
    for (const period of p.pricingPeriods || []) {
      bevaradeFastprisperioder.push({
        projectId: p.id,
        projektnamn: p.name,
        periodId: period.id,
        typ: period.type,
        beloppText: oreTillText(Math.round((Number(period.amount) || 0) * 100)),
        startDate: period.startDate,
        endDate: period.endDate ?? null,
        omvandladTillLeverans: false,
      });
    }
  }

  const granskningsposter = resultat.reviewQueue || [];
  const perTyp = {};
  for (const post of granskningsposter) perTyp[post.typ] = (perTyp[post.typ] || 0) + 1;

  const fel = [];
  if (avvikelser.length) {
    fel.push('Kontrollsummorna stämmer inte. Migreringen får inte sparas.');
  }
  if (!idempotent) {
    fel.push('Migreringen är inte idempotent. En andra körning skulle skapa dubbletter.');
  }

  return {
    giltig: fel.length === 0,
    fel,
    redanMigrerad,
    idempotent,

    fore,
    efter,
    avvikelser,

    skapade: {
      artiklar: artiklar.length,
      leveranser: (resultat.deliverables || []).length,
      fakturareferenser: (resultat.invoiceRecords || []).length,
      granskningsposter: granskningsposter.length,
    },

    artiklar: artiklar.map(a => ({
      id: a.id, projectId: a.projectId, namn: a.name, typ: a.type, enhet: a.unit,
      prisText: oreTillText(a.unitPriceOre),
      moms: a.vatRate === null ? 'ogranskad' : a.vatRate / 100 + ' %',
      vatStatus: a.vatStatus,
    })),

    ogranskadMoms: ogranskadMoms.map(a => ({ id: a.id, namn: a.name, projectId: a.projectId, notis: a.reviewNote })),
    ogranskadMomsAntal: ogranskadMoms.length,

    bevaradeFastprisperioder,

    fakturareferenser: (resultat.invoiceRecords || []).map(r => ({
      id: r.id, period: r.period, clientId: r.clientId,
      status: r.status, invoiceNumber: r.invoiceNumber, needsReview: r.needsReview,
    })),

    granskningsposter: granskningsposter.map(k => ({
      id: k.id, typ: k.typ, ref: k.ref, severity: k.severity, beskrivning: k.beskrivning,
    })),
    granskningsposterPerTyp: perTyp,

    // Resultatet finns bara här, i minnet. Ingenting har sparats.
    resultat,
    sparat: false,
  };
}

/** Förhandsgranskningen som läsbar text, för terminalen eller en vy. */
export function sammanfattning(f) {
  if (!f) return 'Ingen förhandsgranskning.';
  const rader = [];
  const r = (etikett, varde) => rader.push(`  ${etikett.padEnd(34)} ${varde}`);

  rader.push('Migreringsförhandsgranskning');
  rader.push('─'.repeat(64));

  if (!f.giltig) {
    rader.push('  STOPP. Migreringen får inte sparas:');
    for (const fel of f.fel) rader.push('    • ' + fel);
    rader.push('');
  }
  if (f.redanMigrerad) rader.push('  Datat är redan migrerat. Ingenting nytt skapas.');

  rader.push('Bevarat, får inte minska');
  for (const falt of ['clients', 'projects', 'entries', 'expenses', 'trips', 'invoices', 'tombstones']) {
    const fore = f.fore?.[falt] ?? 0;
    const efter = f.efter?.[falt] ?? 0;
    r(falt, `${fore} → ${efter}${efter < fore ? '   AVVIKELSE' : ''}`);
  }

  rader.push('Kontrollsummor, ska vara oförändrade');
  for (const falt of ['sekunder', 'km', 'utlaggKronor']) {
    const fore = f.fore?.[falt] ?? 0;
    const efter = f.efter?.[falt] ?? 0;
    r(falt, `${fore} → ${efter}${efter !== fore ? '   AVVIKELSE' : '   oförändrad'}`);
  }

  rader.push('Skapas av migreringen');
  r('artiklar', f.skapade.artiklar);
  r('leveranser', `${f.skapade.leveranser}   (fastpris omvandlas aldrig automatiskt)`);
  r('fakturareferenser', `${f.skapade.fakturareferenser}   (alla osäkra, utan fakturanummer)`);
  r('granskningsposter', f.skapade.granskningsposter);

  rader.push('Kräver granskning innan fakturering');
  r('artiklar med ogranskad moms', `${f.ogranskadMomsAntal} av ${f.skapade.artiklar}`);
  r('bevarade fastprisperioder', f.bevaradeFastprisperioder.length);
  for (const [typ, antal] of Object.entries(f.granskningsposterPerTyp || {})) r(typ, antal);

  rader.push('─'.repeat(64));
  rader.push(f.giltig
    ? '  Förhandsgranskningen är godkänd. Ingenting har sparats.'
    : '  Förhandsgranskningen är underkänd. Ingenting har sparats.');
  return rader.join('\n');
}
