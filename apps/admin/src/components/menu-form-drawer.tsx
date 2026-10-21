'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MENU_ICON_NAMES, type MenuNode, type PermissionSummary } from '@b2b/contracts';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  MenuIcon,
  MultiSelect,
  Select,
  useToast,
} from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { ADMIN_LOCALES, translateError } from '../lib/i18n';
import {
  MENU_CODE_MAX,
  MENU_LABEL_MAX,
  emptyMenuForm,
  hasMenuFormErrors,
  isMenuFormDirty,
  mapMenuFieldErrors,
  nextSortOrder,
  toMenuFormValues,
  toMenuPayload,
  toPermissionOptions,
  validateMenuForm,
  type MenuFormErrors,
  type MenuFormMode,
  type MenuFormType,
  type MenuFormValues,
} from '../lib/menu-form';
import { findSiblings, parentOptions, subtreeIds } from '../lib/menu-tree-state';
import { menusApi } from '../lib/menus-api';
import { useSession } from './session-provider';

export interface MenuFormDrawerProps {
  open: boolean;
  mode: MenuFormMode;
  /** Edit target; null while creating. */
  node: MenuNode | null;
  /** Preselected parent for "add child"; null creates a root menu. */
  parentId: string | null;
  /** Current tree, used for the parent selector and sibling defaults. */
  tree: MenuNode[];
  onClose: () => void;
  onSaved: (saved: MenuNode, mode: MenuFormMode) => void;
}

/**
 * One drawer for creating and editing a menu (docs/19 §3, §4.2).
 *
 * `code` stays read-only while editing (it is the stable identifier), the
 * translation inputs are generated from the locale configuration instead of
 * fixed Chinese/English columns, and the permission picker only offers codes
 * returned by the API.
 */
