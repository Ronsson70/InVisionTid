# In Vision Tid

Personlig single-file PWA för tidsregistrering. Byggd för eget bruk i In Vision STH HB.

**Live:** https://invisiontid.pages.dev

## Teknik

- En enda `index.html` — HTML, CSS och JS i samma fil
- React 18 + Babel standalone (ingen byggprocess)
- SheetJS för Excel-export
- PWA via inline manifest, installerbar på mobil och desktop
- Sync mot OneDrive via Microsoft Graph (Files.ReadWrite + Calendars.Read)

## Tester

`test.html` återanvänder de rena funktionerna direkt ur `index.html`
(koden mellan `/* PURE-START */` och `/* PURE-END */` — ingen dubblering,
ingen byggprocess). Kör via en lokal server och öppna `/test.html`
(t.ex. `npx serve` eller `python -m http.server`); `fetch` fungerar inte
på `file://`.

## Datamodell

Privata tidsdata sparas i `invisiontid-data.json` i användarens OneDrive — den filen ligger inte i repot. localStorage används som primär lagring i webbläsaren och syncas mot OneDrive vid inloggning.

## Deploy

Cloudflare Pages-projekt `invisiontid` är kopplat mot main-branchen i detta repo. Push till main triggar automatisk deploy.
