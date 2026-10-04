import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/app/logik.mjs';
import { tillAppTillstand, franAppTillstand } from '../src/app/tillstand.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

function state() {
  return { clients: [{ id: 'c', name: 'Kund A' }], projects: [{ id: 'a', clientId: 'c', name: 'Arbete', kind: 'billable', billingCompany: L.FORETAG[0] }, { id: 'b', clientId: 'c', name: 'Städning', kind: 'billable', billingCompany: L.FORETAG[1] }],
    articles: [{ id: 'ar', projectId: 'a', name: 'Resa', type: 'travel', unit: 'km', unitPriceOre: 625, vatRate: 2500, vatStatus: 'reviewed', active: true, billable: true }, { id: 'br', projectId: 'b', name: 'Arbete', type: 'hourly', unit: 'tim', unitPriceOre: 44000, vatRate: 2500, vatStatus: 'reviewed', active: true, billable: true }],
    poster: [], deliverables: [], invoiceRecords: [], installningar: {} };
}
const trip = (id, km, date = '2026-09-18') => ({ id, projectId: 'a', articleId: 'ar', date, qtyMilli: km * 1000, sourceType: 'trip', status: 'open' });

test('Alla sex resor förblir spårbara men exporteras som 35 km på en rad', () => {
  const s = state();
  s.poster = [trip('1', 10), ...[17, 18, 20, 22, 29].map(d => trip(`r${d}`, 5, `2026-09-${d}`))];
  const result = L.forberedUnderlag(s, L.underlagsgrupper(s)[0].id);
  assert.equal(result.ok, true);
  const rows = L.fakturarader(s, result.underlag);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qtyMilli, 35000);
  assert.equal(rows[0].nettoOre, 21875);
  assert.equal(rows[0].sourceIds.length, 6);
  assert.equal(result.poster.length, 6);
});

test('Samma kund och månad från två företag kan aldrig blandas i ett underlag', () => {
  const s = state();
  s.poster = [trip('r', 10), { id: 't', projectId: 'b', articleId: 'br', date: '2026-09-18', qtyMilli: 1000, sourceType: 'entry', status: 'open' }];
  const groups = L.underlagsgrupper(s);
  assert.equal(groups.length, 2);
  for (const g of groups) {
    const result = L.forberedUnderlag(s, g.id);
    assert.equal(result.underlag.billingCompany, g.billingCompany);
    assert.equal(result.underlag.rader.length, 1);
    assert.match(L.lundifyText(s, result.underlag), /Ronney registrerar och skickar själv/);
  }
});

test('Tema, datum, utförare och samråd följer med till fakturatexten', () => {
  const s = state();
  s.poster = [{ id: 't', projectId: 'b', articleId: 'br', date: '2026-09-18', qtyMilli: 1000, sourceType: 'entry', status: 'open', beskrivning: 'Laga frysdörr', anteckning: 'Kontroll och reparation', consultedWith: 'Kontakt A', performedBy: 'Utförare A' }];
  const result = L.forberedUnderlag(s, L.underlagsgrupper(s)[0].id);
  const text = L.lundifyText(s, result.underlag);
  for (const part of ['2026-09-18', 'Laga frysdörr', 'Kontroll och reparation', 'samråd med Kontakt A', 'Utförare A']) assert.ok(text.includes(part));
});

test('Privat kvitto 407 kr har 325,60 kr netto och 81,40 kr moms utan påslag', () => {
  const s = L.registreraUtlagg(state(), { projectId: 'b', gross: '407,00', receiptVat: '2500', invoiceVat: '2500', paidBy: 'private', date: '2026-09-30', description: 'Material enligt kvitto', receiptImage: 'data:image/jpeg;base64,dGVzdA==' }, 'k1');
  const p = s.poster[0];
  assert.equal(p.receiptGrossOre, 40700);
  assert.equal(p.receiptVatOre, 8140);
  assert.equal(p.paidBy, 'private');
  assert.equal(p.reimbursementStatus, 'unreviewed');
  const result = L.forberedUnderlag(s, L.underlagsgrupper(s)[0].id);
  assert.equal(result.underlag.nettoOre, 32560);
  assert.equal(result.underlag.momsOre, 8140);
  const fil = franAppTillstand({ ...s, version: 2 });
  const restored = tillAppTillstand(fil).tillstand;
  assert.equal(restored.poster[0].receiptImage, p.receiptImage);
  assert.equal(restored.projects[1].billingCompany, L.FORETAG[1]);
});

