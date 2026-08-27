// Syntetiska acceptansfixtures för In Vision Tid v2.
//
// INGA produktionsdata, inga personuppgifter, inga org.nummer, inga kontaktuppgifter.
// Kunderna heter "Kund A"–"Kund E". Vilket verkligt uppdrag varje bokstav motsvarar
// står i den privata, gitignorerade filen test-fixtures/privat/kundmappning.local.md.
// Prismodellerna kommer från kravspecifikationen, inte från produktionsfilen.
//
// Alla belopp är HELTAL ÖRE. Alla kvantiteter är HELTAL TUSENDELAR av enheten
// (milli-units), så 3 timmar = 3000 och 0,25 timmar = 250. Ingen flyttalsaritmetik
// får förekomma i den slutliga moms- och avrundningsberäkningen.

export const KR = 100;               // 1 krona = 100 öre
export const MILLI = 1000;           // 1 enhet = 1000 milli-units

export const VAT_25 = 2500;          // momssats i hundradels procent (25,00 %)
export const VAT_0 = 0;

/** Momssatsen på behandlingspass är INTE fastställd i källdatan.
 *
 *  Två skilda saker hålls isär:
 *
 *  1. MIGRERING. En artikel som härleds ur v1 får `vatRate: null` och
 *     `vatStatus: 'needsReview'`. Migreringen befäster varken 0 % eller hittar
 *     på 25 %. Ett underlag kan inte färdigställas förrän momsen är granskad.
 *
 *  2. BERÄKNING. T1 testar summeringen GIVET en granskad momssats. Där är
 *     momsen satt till 0 % med `vatStatus: 'reviewed'`, eftersom det är så
 *     acceptanskravet är formulerat. Det är ett medvetet konfigurerat värde,
 *     inte ett värde som migreringen gissat fram.
 */
export const VAT_BEHANDLINGSPASS = VAT_0;

/** Momsstatus på en artikel. Blockerar färdigt underlag så länge den är needsReview. */
export const MOMS_GRANSKAD = 'reviewed';
export const MOMS_OGRANSKAD = 'needsReview';

// ── Artiklar ────────────────────────────────────────────────────────────────
// type: 'hourly' | 'session' | 'piece' | 'travel' | 'fixedDeliverable' | 'trackingOnly'

export const artiklar = {
  A_behandlingspass: {
    id: 'art-a-pass', projectId: 'proj-a-hvb', name: 'Behandlingspass',
    type: 'session', unit: 'pass', unitPriceOre: 240000, vatRate: VAT_BEHANDLINGSPASS,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
    reviewNote: 'Momssatsen är satt till 0 % efter granskning mot avtal. '
      + 'Ändras den ska den granskas om innan nästa underlag färdigställs.',
  },
  A_samtal: {
    id: 'art-a-samtal', projectId: 'proj-a-hvb', name: 'Enskilt samtal och parsamtal',
    type: 'hourly', unit: 'tim', unitPriceOre: 85000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 20,
  },
  A_resa: {
    id: 'art-a-resa', projectId: 'proj-a-hvb', name: 'Resa',
    type: 'travel', unit: 'km', unitPriceOre: 550, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 90,
  },

  B_timme: {
    id: 'art-b-tim', projectId: 'proj-b-stodboende', name: 'Lektion, gruppaktivitet och samtal',
    type: 'hourly', unit: 'tim', unitPriceOre: 85000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
  },
  B_resa: {
    id: 'art-b-resa', projectId: 'proj-b-stodboende', name: 'Resa',
    type: 'travel', unit: 'km', unitPriceOre: 550, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 90,
  },

  C_isspolning: {
    id: 'art-c-is', projectId: 'proj-c-drift', name: 'Isspolning',
    type: 'piece', unit: 'st', unitPriceOre: 35000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
  },
  C_admin: {
    id: 'art-c-adm', projectId: 'proj-c-admin', name: 'Administration och övrigt arbete',
    type: 'hourly', unit: 'tim', unitPriceOre: 35000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 20,
  },

  D_verkstad: {
    id: 'art-d-verkstad', projectId: 'proj-d-serie1', name: 'Genomförd verkstad',
    type: 'fixedDeliverable', unit: 'st', unitPriceOre: 5000000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
  },
  D_tid: {
    id: 'art-d-tid', projectId: 'proj-d-serie1', name: 'Nedlagd tid för uppföljning',
    type: 'trackingOnly', unit: 'tim', unitPriceOre: 0, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: false, active: true, sortOrder: 80,
  },

  E_del: {
    id: 'art-e-del', projectId: 'proj-e-forstudie', name: 'Delfakturering förstudie',
    type: 'fixedDeliverable', unit: 'st', unitPriceOre: 1500000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
  },

  // Kund C har TRE uppdrag. Det tredje är ett eget uppdrag hos samma kund, med
  // eget timpris, och används av T6 tillsammans med administrationsuppdraget.
  C_uppdrag3_timme: {
    id: 'art-c-u3-tim', projectId: 'proj-c-uppdrag3', name: 'Konsulttid',
    type: 'hourly', unit: 'tim', unitPriceOre: 44000, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 10,
  },
  C_uppdrag3_utlagg: {
    id: 'art-c-u3-utl', projectId: 'proj-c-uppdrag3', name: 'Vidarefakturerat utlägg',
    type: 'piece', unit: 'kr', unitPriceOre: 100, vatRate: VAT_25,
    vatStatus: MOMS_GRANSKAD,
    billable: true, active: true, sortOrder: 95,
  },
};

