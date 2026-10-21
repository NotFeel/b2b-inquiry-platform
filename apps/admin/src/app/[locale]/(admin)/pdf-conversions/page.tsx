'use client';

import { useState } from 'react';
import { Button, Field, Input, Modal, useToast } from '@b2b/ui';
import { ResourcePage } from '../../../../components/resource-page';
import type { PdfConversionJobSummary } from '@b2b/contracts';
import { JOB_STATUS_TONES, StatusTag } from '@b2b/ui';
import { AdminApiError, adminApi, uploadFile } from '../../../../lib/admin-api';
import { translateError } from '../../../../lib/i18n';
import { useSession } from '../../../../components/session-provider';

export default function PdfConversionsPage() {
  const { t, can, locale } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadState, setUploadState] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const upload = async (file: File) => {
    setBusy(true);
    setUploadState(null);
    try {
      const asset = await uploadFile(file, 'quote-template');
      setAssetId(asset.id);
      setUploadState(`${asset.originalName} → ${asset.id}`);
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    setBusy(true);
    try {
      await adminApi.post('/admin/pdf-conversions', { fileAssetId: assetId.trim() });
      toast.success(t('documents.convert'));
      setOpen(false);
      setReloadKey((value) => value + 1);
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
      <ResourcePage<PdfConversionJobSummary>
        key={reloadKey}
        title={t('nav.pdf')}
        listPath="/admin/pdf-conversions"
        rowKey={(row) => row.id}
        columns={() => [
          { key: 'file', header: t('documents.templateName'), render: (row) => row.sourceFileName },
          {
            key: 'status',
            header: t('documents.status'),
            render: (row) => <StatusTag value={row.status} label={row.status} toneMap={JOB_STATUS_TONES} />,
          },
          { key: 'pages', header: t('documents.pageCount'), render: (row) => row.pageCount ?? '-' },
          {
            key: 'output',
            header: t('documents.output'),
            render: (row) => row.outputUrl ?? row.errorCode ?? '-',
            truncate: true,
          },
          {
            key: 'createdAt',
            header: t('documents.createdAt'),
            render: (row) => new Date(row.createdAt).toLocaleString(locale),
          },
        ]}
      />
      {can('pdf.convert') ? (
        <Button onClick={() => setOpen(true)}>{t('documents.convert')}</Button>
      ) : null}

      <Modal
        open={open}
        title={t('documents.convert')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={assetId.length === 0} onClick={() => void convert()}>
              {t('documents.convert')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label={t('documents.uploadWorkbook')} help="Macro-free .xlsx only. Size, signature and sheet limits apply.">
            {({ inputId }) => (
              <input
                id={inputId}
                type="file"
                accept=".xlsx"
                aria-label="Workbook"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            )}
          </Field>
          {uploadState ? <p className="field-help">{uploadState}</p> : null}
          <Field label={t('documents.fileAssetId')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
