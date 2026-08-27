# Testversion för användartest

En klickbar testversion av det nya arbetsflödet. Syftet är att pröva om flödet
passar innan produktionsdata, OneDrive eller Lundify kopplas in.

## Så öppnar du den

```
python -m http.server 8000
```

Öppna sedan **http://localhost:8000/prototyp/**

En lokal server behövs eftersom testversionen använder ES-moduler. `file://`
fungerar inte.

## Vad den är kopplad till

**Ingenting.** Ingen OneDrive, ingen Graph-inloggning, ingen Lundify, ingen
produktionsdata. Testdatat är påhittat och kunderna heter Kund A, B och C.

Det du registrerar sparas i webbläsaren under nyckeln
`invisiontid-prototyp-5a`. Produktionsappens nyckel `invisiontid-data` rörs
aldrig — ett test ser till att den inte ens förekommer i koden.

Knappen **Börja om** i den orange listen återställer testdatat.

## Så hänger det ihop

```
prototyp/index.html    utseende och start
prototyp/ui.mjs        vyer och händelser, ingen beräkning
prototyp/logik.mjs     gruppering och besked på svenska
        ↓
src/domain/            pengar, moms, artiklar, leveranser, underlag
```

Belopp, moms och avrundning räknas **bara** i `src/domain`. Gränssnittet räknar
aldrig själv, och ett test kontrollerar att det förblir så. Det är därför domän-
och datatesterna också täcker det du ser på skärmen.

## Vad som är byggt och vad som bara är en skiss

| | |
|---|---|
| Idag, Vecka, Fakturera | fungerar |
| Veckans "Jobbat in" med frivilligt mål | fungerar |
| Ångra överföring, rätta och ta bort fakturanummer | fungerar |
| Ange moms från en blockerad faktura | fungerar |
| Uppföljning | enkel prototyp, några tal och en fördelning per kund |
| Fast leverans från Idag | inte byggd, leveranser faktureras från Fakturera |
| Utlägg | inte byggt, ligger under Mer som platshållare |
| Timer | inte byggd, tid registreras med snabbval eller klockslag |

## Tester

```
node --test test/prototyp.test.mjs test/prototyp-korrigeringar.test.mjs test/prototyp-rendering.test.mjs
```

91 tester: 33 för de ursprungliga flödesreglerna, 39 för korrigeringarna efter
användartestet och 19 rökprov som renderar alla fyra vyerna mot en DOM-stubbe.

## Känd avgränsning: reseförslag grupperas per kund

Ett reseförslag räknas per **kund** och dag. Har du arbetat på flera uppdrag hos
samma kund samma dag är det ett besök och ger ett förslag.

**Det håller bara så länge en kund har en besöksplats.** Har en kund flera
adresser, eller om två besök till samma kund samma dag är olika resor, behöver
modellen skilja på besöksplatser i stället för på kunder.

Funktionen ändras inte nu. Noterat för en senare etapp.

## Jobbat in

Veckovyn svarar på en fråga: hur mycket pengar har jag jobbat in?

Med räknas genomförda behandlingstillfällen, utfört timdebiterat arbete och
genomförda fakturerbara fasta leveranser. Inte med räknas trackingOnly-tid,
internt arbete, ideellt arbete, moms och rena utlägg. Resor och utlägg visas
separat eftersom de i huvudsak är kostnadsersättning.

Veckomålet är frivilligt och jämförs bara med "jobbat in". Appen räknar ingen
lön, skatt, avgift eller budget.