// ── Acceptansfall ───────────────────────────────────────────────────────────
// Varje fall bär sina egna poster OCH sitt förväntade utfall, så testet aldrig
// räknar fram facit själv.

export const T1 = {
  id: 'T1',
  namn: 'Kund A, behandlingshem – juni 2026, blandad moms',
  clientId: 'kund-a', period: '2026-06',
  defaultTripKm: 23,
  poster: [
    { articleId: 'art-a-pass', date: '2026-06-02', qtyMilli: 8 * MILLI, beskrivning: 'Behandlingspass' },
    { articleId: 'art-a-samtal', date: '2026-06-09', qtyMilli: 3 * MILLI, beskrivning: 'Enskilda samtal' },
    { articleId: 'art-a-resa', date: '2026-06-09', qtyMilli: 230 * MILLI, beskrivning: 'Resor juni' },
  ],
  forvantat: {
    nettoOre: 2301500,                    // 19 200,00 + 2 550,00 + 1 265,00
    momsUnderlag: { [VAT_0]: 1920000, [VAT_25]: 381500 },
    momsOre: 95375,                       // 3 815,00 * 25 %
    bruttoForeAvrundningOre: 2396875,     // 23 968,75
    avrundningOre: 25,                    // +0,25
    attBetalaOre: 2396900,                // 23 969 kr
  },
};

export const T2 = {
  id: 'T2',
  namn: 'Kund B, stödboende – maj 2026, ROUND_HALF_UP på halvöre',
  clientId: 'kund-b', period: '2026-05',
  poster: [
    { articleId: 'art-b-tim', date: '2026-05-06', qtyMilli: 13 * MILLI, beskrivning: 'Lektioner och samtal' },
    { articleId: 'art-b-resa', date: '2026-05-06', qtyMilli: 67 * MILLI, beskrivning: 'Resor maj' },
  ],
  forvantat: {
    nettoOre: 1141850,                    // 11 050,00 + 368,50
    momsUnderlag: { [VAT_25]: 1141850 },
    momsOre: 285463,                      // 285 462,5 öre → ROUND_HALF_UP
    bruttoForeAvrundningOre: 1427313,     // 14 273,13
    avrundningOre: -13,                   // −0,13
    attBetalaOre: 1427300,                // 14 273 kr
  },
};

