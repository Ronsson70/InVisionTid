// Ren logik för att lägga till och återaktivera uppdrag.
//
// Den gamla v1-filen läses bara. När ett tidigare uppdrag aktiveras kopieras
// enbart kunden, uppdraget och dess artiklar till v2. Ingen arbetshistorik och
// inga gamla fakturamarkeringar följer med.

import { skapaArtikel, kronorTillOre, migreraTillV2 } from '../domain/index.mjs';

export const DEBITERINGSTYPER = Object.freeze([
  { id: 'hourly', etikett: 'Per timme' },
  { id: 'session', etikett: 'Per tillfälle' },
  { id: 'fixed', etikett: 'Fast pris' },
  { id: 'internal', etikett: 'Endast tidsuppföljning' },
]);

export const KUNDSTATUSAR = Object.freeze([
  { id: 'active', etikett: 'Aktiv' },
  { id: 'paused', etikett: 'Vilande' },
  { id: 'closed', etikett: 'Avslutad' },
]);

const text = v => String(v ?? '').trim();

function pengarOre(varde, falt) {
  const normaliserat = text(varde).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normaliserat)) {
    throw new Error(`${falt} måste vara ett belopp i kronor.`);
  }
  const ore = kronorTillOre(Number(normaliserat));
  if (ore <= 0) throw new Error(`${falt} måste vara större än noll.`);
  return ore;
}

function heltal(varde, falt, { tillatTomt = false } = {}) {
  if (tillatTomt && text(varde) === '') return null;
  const tal = Number(text(varde).replace(',', '.'));
  if (!Number.isFinite(tal) || tal <= 0) throw new Error(`${falt} måste vara större än noll.`);
  return tal;
}

