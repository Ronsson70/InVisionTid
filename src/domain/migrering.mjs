// Migrering v1 → v2. Ren, idempotent och utan sidoeffekter.
//
// Funktionen läser ingen fil, skriver ingen fil, anropar inget nätverk och tittar
// inte på klockan. Tidsstämplar skickas in. Samma indata ger alltid samma utdata.
//
// Tre regler som styr allt annat:
//
//   1. Ingenting får försvinna. Kontrollsummor räknas före och efter.
//   2. Ingenting får hittas på. Momssatsen migreras inte, den granskas.
//      Fastprisperioder omvandlas inte, de granskas. Gamla fakturamarkeringar
//      blir osäkra referenser utan fakturanummer.
//   3. Andra körningen ska inte skapa någonting nytt.

import { kronorTillOre, sekunderTillTimmarMilli, MILLI } from './pengar.mjs';
import { MOMS_OGRANSKAD } from './moms.mjs';
import { skapaArtikel, artikelId } from './artiklar.mjs';

export const SCHEMA_VERSION = 2;

const MOMSNOTIS =
  'Momssatsen saknas i v1 och måste granskas innan fakturering. '
  + 'En okänd momssats är inte noll procent.';

/** Deterministiskt id för en migrerad fakturareferens. */
export function referensId(projectId, manad) {
  return `ref-${projectId}-${manad}`;
}

/** Kontrollsummor som måste stämma före och efter migreringen. */
export function kontrollsummor(data) {
  const antal = namn => (data?.[namn] || []).length;
  const summa = (namn, falt) => (data?.[namn] || []).reduce((s, x) => s + (Number(x?.[falt]) || 0), 0);
  return {
    clients: antal('clients'),
    projects: antal('projects'),
    entries: antal('entries'),
    expenses: antal('expenses'),
    trips: antal('trips'),
    invoices: antal('invoices'),
    tombstones: Object.keys(data?.deletedIds || {}).length,
    sekunder: summa('entries', 'seconds'),
    km: summa('trips', 'km'),
    utlaggKronor: summa('expenses', 'amount'),
  };
}

/** Jämför före och efter. Returnerar en lista med avvikelser, tom när allt stämmer. */
export function jamforKontrollsummor(fore, efter) {
  const avvikelser = [];
  const farInteMinska = ['clients', 'projects', 'entries', 'expenses', 'trips', 'invoices', 'tombstones'];
  for (const falt of farInteMinska) {
    if (efter[falt] < fore[falt]) {
      avvikelser.push({ falt, fore: fore[falt], efter: efter[falt], regel: 'får inte minska' });
    }
  }
  for (const falt of ['sekunder', 'km', 'utlaggKronor']) {
    if (efter[falt] !== fore[falt]) {
      avvikelser.push({ falt, fore: fore[falt], efter: efter[falt], regel: 'ska vara oförändrad' });
    }
  }
  return avvikelser;
}

/** Sant när uppdraget har ett avtalat fast pris i stället för ett timpris. */
const arFastprisuppdrag = projekt =>
  (projekt?.pricingPeriods || []).some(p => p.type === 'fixed');

