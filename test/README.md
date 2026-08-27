# Tester

Två sviter som mäter olika saker. Inga beroenden, ingen `package.json`, ingen
byggprocess. Node 18 eller senare.

```
node --test test/*.test.mjs     kör allt
node test/rapport.mjs           läsbar acceptanstabell mot v1
node test/rapport.mjs v2        samma tabell mot v2, när adaptern finns
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

## `acceptance.test.mjs` — förväntat röd tills etapp 3 är klar

Acceptansfallen T1–T13 skrivna mot **v2-kontraktet**, inte mot en implementation.
Samma fil körs mot vilken adapter som helst.

Baslinje mot v1 per 2026-08-27:

| | | |
|---|---|---|
| T7, T12 | godkända | reseförslag och svenska tecken fungerar redan |
| T8 | fel svar | 2 400 kr i stället för 3 250 kr |
| övriga 10 | saknar stöd | v1 har inget momsbegrepp och inget underlag |

Att T7 och T12 är gröna är avsiktligt. De visar att baslinjen mäter något verkligt
och inte bara faller på att koden saknas.

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
