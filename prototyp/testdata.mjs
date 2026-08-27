// Pseudonymiserade testdata för användartestversionen.
//
// INGA produktionsdata. Kunderna heter Kund A, B och C. Priserna kommer från
// kravspecifikationen, inte från produktionsfilen.
//
// Datat täcker de sju testscenarierna:
//   1. två behandlingstillfällen och en resa samma dag
//   2. ett timdebiterat samtal samma dag
//   3. ett fastprisuppdrag med loggad tid som inte påverkar fakturabeloppet
//   4. en uttrycklig fastprisleverans
//   5. en artikel med ogranskad moms som blockerar underlaget
//   6. en intern aktivitet som inte får faktureras
//   7. ändring och borttagning provas i gränssnittet

const MILLI = 1000;

/** Datum relativt "idag", så testdatat aldrig blir gammalt. */
export function datum(dagarSedan = 0, idag = new Date()) {
  const d = new Date(idag);
  d.setDate(d.getDate() - dagarSedan);
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/** Datum framåt i tiden. */
function omDagar(antal, idag = new Date()) { return datum(-antal, idag); }

/** Ett datum plus eller minus ett antal dagar. */
function plusDagar(datumStr, antal) {
  const d = new Date(datumStr + 'T12:00:00');
  d.setDate(d.getDate() + antal);
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

export function skapaTestdata(idag = new Date()) {
  const iDag = datum(0, idag);
  const iGar = datum(1, idag);
  const treDarSedan = datum(3, idag);
  const femDarSedan = datum(5, idag);

  // En avtalsperiod på 91 dagar, som ett kvartal. 100 000 kr fördelat över
  // perioden ger 7 692,30 kr för en hel vecka.
  const periodStart = datum(45, idag);
  const periodSlut = omDagar(45, idag);

  // Verkstad 1 upparbetas över fyra hela veckor, med innevarande vecka som
  // vecka tre. Verkstad 2 ligger de fyra veckorna därefter.
  const veckodag = idag.getDay();
  const dennaVeckasMandag = plusDagar(datum(0, idag), veckodag === 0 ? -6 : 1 - veckodag);

  const verkstad1Start = plusDagar(dennaVeckasMandag, -14);
  const verkstad1Slut = plusDagar(verkstad1Start, 27);     // 28 dagar, fyra veckor
  const verkstad2Start = plusDagar(verkstad1Slut, 1);
  const verkstad2Slut = plusDagar(verkstad2Start, 27);

  return {
    // Ett frivilligt veckomål i kronor. Inget annat.
    // Appen räknar inte lön, skatt, avgifter eller budget.
    installningar: {
      veckomalOre: 2500000,      // 25 000 kr, påhittat testvärde. null = inget mål.
    },

    clients: [
      { id: 'k-a', name: 'Kund A' },
      { id: 'k-b', name: 'Kund B' },
      { id: 'k-c', name: 'Kund C' },
      { id: 'k-d', name: 'Kund D' },
      { id: 'k-eget', name: 'Eget bolag' },
    ],

    projects: [
      { id: 'u-behandling', name: 'Behandling', clientId: 'k-a', kind: 'billable', defaultTripKm: 23, sortOrder: 1 },
      { id: 'u-lektioner', name: 'Lektioner', clientId: 'k-b', kind: 'billable', defaultTripKm: 34, sortOrder: 2 },
      { id: 'u-verkstad', name: 'Verkstadsserie', clientId: 'k-c', kind: 'billable', defaultTripKm: null, sortOrder: 3 },
      { id: 'u-avtal', name: 'Löpande avtal', clientId: 'k-d', kind: 'billable', defaultTripKm: null, sortOrder: 4 },
      { id: 'u-internt', name: 'Internt bolagsarbete', clientId: 'k-eget', kind: 'internal', defaultTripKm: null, sortOrder: 5 },
    ],

    articles: [
      // Kund A — granskad moms, går att fakturera
      { id: 'a-tillfalle', projectId: 'u-behandling', name: 'Behandlingstillfälle',
        type: 'session', unit: 'pass', unitPriceOre: 240000, vatRate: 0, vatStatus: 'reviewed',
        billable: true, active: true, sortOrder: 10 },
      { id: 'a-samtal', projectId: 'u-behandling', name: 'Samtal',
        type: 'hourly', unit: 'tim', unitPriceOre: 85000, vatRate: 2500, vatStatus: 'reviewed',
        billable: true, active: true, sortOrder: 20 },
      { id: 'a-resa-a', projectId: 'u-behandling', name: 'Resa',
        type: 'travel', unit: 'km', unitPriceOre: 550, vatRate: 2500, vatStatus: 'reviewed',
        billable: true, active: true, sortOrder: 90 },

      // Scenario 5 — Kund B har en artikel vars moms inte är granskad.
      // Underlaget för Kund B ska blockeras med ett begripligt besked.
      { id: 'b-timme', projectId: 'u-lektioner', name: 'Lektion',
        type: 'hourly', unit: 'tim', unitPriceOre: 85000, vatRate: null, vatStatus: 'needsReview',
        billable: true, active: true, sortOrder: 10,
        reviewNote: 'Momssatsen är inte fastställd för det här uppdraget.' },
      { id: 'b-resa', projectId: 'u-lektioner', name: 'Resa',
        type: 'travel', unit: 'km', unitPriceOre: 550, vatRate: 2500, vatStatus: 'reviewed',
        billable: true, active: true, sortOrder: 90 },

      // Scenario 3 — fastprisuppdrag. Tiden loggas men faktureras aldrig.
      { id: 'c-tid', projectId: 'u-verkstad', name: 'Nedlagd tid',
        type: 'trackingOnly', unit: 'tim', unitPriceOre: 0, vatRate: 2500, vatStatus: 'reviewed',
        billable: false, active: true, sortOrder: 80 },

      // Scenario 6 — internt arbete. Loggas, faktureras aldrig.
      { id: 'i-tid', projectId: 'u-internt', name: 'Internt arbete',
        type: 'trackingOnly', unit: 'tim', unitPriceOre: 0, vatRate: 0, vatStatus: 'reviewed',
        billable: false, active: true, sortOrder: 10 },
    ],

    // Scenario 4 — en uttrycklig leverans. Faktureras bara om den väljs.
    deliverables: [
      // Verkstad 1: 50 000 kr som tjänas in över fyra veckor. Den aktuella
      // veckan ligger mitt i perioden, så veckovyn visar en veckoandel — inte
      // hela beloppet den dag leveransen markerades genomförd.
      { id: 'lev-verkstad-1', projectId: 'u-verkstad', name: 'Verkstad 1, genomförd',
        amountOre: 5000000, vatRate: 2500, vatStatus: 'reviewed',
        order: 1, status: 'open', completedAt: treDarSedan, invoiceRecordId: null,
        startDate: verkstad1Start, endDate: verkstad1Slut },

      // Verkstad 2: samma belopp, period som ligger framåt. Inte genomförd, och
      // kan därför inte tas med i ett underlag.
      { id: 'lev-verkstad-2', projectId: 'u-verkstad', name: 'Verkstad 2, planerad',
        amountOre: 5000000, vatRate: 2500, vatStatus: 'reviewed',
        order: 2, status: 'planned', completedAt: null, invoiceRecordId: null,
        startDate: verkstad2Start, endDate: verkstad2Slut },

      // Fastpris för en AVTALSPERIOD. Tjänas in successivt och fördelas över
      // periodens dagar när "Jobbat in" räknas. Faktureras enligt avtalet, inte
      // per vecka.
      { id: 'lev-avtal', projectId: 'u-avtal', name: 'Löpande avtal, kvartal',
        amountOre: 10000000, vatRate: 2500, vatStatus: 'reviewed',
        order: 1, status: 'open', completedAt: null, invoiceRecordId: null,
        startDate: periodStart, endDate: periodSlut },

      // Fastprisperiod där uppgifterna saknas. Ska INTE räknas in, och ska
      // visas som något som behöver kompletteras.
      { id: 'lev-ofullstandig', projectId: 'u-avtal', name: 'Avtal utan slutdatum',
        amountOre: 5000000, vatRate: 2500, vatStatus: 'reviewed',
        order: 2, status: 'open', completedAt: null, invoiceRecordId: null,
        startDate: periodStart, endDate: null },
    ],

    poster: [
      // Scenario 1 — två behandlingstillfällen och en resa samma dag
      { id: 'p-1', projectId: 'u-behandling', articleId: 'a-tillfalle', date: iGar,
        beskrivning: 'Behandlingstillfälle', qtyMilli: 2 * MILLI, seconds: 10800,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },
      { id: 'p-2', projectId: 'u-behandling', articleId: 'a-resa-a', date: iGar,
        beskrivning: 'Resa tur och retur', qtyMilli: 23 * MILLI, seconds: null,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },

      // Scenario 2 — ett timdebiterat samtal samma dag
      { id: 'p-3', projectId: 'u-behandling', articleId: 'a-samtal', date: iGar,
        beskrivning: 'Enskilt samtal', qtyMilli: 1 * MILLI, seconds: 3600,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },

      // Scenario 3 — loggad tid på fastprisuppdrag
      { id: 'p-4', projectId: 'u-verkstad', articleId: 'c-tid', date: treDarSedan,
        beskrivning: 'Förberedelse och genomförande', qtyMilli: 6 * MILLI, seconds: 21600,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },

      // Scenario 5 — timarbete hos Kund B, vars moms inte är granskad
      { id: 'p-5', projectId: 'u-lektioner', articleId: 'b-timme', date: femDarSedan,
        beskrivning: 'Lektion', qtyMilli: 3 * MILLI, seconds: 10800,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },

      // Dag med arbete men UTAN resa — Vecka ska flagga den
      { id: 'p-6', projectId: 'u-behandling', articleId: 'a-tillfalle', date: femDarSedan,
        beskrivning: 'Behandlingstillfälle', qtyMilli: 1 * MILLI, seconds: 5400,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },

      // Scenario 6 — internt arbete
      { id: 'p-7', projectId: 'u-internt', articleId: 'i-tid', date: iDag,
        beskrivning: 'Bokföring och administration', qtyMilli: 2 * MILLI, seconds: 7200,
        status: 'open', invoiceRecordId: null, priceSnapshot: null },
    ],

    invoiceRecords: [],
  };
}
