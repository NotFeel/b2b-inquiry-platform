'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRODUCT_IMAGE_LIMITS,
  type FileOperationSummary,
  type MediaStagingResult,
  type ProductImageSummary,
} from '@b2b/contracts';
import { Badge, Button, Card, ConfirmDialog, Input, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import { formatBytes } from '../lib/product-form';
import { getProductImageStaging, productsApi, uploadProductImage } from '../lib/products-api';
import { useSession } from './session-provider';

interface UploadEntry {
  id: string;
  name: string;
  sizeBytes: number;
  progress: number;
  status: 'uploading' | 'processing' | 'failed' | 'done';
  errorKey?: string;
}

interface ProductImageManagerProps {
  /** `null` while creating: uploads are staged and attached after the save. */
  productId: string | null;
  images: ProductImageSummary[];
  coverImageId: string | null;
  onChange: (images: ProductImageSummary[], coverImageId: string | null) => void;
  /**
   * Assets uploaded before the product exists. The create flow attaches these
   * ids explicitly after the product row has been written.
   */
  stagedAssets: MediaStagingResult[];
  onStagedAssetsChange: (assets: MediaStagingResult[]) => void;
  canUpload: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * Product gallery (docs/24 §3.3 F, §6.2, §4.4).
 *
 * Every structural operation is a server call that returns the authoritative
 * gallery again: attach staged assets, set the cover, submit an order, edit alt
 * text and request a permanent delete. The component renders the server's delete
 * state instead of assuming the file is gone, so a pending or failed physical
 * delete stays visible rather than being reported as success.
 */
export function ProductImageManager({
  productId,
  images,
  coverImageId,
  onChange,
  stagedAssets,
  onStagedAssetsChange,
  canUpload,
  canUpdate,
  canDelete,
}: ProductImageManagerProps) {
  const { t, locale } = useSession();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductImageSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [operations, setOperations] = useState<Record<string, FileOperationSummary>>({});

  const usable = images.filter((image) => image.state === 'READY');
  const total = usable.length + stagedAssets.length;

  /** Re-reads the delete tasks so the UI never shows a stale "deleting" state. */
  const refreshOperations = useCallback(async () => {
    const pending = images.filter((image) => image.deleteOperationId !== null);
    if (pending.length === 0) return;
    const results = await Promise.all(
      pending.map((image) =>
        productsApi
          .fileOperation(image.deleteOperationId as string)
          .then((operation) => [image.id, operation] as const)
          .catch(() => null),
      ),
    );
    setOperations((current) => {
      const next = { ...current };
      for (const result of results) {
        if (result) next[result[0]] = result[1];
      }
      return next;
    });
  }, [images]);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  const reportError = (caught: unknown) => {
    toast.error(
      caught instanceof AdminApiError
        ? translateError(locale, caught.code)
        : t('errors.INTERNAL_ERROR'),
    );
  };

  const handleFiles = async (files: FileList) => {
    const selected = [...files];
    if (selected.length === 0) return;
    if (total + selected.length > PRODUCT_IMAGE_LIMITS.maxPerProduct) {
      toast.error(t('products.images.limitReached', { count: PRODUCT_IMAGE_LIMITS.maxPerProduct }));
      return;
    }

    const entries: UploadEntry[] = selected.map((file, index) => ({
      id: `${index}-${file.name}-${file.size}-${Math.random().toString(16).slice(2, 8)}`,
      name: file.name,
      sizeBytes: file.size,
      progress: 0,
      status: 'uploading',
    }));
    setUploads((current) => [...current, ...entries]);

    const stagedResults: MediaStagingResult[] = [];
    for (const [index, file] of selected.entries()) {
      const entry = entries[index];
      if (!entry) continue;
      if (file.size > PRODUCT_IMAGE_LIMITS.maxBytes) {
        setUploads((current) =>
          current.map((item) =>
            item.id === entry.id
              ? { ...item, status: 'failed', progress: 0, errorKey: 'UPLOAD_TOO_LARGE' }
              : item,
          ),
        );
        continue;
      }
      // fetch() exposes no upload progress, so the bar moves in honest coarse
      // steps (queued -> uploading -> response) instead of animating a number
      // that means nothing.
      setUploads((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, progress: 50 } : item)),
      );
      try {
        const uploaded = await uploadProductImage(file);
        setUploads((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...item, progress: 75, status: 'processing' } : item,
          ),
        );
        const staged = await waitForStaging(uploaded);
        stagedResults.push(staged);
        setUploads((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...item, progress: 100, status: 'done' } : item,
          ),
        );
      } catch (caught) {
        setUploads((current) =>
          current.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  status: 'failed',
                  progress: 0,
                  errorKey: caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR',
                }
              : item,
          ),
        );
      }
    }

    if (stagedResults.length === 0) return;

    if (!productId) {
      // The product does not exist yet. Keep the complete staging response,
      // including its preview URL and id, so the form can both show the image
      // and attach the exact asset ids after creation.
      onStagedAssetsChange([...stagedAssets, ...stagedResults]);
      toast.info(t('products.images.staged', { count: stagedResults.length }));
      return;
    }

    try {
      const result = await productsApi.attachImages(
        productId,
        stagedResults.map((asset) => ({ fileAssetId: asset.fileAssetId })),
      );
      onChange(result.images, result.coverImageId);
      toast.success(t('products.images.uploaded', { count: stagedResults.length }));
    } catch (caught) {
      reportError(caught);
    }
  };

  const move = async (image: ProductImageSummary, delta: number) => {
    if (!productId) return;
    const ordered = [...usable].sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((item) => item.id === image.id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const swapped = [...ordered];
    const [moved] = swapped.splice(index, 1);
    if (!moved) return;
    swapped.splice(target, 0, moved);
    setBusy(true);
    try {
      const result = await productsApi.reorderImages(
        productId,
        swapped.map((item) => item.id),
      );
      onChange(result.images, result.coverImageId);
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  };

  const setCover = async (image: ProductImageSummary) => {
    if (!productId) return;
    setBusy(true);
    try {
      const result = await productsApi.setCover(productId, image.id);
      onChange(result.images, result.coverImageId);
      toast.success(t('products.images.coverSet'));
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  };

  const saveAltText = async (image: ProductImageSummary) => {
    if (!productId) return;
    const draft = altDrafts[image.id];
    if (draft === undefined || draft === (image.alt ?? '')) return;
    setBusy(true);
    try {
      const updated = await productsApi.updateImageAlt(productId, image.id, draft.trim() || null);
      onChange(
        images.map((item) => (item.id === updated.id ? updated : item)),
        coverImageId,
      );
      toast.success(t('products.images.altSaved'));
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !productId) return;
    setDeleting(true);
    try {
      const accepted = await productsApi.deleteImage(productId, deleteTarget.id);
      toast.info(t('products.images.deleteAccepted'));
      const operation = await productsApi.fileOperation(accepted.operationId).catch(() => null);
      if (operation) setOperations((current) => ({ ...current, [deleteTarget.id]: operation }));
      // Re-read the gallery: the server owns the cover and the delete state.
      const refreshed = await productsApi
        .detail(productId)
        .then((detail) => ({ images: detail.images, cover: detail.coverImageId }))
        .catch(() => null);
      if (refreshed) {
        onChange(refreshed.images, refreshed.cover);
      } else {
        onChange(
          images.map((item) =>
            item.id === deleteTarget.id
              ? {
                  ...item,
                  state: 'DELETE_PENDING',
                  isCover: false,
                  deleteOperationId: accepted.operationId,
                }
              : item,
          ),
          coverImageId === deleteTarget.id ? null : coverImageId,
        );
      }
      setDeleteTarget(null);
    } catch (caught) {
      reportError(caught);
    } finally {
      setDeleting(false);
    }
  };

  const retry = async (image: ProductImageSummary) => {
    const operation =
      operations[image.id] ??
      (image.deleteOperationId
        ? await productsApi.fileOperation(image.deleteOperationId).catch(() => null)
        : null);
    if (!operation) return;
    setBusy(true);
    try {
      const retried = await productsApi.retryFileOperation(operation.id);
      setOperations((current) => ({ ...current, [image.id]: retried }));
      toast.info(t('products.images.deleteRetried'));
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  };

  const reloadGallery = async () => {
    if (!productId) return;
    try {
      const detail = await productsApi.detail(productId);
      onChange(detail.images, detail.coverImageId);
    } catch (caught) {
      reportError(caught);
    }
  };

  return (
    <Card
      title={t('products.sections.images')}
      actions={
        <span className="row" style={{ gap: 8 }}>
          <span className="field-help">
            {t('products.images.count', {
              count: total,
              max: PRODUCT_IMAGE_LIMITS.maxPerProduct,
            })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void reloadGallery()}>
            {t('common.refresh')}
          </Button>
        </span>
      }
    >
      {canUpload ? (
        <div className="upload">
          <input
            ref={inputRef}
            type="file"
            accept={PRODUCT_IMAGE_LIMITS.allowedExtensions.join(',')}
            multiple
            aria-label={t('products.images.choose')}
            onChange={(event) => {
              const files = event.target.files;
              if (files) void handleFiles(files);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          <span className="field-help">
            {t('products.images.hint', {
              types: PRODUCT_IMAGE_LIMITS.allowedExtensions.join(', '),
              mb: Math.round(PRODUCT_IMAGE_LIMITS.maxBytes / (1024 * 1024)),
            })}
          </span>
        </div>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="upload-list">
          {uploads.map((entry) => (
            <li key={entry.id} className="upload-list-item">
              <span className="truncate">{entry.name}</span>
              <span className="muted small">{formatBytes(entry.sizeBytes)}</span>
              {entry.status === 'uploading' ? (
                <span
                  className="upload-progress"
                  role="progressbar"
                  aria-valuenow={entry.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${entry.progress}%` }} />
                </span>
              ) : entry.status === 'done' ? (
                <Badge tone="success">{t('products.images.uploadDone')}</Badge>
              ) : entry.status === 'processing' ? (
                <Badge tone="info">{t('products.images.processing')}</Badge>
              ) : (
                <span className="field-error" role="alert">
                  {translateError(locale, entry.errorKey ?? 'INTERNAL_ERROR')}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {images.length === 0 && stagedAssets.length === 0 ? (
        <p className="field-help">{t('products.images.empty')}</p>
      ) : (
        <>
          {stagedAssets.length > 0 ? (
            <ul className="image-grid">
              {stagedAssets.map((asset) => (
                <li key={asset.fileAssetId} className="image-tile" data-state="STAGED">
                  <div className="image-tile-media">
                    <img
                      src={asset.url ?? undefined}
                      alt={t('products.images.stagedAlt')}
                      width={asset.width ?? undefined}
                      height={asset.height ?? undefined}
                      loading="lazy"
                    />
                  </div>
                  <div className="image-tile-body">
                    <span className="truncate">{asset.originalName}</span>
                    <span className="muted small">
                      {asset.width && asset.height
                        ? `${asset.width}×${asset.height}`
                        : t('products.images.unknownSize')}{' '}
                      · {formatBytes(asset.sizeBytes)}
                    </span>
                    <Badge tone="info">{t('products.images.stagedBadge')}</Badge>
                    {canUpload ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onStagedAssetsChange(
                            stagedAssets.filter((item) => item.fileAssetId !== asset.fileAssetId),
                          )
                        }
                      >
                        {t('products.images.removeStaged')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {images.length > 0 ? (
            <ul className="image-grid">
              {images.map((image) => {
                const operation = operations[image.id];
                const deletingState = operation?.status ?? image.state;
                const canPreview = image.state === 'READY' || image.state === 'DELETE_FAILED';
                return (
                  <li key={image.id} className="image-tile" data-state={image.state}>
                    <div className="image-tile-media">
                      {/* An image whose object is gone must not be fetched: the tile
                      shows the state instead of a broken picture. */}
                      {canPreview ? (
                        // Served straight from the storage origin; the Next image
                        // optimizer would add a second cache for an admin-only
                        // gallery tile.
                        <img
                          src={image.url}
                          alt={image.alt ?? ''}
                          width={image.width ?? undefined}
                          height={image.height ?? undefined}
                          loading="lazy"
                        />
                      ) : (
                        <span className="media-fallback">{t('products.images.deleting')}</span>
                      )}
                      {image.id === coverImageId ? (
                        <span className="image-tile-badge">
                          <Badge tone="brand">{t('products.images.cover')}</Badge>
                        </span>
                      ) : null}
                    </div>
                    <div className="image-tile-body">
                      <span className="muted small">
                        {image.width && image.height
                          ? `${image.width}×${image.height}`
                          : t('products.images.unknownSize')}{' '}
                        · {formatBytes(image.sizeBytes)}
                      </span>
                      <label className="field-label" htmlFor={`alt-${image.id}`}>
                        {t('products.images.alt')}
                      </label>
                      <Input
                        inputId={`alt-${image.id}`}
                        value={altDrafts[image.id] ?? image.alt ?? ''}
                        disabled={!canUpdate || image.state === 'DELETE_PENDING'}
                        maxLength={PRODUCT_IMAGE_LIMITS.maxAltTextLength}
                        onChange={(event) =>
                          setAltDrafts((current) => ({
                            ...current,
                            [image.id]: event.target.value,
                          }))
                        }
                        onBlur={() => void saveAltText(image)}
                      />
                      {image.state !== 'READY' ? (
                        <span className="field-help">
                          {deletingState === 'FAILED'
                            ? t('products.images.deleteFailed')
                            : t('products.images.deletePending')}
                          {operation?.lastErrorCode ? ` (${operation.lastErrorCode})` : ''}
                        </span>
                      ) : null}
                      <div className="image-tile-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canUpdate || busy || image.state !== 'READY'}
                          onClick={() => void move(image, -1)}
                        >
                          {t('products.images.moveUp')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canUpdate || busy || image.state !== 'READY'}
                          onClick={() => void move(image, 1)}
                        >
                          {t('products.images.moveDown')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canUpdate || busy || image.isCover || image.state !== 'READY'}
                          onClick={() => void setCover(image)}
                        >
                          {t('products.images.setCover')}
                        </Button>
                        {canDelete && image.state === 'READY' ? (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => setDeleteTarget(image)}
                          >
                            {t('products.images.delete')}
                          </Button>
                        ) : null}
                        {canDelete && deletingState === 'FAILED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void retry(image)}
                          >
                            {t('products.images.retry')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('products.images.deleteTitle')}
        description={t('products.images.deleteWarning')}
        confirmLabel={t('products.images.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}

/**
 * Waits for the real Sharp decode and WebP derivative commit.
 *
 * Browser-side checks and a plausible file header are not proof that the image
 * can be decoded safely. The server only exposes the asset as ready after the
 * worker has produced and verified its WebP variants.
 */
async function waitForStaging(
  initial: MediaStagingResult,
  timeoutMs = 60_000,
): Promise<MediaStagingResult> {
  let current = initial;
  const deadline = Date.now() + timeoutMs;
  while (current.status === 'processing' && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    current = await getProductImageStaging(current.fileAssetId);
  }
  if (current.status === 'ready') return current;
  throw new AdminApiError(
    current.status === 'failed' ? 422 : 504,
    'UPLOAD_PROCESSING_FAILED',
    'The image could not be safely decoded or optimized.',
  );
}
