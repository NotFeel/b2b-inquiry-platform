'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DICTIONARY_TYPES,
  PRODUCT_LIFECYCLE_STATUSES,
  PUBLISH_STATUSES,
  SUPPORTED_LOCALES,
  type CategoryNode,
  type MediaStagingResult,
  type ProductAdminDetail,
  type ProductImageSummary,
} from '@b2b/contracts';
import { Button, Card, Field, Input, MultiSelect, Select, Tabs, Textarea, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { categoriesApi } from '../lib/categories-api';
import { useDictionaryOptions } from '../lib/dictionary-options';
import { localeHref, translateError } from '../lib/i18n';
import {
  applyLifecycleChange,
  emptyProductForm,
  fromProductDetail,
  mapServerFieldErrors,
  toCreatePayload,
  toWritePayload,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormState,
} from '../lib/product-form';
import { productsApi } from '../lib/products-api';
import { useTagIdSelectOptions } from '../lib/tag-options';
import { setAdminFormDirty } from '../lib/unsaved-form';
import { CategoryPicker } from './category-picker';
import { ProductImageManager } from './product-image-manager';
import { useSession } from './session-provider';

interface ProductFormProps {
  mode: 'create' | 'edit';
  detail: ProductAdminDetail | null;
}

const ENGLISH = 'en-US';
const ENGLISH_LABEL = 'en-US';

/**
 * Product editor (docs/24 §3.2-§3.3).
 *
 * A full page, not a narrow drawer: fields are grouped (basic data, status,
 * product dimensions, carton dimensions, tags, internal price, gallery, SEO) and
 * every dimension carries its own label and unit. The category comes from the
 * real category tree - never a hand-typed UUID - and tags are submitted as
 * structured ids. The gallery is a separate card whose operations are their own
 * API calls, so saving the form can never replace or lose an image.
 */
export function ProductForm({ mode, detail }: ProductFormProps) {
  const { t, locale, can } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [state, setState] = useState<ProductFormState>(() =>
    detail ? fromProductDetail(detail) : emptyProductForm(),
  );
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState(false);
  const [appendRandomSlug, setAppendRandomSlug] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [localeTab, setLocaleTab] = useState<string>(ENGLISH_LABEL);
  const [images, setImages] = useState<ProductImageSummary[]>(detail?.images ?? []);
  const [coverImageId, setCoverImageId] = useState<string | null>(detail?.coverImageId ?? null);
  const [stagedAssets, setStagedAssets] = useState<MediaStagingResult[]>([]);
  const [productId, setProductId] = useState<string | null>(detail?.id ?? null);
  const [publishStatus, setPublishStatus] = useState<string>(detail?.publishStatus ?? 'draft');
  const [categoryNodes, setCategoryNodes] = useState<CategoryNode[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const canEditCost = can('product.cost.update');
  const canSeeCost = can('product.cost.read') || canEditCost;
  const canPublish = can('product.publish');
  const canDelete = can('product.delete');
  const slugLocked = mode === 'edit' && detail?.publishStatus !== 'draft';

  const lifecycle = useDictionaryOptions(DICTIONARY_TYPES.productLifecycle, {
    locale,
    fallback: PRODUCT_LIFECYCLE_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const publish = useDictionaryOptions(DICTIONARY_TYPES.productPublishStatus, {
    locale,
    fallback: PUBLISH_STATUSES.map((code) => ({ value: code, label: code })),
  });
  const packaging = useDictionaryOptions(DICTIONARY_TYPES.packagingType, { locale });
  const tags = useTagIdSelectOptions(locale, t('tags.statusOptions.disabled'));

  const loadCategories = useCallback(async () => {
    setCategoryLoading(true);
    try {
      const tree = await categoriesApi.tree({ locale });
      setCategoryNodes(tree);
      setCategoryError(null);
    } catch (caught) {
      setCategoryError(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : 'errors.INTERNAL_ERROR',
      );
    } finally {
      setCategoryLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (can('category.read')) void loadCategories();
  }, [can, loadCategories]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    setAdminFormDirty(dirty);
    return () => setAdminFormDirty(false);
  }, [dirty]);

  const update = (patch: Partial<ProductFormState>) => {
    setState((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const updateSpec = (key: keyof ProductFormState['specs'], value: string) => {
    setState((current) => ({ ...current, specs: { ...current.specs, [key]: value } }));
    setDirty(true);
  };
  const updateTranslation = (
    targetLocale: string,
    key: keyof ProductFormState['translations'][string],
    value: string,
  ) => {
    setState((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [targetLocale]: {
          ...(current.translations[targetLocale] ?? {
            name: '',
            description: '',
            seoTitle: '',
            seoDescription: '',
          }),
          [key]: value,
        },
      },
    }));
    setDirty(true);
  };

  const errorFor = (key: string) => {
    const value = errors[key];
    return value ? t(value) : undefined;
  };

  const generateSlug = async () => {
    if (slugLocked) return;
    setGeneratingSlug(true);
    try {
      const suggestion = await productsApi.suggestSlug({
        name: state.translations[ENGLISH]?.name ?? '',
        strategy: appendRandomSlug ? 'name-random' : 'name',
        excludeProductId: mode === 'edit' ? productId : null,
      });
      update({ slug: suggestion.slug });
      setErrors((current) => {
        if (!current.slug) return current;
        const next = { ...current };
        delete next.slug;
        return next;
      });
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const mapped = mapServerFieldErrors(caught.details);
        setErrors((current) => ({
          ...current,
          slug:
            mapped.errors.slug ??
            (caught.code === 'PRODUCT_SLUG_SUGGESTION_CONFLICT'
              ? 'products.validation.slugTaken'
              : 'products.validation.slugGenerateFailed'),
        }));
        toast.error(translateError(locale, caught.code));
      } else {
        setErrors((current) => ({
          ...current,
          slug: 'products.validation.slugGenerateFailed',
        }));
        toast.error(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setGeneratingSlug(false);
    }
  };

  const reloadGallery = async (id: string) => {
    const refreshed = await productsApi.detail(id).catch(() => null);
    if (refreshed) {
      setImages(refreshed.images);
      setCoverImageId(refreshed.coverImageId);
    }
  };

  const save = async (options: { stay: boolean; publishAfter?: boolean }) => {
    const clientErrors = validateProductForm(state, { mode });
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) {
      toast.error(t('products.validation.fixFields'));
      return;
    }

    setSaving(true);
    try {
      let id = productId;
      if (!id) {
        const created = await productsApi.create(toCreatePayload(state, { canEditCost }));
        id = created.id;
        setProductId(created.id);
      } else {
        await productsApi.update(id, toWritePayload(state, { canEditCost }));
      }
      if (stagedAssets.length > 0) {
        // Staging is deliberate: validation happens on upload, but the asset
        // only becomes part of a gallery through this explicit attach call.
        // Skipping it was why a newly created product showed no images.
        const attached = await productsApi.attachImages(
          id,
          stagedAssets.map((asset) => ({ fileAssetId: asset.fileAssetId })),
        );
        setImages(attached.images);
        setCoverImageId(attached.coverImageId);
        setStagedAssets([]);
      }
      if (options.publishAfter && id) {
        await productsApi.setPublishStatus(id, 'published');
        setPublishStatus('published');
      }
      setDirty(false);
      toast.success(t('products.saved'));
      if (options.stay) {
        if (mode === 'create') {
          router.replace(localeHref(locale, `/products/${id}/edit`));
        }
        await reloadGallery(id);
      } else {
        router.push(localeHref(locale, '/products'));
      }
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const mapped = mapServerFieldErrors(caught.details);
        setErrors(mapped.errors);
        setFormError(
          mapped.formLevel.length > 0
            ? mapped.formLevel.join(' ')
            : translateError(locale, caught.code),
        );
        toast.error(translateError(locale, caught.code));
      } else {
        setFormError(t('errors.INTERNAL_ERROR'));
        toast.error(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'published' | 'unpublished') => {
    if (!productId) return;
    setBusyAction(status);
    try {
      await productsApi.setPublishStatus(productId, status);
      setPublishStatus(status);
      toast.success(status === 'published' ? t('products.published') : t('products.unpublished'));
      router.refresh();
    } catch (caught) {
      toast.error(
        caught instanceof AdminApiError
          ? translateError(locale, caught.code)
          : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="stack">
      <Card title={t('products.sections.basic')}>
        <Tabs
          items={SUPPORTED_LOCALES.map((code) => ({
            id: code,
            label: code === 'en-US' ? t('products.localeEn') : t('products.localeZh'),
          }))}
          activeId={localeTab}
          onChange={setLocaleTab}
          ariaLabel={t('products.fields.name', { locale: localeTab })}
        />
        <div className="form-grid">
          <Field
            label={t('products.fields.sku')}
            required={mode === 'create'}
            help={t('products.help.sku')}
            error={errorFor('sku')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={state.sku}
                disabled={mode === 'edit'}
                invalid={Boolean(errors.sku)}
                maxLength={64}
                onChange={(event) => update({ sku: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.slug')}
            required
            help={slugLocked ? t('products.help.slugPublishedLocked') : t('products.help.slug')}
            error={errorFor('slug')}
            hint={
              <div className="slug-generator">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={generatingSlug}
                  disabled={slugLocked}
                  onClick={() => void generateSlug()}
                >
                  {t('products.actions.generateSlug')}
                </Button>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={appendRandomSlug}
                    disabled={slugLocked}
                    onChange={(event) => setAppendRandomSlug(event.target.checked)}
                  />
                  <span>{t('products.fields.appendRandomSlug')}</span>
                </label>
              </div>
            }
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={state.slug}
                disabled={slugLocked}
                invalid={Boolean(errors.slug)}
                maxLength={180}
                onChange={(event) => update({ slug: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.category')}
            required
            help={t('products.help.category')}
            error={errorFor('categoryId')}
          >
            {() => (
              <CategoryPicker
                mode="product"
                nodes={categoryNodes}
                value={state.categoryId}
                invalid={Boolean(errors.categoryId)}
                fallbackLabel={detail?.categoryPath ?? detail?.categoryName ?? null}
                loading={categoryLoading}
                errorLabel={categoryError}
                onRetry={() => void loadCategories()}
                onChange={(id) => {
                  if (!id) return;
                  update({ categoryId: id });
                  setErrors((current) => {
                    if (!current.categoryId) return current;
                    const next = { ...current };
                    delete next.categoryId;
                    return next;
                  });
                }}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.name', { locale: localeTab })}
            required={localeTab === ENGLISH}
            help={localeTab === ENGLISH ? t('products.help.englishRequired') : undefined}
            error={errorFor(`translations.${localeTab}.name`)}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={state.translations[localeTab]?.name ?? ''}
                invalid={Boolean(errors[`translations.${localeTab}.name`])}
                maxLength={240}
                onChange={(event) => updateTranslation(localeTab, 'name', event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('products.fields.description', { locale: localeTab })}
          help={t('products.help.description')}
        >
          {({ inputId, describedBy }) => (
            <Textarea
              inputId={inputId}
              describedBy={describedBy}
              rows={4}
              value={state.translations[localeTab]?.description ?? ''}
              onChange={(event) => updateTranslation(localeTab, 'description', event.target.value)}
            />
          )}
        </Field>
      </Card>

      <Card title={t('products.sections.status')}>
        <div className="form-grid">
          <Field label={t('products.fields.publishStatus')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={state.publishStatus}
                options={publish.options}
                onChange={(event) =>
                  update({
                    publishStatus: event.target.value as ProductFormState['publishStatus'],
                  })
                }
              />
            )}
          </Field>
          <Field label={t('products.fields.lifecycleStatus')}>
            {({ inputId, describedBy }) => (
              <Select
                inputId={inputId}
                describedBy={describedBy}
                value={state.lifecycleStatus}
                options={lifecycle.options}
                onChange={(event) =>
                  setState((current) =>
                    applyLifecycleChange(
                      current,
                      event.target.value as ProductFormState['lifecycleStatus'],
                    ),
                  )
                }
              />
            )}
          </Field>
          <Field label={t('products.fields.sortOrder')} error={errorFor('sortOrder')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={0}
                value={state.sortOrder}
                invalid={Boolean(errors.sortOrder)}
                onChange={(event) => update({ sortOrder: event.target.value })}
              />
            )}
          </Field>
        </div>
        <p className="field-help">{t('products.help.lifecycleDiscontinued')}</p>
      </Card>

      <Card title={t('products.sections.productSpecs')}>
        <div className="form-grid">
          <Field label={t('products.fields.lengthCm')} error={errorFor('specs.lengthCm')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={0.1}
                step={0.1}
                unit="cm"
                value={state.specs.lengthCm}
                invalid={Boolean(errors['specs.lengthCm'])}
                onChange={(event) => updateSpec('lengthCm', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('products.fields.widthCm')} error={errorFor('specs.widthCm')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={0.1}
                step={0.1}
                unit="cm"
                value={state.specs.widthCm}
                invalid={Boolean(errors['specs.widthCm'])}
                onChange={(event) => updateSpec('widthCm', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('products.fields.heightCm')} error={errorFor('specs.heightCm')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={0.1}
                step={0.1}
                unit="cm"
                value={state.specs.heightCm}
                invalid={Boolean(errors['specs.heightCm'])}
                onChange={(event) => updateSpec('heightCm', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('products.fields.weightGrams')} error={errorFor('specs.weightGrams')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={1}
                unit="g"
                value={state.specs.weightGrams}
                invalid={Boolean(errors['specs.weightGrams'])}
                onChange={(event) => updateSpec('weightGrams', event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('products.fields.packaging')} help={t('products.packagingHelp')}>
          {({ inputId, describedBy }) => (
            <>
              <Input
                inputId={inputId}
                describedBy={describedBy}
                list="packaging-suggestions"
                value={state.specs.packaging}
                onChange={(event) => updateSpec('packaging', event.target.value)}
              />
              <datalist id="packaging-suggestions">
                {packaging.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </Field>
      </Card>

      <Card title={t('products.sections.cartonSpecs')}>
        <div className="form-grid">
          <Field
            label={t('products.fields.cartonLengthCm')}
            error={errorFor('specs.cartonLengthCm')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={1}
                unit="cm"
                value={state.specs.cartonLengthCm}
                invalid={Boolean(errors['specs.cartonLengthCm'])}
                onChange={(event) => updateSpec('cartonLengthCm', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('products.fields.cartonWidthCm')} error={errorFor('specs.cartonWidthCm')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={1}
                unit="cm"
                value={state.specs.cartonWidthCm}
                invalid={Boolean(errors['specs.cartonWidthCm'])}
                onChange={(event) => updateSpec('cartonWidthCm', event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.cartonHeightCm')}
            error={errorFor('specs.cartonHeightCm')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={1}
                unit="cm"
                value={state.specs.cartonHeightCm}
                invalid={Boolean(errors['specs.cartonHeightCm'])}
                onChange={(event) => updateSpec('cartonHeightCm', event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.cartonWeightKg')}
            error={errorFor('specs.cartonWeightKg')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                unit="kg"
                value={state.specs.cartonWeightKg}
                invalid={Boolean(errors['specs.cartonWeightKg'])}
                onChange={(event) => updateSpec('cartonWeightKg', event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('products.fields.cartonQuantity')}
            error={errorFor('specs.cartonQuantity')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                min={1}
                value={state.specs.cartonQuantity}
                invalid={Boolean(errors['specs.cartonQuantity'])}
                onChange={(event) => updateSpec('cartonQuantity', event.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('products.sections.tags')}>
        <Field label={t('products.fields.tags')} help={t('products.tagsHelp')}>
          {({ inputId, describedBy }) => (
            <MultiSelect
              inputId={inputId}
              describedBy={describedBy}
              options={tags.options}
              value={state.tagIds}
              onChange={(next) => update({ tagIds: next })}
              placeholder={t('products.tags.placeholder')}
              searchPlaceholder={t('products.tags.search')}
              emptyLabel={t('products.tags.empty')}
              noMatchLabel={t('products.tags.noMatch')}
              loading={tags.loading}
              loadingLabel={t('common.loading')}
              error={tags.error}
              retryLabel={t('common.retry')}
              removeLabel={(label) => t('products.tags.remove', { label })}
            />
          )}
        </Field>
      </Card>

      {canSeeCost ? (
        <Card title={t('products.sections.cost')}>
          <Field
            label={t('products.fields.priceCny')}
            help={t('products.priceNotice')}
            error={errorFor('priceCny')}
          >
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                unit="CNY"
                value={state.priceCny}
                disabled={!canEditCost}
                invalid={Boolean(errors.priceCny)}
                onChange={(event) => update({ priceCny: event.target.value })}
              />
            )}
          </Field>
        </Card>
      ) : null}

      <ProductImageManager
        productId={productId}
        images={images}
        coverImageId={coverImageId}
        onChange={(next, cover) => {
          setImages(next);
          setCoverImageId(cover);
        }}
        stagedAssets={stagedAssets}
        onStagedAssetsChange={setStagedAssets}
        canUpload={can('product.image.upload')}
        canUpdate={can('product.image.update')}
        canDelete={can('product.image.delete')}
      />

      <Card title={t('products.sections.seo')}>
        <div className="form-grid">
          <Field label={t('products.fields.seoTitle', { locale: localeTab })}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                maxLength={240}
                value={state.translations[localeTab]?.seoTitle ?? ''}
                onChange={(event) => updateTranslation(localeTab, 'seoTitle', event.target.value)}
              />
            )}
          </Field>
          <Field label={t('products.fields.seoDescription', { locale: localeTab })}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                maxLength={400}
                value={state.translations[localeTab]?.seoDescription ?? ''}
                onChange={(event) =>
                  updateTranslation(localeTab, 'seoDescription', event.target.value)
                }
              />
            )}
          </Field>
        </div>
      </Card>

      {formError ? (
        <p className="notice notice-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="sticky-actions">
        <span className="field-help">{t('products.help.unsaved')}</span>
        <div className="row">
          <Button variant="secondary" onClick={() => router.push(localeHref(locale, '/products'))}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" loading={saving} onClick={() => void save({ stay: true })}>
            {t('products.actions.saveStay')}
          </Button>
          <Button loading={saving} onClick={() => void save({ stay: false })}>
            {t('products.actions.save')}
          </Button>
          {canPublish && productId ? (
            publishStatus === 'published' ? (
              <Button
                variant="secondary"
                loading={busyAction === 'unpublished'}
                onClick={() => void setStatus('unpublished')}
              >
                {t('products.unpublish')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={busyAction === 'published'}
                onClick={() => void save({ stay: true, publishAfter: true })}
              >
                {t('products.publish')}
              </Button>
            )
          ) : null}
          {canDelete && productId ? (
            <Button
              variant="danger"
              onClick={() => router.push(`${localeHref(locale, '/products')}?delete=${productId}`)}
            >
              {t('common.delete')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
