// v1-adapter: försöker svara på acceptansfrågorna med den kod som faktiskt finns
// i index.html idag. Där v1 saknar begreppet kastas EjStodd med en konkret
// förklaring, så baslinjen visar VARFÖR ett fall faller och inte bara ATT det gör det.
//
// När etapp 3 är klar läggs test/adapters/v2.mjs till med samma exportnamn, och
// acceptanstesterna körs mot båda.

import { laddaPureV1, laddaV1Fixture, laddaMigrateV1 } from '../lib/pure-v1.mjs';

export const namn = 'v1 (index.html som den ser ut idag)';

export class EjStodd extends Error {
  constructor(orsak) { super(orsak); this.name = 'EjStodd'; this.orsak = orsak; }
}

const { fns } = laddaPureV1();
export const pure = fns;

// ── Översättning från v2-artiklar till v1:s datamodell ──────────────────────
// v1 har EN prismodell per projekt. Översättningen visar precis var det brister.

const KM_RATE_KR = 5.5;

function artikelLista(artiklar) {
  return Array.isArray(artiklar) ? artiklar : Object.values(artiklar);
}

/**
 * Bygger ett v1-dataobjekt av v2-poster. Returnerar även vilka artiklar som
 * inte gick att representera alls i v1.
 */
export function tillV1Data(artiklar, poster) {
  const arts = artikelLista(artiklar);
  const byId = new Map(arts.map(a => [a.id, a]));
  const ejRepresenterbara = [];
  const projects = new Map();
  const entries = [];
  const trips = [];

  const projekt = pid => {
    if (!projects.has(pid)) projects.set(pid, { id: pid, name: pid });
    return projects.get(pid);
  };

  for (const post of poster) {
    const a = byId.get(post.articleId);
    if (!a) throw new Error('Okänd artikel i fixturen: ' + post.articleId);
    const p = projekt(a.projectId);
    const antal = post.qtyMilli / 1000;

    if (a.type === 'session') {
      // v1: sessionPrice på projektet, och ETT tillfälle per unikt DATUM.
      // Antalet pass i posten går inte att uttrycka.
      p.sessionPrice = a.unitPriceOre / 100;
      entries.push({ id: post.id || post.articleId + post.date, projectId: a.projectId, date: post.date, seconds: 3600, moment: a.name });
      if (antal !== 1) ejRepresenterbara.push({ artikel: a.name, orsak: 'v1 räknar ett tillfälle per unikt datum, inte ' + antal + ' pass' });
    } else if (a.type === 'hourly') {
      p.hourlyRate = a.unitPriceOre / 100;
      entries.push({ id: post.id || post.articleId + post.date, projectId: a.projectId, date: post.date, seconds: Math.round(antal * 3600), moment: a.name });
    } else if (a.type === 'travel') {
      trips.push({ id: post.id || post.articleId + post.date, projectId: a.projectId, date: post.date, km: antal, description: a.name });
    } else if (a.type === 'trackingOnly') {
      entries.push({ id: post.id || post.articleId + post.date, projectId: a.projectId, date: post.date, seconds: Math.round(antal * 3600), moment: a.name });
      ejRepresenterbara.push({ artikel: a.name, orsak: 'v1 saknar trackingOnly, tiden räknas som fakturerbar om projektet har timpris' });
    } else if (a.type === 'piece') {
      ejRepresenterbara.push({ artikel: a.name, orsak: 'v1 saknar styckpris, bara timpris, tillfälle per dag och fastprisperiod finns' });
    } else if (a.type === 'fixedDeliverable') {
      ejRepresenterbara.push({ artikel: a.name, orsak: 'v1 har fastpris som PERIOD som fördelas över kalendertid, inte som leverans' });
    }
  }

  return {
    data: {
      projects: [...projects.values()],
      entries, trips, expenses: [], clients: [], invoices: [],
      hourlyRate: 850, kmRate: KM_RATE_KR, weeklyGoal: 0, settings: { staleWarningDays: 7 },
    },
    ejRepresenterbara,
  };
}

/** Netto i öre enligt v1:s prislogik. Kastar inte, men kan ge fel siffra. */
export function nettoOreEnligtV1(artiklar, poster) {
  const { data, ejRepresenterbara } = tillV1Data(artiklar, poster);
  const arvodeKr = fns.calcRevenue(data.entries, data);
  const resaKr = data.trips.reduce((s, t) => s + t.km * data.kmRate, 0);
  return { nettoOre: Math.round((arvodeKr + resaKr) * 100), ejRepresenterbara };
}

// ── v2-kontraktet ───────────────────────────────────────────────────────────

/** Netto i öre för en uppsättning poster. v1 svarar med sin egen prislogik. */
export function nettoOreForPoster(artiklar, poster) {
  return nettoOreEnligtV1(artiklar, poster).nettoOre;
}

/** Fullt faktureringsunderlag med moms per momssats och öresavrundning. */
export function byggUnderlag() {
  throw new EjStodd(
    'v1 saknar momsbegrepp helt. Ingen artikel, post eller summering bär momssats, ' +
    'och det finns ingen öresavrundning. Underlaget kan därför inte byggas.'
  );
}

/** Skapar och låser ett underlag, och kopplar valda poster till det. */
export function lasUnderlag() {
  throw new EjStodd(
    'v1 har inget faktureringsunderlag att låsa poster till. Fakturamarkeringen är ' +
    'en rad med projectId + month som inte pekar på några poster alls, och kan därför ' +
    'varken reservera, låsa eller utesluta enskilda poster.'
  );
}

/** Reseförslag utifrån projektets standardavstånd. Detta KAN v1. */
export function foreslaResor(data, datum) {
  const dagensProjekt = [...new Set((data.entries || []).filter(e => e.date === datum).map(e => e.projectId))];
  return dagensProjekt.map(pid => fns.suggestTrip(data, pid, datum)).filter(Boolean);
}

/** Migrering till schemaVersion 2. */
export function migreraTillV2() {
  throw new EjStodd(
    'v1:s migrate() normaliserar bara v1-fält och stämplar schemaVersion 1. ' +
    'Den skapar varken artiklar, leveranser, låsta prissnapshots eller externa fakturareferenser.'
  );
}

/** v1:s egen migrate, för att kunna mäta idempotens och dataförlust i baslinjen. */
const migrateV1 = laddaMigrateV1();
export function migreraV1(d) { return migrateV1(d); }

/** Radbelopp med prissnapshot vid låsning. */
export function radbeloppMedSnapshot() {
  throw new EjStodd(
    'v1 har inga låsta poster och inget prissnapshot. Priset läses alltid från ' +
    'projektet vid visningstillfället, så en prisändring skriver om historiken.'
  );
}

/** Statusflödet öppen → förberedd → Lundify-utkast → skickad → betald. */
export function statusFlode() {
  throw new EjStodd(
    'v1 har ett enda binärt tillstånd: en rad i invoices med projectId + month. ' +
    'Det finns inget fakturanummer, ingen utkaststatus och ingen betalstatus.'
  );
}

/** Läser den syntetiska v1-fixturen. */
export { laddaV1Fixture };
