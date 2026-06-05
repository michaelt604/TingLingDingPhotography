'use client';

import { useState, type FormEvent } from 'react';
import styles from './Contact.module.css';

const TO_EMAIL = 'tinglingdingphotography@gmail.com';

interface Props {
  heading?: string;
  /** Side the contact section is on — only affects the placeholder text */
  side?: 'underwater' | 'portraits';
  /** Called after the mailto: link fires. Useful for closing a modal wrapper. */
  onAfterSubmit?: () => void;
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
  side = 'portraits',
  onAfterSubmit,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const subject = (topic || 'Inquiry from your photography site').trim();

    const lines = [
      name ? `Name: ${name.trim()}` : null,
      email ? `Email: ${email.trim()}` : null,
      '',
      message.trim(),
    ].filter((line) => line !== null) as string[];

    const body = lines.join('\n');
    const href =
      `mailto:${TO_EMAIL}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    window.location.href = href;
    onAfterSubmit?.();
  };

  const placeholderTopic =
    side === 'underwater'
      ? 'e.g. Underwater session inquiry'
      : 'e.g. Portrait session inquiry';

  return (
    <section className={styles.contact} id="contact" aria-label="Contact">
      <div className="container">
        <div className={styles.inner}>
          <h2 className={styles.title}>{heading}</h2>

          <form
            className={styles.form}
            onSubmit={onSubmit}
            action={`mailto:${TO_EMAIL}`}
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
              <a className={styles.direct} href={`mailto:${TO_EMAIL}`}>
                or email {TO_EMAIL}
              </a>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

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
