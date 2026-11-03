import test from 'node:test';import assert from 'node:assert/strict';
import {granskaAldreAvstamning as review,sparaAldreAvstamning as save} from '../src/app/aldre-avstamning.mjs';
import * as L from '../src/app/logik.mjs';
import {tillAppTillstand,franAppTillstand} from '../src/app/tillstand.mjs';
const company=L.FORETAG[0];
function fixture(){
 const s={clients:[{id:'c',name:'Testkund'}],projects:[{id:'p',clientId:'c',kind:'billable',name:'Testarbete',billingCompany:company}],articles:[{id:'a',projectId:'p',type:'hourly',unit:'tim',unitPriceOre:10000,vatRate:2500,vatStatus:'reviewed',billable:true,name:'Arbete'}],poster:[{id:'row',projectId:'p',articleId:'a',sourceType:'entry',date:'2026-10-01',beskrivning:'Arbete',description:'Arbete',seconds:3600,qtyMilli:1000,status:'included',invoiceRecordId:'old',priceSnapshot:{unitPriceOre:10000,vatRate:2500,unit:'tim',articleName:'Arbete'},anteckning:'Tidigare utkast 42, ännu oskickat.'}],deliverables:[],invoiceRecords:[{id:'old',clientId:'c',billingCompany:company,period:'2026-10',nettoOre:10000,momsOre:2500,attBetalaOre:12500,invoiceNumber:null,klarmarkeradAt:null,legacyStatus:'prepared'}],reviewQueue:[],migrationLog:[],installningar:{veckomalOre:123,manadsmalOre:null}};
 s.lundifyLedger={version:1,coverage:[],records:[{billingCompany:company,invoiceNumber:'900',customer:{number:'10',name:'Testkund'},invoiceDate:'2026-10-31',netOre:10000,vatOre:2500,roundingOre:0,totalOre:12500,status:'registered',kind:'invoice',workPeriod:{description:'Oktober'},cashVerified:false,lundifyPaymentStatus:'unpaid',source:{system:'Lundify',listCheckedAt:'2026-11-03T12:00:00Z',detailsBasis:'Syntetisk avstämning'}}]};return s;
}
const q=()=>({invoiceNumber:'900',customerNumber:'10',clientId:'c',sourceId:'row',correction:'Avstämt mot registrerad faktura 900. Tidigare utkast 42 är historik.',confirmed:true});
const opts={eTag:'v1',expectedETag:'v1',nu:'2026-11-03T15:00:00Z'};
test('ren granskning, fryst rekonstruerad snapshot och oförändrade låsta källor',()=>{
 const s=fixture(),before=structuredClone(s),v=review(s,'old',q());assert.deepEqual(s,before);const out=save(s,v,opts);assert.deepEqual(s,before);assert.deepEqual(out.poster,s.poster);assert.deepEqual(out.deliverables,s.deliverables);assert.deepEqual(out.installningar,s.installningar);
 const r=out.invoiceRecords[0];assert.equal(r.id,'old');assert.equal(r.invoiceDate,'2026-10-31');assert.equal(r.klarmarkeradAt,'2026-11-03');assert.equal(r.checkedAt,opts.nu);assert.equal(r.workflowStatus,'registered');assert.equal(r.snapshot.reconstructed,true);assert.deepEqual(r.legacyReconciliation.originalRecord,s.invoiceRecords[0]);assert.equal(r.events[0].originalNote,s.poster[0].anteckning);assert.deepEqual(out.lundifyLedger.records[0],{...s.lundifyLedger.records[0],underlagIds:['old']});assert.equal(save(out,v,opts),out);
 assert.match(L.lundifyText(out,r.snapshot),/skapa inte en ny/);
 const raw=franAppTillstand(out);assert.deepEqual(franAppTillstand(tillAppTillstand(raw).tillstand),raw);
});
test('fel faktura, kund, bolag, belopp, moms, avrundning och låsning avvisas',()=>{
 for(const patch of [{invoiceNumber:'901'},{customerNumber:'11'},{clientId:'other'},{sourceId:'other'},{confirmed:false},{correction:''}])assert.throws(()=>review(fixture(),'old',{...q(),...patch}));
 for(const change of [s=>s.projects[0].billingCompany=L.FORETAG[1],s=>s.invoiceRecords[0].nettoOre++,s=>s.poster[0].qtyMilli=2000,s=>s.poster[0].status='open',s=>s.lundifyLedger.records[0].vatOre++,s=>s.lundifyLedger.records[0].roundingOre++,s=>s.lundifyLedger.records[0].status='draft']){const s=fixture();change(s);assert.throws(()=>review(s,'old',q()));}
});
test('dubbletter, kopplingar och versionskonflikter avvisas utan mutation',()=>{
 let s=fixture();s.invoiceRecords.push({...s.invoiceRecords[0],id:'other',invoiceNumber:'900'});assert.throws(()=>review(s,'old',q()));
 s=fixture();const v=review(s,'old',q());assert.throws(()=>save(s,v,{...opts,eTag:'v2'}),/version/);assert.throws(()=>save(s,v,{...opts,eTag:null}),/version/);s.poster[0].anteckning+=' ändrad';const before=structuredClone(s);assert.throws(()=>save(s,v,opts),/ändrats/);assert.deepEqual(s,before);
});
test('UI visar granskning utan skrivning, avbryt och saknad version sparar inget',async()=>{
 const events={};let html='',writes=0;
 globalThis.document={getElementById:()=>({set innerHTML(v){html=v;}}),addEventListener:(k,f)=>events[k]=f,querySelector:()=>null};globalThis.window={addEventListener(){}};
 const {startaApp,harOsparadeAndringar}=await import('../src/app/ui.mjs');
 const click=dataset=>{const n={dataset,classList:{contains:()=>false},closest:()=>n};events.click({target:n});};
 const s=fixture(),before=structuredClone(s);
 startaApp({tillstand:s,lagring:{version:{eTag:'v1'},async spara(){writes++;}}});click({sparatunderlag:'old'});assert.match(html,/Stäm av äldre underlag/);
 for(const [k,v] of [['aldreFaktura','900'],['aldreKund','10'],['aldreRad','row'],['aldreText',q().correction]])events.input({target:{dataset:{falt:k},value:v}});
 click({aldregranska:'1'});assert.match(html,/Granskat: faktura 900/);assert.equal(harOsparadeAndringar(),false);click({stang:'knapp'});click({sparatunderlag:'old'});assert.doesNotMatch(html,/Granskat: faktura/);assert.deepEqual(s,before);assert.equal(writes,0);
 startaApp({tillstand:s,lagring:{async spara(){writes++;}}});click({sparatunderlag:'old'});click({aldrespara:'1'});assert.equal(harOsparadeAndringar(),false);assert.equal(writes,0);
});


