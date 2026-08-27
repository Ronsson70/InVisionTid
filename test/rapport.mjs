// Skriver ut acceptansbaslinjen som en läsbar tabell.
//
//   node test/rapport.mjs           kör mot v1 (index.html som den ser ut idag)
//   node test/rapport.mjs v2        kör mot v2 när adaptern finns
//
// Exitkod är alltid 0. Det här är en lägesrapport, inte en grind. Grinden är
// node --test test/.

import { korAlla } from './acceptance-checks.mjs';

const mal = process.argv[2] || 'v1';

let adapter;
try {
  adapter = await import(`./adapters/${mal}.mjs`);
} catch {
  console.error(`Ingen adapter för "${mal}". Tillgängligt idag: v1.`);
  process.exit(1);
}

const rader = korAlla(adapter);
const symbol = { godkand: '✓', 'ej-stodd': '–', misslyckad: '✗' };
const rubrik = { godkand: 'GODKÄNT', 'ej-stodd': 'SAKNAS', misslyckad: 'FEL' };

console.log(`\nAcceptansbaslinje mot ${adapter.namn}\n${'─'.repeat(72)}`);

for (const r of rader) {
  console.log(`${symbol[r.status]} ${r.id.padEnd(4)} ${rubrik[r.status].padEnd(8)} ${r.namn}`);
  console.log(`       ${r.detalj.replace(/\n/g, '\n       ')}`);
  console.log('');
}

const antal = s => rader.filter(r => r.status === s).length;
console.log('─'.repeat(72));
console.log(`${antal('godkand')} godkända, ${antal('misslyckad')} felaktiga, ${antal('ej-stodd')} saknar stöd i ${mal}.`);
console.log(`Totalt ${rader.length} acceptanskrav.\n`);
