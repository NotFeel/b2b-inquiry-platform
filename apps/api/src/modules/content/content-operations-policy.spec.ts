import { describe, expect, it } from 'vitest';
import {
  homeSectionItemKind,
  isCredentialExpired,
  isValidityOrderValid,
} from './content-operations-policy';

describe('content operations policy', () => {
  it('never treats an unknown or perpetual validity as expired', () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    expect(isCredentialExpired('not_specified', past)).toBe(false);
    expect(isCredentialExpired('perpetual', past)).toBe(false);
    expect(isCredentialExpired('dated', null)).toBe(false);
    expect(isCredentialExpired('dated', past)).toBe(true);
    expect(
      isCredentialExpired(
        'dated',
        new Date('2026-10-20T00:00:00.000Z'),
        new Date('2026-10-20T23:59:59.000Z'),
      ),
    ).toBe(false);
  });

  it('validates the end date after the start date', () => {
    expect(isValidityOrderValid('2026-01-01', '2026-12-31')).toBe(true);
    expect(isValidityOrderValid('2026-12-31', '2026-01-01')).toBe(false);
    expect(isValidityOrderValid(null, '2026-01-01')).toBe(true);
    expect(isValidityOrderValid('2026-01-01', null)).toBe(true);
  });

  it('maps homepage section codes to the correct item type', () => {
    expect(homeSectionItemKind('home.factory-preview')).toBe('factory_media');
    expect(homeSectionItemKind('home.quality-preview')).toBe('credential');
    expect(homeSectionItemKind('home.unknown')).toBeNull();
  });
});
