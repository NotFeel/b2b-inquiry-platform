'use client';

import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface BaseProps {
  invalid?: boolean;
  inputId?: string;
  describedBy?: string;
  /** Unit suffix such as `mm` - the unit is always visible in the admin UI (docs/06 §5). */
  unit?: string;
}

export function Input({
  invalid,
  inputId,
  describedBy,
  unit,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & BaseProps) {
  const input = (
    <input
      {...rest}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={['input', className].filter(Boolean).join(' ')}
    />
  );
  if (!unit) return input;
  return (
    <span className="input-unit">
      {input}
      <span className="input-unit-suffix">{unit}</span>
    </span>
  );
}

export function Textarea({
  invalid,
  inputId,
  describedBy,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & BaseProps) {
  return (
    <textarea
      {...rest}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={['textarea', className].filter(Boolean).join(' ')}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  inputId?: string;
  describedBy?: string;
}

export function Select({
  options,
  placeholder,
  invalid,
  inputId,
  describedBy,
  className,
  ...rest
}: SelectProps) {
  return (
    <select
      {...rest}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={['select', className].filter(Boolean).join(' ')}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  help?: string;
}

export function Checkbox({ label, help, id, ...rest }: CheckboxProps) {
  return (
    <label className="checkbox-row" htmlFor={id}>
      <input {...rest} id={id} type="checkbox" />
      <span className="checkbox-label">
        {label}
        {help ? <span className="field-help">{help}</span> : null}
      </span>
    </label>
  );
}
