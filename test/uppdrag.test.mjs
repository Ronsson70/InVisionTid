import test from 'node:test';
import assert from 'node:assert/strict';

import * as L from '../src/app/logik.mjs';
import { franAppTillstand, tillAppTillstand } from '../src/app/tillstand.mjs';
import { tidigareUppdragFranV1, aktiveraTidigareUppdrag, aktiveraBefintligtUppdrag, skapaNyttUppdrag, uppdateraKund, uppdateraUppdrag }
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

test('ett importerat vilande uppdrag kan återaktiveras utan att historiken ändras', () => {
  const s = {
    ...grund(),
    clients: [{ id: 'k2', name: 'Kund B', status: 'paused' }],
    projects: [{ id: 'u2', clientId: 'k2', name: 'Vilande', active: false, archivedAt: '2026-01-01' }],
    articles: [{ ...artikel('a-u2', 'u2', 'hourly', 'tim'), active: false }],
    poster: [{ id: 'gammal', projectId: 'u2', articleId: 'a-u2', sourceType: 'entry', date: '2025-01-01' }],
  };
  const fore = structuredClone(s.poster);
  const ut = aktiveraBefintligtUppdrag(s, 'u2');

  assert.equal(ut.projects[0].active, true);
  assert.equal(ut.clients[0].status, 'active');
  assert.equal(ut.articles[0].active, true);
  assert.deepEqual(ut.poster, fore);
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
    debitering: 'session', pris: '2400', vatRate: 0, arbetstidTimmar: '3',
    standardresaKm: '', resepris: '',
  });
  const p = ut.projects.find(x => x.name === 'Nytt uppdrag');
  assert.equal(ut.clients.find(c => c.id === p.clientId).name, 'Ny kund');
  const a = ut.articles.find(a => a.projectId === p.id);
  assert.equal(a.vatRate, 0);
  assert.equal(a.workSecondsPerUnit, 10800);
  assert.equal(L.arbetstidSekunderForArtikel(a, L.MILLI), 10800);
  assert.equal(L.arbetstidSekunderForArtikel(a, 2 * L.MILLI), 21600);
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
    clientId: 'k1', namn: 'Utan arbetstid', debitering: 'session', pris: '2400', vatRate: 2500,
  }), /Arbetstiden per tillfälle/);
  assert.throws(() => skapaNyttUppdrag(grund(), {
    clientId: 'k1', namn: 'Halv resa', debitering: 'hourly', pris: '850', vatRate: 2500,
    standardresaKm: '20', resepris: '',
  }), /både standardresa och pris/);
});

test('kunduppgifter kan redigeras med samma fält som i den gamla appen', () => {
  const fore = grund();
  fore.clients[0] = { ...fore.clients[0], egetFalt: 'bevaras' };
  const ut = uppdateraKund(fore, 'k1', {
    name: 'Kund A AB', orgNr: '556677-8899', contact: 'Anna', phone: '070-123 45 67',
    email: 'anna@example.se', address: 'Vägen 1, 820 40 Järvsö', status: 'paused',
  });
  const kund = ut.clients[0];
  assert.equal(kund.name, 'Kund A AB');
  assert.equal(kund.orgNr, '556677-8899');
  assert.equal(kund.contact, 'Anna');
  assert.equal(kund.phone, '070-123 45 67');
  assert.equal(kund.email, 'anna@example.se');
  assert.equal(kund.address, 'Vägen 1, 820 40 Järvsö');
  assert.equal(kund.status, 'paused');
  assert.equal(kund.egetFalt, 'bevaras');
  assert.equal(ut.projects[0].clientId, 'k1', 'uppdragets koppling bevaras');
});

test('kundredigering avvisar tomt namn och okänd status', () => {
  assert.throws(() => uppdateraKund(grund(), 'k1', { name: '', status: 'active' }), /namn/);
  assert.throws(() => uppdateraKund(grund(), 'k1', { name: 'Kund', status: 'fel' }), /kundstatus/);
  assert.throws(() => uppdateraKund(grund(), 'saknas', { name: 'Kund', status: 'active' }), /finns inte/);
});

