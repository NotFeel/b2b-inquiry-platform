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
const homePage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/page.tsx', import.meta.url)),
  'utf8',
);
const homepageSection = readFileSync(
  fileURLToPath(new URL('../components/homepage-product-section.tsx', import.meta.url)),
  'utf8',
);
const productsPage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/products/page.tsx', import.meta.url)),
  'utf8',
);
const categoryPage = readFileSync(
  fileURLToPath(new URL('../app/[locale]/categories/[slug]/page.tsx', import.meta.url)),
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

  it('uses the required wide product container', () => {
    expect(styles).toMatch(
      /\.container-products\s*\{[^}]*width:\s*96%[^}]*max-width:\s*1800px[^}]*margin-inline:\s*auto/s,
    );
  });

  it('uses six, four, three and two product columns at the required breakpoints', () => {
    expect(styles).toMatch(
      /\.product-grid,\s*\.product-rail\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1199px\)\s*\{[\s\S]*?\.product-grid,[\s\S]*?\.product-rail\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.product-grid,[\s\S]*?\.product-rail\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*?\.product-grid,[\s\S]*?\.product-rail,[\s\S]*?\.grid-cards\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
  });

  it('never collapses product grids to one column on narrow phones', () => {
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.category-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    const extremeNarrow = styles.slice(styles.indexOf('@media (max-width: 359px)'));
    expect(extremeNarrow).not.toContain('.product-grid');
    expect(extremeNarrow).not.toContain('.product-rail');
    expect(styles).not.toMatch(/@media \(max-width: 420px\)/);
  });

  it('connects every storefront product listing to the wide product container', () => {
    expect(homePage).toContain('<HomepageProductSection');
    expect(homePage).toContain('storefrontApi');
    expect(homePage).toContain('.getHomepage(locale)');
    expect(homePage).not.toContain('isPreOrder');
    expect(homePage).not.toContain('featured: true');
    expect(homePage).not.toContain('category-grid');
    expect(homePage).not.toContain('homeSections.data.map');
    expect(homePage).toContain('key={`new-arrivals:${locale}`}');
    expect(homePage).toContain('key={`${collection.id}:${locale}`}');
    expect(homepageSection).toContain('<ProductCard');
    expect(homepageSection).toContain('className="product-grid"');
    expect(homepageSection).toContain('loadMoreHomepageSection');
    expect(productsPage).toContain('className="container-products"');
    expect(categoryPage).toContain('className="container-products stack"');
    expect(categoryPage).toContain('className="product-grid"');
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
