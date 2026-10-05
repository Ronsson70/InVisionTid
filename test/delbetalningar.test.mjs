import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/app/logik.mjs';

const state = () => ({
  clients: [{ id: 'kund', name: 'Testkund' }],
  projects: [{ id: 'projekt', clientId: 'kund', name: 'Testprojekt', kind: 'billable', active: true }],
  articles: [], poster: [], invoiceRecords: [],
  deliverables: [
    { id: 'avtal', projectId: 'projekt', amountOre: 6000000, billingDisabled: true },
    ...[1, 2, 3, 4].map(n => ({
      id: `del-${n}`, splitFrom: 'avtal', projectId: 'projekt', name: `Del ${n}`,
      amountOre: 1500000, startDate: '2026-02-21', endDate: '2026-10-30',
      status: n <= 2 ? 'invoiced' : 'planned',
      plannedInvoiceDate: n === 3 ? '2026-10-31' : n === 4 ? '2026-11-30' : null,
    })),
  ],
});

test('fyra delbetalningar visas som ett avtal, med bevarade ören och fakturadatum', () => {
  const s = state(), fore = structuredClone(s);
  const vecka = L.jobbatIn(s, L.veckansDatum(0, new Date('2026-10-05T12:00:00')));
  const grupper = L.samlaFastprisDetaljer(s, vecka.fastPrisDetaljer);
  assert.equal(grupper.length, 1);
  assert.equal(grupper[0].amountOre, 6000000);
  assert.equal(grupper[0].andelOre, vecka.delar.fastPrisAndelOre);
  assert.equal(grupper[0].oversikt.faktureratOre, 3000000);
  assert.equal(grupper[0].oversikt.kvarOre, 3000000);
  assert.deepEqual(grupper[0].oversikt.delar.slice(2).map(l => l.plannedInvoiceDate),
    ['2026-10-31', '2026-11-30']);
  assert.equal(vecka.totaltUnderlagOre, 0, 'upparbetning skapar inga fakturarader');
  assert.deepEqual(s, fore, 'visningen ändrar ingen lagrad uppgift');
});

test('olika arbetsperioder och fristående leveranser blandas inte ihop', () => {
  const s = state();
  s.deliverables[4].endDate = '2026-11-30';
  s.deliverables.push({ ...s.deliverables[1], id: 'annan', splitFrom: null });
  const vecka = L.jobbatIn(s, L.veckansDatum(0, new Date('2026-10-05T12:00:00')));
  const grupper = L.samlaFastprisDetaljer(s, vecka.fastPrisDetaljer);
  assert.equal(grupper.length, 3);
  assert.equal(grupper.reduce((sum, p) => sum + p.andelOre, 0), vecka.delar.fastPrisAndelOre);
  assert.equal(grupper.find(p => p.id === 'annan').oversikt, null);
});

test('gränssnittet visar en veckorad och en översikt utan att spara data', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00') });
  let html = '', sparningar = 0;
  const events = {};
  globalThis.document = {
    getElementById: () => ({ set innerHTML(v) { html = v; } }),
    addEventListener: (typ, fn) => { events[typ] = fn; },
    querySelector: () => null,
  };
  const klicka = dataset => {
    const nod = { dataset, classList: { contains: () => false }, closest: () => nod };
    events.click({ target: nod });
  };
  const { startaApp } = await import('../src/app/ui.mjs');
  startaApp({ tillstand: state(), lagring: { async spara() { sparningar++; } } });
  klicka({ vy: 'vecka' });
  assert.equal((html.match(/class="fastprisrad"/g) || []).length, 1);
  assert.match(html, /Markerat fakturerat 30\s000 kr/);
  assert.match(html, /planerad fakturering 31 okt 2026/);
  assert.match(html, /planerad fakturering 30 nov 2026/);
  klicka({ redigerauppdrag: 'projekt' });
  assert.match(html, /faktureringsöversikt/);
  assert.match(html, /<details><summary>Ändra delbelopp/);
  assert.equal(sparningar, 0);
  mock.timers.reset();
});
