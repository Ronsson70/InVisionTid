import { faktureringsprofil } from './faktureringsprofil.mjs';
import { radbeloppOre } from '../domain/pengar.mjs';

export const FORETAG = ['In Vision Järvsö AB', 'Järvsö IK Event AB'];
export const foretagFor = (s, projectId) => s.projects.find(p => p.id === projectId)?.billingCompany || null;

export const faktureringsvag = (s, projectId) => {
  const p = s.projects.find(p => p.id === projectId);
  const kund = s.clients.find(c => c.id === p?.clientId)?.name || 'Kund inte vald';
  return `${p?.billingCompany || 'Fakturerande företag inte valt'} → ${kund}`;
};

/** Endast entydiga kopplingar från underlagets egna registreringar föreslås. */
export function foretagskopplingar(s) {
  return (s.invoiceRecords || []).filter(r => !r.billingCompany).flatMap(r => {
    const kallor = [...(s.poster || []), ...(s.deliverables || [])]
      .filter(p => p.invoiceRecordId === r.id);
    const foretag = new Set(kallor.map(p => foretagFor(s, p.projectId)));
    return kallor.length && foretag.size === 1 && FORETAG.includes([...foretag][0])
      ? [{ id: r.id, billingCompany: [...foretag][0], period: r.period,
        kundnamn: s.clients.find(c => c.id === r.clientId)?.name || 'Utan kund' }] : [];
  });
}

/** Rättar bara saknat företagsfält. Status, låsning och pengar bevaras. */
export function kopplaUnderlagsForetag(s, ids) {
  const forslag = new Map(foretagskopplingar(s).map(r => [r.id, r.billingCompany]));
  if (!ids.length || ids.some(id => !forslag.has(id))) throw new Error('Företagskopplingen är inte entydig. Kontrollera underlaget.');
  return { ...s, invoiceRecords: s.invoiceRecords.map(r => ids.includes(r.id)
    ? { ...r, billingCompany: forslag.get(r.id) } : r) };
}

// Detta är presentationsrader. Originalbesöken och prisögonblicksbilden behålls.
export function fakturarader(s, underlag) {
  const resor = new Map();
  const samtal = new Map();
  const rader = [];
  for (const rad of underlag.rader) {
    const post = s.poster.find(p => p.id === rad.sourceId);
    const profile = faktureringsprofil(s, rad.projectId);
    const article = s.articles.find(a => a.id === post?.articleId);
    if (rad.sourceType === 'trip') {
      const purpose = faktureringsprofil(s, rad.projectId).travelGrouping === 'purpose';
      const label = purpose ? ({ session: 'Passresor', conversation: 'Samtalsresor', other: 'Övriga resor' }[post?.travelPurpose] || 'Resor – ändamål behöver verifieras') : 'Resor för arbete';
      const key = `${rad.projectId}|${post?.travelPurpose || ''}|${rad.unit}|${rad.unitPriceOre}|${rad.vatRate}`;
      const r = resor.get(key) || { ...rad, beskrivning: `${label} ${underlag.period || ''}`.trim(), qtyMilli: 0, nettoOre: 0, sourceIds: [] };
      r.qtyMilli += rad.qtyMilli;
      r.nettoOre += rad.nettoOre;
      r.sourceIds.push(rad.sourceId);
      resor.set(key, r);
    } else {
      const title = article?.type === 'session' ? profile.sessionLabel || rad.beskrivning : rad.beskrivning;
      const delar = [rad.datum, title, title !== rad.beskrivning ? rad.beskrivning : null];
      const kundtext = post?.customerText ?? post?.anteckning; // äldre fält var kundens arbetsbeskrivning
      if (kundtext && !title.includes(kundtext)) delar.push(kundtext);
      if (post?.consultedWith) delar.push(`Utfört i samråd med ${post.consultedWith}`);
      if (post?.performedBy) delar.push(`Utförare: ${post.performedBy}`);
      const decorated = { ...rad, beskrivning: delar.filter(Boolean).join(' · ') };
      if (article?.type === 'hourly' && profile.hourlyGrouping === 'dated') {
        const key = `${rad.projectId}|${rad.unit}|${rad.unitPriceOre}|${rad.vatRate}`;
        const group = samtal.get(key) || { ...rad, label: profile.hourlyLabel || 'Timarbete', qtyMilli: 0, nettoOre: 0, sourceIds: [], originals: [] };
        group.qtyMilli += rad.qtyMilli; group.nettoOre += rad.nettoOre;
        group.sourceIds.push(rad.sourceId); group.originals.push(decorated);
        samtal.set(key, group);
      } else rader.push(decorated);
    }
  }
  for (const group of samtal.values()) {
    const { originals, label, ...row } = group;
    if (radbeloppOre(row.unitPriceOre, row.qtyMilli) !== row.nettoOre) { rader.push(...originals); continue; }
    const dates = [...originals].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    rader.push({ ...row, beskrivning: `${label}: ${dates.map(r => `${r.beskrivning} (${String(r.qtyMilli / 1000).replace('.', ',')} ${r.unit})`).join('; ')}` });
  }
  // Olika priser/moms hålls isär. Öresavrundning måste också bli densamma.
  for (const r of resor.values()) {
    if (radbeloppOre(r.unitPriceOre, r.qtyMilli) === r.nettoOre) rader.push(r);
    else rader.push(...underlag.rader.filter(x => r.sourceIds.includes(x.sourceId)));
  }
  return rader;
}

