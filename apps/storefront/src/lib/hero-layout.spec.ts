import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const homePage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/page.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('../../../../packages/ui/styles/storefront.css', import.meta.url)),
  'utf8',
);

describe('storefront hero layout contract', () => {
  it('uses a four-product mixed collage linked to real product pages', () => {
    expect(homePage).toContain('const heroProducts = homepageHeroProducts(homepage);');
    expect(homePage).toContain('data-count={Math.max(1, Math.min(heroProducts.length, 4))}');
    expect(homePage).toContain('href={localeHref(locale, `/products/${product.slug}`)}');
    expect(homePage).toContain('fit="contain"');
    expect(homePage).toContain("loading={index === 0 ? 'eager' : 'lazy'}");
  });

  it('keeps the hero conversion actions and OEM positioning wired to their existing paths', () => {
    expect(homePage).toContain("href={localeHref(locale, '/products')}");
    expect(homePage).toContain("label={t('home.heroSecondaryCta')}");
    expect(homePage).toContain("t('home.heroPointFactory')");
    expect(homePage).toContain("t('home.heroPointOem')");
    expect(homePage).toContain("t('home.heroPointPackaging')");
  });

  it('defines distinct desktop, tablet and phone collage layouts', () => {
    expect(styles).toMatch(
      /\.hero-collage\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(0,\s*0\.9fr\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?\.hero-inner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.hero-collage,[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.hero-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it('keeps internal pricing out of the public homepage source', () => {
    expect(homePage).not.toMatch(/\bprice(Cny|Usd|Amount)?\b/i);
  });
});
