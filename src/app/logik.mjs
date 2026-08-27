// Ren logik för användartestversionen.
//
// All prissättning, moms och avrundning kommer från src/domain. Ingen beräkning
// görs om här — det som finns här är gruppering, sortering och de besked
// gränssnittet ska visa på svenska.

import {
  byggUnderlag, lasUnderlag, OgranskadMoms,
  radbeloppOre, oreTillText, kvantitetTillText,
  foreslaResor, hittaArtikel, arFakturerbar,
  momsAnvandbar, MILLI,
  harAvtalsperiod, periodKontroll, periodandelOre, arGenomford,
  oreTillKortText,
} from '../domain/index.mjs';

export { harAvtalsperiod, periodKontroll, periodandelOre, arGenomford };

export { oreTillText, oreTillKortText, kvantitetTillText, MILLI };

/**
 * Beloppsformatet i gränssnittet: hela kronor utan ören.
 * "50 000 kr" är lättare att läsa än "50 000,00 kr", och ",00" bär ingen
 * information. Ören visas så snart de inte är noll: "566,50 kr".
 */
export const belopp = oreTillKortText;

// ── Uppslag ─────────────────────────────────────────────────────────────────

export const artikelFor = (s, id) => s.articles.find(a => a.id === id);
export const uppdragFor = (s, id) => s.projects.find(p => p.id === id);
export const kundFor = (s, id) => s.clients.find(k => k.id === id);

export function kundNamnForUppdrag(s, projectId) {
  const u = uppdragFor(s, projectId);
  return kundFor(s, u?.clientId)?.name ?? 'Utan kund';
}

/**
 * Vad en registrering ska heta på skärmen.
 *
 * "Internt bolagsarbete · Internt arbete" säger samma sak två gånger. När
 * uppdragets och arbetstypens namn överlappar räcker det ena.
 */
export function radrubrik(s, post) {
  const uppdrag = uppdragFor(s, post.projectId)?.name ?? '';
  const artikel = artikelFor(s, post.articleId)?.name ?? '';
  if (!artikel) return uppdrag;
  if (!uppdrag) return artikel;

  const nyckelord = t => t.toLowerCase().replace(/[^a-zåäö ]/g, '').split(/\s+/).filter(o => o.length > 3);
  const gemensamma = nyckelord(uppdrag).filter(o => nyckelord(artikel).includes(o));
  if (gemensamma.length) return uppdrag;

  return `${uppdrag} · ${artikel}`;
}

// ── Urvalsregler ────────────────────────────────────────────────────────────
//
// Tre regler med SKILDA betydelser. Ett enda "billable" hade dolt skillnaden
// mellan dem, och det är just den skillnaden som avgör om en siffra hamnar
// rätt.
//
//   kanIngaIFakturaunderlag   får bli en fakturarad: arbete, resor, utlägg
//   raknasSomJobbatIn         räknas som inarbetade pengar: arbete, INTE
//                             resor och utlägg som är kostnadsersättning
//   arEndastUppfoljning       loggas men faktureras aldrig: trackingOnly,
//                             internt och ideellt
//
// Reglerna finns bara här. Gränssnittet frågar, det bedömer inte.

/** Sant när uppdraget över huvud taget får faktureras. */
export const uppdragArFakturerbart = uppdrag =>
  uppdrag?.kind === 'billable';

/** Sant när posten får bli en rad i ett fakturaunderlag. */
export function kanIngaIFakturaunderlag(s, post) {
  const artikel = artikelFor(s, post.articleId);
  const uppdrag = uppdragFor(s, post.projectId);
  if (!artikel || !uppdrag) return false;
  if (!uppdragArFakturerbart(uppdrag)) return false;   // internt och ideellt
  return arFakturerbar(artikel);                       // inte trackingOnly
}

/** Sant när posten bara loggas för uppföljning och aldrig faktureras. */
export function arEndastUppfoljning(s, post) {
  return !kanIngaIFakturaunderlag(s, post);
}

/** Varför posten inte kan faktureras, på vanlig svenska. */
export function ejFakturerbarText(s, post) {
  const uppdrag = uppdragFor(s, post.projectId);
  if (uppdrag?.kind === 'internal' || uppdrag?.kind === 'voluntary') return 'Inte fakturerbart';
  return 'Ingår i fast pris';
}

/** Artiklar av en viss typ, för registreringsvalen. */
export function artiklarAvTyp(s, typer) {
  const lista = Array.isArray(typer) ? typer : [typer];
  return s.articles.filter(a => a.active && lista.includes(a.type));
}

// ── Senast använt ───────────────────────────────────────────────────────────

/**
 * Uppdrag sorterade efter senaste användning, nyast först. Uppdrag som aldrig
 * använts hamnar sist i sin egen ordning. Det är det som gör att ett vanligt
 * val räcker med ett tryck.
 */
