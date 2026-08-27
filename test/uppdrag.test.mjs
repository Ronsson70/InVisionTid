import test from 'node:test';
import assert from 'node:assert/strict';

import * as L from '../src/app/logik.mjs';
import { franAppTillstand } from '../src/app/tillstand.mjs';
import { tidigareUppdragFranV1, aktiveraTidigareUppdrag, skapaNyttUppdrag }
  from '../src/app/uppdrag.mjs';

const artikel = (id, projectId, type, unit) => ({
  id, projectId, type, unit, name: type, active: true,
  unitPriceOre: 10000, vatRate: 2500, vatStatus: 'reviewed', billable: type !== 'trackingOnly',
});

const grund = () => ({
  clients: [{ id: 'k1', name: 'Kund A' }],
  projects: [{ id: 'u1', clientId: 'k1', name: 'Uppdrag A', kind: 'billable', active: true }],
  articles: [
    artikel('a-tid', 'u1', 'hourly', 'tim'),
    artikel('a-resa', 'u1', 'travel', 'km'),
    artikel('a-utlagg', 'u1', 'piece', 'kr'),
  ],
  poster: [], deliverables: [], invoiceRecords: [], expenses: [], trips: [], entries: [],
});

test('nya registreringar får källtyp när de skapas', () => {
  let s = grund();
  s = L.laggTillPost(s, { id: 'tid', projectId: 'u1', articleId: 'a-tid', date: '2026-08-27' });
  s = L.laggTillPost(s, { id: 'resa', projectId: 'u1', articleId: 'a-resa', date: '2026-08-27' });
  s = L.laggTillPost(s, { id: 'utlagg', projectId: 'u1', articleId: 'a-utlagg', date: '2026-08-27' });

  assert.deepEqual(s.poster.map(p => p.sourceType), ['entry', 'trip', 'expense']);
});

test('nya registreringar går hela vägen tillbaka till rätt filsamling', () => {
  let s = grund();
  s = L.laggTillPost(s, { id: 'tid', projectId: 'u1', articleId: 'a-tid', date: '2026-08-27' });
  s = L.laggTillPost(s, { id: 'resa', projectId: 'u1', articleId: 'a-resa', date: '2026-08-27' });

  const fil = franAppTillstand(s);
  assert.deepEqual(fil.entries.map(p => p.id), ['tid']);
  assert.deepEqual(fil.trips.map(p => p.id), ['resa']);
  assert.deepEqual(fil.expenses, []);
});

test('en okänd källtyp stoppas innan tillståndet ändras', () => {
  const s = grund();
  assert.throws(() => L.laggTillPost(s, {
    id: 'fel', projectId: 'u1', articleId: 'a-tid', sourceType: 'saknas',
  }), /okänd typ/);
  assert.equal(s.poster.length, 0);
});

test('tidigare uppdrag hämtas som grunddata utan historik', () => {
  const v1 = {
    clients: [{ id: 'k1', name: 'Kund A' }, { id: 'k2', name: 'Kund B' }],
    projects: [
      { id: 'u1', clientId: 'k1', name: 'Aktivt', hourlyRate: 800 },
      { id: 'u2', clientId: 'k2', name: 'Tidigare', sessionPrice: 1200 },
    ],
    entries: [{ id: 'gammal', projectId: 'u2', date: '2020-01-01', seconds: 3600 }],
    trips: [], expenses: [], invoices: [],
  };
  const lista = tidigareUppdragFranV1(v1, grund(), { nu: '2026-08-27T12:00:00Z' });

  assert.deepEqual(lista.map(x => x.id), ['u2']);
  assert.equal(lista[0].client.name, 'Kund B');
  assert.ok(lista[0].articles.some(a => a.type === 'session'));
  assert.equal(lista[0].entries, undefined, 'ingen historik följer med');
});

test('ett tidigare uppdrag kan aktiveras utan gamla poster eller fakturor', () => {
  const s = grund();
  const forePoster = s.poster.length;
  const paket = {
    id: 'u2', client: { id: 'k2', name: 'Kund B', status: 'paused' },
    project: { id: 'u2', clientId: 'k2', name: 'Tidigare', active: true },
    articles: [artikel('a-u2', 'u2', 'hourly', 'tim')],
  };
  const ut = aktiveraTidigareUppdrag(s, paket);

  assert.ok(ut.projects.some(p => p.id === 'u2'));
  assert.ok(ut.clients.some(c => c.id === 'k2' && c.status === 'active'));
  assert.ok(ut.articles.some(a => a.id === 'a-u2'));
  assert.equal(ut.poster.length, forePoster);
  assert.deepEqual(ut.invoiceRecords, []);
});

test('nytt timuppdrag får kund, artikel, pris, moms och valfri resa', () => {
  const ut = skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Nytt timuppdrag', debitering: 'hourly',
    pris: '950', vatRate: 2500, standardresaKm: '23', resepris: '5,50',
  });
  const p = ut.projects.find(x => x.name === 'Nytt timuppdrag');
  const artiklar = ut.articles.filter(a => a.projectId === p.id);

  assert.equal(artiklar.find(a => a.type === 'hourly').unitPriceOre, 95000);
  assert.equal(artiklar.find(a => a.type === 'travel').unitPriceOre, 550);
  assert.ok(artiklar.every(a => a.vatRate === 2500 && a.vatStatus === 'reviewed'));
  assert.equal(p.defaultTripKm, 23);
  assert.ok(L.uppdragEfterSenast(ut, ['hourly']).some(x => x.id === p.id));
});

test('ny kund skapas tillsammans med uppdraget', () => {
  const ut = skapaNyttUppdrag(grund(), {
    clientId: 'ny', kundnamn: 'Ny kund', namn: 'Nytt uppdrag',
    debitering: 'session', pris: '2400', vatRate: 0,
    standardresaKm: '', resepris: '',
  });
  const p = ut.projects.find(x => x.name === 'Nytt uppdrag');
  assert.equal(ut.clients.find(c => c.id === p.clientId).name, 'Ny kund');
  assert.equal(ut.articles.find(a => a.projectId === p.id).vatRate, 0);
});

test('fastpris skapar uppföljningstid och en leverans över angiven period', () => {
  const ut = skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Fast uppdrag', debitering: 'fixed', pris: '50000', vatRate: 2500,
    startDate: '2026-09-01', endDate: '2026-09-28', standardresaKm: '', resepris: '',
  });
  const p = ut.projects.find(x => x.name === 'Fast uppdrag');
  const a = ut.articles.find(x => x.projectId === p.id);
  const l = ut.deliverables.find(x => x.projectId === p.id);

  assert.equal(a.type, 'trackingOnly');
  assert.equal(a.billable, false);
  assert.equal(l.amountOre, 5000000);
  assert.equal(l.startDate, '2026-09-01');
  assert.equal(l.endDate, '2026-09-28');
  assert.equal(l.status, 'planned');
});

test('ekonomiska uppgifter gissas aldrig för ett nytt uppdrag', () => {
  assert.throws(() => skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Utan moms', debitering: 'hourly', pris: '850', vatRate: null,
  }), /Välj momssats/);
  assert.throws(() => skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Utan pris', debitering: 'session', pris: '', vatRate: 2500,
  }), /belopp/);
  assert.throws(() => skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Halv resa', debitering: 'hourly', pris: '850', vatRate: 2500,
    standardresaKm: '20', resepris: '',
  }), /både standardresa och pris/);
});
