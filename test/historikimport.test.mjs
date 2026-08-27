import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planeraHistorikimport, beslutaHistorikpost, aterstallHistorikbeslut,
  HISTORIK_FAKTURERA, HISTORIK_KLAR_I_LUNDIFY, HISTORIK_ENDAST,
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
  reviewQueue: [], migrationLog: [], installningar: { veckomalOre: null },
});

test('hela v1-historiken planeras för v2 utan att en rad försvinner', () => {
  const plan = planeraHistorikimport(v1(), tomt(), { nu: NU });
  assert.deepEqual(plan.antal, {
    poster: 2, resor: 1, utlagg: 1, totalt: 4,
    gamlaFakturamarkeringar: 3, kunder: 2, uppdrag: 2,
  });
  assert.deepEqual(new Set(plan.tillstand.poster.map(p => p.id)), new Set(['e1', 'e2', 't1', 'x1']));
  assert.ok(plan.tillstand.poster.every(p => p.legacyReviewStatus === 'needsReview'));
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

test('osäker gammal historik påverkar varken Jobbat in eller Lundify-underlag', () => {
  const s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  const datum = ['2026-03-04', '2026-03-05'];
  assert.equal(L.jobbatIn(s, datum).jobbatInOre, 0);
  assert.equal(L.underlagsgrupper(s).length, 0);
});

test('Ska faktureras räknar arbetet och gör posten tillgänglig för underlag', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_FAKTURERA, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'open');
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 90000);
  assert.ok(L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'e1')));
});

test('Redan klart i Lundify räknar utfört arbete men kan inte faktureras igen', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_KLAR_I_LUNDIFY, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'handled');
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 90000);
  assert.ok(!L.underlagsgrupper(s).some(g => g.rader.some(r => r.post.id === 'e1')));
});

test('Endast historik behåller tid och rad men inga pengar', () => {
  let s = planeraHistorikimport(v1(), tomt(), { nu: NU }).tillstand;
  s = L.sattHistorikbeslut(s, 'e1', HISTORIK_ENDAST, { nu: NU });
  assert.equal(s.poster.find(p => p.id === 'e1').status, 'historyOnly');
  assert.equal(L.arbetadTidSekunder(s.poster.filter(p => p.id === 'e1')), 3600);
  assert.equal(L.jobbatIn(s, ['2026-03-04']).jobbatInOre, 0);
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