export const T3 = {
  id: 'T3',
  namn: 'Kund C, eventbolag – juni 2026, styckpris och timpris på samma faktura',
  clientId: 'kund-c', period: '2026-06',
  poster: [
    { articleId: 'art-c-is', date: '2026-06-04', qtyMilli: 12 * MILLI, beskrivning: 'Isspolning' },
    { articleId: 'art-c-adm', date: '2026-06-11', qtyMilli: 9 * MILLI, beskrivning: 'Administration' },
  ],
  forvantat: {
    nettoOre: 735000,                     // 4 200,00 + 3 150,00
    momsUnderlag: { [VAT_25]: 735000 },
    momsOre: 183750,
    bruttoForeAvrundningOre: 918750,      // 9 187,50
    avrundningOre: 50,                    // +0,50
    attBetalaOre: 918800,                 // 9 188 kr
  },
};

export const T4 = {
  id: 'T4',
  namn: 'Kund D, utbildningsbolag – fast leverans, loggad tid påverkar inte beloppet',
  clientId: 'kund-d', period: '2026-06',
  poster: [
    { articleId: 'art-d-verkstad', date: '2026-06-17', qtyMilli: 1 * MILLI, beskrivning: 'Verkstad 1 i serie 1' },
    // Nedlagd tid loggas men är trackingOnly och får ALDRIG hamna på fakturan.
    { articleId: 'art-d-tid', date: '2026-06-17', qtyMilli: 12 * MILLI, beskrivning: 'Förberedelse och genomförande' },
  ],
  forvantat: {
    nettoOre: 5000000,
    momsUnderlag: { [VAT_25]: 5000000 },
    momsOre: 1250000,
    bruttoForeAvrundningOre: 6250000,
    avrundningOre: 0,
    attBetalaOre: 6250000,
    loggadTidTimmar: 12,                  // ska redovisas separat, inte i beloppet
    antalFakturarader: 1,
  },
};

export const T5 = {
  id: 'T5',
  namn: 'Kund E, förstudie – delfakturering 1 av 4 med öppen avtalsfråga',
  clientId: 'kund-e', period: '2026-06',
  leveranser: [
    { id: 'lev-e-1', name: 'Förstudie del 1 av 4', amountOre: 1500000, vatRate: VAT_25, order: 1, status: 'open' },
    { id: 'lev-e-2', name: 'Förstudie del 2 av 4', amountOre: 1500000, vatRate: VAT_25, order: 2, status: 'open' },
    { id: 'lev-e-3', name: 'Förstudie del 3 av 4', amountOre: 1500000, vatRate: VAT_25, order: 3, status: 'open' },
    { id: 'lev-e-4', name: 'Förstudie del 4 av 4', amountOre: 1500000, vatRate: VAT_25, order: 4, status: 'open' },
  ],
  valdLeverans: 'lev-e-1',
  // Öppen fråga: 4 × 15 000 = 60 000 kr, men en tidigare uppgift motsvarar 64 000 kr.
  // Appen får INTE gissa ett totalpris. Den ska flagga skillnaden.
  avtalsuppgifter: { summaAvDelarOre: 6000000, tidigareUppgiftOre: 6400000 },
  forvantat: {
    fakturaradNamn: 'Förstudie del 1 av 4',
    nettoOre: 1500000,
    momsOre: 375000,
    attBetalaOre: 1875000,
    aterstaendeDelar: 3,
    kontrollflagga: true,
    kontrollflaggaDiffOre: 400000,        // 64 000 − 60 000
  },
};

