// Separat, additivt fakturafacit. Ändrar aldrig arbetsposter eller underlag.
import { FORETAG } from './arbetsflode.mjs';
const fail = text => { throw new Error(text); };
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const text = v => typeof v === 'string' && v.trim().length > 0;
const key = r => JSON.stringify([r.billingCompany, r.invoiceNumber]);
const canonical = v => JSON.stringify(v, function(k,value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])) : value; });
function validateRecord(r, s) {
  if (!r || !FORETAG.includes(r.billingCompany) || !text(r.invoiceNumber) || r.invoiceNumber !== r.invoiceNumber.trim() || /^0\d+$/.test(r.invoiceNumber)) fail('Kontrollera bolag och fakturanummer.');
  if (!r.customer || !text(r.customer.number) || !text(r.customer.name)) fail('Kundnummer och kundnamn krävs. Kundnummer är inte API-ID.');
  if (!date(r.invoiceDate) || r.status !== 'registered' || !['invoice','credit'].includes(r.kind)) fail('Kontrollera fakturadatum, status och dokumenttyp.');
  for (const f of ['netOre','vatOre','roundingOre','totalOre']) if (!Number.isSafeInteger(r[f])) fail('Alla belopp ska vara heltalsören.');
  if (r.netOre+r.vatOre+r.roundingOre !== r.totalOre || Math.abs(r.roundingOre)>100) fail('Netto, moms och avrundning stämmer inte med totalen.');
  if (r.kind === 'credit' ? !(text(r.creditOf) && r.creditOf !== r.invoiceNumber && r.netOre <= 0 && r.totalOre <= 0) : r.netOre < 0 || r.vatOre < 0 || r.totalOre < 0) fail('Kredit måste ha originalreferens och negativa belopp.');
  if (!r.workPeriod || !text(r.workPeriod.description)) fail('Beskriv arbetsperioden; ange okänd när den inte är verifierad.');
  if (['from','to'].some(k=>r.workPeriod[k] != null && !date(r.workPeriod[k])) || (r.workPeriod.from && r.workPeriod.to && r.workPeriod.from > r.workPeriod.to)) fail('Ogiltig arbetsperiod.');
  if (r.source?.system !== 'Lundify' || !text(r.source.listCheckedAt) || !Number.isFinite(Date.parse(r.source.listCheckedAt)) || !text(r.source.detailsBasis)) fail('Lundifykälla och kontrolltid krävs.');
  if (r.cashVerified !== false || !['paid','unpaid','partial','unknown'].includes(r.lundifyPaymentStatus)) fail('Betalstatus får inte intygas som bankinbetalning.');
  if (r.underlagIds != null && (!Array.isArray(r.underlagIds) || new Set(r.underlagIds).size !== r.underlagIds.length || r.underlagIds.some(id=>!s.invoiceRecords.some(u=>u.id===id && u.billingCompany===r.billingCompany)))) fail('Underlagsreferenserna måste finnas i samma bolag.');
}
function validateCoverage(c) {
  if (!c || !FORETAG.includes(c.billingCompany) || !date(c.from) || !date(c.to) || c.from > c.to || !Array.isArray(c.customerNumbers) || !c.customerNumbers.length || c.customerNumbers.some(n=>!text(n)) || new Set(c.customerNumbers).size!==c.customerNumbers.length || !text(c.limitations) || !text(c.checkedAt) || !Number.isFinite(Date.parse(c.checkedAt))) fail('Täckningen kräver bolag, fakturadatumperiod, kundnummer och begränsningar.');
}
export function importeraFakturaregister(s, batch) {
  if (batch?.version !== 1 || !Array.isArray(batch.records) || !batch.records.length || !Array.isArray(batch.coverage) || !batch.coverage.length) fail('Ogiltigt fakturaregister. Version 1, fakturor och täckning krävs.');
  const current=s.lundifyLedger ?? {version:1,records:[],coverage:[]};
  if (current.version!==1 || !Array.isArray(current.records) || !Array.isArray(current.coverage)) fail('Befintligt register har okänd struktur.');
  const records=structuredClone(current.records), coverage=structuredClone(current.coverage); const keys=new Map();
  for(const r of records){validateRecord(r,s);if(keys.has(key(r)))fail('Befintligt register har dubbla fakturor.');keys.set(key(r),r);}
  for(const c of batch.coverage)validateCoverage(c);
  let added=0;
  for(const r of batch.records){validateRecord(r,s);
    if(!batch.coverage.some(c=>c.billingCompany===r.billingCompany && c.customerNumbers.includes(r.customer.number) && c.from<=r.invoiceDate && c.to>=r.invoiceDate))fail('Fakturan ligger utanför angiven täckning.');
    const old=keys.get(key(r));if(old){if(canonical(old)!==canonical(r))fail('Samma fakturanummer har andra uppgifter. Ingen automatisk överskrivning.');continue;}
    if(r.kind==='invoice' && (r.underlagIds||[]).some(id=>records.some(x=>x.kind==='invoice' && x.billingCompany===r.billingCompany && x.underlagIds?.includes(id))))fail('Underlaget är redan kopplat till en annan faktura.');
    const copy=structuredClone(r);records.push(copy);keys.set(key(r),copy);added++;
  }
  for(const c of batch.coverage){if(!coverage.some(x=>canonical(x)===canonical(c)))coverage.push(structuredClone(c));}
  const changed=added>0 || coverage.length!==current.coverage.length;
  return {state:changed?{...s,lundifyLedger:{version:1,records,coverage}}:s,added,duplicates:batch.records.length-added};
}
export function fakturafacit(s, month, company='') {
  const ledger=s.lundifyLedger;
  if(!ledger)return {records:[],coverage:[],netOre:0,vatOre:0,totalOre:0,hasRegister:false};
  if(ledger.version!==1 || !Array.isArray(ledger.records) || !Array.isArray(ledger.coverage))fail('Fakturaregistret kan inte läsas.');
  const all=ledger.records.filter(r=>!company || r.billingCompany===company), seen=new Set();
  for(const r of all){validateRecord(r,s);if(seen.has(key(r)))fail('Dubbla fakturanummer: summering stoppad.');seen.add(key(r));}
  const records=all.filter(r=>r.status==='registered' && r.invoiceDate.startsWith(month));
  const coverage=ledger.coverage.filter(c=>!company||c.billingCompany===company);
  const registered=all.filter(r=>r.status==='registered');
  return {records,coverage,coveredMonth:coverage.some(c=>c.from.slice(0,7)<=month && c.to.slice(0,7)>=month),allNetOre:registered.reduce((n,r)=>n+r.netOre,0),allCount:registered.length,netOre:records.reduce((a,r)=>a+r.netOre,0),vatOre:records.reduce((a,r)=>a+r.vatOre,0),totalOre:records.reduce((a,r)=>a+r.totalOre,0),hasRegister:true};
}

