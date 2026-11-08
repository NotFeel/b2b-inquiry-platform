'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { IconClose } from './icons';

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DrawerLabels {
  maximize?: string;
  restore?: string;
  resize?: string;
}

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  footer?: ReactNode;
  /** Preset width. `xl` is intended for data-heavy order/detail drawers. */
  size?: DrawerSize;
  /** Enables the left-edge pointer/keyboard resize handle. */
  resizable?: boolean;
  /** Shows the maximize/restore control in the header. */
  maximizable?: boolean;
  /** Initial width in pixels when resizable is enabled. */
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  labels?: DrawerLabels;
  className?: string;
}

const DEFAULT_MIN_WIDTH = 420;
const MAX_WIDTH_MARGIN = 24;
const KEYBOARD_RESIZE_STEP = 32;

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(width, minWidth), maxWidth);
}

/**
 * Right-side dialog used by the admin workbench.
 *
 * The width is a CSS custom property so a caller can widen the panel without
 * copying its structure. Resizing uses native Pointer Events and is also
 * operable from the keyboard (Left/Right, Home, End) on the separator
 * (docs/43 §11.3).
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  closeLabel = 'Close',
  footer,
  size,
  resizable = false,
  maximizable = false,
  defaultWidth,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth,
  labels,
  className,
}: DrawerProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const asideRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [width, setWidth] = useState<number | null>(defaultWidth ?? null);
  const [maximized, setMaximized] = useState(false);

  const upperBound = () =>
    maxWidth ?? Math.max(DEFAULT_MIN_WIDTH, window.innerWidth - MAX_WIDTH_MARGIN);

  useEffect(() => {
    if (!open) {
      setMaximized(false);
      return undefined;
    }
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Move focus into the dialog and restore it on close. Tab is kept inside
    // the drawer so keyboard users cannot interact with the obscured page.
    const aside = asideRef.current;
    aside?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !aside) return;
      const focusable = Array.from(aside.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === aside)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      dragRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizable || maximized) return;
    event.preventDefault();
    event.stopPropagation();
    const currentWidth =
      asideRef.current?.getBoundingClientRect().width ?? width ?? DEFAULT_MIN_WIDTH;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampWidth(
      drag.startWidth + (drag.startX - event.clientX),
      minWidth,
      upperBound(),
    );
    setWidth(next);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!resizable || maximized) return;
    const currentWidth =
      asideRef.current?.getBoundingClientRect().width ?? width ?? DEFAULT_MIN_WIDTH;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = currentWidth + KEYBOARD_RESIZE_STEP;
    else if (event.key === 'ArrowRight') next = currentWidth - KEYBOARD_RESIZE_STEP;
    else if (event.key === 'Home') next = minWidth;
    else if (event.key === 'End') next = upperBound();
    if (next === null) return;
    event.preventDefault();
    setMaximized(false);
    setWidth(clampWidth(next, minWidth, upperBound()));
  };

  const style = {
    ...(width !== null && !maximized ? { '--drawer-width': `${width}px` } : {}),
  } as CSSProperties;

  return (
    <div
      className="overlay overlay-right"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={asideRef}
        className={[
          'drawer',
          size ? `drawer-${size}` : '',
          maximized ? 'drawer-maximized' : '',
          resizable ? 'drawer-resizable' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {resizable && !maximized ? (
          <div
            className="drawer-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={labels?.resize ?? 'Resize panel'}
            aria-valuemin={minWidth}
            aria-valuemax={Math.round(upperBound())}
            aria-valuenow={Math.round(
              width ?? asideRef.current?.getBoundingClientRect().width ?? 0,
            )}
            tabIndex={0}
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={resizeWithKeyboard}
          />
        ) : null}
        <header className="modal-header">
          <h2 style={{ fontSize: 'var(--text-lg)' }}>{title}</h2>
          <div className="drawer-header-actions">
            {maximizable ? (
              <button
                type="button"
                className="icon-button"
                aria-label={
                  maximized
                    ? (labels?.restore ?? 'Restore panel')
                    : (labels?.maximize ?? 'Maximize panel')
                }
                aria-pressed={maximized}
                onClick={() => setMaximized((current) => !current)}
              >
                {maximized ? <IconRestore /> : <IconMaximize />}
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>
              <IconClose size={18} />
            </button>
          </div>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

function IconMaximize() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}
