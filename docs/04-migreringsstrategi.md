# Migreringsstrategi v1 → v2

Status: **förslag.** Ingenting av detta får köras mot produktionsdata innan
etapp 3 och 4 är godkända.

---

## Grundprincip

`migrate()` är en **ren funktion**: in ett v1-objekt, ut ett v2-objekt. Den läser
ingen fil, skriver ingen fil, anropar inget nätverk och tittar inte på klockan.
Tidsstämplar och nya id:n skickas in som argument, så samma indata alltid ger samma
utdata och testerna kan vara exakta.

```js
migrera(v1data, { nu: '2026-08-27T10:00:00.000Z', gid: idGenerator })
```

Detta är också vad som gör idempotensen testbar: kör två gånger, jämför.

---

## Skyddsordningen

Ingen skrivning sker förrän varje steg innan har lyckats.

```
0. Verifiera VILKEN fil som är den aktiva, genom appens egen OneDrive-koppling
1. Läs rådata från OneDrive och localStorage
2. Skriv daterad backup av RÅDATA, orörd, före allt annat
3. Kör migreringen HELT I MINNET
4. Räkna kontrollsummor före och efter
5. Visa sammanfattning för användaren
6. Vänta på uttryckligt godkännande
7. Först då: skriv v2 till localStorage och OneDrive
8. Behåll backupen. Erbjud återställning.
```

**Steg 6 är inte förhandlingsbart.** Appen får aldrig migrera produktionsdata vid
uppstart. Migreringen är en åtgärd användaren startar, inte något som händer.

**Steg 0 är lika viktigt.** Det finns flera filer med samma namn på olika platser
i OneDrive, och bara en av dem är den appen faktiskt använder. Verifieringen sker
genom appens egen Graph-koppling mot `me/drive/root:/InVisionTid/` och redovisar
`lastSync`, antal per samling och filens ändringsdatum. Att migrera fel fil vore
att skriva över aktuell data med gammal.

---

## Backup

Innan något annat sker skrivs rådata oförändrad till två platser:

- `localStorage`, nyckel `invisiontid-backup-<ISO-datum>`
- OneDrive, `InVisionTid/backup/invisiontid-backup-<ISO-datum>.json`

Filnamnsmönstret `invisiontid-backup-*.json` är redan gitignorerat sedan v1.
`migrering-backup-*.json` har lagts till i `.gitignore` i den här etappen.

Backupen är **rådata, inte migrerad data**. Poängen är att kunna gå tillbaka till
exakt det som fanns, inte till en tolkning av det.

---

## Kontrollsummor

Före och efter migreringen räknas:

| | krav |
|---|---|
| antal `clients` | får inte minska |
| antal `projects` | får inte minska |
| antal `entries` | får inte minska |
| antal `expenses` | får inte minska |
| antal `trips` | får inte minska |
| antal tombstones i `deletedIds` | får inte minska |
| summa `entries[].seconds` | ska vara **exakt** oförändrad |
| summa `trips[].km` | ska vara **exakt** oförändrad |
| summa `expenses[].amount` | ska vara **exakt** oförändrad |
| antal unika `id` per samling | inga dubbletter |

Minskar något, eller ändras en summa, **avbryts migreringen** och rådata lämnas
orörd. Det är inte en varning, det är ett stopp.

Summorna är viktigare än antalen. Antalet poster kan stämma medan tid har gått
förlorad i en felaktig fältöversättning.

---

## Steg för steg

### 1. Kunder

Kopieras rakt av. Nya valfria fält sätts till `null`. Inget kan gå fel här.

### 2. Projekt

Kopieras med `kind: 'billable'` som standard. `hourlyRate`, `sessionPrice` och
`pricingPeriods` **behålls oförändrade** som råvärden.

Projekt som kan vara internt eller ideellt arbete kan inte avgöras automatiskt.
De läggs inte i granskningskön automatiskt heller — det skulle skapa brus. I stället
visar grunddatavyn `kind` tydligt så att felaktiga värden syns.

### 3. Artiklar — härledda, alltid granskningsbara

För varje projekt skapas artiklar ur den prisinformation som finns:

| v1-värde | ny artikel | moms |
|---|---|---|
| `sessionPrice > 0` | `type: 'session'`, `unit: 'pass'`, priset i öre | `null` |
| `hourlyRate` | `type: 'hourly'`, `unit: 'tim'`, priset i öre | `null` |
| varken eller | `type: 'hourly'` med `data.hourlyRate` som pris | `null` |
| projektet har `trips` | `type: 'travel'`, `unit: 'km'`, `data.kmRate` i öre | `null` |
| projektet har `expenses` | `type: 'piece'`, `unit: 'kr'`, `unitPriceOre: 100` | `null` |

