import test from 'node:test';
import assert from 'node:assert/strict';
import {granskaGruppavstamning as review,sparaGruppavstamning as save} from '../src/app/gruppavstamning.mjs';
import {granskaAldreAvstamning} from '../src/app/aldre-avstamning.mjs';
import {fakturafacit,kopplaDelbetalning} from '../src/app/fakturaregister.mjs';
import * as L from '../src/app/logik.mjs';
import {tillAppTillstand,franAppTillstand} from '../src/app/tillstand.mjs';
import {fixture,request,options,ids,company} from './lib/grupp-fixture.mjs';
const apply=s=>save(s,review(s,ids,request()),options);

test('tre underlag, en faktura och exakt -1 krona utan att ändra ekonomin eller källorna',()=>{
 const s=fixture(),before=structuredClone(s),v=review(s,ids,request());
 assert.deepEqual(v.totals,{netOre:2757500,vatOre:689375,roundingOre:125,totalOre:3447000});assert.equal(v.roundingDifferenceOre,-100);
 assert.deepEqual(s,before);const out=save(s,v,options);assert.deepEqual(s,before);
 assert.deepEqual(out.poster,s.poster);assert.deepEqual(out.articles,s.articles);assert.deepEqual(out.projects,s.projects);assert.deepEqual(out.deliverables,s.deliverables);assert.deepEqual(out.installningar,s.installningar);
 const ledger=out.lundifyLedger.records[0];const {underlagIds,groupReconciliation,...rest}=ledger;assert.deepEqual(rest,s.lundifyLedger.records[0]);assert.deepEqual(underlagIds,ids);
 for(let i=0;i<3;i++){
  const r=out.invoiceRecords[i],old=s.invoiceRecords[i];
  for(const f of ['id','period','nettoOre','momsOre','attBetalaOre','createdAt'])assert.equal(r[f],old[f]);
  assert.equal(r.workflowStatus,'registered');assert.equal(r.invoiceDate,'2026-11-01');assert.equal(r.klarmarkeradAt,'2026-11-04');assert.deepEqual(r.groupReconciliation.originalRecord,old);
  assert.equal(r.events.length,1);assert.equal(r.events[0].type,'invoiceGroupReconciled');
 }
 const facit=fakturafacit(out,'2026-11',company);assert.equal(facit.allCount,1);assert.equal(facit.netOre,2757500);assert.equal(facit.vatOre,689375);assert.equal(facit.totalOre,3446900);assert.equal(fakturafacit(out,'2026-10',company).netOre,0);
});

test('tidigare avstämningsdatum, fryst version och historik bevaras',()=>{
 const s=fixture(),r=s.invoiceRecords[0];
 r.snapshot={...L.hamtaSparatUnderlag(s,r.id),clientSnapshot:structuredClone(s.clients[0])};r.presentationRows=L.fakturarader(s,r.snapshot);
 Object.assign(r,{workflowStatus:'registered',invoiceNumber:'900',invoiceDate:'2026-11-01',checkedAt:'2026-11-02T10:00:00Z',klarmarkeradAt:'2026-11-02',events:[{type:'registered',at:'2026-11-02T10:00:00Z'}]});r.lockedVersion=L.kontrollversion(s,r.snapshot);
 s.lundifyLedger.records[0].underlagIds=['u1'];
 const before=structuredClone(r),out=apply(s),updated=out.invoiceRecords[0];
 for(const f of ['checkedAt','klarmarkeradAt','snapshot','presentationRows','lockedVersion'])assert.deepEqual(updated[f],before[f]);
 assert.deepEqual(updated.events[0],before.events[0]);assert.equal(updated.groupReconciliation.checkedAt,options.nu);
});

test('legacydatum och anteckningar överlever utan tidigare snapshot',()=>{
 const s=fixture();Object.assign(s.invoiceRecords[0],{invoiceNumber:'900',checkedAt:'2026-11-01T12:00:00Z',klarmarkeradAt:'2026-11-01',events:[{type:'old',at:'2026-10-31'}]});
 const out=apply(s);assert.equal(out.invoiceRecords[0].checkedAt,s.invoiceRecords[0].checkedAt);assert.equal(out.invoiceRecords[0].klarmarkeradAt,'2026-11-01');assert.deepEqual(out.invoiceRecords[0].events[0],s.invoiceRecords[0].events[0]);
});

