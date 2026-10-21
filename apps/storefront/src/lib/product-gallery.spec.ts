import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../../../../packages/ui/src/components/Media.tsx', import.meta.url)),
  'utf8',
);

describe('product gallery image preview', () => {
  it('opens the active image in an in-page dialog instead of an image URL link', () => {
    expect(source).not.toContain('href={active.url}');
    expect(source).toContain('setLightboxOpen(true)');
    expect(source).toContain('<Modal');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('srcSet={variantSrcSet(active.variants)}');
    expect(source).toContain('sizes="(max-width: 1023px) 100vw, 50vw"');
  });
});
