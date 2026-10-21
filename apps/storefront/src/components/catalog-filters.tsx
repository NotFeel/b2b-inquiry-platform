'use client';

import { useState, type ReactNode } from 'react';
import { Button, Drawer, IconFilter } from '@b2b/ui';
import { getTranslator } from '../lib/i18n';

interface Props {
  locale: string;
  children: ReactNode;
  activeCount?: number;
  /** Rendered next to the Filters button on small screens. */
  trailing?: ReactNode;
}

// Desktop shows a 260px sticky filter rail; below 1024px the same filters move
// into a drawer so the product grid keeps the full width (docs/16 §6.5).
export function CatalogFilters({ locale, children, activeCount = 0, trailing }: Props) {
  const t = getTranslator(locale).t;
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="catalog-sidebar" aria-label={t('catalog.filters')}>
        {children}
      </aside>

      <div className="catalog-filter-button row" style={{ justifyContent: 'space-between' }}>
        <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
          <IconFilter size={17} />
          {activeCount > 0
            ? t('catalog.showFiltersCount', { count: activeCount })
            : t('catalog.showFilters')}
        </Button>
        {trailing}
      </div>

      <Drawer
        open={open}
        title={t('catalog.filters')}
        onClose={() => setOpen(false)}
        closeLabel={t('inquiry.close')}
      >
        {children}
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <Button block onClick={() => setOpen(false)}>
            {t('catalog.showProducts')}
          </Button>
        </div>
      </Drawer>
    </>
  );
}
