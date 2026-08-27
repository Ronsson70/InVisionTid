// Laddar de rena funktionerna ur index.html på exakt samma sätt som test.html gör,
// men i Node i stället för i webbläsaren. Ingen dubblerad logik: sektionen mellan
// PURE-START och PURE-END är fortfarande enda källan.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRot = fileURLToPath(new URL('../../', import.meta.url));

const EXPORTS = [
  'gid', 'fmtDur', 'fmtH', 'today', 'pc',
  'localDateStr', 'getWeekDates', 'weekLabel',
  'getRate', 'hasSessionPrice', 'hasFixedPeriod', 'pricingModel', 'isFixedPrice',
  'getActivePeriod', 'getSessionCount', 'getSessionRevenue',
  'calcRevenue', 'calcFixedMonthly', 'getFixedWeeklyAmount', 'calcWeekRevenue', 'weekSummary',
  'getDefaultTripKm', 'hasTripOn', 'suggestTrip', 'addDays', 'missingTrips',
  'lastActivityDate', 'daysBetween', 'staleStatus', 'lastActivityLabel',
  'projectMonthSummary', 'clientMonthSummaries',
  'recentProjectIds', 'lastEntryFor',
];

let cache = null;

/** Returnerar { fns, kalla } där fns är de rena v1-funktionerna. */
export function laddaPureV1() {
  if (cache) return cache;
  const sokvag = new URL('../../index.html', import.meta.url);
  const src = readFileSync(sokvag, 'utf8');
  const m = src.match(/\/\* PURE-START \*\/([\s\S]*?)\/\* PURE-END \*\//);
  if (!m) throw new Error('Hittade inte PURE-START/PURE-END i index.html');
  const fns = new Function(`${m[1]}\nreturn {${EXPORTS.join(',')}};`)();
  cache = { fns, kalla: m[1] };
  return cache;
}

/**
 * Plockar ut migrate() ur index.html. Observera att migrate() ligger UTANFÖR
 * PURE-START/PURE-END, alltså utanför det test.html kan nå. Den mest
 * säkerhetskritiska funktionen i appen har därför noll testtäckning idag.
 * Loadern finns här enbart för att kunna mäta baslinjen.
 */
export function laddaMigrateV1() {
  const src = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = src.match(/const SCHEMA_VERSION=\d+;[\s\S]*?\nfunction migrate\(d\)\{[\s\S]*?\n\}/);
  if (!m) throw new Error('Hittade inte migrate() i index.html');
  return new Function(`${m[0]}\nreturn migrate;`)();
}

/**
 * Plockar ut migrate() OCH mergeData() tillsammans, eftersom mergeData anropar
 * migrate. Båda ligger utanför PURE-sektionen och saknar därför testtäckning
 * i test.html, trots att de avgör om data överlever en synk.
 */
export function laddaSyncV1() {
  const src = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const migrateBlock = src.match(/const SCHEMA_VERSION=\d+;[\s\S]*?\nfunction migrate\(d\)\{[\s\S]*?\n\}/);
  const mergeBlock = src.match(/function mergeData\(local,remote\)\{[\s\S]*?\n\}/);
  if (!migrateBlock || !mergeBlock) throw new Error('Hittade inte migrate()/mergeData() i index.html');
  return new Function(`${migrateBlock[0]}\n${mergeBlock[0]}\nreturn {migrate, mergeData};`)();
}

/** Läser hela index.html som text, för språk- och innehållskontroller. */
export function laddaIndexHtml() {
  return readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
}

/** Läser den syntetiska v1-fixturen. */
export function laddaV1Fixture() {
  const rad = readFileSync(new URL('../../test-fixtures/v1-legacy.json', import.meta.url), 'utf8');
  return JSON.parse(rad);
}
