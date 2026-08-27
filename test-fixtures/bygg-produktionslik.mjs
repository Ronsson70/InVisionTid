// Bygger en SANERAD v1-fixtur med samma struktur och samma aggregat som den
// verkliga filen. Inga verkliga namn, belopp eller kunduppgifter — bara formen.
//
// Aggregaten är hämtade ur den verkliga filen och ska stämma exakt:
//
//   157 tidsposter    135 fakturamarkerade    22 öppna
//    87 resor          78 fakturamarkerade     9 öppna
//    23 fakturamarkeringar
//     2 vilande kunder                         2 vilande uppdrag
//
// Fixturen är den som utlöste s.poster-felet: en riktig v1-fil har entries,
// trips och expenses som tre skilda samlingar, aldrig en sammanslagen poster.
//
// Kör: node test-fixtures/bygg-produktionslik.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NU = '2026-08-27T12:00:00.000Z';

const pad = n => String(n).padStart(2, '0');
/** Ett datum i en given månad, spritt men deterministiskt. */
const datum = (manad, i) => `${manad}-${pad((i % 27) + 1)}`;

// ── Kunder: 4 aktiva, 2 vilande ─────────────────────────────────────────────
const kunder = [
  { id: 'k1', name: 'Kund 1' }, { id: 'k2', name: 'Kund 2' },
  { id: 'k3', name: 'Kund 3' }, { id: 'k4', name: 'Kund 4' },
  { id: 'k5', name: 'Kund 5' }, { id: 'k6', name: 'Kund 6' },
].map(k => ({
  ...k, contact: '', phone: '', email: '', orgNr: '', address: '', status: 'active',
}));

// ── Uppdrag: 5 aktiva (P1–P5), 2 vilande (P6–P7) ────────────────────────────
//
// P2 har fast pris. P3 har tillfällespris. Båda måste fortsätta bete sig
// som de gör i den bevisade migreringen.
const uppdrag = [
  { id: 'p1', name: 'Uppdrag 1', clientId: 'k1', sessionPrice: 0, defaultTripKm: 24 },
  {
    id: 'p2', name: 'Uppdrag 2', clientId: 'k1', sessionPrice: 0, defaultTripKm: 18,
    pricingPeriods: [{ id: 'per-1', type: 'fixed', amount: 48000, startDate: '2026-01-01', endDate: '2026-12-31' }],
  },
  { id: 'p3', name: 'Uppdrag 3', clientId: 'k2', sessionPrice: 650, defaultTripKm: 12 },
  { id: 'p4', name: 'Uppdrag 4', clientId: 'k3', sessionPrice: 0, defaultTripKm: 40 },
  { id: 'p5', name: 'Uppdrag 5', clientId: 'k4', sessionPrice: 0, defaultTripKm: 8 },
  { id: 'p6', name: 'Uppdrag 6', clientId: 'k5', sessionPrice: 0, defaultTripKm: 30 },
  { id: 'p7', name: 'Uppdrag 7', clientId: 'k6', sessionPrice: 0, defaultTripKm: 30 },
];

// ── Fakturamarkeringar: 23 stycken ──────────────────────────────────────────
//
// En markering gäller uppdrag + månad. Allt som ligger i en markerad månad
// räknas som fakturerat och stannar i arkivet.
const MARKERADE = {
  p1: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  p2: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  p3: ['2026-01', '2026-02', '2026-03'],
  p4: ['2026-05', '2026-06', '2026-07', '2026-08'],
  p5: ['2026-07', '2026-08'],
  p6: ['2026-01'],
  p7: ['2026-01'],
};
const fakturor = Object.entries(MARKERADE).flatMap(([projectId, manader]) =>
  manader.map(month => ({ projectId, month, invoicedAt: `${month}-28T10:00:00.000Z` })));

// ── Tidsposter: 135 fakturamarkerade + 22 öppna ─────────────────────────────
//
// De öppna ligger i månader som INTE är markerade för sitt uppdrag.
// P2 har 11 och P3 har 5 — samma fördelning som i den verkliga filen.
const MARKERADE_POSTER = { p1: 20, p2: 20, p3: 15, p4: 25, p5: 25, p6: 15, p7: 15 };
const OPPNA_POSTER = { p1: 6, p2: 11, p3: 5 };
const OPPNA_MANADER = ['2026-07', '2026-08'];

const poster = [];
for (const [pid, antal] of Object.entries(MARKERADE_POSTER)) {
  const manader = MARKERADE[pid];
  for (let i = 0; i < antal; i++) {
    const manad = manader[i % manader.length];
    poster.push({
      id: `e-${pid}-m${i}`, projectId: pid, moment: 'Arbete',
      seconds: 3600 + (i % 4) * 1800, date: datum(manad, i),
      createdAt: `${datum(manad, i)}T16:00:00.000Z`,
    });
  }
}
for (const [pid, antal] of Object.entries(OPPNA_POSTER)) {
  for (let i = 0; i < antal; i++) {
    const manad = OPPNA_MANADER[i % OPPNA_MANADER.length];
    poster.push({
      id: `e-${pid}-o${i}`, projectId: pid, moment: 'Arbete',
      seconds: 3600 + (i % 3) * 1800, date: datum(manad, i),
      createdAt: `${datum(manad, i)}T16:00:00.000Z`,
    });
  }
}

