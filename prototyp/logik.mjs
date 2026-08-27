// Ren logik för användartestversionen.
//
// All prissättning, moms och avrundning kommer från src/domain. Ingen beräkning
// görs om här — det som finns här är gruppering, sortering och de besked
// gränssnittet ska visa på svenska.

import {
  byggUnderlag, lasUnderlag, OgranskadMoms,
  radbeloppOre, oreTillText, kvantitetTillText,
  foreslaResor, hittaArtikel, arFakturerbar,
  kontrolleraTillstand, MILLI,
} from '../src/domain/index.mjs';

export { oreTillText, kvantitetTillText, MILLI };

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

/** Sant när posten hör till arbete som aldrig ska faktureras. */
export function arEjFakturerbar(s, post) {
  const artikel = artikelFor(s, post.articleId);
  const uppdrag = uppdragFor(s, post.projectId);
  return !artikel || !arFakturerbar(artikel) || uppdrag?.kind !== 'billable';
}

/** Varför posten inte är fakturerbar, på vanlig svenska. */
export function ejFakturerbarText(s, post) {
  const uppdrag = uppdragFor(s, post.projectId);
  if (uppdrag?.kind === 'internal') return 'Inte fakturerbart';
  if (uppdrag?.kind === 'voluntary') return 'Inte fakturerbart';
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
    const a = artikelFor(s, p.articleId);
    if (!a || !arFakturerbar(a)) return summa;
    return summa + radbeloppOre(a.unitPriceOre, p.qtyMilli);
  }, 0);
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

// ── Fakturaunderlag ─────────────────────────────────────────────────────────

const ORDNING = { session: 1, piece: 2, hourly: 3, fixedDeliverable: 4, travel: 5, trackingOnly: 9 };

/**
 * Öppna poster grupperade per kund och därunder per uppdrag.
 * Poster som redan hör till ett underlag tas inte med.
 */
export function underlagPerKund(s) {
  const oppna = s.poster.filter(p => p.status === 'open' && !p.invoiceRecordId);
  const oppnaLev = (s.deliverables || []).filter(l => l.status === 'open' && !l.invoiceRecordId);

  const perKund = new Map();
  const kundFor_ = pid => uppdragFor(s, pid)?.clientId ?? '_utan';

  const lagg = (clientId, projectId) => {
    if (!perKund.has(clientId)) {
      perKund.set(clientId, { clientId, kundnamn: kundFor(s, clientId)?.name ?? 'Utan kund', uppdrag: new Map() });
    }
    const kund = perKund.get(clientId);
    if (!kund.uppdrag.has(projectId)) {
      kund.uppdrag.set(projectId, {
        projectId, namn: uppdragFor(s, projectId)?.namn ?? uppdragFor(s, projectId)?.name,
        rader: [], leveranser: [], loggadTidSekunder: 0,
      });
    }
    return kund.uppdrag.get(projectId);
  };

  for (const p of oppna) {
    const a = artikelFor(s, p.articleId);
    const u = uppdragFor(s, p.projectId);
    if (!a || !u || u.kind !== 'billable') continue;      // internt och ideellt hamnar aldrig här
    const grupp = lagg(kundFor_(p.projectId), p.projectId);
    if (!arFakturerbar(a)) { grupp.loggadTidSekunder += p.seconds || 0; continue; }
    grupp.rader.push({
      post: p, artikel: a,
      beloppOre: radbeloppOre(a.unitPriceOre, p.qtyMilli),
    });
    grupp.loggadTidSekunder += p.seconds || 0;
  }

  for (const l of oppnaLev) {
    const u = uppdragFor(s, l.projectId);
    if (!u || u.kind !== 'billable') continue;
    lagg(kundFor_(l.projectId), l.projectId).leveranser.push(l);
  }

  return [...perKund.values()].map(kund => {
    const uppdrag = [...kund.uppdrag.values()]
      .map(g => ({
        ...g,
        namn: uppdragFor(s, g.projectId)?.name,
        rader: g.rader.sort((a, b) => (ORDNING[a.artikel.type] ?? 8) - (ORDNING[b.artikel.type] ?? 8)),
        summaOre: g.rader.reduce((sum, r) => sum + r.beloppOre, 0),
      }))
      .filter(g => g.rader.length || g.leveranser.length || g.loggadTidSekunder);

    const antalRader = uppdrag.reduce((sum, g) => sum + g.rader.length, 0);
    const valbaraLeveranser = uppdrag.reduce((sum, g) => sum + g.leveranser.length, 0);
    const harOverfort = (s.invoiceRecords || []).some(r => r.clientId === kund.clientId && r.status !== 'prepared');

    return {
      ...kund,
      uppdrag,
      summaOre: uppdrag.reduce((sum, g) => sum + g.summaOre, 0),
      antalRader,
      valbaraLeveranser,
      // Tre skilda lägen, så gränssnittet slipper gissa vad tomheten betyder.
      lage: antalRader > 0 ? 'att-fakturera'
        : valbaraLeveranser > 0 ? 'ingen-leverans-vald'
          : harOverfort ? 'allt-overfort' : 'inget-att-fakturera',
    };
  }).filter(k => k.uppdrag.length)
    .sort((a, b) => b.summaOre - a.summaOre);
}

