'use client';

import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
  help?: string;
  error?: string;
  required?: boolean;
  hint?: ReactNode;
}

// Renders a labelled form control and wires aria-describedby to help/error text
// so screen readers announce validation state (docs/06 §7).
export function Field({ label, children, help, error, required, hint }: FieldProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="visually-hidden">(required)</span> : null}
      </label>
      {children({ inputId, describedBy })}
      {hint}
      {help ? (
        <span className="field-help" id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
