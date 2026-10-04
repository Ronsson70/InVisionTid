# Rättningar efter granskning i Edge

Genomförda efter godkänd granskning i oktober 2026.

- Underlag utan företagsval visas också vid filtrering på ett företag,
  tillsammans med en varning. Företag gissas aldrig på en äldre referens.
- Avslutade underlag ligger i en stängd historiksektion.
- Vilande, interna och redan fakturerade fasta leveranser erbjuds inte som
  nya fakturerbara leveranser. Samma spärr finns i klarmarkeringslogiken.
- En totalpost med `billingDisabled: true` sparas som historik men bidrar
  inte samtidigt som sina delbetalningar till underlag och uppföljning.
- En planerad delbetalnings faktureringsdatum visas före klarmarkering.
- Uppföljning och radbelopp använder ett befintligt prissnapshot, så en
  prisrättning inte räknar om redan låsta poster.
- Underlagets skärmvy visar exakta ören i rader, moms och avrundning,
  precis som texten som kopieras till Lundify.

Företagsval, priser och delbetalningar i verkliga uppdrag sparas endast i
användarens OneDrive. Privata data och ändringsskript får inte committas.
Ett öppet, ännu inte registrerat underlag kan rättas med användarens
bekräftade uppgifter. Avslutade referenser och deras poster bevaras.

Ingen Lundify-faktura registreras, ändras eller skickas av denna ändring.
