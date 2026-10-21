export type CredentialValidityType = 'dated' | 'perpetual' | 'not_specified';

/** A credential without an end date is never treated as expired. */
export function isCredentialExpired(
  validityType: CredentialValidityType,
  validUntil: Date | null,
  now: Date = new Date(),
): boolean {
  if (validityType !== 'dated' || validUntil === null) return false;
  const endDay = Date.UTC(
    validUntil.getUTCFullYear(),
    validUntil.getUTCMonth(),
    validUntil.getUTCDate(),
  );
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return endDay < currentDay;
}

/** Empty bounds are allowed; when both exist the end must not precede start. */
export function isValidityOrderValid(
  validFrom: string | Date | null | undefined,
  validUntil: string | Date | null | undefined,
): boolean {
  if (!validFrom || !validUntil) return true;
  const from = validFrom instanceof Date ? validFrom.toISOString().slice(0, 10) : validFrom;
  const until = validUntil instanceof Date ? validUntil.toISOString().slice(0, 10) : validUntil;
  return until >= from;
}

export function homeSectionItemKind(code: string): 'factory_media' | 'credential' | null {
  if (code === 'home.factory-preview') return 'factory_media';
  if (code === 'home.quality-preview') return 'credential';
  return null;
}