export function uppdragEfterSenast(s, artikeltyper = null) {
  const senast = {};
  for (const p of s.poster) {
    if (artikeltyper) {
      const a = artikelFor(s, p.articleId);
      if (!a || !artikeltyper.includes(a.type)) continue;
    }
    if (!senast[p.projectId] || p.date > senast[p.projectId]) senast[p.projectId] = p.date;
  }
  return [...s.projects]
    .filter(p => !artikeltyper || s.articles.some(a => a.projectId === p.id && artikeltyper.includes(a.type)))
    .sort((a, b) => {
      const sa = senast[a.id] || '';
      const sb = senast[b.id] || '';
      if (sa !== sb) return sb.localeCompare(sa);
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
}

/** Artikeln av en viss typ som hör till uppdraget. */
export function artikelForUppdrag(s, projectId, typ) {
  return s.articles.find(a => a.projectId === projectId && a.type === typ && a.active) || null;
}

// ── Dagens och veckans poster ───────────────────────────────────────────────

export const posterForDag = (s, datum) => s.poster.filter(p => p.date === datum);

/** Fakturerbart belopp EXKLUSIVE moms för en uppsättning poster. */
export function fakturerbartOre(s, poster) {
  return poster.reduce((summa, p) => {
    if (!kanIngaIFakturaunderlag(s, p)) return summa;
    const a = artikelFor(s, p.articleId);
    return summa + radbeloppOre(a.unitPriceOre, p.qtyMilli);
  }, 0);
}

/**
 * Dagens fakturaunderlag: poster plus genomförda fristående leveranser.
 * Gränssnittet ska inte summera leveranser på egen hand.
 */
export function fakturaunderlagForDag(s, datum) {
  const poster = posterForDag(s, datum);
  const leveranser = genomfordaLeveranserForDag(s, datum);
  // Leveranser räknas inte in i dagens underlag. De upparbetas över sin period
  // och faktureras när de väljs till ett underlag i Fakturera.
  return {
    beloppOre: fakturerbartOre(s, poster),
    harFakturerbart: poster.some(p => kanIngaIFakturaunderlag(s, p)),
    poster, leveranser,
  };
}

/** Arbetad tid i sekunder, oavsett om den är fakturerbar. */
export function arbetadTidSekunder(poster) {
  return poster.reduce((s, p) => s + (p.seconds || 0), 0);
}

export function veckansDatum(offset = 0, idag = new Date()) {
  const n = new Date(idag);
  const veckodag = n.getDay();
  const tillMandag = veckodag === 0 ? -6 : 1 - veckodag;
  const mandag = new Date(n);
  mandag.setDate(n.getDate() + tillMandag + offset * 7);
  mandag.setHours(12, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mandag);
    d.setDate(mandag.getDate() + i);
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  });
}

// ── Reseförslag ─────────────────────────────────────────────────────────────

/**
 * Reseförslag för en dag, ETT per BESÖK.
 *
 * En resa är fysisk. Har man kört till en kund och gjort tre saker där, på ett
 * eller flera uppdrag, är det fortfarande en resa. Därför grupperas förslaget
 * per KUND och inte per uppdrag. Två olika kunder samma dag är däremot två
 * besök och ger två förslag.
 *
 * Finns redan en registrerad resa till kunden den dagen föreslås ingenting.
 * Förslaget tillämpas ALDRIG automatiskt — gränssnittet kräver ett tryck.
 */
export function saknadeResorForDag(s, datum) {
  const resartikel = new Set(s.articles.filter(a => a.type === 'travel').map(a => a.id));
  const dagens = s.poster.filter(p => p.date === datum);

  const kundHarResa = new Set();
  for (const p of dagens) {
    if (resartikel.has(p.articleId)) kundHarResa.add(uppdragFor(s, p.projectId)?.clientId);
  }

  const perKund = new Map();
  for (const p of dagens) {
    if (resartikel.has(p.articleId)) continue;
    const u = uppdragFor(s, p.projectId);
    if (!u?.defaultTripKm || kundHarResa.has(u.clientId)) continue;
    // Har kunden flera uppdrag med olika standardavstånd väljs det längsta.
    // Att föreslå det kortaste vore att systematiskt underskatta resan.
    const nuvarande = perKund.get(u.clientId);
    if (!nuvarande || u.defaultTripKm > nuvarande.km) {
      perKund.set(u.clientId, {
        projectId: u.id, date: datum, km: u.defaultTripKm,
        projectName: u.name, clientId: u.clientId,
        kundnamn: kundFor(s, u.clientId)?.name ?? u.name,
      });
    }
  }
  return [...perKund.values()];
}

// ── Enstaka fasta leveranser ────────────────────────────────────────────────
//
// Två slags fastpris som aldrig får blandas ihop:
//
//   Fastprisperiod        har start- och slutdatum, fördelas automatiskt över
//                         avtalsperioden och registreras aldrig från Idag.
//   Enstaka leverans      har ingen period. Den räknas som jobbat in den dag
//                         användaren markerar den genomförd.
//
// Samma ekonomiska åtagande får aldrig vara båda. Det kontrolleras i koden.

/**
 * Leveranser som går att markera genomförda.
 *
 * Alla fasta ersättningar har en upparbetningsperiod. Genomförandet handlar
 * inte om upparbetning utan om FAKTURERING: en leverans som inte är genomförd
 * kan inte tas med i ett underlag.
 */
