// Dubbellåsning: en post får höra till exakt ett underlag.
//
// Utan spärren flyttade ett andra anrop tyst posten till det nya underlaget,
// och samma arbete kunde hamna på två fakturor. Kontrollen sker på HELA
// underlaget innan den första mutationen, så ett fel aldrig lämnar halvt
// ändrad data efter sig.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lasUnderlag, RedanLast } from '../src/domain/index.mjs';

const artikel = {
  id: 'a1', projectId: 'p1', name: 'Konsulttid', type: 'hourly', unit: 'tim',
  unitPriceOre: 85000, vatRate: 2500, vatStatus: 'reviewed',
  billable: true, active: true, sortOrder: 10,
};
const post = (id, extra = {}) => ({
  id, projectId: 'p1', articleId: 'a1', date: '2026-08-03',
  beskrivning: 'Arbete', qtyMilli: 1000, seconds: 3600,
  status: 'open', invoiceRecordId: null, priceSnapshot: null, ...extra,
});
const las = (poster, valda, opts = {}) => lasUnderlag({
  artiklar: [artikel], poster, valda, clientId: 'k1', period: '2026-08', ...opts,
});

// ── Grundfallet ─────────────────────────────────────────────────────────────

test('en post utan underlag får låsas', () => {
  const { underlag, poster } = las([post('e1')], ['e1']);
  const p = poster.find(x => x.id === 'e1');
  assert.equal(p.status, 'included');
  assert.equal(p.invoiceRecordId, underlag.id);
  assert.deepEqual(p.priceSnapshot, {
    unitPriceOre: 85000, vatRate: 2500, unit: 'tim', articleName: 'Konsulttid',
  });
});

// ── Konflikt mot ett annat underlag ─────────────────────────────────────────

test('samma post kan inte låsas till två olika underlag', () => {
  const forsta = las([post('e1')], ['e1']);
  const last = forsta.poster.find(p => p.id === 'e1');
  assert.equal(last.invoiceRecordId, 'und-k1-2026-08');

  assert.throws(
    () => las([last], ['e1'], { id: 'und-annat' }),
    e => e instanceof RedanLast && /hör redan till underlag und-k1-2026-08/.test(e.message)
  );
});

test('felet säger vad som ska göras i stället', () => {
  const last = post('e1', { invoiceRecordId: 'und-gammalt', status: 'included' });
  assert.throws(() => las([last], ['e1'], { id: 'und-nytt' }),
    /Flytta tillbaka det andra underlaget först/);
});

test('en leverans kan inte heller flyttas mellan underlag', () => {
  const leverans = {
    id: 'lev1', projectId: 'p1', name: 'Verkstad', amountOre: 5000000,
    vatRate: 2500, vatStatus: 'reviewed', status: 'included', invoiceRecordId: 'und-gammalt',
  };
  assert.throws(
    () => las([], [], { leveranser: [leverans], valdaLeveranser: ['lev1'], id: 'und-nytt' }),
    e => e instanceof RedanLast && /Leveransen lev1/.test(e.message)
  );
});

// ── Ingen partiell mutation ─────────────────────────────────────────────────

test('en blandad samling där EN post är låst ändrar ingenting alls', () => {
  const poster = [
    post('e1'),                                              // fri
    post('e2', { invoiceRecordId: 'und-gammalt', status: 'included' }), // låst någon annanstans
    post('e3'),                                              // fri
  ];
  const fore = structuredClone(poster);

  assert.throws(() => las(poster, ['e1', 'e2', 'e3'], { id: 'und-nytt' }), RedanLast);

  // Indata är orörd, och inget delvis låst resultat har lämnats ifrån sig.
  assert.deepEqual(poster, fore, 'anropet får inte mutera indata');
  assert.equal(poster[0].invoiceRecordId, null, 'den fria posten är fortfarande fri');
  assert.equal(poster[2].invoiceRecordId, null);
});