// EN kund, EN fakturamottagare, TVÅ uppdrag på samma faktura.
// Motsvarar en verklig faktura där underlaget kom från två skilda uppdrag hos
// samma kund. Det är alltså inte två fakturamottagare — det finns bara en.
export const T6 = {
  id: 'T6',
  namn: 'Kund C – en faktura med underlag från två uppdrag hos samma kund',
  clientId: 'kund-c', period: '2026-06',
  // Poster som SKA väljas, från två olika uppdrag
  valda: [
    { id: 'post-t6-1', articleId: 'art-c-u3-tim', date: '2026-06-03', qtyMilli: 4 * MILLI, beskrivning: 'Rådgivning' },
    { id: 'post-t6-2', articleId: 'art-c-u3-utl', date: '2026-06-03', qtyMilli: 1250 * MILLI, beskrivning: 'Vidarefakturerat utlägg, kvitto bifogat' },
    { id: 'post-t6-3', articleId: 'art-c-adm', date: '2026-06-10', qtyMilli: 6 * MILLI, beskrivning: 'Administration' },
  ],
  // Post som INTE valts och som inte får påverkas
  ejVald: { id: 'post-t6-4', articleId: 'art-c-adm', date: '2026-06-24', qtyMilli: 2 * MILLI, beskrivning: 'Administration efter brytdatum' },
  forvantat: {
    antalRader: 3,
    antalKunder: 1,
    projektIUnderlaget: ['proj-c-admin', 'proj-c-uppdrag3'],
    nettoOre: 511000,                     // 1 760,00 + 1 250,00 + 2 100,00
    momsOre: 127750,                      // 5 110,00 * 25 %
    bruttoForeAvrundningOre: 638750,      // 6 387,50
    avrundningOre: 50,
    attBetalaOre: 638800,                 // 6 388 kr
    ejValdStatusEfterat: 'open',
    ejValdInvoiceRecordId: null,
  },
};

export const T7 = {
  id: 'T7',
  namn: 'Reseförslag – standardresa 23 km, flera arbetsposter samma dag ger ETT förslag',
  projectId: 'proj-a-hvb',
  defaultTripKm: 23,
  datum: '2026-06-09',
  poster: [
    { articleId: 'art-a-pass', date: '2026-06-09', qtyMilli: 1 * MILLI },
    { articleId: 'art-a-samtal', date: '2026-06-09', qtyMilli: 1 * MILLI },
  ],
  forvantat: { antalForslag: 1, km: 23 },
};

export const T8 = {
  id: 'T8',
  namn: 'Blandade artiklar samma dag – ett pass OCH ett timdebiterat samtal',
  projectId: 'proj-a-hvb',
  datum: '2026-06-09',
  poster: [
    { articleId: 'art-a-pass', date: '2026-06-09', qtyMilli: 1 * MILLI },
    { articleId: 'art-a-samtal', date: '2026-06-09', qtyMilli: 1 * MILLI },
  ],
  forvantat: {
    nettoOreForeResa: 325000,             // 2 400,00 + 850,00 = 3 250,00
  },
};

export const T11 = {
  id: 'T11',
  namn: 'Prisändring – låst post behåller sitt snapshotspris',
  articleId: 'art-b-tim',
  prisFore: 85000,
  prisEfter: 90000,
  lastPost: { id: 'post-b-last', articleId: 'art-b-tim', date: '2026-05-06', qtyMilli: 1 * MILLI },
  nyPost: { id: 'post-b-ny', articleId: 'art-b-tim', date: '2026-07-01', qtyMilli: 1 * MILLI },
  forvantat: { lastPostRadbeloppOre: 85000, nyPostRadbeloppOre: 90000 },
};

export const T13 = {
  id: 'T13',
  namn: 'Lundify-flöde utan påhittat fakturanummer',
  steg: [
    { status: 'prepared', invoiceNumber: null, beskrivning: 'Förberett underlag i In Vision Tid' },
    { status: 'lundifyDraft', invoiceNumber: null, beskrivning: 'Överfört till utkast i Lundify' },
    { status: 'lundifySent', invoiceNumber: '2026-118', beskrivning: 'Skickad i Lundify med verkligt fakturanummer' },
    { status: 'lundifyPaid', invoiceNumber: '2026-118', beskrivning: 'Betald enligt Lundify' },
  ],
  forvantat: {
    fakturanummerSaknasIUtkast: true,
    utkastRaknasEjSomSkickad: true,
    nummerKravsForSkickad: true,
  },
};

export const alla = { T1, T2, T3, T4, T5, T6, T7, T8, T11, T13 };
