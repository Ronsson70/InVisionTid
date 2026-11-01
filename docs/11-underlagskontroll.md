# Lokal underlagskontroll – granskningsversion

Bas: f73adc61871ced82e5ab889342f34e2f2169d47d. Arbetsgren: codex/billing-review.
Ingen publicering eller ändring i verklig affärsdata ingår.

## Återanvänt

Befintlig datumregistrering, uppdrag per kund, tim-/pass-/fastprisartiklar,
standardresor, kvittokomprimering, OneDrive-konfliktskydd och målberäkning används.
Inga nya externa tjänster, tokens, API-klienter eller behörigheter tillkommer.
Ett eget uppdrag fungerar som återanvändbar arbetsuppgift under kunden. Nya kunder
kan fortfarande skapas i samma flöde utan Lundify-ID. Entydigt befintligt pris
inom samma kund och bolag kan användas som ett uttryckligt förslag.

## Ändrat

- Visa underlag är en ren läsning. Spara förberett är en separat åtgärd med
  versionskontroll. Upprepade sparförsök reserverar inte samma poster igen.
- Förberedda underlag bevarar rader, presentationstext, villkor och belopp.
  Uppdragsprofilen lagrar betalningsvillkor, referens, fakturatext och momstext.
  Priser/moms ligger kvar på de befintliga artiklarna.
- Separat uppdragsunderlag erbjuds när en kundgrupp innehåller flera uppdrag.
  Månadsgrupperingen per kund och fakturerande bolag är grundval.
- Manuell återrapportering skiljer sparat, avstämt utkast och registrerad faktura.
  Rätt bolag/kund/rader/moms/avrundning måste bekräftas. Kund-ID, dokumentreferens
  och exakt netto krävs; registrerad faktura kräver också fakturadatum.
  Detta är användarens observation, inte automatisk Lundify-verifiering.
- Äldre markeringar visas som oavstämda. Appstarten omvandlar inte legacy-status
  till en påstådd faktisk faktura. Äldre domänhjälpare finns kvar för kompatibilitet,
  men används inte av det nya registreringsflödet.
- Förberett/utkast kan öppnas för ändring: den gamla versionen och dess
  källsnapshot bevaras. Registrerat eller äldre oavstämt underlag får inte
  frigöras till ny fakturering genom denna knapp.
- Tidigare priser fryses när standardpris ändras. Standardlängd på pass skriver
  inte om redan registrerad arbetstid. Intern anteckning skickas inte med i text.
  Äldre anteckningsfält var kundtext och behåller sin betydelse.
- Utlägg kan registreras utan vidarefakturering. Befintlig kvittobild är fortsatt
  en arbetskopia i datafilen och skickas inte automatiskt till kunden.
- Vecko-/månadsmål behålls. Ett valt bolag avgränsar sammanställningen utan att
  räkna om målbeloppet. Hela periodens arbetsvärde och värdet hittills särredovisas.
  Fakturerat efter krediter och inbetalt visas som ej verifierat, aldrig som noll
  eller som härlett från klarmarkeradAt.

## Verifiering

501 tester passerade på Node 24.19.0: varje testfil kördes i egen process med
IVT_MAL=v2 node --test --test-isolation=none test/FIL.test.mjs. Detta undviker
att miljöns vanliga isolerade teststart endast rapporterar testfilernas exitstatus.
Alla appmodulers syntax kontrollerades; git diff --check passerade.

Testerna för underlagskontroll täcker sju anonymiserade kundmodeller: timarbete/resor,
pass plus samtal, administration som tid och separat campfastpris,
fastpris med trackingOnly och tre delar, fyra delbetalningar och avstängd
ursprungstotal, annat fakturerande bolag samt intern 1-kronasleverans.
De bevisar regler och beräkningar, INTE verkliga kundvillkor eller kundmatchningar.
Även läsning, upprepade klick, avbryt, explicit sparning, snapshots, förändrad
källa, filroundtrip, dokumentdubbletter och bolagsisolering kontrolleras.
Befintliga avrundningstester ingår i hela sviten.

Lokalt browserprov på /prototyp/: förhandsvisa/stäng/återöppna, spara uttryckligen,
ladda om och återfinna underlaget samt bolagsval med bibehållet målbelopp.
Endast syntetiska data och prototypens separata localStorage användes.

## Kvar innan införande

