# Företag och kundunderlag

Fakturaunderlag har två ingångar: In Vision – min fakturering och JIK Event –
till kunder. Företaget är avsändare; kunden är mottagare. Ett val filtrerar
underlagen och ger genvägar till tid, resa, inköp och ett nytt kunduppdrag.
Registreringen visar faktureringsvägen och väljer bara uppdrag för valt företag.
JIK:s tidsregistrering visar utförare öppet, så flera personers arbete kan samlas
hos samma kund och månad. Varje kunduppdrag behåller sin prissättning.

In Visions timmar förs inte automatiskt vidare till JIK:s kundunderlag.
Underlagen kan avse samma arbete men olika försäljningar och priser; appen
skapar ingen kopia och antar inte att kundens underlag är komplett.

Äldre underlag kan sakna fakturerande företag. En separat åtgärd föreslår bara
företag när samtliga kopplade registreringar och leveranser pekar på samma
befintliga, känt fakturerande företag. Åtgärden kompletterar enbart detta fält.
Belopp, fakturanummer, klarmarkering och låsta registreringar ändras inte.
Underlag utan källor eller med blandade/okända företag rättas inte automatiskt.

Tester täcker företagsseparation vid registrering, flera utförare i samma
kundunderlag, tomma urval och företagskomplettering utan upplåsning eller
ändring av belopp. Ingen funktion registrerar eller skickar fakturor i Lundify.
