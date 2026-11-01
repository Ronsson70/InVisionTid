import test from 'node:test';
import assert from 'node:assert/strict';
import {kopplaDelbetalning} from '../src/app/fakturaregister.mjs';
import {uppdateraUppdrag} from '../src/app/uppdrag.mjs';
import {angraGenomford,markeraGenomford} from '../src/app/logik.mjs';
import {periodensDatum,periodandelOre,byggUnderlag} from '../src/domain/index.mjs';
import {FORETAG} from '../src/app/arbetsflode.mjs';
const company=FORETAG[0];
const fixture=()=>({clients:[{id:'c',name:'Kund A'}],projects:[{id:'p',clientId:'c',name:'Plan A',kind:'billable',billingCompany:company}],articles:[],poster:[{id:'t',seconds:3600,priceSnapshot:{unitPriceOre:123}}],invoiceRecords:[],deliverables:[1,2,3,4].map(i=>({id:'d'+i,projectId:'p',name:'Del '+i,amountOre:1500000,vatRate:2500,vatStatus:'reviewed',status:i<3?'invoiced':i===3?'open':'planned',completedAt:i===3?'2026-11-01':null,startDate:'2026-02-21',endDate:'2026-10-30',plannedInvoiceDate:'2026-11-30',priceSnapshot:null})),lundifyLedger:{version:1,records:[{billingCompany:company,invoiceNumber:'900',customer:{number:'10',name:'Kund A'},invoiceDate:'2026-10-31',netOre:1500000,vatOre:375000,roundingOre:0,totalOre:1875000,status:'registered',kind:'invoice',workPeriod:{description:'Okänd'},cashVerified:false,lundifyPaymentStatus:'unpaid',source:{system:'Lundify',listCheckedAt:'2026-11-01T01:00:00Z',detailsBasis:'Test'}}],coverage:[]}});
test('planerat fakturadatum och arbetsperiod är separata; 4 delar summerar exakt',()=>{
 const s=fixture(),old=structuredClone(s);
 const out=uppdateraUppdrag(s,'p',{name:'Plan A',clientId:'c',leveranser:s.deliverables.map(l=>({id:l.id,pris:'15000',vatRate:2500,startDate:'2026-02-21',endDate:'2026-12-20',plannedInvoiceDate:l.id==='d4'?'2026-12-20':l.plannedInvoiceDate}))});
 assert.deepEqual(s,old);assert.deepEqual(out.poster,s.poster);assert.deepEqual(out.lundifyLedger,s.lundifyLedger);
 assert.equal(out.deliverables[3].plannedInvoiceDate,'2026-12-20');
 assert.equal(out.deliverables.reduce((n,l)=>n+periodandelOre(l,periodensDatum(l)),0),6000000);
});
test('koppling bevarar faktisk datumhistorik, register och poster; upprepning är no-op',()=>{
 const s=fixture(),old=structuredClone(s);const out=kopplaDelbetalning(s,'d3','900','10');assert.deepEqual(s,old);
 assert.equal(out.deliverables[2].status,'invoiced');assert.equal(out.deliverables[2].completedAt,'2026-11-01');assert.equal(out.deliverables[2].ledgerReference.invoiceDate,'2026-10-31');assert.equal(out.deliverables[2].ledgerReference.previousStatus,'open');
 assert.deepEqual(out.lundifyLedger,s.lundifyLedger);assert.deepEqual(out.poster,s.poster);assert.equal(kopplaDelbetalning(out,'d3','900','10'),out);
 assert.equal(angraGenomford(out,'d3').ok,false);assert.equal(markeraGenomford(out,'d3','2026-11-01').ok,false);
 assert.throws(()=>byggUnderlag({poster:[],artiklar:[],leveranser:out.deliverables,valdaLeveranser:['d3']}),/registrerad faktura/);
});
test('fel bolag, kund, belopp, moms och återanvänd faktura stoppas',()=>{
 for(const mutate of [s=>s.projects[0].billingCompany=FORETAG[1],s=>s.deliverables[2].amountOre++,s=>s.deliverables[2].vatRate=0]){const s=fixture();mutate(s);assert.throws(()=>kopplaDelbetalning(s,'d3','900','10'));}
 assert.throws(()=>kopplaDelbetalning(fixture(),'d3','900','99'),/kundnummer/);
 const s=kopplaDelbetalning(fixture(),'d3','900','10');assert.throws(()=>kopplaDelbetalning(s,'d4','900','10'),/annan del/);
});
test('UI kräver versionsskydd och misslyckad koppling lämnar tillstånd orört',async()=>{
 const events={};let html='',writes=0;
 globalThis.document={getElementById:()=>({set innerHTML(v){html=v;}}),addEventListener:(k,f)=>events[k]=f,querySelector:()=>null};globalThis.window={addEventListener(){}};
 const {startaApp,harOsparadeAndringar}=await import('../src/app/ui.mjs');
 const click=dataset=>{const n={dataset,classList:{contains:()=>false},closest:()=>n};events.click({target:n});};
 const s=fixture();s.installningar={};const before=structuredClone(s);
 startaApp({tillstand:s,lagring:{async spara(){writes++;}}});click({redigerauppdrag:'p'});
 assert.match(html,/Planerat fakturadatum/);
 for(const [k,v] of [['faktura_d3','900'],['kundnummer_d3','10']])events.input({target:{dataset:{falt:k},value:v}});
 click({sparauppdrag:'p'});assert.equal(harOsparadeAndringar(),false);assert.deepEqual(s,before);assert.equal(writes,0);
});
