import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/app/logik.mjs';
import { skapaTestdata } from '../prototyp/testdata.mjs';

const now = '2026-10-31T12:00:00.000Z';
// Sju anonymiserade kundmodeller. Verifierar regler, inte verkliga kundvillkor.
function fixture() {
  const s = { clients: [], projects: [], articles: [], poster: [], deliverables: [], invoiceRecords: [],
    installningar: { veckomalOre: 1850000, manadsmalOre: 8000000 } };
  for (let i = 1; i <= 7; i++) {
    s.clients.push({ id: `c${i}`, name: `Testkund ${i}` });
    s.projects.push({ id: `p${i}`, clientId: `c${i}`, name: `Uppgift ${i}`, kind: i === 7 ? 'internal' : 'billable', billingCompany: L.FORETAG[i === 6 ? 1 : 0] });
  }
  function post(i, type, price, qty, seconds, vat = 2500) {
    const id = `${i}-${type}`;
    s.articles.push({ id, projectId: `p${i}`, type, name: type, unit: type === 'travel' ? 'km' : type === 'session' ? 'pass' : 'tim', unitPriceOre: price, vatRate: vat, vatStatus: 'reviewed', billable: type !== 'trackingOnly', active: true });
    s.poster.push({ id, projectId: `p${i}`, articleId: id, date: '2026-10-20', qtyMilli: qty, seconds, status: 'open', sourceType: type === 'travel' ? 'trip' : 'entry', customerText: 'Kundtext', internalNote: 'HEMLIG INTERN TEXT' });
  }
  post(1, 'hourly', 85000, 1000, 3600); post(1, 'travel', 625, 14000, 0);
  post(2, 'session', 240000, 1000, 10800, 0); post(2, 'hourly', 85000, 1000, 3600, 0); post(2, 'travel', 625, 23000, 0, 0);
  post(3, 'hourly', 42000, 4000, 14400); post(3, 'travel', 625, 10000, 0);
  post(4, 'trackingOnly', 0, 6000, 21600); post(5, 'trackingOnly', 0, 2000, 7200);
  post(6, 'hourly', 44000, 1000, 3600); post(6, 'travel', 625, 10000, 0);
  post(7, 'trackingOnly', 0, 1000, 3600);
  for (const [i, amount, count] of [[4, 5000000, 3], [5, 1500000, 4], [3, 700000, 1], [7, 100, 1]]) {
    for (let n = 1; n <= count; n++) s.deliverables.push({ id: `d${i}-${n}`, projectId: `p${i}`, name: `Del ${n}`, amountOre: amount, vatRate: 2500, vatStatus: 'reviewed', status: n === 1 ? 'open' : 'planned', completedAt: n === 1 ? '2026-10-20' : null, startDate: '2026-10-01', endDate: '2026-10-31' });
  }
  s.deliverables.push({ ...s.deliverables.find(x => x.projectId === 'p5'), id: 'superseded-total', amountOre: 6000000, billingDisabled: true });
  return s;
}
function save(s, client = 'c1', deliveries = []) {
  const group = L.underlagsgrupper(s).find(x => x.clientId === client);
  const preview = L.forberedUnderlag(s, group.id, { valdaLeveranser: deliveries });
  assert.equal(preview.ok, true);
  return L.sparaForberett(s, group.id, deliveries, L.kontrollversion(s, preview.underlag), { nu: now });
}
test('sju modeller: timmar/pass/resor, delbetalningar, camp och internt 1 kr', () => {
  const s = fixture();
  assert.equal(save(s, 'c1').referens.nettoOre, 93750);
  assert.equal(save(s, 'c2').referens.nettoOre, 339375);
  assert.equal(save(s, 'c2').referens.momsOre, 0);
  assert.equal(save(s, 'c3').referens.nettoOre, 174250); // admin är vanlig tid, ingen extra avgift
  assert.equal(save(s, 'c3', ['d3-1']).referens.nettoOre, 874250);
  assert.equal(save(s, 'c4', ['d4-1']).referens.nettoOre, 5000000);
  assert.equal(save(s, 'c5', ['d5-1']).referens.nettoOre, 1500000);
  assert.equal(save(s, 'c6').referens.nettoOre, 50250);
  assert.equal(L.underlagsgrupper(s).some(g => g.clientId === 'c7'), false);
  assert.equal(L.arbetadTidSekunder(s.poster), 68400);
  assert.deepEqual(s.installningar, { veckomalOre: 1850000, manadsmalOre: 8000000 });
});
test('förhandsvisning är ren, repeterbar och sparning reserverar exakt en gång', () => {
  const s = fixture(), original = structuredClone(s);
  const group = L.underlagsgrupper(s)[0];
  const a = L.forberedUnderlag(s, group.id), b = L.forberedUnderlag(s, group.id);
  assert.deepEqual(a, b); assert.deepEqual(s, original);
  const saved = save(s);
  assert.equal(saved.ok, true);
  const again = L.sparaForberett(saved.state, group.id, [], L.kontrollversion(s, a.underlag));
  assert.equal(again.ok, false);
  assert.equal(saved.state.invoiceRecords.length, 1);
  assert.deepEqual(saved.state.poster.map(p => p.seconds), s.poster.map(p => p.seconds));
});
test('ändrad källa mellan preview och spara kräver ny läsning', () => {
  const s = fixture(), group = L.underlagsgrupper(s)[0];
  const p = L.forberedUnderlag(s, group.id);
  const version = L.kontrollversion(s, p.underlag);
  s.poster[0].qtyMilli = 2000;
  assert.equal(L.sparaForberett(s, group.id, [], version).ok, false);
});
test('manuell dokumentkontroll skiljer utkast och registrerat, kräver belopp och kund', () => {
  const { state: s, referens: r } = save(fixture());
  const obs = { kind: 'draft', customerId: 'test-customer', reference: 'draft-test-1', nettoOre: r.nettoOre, confirmed: true };
  assert.equal(L.kontrolleraDokument(s, r.id, { ...obs, nettoOre: 1 }).ok, false);
  assert.equal(L.kontrolleraDokument(s, r.id, { ...obs, customerId: '' }).ok, false);
  const draft = L.kontrolleraDokument(s, r.id, obs, { nu: now });
  assert.equal(draft.state.invoiceRecords[0].invoiceNumber, null);
  assert.equal(draft.state.invoiceRecords[0].workflowStatus, 'draft');
  assert.equal(L.kontrolleraDokument(draft.state, r.id, obs).state, draft.state);
  const registered = L.kontrolleraDokument(draft.state, r.id, { ...obs, kind: 'registered', reference: 'TEST-101', invoiceDate: '2026-10-31' });
  assert.equal(registered.state.invoiceRecords[0].invoiceNumber, 'TEST-101');
  assert.equal(L.oppnaNyVersion(registered.state, r.id).ok, false);
});
test('återöppning bevarar snapshot och utkastets revisionsspår', () => {
  const { state: s, referens: r } = save(fixture());
  const old = structuredClone(r.snapshot);
  const reopened = L.oppnaNyVersion(s, r.id, { nu: now });
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.state.invoiceRecords[0].snapshot, old);
  assert.ok(reopened.state.poster[0].priceSnapshot);
  assert.equal(reopened.state.invoiceRecords[0].needsReview, true);
  assert.deepEqual(L.hamtaSparatUnderlag(reopened.state, r.id), old);
  assert.notEqual(save(reopened.state).referens.id, r.id);
});
test('kundtext exporteras, intern anteckning och kvittobild exporteras inte', () => {
  const { state, referens } = save(fixture());
  const text = L.lundifyText(state, referens.snapshot);
  assert.match(text, /Kundtext/); assert.match(text, /Källposter:/);
  assert.ok(!text.includes('HEMLIG INTERN TEXT'));
});
test('bolagsavgränsat mål ändrar inte belopp och andra bolag ingår inte', () => {
  const s = fixture(); s.installningar.malForetag = L.FORETAG[1];
  const m = L.manadsSammanstallning(s, '2026-10');
  assert.equal(m.malOre, 8000000); assert.equal(m.jobbatInOre, 44000);
  assert.equal(m.arbetadTidSekunder, 3600);
});
test('ändrade standardpriser och passlängd skriver inte om redan registrerad tid', () => {
  const s = fixture();
  const ut = L.uppdateraUppdrag(s, 'p2', { name: 'Uppgift 2', clientId: 'c2', defaultTripKm: 23,
    artiklar: [{ id: '2-session', pris: '3000', vatRate: 0, arbetstidTimmar: '5' }], leveranser: [] });
  assert.equal(ut.poster.find(p => p.id === '2-session').seconds, 10800);
  assert.equal(save(ut, 'c2').referens.nettoOre, 339375);
});
test('fastpristid faktureras inte extra och fel bolags leverans avvisas', () => {
  const s = fixture(), group = L.underlagsgrupper(s).find(g => g.clientId === 'c6');
  assert.equal(L.forberedUnderlag(s, group.id, { valdaLeveranser: ['d4-1'] }).ok, false);
  assert.equal(save(s, 'c4', ['d4-1']).referens.rader.length, 1);
});
test('utlägg kan vara endast egen kostnad utan vidarefakturering', () => {
  const s = L.registreraUtlagg(fixture(), { projectId: 'p1', gross: '125', receiptVat: '2500', invoiceVat: '2500', date: '2026-10-20', description: 'Testmaterial', rebill: 'no', receiptImage: 'test-only' }, 'expense-test');
  assert.equal(L.kanIngaIFakturaunderlag(s, s.poster.at(-1)), false);
  assert.equal(save(s).referens.nettoOre, 93750);
});

