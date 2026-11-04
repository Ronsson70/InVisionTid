import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './lib/grupp-fixture.mjs';
import {tillAppTillstand,franAppTillstand} from '../src/app/tillstand.mjs';
let html='';const events={};
globalThis.document={getElementById:()=>({set innerHTML(v){html=v;}}),addEventListener:(k,f)=>events[k]=f,querySelector:()=>null};
globalThis.window={addEventListener(){}};
globalThis.setTimeout=fn=>{queueMicrotask(fn);return 1;};globalThis.clearTimeout=()=>{};
const {startaApp,harOsparadeAndringar}=await import('../src/app/ui.mjs');
const click=dataset=>{const n={dataset,classList:{contains:()=>false},closest:()=>n};events.click({target:n});};
const fill=(f,value)=>events.input({target:{dataset:{falt:f},value}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({conflict=false,noVersion=false,failSave=false}={}) {
 let writes=0,saved=null;const s=fixture();
 if(conflict)s.deliverables.push({id:'d',ledgerReference:{billingCompany:s.projects[0].billingCompany,invoiceNumber:'899',clientId:'other',customerNumber:'10'}});
 const storage={version:noVersion?null:{eTag:'v1'},async spara(next){if(failSave){const e=new Error('Syntetisk versionskonflikt');e.name='Synkkonflikt';throw e;}writes++;saved=structuredClone(franAppTillstand(next));storage.version.eTag='v2';}};
 startaApp({tillstand:s,lagring:storage});click({sparatunderlag:'u1'});click({gruppoppna:'u1'});click({gruppval:'u2'});click({gruppval:'u3'});
 fill('gruppFaktura','900');fill('gruppKund','10');fill('gruppPeriod','2026-10');fill('gruppNotering','Syntetisk UI-kontroll av hela gruppen.');
 return {s,storage,get writes(){return writes;},get saved(){return saved;}};
}

test('UI granskar, sparar en gång och återöppnar gruppen med bevarad historik',async()=>{
 const t=setup(),before=structuredClone(t.s);click({gruppgranska:'1'});
 assert.match(html,/Granskat: 3 underlag/);assert.match(html,/Avrundningsskillnad på gruppnivå: −1 kr/);assert.equal(t.writes,0);assert.equal(harOsparadeAndringar(),false);
 click({gruppspara:'1'});await flush();assert.equal(t.writes,1);assert.equal(harOsparadeAndringar(),false);assert.match(html,/Ingår i gemensam faktura 900/);assert.doesNotMatch(html,/data-gruppspara/);assert.deepEqual(t.s,before);
 click({gruppspara:'1'});await flush();assert.equal(t.writes,1);
 click({stang:'knapp'});startaApp({tillstand:tillAppTillstand(t.saved).tillstand,lagring:t.storage});click({sparatunderlag:'u2'});
 assert.match(html,/Ingår i gemensam faktura 900/);assert.match(html,/u1, u2, u3/);assert.match(html,/Den läggs inte på detta underlag/);
});

test('UI avbryt, fel kund, saknad version och ändrat formulär skriver inget',async()=>{
 let t=setup();click({gruppgranska:'1'});click({stang:'knapp'});await flush();assert.equal(t.writes,0);assert.equal(harOsparadeAndringar(),false);
 for(const options of [{conflict:true},{noVersion:true}]){t=setup(options);click({gruppgranska:'1'});click({gruppspara:'1'});await flush();assert.equal(t.writes,0);assert.equal(harOsparadeAndringar(),false);}
 t=setup();click({gruppgranska:'1'});fill('gruppNotering','Ändrad efter granskningen');click({gruppspara:'1'});await flush();assert.equal(t.writes,0);
 t=setup();click({gruppgranska:'1'});click({gruppval:'u3'});click({gruppspara:'1'});await flush();assert.equal(t.writes,0);
});

test('UI stoppar ändrad eTag och visar lagringskonflikt utan lyckad skrivning',async()=>{
 let t=setup();click({gruppgranska:'1'});t.storage.version.eTag='v2';click({gruppspara:'1'});await flush();assert.equal(t.writes,0);assert.equal(harOsparadeAndringar(),false);
 t=setup({failSave:true});click({gruppgranska:'1'});click({gruppspara:'1'});await flush();assert.equal(t.writes,0);assert.equal(harOsparadeAndringar(),true);assert.match(html,/Syntetisk versionskonflikt/);
});
