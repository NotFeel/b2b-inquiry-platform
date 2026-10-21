import { ERROR_CODES } from '@b2b/contracts';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { ApiError } from '../../common/errors/api-error';

export interface NormalizedPhone {
  e164: string;
  countryCode: string | null;
  nationalNumber: string;
}

/**
 * Normalises a customer phone number to E.164.
 *
 * The country is never guessed from the caller's IP: when the number has no
 * international prefix and no country was supplied, the operator is asked to
 * pick one (docs/04 §5, docs/09 §2).
 */
export function normalizePhone(raw: string, countryCode?: string | null): NormalizedPhone {
  const trimmed = raw.trim();
  const hadPlusPrefix = trimmed.startsWith('+');
  const country = countryCode ? (countryCode.toUpperCase() as CountryCode) : undefined;
  const parsed = parsePhoneNumberFromString(trimmed, country);

  if (!parsed || !parsed.isValid()) {
    if (!hadPlusPrefix && !country) {
      throw new ApiError(
        ERROR_CODES.customerCountryRequired,
        'Select the customer country so the number can be normalised.',
      );
    }
    throw new ApiError(ERROR_CODES.customerPhoneInvalid, 'The phone number could not be normalised.');
  }

  if (!hadPlusPrefix && !country) {
    throw new ApiError(
      ERROR_CODES.customerCountryRequired,
      'Select the customer country so the number can be normalised.',
    );
  }

  return {
    e164: parsed.number,
    countryCode: parsed.country ?? country ?? null,
    nationalNumber: parsed.nationalNumber,
  };
}

/** Digits-only fallback used for fuzzy searching when parsing fails. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164;
  return `${e164.slice(0, 4)}${'*'.repeat(Math.max(0, e164.length - 7))}${e164.slice(-3)}`;
}