test('ett underlag får inte kopplas till en andra registerfaktura',()=>{
 const s=fixture();
 s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),invoiceNumber:'899',underlagIds:['old']});
 const before=structuredClone(s);
 assert.throws(()=>review(s,'old',q()),/redan kopplat till en annan faktura/);
 assert.deepEqual(s,before);
});

test('tidigare verifierade kundnummer måste stämma inom samma bolag och kund',()=>{
 for(const origin of ['delivery','reconciliation','ledger']) {
  for(const number of ['10','11']) {
   const s=fixture();
   if(origin==='delivery')s.deliverables.push({id:'other',ledgerReference:{billingCompany:company,clientId:'c',invoiceNumber:'899',customerNumber:number}});
   else {
    s.invoiceRecords.push({...s.invoiceRecords[0],id:'other',clientId:'c',events:origin==='reconciliation'?[{type:'legacyReconciled',clientId:'c',customerNumber:number}]:[]});
    if(origin==='ledger')s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),invoiceNumber:'899',customer:{number,name:'Testkund'},underlagIds:['other']});
   }
   const before=structuredClone(s);
   if(number==='11')assert.throws(()=>review(s,'old',q()),/Kundnumret motsäger/);
   else assert.doesNotThrow(()=>review(s,'old',q()));
   assert.deepEqual(s,before);
  }
 }
 for(const ref of [{billingCompany:L.FORETAG[1],clientId:'c'},{billingCompany:company,clientId:'other'}]) {
  const s=fixture();s.deliverables.push({id:'other',ledgerReference:{...ref,invoiceNumber:'899',customerNumber:'11'}});
  assert.doesNotThrow(()=>review(s,'old',q()));
 }
});