**Momssatsen migreras aldrig, den granskas.**

Varje härledd artikel får:

```js
vatRate: null,                  // okänd, INTE noll procent
vatStatus: 'needsReview',
needsReview: true,
reviewNote: 'Momssatsen saknas i v1 och måste granskas innan fakturering.',
```

Ingen momssats finns i v1. Därför sätts **ingen**. Migreringen får varken befästa
0 % för att det historiskt hanterats så, eller sätta 25 % för att det är vanligast.
Båda vore påhitt, bara åt olika håll.

Behandlingspassen är det tydligaste exemplet: de har hanterats med 0 % moms, men
det är en skattefråga som ska bekräftas mot avtalet. Migreringen lämnar `null` och
flaggar. Först när en människa har granskat sätts `vatRate` och `vatStatus` blir
`'reviewed'`.

**Spärren:** ett faktureringsunderlag kan byggas och förhandsgranskas medan momsen
är ogranskad, men det kan inte **färdigställas, låsas eller överföras** så länge
någon rad bygger på `vatStatus: 'needsReview'`. Det är så en gissad moms hindras
från att nå en faktura, och det testas som en del av T9.

**Idempotens:** artiklar får deterministiska id:n härledda ur projektets id och
artikeltypen, `art-<projectId>-<type>`. Andra körningen hittar dem och skapar inga
dubbletter.

### 4. Tidsposter

```
entry.articleId  ← projektets härledda artikel av rätt typ
entry.description ← entry.moment          (moment behålls som råvärde)
entry.qtyMilli   ← härledd ur seconds för hourly-artiklar
entry.seconds    ← OFÖRÄNDRAD
entry.status     ← 'open'
entry.priceSnapshot ← null
```

För en `session`-artikel går kvantiteten **inte** att härleda. v1 räknade unika
datum, inte antal pass. Åtta pass samma dag ser i v1 ut som ett tillfälle. Därför:

- `qtyMilli` sätts till `1000`, alltså ett pass
- posten får `status: 'needsReview'` och en post i granskningskön

Det är den ärliga hanteringen. Att gissa åtta hade varit att hitta på.

### 5. Resor och utlägg

Resor får `qtyMilli = km * 1000` och pekar på projektets travel-artikel.

Utlägg får `amountOre = Math.round(amount * 100)` medan `amount` behålls. Utlägg
utan `description` eller med `hasReceipt: false` hamnar i granskningskön.

### 6. Fastprisperioder — **omvandlas aldrig automatiskt**

En `pricingPeriod` med `type: 'fixed'` kan betyda två helt olika saker:

- ett avtalat totalbelopp som ska faktureras vid leverans, eller
- en periodiserad månadsersättning

Innebörden går inte att läsa ur datan. Därför:

- `pricingPeriods` **behålls oförändrad** på projektet
- **ingen** `deliverable` skapas
- en granskningspost av typ `osakert-pris` skapas per period, med råvärdet

Användaren avgör i granskningskön om perioden ska bli en leverans, flera leveranser
eller en månadsvis serie. Fyra av sju projekt i den inspekterade ögonblicksbilden
har fastprisperioder, så det här är den granskningspost som kommer synas mest —
och den viktigaste att göra rätt.

### 7. Fakturamarkeringar — migreras som osäkra

Varje rad i `invoices` blir en `invoiceRecord`:

```js
{
  id: 'ref-<projectId>-<month>',      // deterministiskt, idempotent
  clientId: projektets kund,
  period: month,
  rader: [],                          // TOMT, vi vet inte vilka poster som ingick
  nettoOre: 0, momsOre: 0, attBetalaOre: 0,
  status: 'prepared',                 // INTE lundifySent, INTE lundifyPaid
  invoiceNumber: null,                // ALDRIG påhittat
  invoiceDate: null,
  needsReview: true,
  reviewNote: 'Migrerad från v1:s fakturamarkering projectId + month. '
            + 'Uppgiften är inte verifierad mot Lundify och kan vara fel åt båda håll.',
  source: 'migrated-from-v1',
}
```

Och en granskningspost av typ `omigrerad-fakturamarkering` per referens.

**Ingen post kopplas till dessa referenser.** Alla tidsposter, resor och utlägg
förblir `status: 'open'`. Att koppla dem hade betytt att appen påstår att just de
posterna fakturerades, vilket den inte vet.

Konsekvensen är att en period kan se ofakturerad ut trots att den fakturerades.
Det är rätt beteende: Lundify är facit, och avstämningen görs mot Lundify, inte mot
en gammal markering. Det är T10.

`invoices` behålls oförändrad som råvärde.

### 8. Migreringslogg

