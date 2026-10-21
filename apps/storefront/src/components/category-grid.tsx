import Link from 'next/link';
import type { PublicCategoryTreeNode } from '@b2b/contracts';
import { CategoryArt, IconArrowRight, MediaFrame } from '@b2b/ui';
import { getTranslator, localeHref, productCountLabel } from '../lib/i18n';

interface Props {
  categories: PublicCategoryTreeNode[];
  locale: string;
  /** Home pages show the first-level categories only (docs/16 §6.4). */
  limit?: number;
  /** Set when the cards are a flat list rather than a tree. */
  flat?: boolean;
}

function flatten(nodes: PublicCategoryTreeNode[]): PublicCategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const TONES = ['pink', 'mint', 'yellow', 'lavender'] as const;

export function CategoryGrid({ categories, locale, limit, flat = false }: Props) {
  const t = getTranslator(locale).t;
  const nodes = flat ? flatten(categories) : categories;
  const visible = typeof limit === 'number' ? nodes.slice(0, limit) : nodes;
  if (visible.length === 0) return null;

  return (
    <div className="category-grid">
      {visible.map((category, index) => (
        <Link
          key={category.id}
          className={`category-card tone-${TONES[index % TONES.length]}`}
          href={localeHref(locale, `/categories/${category.slug}`)}
        >
          <div className="category-card-media">
            <MediaFrame
              src={category.coverImageUrl}
              alt={category.name}
              ratio="16 / 10"
              loading="lazy"
              fallbackLabel=""
              fallbackSeed={category.slug || category.name}
            />
          </div>
          <div className="category-card-body">
            <span className="category-card-name">{category.name}</span>
            <span className="category-card-meta">
              <span>
                {productCountLabel(
                  t,
                  category.productCount,
                  'catalog.categoryItemsOne',
                  'catalog.categoryItems',
                )}
              </span>
              <span className="category-card-explore">
                {t('catalog.explore')}
                <IconArrowRight size={15} />
              </span>
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Fallback art used by pages that render category chips without cards. */
export function CategoryArtBadge({ seed }: { seed: string }) {
  return (
    <span className="state-icon" aria-hidden="true">
      <CategoryArt seed={seed} />
    </span>
  );
}