test('frysta kunduppgifter, presentation och gruppförklaring överlever filrundtur',()=>{
 const out=apply(fixture()),r=out.invoiceRecords[0],text=L.lundifyText(out,r.snapshot);
 assert.match(text,/Delunderlag i faktura 900/);assert.match(text,/hela gruppen: −1 kr/);assert.match(text,/skapa inte en ny/);
 out.clients[0].name='Ändrat namn';out.poster[0].anteckning='Ändrat senare';out.projects[0].name='Ändrat uppdrag';
 const raw=franAppTillstand(out),restored=tillAppTillstand(raw).tillstand;
 assert.deepEqual(franAppTillstand(restored),raw);assert.equal(L.lundifyText(restored,L.hamtaSparatUnderlag(restored,'u1')),text);
 assert.equal(fakturafacit(restored,'2026-11',company).totalOre,3446900);
});

test('återförsök är idempotent och en sparad grupp kan inte bytas ut',()=>{
 const s=fixture(),v=review(s,ids,request()),out=save(s,v,options);
 assert.equal(save(out,v,{...options,nu:'2026-12-01T00:00:00Z'}),out);
 assert.equal(save(tillAppTillstand(franAppTillstand(out)).tillstand,v,options).invoiceRecords[0].events.length,1);
 assert.throws(()=>review(out,ids,request()),/redan en sparad/);
 assert.throws(()=>save(out,{...v,request:{...v.request,note:'ändrad'}},options),/ändrats/);
 assert.throws(()=>save(out,v,{...options,confirmedRoundingOre:0}),/skrivas över/);
});

test('minst två unika och entydiga underlag krävs',()=>{
 for(const selection of [[],['u1'],['u1','u1'],['u1','missing']])assert.throws(()=>review(fixture(),selection,request()));
 const s=fixture();s.invoiceRecords.push({...s.invoiceRecords[0]});assert.throws(()=>review(s,ids,request()),/dubblerat/);
 assert.deepEqual(review(fixture(),[...ids].reverse(),request()).ids,ids);
});

test('fel kund, bolag, månad och obekräftad granskning blockeras utan mutation',()=>{
 for(const patch of [{clientId:'other'},{billingCompany:L.FORETAG[1]},{period:'2026-09'},{period:'2026-13'},{customerNumber:'11'},{confirmed:false},{note:''},{invoiceNumber:'901'}]){
  const s=fixture(),before=structuredClone(s);assert.throws(()=>review(s,ids,{...request(),...patch}));assert.deepEqual(s,before);
 }
 for(const patch of [{clientId:'other'},{billingCompany:L.FORETAG[1]},{period:'2026-09'},{workflowStatus:'superseded'},{workflowStatus:'draft'},{invoiceNumber:'901'},{invoiceDate:'2026-10-31'},{lundifyDraftId:'draft-1'}]){
  const s=fixture();Object.assign(s.invoiceRecords[1],patch);assert.throws(()=>review(s,ids,request()));
 }
});

test('källradernas period, låsning och bolag samt dubbletter valideras',()=>{
 for(const patch of [{date:'2026-09-30'},{date:'2026-10-32'},{status:'open'},{invoiceRecordId:'missing'},{projectId:'missing'}]){const s=fixture();Object.assign(s.poster[1],patch);assert.throws(()=>review(s,ids,request()));}
 let s=fixture();s.poster.push({...s.poster[0]});assert.throws(()=>review(s,ids,request()),/en gång/);
 s=fixture();s.poster[1].id=s.poster[0].id;assert.throws(()=>review(s,ids,request()),/en gång/);
 s=fixture();s.projects[0].billingCompany=L.FORETAG[1];assert.throws(()=>review(s,ids,request()));
 s=fixture();s.lundifyLedger.records[0].workPeriod.to='2026-10-02';assert.throws(()=>review(s,ids,request()),/arbetsperiod/);
});

test('kända kundmappningar kontrolleras åt båda hållen och inom bolaget',()=>{
 for(const origin of ['delivery','event','ledger'])for(const pair of [{clientId:'c',customerNumber:'11'},{clientId:'other',customerNumber:'10'}])for(const billingCompany of L.FORETAG){
  const s=fixture();s.clients.push({id:'other',name:'Annan testkund'});
  if(origin==='delivery')s.deliverables.push({id:'d',ledgerReference:{billingCompany,invoiceNumber:'899',...pair}});
  else{s.invoiceRecords.push({id:'other',billingCompany,clientId:pair.clientId,events:origin==='event'?[{type:'legacyReconciled',...pair}]:[]});if(origin==='ledger')s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),billingCompany,invoiceNumber:'899',customer:{number:pair.customerNumber,name:'Test'},underlagIds:['other']});}
  if(billingCompany===company)assert.throws(()=>review(s,ids,request()),/Kundnumret/);else assert.doesNotThrow(()=>review(s,ids,request()));
 }
});

