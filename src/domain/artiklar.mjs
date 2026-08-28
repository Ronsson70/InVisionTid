// Arbetstyper och artiklar. Priset sitter HÄR, inte på projektet.
//
// Det är hela skillnaden mot v1. Ett uppdrag kan ha behandlingspass à 2 400 kr
// med en momssats och samtal à 850 kr per timme med en annan, samma dag.

import { MOMS_GRANSKAD, MOMS_OGRANSKAD } from './moms.mjs';

export const ARTIKELTYPER = /** @type {const} */ ([
  'hourly',            // debiteras per timme
  'session',           // debiteras per pass eller tillfälle
  'piece',             // debiteras per styck
  'travel',            // debiteras per kilometer
  'fixedDeliverable',  // fast leverans, prissätts via leveranser
  'trackingOnly',      // loggas för uppföljning, faktureras aldrig
]);

export const ENHETER = /** @type {const} */ (['tim', 'pass', 'st', 'km', 'kr']);

/** Enheten som normalt hör till varje artikeltyp. */
export const STANDARDENHET = {
  hourly: 'tim',
  session: 'pass',
  piece: 'st',
  travel: 'km',
  fixedDeliverable: 'st',
  trackingOnly: 'tim',
};

/**
 * Skapar en artikel med kontrollerade fält.
 * Momssatsen måste anges uttryckligen — antingen ett granskat värde, eller null
 * med vatStatus 'needsReview'. Det finns ingen tyst standard.
 */
export function skapaArtikel(indata) {
  const {
    id, projectId, name, type,
    unit = STANDARDENHET[type],
    unitPriceOre = 0,
    vatRate = null,
    vatStatus = vatRate === null ? MOMS_OGRANSKAD : MOMS_GRANSKAD,
    vatCode = null,
    billable = type !== 'trackingOnly',
    active = true,
    sortOrder = 0,
    needsReview = vatStatus === MOMS_OGRANSKAD,
    reviewNote = null,
    lundifyArticleId = null,
    lundifyArticleNumber = null,
    workSecondsPerUnit = null,
  } = indata;

  if (!ARTIKELTYPER.includes(type)) {
    throw new Error(`Okänd artikeltyp "${type}". Giltiga: ${ARTIKELTYPER.join(', ')}`);
  }
  if (!ENHETER.includes(unit)) {
    throw new Error(`Okänd enhet "${unit}". Giltiga: ${ENHETER.join(', ')}`);
  }
  if (type === 'trackingOnly' && billable) {
    throw new Error('En trackingOnly-artikel kan aldrig vara fakturerbar.');
  }
  if (vatRate !== null && !Number.isInteger(vatRate)) {
    throw new TypeError('Momssatsen anges i hundradels procent som heltal, 25 % = 2500.');
  }
  if (workSecondsPerUnit !== null
      && (type !== 'session' || !Number.isInteger(workSecondsPerUnit) || workSecondsPerUnit <= 0)) {
    throw new TypeError('Arbetstid per tillfälle anges som ett positivt heltal sekunder på en tillfällesartikel.');
  }

  return {
    id, projectId, name, type, unit,
    unitPriceOre,
    vatRate, vatStatus, vatCode,
    billable, active, sortOrder,
    needsReview, reviewNote,
    lundifyArticleId, lundifyArticleNumber,
    ...(workSecondsPerUnit !== null ? { workSecondsPerUnit } : {}),
  };
}

/** Slår upp en artikel och ger ett begripligt fel om den saknas. */
export function hittaArtikel(artiklar, articleId) {
  const lista = Array.isArray(artiklar) ? artiklar : Object.values(artiklar || {});
  const artikel = lista.find(a => a.id === articleId);
  if (!artikel) throw new Error(`Okänd artikel: ${articleId}`);
  return artikel;
}

/** Normaliserar artiklar till en lista, oavsett om de kommer som objekt eller array. */
export function artikelLista(artiklar) {
  return Array.isArray(artiklar) ? artiklar : Object.values(artiklar || {});
}

/** Sant om artikeln får bli en fakturarad alls. */
export function arFakturerbar(artikel) {
  return !!artikel?.billable && artikel.type !== 'trackingOnly';
}

/** Sant om artikeln bara loggas för uppföljning. */
export function arEndastUppfoljning(artikel) {
  return artikel?.type === 'trackingOnly' || artikel?.billable === false;
}

/** Sant om artikeln mäter tid, alltså om kvantiteten kan härledas ur sekunder. */
export function arTidsartikel(artikel) {
  return artikel?.unit === 'tim';
}

/** Deterministiskt artikel-id, så migreringen kan köras om utan att skapa dubbletter. */
export function artikelId(projectId, type) {
  return `art-${projectId}-${type}`;
}
