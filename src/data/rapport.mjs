// Sanerad rapport från en migreringsförhandsgranskning.
//
// Rapporten byggs av en TILLÅTELSELISTA. Den kopierar aldrig ett fält vidare
// från källan, den läser bara antal, tidsstämplar, enum-värden och booleaner.
// Kundnamn, projektnamn, beskrivningar, belopp och rå JSON kan därför inte
// hamna i en rapport ens av misstag — det finns ingen väg dit.
//
// Ett test bevisar det med en kanariefågel: en syntetisk källa där varje
// textfält innehåller en markörsträng, och en kontroll att markören inte finns
// någonstans i den serialiserade rapporten.

const RAKNADE = ['clients', 'projects', 'entries', 'expenses', 'trips', 'invoices', 'tombstones'];
const SUMMOR = ['sekunder', 'km', 'utlaggKronor'];

/**
 * @param {object} f  resultatet från forhandsgranskaMigrering
 * @param {object} kalla  { sokvag, byte, andrad, checksummaFore, checksummaEfter, lastSync, via }
 */
export function saneradRapport(f, kalla = {}) {
  const antal = {};
  for (const falt of RAKNADE) {
    antal[falt] = { fore: f?.fore?.[falt] ?? 0, efter: f?.efter?.[falt] ?? 0 };
  }

  const kontrollsummor = {};
  let allaOforandrade = true;
  for (const falt of SUMMOR) {
    const fore = f?.fore?.[falt] ?? 0;
    const efter = f?.efter?.[falt] ?? 0;
    kontrollsummor[falt] = { fore, efter, oforandrad: fore === efter };
    if (fore !== efter) allaOforandrade = false;
  }

  // Enum-nycklar och antal. Aldrig beskrivningarna.
  const granskningsposterPerTyp = {};
  for (const [typ, n] of Object.entries(f?.granskningsposterPerTyp || {})) {
    granskningsposterPerTyp[String(typ)] = Number(n);
  }

  const referenser = f?.fakturareferenser || [];

  return {
    kalla: {
      sokvag: kalla.sokvag ?? null,
      byte: kalla.byte ?? null,
      andrad: kalla.andrad ?? null,
      lastSync: typeof kalla.lastSync === 'string' ? kalla.lastSync : null,
      checksummaFore: kalla.checksummaFore ?? null,
      checksummaEfter: kalla.checksummaEfter ?? null,
      oforandrad: kalla.checksummaFore != null && kalla.checksummaFore === kalla.checksummaEfter,
      via: kalla.via ?? null,
    },

    antal,
    kontrollsummor,
    kontrollsummorOforandrade: allaOforandrade,

    skapade: {
      artiklar: Number(f?.skapade?.artiklar ?? 0),
      leveranser: Number(f?.skapade?.leveranser ?? 0),
      fakturareferenser: Number(f?.skapade?.fakturareferenser ?? 0),
      granskningsposter: Number(f?.skapade?.granskningsposter ?? 0),
    },

    ogranskadMomsAntal: Number(f?.ogranskadMomsAntal ?? 0),
    bevaradeFastprisperioderAntal: (f?.bevaradeFastprisperioder || []).length,
    osakraFakturareferenserAntal: referenser.filter(r => r.needsReview === true).length,
    fakturareferenserUtanNummer: referenser.filter(r => r.invoiceNumber === null).length,
    granskningsposterPerTyp,

    // Momsen ligger INTE i granskningskön.
    //
    // Granskningskön är poster i reviewQueue. Momsflaggan sitter på ARTIKELN,
    // som vatStatus 'needsReview'. Att lägga ihop dem vore fel, och att bara
    // rapportera det ena antalet ger intrycket att färre beslut återstår än det
    // faktiskt gör. Därför redovisas båda, och summan.
    beslut: {
      iGranskningskon: Number(f?.skapade?.granskningsposter ?? 0),
      momsUtanforGranskningskon: Number(f?.ogranskadMomsAntal ?? 0),
      totalt: Number(f?.skapade?.granskningsposter ?? 0) + Number(f?.ogranskadMomsAntal ?? 0),
    },

    idempotent: f?.idempotent === true,
    redanMigrerad: f?.redanMigrerad === true,
    giltig: f?.giltig === true,

    // Fasta meddelanden och fältnamn, aldrig innehåll ur källan.
    fel: (f?.fel || []).map(String),
    avvikelser: (f?.avvikelser || []).map(a => ({
      falt: String(a.falt), fore: Number(a.fore), efter: Number(a.efter), regel: String(a.regel),
    })),

    sparat: false,
    skrivningar: 0,
  };
}

