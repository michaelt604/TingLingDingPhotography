/**
 * Locks body scroll while a modal/lightbox is open, compensating for the
 * disappearing scrollbar by padding the body so layout doesn't shift.
 *
 * Returns an unlock function that restores the previous overflow and
 * padding-right; call it from the effect cleanup.
 */
export function lockBodyScroll(): () => void {
  const previousOverflow = document.body.style.overflow;
  const previousPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (scrollbarWidth > 0)
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  return () => {
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  };
}
