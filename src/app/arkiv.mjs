// Skrivskyddad läsmodell för historiken i v1-filen.
//
// Arkivet används bara för att göra äldre registreringar synliga. Det räknar
// aldrig pengar som intjänade eller fakturerbara, och det skapar inga v2-poster.

const lista = v => Array.isArray(v) ? v : [];
const text = v => String(v ?? '').trim();
const manadFranDatum = datum => /^\d{4}-\d{2}-\d{2}$/.test(text(datum)) ? text(datum).slice(0, 7) : null;

const oreFranKronor = kronor => {
  const tal = Number(kronor);
  return Number.isFinite(tal) ? Math.round(tal * 100) : 0;
};

/**
 * Gör hela den gamla historiken läsbar utan att tolka fakturastatus eller
 * prissättning. Gamla fakturamarkeringar följer bara med som varningsetikett.
 */
export function byggArkiv(v1data) {
  const kunder = new Map(lista(v1data?.clients).map(k => [k.id, k]));
  const uppdrag = new Map(lista(v1data?.projects).map(p => [p.id, p]));
  const markeringar = new Set(lista(v1data?.invoices)
    .filter(i => i?.projectId && /^\d{4}-\d{2}$/.test(text(i.month)))
    .map(i => `${i.projectId}|${i.month}`));

  const grund = (post, typ, beskrivning) => {
    const project = uppdrag.get(post.projectId);
    const client = kunder.get(project?.clientId);
    const month = manadFranDatum(post.date) ?? 'utan-datum';
    return {
      id: text(post.id), typ, date: text(post.date), month,
      projectId: text(post.projectId),
      projectName: text(project?.name) || 'Okänt uppdrag',
      clientName: text(client?.name) || 'Utan kund',
      description: text(beskrivning),
      gammalFakturamarkering: month !== 'utan-datum' && markeringar.has(`${post.projectId}|${month}`),
    };
  };

  const rader = [
    ...lista(v1data?.entries).map(p => ({
      ...grund(p, 'time', p.moment || p.description || 'Tid'),
      seconds: Number.isFinite(Number(p.seconds)) ? Number(p.seconds) : 0,
    })),
    ...lista(v1data?.trips).map(p => ({
      ...grund(p, 'trip', p.description || 'Resa'),
      km: Number.isFinite(Number(p.km)) ? Number(p.km) : 0,
    })),
    ...lista(v1data?.expenses).map(p => ({
      ...grund(p, 'expense', p.description || 'Utlägg'),
      amountOre: oreFranKronor(p.amount),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.clientName.localeCompare(b.clientName, 'sv') || a.id.localeCompare(b.id));

  const allaManader = [...new Set(rader.map(r => r.month))];
  const manadsIdn = allaManader.filter(id => id !== 'utan-datum').sort().reverse();
  if (allaManader.includes('utan-datum')) manadsIdn.push('utan-datum');
  const manader = manadsIdn.map(id => {
    const manadsrader = rader.filter(r => r.month === id);
    return {
      id,
      rader: manadsrader,
      tidsposter: manadsrader.filter(r => r.typ === 'time').length,
      resor: manadsrader.filter(r => r.typ === 'trip').length,
      utlagg: manadsrader.filter(r => r.typ === 'expense').length,
      sekunder: manadsrader.reduce((summa, r) => summa + (r.seconds || 0), 0),
      km: manadsrader.reduce((summa, r) => summa + (r.km || 0), 0),
      utlaggOre: manadsrader.reduce((summa, r) => summa + (r.amountOre || 0), 0),
      harGamlaFakturamarkeringar: manadsrader.some(r => r.gammalFakturamarkering),
    };
  });

  return {
    skrivskyddad: true,
    manader,
    totalt: {
      tidsposter: lista(v1data?.entries).length,
      resor: lista(v1data?.trips).length,
      utlagg: lista(v1data?.expenses).length,
    },
  };
}

export function arkivmanad(arkiv, index = 0) {
  const manader = lista(arkiv?.manader);
  if (!manader.length) return null;
  const giltigtIndex = Math.max(0, Math.min(manader.length - 1, Number(index) || 0));
  return manader[giltigtIndex];
}
