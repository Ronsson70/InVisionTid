# Öppna frågor

Frågor som måste besvaras av en människa. Ingen av dem har besvarats med en
gissning, och ingen av dem blockerar etapp 3 utom där det uttryckligen står.

---

## 1. T6 — en kund, två uppdrag ✔ besvarad 2026-08-27

**Svar:** kunden och fakturamottagaren är **en enda**. Fakturan innehöll underlag
från två skilda uppdrag hos den kunden. Det är alltså inte två fakturamottagare.

**Genomfört:** T6 ligger på **Kund C**, som har tre uppdrag. Två av dem ingår i
T6-fakturan — ett med 440 kr per timme plus ett vidarefakturerat utlägg, och ett
med 350 kr per timme. Alla belopp i testet är oförändrade: netto 5 110,00 kr,
moms 1 277,50 kr, att betala 6 388 kr efter avrundning.

Kontrollen i `test/acceptance-checks.mjs` säkerställer nu uttryckligen att
underlaget har **exakt en** `clientId`, och att raderna kommer från två skilda
`projectId`. Det tidigare "Kund F" finns inte längre.

Kopplingen mellan pseudonym och verkligt bolag, och vilken faktura det gällde,
står enbart i den gitignorerade `test-fixtures/privat/kundmappning.local.md`.

---

## 2. Momssatsen på behandlingspass ✔ hanteringen fastställd 2026-08-27

Kravspecifikationen säger att behandlingspassen hittills hanterats med 0 % moms,
och att momssatsen ska vara konfigurerbar och tydligt markerad för kontroll.

**Detta är inte samma sak som att 0 % är rätt.** Vård- och behandlingstjänster kan
vara momsbefriade, men det beror på verksamhetens art och på avtalet. Frågan är en
skattefråga, inte en programmeringsfråga.

**Så det hanteras, beslutat:** migreringen sätter **ingen** momssats alls.

```js
vatRate: null,                  // okänd, INTE noll procent
vatStatus: 'needsReview',
```

Migreringen befäster varken 0 % för att det historiskt hanterats så, eller 25 %
för att det är vanligast. Båda vore påhitt, bara åt olika håll.

Ett underlag kan byggas och förhandsgranskas medan momsen är ogranskad, men det
kan inte **färdigställas, låsas eller överföras** förrän `vatStatus` är
`'reviewed'`. Spärren testas som en del av T9.

**Kvarstår:** själva momssatsen ska verifieras mot avtal och Skatteverkets regler
innan första fakturan går via v2. Det är en skattefråga, inte en programmeringsfråga.

---

## 3. Totalpriset i förstudien: 60 000 eller 64 000 kr?

Fyra delar à 15 000 kr ger 60 000 kr exklusive moms. En tidigare uppgift motsvarar
64 000 kr exklusive moms. Skillnaden är 4 000 kr.

**Inget totalpris har hittats på.** T5 kräver att appen visar en kontrollflagga med
båda uppgifterna och differensen, och att `totalOre` är `null` tills frågan är
avgjord. Delfakturan på 15 000 kr går att skapa oavsett — flaggan blockerar inte.

Möjliga förklaringar som **inte** har antagits: att en femte del tillkommit, att
en av delarna har ett annat belopp, att 64 000 kr är inklusive något tillägg, eller
att en av uppgifterna helt enkelt är fel.

**Behöver svar innan sista delfakturan skickas, inte innan etapp 3.**

---

## 4. Vilka uppdrag är fakturerbara, interna eller ideella?

Modellen har `project.kind` med värdena `billable`, `internal` och `voluntary`.
Migreringen sätter `billable` på allt, eftersom v1 inte har begreppet och det inte
går att härleda ur datan.

**Frågan:** finns det projekt i nuvarande data som egentligen är internt
bolagsarbete eller ideellt arbete? De behöver märkas om manuellt i grunddatavyn
efter migreringen, annars räknas de som fakturerbara i uppföljningen.

