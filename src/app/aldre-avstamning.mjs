// Explicit avstämning av äldre låsta underlag. Ingen nätverks- eller lagringsåtkomst.
import {hamtaSparatUnderlag, kontrollversion, foretagFor, fakturarader} from './logik.mjs';
import {faktureringsprofil} from './faktureringsprofil.mjs';
import {fakturafacit} from './fakturaregister.mjs';
const fail = message => { throw new Error(message); };
// Kalenderdagen följer svensk tid, oberoende av webbläsarens tidszon.
const stockholmDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Europe/Stockholm', calendar:'gregory', numberingSystem:'latn',
  year:'numeric', month:'2-digit', day:'2-digit',
});
export const avstamningsdag = nu => {
  const parts=Object.fromEntries(stockholmDate.formatToParts(new Date(nu)).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const signature = s => JSON.stringify(s);
const requestKey = q => JSON.stringify([q.invoiceNumber,q.customerNumber,q.clientId,q.sourceId,q.correction,q.confirmed]);
export function granskaAldreAvstamning(s, id, q) {
  const r=s.invoiceRecords.find(x=>x.id===id);
  if (!r || r.workflowStatus || r.snapshot) fail('Endast äldre underlag utan snapshot kan stämmas av här.');
  if (q.confirmed!==true || q.clientId!==r.clientId || !String(q.customerNumber||'').trim()) fail('Bekräfta mottagaren, kundnumret och samtliga rader.');
  if (r.invoiceNumber && r.invoiceNumber!==q.invoiceNumber) fail('Underlaget har redan ett annat fakturanummer.');
  const candidates=(s.lundifyLedger?.records||[]).filter(x=>x.billingCompany===r.billingCompany && x.invoiceNumber===q.invoiceNumber);
  if(candidates.length!==1)fail('Välj en entydig befintlig faktura i rätt bolag.');
  const invoice=candidates[0];
  fakturafacit(s,invoice.invoiceDate.slice(0,7),r.billingCompany); // återanvänd registervalideringen
  if(invoice.kind!=='invoice' || invoice.status!=='registered' || invoice.customer.number!==q.customerNumber)fail('Fakturan eller kunden stämmer inte.');
  if(s.invoiceRecords.some(x=>x.id!==id && x.billingCompany===r.billingCompany && x.invoiceNumber===q.invoiceNumber && x.workflowStatus!=='superseded'))fail('Fakturan är redan kopplad till ett annat underlag.');
  if((invoice.underlagIds||[]).some(x=>x!==id) || (s.deliverables||[]).some(x=>x.ledgerReference?.billingCompany===r.billingCompany && x.ledgerReference?.invoiceNumber===q.invoiceNumber))fail('Fakturan har en annan koppling.');
  if((s.lundifyLedger?.records||[]).some(x=>x.billingCompany===r.billingCompany && x.kind==='invoice' && x.invoiceNumber!==invoice.invoiceNumber && x.underlagIds?.includes(id)))fail('Underlaget är redan kopplat till en annan faktura.');
  verifieraKundkoppling(s,r.billingCompany,r.clientId,q.customerNumber);
  const sources=s.poster.filter(x=>x.invoiceRecordId===id);
  if(!sources.length || sources.some(x=>x.status!=='included' || foretagFor(s,x.projectId)!==r.billingCompany || s.projects.find(p=>p.id===x.projectId)?.clientId!==r.clientId))fail('Källradernas låsning, kund eller bolag stämmer inte.');
  if((s.deliverables||[]).some(x=>x.invoiceRecordId===id))fail('Äldre underlag med delbetalningar behöver separat granskning.');
  const client=s.clients.find(x=>x.id===r.clientId);
  if(!client)fail('Underlagets kund saknas.');
  const reconstructed=hamtaSparatUnderlag(s,id);
  const snapshot={...reconstructed,clientSnapshot:structuredClone(client),billingProfiles:[...new Set(reconstructed.rader.map(x=>x.projectId))].map(projectId=>({projectId,projectName:s.projects.find(x=>x.id===projectId)?.name,...structuredClone(faktureringsprofil(s,projectId))}))};
  for(const [a,b] of [['nettoOre','netOre'],['momsOre','vatOre'],['attBetalaOre','totalOre']])if(r[a]!==invoice[b] || snapshot[a]!==r[a])fail('Rekonstruerade belopp, sparat underlag och faktura måste stämma exakt.');
  if(snapshot.avrundningOre!==invoice.roundingOre)fail('Avrundningen avviker.');
  const source=sources.find(x=>x.id===q.sourceId);
  if(!source || !String(q.correction||'').trim())fail('Välj rätt källrad och ange daterad rättelsetext.');
  return {id,request:structuredClone(q),requestKey:requestKey(q),base:signature(s),snapshot,invoice:structuredClone(invoice),source:structuredClone(source)};
}
export function sparaAldreAvstamning(s, review, {eTag,expectedETag,nu=new Date().toISOString()}={}) {
  if(!eTag || eTag!==expectedETag)fail('Lagringsversionen har ändrats eller saknas. Granska igen.');
  const old=s.invoiceRecords.find(x=>x.id===review.id);
  if(old?.legacyReconciliation){
    if(old.legacyReconciliation.requestKey===review.requestKey && old.invoiceNumber===review.request.invoiceNumber)return s;
    fail('En befintlig avstämning får inte skrivas över.');
  }
  if(signature(s)!==review.base)fail('Uppgifterna har ändrats sedan granskningen. Granska igen.');
  if(!Number.isFinite(Date.parse(nu)))fail('Ogiltig avstämningstid.');
  const checked=granskaAldreAvstamning(s,review.id,review.request);
  const q=checked.request, invoice=checked.invoice;
  const observation={type:'legacyReconciled',at:nu,invoiceNumber:invoice.invoiceNumber,invoiceDate:invoice.invoiceDate,customerNumber:invoice.customer.number,clientId:old.clientId,sourceId:q.sourceId,correction:q.correction,originalNote:checked.source.anteckning??null};
  const record={...old,workflowStatus:'registered',invoiceNumber:invoice.invoiceNumber,invoiceDate:invoice.invoiceDate,documentReference:invoice.invoiceNumber,checkedAt:nu,updatedAt:nu,klarmarkeradAt:old.klarmarkeradAt||avstamningsdag(nu),snapshot:{...checked.snapshot,reconstructed:true,reconstructedAt:nu},legacyReconciliation:{requestKey:review.requestKey,originalRecord:structuredClone(old),originalSource:checked.source},events:[...(old.events||[]),observation]};
  record.presentationRows=structuredClone(fakturarader(s,record.snapshot));
  record.lockedVersion=kontrollversion(s,record.snapshot);
  return {...s,invoiceRecords:s.invoiceRecords.map(x=>x.id===old.id?record:x),lundifyLedger:{...s.lundifyLedger,records:s.lundifyLedger.records.map(x=>x===s.lundifyLedger.records.find(y=>y.billingCompany===invoice.billingCompany&&y.invoiceNumber===invoice.invoiceNumber)?{...x,underlagIds:[old.id]}:x)}};
}

// Samma verifierade kundrelation gäller för enskild och gemensam avstämning.
export function verifieraKundkoppling(s,company,clientId,customerNumber) {
  const verifiedCustomers = [
    ...(s.deliverables||[]).map(x=>x.ledgerReference).filter(Boolean),
    ...s.invoiceRecords.flatMap(x=>(x.events||[]).filter(e=>e.type==='legacyReconciled').map(e=>({...e,billingCompany:x.billingCompany}))),
    ...(s.lundifyLedger?.records||[]).flatMap(x=>(x.underlagIds||[]).map(linkedId=>({billingCompany:x.billingCompany,clientId:s.invoiceRecords.find(u=>u.id===linkedId)?.clientId,customerNumber:x.customer.number}))),
  ];
  if(verifiedCustomers.some(x=>x.billingCompany===company && (
    (x.clientId===clientId && x.customerNumber!==customerNumber) ||
    (x.customerNumber===customerNumber && x.clientId!==clientId)
  )))fail('Kundnumret motsäger en tidigare verifierad koppling.');
}
