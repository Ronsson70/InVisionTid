// Skrivskyddad läsare för en OneDrive-synkad fil på disk.
//
// Används när en verklig förhandsgranskning ska göras utan att gå via Graph.
// Precis som Graph-adaptern har den ingen skrivfunktion alls.
//
// Att läsa den synkade kopian i stället för att anropa Graph är INTE samma sak.
// Skillnaden redovisas i rapporten: en synkad fil kan ligga efter molnet om
// synkningen är pausad eller pågår.

import { readFileSync, statSync, existsSync } from 'node:fs';
import { OtydligKalla, faststallAktivFil } from '../onedrive/lasadapter.mjs';

export { faststallAktivFil, OtydligKalla };

/**
 * Skapar en skrivskyddad läsare för en fil på disk.
 * @param {string} sokvag
 */
export function skapaFillasare(sokvag) {
  if (!sokvag) throw new OtydligKalla('Ingen sökväg angiven. Körningen avbryts.');
  if (!existsSync(sokvag)) {
    throw new OtydligKalla(`Sökvägen finns inte: ${sokvag}. Körningen avbryts utan att någon fil läses.`);
  }
  const info = statSync(sokvag);
  if (!info.isFile()) {
    throw new OtydligKalla(`Sökvägen är inte en fil: ${sokvag}. Körningen avbryts.`);
  }

  return {
    skrivskyddad: true,
    sokvag,

    /** Filens innehåll som RÅTEXT. */
    las: () => readFileSync(sokvag, 'utf8'),

    /** Metadata utan att läsa innehållet. */
    metadata: () => {
      const s = statSync(sokvag);
      return { sokvag, byte: s.size, andrad: new Date(s.mtimeMs).toISOString() };
    },
  };
}

/**
 * Letar upp kandidater för appens datafil bland flera möjliga rötter.
 * Returnerar dem alla — beslutet om vilken som är aktiv fattas av
 * faststallAktivFil, som avbryter vid noll eller flera.
 */
export function hittaKandidater(rotter, { mapp = 'InVisionTid', filnamn = 'invisiontid-data.json' } = {}) {
  const kandidater = [];
  for (const rot of rotter || []) {
    const full = `${rot}/${mapp}/${filnamn}`;
    if (existsSync(full) && statSync(full).isFile()) kandidater.push(full);
  }
  return kandidater;
}