test('Okänd moms på kvitto eller vidarefakturering får inte gissas', () => {
  assert.throws(() => L.registreraUtlagg(state(), { projectId: 'b', gross: '407', receiptVat: '', invoiceVat: '', date: '2026-09-30', description: 'Material' }, 'k1'), /Välj både/);
});

test('Ett kvitto i sig får inte föreslå en resa till kunden', () => {
  const s = state(); s.projects[1].defaultTripKm = 23;
  const result = L.registreraUtlagg(s, { projectId: 'b', gross: '407', receiptVat: '2500', invoiceVat: '2500', date: '2026-09-30', description: 'Material' }, 'k1');
  assert.equal(L.saknadeResorForDag(result, '2026-09-30').length, 0);
});

test('Resor med olika pris eller moms behåller olika fakturarader', () => {
  const s = state();
  const u = { period: '2026-09', rader: [
    { sourceId: 'a', sourceType: 'trip', unit: 'km', qtyMilli: 1000, unitPriceOre: 625, vatRate: 2500, nettoOre: 625 },
    { sourceId: 'b', sourceType: 'trip', unit: 'km', qtyMilli: 1000, unitPriceOre: 625, vatRate: 0, nettoOre: 625 },
    { sourceId: 'c', sourceType: 'trip', unit: 'km', qtyMilli: 1000, unitPriceOre: 850, vatRate: 2500, nettoOre: 850 },
  ] };
  assert.equal(L.fakturarader(s, u).length, 3);
});

test('Månadsnoteringen hör endast till valt företag och vald månad', () => {
  const s = L.sattManadskontroll(state(), L.FORETAG[1], '2026-09', 'Väntar på kundunderlag');
  assert.equal(s.installningar.manadskontroll[`${L.FORETAG[1]}|2026-09`], 'Väntar på kundunderlag');
  assert.equal(s.installningar.manadskontroll[`${L.FORETAG[0]}|2026-09`], undefined);
});

test('Kund utan bestämd grupp får inte välja ett av två företag godtyckligt', () => {
  const s = state();
  s.poster = [trip('r', 10), { id: 't', projectId: 'b', articleId: 'br', date: '2026-09-18', qtyMilli: 1000, sourceType: 'entry', status: 'open' }];
  assert.equal(L.forberedUnderlag(s, 'c').ok, false);
  assert.equal(L.forhandsvisa(s, 'c'), null);
});

test('En fastprisleverans från ett annat företag stoppas före låsning', () => {
  const s = skapaTestdata(new Date('2026-08-27T12:00:00'));
  const lev = s.deliverables.find(l => l.id === 'lev-verkstad-1');
  const project = s.projects.find(p => p.id === lev.projectId);
  project.billingCompany = L.FORETAG[1];
  s.projects.push({ id: 'annat', clientId: project.clientId, name: 'Annat arbete', kind: 'billable', billingCompany: L.FORETAG[0] });
  s.articles.push({ id: 'annan-artikel', projectId: 'annat', name: 'Tid', type: 'hourly', unit: 'tim', unitPriceOre: 42000, vatRate: 2500, vatStatus: 'reviewed', active: true, billable: true });
  s.poster.push({ id: 'egen', projectId: 'annat', articleId: 'annan-artikel', date: lev.completedAt, qtyMilli: 1000, sourceType: 'entry', status: 'open' });
  const group = L.underlagsgrupper(s).find(g => g.billingCompany === L.FORETAG[0]);
  const result = L.forberedUnderlag(s, group.id, { valdaLeveranser: [lev.id] });
  assert.equal(result.ok, false);
  assert.match(result.besked, /valt företag/);
  assert.equal(L.forhandsvisa(s, group.id, { valdaLeveranser: [lev.id] }), null);
  assert.equal(lev.status, 'open');
});
