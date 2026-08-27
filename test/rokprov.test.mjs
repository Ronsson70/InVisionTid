// Rökprov: produktionssidan renderad på riktigt, med en minimal DOM-stubbe.
//
// Det här är sista kontrollen före deployment och den enda som kör hela
// produktionskedjan — start.mjs → lagring → införande → ui — i ett svep.
//
// Två saker bevisas:
//
//   1. Sidan visar rätt läge (inloggning respektive "Starta nya InVisionTid").
//   2. Ingenting skrivs till OneDrive innan Ronney skrivit JA, SKRIV.
//
// Nätverket är en stubbe som registrerar varje begäran, så testet kan påstå
// något om vad som INTE skickades.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { skapaTestdata } from '../prototyp/testdata.mjs';

const repoRot = fileURLToPath(new URL('../', import.meta.url));
const V1 = 'InVisionTid/invisiontid-data.json';
const V2 = 'InVisionTid/invisiontid-data-v2.json';
const v1txt = readFileSync(join(repoRot, 'test-fixtures', 'v1-legacy.json'), 'utf8');

const TOKEN_NYCKEL = 'invisiontid-ms-token';
const UTGANG_NYCKEL = 'invisiontid-ms-expiry';

/** Minimal DOM som räcker för att fånga det appen renderar. */
function stubbaWebblasare() {
  const nod = () => ({
    innerHTML: '', value: '', textContent: '', dataset: {}, style: {},
    appendChild() {}, removeChild() {}, click() {}, addEventListener() {},
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
  });
  const app = nod();
  const lagrat = new Map();
  const anrop = [];
  const filer = { [V1]: v1txt };

  globalThis.document = {
    getElementById: id => (id === 'app' ? app : null),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: nod, addEventListener() {}, body: nod(),
  };
  globalThis.window = {
    location: { origin: 'https://tid.example', pathname: '/', hash: '', href: '', reload() {} },
    addEventListener() {}, setTimeout,
  };
  globalThis.location = globalThis.window.location;
  globalThis.localStorage = {
    getItem: k => (lagrat.has(k) ? lagrat.get(k) : null),
    setItem: (k, v) => lagrat.set(k, String(v)),
    removeItem: k => lagrat.delete(k),
  };
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Blob = class {};

  globalThis.fetch = async (url, init = {}) => {
    const metod = init.method ?? 'GET';
    anrop.push({ metod, url: String(url) });
    const m = String(url).match(/root:\/(.+?)(:\/content)?$/);
    const sokvag = m ? decodeURIComponent(m[1]) : null;

    if (metod === 'PUT') { filer[sokvag] = init.body; return { ok: true, status: 200, json: async () => ({}) }; }
    if (filer[sokvag] === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (m?.[2]) return { ok: true, status: 200, text: async () => filer[sokvag] };
    return {
      ok: true, status: 200,
      json: async () => ({
        id: 'i', size: filer[sokvag].length, eTag: '"e"',
        lastModifiedDateTime: '2026-08-11T23:47:21Z',
      }),
    };
  };

  return {
    app, anrop, filer,
    loggaIn: () => {
      lagrat.set(TOKEN_NYCKEL, 'stubbat-token');
      lagrat.set(UTGANG_NYCKEL, String(Date.now() + 3600e3));
    },
  };
}

/** Alla namn och belopp som bara finns i testdatan. */
function testdataOrd() {
  const d = skapaTestdata(new Date('2026-08-27T09:00:00'));
  const ord = new Set();
  for (const c of d.clients || []) ord.add(c.name);
  for (const p of d.projects || []) ord.add(p.name);
  return [...ord].filter(Boolean);
}

test('rökprov: produktionssidan renderas i rätt läge och skriver ingenting', async () => {
  const w = stubbaWebblasare();
  const { start } = await import('../src/app/start.mjs');

  // ── Läge 1: inte inloggad ────────────────────────────────────────────────
  await start();
  assert.match(w.app.innerHTML, /Logga in med Microsoft/, 'inloggningssidan visas');
  assert.equal(w.anrop.length, 0, 'inget nätverksanrop görs innan inloggning');

  // ── Läge 2: inloggad, men ingen v2-fil ───────────────────────────────────
  w.loggaIn();
  w.anrop.length = 0;
  await start();
  const sida = w.app.innerHTML;

  assert.match(sida, /Starta nya InVisionTid/, 'kontrollsidan visas');
  assert.ok(sida.includes('JA, SKRIV'), 'den ordagranna bekräftelsen krävs');
  assert.match(sida, /SHA-256/, 'checksumman visas');

  // Det viktigaste påståendet i hela sviten.
  const skrivningar = w.anrop.filter(a => a.metod === 'PUT');
  assert.deepEqual(skrivningar, [], 'ingenting får skrivas innan bekräftelsen');
  assert.equal(w.filer[V2], undefined, 'ingen v2-fil har skapats');
  assert.equal(w.filer[V1], v1txt, 'v1-filen är byte för byte oförändrad');
});

test('rökprov: produktionssidan visar ingen testdata', async () => {
  const w = stubbaWebblasare();
  const { start } = await import('../src/app/start.mjs');
  w.loggaIn();
  await start();
  const sida = w.app.innerHTML;

  // Hela ord, inte delsträngar: "Behandling" är ett uppdragsnamn i testdatan
  // men också början på den fullt giltiga etiketten "Behandlingstillfällen".
  const heltOrd = ord => new RegExp(String.raw`\b${ord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`);

  for (const ord of testdataOrd()) {
    assert.ok(!heltOrd(ord).test(sida), `testdatanamnet "${ord}" syns på produktionssidan`);
  }
  for (const ord of ['Testversion', 'Börja om', 'Ladda testdata']) {
    assert.ok(!sida.includes(ord), `"${ord}" hör inte hemma i produktion`);
  }

  // Kontrollsidan visar antal, aldrig kundnamn ur den verkliga filen.
  for (const kund of JSON.parse(v1txt).clients) {
    assert.ok(!sida.includes(kund.name), `kundnamnet "${kund.name}" ska inte visas`);
  }
});
