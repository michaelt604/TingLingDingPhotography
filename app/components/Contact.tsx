'use client';

import { useState, type FormEvent } from 'react';
import {
  buildContactMailto,
  buildContactText,
  CONTACT_EMAIL,
} from './contactMailto';
import type { ContactControlledProps } from './ContactProvider';
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
  draft?: ContactControlledProps['draft'];
  onDraftChange?: ContactControlledProps['onDraftChange'];
  /** Collection context; copy stays neutral across collections (unused). */
  side?: ContactControlledProps['side'];
}

/**
 * Contact
 * A no-backend inquiry form. On submit it opens the user's mail client
 * with everything pre-filled via a mailto: link. Nothing is sent by the
 * site itself — the "Open email draft" button just hands a pre-filled
 * draft to the visitor's email app.
 *
 *  - Needs JS to build the draft; without JS use the direct email link.
 *  - Cleans/normalises the values
 *  - URL-encodes everything properly
 *  - Copy-email / Copy-inquiry reuse the shared buildContactText
 *    formatter, so clipboard text and the mailto body never drift apart.
 *    When the Clipboard API is unavailable or rejects, the text is shown
 *    in a selectable field instead.
 */
export function Contact({
  heading = 'Get in touch',
  headingId,
  draft,
  onDraftChange,
}: Props) {
  const [localName, setLocalName] = useState('');
  const [localEmail, setLocalEmail] = useState('');
  const [localTimeframe, setLocalTimeframe] = useState('');
  const [localLocation, setLocalLocation] = useState('');
  const [localTopic, setLocalTopic] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [status, setStatus] = useState('');
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  const controlled = draft !== undefined && onDraftChange !== undefined;

  const name = controlled ? draft.name : localName;
  const email = controlled ? draft.email : localEmail;
  const timeframe = controlled ? draft.timeframe : localTimeframe;
  const location = controlled ? draft.location : localLocation;
  const topic = controlled ? draft.topic : localTopic;
  const message = controlled ? draft.message : localMessage;

  // Prefix modal field ids so the modal form and the homepage form never
  // share duplicate ids when both are in the DOM.
  const idPrefix = headingId === 'contact-modal-title' ? 'modal-' : '';

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // The draft is intentionally kept: reopening the dialog (or navigating
    // back) shows exactly what was typed before the mail client opened.
    const href = buildContactMailto({
      name,
      email,
      timeframe,
      location,
      topic,
      message,
    });
    setStatus(
      'Your email app should open with this message. If it does not, use the direct email link below.',
    );
    window.location.assign(href);
  };

  const copyText = async (text: string, okMessage: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(text);
      setCopyFallback(null);
      setStatus(okMessage);
    } catch {
      setCopyFallback(text);
      setStatus('Copy was blocked. Select the text below and copy it manually.');
    }
  };

  const placeholderTopic = 'e.g. A project, collaboration, or question';


  return (
    <section className={styles.contact} id="contact" aria-label="Contact">
      <div className="container">
        <div className={styles.inner}>
          <h2 className={styles.title} id={headingId}>{heading}</h2>
          <p className={styles.responseNote}>Have an idea or a question? Fill this in to open a draft in your email app.</p>

          <form
            className={styles.form}
            onSubmit={onSubmit}
            action={`mailto:${CONTACT_EMAIL}`}
            method="post"
            encType="text/plain"
          >
            <div className={styles.row}>
              <Field
                id={`${idPrefix}contact-name`}
                label="Name"
                value={name}
                onChange={(v) => (controlled ? onDraftChange({ name: v }) : setLocalName(v))}
                autoComplete="name"
              />
              <Field
                id={`${idPrefix}contact-email`}
                label="Email"
                type="email"
                value={email}
                onChange={(v) => (controlled ? onDraftChange({ email: v }) : setLocalEmail(v))}
                autoComplete="email"
                required
              />
            </div>

            <div className={styles.row}>
              <Field
                id={`${idPrefix}contact-timeframe`}
                label="Date / timeframe"
                value={timeframe}
                onChange={(v) => (controlled ? onDraftChange({ timeframe: v }) : setLocalTimeframe(v))}
                placeholder="e.g. October 2026 or flexible"
              />
              <Field
                id={`${idPrefix}contact-location`}
                label="Location"
                value={location}
                onChange={(v) => (controlled ? onDraftChange({ location: v }) : setLocalLocation(v))}
                autoComplete="address-level2"
                placeholder="City, venue, or remote"
              />
            </div>

            <Field
              id={`${idPrefix}contact-topic`}
              label="Subject"
              value={topic}
              onChange={(v) => (controlled ? onDraftChange({ topic: v }) : setLocalTopic(v))}
              placeholder={placeholderTopic}
            />

            <Field
              id={`${idPrefix}contact-message`}
              label="Message"
              value={message}
              onChange={(v) => (controlled ? onDraftChange({ message: v }) : setLocalMessage(v))}
              textarea
              required
            />

            <div className={styles.actions}>
              <button type="submit" className={`${styles.submit} btn btn--primary`}>
                Open email draft
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
              <a className={styles.direct} href={`mailto:${CONTACT_EMAIL}`}>
                or email {CONTACT_EMAIL}
              </a>
            </div>
            <div className={styles.copyRow}>
              <button type="button" className={styles.copyButton} onClick={() => void copyText(CONTACT_EMAIL, 'Email address copied.')}>
                Copy email
              </button>
              <button type="button" className={styles.copyButton} onClick={() => void copyText(buildContactText({ name, email, timeframe, location, topic, message }), 'Inquiry copied. Paste it into your email app.')}>
                Copy inquiry
              </button>
            </div>
            {copyFallback !== null && (
              <textarea
                className={`${styles.input} ${styles.fallback}`}
                readOnly
                rows={6}
                value={copyFallback}
                aria-label="Copy this text manually"
                onFocus={(e) => e.target.select()}
              />
            )}
            <p className={styles.status} role="status" aria-live="polite">
              {status}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
