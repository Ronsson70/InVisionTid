// Manuell avstämning. Inga nätverksanrop och inga antaganden om Lundifystatus.
import * as L from './logik.mjs';

export const underlagsStatus = r => ({
  prepared: 'Sparat förberett', draft: 'Verifierat Lundify-utkast',
  registered: 'Registrerad faktura enligt avstämning', superseded: 'Tidigare underlagsversion',
}[r?.workflowStatus] || 'Äldre underlag – behöver avstämmas');

// Jämför hela innehållet, inte en kort hash med kollisionsrisk.
const canonical = x => Array.isArray(x) ? x.map(canonical)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const byId = xs => [...xs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
export function kontrollversion(s, underlag) {
  const ids = new Set(underlag.rader.map(r => r.sourceId));
  const projectIds = new Set(underlag.rader.map(r => r.projectId));
  return JSON.stringify(canonical({
    company: underlag.billingCompany, client: s.clients.find(c => c.id === underlag.clientId),
    projects: byId(s.projects.filter(p => projectIds.has(p.id))),
    rows: underlag.rader,
    sources: byId(s.poster.filter(p => ids.has(p.id))).map(p => ({
      id: p.id, projectId: p.projectId, articleId: p.articleId, date: p.date,
      qtyMilli: p.qtyMilli, seconds: p.seconds ?? null, status: p.status ?? 'open', invoiceRecordId: p.invoiceRecordId ?? null,
      text: p.beskrivning || p.description || '', customerText: p.customerText ?? p.anteckning ?? null,
      internalNote: p.internalNote ?? null, travelPurpose: p.travelPurpose ?? null, performedBy: p.performedBy ?? null, consultedWith: p.consultedWith ?? null,
      priceSnapshot: p.priceSnapshot ?? null,
    })),
    deliveries: byId((s.deliverables || []).filter(l => ids.has(l.id))),
  }));
}

export function sparaForberett(s, gruppId, valdaLeveranser, version, { nu = new Date().toISOString(), projectId = null } = {}) {
  const res = L.forberedUnderlag(s, gruppId, { valdaLeveranser, projectId });
  if (!res.ok) return res;
  if (!res.grupp.billingCompany) return { ok: false, besked: 'Välj fakturerande företag.' };
  if (kontrollversion(s, res.underlag) !== version) return { ok: false, besked: 'Underlaget har ändrats. Öppna förhandsvisningen igen.' };
  const underlag = { ...structuredClone(res.underlag), clientSnapshot: structuredClone(s.clients.find(c => c.id === res.underlag.clientId)), previousDraftReferences: (s.invoiceRecords || []).filter(r => r.workflowStatus === 'superseded' && r.lundifyDraftId && r.snapshot?.rader.some(old => res.underlag.rader.some(row => row.sourceType === old.sourceType && row.sourceId === old.sourceId))).map(r => r.lundifyDraftId) };
  const referens = { ...underlag, workflowStatus: 'prepared', createdAt: nu, updatedAt: nu,
    snapshot: underlag, presentationRows: structuredClone(L.fakturarader(s, underlag)),
    sourceVersion: version, events: [{ type: 'prepared', at: nu }], invoiceNumber: null };
  const state = { ...s, poster: res.poster, deliverables: res.leveranser,
    invoiceRecords: [...(s.invoiceRecords || []), referens] };
  referens.lockedVersion = kontrollversion(state, underlag);
  return { ok: true, state, referens };
}

export function kontrolleraDokument(s, id, uppgift, { nu = new Date().toISOString() } = {}) {
  const r = s.invoiceRecords.find(r => r.id === id);
  const fel = besked => ({ ok: false, besked });
  if (!r?.snapshot || !['prepared', 'draft'].includes(r.workflowStatus)) return fel('Underlaget behöver granskas innan en dokumentkoppling kan sparas.');
  if (kontrollversion(s, r.snapshot) !== r.lockedVersion) return fel('Underlaget har ändrats sedan det sparades. Gör en ny version och avstämning.');
  if (!['draft', 'registered'].includes(uppgift.kind)) return fel('Välj utkast eller registrerad faktura.');
  const reference = String(uppgift.reference || '').trim();
  const customerId = String(uppgift.customerId || '').trim();
  if (!reference || !customerId || uppgift.confirmed !== true) return fel('Bekräfta rätt bolag, kund-ID, dokumentreferens och samtliga rader mot Lundify.');
  if (!Number.isSafeInteger(uppgift.nettoOre) || uppgift.nettoOre !== r.nettoOre) return fel('Lundifys nettobelopp avviker från underlaget.');
  if (uppgift.kind === 'registered' && (!/^\d{4}-\d{2}-\d{2}$/.test(uppgift.invoiceDate || '') || !Number.isFinite(Date.parse(uppgift.invoiceDate)) || new Date(uppgift.invoiceDate).toISOString().slice(0, 10) !== uppgift.invoiceDate)) return fel('Ange fakturadatum från Lundify.');
  if (r.lundifyCustomerId && r.lundifyCustomerId !== customerId) return fel('Kundkopplingen får inte bytas på ett avstämt underlag. Kontrollera rättelsen i Lundify.');
  if (uppgift.kind === 'draft' && r.lundifyDraftId && r.lundifyDraftId !== reference) return fel('Underlaget har redan ett Lundify-utkast. Stäm av samma utkast.');
  if (s.invoiceRecords.some(x => x.id !== id && x.billingCompany === r.billingCompany
      && x.workflowStatus !== 'superseded' && (uppgift.kind === 'draft' ? x.lundifyDraftId === reference : x.invoiceNumber === reference))) {
    return fel('Dokumentet är redan kopplat till ett annat underlag i samma bolag.');
  }
  const sources = new Set(r.snapshot.rader.map(x => x.sourceType + ':' + x.sourceId));
  const earlierDrafts = s.invoiceRecords.filter(x => x.workflowStatus === 'superseded' && x.lundifyDraftId && x.snapshot?.rader.some(row => sources.has(row.sourceType + ':' + row.sourceId)));
  if (earlierDrafts.some(x => x.billingCompany !== r.billingCompany || x.clientId !== r.clientId || x.lundifyDraftId !== (uppgift.kind === 'draft' ? reference : r.lundifyDraftId))) return fel('Dessa poster har ett tidigare Lundify-utkast. Stäm av samma utkast innan en ny dokumentkoppling används.');
  const observation = { kind: uppgift.kind, reference, customerId, nettoOre: uppgift.nettoOre,
    checkedAt: nu, sourceVersion: r.lockedVersion, invoiceDate: uppgift.invoiceDate || null };
  if (r.workflowStatus === uppgift.kind && r.documentReference === reference && r.lundifyCustomerId === customerId) return { ok: true, state: s };
  return { ok: true, state: { ...s, invoiceRecords: s.invoiceRecords.map(x => x.id !== id ? x : {
    ...x, workflowStatus: uppgift.kind, documentReference: reference, lundifyCustomerId: customerId,
    ...(uppgift.kind === 'draft' ? { lundifyDraftId: reference } : { invoiceNumber: reference, invoiceDate: uppgift.invoiceDate }),
    checkedAt: nu, updatedAt: nu, observation, events: [...(x.events || []), { type: uppgift.kind, at: nu, observation }],
  }) } };
}

export function oppnaNyVersion(s, id, { nu = new Date().toISOString() } = {}) {
  const r = s.invoiceRecords.find(r => r.id === id);
  if (!r || !['prepared', 'draft'].includes(r.workflowStatus)) return { ok: false, besked: 'Registrerade eller äldre oavstämda underlag får inte öppnas som ofakturerade. Rättelsen måste först stämmas av mot Lundify.' };
  const gamlaPoster = s.poster.filter(p => p.invoiceRecordId === id);
  const gamlaLeveranser = (s.deliverables || []).filter(l => l.invoiceRecordId === id);
  const los = x => x.invoiceRecordId === id ? { ...x, invoiceRecordId: null, status: 'open' } : x;
  return { ok: true, antalPoster: gamlaPoster.length, antalLeveranser: gamlaLeveranser.length,
    state: { ...s, poster: s.poster.map(los), deliverables: (s.deliverables || []).map(los),
      invoiceRecords: s.invoiceRecords.map(x => x.id !== id ? x : { ...x, workflowStatus: 'superseded', needsReview: true,
        updatedAt: nu, sourceSnapshot: structuredClone({ poster: gamlaPoster, deliverables: gamlaLeveranser }),
        events: [...(x.events || []), { type: 'reopened', at: nu }],
      }) } };
}

// Registrerat dokument förblir låst. Detta är en begäran om avstämning,
// aldrig en kredit, ny faktura eller ändring av originalets ekonomiska uppgifter.
export function registreraRattelsebehov(s, id, reason, { nu = new Date().toISOString() } = {}) {
  const r = (s.invoiceRecords || []).find(x => x.id === id);
  if (r?.workflowStatus !== 'registered' || !r.invoiceNumber) return { ok: false, besked: 'Rättelsebehov kräver en avstämd registrerad faktura med fakturanummer.' };
  const text = String(reason || '').trim();
  if (!text) return { ok: false, besked: 'Beskriv vad som behöver stämmas av mot Lundify.' };
  if ((r.events || []).some(e => e.type === 'correctionRequested' && e.reason === text)) return { ok: true, state: s };
  const event = { type: 'correctionRequested', at: nu, reason: text, originalInvoiceNumber: r.invoiceNumber,
    originalRecordId: r.id, billingCompany: r.billingCompany, customerId: r.lundifyCustomerId || null };
  return { ok: true, state: { ...s, invoiceRecords: s.invoiceRecords.map(x => x.id === id
    ? { ...x, correctionPending: true, updatedAt: nu, events: [...(x.events || []), event] } : x) } };
}
