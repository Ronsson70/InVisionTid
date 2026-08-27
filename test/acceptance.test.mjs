// Acceptanstester T1–T13 mot v2-kontraktet.
//
// FÖRVÄNTAT RÖD i etapp 2. Suiten är skriven innan implementationen finns, så den
// visar exakt vad v1 inte klarar. Baslinjen per 2026-08-27 mot v1:
//
//   godkända   T7, T12
//   fel svar   T8   (2 400 kr i stället för 3 250 kr, en prismodell per projekt)
//   saknas     T1, T2, T3, T4, T5, T6, T9, T10, T11, T13
//
// Kör "node test/rapport.mjs" för en läsbar tabell med orsaker.
// När etapp 3 lägger till test/adapters/v2.mjs körs samma fall mot v2 med
// IVT_MAL=v2 och ska då bli helt gröna.

import test from 'node:test';
import assert from 'node:assert/strict';
import { kontroller } from './acceptance-checks.mjs';

const mal = process.env.IVT_MAL || 'v1';
const adapter = await import(`./adapters/${mal}.mjs`);

test(`Acceptans T1–T13 mot ${adapter.namn}`, async t => {
  for (const k of kontroller) {
    await t.test(`${k.id} – ${k.namn}`, () => {
      try {
        const detalj = k.kor(adapter);
        assert.ok(detalj, `${k.id} ska returnera en beskrivning av utfallet`);
      } catch (e) {
        if (e.name === 'EjStodd') {
          assert.fail(`${k.id} saknar stöd i ${mal}: ${e.orsak}\n  Krav: ${k.krav}`);
        }
        throw e;
      }
    });
  }
});
