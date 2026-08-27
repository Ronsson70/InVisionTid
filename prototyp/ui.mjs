// Gränssnitt för användartestversionen.
//
// Ingen beräkning sker här. Belopp, moms och avrundning kommer från
// prototyp/logik.mjs, som i sin tur använder den testade domänen i src/domain.
//
// Testdata sparas i webbläsaren under en EGEN nyckel. Produktionsappens nyckel
// rörs aldrig.

import * as L from './logik.mjs';
import { skapaTestdata } from './testdata.mjs';

const NYCKEL = 'invisiontid-prototyp-5a';
const DAGAR = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
const MANADER = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const FARGER = ['#7C9082', '#D4856A', '#8B7EA8', '#C4A55A', '#5B8A72', '#B07156'];

// ── Tillstånd ───────────────────────────────────────────────────────────────

let s, vy = 'idag', veckoOffset = 0, ark = null, flash = null, kopierat = false;

function ladda() {
  try {
    const sparat = localStorage.getItem(NYCKEL);
    if (sparat) return JSON.parse(sparat);
  } catch { /* börjar om med färska testdata */ }
  return skapaTestdata();
}
function spara() {
  try { localStorage.setItem(NYCKEL, JSON.stringify(s)); } catch { /* testversion */ }
}
function borjaOm() {
  try { localStorage.removeItem(NYCKEL); } catch { /* ignoreras */ }
  s = skapaTestdata(); veckoOffset = 0; ark = null; rita();
}

// ── Hjälpare ────────────────────────────────────────────────────────────────

const idag = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kr = ore => L.oreTillText(ore);
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
  const ejFakt = L.arEjFakturerbar(s, p);
  const mangd = L.kvantitetTillText(p.qtyMilli, a?.unit);
  const last = !!p.invoiceRecordId;
  return `<div class="postrad" ${klickbar ? `data-post="${esc(p.id)}" role="button" tabindex="0"` : ''}>
    <span class="prick" style="background:${farg(p.projectId)}"></span>
    <span class="txt">
      <span class="namn">${esc(L.radrubrik(s, p))}</span>
      <span class="under">${esc(mangd)}${last ? ' · överfört till Lundify' : ''}</span>
    </span>
    ${ejFakt
      ? `<span class="ejfakt">${esc(L.ejFakturerbarText(s, p))}</span>`
      : `<span class="belopp">${esc(kr(L.fakturerbartOre(s, [p])))}<small>exkl. moms</small></span>`}
  </div>`;
}

// ── Vy: Idag ────────────────────────────────────────────────────────────────

