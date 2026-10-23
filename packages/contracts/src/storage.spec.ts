import { describe, expect, it } from 'vitest';
import { storageVisibilityForKey } from './storage';

describe('storage visibility routing', () => {
  it('routes private workbooks, product sources and unknown keys to the private bucket', () => {
    expect(storageVisibilityForKey('product-image/2026/10/source.png')).toBe('private');
    expect(storageVisibilityForKey('quote-template/2026/10/template.xlsx')).toBe('private');
    expect(storageVisibilityForKey('quote-exports/2026/10/export.xlsx')).toBe('private');
    expect(storageVisibilityForKey('category-cover/2026/10/cover.webp')).toBe('private');
    expect(storageVisibilityForKey('credential-document/2026/10/certificate.pdf')).toBe('private');
    expect(storageVisibilityForKey('unknown/future-file.bin')).toBe('private');
  });

  it('routes only explicit public purposes and derived variants publicly', () => {
    expect(storageVisibilityForKey('public/products/asset/version/640.webp')).toBe('public');
    expect(storageVisibilityForKey('public/banners/2026/10/home.webp')).toBe('public');
  });
});
