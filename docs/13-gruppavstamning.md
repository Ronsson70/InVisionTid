# Flera underlag mot en registrerad faktura

Lokalt byggd på main `1ae4278`. Ingen produktionsdata har ändrats. Ingen publicering ingår.

Öppna ett sparat underlag och välj **Koppla flera underlag till en faktura**.
Välj hela gruppen inom samma bolag, kund och arbetsmånad. Bekräfta kundnummer,
arbetsmånad och samtliga rader mot den befintliga Lundifyfakturan. Granska
sammanställningen, öppna raddetaljerna och bekräfta den visade avrundningsskillnaden
innan sparande. Avbryt sparar inget.

## Ekonomi och historik

- Fakturaregistret har fortsatt en post per bolag och fakturanummer, nu med flera
  `underlagIds`. Fakturerat räknas från registret, aldrig som fakturans total per underlag.
- Varje underlags netto, moms och total bevaras. Tider, resor, utlägg, källanteckningar,
  låsningar, kund- och projektdata ändras inte. Befintliga snapshots och presentationsrader
  bevaras; saknade historiska snapshots fryses som uttryckligen rekonstruerade.
- Tidigare `checkedAt`, `klarmarkeradAt` och händelser bevaras. Gruppavstämningen får
  egen tidpunkt, anteckning och händelse. Originalunderlaget sparas i gruppreferensen.
- Summan av underlagens netto och moms måste matcha fakturan exakt. Endast
  `fakturans avrundning − summan av underlagens avrundningar` godtas som skillnad.
  `summa underlagstotaler + skillnaden` måste vara exakt fakturans total.
  Ingen tolerans och ingen automatisk fördelning på arbetsposter används.
- Syntetiskt exempel: tre underlag har netto 27 575 kr, moms 6 893,75 kr,
  avrundning 1,25 kr och total 34 470 kr. Fakturan har samma netto/moms men
  avrundning 0,25 kr och total 34 469 kr. Gruppen visar −1 kr; underlagen ändras inte.
  Detta är en testfixtur, inte verifierade detaljbelopp för någon verklig faktura.

## Skydd

Kundnummer kontrolleras åt båda hållen mot tidigare verifierade kopplingar inom
bolaget. Alla redan kopplade underlag måste ingå. Andra fakturakopplingar, dubbla
underlags-ID och källrader, annan kund/period/bolag samt ändrade låsningar stoppas.
Tidigare ersatta versioner med samma källtyp och käll-ID kontrolleras också: deras
utkastreferens, bolag och kund måste stämma med den valda versionen, enligt samma
regel som vanlig dokumentavstämning. Källradernas datum måste tillhöra arbetsmånaden och rymmas inom eventuell känd
arbetsperiod på fakturan. Fakturadatum får ligga i en senare månad.

Granskningen binder hela tillståndet och formuläret. Vid sparande valideras allt igen,
eTag måste vara oförändrad och exakt avrundningsskillnad bekräftad. Uppdateringen
sker som ett enda tillståndsbyte via befintlig versionsskyddad lagring. Samma
sparförsök är idempotent; en färdig grupp kan inte ersättas eller utökas i detta flöde.

## Avgränsningar och nästa steg

Underlag med delbetalningar, aktiva utkast eller ersatta versioner stöds inte.
En befintlig fryst snapshot vars källor ändrats kräver separat granskning.
Även skillnader som uppstått genom separat momsavrundning stoppas; de behandlas
inte som öresavrundning på fakturans total. Okänd arbetsperiod i registret måste
bekräftas manuellt mot fakturan. Ingen koppling skapas genom namnmatchning.

Före användning på faktura 435: granska koden, godkänn och publicera separat.
Kontrollera sedan rätt fakturerande bolag, kundnummer, fakturadatum, samtliga tre
oktoberunderlag och fakturans faktiska netto/moms/avrundning/total. Använd en aktuell
versionsskyddad läsning. Förhandsgranska hela gruppen; spara först efter separat
uttryckligt godkännande för den verkliga datakopplingen. Vid konflikt: ladda om och
granska igen. Tvinga aldrig igenom en beloppsavvikelse.

Testning: rena syntetiska domän- och UI-tester, filrundtur samt Edge mot lokal
minneslagring. Verklig OneDrive-skrivning och faktura 435 är inte provade.
