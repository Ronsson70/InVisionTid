# Datamodell v2

`schemaVersion: 2`. Alla belopp i **heltal öre**, alla kvantiteter i **heltal
tusendelar av enheten**, alla momssatser i **heltal hundradels procent**.

Fält som är nya i v2 markeras **ny**. Fält som finns i v1 behåller sitt namn och
sin betydelse, så migreringen blir så liten som möjligt.

---

## Toppnivå

```js
{
  schemaVersion: 2,

  clients: [],            // v1, oförändrad struktur
  projects: [],           // v1 + nya fält
  articles: [],           // ny — arbetstyper och artiklar
  entries: [],            // v1 + nya fält
  deliverables: [],       // ny — fasta leveranser och milstolpar
  trips: [],              // v1 + nya fält
  expenses: [],           // v1 + nya fält
  invoiceRecords: [],     // ny — faktureringsunderlag och Lundify-referens
  reviewQueue: [],        // ny — granskningskö
  invoices: [],           // v1, BEHÅLLS ORÖRD som råvärde, används inte i beräkning

  deletedIds: {},         // v1, tombstones
  settings: {},           // v1 + nya inställningar
  hourlyRate, kmRate, weeklyGoal,   // v1, fallback vid migrering

  migrationLog: [],       // ny — vad migreringen gjorde och varför
  lastSync,
}
```

`invoices` behålls **oförändrad**. Den är opålitlig och får inte styra någonting,
men råvärdet ska aldrig kastas bort. Migreringen läser den och skapar osäkra
`invoiceRecords`, men originalet ligger kvar för spårbarhet.

---

## Kund

```js
client = {
  id, name, contact, phone, email, orgNr, address,
  status: 'active' | 'paused' | 'closed',

  // ny
  lundifyCustomerId: null,      // valfri, för framtida mappning
  defaultPaymentTerms: null,    // t.ex. 30, dagar
  invoiceReference: null,       // kundreferens som ska stå på fakturan
  notes: null,
}
```

Oförändrad från v1 utöver de nya valfria fälten. Ingen migrering behövs.

---

## Uppdrag/projekt

```js
project = {
  id, name, clientId,
  defaultTripKm,                // v1, används av reseförslaget

  // ny
  kind: 'billable' | 'internal' | 'voluntary',   // standard: 'billable'
  series: null,                 // t.ex. verkstadsserie, fritext
  active: true,
  sortOrder: 0,
  archivedAt: null,

  // BEHÅLLS men används inte i beräkning
  hourlyRate, sessionPrice, pricingPeriods,
}
```

`kind` är det som gör att fakturerbart konsultarbete, internt bolagsarbete och
ideellt arbete kan hållas isär i uppföljningen. Endast `billable` kan hamna på ett
fakturaunderlag.

`hourlyRate`, `sessionPrice` och `pricingPeriods` ligger kvar som råvärden efter
migreringen. De läses aldrig av v2:s prislogik, men de är källan till de artiklar
migreringen skapar, och de behövs om en granskning behöver se vad som fanns.

---

## Arbetstyp/artikel — **ny**

Det här är kärnan i lösningen. Priset sitter här, inte på projektet.

```js
article = {
  id,
  projectId,
  name,                         // "Behandlingspass", "Isspolning", "Resa"

  type: 'hourly'                // debiteras per timme
      | 'session'               // debiteras per pass eller tillfälle
      | 'piece'                 // debiteras per styck
      | 'travel'                // debiteras per kilometer
      | 'fixedDeliverable'      // fast leverans, se deliverables
      | 'trackingOnly',         // loggas för uppföljning, faktureras aldrig

  unit: 'tim' | 'pass' | 'st' | 'km' | 'kr',

  unitPriceOre,                 // heltal öre, 2 400 kr = 240000

  vatRate,                      // heltal hundradels procent, 25 % = 2500, 0 % = 0
                                // NULL = momssatsen är okänd, inte "noll procent"
  vatStatus: 'reviewed'         // momssatsen är granskad och får användas
          | 'needsReview',      // momssatsen är okänd, blockerar färdigt underlag
  vatCode: null,                // valfri momskod om Lundify kräver det

  billable: true,
  active: true,
  sortOrder: 0,

  // kontroll
  needsReview: false,
  reviewNote: null,

  // framtida mappning, alla valfria
  lundifyArticleId: null,
  lundifyArticleNumber: null,
}
```

**Regler**

- `trackingOnly` har alltid `billable: false` och `unitPriceOre: 0`. Den får aldrig
  bli en fakturarad. Det är så T4 håller loggad tid utanför verkstadens 50 000 kr.
- `type: 'fixedDeliverable'` prissätts via `deliverables`, inte via `unitPriceOre`
  på registreringar. Fältet finns för att kunna visa ett riktvärde.
