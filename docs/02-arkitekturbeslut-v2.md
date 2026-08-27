# Arkitekturbeslut för v2

Datum: 2026-08-27. Status: **förslag, inväntar godkännande.**

---

## Beslut 1 — Domänen bryts ut först, UI:n rörs inte

Den nuvarande `index.html` är 1 999 rader och innehåller allt. Den nya domänlogiken
— artiklar, kvantiteter, moms i heltalsöre, leveranser, låsta underlag och externa
fakturareferenser — är väsentligt mer omfattande än den prislogik som finns idag,
och den måste vara bevisbart korrekt innan någon rör produktionsdata.

**Beslut:** `src/domain/` skapas som rena ES-moduler utan React- eller DOM-beroende
och testas i Node. Den befintliga appen fortsätter fungera oförändrad under tiden.

**Varför inte skriva om allt på en gång:** en samtidig omskrivning av datamodell,
prislogik, UI, byggkedja och autentisering ger inga verifierbara mellanlägen. När
något går fel finns inget sätt att avgöra vilken av fem förändringar som orsakade
det. Kravspecifikationen säger det själv: undvik en stor omskrivning utan
verifierbara mellanlägen.

**Varför inte lappa in i `index.html`:** domänlogiken behöver ungefär lika många
rader som hela appen har idag. Att lägga den i samma fil gör den omöjlig att
testa isolerat och omöjlig att granska.

---

## Beslut 2 — Vite och TypeScript, men i etapp 11, inte nu

Kravspecifikationen pekar ut en byggd statisk React-app med TypeScript. Det är rätt
mål. Men byggkedjan är inte det som blockerar korrekt fakturering, och den tillför
risk i ett läge där risken ska vara låg.

**Beslut:** `src/domain/` skrivs som `.mjs` med JSDoc-typer från början. Filerna
är giltig TypeScript-indata när Vite införs, och `tsc --checkJs` kan köras mot dem
redan innan dess. Vite-flytten sker i etapp 11 när domänen är bevisad.

**En konkret fallgrop:** Cloudflare Pages autodetekterar `package.json` i roten och
kan börja köra ett byggkommando. Projektet publicerar idag statiska filer direkt.
Därför läggs **ingen `package.json` i roten** i den här etappen. Testerna körs med
Node:s inbyggda testkörare utan beroenden:

```
node --test test/*.test.mjs     alla tester
node test/rapport.mjs           läsbar acceptanstabell
```

När Vite införs ska Pages byggkommando och utdatakatalog sättas **explicit** i
samma ändring, inte lämnas åt autodetektering.

---

## Beslut 3 — Pengar är heltal öre, kvantiteter är heltal tusendelar

Inga flyttal någonstans i prissättning, moms eller avrundning.

- Belopp: heltal **öre**. 2 400 kr = `240000`.
- Kvantitet: heltal **tusendelar av enheten**. 3 timmar = `3000`, 15 minuter = `250`.
- Momssats: heltal **hundradels procent**. 25 % = `2500`, 0 % = `0`.

Radbelopp: `roundHalfUp(unitPriceOre * qtyMilli, 1000)`.
Moms per momssats: `roundHalfUp(nettoPerSats * vatRate, 10000)`.
Öresavrundning: `roundHalfUp(brutto, 100)` mot närmaste hel krona.

`roundHalfUp` implementeras på heltal och avrundar **bort från noll** vid exakt
halva, så kreditfakturor blir rätt. `Math.round(-0.5)` ger `-0` och duger inte.

Inget decimalbibliotek behövs. Med heltalsaritmetik ligger alla mellanled långt
under `Number.MAX_SAFE_INTEGER` — en faktura på 50 000 kr är `5000000`, och största
mellanprodukt i `unitPriceOre * qtyMilli` för realistiska belopp är i
storleksordningen 10¹⁰. Det är avsevärt enklare att granska än en beroendekedja.

**Verifierat mot acceptansfallen:** T2 ger 285 462,5 öre moms, som ROUND_HALF_UP
ger 285 463. T1 ger brutto 23 968,75 kr som avrundas upp till 23 969. T3 ger
9 187,50 kr som avrundas upp till 9 188. Alla tre faller ut rätt med reglerna ovan.

---

## Beslut 4 — Priset sitter på artikeln, inte på projektet

Det här är den enda ändring som löser grundproblemet.

Idag väljer `pricingModel(project)` en modell för hela projektet. I v2 finns
**arbetstyper/artiklar** under ett projekt, och varje registrering pekar på en
artikel. Ett projekt kan därmed ha behandlingspass à 2 400 kr med en momssats och
samtal à 850 kr per timme med en annan, samma dag.

`pricingModel`, `hasSessionPrice`, `isFixedPrice`, `getActivePeriod`,
`calcFixedMonthly` och `getFixedWeeklyAmount` avvecklas. De löser ett problem som
inte längre finns när kvantitet och artikel är egna begrepp.

