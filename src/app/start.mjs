// Produktionsappens start.
//
// Tre lägen, i tur och ordning:
//
//   1. inte inloggad         → inloggningssida
//   2. inloggad, ingen v2    → "Starta nya InVisionTid", kontrollsidan
//   3. inloggad, v2 finns    → appen
//
// Ingenting skrivs till OneDrive förrän användaren skrivit JA, SKRIV.

import { startaApp } from './ui.mjs';
import { skapaOneDriveLagring } from './lagring-onedrive.mjs';
import { forbered, genomfor, BEKRAFTELSE, backupFilnamn, V1_SOKVAG, V2_SOKVAG } from './infrande.mjs';
import { hamtaToken, fangaTokenFranAdress, logga_in, loggaUt } from './inloggning.mjs';
import { OgiltigStruktur } from './tillstand.mjs';

const rot = () => document.getElementById('app');
const esc = t => String(t ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let lagring = null;
let forberedelse = null;
let arbetar = false;
let felbesked = null;

async function startaMedUppdrag(tillstand) {
  let tidigareUppdrag = [];
  let tidigareUppdragFel = null;
  let historik = null;
  let historikFel = null;
  try {
    tidigareUppdrag = await lagring.lasTidigareUppdrag(tillstand);
  } catch (e) {
    // Tidigare uppdrag är en hjälpfunktion. Ett läsfel där får inte blockera
    // tidsregistreringen i den nya filen.
    tidigareUppdragFel = e.message;
  }
  try {
    historik = await lagring.lasArkiv();
  } catch (e) {
    // Arkivet är separat och skrivskyddat. Ett läsfel får inte hindra det
    // dagliga arbetet i v2-filen.
    historikFel = e.message;
  }
  return startaApp({
    lagring,
    tillstand,
    tidigareUppdrag,
    tidigareUppdragFel,
    historik,
    historikFel,
    kontoNamn: 'Microsoft OneDrive',
    synkaOm: () => window.location.reload(),
    loggaUt: () => {
      loggaUt();
      window.location.reload();
    },
  });
}

// ── Vyer före appen ─────────────────────────────────────────────────────────

function visaInloggning() {
  rot().innerHTML = `
    <header><h1>In Vision Tid</h1><div class="datum">Tidsregistrering och fakturaunderlag</div></header>
    <div class="kort">
      <p>Logga in med ditt Microsoft-konto för att komma åt dina data i OneDrive.</p>
      <button class="primar" data-loggain="1">Logga in med Microsoft</button>
      <div class="notis">Appen läser och skriver bara sina egna filer i mappen InVisionTid.</div>
    </div>`;
}

function rad(etikett, varde) {
  return `<div class="uppfrad"><span>${esc(etikett)}</span><span class="v">${esc(varde)}</span></div>`;
}

function visaInforande() {
  const f = forberedelse;
  const k = f.kalla;
  const o = f.analys.forsOver;
  const a = f.analys.lamnasIArkivet;
  const u = f.valtUt;

  rot().innerHTML = `
    <header><h1>Starta nya InVisionTid</h1>
      <div class="datum">Engångsåtgärd. Den gamla filen ändras aldrig.</div></header>

    <div class="kort">
      <div class="rubrik">Din nuvarande fil</div>
      ${rad('Sökväg', k.sokvag)}
      ${rad('Senast ändrad', k.andrad ?? 'okänt')}
      ${rad('lastSync i filen', k.lastSync ?? 'saknas')}
      ${rad('Storlek', k.byteLangd + ' byte')}
      ${rad('SHA-256', k.checksumma)}
      ${rad('Kunder', k.antal.kunder)}
      ${rad('Uppdrag', k.antal.uppdrag)}
      ${rad('Tidsposter', k.antal.tidsposter)}
      ${rad('Resor', k.antal.resor)}
      ${rad('Utlägg', k.antal.utlagg)}
      ${rad('Fakturamarkeringar', k.antal.fakturamarkeringar)}
      ${k.saknadeSamlingar.length
        ? `<div class="notis">Filen saknar ${esc(k.saknadeSamlingar.join(', '))}. Det är tillåtet — de räknas som tomma.</div>`
        : ''}
      <div class="notis">Filen läses bara. Den ändras, flyttas eller döps aldrig om.</div>
    </div>

    <div class="kort">
      <div class="rubrik">Detta förs över</div>
      ${rad('Aktiva kunder', o.kunder)}
      ${rad('Aktiva uppdrag', o.uppdrag)}
      ${rad('Öppna tidsposter', o.oppnaPoster)}
      ${rad('Öppna resor', o.oppnaResor)}
      ${rad('Öppna utlägg', o.oppnaUtlagg)}
      ${rad('Fakturamarkeringar', '0')}
      ${rad('Redan uträknat och kontrollerat', `${u.poster} poster, ${u.artiklar} artiklar`)}
      <div class="notis">
        Tid på fastprisuppdrag följer med som uppföljning och kan inte bli fakturarader.
        Behandlingstillfällen får antal 1 och måste kontrolleras, eftersom den gamla appen
        räknade unika datum i stället för antal. Momssatser som inte är bekräftade blockerar
        fakturaunderlag, men hindrar inte att appen används. Fastprisperioder behålls för
        granskning och gissas inte.
      </div>
    </div>

    <div class="kort">
      <div class="rubrik">Detta stannar i den gamla filen</div>
      ${rad('Vilande kunder', a.kunder)}
      ${rad('Vilande uppdrag', a.uppdrag)}
      ${rad('Fakturerade tidsposter', a.fakturerade.poster)}
      ${rad('Fakturerade resor', a.fakturerade.resor)}
      ${rad('Gamla fakturamarkeringar', a.fakturamarkeringar)}
      <div class="notis">
        Historiken finns kvar i den gamla filen, oförändrad. Gamla fakturamarkeringar
        förs inte över — de har varit fel åt båda håll, och Lundify är facit.
      </div>
    </div>

    <div class="kort">
      <div class="rubrik">Så här går det till</div>
      <div class="notis">
        Den nya filen är redan uträknad och kontrollerad här i webbläsaren.
        Ingenting har skrivits, och ingenting skrivs förrän du bekräftar.<br><br>
        1. En byte-identisk backup av den gamla filen skapas i OneDrive och verifieras.<br>
        2. Backupen erbjuds också som nedladdning till datorn.<br>
        3. Först därefter skapas ${esc(V2_SOKVAG)}.<br>
        4. Den nya filen läses tillbaka och kontrolleras.<br>
        Misslyckas något steg avbryts allt, och den gamla filen är fortfarande orörd.
        En backup som redan finns skrivs aldrig över.
      </div>
      <div class="faltrubrik">Skriv ${esc(BEKRAFTELSE)} för att genomföra</div>
      <input type="text" data-falt="bekraftelse" placeholder="${esc(BEKRAFTELSE)}" autocomplete="off">
      ${felbesked ? `<div class="varning"><strong>Införandet avbröts</strong>${esc(felbesked)}</div>` : ''}
      <button class="primar" data-genomfor="1" ${arbetar ? 'disabled' : ''}>
        ${arbetar ? 'Arbetar…' : 'Skapa backup och starta nya InVisionTid'}</button>
      <button class="avbryt" data-loggaut="1">Logga ut</button>
    </div>`;
}

/**
 * v2-filen finns men går inte att använda.
 *
 * Appen startar inte, och skriver ingenting. Att skriva över filen hade kunnat
 * förstöra det enda spåret av ett avbrutet införande.
 */
function visaOanvandbarV2(fel) {
  rot().innerHTML = `
    <header><h1>In Vision Tid</h1>
      <div class="datum">Den nya filen går inte att använda</div></header>
    <div class="kort">
      <div class="varning">
        <strong>${esc(V2_SOKVAG)} finns, men kunde inte läsas in</strong>
        ${esc(fel.message)}
      </div>
      ${fel.samling ? rad('Samling', fel.samling) : ''}
      <div class="notis">
        Appen har inte ändrat någonting. Filen ligger kvar precis som den är, och den
        gamla filen är oförändrad. Flytta undan eller döp om den nya filen i OneDrive
        om du vill göra ett nytt införande — ta inte bort någon backup.
      </div>
      <button class="sekundar" data-laddaom="1">Ladda om</button>
      <button class="avbryt" data-loggaut="1">Logga ut</button>
    </div>`;
}

function visaFel(text) {
  rot().innerHTML = `
    <header><h1>In Vision Tid</h1></header>
    <div class="kort">
      <div class="varning"><strong>Något gick fel</strong>${esc(text)}</div>
      <button class="sekundar" data-laddaom="1">Ladda om</button>
      <button class="avbryt" data-loggaut="1">Logga ut</button>
    </div>`;
}

// ── Åtgärder ────────────────────────────────────────────────────────────────

async function genomforInforande() {
  const skrivet = document.querySelector('[data-falt="bekraftelse"]')?.value ?? '';
  felbesked = null;
  arbetar = true;
  visaInforande();
  try {
    const nu = new Date().toISOString();
    const resultat = await genomfor(forberedelse, lagring.graph, { bekraftelse: skrivet, nu });
    laddaNerBackup(forberedelse.ravara, backupFilnamn(nu));
    lagring.sattVersion({ eTag: resultat.v2.eTag, checksumma: resultat.v2.checksumma, id: resultat.v2.id });
    await startaMedUppdrag(resultat.tillstand);
  } catch (e) {
    arbetar = false;
    felbesked = e.message;
    visaInforande();
  }
}

/** Erbjuder backupen som nedladdning, så en kopia finns utanför OneDrive. */
function laddaNerBackup(text, filnamn) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filnamn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { /* nedladdningen är ett extra skydd, inte ett krav */ }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-loggain],[data-loggaut],[data-genomfor],[data-laddaom]');
  if (!t) return;
  if (t.dataset.loggain) return logga_in();
  if (t.dataset.loggaut) { loggaUt(); window.location.reload(); return; }
  if (t.dataset.laddaom) { window.location.reload(); return; }
  if (t.dataset.genomfor) return genomforInforande();
});

// ── Start ───────────────────────────────────────────────────────────────────

export async function start() {
  const token = fangaTokenFranAdress() ?? hamtaToken();
  if (!token) return visaInloggning();

  lagring = skapaOneDriveLagring({ token });

  try {
    let tillstand = null;
    try {
      tillstand = await lagring.las();
    } catch (e) {
      // Filen finns, men går inte att använda. Ett avbrutet införande kan ha
      // hunnit skapa den. Då ska appen INTE starta på den, och absolut inte
      // skriva över den — den kan vara det enda som finns kvar av försöket.
      if (e instanceof OgiltigStruktur) return visaOanvandbarV2(e);
      throw e;
    }
    if (tillstand) return startaMedUppdrag(tillstand);

    // Ingen v2-fil ännu: kontrollsidan. Inget skrivs.
    forberedelse = await forbered(lagring.graph, { nu: new Date().toISOString() });
    return visaInforande();
  } catch (e) {
    if (e.name === 'Utloggad') { loggaUt(); return visaInloggning(); }
    return visaFel(e.message);
  }
}

export { V1_SOKVAG, V2_SOKVAG };