- **`vatRate: null` betyder okänd momssats, inte noll procent.** Skillnaden är
  avgörande. `0` är ett granskat beslut, `null` är frånvaron av ett beslut.
- **`vatStatus: 'needsReview'` blockerar färdigställande av ett underlag.** Ett
  underlag kan byggas och förhandsgranskas, men inte låsas eller överföras, så
  länge någon rad bygger på en ogranskad momssats. Det är den mekanism som gör
  att en gissad moms aldrig kan nå en faktura.
- Migreringen sätter alltid `vatRate: null` och `vatStatus: 'needsReview'` på
  härledda artiklar. Den befäster varken 0 % eller hittar på 25 %.

**Enhet och kvantitet hänger ihop**

| type | unit | qtyMilli betyder |
|---|---|---|
| `hourly` | `tim` | 3000 = 3 timmar |
| `session` | `pass` | 8000 = 8 pass |
| `piece` | `st` | 12000 = 12 stycken |
| `travel` | `km` | 230000 = 230 km |
| `trackingOnly` | `tim` | 12000 = 12 timmar, aldrig fakturerat |

Det är den här tabellen som gör att åtta behandlingspass samma dag blir 19 200 kr
och inte 2 400 kr, och att tolv isspolningar en tisdag går att uttrycka alls.

---

## Registrerad arbetsinsats

```js
entry = {
  id,
  projectId,                    // v1
  articleId,                    // ny
  date,                         // v1, 'YYYY-MM-DD'
  description,                  // ny, ersätter v1:s moment
  moment,                       // v1, behålls som råvärde vid migrering

  qtyMilli,                     // ny, fakturerbar kvantitet
  seconds,                      // v1, arbetad tid, FRIVILLIGT separat mått

  // snapshot, sätts först vid låsning, null dessförinnan
  priceSnapshot: null,          // { unitPriceOre, vatRate, unit, articleName }

  status: 'open' | 'included' | 'excluded' | 'needsReview',
  invoiceRecordId: null,

  createdAt, updatedAt,         // v1 + ny updatedAt
  calEventId,                   // v1
  note,                         // v1
}
```

**`qtyMilli` och `seconds` är två skilda saker och blandas aldrig.** För en
timartikel härleds `qtyMilli` från `seconds` vid registrering, men de kan skilja sig:
man kan ha lagt tre timmar på ett behandlingspass som faktureras som ett pass. Det
är precis den skillnaden som gör lönsamhetsuppföljningen möjlig.

**`priceSnapshot` sätts vid låsning, inte vid registrering.** En öppen post ska
följa med prisändringar. En låst post får inte göra det. Det är T11.

---

## Fast leverans eller milstolpe — **ny**

```js
deliverable = {
  id,
  projectId,
  name,                         // "Verkstad 1, serie Sörmland"
                                // "Förstudie del 1 av 4"
  amountOre,
  vatRate,
  order,                        // 1, 2, 3 … för delfakturering
  partOf: null,                 // { total: 4 } när leveransen är del av en serie

  status: 'planned' | 'open' | 'included' | 'invoiced',
  completedAt: null,            // datum då leveransen genomfördes
  invoiceRecordId: null,
  priceSnapshot: null,

  needsReview: false,
  reviewNote: null,

  createdAt, updatedAt,
}
```

**Fastpris fördelas aldrig över kalenderdagar, veckor eller månader.** En verkstad
är genomförd eller inte. En förstudiedel är levererad eller inte.

Undantaget är avtal som uttryckligen är periodiserad månadsersättning. Då skapas en
leverans per månad med `order` som löpnummer — inte en dagfördelning.

---

## Resa och utlägg

```js
trip = {
  id, projectId, date, km,      // v1
  articleId,                    // ny, pekar på en travel-artikel
  qtyMilli,                     // ny, km * 1000
  description,                  // v1
  suggested: false,             // ny, kom förslaget från defaultTripKm
  priceSnapshot, status, invoiceRecordId,
  createdAt, updatedAt,
}

expense = {
  id, projectId, date, amount,  // v1, amount i KRONOR
  amountOre,                    // ny, samma belopp i öre
  articleId,                    // ny
  description,                  // v1
  rebillable: true,             // ny, ska utlägget vidarefaktureras
  receiptRef: null,             // ny, referens till kvitto
  hasReceipt: false,            // ny
  priceSnapshot, status, invoiceRecordId,
  createdAt, updatedAt,
}
```

`amount` behålls parallellt med `amountOre` genom hela v2. Skulle något återstående
v1-anrop läsa `amount` får det rätt värde, och `mergeData` från en gammal klient
tappar inte beloppet.

`hasReceipt: false` eller tom `description` lägger utlägget i granskningskön. Det är
kravet från det uppdrag som har vidarefakturerade utlägg: de får inte tappas bort.

