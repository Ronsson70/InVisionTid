// Gränsen mellan v2-FILEN och appens TILLSTÅND.
//
// De två har olika form, och det var det som fällde första införandet.
//
//   Filen (v2-datamodellen)     entries, trips och expenses — tre samlingar
//   Tillståndet (appen)         poster — en enda lista med allt som har ett
//                               datum, en artikel och en kvantitet
//
// Appen slår ihop dem därför att en arbetsdag är en arbetsdag: två behandlingar,
// en resa och ett utlägg samma dag hör ihop i vyn. Filen håller dem isär därför
// att de kommer från olika håll och ska kunna läsas var för sig.
//
// Ingen annan kod får översätta mellan formerna. Gör den det uppstår exakt den
// tysta glidning som gav "undefined is not an object (evaluating 's.poster.filter')":
// v2-objektet skickades rakt in i appen, som letade efter en lista som aldrig
// hade skapats.
//
// Därför gäller två regler här:
//
//   1. Ingen blind åtkomst. Varje samling kontrolleras innan den används.
//   2. Valfritt är valfritt PÅ RIKTIGT. En saknad valfri samling rapporteras,
//      den tystas inte ner till [] så att felet upptäcks först i vyn.

/** Strukturfel i en datafil. Bär namnet på samlingen det gäller. */
export class OgiltigStruktur extends Error {
  constructor(besked, samling = null) {
    super(besked);
    this.name = 'OgiltigStruktur';
    this.samling = samling;
  }
}

/** Samlingar en v1-fil MÅSTE ha för att en nystart ska vara meningsfull. */
export const V1_OBLIGATORISKA = Object.freeze(['clients', 'projects', 'entries']);

/** Samlingar en v1-fil får sakna. Att de saknades rapporteras. */
export const V1_VALFRIA = Object.freeze(['trips', 'expenses', 'invoices']);

/** Samlingar appen läser utan att fråga om lov, och som därför måste finnas. */
export const V2_OBLIGATORISKA = Object.freeze([
  'clients', 'projects', 'articles', 'entries', 'trips', 'expenses',
  'deliverables', 'invoiceRecords',
]);

/** Samlingar i en v2-fil som appen klarar sig utan. */
export const V2_VALFRIA = Object.freeze(['reviewQueue', 'migrationLog']);

const typnamn = v => (v === null ? 'null' : Array.isArray(v) ? 'en lista' : typeof v);

function kravObjekt(data, vad) {
  if (data === null || data === undefined) {
    throw new OgiltigStruktur(`${vad} är tom. Det finns ingen data att läsa.`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new OgiltigStruktur(
      `${vad} innehåller ${typnamn(data)} på översta nivån, inte ett objekt med samlingar.`);
  }
}

/**
 * Kontrollerar samlingarna i en fil och returnerar en normaliserad kopia.
 *
 * @param {object} data
 * @param {object} spec  {vad, obligatoriska, valfria}
 * @returns {{data: object, saknadeValfria: string[]}}
 * @throws {OgiltigStruktur} med samlingens namn i klartext
 */
function valideraSamlingar(data, { vad, obligatoriska, valfria }) {
  kravObjekt(data, vad);

  const ut = { ...data };
  const saknadeValfria = [];

  for (const namn of obligatoriska) {
    const v = data[namn];
    if (v === undefined || v === null) {
      throw new OgiltigStruktur(
        `${vad} saknar samlingen "${namn}". Den är obligatorisk och går inte att ersätta med en tom lista, `
        + 'eftersom det skulle se ut som att det inte fanns någonting att föra över.', namn);
    }
    if (!Array.isArray(v)) {
      throw new OgiltigStruktur(
        `Samlingen "${namn}" i ${vad.toLowerCase()} är ${typnamn(v)}, inte en lista.`, namn);
    }
    ut[namn] = v;
  }

  for (const namn of valfria) {
    const v = data[namn];
    if (v === undefined || v === null) { saknadeValfria.push(namn); ut[namn] = []; continue; }
    if (!Array.isArray(v)) {
      throw new OgiltigStruktur(
        `Samlingen "${namn}" i ${vad.toLowerCase()} är ${typnamn(v)}, inte en lista. `
        + 'En valfri samling får saknas, men inte vara något annat än en lista.', namn);
    }
    ut[namn] = v;
  }

  return { data: ut, saknadeValfria };
}

/** Kontrollerar den gamla filens struktur före en nystart. */
export function valideraV1(data) {
  return valideraSamlingar(data, {
    vad: 'Den gamla filen',
    obligatoriska: V1_OBLIGATORISKA,
    valfria: V1_VALFRIA,
  });
}

/** Kontrollerar en v2-fil eller ett migreringsresultat. */
export function valideraV2(data) {
  return valideraSamlingar(data, {
    vad: 'Den nya filen',
    obligatoriska: V2_OBLIGATORISKA,
    valfria: V2_VALFRIA,
  });
}

// ── Filens form → appens form ───────────────────────────────────────────────

/** Vilken samling en post kom ur. Krävs för att kunna dela upp den igen. */
export const KALLTYP = Object.freeze({ entries: 'entry', trips: 'trip', expenses: 'expense' });

const beskrivningFor = rad =>
  rad.beskrivning ?? rad.description ?? rad.moment ?? '';

/**
 * Bygger appens tillstånd ur en v2-fil.
 *
 * Slår ihop entries, trips och expenses till en lista, eftersom appen visar
 * dem tillsammans. Varje post bär sourceType så att uppdelningen kan göras om
 * exakt när tillståndet sparas.
 *
 * @throws {OgiltigStruktur} om någon obligatorisk samling saknas
 */
export function tillAppTillstand(fil) {
  const { data, saknadeValfria } = valideraV2(fil);

  const poster = [];
  for (const [samling, sourceType] of Object.entries(KALLTYP)) {
    data[samling].forEach((rad, kallindex) => {
      poster.push({ ...rad, sourceType, kallindex, beskrivning: beskrivningFor(rad) });
    });
  }
  // Appen visar äldst först. Filens egen radordning bevaras i kallindex, så
  // att sorteringen här aldrig kan skriva om hur filen ser ut.
  poster.sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));

  const tillstand = { ...data, poster };
  // De tre källsamlingarna finns nu i poster. Att låta dem ligga kvar hade
  // gett två sanningar om samma rad.
  for (const samling of Object.keys(KALLTYP)) delete tillstand[samling];

  tillstand.installningar = data.installningar ?? { veckomalOre: null };
  return { tillstand, saknadeValfria };
}

