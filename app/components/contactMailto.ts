export const CONTACT_EMAIL = 'tinglingdingphotography@gmail.com';

interface MailtoFields {
  name: string;
  email: string;
  topic: string;
  message: string;
  timeframe?: string;
  location?: string;
}

export function buildContactMailto({
  name,
  email,
  topic,
  message,
  timeframe,
  location,
}: MailtoFields): string {
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

  return (
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(parts.join('\n'))}`
  );
}
