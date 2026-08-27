# Förstudie: integration mot Lundify

Status: **förstudie. Ingenting är anslutet, inget har skrivits, inga uppgifter har
skickats någonstans.**

Förstudien bygger på kravspecifikationens uppgifter om Lundify och på allmän
kunskap om hur den här sortens integrationer fungerar. **Den innehåller inga
verifierade uppgifter om Lundifys API, priser eller villkor.** Varje sådan uppgift
måste hämtas från Lundify direkt innan något beslut fattas. Att gissa dem här hade
varit att hitta på.

---

## 1. Utgångspunkten

Lundify är facit för fakturanummer, utfärdade fakturor, bokföring och betalningar.
In Vision Tid ska skapa och låsa faktureringsunderlag och registrera eller synka
Lundify-referensen. Appen ska aldrig påstå att en faktura är skickad.

Enligt kravspecifikationen har Lundify en tjänst för **Integrationer** och beskriver
**API.1 by Zwapgrid** som ett sätt att läsa och uppdatera bland annat fakturadata.
Det är utgångspunkten för utredningen, inte en bekräftad förutsättning.

---

## 2. Den avgörande begränsningen

In Vision Tid är en **statisk PWA**. Den publiceras på Cloudflare Pages, har ingen
server och kör helt i användarens webbläsare.

Det betyder att **appen inte kan hålla en hemlighet**. En API-nyckel, ett
klienthemligt värde eller ett långlivat token som ligger i klientkoden är läsbart
av vem som helst som öppnar sidan. Det gäller även om värdet hämtas vid körning:
allt som webbläsaren kan läsa kan användaren läsa.

Två följder:

1. **Ingen Lundify-nyckel får någonsin läggas i `index.html` eller i byggda
   klientfiler.** Inte heller i en miljövariabel som bakas in vid bygget — Vite
   skriver in `import.meta.env`-värden i klartext i bundlen.
2. Om Lundifys API kräver en klienthemlighet, vilket serverside-API:er normalt gör,
   behövs en **mellanserver**. Det bryter mot "ingen server" i dagens arkitektur och
   är ett eget beslut med egen kostnad och eget underhåll.

Undantaget vore ett API som stöder OAuth authorization code flow med PKCE och
publik klient, alltså samma mönster som Microsoft-inloggningen ska byta till. Då
kan integrationen ligga helt i klienten. **Om Lundify eller Zwapgrid stöder det är
inte känt och måste verifieras.**

---

## 3. Vad som måste tas reda på, i den ordningen

Frågorna är ordnade så att ett nej tidigt gör resten onödig.

### A. Åtkomst och abonnemang

1. Ingår Integrationer i nuvarande abonnemang, eller är det ett tillägg?
2. Vad kostar det, per månad eller per transaktion?
3. Krävs API.1 by Zwapgrid som separat avtal och separat kostnad?
4. Finns det en testmiljö, eller sker all utveckling mot skarp data?

**Punkt 4 är viktigast.** Utan testmiljö kan integrationen inte utvecklas utan att
röra riktiga fakturor. Saknas testmiljö bör integrationen avfärdas.

### B. Autentisering

5. Vilken autentiseringsmodell används — API-nyckel, OAuth client credentials,
   OAuth authorization code?
6. Stöds PKCE och publik klient, alltså en integration utan serverhemlighet?
7. Hur länge lever ett token och hur förnyas det?
8. Går rättigheterna att begränsa till enbart fakturor, eller ger nyckeln åtkomst
   till hela bokföringen?

**Punkt 8 avgör riskbilden.** En nyckel som ger full åtkomst till bokföringen är en
väsentligt större sak att hantera än en som bara får läsa fakturastatus.

### C. Vad som faktiskt går att göra

9. Går det att **skapa ett fakturautkast** med rader, artiklar, antal, á-pris och
   momssats?
10. Går det att **läsa** en fakturas status, fakturanummer, fakturadatum,
    förfallodatum och betalstatus?
11. Hur mappas kunder — finns ett kund-id att hämta, eller måste matchning ske på
    namn eller organisationsnummer?
12. Hur mappas artiklar — krävs fördefinierade artikelnummer i Lundify, eller kan
    fria rader skickas?
13. Hur hanteras moms — per rad, per momskod, eller per fakturahuvud?
14. Hur hanteras öresavrundning — räknar Lundify själv, och blir resultatet samma
    som In Vision Tids ROUND_HALF_UP?

**Punkt 14 är lätt att missa och dyr att upptäcka sent.** Om Lundify avrundar
annorlunda kommer underlaget och fakturan att skilja med ören, och avstämningen blir
otillförlitlig. Det ska testas mot en verklig faktura innan integrationen byggs.

### D. Drift