test('versionskontroll överlever riktig v2-filroundtrip och JSON-omordning', async () => {
  const { franAppTillstand, tillAppTillstand } = await import('../src/app/tillstand.mjs');
  const profiled = L.uppdateraKundprofil(fixture(), 'c1', L.FORETAG[0], {travelGrouping:'purpose',hourlyGrouping:'dated',hourlyLabel:'Samtal'});
  const { state, referens } = save(profiled);
  const file = JSON.parse(JSON.stringify(franAppTillstand(state)));
  const restored = tillAppTillstand(file).tillstand;
  assert.deepEqual(restored.clients[0].billingProfiles, state.clients[0].billingProfiles);
  assert.equal(L.kontrollversion(restored, referens.snapshot), referens.lockedVersion);
  assert.equal(L.kontrolleraDokument(restored, referens.id, { kind: 'draft', reference: 'test-draft', customerId: 'test-customer', nettoOre: referens.nettoOre, confirmed: true }).ok, true);
});

test('separat uppdrag väljer inte annan uppgift i samma kundmånad', () => {
  const s = fixture();
  s.projects.push({ ...s.projects[0], id: 'extra' });
  s.articles.push({ ...s.articles[0], id: 'extra-a', projectId: 'extra' });
  s.poster.push({ ...s.poster[0], id: 'extra-post', articleId: 'extra-a', projectId: 'extra' });
  const g = L.underlagsgrupper(s).find(g => g.clientId === 'c1');
  const p = L.forberedUnderlag(s, g.id, { projectId: 'extra' });
  assert.deepEqual(p.underlag.rader.map(r => r.sourceId), ['extra-post']);
  const saved = L.sparaForberett(s, g.id, [], L.kontrollversion(s, p.underlag), { projectId: 'extra' });
  assert.equal(saved.state.poster[0].status, 'open');
});

