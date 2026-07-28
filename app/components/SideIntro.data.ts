export interface SideIntroCopy {
  /** Short human-readable heading shown above the Instagram feed. */
  heading: string;
  /** Lead sentence — usually one line, sets the tone for the page. */
  lead: string;
  /** Optional secondary note — e.g. a current booking status. */
  note?: string;
}

/**
 * Per-side intro copy. Kept here so the side pages and any shared
 * sub-component (e.g. a future "About this series" panel) can use
 * the same wording.
 */
export const SIDE_INTRO: Record<'underwater' | 'portraits', SideIntroCopy> = {
  underwater: {
    heading: 'The world below the surface.',
    lead: 'Underwater and nature photography from dives, expeditions, and quiet mornings.',
    note: 'Currently accepting expedition commissions for late 2026.',
  },
  portraits: {
    heading: 'Portraits, made for faces.',
    lead: 'Intimate, considered sessions — clients, friends, and the occasional stranger who lets me in.',
    note: 'Booking portrait sessions through autumn 2026.',
  },
};