test('uppdragets priser, moms, kund och standardresa kan rättas', () => {
  const s = {
    ...grund(),
    clients: [...grund().clients, { id: 'k2', name: 'Kund B' }],
    deliverables: [{
      id: 'l1', projectId: 'u1', name: 'Fast del', amountOre: 5000000,
      vatRate: 2500, vatStatus: 'reviewed', status: 'planned', invoiceRecordId: null,
      startDate: '2026-09-01', endDate: '2026-09-30',
    }],
  };
  const ut = uppdateraUppdrag(s, 'u1', {
    name: 'Rättat uppdrag', clientId: 'k2', defaultTripKm: '46',
    artiklar: [
      { id: 'a-tid', pris: '950', vatRate: 2500 },
      { id: 'a-resa', pris: '6,25', vatRate: 2500 },
      { id: 'a-utlagg', pris: '1', vatRate: 0 },
    ],
    leveranser: [{ id: 'l1', pris: '60 000', vatRate: 1200, startDate: '2026-10-01', endDate: '2026-10-31' }],
  });

  assert.equal(ut.projects[0].name, 'Rättat uppdrag');
  assert.equal(ut.projects[0].clientId, 'k2');
  assert.equal(ut.projects[0].defaultTripKm, 46);
  assert.equal(ut.articles.find(a => a.id === 'a-tid').unitPriceOre, 95000);
  assert.equal(ut.articles.find(a => a.id === 'a-resa').unitPriceOre, 625);
  assert.equal(ut.articles.find(a => a.id === 'a-utlagg').vatRate, 0);
  assert.equal(ut.deliverables[0].amountOre, 6000000);
  assert.equal(ut.deliverables[0].vatRate, 1200);
  assert.equal(ut.deliverables[0].startDate, '2026-10-01');
  assert.equal(ut.deliverables[0].endDate, '2026-10-31');
});

test('ett låst fastpris kan inte rättas förrän underlaget flyttats tillbaka', () => {
  const s = {
    ...grund(),
    deliverables: [{
      id: 'l1', projectId: 'u1', name: 'Låst del', amountOre: 5000000,
      vatRate: 2500, vatStatus: 'reviewed', status: 'included', invoiceRecordId: 'und-1',
      startDate: '2026-09-01', endDate: '2026-09-30',
    }],
  };
  const fore = JSON.stringify(s);
  assert.throws(() => uppdateraUppdrag(s, 'u1', {
    name: 'Uppdrag A', clientId: 'k1', defaultTripKm: '', artiklar: [],
    leveranser: [{ id: 'l1', pris: '60000', vatRate: 2500, startDate: '2026-09-01', endDate: '2026-09-30' }],
  }), /Flytta tillbaka/);
  assert.equal(JSON.stringify(s), fore, 'indata får inte delvis ändras när valideringen stoppar');
});

test('arbetstid per tillfälle rättar öppna pass men ändrar inte fakturakvantiteten', () => {
  const session = { ...artikel('a-pass', 'u1', 'session', 'pass'), unitPriceOre: 240000 };
  const s = {
    ...grund(),
    articles: [...grund().articles, session],
    poster: [
      { id: 'oppet', projectId: 'u1', articleId: 'a-pass', date: '2026-08-20',
        qtyMilli: 1000, seconds: null, status: 'open', invoiceRecordId: null },
      { id: 'klart', projectId: 'u1', articleId: 'a-pass', date: '2026-07-20',
        qtyMilli: 1000, seconds: 5400, status: 'handled', invoiceRecordId: null },
    ],
  };
  const ut = uppdateraUppdrag(s, 'u1', {
    name: 'Uppdrag A', clientId: 'k1', defaultTripKm: '',
    artiklar: [{ id: 'a-pass', pris: '2400', vatRate: 2500, arbetstidTimmar: '3' }],
    leveranser: [],
  });
  assert.equal(ut.articles.find(a => a.id === 'a-pass').workSecondsPerUnit, 10800);
  assert.equal(ut.poster.find(p => p.id === 'oppet').seconds, 10800);
  assert.equal(ut.poster.find(p => p.id === 'oppet').qtyMilli, 1000);
  assert.equal(ut.poster.find(p => p.id === 'klart').seconds, 5400);
  assert.equal(L.fakturerbartOre(ut, [ut.poster.find(p => p.id === 'oppet')]), 240000);
});

