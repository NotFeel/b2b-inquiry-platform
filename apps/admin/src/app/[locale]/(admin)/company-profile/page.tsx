'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  PageHeader,
  Upload,
  useToast,
} from '@b2b/ui';
import { AdminApiError, uploadFile } from '../../../../lib/admin-api';
import { commercialDocumentsApi } from '../../../../lib/commercial-documents-api';
import type { BankAccountProfile, CompanyProfile } from '../../../../lib/commercial-documents-api';
import { translateError } from '../../../../lib/i18n';
import { useBreadcrumb } from '../../../../components/use-breadcrumb';
import { useSession } from '../../../../components/session-provider';

interface ProfileForm {
  code: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  taxId: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  logoAssetId: string;
  stampAssetId: string;
  isDefault: boolean;
  enabled: boolean;
}

interface BankForm {
  id: string | null;
  label: string;
  accountHolder: string;
  bankName: string;
  bankAddress: string;
  accountNumber: string;
  swiftCode: string;
  wireRoutingNumber: string;
  achRoutingNumber: string;
  currencyCode: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: string;
}

const emptyProfile: ProfileForm = {
  code: '',
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  taxId: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  countryCode: '',
  logoAssetId: '',
  stampAssetId: '',
  isDefault: false,
  enabled: true,
};

const emptyBank: BankForm = {
  id: null,
  label: '',
  accountHolder: '',
  bankName: '',
  bankAddress: '',
  accountNumber: '',
  swiftCode: '',
  wireRoutingNumber: '',
  achRoutingNumber: '',
  currencyCode: '',
  isDefault: false,
  enabled: true,
  sortOrder: '0',
};

function addressText(profile: CompanyProfile | null): string {
  if (!profile) return '';
  return [profile.address?.line1, profile.address?.city, profile.address?.countryCode]
    .filter(Boolean)
    .join(', ');
}

