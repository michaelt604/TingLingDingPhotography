export const CONTACT_EMAIL = 'tinglingdingphotography@gmail.com';

interface MailtoFields {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export function buildContactMailto({
  name,
  email,
  topic,
  message,
}: MailtoFields): string {
  const subject = topic.trim() || 'Inquiry from your photography site';
  const parts: string[] = [];

  if (name.trim()) parts.push(`Name: ${name.trim()}`);
  if (email.trim()) parts.push(`Email: ${email.trim()}`);
  if (message.trim()) parts.push('', message.trim());

  return (
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(parts.join('\n'))}`
  );
}
