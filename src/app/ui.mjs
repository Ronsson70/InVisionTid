// Gränssnittet för In Vision Tid v2.
//
// Ingen beräkning sker här. Belopp, moms och avrundning kommer från
// src/app/logik.mjs, som i sin tur använder den testade domänen i src/domain.
//
// LAGRINGEN SKICKAS IN. Produktionsappen ger en OneDrive-lagring, prototypen en
// lagring i minnet. Gränssnittet vet inte vilken det är, och innehåller därför
// varken testdata eller en väg tillbaka till testdata.

import * as L from './logik.mjs';

const DAGAR = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const FARGER = ['#7C9082', '#D4856A', '#8B7EA8', '#C4A55A', '#5B8A72', '#B07156'];

// ── Tillstånd ───────────────────────────────────────────────────────────────

let s, vy = 'idag', veckoOffset = 0, ark = null, flash = null, kopierat = false;
let tidigareUppdrag = [];

/** Lagringen. Sätts av startaApp och byts aldrig under körning. */
let lagring = null;
let installningar = {
  testlage: false, banner: null, tillaterAterstallning: false,
  tidigareUppdragFel: null, kontoNamn: null, synkaOm: null, loggaUt: null,
};

/** Sparläget som visas för användaren. */
let sparlage = 'sparat';      // sparat | sparar | osparat | konflikt | offline | fel
let sparbesked = null;
let sparTimer = null;

export const SPARETIKETT = {
  sparat: 'Sparat',
  sparar: 'Sparar…',
  osparat: 'Osparade ändringar',
  konflikt: 'Synkkonflikt',
  offline: 'Offline',
  fel: 'Kunde inte spara',
};

function sattSparlage(lage, besked = null) {
  sparlage = lage;
  sparbesked = besked;
  rita();
}

export const harOsparadeAndringar = () => sparlage === 'osparat' || sparlage === 'sparar';

/**
 * Sparar mot lagringen. Debouncat, så en rad snabba ändringar blir en skrivning.
 * Vid synkkonflikt sparas ingenting och användaren får veta varför.
 */
function spara() {
  if (!lagring) return;
  sattSparlage('osparat');
  clearTimeout(sparTimer);
  sparTimer = setTimeout(async () => {
    sattSparlage('sparar');
    try {
      await lagring.spara(s);
      sattSparlage('sparat');
    } catch (e) {
      if (e.name === 'Synkkonflikt') {
        sattSparlage('konflikt', e.message);
      } else if (e.name === 'Natverksfel') {
        sattSparlage('offline', 'Ingen kontakt med OneDrive. Ändringarna finns kvar i webbläsaren.');
      } else {
        sattSparlage('fel', e.message);
      }
    }
  }, 600);
}

// ── Hjälpare ────────────────────────────────────────────────────────────────

const idag = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kr = ore => L.belopp(ore);      // hela kronor utan ,00
const timmar = sek => (sek / 3600).toFixed(1).replace('.', ',');
const langtDatum = d => {
  const o = new Date(d + 'T12:00:00');
  return `${DAGAR[o.getDay()]} ${o.getDate()} ${MANADER[o.getMonth()]}`;
};
const kortDatum = d => {
  const o = new Date(d + 'T12:00:00');
  return `${DAGAR[o.getDay()].slice(0, 3)} ${o.getDate()}/${o.getMonth() + 1}`;
};
const farg = pid => FARGER[Math.max(0, s.projects.findIndex(p => p.id === pid)) % FARGER.length];

function visa(text) { flash = text; rita(); setTimeout(() => { flash = null; rita(); }, 2600); }

/** Ett belopp får aldrig stå ensamt utan att säga om momsen ingår. */
const beloppMedMarkning = (ore, markning) =>
  `<span class="varde">${esc(kr(ore))}</span><div class="markning">${esc(markning)}</div>`;

// ── Postrad ─────────────────────────────────────────────────────────────────

function postrad(p, { klickbar = true } = {}) {
  const a = L.artikelFor(s, p.articleId);
  const ejFakt = L.arEndastUppfoljning(s, p);
  const mangd = L.kvantitetTillText(p.qtyMilli, a?.unit);
  const last = !!p.invoiceRecordId;
  return `<div class="postrad" ${klickbar ? `data-post="${esc(p.id)}" role="button" tabindex="0"` : ''}>
    <span class="prick" style="background:${farg(p.projectId)}"></span>
    <span class="txt">
      <span class="namn">${esc(L.radrubrik(s, p))}</span>
      <span class="under">${esc(mangd)}${last ? ' · klart i Lundify' : ''}</span>
    </span>
    ${ejFakt
      ? `<span class="ejfakt">${esc(L.ejFakturerbarText(s, p))}</span>`
      : `<span class="belopp">${esc(kr(L.fakturerbartOre(s, [p])))}<small>exkl. moms</small></span>`}
  </div>`;
}

/**
 * En genomförd leverans visas som en HÄNDELSE, inte som ett belopp.
 * Pengarna tjänas in över upparbetningsperioden, inte den dag leveransen
 * blev klar. Att visa hela beloppet här skulle ge sken av motsatsen.
 */
function leveransrad(l) {
  return `<div class="postrad" data-leverans="${esc(l.id)}" role="button" tabindex="0">
    <span class="prick" style="background:${farg(l.projectId)}"></span>
    <span class="txt">
      <span class="namn">${esc(l.uppdragnamn)} · ${esc(l.name)}</span>
      <span class="under">leverans genomförd${l.invoiceRecordId ? ' · klart i Lundify' : ''}</span>
    </span>
    <span class="ejfakt">Upparbetas över perioden</span>
  </div>`;
}

// ── Vy: Idag ────────────────────────────────────────────────────────────────

function vyIdag() {
  const d = idag();
  // Vyn frågar logiken. Den summerar inte själv.
  const dagen = L.fakturaunderlagForDag(s, d);
  const { poster, leveranser } = dagen;
  const forslag = L.saknadeResorForDag(s, d);

  return `
  <header><h1>Idag</h1><div class="datum">${esc(langtDatum(d))}</div></header>

  <div class="knapprad">
    <button class="storknapp" data-oppna="tillfalle"><span class="ikon">✦</span>Tillfälle</button>
    <button class="storknapp" data-oppna="tid"><span class="ikon">⏱</span>Tid</button>
    <button class="storknapp" data-oppna="resa"><span class="ikon">⛟</span>Resa</button>
  </div>
  <button class="merknapp" data-oppna="mer">Mer · uppdrag, leverans och synk</button>

  <div class="kort">
    <div class="rubrik">Dagens registreringar</div>
    ${poster.length || leveranser.length
      ? poster.map(p => postrad(p)).join('') + leveranser.map(leveransrad).join('')
      : '<div class="tom">Inget registrerat än idag.</div>'}
    ${poster.length || leveranser.length ? (dagen.harFakturerbart
      ? `<div class="summa"><span class="etikett">Fakturaunderlag idag</span>
           <span class="hoger">${beloppMedMarkning(dagen.beloppOre, 'exklusive moms')}</span></div>`
      : '<div class="summa"><span class="etikett">Fakturaunderlag idag</span><span class="ejfakt stor">Inte fakturerbart</span></div>') : ''}
    ${forslag.map(f => `<div class="forslag">
        <span class="txt">Du har arbetat hos <strong>${esc(f.kundnamn)}</strong> idag men inte registrerat någon resa.</span>
        <button data-godkannresa="${esc(f.projectId)}|${esc(f.date)}|${f.km}">Lägg till ${f.km} km</button>
        <button class="neka" data-avboj="1">Ingen resa</button>
      </div>`).join('')}
  </div>`;
}