// ── Resor: 78 fakturamarkerade + 9 öppna ────────────────────────────────────
const MARKERADE_RESOR = { p1: 12, p2: 12, p3: 10, p4: 14, p5: 14, p6: 8, p7: 8 };
const OPPNA_RESOR = { p1: 4, p2: 3, p3: 2 };

const resor = [];
for (const [pid, antal] of Object.entries(MARKERADE_RESOR)) {
  const manader = MARKERADE[pid];
  for (let i = 0; i < antal; i++) {
    const manad = manader[i % manader.length];
    resor.push({
      id: `t-${pid}-m${i}`, projectId: pid, km: 12 + (i % 5) * 6,
      description: 'Resa', date: datum(manad, i), createdAt: `${datum(manad, i)}T17:00:00.000Z`,
    });
  }
}
for (const [pid, antal] of Object.entries(OPPNA_RESOR)) {
  for (let i = 0; i < antal; i++) {
    const manad = OPPNA_MANADER[i % OPPNA_MANADER.length];
    resor.push({
      id: `t-${pid}-o${i}`, projectId: pid, km: 12 + (i % 5) * 6,
      description: 'Resa', date: datum(manad, i), createdAt: `${datum(manad, i)}T17:00:00.000Z`,
    });
  }
}

// ── Utlägg: alla i markerade månader, alltså inga öppna ─────────────────────
const utlagg = ['p1', 'p2', 'p4', 'p5', 'p6'].map((pid, i) => ({
  id: `x-${pid}-${i}`, projectId: pid, amount: 120 + i * 40,
  description: 'Material', date: datum(MARKERADE[pid][0], i),
  createdAt: `${datum(MARKERADE[pid][0], i)}T18:00:00.000Z`,
}));

export const produktionslikV1 = {
  _kommentar:
    'SANERAD fixtur. Samma struktur och samma aggregat som den verkliga filen, '
    + 'men påhittade namn och belopp. Innehåller ingen kunddata.',
  clients: kunder,
  projects: uppdrag,
  entries: poster,
  expenses: utlagg,
  trips: resor,
  invoices: fakturor,
  deletedIds: {},
  hourlyRate: 850,
  kmRate: 2.5,
  weeklyGoal: 20,
  settings: { staleWarningDays: 14 },
  schemaVersion: 1,
  lastSync: '2026-08-26T21:12:03.000Z',
};

// ── Kontroll: aggregaten måste stämma, annars är fixturen inte produktionslik ──
const manaderFor = pid => new Set(MARKERADE[pid] || []);
const arOppen = x => !manaderFor(x.projectId).has(x.date.slice(0, 7));

export const FORVANTAT = {
  tidsposter: 157, fakturamarkeradePoster: 135, oppnaPoster: 22,
  resor: 87, fakturamarkeradeResor: 78, oppnaResor: 9,
  fakturamarkeringar: 23, vilandeKunder: 2, vilandeUppdrag: 2,
};

export function kontrolleraAggregat() {
  const d = produktionslikV1;
  const fel = [];
  const kolla = (namn, faktiskt, vantat) => {
    if (faktiskt !== vantat) fel.push(`${namn}: ${faktiskt}, väntade ${vantat}`);
  };
  kolla('tidsposter', d.entries.length, FORVANTAT.tidsposter);
  kolla('öppna tidsposter', d.entries.filter(arOppen).length, FORVANTAT.oppnaPoster);
  kolla('fakturamarkerade tidsposter', d.entries.filter(e => !arOppen(e)).length, FORVANTAT.fakturamarkeradePoster);
  kolla('resor', d.trips.length, FORVANTAT.resor);
  kolla('öppna resor', d.trips.filter(arOppen).length, FORVANTAT.oppnaResor);
  kolla('fakturamarkerade resor', d.trips.filter(t => !arOppen(t)).length, FORVANTAT.fakturamarkeradeResor);
  kolla('fakturamarkeringar', d.invoices.length, FORVANTAT.fakturamarkeringar);
  return fel;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fel = kontrolleraAggregat();
  if (fel.length) { console.error('Fixturen stämmer inte:\n  ' + fel.join('\n  ')); process.exit(1); }
  const ut = fileURLToPath(new URL('./v1-produktionslik.json', import.meta.url));
  writeFileSync(ut, JSON.stringify(produktionslikV1, null, 2) + '\n', 'utf8');
  console.log('Skrev ' + ut);
  console.log(`  ${produktionslikV1.entries.length} tidsposter, ${produktionslikV1.trips.length} resor, `
    + `${produktionslikV1.invoices.length} fakturamarkeringar`);
}
