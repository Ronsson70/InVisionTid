# Nulägesanalys — In Vision Tid v1

Datum: 2026-08-27. Kodbas: `main` @ `baf9e10`.

Analysen bygger på läsning av `CLAUDE.md`, `README.md`, `index.html`, `test.html`
och git-historiken, samt en **strukturell** inspektion av en gammal
produktionsögonblicksbild. Inga värden ur produktionsdata har lästs ut, skrivits
ut eller kopierats in någonstans.

---

## 1. Två saker att känna till innan analysen läses

**Den lokala kopian låg efter.** Arbetskopian stod på `79bebf6` medan `origin/main`
stod på `baf9e10`, tre commits senare. De tre commitsen innehåller `CLAUDE.md`,
den fyrflikiga navigationen, reseförslag, eftersläpningsvarning och en samlad
prismodellprioritet. Utan hämtningen hade analysen beskrivit fel app. Kopian är
nu fast-forwardad. Ingen push har gjorts.

**Filen som inspekterades är inte produktionskällan.** Det finns en äldre kopia
med samma filnamn i en annan OneDrive-mapp, daterad 2026-03-31. Koden läser och
skriver mot `me/drive/root:/InVisionTid/`, alltså en annan plats
([index.html:136](../index.html#L136)).

Den aktiva filen ligger på den sökväg appen faktiskt använder och var senast
ändrad 2026-08-11. **Den har inte lästs, öppnats eller rörts.**

Siffrorna nedan kommer alltså från en fem månader gammal ögonblicksbild och
beskriver **strukturen**, inte dagens innehåll. De duger för att forma
migreringen — vilka fält som förekommer, vilka som saknas, vilka kombinationer
som är vanliga — men får inte användas som facit för antal eller belopp.

Före en produktionsmigrering ska den aktiva filen verifieras genom appens
verkliga OneDrive-koppling: `lastSync`, antal per samling och en daterad backup,
innan något annat sker. Se `docs/04-migreringsstrategi.md`.

Strukturen i ögonblicksbilden, enbart antal och fältnamn:

| | antal |
|---|---|
| clients | 6 |
| projects | 7 |
| entries | 55 |
| expenses | 0 |
| trips | 30 |
| invoices | fältet saknas helt |
| deletedIds | fältet saknas helt |
| schemaVersion | saknas (skrevs före versionsstämpeln) |

Alla 55 tidsposter saknar `updatedAt`. 29 av dem bär `calEventId`, alltså drygt
hälften kommer från kalenderimport. Fyra av sju projekt har `pricingPeriods` av
typen `fixed`, inget projekt har `sessionPrice`, ett projekt saknar kund.

Det säger tre saker om migreringen: **utan `updatedAt` faller merge tillbaka på
`createdAt`**, **`invoices` och `deletedIds` kan saknas i verklig indata**, och
**fastprisperioder är den vanligaste prismodellen i verkligt data** — exakt den
konstruktion som ska ersättas av leveranser.

---

## 2. Vad appen är idag

En single-file PWA. `index.html` är 1 999 rader och ungefär 175 kB och innehåller
HTML, CSS, React 18 via CDN, Babel standalone och all applikationslogik. Ingen
byggprocess. `test.html` läser sektionen mellan `PURE-START` och `PURE-END` ur
`index.html` med `fetch` + `new Function` och kör 40-talet assertions i webbläsaren.

Fyra flikar: **Idag** (`TodayView`), **Vecka** (`WeekView`), **Fakturera**
(`InvoiceView`), **Uppföljning** (`ReportView` + `TrendCharts`). Grunddata och
inställningar ligger bakom kugghjulet.

Det som redan fungerar och ska bevaras: timer med återupptagning efter omstart,
manuell tidsregistrering, Snabb tid byggd på `recentProjectIds` och `lastEntryFor`,
kalenderimport från Outlook, projekt och kunder, resor och utlägg, reseförslag ur
`defaultTripKm`, eftersläpningsvarning via `staleStatus`, veckovis och månadsvis
uppföljning, OneDrive-synk med merge och tombstones, Excel- och ICS-export samt
utskrivbar månadsrapport per projekt.

Koden är genomtänkt på flera punkter som är värda att behålla i v2:

- `oneDriveRead` returnerar `null` **bara** vid 404 och kastar vid alla andra fel,
  så ett tillfälligt nätverksfel aldrig kan få lokal data att skriva över fjärrdata
  ([index.html:136](../index.html#L136)).
- `mergeData` använder tombstones med tidsstämpel, så en radering överlever en
  tur och retur men en post som redigerats *efter* raderingen kommer tillbaka
  ([index.html:154](../index.html#L154)).
- Prismodellprioriteten samlades nyligen till en enda funktion, `pricingModel`,
  just för att stoppa dubbelräkning ([index.html:255](../index.html#L255)).

---

## 3. Grundproblemet: en prismodell per projekt

Hela prissättningen hänger på `pricingModel(project)`:

```js
function pricingModel(project){
  if(hasSessionPrice(project))return'session';
  if(hasFixedPeriod(project))return'fixed';
  return'hourly';
}
```

Priset är en **egenskap hos projektet**. En behandlingsdag som innehåller både ett
fast behandlingspass och ett timdebiterat samtal kan därför inte räknas rätt. Det
är inte en avrundningsfråga utan en modellfråga, och den syns direkt i mätning.

Acceptansfall T8 kört mot dagens kod:

```
✗ T8  nettoOre före resa: fick 240000, väntade 325000
```

2 400 kr i stället för 3 250 kr. Samtalet försvinner helt, eftersom `calcRevenue`
returnerar tidigt så snart projektet har `sessionPrice`
([index.html:270](../index.html#L270)).

Samma modellfel har en andra sida. `getSessionCount` räknar **unika datum**, inte
antal tillfällen:

```js
const dates=new Set(entries.filter(e=>e.projectId===project.id).map(e=>e.date));
return dates.size;
```

Åtta behandlingspass samma dag blir ett tillfälle och 2 400 kr i stället för
19 200 kr. Kvantitet finns inte som begrepp. Det är samma sak som gör att
isspolning à 350 kr per spolning inte går att uttrycka alls: tolv spolningar en
tisdag är antingen en session eller tolv separata dagar.

**Fastpris fördelas över kalendertid.** `calcFixedMonthly` delar avtalsbeloppet på
antalet månader perioden spänner över, och `getFixedWeeklyAmount` delar vidare per
dag. Konstruktionen är matematiskt konsekvent — veckosummorna summerar till
månadsbeloppet, vilket ett test låser fast — men den modellerar fel verklighet.
50 000 kr per genomförd verkstad är inte en periodiserad ersättning. Det är en
leverans som antingen är genomförd eller inte. Att fördela den över dagar gör
intäkten synlig i fel period och gör den omöjlig att fakturera vid rätt tillfälle.

---

## 4. Fakturamarkeringen bär ingen sanning

```js
// invoice = { projectId, month:'2026-03', invoicedAt:'2026-04-02' }
```

Tre fält. Ingen koppling till vilka poster som ingick, inget belopp, inget
fakturanummer, ingen status utöver "markerad eller inte". `InvoiceView.toggleClient`
sätter eller tar bort markeringen för alla kundens projekt på en gång
([index.html:1402](../index.html#L1402)).

Konsekvenserna:

- En post som läggs in i efterhand på en redan markerad månad hamnar tyst utanför.
  Ingenting i appen upptäcker det.
- En markering säger inte om fakturan är ett utkast, skickad eller betald.
- Markeringen har bevisligen varit fel åt båda håll och kan därför inte migreras
  som sanning. Den måste migreras som en **osäker uppgift**.
- `mergeData` deduplicerar fakturamarkeringar på `projectId + month` utan
  tombstones. Två enheter som är oense om en markering avgörs av vilken som
  synkar sist, tyst.

Appen visar redan idag en ärlig varning i faktureringsvyn: *"Beloppen är underlag,
inte fakturor."* Den ärligheten ska byggas in i datamodellen, inte stå i en ruta.

---

## 5. Pengar räknas i flyttal, moms finns inte

Ingenstans i `index.html` förekommer ordet moms. Det finns ingen momssats, inget
momsunderlag, ingen öresavrundning och ingen skillnad mellan momspliktigt och
momsfritt. Behandlingspass med 0 % och samtal med 25 % samma dag går inte att
uttrycka.

Alla belopp är flyttal. `calcRevenue` returnerar `(e.seconds/3600)*rate`,
`getFixedWeeklyAmount` summerar `monthlyAmount/coveredDays` per dag och avrundar
till sist. Avrundningen sker med `Math.round`, som är half-up för positiva tal men
**half-up mot plus oändligheten** för negativa — `Math.round(-0.5)` ger `-0`. För
en kreditfaktura blir det fel åt fel håll.

Testfall T2 visar varför exakthet spelar roll: 11 418,50 kr med 25 % moms ger
2 854,625 kr, alltså exakt ett halvt öre. ROUND_HALF_UP ger 2 854,63 kr, bankers
rounding ger 2 854,62 kr. En krona fel i månaden är ett bokföringsproblem, inte en
skönhetsfläck.

---

## 6. Vad testtäckningen faktiskt täcker

`test.html` är väl byggd — den återanvänder produktionskoden i stället för att
kopiera den. Men den når **bara** sektionen mellan `PURE-START` och `PURE-END`.

`migrate()` ligger på rad 104 och `mergeData()` på rad 154, alltså **utanför**
PURE-sektionen. De två funktioner som ensamma avgör om användarens data överlever
en synk har därmed noll testtäckning i dag.

Det är åtgärdat i den här etappen. `test/v1-skyddsnat.test.mjs` plockar ut båda ur
`index.html` och kör 13 tester mot dem: idempotens, skräpindata, bevarade okända
fält, tombstone-beteende åt båda håll, och att varje toppnivåfält faktiskt räknas
upp i `mergeData`:s objektbygge. Alla 13 är gröna och ska förbli gröna genom hela
v2-arbetet.

Ett fynd värt att notera: `mergeData` bygger ett **helt nytt objekt** och listar
varje fält explicit. `settings` finns med, så eftersläpningsvarningen överlever.
Men konstruktionen betyder att varje framtida toppnivåfält som glöms bort i den
listan raderas tyst vid nästa synk. `CLAUDE.md` varnar redan för det. Skyddsnätet
gör varningen mätbar.

---

## 7. Säkerhet i autentiseringen

`msLoginUrl()` använder `response_type: 'token'` — implicit flow. Access token
sparas i `localStorage` under `invisiontid-ms-token`
([index.html:126-130](../index.html#L126-L130)).

Implicit flow är avrådd av både OAuth 2.0 Security BCP och Microsoft. Token
passerar i URL-fragmentet, hamnar i webbläsarhistoriken och ligger sedan
oskyddad mot XSS i `localStorage`. Scopet är `Files.ReadWrite Calendars.Read` —
inte begränsat till appmappen, utan skrivrättighet till hela användarens OneDrive.

Detta ska bytas till MSAL med authorization code flow och PKCE, men som en **egen,
separat etapp**. Att blanda ihop ett auth-byte med en datamigrering är precis den
sortens kombination som gör fel omöjliga att felsöka.

Ett mindre observandum: SRI-hashar finns på alla CDN-script, vilket är bra. Babel
standalone kompilerar JSX i webbläsaren vid varje sidladdning, vilket kostar
ungefär en halv sekund på mobil och tvingar fram `unsafe-eval` om CSP någon gång
ska införas.

---

## 8. Övriga observationer

**Ingen backup före skrivning.** `oneDriveWrite` skriver rakt över filen. Det finns
ingen versionshistorik i appen och ingen daterad backup. Enda skyddet är OneDrives
egen versionshantering. Innan en migrering får skriva något måste en daterad backup
tas.

**Kalenderimport kan massimportera.** `importAllEvents` lägger alla veckans
händelser på ett och samma projekt utan individuell kontroll
([index.html:1196](../index.html#L1196)). Med 29 av 55 poster från kalendern i den
ögonblicksbild som inspekterats är det den vanligaste vägen in för data. Det behöver
en granskningskö, inte en knapp som gör allt på en gång.

**Utlägg har inget kvittobegrepp.** `expense = { id, projectId, amount, description,
date, createdAt }`. Inget kvitto, ingen markering av om utlägget ska vidarefaktureras.
I den inspekterade ögonblicksbilden fanns noll utlägg, men ett av uppdragen
kräver att utlägg kan kopplas till underlaget utan att tappas bort.

**Ingen skillnad på arbetstyp.** Alla poster har fältet `moment`, en fritextsträng.
Det finns inget sätt att skilja fakturerbart konsultarbete från internt bolagsarbete
eller ideellt arbete. Kravet att aldrig blanda ihop dem går inte att uppfylla med
dagens modell.

**Svenska tecken.** Appens texter är korrekta. Däremot saknar samtliga commit-subjekt
i historiken å, ä och ö — "Fixa fastpris-fordelning: vecka stammer mot manad". Det
bryter inte mot T12, som gäller användarsynliga texter, men är värt att ändra framåt.

---

## 9. Baslinje mot acceptanskraven

Acceptansfallen T1–T13 är implementerade i `test/acceptance-checks.mjs` och körs mot
en adapter. `test/adapters/v1.mjs` försöker svara med den kod som faktiskt finns
idag. Kör `node test/rapport.mjs` för hela tabellen med orsaker.

| | | |
|---|---|---|
| **T1** | saknas | v1 saknar momsbegrepp helt |
| **T2** | saknas | v1 saknar momsbegrepp helt |
| **T3** | saknas | v1 saknar styckpris och momsbegrepp |
| **T4** | saknas | fastpris är period, inte leverans |
| **T5** | saknas | inga leveranser, inga kontrollflaggor |
| **T6** | saknas | inget underlag att låsa poster till |
| **T7** | **godkänt** | `suggestTrip` klarar redan 23 km och dubblettskyddet |
| **T8** | **fel svar** | 2 400 kr i stället för 3 250 kr |
| **T9** | saknas | `migrate()` skapar inga artiklar eller leveranser |
| **T10** | saknas | gamla markeringar migreras inte som osäkra |
| **T11** | saknas | inget prissnapshot, prisändring skriver om historiken |
| **T12** | **godkänt** | inga trasiga tecken, inga understreck i filnamn |
| **T13** | saknas | ett binärt tillstånd, inget fakturanummer |

**2 godkända, 1 fel svar, 10 utan stöd.**

T7 och T12 är gröna redan nu, och det är avsiktligt: de visar att baslinjen mäter
något verkligt och inte bara faller på att koden saknas.

Skyddsnätet `test/v1-skyddsnat.test.mjs` är grönt på alla 13 tester.

---

## 10. Riskbedömning

| Risk | Konsekvens | Hantering |
|---|---|---|
| Migrering tappar poster | Förlorad fakturerbar tid, oåterkalleligt | Daterad backup, migrering i minnet, kontrollsummor före/efter, återställning. Etapp 4. |
| Gammal fakturamarkering tolkas som sanning | Dubbelfakturering eller utebliven fakturering | Migreras som `needsReview` utan fakturanummer. T10. |
| Fastprisperiod tolkas fel som leverans | Fel intäktsperiod, fel underlag | Råvärdet behålls, granskningspost skapas, ingen automatisk omvandling. |
| Flyttalsfel i moms | Bokföringsdifferens | Heltalsöre genom hela kedjan. T1–T3. |
| Auth-byte blandas med datamigrering | Omöjligt att felsöka | Separata etapper, 10 respektive 3–4. |
| Lundify-nyckel i klientkoden | Läckta faktureringsuppgifter | Ingen integration byggs innan förstudien är godkänd. Etapp 9. |
| Cloudflare Pages börjar bygga | Trasig deploy | Ingen `package.json` i roten. Testerna körs med `node --test test/*.test.mjs`. |
| Separat deployment utanför Git | Data ligger utanför versionshantering och kanske bara i localStorage | Utanför uppdraget, men risken kvarstår och bör hanteras separat. |

---

## 11. Slutsats

Appen är välbyggd för det den byggdes för: att snabbt logga tid och se hur veckan
ligger till. Problemet är att den nu ska svara på en annan sorts fråga — vad som
faktiskt ska faktureras, till vem, med vilken moms och i vilket tillstånd — och
den frågan kräver begrepp som inte finns i modellen: artikel, kvantitet, momssats,
leverans, låst underlag och extern fakturareferens.

Det går inte att lappa in. Priset sitter på projektet, kvantiteten saknas helt och
pengarna är flyttal. Men det behöver inte heller skrivas om i ett svep. Domänen kan
brytas ut och testas först, medan den befintliga UI:n fortsätter fungera oförändrad.
Det är vad `docs/02-arkitekturbeslut-v2.md` föreslår.
