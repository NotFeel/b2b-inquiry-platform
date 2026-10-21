import { FAQ_CATEGORY_CODES, type FaqCategoryCode, type PublicFaqItem } from '@b2b/contracts';
import { htmlToPlainText } from './content';

export interface FaqCategoryGroup {
  category: FaqCategoryCode;
  items: PublicFaqItem[];
}

/** Multi-open accordion state: each click toggles only the requested item. */
export function toggleFaqId(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Groups visible questions in the documented category order. */
export function groupFaqItems(items: PublicFaqItem[]): FaqCategoryGroup[] {
  return FAQ_CATEGORY_CODES.map((category) => ({
    category,
    items: items
      .filter((item) => item.category === category)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Structured data is built from the same questions and sanitized answers that
 * are visible on the page. No hidden or aspirational FAQ entries are added.
 */
export function buildFaqJsonLd(items: PublicFaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: htmlToPlainText(item.answerHtml, 10_000) ?? '',
      },
    })),
  };
}