// ── Vy: Vecka ───────────────────────────────────────────────────────────────

function vyVecka() {
  const datum = L.veckansDatum(veckoOffset);
  const forsta = new Date(datum[0] + 'T12:00:00');
  const sista = new Date(datum[6] + 'T12:00:00');
  const etikett = `${forsta.getDate()} ${MANADER[forsta.getMonth()].slice(0, 3)} – ${sista.getDate()} ${MANADER[sista.getMonth()].slice(0, 3)}`;
  const veckansPoster = s.poster.filter(p => datum.includes(p.date));

  const dagar = datum.map(d => {
    const poster = L.posterForDag(s, d);
    const leveranser = L.genomfordaLeveranserForDag(s, d);
    const saknar = L.saknadeResorForDag(s, d);
    if (!poster.length && !leveranser.length) return '';
    return `<div class="dag">
      <div class="dagrubrik">
        <span class="dagnamn">${esc(kortDatum(d))}${d === idag() ? '<span class="idagmark">idag</span>' : ''}</span>
        <span class="dagsumma">${esc(timmar(L.arbetadTidSekunder(poster)))} h</span>
      </div>
      ${poster.map(p => postrad(p)).join('')}
      ${leveranser.map(leveransrad).join('')}
      ${saknar.map(f => `<div class="forslag">
          <span class="txt">Saknar resa till ${esc(f.kundnamn)}.</span>
          <button data-godkannresa="${esc(f.projectId)}|${esc(f.date)}|${f.km}">Lägg till ${f.km} km</button>
          <button class="neka" data-avboj="1">Ingen resa</button>
        </div>`).join('')}
    </div>`;
  }).join('');

  const v = L.veckoSammanstallning(s, veckoOffset);
  const bredd = v.harMal ? Math.min(100, Math.round(v.jobbatInOre / v.malOre * 100)) : 0;

  return `
  <header><h1>Vecka</h1><div class="datum">Tryck på en rad för att ändra eller ta bort.</div></header>
  <div class="veckonav">
    <button data-vecka="-1" aria-label="Föregående vecka">◀</button>
    <span class="mitt"><span class="p">${esc(etikett)}</span></span>
    <button data-vecka="1" aria-label="Nästa vecka">▶</button>
  </div>

  <div class="kort">
    <div class="rubrik">Jobbat in denna vecka</div>
    <div class="malbelopp">${esc(kr(v.jobbatInOre))}<small>exklusive moms</small></div>
    <button class="lankknapp mitten" data-oppna="veckomal">${v.harMal ? 'Ändra veckomål' : 'Sätt veckomål'}</button>
    ${v.harMal ? `
      <div class="matare"><div class="matarfyll" style="width:${bredd}%"></div></div>
      <div class="maltext">${esc(L.maltext(v))}</div>
      <div class="malrader malruta">
        <div class="brad"><span>Upparbetat</span><span>${esc(kr(v.jobbatInOre))}</span></div>
        <div class="brad"><span>Veckans mål</span><span>${esc(kr(v.malOre))}</span></div>
        <div class="brad stark"><span>${v.naddMal ? 'Över målet' : 'Kvar till målet'}</span><span>${esc(kr(v.naddMal ? v.overskjutandeOre : v.kvarOre))}</span></div>
      </div>` : ''}
    <div class="malrader">
      <div class="brad"><span>Jobbat in</span><span>${esc(kr(v.jobbatInOre))}</span></div>
      ${v.delar.timarbeteOre ? `<div class="brad under"><span>Timarbete</span><span>${esc(kr(v.delar.timarbeteOre))}</span></div>` : ''}
      ${v.delar.tillfallenOre ? `<div class="brad under"><span>Behandlingstillfällen</span><span>${esc(kr(v.delar.tillfallenOre))}</span></div>` : ''}
      ${v.delar.styckOre ? `<div class="brad under"><span>Styckprisat arbete</span><span>${esc(kr(v.delar.styckOre))}</span></div>` : ''}
      ${v.delar.fastPrisAndelOre ? `<div class="brad under"><span>Fast pris, veckans andel</span><span>${esc(kr(v.delar.fastPrisAndelOre))}</span></div>` : ''}
      <div class="brad avstand"><span>Resor att fakturera</span><span>${esc(kr(v.resorOre))}</span></div>
      <div class="brad"><span>Utlägg att ersätta</span><span>${esc(kr(v.utlaggOre))}</span></div>
      <div class="brad stark"><span>Totalt fakturaunderlag</span><span>${esc(kr(v.totaltUnderlagOre))}</span></div>
      <div class="markning">exklusive moms</div>
    </div>
    ${v.delar.fastPrisAndelOre ? `<div class="notis">Fast pris tjänas in över sin upparbetningsperiod och ingår i Jobbat in. Det faktureras när leveransen är genomförd och vald, med hela det avtalade beloppet, och ingår därför inte i veckans fakturaunderlag.</div>` : ''}
    ${v.ofullstandigaPerioder.map(p => `<div class="varning">
      <strong>Upparbetningsperioden behöver anges</strong>${esc(p.namn)} saknar start- eller slutdatum eller belopp, och räknas därför inte in i Jobbat in.
    </div>`).join('')}
    <div class="malrader avskild">
      <div class="brad"><span>Arbetad tid</span><span>${esc(timmar(v.arbetadTidSekunder))} h</span></div>
    </div>
  </div>

  <div class="kort">
    ${dagar || '<div class="tom">Inget registrerat den här veckan.</div>'}
    ${veckansPoster.length ? `<div class="summa">
      <span class="etikett">Arbetad tid</span>
      <span class="varde">${esc(timmar(L.arbetadTidSekunder(veckansPoster)))} h</span>
    </div>` : ''}
  </div>`;
}

// ── Vy: Fakturera ───────────────────────────────────────────────────────────

const MANADSNAMN = m => {
  const [ar, man] = String(m).split('-');
  return MANADER[parseInt(man, 10) - 1] ? `${MANADER[parseInt(man, 10) - 1]} ${ar}` : m;
};

/** Ett kort under Redo för Lundify: kund, period, innehåll, belopp, knapp. */
function redokort(g) {
  const forhand = L.forhandsvisa(s, g.id);
  return `<div class="kort kundkort">
    <div class="kundnamn">${esc(g.kundnamn)}</div>
    <div class="kortperiod">${esc(MANADSNAMN(g.period))}</div>
    <div class="sammanfattning">${esc(g.sammanfattning)}</div>
    ${g.uppdrag.length > 1 ? `<div class="notis">${esc(g.uppdrag.join(' och '))}</div>` : ''}
    <div class="summa">
      <span class="etikett">Redo för Lundify</span>
      <span class="hoger">${beloppMedMarkning(forhand ? forhand.nettoOre : g.summaOre, 'exklusive moms')}</span>
    </div>
    <button class="primar" data-underlag="${esc(g.id)}">Visa underlag</button>
  </div>`;
}

