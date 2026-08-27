// Prototypens skal. Behålls för referens.
//
// Samma gränssnitt som produktionsappen — det finns bara ett. Skillnaden är
// lagringen: här sparas allt i webbläsaren under en egen nyckel, och
// produktionens OneDrive-fil rörs aldrig.

import { startaApp } from '../src/app/ui.mjs';
import { skapaTestdata } from './testdata.mjs';

const NYCKEL = 'invisiontid-prototyp-5a';

/** Lagring i webbläsaren. Produktionsnyckeln invisiontid-data rörs aldrig. */
const minneslagring = {
  las() {
    try {
      const sparat = localStorage.getItem(NYCKEL);
      if (sparat) return JSON.parse(sparat);
    } catch { /* börjar om med färska testdata */ }
    return null;
  },
  async spara(tillstand) {
    try { localStorage.setItem(NYCKEL, JSON.stringify(tillstand)); } catch { /* testversion */ }
  },
};

startaApp({
  lagring: minneslagring,
  tillstand: minneslagring.las() ?? skapaTestdata(),
  banner: 'Testversion med påhittade data. Ingen koppling till OneDrive eller Lundify.',
  tillaterAterstallning: true,
  aterstall: () => {
    try { localStorage.removeItem(NYCKEL); } catch { /* ignoreras */ }
    return skapaTestdata();
  },
});
