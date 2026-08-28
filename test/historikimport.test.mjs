import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planeraHistorikimport, beslutaHistorikpost, aterstallHistorikbeslut,
  HISTORIK_FAKTURERA, HISTORIK_KLAR_I_LUNDIFY, HISTORIK_ENDAST, OPPEN_FAKTURERING_FRAN,
} from '../src/app/historikimport.mjs';
import { franAppTillstand, tillAppTillstand } from '../src/app/tillstand.mjs';
import * as L from '../src/app/logik.mjs';

const NU = '2026-08-27T20:00:00.000Z';
const v1 = () => ({
  clients: [{ id: 'c1', name: 'Kund Ett' }, { id: 'c2', name: 'Kund Två' }],
  projects: [
    { id: 'p1', clientId: 'c1', name: 'Timuppdrag', hourlyRate: 900 },
    { id: 'p2', clientId: 'c2', name: 'Fast uppdrag', pricingPeriods: [
      { id: 'pp1', type: 'fixed', amount: 50000, startDate: '2026-03-01', endDate: '2026-03-31' },
    ] },
  ],
  entries: [
    { id: 'e1', projectId: 'p1', date: '2026-03-04', moment: 'Möte', seconds: 3600 },
    { id: 'e2', projectId: 'p2', date: '2026-03-05', moment: 'Verkstad', seconds: 7200 },
  ],
  trips: [{ id: 't1', projectId: 'p1', date: '2026-03-04', description: 'Resa', km: 23 }],
  expenses: [{ id: 'x1', projectId: 'p1', date: '2026-03-04', description: 'Material', amount: 125 }],
  invoices: [{ projectId: 'p1', month: '2026-03' }],
  kmRate: 5.5,
});

const tomt = () => ({
  clients: [], projects: [], articles: [], poster: [], deliverables: [], invoiceRecords: [],
  reviewQueue: [], migrationLog: [], installningar: { veckomalOre: null, manadsmalOre: null },
});

test('hela v1-historiken planeras för v2 utan att en rad försvinner', () => {
  const plan = planeraHistorikimport(v1(), tomt(), { nu: NU });
  assert.deepEqual(plan.antal, {
    poster: 2, resor: 1, utlagg: 1, uppdaterade: 0, fastprisperioder: 1,
    uppdateradeFastprisperioder: 0, totalt: 5,
    gamlaFakturamarkeringar: 3, kunder: 2, uppdrag: 2,
  });
  assert.deepEqual(new Set(plan.tillstand.poster.map(p => p.id)), new Set(['e1', 'e2', 't1', 'x1']));
  assert.equal(plan.tillstand.poster.find(p => p.id === 'e1').legacyReviewStatus, HISTORIK_KLAR_I_LUNDIFY);
  assert.equal(plan.tillstand.poster.find(p => p.id === 'e2').legacyReviewStatus, HISTORIK_ENDAST);
  assert.ok(plan.tillstand.poster.filter(p => ['e1', 't1', 'x1'].includes(p.id)).every(p => p.status === 'handled'));
  assert.equal(plan.tillstand.deliverables[0].status, 'invoiced');
  assert.equal(plan.tillstand.deliverables[0].amountOre, 5000000);
});

test('31 juli är sista låsta dagen och 1 augusti är öppet för fakturering', () => {
  const data = v1();
  data.entries = [
    { id: 'juli', projectId: 'p1', date: '2026-07-31', moment: 'Juli', seconds: 3600 },
    { id: 'augusti', projectId: 'p1', date: OPPEN_FAKTURERING_FRAN, moment: 'Augusti', seconds: 3600 },
  ];
  data.trips = [];
  data.expenses = [];
  const s = planeraHistorikimport(data, tomt(), { nu: NU }).tillstand;
  const juli = s.poster.find(p => p.id === 'juli');
  const augusti = s.poster.find(p => p.id === 'augusti');

  assert.equal(juli.status, 'handled');
  assert.equal(juli.legacyReviewStatus, HISTORIK_KLAR_I_LUNDIFY);
  assert.equal(augusti.status, 'open');
  assert.equal(augusti.legacyReviewStatus, HISTORIK_FAKTURERA);
  assert.ok(L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'augusti')));
  assert.ok(!L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'juli')));
});

