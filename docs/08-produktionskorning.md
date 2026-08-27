# Så genomförs en produktionsmigrering

> Dokumentet beskriver vad som **ska** ske. Ingenting av det har utförts.

Status: **beskrivning, inte utförande.** Ingen del av detta har körts mot verklig
data. Etapp 4A är byggd och testad mot syntetiska fixtures i minnet. Kopplingen
mot ett verkligt lager finns inte ännu — den byggs i etapp 4B, efter godkännande.

---

## Vad som redan finns, och vad som saknas

**Finns:** hela beslutskedjan. Backup med checksumma, förhandsgranskning i
minnet, uttryckligt godkännande, skrivning, återställning. Testad i 31 fall.

**Saknas:** de två funktioner som faktiskt läser och skriver.

Det är avsiktligt. `migreringskorning.mjs` tar emot `las`, `skriv` och
`sparaBackup` som argument. Under etapp 4A pekar de på ett objekt i minnet. I
etapp 4B pekar de på OneDrive. Domänen och beslutskedjan ändras inte alls
däremellan — bara vad de två funktionerna gör.

Det är också därför en bugg i migreringen inte kan nå produktionsdata av misstag:
det finns inget att nå. `src/` innehåller varken `fetch`, `localStorage` eller
`node:fs`, och ett test ser till att det förblir så.

---

## Steg 0 — Fastställ vilken fil som är den aktiva

**Detta måste ske först, och det är inte en formalitet.**

Det finns flera filer med namnet `invisiontid-data.json` på olika platser. Appen
läser och skriver mot `me/drive/root:/InVisionTid/`. En äldre kopia i en annan
mapp är daterad 2026-03-31 och är **inte** produktionskälla. Den aktiva
kandidaten var senast ändrad 2026-08-11.

Verifieringen sker genom appens egen Graph-koppling och redovisar:

- filens fullständiga sökväg och ändringsdatum
- `lastSync` i filens innehåll
- antal per samling: `clients`, `projects`, `entries`, `expenses`, `trips`,
  `invoices`, tombstones
- filens storlek i byte och dess SHA-256

Stämmer inte antalen mot vad som rimligen borde finnas, **avbryts allt** och
frågan utreds innan något annat sker. Att migrera fel fil vore att skriva över
aktuell data med gammal.

---

## Steg 1 — Läs rådata som text

Läsningen returnerar **text**, inte ett tolkat objekt.

`forberedMigrering` avvisar en läsfunktion som returnerar något annat än en
sträng, med just den motiveringen: backupen kan bara bevara byte om den får byte.

---

## Steg 2 — Backup av rådata, orörd

Backupen sparar råtexten som den lästes. Inte en tolkad kopia.

Skälet är konkret. `JSON.parse` följt av `JSON.stringify` bevarar inte
nyckelordning, blanksteg, talformat eller Unicode-escaper. `1.50` blir `1.5`.
`"å"` blir `"å"`. En backup som återställer "samma data" men inte samma byte
är inte en backup, den är en tolkning. Ett test låser fast just det fallet.

Backupen bär:

| | |
|---|---|
| `ravara` | råtexten, orörd |
| `checksumma` | SHA-256 |
| `byteLangd` | UTF-8-byte, inte tecken — å, ä och ö är två byte var |
| `skapad`, `kalla`, `filnamn` | spårbarhet |

Filnamn: `invisiontid-backup-2026-08-27T10-00-00.json`. Inga understreck, inga
kolon. Mönstret är redan gitignorerat.

Backupen skrivs till **två** platser innan något annat sker: `localStorage` och
`InVisionTid/backup/` i OneDrive.

---

## Steg 3 — Verifiera backupen

Checksumma och bytelängd räknas om och jämförs. Stämmer de inte avbryts
migreringen innan den börjat. En manipulerad eller trunkerad backup kan inte
heller återställas — `aterstallFranBackup` verifierar först och vägrar leverera
trasig data.

---

## Steg 4 — Migrera i minnet

Migreringen är en ren funktion. Den läser ingen fil, skriver ingen fil, anropar
inget nätverk och tittar inte på klockan. Tidsstämpeln skickas in.

Ingenting sparas i det här steget. Att förhandsgranskningen inte kan spara är en
egenskap hos konstruktionen: modulen importerar ingenting som kan skriva.

---

## Steg 5 — Kontrollsummor och idempotens

| Kontroll | Krav |
|---|---|
| antal `clients`, `projects`, `entries`, `expenses`, `trips`, `invoices`, tombstones | får inte minska |
| summa `entries[].seconds` | **exakt** oförändrad |
| summa `trips[].km` | **exakt** oförändrad |
| summa `expenses[].amount` | **exakt** oförändrad |
| andra körningen i minnet | får inte skapa något nytt |

Avviker något blir förhandsgranskningen underkänd, och `genomforMigrering` vägrar
skriva. Summorna är viktigare än antalen: antalet poster kan stämma medan tid har
gått förlorad i en felaktig fältöversättning.

