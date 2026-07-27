'use client';

import { useState, type FormEvent } from 'react';
import { buildContactMailto, CONTACT_EMAIL } from './contactMailto';
import styles from './Contact.module.css';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}

function Field({ id, label, value, onChange, type = 'text', textarea, required, autoComplete, placeholder }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={`mono ${styles.label}`}>{label}{required ? ' *' : ''}</label>
      {textarea ? (
        <textarea
          id={id}
          name={id}
          className={styles.input}
          rows={6}
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          className={styles.input}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

interface Props {
  heading?: string;
  headingId?: string;
  /** Side the contact section is on — only affects the placeholder text */
  side?: 'underwater' | 'portraits';
}

/**
 * Contact
 * A no-backend inquiry form. On submit it opens the user's mail client
 * with everything pre-filled via a mailto: link.
 *
 *  - Works without JS (the form has a fallback `action="mailto:..."`)
 *  - Cleans/normalises the values
 *  - URL-encodes everything properly
 */
export function Contact({
  heading = 'Get in touch',
  headingId,
  side = 'portraits',
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const href = buildContactMailto({ name, email, topic, message });
    setStatus(
      'Your email app should open with this message. If it does not, use the direct email link below.',
    );
    window.location.assign(href);
  };

  const placeholderTopic =
    side === 'underwater'
      ? 'e.g. Underwater session inquiry'
      : 'e.g. Portrait session inquiry';

  return (
    <section className={styles.contact} id="contact" aria-label="Contact">
      <div className="container">
        <div className={styles.inner}>
          <h2 className={styles.title} id={headingId}>{heading}</h2>

          <form
            className={styles.form}
            onSubmit={onSubmit}
            action={`mailto:${CONTACT_EMAIL}`}
            method="post"
            encType="text/plain"
          >
            <div className={styles.row}>
              <Field
                id="contact-name"
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="name"
              />
              <Field
                id="contact-email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                required
              />
            </div>

            <Field
              id="contact-topic"
              label="Subject"
              value={topic}
              onChange={setTopic}
              placeholder={placeholderTopic}
            />

            <Field
              id="contact-message"
              label="Message"
              value={message}
              onChange={setMessage}
              textarea
              required
            />

            <div className={styles.actions}>
              <button type="submit" className={`${styles.submit} btn btn--primary`}>
                Send
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
              <a className={styles.direct} href={`mailto:${CONTACT_EMAIL}`}>
                or email {CONTACT_EMAIL}
              </a>
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {status}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
