// Syntetisk källa i minnet, som står i stället för OneDrive eller localStorage
// under etapp 4A. Den räknar varje läsning och skrivning, så testerna kan bevisa
// att en avbruten migrering aldrig ens försökte skriva.

export function skapaMinneskalla(initialText, { felVidSkrivning = null } = {}) {
  let text = initialText;
  const historik = [];
  const backuper = [];

  return {
    /** Vad källan innehåller just nu. Används för byte-jämförelser. */
    get innehall() { return text; },

    /** Antal skrivningar. Ska vara 0 efter ett avbrott. */
    get antalSkrivningar() { return historik.length; },
    get historik() { return [...historik]; },
    get backuper() { return [...backuper]; },

    las: async () => text,

    skriv: async (nyText) => {
      if (felVidSkrivning) throw new Error(felVidSkrivning);
      historik.push(nyText);
      text = nyText;
    },

    sparaBackup: async (backup) => {
      backuper.push(backup);
    },
  };
}

/** Källa vars backupskrivning misslyckas, för att pröva ordningen backup före skrivning. */
export function skapaKallaMedTrasigBackup(initialText) {
  const kalla = skapaMinneskalla(initialText);
  return {
    ...kalla,
    get innehall() { return kalla.innehall; },
    get antalSkrivningar() { return kalla.antalSkrivningar; },
    sparaBackup: async () => { throw new Error('disken är full'); },
  };
}
