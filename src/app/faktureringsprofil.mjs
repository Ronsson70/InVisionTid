// Kundens villkor är separata per fakturerande bolag. Tom uppdragsruta ärver.
export function faktureringsprofil(s, projectId) {
  const p = s.projects.find(x => x.id === projectId);
  if (!p?.billingCompany) return {};
  const c = s.clients.find(x => x.id === p.clientId);
  const overrides = Object.fromEntries(Object.entries(p.billingProfile || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  return { ...(c?.billingProfiles?.[p.billingCompany] || {}), ...overrides };
}

export function uppdateraKundprofil(s, clientId, company, profile) {
  if (!s.clients.some(c => c.id === clientId) || !company) throw new Error('Välj kund och fakturerande bolag.');
  const terms = profile.paymentTermsDays;
  if (terms != null && terms !== '' && (!/^\d+$/.test(String(terms)) || Number(terms) > 365)) throw new Error('Ange betalningsvillkor i hela dagar, högst 365.');
  if (!['project', 'purpose'].includes(profile.travelGrouping)) throw new Error('Välj resegruppering.');
  if (profile.hourlyGrouping && !['individual', 'dated'].includes(profile.hourlyGrouping)) throw new Error('Välj gruppering av timarbete.');
  const normalized = { paymentTermsDays: terms == null || terms === '' ? null : Number(terms),
    customerReference: String(profile.customerReference || '').trim(), invoiceText: String(profile.invoiceText || '').trim(),
    vatText: String(profile.vatText || '').trim(), travelGrouping: profile.travelGrouping, hourlyGrouping: profile.hourlyGrouping || 'individual',
    hourlyLabel: String(profile.hourlyLabel || '').trim(), sessionLabel: String(profile.sessionLabel || '').trim() };
  return { ...s, clients: s.clients.map(c => c.id === clientId ? { ...c, billingProfiles: {
    ...c.billingProfiles, [company]: { ...c.billingProfiles?.[company], ...normalized },
  } } : c) };
}
