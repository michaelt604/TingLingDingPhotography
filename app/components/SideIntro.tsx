import { SIDE_INTRO, type SideIntroCopy } from './SideIntro.data';

interface Props {
  side: 'underwater' | 'portraits';
}

/**
 * SideIntro
 * Renders the visible heading + lead + status note above the feed.
 * The sr-only H1 inside <main> stays in the markup for screen readers
 * (the document needs exactly one H1); this one is the design hero.
 */
export function SideIntro({ side }: Props) {
  const intro: SideIntroCopy = SIDE_INTRO[side];
  return (
    <section className="sideIntro" aria-label="Introduction">
      <h2 className="sideIntroHeading">{intro.heading}</h2>
      <p className="sideIntroLead">{intro.lead}</p>
      {intro.note ? <p className="sideIntroNote">{intro.note}</p> : null}
    </section>
  );
}
