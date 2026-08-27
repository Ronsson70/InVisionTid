// Rökprov för testversionens gränssnitt.
//
// Kör ui.mjs i Node mot en minimal DOM-stubbe och kontrollerar att alla fyra
// vyerna renderar utan att kasta, och att de innehåller det de ska. Det fångar
// den vanligaste sortens fel i ett gränssnitt utan byggsteg: en stavfel i ett
// funktionsnamn som bara visar sig när man klickar sig till rätt vy.

import test from 'node:test';
import assert from 'node:assert/strict';

let html = '';
const lyssnare = {};

globalThis.document = {
  getElementById: () => ({
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
  }),
  addEventListener: (typ, fn) => { lyssnare[typ] = fn; },
  querySelector: () => null,
};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** Simulerar ett klick på ett element med givna data-attribut. */
function klicka(dataset) {
  const nod = { dataset, classList: { contains: () => false }, closest: () => nod };
  lyssnare.click({ target: nod });
}

await import('../prototyp/ui.mjs');

test('rendering: Idag visar de tre huvudvalen och Mer', () => {
  klicka({ vy: 'idag' });
  assert.match(html, /data-oppna="tillfalle"/);
  assert.match(html, /data-oppna="tid"/);
  assert.match(html, /data-oppna="resa"/);
  assert.match(html, /data-oppna="mer"/);
  // Leverans och utlägg får INTE ligga som huvudval.
  assert.ok(!/class="storknapp"[^>]*data-oppna="(leverans|utlagg)"/.test(html));
});

test('rendering: en dag med bara internt arbete visar Inte fakturerbart, inte 0,00 kr', () => {
  klicka({ vy: 'idag' });
  assert.match(html, /Att fakturera/);
  assert.match(html, /Inte fakturerbart/);
  assert.ok(!/class="varde">0,00 kr/.test(html), 'inget stort nollbelopp');
});

test('rendering: internt arbete får ingen dubbel rubrik', () => {
  klicka({ vy: 'idag' });
  assert.ok(!/Internt bolagsarbete · Internt arbete/.test(html), 'samma sak ska inte sägas två gånger');
  assert.match(html, /Internt bolagsarbete/);
});

test('rendering: fakturerbara belopp är märkta med moms', () => {
  klicka({ vy: 'vecka' });
  assert.match(html, /exkl\. moms/, 'radbelopp märks');
  assert.match(html, /exklusive moms/, 'huvudtalet märks');
});

test('rendering: Fakturera märker exklusive moms, moms och inklusive moms', () => {
  klicka({ vy: 'fakturera' });
  assert.match(html, /Exklusive moms/);
  assert.match(html, />Moms</);
  assert.match(html, /Inklusive moms/);
});

test('rendering: navigeringen har eget utrymme och kan inte täcka innehåll', () => {
  for (const v of ['idag', 'vecka', 'fakturera', 'uppfoljning']) {
    klicka({ vy: v });
    assert.match(html, /class="navutrymme"/, `${v} saknar utrymme under innehållet`);
    const utrymme = html.indexOf('class="navutrymme"');
    assert.ok(utrymme < html.indexOf('<nav>'), 'utrymmet ska ligga före menyn');
  }
});

test('rendering: Vecka visar Jobbat in som huvudtal, utan graf', () => {
  klicka({ vy: 'vecka' });
  assert.match(html, /Jobbat in denna vecka/);
  assert.match(html, /Arbetad tid|Inget registrerat/);
  assert.ok(!/<svg|<canvas/i.test(html), 'ingen graf, bara en enkel mätare');
});

test('rendering: Vecka håller isär jobbat in, resor och utlägg', () => {
  klicka({ vy: 'vecka' });
  assert.match(html, /Resor att fakturera/);
  assert.match(html, /Utlägg att ersätta/);
  assert.match(html, /Totalt fakturaunderlag/);
});

test('rendering: veckomålet jämförs med jobbat in och visar vad som är kvar', () => {
  klicka({ vy: 'vecka' });
  assert.match(html, /av veckans mål/);
  assert.match(html, /kvar\./);
  assert.match(html, /class="matare"/);
});

test('rendering: ingen lönekalkyl, skatt eller budget förekommer', () => {
  for (const v of ['idag', 'vecka', 'fakturera', 'uppfoljning']) {
    klicka({ vy: v });
    for (const ord of ['bruttolön', 'nettolön', 'skatt', 'arbetsgivaravgift', 'budget', 'prognos', 'löneutrymme']) {
      assert.ok(!new RegExp(ord, 'i').test(html), `${v} får inte nämna ${ord}`);
    }
  }
});

test('rendering: Fakturera grupperar per kund och blockerar ogranskad moms', () => {
  klicka({ vy: 'fakturera' });
  assert.match(html, /Kund A/);
  assert.match(html, /Kund B/);
  assert.match(html, /Momsen behöver kontrolleras innan underlaget kan föras över till Lundify/);
  assert.match(html, /Skapa underlag för Lundify/);
});

test('rendering: Fakturera visar loggad tid på fastpris utan att den ökar beloppet', () => {
  klicka({ vy: 'fakturera' });
  assert.match(html, /Ingår i fast pris och ökar inte beloppet/);
  assert.match(html, /Ta med leveransen i underlaget/, 'leveransen måste väljas uttryckligen');
});

test('rendering: ordet betald förekommer aldrig i Fakturera', () => {
  klicka({ vy: 'fakturera' });
  const text = html.replace(/<[^>]+>/g, ' ').toLowerCase();
  assert.ok(!/\bbetald\b|\bbetalt\b(?! enligt)/.test(text.replace('vet om fakturan är betald', '')),
    'appen får inte påstå något om betalning');
});

test('rendering: Uppföljning visar tid och kronor på egna rader', () => {
  klicka({ vy: 'uppfoljning' });
  assert.match(html, /Arbetad tid/);
  assert.match(html, /Jobbat in/);
  assert.match(html, /Överfört till Lundify/);
  assert.match(html, /Resor att fakturera/);
  assert.match(html, /Utlägg att ersätta/);
  assert.ok(!/Betalt enligt Lundify/.test(html), 'betalstatus ska vara borttagen ur första versionen');
});

test('rendering: registreringsarket kräver högst tre val', () => {
  klicka({ vy: 'idag' });
  klicka({ oppna: 'tillfalle' });
  const rubriker = [...html.matchAll(/class="faltrubrik">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(rubriker, ['Vilket uppdrag?', 'Hur många tillfällen?', 'Vilken dag?']);
  assert.match(html, /senast använt/, 'senast använda uppdrag är förvalt');
});

test('rendering: tidsarket erbjuder både snabbval och klockslag', () => {
  klicka({ oppna: 'tid' });
  assert.match(html, /Hur länge\?/);
  assert.match(html, /data-timmar="1"/);
  assert.match(html, /type="time"/);
});

test('rendering: researket föreslår uppdragets standardavstånd', () => {
  klicka({ oppna: 'resa' });
  assert.match(html, /Hur långt\?/);
  assert.match(html, /data-km="23"/, 'standardavståndet ligger först');
});

test('rendering: Mer innehåller leverans och utlägg', () => {
  klicka({ oppna: 'mer' });
  assert.match(html, /Fast leverans/);
  assert.match(html, /Utlägg/);
});

test('rendering: testbannern gör tydligt att datat är påhittat', () => {
  klicka({ vy: 'idag' });
  assert.match(html, /Testversion med påhittade data/);
  assert.match(html, /Ingen koppling till OneDrive eller Lundify/);
});
