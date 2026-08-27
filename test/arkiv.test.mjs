import test from 'node:test';
import assert from 'node:assert/strict';
import { byggArkiv, arkivmanad } from '../src/app/arkiv.mjs';

const data = () => ({
  clients: [{ id: 'c1', name: 'Kund Ett' }],
  projects: [{ id: 'p1', clientId: 'c1', name: 'Uppdrag Ett' }],
  entries: [
    { id: 'e1', projectId: 'p1', date: '2026-03-04', moment: 'Möte', seconds: 3600 },
    { id: 'e2', projectId: 'p1', date: '2026-04-02', moment: 'Arbete', seconds: 1800 },
  ],
  trips: [{ id: 't1', projectId: 'p1', date: '2026-03-04', description: 'Tur och retur', km: 23 }],
  expenses: [{ id: 'x1', projectId: 'p1', date: '2026-03-04', description: 'Material', amount: 12.50 }],
  invoices: [{ projectId: 'p1', month: '2026-03' }],
});

test('arkivet visar alla gamla tidsposter, resor och utlägg', () => {
  const a = byggArkiv(data());
  assert.deepEqual(a.totalt, { tidsposter: 2, resor: 1, utlagg: 1 });
  assert.equal(a.manader.flatMap(m => m.rader).length, 4);
  assert.deepEqual(a.manader.map(m => m.id), ['2026-04', '2026-03']);
});

test('gamla fakturamarkeringar döljer inte historiken', () => {
  const mars = byggArkiv(data()).manader.find(m => m.id === '2026-03');
  assert.equal(mars.rader.length, 3);
  assert.ok(mars.rader.every(r => r.gammalFakturamarkering));
  assert.equal(mars.harGamlaFakturamarkeringar, true);
});

test('arkivet summerar mängder men tolkar inte gamla intäkter', () => {
  const mars = byggArkiv(data()).manader.find(m => m.id === '2026-03');
  assert.equal(mars.sekunder, 3600);
  assert.equal(mars.km, 23);
  assert.equal(mars.utlaggOre, 1250);
  assert.ok(!('jobbatInOre' in mars));
  assert.ok(!('fakturerbartOre' in mars));
});

test('arkivbygget ändrar inte v1-indatan', () => {
  const v1 = data();
  const fore = JSON.stringify(v1);
  byggArkiv(v1);
  assert.equal(JSON.stringify(v1), fore);
});

test('månadsväljaren håller sig inom arkivets gränser', () => {
  const a = byggArkiv(data());
  assert.equal(arkivmanad(a, -4).id, '2026-04');
  assert.equal(arkivmanad(a, 99).id, '2026-03');
  assert.equal(arkivmanad(byggArkiv({}), 0), null);
});

test('ofullständiga gamla poster visas med begripliga reservnamn', () => {
  const a = byggArkiv({ entries: [{ id: 'e', projectId: 'saknas', seconds: 10 }] });
  assert.equal(a.manader[0].rader[0].projectName, 'Okänt uppdrag');
  assert.equal(a.manader[0].rader[0].clientName, 'Utan kund');
  assert.equal(a.manader[0].id, 'utan-datum', 'även en post utan datum måste vara synlig');
});
