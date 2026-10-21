'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getTranslator } from '../lib/i18n';

interface Option {
  value: string;
  label: string;
}

export function CatalogSortSelect({
  locale,
  value,
  options,
}: {
  locale: string;
  value: string;
  options: Option[];
}) {
  const t = getTranslator(locale).t;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="catalog-sort-control">
      <span className="field-label">{t('catalog.sort')}</span>
      <select
        className="select"
        value={value}
        aria-label={t('catalog.sort')}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('sortBy', event.target.value);
          params.delete('page');
          const suffix = params.toString();
          router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