**Behöver svar efter etapp 4, före etapp 8.**

---

## 5b. Fastprisuppdraget med två perioder ⚠ kräver avstämning

Ett av uppdragen har **två fastprisperioder à 100 000 kr**: april–juni och
juli–september. Fakturamarkerat är mars, maj, juni och juli. April saknar
markering.

**De loggade tidsposterna på uppdraget är inte fakturerbara tidsrader.** Priset
är fast, tiden är `trackingOnly` och påverkar inte beloppet. Att beskriva de
11 aprilposterna som "ofakturerad tid" vore fel.

**Frågan är inte hur stor en beräknad "aprildel" är.** Ett fast pris för en
period är inte en summa som appen ska dela upp per månad — det var precis den
konstruktionen i v1 som gjorde intäkten synlig i fel period. Frågan är:

> Har den avtalade leveransen eller betalningsperioden fakturerats, helt eller
> delvis?

Det kan bara avgöras mot **avtalet** och **Lundify**. Appen ska varken räkna
fram ett belopp eller gissa vilken del som återstår.

Två saker till som inte går att lösa ur datan:

- **Mars är fakturamarkerat men ligger före den första periodens start.** Det
  finns antingen ett tidigare avtal som inte är registrerat, eller så avser
  markeringen något annat.
- **Augusti och september i den andra perioden** har varken poster eller
  markering. Om perioden faktureras i förskott eller vid periodens slut går
  inte att läsa ur datan.

**Behöver stämmas av mot avtal och Lundify innan uppdraget förs över till v2.**

---

## 5. Vad betyder de befintliga fastprisperioderna?

Fyra av sju projekt i den inspekterade ögonblicksbilden har `pricingPeriods` av
typen `fixed`. En sådan period kan betyda ett avtalat totalbelopp som faktureras
vid leverans, eller en periodiserad månadsersättning.

**Migreringen omvandlar dem inte.** Råvärdet behålls och en granskningspost skapas
per period. Beslutet fattas manuellt, period för period.

**Behöver svar i granskningskön efter etapp 4.**

---

## 6. Fakturerades mars och april 2026, och i så fall vad?

Den inspekterade ögonblicksbilden saknar `invoices` helt, medan den syntetiska
fixturen innehåller markeringar. Den verkliga aktuella filen ligger på en annan
plats och har inte lästs.

Oavsett vad som står där är markeringarna inte tillförlitliga. Avstämningen ska
göras mot Lundify, faktura för faktura, efter migreringen.

**Behöver göras som en avstämningsövning efter etapp 4.**

---

## 7. En andra deployment utanför versionshantering

Det finns en separat deployment av appen vars källkod aldrig hamnat i något
Git-repo, och där det är oklart om data sparas mot OneDrive eller enbart i
webbläsarens localStorage. Detaljerna står i den privata projektanteckningen.

Det ligger **utanför det här uppdraget**, men v2-arbetet varken ändrar eller tar
bort risken. Om datan bara finns i en webbläsare försvinner den vid en rensning.

**Bör hanteras separat och snart.**

---

## 8. Vilken OneDrive-fil är den riktiga? ✔ delvis besvarad 2026-08-27

**Svar:** filen i produktmappen från 2026-03-31 är **inte** produktionskälla. Den
aktiva kandidaten ligger på den sökväg appen faktiskt använder,
`InVisionTid/invisiontid-data.json`, senast ändrad 2026-08-11.

**Den har inte rörts.** Den strukturella inspektionen i nulägesanalysen gjordes på
marsfilen och beskriver därför bara vilka fält och kombinationer som förekommer,
inte dagens innehåll.

**Kvarstår:** före produktionsmigreringen ska den aktiva filen verifieras genom
appens verkliga OneDrive-koppling — `lastSync`, antal per samling och en daterad
backup — som steg 0 i migreringsordningen. Fram till dess sker allt arbete mot
syntetiska fixtures.
