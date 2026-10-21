import type { PublicFaqItem } from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import { buildFaqJsonLd, groupFaqItems, toggleFaqId } from './faq';

const item = (
  id: string,
  category: PublicFaqItem['category'],
  sortOrder: number,
): PublicFaqItem => ({
  id,
  category,
  sortOrder,
  question: `Question ${id}`,
  answerHtml: `<p>Answer <strong>${id}</strong></p>`,
});

describe('FAQ presentation helpers', () => {
  it('groups only published items in category and stable sort order', () => {
    const groups = groupFaqItems([
      item('wholesale-1', 'wholesale', 50),
      item('products-2', 'products', 40),
      item('products-1', 'products', 10),
    ]);
    expect(groups.map((group) => group.category)).toEqual(['products', 'wholesale']);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['products-1', 'products-2']);
    expect(groups[1]?.items.map((entry) => entry.id)).toEqual(['wholesale-1']);
  });

  it('supports multiple open answers and closes only the selected item', () => {
    const first = toggleFaqId(new Set<string>(), 'one');
    const second = toggleFaqId(first, 'two');
    expect([...second]).toEqual(['one', 'two']);
    expect([...toggleFaqId(second, 'one')]).toEqual(['two']);
  });

  it('builds structured data from the same visible text without HTML markup', () => {
    const jsonLd = buildFaqJsonLd([item('pricing', 'products', 40)]);
    expect(jsonLd.mainEntity[0]?.name).toBe('Question pricing');
    expect(jsonLd.mainEntity[0]?.acceptedAnswer.text).toBe('Answer pricing');
  });
});