/** Ett kort under Behöver kontrolleras: problemet och nästa åtgärd. */
function kontrollkort(g) {
  const atgard = g.atgard ?? { besked: 'Behöver kontrolleras', artiklar: [] };
  return `<div class="kort kundkort">
    <div class="kundnamn">${esc(g.kundnamn)}</div>
    <div class="kortperiod">${esc(MANADSNAMN(g.period))}</div>
    <div class="varning">
      <strong>${esc(atgard.besked)}</strong>
      ${atgard.artiklar.length ? esc(atgard.artiklar.map(a => a.name ?? a).join(', ')) : ''}
    </div>
    ${g.utanMoms.map(a => `<button class="primar" data-angemoms="${esc(a.id)}">Ange moms</button>`).join('')}
    ${g.leveranser.map(l => `<div class="postrad">
      <span class="txt">
        <span class="namn">${esc(l.name)}</span>
        <span class="under">fast leverans · ${esc(kr(l.amountOre))} exklusive moms</span>
      </span>
      <button class="valjknapp" data-valjleverans="${esc(g.id)}|${esc(l.id)}">Ta med leveransen i underlaget</button>
    </div>`).join('')}
  </div>`;
}

/** Ett kort under Klart i Lundify. Fakturanummer visas bara om det finns. */
function klartkort(r) {
  return `<div class="statusrad">
    <div class="statustxt">
      <div class="kundnamn liten">${esc(r.kundnamn)}</div>
      <div class="under">${esc(MANADSNAMN(r.period))} · ${esc(kr(r.nettoOre))} exklusive moms</div>
      <div class="under">Klart ${esc(r.klarmarkeradAt)}${r.invoiceNumber ? ` · faktura ${esc(r.invoiceNumber)}` : ''}</div>
    </div>
    <div class="statusknappar">
      <button class="lankknapp" data-angra="${esc(r.id)}">Ångra</button>
    </div>
  </div>`;
}

function vyFakturera() {
  const grupper = L.underlagsgrupper(s);
  const kontroll = grupper.filter(g => g.lage === L.LAGE_KONTROLL);
  const redo = grupper.filter(g => g.lage === L.LAGE_REDO);
  const klara = L.klaraUnderlag(s);

  const avsnitt = (titel, innehall) => innehall
    ? `<div class="avsnitt"><div class="avsnittsrubrik">${esc(titel)}</div>${innehall}</div>` : '';

  const inget = !kontroll.length && !redo.length && !klara.length;

  return `
  <header><h1>Fakturera</h1><div class="datum">Underlag per kund och månad.</div></header>
  ${inget ? '<div class="kort"><div class="tom">Inget att fakturera just nu.</div></div>' : ''}
  ${avsnitt('Behöver kontrolleras', kontroll.map(kontrollkort).join(''))}
  ${avsnitt('Redo för Lundify', redo.map(redokort).join(''))}
  ${avsnitt('Klart i Lundify', klara.length
    ? `<div class="kort">${klara.map(klartkort).join('')}
        <div class="notis">Lundify håller reda på fakturanummer, utskick och betalning.</div>
      </div>` : '')}`;
}

// ── Vy: Uppföljning ─────────────────────────────────────────────────────────

function vyUppfoljning() {
  const manad = idag().slice(0, 7);
  const namn = MANADER[parseInt(manad.slice(5, 7), 10) - 1];

  // EN sammanställning. Vyn kombinerar inte siffror från två beräkningsvägar.
  const m = L.manadsSammanstallning(s, manad);
  const kunder = L.perKund(s, L.manadensDatum(s, manad));

  return `
  <header><h1>Uppföljning</h1><div class="datum">${esc(namn)} · enkel prototyp</div></header>
  <div class="kort">
    <div class="uppfrad"><span>Jobbat in<div class="markning">exklusive moms</div></span><span class="v">${esc(kr(m.jobbatInOre))}</span></div>
    <div class="uppfrad"><span>Redo för Lundify<div class="markning">exklusive moms</div></span><span class="v">${esc(kr(m.redoForLundifyOre))}</span></div>
    <div class="uppfrad"><span>Klart i Lundify<div class="markning">exklusive moms</div></span><span class="v">${esc(kr(m.klartILundifyOre))}</span></div>
    <div class="uppfrad"><span>Arbetad tid</span><span class="v">${esc(timmar(m.arbetadTidSekunder))} h</span></div>
  </div>
  <div class="kort">
    <div class="rubrik">Kostnadsersättning</div>
    <div class="uppfrad"><span>Resor</span><span class="v">${esc(kr(m.resorOre))}</span></div>
    <div class="uppfrad"><span>Utlägg</span><span class="v">${esc(kr(m.utlaggOre))}</span></div>
    <div class="notis">Visas separat från det du har jobbat in.</div>
  </div>
  <div class="kort">
    <div class="rubrik">Per kund</div>
    ${kunder.length ? kunder.map(k => `<div class="postrad">
      <span class="txt"><span class="namn">${esc(k.namn)}</span>
      <span class="under">${esc(timmar(k.sekunder))} h${k.sort !== 'billable' ? ' · internt' : ''}</span></span>
      ${k.beloppOre ? `<span class="belopp">${esc(kr(k.beloppOre))}<small>exkl. moms</small></span>`
        : '<span class="ejfakt">Inte fakturerbart</span>'}
    </div>`).join('') : '<div class="tom">Inget registrerat den här månaden.</div>'}
  </div>`;
}

// ── Ark ─────────────────────────────────────────────────────────────────────

const RUBRIKER = {
  tillfalle: 'Behandlingstillfälle', tid: 'Arbetstid', resa: 'Resa',
  leverans: 'Leverans klar', mer: 'Mer', uppdrag: 'Mina uppdrag',
  nyttuppdrag: 'Nytt uppdrag', veckomal: 'Veckomål', konto: 'Konto och synk',
};
const TYPKARTA = { tillfalle: ['session'], tid: ['hourly', 'trackingOnly'], resa: ['travel'] };

function arkMer() {
  // Utlägg är inte byggt och visas därför inte. En synlig knapp som leder till
  // en återvändsgränd är sämre än ingen knapp alls.
  return `<div class="val">
    <button data-oppna="leverans">Leverans klar<span class="kund">Markera en avtalad leverans som genomförd</span></button>
    <button data-oppna="uppdrag">Mina uppdrag<span class="kund">Visa, återaktivera eller lägg till uppdrag</span></button>
    <button data-oppna="konto">Konto och synk<span class="kund">OneDrive, synkstatus och utloggning</span></button>
  </div>`;
}

function arkVeckomal() {
  const befintligt = s.installningar?.veckomalOre;
  const forvalt = befintligt ? String(befintligt / 100).replace('.', ',') : '';
  return `
    <p class="notis">Målet jämförs bara med Jobbat in. Resor, utlägg och moms räknas inte in.</p>
    <div class="faltrubrik">Mål per vecka, exklusive moms</div>
    <input type="text" inputmode="decimal" data-falt="veckomal" value="${esc(ark.veckomal ?? forvalt)}" placeholder="till exempel 25 000">
    <button class="spara" data-sparaveckomal="1">Spara veckomålet</button>
    ${befintligt ? '<button class="sekundar" data-tabortveckomal="1">Ta bort veckomålet</button>' : ''}
    <button class="avbryt" data-stang="knapp">Avbryt</button>`;
}

