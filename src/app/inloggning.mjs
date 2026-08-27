// Microsoft-inloggning.
//
// Återanvänder webbläsarappens befintliga SPA-konfiguration oförändrad:
// samma klient-ID och samma redirect-adress som redan är registrerad för
// produktionswebbplatsens rot. Ingen ändring av appregistreringen behövs.
//
// Tokenet finns bara i webbläsaren. Det skrivs aldrig till en logg, en rapport
// eller till Git, och koden hanterar aldrig ett lösenord.

export const MS_CLIENT_ID = 'a556c14a-656f-433e-b485-c4513122856c';
export const MS_SCOPES = 'Files.ReadWrite Calendars.Read';

const TOKEN_KEY = 'invisiontid-ms-token';
const TOKEN_EXPIRY_KEY = 'invisiontid-ms-expiry';

export const redirectUri = () => window.location.origin + window.location.pathname;

export function hamtaToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    const utgang = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    if (t && Date.now() < utgang) return t;
  } catch { /* blockerad lagring, behandlas som utloggad */ }
  return null;
}

function sparaToken(token, sekunder) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + sekunder * 1000));
  } catch { /* ignoreras, användaren får logga in igen */ }
}

export function loggaUt() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch { /* ignoreras */ }
}

export function inloggningsUrl() {
  const p = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUri(),
    scope: MS_SCOPES,
    response_mode: 'fragment',
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${p}`;
}

/**
 * Tar emot tokenet ur adressfältet efter inloggning och rensar bort det
 * därifrån, så det inte blir kvar i historiken.
 */
export function fangaTokenFranAdress() {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return null;
  const p = new URLSearchParams(hash.substring(1));
  const token = p.get('access_token');
  const sekunder = parseInt(p.get('expires_in') || '3600', 10);
  if (!token) return null;
  sparaToken(token, sekunder);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

export function logga_in() { window.location.href = inloggningsUrl(); }