15. Finns anropsbegränsningar?
16. Hur meddelas ändringar i API:et?
17. Vad händer med integrationen om abonnemanget avslutas?

---

## 4. Tre alternativ

### Alternativ 1 — Manuell överföring med bra underlag

**Detta byggs i etapp 7 oavsett vad utredningen kommer fram till.**

In Vision Tid producerar ett underlag som är gjort för att skrivas av:

- fakturarader i samma ordning som de ska läggas in i Lundify
- artikelnummer eller tydlig artikelbeskrivning, antal, enhet, á-pris, momssats
- kundreferens, projekt, betalningsvillkor och eventuell fakturatext
- kopiera till urklipp, samt export till PDF och Excel
- en checklista: öppna Lundify, skapa kundfaktura, välj kund, lägg in rader,
  bifoga underlag vid behov, spara utkast eller skicka
- när fakturan är skickad: klistra in fakturanumret i In Vision Tid

**Kostnad:** ingen. **Risk:** ingen. **Insats:** några minuter per faktura, kanske
en handfull fakturor i månaden. **Hemligheter i klientkoden:** inga.

Det här är basfallet, och det är dugligt. En integration ska motiveras mot det här,
inte mot att göra allt för hand.

### Alternativ 2 — Läsande integration

Appen läser fakturastatus, fakturanummer och betalstatus från Lundify. Skapandet
sker fortsatt manuellt.

**Vinsten:** uppföljningen blir sann. "Skickat" och "betalt" kommer från Lundify i
stället för från något användaren har klickat i. Det är precis den svaga punkten i
dagens app.

**Kravet:** en autentisering som fungerar utan serverhemlighet, eller en
mellanserver. Rättigheterna bör begränsas till läsning.

**Bedömning:** det här är den intressantaste nivån. Den tar bort det mest
felbenägna momentet — att manuellt hålla statusen aktuell — utan att appen någonsin
skriver i bokföringen.

### Alternativ 3 — Skrivande integration

Appen skapar fakturautkast direkt i Lundify.

**Vinsten:** några minuter per faktura.

**Kostnaden:** skrivrättigheter mot bokföringen från en klientapp, sannolikt en
mellanserver att drifta och säkra, mappning av kunder och artiklar som måste hållas
i synk, och felhantering när ett anrop går halvvägs.

**Bedömning:** svag lönsamhet vid nuvarande fakturavolym. Bör inte byggas förrän
alternativ 2 har varit i drift och visat sig stabilt.

---

## 5. Rekommendation

1. **Bygg alternativ 1 nu.** Manuell överföring med ett underlag som är gjort för
   ändamålet. Det ger huvuddelen av nyttan omedelbart och till noll risk.
2. **Ställ frågorna i avsnitt 3 till Lundify.** Särskilt A4 testmiljö, B6 PKCE,
   B8 rättighetsbegränsning och C14 öresavrundning.
3. **Bygg alternativ 2 bara om** det finns en testmiljö, autentiseringen kan
   begränsas till läsning, och det går utan mellanserver — eller om en mellanserver
   uttryckligen accepteras som en ny driftkostnad.
4. **Avvakta med alternativ 3** tills alternativ 2 har varit i drift.

---

## 6. Adaptergränssnittet

Oavsett utfall byggs `src/integrations/lundify/` med samma yta för båda vägarna, så
att fakturaunderlaget aldrig behöver byggas om:

```js
// src/integrations/lundify/adapter.mjs
export const manuellAdapter = {
  namn: 'Manuell överföring',
  kanSkapaUtkast: false,
  kanLasaStatus: false,

  // Formaterar underlaget för avskrift, urklipp och export.
  forberedOverforing(invoiceRecord, kontext) { /* … */ },

  // Registrerar det användaren har gjort i Lundify. Appen hittar aldrig på.
  registreraUtkast(invoiceRecord, { lundifyDraftId }) { /* … */ },
  registreraSkickad(invoiceRecord, { invoiceNumber, invoiceDate, dueDate }) { /* … */ },
  registreraBetald(invoiceRecord, { paidDate }) { /* … */ },
};
```

En framtida `apiAdapter` implementerar samma yta med `kanSkapaUtkast: true`. Vyerna
och domänen märker ingen skillnad.

**Ingen `apiAdapter` skrivs innan utredningen är klar och godkänd.**

---

## 7. Vad som inte har gjorts i den här förstudien

- Ingen anslutning har upprättats mot Lundify eller Zwapgrid.
- Inga uppgifter har skickats någonstans.
- Inga API-nycklar eller tokens har efterfrågats, tagits emot eller lagrats.
- Ingen dokumentation har hämtats, och därför påstås ingenting om vad API:et kan.
- Inga priser, villkor eller tekniska detaljer har antagits.

Nästa steg är en fråga till Lundify, inte en rad kod.
