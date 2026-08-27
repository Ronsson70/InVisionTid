// Statusflödet mot Lundify.
//
// Lundify är facit. Appen påstår aldrig mer än vad Lundify faktiskt säger.
//
//   open          poster som inte hör till något underlag
//   prepared      förberett underlag i In Vision Tid
//   lundifyDraft  överfört eller registrerat som utkast — INGET fakturanummer
//   lundifySent   skickad i Lundify — KRÄVER verkligt fakturanummer
//   lundifyPaid   betald enligt Lundify
//   cancelled     makulerad, alla poster frigörs
//
// Lundify ger fakturanummer först när fakturan skickas. Ett utkast saknar alltså
// nummer. Appen får aldrig hitta på ett.

export const STATUSAR = /** @type {const} */ ([
  'prepared', 'lundifyDraft', 'lundifySent', 'lundifyPaid', 'cancelled',
]);

const TILLATNA_OVERGANGAR = {
  prepared: ['lundifyDraft', 'lundifySent', 'cancelled'],
  lundifyDraft: ['lundifySent', 'cancelled'],
  lundifySent: ['lundifyPaid', 'cancelled'],
  lundifyPaid: [],
  cancelled: [],
};

export class OgiltigStatus extends Error {
  constructor(meddelande) { super(meddelande); this.name = 'OgiltigStatus'; }
}

/** Sant bara när fakturan verkligen har skickats i Lundify. */
export function arSkickad(status) {
  return status === 'lundifySent' || status === 'lundifyPaid';
}

/** Sant bara när Lundify säger att fakturan är betald. */
export function arBetald(status) {
  return status === 'lundifyPaid';
}

/** Sant när underlaget fortfarande kan redigeras utan granskningsflöde. */
export function arRedigerbar(status) {
  return status === 'prepared';
}

/**
 * Kontrollerar att ett tillstånd är internt konsekvent.
 * Kastar om ett fakturanummer saknas där det krävs, eller finns där det inte får finnas.
 */
export function kontrolleraTillstand({ status, invoiceNumber = null, invoiceDate = null, paidDate = null }) {
  if (!STATUSAR.includes(status)) {
    throw new OgiltigStatus(`Okänd status "${status}". Giltiga: ${STATUSAR.join(', ')}`);
  }
  if (status === 'prepared' && invoiceNumber) {
    throw new OgiltigStatus(
      'Ett förberett underlag kan inte ha ett fakturanummer. Numret kommer från Lundify när fakturan skickas.'
    );
  }
  if (status === 'lundifyDraft' && invoiceNumber) {
    throw new OgiltigStatus(
      'Ett Lundify-utkast har inget fakturanummer. Lundify numrerar först när fakturan skickas.'
    );
  }
  if (status === 'lundifySent' && !invoiceNumber) {
    throw new OgiltigStatus(
      'En skickad faktura kräver ett verkligt fakturanummer från Lundify. Appen får inte hitta på ett.'
    );
  }
  if (status === 'lundifyPaid' && !invoiceNumber) {
    throw new OgiltigStatus('En betald faktura kräver fakturanumret från Lundify.');
  }
  if (status === 'lundifyPaid' && !paidDate && paidDate !== undefined) {
    // paidDate är önskvärt men blockerar inte — Lundify kan sakna det vid import.
  }
  return {
    status,
    invoiceNumber: invoiceNumber ?? null,
    invoiceDate: invoiceDate ?? null,
    paidDate: paidDate ?? null,
    arSkickad: arSkickad(status),
    arBetald: arBetald(status),
    arRedigerbar: arRedigerbar(status),
  };
}

/** Kontrollerar en övergång mellan två tillstånd. */
export function overgang(fran, till, uppgifter = {}) {
  if (!STATUSAR.includes(fran)) throw new OgiltigStatus(`Okänd utgångsstatus "${fran}".`);
  if (!(TILLATNA_OVERGANGAR[fran] || []).includes(till)) {
    throw new OgiltigStatus(
      `Övergången ${fran} → ${till} är inte tillåten. Möjliga: ${(TILLATNA_OVERGANGAR[fran] || []).join(', ') || 'inga'}`
    );
  }
  return kontrolleraTillstand({ status: till, ...uppgifter });
}

/**
 * Går igenom ett helt flöde och returnerar varje steg med härledda egenskaper.
 * Kastar på första steget som är internt motsägelsefullt.
 */
export function statusFlode(steg) {
  return (steg || []).map(s => ({ ...s, ...kontrolleraTillstand(s) }));
}

/** Skapar en tom fakturareferens från ett underlag. */
export function skapaReferens(underlag, { nu = null } = {}) {
  return {
    id: underlag.id,
    clientId: underlag.clientId,
    period: underlag.period,
    rader: underlag.rader,
    nettoOre: underlag.nettoOre,
    momsUnderlag: underlag.momsUnderlag,
    momsOre: underlag.momsOre,
    bruttoForeAvrundningOre: underlag.bruttoForeAvrundningOre,
    avrundningOre: underlag.avrundningOre,
    attBetalaOre: underlag.attBetalaOre,
    status: 'prepared',
    lundifyDraftId: null,
    lundifyInvoiceId: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    paidDate: null,
    paymentTerms: null,
    customerReference: null,
    invoiceText: null,
    needsReview: false,
    reviewNote: null,
    source: 'app',
    createdAt: nu,
    updatedAt: nu,
  };
}
