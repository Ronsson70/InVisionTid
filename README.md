# In Vision Tid

Tidsregistrering och fakturaunderlag för In Vision Järvsö AB och Järvsö IK Event AB.

**Live:** https://invisiontid.pages.dev

## Teknik och start

Produktionsstarten finns i `index.html` och `src/app/start.mjs`. Appen använder
ES-moduler i `src/app/`, domänlogik i `src/domain/` och OneDrive-adaptern i
`src/integrations/onedrive/`. Ingen bundling eller byggprocess behövs.

Starta `python -m http.server 8765` från repots rot. `/prototyp/` använder
påhittade data och egen lokal lagring, utan koppling till OneDrive eller Lundify.
Produktionsappen kräver Microsoft-inloggning med registrerad redirect-adress.

## Data och fakturering

Produktionsdata finns i OneDrive-filen `InVisionTid/invisiontid-data-v2.json`.
Appen kontrollerar versionen före skrivning, skapar backup och läser tillbaka
resultatet. Den äldre v1-filen används skrivskyddat vid införande/historikimport.
Inloggningens token lagras i webbläsaren; produktionsdata får aldrig committas.

Underlag grupperas per fakturerande företag, kund och månad. Appen förbereder
fakturatext och sparar en referens. Ronney registrerar och skickar själv i Lundify.
Ingen knapp i appen registrerar eller skickar en faktura i Lundify.
Se [mobil och fakturaunderlag](docs/09-mobil-och-fakturaunderlag.md) för senaste
lokala ändringen, testning och kvarstående begränsningar.

## Tester

Node utan externa beroenden:

```powershell
$env:IVT_MAL = 'v2'
node --test test/*.test.mjs
```

På Linux/macOS: `IVT_MAL=v2 node --test test/*.test.mjs`.
Tester körs också i GitHub Actions vid push och pull request.
V1-baslinjen och äldre browsertester är historiska; se `test/README.md`.

## Publicering

Cloudflare Pages-projektet `invisiontid` är kopplat till GitHub-grenen `main`.
Push till main triggar publicering. GitHub Actions kör tester, men dess resultat
blockerar inte i sig Cloudflares automatiska publicering. Granska och testa på en
arbetsgren före sammanslagning. Branch protection och preview-inställningar måste
kontrolleras i respektive tjänst; de kan inte verifieras enbart från repot.

Den 4 oktober 2026 kontrollerades commit `fca1b4697d47835511b5997f69a2ea0932aa7c99`:
Cloudflare-checken var lyckad och publicerade `index.html`, `src/app/start.mjs`,
`src/app/ui.mjs` och `src/app/logik.mjs` matchade committen. Den nya lokala
ombyggnaden är ännu inte pushad eller publicerad. Pushbehörigheten verifierades
senare med ett lyckat dry-run utanför den begränsade körmiljön.