/** Artiklar som ska härledas för ett projekt, utifrån vad v1 faktiskt innehåller. */
function harledArtiklar(projekt, data) {
  const artiklar = [];
  const harTrips = (data.trips || []).some(t => t.projectId === projekt.id);
  const harExpenses = (data.expenses || []).some(x => x.projectId === projekt.id);

  const gemensamt = {
    projectId: projekt.id,
    vatRate: null,
    vatStatus: MOMS_OGRANSKAD,
    needsReview: true,
    reviewNote: MOMSNOTIS,
  };

  if (projekt.sessionPrice > 0) {
    artiklar.push(skapaArtikel({
      ...gemensamt,
      id: artikelId(projekt.id, 'session'),
      name: 'Tillfälle',
      type: 'session',
      unitPriceOre: kronorTillOre(projekt.sessionPrice),
      sortOrder: 10,
    }));
  } else if (arFastprisuppdrag(projekt)) {
    // Tid på ett fastprisuppdrag är UPPFÖLJNING, inte en fakturarad.
    //
    // Priset är avtalat. Att göra timmarna fakturerbara hade lagt tid ovanpå
    // ett fast pris och gett en faktura på för mycket. Timpriset finns inte
    // heller — det som fanns i v1 var en periodfördelning, inte ett à-pris.
    artiklar.push(skapaArtikel({
      ...gemensamt,
      id: artikelId(projekt.id, 'trackingOnly'),
      name: 'Nedlagd tid',
      type: 'trackingOnly',
      unitPriceOre: 0,
      sortOrder: 80,
      reviewNote: 'Uppdraget har fast pris. Tiden loggas för uppföljning och blir aldrig en fakturarad.',
    }));
  } else {
    artiklar.push(skapaArtikel({
      ...gemensamt,
      id: artikelId(projekt.id, 'hourly'),
      name: 'Arbetad tid',
      type: 'hourly',
      unitPriceOre: kronorTillOre(projekt.hourlyRate ?? data.hourlyRate ?? 850),
      sortOrder: 10,
      reviewNote: projekt.hourlyRate == null
        ? MOMSNOTIS + ' Timpriset är hämtat från appens standardvärde, inte från uppdraget.'
        : MOMSNOTIS,
    }));
  }

  if (harTrips) {
    artiklar.push(skapaArtikel({
      ...gemensamt,
      id: artikelId(projekt.id, 'travel'),
      name: 'Resa',
      type: 'travel',
      unitPriceOre: kronorTillOre(data.kmRate ?? 2.5),
      sortOrder: 90,
    }));
  }

  if (harExpenses) {
    artiklar.push(skapaArtikel({
      ...gemensamt,
      id: artikelId(projekt.id, 'piece'),
      name: 'Vidarefakturerat utlägg',
      type: 'piece',
      unit: 'kr',
      unitPriceOre: 100,          // 1 kr per enhet, kvantiteten bär beloppet
      sortOrder: 95,
    }));
  }

  return artiklar;
}

/** Artikeln en tidspost ska peka på: tillfälle om projektet har det, annars tid. */
function artikelForPost(projekt) {
  if (projekt.sessionPrice > 0) return artikelId(projekt.id, 'session');
  if (arFastprisuppdrag(projekt)) return artikelId(projekt.id, 'trackingOnly');
  return artikelId(projekt.id, 'hourly');
}

/**
 * Migrerar v1-data till v2.
 *
 * @param {object} v1data
 * @param {object} [opts]
 * @param {string} [opts.nu] ISO-tidsstämpel. Skickas in för att hålla funktionen ren.
 * @returns {object} v2-data
 */
