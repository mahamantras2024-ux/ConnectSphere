// File: Provides keyboard-accessible dialogs with Escape dismissal and focus restoration.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
const activeDialogs = [];
let backgroundOverflow;
// Traps keyboard focus while a dialog is open and restores focus when it closes.
export default function Modal({ title, children, onClose, wide = false, drawer = false, centered = false }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Locks background scrolling and installs the dialog's keyboard handler.
    const dialog = ref.current;
    // Capture the original scroll state once, so closing nested dialogs in any order restores it.
    if (!activeDialogs.length) backgroundOverflow = document.body.style.overflow;
    activeDialogs.push(dialog);
    const previous = document.activeElement;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    // Closes on Escape and cycles Tab through enabled dialog controls.
    function keydown(event) {
      // Only the top dialog handles keys when a confirmation overlays event details.
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
      const first = items[0], last = items[items.length - 1];
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      // Restores scrolling, removes the handler, and returns focus to the opening control.
      activeDialogs.splice(activeDialogs.indexOf(dialog), 1);
      document.removeEventListener('keydown', keydown); document.body.style.overflow = activeDialogs.length ? 'hidden' : backgroundOverflow; previous?.focus();
    };
  }, []);
  return createPortal(<div className={`modal-backdrop ${drawer ? 'drawer-backdrop' : ''} ${centered ? 'centered-detail-backdrop' : ''}`} onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal-panel ${wide ? 'modal-wide' : ''} ${drawer ? 'venue-drawer' : ''} ${centered ? 'centered-detail-panel' : ''}`}>
    <header className="modal-header"><div><p className="eyebrow">ConnectSphere</p><h2>{title}</h2></div><button className="button-secondary modal-close" aria-label="Close dialog" onClick={onClose}><span aria-hidden="true">✕</span> Close</button></header>{drawer && <div className="drawer-navigation"><button className="button-secondary" aria-label="Back to list" onClick={onClose}><span aria-hidden="true">←</span> Back to list</button></div>}{children}
  </section></div>, document.body);
}