test('en kunds prisförslag får inte komma från annat bolag eller tvetydiga priser', () => {
  const s = fixture();
  assert.equal(L.kundprisForslag(s, 'c1', L.FORETAG[0], 'hourly'), 85000);
  assert.equal(L.kundprisForslag(s, 'c1', L.FORETAG[1], 'hourly'), null);
  s.articles.push({ ...s.articles[0], id: 'different', unitPriceOre: 95000 });
  assert.equal(L.kundprisForslag(s, 'c1', L.FORETAG[0], 'hourly'), null);
});

test('samma dokument inom samma bolag kan inte bokas på två underlag', () => {
  const first = save(fixture());
  const r = first.referens;
  const doc = { kind: 'draft', reference: 'test-draft', customerId: 'test-customer', nettoOre: r.nettoOre, confirmed: true };
  const one = L.kontrolleraDokument(first.state, r.id, doc).state;
  const second = save(one, 'c2');
  assert.equal(L.kontrolleraDokument(second.state, second.referens.id, { ...doc, nettoOre: second.referens.nettoOre }).ok, false);
});

test('kundprofil och aktuella priser kan ändras utan att sparad export förändras', () => {
  const initial = fixture();
  initial.projects[0].billingProfile = { paymentTermsDays: 10, customerReference: 'TEST-REF', invoiceText: 'Godkänd testtext' };
  const { state, referens } = save(initial);
  const before = L.lundifyText(state, referens.snapshot);
  state.projects[0].billingProfile.paymentTermsDays = 30;
  state.articles[0].unitPriceOre = 999999;
  assert.equal(L.lundifyText(state, L.hamtaSparatUnderlag(state, referens.id)), before);
  assert.match(before, /Betalningsvillkor: 10 dagar/);
  assert.equal(L.kontrolleraDokument(state, referens.id, { kind: 'draft', reference: 'test', customerId: 'test', nettoOre: referens.nettoOre, confirmed: true }).ok, false);
});