export function migreraTillV2(v1data, opts = {}) {
  const data = structuredClone(v1data || {});
  const nu = opts.nu ?? data.lastSync ?? '2000-01-01T00:00:00.000Z';

  // Idempotens: redan migrerad data lämnas orörd.
  if ((data.schemaVersion || 0) >= SCHEMA_VERSION) return data;

  const fore = kontrollsummor(data);

  const projekt = data.projects || [];
  const projektPerId = new Map(projekt.map(p => [p.id, p]));

  // ── Artiklar ──────────────────────────────────────────────────────────────
  const articles = [];
  for (const p of projekt) articles.push(...harledArtiklar(p, data));

  const reviewQueue = [];
  const laggTillGranskning = post => {
    if (!reviewQueue.some(k => k.id === post.id)) reviewQueue.push(post);
  };

  // ── Kunder och projekt ────────────────────────────────────────────────────
  const clients = (data.clients || []).map(c => ({
    lundifyCustomerId: null,
    defaultPaymentTerms: null,
    invoiceReference: null,
    notes: null,
    ...c,
  }));

  const projects = projekt.map(p => ({
    kind: 'billable',
    series: null,
    active: true,
    sortOrder: 0,
    archivedAt: null,
    ...p,                     // hourlyRate, sessionPrice och pricingPeriods behålls som råvärden
  }));

  // Fastprisperioder omvandlas ALDRIG automatiskt. Råvärdet behålls, en
  // granskningspost skapas per period.
  for (const p of projekt) {
    for (const period of p.pricingPeriods || []) {
      laggTillGranskning({
        id: `gr-period-${p.id}-${period.id}`,
        typ: 'osakert-pris',
        ref: p.id,
        beskrivning:
          `Uppdraget "${p.name}" har en prisperiod av typen ${period.type} på `
          + `${period.amount} kr från ${period.startDate}${period.endDate ? ' till ' + period.endDate : ''}. `
          + 'Innebörden går inte att läsa ur datan: avtalat totalbelopp som faktureras vid leverans, '
          + 'eller periodiserad månadsersättning. Avgör vilken leverans- eller milstolpsmodell som gäller.',
        forslag: null,
        ravarde: structuredClone(period),
        severity: 'varning',
        createdAt: nu,
        resolvedAt: null,
      });
    }
  }

  // ── Tidsposter ────────────────────────────────────────────────────────────
  const entries = (data.entries || []).map(e => {
    const p = projektPerId.get(e.projectId);
    if (!p) {
      return { ...e, articleId: null, qtyMilli: 0, status: 'needsReview', invoiceRecordId: null, priceSnapshot: null };
    }
    const articleId = artikelForPost(p);
    const arTillfalle = p.sessionPrice > 0;

    // v1 räknade unika DATUM, inte antal tillfällen. Åtta pass samma dag ser i v1
    // ut som ett tillfälle. Kvantiteten går alltså inte att härleda — den granskas.
    const qtyMilli = arTillfalle ? MILLI : sekunderTillTimmarMilli(e.seconds || 0);

    if (arTillfalle) {
      laggTillGranskning({
        id: `gr-antal-${e.id}`,
        typ: 'osaker-kvantitet',
        ref: e.id,
        beskrivning:
          `Posten ${e.date} på "${p.name}" har migrerats som 1 tillfälle. `
          + 'v1 räknade unika datum, inte antal, så det verkliga antalet går inte att härleda.',
        forslag: null,
        severity: 'varning',
        createdAt: nu,
        resolvedAt: null,
      });
    }

    return {
      ...e,
      articleId,
      description: e.description ?? e.moment ?? '',
      qtyMilli,
      status: arTillfalle ? 'needsReview' : 'open',
      invoiceRecordId: null,
      priceSnapshot: null,
      updatedAt: e.updatedAt ?? null,
    };
  });

  // ── Resor ─────────────────────────────────────────────────────────────────
  const trips = (data.trips || []).map(t => ({
    ...t,
    articleId: projektPerId.has(t.projectId) ? artikelId(t.projectId, 'travel') : null,
    qtyMilli: Math.round((Number(t.km) || 0) * MILLI),
    suggested: t.suggested ?? false,
    status: 'open',
    invoiceRecordId: null,
    priceSnapshot: null,
    updatedAt: t.updatedAt ?? null,
  }));

  // ── Utlägg ────────────────────────────────────────────────────────────────
  const expenses = (data.expenses || []).map(x => {
    const amountOre = kronorTillOre(Number(x.amount) || 0);
    const saknarUnderlag = !x.description || !String(x.description).trim();
    if (saknarUnderlag) {
      laggTillGranskning({
        id: `gr-utlagg-${x.id}`,
        typ: 'utlagg-utan-kvitto',
        ref: x.id,
        beskrivning: `Utlägget ${x.date} saknar beskrivning och kvittoreferens.`,
        forslag: null,
        severity: 'varning',
        createdAt: nu,
        resolvedAt: null,
      });
    }
    return {
      ...x,
      amountOre,                     // amount behålls parallellt
      articleId: projektPerId.has(x.projectId) ? artikelId(x.projectId, 'piece') : null,
      qtyMilli: Math.round((Number(x.amount) || 0) * MILLI),
      rebillable: x.rebillable ?? true,
      receiptRef: x.receiptRef ?? null,
      hasReceipt: x.hasReceipt ?? false,
      status: saknarUnderlag ? 'needsReview' : 'open',
      invoiceRecordId: null,
      priceSnapshot: null,
      updatedAt: x.updatedAt ?? null,
    };
  });

  // ── Gamla fakturamarkeringar → osäkra referenser ──────────────────────────
  // Ingen post kopplas till dem. Att koppla poster hade betytt att appen påstår
  // att just de posterna fakturerades, vilket den inte vet.
  const invoiceRecords = (data.invoices || []).map(inv => {
    const p = projektPerId.get(inv.projectId);
    const id = referensId(inv.projectId, inv.month);
    laggTillGranskning({
      id: `gr-faktura-${id}`,
      typ: 'omigrerad-fakturamarkering',
      ref: id,
      beskrivning:
        `Fakturamarkering för "${p?.name || inv.projectId}" ${inv.month} är migrerad som osäker. `
        + 'Uppgiften är inte verifierad mot fakturaprogrammet och kan vara fel åt båda håll. '
        + 'Stäm av mot Lundify.',
      forslag: null,
      severity: 'varning',
      createdAt: nu,
      resolvedAt: null,
    });
    return {
      id,
      clientId: p?.clientId ?? null,
      period: inv.month,
      rader: [],                    // vi vet inte vilka poster som ingick
      nettoOre: 0,
      momsUnderlag: {},
      momsOre: 0,
      bruttoForeAvrundningOre: 0,
      avrundningOre: 0,
      attBetalaOre: 0,
      status: 'prepared',           // INTE lundifySent, INTE lundifyPaid
      lundifyDraftId: null,
      lundifyInvoiceId: null,
      invoiceNumber: null,          // ALDRIG påhittat
      invoiceDate: null,
      dueDate: null,
      paidDate: null,
      paymentTerms: null,
      customerReference: null,
      invoiceText: null,
      needsReview: true,
      reviewNote:
        'Migrerad från v1:s fakturamarkering projectId + month. Uppgiften är inte '
        + 'verifierad mot Lundify och kan vara fel åt båda håll.',
      source: 'migrated-from-v1',
      createdAt: nu,
      updatedAt: nu,
      ravarde: structuredClone(inv),
    };
  });

  const ut = {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    clients, projects, articles, entries, deliverables: [], trips, expenses,
    invoiceRecords, reviewQueue,
    invoices: data.invoices || [],   // råvärdet behålls orört
    deletedIds: data.deletedIds || {},
    settings: {
      staleWarningDays: 7,
      defaultPaymentTerms: 30,
      roundToWholeKrona: true,
      migrationConfirmedAt: null,
      ...(data.settings || {}),
    },
  };

  const efter = kontrollsummor(ut);
  ut.migrationLog = [
    ...(data.migrationLog || []),
    {
      at: nu,
      fromVersion: v1data?.schemaVersion ?? 1,
      toVersion: SCHEMA_VERSION,
      skapade: {
        articles: articles.length,
        deliverables: 0,
        invoiceRecords: invoiceRecords.length,
        reviewItems: reviewQueue.length,
      },
      bevarade: fore,
      kontrollsummor: { fore, efter },
      avvikelser: jamforKontrollsummor(fore, efter),
    },
  ];

  return ut;
}

/**
 * Kör migreringen och vägrar leverera ett resultat som tappat data.
 * Det här är den variant produktionsflödet ska använda.
 */
export function migreraSakert(v1data, opts = {}) {
  const fore = kontrollsummor(v1data);
  const ut = migreraTillV2(v1data, opts);
  const efter = kontrollsummor(ut);
  const avvikelser = jamforKontrollsummor(fore, efter);
  if (avvikelser.length) {
    const rader = avvikelser.map(a => `${a.falt}: ${a.fore} → ${a.efter} (${a.regel})`).join('; ');
    throw new Error(`Migreringen avbryts, kontrollsummorna stämmer inte: ${rader}`);
  }
  return { data: ut, fore, efter, avvikelser };
}
