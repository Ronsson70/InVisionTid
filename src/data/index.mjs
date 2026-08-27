// Datalagret. Ingenting här känner till OneDrive, localStorage eller filsystemet.
//
//   backup             rådata byte för byte, med checksumma
//   forhandsgranskning migrering i minnet, kan inte spara
//   migreringskorning  förbered, godkänn, genomför, återställ
//
// Läsning och skrivning skickas in som funktioner. Kopplingen mot ett verkligt
// lager görs först i etapp 4B, i egna moduler, och först efter godkännande.

export * from './backup.mjs';
export * from './forhandsgranskning.mjs';
export * from './migreringskorning.mjs';