export function MenuFormDrawer({
  open,
  mode,
  node,
  parentId,
  tree,
  onClose,
  onSaved,
}: MenuFormDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<MenuFormValues>(() => emptyMenuForm());
  const [initial, setInitial] = useState<MenuFormValues>(() => emptyMenuForm());
  const [errors, setErrors] = useState<MenuFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);

  const [permissions, setPermissions] = useState<PermissionSummary[]>([]);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  const locales = ADMIN_LOCALES;

  const loadPermissions = useCallback(async () => {
    setPermissionsLoading(true);
    try {
      setPermissions(await menusApi.permissionOptions());
      setPermissionsError(null);
    } catch (caught) {
      setPermissions([]);
      setPermissionsError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  // Seeded on every open so a previous menu can never leak into the next form.
  useEffect(() => {
    if (!open) return undefined;
    void loadPermissions();

    if (mode === 'create') {
      const siblings = findSiblings(tree, parentId);
      const seeded = { ...emptyMenuForm(nextSortOrder(siblings)), parentId: parentId ?? '' };
      setValues(seeded);
      setInitial(seeded);
      setExpectedUpdatedAt(undefined);
      setErrors({});
      setServerError(null);
      setLoadError(null);
      return undefined;
    }

    if (!node) return undefined;
    // Editing re-reads the menu so the form carries fresh values and the
    // concurrency token of the version the administrator actually edits.
    let cancelled = false;
    setLoading(true);
    menusApi
      .detail(node.id)
      .then((detail) => {
        if (cancelled) return;
        const seeded = toMenuFormValues(detail, locales);
        setValues(seeded);
        setInitial(seeded);
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
  }, [open, mode, node, parentId, tree, locales, loadPermissions]);

  const dirty = isMenuFormDirty(values, initial);

  const parentChoices = useMemo(() => {
    const excluded = node ? new Set(subtreeIds(node)) : new Set<string>();
    return parentOptions(tree, { excludedIds: excluded }).map((option) => ({
      value: option.value,
      label: `${'— '.repeat(option.depth)}${option.label}`,
    }));
  }, [tree, node]);

  const permissionOptions = useMemo(() => toPermissionOptions(permissions, t), [permissions, t]);

  const childCount = node?.children.length ?? 0;

  const setField = <K extends keyof MenuFormValues>(key: K, value: MenuFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const setLabel = (targetLocale: string, label: string) =>
    setValues((current) => ({ ...current, labels: { ...current.labels, [targetLocale]: label } }));

  const changeType = (type: MenuFormType) =>
    setValues((current) => ({
      ...current,
      type,
      // A grouping menu has no route; clearing it keeps the form and the payload
      // consistent with the server rule instead of saving an ignored value.
      route: type === 'group' ? '' : current.route,
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
    const validation = validateMenuForm(values, mode, locales);
    setErrors(validation);
    setServerError(null);
    if (hasMenuFormErrors(validation)) return;

    setBusy(true);
    try {
      const payload = toMenuPayload(values, mode);
      if (mode === 'create') {
        const created = await menusApi.create({
          code: payload.code ?? '',
          parentId: payload.parentId,
          route: payload.route,
          icon: payload.icon,
          permissionCode: payload.permissionCode,
          sortOrder: payload.sortOrder,
          visible: payload.visible,
          enabled: payload.enabled,
          external: payload.external,
          labels: payload.labels,
        });
        toast.success(t('menus.createSuccess'));
        onSaved(created, 'create');
      } else if (node) {
        const updated = await menusApi.update(node.id, {
          parentId: payload.parentId,
          route: payload.route,
          icon: payload.icon,
          permissionCode: payload.permissionCode,
          sortOrder: payload.sortOrder,
          visible: payload.visible,
          enabled: payload.enabled,
          external: payload.external,
          labels: payload.labels,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        toast.success(t('menus.updateSuccess'));
        onSaved(updated, 'edit');
      }
      onClose();
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        const fieldErrors = mapMenuFieldErrors(caught.details);
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else setServerError(translateError(locale, caught.code));
      } else {
        setServerError(t('errors.INTERNAL_ERROR'));
      }
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? t('menus.create') : t('menus.edit');

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
              {mode === 'create' ? t('menus.createSubmit') : t('common.save')}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="muted">{t('menus.detailLoading')}</p>
        ) : loadError ? (
          <div className="notice notice-danger" role="alert">
            {translateError(locale, loadError)}
          </div>
        ) : (
          <div className="stack">
            <div className="grid-form">
              <Field
                label={t('menus.fields.code')}
                required={mode === 'create'}
                help={mode === 'create' ? t('menus.fields.codeHelp') : t('menus.fields.codeLocked')}
                error={errors.code ? t(errors.code) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.code}
                    disabled={mode === 'edit' || busy}
                    autoComplete="off"
                    maxLength={MENU_CODE_MAX}
                    invalid={Boolean(errors.code)}
                    placeholder="product-reports"
                    onChange={(event) => setField('code', event.target.value.trim().toLowerCase())}
                  />
                )}
              </Field>

              <Field label={t('menus.fields.type')} required>
                {({ inputId, describedBy }) => (
                  <Select
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.type}
                    disabled={busy}
                    options={[
                      { value: 'group', label: t('menus.types.group') },
                      { value: 'page', label: t('menus.types.page') },
                      { value: 'external', label: t('menus.types.external') },
                    ]}
                    onChange={(event) => changeType(event.target.value as MenuFormType)}
                  />
                )}
              </Field>
            </div>

            <Field label={t('menus.fields.parent')} error={errors.parentId ? t(errors.parentId) : undefined}>
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={values.parentId}
                  disabled={busy}
                  placeholder={t('menus.fields.parentNone')}
                  options={parentChoices}
                  onChange={(event) => setField('parentId', event.target.value)}
                />
              )}
            </Field>

            {locales.map((targetLocale) => (
              <Field
                key={targetLocale}
                label={t('menus.fields.label', { locale: t(`menus.locales.${targetLocale}`) })}
                required
                error={errors.labels?.[targetLocale] ? t(errors.labels[targetLocale]) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.labels[targetLocale] ?? ''}
                    disabled={busy}
                    maxLength={MENU_LABEL_MAX}
                    invalid={Boolean(errors.labels?.[targetLocale])}
                    onChange={(event) => setLabel(targetLocale, event.target.value)}
                  />
                )}
              </Field>
            ))}

            <div className="grid-form">
              <Field
                label={t('menus.fields.route')}
                help={values.type === 'group' ? t('menus.fields.routeGroupHelp') : t('menus.fields.routeHelp')}
                error={errors.route ? t(errors.route) : undefined}
              >
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={values.route}
                    disabled={busy || values.type === 'group'}
                    invalid={Boolean(errors.route)}
                    placeholder={values.type === 'external' ? 'https://example.com/report' : '/reports'}
                    onChange={(event) => setField('route', event.target.value)}
                  />
                )}
              </Field>

              <Field label={t('menus.fields.sortOrder')} error={errors.sortOrder ? t(errors.sortOrder) : undefined}>
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
            </div>

            <Field
              label={t('menus.fields.icon')}
              hint={
                <span className="menu-icon-preview">
                  <MenuIcon name={values.icon} />
                  <code className="mono">{values.icon || t('menus.fields.iconNone')}</code>
                </span>
              }
            >
              {({ inputId, describedBy }) => (
                <Select
                  inputId={inputId}
                  describedBy={describedBy}
                  value={values.icon}
                  disabled={busy}
                  options={[
                    { value: '', label: t('menus.fields.iconNone') },
                    ...MENU_ICON_NAMES.map((name) => ({ value: name, label: name })),
                  ]}
                  onChange={(event) => setField('icon', event.target.value)}
                />
              )}
            </Field>

            <Field
              label={t('menus.fields.permission')}
              help={t('menus.fields.permissionHelp')}
              error={errors.permissionCode ? t(errors.permissionCode) : undefined}
            >
              {({ inputId, describedBy }) => (
                <MultiSelect
                  inputId={inputId}
                  describedBy={describedBy}
                  invalid={Boolean(errors.permissionCode)}
                  options={permissionOptions}
                  // Single-select semantics: the picker keeps the most recent choice.
                  value={values.permissionCode.length > 0 ? [values.permissionCode] : []}
                  onChange={(next) => setField('permissionCode', next.at(-1) ?? '')}
                  placeholder={t('menus.fields.permissionNone')}
                  searchPlaceholder={t('menus.fields.permissionSearch')}
                  emptyLabel={t('menus.fields.permissionEmpty')}
                  noMatchLabel={t('menus.noMatch')}
                  loading={permissionsLoading}
                  loadingLabel={t('common.loading')}
                  error={permissionsError ? translateError(locale, permissionsError) : null}
                  onRetry={() => void loadPermissions()}
                  retryLabel={t('common.retry')}
                  removeLabel={(label) => t('menus.fields.permissionRemove', { name: label })}
                  disabled={busy}
                />
              )}
            </Field>

            <div className="checkbox-stack">
              <Checkbox
                label={t('menus.fields.enabled')}
                help={t('menus.fields.enabledHelp')}
                checked={values.enabled}
                disabled={busy}
                onChange={(event) => setField('enabled', event.target.checked)}
              />
              <Checkbox
                label={t('menus.fields.visible')}
                help={t('menus.fields.visibleHelp')}
                checked={values.visible}
                disabled={busy}
                onChange={(event) => setField('visible', event.target.checked)}
              />
            </div>

            {mode === 'edit' && childCount > 0 ? (
              <div className="notice">{t('menus.childrenImpact', { count: childCount })}</div>
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
        description={t('menus.discardMessage')}
        confirmLabel={t('menus.discardConfirm')}
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