test('andra fakturakopplingar och ofullständiga grupper stoppas',()=>{
 let s=fixture();s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),invoiceNumber:'899',underlagIds:['u2']});assert.throws(()=>review(s,ids,request()),/annan faktura/);
 s=fixture();s.invoiceRecords.push({...s.invoiceRecords[0],id:'other',invoiceNumber:'900'});assert.throws(()=>review(s,ids,request()),/Alla redan/);
 s=fixture();s.invoiceRecords.push({...s.invoiceRecords[0],id:'other'});s.lundifyLedger.records[0].underlagIds=['other'];assert.throws(()=>review(s,ids,request()),/Alla redan/);
 s=fixture();s.deliverables.push({id:'d',ledgerReference:{billingCompany:company,invoiceNumber:'900'}});assert.throws(()=>review(s,ids,request()),/delbetalning/);
 s=fixture();s.deliverables.push({id:'d',invoiceRecordId:'u1'});assert.throws(()=>review(s,ids,request()),/delbetalningar/);
});

test('netto- och momsavvikelser maskeras aldrig som avrundning',()=>{
 for(const patch of [{netOre:2757501,totalOre:3446901},{vatOre:689376,totalOre:3446901},{roundingOre:126,totalOre:3447001},{status:'draft'},{kind:'credit'},{totalOre:3446901}]){const s=fixture();Object.assign(s.lundifyLedger.records[0],patch);assert.throws(()=>review(s,ids,request()));}
 for(const field of ['nettoOre','momsOre','attBetalaOre']){const s=fixture();s.invoiceRecords[0][field]++;assert.throws(()=>review(s,ids,request()),/belopp/);}
 const s=fixture();s.poster[0].qtyMilli++;assert.throws(()=>review(s,ids,request()));
});

test('avrundningsskillnaden måste bekräftas exakt, även när den är noll',()=>{
 const s=fixture(),v=review(s,ids,request());
 for(const value of [undefined,0,100,-99,'-100',NaN])assert.throws(()=>save(s,v,{...options,confirmedRoundingOre:value}),/avrundningsskillnaden/);
 const zero=fixture([1000000,1000000,757500]);const z=review(zero,ids,request());assert.equal(z.roundingDifferenceOre,0);assert.doesNotThrow(()=>save(zero,z,{...options,confirmedRoundingOre:0}));
});

test('positiv avrundningsskillnad och säker heltalsaritmetik',()=>{
 const s=fixture([1000100,1000100,757300]),v=review(s,ids,request());assert.equal(v.roundingDifferenceOre,100);assert.doesNotThrow(()=>save(s,v,{...options,confirmedRoundingOre:100}));
 const bad=fixture();bad.lundifyLedger.records[0].netOre=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>review(bad,ids,request()));
});

test('ändrade data eller eTag kräver ny granskning, ingen delvis mutation',()=>{
 for(const change of [s=>s.poster[0].anteckning+=' ändrad',s=>s.lundifyLedger.records[0].source.detailsBasis+=' ändrad',s=>s.clients[0].name='Annat namn',s=>s.invoiceRecords[0].checkedAt='2026-11-03T10:00:00Z']){
  const s=fixture(),v=review(s,ids,request());change(s);const before=structuredClone(s);assert.throws(()=>save(s,v,options),/ändrats/);assert.deepEqual(s,before);
 }
 const s=fixture(),v=review(s,ids,request()),before=structuredClone(s);
 for(const eTag of [null,'v2'])assert.throws(()=>save(s,v,{...options,eTag}),/version/);
 assert.throws(()=>save(s,v,{...options,nu:'fel'}),/tid/);assert.deepEqual(s,before);
 const forged={...v,totals:{netOre:0},members:[],roundingDifferenceOre:0};assert.equal(save(s,forged,options).invoiceRecords.length,3);
});

test('frysta källor som ändrats får inte återgodkännas',()=>{
 const s=fixture(),r=s.invoiceRecords[0];r.snapshot={...L.hamtaSparatUnderlag(s,'u1'),clientSnapshot:structuredClone(s.clients[0])};r.presentationRows=L.fakturarader(s,r.snapshot);r.workflowStatus='prepared';r.lockedVersion=L.kontrollversion(s,r.snapshot);
 assert.doesNotThrow(()=>review(s,ids,request()));s.poster[0].anteckning='ändrad';assert.throws(()=>review(s,ids,request()),/frysta/);
});

