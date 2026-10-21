'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  footer?: ReactNode;
}

export function Drawer({ open, title, onClose, children, closeLabel = 'Close', footer }: DrawerProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Depends on `open` only: the caller typically passes a new `onClose` every
  // render, and re-running this effect would clear and re-apply the body scroll
  // lock (and re-register the listener) on every keystroke inside the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="overlay overlay-right"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}