- Verifiera alla verkliga kunders kopplingar, priser för rätt period, moms,
  texter, villkor, referenser och befintliga Lundify-utkast. Inga affärsdata har
  rättats eller fyllts med antaganden. Ingen kund är härmed produktionsgodkänd.
- Krediter, delbetalningar från kund, kvittningar och faktiska inbetalningar har
  ingen komplett återrapporteringsmodell i denna etapp. De visas inte som kända.
- Registrerade fakturor kan få ett spårbart rättelsebehov men förblir låsta; ett komplett kredit- och
  rättelseflöde återstår. Äldre underlag behöver individuell avstämning.
- Versionskontrollen upptäcker ändringar i appens inlästa källor. Den känner inte
  till ändringar i Lundify eller en ännu oläst OneDrive-version. Läs om källorna
  före fakturering; befintligt OneDrive-konfliktskydd ersätter inte avstämning.
- Godkänd katalog över kundmatchningar återstår. Kundprofiler per fakturerande
  bolag är nu redigerbara och ärvs av tomma uppdragsfält. Priser/moms ligger kvar
  på artiklarna, med befintligt explicit prisförslag vid nya uppdrag.
- Kundprofilen kan välja separata passresor/samtalsresor. Ändamål väljs vid ny
  resa eller rättning av en öppen post. Äldre resor klassificeras inte automatiskt;
  saknat ändamål syns som verifieringsbehov. Olika projekt/priser/moms hålls isär.
  Samlad daterad timrad och egna pass-/samtalsrubriker finns nu. Se docs/12-kravmatris.md för gränser och verifiering.
- Fullständigt mobilprov, verklig kamera och produktionssynk har inte genomförts.

## GitHub och lokal start

GitHub Actions kör tester vid push och pull_request. Cloudflare Pages är anslutet
för push/pull_request och main har en lyckad deployment. Grenarnas exakta
preview-/deployregler kunde inte verifieras utan ytterligare konfigurationsåtkomst.
Därför ingen push eller PR. Ändra inte denna konfiguration som del av kodgranskningen.

Starta lokalt i worktree med python3 -m http.server 8765 --bind 127.0.0.1 och
öppna http://127.0.0.1:8765/prototyp/. Root-sidan är produktionsstarten och ska
inte användas för detta test. Säkerhetskopior ligger utanför repot i arbetsmappens
backup/, inklusive repository-before-billing.bundle och tidigare kod/data-backup.

## Uppföljande granskning av 3e52886

- Fixat: kundnamn fryses i nya snapshots, även vid senare namnändring.
- Fixat: befintligt avstämt utkast/kund kan inte ersättas med annan koppling.
  Utkast-ID och fakturanummer har separata dubblettkontroller. Fakturadatum
  måste vara ett verkligt kalenderdatum. Återöppnat utkast måste avstämmas igen
  innan nya versionen får fakturanummer; tidigare referens följer med exporten.
- Fixat: kund-/bolagsbyte kontrollerar både leveranser och historiska snapshots.
  Källposter med underlagshistorik får inte flyttas till andra uppdrag.
- Fixat: byte av arbetstyp på en öppen post använder inte föregående artikels
  prisögonblicksbild. Oförändrad artikel behåller historiskt pris.
- Tillagt: kundgemensamma villkor med bolagsisolerat arv, reseändamål och
  regression för exportens oföränderlighet efter återöppning.
- Verifierat genom kod och test: nykund/uppgift före Lundifykoppling, standardresa,
  passlängd och befintligt kvittobildsstöd. Kamera och dessa nya profilers visuella
  mobilpresentation har inte testats. Profilens sparflöde har UI-regressionstest.
- Ingen automatisk komplettering av äldre snapshots görs. Äldre underlag utan
  kundsnapshot kan därför inte garanteras visa sitt ursprungliga kundnamn.
- Inga nya kredit-/betalningsbelopp härleds; de är fortsatt ej verifierade.
- Deployblockerare: GitHub-connectorns försök att läsa deployments-endpointen
  stöddes inte (HTTP 400 INVALID_ARGUMENT). Tillgängliga Cloudflare-verktyg gäller
  andra Sites, inte detta Pages-projekt. Branchreglernas utfall är därför okänt;
  push/PR har inte försökts. GitHub Actions definierar endast tester men bevisar
  inte att Cloudflares externa app saknar publiceringstriggers.

Aktuell sammanställd kravstatus, mobilprov och exakt Cloudflareblockerare finns i `docs/12-kravmatris.md`.
