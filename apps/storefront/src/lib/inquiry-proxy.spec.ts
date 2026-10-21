import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8');
const nextConfig = readFileSync(
  fileURLToPath(new URL('../../next.config.mjs', import.meta.url)),
  'utf8',
);

describe('inquiry same-origin proxy', () => {
  it('posts inquiry intents to the same-origin endpoint', () => {
    expect(apiSource).toContain(
      "export const INQUIRY_INTENT_ENDPOINT = '/api/v1/public/inquiry-intents'",
    );
    expect(apiSource).toContain('fetch(INQUIRY_INTENT_ENDPOINT');
    expect(apiSource).not.toContain('`${API_BASE_URL}/api/v1/public/inquiry-intents`');
  });

  it('forwards only the inquiry endpoint to the server-side proxy target', () => {
    expect(nextConfig).toContain("source: '/api/v1/public/inquiry-intents'");
    expect(nextConfig).toContain('destination: `${target}/api/v1/public/inquiry-intents`');
    expect(nextConfig).toContain('STOREFRONT_API_PROXY_TARGET');
  });
});