/**
 * Bygger v2-filen ur appens tillstånd. Motsatsen till tillAppTillstand.
 *
 * Round-trip ska vara förlustfri: franAppTillstand(tillAppTillstand(f)) === f.
 */
export function franAppTillstand(tillstand) {
  kravObjekt(tillstand, 'Tillståndet');
  if (!Array.isArray(tillstand.poster)) {
    throw new OgiltigStruktur(
      'Tillståndet saknar samlingen "poster". Det går inte att spara något som inte har lästs in.', 'poster');
  }

  const fil = { ...tillstand };
  delete fil.poster;
  for (const samling of Object.keys(KALLTYP)) fil[samling] = [];

  const perTyp = new Map(Object.entries(KALLTYP).map(([samling, typ]) => [typ, samling]));
  for (const post of tillstand.poster) {
    const samling = perTyp.get(post.sourceType);
    if (!samling) {
      throw new OgiltigStruktur(
        `Posten ${post.id ?? '(utan id)'} har källtypen "${post.sourceType ?? 'saknas'}", `
        + `som inte hör till någon samling. Kända källtyper: ${[...perTyp.keys()].join(', ')}.`, 'poster');
    }
    const rad = { ...post, description: post.beskrivning };
    delete rad.sourceType;
    delete rad.beskrivning;
    delete rad.kallindex;
    fil[samling].push({ rad, kallindex: post.kallindex });
  }

  // Tillbaka till filens egen ordning. Nya poster saknar kallindex och läggs
  // sist, i den ordning de registrerades.
  for (const samling of Object.keys(KALLTYP)) {
    fil[samling] = fil[samling]
      .map((x, i) => ({ ...x, fallback: i }))
      .sort((a, b) =>
        (a.kallindex ?? Infinity) - (b.kallindex ?? Infinity) || a.fallback - b.fallback)
      .map(x => x.rad);
  }

  return fil;
}

/**
 * Bevisar att ett migreringsresultat går att visa i appen INNAN något skrivs.
 *
 * Det är den kontrollen som saknades. Migreringen var korrekt — resultatet
 * gick bara inte att rendera, och det upptäcktes först när filerna redan låg
 * i OneDrive.
 *
 * @returns {{tillstand: object, antal: object, saknadeValfria: string[]}}
 */
export function kontrolleraForeSkrivning(v2) {
  const { tillstand, saknadeValfria } = tillAppTillstand(v2);

  const antalAv = typ => tillstand.poster.filter(p => p.sourceType === typ).length;
  const antal = {
    poster: tillstand.poster.length,
    tidsposter: antalAv('entry'),
    resor: antalAv('trip'),
    utlagg: antalAv('expense'),
    kunder: tillstand.clients.length,
    uppdrag: tillstand.projects.length,
    artiklar: tillstand.articles.length,
    fakturamarkeringar: tillstand.invoiceRecords.length,
  };

  // Round-trip: det som ska skrivas måste gå att läsa tillbaka till samma sak.
  const tillbaka = franAppTillstand(tillstand);
  for (const samling of Object.keys(KALLTYP)) {
    if (tillbaka[samling].length !== v2[samling].length) {
      throw new OgiltigStruktur(
        `Samlingen "${samling}" tappade rader på vägen: ${v2[samling].length} in, `
        + `${tillbaka[samling].length} ut. Ingenting har skrivits.`, samling);
    }
  }

  // Varje post måste peka på en artikel som finns, annars går den inte att prissätta.
  const artikelIdn = new Set(tillstand.articles.map(a => a.id));
  const utanArtikel = tillstand.poster.filter(p => p.articleId && !artikelIdn.has(p.articleId));
  if (utanArtikel.length) {
    throw new OgiltigStruktur(
      `${utanArtikel.length} poster pekar på en artikel som inte finns. Ingenting har skrivits.`, 'articles');
  }

  return { tillstand, antal, saknadeValfria };
}
