// Skyddsnät för v1 innan v2-arbetet börjar.
//
// Testerna här täcker migrate() och mergeData() — de två funktioner som avgör om
// data överlever en synk, och som ligger UTANFÖR PURE-sektionen och därför inte
// kan nås av test.html. De har alltså ingen testtäckning alls idag.
//
// Suiten ska vara grön både före och efter migreringen till v2. Blir den röd har
// någonting i datalagret gått sönder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { laddaSyncV1, laddaV1Fixture } from './lib/pure-v1.mjs';

const { migrate, mergeData } = laddaSyncV1();

test('migrate: tomt objekt får fullständig struktur', () => {
  const d = migrate({});
  for (const falt of ['clients', 'projects', 'entries', 'expenses', 'trips', 'invoices']) {
    assert.ok(Array.isArray(d[falt]), `${falt} ska vara en array`);
  }
  assert.equal(typeof d.deletedIds, 'object');
  assert.equal(d.hourlyRate, 850);
  assert.equal(d.kmRate, 2.5);
  assert.equal(d.settings.staleWarningDays, 7);
  assert.equal(d.schemaVersion, 1);
});

test('migrate: null och skräpvärden kraschar inte', () => {
  for (const skrap of [null, undefined, 0, 'text', [], true]) {
    const d = migrate(skrap);
    assert.ok(Array.isArray(d.entries), `${JSON.stringify(skrap)} ska ge en giltig struktur`);
  }
});

test('migrate: är idempotent', () => {
  const ra = laddaV1Fixture();
  const ett = migrate(structuredClone(ra));
  const tva = migrate(structuredClone(ett));
  assert.deepEqual(tva, ett);
});

test('migrate: tappar ingenting ur den syntetiska v1-fixturen', () => {
  const ra = laddaV1Fixture();
  const fore = {
    clients: ra.clients.length, projects: ra.projects.length, entries: ra.entries.length,
    expenses: ra.expenses.length, trips: ra.trips.length, invoices: ra.invoices.length,
    tombstones: Object.keys(ra.deletedIds).length,
  };
  const d = migrate(structuredClone(ra));
  assert.equal(d.clients.length, fore.clients);
  assert.equal(d.projects.length, fore.projects);
  assert.equal(d.entries.length, fore.entries);
  assert.equal(d.expenses.length, fore.expenses);
  assert.equal(d.trips.length, fore.trips);
  assert.equal(d.invoices.length, fore.invoices);
  assert.equal(Object.keys(d.deletedIds).length, fore.tombstones);
});

test('migrate: bevarar okända fält på posterna', () => {
  const d = migrate({ entries: [{ id: 'e1', projectId: 'p1', date: '2026-06-01', seconds: 3600, framtidaFalt: 'kvar' }] });
  assert.equal(d.entries[0].framtidaFalt, 'kvar');
});

test('mergeData: returnerar lokal data när fjärrdata saknas', () => {
  const local = migrate({ entries: [{ id: 'e1', projectId: 'p1', date: '2026-06-01', seconds: 3600 }] });
  assert.equal(mergeData(local, null), local);
  assert.equal(mergeData(local, {}), local);
});

test('mergeData: nyaste versionen av samma post vinner', () => {
  const bas = { id: 'e1', projectId: 'p1', date: '2026-06-01', seconds: 3600 };
  const local = migrate({ entries: [{ ...bas, moment: 'gammal', updatedAt: '2026-06-01T10:00:00.000Z' }] });
  const remote = migrate({ entries: [{ ...bas, moment: 'ny', updatedAt: '2026-06-02T10:00:00.000Z' }] });
  assert.equal(mergeData(local, remote).entries[0].moment, 'ny');
  assert.equal(mergeData(remote, local).entries[0].moment, 'ny');
});

test('mergeData: tombstone överlever en tur och retur', () => {
  const post = { id: 'e1', projectId: 'p1', date: '2026-06-01', seconds: 3600, createdAt: '2026-06-01T10:00:00.000Z' };
  const local = migrate({ entries: [], deletedIds: { e1: '2026-06-02T10:00:00.000Z' } });
  const remote = migrate({ entries: [post] });
  const ut = mergeData(local, remote);
  assert.equal(ut.entries.length, 0, 'raderad post får inte återuppstå från fjärrsidan');
  assert.equal(ut.deletedIds.e1, '2026-06-02T10:00:00.000Z');
});

test('mergeData: post som uppdaterats EFTER raderingen kommer tillbaka', () => {
  const post = { id: 'e1', projectId: 'p1', date: '2026-06-01', seconds: 3600, updatedAt: '2026-06-03T10:00:00.000Z' };
  const local = migrate({ entries: [], deletedIds: { e1: '2026-06-02T10:00:00.000Z' } });
  const remote = migrate({ entries: [post] });
  assert.equal(mergeData(local, remote).entries.length, 1);
});

test('mergeData: poster från båda sidor slås ihop utan förlust', () => {
  const local = migrate({ entries: [{ id: 'a', projectId: 'p1', date: '2026-06-01', seconds: 3600 }] });
  const remote = migrate({ entries: [{ id: 'b', projectId: 'p1', date: '2026-06-02', seconds: 3600 }] });
  const ut = mergeData(local, remote);
  assert.deepEqual(ut.entries.map(e => e.id).sort(), ['a', 'b']);
});

test('mergeData: fakturamarkeringar dedupliceras på projectId + month', () => {
  const local = migrate({ invoices: [{ projectId: 'p1', month: '2026-06', invoicedAt: '2026-07-01' }] });
  const remote = migrate({ invoices: [{ projectId: 'p1', month: '2026-06', invoicedAt: '2026-07-02' }] });
  const ut = mergeData(local, remote);
  assert.equal(ut.invoices.length, 1);
});

test('mergeData: settings överlever synken och lokalt värde vinner', () => {
  // mergeData bygger ett HELT NYTT objekt. Varje fält som inte räknas upp där
  // försvinner vid synk, oavsett vad migrate() gör. Testet låser fast att
  // settings faktiskt räknas upp, så nästa nya fält inte tappas tyst.
  const local = migrate({ settings: { staleWarningDays: 14 } });
  const remote = migrate({ settings: { staleWarningDays: 3 } });
  assert.equal(mergeData(local, remote).settings.staleWarningDays, 14);
});

test('mergeData: hourlyRate, kmRate och weeklyGoal överlever synken', () => {
  const local = migrate({ hourlyRate: 900, kmRate: 5.5, weeklyGoal: 12000 });
  const remote = migrate({ hourlyRate: 850, kmRate: 2.5, weeklyGoal: 0 });
  const ut = mergeData(local, remote);
  assert.equal(ut.hourlyRate, 900);
  assert.equal(ut.kmRate, 5.5);
  assert.equal(ut.weeklyGoal, 12000);
});
