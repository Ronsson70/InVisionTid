// Kontrollerad nystart: från v1-filen till en ny v2-fil.
//
// Nystart, inte migrering. Det som förs över är det som behövs för att arbeta
// vidare: aktiva kunder och uppdrag, och de poster som ännu inte fakturerats.
// Historiken stannar i v1-filen, som aldrig ändras.
//
// Inga gamla fakturamarkeringar följer med. De var bevisligen fel åt båda håll
// och Lundify är facit. Att föra över dem hade betytt att appen påstår något
// den inte vet.
//
// Reglerna för hur poster översätts återanvänds oförändrade från den testade
// migreringen: filtret körs FÖRE migreraTillV2, inte i stället för den. Därför
// finns artikelhärledning, kvantiteter och momsflaggor bara på ett ställe.

import { migreraTillV2, kontrollsummor } from './migrering.mjs';

/** Hur länge ett uppdrag räknas som aktivt efter sin senaste registrering. */
export const AKTIV_GRANS_DAGAR = 90;

const DAG_MS = 86400000;
const somDatum = d => new Date(String(d) + 'T12:00:00');

function dagarSedan(datum, nu) {
  const d = somDatum(datum);
  if (isNaN(d.getTime())) return Infinity;
  return Math.round((somDatum(String(nu).slice(0, 10)) - d) / DAG_MS);
}

/** Månader som är fakturamarkerade i v1, per uppdrag. */
function markeradeManader(v1data) {
  const per = new Map();
  for (const i of v1data?.invoices || []) {
    if (!per.has(i.projectId)) per.set(i.projectId, new Set());
    per.get(i.projectId).add(i.month);
  }
  return per;
}

/**
 * Sant när posten ännu inte är fakturamarkerad.
 * En markering gäller uppdrag + månad, så en post i en omarkerad månad är öppen.
 */
function arOppen(post, markerade) {
  const manader = markerade.get(post.projectId);
  return !manader || !manader.has(String(post.date).slice(0, 7));
}

/**
 * Analyserar v1-filen och visar exakt vad en nystart skulle föra över.
 * Läser bara — ändrar ingenting.
 */
export function analysera(v1data, { nu }) {
  const markerade = markeradeManader(v1data);
  const projekt = v1data?.projects || [];

  const senasteFor = pid => (v1data?.entries || [])
    .filter(e => e.projectId === pid).map(e => e.date).sort().pop() ?? null;

  const uppdrag = projekt.map(p => {
    const senaste = senasteFor(p.id);
    const oppnaPoster = (v1data?.entries || []).filter(e => e.projectId === p.id && arOppen(e, markerade));
    const oppnaResor = (v1data?.trips || []).filter(t => t.projectId === p.id && arOppen(t, markerade));
    const oppnaUtlagg = (v1data?.expenses || []).filter(x => x.projectId === p.id && arOppen(x, markerade));
    return {
      id: p.id,
      senasteRegistrering: senaste,
      dagarSedanSenaste: senaste ? dagarSedan(senaste, nu) : null,
      aktiv: !!senaste && dagarSedan(senaste, nu) <= AKTIV_GRANS_DAGAR,
      antalOppnaPoster: oppnaPoster.length,
      antalOppnaResor: oppnaResor.length,
      antalOppnaUtlagg: oppnaUtlagg.length,
      harFastprisperiod: (p.pricingPeriods || []).length > 0,
      harTillfallespris: p.sessionPrice > 0,
      clientId: p.clientId ?? null,
    };
  });

  const aktiva = uppdrag.filter(u => u.aktiv);
  const aktivaKunder = [...new Set(aktiva.map(u => u.clientId).filter(Boolean))];

  return {
    kalla: kontrollsummor(v1data),
    lastSync: typeof v1data?.lastSync === 'string' ? v1data.lastSync : null,
    uppdrag,
    forsOver: {
      kunder: aktivaKunder.length,
      uppdrag: aktiva.length,
      oppnaPoster: aktiva.reduce((s, u) => s + u.antalOppnaPoster, 0),
      oppnaResor: aktiva.reduce((s, u) => s + u.antalOppnaResor, 0),
      oppnaUtlagg: aktiva.reduce((s, u) => s + u.antalOppnaUtlagg, 0),
      fakturamarkeringar: 0,                    // förs aldrig över
    },
    lamnasIArkivet: {
      kunder: (v1data?.clients || []).length - aktivaKunder.length,
      uppdrag: uppdrag.length - aktiva.length,
      fakturamarkeringar: (v1data?.invoices || []).length,
      fakturerade: {
        poster: (v1data?.entries || []).filter(e => !arOppen(e, markerade)).length,
        resor: (v1data?.trips || []).filter(t => !arOppen(t, markerade)).length,
      },
    },
    fastprisperioderAttGranska: projekt.flatMap(p =>
      (p.pricingPeriods || []).map(pp => ({ projectId: p.id, periodId: pp.id, typ: pp.type }))),
  };
}

/**
 * Bygger v2-startdata.
 *
 * Filtrerar först till aktiva uppdrag och öppna poster, och kör sedan den
 * testade migreringen på resultatet. Alla regler om artiklar, kvantiteter och
 * ogranskad moms gäller därför oförändrat:
 *
 *   - fastprisuppdragens tid blir trackingOnly och kan inte bli fakturarader
 *   - tillfällesposter får kvantitet 1 och needsReview, eftersom v1 räknade
 *     unika datum och det verkliga antalet inte går att härleda
 *   - momssatser förblir okända och blockerar fakturaunderlag, inte appen
 *   - fastprisperioder behålls som råvärde för granskning, och gissas inte
 */
export function nystart(v1data, { nu }) {
  const analys = analysera(v1data, { nu });
  const aktivaUppdrag = new Set(analys.uppdrag.filter(u => u.aktiv).map(u => u.id));
  const aktivaKunder = new Set(analys.uppdrag.filter(u => u.aktiv).map(u => u.clientId).filter(Boolean));
  const markerade = markeradeManader(v1data);

  const kvar = x => aktivaUppdrag.has(x.projectId) && arOppen(x, markerade);

  const filtrerad = {
    clients: (v1data?.clients || []).filter(c => aktivaKunder.has(c.id)),
    projects: (v1data?.projects || []).filter(p => aktivaUppdrag.has(p.id)),
    entries: (v1data?.entries || []).filter(kvar),
    trips: (v1data?.trips || []).filter(kvar),
    expenses: (v1data?.expenses || []).filter(kvar),
    invoices: [],                               // ingen historisk fakturastatus
    deletedIds: {},                             // tombstones hör till v1-historiken
    hourlyRate: v1data?.hourlyRate,
    kmRate: v1data?.kmRate,
    settings: v1data?.settings,
  };

  const v2 = migreraTillV2(filtrerad, { nu });

  return {
    ...v2,
    installningar: { veckomalOre: null },        // målet sätts av användaren
    nystart: {
      at: nu,
      kalla: 'InVisionTid/invisiontid-data.json',
      forsOver: analys.forsOver,
      lamnasIArkivet: analys.lamnasIArkivet,
      anmarkning:
        'Nystart, inte migrering. Historiken ligger kvar i v1-filen, som aldrig ändras. '
        + 'Inga fakturamarkeringar fördes över — Lundify är facit.',
    },
  };
}
