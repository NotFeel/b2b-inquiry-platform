'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CategoryNode } from '@b2b/contracts';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  Textarea,
  TreeSelect,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { categoriesApi } from '../lib/categories-api';
import {
  CATEGORY_CODE_MAX,
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
  emptyCategoryForm,
  hasCategoryFormErrors,
  isCategoryFormDirty,
  mapCategoryFieldErrors,
  seedFromParent,
  toCategoryFormValues,
  toCategoryPayload,
  validateCategoryForm,
  type CategoryFormErrors,
  type CategoryFormMode,
  type CategoryFormValues,
} from '../lib/category-form';
import {
  findNode,
  findSiblings,
  localizedName,
  subtreeIds,
  toParentTreeNodes,
} from '../lib/category-tree-state';
import { ADMIN_LOCALES, translateError } from '../lib/i18n';
import { useSession } from './session-provider';

export interface CategoryFormDrawerProps {
  open: boolean;
  mode: CategoryFormMode;
  /** Edit target; null while creating. */
  node: CategoryNode | null;
  /** Preselected parent for "add child"; null creates a root category. */
  parentId: string | null;
  /** Current tree, used by the parent selector and for sibling defaults. */
  tree: CategoryNode[];
  onClose: () => void;
  onSaved: (id: string, mode: CategoryFormMode) => void;
}

/**
 * One drawer for creating and editing a category (docs/22 §3).
 *
 * `code` is the stable machine identifier and stays read-only while editing, the
 * translation inputs are generated from the locale configuration, and the parent
 * is chosen through a searchable tree selector - never by pasting a UUID.
 */
