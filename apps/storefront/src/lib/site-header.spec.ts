import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../components/site-header.tsx', import.meta.url)),
  'utf8',
);

describe('storefront header language control', () => {
  it('does not render a locale switch in desktop or mobile navigation', () => {
    expect(source).not.toContain('LocaleSwitch');
    expect(source).not.toContain('locale-switch');
  });
});