test('sparad export behåller kundnamn och villkor efter senare kundändring', () => {
  let s = fixture();
  s = L.uppdateraKundprofil(s, 'c1', L.FORETAG[0], { paymentTermsDays: 10, invoiceText: 'Godkänd text', travelGrouping: 'project' });
  const saved = save(s);
  const before = L.lundifyText(saved.state, saved.referens.snapshot);
  const changed = structuredClone(saved.state);
  changed.clients[0].name = 'Ändrat namn';
  changed.clients[0].billingProfiles[L.FORETAG[0]].invoiceText = 'Ny text';
  assert.equal(L.lundifyText(changed, saved.referens.snapshot), before);
  assert.match(before, /Godkänd text/);
  assert.match(before, /10 dagar/);
});
test('kundprofil ärver per bolag, uppdrag kan åsidosätta och noll dagar är giltigt', () => {
  let s = fixture();
  s = L.uppdateraKundprofil(s, 'c1', L.FORETAG[0], { paymentTermsDays: 10, customerReference: 'A', travelGrouping: 'purpose' });
  s = L.uppdateraKundprofil(s, 'c1', L.FORETAG[1], { paymentTermsDays: 20, customerReference: 'B', travelGrouping: 'project' });
  s.projects[0].billingProfile = { paymentTermsDays: 0, customerReference: '' };
  assert.equal(L.faktureringsprofil(s, 'p1').paymentTermsDays, 0);
  assert.equal(L.faktureringsprofil(s, 'p1').customerReference, 'A');
  s.projects[0].billingCompany = L.FORETAG[1];
  assert.equal(L.faktureringsprofil(s, 'p1').customerReference, 'B');
  assert.throws(() => L.uppdateraKundprofil(s, 'c1', L.FORETAG[0], { paymentTermsDays: -1, travelGrouping: 'project' }));
});
test('kundstyrda resor separerar pass och samtal utan att gissa äldre ändamål', () => {
  let s = fixture();
  s = L.uppdateraKundprofil(s, 'c2', L.FORETAG[0], { travelGrouping: 'purpose' });
  const trip = s.poster.find(p => p.id === '2-travel');
  s.poster.push({ ...trip, id: 'trip-pass', travelPurpose: 'session' }, { ...trip, id: 'trip-talk', travelPurpose: 'conversation' });
  const saved = save(s, 'c2');
  const text = L.lundifyText(saved.state, saved.referens.snapshot);
  assert.match(text, /Passresor/); assert.match(text, /Samtalsresor/); assert.match(text, /ändamål behöver verifieras/);
  assert.equal(saved.referens.presentationRows.filter(x => x.sourceType === 'trip').length, 3);
});
test('avstämt utkast kan inte ersättas med annan referens eller kund', () => {
  const { state, referens: r } = save(fixture());
  const obs = { kind: 'draft', reference: 'd1', customerId: 'c1', nettoOre: r.nettoOre, confirmed: true };
  const draft = L.kontrolleraDokument(state, r.id, obs).state;
  assert.equal(L.kontrolleraDokument(draft, r.id, { ...obs, reference: 'd2' }).ok, false);
  assert.equal(L.kontrolleraDokument(draft, r.id, { ...obs, customerId: 'c2' }).ok, false);
  assert.equal(L.kontrolleraDokument(draft, r.id, { ...obs, kind: 'registered', reference: 'f1', invoiceDate: '2026-02-31' }).ok, false);
});
test('återöppnat utkast måste avstämmas innan nya versionen får fakturanummer', () => {
  const saved = save(fixture()), r = saved.referens;
  const obs = { kind: 'draft', reference: 'd1', customerId: 'c1', nettoOre: r.nettoOre, confirmed: true };
  const draft = L.kontrolleraDokument(saved.state, r.id, obs).state;
  const fresh = save(L.oppnaNyVersion(draft, r.id).state);
  const invoice = { ...obs, kind: 'registered', reference: 'f1', invoiceDate: '2026-10-31' };
  assert.equal(L.kontrolleraDokument(fresh.state, fresh.referens.id, invoice).ok, false);
  const checked = L.kontrolleraDokument(fresh.state, fresh.referens.id, obs);
  assert.equal(checked.ok, true);
  assert.equal(L.kontrolleraDokument(checked.state, fresh.referens.id, invoice).ok, true);
});
test('leveransunderlag hindrar kundbyte även när uppdraget saknar tidsposter', () => {
  const saved = save(fixture(), 'c4', ['d4-1']);
  saved.state.poster = saved.state.poster.filter(p => p.projectId !== 'p4');
  assert.throws(() => L.uppdateraUppdrag(saved.state, 'p4', { name: 'Test', clientId: 'c1' }), /Kundbyte/);
});

