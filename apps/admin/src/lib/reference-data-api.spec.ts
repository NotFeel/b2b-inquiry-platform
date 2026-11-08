import { describe, expect, it } from 'vitest';
import { filterReferenceOptions, type ReferenceOption } from './reference-data-api';

const options: ReferenceOption[] = [
  { id: 'us', code: 'US', label: 'United States', value: null, enabled: true },
  { id: 'cn', code: 'CN', label: 'China', value: null, enabled: true },
  { id: 'gb', code: 'GB', label: 'United Kingdom', value: null, enabled: true },
];

describe('filterReferenceOptions', () => {
  it('matches by localized label or ISO code, case-insensitively', () => {
    expect(filterReferenceOptions(options, 'china').map((option) => option.code)).toEqual(['CN']);
    expect(filterReferenceOptions(options, 'gb').map((option) => option.code)).toEqual(['GB']);
    expect(filterReferenceOptions(options, '  united  ').map((option) => option.code)).toEqual([
      'US',
      'GB',
    ]);
  });

  it('returns the full list for an empty query', () => {
    expect(filterReferenceOptions(options, '')).toBe(options);
  });
});
