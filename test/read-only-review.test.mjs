import test from 'node:test';
import assert from 'node:assert/strict';
import { skapaTestdata } from '../prototyp/testdata.mjs';
import * as L from '../src/app/logik.mjs';
let html=''; const events={};
globalThis.document={getElementById:()=>({set innerHTML(v){html=v;}}),addEventListener:(k,f)=>events[k]=f,querySelector:()=>null};
globalThis.window={addEventListener(){}};
const {startaApp,harOsparadeAndringar}=await import('../src/app/ui.mjs');
function click(dataset){const n={dataset,classList:{contains:()=>false},closest:()=>n};events.click({target:n});}
test('bolagsfilter och återöppnade vyer ändrar varken data eller lagring',async()=>{
 const s=skapaTestdata();s.installningar={veckomalOre:1850000,manadsmalOre:8000000,malForetag:L.FORETAG[0]};const before=structuredClone(s);let writes=0;
 startaApp({tillstand:s,lagring:{async spara(){writes++;}}});click({vy:'vecka'});
 await events.change({target:{dataset:{malforetag:'1'},value:L.FORETAG[1]}});
 assert.match(html,new RegExp(L.FORETAG[1]+'" selected'));assert.equal(harOsparadeAndringar(),false);
 click({oppna:'veckomal'});click({stang:'knapp'});click({vy:'idag'});click({vy:'vecka'});
 assert.match(html,new RegExp(L.FORETAG[1]+'" selected'));
 await events.change({target:{dataset:{malforetag:'1'},value:''}});click({vy:'uppfoljning'});
 await new Promise(r=>setTimeout(r,700));assert.equal(writes,0);assert.deepEqual(s,before);
 startaApp({tillstand:s,lagring:{async spara(){writes++;}}});click({vy:'vecka'});assert.ok(!html.includes(L.FORETAG[0]+'" selected'));assert.deepEqual(s,before);
});
test('äldre sparat underlag utan snapshot behåller ID och visar rekonstruktion',()=>{
 const s=skapaTestdata();const p=s.poster.find(p=>s.articles.find(a=>a.id===p.articleId)?.billable===true);p.invoiceRecordId='legacy';
 s.invoiceRecords=[{id:'legacy',clientId:s.projects.find(x=>x.id===p.projectId).clientId,billingCompany:L.FORETAG[0],period:p.date.slice(0,7),status:'prepared',documentReference:'äldre-ref'}];const before=structuredClone(s);
 const u=L.hamtaSparatUnderlag(s,'legacy');const text=L.lundifyText(s,u);
 assert.equal(u.id,'legacy');assert.equal(u.reconstructed,true);assert.match(text,/Underlagsreferens: legacy/);assert.match(text,/Status: /);assert.match(text,/Dokumentreferens: äldre-ref/);assert.match(text,/Rekonstruerat/);assert.doesNotMatch(text,/Förhandsvisning – inte sparad/);
 startaApp({tillstand:s,lagring:{spara(){throw new Error('write');}}});click({sparatunderlag:'legacy'});assert.match(html,/utan fryst snapshot/);click({stang:'knapp'});click({sparatunderlag:'legacy'});assert.deepEqual(s,before);
});
