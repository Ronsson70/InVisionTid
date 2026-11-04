// Flera låsta underlag, en redan registrerad faktura. Endast rena tillståndsbyten.
import {hamtaSparatUnderlag,kontrollversion,foretagFor,fakturarader} from './logik.mjs';
import {faktureringsprofil} from './faktureringsprofil.mjs';
import {fakturafacit} from './fakturaregister.mjs';
import {avstamningsdag,verifieraKundkoppling} from './aldre-avstamning.mjs';
import {summera} from '../domain/moms.mjs';
const fail = message => {throw new Error(message);};
const signature = s => JSON.stringify(s);
const month = x => typeof x==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const date = x => typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10)===x;
const sum = xs => xs.reduce((n,x)=>{if(!Number.isSafeInteger(x)||!Number.isSafeInteger(n+x))fail('Beloppen måste vara säkra heltalsören.');return n+x;},0);
const requestKey = (ids,q) => JSON.stringify([ids,q.billingCompany,q.clientId,q.period,q.invoiceNumber,q.customerNumber,q.note,q.confirmed]);

export function granskaGruppavstamning(s,ids,q) {
  if(!Array.isArray(ids)||ids.length<2||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)fail('Välj minst två olika underlag.');
  ids=[...ids].sort();
  if(q.confirmed!==true||!month(q.period)||!String(q.note||'').trim())fail('Bekräfta kund, arbetsmånad, samtliga rader och ange en avstämningsanteckning.');
  fakturafacit(s,'',q.billingCompany);
  const matches=(s.lundifyLedger?.records||[]).filter(x=>x.billingCompany===q.billingCompany&&x.invoiceNumber===q.invoiceNumber);
  if(matches.length!==1)fail('Välj en entydig befintlig faktura i rätt bolag.');
  const invoice=matches[0];
  if(invoice.kind!=='invoice'||invoice.status!=='registered'||invoice.customer.number!==q.customerNumber)fail('Fakturan eller kundnumret stämmer inte.');
  if(invoice.groupReconciliation)fail('Fakturan har redan en sparad gruppavstämning. Den får inte skrivas över.');
  verifieraKundkoppling(s,q.billingCompany,q.clientId,q.customerNumber);
  if((invoice.underlagIds||[]).some(id=>!ids.includes(id))||s.invoiceRecords.some(r=>!ids.includes(r.id)&&r.billingCompany===q.billingCompany&&r.invoiceNumber===q.invoiceNumber&&r.workflowStatus!=='superseded'))fail('Alla redan kopplade underlag måste ingå.');
  if((s.deliverables||[]).some(x=>x.ledgerReference?.billingCompany===q.billingCompany&&x.ledgerReference.invoiceNumber===q.invoiceNumber))fail('Fakturan är redan kopplad till en separat delbetalning.');
  if(s.lundifyLedger.records.some(x=>x.kind==='invoice'&&x.billingCompany===q.billingCompany&&x.invoiceNumber!==q.invoiceNumber&&x.underlagIds?.some(id=>ids.includes(id))))fail('Ett underlag är redan kopplat till en annan faktura.');
  const client=s.clients.find(x=>x.id===q.clientId);
  if(!client)fail('Kunden saknas.');
  const seen=new Set();
  const members=ids.map(id=>{
    const matches=s.invoiceRecords.filter(r=>r.id===id);
    if(matches.length!==1)fail('Underlags-ID saknas eller är dubblerat.');
    const r=matches[0];
    if(r.billingCompany!==q.billingCompany||r.clientId!==q.clientId||r.period!==q.period)fail('Alla underlag måste ha samma bolag, kund och arbetsmånad.');
    if(r.groupReconciliation||r.workflowStatus&&!['prepared','registered'].includes(r.workflowStatus)||!r.workflowStatus&&r.snapshot)fail('Underlagets status stöds inte för gruppavstämning.');
    if(r.invoiceNumber&&r.invoiceNumber!==q.invoiceNumber||r.workflowStatus==='registered'&&r.invoiceNumber!==q.invoiceNumber||r.invoiceDate&&r.invoiceDate!==invoice.invoiceDate||r.lundifyDraftId&&r.workflowStatus!=='registered')fail('Underlaget har en annan dokumentkoppling som måste stämmas av separat.');
    if((s.deliverables||[]).some(x=>x.invoiceRecordId===id))fail('Underlag med delbetalningar behöver separat granskning.');
    const sources=s.poster.filter(x=>x.invoiceRecordId===id);
    if(!sources.length||sources.some(x=>x.status!=='included'||foretagFor(s,x.projectId)!==q.billingCompany||s.projects.find(p=>p.id===x.projectId)?.clientId!==q.clientId))fail('Källradernas låsning, kund eller bolag stämmer inte.');
    for(const x of sources){
      if(!date(x.date)||x.date.slice(0,7)!==q.period)fail('Källraderna måste ligga i den bekräftade arbetsmånaden.');
      if(invoice.workPeriod.from&&x.date<invoice.workPeriod.from||invoice.workPeriod.to&&x.date>invoice.workPeriod.to)fail('Källraderna ligger utanför fakturans verifierade arbetsperiod.');
      if(seen.has(x.id)||s.poster.filter(p=>p.id===x.id).length!==1)fail('En källrad får bara räknas en gång.');
      seen.add(x.id);
    }
    let snapshot=hamtaSparatUnderlag(s,id);
    if(r.snapshot){
      if(!r.lockedVersion||kontrollversion(s,snapshot)!==r.lockedVersion||!snapshot.clientSnapshot||!r.presentationRows)fail('Den frysta versionen eller dess källor behöver granskas separat.');
    }else{
      snapshot={...snapshot,clientSnapshot:structuredClone(client),billingProfiles:[...new Set(snapshot.rader.map(x=>x.projectId))].map(projectId=>({projectId,projectName:s.projects.find(x=>x.id===projectId)?.name,...structuredClone(faktureringsprofil(s,projectId))}))};
    }
    if(snapshot.clientId!==q.clientId||snapshot.billingCompany!==q.billingCompany||snapshot.period!==q.period||snapshot.rader.length!==sources.length||new Set(snapshot.rader.map(x=>x.sourceId)).size!==sources.length||snapshot.rader.some(x=>!sources.some(p=>p.id===x.sourceId&&(p.sourceType||'entry')===x.sourceType&&p.projectId===x.projectId)))fail('Snapshoten måste innehålla exakt underlagets källrader.');
    // Samma skydd som kontrolleraDokument: följ källraderna även genom ersatta versioner.
    const sourceKeys=new Set(snapshot.rader.map(row=>row.sourceType+':'+row.sourceId));
    const earlierDrafts=s.invoiceRecords.filter(old=>old.workflowStatus==='superseded'&&old.lundifyDraftId&&old.snapshot?.rader.some(row=>sourceKeys.has(row.sourceType+':'+row.sourceId)));
    if(earlierDrafts.some(old=>old.billingCompany!==r.billingCompany||old.clientId!==r.clientId||old.lundifyDraftId!==r.lundifyDraftId))fail('Dessa poster har ett tidigare Lundify-utkast. Stäm av samma utkast innan en ny dokumentkoppling används.');
    const totals=summera(snapshot.rader);
    for(const f of ['nettoOre','momsOre','attBetalaOre'])if(!Number.isSafeInteger(r[f])||r[f]!==snapshot[f]||snapshot[f]!==totals[f])fail('Sparade belopp och källrader måste stämma exakt.');
    if(snapshot.avrundningOre!==totals.avrundningOre)fail('Underlagets avrundning stämmer inte.');
    return {id,snapshot,presentationRows:structuredClone(r.presentationRows||fakturarader(s,snapshot))};
  });
  const totals={netOre:sum(members.map(x=>x.snapshot.nettoOre)),vatOre:sum(members.map(x=>x.snapshot.momsOre)),roundingOre:sum(members.map(x=>x.snapshot.avrundningOre)),totalOre:sum(members.map(x=>x.snapshot.attBetalaOre))};
  if(totals.netOre!==invoice.netOre||totals.vatOre!==invoice.vatOre)fail('Underlagens sammanlagda netto och moms måste stämma exakt med fakturan.');
  const roundingDifferenceOre=sum([invoice.roundingOre,-totals.roundingOre]);
  if(sum([totals.totalOre,roundingDifferenceOre])!==invoice.totalOre)fail('Skillnaden kan inte förklaras enbart av öresavrundning.');
  return {ids,request:structuredClone(q),requestKey:requestKey(ids,q),base:signature(s),invoice:structuredClone(invoice),members,totals,roundingDifferenceOre};
}