test('kund, profiler och presentation förblir frysta efter avstämning och återläsning',()=>{
 const s=fixture();s.projects[0].billingProfile={hourlyGrouping:'dated',hourlyLabel:'Ursprungligt arbete',invoiceText:'Ursprunglig fakturatext'};
 const out=save(s,review(s,'old',q()),opts),r=out.invoiceRecords[0];
 const originalText=L.lundifyText(out,r.snapshot),originalRows=structuredClone(r.presentationRows);
 assert.equal(r.snapshot.clientSnapshot.name,'Testkund');
 assert.match(originalText,/Ursprungligt arbete/);
 out.clients[0].name='Ändrat kundnamn';out.projects[0].billingProfile.hourlyLabel='Ändrad gruppering';out.projects[0].billingProfile.invoiceText='Ändrad fakturatext';out.poster[0].anteckning='Ändrad anteckning';
 assert.equal(L.lundifyText(out,L.hamtaSparatUnderlag(out,r.id)),originalText);
 assert.deepEqual(r.presentationRows,originalRows);
 const restored=tillAppTillstand(franAppTillstand(out)).tillstand;
 assert.equal(L.lundifyText(restored,L.hamtaSparatUnderlag(restored,r.id)),originalText);
});


test('samma kundnummer får inte verifieras för olika kunder inom samma bolag',()=>{
 for(const origin of ['delivery','reconciliation','ledger']) {
  for(const billingCompany of L.FORETAG) {
   const s=fixture();s.clients.push({id:'other',name:'Annan testkund'});
   if(origin==='delivery')s.deliverables.push({id:'other',ledgerReference:{billingCompany,clientId:'other',invoiceNumber:'899',customerNumber:'10'}});
   else {
    s.invoiceRecords.push({...s.invoiceRecords[0],id:'other',billingCompany,clientId:'other',events:origin==='reconciliation'?[{type:'legacyReconciled',clientId:'other',customerNumber:'10'}]:[]});
    if(origin==='ledger')s.lundifyLedger.records.push({...structuredClone(s.lundifyLedger.records[0]),billingCompany,invoiceNumber:'899',underlagIds:['other']});
   }
   const before=structuredClone(s);
   if(billingCompany===company)assert.throws(()=>review(s,'old',q()),/Kundnumret motsäger/);
   else assert.doesNotThrow(()=>review(s,'old',q()));
   assert.deepEqual(s,before);
  }
 }
});


test('avstämningsdagen följer Stockholm vid midnatt, sommartid och årsskifte',()=>{
 const cases=[
  ['2026-01-15T22:59:59Z','2026-01-15'],
  ['2026-01-15T23:00:00Z','2026-01-16'],
  ['2026-07-15T21:59:59Z','2026-07-15'],
  ['2026-07-15T22:00:00Z','2026-07-16'],
  ['2026-03-28T22:30:00Z','2026-03-28'],
  ['2026-03-29T00:59:59Z','2026-03-29'],
  ['2026-03-29T01:00:00Z','2026-03-29'],
  ['2026-03-29T22:30:00Z','2026-03-30'],
  ['2026-10-24T22:30:00Z','2026-10-25'],
  ['2026-10-25T00:59:59Z','2026-10-25'],
  ['2026-10-25T01:00:00Z','2026-10-25'],
  ['2026-10-25T22:30:00Z','2026-10-25'],
  ['2026-12-31T23:30:00Z','2027-01-01'],
  ['2026-07-16T00:30:00+02:00','2026-07-16'],
  ['2026-07-15T18:30:00-04:00','2026-07-16'],
 ];
 for(const [nu,expected] of cases){
  const s=fixture(),before=structuredClone(s),v=review(s,'old',q());
  const out=save(s,v,{...opts,nu}),r=out.invoiceRecords[0];
  assert.equal(r.klarmarkeradAt,expected,nu);
  assert.equal(r.invoiceDate,'2026-10-31');
  assert.equal(r.checkedAt,nu);assert.equal(r.updatedAt,nu);
  assert.equal(r.snapshot.reconstructedAt,nu);assert.equal(r.events[0].at,nu);
  assert.equal(r.events[0].invoiceDate,'2026-10-31');
  assert.deepEqual(s,before);
 }
});

test('befintlig klarmarkeringsdag bevaras vid avstämning nära svensk midnatt',()=>{
 const s=fixture();s.invoiceRecords[0].klarmarkeradAt='2026-10-31';
 const v=review(s,'old',q()),nu='2026-11-03T23:30:00Z';
 const out=save(s,v,{...opts,nu}),r=out.invoiceRecords[0];
 assert.equal(r.klarmarkeradAt,'2026-10-31');assert.equal(r.checkedAt,nu);
 assert.equal(r.invoiceDate,'2026-10-31');
 assert.equal(save(out,v,{...opts,nu:'2026-11-04T23:30:00Z'}),out);
});
