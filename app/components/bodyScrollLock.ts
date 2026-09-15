/**
 * Locks body scroll while a modal/lightbox is open, compensating for the
 * disappearing scrollbar by padding the body so layout doesn't shift.
 *
 * Ref-counted: stacked dialogs (e.g. viewer + contact) each hold a lock
 * and only the last unlock restores the previous overflow and
 * padding-right. Call the returned function from the effect cleanup;
 * double-calling it is a safe no-op.
 */
let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0)
      document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    }
  };
}