/** Explicit matchning, aldrig namnmatchning eller en ny faktura. */
export function kopplaDelbetalning(s, id, invoiceNumber, customerNumber, {nu = new Date().toISOString()} = {}) {
  const l = s.deliverables?.find(x => x.id === id);
  const p = s.projects?.find(x => x.id === l?.projectId);
  const c = s.clients?.find(x => x.id === p?.clientId);
  if (!l || !p || !c || l.billingDisabled || l.invoiceRecordId) fail('Delen saknas, är spärrad eller ligger redan i ett underlag.');
  const matches = (s.lundifyLedger?.records || []).filter(r => r.billingCompany === p.billingCompany && r.invoiceNumber === invoiceNumber);
  if (matches.length !== 1) fail('En entydig registrerad faktura i rätt bolag krävs.');
  const r = matches[0]; validateRecord(r, s);
  if (r.kind !== 'invoice' || r.customer.number !== customerNumber || !text(customerNumber)) fail('Bekräfta rätt kundnummer i Lundify.');
  if (r.netOre !== l.amountOre || r.vatOre !== Math.round(l.amountOre * l.vatRate / 10000)) fail('Delens belopp och moms måste stämma med hela fakturan.');
  if ((r.underlagIds || []).length) fail('Fakturan är redan kopplad till ett underlag.');
  const refs = (s.deliverables || []).filter(x => x.ledgerReference?.billingCompany === r.billingCompany && x.ledgerReference?.invoiceNumber === r.invoiceNumber);
  if (refs.some(x => x.id !== id)) fail('Fakturan är redan kopplad till en annan del.');
  if (l.ledgerReference) {
    if (l.ledgerReference.billingCompany === r.billingCompany && l.ledgerReference.invoiceNumber === r.invoiceNumber && l.ledgerReference.clientId === c.id && l.ledgerReference.customerNumber === customerNumber) return s;
    fail('Befintlig fakturakoppling får inte skrivas över.');
  }
  if ((s.deliverables || []).some(x => x.ledgerReference?.billingCompany === r.billingCompany && x.ledgerReference?.clientId === c.id && x.ledgerReference.customerNumber !== customerNumber)) fail('Kundnumret motsäger en tidigare verifierad koppling.');
  return {...s, deliverables:s.deliverables.map(x => x.id === id ? {...x, status:'invoiced', ledgerReference:{billingCompany:r.billingCompany,invoiceNumber:r.invoiceNumber,invoiceDate:r.invoiceDate,customerNumber,clientId:c.id,netOre:r.netOre,vatOre:r.vatOre,verifiedAt:nu,previousStatus:x.status,previousCompletedAt:x.completedAt ?? null}} : x)};
}
