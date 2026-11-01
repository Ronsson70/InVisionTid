# Kravmatris – lokal granskningsversion

Arbetsgren: `codex/billing-review`. Bas: `f73adc6`. Tidigare steg: `3e52886`,
`41cd835`. Statusen nedan gäller syntetiskt testad kod, inte godkända verkliga
kundvillkor. Inga riktiga fakturor, produktionsskrivningar, push eller deployment.

| Krav | Status | Verifiering / kvarvarande begränsning |
|---|---|---|
| Befintligt repo, backup, isolerad gren | Klart | Befintliga användarändringar ligger kvar i originalcheckouten; separat worktree och backup/bundle. |
| Ren Visa underlag, avbryt, upprepade klick | Klart/testat | UI- och logiktester: ingen skrivning före explicit Spara förberett. |
| Förberett, avstämt utkast, registrerad faktura | Klart/testat | Separata statusar/referenser; exakt netto, kund-ID, datum och manuell bekräftelse krävs. Ingen automatisk Lundifysynk. |
| Versionskontroll, dubbletter, historiska snapshots | Klart/testat | Ändrade källor blockerar avstämning; återöppning bevarar snapshot. Äldre data utan snapshot efterkonstrueras inte. |
| Bolagsisolering, kundmånad och separat uppdrag | Klart/testat | In Vision och JIK Event hålls isär; historiska källor får inte flyttas för att skapa nya fakturaunderlag. |
| Efterhandsregistrering, nya kunder/egna uppgifter | Klart/testat | Befintligt uppdragsflöde återanvänds. Kund kan skapas före Lundify-ID; inga gissade kopplingar. |
| Kundprisförslag, egna priser, passlängd/standardresa | Klart/testat | Entydigt pris inom samma kund/bolag kan väljas; historiska timmar/priser bevaras. |
| Kundprofil med uppdragsöverstyrning | Klart/testat | Betalningsvillkor, referens, faktura-/momstext per fakturerande bolag. Tomma uppdragsfält ärver. Priser/moms ligger på artiklar. |
| Sauna-typens samlade samtalsrad | Klart/testat syntetiskt | Opt-in per kund/bolag: daterad samlad timrad, antal per besök, kundtext, valfri rubrik. Olika projekt/pris/moms hålls isär. Vid öresavvikelse behålls separata rader. |
| Daterade pass med ämne | Klart/testat syntetiskt | Valfri passrubrik; ursprunglig beskrivning och kundtext behålls. Intern anteckning exporteras inte. |
| Passresor / samtalsresor | Klart/testat syntetiskt | Uttryckligt ändamål vid registrering/rättning. Äldre oklassificerade resor flaggas; ingen gissad klassificering. |
| Sju befintliga kundmodeller | Regler testade; verklig avstämning återstår | Timme, pass/samtal, administration/camp, trackingOnly/fastpris, delbetalningar, separat JIK-bolag och intern 1 kr täcks. Verkliga priser, moms, mottagare och utkast är inte godkända av tester. |
| Utlägg/material och kvittobild | Delvis testat | Belopp, moms, vidarefakturering, inbäddad bild och export utan bild testas. Canvas/bitmap är ersatta med testobjekt i UI-testet; verklig bildavkodning och filval återstår. |
| Mål 18 500/vecka och 80 000/månad | Bevarat/testat | Ingen tyst ändring av värden eller fördelningsmodell. Bolagsfilter och tydligare periodvärde/hittills. |
| Krediter och faktiskt betalt | Avsiktligt okänt | Visas som ej verifierat. Ingen nollställning eller härledning från klarmarkering. Full bokföring ingår inte. |
| Rättelse av registrerat underlag | Minsta säkra flöde klart/testat | Orsak, tid och originalreferens lagras som revisionshändelse. Upprepat klick duplicerar inte. Original, källor och belopp förblir låsta. Ingen kredit/betalning/faktura skapas. |
| Slutföra rättelse efter Lundifyåtgärd | Återstår | Kräver verklig dokumentavstämning; ingen knapp som godtyckligt frigör poster eller markerar ekonomisk rättelse klar. |
| Mobilresponsivitet | Delvis visuellt testad | Kundmall och kvittovy kontrollerade vid faktiskt uppmätta 375 px utan horisontellt överflöde. Testsidans textarea-styling korrigerad. 320/768 px begärdes men browsern rapporterade fortsatt 375 px; de bredderna är inte verifierade. |
| Kamera och telefonens bildväljare/tangentbord | Återstår på verklig enhet | Ingen kamerabehörighet begärd. Verkligt kvittoval blockerat av saknad tilläggsbehörighet; den ändrades inte. |
| Cloudflare branchregler, push/draft PR | Blockerat | Läsning av dashboard nekades av automatisk säkerhetsgranskning. Ingen push har försökts. |

## Testresultat

501 tester i 21 filer passerar på Node 24.19.0. Varje fil körs med
`IVT_MAL=v2 node --test --test-isolation=none test/FIL.test.mjs`.
Alla appmoduler syntaxkontrolleras och `git diff --check` passerar.
Separat lint/build-kommando finns inte i detta statiska projekt; inget sådant
resultat påstås. Befintlig CI anger Node 22; den versionen har inte körts lokalt.

Browserprovet sparade enbart syntetisk kundmall i prototypens separata
localStorage och verifierade den efter omladdning. Inga externa uppladdningar.
Kvittofilen var en genererad enfärgad PNG utan person- eller affärsdata.
Filväljaren kunde inte mata in den utan tilläggets "Allow access to file URLs".
Den behörigheten aktiverades inte och ingen alternativ uppladdningsväg användes.

## Exakt nästa steg för Cloudflarekontroll

1. Ronney behöver uttryckligen godkänna **läsning av sitt befintliga Cloudflarekonto
   på https://dash.cloudflare.com och inställningarna för InVisionTid Pages**.
   Ingen ny inloggning, token, behörighetsändring eller konfigurationsändring ingår.
   Detta krävs eftersom automatisk säkerhetsgranskning uttryckligen nekade
   dashboardöppningen; enbart allmänt GitHubmandat räckte inte för den granskningen.
2. Vid godkänd åtkomst: läs kopplat repo, produktionsgren, automatiska deployer,
   tillåtna previewgrenar och eventuella deploy hooks för just detta projekt.
   Om befintlig session saknas, stanna före inloggning.
3. Jämför med repots GitHub Actions och externa check-app. Om arbetsgren eller
   PR kan utlösa publicering som inte är auktoriserad: behåll arbetet lokalt.
   Ändra inga regler för att göra push möjlig.

Alternativt kan Ronney själv visa dessa specifika inställningar. Ingen token eller
hemlighet behövs. Exakt branchbeteende är fortsatt okänt, inte nekat av Cloudflare.
Det var dashboardläsningen som nekades av verktygets säkerhetsgranskning.

## Lokal testväg

Worktree: `/home/ronney/Documents/Codex/2026-10-31/task-2/invisiontid-worktree`.
Starta där med `python3 -m http.server 8765 --bind 127.0.0.1` och använd
`http://127.0.0.1:8765/prototyp/`. Använd inte produktionsstarten för detta prov.
