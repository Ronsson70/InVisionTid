import {FORETAG} from '../../src/app/arbetsflode.mjs';
import {hamtaSparatUnderlag} from '../../src/app/logik.mjs';
export const company=FORETAG[0];
export const request=()=>({billingCompany:company,clientId:'c',period:'2026-10',invoiceNumber:'900',customerNumber:'10',note:'Syntetisk kontroll av hela oktoberarbetet mot faktura 900.',confirmed:true});
export const options={eTag:'v1',expectedETag:'v1',nu:'2026-11-03T23:30:00Z',confirmedRoundingOre:-100};
export const ids=['u1','u2','u3'];
export function fixture(amounts=[1000200,1000200,757100]) {
 const s={clients:[{id:'c',name:'Syntetisk kund'}],projects:[{id:'p',clientId:'c',name:'Testarbete',kind:'billable',billingCompany:company}],articles:[],poster:[],invoiceRecords:[],deliverables:[],reviewQueue:[],migrationLog:[],installningar:{veckomalOre:100000,manadsmalOre:null}};
 amounts.forEach((amount,i)=>{
  const id=`u${i+1}`,type=i===2?'travel':'hourly',unit=i===2?'km':'tim';
  s.articles.push({id:`a${i}`,projectId:'p',name:'Syntetiskt arbete',type,unit,unitPriceOre:amount,vatRate:2500,vatStatus:'reviewed',billable:true});
  s.poster.push({id:`row${i}`,projectId:'p',articleId:`a${i}`,sourceType:i===2?'trip':'entry',date:`2026-10-0${i+1}`,description:'Syntetisk rad',beskrivning:'Syntetisk rad',qtyMilli:1000,seconds:i===2?0:3600,status:'included',invoiceRecordId:id,priceSnapshot:{unitPriceOre:amount,vatRate:2500,unit},anteckning:'Bevarad originalanteckning'});
  s.invoiceRecords.push({id,clientId:'c',billingCompany:company,period:'2026-10',legacyStatus:'prepared',invoiceNumber:null,createdAt:'2026-10-15T12:00:00Z'});
  const u=hamtaSparatUnderlag(s,id);Object.assign(s.invoiceRecords.at(-1),{nettoOre:u.nettoOre,momsOre:u.momsOre,attBetalaOre:u.attBetalaOre});
 });
 s.lundifyLedger={version:1,coverage:[],records:[{billingCompany:company,invoiceNumber:'900',customer:{number:'10',name:'Syntetisk kund'},invoiceDate:'2026-11-01',workPeriod:{from:'2026-10-01',to:'2026-10-31',description:'Oktober'},netOre:2757500,vatOre:689375,roundingOre:25,totalOre:3446900,status:'registered',kind:'invoice',lundifyPaymentStatus:'unpaid',cashVerified:false,source:{system:'Lundify',listCheckedAt:'2026-11-02T12:00:00Z',detailsBasis:'Endast syntetiska testdata'}}]};
 return s;
}
