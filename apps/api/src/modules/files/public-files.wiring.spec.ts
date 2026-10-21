import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicController = readFileSync(resolve(__dirname, './public-files.controller.ts'), 'utf8');
const mediaController = readFileSync(resolve(__dirname, './media.controller.ts'), 'utf8');

describe('public image delivery wiring', () => {
  it('uses a publication-gated versioned product-image route with immutable caching', () => {
    expect(publicController).toContain("@Get('images/:assetId/:version/:name')");
    expect(publicController).toContain('resolvePublicProductImage(assetId, version, name)');
    expect(publicController).toContain('public, max-age=31536000, immutable');
    expect(publicController).toContain('Cache-Tag');
  });

  it('keeps product source previews behind authenticated admin permissions', () => {
    expect(mediaController).toContain("@Get('assets/:id/preview')");
    expect(mediaController).toContain('Permission.productRead');
    expect(mediaController).toContain("'private, no-store'");
  });
});
