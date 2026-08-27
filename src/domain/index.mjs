// Samlad export för domänen. Inga React- eller DOM-beroenden, inga sidoeffekter.
//
//   pengar          heltalsöre, ROUND_HALF_UP, kvantiteter i tusendelar
//   moms            momsunderlag per sats, öresavrundning
//   artiklar        arbetstyper, priset sitter här och inte på projektet
//   leveranser      fasta leveranser och milstolpar, aldrig kalenderfördelade
//   underlag        faktureringsunderlag, radbygge, låsning med prissnapshot
//   fakturareferens statusflödet mot Lundify
//   migrering       v1 → v2, ren och idempotent
//   resor           reseförslag ur uppdragets standardavstånd

export * from './pengar.mjs';
export * from './moms.mjs';
export * from './artiklar.mjs';
export * from './leveranser.mjs';
export * from './underlag.mjs';
export * from './fakturareferens.mjs';
export * from './migrering.mjs';
export * from './resor.mjs';
export * from './nystart.mjs';
