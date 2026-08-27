# Tester

Två sviter som mäter olika saker. Inga beroenden, ingen `package.json`, ingen
byggprocess. Node 18 eller senare.

```
IVT_MAL=v2 node --test test/*.test.mjs    kör allt mot v2      61/61 gröna
node --test test/*.test.mjs               kör allt mot v1      49/61, se nedan
node test/rapport.mjs v2                  acceptanstabell, v2
node test/rapport.mjs                     acceptanstabell, v1
```

Ingen `package.json` läggs i roten. Cloudflare Pages autodetekterar den och kan
börja köra ett byggkommando mot ett projekt som publicerar statiska filer direkt.

`test.html` finns kvar och körs i webbläsaren via en lokal server. Den täcker
PURE-sektionen i `index.html` och ska förbli grön så länge v1 lever.

---

## `v1-skyddsnat.test.mjs` — ska alltid vara grön

13 tester mot `migrate()` och `mergeData()`, de två funktioner som avgör om data
överlever en synk.

Båda ligger **utanför** `PURE-START`/`PURE-END` och kan därför inte nås av
`test.html`. De hade ingen testtäckning alls innan den här suiten.

Blir den röd har något i datalagret gått sönder. Det är den viktigaste signalen i
hela repot.

---

## `domain.test.mjs` — ska alltid vara grön

34 enhetstester för domänens primitiver. Acceptansfallen provar hela kedjan, de
här provar kantfallen under: negativ avrundning, heltalsspill, okänd moms mot
noll procent, otillåtna statusövergångar, migreringens kontrollsummor.

## `acceptance.test.mjs` — grön mot v2, avsiktligt röd mot v1

Acceptansfallen T1–T13 skrivna mot **v2-kontraktet**, inte mot en implementation.
Samma fil körs mot vilken adapter som helst.

**Mot v2: 13 av 13 gröna.**

**Mot v1** ligger baslinjen kvar som mätpunkt:

| | | |
|---|---|---|
| T7, T12 | godkända | reseförslag och svenska tecken fungerar redan i v1 |
| T8 | fel svar | 2 400 kr i stället för 3 250 kr |
| övriga 10 | saknar stöd | v1 har inget momsbegrepp och inget underlag |

Att T7 och T12 är gröna även mot v1 är avsiktligt. De visar att baslinjen mäter
något verkligt och inte bara faller på att koden saknas.

### Att testerna biter är kontrollerat

En grön svit bevisar ingenting om den inte kan bli röd. Fyra mutationer i
domänen provades, och varje gång fångades felet:

| Mutation | Utfall |
|---|---|
| ROUND_HALF_UP byttes mot trunkering | 4 fall föll |
| `trackingOnly` släpptes in på fakturan | T4 föll |
| Prissnapshot ignorerades | T11 föll |
| Migreringen gissade 25 % moms | T9 föll |

---

## Så hänger det ihop

```
test-fixtures/scenarier.mjs      facit: indata och förväntat utfall
test-fixtures/v1-legacy.json     syntetisk v1-fil för migreringstesterna
        │
        ▼
test/acceptance-checks.mjs       T1–T13 mot v2-kontraktet, adapteroberoende
        │
        ├── test/adapters/v1.mjs   svarar med koden i index.html idag
        └── test/adapters/v2.mjs   läggs till i etapp 3
        │
        ├── test/acceptance.test.mjs   grind
        └── test/rapport.mjs           läsbar tabell
```

Kontrollerna räknar aldrig fram förväntade belopp själva. Allt facit kommer från
fixturerna, som i sin tur kommer från kravspecifikationen.

`test/lib/pure-v1.mjs` plockar ut funktioner ur `index.html` med samma
`PURE-START`/`PURE-END`-teknik som `test.html` använder, plus separata uttag för
`migrate()` och `mergeData()`. Ingen logik dupliceras.

---

## Lägga till en ny kontroll

1. Lägg indata och förväntat utfall i `test-fixtures/scenarier.mjs`
2. Lägg kontrollen i `kontroller`-arrayen i `test/acceptance-checks.mjs`
3. Kontrollen ska kasta `EjStodd` när adaptern saknar begreppet, och `Avvikelse`
   när svaret är fel. Skillnaden är hela poängen med baslinjen.
