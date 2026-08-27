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
| Fastpris över avtalsperiod, fördelat per vecka | fungerar |
| Veckans "Jobbat in" med frivilligt mål | fungerar |
| Ångra klarmarkering, frivillig fakturanummeranteckning | fungerar |
| Ange moms från en blockerad faktura | fungerar |
| Uppföljning | enkel prototyp, några tal och en fördelning per kund |
| Leverans klar, från Idag → Mer | fungerar |
| Utlägg | inte byggt, och därför **dolt** i gränssnittet |
| Timer | inte byggd, tid registreras med snabbval eller klockslag |

Utlägg finns kvar i datamodellen och räknas fortfarande i Vecka och Uppföljning.
Det som är dolt är bara möjligheten att registrera nya. En synlig knapp som
leder till en återvändsgränd är sämre än ingen knapp alls, och ett
renderingstest underkänner om en sådan dyker upp.

## Tester

```
node --test test/prototyp.test.mjs test/prototyp-korrigeringar.test.mjs test/prototyp-rendering.test.mjs
```

```
node --test test/fastpris.test.mjs test/leveranser.test.mjs test/format-och-mal.test.mjs
```

183 tester för prototypen och den underliggande domänen: 34 flödesregler,
42 korrigeringar, 28 rökprov, 25 fastpris, 27 enstaka leveranser, 15
beloppsformat och veckomål samt 13 för låsning av underlag.

## Var räknas siffrorna

`sammanstallning()` i `prototyp/logik.mjs` är den enda källan för periodens tal,
och både Vecka och Uppföljning använder den. Tre ekonomiska begrepp hålls isär:

| | |
|---|---|
| **Jobbat in** | vad arbetet är värt: timarbete, tillfällen, styckprisat, upparbetad fastprisandel och genomförda fristående leveranser |
| **Redo för Lundify** | vad som är redo att föras över: poster som ännu inte hör till ett underlag, inklusive resor och utlägg |
| **Klart i Lundify** | vad som redan är överfört och markerat klart |

Resor och utlägg särredovisas. Den upparbetade fastprisandelen ingår i Jobbat in
men aldrig i fakturaunderlaget.

Tre urvalsregler med skilda betydelser, samlade på ett ställe:
`kanIngaIFakturaunderlag`, `raknasSomJobbatIn` och `arEndastUppfoljning`.
Gränssnittet frågar dem, det bedömer inte själv.

## Belopp

Hela kronor visas utan ören: **50 000 kr**, inte 50 000,00 kr. Ören visas så
snart de finns: **566,50 kr**. Samma format används på skärmen, i besked och i
underlaget som kopieras till Lundify.

Det exakta formatet med båda decimalerna finns kvar i `oreTillText` och används
där varje öre måste synas, till exempel i migreringsrapporten.

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

### Fastpris

**Varje** fast ersättning har en upparbetningsperiod med start- och slutdatum.
Beloppet tjänas in successivt: det fördelas proportionellt över periodens
kalenderdagar i heltalsöre, och summan av alla veckor blir exakt totalpriset.

Ett arvode på 50 000 kr för ett arbete som pågår i fyra veckor ger alltså cirka
12 500 kr per vecka — inte 50 000 kr den dag arbetet blev klart.

Upparbetning och fakturering är skilda saker:

| | |
|---|---|
| **Upparbetning** | perioden styr. Syns i Jobbat in. Aldrig en fakturarad. |
| **Genomförande** | styr faktureringen. En leverans som inte är genomförd kan inte tas med i ett underlag, och när den tas med används **hela** det avtalade beloppet. |

Eftersom perioden är enda vägen in i Jobbat in kan samma belopp inte
dubbelräknas — varken av en genomförandemarkering eller av en fakturering.

En ersättning för en enda dag får samma start- och slutdatum och räknas helt den
dagen. Saknas startdatum, slutdatum eller belopp gissas ingenting: beloppet
räknas inte in, och veckovyn visar "Upparbetningsperioden behöver anges".

### Markera en leverans klar

En leverans markeras genomförd från **Idag → Mer → Leverans klar**: välj uppdrag, välj vilken av de
upplagda leveranserna det gäller, och vilken dag. Pris och moms kommer från
avtalet och går inte att ändra i det dagliga formuläret.

Innan du sparar står det vad som händer, och lika viktigt vad som inte händer:

> När leveransen markeras som genomförd räknas 50 000,00 kr som Jobbat in.
> Leveransen läggs inte automatiskt i ett fakturaunderlag.

Leveransen syns sedan i Idag och Vecka, och ligger under **Behöver
kontrolleras** i Fakturera tills du väljer "Ta med leveransen i underlaget".
Genomförandedatumet går att ändra och genomförandet att ångra — men bara så
länge leveransen inte ligger i ett underlag som är klart i Lundify. Då måste
underlaget flyttas tillbaka först.

Fastprisperioder erbjuds aldrig i den här listan. Samma ekonomiska åtagande kan
inte vara både period och enstaka leverans.

## Fakturera

Tre lägen, inga tekniska statusar:

**Behöver kontrolleras** visar problemet och nästa åtgärd, till exempel
"Momsen behöver anges" med en knapp som öppnar valet.

**Redo för Lundify** visar kund, period, en kort sammanfattning av innehållet,
totalbelopp exklusive moms och knappen "Visa underlag".

**Klart i Lundify** visar kund, period, belopp exklusive moms och datumet det
markerades klart. Ångra finns alltid.

Fakturanummer krävs aldrig och efterfrågas inte. Det går att anteckna frivilligt
under "Mer information" i underlaget, och visas bara om det är ifyllt.
Betalningsstatus finns inte alls.
