'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { IconClose } from './icons';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  /** Destructive confirmations stay closable only via an explicit choice. */
  dismissOnBackdrop?: boolean;
}

/**
 * Accessible dialog with focus management.
 *
 * Focus is captured **once per open transition**: the effects depend on `open`
 * only and read `onClose` through a ref. Consumers routinely pass a freshly
 * created `onClose` on every render, and a re-run of the focus effect would
 * restore focus to the opener and then move it to the dialog's first focusable
 * element - which is the header close button. That made it impossible to type
 * into a dialog field: every keystroke moved focus to the `×`.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeLabel = 'Close',
  dismissOnBackdrop = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  // Kept current without participating in any effect dependency list.
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const node = dialogRef.current;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Take focus only if it is not already inside the dialog, so a re-render
    // can never steal it from the field the user is typing in.
    if (node && !node.contains(document.activeElement)) {
      const target =
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        // Prefer the first form control over the header close button.
        node.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ) ??
        node;
      target.focus({ preventScroll: true });
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      const restore = previouslyFocused.current;
      previouslyFocused.current = null;
      if (restore && document.contains(restore)) restore.focus({ preventScroll: true });
    };
  }, [open]);

  // Keyboard handling is registered once per open transition.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const nodes = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="overlay overlay-center"
      onClick={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={['modal', size === 'sm' ? 'modal-sm' : '', size === 'lg' ? 'modal-lg' : '']
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        // Fallback focus target for dialogs without any form control.
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 style={{ fontSize: 'var(--text-xl)' }}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  loading?: boolean;
  /** Blocks the destructive action while a precondition (for example an impact
   * check) is not satisfied. The reason stays visible in the description. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      dismissOnBackdrop={false}
      closeLabel={cancelLabel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  );
}
