import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  fileURLToPath(new URL('../components/product-card.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('../../../../packages/ui/styles/storefront.css', import.meta.url)),
  'utf8',
);
const qualityPage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/quality/page.tsx', import.meta.url)),
  'utf8',
);
const factoryPage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/factory/page.tsx', import.meta.url)),
  'utf8',
);

describe('product card layout contract', () => {
  it('uses a contain-fit square image without clipping the card shell', () => {
    expect(component).toContain('ratio="1 / 1"');
    expect(component).toContain('fit="contain"');
    expect(component).toContain('srcSet={imageSrcSet(product.coverImage?.variants)}');
    expect(component).toContain('sizes={PRODUCT_GRID_IMAGE_SIZES}');
    expect(styles).toMatch(/\.product-card\s*\{[^}]*overflow:\s*visible/s);
  });

  it('keeps both actions in a two-column grid with shrinkable full-width buttons', () => {
    expect(styles).toMatch(
      /\.product-card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /\.product-card-actions > \.btn\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*var\(--touch-target\)[^}]*white-space:\s*normal/s,
    );
  });

  it('stacks actions when cards become narrow', () => {
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.product-card-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it('uses two columns on phones and falls back to one only on extreme narrow screens', () => {
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.product-grid,[\s\S]*?\.grid-cards\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.category-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 359px\)[\s\S]*?\.product-grid,[\s\S]*?\.grid-cards,[\s\S]*?\.category-grid,[\s\S]*?\.factory-process-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(styles).not.toMatch(/@media \(max-width: 420px\)/);
  });

  it('applies the compact responsive card treatment to quality credentials', () => {
    expect(qualityPage).toContain('grid-cards quality-grid');
    expect(qualityPage).toContain('quality-card');
    expect(qualityPage).toContain('quality-card-title');
    expect(qualityPage).toContain('quality-card-link');
  });

  it('applies a separate two-column mobile process layout on the factory page', () => {
    expect(factoryPage).toContain('steps-grid factory-process-grid');
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.factory-process-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });
});