export function CategoryFormDrawer({
  open,
  mode,
  node,
  parentId,
  tree,
  onClose,
  onSaved,
}: CategoryFormDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<CategoryFormValues>(() => emptyCategoryForm());
  const [initial, setInitial] = useState<CategoryFormValues>(() => emptyCategoryForm());
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);
  /**
   * Resolved parent label shown back to the administrator.
   *
   * It comes from the API detail (edit) or the clicked tree node (add child) so
   * the form never echoes a raw UUID - the very thing the tree selector exists
   * to remove (docs/22 §3.4).
   */
  const [parentName, setParentName] = useState<string | null>(null);

  const locales = ADMIN_LOCALES;

  // Re-seeded on every open so a previously edited category can never leak into
  // the next form.
  useEffect(() => {
    if (!open) return undefined;

    if (mode !== 'edit') {
      const siblings = findSiblings(tree, parentId);
      const parent = parentId ? findNode(tree, parentId) : null;
      const nextOrder =
        siblings.length === 0 ? 10 : Math.max(...siblings.map((sibling) => sibling.sortOrder)) + 10;
      const seeded = seedFromParent(parent, { locales, sortOrder: nextOrder });
      setValues(seeded);
      setInitial(seeded);
      setParentName(parent ? localizedName(parent, locale) : null);
      setExpectedUpdatedAt(undefined);
      setErrors({});
      setServerError(null);
      setLoadError(null);
      return undefined;
    }

    if (!node) return undefined;
    // Editing re-reads the category so the form carries fresh values plus the
    // concurrency token of the version the administrator actually edits.
    let cancelled = false;
    setLoading(true);
    categoriesApi
      .detail(node.id, locale)
      .then((detail) => {
        if (cancelled) return;
        const seeded = toCategoryFormValues(detail, locales);
        setValues(seeded);
        setInitial(seeded);
        setParentName(detail.parentName);
        setExpectedUpdatedAt(detail.updatedAt);
        setErrors({});
        setServerError(null);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, node, parentId, tree, locale, locales]);

  const dirty = isCategoryFormDirty(values, initial);

  const parentNodes = useMemo(() => toParentTreeNodes(tree, locale), [tree, locale]);
  const blockedIds = useMemo(() => (node ? subtreeIds(node) : []), [node]);

  const setField = <K extends keyof CategoryFormValues>(key: K, value: CategoryFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const setTranslation = (field: 'names' | 'descriptions', targetLocale: string, value: string) =>
    setValues((current) => ({
      ...current,
      [field]: { ...current[field], [targetLocale]: value },
    }));

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const submit = async () => {
    const validation = validateCategoryForm(values, mode, locales);
    setErrors(validation);
    setServerError(null);
    if (hasCategoryFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toCategoryPayload(values, mode);
      if (mode === 'edit' && node) {
        await categoriesApi.update(node.id, {
          ...payload,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        toast.success(t('categories.updateSuccess'));
        onSaved(node.id, mode);
      } else {
        const created = await categoriesApi.create({ ...payload, code: payload.code ?? '' });
        toast.success(t('categories.createSuccess'));
        onSaved(created.id, mode);
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const fieldErrors = mapCategoryFieldErrors(caught.details);
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else setServerError(translateError(locale, caught.code));
      } else {
        setServerError(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'edit'
      ? t('categories.edit')
      : mode === 'createChild'
        ? t('categories.createChild')
        : t('categories.createRoot');

  const resolvedParentLabel = values.parentId
    ? (parentName ?? t('categories.fields.parentUnknown'))
    : t('categories.fields.parentNone');

  return (
    <>
      <Drawer
        open={open}
        title={title}
        onClose={requestClose}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={loading} onClick={() => void submit()}>
              {mode === 'edit' ? t('common.save') : t('categories.createSubmit')}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="muted">{t('categories.detailLoading')}</p>
        ) : loadError ? (
          <div className="notice notice-danger" role="alert">
            {translateError(locale, loadError)}
          </div>
        ) : (
          <div className="stack">
            <div className="grid-form">
              <Field
                label={t('categories.fields.code')}
                required={mode !== 'edit'}
                help={
                  mode === 'edit'
                    ? t('categories.fields.codeLocked')
                    : t('categories.fields.codeHelp')
                }
                error={errors.code ? t(errors.code) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.code}
                    disabled={mode === 'edit' || busy}
                    autoComplete="off"
                    maxLength={CATEGORY_CODE_MAX}
                    invalid={Boolean(errors.code)}
                    placeholder="model-toys"
                    onChange={(event) => setField('code', event.target.value.trim().toLowerCase())}
                  />
                )}
              </Field>

              <Field
                label={t('categories.fields.slug')}
                required
                help={t('categories.fields.slugHelp')}
                error={errors.slug ? t(errors.slug) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.slug}
                    disabled={busy}
                    autoComplete="off"
                    maxLength={CATEGORY_SLUG_MAX}
                    invalid={Boolean(errors.slug)}
                    placeholder="model-toys"
                    onChange={(event) => setField('slug', event.target.value.trim().toLowerCase())}
                  />
                )}
              </Field>
            </div>

            <Field
              label={t('categories.fields.parent')}
              help={t('categories.fields.parentHelp')}
              error={errors.parentId ? t(errors.parentId) : undefined}
            >
              {() => (
                <TreeSelect
                  nodes={parentNodes}
                  selectedId={values.parentId.length > 0 ? values.parentId : null}
                  onSelect={(id) => setField('parentId', id ?? '')}
                  searchPlaceholder={t('categories.fields.parentSearch')}
                  clearLabel={t('categories.fields.parentNone')}
                  ariaLabel={t('categories.fields.parent')}
                  allowClear
                  blockedIds={blockedIds}
                  emptyLabel={t('categories.fields.parentEmpty')}
                />
              )}
            </Field>

            <p className="field-help">
              {t('categories.fields.parentResolved', { name: resolvedParentLabel })}
            </p>

            {locales.map((targetLocale) => (
              <div key={targetLocale} className="stack-sm">
                <Field
                  label={t('categories.fields.name', {
                    locale: t(`categories.locales.${targetLocale}`),
                  })}
                  required
                  error={errors.names?.[targetLocale] ? t(errors.names[targetLocale]) : undefined}
                >
                  {({ inputId, describedBy }) => (
                    <Input
                      inputId={inputId}
                      describedBy={describedBy}
                      value={values.names[targetLocale] ?? ''}
                      disabled={busy}
                      maxLength={CATEGORY_NAME_MAX}
                      invalid={Boolean(errors.names?.[targetLocale])}
                      onChange={(event) =>
                        setTranslation('names', targetLocale, event.target.value)
                      }
                    />
                  )}
                </Field>
                <Field
                  label={t('categories.fields.description', {
                    locale: t(`categories.locales.${targetLocale}`),
                  })}
                >
                  {({ inputId, describedBy }) => (
                    <Textarea
                      inputId={inputId}
                      describedBy={describedBy}
                      value={values.descriptions[targetLocale] ?? ''}
                      disabled={busy}
                      rows={3}
                      maxLength={CATEGORY_DESCRIPTION_MAX}
                      onChange={(event) =>
                        setTranslation('descriptions', targetLocale, event.target.value)
                      }
                    />
                  )}
                </Field>
              </div>
            ))}

            <Field
              label={t('categories.fields.sortOrder')}
              help={t('categories.fields.sortOrderHelp')}
              error={errors.sortOrder ? t(errors.sortOrder) : undefined}
            >
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  type="number"
                  value={values.sortOrder}
                  disabled={busy}
                  invalid={Boolean(errors.sortOrder)}
                  onChange={(event) => setField('sortOrder', event.target.value)}
                />
              )}
            </Field>

            <div className="checkbox-stack">
              <Checkbox
                label={t('categories.fields.enabled')}
                help={t('categories.fields.enabledHelp')}
                checked={values.enabled}
                disabled={busy}
                onChange={(event) => setField('enabled', event.target.checked)}
              />
              <Checkbox
                label={t('categories.fields.visible')}
                help={t('categories.fields.visibleHelp')}
                checked={values.visible}
                disabled={busy}
                onChange={(event) => setField('visible', event.target.checked)}
              />
            </div>

            {mode === 'edit' && node && node.children.length > 0 ? (
              <div className="notice">
                {t('categories.childrenImpact', { count: node.children.length })}
              </div>
            ) : null}

            {serverError ? (
              <div className="notice notice-danger" role="alert">
                {serverError}
              </div>
            ) : null}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={title}
        description={t('categories.discardMessage')}
        confirmLabel={t('categories.discardConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
