// Säker komplettering av en befintlig v2-fil med hela historiken från v1.
//
// V1-filen är fortsatt orörd. Saknade rader kopieras till v2 och markeras som
// redan klara i Lundify. Befintliga rättningar av datum och mängd bevaras.
// Endast statusen på poster som säkert kommer från v1 färdigställs.

import { migreraTillV2 } from '../domain/migrering.mjs';
import { kronorTillOre } from '../domain/pengar.mjs';
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

const fastprisId = (projectId, period, index) =>
  `historik-fastpris-${projectId}-${period?.id ?? index + 1}`;

const fastprisSignatur = leverans => [
  leverans?.projectId,
  leverans?.startDate,
  leverans?.endDate,
  leverans?.amountOre,
].join('|');

/**
 * All historik är enligt användaren redan fakturerad och klar i Lundify.
 * Fakturerbart arbete och kostnadsersättningar räknas därför på sina gamla
 * datum, men kan aldrig hamna i ett nytt underlag. Tid som ingår i fast pris,
 * internt eller ideellt arbete behålls bara som historik.
 */
function slutlageForHistorik(gammalt, post) {
  const artikel = lista(gammalt.articles).find(a => a.id === post.articleId);
  const uppdrag = lista(gammalt.projects).find(p => p.id === post.projectId);
  const endastHistorik = !artikel || uppdrag?.kind !== 'billable' || artikel.type === 'trackingOnly';
  return endastHistorik
    ? { legacyReviewStatus: HISTORIK_ENDAST, status: 'historyOnly' }
    : { legacyReviewStatus: HISTORIK_KLAR_I_LUNDIFY, status: 'handled' };
}

/** Skapar en periodiserad, redan fakturerad fastprispost ur ett komplett v1-avtal. */
function fastprisFranV1(project, period, index, nu) {
  const amountOre = kronorTillOre(Number(period?.amount) || 0);
  if (period?.type !== 'fixed' || !period.startDate || !period.endDate || amountOre <= 0) return null;
  if (period.endDate < period.startDate) return null;
  return {
    id: fastprisId(project.id, period, index),
    projectId: project.id,
    name: period.name ?? period.label ?? `${project.name} – fast pris`,
    amountOre,
    vatRate: null,
    vatStatus: 'needsReview',
    needsReview: true,
    reviewNote: 'Historiskt fastpris. Redan fakturerat och klart i Lundify.',
    order: index + 1,
    status: 'invoiced',
    completedAt: period.endDate,
    invoiceRecordId: null,
    priceSnapshot: null,
    startDate: period.startDate,
    endDate: period.endDate,
    legacySource: HISTORIK_KALLA,
    legacyReviewedAt: nu,
  };
}

/**
 * Planerar en full historikimport utan att ändra indata.
 * Returnerar det kompletta nya tillståndet och exakta antal som skulle ändras.
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
      const slutlage = slutlageForHistorik(gammalt, p);
      return {
        ...rad,
        ...slutlage,
        invoiceRecordId: null,
        priceSnapshot: null,
        legacySource: HISTORIK_KALLA,
        legacyInvoiceMarked: markeringar.has(`${p.projectId}|${manad}`),
        legacyOriginalStatus: p.status ?? null,
        legacyReviewedAt: nu,
      };
    });

  // Poster som följde med redan vid nystarten kommer också från v1. De får
  // samma slutläge, men användarens eventuella ändringar av antal och datum
  // bevaras. Låsta poster lämnas helt orörda.
  const gammalPerId = new Map(lista(gammalt.poster).map(p => [p.id, p]));
  let uppdateradePoster = 0;
  const nuvarandePoster = lista(tillstand?.poster).map(p => {
    const original = gammalPerId.get(p.id);
    if (!original || p.invoiceRecordId) return p;
    const slutlage = slutlageForHistorik(gammalt, original);
    const redanKlar = p.legacySource === HISTORIK_KALLA
      && p.legacyReviewStatus === slutlage.legacyReviewStatus
      && p.status === slutlage.status;
    if (redanKlar) return p;
    uppdateradePoster += 1;
    const manad = String(original.date ?? '').slice(0, 7);
    return {
      ...p,
      ...slutlage,
      legacySource: HISTORIK_KALLA,
      legacyInvoiceMarked: markeringar.has(`${original.projectId}|${manad}`),
      legacyOriginalStatus: p.legacyOriginalStatus ?? original.status ?? null,
      legacyReviewedAt: nu,
    };
  });

  const projects = laggTillSaknade(tillstand?.projects, gammalt.projects, p => ({
    ...p, active: false, archivedAt: p.archivedAt ?? nu,
  }));
  const aktuellaProjekt = new Set(lista(tillstand?.projects).filter(p => p.active !== false).map(p => p.id));
  const articles = laggTillSaknade(tillstand?.articles, gammalt.articles, a => ({
    ...a, active: aktuellaProjekt.has(a.projectId),
  }));

  // V1:s fastprisperioder får nu en entydig betydelse: avtalat totalbelopp
  // mellan två datum. De fördelas över kalenderdagar av den befintliga
  // fastprisregeln. Signaturen hindrar dubbelräkning även om samma period
  // redan lagts upp manuellt med ett annat id.
  const befintligaLeveranser = lista(tillstand?.deliverables);
  const leveransIdn = new Set(befintligaLeveranser.map(l => l.id));
  const leveransSignaturer = new Set(befintligaLeveranser.map(fastprisSignatur));
  const nyaFastprisperioder = [];
  for (const project of lista(v1data?.projects)) {
    lista(project.pricingPeriods).forEach((period, index) => {
      const leverans = fastprisFranV1(project, period, index, nu);
      if (!leverans || leveransIdn.has(leverans.id)) return;
      const signatur = fastprisSignatur(leverans);
      if (leveransSignaturer.has(signatur)) return;
      leveransIdn.add(leverans.id);
      leveransSignaturer.add(signatur);
      nyaFastprisperioder.push(leverans);
    });
  }

  const nyttTillstand = {
    ...tillstand,
    clients: laggTillSaknade(tillstand?.clients, gammalt.clients),
    projects,
    articles,
    poster: [...nuvarandePoster, ...nyaPoster],
    deliverables: [...befintligaLeveranser, ...nyaFastprisperioder],
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
      uppdaterade: uppdateradePoster,
      fastprisperioder: nyaFastprisperioder.length,
      totalt: nyaPoster.length + uppdateradePoster + nyaFastprisperioder.length,
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
