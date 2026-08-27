// v2-adapter: kopplar acceptanskontrollerna till den riktiga domänen i src/domain.
//
// Samma yta som test/adapters/v1.mjs, så exakt samma kontroller körs mot båda.
//   node --test test/*.test.mjs               kör mot v1
//   IVT_MAL=v2 node --test test/*.test.mjs    kör mot v2

import { readFileSync } from 'node:fs';
import * as domain from '../../src/domain/index.mjs';

export const namn = 'v2 (src/domain)';

export const {
  byggUnderlag,
  lasUnderlag,
  radbeloppMedSnapshot,
  nettoOreForPoster,
  foreslaResor,
  statusFlode,
  migreraTillV2,
} = domain;

export function laddaV1Fixture() {
  return JSON.parse(readFileSync(new URL('../../test-fixtures/v1-legacy.json', import.meta.url), 'utf8'));
}

export { domain };
