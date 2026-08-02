export const CONTACT_EMAIL = 'tinglingdingphotography@gmail.com';

interface MailtoFields {
  name: string;
  email: string;
  topic: string;
  message: string;
  sessionType?: string;
  timeframe?: string;
  location?: string;
  budgetUsage?: string;
}

export function buildContactMailto({
  name,
  email,
  topic,
  message,
  sessionType,
  timeframe,
  location,
  budgetUsage,
}: MailtoFields): string {
  const subject = topic.trim() || 'Inquiry from your photography site';
  const parts = [
    ['Name', name],
    ['Email', email],
    ['Session type', sessionType],
    ['Date / timeframe', timeframe],
    ['Location', location],
    ['Budget / usage', budgetUsage],
  ].flatMap(([label, value]) => (value?.trim() ? [`${label}: ${value.trim()}`] : []));

  if (message.trim()) parts.push('', message.trim());

  return (
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(parts.join('\n'))}`
  );
}