test('en post som tidigare låstes från 1 augusti öppnas igen', () => {
  const data = v1();
  data.entries = [{ id: 'augusti', projectId: 'p1', date: '2026-08-10', moment: 'Augusti', seconds: 3600 }];
  data.trips = [];
  data.expenses = [];
  const migrerad = planeraHistorikimport(data, tomt(), { nu: NU }).tillstand;
  const felaktigtLast = {
    ...migrerad,
    poster: migrerad.poster.map(p => p.id === 'augusti'
      ? { ...p, status: 'handled', legacyReviewStatus: HISTORIK_KLAR_I_LUNDIFY } : p),
  };
  const plan = planeraHistorikimport(data, felaktigtLast, { nu: NU });
  assert.equal(plan.tillstand.poster.find(p => p.id === 'augusti').status, 'open');
  assert.equal(plan.antal.uppdaterade, 1);
});

test('fastpris som slutar efter gränsen är öppet för upparbetning men inte automatiskt genomfört', () => {
  const data = v1();
  data.projects[1].pricingPeriods = [
    { id: 'aug', type: 'fixed', amount: 50000, startDate: '2026-08-01', endDate: '2026-08-31' },
  ];
  const plan = planeraHistorikimport(data, tomt(), { nu: NU });
  const l = plan.tillstand.deliverables[0];
  assert.equal(l.status, 'planned');
  assert.equal(l.completedAt, null);
  assert.equal(L.manadsSammanstallning(plan.tillstand, '2026-08').delar.fastPrisAndelOre, 5000000);
});

test('befintlig v2-post vinner och importen skapar aldrig dubbletter', () => {
  const nuvarande = { ...tomt(), poster: [{ id: 'e1', projectId: 'egen', articleId: 'egen', sourceType: 'entry', date: '2026-03-04' }] };
  const plan = planeraHistorikimport(v1(), nuvarande, { nu: NU });
  assert.equal(plan.tillstand.poster.filter(p => p.id === 'e1').length, 1);
  assert.equal(plan.tillstand.poster.find(p => p.id === 'e1').projectId, 'egen');

  const igen = planeraHistorikimport(v1(), plan.tillstand, { nu: NU });
  assert.equal(igen.antal.totalt, 0);
  assert.equal(igen.tillstand.poster.length, plan.tillstand.poster.length);
});

test('planeringen ändrar varken v1 eller befintlig v2', () => {
  const gammal = v1();
  const aktuell = tomt();
  const foreGammal = JSON.stringify(gammal);
  const foreAktuell = JSON.stringify(aktuell);
  planeraHistorikimport(gammal, aktuell, { nu: NU });
  assert.equal(JSON.stringify(gammal), foreGammal);
  assert.equal(JSON.stringify(aktuell), foreAktuell);
});

test('gammal historik räknas på ursprungsdatumen men kan aldrig faktureras igen', () => {
  const s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  const datum = ['2026-03-04', '2026-03-05'];
  assert.equal(L.jobbatIn(s, datum).jobbatInOre, 412582); // 900 kr + två fastprisdagar
  assert.equal(L.underlagsgrupper(s).length, 0);
  assert.equal(L.fakturaunderlagForDag(s, '2026-03-04').beloppOre, 0,
    'dagens underlag är noll även om det historiska arbetets värde visas');
  assert.equal(L.manadsSammanstallning(s, '2026-03').fakturaunderlagOre, 0);
});

test('Ska faktureras räknar arbetet och gör posten tillgänglig för underlag', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_FAKTURERA, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'open');
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 251291); // 900 kr + fastprisdag
  assert.ok(L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'e1')));
});

test('Redan klart i Lundify räknar utfört arbete men kan inte faktureras igen', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_KLAR_I_LUNDIFY, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'handled');
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 251291);
  assert.ok(!L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'e1')));
});

