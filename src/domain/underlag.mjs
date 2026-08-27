// Faktureringsunderlag.
//
// Ett underlag hör till en KUND, inte till ett projekt, och pekar explicit på de
// poster som ingår. En faktura har exakt en mottagare, men kan innehålla poster
// från flera uppdrag hos den kunden.
//
// Vid låsning fryses pris och momssats som ett snapshot på varje rad. En senare
// prisändring rör aldrig redan låsta rader.

import { radbeloppOre, MILLI } from './pengar.mjs';
import { summera, momsAnvandbar } from './moms.mjs';
import { artikelLista, hittaArtikel, arFakturerbar, arTidsartikel } from './artiklar.mjs';
import { aterstaendeEfterVal, kontrolleraAvtalstotal } from './leveranser.mjs';

export class OgranskadMoms extends Error {
  constructor(artiklar) {
    const namn = artiklar.map(a => `"${a.name}"`).join(', ');
    super(
      `Underlaget kan inte färdigställas: momssatsen är inte granskad på ${namn}. `
      + 'En okänd momssats är inte noll procent. Granska momsen först.'
    );
    this.name = 'OgranskadMoms';
    this.artiklar = artiklar;
  }
}

/** Bygger en fakturarad ur en post och dess artikel. */
function radFranPost(post, artikel) {
  const unitPriceOre = post.priceSnapshot?.unitPriceOre ?? artikel.unitPriceOre;
  const vatRate = post.priceSnapshot?.vatRate ?? artikel.vatRate;
  return {
    sourceType: post.sourceType || 'entry',
    sourceId: post.id ?? null,
    projectId: artikel.projectId,
    articleId: artikel.id,
    beskrivning: post.beskrivning || post.description || artikel.name,
    qtyMilli: post.qtyMilli,
    unit: post.priceSnapshot?.unit ?? artikel.unit,
    unitPriceOre,
    vatRate,
    nettoOre: radbeloppOre(unitPriceOre, post.qtyMilli),
    lundifyArticleNumber: artikel.lundifyArticleNumber ?? null,
  };
}

/** Bygger en fakturarad ur en fast leverans. */
function radFranLeverans(leverans) {
  return {
    sourceType: 'deliverable',
    sourceId: leverans.id,
    projectId: leverans.projectId ?? null,
    articleId: null,
    beskrivning: leverans.name,
    qtyMilli: MILLI,
    unit: 'st',
    unitPriceOre: leverans.priceSnapshot?.unitPriceOre ?? leverans.amountOre,
    vatRate: leverans.priceSnapshot?.vatRate ?? leverans.vatRate,
    nettoOre: leverans.priceSnapshot?.unitPriceOre ?? leverans.amountOre,
    lundifyArticleNumber: null,
  };
}

/**
 * Bygger ett faktureringsunderlag.
 *
 * @param {object} indata
 * @param {Array|object} indata.artiklar
 * @param {Array} [indata.poster]              tidsposter, resor och utlägg
 * @param {Array} [indata.leveranser]
 * @param {string[]} [indata.valdaLeveranser]
 * @param {object} [indata.avtalsuppgifter]
 * @param {string} indata.clientId             EN mottagare
 * @param {string} [indata.period]
 * @param {boolean} [indata.kravGranskadMoms]  true vid färdigställande
 */
export function byggUnderlag({
  artiklar,
  poster = [],
  leveranser = [],
  valdaLeveranser = [],
  avtalsuppgifter = null,
  clientId,
  period = null,
  kravGranskadMoms = false,
  id = null,
}) {
  const lista = artikelLista(artiklar);

  // Poster delas i fakturerbara och sådana som bara följs upp.
  const fakturerbara = [];
  const uppfoljning = [];
  for (const post of poster) {
    const artikel = hittaArtikel(lista, post.articleId);
    (arFakturerbar(artikel) ? fakturerbara : uppfoljning).push({ post, artikel });
  }

  // Loggad tid redovisas separat och får aldrig påverka beloppet.
  const loggadTidMilli = [...fakturerbara, ...uppfoljning]
    .filter(({ artikel }) => arTidsartikel(artikel))
    .reduce((s, { post }) => s + (post.qtyMilli || 0), 0);

  const valda = new Set(valdaLeveranser);
  const valdaLev = (leveranser || []).filter(l => valda.has(l.id));

  const rader = [
    ...fakturerbara.map(({ post, artikel }) => radFranPost(post, artikel)),
    ...valdaLev.map(radFranLeverans),
  ];

  if (kravGranskadMoms) {
    const ogranskade = fakturerbara
      .map(({ artikel }) => artikel)
      .filter(a => !momsAnvandbar(a));
    const ogranskadeLev = valdaLev.filter(l => l.vatStatus !== 'reviewed' || l.vatRate == null);
    if (ogranskade.length || ogranskadeLev.length) {
      throw new OgranskadMoms([...new Set([...ogranskade, ...ogranskadeLev])]);
    }
  }

  const summering = summera(rader);
  const kontrollflaggor = [];
  const avtalsflagga = kontrolleraAvtalstotal(avtalsuppgifter);
  if (avtalsflagga) kontrollflaggor.push(avtalsflagga);

  return {
    id,
    clientId,
    period,
    rader,
    ...summering,
    loggadTidTimmar: loggadTidMilli / MILLI,
    aterstaendeLeveranser: aterstaendeEfterVal(leveranser, valdaLeveranser),
    kontrollflaggor,
    status: 'prepared',
  };
}