---

## Faktureringsunderlag och extern fakturareferens — **ny**

Ett objekt bär både underlaget och referensen mot Lundify.

```js
invoiceRecord = {
  id,
  clientId,                     // underlaget hör till KUNDEN, inte till projektet
  period,                       // 'YYYY-MM', informativt
  createdAt, updatedAt,

  // raderna, i den ordning de ska läggas in i Lundify
  rader: [{
    sourceType: 'entry' | 'trip' | 'expense' | 'deliverable',
    sourceId,
    projectId,
    articleId,
    beskrivning,
    qtyMilli,
    unit,
    unitPriceOre,               // snapshot
    vatRate,                    // snapshot
    nettoOre,
    lundifyArticleNumber: null,
  }],

  // summering, allt i heltal öre
  nettoOre,
  momsUnderlag: { 0: ore, 2500: ore },   // netto per momssats
  momsOre,
  bruttoForeAvrundningOre,
  avrundningOre,
  attBetalaOre,

  // tillstånd — fem separata lägen, inte en flagga
  status: 'prepared'            // förberett underlag i In Vision Tid
        | 'lundifyDraft'        // överfört eller registrerat som utkast
        | 'lundifySent'         // skickad i Lundify med verkligt fakturanummer
        | 'lundifyPaid'         // betald enligt Lundify
        | 'cancelled',

  // Lundify — alla valfria, ingen fylls i av appen själv
  lundifyDraftId: null,
  lundifyInvoiceId: null,
  invoiceNumber: null,          // NULL tills fakturan faktiskt har skickats
  invoiceDate: null,
  dueDate: null,
  paidDate: null,

  paymentTerms: null,
  customerReference: null,
  invoiceText: null,

  needsReview: false,
  reviewNote: null,

  // spårbarhet
  source: 'app' | 'migrated-from-v1',
}
```

**Statusregler**

| Från | Till | Villkor |
|---|---|---|
| — | `prepared` | Minst en rad, alla poster reserverade |
| `prepared` | `lundifyDraft` | Manuellt bekräftat. **Inget fakturanummer krävs** |
| `lundifyDraft` | `lundifySent` | **Kräver `invoiceNumber` och `invoiceDate`** |
| `lundifySent` | `lundifyPaid` | Kräver `paidDate` |
| valfri | `cancelled` | Frigör alla poster till `open` |

`invoiceNumber` kan aldrig sättas av appen. Ett utkast är inte en skickad faktura.
Övergången till `lundifySent` utan fakturanummer avvisas. Det är T13.

**Öppna poster** är inget eget tillstånd i `invoiceRecords` utan är helt enkelt
poster med `status: 'open'` och `invoiceRecordId: null`. De fem tillstånden i
kravspecifikationen blir alltså: öppna poster (på posten), och fyra `status`-lägen
på underlaget.

---

## Granskningskö — **ny**

```js
reviewItem = {
  id,
  typ: 'kalenderhandelse'       // händelse utan uppdrag
     | 'saknad-resa'            // dag utan standardresa
     | 'utlagg-utan-kvitto'
     | 'post-utan-artikel'
     | 'osaker-moms'
     | 'osakert-pris'
     | 'efterslapning'
     | 'omigrerad-fakturamarkering'
     | 'avtalstotal',           // t.ex. 60 000 mot 64 000
  ref,                          // id på det objekt som ska granskas
  beskrivning,
  forslag: null,                // appens förslag, aldrig automatiskt tillämpat
  severity: 'info' | 'varning',
  createdAt,
  resolvedAt: null,
}
```

Kön är **härledd där det går** och lagrad där den bär ett beslut. Saknad resa och
eftersläpning räknas fram vid visning ur `defaultTripKm` och `staleStatus`, precis
som idag. Migrerade fakturamarkeringar och avtalsflaggor lagras, eftersom de bär
ett granskningsbeslut som måste överleva en synk.

---

## Inställningar

```js
settings = {
  staleWarningDays: 7,          // v1
  defaultVatRate: 2500,         // ny
  defaultPaymentTerms: 30,      // ny
  roundToWholeKrona: true,      // ny, öresavrundning på fakturan
  migrationConfirmedAt: null,   // ny, när användaren godkände migreringen
}
```

---

## Vad som medvetet inte modelleras

**Ingen fakturanummerserie i appen.** Lundify äger numreringen.

**Ingen bokföring.** Kontering, momsdeklaration och betalningsavstämning ligger
i Lundify.

**Inga andra personers arbetstid.** Modellen har ingen `userId` och ska inte få det.

**Ingen valuta.** Allt är SEK. Ett `currency`-fält skulle antyda en flexibilitet
som inte finns och som ingen har efterfrågat.