export function registreraUtlagg(s, indata, id) {
  const project = s.projects.find(p => p.id === indata.projectId);
  if (!project) throw new Error('Välj ett uppdrag.');
  const grossOre = Math.round(Number(String(indata.gross || '').replace(',', '.')) * 100);
  const receiptVat = Number(indata.receiptVat);
  const invoiceVat = Number(indata.invoiceVat);
  if (!Number.isSafeInteger(grossOre) || grossOre <= 0) throw new Error('Ange kvittots belopp inklusive moms.');
  if (indata.receiptVat === '' || indata.invoiceVat === '' || ![0, 600, 1200, 2500].includes(receiptVat) || ![0, 600, 1200, 2500].includes(invoiceVat)) throw new Error('Välj både kvittots moms och momsen vid vidarefakturering.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(indata.date || '')) throw new Error('Välj datum.');
  if (!String(indata.description || '').trim()) throw new Error('Beskriv inköpet.');
  const netOre = Math.round(grossOre * 10000 / (10000 + receiptVat));
  const articleId = `utlagg-${id}`;
  return {
    ...s,
    articles: [...s.articles, { id: articleId, projectId: project.id, name: 'Material utan påslag', type: 'piece', unit: 'kr', unitPriceOre: 100, vatRate: invoiceVat, vatStatus: 'reviewed', billable: indata.rebill !== 'no', active: true }],
    poster: [...s.poster, { id, projectId: project.id, articleId, date: indata.date, beskrivning: String(indata.description).trim(), qtyMilli: netOre * 10, seconds: 0, sourceType: 'expense', status: 'open', invoiceRecordId: null, priceSnapshot: null,
      rebill: indata.rebill !== 'no', receiptGrossOre: grossOre, receiptVatOre: grossOre - netOre, receiptVatRate: receiptVat, paidBy: indata.paidBy || 'company', receiptImage: indata.receiptImage || null, reimbursementStatus: 'unreviewed' }],
  };
}

export function sattManadskontroll(s, company, period, note) {
  if (!FORETAG.includes(company) || !/^\d{4}-\d{2}$/.test(period)) throw new Error('Välj företag och månad.');
  const key = `${company}|${period}`;
  return { ...s, installningar: { ...s.installningar, manadskontroll: { ...s.installningar?.manadskontroll, [key]: String(note || '').trim() } } };
}