/**
 * Skapar ett underlag av de VALDA posterna och låser dem till det.
 *
 * Ovalda poster lämnas orörda. Valda poster får status 'included', en
 * invoiceRecordId och ett priceSnapshot som fryser pris och momssats.
 *
 * @returns {{underlag: object, poster: Array}} alla poster, låsta och orörda
 */
export function lasUnderlag({
  artiklar,
  poster = [],
  valda = [],
  leveranser = [],
  valdaLeveranser = [],
  avtalsuppgifter = null,
  clientId,
  period = null,
  id = null,
  nu = null,
}) {
  const lista = artikelLista(artiklar);
  const valdaIds = new Set(valda);
  const underlagsId = id || `und-${clientId}-${period || 'utan-period'}`;

  const valdaPoster = poster.filter(p => valdaIds.has(p.id));
  if (!valdaPoster.length && !valdaLeveranser.length) {
    throw new Error('Ett underlag måste innehålla minst en post eller leverans.');
  }

  const underlag = byggUnderlag({
    artiklar: lista,
    poster: valdaPoster,
    leveranser,
    valdaLeveranser,
    avtalsuppgifter,
    clientId,
    period,
    kravGranskadMoms: true,     // färdigställande kräver alltid granskad moms
    id: underlagsId,
  });

  // Snapshot och låsning. Ovalda poster returneras oförändrade.
  const uppdaterade = poster.map(post => {
    if (!valdaIds.has(post.id)) {
      return { ...post, status: post.status || 'open', invoiceRecordId: post.invoiceRecordId ?? null };
    }
    const artikel = hittaArtikel(lista, post.articleId);
    return {
      ...post,
      status: 'included',
      invoiceRecordId: underlagsId,
      priceSnapshot: post.priceSnapshot || {
        unitPriceOre: artikel.unitPriceOre,
        vatRate: artikel.vatRate,
        unit: artikel.unit,
        articleName: artikel.name,
      },
      updatedAt: nu ?? post.updatedAt ?? null,
    };
  });

  return { underlag, poster: uppdaterade };
}

/**
 * Radbelopp före och efter en prisändring, med snapshot på den låsta posten.
 * Låst post behåller sitt pris. Ny post får det nya priset.
 */
export function radbeloppMedSnapshot({ artikel, lastPost, nyPost, nyttPrisOre }) {
  // Posten låses till dagens pris.
  const { poster } = lasUnderlag({
    artiklar: [artikel],
    poster: [{ ...lastPost, sourceType: 'entry' }],
    valda: [lastPost.id],
    clientId: 'kontroll',
    period: null,
  });
  const last = poster.find(p => p.id === lastPost.id);

  // Priset ändras EFTERÅT.
  const nyArtikel = { ...artikel, unitPriceOre: nyttPrisOre };

  const lastRad = radFranPost(last, nyArtikel);      // snapshot ska vinna
  const nyRad = radFranPost({ ...nyPost, sourceType: 'entry' }, nyArtikel);

  return {
    lastPostRadbeloppOre: lastRad.nettoOre,
    nyPostRadbeloppOre: nyRad.nettoOre,
    snapshot: last.priceSnapshot,
  };
}

/** Netto i öre för en uppsättning poster, utan moms och utan avrundning. */
export function nettoOreForPoster(artiklar, poster) {
  const lista = artikelLista(artiklar);
  return poster.reduce((summa, post) => {
    const artikel = hittaArtikel(lista, post.articleId);
    if (!arFakturerbar(artikel)) return summa;
    return summa + radbeloppOre(artikel.unitPriceOre, post.qtyMilli);
  }, 0);
}