---

## Steg 6 — Granska sammanfattningen

Sammanfattningen visar, med den syntetiska fixturen som exempel:

```
Bevarat, får inte minska
  entries                            7 → 7
  trips                              2 → 2
Kontrollsummor, ska vara oförändrade
  sekunder                           57600 → 57600   oförändrad
  km                                 90 → 90   oförändrad
Skapas av migreringen
  artiklar                           9
  leveranser                         0   (fastpris omvandlas aldrig automatiskt)
  fakturareferenser                  3   (alla osäkra, utan fakturanummer)
Kräver granskning innan fakturering
  artiklar med ogranskad moms        9 av 9
  bevarade fastprisperioder          2
```

**Tre saker ska granskas post för post innan godkännande:**

1. **Artiklar med ogranskad moms.** Alla, alltid. v1 har ingen momssats, så varje
   artikel får `vatRate: null` och `vatStatus: 'needsReview'`. Ett underlag kan
   inte färdigställas förrän momsen är satt. Behandlingspassen är det fall som
   kräver ett faktiskt beslut mot avtalet.

2. **Bevarade fastprisperioder.** Ingen har omvandlats till en leverans. Råvärdet
   ligger kvar och varje period har en granskningspost som bär originalet. Beslutet
   fattas period för period.

3. **Migrerade fakturamarkeringar.** Alla har `invoiceNumber: null` och
   `needsReview: true`. Ingen post är kopplad till dem. Konsekvensen är att en
   period kan se ofakturerad ut trots att den fakturerades — det är rätt beteende.
   Avstämningen görs mot Lundify, inte mot en gammal markering.

Kör `node test/migreringsdemo.mjs` för att se hela flödet mot den syntetiska
fixturen.

---

## Steg 7 — Uttryckligt godkännande

```js
godkannande({ av: 'Ronney', at: '2026-…', bekraftelse: 'JA, SKRIV' })
```

Bekräftelsen måste vara ordagrann. `true`, `'ja'` eller ett kryss räcker inte.
Godkännandet bär vem som godkände och när, och stämplas in i datat som
`settings.migrationConfirmedAt`.

**Appen får aldrig migrera vid uppstart.** Migreringen är en åtgärd användaren
startar, inte något som händer.

---

## Steg 8 — Skrivning

Ordningen är låst i koden: backupen sparas **först**. Misslyckas den anropas
skrivfunktionen aldrig, och felet säger uttryckligen att källan är orörd. Ett
test provar just det med en backupfunktion som kastar.

v2 skriver till en **ny fil**, `InVisionTid/invisiontid-data-v2.json`.
v1-filen lämnas orörd tills övergången är klar.

Skälet: `mergeData` i v1 bygger ett nytt objekt och listar varje toppnivåfält
explicit. En glömd v1-flik på mobilen som synkar mot en v2-fil skulle tyst radera
`articles`, `deliverables`, `invoiceRecords` och `reviewQueue`. Med separata filer
kan det inte inträffa. Det kostar en extra fil under en övergångsperiod.

---

## Steg 9 — Återställning om något är fel

```js
aterstallMigrering({ backup, skriv, godkant })
```

Verifierar backupen, skriver tillbaka råtexten byte för byte och kräver samma
ordagranna godkännande som en migrering. Ett test bevisar att originalets
SHA-256 återkommer exakt efter en genomförd migrering och en återställning.

Backupen raderas aldrig automatiskt.

---

## Vad som händer vid avbrott

| Avbrott | Följd |
|---|---|
| Fel fil identifierad i steg 0 | allt avbryts, inget läses |
| Läsfunktionen ger objekt i stället för text | avvisas, inget skrivs |
| Backupen kan inte skrivas | skrivfunktionen anropas aldrig, källan orörd |
| Backupen verifieras inte | migreringen avbryts före förhandsgranskningen |
| Rådata är inte giltig JSON | förhandsgranskningen underkänns, inget skrivs |
| Kontrollsumma avviker | förhandsgranskningen underkänns, inget skrivs |
| Migreringen är inte idempotent | förhandsgranskningen underkänns, inget skrivs |
| Godkännande saknas eller är felformulerat | inget skrivs |
| Skrivfunktioner saknas | inget skrivs |
| Förberedelsen körs två gånger | avvisas |

Varje rad har ett test. I samtliga fall är antalet skrivningar till källan noll,
och källans innehåll är byte-identiskt med utgångsläget.

---

## Vad som återstår innan detta kan köras skarpt

1. **Etapp 4B:** `las`, `skriv` och `sparaBackup` mot OneDrive och localStorage.
   Egna moduler, egna tester.
2. **Verifiering av den aktiva filen** enligt steg 0.
3. **Godkännande** att över huvud taget läsa den aktiva filen för en verklig
   förhandsgranskning.

Punkt 3 är en egen stoppunkt. En förhandsgranskning skriver ingenting, men den
läser verklig data, och det beslutet är inte mitt.
