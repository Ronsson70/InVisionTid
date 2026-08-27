// Säker komplettering av en befintlig v2-fil med hela historiken från v1.
//
// V1-filen är fortsatt orörd. Saknade rader kopieras till v2 med ett tydligt
// granskningsläge. Befintlig v2-data vinner alltid vid samma id, vilket gör
// importen idempotent och skyddar allt användaren redan har ändrat.

import { migreraTillV2 } from '../domain/migrering.mjs';
import { tillAppTillstand } from './tillstand.mjs';

export const HISTORIK_KALLA = 'v1-full-history';
export const HISTORIK_BEHOVER_GRANSKAS = 'needsReview';
export const HISTORIK_FAKTURERA = 'billable';
export const HISTORIK_KLAR_I_LUNDIFY = 'lundifyDone';
export const HISTORIK_ENDAST = 'historyOnly';

const lista = v => Array.isArray(v) ? v : [];
const laggTillSaknade = (nuvarande, kandidater, omvandla = x => x) => {
  const idn = new Set(lista(nuvarande).map(x => x.id));
  return [...lista(nuvarande), ...lista(kandidater).filter(x => !idn.has(x.id)).map(omvandla)];
};

/**
 * Planerar en full historikimport utan att ändra indata.
 * Returnerar det kompletta nya tillståndet och exakta antal som skulle läggas till.
 */
export function planeraHistorikimport(v1data, tillstand, { nu = new Date().toISOString() } = {}) {
  const migreradFil = migreraTillV2(v1data, { nu });
  const { tillstand: gammalt } = tillAppTillstand(migreradFil);
  const ignorerade = new Set(lista(tillstand?.historikimport?.ignoredIds));
  const befintligaPoster = new Set([
    ...lista(tillstand?.poster).map(p => p.id),
    ...ignorerade,
  ]);
  const markeringar = new Set(lista(v1data?.invoices).map(i => `${i.projectId}|${i.month}`));

  const nyaPoster = lista(gammalt.poster)
    .filter(p => !befintligaPoster.has(p.id))
    .map(p => {
      const { kallindex, ...rad } = p;
      const manad = String(p.date ?? '').slice(0, 7);
      return {
        ...rad,
        status: 'needsReview',
        invoiceRecordId: null,
        priceSnapshot: null,
        legacySource: HISTORIK_KALLA,
        legacyReviewStatus: HISTORIK_BEHOVER_GRANSKAS,
        legacyInvoiceMarked: markeringar.has(`${p.projectId}|${manad}`),
        legacyOriginalStatus: p.status ?? null,
        legacyReviewedAt: null,
      };
    });

  const projects = laggTillSaknade(tillstand?.projects, gammalt.projects, p => ({
    ...p, active: false, archivedAt: p.archivedAt ?? nu,
  }));
  const aktuellaProjekt = new Set(lista(tillstand?.projects).filter(p => p.active !== false).map(p => p.id));
  const articles = laggTillSaknade(tillstand?.articles, gammalt.articles, a => ({
    ...a, active: aktuellaProjekt.has(a.projectId),
  }));

  const nyttTillstand = {
    ...tillstand,
    clients: laggTillSaknade(tillstand?.clients, gammalt.clients),
    projects,
    articles,
    poster: [...lista(tillstand?.poster), ...nyaPoster],
    historikimport: {
      ...(tillstand?.historikimport || {}),
      source: HISTORIK_KALLA,
      importedAt: tillstand?.historikimport?.importedAt ?? nu,
      lastCompletedAt: nu,
      knownIds: [...new Set([
        ...lista(tillstand?.historikimport?.knownIds),
        ...lista(gammalt.poster).map(p => p.id),
      ])],
      ignoredIds: [...ignorerade],
      added: {
        entries: nyaPoster.filter(p => p.sourceType === 'entry').length,
        trips: nyaPoster.filter(p => p.sourceType === 'trip').length,
        expenses: nyaPoster.filter(p => p.sourceType === 'expense').length,
      },
    },
  };

  return {
    tillstand: nyttTillstand,
    antal: {
      poster: nyaPoster.filter(p => p.sourceType === 'entry').length,
      resor: nyaPoster.filter(p => p.sourceType === 'trip').length,
      utlagg: nyaPoster.filter(p => p.sourceType === 'expense').length,
      totalt: nyaPoster.length,
      gamlaFakturamarkeringar: nyaPoster.filter(p => p.legacyInvoiceMarked).length,
      kunder: nyttTillstand.clients.length - lista(tillstand?.clients).length,
      uppdrag: nyttTillstand.projects.length - lista(tillstand?.projects).length,
    },
  };
}

export const arImporteradHistorik = post => post?.legacySource === HISTORIK_KALLA;
export const historikBehoverGranskas = post =>
  arImporteradHistorik(post) && post.legacyReviewStatus === HISTORIK_BEHOVER_GRANSKAS;

export function beslutaHistorikpost(tillstand, id, beslut, { nu = new Date().toISOString() } = {}) {
  const tillatna = [HISTORIK_FAKTURERA, HISTORIK_KLAR_I_LUNDIFY, HISTORIK_ENDAST];
  if (!tillatna.includes(beslut)) throw new Error('Välj vad den äldre registreringen ska användas till.');

  let hittad = false;
  const poster = lista(tillstand?.poster).map(p => {
    if (p.id !== id) return p;
    hittad = true;
    if (!arImporteradHistorik(p)) throw new Error('Registreringen kommer inte från den äldre historiken.');
    if (p.invoiceRecordId) throw new Error('Registreringen hör redan till ett Lundify-underlag och kan inte ändras.');
    return {
      ...p,
      legacyReviewStatus: beslut,
      legacyReviewedAt: nu,
      status: beslut === HISTORIK_FAKTURERA ? 'open'
        : beslut === HISTORIK_KLAR_I_LUNDIFY ? 'handled'
          : 'historyOnly',
    };
  });
  if (!hittad) throw new Error('Den äldre registreringen finns inte längre.');
  return { ...tillstand, poster };
}

export function aterstallHistorikbeslut(tillstand, id) {
  return {
    ...tillstand,
    poster: lista(tillstand?.poster).map(p => p.id === id && arImporteradHistorik(p)
      ? { ...p, legacyReviewStatus: HISTORIK_BEHOVER_GRANSKAS, legacyReviewedAt: null, status: 'needsReview' }
      : p),
  };
}