**Fastpris blir leverans, inte period.** En genomförd verkstad är en leverans med
belopp, moms, ordning och status. Den fördelas inte över kalendertid. Undantaget är
avtal som uttryckligen är periodiserad månadsersättning — då modelleras det som en
återkommande leverans per månad, inte som en dagfördelning.

---

## Beslut 5 — Fakturaunderlaget äger sina poster, och priset fryses vid låsning

Ett underlag hör till en **kund**, inte till ett projekt, och pekar explicit på de
poster som ingår. När underlaget låses skrivs `unitPriceOre` och `vatRate` in på
varje rad som ett **snapshot**. En senare prisändring på artikeln rör inte redan
låsta rader.

Det gör tre saker som dagens `projectId + month` inte kan: en post som läggs in i
efterhand syns som öppen i stället för att tyst hamna utanför, en faktura kan
innehålla poster från flera uppdrag hos samma kund, och historiken går inte att
skriva om i efterhand.

---

## Beslut 6 — Lundify är facit, appen påstår ingenting

Statusarna hålls isär som separata tillstånd, inte som en flagga:

```
open → prepared → lundifyDraft → lundifySent → lundifyPaid
```

`invoiceNumber` är `null` fram till `lundifySent` och kan aldrig sättas av appen
själv. Ett Lundify-utkast är inte en skickad faktura. Övergången till `lundifySent`
kräver ett verkligt fakturanummer och avvisas utan.

**Ingen Lundify-integration byggs** förrän förstudien i `docs/06-lundify-forstudie.md`
är genomförd och godkänd. Adaptergränssnittet `src/integrations/lundify/` definieras
så att manuell överföring och en framtida API-överföring använder exakt samma
underlag, men bara den manuella implementationen finns.

En statisk PWA får aldrig innehålla långlivade Lundify-nycklar. Om ett API blir
aktuellt krävs en mellanserver.

---

## Beslut 7 — Autentiseringen byts separat, efter datamigreringen

Implicit flow med access token i `localStorage` ska bort till förmån för MSAL med
authorization code flow och PKCE. Men det är en egen etapp med egen verifiering.

Att byta inloggning och datamodell samtidigt betyder att ett synkfel kan komma från
antingen tokenhanteringen eller migreringen, utan sätt att avgöra vilket. Etapp 10,
efter att datamodellen är i drift och stabil.

---

## Föreslagen filstruktur

```
index.html                    v1-appen, orörd tills domänen är bevisad
test.html                     v1:s browsertester, orörda

src/
  domain/
    pengar.mjs                heltalsöre, roundHalfUp, formatering
    moms.mjs                  momsunderlag per sats, öresavrundning
    artiklar.mjs              arbetstyper, enheter, giltighetsregler
    poster.mjs                registreringar, status, snapshots
    leveranser.mjs            fasta leveranser och milstolpar
    underlag.mjs              faktureringsunderlag, radbygge, låsning
    fakturareferens.mjs       statusflödet mot Lundify
    granskning.mjs            granskningskön
    migrering.mjs             v1 → v2, ren och idempotent
    index.mjs                 samlad export, adapterns yta

  data/
    lokal.mjs                 localStorage
    onedrive.mjs              Microsoft Graph
    merge.mjs                 merge och tombstones
    backup.mjs                daterad backup och återställning

  features/                   UI per arbetsflöde, införs stegvis
    registrering/
    granskning/
    fakturering/
    uppfoljning/
    grunddata/

  integrations/
    microsoft/                inloggning och kalender
    lundify/                  adaptergränssnitt, ej aktiverat

test/
  lib/pure-v1.mjs             laddar v1-funktioner ur index.html
  adapters/v1.mjs             v1 mot v2-kontraktet
  adapters/v2.mjs             läggs till i etapp 3
  acceptance-checks.mjs       T1–T13
  acceptance.test.mjs
  v1-skyddsnat.test.mjs       migrate och mergeData
  rapport.mjs

test-fixtures/
  scenarier.mjs               syntetiska acceptansfixtures
  v1-legacy.json              syntetisk v1-fil för migreringstester
  privat/                     gitignorerad, aldrig i repot
```

---

## Vad som medvetet inte görs

**Ingen server och ingen extern databas.** OneDrive förblir användarens privata
datalager. Cloudflare Pages publicerar statiska filer.

**Ingen multi-user, ingen delning.** Appen är personlig. Andra personers arbetstid
ligger utanför.

**Ingen automatisk skrivning till produktionsdata.** Migreringen körs i minnet och
visar en sammanfattning. Skrivningen kräver ett uttryckligt godkännande.

**Ingen avveckling av `test.html`.** Browsertesterna behålls så länge `index.html`
lever. De två testsviterna mäter olika saker och ska båda vara gröna.
