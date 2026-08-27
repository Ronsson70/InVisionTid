# Testfixtures

Syntetiska testdata. **Inga produktionsdata, inga personuppgifter, inga
organisationsnummer, inga kontaktuppgifter.**

## Varför pseudonymer

Repot är publikt. Ett kundregister med avtalade priser är uppgifter om kunder och
hör inte hemma på GitHub, även när de bara används i tester.

Därför heter kunderna **Kund A** till **Kund E**. Prismodellerna är verkliga —
de är själva kravet som ska implementeras — men kopplingen till vilket bolag som
är vilket ligger i `privat/kundmappning.local.md`, som är gitignorerad.

## Filer

| Fil | Innehåll |
|---|---|
| `scenarier.mjs` | Artiklar och acceptansfall T1–T8, T11, T13 med förväntat utfall |
| `v1-legacy.json` | Syntetisk fil i exakt v1-format, för T9 och T10 |
| `privat/` | **Gitignorerad.** Kundmappning och eventuell verklig testdata |

## Enheter

Inga flyttal förekommer i belopp eller kvantiteter.

| | enhet | exempel |
|---|---|---|
| Belopp | heltal **öre** | 2 400 kr = `240000` |
| Kvantitet | heltal **tusendelar** av enheten | 3 tim = `3000`, 15 min = `250` |
| Momssats | heltal **hundradels procent** | 25 % = `2500`, 0 % = `0` |

## Facit räknas aldrig fram av testerna

Varje acceptansfall bär sitt eget `forvantat`-objekt med netto, momsunderlag per
momssats, moms, brutto före avrundning, avrundning och att betala. Kontrollerna i
`test/acceptance-checks.mjs` jämför mot dessa värden och härleder dem aldrig
själva. Ett test som räknar likadant som koden bevisar ingenting.

Värdena kommer från kravspecifikationens acceptanstester och är kontrollräknade:

- **T1** 19 200 + 2 550 + 1 265 = 23 015,00 netto. Momsunderlag 3 815,00 ger
  953,75 moms. Brutto 23 968,75 avrundas upp till 23 969 kr, avrundning +0,25.
- **T2** 11 050 + 368,50 = 11 418,50 netto. Moms 2 854,625 avrundas ROUND_HALF_UP
  till 2 854,63. Brutto 14 273,13 avrundas till 14 273 kr, avrundning −0,13.
- **T3** 4 200 + 3 150 = 7 350 netto, moms 1 837,50, brutto 9 187,50 avrundas upp
  till 9 188 kr.

## Om verklig testdata behövs

Lägg den i `privat/`. Den katalogen är gitignorerad. Anonymisera först: byt namn,
ta bort kontaktuppgifter och organisationsnummer, och skriv aldrig ut innehållet
i loggar eller i dokumentation.