function vyIdag() {
  const d = idag();
  const poster = L.posterForDag(s, d);
  const belopp = L.fakturerbartOre(s, poster);
  const finnsFakturerbart = poster.some(p => !L.arEjFakturerbar(s, p));
  const forslag = L.saknadeResorForDag(s, d);

  return `
  <header><h1>Idag</h1><div class="datum">${esc(langtDatum(d))}</div></header>

  <div class="knapprad">
    <button class="storknapp" data-oppna="tillfalle"><span class="ikon">✦</span>Tillfälle</button>
    <button class="storknapp" data-oppna="tid"><span class="ikon">⏱</span>Tid</button>
    <button class="storknapp" data-oppna="resa"><span class="ikon">⛟</span>Resa</button>
  </div>
  <button class="merknapp" data-oppna="mer">Mer · leverans och utlägg</button>

  <div class="kort">
    <div class="rubrik">Dagens registreringar</div>
    ${poster.length ? poster.map(p => postrad(p)).join('') : '<div class="tom">Inget registrerat än idag.</div>'}
    ${poster.length ? (finnsFakturerbart
      ? `<div class="summa"><span class="etikett">Att fakturera</span>
           <span class="hoger">${beloppMedMarkning(belopp, 'exklusive moms')}</span></div>`
      : '<div class="summa"><span class="etikett">Att fakturera</span><span class="ejfakt stor">Inte fakturerbart</span></div>') : ''}
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
    const saknar = L.saknadeResorForDag(s, d);
    if (!poster.length) return '';
    return `<div class="dag">
      <div class="dagrubrik">
        <span class="dagnamn">${esc(kortDatum(d))}${d === idag() ? '<span class="idagmark">idag</span>' : ''}</span>
        <span class="dagsumma">${esc(timmar(L.arbetadTidSekunder(poster)))} h</span>
      </div>
      ${poster.map(p => postrad(p)).join('')}
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
    ${v.harMal ? `
      <div class="matare"><div class="matarfyll" style="width:${bredd}%"></div></div>
      <div class="maltext">${esc(L.maltext(v))}</div>` : ''}
    <div class="malrader">
      <div class="brad"><span>Jobbat in</span><span>${esc(kr(v.jobbatInOre))}</span></div>
      <div class="brad"><span>Resor att fakturera</span><span>${esc(kr(v.resorOre))}</span></div>
      <div class="brad"><span>Utlägg att ersätta</span><span>${esc(kr(v.utlaggOre))}</span></div>
      <div class="brad stark"><span>Totalt fakturaunderlag</span><span>${esc(kr(v.totaltUnderlagOre))}</span></div>
      <div class="markning">exklusive moms</div>
    </div>
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

function statusrad(r) {
  const kund = L.kundFor(s, r.clientId)?.name ?? '';
  const skickad = r.status === 'lundifySent';
  return `<div class="statusrad">
    <div class="statustxt">
      <div class="kundnamn liten">${esc(kund)}</div>
      <div class="under">
        ${skickad ? `Faktura ${esc(r.invoiceNumber)} · ` : ''}${esc(kr(r.nettoOre))} exklusive moms
      </div>
      <div class="under">${esc(kr(r.attBetalaOre))} inklusive moms</div>
      <div class="under">Status: <span class="etikettbricka">${esc(L.etikettFor(r.status))}</span></div>
    </div>
    <div class="statusknappar">
      ${r.status === 'lundifyDraft'
        ? `<button class="sekundar liten" data-nummer="${esc(r.id)}">Skriv in fakturanummer</button>` : ''}
      ${skickad
        ? `<button class="sekundar liten" data-nummer="${esc(r.id)}">Rätta fakturanummer</button>` : ''}
      <button class="lankknapp" data-angra="${esc(r.id)}">Flytta tillbaka till Att fakturera</button>
    </div>
  </div>`;
}

function vyFakturera() {
  const kunder = L.underlagPerKund(s);
  const overforda = (s.invoiceRecords || []).filter(r => r.status !== 'prepared');
  const klara = L.allaOverfordaKunder(s);

  const kort = kunder.map(k => {
    const kontroll = L.forberedUnderlag(s, k.clientId);
    const forhand = k.lage === 'att-fakturera' ? L.forhandsvisa(s, k.clientId) : null;

    const uppdrag = k.uppdrag.map(u => `
      <div class="uppdragnamn">${esc(u.namn)}</div>
      ${u.rader.map(r => `<div class="postrad">
        <span class="txt">
          <span class="namn">${esc(r.artikel.name)}</span>
          <span class="under">${esc(L.kvantitetTillText(r.post.qtyMilli, r.artikel.unit))} · ${esc(kr(r.artikel.unitPriceOre))} per ${esc(r.artikel.unit)} · moms ${esc(L.momsText(r.artikel.vatRate))}</span>
        </span>
        <span class="belopp">${esc(kr(r.beloppOre))}<small>exkl. moms</small></span>
      </div>`).join('')}
      ${u.leveranser.map(l => `<div class="postrad">
        <span class="txt">
          <span class="namn">${esc(l.name)}</span>
          <span class="under">fast leverans · ${esc(kr(l.amountOre))} exklusive moms</span>
        </span>
        <button class="valjknapp" data-valjleverans="${esc(k.clientId)}|${esc(l.id)}">Ta med leveransen i underlaget</button>
      </div>`).join('')}
      ${u.loggadTidSekunder && !u.rader.length
        ? `<div class="notis">${esc(timmar(u.loggadTidSekunder))} h loggad tid. Ingår i fast pris och ökar inte beloppet.</div>` : ''}
    `).join('');

    let botten;
    if (k.lage === 'ingen-leverans-vald') {
      botten = '<div class="neutral">Ingen leverans vald. Välj en leverans ovan för att skapa ett underlag.</div>';
    } else if (k.lage === 'allt-overfort') {
      botten = '<div class="neutral">Allt är överfört till Lundify.</div>';
    } else if (k.lage === 'inget-att-fakturera') {
      botten = '<div class="neutral">Inget att fakturera just nu.</div>';
    } else if (kontroll.ok && forhand) {
      botten = `
        <div class="beloppblock">
          <div class="brad"><span>Exklusive moms</span><span>${esc(kr(forhand.nettoOre))}</span></div>
          <div class="brad"><span>Moms</span><span>${esc(kr(forhand.momsOre))}</span></div>
          <div class="brad stark"><span>Inklusive moms</span><span>${esc(kr(forhand.attBetalaOre))}</span></div>
        </div>
        <button class="primar" data-underlag="${esc(k.clientId)}">Skapa underlag för Lundify</button>`;
    } else {
      const utanMoms = L.artiklarUtanMoms(s, k.clientId);
      botten = `<div class="varning">
          <strong>${esc(kontroll.besked)}</strong>
          ${kontroll.artiklar.length ? esc(kontroll.artiklar.join(', ')) : ''}
        </div>
        ${utanMoms.map(a => `<button class="primar" data-angemoms="${esc(a.id)}">Ange moms för ${esc(a.name)}</button>`).join('')}`;
    }

    return `<div class="kort kundkort">
      <div class="kundnamn">${esc(k.kundnamn)}</div>
      ${uppdrag}
      ${botten}
    </div>`;
  }).join('');

  const klaraKort = klara.length ? `<div class="kort">
    ${klara.map(k => `<div class="neutral">${esc(k.kundnamn)} · Allt är överfört till Lundify.</div>`).join('')}
  </div>` : '';

  const overfordaKort = overforda.length ? `<div class="kort">
    <div class="rubrik">Överfört till Lundify</div>
    ${overforda.map(statusrad).join('')}
    <div class="notis">Lundify vet om fakturan är betald. Det gör inte den här appen, och därför visas det inte här.</div>
  </div>` : '';

  return `
  <header><h1>Fakturera</h1><div class="datum">Grupperat per kund och uppdrag.</div></header>
  ${kort || '<div class="kort"><div class="tom">Inget att fakturera just nu.</div></div>'}
  ${klaraKort}
  ${overfordaKort}`;
}

// ── Vy: Uppföljning ─────────────────────────────────────────────────────────

function vyUppfoljning() {
  const manad = idag().slice(0, 7);
  const u = L.uppfoljning(s, manad);
  const namn = MANADER[parseInt(manad.slice(5, 7), 10) - 1];

  const m = L.manadsSammanstallning(s, manad);

  return `
  <header><h1>Uppföljning</h1><div class="datum">${esc(namn)} · enkel prototyp</div></header>
  <div class="kort">
    <div class="uppfrad"><span>Jobbat in<div class="markning">exklusive moms</div></span><span class="v">${esc(kr(m.jobbatInOre))}</span></div>
    <div class="uppfrad"><span>Överfört till Lundify<div class="markning">exklusive moms</div></span><span class="v">${esc(kr(m.overfortOre))}</span></div>
    <div class="uppfrad"><span>Arbetad tid</span><span class="v">${esc(timmar(m.arbetadTidSekunder))} h</span></div>
  </div>
  <div class="kort">
    <div class="rubrik">Kostnadsersättning</div>
    <div class="uppfrad"><span>Resor att fakturera</span><span class="v">${esc(kr(m.resorOre))}</span></div>
    <div class="uppfrad"><span>Utlägg att ersätta</span><span class="v">${esc(kr(m.utlaggOre))}</span></div>
    <div class="notis">Visas separat från det du har jobbat in.</div>
  </div>
  <div class="kort">
    <div class="rubrik">Per kund</div>
    ${u.perKund.length ? u.perKund.map(k => `<div class="postrad">
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
  leverans: 'Fast leverans', utlagg: 'Utlägg', mer: 'Mer',
};
const TYPKARTA = { tillfalle: ['session'], tid: ['hourly', 'trackingOnly'], resa: ['travel'] };

function arkMer() {
  return `<div class="val">
    <button data-oppna="leverans">Fast leverans<span class="kund">Fakturera en genomförd leverans</span></button>
    <button data-oppna="utlagg">Utlägg<span class="kund">Kvitto som ska vidarefaktureras</span></button>
  </div>`;
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
  const u = L.uppdragFor(s, projectId);
  if (!L.arFakturerbar(artikel) || u?.kind !== 'billable') return null;
  return L.fakturerbartOre(s, [{ projectId, articleId: artikel.id, qtyMilli: aktuellQty() }]);
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
    ${p.invoiceRecordId ? '<div class="varning"><strong>Posten är överförd till Lundify och kan inte ändras.</strong>Flytta tillbaka underlaget till Att fakturera först.</div>' : `
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
    <button class="primar" data-kopiera="1">${kopierat ? 'Kopierat' : 'Kopiera till urklipp'}</button>
    <p class="notis forklaring">${esc(L.OVERFORINGSBESKED)}</p>
    <button class="sekundar" data-markoverfort="${esc(r.id)}">Jag har lagt in det i Lundify</button>
    <button class="avbryt" data-stang="knapp">Stäng utan att ändra status</button>`;
}

function arkFakturanummer() {
  const r = s.invoiceRecords.find(x => x.id === ark.referensId);
  const skickad = r?.status === 'lundifySent';
  return `
    <div class="faltrubrik">Fakturanummer från Lundify</div>
    <input type="text" data-falt="fakturanummer" value="${esc(ark.fakturanummer ?? r?.invoiceNumber ?? '')}" placeholder="till exempel 2341">
    <div class="faltrubrik">Fakturadatum</div>
    <input type="date" data-falt="fakturadatum" value="${esc(ark.fakturadatum ?? r?.invoiceDate ?? idag())}">
    <button class="spara" data-sparanummer="${esc(ark.referensId)}">${skickad ? 'Spara rättat nummer' : 'Markera som skickad'}</button>
    ${skickad ? `<button class="tabort" data-tabortnummer="${esc(ark.referensId)}">Ta bort fakturanumret</button>` : ''}
    <button class="avbryt" data-stang="knapp">Avbryt</button>`;
}

function ritaArk() {
  if (!ark) return '';
  let innehall = '';
  if (ark.typ === 'mer') innehall = arkMer();
  else if (ark.typ === 'andra') innehall = arkAndra();
  else if (ark.typ === 'moms') innehall = arkMoms();
  else if (ark.typ === 'underlag') innehall = arkUnderlag();
  else if (ark.typ === 'nummer') innehall = arkFakturanummer();
  else if (ark.typ === 'leverans' || ark.typ === 'utlagg') {
    innehall = `<div class="tom">Den här delen är inte byggd i testversionen.<br>
      Fasta leveranser faktureras från vyn Fakturera.</div>`;
  } else innehall = arkRegistrering();

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
    <div class="testbanner">
      <span>Testversion med påhittade data. Ingen koppling till OneDrive eller Lundify.</span>
      <button data-borjaom="1">Börja om</button>
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
  'markoverfort', 'nummer', 'sparanummer', 'borjaom', 'angemoms', 'valjmoms', 'sparamoms',
  'angra', 'tabortnummer'].map(n => `[data-${n}]`).join(',');

document.addEventListener('click', e => {
  const t = e.target.closest(VALJARE);
  if (!t) return;
  const d = t.dataset;

  if (d.borjaom) return borjaOm();
  if (d.vy) { vy = d.vy; ark = null; return rita(); }
  if (d.vecka) { veckoOffset += Number(d.vecka); return rita(); }
  if (d.stang) { if (d.stang === 'knapp' || e.target.classList.contains('ark')) { ark = null; kopierat = false; rita(); } return; }

  if (d.oppna) {
    if (d.oppna === 'mer') ark = { typ: 'mer' };
    else ark = { typ: d.oppna, projectId: null, antal: 1, timmar: 1, km: null, start: '', slut: '', datum: idag() };
    return rita();
  }
  if (d.valjuppdrag) { ark.projectId = d.valjuppdrag; ark.km = null; return rita(); }
  if (d.antal) { ark.antal = Math.max(1, ark.antal + Number(d.antal)); return rita(); }
  if (d.timmar) { ark.timmar = Number(d.timmar); ark.start = ''; ark.slut = ''; return rita(); }
  if (d.km) { ark.km = Number(d.km); return rita(); }

  if (d.spara) return sparaNy();
  if (d.post) { ark = { typ: 'andra', postId: d.post, rubrik: 'Ändra registrering' }; return rita(); }
  if (d.sparaandring) return sparaAndring(d.sparaandring);
  if (d.tabort) return taBort(d.tabort);
  if (d.avboj) { return visa('Inget reseförslag den här gången.'); }
  if (d.godkannresa) return godkannResa(d.godkannresa);
  if (d.underlag) return skapaUnderlag(d.underlag, []);
  if (d.valjleverans) { const [kid, lid] = d.valjleverans.split('|'); return skapaUnderlag(kid, [lid]); }
  if (d.kopiera) return kopiera();
  if (d.markoverfort) return markOverfort(d.markoverfort);
  if (d.nummer) { ark = { typ: 'nummer', referensId: d.nummer, rubrik: 'Fakturanummer' }; return rita(); }
  if (d.sparanummer) return sparaNummer(d.sparanummer);
  if (d.tabortnummer) return taBortNummer(d.tabortnummer);
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
    status: 'open', invoiceRecordId: null, priceSnapshot: null,
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

function skapaUnderlag(clientId, valdaLeveranser) {
  const res = L.forberedUnderlag(s, clientId, { valdaLeveranser });
  if (!res.ok) return visa(res.besked);
  const referens = {
    id: res.underlag.id, clientId, status: 'prepared',
    nettoOre: res.underlag.nettoOre, momsOre: res.underlag.momsOre,
    attBetalaOre: res.underlag.attBetalaOre,
    invoiceNumber: null, invoiceDate: null,
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

function markOverfort(id) {
  s = { ...s, invoiceRecords: s.invoiceRecords.map(r => r.id === id ? { ...r, status: 'lundifyDraft' } : r) };
  spara(); ark = null; kopierat = false; visa('Markerat som överfört till Lundify.');
}

function sparaNummer(id) {
  const nummer = document.querySelector('[data-falt="fakturanummer"]')?.value?.trim();
  const datum = document.querySelector('[data-falt="fakturadatum"]')?.value;
  const referens = s.invoiceRecords.find(r => r.id === id);

  if (referens.status === 'lundifySent') {
    const res = L.andraFakturanummer(s, id, nummer);
    if (!res.ok) return visa(res.besked);
    s = res.state; spara(); ark = null; return visa('Fakturanumret är rättat.');
  }
  const res = L.satStatus(referens, 'lundifySent', { invoiceNumber: nummer || null, invoiceDate: datum || null });
  if (!res.ok) return visa(res.besked);
  s = { ...s, invoiceRecords: s.invoiceRecords.map(r => r.id === id ? res.referens : r) };
  spara(); ark = null; visa('Fakturan är markerad som skickad.');
}

function taBortNummer(id) {
  const res = L.taBortFakturanummer(s, id);
  s = res.state; spara(); ark = null;
  visa('Fakturanumret är borttaget. Underlaget är åter ett utkast.');
}

function angraOverforing(id) {
  const res = L.angraOverforing(s, id);
  if (!res.ok) return visa(res.besked);
  s = res.state; spara(); ark = null;
  visa('Underlaget är tillbaka under Att fakturera.');
}

// ── Start ───────────────────────────────────────────────────────────────────

s = ladda();
rita();
