# Mobilregistrering och fakturaunderlag

Lokalt byggd 2026-10-04. Ännu inte publicerad.

## Användning

Telefonens startvy behåller Tillfälle, Tid och Resa. Kvitto/inköp har en egen
knapp. Utförare och samråd ligger bakom en stängd detaljsektion.

Behandlingspass kräver ett tema. Temat följer med till fakturatexten tillsammans
med datum. Arbetsbeskrivning, utförare och samråd kan rättas på en öppen post.

Resan anges i kilometer totalt tur och retur. Separata besök registreras som
separata poster. Exporten samlar resor med samma pris, enhet och moms på en rad;
originalposterna finns kvar. Resor med olika pris/moms eller där summerad rad
skulle förändra öresavrundningen hålls isär. Ett materialinköp föreslår inte i
sig en resa till kunden.

## Företag och priser

Välj fakturerande företag i varje uppdrag. Grupperingen använder företag, kund
och månad. Ett företag får aldrig ta med ett annat företags poster i samma
underlag. Äldre uppdrag får inget företag gissat åt sig. Företag måste väljas
innan ett nytt underlag förbereds i gränssnittet.

In Vision → JIK och JIK → slutkund hanteras i denna version som två uppdrag med
egna kunder och priser. En registrering får ännu inte två faktureringsvägar
automatiskt. Kontrollerad fördelning av samma besök mellan två säljarled är
en separat vidareutveckling; kopiera inte fakturamarkeringar mellan företagen.

## Inköp

Ange datum, beskrivning, belopp inklusive moms, kvittomoms och fakturamoms.
Inget momsval är förvalt. Netto räknas i heltalsöre och vidarefaktureras utan
påslag. Kvitton med blandad moms registreras uppdelade per momssats.

Privat betalning sparas som paidBy=private med reimbursementStatus=unreviewed.
Appen bokför eller återbetalar inte utlägget. En kvittobild kan bifogas som en
komprimerad arbetskopia; originalet måste bevaras för bokföringen. Bilder
skalas till högst 1200 px och avvisas över 500000 tecken. Arbetskopian ligger
i samma v2-fil som registreringarna och blir större med fler bilder.

## Månadskontroll och Lundify

Vyn Underlag kan filtreras per företag och månad. En månadsnotering kan ange
exempelvis att ett underlag saknas. Invisiontid kan inte avgöra om alla tider
registrerats eller om ett vänteläge verkligen är avslutat.

Exporten innehåller datum, arbetsbeskrivning/tema, utförare, samråd, samlade
resor och belopp. Ingen Lundify-API eller automatisk browserstyrning tillkommer.
Ronney skapar/granskar utkast, registrerar och skickar fakturan själv.
Appens knapp för klarmarkering kräver att användaren bekräftar att fakturan
redan är registrerad; den skickar eller registrerar inget i Lundify.

Moms och RUT är användarens bedömning. Ingen automatisk skatteklassificering
eller RUT-beräkning har lagts till. Prisändringar fryses i förberedda underlag
med den befintliga snapshotmodellen. Kalenderstyrd KPI/prishistorik är inte
implementerad i denna ändring.

## Verifiering

- Node: IVT_MAL=v2 node --test test/*.test.mjs
- Syntaxkontroll av appmoduler och git diff --check.
- Mobilvy 390 × 844 px: registrera pass med tema, spara privat utlägg,
  återläs efter omladdning, filtrera företag/månad och granska underlag.
- Automatisk kontroll av fil/tillstånd-roundtrip inklusive kvittobild och
  företagsfält. Ingen ändring av produktionsfilen eller OneDrive under byggandet.

Kameraflödet måste fortfarande provas med en fysisk telefon och den
autentiserade OneDrive-lagringen innan det kan kallas verifierat i produktion.
Prototypen använder endast testdata och en egen localStorage-nyckel.

GitHub-läsning verifierad med ls-remote. Pushåtkomst verifierad med lyckat
dry-run utanför sandlådan; ingen GitHub-gren skapades av kontrollen.
Publicering sker först efter Ronneys godkännande.

## Slutkontroll 2026-10-04

- 458 Node-tester passerar efter spärren mot fastprisleveranser från fel
  företag/kund/månad och mot tvetydigt kundval när flera underlagsgrupper finns.
- GitHubs main pekar på fca1b4697d47835511b5997f69a2ea0932aa7c99.
  Cloudflare Pages-checken för denna commit är completed/success.
- Produktionsfilerna index.html, src/app/start.mjs, src/app/ui.mjs och
  src/app/logik.mjs stämmer med main (radslut normaliserade).
- Push dry-run avslutades med kod 128 och Windows visade en krasch i
  git-remote-https.exe. Inga ref-ändringar eller publicering gjordes.
  Exakt kraschorsak och pushbehörighet är fortfarande inte verifierade.
- README och CLAUDE.md har rättats till aktuell v2-arkitektur.
- En lokal GitHub Actions-workflow kör v2-tester vid push och pull request.
  Den är ännu inte pushad och har därför inte körts på GitHub. Den stoppar
  inte automatiskt Cloudflares publicering från main.

Prioriterad vidareutveckling är en arbetsregistrering med separat prissättning
för In Vision → JIK och JIK → slutkund, separat kvittolagring för att undvika
att varje datafil och backup växer med bilderna samt en avstämning mot Lundify
innan nya utkast skapas. Dessa funktioner är inte implementerade här.

## Kompletterad kontroll 2026-10-04

Push dry-run gav exit 0 när Git kördes utanför den begränsade miljön, med
ordinarie TLS och utan ändring av inloggningsuppgifter. Ett efterföljande
ls-remote visade oförändrad main och ingen skapad arbetsgren. Det pekar på
begränsningarna i körmiljön som en bidragande faktor till tidigare krasch,
men den exakta minnesfelsorsaken är inte fastställd.

459 tester passerar. Ett tillagt adaptertest visar att företag, privat
betalning, kvittobild, månadsnotering och låst underlag sparas, säkerhetskopieras
och återläses genom den riktiga OneDrive-adaptern med en simulerad Graph-server.
Det är ett integrationstest utan verkliga nätverksanrop; fysisk kamera och
autentiserad synk på telefonen är fortfarande inte verifierade för ändringen.
