# InVisionTid – kodinstruktioner

## Aktuell arkitektur

Appen använder v2. `index.html` laddar `src/app/start.mjs` som startar UI i
`src/app/ui.mjs`. Appens logik ligger i `src/app/logik.mjs` och
`src/app/arbetsflode.mjs`; pris, moms och låsning ligger i `src/domain/`.
Filformatet har entries/trips/expenses. Appens tillstånd har poster.
Översätt endast via `src/app/tillstand.mjs`.

Ingen bundling behövs. Lägg ingen `package.json` i roten eftersom Cloudflare
kan autodetektera ett byggkommando. Kör lokalt med `python -m http.server 8765`.
`/prototyp/` använder syntetiska data och separat localStorage.
`arkiv/v1-app.txt` och äldre v1-browsertester är historik, inte produktionsstarten.

## Arbetsregler

- Rör inte `src/domain/` och `index.html` i samma ändring.
- Undvik duplicerad beräkningslogik. Pris hör till artikeln; pengar räknas i heltalsöre.
- Ändra inte produktionsdata eller OneDrive utan uttryckligt godkännande.
- Committa aldrig produktionsdata, tokens, kunduppgifter eller kvitton.
- Fixtures använder pseudonymer; repot är publikt.
- Gissa aldrig moms, priser, fakturanummer eller avtalsbelopp.
- Lundify är facit för fakturanummer, registrering, skickstatus, bokföring och betalning.
- Förbered endast utkast. Ronney registrerar och skickar själv, inklusive
  åtgärden ”Ladda ned och registrera”. Appens klarmarkering är bara en manuell referens.
- Företag, kund och månad ska hållas åtskilda även vid val av fastprisleveranser.
- Varje vy äger sin period. Blanda inte timmar och kronor i samma siffra.
- Håll telefonens dagliga registrering kort; detaljer hör bakom ett aktivt val.

## Tester

```powershell
$env:IVT_MAL = 'v2'
node --test test/*.test.mjs
```

Linux/macOS: `IVT_MAL=v2 node --test test/*.test.mjs`.
Kör även syntaxkontroll och `git diff --check` för ändrade moduler.
GitHub Actions kör samma v2-svit. Testantal i äldre dokument är historiska.
Testa UI via lokal server. Produktionssynk och kamera kräver separat verifiering;
ett lyckat prototyptest bevisar inte att de fungerar i produktion.

## Deployment

Cloudflare Pages publicerar från `main`. Publicera först när Ronney godkänt den
konkreta ändringen. En lokal ändring eller lyckad testkörning är ingen deploy.
GitHub Actions är en kontroll; den stoppar inte automatiskt Cloudflares deploy.
Se README och `docs/09-mobil-och-fakturaunderlag.md` för verifierat läge.