export function sparaGruppavstamning(s,review,{eTag,expectedETag,confirmedRoundingOre,nu=new Date().toISOString()}={}) {
  if(!eTag||eTag!==expectedETag)fail('Lagringsversionen har ändrats eller saknas. Granska igen.');
  if(!review||review.requestKey!==requestKey(review.ids,review.request))fail('Granskningsuppgifterna har ändrats. Granska igen.');
  const invoice=s.lundifyLedger?.records.find(x=>x.billingCompany===review.request.billingCompany&&x.invoiceNumber===review.request.invoiceNumber);
  if(invoice?.groupReconciliation){
    const g=invoice.groupReconciliation;
    if(g.requestKey===review.requestKey&&g.roundingDifferenceOre===confirmedRoundingOre&&JSON.stringify(invoice.underlagIds)===JSON.stringify(review.ids)&&review.ids.every(id=>s.invoiceRecords.find(r=>r.id===id)?.groupReconciliation?.requestKey===g.requestKey))return s;
    fail('En sparad gruppavstämning får inte skrivas över.');
  }
  if(signature(s)!==review.base)fail('Uppgifterna har ändrats sedan granskningen. Granska igen.');
  if(!Number.isFinite(Date.parse(nu)))fail('Ogiltig avstämningstid.');
  const checked=granskaGruppavstamning(s,review.ids,review.request);
  if(!Number.isSafeInteger(confirmedRoundingOre)||confirmedRoundingOre!==checked.roundingDifferenceOre)fail('Bekräfta den exakta avrundningsskillnaden innan du sparar.');
  const q=checked.request;
  const group={version:1,requestKey:checked.requestKey,underlagIds:checked.ids,clientId:q.clientId,period:q.period,checkedAt:nu,note:q.note,underlagTotals:checked.totals,roundingDifferenceOre:checked.roundingDifferenceOre};
  const members=new Map(checked.members.map(x=>[x.id,x]));
  return {...s,invoiceRecords:s.invoiceRecords.map(old=>{
    const member=members.get(old.id);if(!member)return old;
    const snapshot=old.snapshot?structuredClone(old.snapshot):{...member.snapshot,reconstructed:true,reconstructedAt:nu};
    const record={...old,workflowStatus:'registered',invoiceNumber:invoice.invoiceNumber,invoiceDate:invoice.invoiceDate,documentReference:invoice.invoiceNumber,
      checkedAt:old.checkedAt||nu,klarmarkeradAt:old.klarmarkeradAt||avstamningsdag(nu),updatedAt:nu,snapshot,presentationRows:member.presentationRows,
      groupReconciliation:{...structuredClone(group),billingCompany:q.billingCompany,invoiceNumber:invoice.invoiceNumber,originalRecord:structuredClone(old)},
      events:[...(old.events||[]),{type:'invoiceGroupReconciled',at:nu,invoiceNumber:invoice.invoiceNumber,invoiceDate:invoice.invoiceDate,underlagIds:checked.ids,customerNumber:q.customerNumber,clientId:q.clientId,note:q.note,roundingDifferenceOre:checked.roundingDifferenceOre}]};
    record.lockedVersion=old.lockedVersion||kontrollversion(s,snapshot);
    return record;
  }),lundifyLedger:{...s.lundifyLedger,records:s.lundifyLedger.records.map(x=>x===invoice?{...x,underlagIds:checked.ids,groupReconciliation:group}:x)}};
}
