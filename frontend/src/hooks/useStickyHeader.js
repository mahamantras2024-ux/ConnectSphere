import { useLayoutEffect, useRef } from 'react';

/**
 * Measures the signed-in navigation so native scroll targets stop below its actual wrapped height.
 * Observing the element also catches the Technical Support navigation portal and role-dependent controls.
 */
export default function useStickyHeader(activeRole) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!activeRole) return undefined;
    const root = document.documentElement;
    const previousHeight = root.style.getPropertyValue('--app-header-height');
    let active = true;
    /** A disconnected observer may have a queued callback; only the current header can change scroll clearance. */
    function measure() {
      // Round up fractional font/layout pixels so native integer scrolling cannot clip the target.
      if (active) root.style.setProperty('--app-header-height', `${Math.ceil(ref.current.getBoundingClientRect().height)}px`);
    }
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(ref.current);
    else window.addEventListener('resize', measure);
    return () => {
      active = false;
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
      // Preserve a pre-existing value, and clear our offset when the signed-in header goes away.
      if (previousHeight) root.style.setProperty('--app-header-height', previousHeight);
      else root.style.removeProperty('--app-header-height');
    };
  }, [activeRole]);
  return ref;
}