/** Rapporten som läsbar text. Samma tillåtelselista, ingenting mer. */
export function rapportText(r) {
  const rad = (etikett, varde) => `  ${String(etikett).padEnd(32)} ${varde}`;
  const ut = [];

  ut.push('Skrivskyddad förhandsgranskning');
  ut.push('═'.repeat(66));
  ut.push('Källa');
  ut.push(rad('sökväg', r.kalla.sokvag ?? 'okänd'));
  ut.push(rad('läst via', r.kalla.via ?? 'okänt'));
  ut.push(rad('bytelängd', r.kalla.byte ?? 'okänd'));
  ut.push(rad('ändrad', r.kalla.andrad ?? 'okänt'));
  ut.push(rad('lastSync i filen', r.kalla.lastSync ?? 'saknas'));
  ut.push(rad('SHA-256 före', r.kalla.checksummaFore ?? 'okänd'));
  ut.push(rad('SHA-256 efter', r.kalla.checksummaEfter ?? 'okänd'));
  ut.push(rad('källan oförändrad', r.kalla.oforandrad ? 'ja' : 'NEJ'));

  ut.push('');
  ut.push('Antal per samling, får inte minska');
  for (const [falt, v] of Object.entries(r.antal)) {
    ut.push(rad(falt, `${v.fore} → ${v.efter}${v.efter < v.fore ? '   AVVIKELSE' : ''}`));
  }

  ut.push('');
  ut.push('Kontrollsummor, ska vara oförändrade');
  for (const [falt, v] of Object.entries(r.kontrollsummor)) {
    ut.push(rad(falt, `${v.fore} → ${v.efter}   ${v.oforandrad ? 'oförändrad' : 'AVVIKELSE'}`));
  }

  ut.push('');
  ut.push('Skapas av migreringen');
  ut.push(rad('artiklar', r.skapade.artiklar));
  ut.push(rad('leveranser', `${r.skapade.leveranser}   (fastpris omvandlas aldrig automatiskt)`));
  ut.push(rad('fakturareferenser', r.skapade.fakturareferenser));
  ut.push(rad('granskningsposter', r.skapade.granskningsposter));

  ut.push('');
  ut.push('Kvarstående beslut');
  ut.push(rad('i granskningskön', r.beslut.iGranskningskon));
  for (const [typ, n] of Object.entries(r.granskningsposterPerTyp)) ut.push(rad('  ' + typ, n));
  ut.push(rad('moms, UTANFÖR granskningskön', `${r.beslut.momsUtanforGranskningskon} artiklar med vatStatus needsReview`));
  ut.push(rad('SUMMA beslut', `${r.beslut.totalt}   (${r.beslut.iGranskningskon} + ${r.beslut.momsUtanforGranskningskon})`));
  ut.push('');
  ut.push('  Momsflaggan sitter på artikeln, inte i granskningskön. De två');
  ut.push('  antalen överlappar alltså inte och ska inte förväxlas.');
  ut.push('');
  ut.push(rad('bevarade fastprisperioder', r.bevaradeFastprisperioderAntal));
  ut.push(rad('osäkra fakturareferenser', r.osakraFakturareferenserAntal));
  ut.push(rad('därav utan fakturanummer', r.fakturareferenserUtanNummer));

  ut.push('');
  ut.push('Kontroller');
  ut.push(rad('idempotent', r.idempotent ? 'ja' : 'NEJ'));
  ut.push(rad('redan migrerad', r.redanMigrerad ? 'ja' : 'nej'));
  ut.push(rad('förhandsgranskning giltig', r.giltig ? 'ja' : 'NEJ'));
  ut.push(rad('skrivningar', r.skrivningar));
  ut.push(rad('sparat', r.sparat ? 'JA' : 'nej'));

  if (r.fel.length) {
    ut.push('');
    ut.push('Blockerande');
    for (const f of r.fel) ut.push('  • ' + f);
  }
  if (r.avvikelser.length) {
    ut.push('');
    ut.push('Avvikelser');
    for (const a of r.avvikelser) ut.push(`  • ${a.falt}: ${a.fore} → ${a.efter} (${a.regel})`);
  }

  ut.push('═'.repeat(66));
  return ut.join('\n');
}