/** Kunder som har något överfört men inget kvar att fakturera. */
export function allaOverfordaKunder(s) {
  const medOppet = new Set(underlagPerKund(s).filter(k => k.lage === 'att-fakturera').map(k => k.clientId));
  const kunder = new Set((s.invoiceRecords || []).filter(r => r.status !== 'prepared').map(r => r.clientId));
  return [...kunder].filter(id => !medOppet.has(id))
    .map(id => ({ clientId: id, kundnamn: kundFor(s, id)?.name ?? '' }));
}

/**
 * Försöker färdigställa ett underlag för en kund.
 * @returns {{ok:true, underlag, poster}|{ok:false, besked:string, artiklar:string[]}}
 */
export function forberedUnderlag(s, clientId, { valdaLeveranser = [] } = {}) {
  const kund = underlagPerKund(s).find(k => k.clientId === clientId);
  if (!kund) return { ok: false, besked: 'Det finns inget att fakturera för den här kunden just nu.', artiklar: [] };

  const valdaPoster = kund.uppdrag.flatMap(g => g.rader.map(r => r.post.id));
  if (!valdaPoster.length && !valdaLeveranser.length) {
    return { ok: false, besked: 'Underlaget skulle bli tomt. Välj minst en leverans eller registrera något att fakturera.', artiklar: [] };
  }

  try {
    const { underlag, poster } = lasUnderlag({
      artiklar: s.articles,
      poster: s.poster,
      valda: valdaPoster,
      leveranser: s.deliverables || [],
      valdaLeveranser,
      clientId,
      period: (kund.uppdrag[0]?.rader[0]?.post.date || '').slice(0, 7) || null,
    });
    return { ok: true, underlag, poster };
  } catch (e) {
    if (e instanceof OgranskadMoms || e.name === 'OgranskadMoms') {
      const namn = (e.artiklar || []).map(a => a.name);
      return {
        ok: false,
        besked: 'Momsen behöver kontrolleras innan underlaget kan föras över till Lundify.',
        artiklar: namn,
      };
    }
    return { ok: false, besked: e.message, artiklar: [] };
  }
}

