export const CONTACT_EMAIL = 'tinglingdingphotography@gmail.com';

/**
 * ContactDraft — the shared inquiry draft owned by ContactProvider.
 * All six fields are required strings (empty string = untouched).
 * The draft starts empty on reload, survives close/reopen and SPA
 * navigation, and is never cleared when the mailto link opens.
 */
export interface ContactDraft {
  name: string;
  email: string;
  timeframe: string;
  location: string;
  topic: string;
  message: string;
}

 interface MailtoFields {
   name: string;
   email: string;
   topic: string;
   message: string;
   timeframe?: string;
   location?: string;
 }

/**
 * Single formatter shared by buildContactMailto and buildContactText,
 * so the mailto body and the plain-text draft can never drift apart.
 * ContactDraft (every field present) is assignable to MailtoFields.
 */
function formatContactBody({
  name,
  email,
  topic,
  message,
  timeframe,
  location,
}: MailtoFields): { subject: string; body: string } {
  const subject = topic.trim() || 'Inquiry from your photography site';
  const parts = [
    ['Name', name],
    ['Email', email],
    ['Date / timeframe', timeframe],
    ['Location', location],
  ].flatMap(([label, value]) => (value?.trim() ? [`${label}: ${value.trim()}`] : []));

  // Cap the message so the encoded mailto URL stays within practical
  // mail-client length limits (~2000 chars total URL).
  if (message.trim()) parts.push('', message.trim().slice(0, 1500));

  return { subject, body: parts.join('\n') };
}

/**
 * Plain-text email body for a draft — the same text buildContactMailto
 * encodes into the mailto: URL, without any URL encoding.
 */
export function buildContactText(draft: ContactDraft | MailtoFields): string {
  return formatContactBody(draft).body;
}

export function buildContactMailto(fields: MailtoFields): string {
  const { subject, body } = formatContactBody(fields);
  return (
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