test('konflikten pekar ut exakt vilka poster som krockar', () => {
  const poster = [
    post('e1'),
    post('e2', { invoiceRecordId: 'und-a' }),
    post('e3', { invoiceRecordId: 'und-b' }),
  ];
  try {
    las(poster, ['e1', 'e2', 'e3'], { id: 'und-nytt' });
    assert.fail('skulle ha kastat');
  } catch (e) {
    assert.ok(e instanceof RedanLast);
    assert.deepEqual(e.konflikter.map(k => k.id), ['e2', 'e3']);
    assert.deepEqual(e.konflikter.map(k => k.invoiceRecordId), ['und-a', 'und-b']);
  }
});

test('validering sker före momskontrollen, så det första felet är det verkliga', () => {
  const ogranskad = { ...artikel, id: 'a2', vatRate: null, vatStatus: 'needsReview' };
  const p = post('e1', { articleId: 'a2', invoiceRecordId: 'und-gammalt' });
  assert.throws(
    () => lasUnderlag({ artiklar: [ogranskad], poster: [p], valda: ['e1'], clientId: 'k1', period: '2026-08', id: 'und-nytt' }),
    RedanLast
  );
});

// ── Idempotent återförsök ───────────────────────────────────────────────────

test('återförsök mot SAMMA underlag går igenom', () => {
  const forsta = las([post('e1')], ['e1']);
  const andra = las(forsta.poster, ['e1']);
  assert.equal(andra.poster.find(p => p.id === 'e1').invoiceRecordId, 'und-k1-2026-08');
});

test('återförsök ändrar inte prissnapshotet ens om priset har ändrats', () => {
  const forsta = las([post('e1')], ['e1']);
  const snapshotFore = forsta.poster.find(p => p.id === 'e1').priceSnapshot;

  // Priset dubblas efteråt. Snapshotet ska stå fast.
  const nyttPris = { ...artikel, unitPriceOre: 170000 };
  const andra = lasUnderlag({
    artiklar: [nyttPris], poster: forsta.poster, valda: ['e1'],
    clientId: 'k1', period: '2026-08',
  });
  assert.deepEqual(andra.poster.find(p => p.id === 'e1').priceSnapshot, snapshotFore);
  assert.equal(andra.poster.find(p => p.id === 'e1').priceSnapshot.unitPriceOre, 85000);
});

test('återförsök skapar inga dubbletter', () => {
  const forsta = las([post('e1'), post('e2')], ['e1', 'e2']);
  const andra = las(forsta.poster, ['e1', 'e2']);
  assert.equal(andra.poster.length, 2);
  assert.equal(andra.underlag.rader.length, 2);
  assert.equal(andra.underlag.nettoOre, forsta.underlag.nettoOre);
});

test('återförsök rör inte heller tidsstämpeln', () => {
  const forsta = las([post('e1')], ['e1'], { nu: '2026-08-27T10:00:00.000Z' });
  const andra = las(forsta.poster, ['e1'], { nu: '2026-09-01T10:00:00.000Z' });
  assert.equal(andra.poster.find(p => p.id === 'e1').updatedAt, '2026-08-27T10:00:00.000Z');
});

// ── Ovalda poster ───────────────────────────────────────────────────────────

test('ovalda poster lämnas orörda även när andra låses', () => {
  const { poster } = las([post('e1'), post('e2')], ['e1']);
  const kvar = poster.find(p => p.id === 'e2');
  assert.equal(kvar.status, 'open');
  assert.equal(kvar.invoiceRecordId, null);
  assert.equal(kvar.priceSnapshot, null);
});

test('en ovald post som redan hör till ett annat underlag stoppar ingenting', () => {
  const poster = [post('e1'), post('e2', { invoiceRecordId: 'und-gammalt' })];
  assert.doesNotThrow(() => las(poster, ['e1'], { id: 'und-nytt' }));
  const { poster: ut } = las(poster, ['e1'], { id: 'und-nytt' });
  assert.equal(ut.find(p => p.id === 'e2').invoiceRecordId, 'und-gammalt', 'oförändrad');
});
