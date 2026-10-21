'use client';

import { useId, useState } from 'react';
import type { PublicFaqItem } from '@b2b/contracts';
import { IconChevronDown } from '@b2b/ui';
import { toggleFaqId } from '../lib/faq';

interface Props {
  items: PublicFaqItem[];
}

/**
 * Accessible multi-open FAQ accordion. Each question is a real button and every
 * panel remains in the DOM so `aria-controls` always resolves to its target.
 */
export function FaqAccordion({ items }: Props) {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpenIds((current) => {
      return toggleFaqId(current, id);
    });
  };

  return (
    <div className="faq-list">
      {items.map((item, index) => {
        const open = openIds.has(item.id);
        const triggerId = `${baseId}-trigger-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <article className="faq-item" key={item.id} data-open={open}>
            <h3 className="faq-question-heading">
              <button
                id={triggerId}
                type="button"
                className="faq-question-button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span>{item.question}</span>
                <IconChevronDown className="faq-question-icon" size={20} />
              </button>
            </h3>
            <div
              id={panelId}
              className="faq-answer"
              role="region"
              aria-labelledby={triggerId}
              hidden={!open}
            >
              <div className="prose" dangerouslySetInnerHTML={{ __html: item.answerHtml }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
