'use client';

import { useState } from 'react';
import { IconCheck, IconCopy } from './icons';

export interface CopyButtonProps {
  value: string;
  /** Accessible label, already translated by the caller. */
  label: string;
  copiedLabel: string;
  className?: string;
  size?: number;
}

/**
 * Copies a technical value (request id, entity id, SKU) with a visible result
 * state. Uses the async clipboard API with a selection fallback, and never
 * raises an alert (docs/16 §5.3).
 */
export function CopyButton({ value, label, copiedLabel, className, size = 16 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 3000);
    }
  };

  return (
    <button
      type="button"
      className={['copy-button', className].filter(Boolean).join(' ')}
      data-copied={copied}
      title={failed ? value : copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      {copied ? <IconCheck size={size} /> : <IconCopy size={size} />}
      <span className="visually-hidden" role="status">
        {copied ? copiedLabel : ''}
      </span>
    </button>
  );
}