/** Förhandsvisning utan att låsa något, för att kunna visa summan i listan. */
export function forhandsvisa(s, clientId, { valdaLeveranser = [] } = {}) {
  const kund = underlagPerKund(s).find(k => k.clientId === clientId);
  if (!kund) return null;
  const valdaPoster = kund.uppdrag.flatMap(g => g.rader.map(r => r.post));
  try {
    return byggUnderlag({
      artiklar: s.articles,
      poster: valdaPoster,
      leveranser: s.deliverables || [],
      valdaLeveranser,
      clientId,
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
    return `${r.beskrivning}\t${antal}\t${oreTillText(r.unitPriceOre)}\t${momsText(r.vatRate)}\t${oreTillText(r.nettoOre)}`;
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
    `Summa exklusive moms: ${oreTillText(underlag.nettoOre)}`,
    ...Object.entries(underlag.momsUnderlag).map(([sats, belopp]) =>
      `Moms ${momsText(Number(sats))} på ${oreTillText(belopp)}`),
    `Moms totalt: ${oreTillText(underlag.momsOre)}`,
    underlag.avrundningOre ? `Öresavrundning: ${oreTillText(underlag.avrundningOre)}` : null,
    `Summa inklusive moms: ${oreTillText(underlag.attBetalaOre)}`,
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

// ── Status mot Lundify ──────────────────────────────────────────────────────
// Prototypen visar tre lägen. "Betald" finns inte: utan koppling till Lundify
// vet appen inte om en faktura är betald, och då ska den inte påstå det.

export const LUNDIFY_LAGEN = [
  { status: 'prepared', etikett: 'Underlag klart' },
  { status: 'lundifyDraft', etikett: 'Överfört till Lundify' },
  { status: 'lundifySent', etikett: 'Skickad' },
];

export function etikettFor(status) {
  return LUNDIFY_LAGEN.find(l => l.status === status)?.etikett ?? status;
}

/**
 * Ändrar status på ett underlag och returnerar ett begripligt fel om något
 * saknas. Fakturanumret kan läggas in senare.
 */
export function satStatus(referens, status, { invoiceNumber = null, invoiceDate = null } = {}) {
  if (status === 'lundifySent' && !invoiceNumber) {
    return { ok: false, besked: 'Skriv in fakturanumret från Lundify innan du markerar fakturan som skickad.' };
  }
  try {
    kontrolleraTillstand({ status, invoiceNumber, invoiceDate });
    return { ok: true, referens: { ...referens, status, invoiceNumber, invoiceDate } };
  } catch (e) {
    return { ok: false, besked: e.message };
  }
}

/** Vad som händer när ett underlag skapas. Visas INNAN användaren bekräftar. */
export const OVERFORINGSBESKED =
  'Posterna flyttas från Att fakturera till Överfört till Lundify.';

/**
 * Flyttar tillbaka ett underlag till Att fakturera.
 * Poster och leveranser frigörs, prissnapshotet tas bort och referensen
 * försvinner. Ett misstag ska gå att ångra utan att data går förlorad.
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

/** Rättar ett felaktigt fakturanummer på en redan skickad faktura. */
export function andraFakturanummer(s, referensId, nyttNummer) {
  const nummer = String(nyttNummer ?? '').trim();
  if (!nummer) {
    return { ok: false, besked: 'Skriv in fakturanumret, eller ta bort det om fakturan inte är skickad än.' };
  }
  return {
    ok: true,
    state: {
      ...s,
      invoiceRecords: s.invoiceRecords.map(r => r.id === referensId ? { ...r, invoiceNumber: nummer } : r),
    },
  };
}

/**
 * Tar bort fakturanumret. Underlaget går tillbaka till att vara ett utkast,
 * eftersom en faktura utan nummer inte är skickad.
 */
export function taBortFakturanummer(s, referensId) {
  return {
    ok: true,
    state: {
      ...s,
      invoiceRecords: s.invoiceRecords.map(r => r.id === referensId
        ? { ...r, invoiceNumber: null, invoiceDate: null, status: 'lundifyDraft' } : r),
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
  if (uppdrag.kind !== 'billable') return false;         // internt och ideellt
  if (!arFakturerbar(artikel)) return false;             // trackingOnly
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

  let jobbatInOre = 0, resorOre = 0, utlaggOre = 0;
  for (const p of poster) {
    const a = artikelFor(s, p.articleId);
    const u = uppdragFor(s, p.projectId);
    if (!a || !u || u.kind !== 'billable' || !arFakturerbar(a)) continue;
    const belopp = radbeloppOre(a.unitPriceOre, p.qtyMilli);

    // Samma regel som raknasSomJobbatIn, och bara på ett ställe. Fanns den på
    // två kunde de glida isär, och då hade summan blivit fel medan
    // kontrollfunktionen fortsatte svara rätt.
    if (raknasSomJobbatIn(s, p)) jobbatInOre += belopp;
    else if (a.type === 'travel') resorOre += belopp;
    else if (a.unit === 'kr') utlaggOre += belopp;
  }

  // Fasta leveranser räknas när de är genomförda och valda som fakturerbara.
  jobbatInOre += (s.deliverables || [])
    .filter(l => (l.status === 'included' || l.status === 'invoiced')
      && l.completedAt && ingar(l.completedAt)
      && uppdragFor(s, l.projectId)?.kind === 'billable')
    .reduce((sum, l) => sum + l.amountOre, 0);

  return {
    jobbatInOre, resorOre, utlaggOre,
    totaltUnderlagOre: jobbatInOre + resorOre + utlaggOre,
    arbetadTidSekunder: arbetadTidSekunder(poster),
  };
}

/**
 * Veckans sammanställning, med ett frivilligt mål.
 * Målet jämförs med "jobbat in" — aldrig med moms, resor eller utlägg.
 */
export function veckoSammanstallning(s, offset = 0, idagDatum = new Date()) {
  const datum = veckansDatum(offset, idagDatum);
  const summa = jobbatIn(s, datum);
  const malOre = s.installningar?.veckomalOre ?? null;

  const overfortOre = (s.invoiceRecords || [])
    .filter(r => r.status !== 'prepared')
    .reduce((sum, r) => sum + r.nettoOre, 0);

  return {
    ...summa,
    overfortOre,
    malOre,
    harMal: typeof malOre === 'number' && malOre > 0,
    kvarOre: malOre ? Math.max(malOre - summa.jobbatInOre, 0) : 0,
    overskjutandeOre: malOre ? Math.max(summa.jobbatInOre - malOre, 0) : 0,
    procent: malOre ? Math.round(summa.jobbatInOre / malOre * 100) : null,
    naddMal: !!malOre && summa.jobbatInOre >= malOre,
  };
}

/** Månadens sammanställning. Samma regler, ingen budget och ingen prognos. */
export function manadsSammanstallning(s, manad) {
  const datum = s.poster.map(p => p.date).filter(d => d.slice(0, 7) === manad);
  const levDatum = (s.deliverables || []).map(l => l.completedAt)
    .filter(d => d && d.slice(0, 7) === manad);
  const summa = jobbatIn(s, [...new Set([...datum, ...levDatum])]);
  const overfortOre = (s.invoiceRecords || [])
    .filter(r => r.status !== 'prepared')
    .reduce((sum, r) => sum + r.nettoOre, 0);
  return { ...summa, overfortOre };
}

/** Måltexten på vanlig svenska. Kort, utan prestationstryck. */
export function maltext(v) {
  if (!v.harMal) return null;
  const inledning = `${oreTillText(v.jobbatInOre)} av veckans mål ${oreTillText(v.malOre)}`;
  if (v.naddMal) return `${inledning}. Målet är nått.`;
  return `${inledning}. ${oreTillText(v.kvarOre)} kvar.`;
}

// ── Uppföljning ─────────────────────────────────────────────────────────────

export function uppfoljning(s, manad) {
  const iManad = p => p.date.slice(0, 7) === manad;
  const poster = s.poster.filter(iManad);

  const fakturerbartNu = fakturerbartOre(s, poster.filter(p => {
    const u = uppdragFor(s, p.projectId);
    return u?.kind === 'billable' && p.status === 'open' && !p.invoiceRecordId;
  }));

  const overfort = (s.invoiceRecords || [])
    .filter(r => r.status === 'lundifyDraft' || r.status === 'lundifySent')
    .reduce((sum, r) => sum + r.nettoOre, 0);

  const perKund = new Map();
  for (const p of poster) {
    const u = uppdragFor(s, p.projectId);
    const namn = kundNamnForUppdrag(s, p.projectId);
    if (!perKund.has(namn)) perKund.set(namn, { namn, sekunder: 0, beloppOre: 0, sort: u?.kind ?? 'billable' });
    const rad = perKund.get(namn);
    rad.sekunder += p.seconds || 0;
    if (u?.kind === 'billable' && p.status === 'open' && !p.invoiceRecordId) {
      rad.beloppOre += fakturerbartOre(s, [p]);
    }
  }

  return {
    arbetadTidSekunder: arbetadTidSekunder(poster),
    fakturerbartNuOre: fakturerbartNu,
    overfortOre: overfort,
    perKund: [...perKund.values()].sort((a, b) => b.beloppOre - a.beloppOre || b.sekunder - a.sekunder),
  };
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
