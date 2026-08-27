// Acceptanskontroller T1–T13.
//
// Kontrollerna är skrivna mot v2-kontraktet, inte mot en implementation. Samma
// fil körs mot vilken adapter som helst: test/adapters/v1.mjs idag, och
// test/adapters/v2.mjs när etapp 3 är klar. Det är så baslinjen blir ärlig —
// varje fall som faller gör det med en konkret orsak.
//
// Facit kommer uteslutande från test-fixtures/scenarier.mjs. Kontrollerna
// räknar aldrig fram förväntade belopp själva.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname, basename } from 'node:path';
import * as F from '../test-fixtures/scenarier.mjs';

const repoRot = fileURLToPath(new URL('../', import.meta.url));

// ── Hjälpare ────────────────────────────────────────────────────────────────

class Avvikelse extends Error {
  constructor(falt, fick, vantade) {
    super(`${falt}: fick ${JSON.stringify(fick)}, väntade ${JSON.stringify(vantade)}`);
    this.name = 'Avvikelse';
  }
}

const lika = (falt, fick, vantade) => {
  if (JSON.stringify(fick) !== JSON.stringify(vantade)) throw new Avvikelse(falt, fick, vantade);
};

const kr = ore => (ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';

/** Jämför hela summeringen mot fixturens facit. */
function kontrolleraSummering(res, f) {
  lika('nettoOre', res.nettoOre, f.nettoOre);
  if (f.momsUnderlag) {
    const fick = {};
    for (const [sats, belopp] of Object.entries(res.momsUnderlag || {})) fick[String(sats)] = belopp;
    const vantat = {};
    for (const [sats, belopp] of Object.entries(f.momsUnderlag)) vantat[String(sats)] = belopp;
    lika('momsUnderlag per momssats', fick, vantat);
  }
  lika('momsOre', res.momsOre, f.momsOre);
  lika('bruttoForeAvrundningOre', res.bruttoForeAvrundningOre, f.bruttoForeAvrundningOre);
  lika('avrundningOre', res.avrundningOre, f.avrundningOre);
  lika('attBetalaOre', res.attBetalaOre, f.attBetalaOre);
  return `att betala ${kr(res.attBetalaOre)}`;
}

function alltId(objOrArr) {
  return Array.isArray(objOrArr) ? objOrArr : Object.values(objOrArr);
}

// ── Kontrollerna ────────────────────────────────────────────────────────────

export const kontroller = [
  {
    id: 'T1',
    namn: F.T1.namn,
    krav: 'Blandad moms på samma faktura: 0 % på pass, 25 % på samtal och resa. Öresavrundning uppåt.',
    kor(a) {
      const res = a.byggUnderlag({
        artiklar: alltId(F.artiklar), poster: F.T1.poster,
        clientId: F.T1.clientId, period: F.T1.period,
      });
      return kontrolleraSummering(res, F.T1.forvantat);
    },
  },

  {
    id: 'T2',
    namn: F.T2.namn,
    krav: 'Moms 285 462,5 öre ska avrundas ROUND_HALF_UP till 285 463 öre, inte bankers rounding.',
    kor(a) {
      const res = a.byggUnderlag({
        artiklar: alltId(F.artiklar), poster: F.T2.poster,
        clientId: F.T2.clientId, period: F.T2.period,
      });
      return kontrolleraSummering(res, F.T2.forvantat);
    },
  },

  {
    id: 'T3',
    namn: F.T3.namn,
    krav: 'Styckpris och timpris på samma faktura, från två uppdrag hos samma kund.',
    kor(a) {
      const res = a.byggUnderlag({
        artiklar: alltId(F.artiklar), poster: F.T3.poster,
        clientId: F.T3.clientId, period: F.T3.period,
      });
      return kontrolleraSummering(res, F.T3.forvantat);
    },
  },

  {
    id: 'T4',
    namn: F.T4.namn,
    krav: 'Fast leverans faktureras med sitt avtalade belopp. Loggad tid redovisas separat och får aldrig ändra beloppet.',
    kor(a) {
      const res = a.byggUnderlag({
        artiklar: alltId(F.artiklar), poster: F.T4.poster,
        clientId: F.T4.clientId, period: F.T4.period,
      });
      const detalj = kontrolleraSummering(res, F.T4.forvantat);
      lika('antal fakturarader (trackingOnly ska inte med)', res.rader.length, F.T4.forvantat.antalFakturarader);
      lika('loggadTidTimmar redovisad separat', res.loggadTidTimmar, F.T4.forvantat.loggadTidTimmar);
      return detalj + ', 12 h loggat utan påverkan på beloppet';
    },
  },

  {
    id: 'T5',
    namn: F.T5.namn,
    krav: 'Delfaktura 1 av 4 ska gå att fakturera, tre delar ska återstå, och den öppna avtalsfrågan ska flaggas utan att blockera.',
    kor(a) {
      const res = a.byggUnderlag({
        artiklar: alltId(F.artiklar), poster: [],
        leveranser: F.T5.leveranser, valdaLeveranser: [F.T5.valdLeverans],
        avtalsuppgifter: F.T5.avtalsuppgifter,
        clientId: F.T5.clientId, period: F.T5.period,
      });
      const f = F.T5.forvantat;
      lika('fakturaradens namn', res.rader[0]?.beskrivning, f.fakturaradNamn);
      lika('nettoOre', res.nettoOre, f.nettoOre);
      lika('momsOre', res.momsOre, f.momsOre);
      lika('attBetalaOre', res.attBetalaOre, f.attBetalaOre);
      lika('återstående delar', res.aterstaendeLeveranser, f.aterstaendeDelar);
      const flagga = (res.kontrollflaggor || []).find(k => k.typ === 'avtalstotal');
      lika('kontrollflagga för avtalstotal finns', !!flagga, f.kontrollflagga);
      lika('flaggans differens i öre', flagga?.diffOre, f.kontrollflaggaDiffOre);
      lika('appen hittar inte på ett totalpris', flagga?.totalOre ?? null, null);
      return `del 1 av 4 à ${kr(res.nettoOre)}, 3 delar kvar, avtalsdiff ${kr(flagga.diffOre)} flaggad`;
    },
  },

  {
    id: 'T6',
    namn: F.T6.namn,
    krav: 'En faktura har EN mottagare. Underlaget ska kunna innehålla valda poster från flera uppdrag hos den kunden. Ovalda poster ska lämnas orörda.',
    kor(a) {
      const allaPoster = [...F.T6.valda, F.T6.ejVald];
      const { underlag, poster } = a.lasUnderlag({
        artiklar: alltId(F.artiklar), poster: allaPoster,
        valda: F.T6.valda.map(p => p.id),
        clientId: F.T6.clientId, period: F.T6.period,
      });
      const f = F.T6.forvantat;
      lika('antal rader', underlag.rader.length, f.antalRader);
      lika('underlaget har exakt en fakturamottagare', underlag.clientId, F.T6.clientId);
      lika('projekt representerade i underlaget',
        [...new Set(underlag.rader.map(r => r.projectId))].sort(), f.projektIUnderlaget);
      lika('nettoOre', underlag.nettoOre, f.nettoOre);
      lika('momsOre', underlag.momsOre, f.momsOre);
      lika('attBetalaOre', underlag.attBetalaOre, f.attBetalaOre);

      const valda = poster.filter(p => F.T6.valda.some(v => v.id === p.id));
      lika('alla valda poster är låsta till samma underlag',
        [...new Set(valda.map(p => p.invoiceRecordId))], [underlag.id]);
      lika('alla valda poster har status included',
        [...new Set(valda.map(p => p.status))], ['included']);

      const ejVald = poster.find(p => p.id === F.T6.ejVald.id);
      lika('ovald post behåller status', ejVald.status, f.ejValdStatusEfterat);
      lika('ovald post är inte kopplad till underlaget', ejVald.invoiceRecordId ?? null, f.ejValdInvoiceRecordId);
      return `${underlag.rader.length} rader från 2 uppdrag, ${kr(underlag.attBetalaOre)}, ovald post orörd`;
    },
  },

  {
    id: 'T7',
    namn: F.T7.namn,
    krav: 'Standardresa 23 km tur och retur ska föreslås. Flera arbetsposter samma dag får inte ge dubbla resor.',
    kor(a) {
      const data = {
        projects: [{ id: F.T7.projectId, name: 'Uppdrag A', defaultTripKm: F.T7.defaultTripKm }],
        entries: F.T7.poster.map((p, i) => ({ id: 'e' + i, projectId: F.T7.projectId, date: p.date, seconds: 3600 })),
        trips: [], expenses: [],
      };
      const forslag = a.foreslaResor(data, F.T7.datum);
      lika('antal reseförslag', forslag.length, F.T7.forvantat.antalForslag);
      lika('föreslagen sträcka', forslag[0]?.km, F.T7.forvantat.km);

      // Efter att resan registrerats får inget nytt förslag komma.
      const efter = { ...data, trips: [{ id: 't1', projectId: F.T7.projectId, date: F.T7.datum, km: F.T7.forvantat.km }] };
      lika('inget förslag när resan redan är registrerad', a.foreslaResor(efter, F.T7.datum).length, 0);
      return `1 förslag à ${F.T7.forvantat.km} km, inget dubblettförslag`;
    },
  },

  {
    id: 'T8',
    namn: F.T8.namn,
    krav: 'Ett behandlingspass 2 400 kr och ett timdebiterat samtal 850 kr samma datum ska ge 3 250 kr netto före resa.',
    kor(a) {
      const netto = a.nettoOreForPoster(alltId(F.artiklar), F.T8.poster);
      lika('nettoOre före resa', netto, F.T8.forvantat.nettoOreForeResa);
      return `${kr(netto)} netto före resa`;
    },
  },

  {
    id: 'T9',
    namn: 'Migrering utan dataförlust, och idempotent',
    krav: 'Alla befintliga objekt ska finnas kvar. Andra körningen får inte skapa dubbla artiklar, leveranser eller fakturareferenser.',
    kor(a) {
      const ra = a.laddaV1Fixture();
      const fore = {
        clients: ra.clients.length, projects: ra.projects.length, entries: ra.entries.length,
        expenses: ra.expenses.length, trips: ra.trips.length,
        tombstones: Object.keys(ra.deletedIds || {}).length,
      };
      const ett = a.migreraTillV2(structuredClone(ra));
      const tva = a.migreraTillV2(structuredClone(ett));

      for (const [falt, antal] of Object.entries(fore)) {
        const efter = falt === 'tombstones'
          ? Object.keys(ett.deletedIds || {}).length
          : (ett[falt] || []).length;
        if (efter < antal) throw new Avvikelse(`antal ${falt} efter migrering`, efter, `minst ${antal}`);
      }
      lika('schemaVersion', ett.schemaVersion >= 2, true);
      const rakna = d => ({
        artiklar: (d.articles || []).length,
        leveranser: (d.deliverables || []).length,
        fakturareferenser: (d.invoiceRecords || []).length,
        poster: (d.entries || []).length,
      });
      lika('andra körningen ändrar ingenting (idempotent)', rakna(tva), rakna(ett));

      // Momsen finns inte i v1. Migreringen får varken befästa 0 % eller hitta på 25 %.
      const artiklar = ett.articles || [];
      lika('migrerade artiklar har ingen momssats', artiklar.every(x => x.vatRate === null), true);
      lika('migrerade artiklar är flaggade för momsgranskning',
        artiklar.every(x => x.vatStatus === 'needsReview'), true);

      // Ett underlag får inte kunna färdigställas medan momsen är ogranskad.
      let blockerade = false;
      try {
        a.byggUnderlag({ artiklar, poster: [], clientId: ett.clients[0]?.id, period: '2026-03', kravGranskadMoms: true });
      } catch { blockerade = true; }
      lika('färdigt underlag blockeras medan momsen är ogranskad', blockerade, true);

      // Fastprisperioder omvandlas inte automatiskt.
      const medPeriod = (ra.projects || []).filter(p => (p.pricingPeriods || []).length);
      lika('inga leveranser skapas ur fastprisperioder', (ett.deliverables || []).length, 0);
      lika('fastprisperioderna finns kvar som råvärde',
        (ett.projects || []).filter(p => (p.pricingPeriods || []).length).length, medPeriod.length);
      const periodPoster = (ett.reviewQueue || []).filter(k => k.typ === 'osakert-pris');
      lika('varje fastprisperiod får en granskningspost',
        periodPoster.length, medPeriod.reduce((s, p) => s + p.pricingPeriods.length, 0));

      return `${fore.entries} poster, ${fore.trips} resor och ${fore.tombstones} tombstones bevarade, `
        + `${artiklar.length} artiklar utan gissad moms, ${periodPoster.length} fastprisperioder till granskning, `
        + 'körning 2 = körning 1';
    },
  },

  {
    id: 'T10',
    namn: 'Opålitlig gammal fakturamarkering blir aldrig en verifierad faktura',
    krav: 'Gamla projectId + month-markeringar ska migreras som osäkra referenser med needsReview=true och okänt fakturanummer.',
    kor(a) {
      const ra = a.laddaV1Fixture();
      const antalGamla = (ra.invoices || []).length;
      const ut = a.migreraTillV2(structuredClone(ra));
      const refs = ut.invoiceRecords || [];
      lika('antal migrerade fakturareferenser', refs.length, antalGamla);
      lika('inget påhittat fakturanummer', refs.every(r => r.invoiceNumber === null), true);
      lika('alla flaggade needsReview', refs.every(r => r.needsReview === true), true);
      lika('ingen är markerad som skickad eller betald',
        refs.every(r => r.status !== 'lundifySent' && r.status !== 'lundifyPaid'), true);
      const ko = ut.reviewQueue || [];
      lika('alla ligger i granskningskön',
        refs.every(r => ko.some(k => k.ref === r.id)), true);
      return `${refs.length} gamla markeringar migrerade som osäkra, alla utan fakturanummer och i granskningskön`;
    },
  },

  {
    id: 'T11',
    namn: F.T11.namn,
    krav: 'Låsta poster behåller sitt snapshotspris när artikelpriset ändras. Nya poster använder det nya priset.',
    kor(a) {
      const res = a.radbeloppMedSnapshot({
        artikel: { ...F.artiklar.B_timme, unitPriceOre: F.T11.prisFore },
        lastPost: F.T11.lastPost,
        nyPost: F.T11.nyPost,
        nyttPrisOre: F.T11.prisEfter,
      });
      lika('låst post behåller snapshotspris', res.lastPostRadbeloppOre, F.T11.forvantat.lastPostRadbeloppOre);
      lika('ny post får nya priset', res.nyPostRadbeloppOre, F.T11.forvantat.nyPostRadbeloppOre);
      return `låst ${kr(res.lastPostRadbeloppOre)}, ny ${kr(res.nyPostRadbeloppOre)}`;
    },
  },

  {
    id: 'T12',
    namn: 'Svenskt språk i texter, filnamn och exporter',
    krav: 'Å, ä och ö ska användas. Inga ersättningar med a/o, inga understreck i användarsynliga filnamn, inga trasiga teckenkodningar.',
    kor() {
      const filer = samlaProjektfiler();
      const trasiga = [];
      const understreck = [];
      // Mönstret byggs av teckenkoder, inte av trasiga tecken, så den här filen
      // inte flaggar sig själv: "Ã" följt av ett typiskt andratecken, samt U+FFFD.
      const MOJIBAKE = new RegExp('\\u00C3[\\u00A4\\u00A5\\u00B6\\u201E\\u2013\\u2026]|\\uFFFD|\\u00EF\\u00BF\\u00BD');

      for (const fil of filer) {
        const rel = fil.slice(repoRot.length).replaceAll('\\', '/');
        const text = readFileSync(fil, 'utf8');
        if (MOJIBAKE.test(text)) trasiga.push(rel);
        if (/_/.test(basename(fil))) understreck.push(rel);
      }
      lika('filer med trasig teckenkodning', trasiga, []);
      lika('filnamn med understreck', understreck, []);

      // Nedladdningsnamn som användaren faktiskt ser.
      const html = readFileSync(join(repoRot, 'index.html'), 'utf8');
      const nedladdningar = [...html.matchAll(/(?:XLSX\.writeFile\([^,]+,\s*|\.download\s*=\s*|dlICS\([^,]+,[^,]+,\s*)([`'"])([^`'"]*)\1/g)]
        .map(m => m[2]).filter(Boolean);
      const daligaNamn = nedladdningar.filter(n => n.includes('_'));
      lika('nedladdningsnamn med understreck', daligaNamn, []);

      // Appen ska faktiskt innehålla svenska tecken, inte bara sakna trasiga.
      lika('index.html innehåller å, ä och ö', /[åäöÅÄÖ]/.test(html), true);
      return `${filer.length} filer kontrollerade, ${nedladdningar.length} nedladdningsnamn, inga trasiga tecken`;
    },
  },

  {
    id: 'T13',
    namn: F.T13.namn,
    krav: 'Ett underlag ska kunna markeras som Lundify-utkast utan fakturanummer. Fakturanummer kopplas först när fakturan har skickats.',
    kor(a) {
      const flode = a.statusFlode(F.T13.steg);
      const f = F.T13.forvantat;
      const utkast = flode.find(s => s.status === 'lundifyDraft');
      const skickad = flode.find(s => s.status === 'lundifySent');
      lika('utkast saknar fakturanummer', utkast.invoiceNumber ?? null, null);
      lika('utkast räknas inte som skickad faktura', utkast.arSkickad, false);
      lika('utkast räknas inte som betald', utkast.arBetald, false);
      lika('skickad faktura har verkligt fakturanummer', skickad.invoiceNumber, '2026-118');
      lika('skickad faktura räknas som skickad', skickad.arSkickad, true);
      if (f.nummerKravsForSkickad) {
        let kastade = false;
        try { a.statusFlode([{ status: 'lundifySent', invoiceNumber: null }]); } catch { kastade = true; }
        lika('skickad utan fakturanummer avvisas', kastade, true);
      }
      return 'utkast utan nummer, skickad med nummer 2026-118, statusarna hålls isär';
    },
  },
];

// ── Filinsamling för T12 ────────────────────────────────────────────────────

const HOPPA_OVER = new Set(['.git', 'node_modules', '.wrangler', '.deploy-tmp', '.vscode', 'privat']);
const TEXTFILER = new Set(['.html', '.md', '.mjs', '.js', '.json', '.css']);

function samlaProjektfiler(katalog = repoRot, ut = []) {
  for (const namn of readdirSync(katalog)) {
    if (HOPPA_OVER.has(namn)) continue;
    const full = join(katalog, namn);
    if (statSync(full).isDirectory()) samlaProjektfiler(full, ut);
    else if (TEXTFILER.has(extname(namn))) ut.push(full);
  }
  return ut;
}

/** Kör alla kontroller mot en adapter och returnerar ett strukturerat resultat. */
export function korAlla(adapter) {
  return kontroller.map(k => {
    try {
      const detalj = k.kor(adapter);
      return { id: k.id, namn: k.namn, krav: k.krav, status: 'godkand', detalj };
    } catch (e) {
      const status = e.name === 'EjStodd' ? 'ej-stodd' : 'misslyckad';
      return { id: k.id, namn: k.namn, krav: k.krav, status, detalj: e.message };
    }
  });
}
