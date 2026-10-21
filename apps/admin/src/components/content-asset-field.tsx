'use client';

import { useRef, useState } from 'react';
import { Button, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { uploadContentAsset } from '../lib/content-ops-api';
import { useSession } from './session-provider';

interface Props {
  purpose: string;
  accept: string;
  assetId: string | null;
  assetUrl: string | null;
  mediaType?: 'image' | 'video' | 'document';
  label: string;
  disabled?: boolean;
  onChange: (asset: { id: string; url: string | null; originalName: string } | null) => void;
}

export function ContentAssetField({
  purpose,
  accept,
  assetId,
  assetUrl,
  mediaType = 'image',
  label,
  disabled = false,
  onChange,
}: Props) {
  const { t } = useSession();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadContentAsset(file, purpose);
      onChange({ id: uploaded.id, url: uploaded.url, originalName: uploaded.originalName });
      toast.success(t('contentOps.common.saved'));
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError ? caught.message : t('contentOps.common.saveError'),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="content-asset-field">
      {assetUrl ? (
        <div className="content-asset-preview">
          {mediaType === 'image' ? (
            <img src={assetUrl} alt={label} />
          ) : mediaType === 'video' ? (
            <video src={assetUrl} controls preload="metadata" />
          ) : (
            <a href={assetUrl} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          )}
        </div>
      ) : (
        <span className="field-help">{t('contentOps.common.none')}</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <div className="row-tight">
        <Button
          size="sm"
          variant="secondary"
          loading={uploading}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {assetId ? t('contentOps.common.replaceFile') : t('contentOps.common.upload')}
        </Button>
        {assetId ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || uploading}
            onClick={() => onChange(null)}
          >
            {t('contentOps.common.removeFile')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
