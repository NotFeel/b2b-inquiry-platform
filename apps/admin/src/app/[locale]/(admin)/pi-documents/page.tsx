'use client';

import { useState } from 'react';
import { DICTIONARY_TYPES } from '@b2b/contracts';
import { Button, ConfirmDialog, Field, Modal, Select, Textarea, useToast } from '@b2b/ui';
import { PI_STATUS_TONES, StatusTag } from '@b2b/ui';
import type { PiDocumentSummary } from '@b2b/contracts';
import { AdminApiError, adminApi } from '../../../../lib/admin-api';
import { useDictionaryOptions } from '../../../../lib/dictionary-options';
import { translateError } from '../../../../lib/i18n';
import { ResourcePage } from '../../../../components/resource-page';
import { useSession } from '../../../../components/session-provider';

interface ItemDraft {
  sku: string;
  productName: string;
  quantity: string;
  unitPrice: string;
}

// PI amounts are always recomputed by the server; this form only supplies inputs
// (docs/08 §5.2).
export default function PiDocumentsPage() {
  const { t, can, locale } = useSession();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [issueTarget, setIssueTarget] = useState<PiDocumentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Payment terms option code ('' = none, `__custom__` = free text) and the
  // clause text that is snapshotted onto the PI document.
  const [paymentTermCode, setPaymentTermCode] = useState('');
  const paymentTerms = useDictionaryOptions(DICTIONARY_TYPES.paymentTerms, { locale });
  const [form, setForm] = useState({
    currency: 'USD',
    sellerCompany: '',
    buyerCompany: '',
    paymentTerms: '',
    items: '[\n  { "sku": "DEMO-1001", "productName": "Hex bolt M12", "quantity": "1000", "unitPrice": "0.28" }\n]',
    notes: '',
  });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = JSON.parse(form.items) as ItemDraft[];
      await adminApi.post('/admin/pi-documents', {
        currency: form.currency,
        seller: { companyName: form.sellerCompany.trim() },
        buyer: { companyName: form.buyerCompany.trim() },
        // The chosen option is snapshotted as text: a PI must keep the clause it
        // was issued with even if the dictionary entry changes later.
        ...(form.paymentTerms.trim().length > 0
          ? { terms: { paymentTerms: form.paymentTerms.trim() } }
          : {}),
        items: items.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unit: 'pcs',
        })),
        notes: form.notes.trim() || null,
      });
      toast.success(t('common.saved'));
      setCreateOpen(false);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.VALIDATION_FAILED'),
      );
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!issueTarget) return;
    setBusy(true);
    try {
      await adminApi.post(`/admin/pi-documents/${issueTarget.id}/status`, { status: 'review' });
      await adminApi.post(`/admin/pi-documents/${issueTarget.id}/status`, { status: 'issued' });
      toast.success(t('common.saved'));
      setIssueTarget(null);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const createRevision = async (row: PiDocumentSummary) => {
    try {
      await adminApi.post(`/admin/pi-documents/${row.id}/revisions`);
      toast.success(t('documents.revision_create'));
      setReloadKey((value) => value + 1);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    }
  };

  return (
    <div className="stack">
      <ResourcePage<PiDocumentSummary>
        key={reloadKey}
        title={t('nav.pi')}
        description={t('documents.amountsServerSide')}
        listPath="/admin/pi-documents"
        rowKey={(row) => row.id}
        canCreate={can('pi.create')}
        createPath="/admin/pi-documents"
        extraActions={(row) => (
          <>
            {can('pi.update') && (row.status === 'draft' || row.status === 'review') ? (
              <Button size="sm" variant="secondary" onClick={() => setIssueTarget(row)}>
                {t('documents.issue')}
              </Button>
            ) : null}
            {can('pi.update') && row.status === 'issued' ? (
              <Button size="sm" variant="secondary" onClick={() => void createRevision(row)}>
                {t('documents.revision_create')}
              </Button>
            ) : null}
            {can('pi.export') ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void adminApi
                    .post(`/admin/pi-documents/${row.id}/export`, {})
                    .then(() => toast.success(t('common.saved')))
                    .catch(() => toast.error(t('errors.INTERNAL_ERROR')))
                }
              >
                Excel
              </Button>
            ) : null}
          </>
        )}
        columns={() => [
          { key: 'piNo', header: t('documents.piNo'), render: (row) => <span className="mono">{row.piNo}</span> },
          { key: 'revision', header: t('documents.revision'), render: (row) => `r${row.revisionNo}` },
          {
            key: 'status',
            header: t('documents.status'),
            render: (row) => <StatusTag value={row.status} label={row.status} toneMap={PI_STATUS_TONES} />,
          },
          { key: 'currency', header: t('documents.currency'), render: (row) => row.currency },
          { key: 'buyer', header: t('documents.buyer'), render: (row) => String(row.buyer.companyName ?? '-') },
          {
            key: 'total',
            header: t('documents.total'),
            align: 'right',
            render: (row) => <span className="mono">{row.totalAmount}</span>,
          },
        ]}
      />
      {can('pi.create') ? <Button onClick={() => setCreateOpen(true)}>{t('common.create')}</Button> : null}

      <Modal
        open={createOpen}
        title={t('common.create')}
        size="lg"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void create()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid-form">
          <Field label={t('documents.currency')} required>
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                aria-describedby={describedBy}
                className="input"
                value={form.currency}
                onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
              />
            )}
          </Field>
          <Field label={t('documents.seller')} required>
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                aria-describedby={describedBy}
                className="input"
                value={form.sellerCompany}
                onChange={(event) => setForm((current) => ({ ...current, sellerCompany: event.target.value }))}
              />
            )}
          </Field>
          <Field label={t('documents.buyer')} required>
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                aria-describedby={describedBy}
                className="input"
                value={form.buyerCompany}
                onChange={(event) => setForm((current) => ({ ...current, buyerCompany: event.target.value }))}
              />
            )}
          </Field>
          <Field
            label={t('documents.paymentTerms')}
            help={t('documents.paymentTermsHelp')}
            error={paymentTerms.error ? t('dictionary.optionsLoadFailed') : undefined}
            hint={
              paymentTermCode && paymentTermCode !== '__custom__' && form.paymentTerms ? (
                // Shows the clause that will be snapshotted, so the choice is
                // verifiable before saving.
                <span className="field-hint-inline">{form.paymentTerms}</span>
              ) : undefined
            }
          >
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={paymentTermCode}
                disabled={paymentTerms.loading}
                placeholder={t('dictionary.filters.all')}
                options={[
                  ...paymentTerms.options.map((option) => ({ value: option.value, label: option.label })),
                  { value: '__custom__', label: t('documents.customPaymentTerms') },
                ]}
                onChange={(event) => {
                  const code = event.target.value;
                  setPaymentTermCode(code);
                  if (code === '__custom__') {
                    setForm((current) => ({ ...current, paymentTerms: '' }));
                    return;
                  }
                  const item = paymentTerms.items.find((candidate) => candidate.code === code);
                  // The clause text lives in the item's extra value; the label is
                  // only the fallback when no clause was configured.
                  setForm((current) => ({
                    ...current,
                    paymentTerms: item ? (item.value ?? item.label) : '',
                  }));
                }}
              />
            )}
          </Field>
        </div>
        {paymentTermCode === '__custom__' ? (
          <Field label={t('documents.customPaymentTerms')}>
            {({ inputId, describedBy }) => (
              <Textarea
                inputId={inputId}
                describedBy={describedBy}
                rows={2}
                maxLength={500}
                value={form.paymentTerms}
                onChange={(event) =>
                  setForm((current) => ({ ...current, paymentTerms: event.target.value }))
                }
              />
            )}
          </Field>
        ) : null}
        <Field label={t('documents.itemsJson')} required help={t('documents.amountsServerSide')} error={error ?? undefined}>
          {({ inputId, describedBy }) => (
            <Textarea
              inputId={inputId}
              describedBy={describedBy}
              rows={8}
              value={form.items}
              onChange={(event) => setForm((current) => ({ ...current, items: event.target.value }))}
            />
          )}
        </Field>
        <Field label={t('leads.note')}>
          {({ inputId, describedBy }) => (
            <Textarea
              inputId={inputId}
              describedBy={describedBy}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          )}
        </Field>
      </Modal>

      <ConfirmDialog
        open={issueTarget !== null}
        title={t('documents.issue')}
        description="Issuing freezes this revision. Later changes require a new revision."
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void issue()}
        onCancel={() => setIssueTarget(null)}
      />
    </div>
  );
}