test('återöppning frigör inte historiska källor för byte av kund eller uppdrag', () => {
  const saved = save(fixture());
  const opened = L.oppnaNyVersion(saved.state, saved.referens.id).state;
  assert.throws(() => L.uppdateraUppdrag(opened, 'p1', { name: 'Test', clientId: 'c2' }), /Kundbyte/);
  assert.throws(() => L.andraPost(opened, '1-hourly', { projectId: 'p3', articleId: '3-hourly' }), /underlagshistorik/);
});
test('ny version exporterar tidigare utkastets referens och behåller den vid senare ändringar', () => {
  const saved = save(fixture()), r = saved.referens;
  const obs = { kind: 'draft', reference: 'draft-original', customerId: 'c1', nettoOre: r.nettoOre, confirmed: true };
  const draft = L.kontrolleraDokument(saved.state, r.id, obs).state;
  const fresh = save(L.oppnaNyVersion(draft, r.id).state);
  const before = L.lundifyText(fresh.state, fresh.referens.snapshot);
  assert.match(before, /Tidigare Lundify-utkast: draft-original/);
  const opened = L.oppnaNyVersion(fresh.state, fresh.referens.id).state;
  assert.equal(L.lundifyText(opened, fresh.referens.snapshot), before);
});

test('samtalsmall samlar daterat timarbete men behåller passens ämnesrader och reseslag', () => {
  let s = fixture();
  s = L.uppdateraKundprofil(s, 'c2', L.FORETAG[0], { travelGrouping: 'purpose', hourlyGrouping: 'dated', hourlyLabel: 'Individuella samtal', sessionLabel: 'Gruppass' });
  const hour = s.poster.find(p => p.id === '2-hourly');
  s.poster.push({ ...hour, id: 'conversation-2', date: '2026-10-22', qtyMilli: 1500, seconds: 5400, customerText: 'Uppföljning' });
  s.poster.find(p => p.id === '2-session').customerText = 'Tema återhämtning';
  s.poster.find(p => p.id === '2-travel').travelPurpose = 'session';
  s.poster.push({ ...s.poster.find(p => p.id === '2-travel'), id: 'conversation-trip', travelPurpose: 'conversation' });
  const original = structuredClone(s);
  const saved = save(s, 'c2'), rows = saved.referens.presentationRows;
  assert.deepEqual(s, original);
  const talk = rows.find(r => r.beskrivning.startsWith('Individuella samtal:'));
  assert.equal(talk.qtyMilli, 2500); assert.equal(talk.nettoOre, 212500);
  assert.match(talk.beskrivning, /2026-10-20/); assert.match(talk.beskrivning, /2026-10-22/);
  assert.match(talk.beskrivning, /Uppföljning/); assert.match(talk.beskrivning, /1,5 tim/);
  assert.equal(talk.sourceIds.length, 2);
  const exported = L.lundifyText(saved.state, saved.referens.snapshot);
  for (const word of ['Gruppass', 'Tema återhämtning', 'Passresor', 'Samtalsresor']) assert.ok(exported.includes(word));
  assert.ok(!exported.includes('HEMLIG INTERN TEXT'));
  assert.equal(rows.reduce((n, r) => n + r.nettoOre, 0), saved.referens.nettoOre);
});
test('samlad rad håller olika priser isär och avstår vid avrundningsskillnad', () => {
  let s = fixture();
  s = L.uppdateraKundprofil(s, 'c1', L.FORETAG[0], { travelGrouping: 'project', hourlyGrouping: 'dated' });
  const base = { projectId: 'p1', sourceType: 'entry', unit: 'tim', unitPriceOre: 1, vatRate: 2500, qtyMilli: 500, nettoOre: 1, datum: '2026-10-20', beskrivning: 'Arbete' };
  s.poster.push({ ...s.poster[0], id: 'round-1' }, { ...s.poster[0], id: 'round-2' });
  const rows = L.fakturarader(s, { rader: [{ ...base, sourceId: 'round-1' }, { ...base, sourceId: 'round-2' }] });
  assert.equal(rows.length, 2); assert.equal(rows.reduce((n, r) => n + r.nettoOre, 0), 2);
  const prices = L.fakturarader(s, { rader: [{ ...base, sourceId: 'round-1', qtyMilli: 1000 }, { ...base, sourceId: 'round-2', qtyMilli: 1000, unitPriceOre: 2, nettoOre: 2 }] });
  assert.equal(prices.length, 2);
});
test('rättelsebehov bevarar originalfaktura, låsning och belopp utan kredit eller ny faktura', async () => {
  const saved = save(fixture()), r = saved.referens;
  const state = L.kontrolleraDokument(saved.state, r.id, { kind: 'registered', reference: 'TEST-99', customerId: 'test-customer', nettoOre: r.nettoOre, confirmed: true, invoiceDate: '2026-10-31' }).state;
  const before = structuredClone(state);
  assert.equal(L.registreraRattelsebehov(state, r.id, '').ok, false);
  const result = L.registreraRattelsebehov(state, r.id, 'Kontrollera resans omfattning', { nu: now });
  const changed = result.state.invoiceRecords[0];
  assert.equal(changed.workflowStatus, 'registered'); assert.equal(changed.invoiceNumber, 'TEST-99');
  const { franAppTillstand, tillAppTillstand } = await import('../src/app/tillstand.mjs');
  const roundtrip = tillAppTillstand(JSON.parse(JSON.stringify(franAppTillstand(result.state)))).tillstand;
  assert.deepEqual(roundtrip.invoiceRecords[0], changed);
  assert.equal(changed.correctionPending, true); assert.equal(changed.events.at(-1).originalInvoiceNumber, 'TEST-99');
  assert.deepEqual(changed.snapshot, before.invoiceRecords[0].snapshot);
  assert.deepEqual(result.state.poster, before.poster); assert.deepEqual(result.state.deliverables, before.deliverables);
  assert.equal(changed.nettoOre, r.nettoOre); assert.equal(result.state.invoiceRecords.length, 1);
  assert.equal(L.oppnaNyVersion(result.state, r.id).ok, false);
  assert.equal(L.registreraRattelsebehov(result.state, r.id, 'Kontrollera resans omfattning').state, result.state);
  assert.equal(L.underlagsgrupper(result.state).some(g => g.clientId === 'c1'), false);
});
