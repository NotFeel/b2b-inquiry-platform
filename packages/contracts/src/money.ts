/**
 * Money helpers shared by the API and the admin UI.
 *
 * Money is always carried as a decimal string (never a float) between layers.
 * Arithmetic lives on the server in `apps/api` using decimal.js (docs/07 §5).
 */

const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,6})?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim());
}

/** Round a decimal string half-up without going through binary floating point. */
export function roundDecimalString(value: string, scale: number): string {
  const negative = value.trim().startsWith('-');
  const unsigned = negative ? value.trim().slice(1) : value.trim();
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  const keep = fracPart.slice(0, scale).padEnd(scale, '0');
  const nextDigit = fracPart.charAt(scale);
  let result = `${intPart}${keep}`.replace(/^0+(?=\d)/, '');
  if (nextDigit && Number(nextDigit) >= 5) {
    result = incrementDigits(result);
  }
  const padded = scale > 0 ? result.padStart(scale + 1, '0') : result;
  const withPoint =
    scale > 0 ? `${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}` : padded;
  return negative && /[1-9]/.test(withPoint) ? `-${withPoint}` : withPoint;
}

function incrementDigits(digits: string): string {
  const chars = digits.split('');
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const current = chars[i] ?? '0';
    if (current === '9') {
      chars[i] = '0';
    } else {
      chars[i] = String(Number(current) + 1);
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

export function formatMoney(amount: string, currency: string, locale = 'en-US'): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}
