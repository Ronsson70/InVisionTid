// Reseförslag utifrån uppdragets standardavstånd.
//
// En resa hör ihop med ett DATUM och ett PROJEKT, inte med en enskild tidspost.
// Flera arbetsposter samma dag ger därför ett enda förslag. Samma regel som v1,
// bevarad ordagrant, eftersom den redan var rätt.

/** Uppdragets normala avstånd tur och retur, eller null. */
export function standardavstand(projekt) {
  const km = projekt?.defaultTripKm;
  return typeof km === 'number' && km > 0 ? km : null;
}

/** Finns redan en registrerad resa på uppdraget det datumet? */
export function harResa(data, projectId, datum) {
  return (data?.trips || []).some(t => t.projectId === projectId && t.date === datum);
}

/** Ett förslag, eller null om inget ska föreslås. */
export function foreslaResa(data, projectId, datum) {
  if (!datum) return null;
  const projekt = (data?.projects || []).find(p => p.id === projectId);
  const km = standardavstand(projekt);
  if (!km) return null;
  if (harResa(data, projectId, datum)) return null;
  return { projectId, date: datum, km, projectName: projekt.name };
}

/** Alla förslag för ett datum, ett per uppdrag med loggad tid. */
export function foreslaResor(data, datum) {
  const projektMedArbete = [...new Set(
    (data?.entries || []).filter(e => e.date === datum).map(e => e.projectId)
  )];
  return projektMedArbete
    .map(pid => foreslaResa(data, pid, datum))
    .filter(Boolean);
}

function laggTillDagar(datum, antal) {
  const d = new Date(datum + 'T12:00:00');
  d.setDate(d.getDate() + antal);
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/**
 * Säkerhetsnät bakåt: dagar med loggad tid på ett uppdrag med standardavstånd
 * men utan registrerad resa. Fångar poster som aldrig passerar förslaget vid
 * sparning — kalenderimport, upprepade dagar, poster från en annan enhet.
 */
export function saknadeResor(data, tillDatum, dagar = 14) {
  const fran = laggTillDagar(tillDatum, -dagar);
  const sedda = new Set();
  const ut = [];
  for (const e of data?.entries || []) {
    if (!e.date || e.date < fran || e.date > tillDatum) continue;
    const nyckel = e.projectId + '|' + e.date;
    if (sedda.has(nyckel)) continue;
    sedda.add(nyckel);
    const forslag = foreslaResa(data, e.projectId, e.date);
    if (forslag) ut.push(forslag);
  }
  return ut.sort((a, b) => b.date.localeCompare(a.date));
}