```js
migrationLog: [{
  at, fromVersion, toVersion,
  skapade: { articles, invoiceRecords, reviewItems },
  bevarade: { clients, projects, entries, trips, expenses, tombstones },
  kontrollsummor: { sekunder, km, utlaggOre },
  varningar: [],
}]
```

Loggen skrivs in i datat, inte bara i konsolen, så det går att se i efterhand vad
migreringen gjorde och varför.

---

## Idempotens

Andra körningen får inte skapa dubbletter. Det säkras på tre sätt:

1. `if (data.schemaVersion >= 2) return data` som första kontroll
2. Deterministiska id:n för allt migreringen skapar
3. Skapa-om-saknas i stället för skapa-alltid

Testet jämför `{artiklar, leveranser, fakturareferenser, poster}` mellan körning 1
och körning 2 och kräver exakt likhet. Det är T9.

---

## Återställning

```
1. Läs backupen från localStorage eller OneDrive
2. Visa vad den innehåller, med datum och antal
3. Kräv uttryckligt godkännande
4. Skriv tillbaka rådata
5. Nolla settings.migrationConfirmedAt
```

Backupen raderas aldrig automatiskt.

---

## v1-arkivet ska vara tekniskt skrivskyddat

När v2 tas i drift blir v1-filen ett historiskt arkiv. Ett arkiv som fortfarande
kan skrivas till är inte ett arkiv.

**Den gamla appen får inte pekas mot arkivfilen så länge den kan skriva.**
`index.html` gör en `PUT` mot samma sökväg den läser, och den skriver dessutom
automatiskt vid varje ändring. Öppnar man den gamla appen mot arkivet räcker det
med ett oavsiktligt tryck för att historiken ska skrivas om.

Skyddet ska vara tekniskt, inte en överenskommelse:

1. **Flytta arkivfilen** till en egen mapp med ett eget namn, till exempel
   `InVisionTid/arkiv/invisiontid-arkiv-v1-<datum>.json`. Den gamla appens
   hårdkodade sökväg pekar då inte på den.
2. **Sätt filen som skrivskyddad** i OneDrive, och behåll en kopia utanför
   OneDrive-synk.
3. **Avveckla den gamla deploymenten.** Så länge `invisiontid.pages.dev` kör v1
   mot `me/drive/root:/InVisionTid/invisiontid-data.json` ska den filen antingen
   vara borta eller ersatt av v2.
4. **Om historiken ska gå att läsa** byggs en läsvy in i v2, eller så används en
   variant av den gamla appen där `oneDriveWrite` och den automatiska
   sparningen är borttagna. En sådan variant ska vara en egen fil, inte samma
   `index.html` med en flagga.

Punkt 4 är viktig: att stänga av skrivningen med en konfigurationsflagga i
samma app är inte skrivskydd. Koden som kan skriva ska inte finnas i den kopian.

## Samexistens under övergången

Under en period kan samma OneDrive-fil nås av både v1 (`index.html`) och v2. Det är
den farligaste tiden.

**Skyddet:** `mergeData` bygger ett nytt objekt och listar varje toppnivåfält
explicit. En v1-klient som synkar en v2-fil skulle därför tyst radera `articles`,
`deliverables`, `invoiceRecords` och `reviewQueue`.

Därför:

- v2 skriver till en **ny fil**, `InVisionTid/invisiontid-data-v2.json`, tills
  övergången är klar. v1-filen lämnas orörd.
- v2 kan läsa v1-filen och migrera från den, men skriver aldrig till den.
- Först när v1 är avvecklad flyttas v2 till ordinarie filnamn.

Det kostar en extra fil under en övergångsperiod och tar bort hela risken för att
en glömd v1-flik på mobilen raderar den nya datamodellen.

---

## Vad som kan gå fel, och vad som händer då

| Fel | Upptäcks av | Följd |
|---|---|---|
| Poster försvinner | kontrollsumma på antal | migrering avbryts, rådata orörd |
| Tid går förlorad i fältöversättning | summa `seconds` | migrering avbryts |
| Dubbletter vid andra körningen | idempotenstest | fångas i CI, inte i produktion |
| Fastprisperiod tolkas fel | ingen automatisk tolkning sker | granskningspost, mänskligt beslut |
| Gammal fakturamarkering tolkas som sanning | `needsReview: true` alltid | period ser ofakturerad ut, stäms av mot Lundify |
| Momssats gissas | ingen sätts, `vatRate: null` | underlaget kan inte färdigställas förrän momsen är granskad |
| v1-flik raderar v2-fält | separat filnamn under övergången | inträffar inte |
| Migreringen körs av misstag | kräver uttryckligt godkännande | inträffar inte |
