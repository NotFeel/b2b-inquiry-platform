'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PermissionTree, RolePermissionGrant, RoleSummary } from '@b2b/contracts';
import { Button, ConfirmDialog, Drawer, ErrorState, Input, LoadingState, useToast } from '@b2b/ui';
import { AdminApiError } from '../lib/admin-api';
import { translateError } from '../lib/i18n';
import {
  allNodeKeys,
  allPermissionCodes,
  countSelected,
  filterPermissionTree,
} from '../lib/permission-tree-state';
import { rolesApi } from '../lib/roles-api';
import { roleDisplayName } from '../lib/user-form';
// Aliased: `PermissionTree` is also the API payload type from @b2b/contracts.
import { PermissionTree as PermissionTreeView } from './permission-tree';
import { useSession } from './session-provider';

export interface RolePermissionDrawerProps {
  open: boolean;
  role: RoleSummary | null;
  /** False for system roles and for operators without role.permissions.update. */
  canEdit: boolean;
  onClose: () => void;
  onSaved: (grant: RolePermissionGrant) => void;
}

function signature(codes: Iterable<string>): string {
  return [...codes].sort().join(',');
}

/**
 * Permission editor for one role (docs/18 §2.5, §6).
 *
 * The tree and the current grant are loaded together; the editor leaves its
 * initialising state only when both calls succeed, so an empty selection is
 * never mistaken for "no permissions" and saved by accident.
 */
export function RolePermissionDrawer({
  open,
  role,
  canEdit,
  onClose,
  onSaved,
}: RolePermissionDrawerProps) {
  const { t, locale } = useSession();
  const toast = useToast();

  const [tree, setTree] = useState<PermissionTree | null>(null);
  const [grant, setGrant] = useState<RolePermissionGrant | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const roleId = role?.id ?? null;

  const load = useCallback(async () => {
    if (!roleId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [treeResult, grantResult] = await Promise.all([
        rolesApi.permissionTree(),
        rolesApi.permissions(roleId),
      ]);
      setTree(treeResult);
      setGrant(grantResult);
      // Both responses are in hand before the editor becomes editable.
      setSelected(new Set(grantResult.permissionCodes));
      setExpanded(new Set(allNodeKeys(treeResult.items)));
      setTerm('');
      setSaveError(null);
    } catch (caught) {
      setTree(null);
      setGrant(null);
      setLoadError(caught instanceof AdminApiError ? caught.code : 'INTERNAL_ERROR');
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (open) return;
    // Reset transient state so reopening another role never shows stale data.
    setTree(null);
    setGrant(null);
    setSelected(new Set());
    setTerm('');
    setSaveError(null);
  }, [open]);

  const editable = canEdit && grant !== null && !grant.isSystem;
  const dirty = grant !== null && signature(selected) !== signature(grant.permissionCodes);

  const visibleTree = useMemo(
    () => (tree ? filterPermissionTree(tree.items, term, locale, t) : []),
    [tree, term, locale, t],
  );

  const total = useMemo(() => (tree ? allPermissionCodes(tree.items).length : 0), [tree]);
  const selectedCount = useMemo(() => (tree ? countSelected(tree.items, selected) : 0), [tree, selected]);

  // A stored code the current dictionary no longer knows is surfaced instead of
  // being silently dropped on save.
  const unknownCodes = useMemo(() => {
    if (!tree) return [];
    const known = new Set(allPermissionCodes(tree.items));
    return (grant?.permissionCodes ?? []).filter((code) => !known.has(code));
  }, [tree, grant]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const save = async () => {
    if (!role || !grant) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await rolesApi.savePermissions(role.id, {
        permissionCodes: [...selected].sort(),
        expectedUpdatedAt: grant.updatedAt,
      });
      // Calibrate the editor against the canonical server result.
      setGrant(saved);
      setSelected(new Set(saved.permissionCodes));
      toast.success(t('roles.permissionsSaved'));
      onSaved(saved);
    } catch (caught) {
      setSaveError(
        caught instanceof AdminApiError ? translateError(locale, caught.code) : t('errors.INTERNAL_ERROR'),
      );
    } finally {
      setSaving(false);
    }
  };

  const allCodes = tree ? allNodeKeys(tree.items) : [];
  const displayName = role ? roleDisplayName(role, locale, t) : '';

  return (
    <>
      <Drawer
        open={open}
        title={
          role
            ? `${t('roles.permissionsTitle')} · ${displayName} (${role.code})`
            : t('roles.permissionsTitle')
        }
        onClose={requestClose}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose} disabled={saving}>
              {t('common.close')}
            </Button>
            {editable ? (
              <Button
                loading={saving}
                disabled={!dirty || loading || Boolean(loadError)}
                onClick={() => void save()}
              >
                {t('common.save')}
              </Button>
            ) : null}
          </>
        }
      >
        {loading ? (
          <LoadingState label={t('roles.permissionsLoading')} rows={5} />
        ) : loadError ? (
          <ErrorState
            title={t('roles.permissionsLoadFailed')}
            description={translateError(locale, loadError)}
            retryLabel={t('common.retry')}
            onRetry={() => void load()}
          />
        ) : tree && grant ? (
          <div className="permission-editor">
            {grant.isSystem ? (
              <div className="notice">{t('roles.permissionsSystemRole')}</div>
            ) : !canEdit ? (
              <div className="notice">{t('roles.permissionsReadOnly')}</div>
            ) : null}

            <p className="field-help">{t('roles.help')}</p>

            <div className="permission-toolbar">
              <Input
                type="search"
                value={term}
                placeholder={t('roles.searchPermissions')}
                aria-label={t('roles.searchPermissions')}
                onChange={(event) => setTerm(event.target.value)}
              />
              <div className="permission-toolbar-actions">
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(allCodes))}>
                  {t('roles.expandAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>
                  {t('roles.collapseAll')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable || selectedCount === 0}
                  onClick={() => setSelected(new Set())}
                >
                  {t('roles.clearSelection')}
                </Button>
              </div>
            </div>

            <p className="permission-count" role="status">
              {t('roles.selectedCount', { count: selectedCount, total })}
            </p>

            {unknownCodes.length > 0 ? (
              <div className="notice notice-warning" role="alert">
                {t('roles.unknownGrant', { codes: unknownCodes.join(', ') })}
              </div>
            ) : null}

            {visibleTree.length === 0 ? (
              <p className="state-block">{t('roles.permissionsNoMatch')}</p>
            ) : (
              <PermissionTreeView
                nodes={visibleTree}
                selected={selected}
                onChange={setSelected}
                expanded={expanded}
                onExpandedChange={setExpanded}
                locale={locale}
                translate={t}
                disabled={!editable}
                labels={{
                  menuAccess: t('roles.menuAccess'),
                  operations: t('roles.operations'),
                  expand: t('roles.expandAll'),
                  collapse: t('roles.collapseAll'),
                }}
              />
            )}

            {saveError ? (
              <div className="notice notice-danger" role="alert">
                {saveError}
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={discardOpen}
        title={t('roles.permissionsTitle')}
        description={t('roles.unsavedWarning')}
        confirmLabel={t('common.close')}
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