function arkKonto() {
  const ansluten = !!installningar.kontoNamn;
  return `
    <div class="uppfrad"><span>Konto</span><span class="v">${esc(ansluten ? installningar.kontoNamn : 'Testversion')}</span></div>
    <div class="uppfrad"><span>Synkstatus</span><span class="v">${esc(SPARETIKETT[sparlage] ?? sparlage)}</span></div>
    <p class="notis">${ansluten
      ? 'Ändringar sparas automatiskt i OneDrive. Synka om läser in den senaste sparade versionen på nytt.'
      : 'Testversionen använder bara webbläsaren och är inte kopplad till OneDrive.'}</p>
    ${ansluten ? `
      <button class="sekundar" data-synkaom="1">Synka om från OneDrive</button>
      <button class="avbryt" data-loggautapp="1">Logga ut eller byt konto</button>` : ''}
    <button class="avbryt" data-stang="knapp">Stäng</button>`;
}

function arkUppdrag() {
  const aktiva = [...(s.projects || [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'sv'));
  return `
    <div class="faltrubrik">Aktiva uppdrag</div>
    <div class="val">${aktiva.map(p => `
      <div class="uppdragsrad">
        <strong>${esc(p.name)}</strong>
        <span>${esc(L.kundNamnForUppdrag(s, p.id))}</span>
      </div>`).join('') || '<div class="tom">Inga aktiva uppdrag.</div>'}</div>

    ${installningar.tidigareUppdragFel ? `<div class="varning">
      <strong>Tidigare uppdrag kunde inte läsas</strong>${esc(installningar.tidigareUppdragFel)}
    </div>` : ''}
    ${tidigareUppdrag.length ? `
      <div class="faltrubrik">Tidigare uppdrag</div>
      <p class="notis">Aktivera ett uppdrag om du ska börja arbeta med det igen. Gammal historik följer inte med.</p>
      <div class="val">${tidigareUppdrag.map(p => `
        <button data-aktiverauppdrag="${esc(p.id)}">
          ${esc(p.project.name)}
          <span class="kund">${esc(p.client?.name ?? 'Utan kund')} · Aktivera igen</span>
        </button>`).join('')}</div>` : ''}

    <button class="spara" data-oppna="nyttuppdrag">Lägg till nytt uppdrag</button>
    <button class="avbryt" data-stang="knapp">Stäng</button>`;
}

function arkNyttUppdrag() {
  const debitering = ark.debitering ?? null;
  const fakturerbart = debitering && debitering !== 'internal';
  const prisetikett = debitering === 'hourly' ? 'Timpris exklusive moms'
    : debitering === 'session' ? 'Pris per tillfälle exklusive moms'
      : 'Fast pris exklusive moms';

  return `
    <div class="faltrubrik">Kund</div>
    <div class="val">${(s.clients || []).map(c => `
      <button class="${ark.clientId === c.id ? 'vald' : ''}" data-valjkund="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
      <button class="${ark.clientId === 'ny' ? 'vald' : ''}" data-valjkund="ny">+ Ny kund</button>
    </div>
    ${ark.clientId === 'ny' ? `
      <div class="faltrubrik">Kundens namn</div>
      <input type="text" data-falt="kundnamn" value="${esc(ark.kundnamn ?? '')}" autocomplete="organization">` : ''}

    <div class="faltrubrik">Uppdragets namn</div>
    <input type="text" data-falt="namn" value="${esc(ark.namn ?? '')}" autocomplete="off">

    <div class="faltrubrik">Hur räknas uppdraget?</div>
    <div class="val">${L.DEBITERINGSTYPER.map(t => `
      <button class="${debitering === t.id ? 'vald' : ''}" data-valjdebitering="${esc(t.id)}">${esc(t.etikett)}</button>`).join('')}</div>

    ${fakturerbart ? `
      <div class="faltrubrik">${esc(prisetikett)}</div>
      <input type="text" inputmode="decimal" data-falt="pris" value="${esc(ark.pris ?? '')}" placeholder="kronor">

      <div class="faltrubrik">Moms på arbete och eventuell resa</div>
      <div class="snabbval">${L.MOMSSATSER.map(m => `
        <button class="${ark.vatRate === m.sats ? 'vald' : ''}" data-valjnyvat="${m.sats}">${esc(m.etikett)}</button>`).join('')}</div>

      ${debitering === 'fixed' ? `
        <div class="faltrubrik">Upparbetningsperiod</div>
        <div class="tvakol">
          <input type="date" data-falt="startDate" value="${esc(ark.startDate ?? '')}" aria-label="Startdatum">
          <input type="date" data-falt="endDate" value="${esc(ark.endDate ?? '')}" aria-label="Slutdatum">
        </div>` : ''}

      <div class="faltrubrik">Resa, valfritt</div>
      <p class="notis">Fyll i båda fälten om resor ska kunna registreras på uppdraget.</p>
      <div class="tvakol">
        <input type="number" inputmode="decimal" data-falt="standardresaKm" value="${esc(ark.standardresaKm ?? '')}" placeholder="Standardresa, km">
        <input type="text" inputmode="decimal" data-falt="resepris" value="${esc(ark.resepris ?? '')}" placeholder="Pris per km">
      </div>` : ''}

    <button class="spara" data-sparanyttuppdrag="1">Spara uppdraget</button>
    <button class="avbryt" data-oppna="uppdrag">Tillbaka</button>`;
}

/**
 * Leverans klar. Pris och moms kan inte ändras här — de kommer från avtalet och
 * hör hemma i grunddata, inte i det dagliga flödet.
 */
function arkLeverans() {
  const valbara = L.enstakaLeveranser(s, { endastEjGenomforda: true })
    .filter(l => !L.leveransArLast(l));
  if (!valbara.length) {
    return `<div class="tom">Alla upplagda leveranser är redan markerade som genomförda.<br>
      Nya leveranser läggs upp i grunddata.</div>
      <button class="avbryt" data-stang="knapp">Stäng</button>`;
  }

  const uppdrag = [...new Set(valbara.map(l => l.projectId))];
  const valtUppdrag = ark.projectId ?? uppdrag[0];
  const forUppdrag = valbara.filter(l => l.projectId === valtUppdrag);
  const vald = forUppdrag.find(l => l.id === ark.leveransId) ?? forUppdrag[0];

  return `
    ${uppdrag.length > 1 ? `<div class="faltrubrik">Vilket uppdrag?</div>
      <div class="val">${uppdrag.map(pid => `
        <button class="${pid === valtUppdrag ? 'vald' : ''}" data-valjlevuppdrag="${esc(pid)}">
          ${esc(L.uppdragFor(s, pid)?.name ?? '')}<span class="kund">${esc(L.kundNamnForUppdrag(s, pid))}</span>
        </button>`).join('')}</div>` : ''}

    <div class="faltrubrik">Vilken leverans?</div>
    <div class="val">${forUppdrag.map(l => `
      <button class="${l.id === vald?.id ? 'vald' : ''}" data-valjleveransklar="${esc(l.id)}">
        ${esc(l.name)}<span class="kund">${esc(kr(l.amountOre))} exklusive moms</span>
      </button>`).join('')}</div>

    <div class="faltrubrik">Vilken dag genomfördes den?</div>
    <input type="date" data-falt="datum" value="${esc(ark.datum)}">

    ${vald ? `<div class="beloppforhand">${esc(kr(vald.amountOre))}<small>exklusive moms, enligt avtalet</small></div>
      ${vald.startDate && vald.endDate ? `<div class="notis">Upparbetas ${esc(vald.startDate)} till ${esc(vald.endDate)}.</div>` : ''}
      <p class="notis forklaring">${esc(L.genomforandebesked(vald))}</p>
      <button class="spara" data-markeragenomford="${esc(vald.id)}">Markera som genomförd</button>` : ''}
    <button class="avbryt" data-stang="knapp">Avbryt</button>`;
}

/** Öppnad genomförd leverans: ändra datum eller ångra genomförandet. */
function arkAndraLeverans() {
  const l = (s.deliverables || []).find(x => x.id === ark.leveransId);
  if (!l) return '<div class="tom">Leveransen finns inte längre.</div>';
  const last = L.leveransArLast(l);
  return `
    <div class="faltrubrik">${esc(L.uppdragFor(s, l.projectId)?.name ?? '')} · ${esc(l.name)}</div>
    <div class="beloppforhand">${esc(kr(l.amountOre))}<small>exklusive moms, enligt avtalet</small></div>
    <div class="faltrubrik">Vilken dag genomfördes den?</div>
    <input type="date" data-falt="datum" value="${esc(l.completedAt ?? idag())}" ${last ? 'disabled' : ''}>
    ${last
      ? `<div class="varning"><strong>Leveransen ligger i ett underlag som är klart i Lundify.</strong>
           Flytta tillbaka underlaget till Redo för Lundify om du behöver ändra.</div>
         <button class="avbryt" data-stang="knapp">Stäng</button>`
      : `<button class="spara" data-sparaleveransdatum="${esc(l.id)}">Spara datum</button>
         <button class="tabort" data-angragenomford="${esc(l.id)}">Ångra genomförandet</button>
         <button class="avbryt" data-stang="knapp">Avbryt</button>`}`;
}

function arkRegistrering() {
  const typer = TYPKARTA[ark.typ];
  const uppdrag = L.uppdragEfterSenast(s, typer);
  const valt = ark.projectId ?? uppdrag[0]?.id ?? null;
  const artikel = valt ? L.artikelForUppdrag(s, valt, typer.find(t => L.artikelForUppdrag(s, valt, t))) : null;

  const uppdragVal = `<div class="faltrubrik">Vilket uppdrag?</div>
    <div class="val">${uppdrag.map((p, i) => `
      <button class="${p.id === valt ? 'vald' : ''}" data-valjuppdrag="${esc(p.id)}">
        ${esc(p.name)}<span class="kund">${esc(L.kundNamnForUppdrag(s, p.id))}${i === 0 && !ark.projectId ? ' · senast använt' : ''}</span>
      </button>`).join('')}</div>`;

  let mangdVal = '';
  if (ark.typ === 'tillfalle') {
    mangdVal = `<div class="faltrubrik">Hur många tillfällen?</div>
      <div class="antal">
        <button data-antal="-1" aria-label="Färre">−</button>
        <span class="varde">${ark.antal}</span>
        <button data-antal="1" aria-label="Fler">+</button>
      </div>`;
  } else if (ark.typ === 'tid') {
    mangdVal = `<div class="faltrubrik">Hur länge?</div>
      <div class="snabbval">
        ${[0.5, 1, 1.5, 2, 3, 4].map(h => `<button class="${ark.timmar === h ? 'vald' : ''}" data-timmar="${h}">${String(h).replace('.', ',')} h</button>`).join('')}
      </div>
      <div class="faltrubrik">eller ange klockslag</div>
      <div class="tvakol">
        <input type="time" data-falt="start" value="${esc(ark.start ?? '')}" aria-label="Från">
        <input type="time" data-falt="slut" value="${esc(ark.slut ?? '')}" aria-label="Till">
      </div>`;
  } else if (ark.typ === 'resa') {
    const std = L.uppdragFor(s, valt)?.defaultTripKm;
    mangdVal = `<div class="faltrubrik">Hur långt?</div>
      <div class="snabbval">
        ${std ? `<button class="${ark.km === std ? 'vald' : ''}" data-km="${std}">${std} km</button>` : ''}
        ${[10, 20, 50, 100].filter(k => k !== std).map(k => `<button class="${ark.km === k ? 'vald' : ''}" data-km="${k}">${k} km</button>`).join('')}
      </div>
      <div class="faltrubrik">eller skriv antal kilometer</div>
      <input type="number" inputmode="numeric" data-falt="km" value="${esc(ark.km ?? '')}" placeholder="km">`;
  }

  const datumVal = `<div class="faltrubrik">Vilken dag?</div>
    <input type="date" data-falt="datum" value="${esc(ark.datum)}">`;

  const forhand = beraknaForhand(valt, artikel);
  return `${uppdragVal}${mangdVal}${datumVal}
    ${forhand !== null
      ? `<div class="beloppforhand">${esc(kr(forhand))}<small>exklusive moms</small></div>`
      : '<div class="beloppforhand"><small>Inte fakturerbart</small></div>'}
    <button class="spara" data-spara="1" ${forhandGiltig() ? '' : 'disabled'}>Spara</button>
    <button class="avbryt" data-stang="knapp">Avbryt</button>`;
}

function aktuellQty() {
  if (ark.typ === 'tillfalle') return ark.antal * L.MILLI;
  if (ark.typ === 'resa') return Math.round((Number(ark.km) || 0) * L.MILLI);
  if (ark.typ === 'tid') {
    if (ark.start && ark.slut) {
      const [sh, sm] = ark.start.split(':').map(Number);
      const [eh, em] = ark.slut.split(':').map(Number);
      let min = (eh * 60 + em) - (sh * 60 + sm);
      if (min < 0) min += 24 * 60;
      return Math.round(min / 60 * L.MILLI);
    }
    return Math.round((Number(ark.timmar) || 0) * L.MILLI);
  }
  return 0;
}
function forhandGiltig() { return aktuellQty() > 0; }

function beraknaForhand(projectId, artikel) {
  if (!artikel || !projectId) return null;
  const post = { projectId, articleId: artikel.id, qtyMilli: aktuellQty() };
  // Urvalsregeln bor i logiken. Vyn frågar, den bedömer inte.
  if (!L.kanIngaIFakturaunderlag(s, post)) return null;
  return L.fakturerbartOre(s, [post]);
}

function arkAndra() {
  const p = s.poster.find(x => x.id === ark.postId);
  if (!p) return '<div class="tom">Posten finns inte längre.</div>';
  const a = L.artikelFor(s, p.articleId);
  return `
    <div class="faltrubrik">${esc(L.radrubrik(s, p))}</div>
    <div class="faltrubrik">Antal ${esc(a?.unit ?? '')}</div>
    <input type="number" inputmode="decimal" step="0.5" data-falt="mangd" value="${esc(p.qtyMilli / L.MILLI)}">
    <div class="faltrubrik">Vilken dag?</div>
    <input type="date" data-falt="datum" value="${esc(p.date)}">
    ${p.invoiceRecordId ? '<div class="varning"><strong>Posten hör till ett underlag som är klart i Lundify och kan inte ändras.</strong>Flytta tillbaka underlaget till Redo för Lundify först.</div>' : `
      <button class="spara" data-sparaandring="${esc(p.id)}">Spara ändring</button>
      <button class="tabort" data-tabort="${esc(p.id)}">Ta bort registreringen</button>
      <button class="avbryt" data-stang="knapp">Avbryt</button>`}`;
}

/** Moms väljs uttryckligen. Ingen sats är förvald och ingenting sparas av sig självt. */
function arkMoms() {
  const a = L.artikelFor(s, ark.articleId);
  return `
    <div class="faltrubrik">${esc(a?.name ?? '')}</div>
    <p class="notis">Momssatsen är inte fastställd för den här arbetstypen. Välj vilken som gäller enligt avtalet.</p>
    <div class="faltrubrik">Momssats</div>
    <div class="val">${L.MOMSSATSER.map(m => `
      <button class="${ark.valdSats === m.sats ? 'vald' : ''}" data-valjmoms="${m.sats}">${esc(m.etikett)}</button>`).join('')}</div>
    <button class="spara" data-sparamoms="${esc(ark.articleId)}" ${ark.valdSats === null ? 'disabled' : ''}>Spara momssats</button>
    <button class="avbryt" data-stang="knapp">Avbryt</button>`;
}

function arkUnderlag() {
  const r = ark.referens;
  const u = ark.underlag;
  return `
    ${ark.period ? `<div class="notis">Avser ${esc(ark.period)}</div>` : ''}
    <div class="underlagrader">
      ${u.rader.map(rad => `<div class="ulrad">
        <div class="ulnamn">${esc(rad.beskrivning)}</div>
        <div class="ulunder">${esc(L.kvantitetTillText(rad.qtyMilli, rad.unit))} · ${esc(kr(rad.unitPriceOre))} per ${esc(rad.unit)} · moms ${esc(L.momsText(rad.vatRate))}</div>
        <div class="ulbelopp">${esc(kr(rad.nettoOre))}</div>
      </div>`).join('')}
    </div>
    <div class="beloppblock">
      <div class="brad"><span>Exklusive moms</span><span>${esc(kr(u.nettoOre))}</span></div>
      <div class="brad"><span>Moms</span><span>${esc(kr(u.momsOre))}</span></div>
      ${u.avrundningOre ? `<div class="brad"><span>Öresavrundning</span><span>${esc(kr(u.avrundningOre))}</span></div>` : ''}
      <div class="brad stark"><span>Inklusive moms</span><span>${esc(kr(u.attBetalaOre))}</span></div>
    </div>
    <button class="primar" data-kopiera="1">${kopierat ? 'Kopierat' : 'Kopiera underlaget'}</button>
    <p class="notis forklaring">${esc(L.OVERFORINGSBESKED)}</p>
    <button class="sekundar" data-markklart="${esc(r.id)}">Klart – jag har lagt in det i Lundify</button>
    <button class="lankknapp mitten" data-merinfo="1">${ark.merinfo ? 'Dölj mer information' : 'Mer information'}</button>
    ${ark.merinfo ? `
      <div class="faltrubrik">Fakturanummer, frivilligt</div>
      <p class="notis">Behövs inte. Lundify äger fakturanumret. Anteckna det bara om du vill kunna hitta tillbaka.</p>
      <input type="text" data-falt="fakturanummer" value="${esc(ark.fakturanummer ?? r.invoiceNumber ?? '')}" placeholder="till exempel 2341">
      <button class="sekundar" data-sparanummer="${esc(r.id)}">Spara anteckningen</button>` : ''}
    <button class="avbryt" data-stang="knapp">Stäng utan att ändra något</button>`;
}

function ritaArk() {
  if (!ark) return '';
  let innehall = '';
  if (ark.typ === 'mer') innehall = arkMer();
  else if (ark.typ === 'uppdrag') innehall = arkUppdrag();
  else if (ark.typ === 'nyttuppdrag') innehall = arkNyttUppdrag();
  else if (ark.typ === 'veckomal') innehall = arkVeckomal();
  else if (ark.typ === 'konto') innehall = arkKonto();
  else if (ark.typ === 'andra') innehall = arkAndra();
  else if (ark.typ === 'moms') innehall = arkMoms();
  else if (ark.typ === 'underlag') innehall = arkUnderlag();
  else if (ark.typ === 'leverans') innehall = arkLeverans();
  else if (ark.typ === 'andraleverans') innehall = arkAndraLeverans();
  else innehall = arkRegistrering();

  return `<div class="ark" data-stang="bakgrund"><div class="arkinne">
    <div class="arkrubrik">
      <h2>${esc(ark.rubrik ?? RUBRIKER[ark.typ] ?? '')}</h2>
      <button data-stang="knapp" aria-label="Stäng">×</button>
    </div>
    ${innehall}
  </div></div>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function rita() {
  const vyer = { idag: vyIdag, vecka: vyVecka, fakturera: vyFakturera, uppfoljning: vyUppfoljning };
  const flikar = [
    ['idag', '☀', 'Idag'], ['vecka', '▤', 'Vecka'],
    ['fakturera', '⛁', 'Fakturera'], ['uppfoljning', '◔', 'Uppföljning'],
  ];
  document.getElementById('app').innerHTML = `
    ${installningar.banner ? `<div class="testbanner">
      <span>${esc(installningar.banner)}</span>
      ${installningar.tillaterAterstallning ? '<button data-borjaom="1">Börja om</button>' : ''}
    </div>` : ''}
    <div class="sparlist ${esc(sparlage)}">
      <span class="sparprick"></span>
      <span>${esc(SPARETIKETT[sparlage] ?? sparlage)}</span>
      ${sparbesked ? `<span class="sparbesked">${esc(sparbesked)}</span>` : ''}
      ${sparlage === 'konflikt' ? '<button data-laddaom="1">Ladda om</button>' : ''}
      <button class="lankknapp" data-oppna="konto">Konto och synk</button>
    </div>
    ${flash ? `<div class="testbanner" style="background:var(--sage-deep)">${esc(flash)}</div>` : ''}
    ${vyer[vy]()}
    <div class="navutrymme"></div>
    <nav>${flikar.map(([id, ikon, txt]) =>
      `<button class="${vy === id ? 'aktiv' : ''}" data-vy="${id}"><span class="ikon">${ikon}</span>${txt}</button>`).join('')}</nav>
    ${ritaArk()}`;
}

// ── Händelser ───────────────────────────────────────────────────────────────

const VALJARE = ['vy', 'oppna', 'valjuppdrag', 'antal', 'timmar', 'km', 'spara', 'stang', 'post',
  'sparaandring', 'tabort', 'vecka', 'godkannresa', 'avboj', 'underlag', 'valjleverans', 'kopiera',
  'markklart', 'merinfo', 'sparanummer', 'borjaom', 'angemoms', 'valjmoms', 'sparamoms',
  'angra', 'valjlevuppdrag', 'valjleveransklar', 'markeragenomford', 'leverans',
  'sparaleveransdatum', 'angragenomford', 'aktiverauppdrag', 'valjkund',
  'valjdebitering', 'valjnyvat', 'sparanyttuppdrag', 'sparaveckomal',
  'tabortveckomal', 'synkaom', 'loggautapp'].map(n => `[data-${n}]`).join(',');

document.addEventListener('click', e => {
  const t = e.target.closest(VALJARE);
  if (!t) return;
  const d = t.dataset;

  if (d.borjaom) return borjaOm();
  if (d.laddaom) { window.location.reload(); return; }
  if (d.synkaom) return synkaOmFranOneDrive();
  if (d.loggautapp) return loggaUtFranApp();
  if (d.vy) { vy = d.vy; ark = null; return rita(); }
  if (d.vecka) { veckoOffset += Number(d.vecka); return rita(); }
  if (d.stang) { if (d.stang === 'knapp' || e.target.classList.contains('ark')) { ark = null; kopierat = false; rita(); } return; }

  if (d.oppna) {
    if (d.oppna === 'mer') ark = { typ: 'mer' };
    else if (d.oppna === 'uppdrag') ark = { typ: 'uppdrag' };
    else if (d.oppna === 'nyttuppdrag') ark = {
      typ: 'nyttuppdrag', clientId: null, kundnamn: '', namn: '', debitering: null,
      pris: '', vatRate: null, startDate: '', endDate: '', standardresaKm: '', resepris: '',
    };
    else if (d.oppna === 'leverans') ark = { typ: 'leverans', projectId: null, leveransId: null, datum: idag() };
    else ark = { typ: d.oppna, projectId: null, antal: 1, timmar: 1, km: null, start: '', slut: '', datum: idag() };
    return rita();
  }
  if (d.valjlevuppdrag) { ark.projectId = d.valjlevuppdrag; ark.leveransId = null; return rita(); }
  if (d.valjleveransklar) { ark.leveransId = d.valjleveransklar; return rita(); }
  if (d.markeragenomford) return markeraGenomford(d.markeragenomford);
  if (d.leverans) { ark = { typ: 'andraleverans', leveransId: d.leverans, rubrik: 'Genomförd leverans' }; return rita(); }
  if (d.sparaleveransdatum) return sparaLeveransdatum(d.sparaleveransdatum);
  if (d.angragenomford) return angraGenomford(d.angragenomford);
  if (d.valjuppdrag) { ark.projectId = d.valjuppdrag; ark.km = null; return rita(); }
  if (d.antal) { ark.antal = Math.max(1, ark.antal + Number(d.antal)); return rita(); }
  if (d.timmar) { ark.timmar = Number(d.timmar); ark.start = ''; ark.slut = ''; return rita(); }
  if (d.km) { ark.km = Number(d.km); return rita(); }
  if (d.aktiverauppdrag) return aktiveraTidigare(d.aktiverauppdrag);
  if (d.valjkund) { ark.clientId = d.valjkund; return rita(); }
  if (d.valjdebitering) { ark.debitering = d.valjdebitering; ark.pris = ''; return rita(); }
  if (d.valjnyvat !== undefined) { ark.vatRate = Number(d.valjnyvat); return rita(); }
  if (d.sparanyttuppdrag) return sparaNyttUppdrag();
  if (d.sparaveckomal) return sparaVeckomal();
  if (d.tabortveckomal) return taBortVeckomal();

  if (d.spara) return sparaNy();
  if (d.post) { ark = { typ: 'andra', postId: d.post, rubrik: 'Ändra registrering' }; return rita(); }
  if (d.sparaandring) return sparaAndring(d.sparaandring);
  if (d.tabort) return taBort(d.tabort);
  if (d.avboj) { return visa('Inget reseförslag den här gången.'); }
  if (d.godkannresa) return godkannResa(d.godkannresa);
  if (d.underlag) return skapaUnderlag(d.underlag, []);
  if (d.valjleverans) { const [kid, lid] = d.valjleverans.split('|'); return skapaUnderlag(kid, [lid]); }
  if (d.kopiera) return kopiera();
  if (d.markklart) return markeraKlart(d.markklart);
  if (d.merinfo) { ark.merinfo = !ark.merinfo; return rita(); }
  if (d.sparanummer) return sparaNummer(d.sparanummer);
  if (d.angemoms) { ark = { typ: 'moms', articleId: d.angemoms, valdSats: null, rubrik: 'Ange moms' }; return rita(); }
  if (d.valjmoms) { ark.valdSats = Number(d.valjmoms); return rita(); }
  if (d.sparamoms) return sparaMoms(d.sparamoms);
  if (d.angra) return angraOverforing(d.angra);
});

document.addEventListener('input', e => {
  const f = e.target.dataset.falt;
  if (!f || !ark) return;
  if (f === 'km') { ark.km = e.target.value === '' ? null : Number(e.target.value); return; }
  ark[f] = e.target.value;
  if (f === 'start' || f === 'slut') { ark.timmar = null; rita(); }
});

// ── Åtgärder ────────────────────────────────────────────────────────────────

function aktiveraTidigare(id) {
  const paket = tidigareUppdrag.find(p => p.id === id);
  if (!paket) return visa('Det tidigare uppdraget finns inte längre.');
  try {
    s = L.aktiveraTidigareUppdrag(s, paket);
    tidigareUppdrag = tidigareUppdrag.filter(p => p.id !== id);
    spara(); ark = { typ: 'uppdrag' };
    visa('Uppdraget är aktivt igen. Ingen gammal historik fördes över.');
  } catch (e) { visa(e.message); }
}

function sparaNyttUppdrag() {
  try {
    s = L.skapaNyttUppdrag(s, ark);
    spara(); ark = { typ: 'uppdrag' };
    visa('Det nya uppdraget är sparat.');
  } catch (e) { visa(e.message); }
}

function sparaVeckomal() {
  try {
    s = L.sattVeckomal(s, ark.veckomal);
    spara(); ark = null;
    visa('Veckomålet är sparat.');
  } catch (e) { visa(e.message); }
}

function taBortVeckomal() {
  s = L.taBortVeckomal(s);
  spara(); ark = null;
  visa('Veckomålet är borttaget.');
}

function synkaOmFranOneDrive() {
  if (harOsparadeAndringar()) return visa('Vänta tills Sparat visas innan du synkar om.');
  if (installningar.synkaOm) installningar.synkaOm();
}

function loggaUtFranApp() {
  if (harOsparadeAndringar()) return visa('Vänta tills Sparat visas innan du loggar ut.');
  if (installningar.loggaUt) installningar.loggaUt();
}

function sparaNy() {
  const typer = TYPKARTA[ark.typ];
  const projectId = ark.projectId ?? L.uppdragEfterSenast(s, typer)[0]?.id;
  if (!projectId) return visa('Välj ett uppdrag först.');
  const typ = typer.find(t => L.artikelForUppdrag(s, projectId, t));
  const artikel = L.artikelForUppdrag(s, projectId, typ);
  if (!artikel) return visa('Det uppdraget har ingen sådan arbetstyp.');
  const qty = aktuellQty();
  if (qty <= 0) return visa('Fyll i hur mycket det gäller.');

  s = L.laggTillPost(s, {
    id: L.nyttId(), projectId, articleId: artikel.id,
    date: ark.datum || idag(), beskrivning: artikel.name, qtyMilli: qty,
    seconds: artikel.unit === 'tim' ? Math.round(qty / L.MILLI * 3600) : null,
    sourceType: ark.typ === 'resa' ? 'trip' : 'entry',
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  spara(); ark = null; visa('Registrerat.');
}

function sparaAndring(id) {
  const mangd = document.querySelector('[data-falt="mangd"]')?.value;
  const datum = document.querySelector('[data-falt="datum"]')?.value;
  try {
    const p = s.poster.find(x => x.id === id);
    const a = L.artikelFor(s, p.articleId);
    const qty = Math.round((Number(mangd) || 0) * L.MILLI);
    if (qty <= 0) return visa('Antalet måste vara större än noll.');
    s = L.andraPost(s, id, {
      qtyMilli: qty, date: datum || p.date,
      seconds: a?.unit === 'tim' ? Math.round(qty / L.MILLI * 3600) : p.seconds,
    });
    spara(); ark = null; visa('Ändringen är sparad.');
  } catch (e) { visa(e.message); }
}

function taBort(id) {
  try { s = L.taBortPost(s, id); spara(); ark = null; visa('Registreringen är borttagen.'); }
  catch (e) { visa(e.message); }
}

function godkannResa(varde) {
  const [projectId, datum, km] = varde.split('|');
  const artikel = L.artikelForUppdrag(s, projectId, 'travel');
  if (!artikel) return visa('Uppdraget har ingen resa upplagd.');
  s = L.laggTillPost(s, {
    id: L.nyttId(), projectId, articleId: artikel.id, date: datum,
    beskrivning: 'Resa tur och retur', qtyMilli: Number(km) * L.MILLI, seconds: null,
    sourceType: 'trip', status: 'open', invoiceRecordId: null, priceSnapshot: null,
  });
  spara(); visa(`Resa på ${km} km tillagd.`);
}

function sparaMoms(articleId) {
  if (ark.valdSats === null) return visa('Välj en momssats först.');
  try {
    s = L.sattMoms(s, articleId, ark.valdSats);
    spara(); ark = null; visa('Momssatsen är sparad.');
  } catch (e) { visa(e.message); }
}

function markeraGenomford(id) {
  const res = L.markeraGenomford(s, id, ark.datum || idag());
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null;
  visa('Leveransen är markerad som genomförd.');
}

function sparaLeveransdatum(id) {
  const datum = document.querySelector('[data-falt="datum"]')?.value;
  const res = L.andraGenomforandedatum(s, id, datum);
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null;
  visa('Datumet är sparat.');
}

function angraGenomford(id) {
  const res = L.angraGenomford(s, id);
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null;
  visa('Leveransen är inte längre markerad som genomförd.');
}

function skapaUnderlag(gruppId, valdaLeveranser) {
  const res = L.forberedUnderlag(s, gruppId, { valdaLeveranser });
  if (!res.ok) return visa(res.besked);
  const clientId = res.grupp.clientId;
  const referens = {
    id: res.underlag.id, clientId, period: res.grupp.period, status: 'prepared',
    nettoOre: res.underlag.nettoOre, momsOre: res.underlag.momsOre,
    attBetalaOre: res.underlag.attBetalaOre,
    invoiceNumber: null, klarmarkeradAt: null,
  };
  s = { ...s, poster: res.poster, invoiceRecords: [...(s.invoiceRecords || []), referens] };
  if (valdaLeveranser.length) {
    s = { ...s, deliverables: s.deliverables.map(l =>
      valdaLeveranser.includes(l.id) ? { ...l, status: 'included', invoiceRecordId: referens.id } : l) };
  }
  spara();
  kopierat = false;
  ark = {
    typ: 'underlag',
    rubrik: `Underlag till Lundify – ${L.kundFor(s, clientId)?.name ?? ''}`,
    text: L.lundifyText(s, res.underlag),
    period: L.underlagsPeriod(res.underlag),
    underlag: res.underlag,
    referens,
  };
  rita();
}

async function kopiera() {
  try {
    await navigator.clipboard.writeText(ark.text);
    kopierat = true; rita();
    setTimeout(() => { kopierat = false; if (ark?.typ === 'underlag') rita(); }, 2200);
  } catch { visa('Kunde inte kopiera. Markera texten och kopiera för hand.'); }
}

function markeraKlart(id) {
  const res = L.markeraKlart(s, id, { datum: idag() });
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null; kopierat = false;
  visa('Klart i Lundify.');
}

function sparaNummer(id) {
  const nummer = document.querySelector('[data-falt="fakturanummer"]')?.value ?? '';
  s = L.antecknaFakturanummer(s, id, nummer).state;
  spara(); ark = null;
  visa(nummer.trim() ? 'Fakturanumret är antecknat.' : 'Anteckningen är borttagen.');
}

function angraOverforing(id) {
  const res = L.angraOverforing(s, id);
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null;
  visa('Underlaget är tillbaka under Redo för Lundify.');
}

// ── Start ───────────────────────────────────────────────────────────────────

/**
 * Startar appen mot en lagring.
 *
 * @param {object} opts
 * @param {object} opts.lagring          { las(), spara(state) }
 * @param {object} opts.tillstand        redan inläst tillstånd
 * @param {string} [opts.banner]         listtext högst upp, null i produktion
 * @param {Array} [opts.tidigareUppdrag] grunddata från skrivskyddad v1-fil
 * @param {boolean} [opts.tillaterAterstallning]
 * @param {Function} [opts.aterstall]
 * @param {string} [opts.kontoNamn]
 * @param {Function} [opts.synkaOm]
 * @param {Function} [opts.loggaUt]
 */
export function startaApp(opts) {
  lagring = opts.lagring;
  installningar = {
    banner: opts.banner ?? null,
    tillaterAterstallning: !!opts.tillaterAterstallning,
    aterstall: opts.aterstall ?? null,
    tidigareUppdragFel: opts.tidigareUppdragFel ?? null,
    kontoNamn: opts.kontoNamn ?? null,
    synkaOm: opts.synkaOm ?? null,
    loggaUt: opts.loggaUt ?? null,
  };
  tidigareUppdrag = opts.tidigareUppdrag ?? [];
  s = L.normaliseraTillstand(opts.tillstand);
  sparlage = 'sparat';
  vy = 'idag';
  rita();
}

function borjaOm() {
  if (!installningar.tillaterAterstallning || !installningar.aterstall) return;
  if (!window.confirm('Vill du återställa till utgångsläget? Det du har registrerat försvinner.')) return;
  s = installningar.aterstall();
  veckoOffset = 0; ark = null;
  spara();
  rita();
}

/** Varnar innan sidan lämnas med osparade ändringar. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => {
    if (!harOsparadeAndringar()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