export default function CompanyProfilePage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();

  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [selected, setSelected] = useState<CompanyProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bankOpen, setBankOpen] = useState(false);
  const [bankForm, setBankForm] = useState<BankForm>(emptyBank);
  const [bankError, setBankError] = useState<string | null>(null);
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false);
  const [deleteBankTarget, setDeleteBankTarget] = useState<BankAccountProfile | null>(null);

  const canManage = can('company_profile.manage');
  const canManageBanks = can('bank_account.manage');

  const applyProfile = (profile: CompanyProfile | null) => {
    setSelected(profile);
    if (!profile) {
      setForm(emptyProfile);
      return;
    }
    setForm({
      code: profile.code,
      companyName: profile.companyName,
      contactName: profile.contactName ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      taxId: profile.taxId ?? '',
      website: profile.website ?? '',
      addressLine1: profile.address?.line1 ?? '',
      addressLine2: profile.address?.line2 ?? '',
      city: profile.address?.city ?? '',
      state: profile.address?.state ?? '',
      postalCode: profile.address?.postalCode ?? '',
      countryCode: profile.address?.countryCode ?? '',
      logoAssetId: profile.logoAssetId ?? '',
      stampAssetId: profile.stampAssetId ?? '',
      isDefault: profile.isDefault,
      enabled: profile.enabled,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await commercialDocumentsApi.companyProfiles();
      setProfiles(data);
      if (selected) {
        const refreshed = data.find((profile) => profile.id === selected.id) ?? null;
        applyProfile(refreshed);
      }
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [locale, selected, t]);

  useEffect(() => {
    // Load once; reloads are explicit through the refresh button.
    void commercialDocumentsApi
      .companyProfiles()
      .then((data) => {
        setProfiles(data);
        setSelected((current) => {
          if (current) return data.find((profile) => profile.id === current.id) ?? null;
          return data[0] ?? null;
        });
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof AdminApiError
            ? translateError(locale, cause.code)
            : t('companyProfile.loadError'),
        );
      })
      .finally(() => setLoading(false));
  }, [locale, t]);

  useEffect(() => {
    if (selected) applyProfile(selected);
  }, [selected]);

  const payload = () => ({
    ...(form.code.trim() ? { code: form.code.trim() } : {}),
    companyName: form.companyName.trim(),
    contactName: form.contactName.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    taxId: form.taxId.trim() || null,
    website: form.website.trim() || null,
    address: {
      line1: form.addressLine1.trim() || null,
      line2: form.addressLine2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      postalCode: form.postalCode.trim() || null,
      countryCode: form.countryCode.trim().toUpperCase() || null,
    },
    logoAssetId: form.logoAssetId || null,
    stampAssetId: form.stampAssetId || null,
    isDefault: form.isDefault,
    enabled: form.enabled,
  });

  const save = async () => {
    if (!canManage || !form.companyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = selected
        ? await commercialDocumentsApi.updateCompanyProfile(selected.id, payload())
        : await commercialDocumentsApi.createCompanyProfile(payload());
      toast.success(t(selected ? 'companyProfile.saved' : 'companyProfile.created'));
      const refreshed = await commercialDocumentsApi.companyProfiles();
      setProfiles(refreshed);
      setSelected(refreshed.find((profile) => profile.id === saved.id) ?? saved);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const removeProfile = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await commercialDocumentsApi.deleteCompanyProfile(selected.id);
      toast.success(t('common.saved'));
      setDeleteProfileOpen(false);
      setSelected(null);
      setForm(emptyProfile);
      await load();
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const openBank = (account: BankAccountProfile | null) => {
    setBankError(null);
    setBankForm(
      account
        ? {
            id: account.id,
            label: account.label,
            accountHolder: account.accountHolder,
            bankName: account.bankName,
            bankAddress: account.bankAddress ?? '',
            accountNumber: account.accountNumber,
            swiftCode: account.swiftCode ?? '',
            wireRoutingNumber: account.wireRoutingNumber ?? '',
            achRoutingNumber: account.achRoutingNumber ?? '',
            currencyCode: account.currencyCode ?? '',
            isDefault: account.isDefault,
            enabled: account.enabled,
            sortOrder: String(account.sortOrder),
          }
        : { ...emptyBank },
    );
    setBankOpen(true);
  };

  const saveBank = async () => {
    if (!selected || !canManageBanks) return;
    if (!bankForm.label.trim() || !bankForm.accountHolder.trim() || !bankForm.bankName.trim() || !bankForm.accountNumber.trim()) {
      setBankError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setBankError(null);
    try {
      const payload = {
        ...(bankForm.id ? {} : { companyProfileId: selected.id }),
        label: bankForm.label.trim(),
        accountHolder: bankForm.accountHolder.trim(),
        bankName: bankForm.bankName.trim(),
        bankAddress: bankForm.bankAddress.trim() || null,
        accountNumber: bankForm.accountNumber.trim(),
        swiftCode: bankForm.swiftCode.trim() || null,
        wireRoutingNumber: bankForm.wireRoutingNumber.trim() || null,
        achRoutingNumber: bankForm.achRoutingNumber.trim() || null,
        currencyCode: bankForm.currencyCode.trim().toUpperCase() || null,
        isDefault: bankForm.isDefault,
        enabled: bankForm.enabled,
        sortOrder: Number(bankForm.sortOrder || '0'),
      };
      if (bankForm.id) {
        await commercialDocumentsApi.updateBankAccount(bankForm.id, payload);
      } else {
        await commercialDocumentsApi.createBankAccount(payload);
      }
      toast.success(t(bankForm.id ? 'companyProfile.bank.saved' : 'companyProfile.bank.created'));
      setBankOpen(false);
      await load();
      const refreshed = await commercialDocumentsApi.companyProfiles();
      setProfiles(refreshed);
      const current = refreshed.find((profile) => profile.id === selected.id) ?? null;
      setSelected(current);
    } catch (cause) {
      setBankError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteBank = async () => {
    if (!deleteBankTarget) return;
    setBusy(true);
    try {
      await commercialDocumentsApi.deleteBankAccount(deleteBankTarget.id);
      toast.success(t('common.saved'));
      setDeleteBankTarget(null);
      const refreshed = await commercialDocumentsApi.companyProfiles();
      setProfiles(refreshed);
      setSelected(refreshed.find((profile) => profile.id === selected?.id) ?? null);
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('companyProfile.title')}
        description={t('companyProfile.description')}
        actions={
          <div className="row-actions">
            <Button variant="secondary" loading={loading} onClick={() => void load()}>
              {t('commercialDocuments.actions.refresh')}
            </Button>
            {canManage ? (
              <Button
                onClick={() => {
                  setSelected(null);
                  setForm(emptyProfile);
                }}
              >
                {t('companyProfile.create')}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="document-workbench">
        <section className="panel table-scroll">
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : profiles.length === 0 ? (
            <p>{t('common.empty')}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('companyProfile.companyName')}</th>
                  <th>{t('companyProfile.contactName')}</th>
                  <th>{t('companyProfile.default')}</th>
                  <th>{t('companyProfile.enabled')}</th>
                  <th>{t('documentTemplates.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setSelected(profile)}>
                        {profile.companyName}
                      </button>
                      <div className="muted">{addressText(profile)}</div>
                    </td>
                    <td>{profile.contactName ?? '—'}</td>
                    <td>{profile.isDefault ? <Badge tone="success">{t('common.yes')}</Badge> : '—'}</td>
                    <td>{profile.enabled ? t('common.yes') : t('common.no')}</td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(profile)}>
                        {t('common.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel stack-sm">
          <h2>{selected ? selected.companyName : t('companyProfile.create')}</h2>
          <div className="form-grid">
            <Field label={t('companyProfile.code')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.code}
                  disabled={!canManage || Boolean(selected)}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.companyName')} required>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.companyName}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, companyName: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.contactName')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.contactName}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.phone')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.phone}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.email')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.email}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.taxId')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.taxId}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, taxId: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.website')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.website}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, website: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.addressLine1')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.addressLine1}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, addressLine1: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.addressLine2')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.addressLine2}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, addressLine2: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.city')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.city}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.state')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.state}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, state: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.postalCode')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.postalCode}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('companyProfile.countryCode')}>
              {({ inputId, describedBy }) => (
                <Input
                  inputId={inputId}
                  describedBy={describedBy}
                  value={form.countryCode}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({ ...form, countryCode: event.target.value.toUpperCase().slice(0, 2) })
                  }
                  maxLength={2}
                />
              )}
            </Field>
          </div>
          <div className="form-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.isDefault}
                disabled={!canManage}
                onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              />
              <span>{t('companyProfile.default')}</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={!canManage}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span>{t('companyProfile.enabled')}</span>
            </label>
          </div>

          {canManage ? (
            <div className="form-grid">
              <div>
                <span className="field-label">Logo</span>
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  maxBytes={2 * 1024 * 1024}
                  purpose="logo"
                  labels={{
                    chooseFile: t('common.select'),
                    hint: 'PNG, JPEG or WebP · max 2 MB',
                    uploading: t('common.loading'),
                    tooLarge: t('errors.PAYLOAD_TOO_LARGE'),
                    failed: t('errors.INTERNAL_ERROR'),
                    result: t('common.saved'),
                  }}
                  onUpload={(file, purpose) =>
                    uploadFile(file, purpose).then((uploaded) => ({
                      id: uploaded.id,
                      url: uploaded.url,
                      originalName: uploaded.originalName,
                    }))
                  }
                  onUploaded={(result) => setForm((current) => ({ ...current, logoAssetId: result.id }))}
                />
                {form.logoAssetId ? <p className="mono">{form.logoAssetId}</p> : null}
              </div>
              <div>
                <span className="field-label">Stamp</span>
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  maxBytes={2 * 1024 * 1024}
                  purpose="logo"
                  labels={{
                    chooseFile: t('common.select'),
                    hint: 'PNG, JPEG or WebP · max 2 MB',
                    uploading: t('common.loading'),
                    tooLarge: t('errors.PAYLOAD_TOO_LARGE'),
                    failed: t('errors.INTERNAL_ERROR'),
                    result: t('common.saved'),
                  }}
                  onUpload={(file, purpose) =>
                    uploadFile(file, purpose).then((uploaded) => ({
                      id: uploaded.id,
                      url: uploaded.url,
                      originalName: uploaded.originalName,
                    }))
                  }
                  onUploaded={(result) => setForm((current) => ({ ...current, stampAssetId: result.id }))}
                />
                {form.stampAssetId ? <p className="mono">{form.stampAssetId}</p> : null}
              </div>
            </div>
          ) : null}

          <div className="row-actions">
            {canManage ? (
              <Button loading={busy} onClick={() => void save()}>
                {t('companyProfile.save')}
              </Button>
            ) : null}
            {selected && canManage ? (
              <Button variant="danger" onClick={() => setDeleteProfileOpen(true)}>
                {t('companyProfile.delete')}
              </Button>
            ) : null}
          </div>

          <div className="row-between">
            <h3>{t('companyProfile.banks')}</h3>
            {selected && canManageBanks ? (
              <Button variant="secondary" onClick={() => openBank(null)}>
                {t('companyProfile.bank.add')}
              </Button>
            ) : null}
          </div>
          {selected?.bankAccounts?.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('companyProfile.bank.label')}</th>
                    <th>{t('companyProfile.bank.accountHolder')}</th>
                    <th>{t('companyProfile.bank.bankName')}</th>
                    <th>{t('companyProfile.bank.currencyCode')}</th>
                    <th>{t('companyProfile.bank.default')}</th>
                    <th>{t('documentTemplates.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.bankAccounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.label}</td>
                      <td>{account.accountHolder}</td>
                      <td>{account.bankName}</td>
                      <td>{account.currencyCode ?? '—'}</td>
                      <td>{account.isDefault ? t('common.yes') : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <Button size="sm" variant="ghost" onClick={() => openBank(account)}>
                            {t('common.edit')}
                          </Button>
                          {canManageBanks ? (
                            <Button size="sm" variant="ghost" onClick={() => setDeleteBankTarget(account)}>
                              {t('companyProfile.bank.delete')}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{t('common.empty')}</p>
          )}
        </section>
      </div>

      <Modal
        open={bankOpen}
        title={bankForm.id ? t('companyProfile.bank.save') : t('companyProfile.bank.add')}
        size="lg"
        onClose={() => setBankOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBankOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void saveBank()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {bankError ? (
          <div className="alert alert-error" role="alert">
            {bankError}
          </div>
        ) : null}
        <div className="form-grid">
          <Field label={t('companyProfile.bank.label')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.label}
                onChange={(event) => setBankForm({ ...bankForm, label: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.accountHolder')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.accountHolder}
                onChange={(event) => setBankForm({ ...bankForm, accountHolder: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.bankName')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.bankName}
                onChange={(event) => setBankForm({ ...bankForm, bankName: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.bankAddress')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.bankAddress}
                onChange={(event) => setBankForm({ ...bankForm, bankAddress: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.accountNumber')} required>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.accountNumber}
                onChange={(event) => setBankForm({ ...bankForm, accountNumber: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.swiftCode')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.swiftCode}
                onChange={(event) => setBankForm({ ...bankForm, swiftCode: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.wireRoutingNumber')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.wireRoutingNumber}
                onChange={(event) =>
                  setBankForm({ ...bankForm, wireRoutingNumber: event.target.value })
                }
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.achRoutingNumber')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.achRoutingNumber}
                onChange={(event) =>
                  setBankForm({ ...bankForm, achRoutingNumber: event.target.value })
                }
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.currencyCode')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                value={bankForm.currencyCode}
                maxLength={3}
                onChange={(event) =>
                  setBankForm({ ...bankForm, currencyCode: event.target.value.toUpperCase() })
                }
              />
            )}
          </Field>
          <Field label={t('companyProfile.bank.sortOrder')}>
            {({ inputId, describedBy }) => (
              <Input
                inputId={inputId}
                describedBy={describedBy}
                type="number"
                value={bankForm.sortOrder}
                onChange={(event) => setBankForm({ ...bankForm, sortOrder: event.target.value })}
              />
            )}
          </Field>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={bankForm.isDefault}
              onChange={(event) => setBankForm({ ...bankForm, isDefault: event.target.checked })}
            />
            <span>{t('companyProfile.bank.default')}</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={bankForm.enabled}
              onChange={(event) => setBankForm({ ...bankForm, enabled: event.target.checked })}
            />
            <span>{t('companyProfile.bank.enabled')}</span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteProfileOpen}
        title={t('companyProfile.delete')}
        description={t('companyProfile.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void removeProfile()}
        onCancel={() => setDeleteProfileOpen(false)}
      />
      <ConfirmDialog
        open={deleteBankTarget !== null}
        title={t('companyProfile.bank.delete')}
        description={t('companyProfile.bank.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void deleteBank()}
        onCancel={() => setDeleteBankTarget(null)}
      />
    </div>
  );
}