test('tid på fastpris kan få en anteckning utan att bli fakturerbar', () => {
  const s = {
    ...grund(),
    articles: [...grund().articles, artikel('a-fasttid', 'u1', 'trackingOnly', 'tim')],
    poster: [{ id: 'fasttid', projectId: 'u1', articleId: 'a-fasttid', sourceType: 'entry',
      date: '2026-08-27', qtyMilli: 2000, seconds: 7200, status: 'open', invoiceRecordId: null }],
  };
  const ut = L.andraPost(s, 'fasttid', { qtyMilli: 3000, anteckning: 'Förberedelse inför verkstad' });
  const p = ut.poster.find(x => x.id === 'fasttid');
  assert.equal(p.seconds, 10800);
  assert.equal(p.anteckning, 'Förberedelse inför verkstad');
  assert.equal(L.kanIngaIFakturaunderlag(ut, p), false);
  assert.equal(L.arbetadTidSekunder([p]), 10800);

  const sparadFil = franAppTillstand(ut);
  assert.equal(sparadFil.entries.find(x => x.id === 'fasttid').anteckning,
    'Förberedelse inför verkstad');
  const inlastIgen = tillAppTillstand(sparadFil).tillstand;
  assert.equal(inlastIgen.poster.find(x => x.id === 'fasttid').anteckning,
    'Förberedelse inför verkstad');
});

test('en registrering kan flyttas till rätt uppdrag och arbetstyp', () => {
  const s = {
    ...grund(),
    clients: [...grund().clients, { id: 'k2', name: 'Kund B' }],
    projects: [...grund().projects, { id: 'u2', clientId: 'k2', name: 'Uppdrag B', kind: 'billable', active: true }],
    articles: [...grund().articles, artikel('a-tid-2', 'u2', 'hourly', 'tim')],
    poster: [{
      id: 'fel', projectId: 'u1', articleId: 'a-tid', sourceType: 'entry',
      date: '2026-08-27', qtyMilli: 1000, seconds: 3600, status: 'open', invoiceRecordId: null,
    }],
  };
  const ut = L.andraPost(s, 'fel', {
    projectId: 'u2', articleId: 'a-tid-2', date: '2026-08-28', qtyMilli: 2500,
  });
  const p = ut.poster[0];
  assert.equal(p.projectId, 'u2');
  assert.equal(p.articleId, 'a-tid-2');
  assert.equal(p.date, '2026-08-28');
  assert.equal(p.qtyMilli, 2500);
  assert.equal(p.seconds, 9000);
  assert.equal(p.sourceType, 'entry');
});

test('en registrering kan inte byta huvudtyp eller ändras när den är låst', () => {
  const s = {
    ...grund(),
    poster: [{
      id: 'fel', projectId: 'u1', articleId: 'a-tid', sourceType: 'entry',
      date: '2026-08-27', qtyMilli: 1000, seconds: 3600, status: 'open', invoiceRecordId: null,
    }],
  };
  assert.throws(() => L.andraPost(s, 'fel', { projectId: 'u1', articleId: 'a-resa' }), /huvudtyp/);
  const last = { ...s, poster: [{ ...s.poster[0], invoiceRecordId: 'und-1' }] };
  assert.throws(() => L.andraPost(last, 'fel', { qtyMilli: 2000 }), /överfört/);
});