const uniktId = (prefix, lista) => {
  let id;
  do id = `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  while (lista.some(x => x.id === id));
  return id;
};

/**
 * Redigerar samma kunduppgifter som fanns i den tidigare appen. Okända fält
 * bevaras och kunden kan inte raderas när historik pekar på den.
 */
export function uppdateraKund(tillstand, clientId, indata) {
  const befintlig = (tillstand.clients || []).find(c => c.id === clientId);
  if (!befintlig) throw new Error('Kunden finns inte längre.');

  const name = text(indata?.name);
  if (!name) throw new Error('Kundens namn får inte vara tomt.');
  const status = text(indata?.status) || 'active';
  if (!KUNDSTATUSAR.some(s => s.id === status)) throw new Error('Välj en giltig kundstatus.');

  const uppdaterad = {
    ...befintlig,
    name,
    orgNr: text(indata?.orgNr),
    contact: text(indata?.contact),
    phone: text(indata?.phone),
    email: text(indata?.email),
    address: text(indata?.address),
    status,
  };
  return {
    ...tillstand,
    clients: tillstand.clients.map(c => c.id === clientId ? uppdaterad : c),
  };
}

/**
 * Tar fram uppdrag som finns i v1 men inte i det aktuella v2-tillståndet.
 * Resultatet innehåller bara grunddata som behövs för ett uttryckligt återval.
 */
export function tidigareUppdragFranV1(v1data, tillstand, { nu = new Date().toISOString() } = {}) {
  const migrerad = migreraTillV2(v1data, { nu });
  const befintliga = new Set((tillstand?.projects || []).map(p => p.id));

  return (migrerad.projects || [])
    .filter(p => !befintliga.has(p.id))
    .map(project => ({
      id: project.id,
      project: structuredClone(project),
      client: structuredClone((migrerad.clients || []).find(c => c.id === project.clientId) || null),
      articles: structuredClone((migrerad.articles || []).filter(a => a.projectId === project.id)),
    }))
    .sort((a, b) => String(a.project.name).localeCompare(String(b.project.name), 'sv'));
}

/** Aktiverar ett tidigare uppdrag utan att kopiera historik från v1. */
export function aktiveraTidigareUppdrag(tillstand, paket) {
  if (!paket?.project?.id) throw new Error('Det tidigare uppdraget saknar identitet.');
  if ((tillstand.projects || []).some(p => p.id === paket.project.id)) {
    throw new Error('Uppdraget är redan aktivt.');
  }
  if (!(paket.articles || []).length) {
    throw new Error('Uppdraget saknar arbetstyp och kan inte aktiveras.');
  }

  const clients = [...(tillstand.clients || [])];
  if (paket.client && !clients.some(c => c.id === paket.client.id)) {
    clients.push({ ...paket.client, status: 'active' });
  }

  const artikelIdn = new Set((tillstand.articles || []).map(a => a.id));
  const articles = [
    ...(tillstand.articles || []),
    ...paket.articles.filter(a => !artikelIdn.has(a.id)).map(a => ({ ...a, active: true })),
  ];

  return {
    ...tillstand,
    clients,
    projects: [...(tillstand.projects || []), {
      ...paket.project, active: true, archivedAt: null,
      sortOrder: Math.max(0, ...(tillstand.projects || []).map(p => p.sortOrder || 0)) + 1,
    }],
    articles,
  };
}

/** Återaktiverar ett uppdrag vars grunddata redan finns i v2. */
export function aktiveraBefintligtUppdrag(tillstand, projectId) {
  const project = (tillstand.projects || []).find(p => p.id === projectId);
  if (!project) throw new Error('Uppdraget finns inte längre.');
  if (project.active !== false) throw new Error('Uppdraget är redan aktivt.');

  return {
    ...tillstand,
    clients: (tillstand.clients || []).map(c => c.id === project.clientId ? { ...c, status: 'active' } : c),
    projects: (tillstand.projects || []).map(p => p.id === projectId
      ? { ...p, active: true, archivedAt: null } : p),
    articles: (tillstand.articles || []).map(a => a.projectId === projectId ? { ...a, active: true } : a),
  };
}

/**
 * Skapar ett nytt uppdrag och de artiklar som det dagliga flödet behöver.
 * Alla ekonomiska uppgifter anges uttryckligen; ingen moms eller prissättning
 * gissas. Fast pris får alltid en upparbetningsperiod.
 */
export function skapaNyttUppdrag(tillstand, indata) {
  const namn = text(indata?.namn);
  if (!namn) throw new Error('Skriv ett namn på uppdraget.');

  const debitering = text(indata?.debitering);
  if (!DEBITERINGSTYPER.some(t => t.id === debitering)) {
    throw new Error('Välj hur uppdraget ska räknas.');
  }

  let clientId = text(indata?.clientId);
  let clients = [...(tillstand.clients || [])];
  if (clientId === 'ny' || !clientId) {
    const kundnamn = text(indata?.kundnamn);
    if (!kundnamn) throw new Error('Välj en kund eller skriv ett nytt kundnamn.');
    clientId = uniktId('kund', clients);
    clients.push({ id: clientId, name: kundnamn, status: 'active' });
  } else if (!clients.some(c => c.id === clientId)) {
    throw new Error('Den valda kunden finns inte längre.');
  }

  const projectId = uniktId('uppdrag', tillstand.projects || []);
  const project = {
    id: projectId, name: namn, clientId,
    kind: debitering === 'internal' ? 'internal' : 'billable',
    active: true, archivedAt: null,
    sortOrder: Math.max(0, ...(tillstand.projects || []).map(p => p.sortOrder || 0)) + 1,
    defaultTripKm: debitering === 'internal'
      ? null : heltal(indata?.standardresaKm, 'Standardresan', { tillatTomt: true }),
  };

  const articles = [];
  const valdMoms = indata?.vatRate === null || indata?.vatRate === undefined || indata?.vatRate === ''
    ? null : Number(indata.vatRate);
  const gemensamt = {
    projectId,
    vatRate: debitering === 'internal' ? 0 : valdMoms,
    vatStatus: 'reviewed', needsReview: false,
  };

  if (debitering !== 'internal' && ![0, 600, 1200, 2500].includes(gemensamt.vatRate)) {
    throw new Error('Välj momssats.');
  }

  if (debitering === 'hourly') {
    articles.push(skapaArtikel({ ...gemensamt, id: `art-${projectId}-hourly`, name: 'Arbetad tid',
      type: 'hourly', unitPriceOre: pengarOre(indata?.pris, 'Timpriset'), sortOrder: 10 }));
  } else if (debitering === 'session') {
    articles.push(skapaArtikel({ ...gemensamt, id: `art-${projectId}-session`, name: 'Tillfälle',
      type: 'session', unitPriceOre: pengarOre(indata?.pris, 'Priset per tillfälle'), sortOrder: 10 }));
  } else {
    articles.push(skapaArtikel({ ...gemensamt, id: `art-${projectId}-trackingOnly`,
      name: debitering === 'internal' ? 'Internt arbete' : 'Nedlagd tid',
      type: 'trackingOnly', unitPriceOre: 0, billable: false, sortOrder: 80 }));
  }

  let deliverables = [...(tillstand.deliverables || [])];
  if (debitering === 'fixed') {
    const startDate = text(indata?.startDate);
    const endDate = text(indata?.endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('Välj start- och slutdatum för fastpriset.');
    }
    if (endDate < startDate) throw new Error('Slutdatumet kan inte ligga före startdatumet.');
    deliverables.push({
      id: uniktId('leverans', deliverables), projectId, name: namn,
      amountOre: pengarOre(indata?.pris, 'Fastpriset'), vatRate: gemensamt.vatRate,
      vatStatus: 'reviewed', order: 1, status: 'planned', completedAt: null,
      invoiceRecordId: null, startDate, endDate,
    });
  }

  const resepris = text(indata?.resepris);
  const standardresa = project.defaultTripKm;
  if ((resepris && standardresa === null) || (!resepris && standardresa !== null)) {
    throw new Error('Fyll i både standardresa och pris per kilometer, eller lämna båda tomma.');
  }
  if (resepris && debitering !== 'internal') {
    articles.push(skapaArtikel({ ...gemensamt, id: `art-${projectId}-travel`, name: 'Resa',
      type: 'travel', unitPriceOre: pengarOre(resepris, 'Resepriset'), sortOrder: 90 }));
  }

  return {
    ...tillstand,
    clients,
    projects: [...(tillstand.projects || []), project],
    articles: [...(tillstand.articles || []), ...articles],
    deliverables,
  };
}