test('enskild avstämning och separat delbetalning kan inte återanvända gruppfakturan',()=>{
 const s=apply(fixture());assert.throws(()=>granskaAldreAvstamning(s,'u1',{invoiceNumber:'900',clientId:'c',customerNumber:'10',sourceId:'row0',correction:'test',confirmed:true}));
 s.deliverables.push({id:'d',projectId:'p',amountOre:2757500,vatRate:2500});assert.throws(()=>kopplaDelbetalning(s,'d','900','10'),/redan kopplad/);
});

test('två underlag stöds och samma fakturanummer i annat bolag påverkas inte',()=>{
 const s=fixture([1000200,1757300]);
 s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),billingCompany:L.FORETAG[1]});
 const other=structuredClone(s.lundifyLedger.records[1]);const v=review(s,['u2','u1'],request());
 assert.equal(v.roundingDifferenceOre,0);
 const out=save(s,v,{...options,confirmedRoundingOre:v.roundingDifferenceOre});
 assert.deepEqual(out.lundifyLedger.records[1],other);assert.equal(out.invoiceRecords.length,2);
 assert.equal(fakturafacit(out,'2026-11',company).allCount,1);
});

test('flera momssatser bevaras och momsskillnader mellan underlag och faktura stoppas',()=>{
 const s=fixture();s.articles[2].vatRate=1200;s.poster[2].priceSnapshot.vatRate=1200;
 const u=L.hamtaSparatUnderlag(s,'u3');Object.assign(s.invoiceRecords[2],{nettoOre:u.nettoOre,momsOre:u.momsOre,attBetalaOre:u.attBetalaOre});
 const invoice=s.lundifyLedger.records[0];invoice.vatOre=590952;invoice.roundingOre=48;invoice.totalOre=3348500;
 const v=review(s,ids,request()),out=save(s,v,{...options,confirmedRoundingOre:v.roundingDifferenceOre});
 assert.deepEqual(out.invoiceRecords[2].snapshot.momsUnderlag,{'1200':757100});assert.equal(out.invoiceRecords[2].snapshot.momsOre,90852);
 const bad=fixture([1000002,1000002,757496]);assert.throws(()=>review(bad,ids,request()),/netto och moms/);
});

test('tidigare ersatt versions utkast stoppar gruppen för samma källrader',()=>{
 for(const memberId of ['u1','u3'])for(const currentDraft of [null,'draft-other','draft-42'])for(const mismatch of ['none','company','client']){
  const s=fixture(),r=s.invoiceRecords.find(x=>x.id===memberId);
  const earlier={...structuredClone(r),id:'previous',workflowStatus:'superseded',lundifyDraftId:'draft-42',snapshot:L.hamtaSparatUnderlag(s,memberId)};
  if(mismatch==='company')earlier.billingCompany=L.FORETAG[1];
  if(mismatch==='client')earlier.clientId='other';
  s.invoiceRecords.push(earlier);
  if(currentDraft)Object.assign(r,{workflowStatus:'registered',invoiceNumber:'900',lundifyDraftId:currentDraft});
  const before=structuredClone(s);
  if(currentDraft==='draft-42'&&mismatch==='none'){
   const out=apply(s);assert.equal(out.invoiceRecords.find(x=>x.id===memberId).lundifyDraftId,'draft-42');
   assert.deepEqual(out.invoiceRecords.find(x=>x.id==='previous'),earlier);
  }else assert.throws(()=>review(s,ids,request()),/tidigare Lundify-utkast/);
  assert.deepEqual(s,before);
 }
});

test('tidigare utkast utan överlappande källtyp och ID blockerar inte gruppen',()=>{
 for(const row of [{sourceType:'entry',sourceId:'unrelated'},{sourceType:'trip',sourceId:'row0'}]){
  const s=fixture();s.invoiceRecords.push({id:'previous',workflowStatus:'superseded',billingCompany:company,clientId:'c',lundifyDraftId:'draft-42',snapshot:{rader:[row]}});
  assert.doesNotThrow(()=>review(s,ids,request()));
 }
});

test('nyupptäckt tidigare utkast efter granskning stoppar sparande utan mutation',()=>{
 const s=fixture(),v=review(s,ids,request());
 s.invoiceRecords.push({...structuredClone(s.invoiceRecords[0]),id:'previous',workflowStatus:'superseded',lundifyDraftId:'draft-42',snapshot:L.hamtaSparatUnderlag(s,'u1')});
 const before=structuredClone(s);assert.throws(()=>save(s,v,options),/ändrats/);assert.deepEqual(s,before);
 assert.throws(()=>review(s,ids,request()),/tidigare Lundify-utkast/);
});
