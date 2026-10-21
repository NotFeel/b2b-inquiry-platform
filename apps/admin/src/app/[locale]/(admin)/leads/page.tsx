'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea, useToast } from '@b2b/ui';
import type { CustomerLookupResult } from '@b2b/contracts';
import { AdminApiError, adminApi } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { useSession } from '../../../../components/session-provider';

// Sales workflow: find a customer by phone, then append a conversation.
// The platform cannot read the salesperson's WhatsApp history, so entries are
// registered here explicitly (docs/09 §1-§2).
export default function LeadsPage() {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [lookup, setLookup] = useState<CustomerLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    salespersonName: '',
    salespersonPhone: '',
    occurredAt: new Date().toISOString().slice(0, 16),
    productSkus: '',
    note: '',
  });

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.post<{ data: CustomerLookupResult }>('/admin/customers/lookup', {
        phone,
        ...(country ? { country: country.toUpperCase() } : {}),
      });
      setLookup(result.data);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await adminApi.post('/admin/inquiry-activities', {
        ...(lookup?.exactMatch ? { customerId: lookup.exactMatch.id } : { phone, ...(country ? { countryCode: country.toUpperCase() } : {}) }),
        salespersonName: form.salespersonName.trim(),
        ...(form.salespersonPhone ? { salespersonPhone: form.salespersonPhone } : {}),
        occurredAt: new Date(form.occurredAt).toISOString(),
        productSkus: form.productSkus
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        note: form.note.trim() || null,
        source: 'manual',
      });
      toast.success(t('leads.created'));
      await search();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">{t('leads.title')}</h1>
          <p className="small muted">{t('leads.whatsappNote')}</p>
        </div>
      </header>

      <section className="panel stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>{t('leads.phoneSearch')}</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Field label={t('leads.phoneSearch')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={phone}
                placeholder={t('leads.phonePlaceholder')}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('leads.country')} help="ISO 3166-1 alpha-2">
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={country}
                placeholder={t('common.none')}
                options={['CN', 'US', 'DE', 'GB', 'FR', 'IT', 'ES', 'NL', 'AE', 'AU', 'BR', 'IN', 'JP', 'KR', 'SG', 'ZA'].map(
                  (code) => ({ value: code, label: code }),
                )}
                onChange={(event) => setCountry(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={busy}>
            {t('leads.search')}
          </Button>
        </form>
        {error ? <p className="field-error">{error}</p> : null}
        {lookup ? (
          <div className="stack-sm">
            <p className="small">
              {lookup.exactMatch ? t('leads.existing') : t('leads.noMatch')}
              {lookup.countryRequired ? ` · ${t('leads.countryRequired')}` : ''}
            </p>
            {lookup.exactMatch ? (
              <dl className="definition-list">
                <dt>{t('leads.phoneSearch')}</dt>
                <dd className="mono">{lookup.exactMatch.phoneDisplay}</dd>
                <dt>{t('leads.country')}</dt>
                <dd>{lookup.exactMatch.countryCode ?? '-'}</dd>
                <dt>{t('categories.productCount')}</dt>
                <dd>{lookup.exactMatch.activityCount}</dd>
              </dl>
            ) : null}
            {lookup.activities.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 'var(--text-sm)' }}>{t('leads.history')}</h3>
                <ul className="small">
                  {lookup.activities.map((activity) => (
                    <li key={activity.id}>
                      {new Date(activity.occurredAt).toLocaleString(locale)} · {activity.salespersonName} ·{' '}
                      {activity.productSkus.join(', ') || '-'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {can('lead.create') ? (
        <section className="panel stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>{t('leads.newActivity')}</h2>
          <div className="grid-form">
            <Field label={t('leads.salesperson')} required>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.salespersonName}
                  onChange={(event) => setForm((current) => ({ ...current, salespersonName: event.target.value }))}
                />
              )}
            </Field>
            <Field label={t('leads.salespersonPhone')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.salespersonPhone}
                  onChange={(event) => setForm((current) => ({ ...current, salespersonPhone: event.target.value }))}
                />
              )}
            </Field>
            <Field label={t('leads.occurredAt')} required>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  type="datetime-local"
                  value={form.occurredAt}
                  onChange={(event) => setForm((current) => ({ ...current, occurredAt: event.target.value }))}
                />
              )}
            </Field>
            <Field label={t('leads.skus')} help={t('leads.skusHelp')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.productSkus}
                  onChange={(event) => setForm((current) => ({ ...current, productSkus: event.target.value }))}
                />
              )}
            </Field>
          </div>
          <Field label={t('leads.note')}>
            {({ inputId, describedBy }) => (
              <Textarea
                inputId={inputId}
                describedBy={describedBy}
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
            )}
          </Field>
          <div className="row">
            <Button loading={busy} disabled={!lookup?.exactMatch && phone.length < 4} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