test('Endast historik behåller tid och rad men inga pengar', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_ENDAST, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'historyOnly');
  assert.equal(L.arbetadTidSekunder(s.poster.filter(p => p.id === 'e1')), 3600);
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 161291, 'bara fastprisandelen återstår');
});

test('ett tidigare needsReview-läge färdigmarkeras utan att användarens rättning skrivs över', () => {
  const aktuell = tomt();
  aktuell.clients = [{ id: 'c1', name: 'Kund Ett' }];
  aktuell.projects = [{ id: 'p1', clientId: 'c1', name: 'Timuppdrag', kind: 'billable' }];
  aktuell.articles = [{ id: 'art-p1-hourly', projectId: 'p1', type: 'hourly', unit: 'tim', unitPriceOre: 90000, billable: true }];
  aktuell.poster = [{
    id: 'e1', projectId: 'p1', articleId: 'art-p1-hourly', sourceType: 'entry',
    date: '2026-03-06', qtyMilli: 1500, seconds: 5400, status: 'needsReview',
    legacySource: 'v1-full-history', legacyReviewStatus: 'needsReview',
  }];

  const plan = planeraHistorikimport(v1(), aktuell, { nu: NU });
  const post = plan.tillstand.poster.find(p => p.id === 'e1');
  assert.equal(plan.antal.uppdaterade, 1);
  assert.equal(post.status, 'handled');
  assert.equal(post.legacyReviewStatus, HISTORIK_KLAR_I_LUNDIFY);
  assert.equal(post.date, '2026-03-06', 'rättat datum bevaras');
  assert.equal(post.qtyMilli, 1500, 'rättad mängd bevaras');
});

test('fastpriset fördelas över både hela månaden och en vecka utan dubbelräkning', () => {
  const s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  const mars = L.manadsSammanstallning(s, '2026-03');
  assert.equal(mars.delar.fastPrisAndelOre, 5000000, 'hela mars får exakt avtalsbeloppet');
  const vecka = L.sammanstallning(s, ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
  assert.equal(vecka.delar.fastPrisAndelOre, 1129037);
  assert.equal(L.underlagsgrupper(s).length, 0, 'fastpriset är redan fakturerat');
});

test('fastpristid kan bara behållas som historik, aldrig faktureras ovanpå avtalet', () => {
  const s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  assert.throws(() => L.sattHistorikbeslut(s, 'e2', HISTORIK_FAKTURERA, { nu: NU }), /fast pris/);
  assert.doesNotThrow(() => L.sattHistorikbeslut(s, 'e2', HISTORIK_ENDAST, { nu: NU }));
});

test('ett beslut kan ångras tillbaka till Behöver granskas', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = beslutaHistorikpost(s, 'e1', HISTORIK_ENDAST, { nu: NU });
  s = aterstallHistorikbeslut(s, 'e1');
  const p = s.poster.find(x => x.id === 'e1');
  assert.equal(p.legacyReviewStatus, 'needsReview');
  assert.equal(p.status, 'needsReview');
});

test('historikens granskningsfält överlever sparning och ny inläsning', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_KLAR_I_LUNDIFY, { nu: NU });
  const tillbaka = tillAppTillstand(franAppTillstand(s)).tillstand;
  const p = tillbaka.poster.find(x => x.id === 'e1');
  assert.equal(p.legacyReviewStatus, HISTORIK_KLAR_I_LUNDIFY);
  assert.equal(p.legacyInvoiceMarked, true);
  assert.equal(p.legacyReviewedAt, NU);
});

test('en borttagen historikpost kommer inte tillbaka vid nästa inläsning', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.taBortPost(s, 'e1');
  assert.ok(!s.poster.some(p => p.id === 'e1'));
  assert.ok(s.historikimport.ignoredIds.includes('e1'));

  const igen = planeraHistorikimport(v1(), s, { nu: NU });
  assert.ok(!igen.tillstand.poster.some(p => p.id === 'e1'));
  assert.equal(igen.antal.totalt, 0);
});
