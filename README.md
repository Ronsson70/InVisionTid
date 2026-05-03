# In Vision Tid

Personlig single-file PWA för tidsregistrering. Byggd för eget bruk i In Vision STH HB.

**Live:** https://invisiontid.pages.dev

## Teknik

- En enda `index.html` — HTML, CSS och JS i samma fil
- React 18 + Babel standalone (ingen byggprocess)
- SheetJS för Excel-export
- PWA via inline manifest, installerbar på mobil och desktop
- Sync mot OneDrive via Microsoft Graph (Files.ReadWrite + Calendars.Read)

## Datamodell

Privata tidsdata sparas i `invisiontid-data.json` i användarens OneDrive — den filen ligger inte i repot. localStorage används som primär lagring i webbläsaren och syncas mot OneDrive vid inloggning.

## Deploy

Cloudflare Pages-projekt `invisiontid` är kopplat mot main-branchen i detta repo. Push till main triggar automatisk deploy.
