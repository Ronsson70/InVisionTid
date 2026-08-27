# Genomförandeplan

Varje etapp ska lämna appen körbar. Efter varje etapp redovisas vad som ändrades,
vilka tester som kördes och resultatet, om dataformatet ändrades, risker och öppna
frågor, samt nästa etapp.

**Stoppunkt** betyder att arbetet avstannar och inväntar uttryckligt godkännande
innan nästa etapp påbörjas.

---

## Etapp 1 — Läsande analys ✔ klar

Genomgång av `CLAUDE.md`, `README.md`, `index.html`, `test.html` och git-historiken.
Strukturell inspektion av en gammal produktionsögonblicksbild, utan att läsa ut
några värden.

**Levererat:** `docs/01-nulagesanalys.md`, `docs/02-arkitekturbeslut-v2.md`,
`docs/03-datamodell-v2.md`, `docs/04-migreringsstrategi.md`,
`docs/06-lundify-forstudie.md`, `docs/07-oppna-fragor.md`.

**Fynd som ändrade planen:** den lokala kopian låg tre commits efter `origin/main`.
`migrate()` och `mergeData()` ligger utanför PURE-sektionen och saknade all
testtäckning.

---

## Etapp 2 — Fixtures och acceptanstester ✔ klar

**Levererat:** `test-fixtures/scenarier.mjs`, `test-fixtures/v1-legacy.json`,
`test/` med adaptermönster, acceptanskontroller T1–T13 och skyddsnät för
`migrate()` och `mergeData()`.

**Resultat:** skyddsnätet 13 av 13 gröna. Acceptansbaslinjen mot v1: 2 godkända
(T7, T12), 1 fel svar (T8: 2 400 kr i stället för 3 250 kr), 10 utan stöd.

**Dataformatet:** oförändrat. Ingen produktionsdata har lästs, ändrats eller skrivits.

### ⛔ Stoppunkt 1 — här är vi nu

Godkännande krävs för datamodellen i `docs/03-datamodell-v2.md`, migreringsstrategin
i `docs/04-migreringsstrategi.md` och svaren på `docs/07-oppna-fragor.md` innan
etapp 3 påbörjas.

---

## Etapp 3 — Domänen: pengar, moms, artiklar, migrering i minnet

Bygger `src/domain/`: `pengar.mjs`, `moms.mjs`, `artiklar.mjs`, `poster.mjs`,
`leveranser.mjs`, `underlag.mjs`, `fakturareferens.mjs`, `migrering.mjs`.
Lägger till `test/adapters/v2.mjs`.

**Klar när:** `IVT_MAL=v2 node --test test/*.test.mjs` är grön på alla T1–T13, och
skyddsnätet fortfarande är grönt.

**Rör inte:** `index.html`, produktionsdata, OneDrive.

**Risk:** låg. Ingenting av detta är kopplat till appen ännu.

---

## Etapp 4 — Backup, förhandsgranskning och återställning

Bygger `src/data/backup.mjs` och en migreringsvy som visar före/efter-antal och
kontrollsummor. Skrivningen ligger bakom ett uttryckligt godkännande.

**Klar när:** en migrering kan köras mot en kopia av rådata, visas, godkännas,
skrivas och återställas — och kontrollsummorna stämmer.

### ⛔ Stoppunkt 2 — före första skrivningen mot produktionsdata

Detta är den enda punkt där oåterkallelig skada kan uppstå. Krav innan skrivning:

1. Daterad backup verifierat skriven och läsbar
2. Migreringen körd i minnet mot en kopia av verklig data
3. Sammanfattningen genomgången post för post
4. Alla granskningsposter genomgångna, särskilt fastprisperioderna
5. Uttryckligt godkännande

---

## Etapp 5 — Registrering med flera arbetstyper per uppdrag

Idag-vyn byggs om: välj först uppdrag, sedan arbetstyp, och inmatningen anpassas
efter enheten. Snabbknappar bygger på uppdrag + arbetstyp, inte bara på projekt.
Arbetad tid och pengar visas som separata värden.

**Bevaras:** timern med återupptagning, manuell registrering, Snabb tid, resor,
utlägg, reseförslag, eftersläpningsvarning.

---

## Etapp 6 — Granskningskö och säkrare kalenderkoppling

Bygger granskningskön för alla åtta typerna. Kalenderimport föreslår koppling ur
tidigare mönster men kräver bekräftelse per händelse. `importAllEvents` i sin
nuvarande form avvecklas.

---

## Etapp 7 — Faktureringsunderlag och manuell Lundify-överföring

Kundbaserat underlag med posturval över flera uppdrag, förhandsgranskning med
moms per momssats och öresavrundning, låsning med prissnapshot, samt
`manuellAdapter` med urklipp, PDF- och Excel-export och checklista.

**Klar när:** T1–T6 och T13 fungerar i den riktiga appen, inte bara i testerna.

---

## Etapp 8 — Uppföljning

Arbetad tid, fakturerbart nu, överfört till Lundify, skickat och betalt enligt
Lundify, fastprisintäkt mot nedlagd tid, effektiv intäkt per arbetad timme, resor
och utlägg, samt internt och ideellt arbete tydligt skilt från fakturerbart.

---

## Etapp 9 — Lundify-utredning

Frågorna i `docs/06-lundify-forstudie.md` ställs till Lundify.

### ⛔ Stoppunkt 3 — ingen integration byggs innan svaren är godkända

---

## Etapp 10 — Microsoft-inloggningen

Implicit flow med token i `localStorage` byts mot MSAL med authorization code flow
och PKCE. Egen etapp, egen verifiering, ingen annan förändring samtidigt.

---

## Etapp 11 — Vite, TypeScript och produktionspaket

Byggkedjan införs sist, när domänen är bevisad. Cloudflare Pages byggkommando och
utdatakatalog sätts **explicit** i samma ändring.

Visuell kontroll på mobil och desktop, alla tester körs, produktionspaket byggs.

---

## Ordningens logik

Domänen först, för att den är testbar utan UI och för att allt annat vilar på den.
Backup och förhandsgranskning före all skrivning, för att det är där oåterkallelig
skada kan uppstå. Registrering före fakturering, för att fakturering utan artiklar
på posterna är meningslös. Lundify och auth sist, för att de är externa beroenden
som inte ska blandas ihop med datamigreringen. Byggkedjan allra sist, för att den
inte löser något av problemen.