export function enstakaLeveranser(s, { endastEjGenomforda = false } = {}) {
  return (s.deliverables || [])
    .filter(l => uppdragArFakturerbart(uppdragFor(s, l.projectId)))
    .filter(l => !endastEjGenomforda || !arGenomford(l))
    .map(l => ({ ...l, uppdragnamn: uppdragFor(s, l.projectId)?.name ?? '' }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Leveranser som markerats genomförda ett visst datum, för Idag och Vecka.
 * De visas som en händelse, inte som ett belopp: upparbetningen sker över
 * perioden, inte den dag leveransen blev klar.
 */
export function genomfordaLeveranserForDag(s, datum) {
  return (s.deliverables || [])
    .filter(l => arGenomford(l) && l.completedAt === datum)
    .map(l => ({ ...l, uppdragnamn: uppdragFor(s, l.projectId)?.name ?? '' }));
}

/** Sant när leveransen hör till ett underlag och därför är låst. */
export const leveransArLast = leverans => !!leverans?.invoiceRecordId;

/** Vad som händer när leveransen markeras genomförd. Visas INNAN bekräftelsen. */
export function genomforandebesked(leverans) {
  return `${belopp(leverans.amountOre)} tjänas in över upparbetningsperioden och påverkar inte `
    + 'veckans Jobbat in. Genomförandet gör att leveransen kan tas med i ett fakturaunderlag, '
    + 'med hela beloppet. Den läggs inte in automatiskt.';
}

/**
 * Markerar en enstaka leverans som genomförd.
 * Kräver ett uttryckligt datum. Fastprisperioder kan inte markeras genomförda.
 */
export function markeraGenomford(s, leveransId, datum) {
  const leverans = (s.deliverables || []).find(l => l.id === leveransId);
  if (!leverans) return { ok: false, besked: 'Leveransen finns inte längre.' };
  if (leveransArLast(leverans)) {
    return { ok: false, besked: 'Leveransen ligger i ett underlag som är klart i Lundify. Flytta tillbaka underlaget först.' };
  }
  if (!datum) return { ok: false, besked: 'Välj vilken dag leveransen genomfördes.' };

  return {
    ok: true,
    state: {
      ...s,
      deliverables: s.deliverables.map(l => l.id === leveransId
        ? { ...l, status: 'open', completedAt: datum } : l),
    },
  };
}

/** Ändrar genomförandedatumet. Låst så snart leveransen ligger i ett underlag. */
export function andraGenomforandedatum(s, leveransId, datum) {
  const leverans = (s.deliverables || []).find(l => l.id === leveransId);
  if (!leverans) return { ok: false, besked: 'Leveransen finns inte längre.' };
  if (leveransArLast(leverans)) {
    return { ok: false, besked: 'Leveransen ligger i ett underlag som är klart i Lundify. Flytta tillbaka underlaget först.' };
  }
  if (!datum) return { ok: false, besked: 'Välj vilken dag leveransen genomfördes.' };
  return {
    ok: true,
    state: { ...s, deliverables: s.deliverables.map(l => l.id === leveransId ? { ...l, completedAt: datum } : l) },
  };
}

/** Ångrar genomförandet. Går inte när leveransen redan ligger i ett underlag. */
export function angraGenomford(s, leveransId) {
  const leverans = (s.deliverables || []).find(l => l.id === leveransId);
  if (!leverans) return { ok: false, besked: 'Leveransen finns inte längre.' };
  if (leveransArLast(leverans)) {
    return { ok: false, besked: 'Leveransen ligger i ett underlag som är klart i Lundify. Flytta tillbaka underlaget först.' };
  }
  return {
    ok: true,
    state: {
      ...s,
      deliverables: s.deliverables.map(l => l.id === leveransId
        ? { ...l, status: 'planned', completedAt: null } : l),
    },
  };
}

// ── Fakturaunderlag ─────────────────────────────────────────────────────────
//
// Tre lägen visas för användaren, och inga tekniska statusar:
//
//   Behöver kontrolleras   något hindrar underlaget, till exempel att momsen
//                          inte är angiven
//   Redo för Lundify       det finns poster att föra över
//   Klart i Lundify        underlaget är överfört och posterna är låsta
//
// Underlagen grupperas per KUND och FAKTURERINGSMÅNAD. Flera uppdrag hos samma
// kund hamnar i samma underlag, men blir separata fakturarader.

export const LAGE_KONTROLL = 'behover-kontrolleras';
export const LAGE_REDO = 'redo';
export const LAGE_KLART = 'klart';

export const LAGEN = [
  { id: LAGE_KONTROLL, etikett: 'Behöver kontrolleras' },
  { id: LAGE_REDO, etikett: 'Redo för Lundify' },
  { id: LAGE_KLART, etikett: 'Klart i Lundify' },
];

export const lagetikett = id => LAGEN.find(l => l.id === id)?.etikett ?? id;

const ORDNING = { session: 1, piece: 2, hourly: 3, fixedDeliverable: 4, travel: 5, trackingOnly: 9 };

/**
 * Kort sammanfattning av innehållet: "3 pass behandlingstillfälle, 1 tim samtal".
 * Rader med samma artikel slås ihop — annars läser man samma namn tre gånger.
 */
export function sammanfattaRader(rader, leveranser = []) {
  const perArtikel = new Map();
  for (const r of rader) {
    const nuvarande = perArtikel.get(r.artikel.id);
    if (nuvarande) nuvarande.qtyMilli += r.post.qtyMilli;
    else perArtikel.set(r.artikel.id, { artikel: r.artikel, qtyMilli: r.post.qtyMilli });
  }
  const delar = [...perArtikel.values()]
    .map(x => `${kvantitetTillText(x.qtyMilli, x.artikel.unit)} ${x.artikel.name.toLowerCase()}`);
  for (const l of leveranser) delar.push(l.name.toLowerCase());

  if (!delar.length) return '';
  if (delar.length <= 3) return delar.join(', ');
  return `${delar.slice(0, 2).join(', ')} och ${delar.length - 2} till`;
}

/**
 * Öppna poster grupperade per kund och faktureringsmånad.
 * Poster som redan hör till ett underlag tas inte med.
 */
export function underlagsgrupper(s) {
  const grupper = new Map();

  const lagg = (clientId, period) => {
    const id = `${clientId}|${period}`;
    if (!grupper.has(id)) {
      grupper.set(id, {
        id, clientId, period,
        kundnamn: kundFor(s, clientId)?.name ?? 'Utan kund',
        rader: [], leveranser: [], loggadTidSekunder: 0,
      });
    }
    return grupper.get(id);
  };

  for (const p of s.poster) {
    if (p.status !== 'open' || p.invoiceRecordId) continue;
    const a = artikelFor(s, p.articleId);
    const u = uppdragFor(s, p.projectId);
    if (!a || !uppdragArFakturerbart(u)) continue;        // internt och ideellt aldrig här
    const grupp = lagg(u.clientId ?? '_utan', p.date.slice(0, 7));
    grupp.loggadTidSekunder += p.seconds || 0;
    if (!kanIngaIFakturaunderlag(s, p)) continue;         // trackingOnly blir ingen rad
    grupp.rader.push({ post: p, artikel: a, uppdragnamn: u.name, beloppOre: radbeloppOre(a.unitPriceOre, p.qtyMilli) });
  }

  for (const l of s.deliverables || []) {
    if (l.status !== 'open' || l.invoiceRecordId) continue;
    if (!arGenomford(l)) continue;                        // ej genomförd kan inte faktureras
    const u = uppdragFor(s, l.projectId);
    if (!uppdragArFakturerbart(u)) continue;
    lagg(u.clientId ?? '_utan', (l.completedAt ?? '').slice(0, 7) || 'utan-period').leveranser.push({ ...l, uppdragnamn: u.name });
  }

  return [...grupper.values()].map(g => {
    const rader = g.rader.sort((a, b) =>
      (ORDNING[a.artikel.type] ?? 8) - (ORDNING[b.artikel.type] ?? 8)
      || a.uppdragnamn.localeCompare(b.uppdragnamn, 'sv'));
    const summaOre = rader.reduce((sum, r) => sum + r.beloppOre, 0);

    // Vad hindrar underlaget? Momsen är det enda som blockerar idag.
    const utanMoms = [...new Set(rader.map(r => r.artikel).filter(a => !momsAnvandbar(a)))];
    const lage = utanMoms.length ? LAGE_KONTROLL
      : rader.length ? LAGE_REDO
        : LAGE_KONTROLL;

    return {
      ...g, rader, summaOre,
      antalRader: rader.length,
      valbaraLeveranser: g.leveranser.length,
      utanMoms,
      lage,
      atgard: utanMoms.length
        ? { besked: 'Momsen behöver anges', artiklar: utanMoms }
        : rader.length ? null
          : { besked: 'Ingen leverans vald', artiklar: [] },
      sammanfattning: sammanfattaRader(rader, g.leveranser),
      uppdrag: [...new Set(rader.map(r => r.uppdragnamn))],
    };
  })
    .filter(g => g.rader.length || g.leveranser.length || g.utanMoms.length)
    .sort((a, b) => a.kundnamn.localeCompare(b.kundnamn, 'sv') || a.period.localeCompare(b.period));
}

/**
 * EN sanningskälla för om ett underlag är klart i Lundify: klarmarkeradAt.
 *
 * Domänens gamla femstegsstatus läses bara som legacydata. Den får aldrig
 * parallellt styra vyn, för då kan användarläget få två olika svar.
 */
export const arKlartILundify = referens => !!referens?.klarmarkeradAt;

/** Legacystatusar som i gammal data betydde "överfört till Lundify". */
const LEGACY_KLART = ['lundifyDraft', 'lundifySent', 'lundifyPaid'];

/**
 * Minsta möjliga kompatibilitet vid inläsning av gammal data.
 *
 * Saknas klarmarkeradAt men en gammal status säger att underlaget var överfört
 * härleds ett datum EN gång, och statusfältet läggs undan som legacy. Efter
 * det finns bara ett fält som styr.
 */
export function normaliseraReferens(referens) {
  if (!referens) return referens;
  const { status, ...rest } = referens;
  if (referens.klarmarkeradAt) return { ...rest, legacyStatus: status ?? null };
  if (status && LEGACY_KLART.includes(status)) {
    return {
      ...rest,
      klarmarkeradAt: referens.invoiceDate ?? referens.paidDate ?? referens.createdAt ?? 'okänt datum',
      legacyStatus: status,
      harledd: true,
    };
  }
  return { ...rest, legacyStatus: status ?? null };
}

/** Normaliserar alla fakturareferenser i ett inläst tillstånd. */
export function normaliseraTillstand(s) {
  if (!s?.invoiceRecords?.length) return s;
  return { ...s, invoiceRecords: s.invoiceRecords.map(normaliseraReferens) };
}

/** Underlag som är klara i Lundify, nyast först. */
export function klaraUnderlag(s) {
  return (s.invoiceRecords || [])
    .filter(arKlartILundify)
    .map(r => ({ ...r, kundnamn: kundFor(s, r.clientId)?.name ?? '' }))
    .sort((a, b) => String(b.klarmarkeradAt).localeCompare(String(a.klarmarkeradAt)));
}

/**
 * Försöker färdigställa ett underlag.
 * @returns {{ok:true, underlag, poster}|{ok:false, besked:string, artiklar:string[]}}
 */
export function forberedUnderlag(s, gruppId, { valdaLeveranser = [] } = {}) {
  const grupp = underlagsgrupper(s).find(g => g.id === gruppId || g.clientId === gruppId);
  if (!grupp) return { ok: false, besked: 'Det finns inget att fakturera för den här kunden just nu.', artiklar: [] };

  const valdaPoster = grupp.rader.map(r => r.post.id);
  if (!valdaPoster.length && !valdaLeveranser.length) {
    return { ok: false, besked: 'Ingen leverans vald', artiklar: [] };
  }

  try {
    const { underlag, poster, leveranser } = lasUnderlag({
      artiklar: s.articles,
      poster: s.poster,
      valda: valdaPoster,
      leveranser: s.deliverables || [],
      valdaLeveranser,
      clientId: grupp.clientId,
      period: grupp.period,
    });
    return { ok: true, underlag, poster, leveranser, grupp };
  } catch (e) {
    if (e instanceof OgranskadMoms || e.name === 'OgranskadMoms') {
      return { ok: false, besked: 'Momsen behöver anges', artiklar: (e.artiklar || []).map(a => a.name) };
    }
    return { ok: false, besked: e.message, artiklar: [] };
  }
}

/** Förhandsvisning utan att låsa något, för att kunna visa summan i listan. */
export function forhandsvisa(s, gruppId, { valdaLeveranser = [] } = {}) {
  const grupp = underlagsgrupper(s).find(g => g.id === gruppId || g.clientId === gruppId);
  if (!grupp) return null;
  try {
    return byggUnderlag({
      artiklar: s.articles,
      poster: grupp.rader.map(r => r.post),
      leveranser: s.deliverables || [],
      valdaLeveranser,
      clientId: grupp.clientId,
      period: grupp.period,
    });
  } catch {
    return null;                 // t.ex. ogranskad moms, hanteras av forberedUnderlag
  }
}


/** Datumen underlaget spänner över, för fakturatexten. */
export function underlagsPeriod(underlag) {
  const datum = underlag.rader.map(r => r.datum).filter(Boolean).sort();
  if (!datum.length) return underlag.period ?? null;
  return datum[0] === datum.at(-1) ? datum[0] : `${datum[0]} – ${datum.at(-1)}`;
}

/** Momssatsen som text. 0 är ett granskat värde och skrivs ut som 0 %. */
export const momsText = sats => (sats === null || sats === undefined) ? 'ej fastställd' : (sats / 100) + ' %';

/** Fakturaunderlaget som ren text att klistra in i Lundify. */
export function lundifyText(s, underlag) {
  const rader = underlag.rader.map(r => {
    const antal = kvantitetTillText(r.qtyMilli, r.unit);
    return `${r.beskrivning}\t${antal}\t${belopp(r.unitPriceOre)}\t${momsText(r.vatRate)}\t${belopp(r.nettoOre)}`;
  });
  const kund = kundFor(s, underlag.clientId)?.name ?? '';
  const period = underlagsPeriod(underlag);
  return [
    `Underlag till Lundify – ${kund}`,
    period ? `Avser: ${period}` : null,
    '',
    'Beskrivning\tAntal\tÁ-pris\tMoms\tBelopp',
    ...rader,
    '',
    `Summa exklusive moms: ${belopp(underlag.nettoOre)}`,
    ...Object.entries(underlag.momsUnderlag).map(([sats, underlagOre]) =>
      `Moms ${momsText(Number(sats))} på ${belopp(underlagOre)}`),
    `Moms totalt: ${belopp(underlag.momsOre)}`,
    underlag.avrundningOre ? `Öresavrundning: ${belopp(underlag.avrundningOre)}` : null,
    `Summa inklusive moms: ${belopp(underlag.attBetalaOre)}`,
  ].filter(r => r !== null).join('\n');
}

// ── Moms ────────────────────────────────────────────────────────────────────

/** De momssatser användaren kan välja mellan. Ingen är förvald. */
export const MOMSSATSER = [
  { sats: 2500, etikett: '25 %' },
  { sats: 1200, etikett: '12 %' },
  { sats: 600, etikett: '6 %' },
  { sats: 0, etikett: '0 %, momsfritt' },
];

/**
 * Sätter momssatsen på en artikel. Kräver ett uttryckligt val — inget värde
 * föreslås och inget sparas av sig självt.
 */
export function sattMoms(s, articleId, vatRate) {
  if (vatRate === null || vatRate === undefined) {
    throw new Error('Välj en momssats innan du sparar.');
  }
  if (!MOMSSATSER.some(m => m.sats === vatRate)) {
    throw new Error('Den momssatsen finns inte att välja.');
  }
  return {
    ...s,
    articles: s.articles.map(a => a.id === articleId
      ? { ...a, vatRate, vatStatus: 'reviewed', needsReview: false, reviewNote: null }
      : a),
  };
}

/** Artiklar hos en kund vars moms ännu inte är fastställd. */
export function artiklarUtanMoms(s, clientId) {
  const uppdrag = s.projects.filter(p => p.clientId === clientId).map(p => p.id);
  return s.articles.filter(a => uppdrag.includes(a.projectId) && a.vatStatus !== 'reviewed');
}

// ── Klart i Lundify ─────────────────────────────────────────────────────────
//
// Ett enda steg för användaren: underlaget är klart i Lundify eller inte.
//
// Fakturanummer är Lundifys sak och krävs aldrig här. Det går att anteckna
// frivilligt, men det ändrar ingenting och visas bara om det är ifyllt.
// Betalningsstatus finns inte alls: utan koppling till Lundify vet appen inte
// om något är betalt, och då ska den inte påstå det.

/** Vad som händer när användaren markerar klart. Visas INNAN bekräftelsen. */
export const OVERFORINGSBESKED =
  'Posterna flyttas från Redo för Lundify till Klart i Lundify.';

/**
 * Markerar ett underlag som klart i Lundify.
 * Kräver inget fakturanummer. Posterna är redan låsta av lasUnderlag.
 */
export function markeraKlart(s, referensId, { datum }) {
  const referens = (s.invoiceRecords || []).find(r => r.id === referensId);
  if (!referens) return { ok: false, besked: 'Underlaget finns inte längre.' };
  if (!datum) return { ok: false, besked: 'Ett datum krävs för att markera klart.' };
  return {
    ok: true,
    state: {
      ...s,
      // Bara klarmarkeradAt sätts. Ingen parallell status som kan säga emot.
      invoiceRecords: s.invoiceRecords.map(r => r.id === referensId
        ? { ...r, klarmarkeradAt: datum } : r),
    },
  };
}

/**
 * Frivillig anteckning av fakturanumret. Ändrar inget läge och krävs aldrig.
 * Ett tomt värde tar bort anteckningen.
 */
export function antecknaFakturanummer(s, referensId, nummer) {
  const rensat = String(nummer ?? '').trim();
  return {
    ok: true,
    state: {
      ...s,
      invoiceRecords: s.invoiceRecords.map(r => r.id === referensId
        ? { ...r, invoiceNumber: rensat || null } : r),
    },
  };
}

/**
 * Flyttar tillbaka ett underlag till Redo för Lundify.
 * Poster och leveranser frigörs, prissnapshotet tas bort och referensen
 * försvinner tillsammans med en eventuell fakturamarkering. Ett misstag ska gå
 * att ångra utan att data går förlorad.
 */
export function angraOverforing(s, referensId) {
  const referens = (s.invoiceRecords || []).find(r => r.id === referensId);
  if (!referens) return { ok: false, besked: 'Underlaget finns inte längre.' };
  return {
    ok: true,
    state: {
      ...s,
      poster: s.poster.map(p => p.invoiceRecordId === referensId
        ? { ...p, status: 'open', invoiceRecordId: null, priceSnapshot: null } : p),
      deliverables: (s.deliverables || []).map(l => l.invoiceRecordId === referensId
        ? { ...l, status: 'open', invoiceRecordId: null, priceSnapshot: null } : l),
      invoiceRecords: (s.invoiceRecords || []).filter(r => r.id !== referensId),
    },
  };
}

// ── Jobbat in ───────────────────────────────────────────────────────────────
//
// En enda fråga: hur mycket pengar har jag jobbat in?
//
// Med i "jobbat in": genomförda behandlingstillfällen, utfört timdebiterat
// arbete och genomförda fakturerbara fasta leveranser.
//
// Inte med: trackingOnly-tid, internt arbete, ideellt arbete, moms och rena
// utlägg. Resor och utlägg visas separat — de är kostnadsersättning, och hur
// stor del som är verklig intäkt går inte att avgöra här.
//
// Ingen lönekalkyl, ingen skatteberäkning, ingen budget och ingen prognos.

export const ARBETSTYPER = ['hourly', 'session', 'piece'];

/** Sant för en artikel som är ren kostnadsersättning, inte arbete. */
export const arKostnadsersattning = artikel =>
  artikel?.type === 'travel' || artikel?.unit === 'kr';

/** Sant för en post som räknas som inarbetade pengar. */
export function raknasSomJobbatIn(s, post) {
  const artikel = artikelFor(s, post.articleId);
  const uppdrag = uppdragFor(s, post.projectId);
  if (!artikel || !uppdrag) return false;
  if (!kanIngaIFakturaunderlag(s, post)) return false;   // internt, ideellt, trackingOnly
  if (arKostnadsersattning(artikel)) return false;       // resor och utlägg
  return ARBETSTYPER.includes(artikel.type);
}

/**
 * Summerar en period i tre delar som aldrig blandas ihop.
 * @returns {{jobbatInOre, resorOre, utlaggOre, totaltUnderlagOre, arbetadTidSekunder}}
 */
export function jobbatIn(s, datumLista) {
  const ingar = d => datumLista.includes(d);
  const poster = s.poster.filter(p => ingar(p.date));

  let timarbeteOre = 0, tillfallenOre = 0, styckOre = 0, resorOre = 0, utlaggOre = 0;
  for (const p of poster) {
    if (!kanIngaIFakturaunderlag(s, p)) continue;
    const a = artikelFor(s, p.articleId);
    const belopp = radbeloppOre(a.unitPriceOre, p.qtyMilli);

    // Samma regel som raknasSomJobbatIn, och bara på ett ställe. Fanns den på
    // två kunde de glida isär, och då hade summan blivit fel medan
    // kontrollfunktionen fortsatte svara rätt.
    if (raknasSomJobbatIn(s, p)) {
      if (a.type === 'hourly') timarbeteOre += belopp;
      else if (a.type === 'session') tillfallenOre += belopp;
      else styckOre += belopp;
    } else if (a.type === 'travel') resorOre += belopp;
    else if (a.unit === 'kr') utlaggOre += belopp;
  }

  // Fasta ersättningar upparbetas ALLTID över sin period.
  //
  // Det finns ingen klumpsumma. En genomförandemarkering lägger aldrig hela
  // beloppet ovanpå en vecka — den styr bara om leveransen får faktureras.
  // Därför kan samma belopp inte räknas både som periodandel och som leverans.
  let fastPrisAndelOre = 0;
  const ofullstandigaPerioder = [];

  for (const l of s.deliverables || []) {
    if (!uppdragArFakturerbart(uppdragFor(s, l.projectId))) continue;
    const kontroll = periodKontroll(l);
    if (!kontroll.giltig) {
      ofullstandigaPerioder.push({ id: l.id, namn: l.name, orsak: kontroll.orsak });
      continue;                                      // gissa inte, räkna inte med
    }
    fastPrisAndelOre += periodandelOre(l, datumLista);
  }

  const jobbatInOre = timarbeteOre + tillfallenOre + styckOre + fastPrisAndelOre;

  return {
    jobbatInOre,
    delar: { timarbeteOre, tillfallenOre, styckOre, fastPrisAndelOre },
    resorOre,
    utlaggOre,
    // Fakturaunderlaget innehåller det som faktiskt blir fakturarader.
    // Den veckofördelade fastprisandelen ingår ALDRIG — den faktureras enligt
    // avtalet, inte per vecka.
    totaltUnderlagOre: timarbeteOre + tillfallenOre + styckOre + resorOre + utlaggOre,
    ofullstandigaPerioder,
    arbetadTidSekunder: arbetadTidSekunder(poster),
  };
}

/**
 * DEN KANONISKA SAMMANSTÄLLNINGEN för en period.
 *
 * Tre ekonomiska begrepp som aldrig får blandas ihop:
 *
 *   jobbatInOre          Vad arbetet är värt. Timarbete, tillfällen,
 *                        styckprisat, upparbetad fastprisandel och genomförda
 *                        fristående leveranser. INTE resor, utlägg eller moms.
 *
 *   fakturaunderlagOre   Vad som är redo att föras över till Lundify. Poster
 *                        som ännu inte hör till ett underlag, inklusive resor
 *                        och utlägg. INTE den upparbetade fastprisandelen —
 *                        den faktureras enligt avtalet, inte per vecka.
 *
 *   klartILundifyOre     Vad som redan är överfört och markerat klart.
 *
 * Resor och utlägg särredovisas. Både Vecka och Uppföljning använder den här
 * funktionen, så vyerna kan inte visa siffror från två olika beräkningar.
 */
export function sammanstallning(s, datumLista, { malOre = null } = {}) {
  const ingar = d => datumLista.includes(d);
  const summa = jobbatIn(s, datumLista);

  // Redo för Lundify: öppna, olåsta poster i perioden.
  const redoPoster = s.poster.filter(p =>
    ingar(p.date) && p.status === 'open' && !p.invoiceRecordId && kanIngaIFakturaunderlag(s, p));
  const fakturaunderlagOre = fakturerbartOre(s, redoPoster);

  // Klart i Lundify: underlag som markerats klara under perioden.
  const klartILundifyOre = (s.invoiceRecords || [])
    .filter(r => r.klarmarkeradAt && ingar(r.klarmarkeradAt))
    .reduce((sum, r) => sum + (r.nettoOre || 0), 0);

  const mal = typeof malOre === 'number' && malOre > 0 ? malOre : null;

  return {
    // Jobbat in
    jobbatInOre: summa.jobbatInOre,
    delar: summa.delar,

    // Fakturaunderlag och Lundify — skilda begrepp, skilda tal
    fakturaunderlagOre,
    redoForLundifyOre: fakturaunderlagOre,     // samma sak, tydligare namn i vyn
    klartILundifyOre,

    // Särredovisat
    resorOre: summa.resorOre,
    utlaggOre: summa.utlaggOre,
    arbetadTidSekunder: summa.arbetadTidSekunder,

    // Totalt underlag inklusive resor och utlägg, exklusive fastprisandelen
    totaltUnderlagOre: summa.totaltUnderlagOre,
    ofullstandigaPerioder: summa.ofullstandigaPerioder,

    // Frivilligt mål, jämförs ALLTID med jobbat in
    malOre: mal,
    harMal: mal !== null,
    kvarOre: mal ? Math.max(mal - summa.jobbatInOre, 0) : 0,
    overskjutandeOre: mal ? Math.max(summa.jobbatInOre - mal, 0) : 0,
    procent: mal ? Math.round(summa.jobbatInOre / mal * 100) : null,
    naddMal: !!mal && summa.jobbatInOre >= mal,
  };
}

export function veckoSammanstallning(s, offset = 0, idagDatum = new Date()) {
  return sammanstallning(s, veckansDatum(offset, idagDatum), { malOre: s.installningar?.veckomalOre });
}

/**
 * Alla datum i en månad som har något registrerat. Används både av
 * sammanställningen och av fördelningen per kund, så de aldrig kan titta på
 * olika perioder.
 */
export function manadensDatum(s, manad) {
  const iManad = d => typeof d === 'string' && d.slice(0, 7) === manad;
  return [...new Set([
    ...s.poster.map(p => p.date).filter(iManad),
    ...(s.deliverables || []).map(l => l.completedAt).filter(iManad),
    ...(s.invoiceRecords || []).map(r => r.klarmarkeradAt).filter(iManad),
  ])];
}

/** Månadens sammanställning. Samma regler, inget mål och ingen budget. */
export function manadsSammanstallning(s, manad) {
  return sammanstallning(s, manadensDatum(s, manad));
}

/** Måltexten på vanlig svenska. Kort, utan prestationstryck. */
export function maltext(v) {
  if (!v.harMal) return null;
  const inledning = `${belopp(v.jobbatInOre)} av veckans mål ${belopp(v.malOre)}`;
  if (v.naddMal) return `${inledning}. Målet är nått, ${belopp(v.overskjutandeOre)} över.`;
  return `${inledning}. ${belopp(v.kvarOre)} kvar.`;
}

/** Intäkt per kund för en period. Använder samma urvalsregler som ovan. */
export function perKund(s, datumLista) {
  const ingar = d => datumLista.includes(d);
  const rader = new Map();
  const lagg = (namn, sort) => {
    if (!rader.has(namn)) rader.set(namn, { namn, sekunder: 0, beloppOre: 0, sort });
    return rader.get(namn);
  };

  for (const p of s.poster.filter(x => ingar(x.date))) {
    const u = uppdragFor(s, p.projectId);
    const rad = lagg(kundNamnForUppdrag(s, p.projectId), u?.kind ?? 'billable');
    rad.sekunder += p.seconds || 0;
    if (raknasSomJobbatIn(s, p)) rad.beloppOre += fakturerbartOre(s, [p]);
  }

  for (const l of s.deliverables || []) {
    if (!uppdragArFakturerbart(uppdragFor(s, l.projectId))) continue;
    if (!periodKontroll(l).giltig) continue;
    const andel = periodandelOre(l, datumLista);
    if (andel) lagg(kundNamnForUppdrag(s, l.projectId), 'billable').beloppOre += andel;
  }

  return [...rader.values()].sort((a, b) => b.beloppOre - a.beloppOre || b.sekunder - a.sekunder);
}

// ── Ändra och ta bort ───────────────────────────────────────────────────────

export function laggTillPost(s, post) {
  return { ...s, poster: [...s.poster, post] };
}

export function andraPost(s, id, andringar) {
  return {
    ...s,
    poster: s.poster.map(p => {
      if (p.id !== id) return p;
      if (p.invoiceRecordId) throw new Error('Posten hör till ett underlag som redan är överfört och kan inte ändras.');
      return { ...p, ...andringar };
    }),
  };
}

export function taBortPost(s, id) {
  const post = s.poster.find(p => p.id === id);
  if (post?.invoiceRecordId) {
    throw new Error('Posten hör till ett underlag som redan är överfört och kan inte tas bort.');
  }
  return { ...s, poster: s.poster.filter(p => p.id !== id) };
}

export function nyttId(prefix = 'p') {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

export { arFakturerbar, hittaArtikel };
