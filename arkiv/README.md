# Arkiv

## `v1-app.txt`

Källkoden till den gamla appen, exakt som den låg på webbplatsens rot fram till
att v2 togs i drift.

Filen har ändelsen `.txt` med avsikt. En webbläsare som öppnar den visar
källkoden i stället för att köra den, och den gamla appen kan därför inte
längre skriva till `InVisionTid/invisiontid-data.json`. Att stänga av
skrivningen med en flagga hade inte varit skrivskydd — koden som kan skriva ska
inte gå att köra.

Filen finns kvar av två skäl:

1. `test/v1-skyddsnat.test.mjs` läser `migrate()` och `mergeData()` ur den och
   provar dem. De två funktionerna avgjorde om data överlevde en synk, och
   testerna ska förbli gröna som referens.
2. `test/adapters/v1.mjs` kör acceptansfallen T1–T13 mot den gamla logiken, så
   baslinjen går att jämföra med.

Behöver historiken läsas igen är vägen att kopiera filen till en egen mapp,
byta ändelse till `.html` och köra den lokalt mot en KOPIA av datafilen. Peka
den aldrig mot originalet.
