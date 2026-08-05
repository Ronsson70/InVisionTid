# CLAUDE.md

Det här repo:t är en personlig single-file PWA för tidsregistrering.

## Projektöversikt
- Huvudfil: `index.html`
- Testfil: `test.html`
- Ingen byggprocess eller bundling
- Appen körs direkt i browsern via en enkel statisk server

## Hur man kör projektet lokalt
1. Starta en lokal server i repo:t:
   `python -m http.server 8000`
2. Öppna:
   `http://localhost:8000`

## Testning
- `test.html` använder rena funktioner från `index.html`
- Kör alltid via en lokal server, inte via `file://`
- Använd samma serverkommandot ovan

## Viktiga tekniska detaljer
- Appen är en enda HTML-fil med inline CSS/JS
- React 18 och Babel används via CDN
- SheetJS används för Excel-export
- PWA-funktionalitet finns inline i manifest och service worker
- Data lagras primärt i `localStorage`
- Synkning mot OneDrive görs via Microsoft Graph

## Vyer
Fyra flikar som följer arbetet, inte hur data visas:
- **Idag** (`TodayView`) — registrering. Timern överst, Snabb tid, Att fixa, dagens poster.
- **Vecka** (`WeekView`) — rättning. Kalenderimport, veckans poster, redigera, dela, ta bort.
- **Fakturera** (`InvoiceView`) — underlag per kund och månad, fakturamarkering.
- **Uppföljning** (`ReportView` + `TrendCharts`) — period, sammanställning, export, trender.

Grunddata (`MasterDataView`: projekt och kunder) och inställningar ligger bakom kugghjulet,
inte i en flik.

Två regler:
- **Varje vy äger sin egen period.** Ingen delad veckoräknare mellan vyer.
- **Timmar och kronor blandas aldrig i samma siffra.** Loggat är timmar, att fakturera är kronor.

## Datamodell
- `clients`
- `projects`
- `entries`
- `expenses`
- `trips`
- `invoices`
- `hourlyRate`, `kmRate`, `weeklyGoal`
- `settings` (appinställningar som inte är belopp, t.ex. `staleWarningDays`)

`migrate()` i `index.html` är enda stället som normaliserar datamodellen. Nya fält
läggs till där, annars försvinner de vid synk eftersom `mergeData()` bygger ett nytt objekt.

## Arbetsregler för ändringar
- Behåll appen single-file om möjligt
- Förändringar i UI och logik går i `index.html`
- Om du behöver testa rena funktioner, använd `test.html`
- Lägg nya rena funktioner mellan `PURE-START` och `PURE-END`, det är den sektion `test.html` läser
- Undvik att duplicera logik mellan filer

## Deployment
- Repo:t deployas via Cloudflare Pages
- Huvudgren: `main`
