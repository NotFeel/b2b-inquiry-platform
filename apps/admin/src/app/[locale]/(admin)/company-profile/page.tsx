'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type {
  BankAccountDetail,
  BankAccountProfile,
  CompanyAssetKind,
  CompanyProfile,
} from '../../../../lib/commercial-documents-api';
import { translateError } from '../../../../lib/i18n';
import {
  CountrySelect,
  CurrencySelect,
  useReferenceOptions,
} from '../../../../components/reference-selects';
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
  logoUrl: string | null;
  stampUrl: string | null;
  isDefault: boolean;
  enabled: boolean;
}

interface BankForm {
  id: string | null;
  label: string;
  accountHolder: string;
  bankName: string;
  bankAddress: string;
  bankCountryCode: string;
  accountNumber: string;
  swiftCode: string;
  wireRoutingNumber: string;
  achRoutingNumber: string;
  currencyCode: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: string;
}

type BankModalMode = 'create' | 'edit' | 'draft';

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
  logoUrl: null,
  stampUrl: null,
  isDefault: false,
  enabled: true,
};

const emptyBank: BankForm = {
  id: null,
  label: '',
  accountHolder: '',
  bankName: '',
  bankAddress: '',
  bankCountryCode: '',
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

function bankFromDetail(account: BankAccountDetail): BankForm {
  return {
    id: account.id,
    label: account.label,
    accountHolder: account.accountHolder,
    bankName: account.bankName,
    bankAddress: account.bankAddress ?? '',
    bankCountryCode: account.bankCountryCode ?? '',
    accountNumber: account.accountNumber,
    swiftCode: account.swiftCode ?? '',
    wireRoutingNumber: account.wireRoutingNumber ?? '',
    achRoutingNumber: account.achRoutingNumber ?? '',
    currencyCode: account.currencyCode ?? '',
    isDefault: account.isDefault,
    enabled: account.enabled,
    sortOrder: String(account.sortOrder),
  };
}

export default function CompanyProfilePage() {
  const { t, can, locale } = useSession();
  const breadcrumb = useBreadcrumb();
  const toast = useToast();
  const countryOptions = useReferenceOptions('country', locale);
  const currencyOptions = useReferenceOptions('currency', locale);

  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [draftBanks, setDraftBanks] = useState<BankForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const [bankOpen, setBankOpen] = useState(false);
  const [bankMode, setBankMode] = useState<BankModalMode>('create');
  const [bankDraftIndex, setBankDraftIndex] = useState<number | null>(null);
  const [bankForm, setBankForm] = useState<BankForm>(emptyBank);
  const [bankError, setBankError] = useState<string | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<CompanyAssetKind | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'disable' | 'default' | 'restore';
    account: BankAccountProfile;
  } | null>(null);

  const logoLabel = t('companyProfile.logo');
  const stampLabel = t('companyProfile.stamp');
  const canManage = can('company_profile.manage');
  const canManageBanks = can('bank_account.manage');
  const canCreateWithBanks = canManage && canManageBanks;

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const appliedProfileId = useRef<string | null>(null);

  const applyProfile = (profile: CompanyProfile | null) => {
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
      logoUrl: profile.logoUrl ?? null,
      stampUrl: profile.stampUrl ?? null,
      isDefault: profile.isDefault,
      enabled: profile.enabled,
    });
  };

  const load = useCallback(
    async (preferredId?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const data = await commercialDocumentsApi.companyProfiles();
        setProfiles(data);
        setSelectedId((current) => {
          const target = preferredId ?? current;
          if (target && data.some((profile) => profile.id === target)) return target;
          return data[0]?.id ?? null;
        });
      } catch (cause) {
        setError(
          cause instanceof AdminApiError
            ? translateError(locale, cause.code)
            : t('companyProfile.loadError'),
        );
      } finally {
        setLoading(false);
      }
    },
    [locale, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (createMode) {
      appliedProfileId.current = null;
      return;
    }
    const nextId = selected?.id ?? null;
    // Reloading the list after a save must not overwrite unsaved form edits.
    // Re-apply only when the operator actually selects a different company.
    if (nextId === appliedProfileId.current) return;
    appliedProfileId.current = nextId;
    applyProfile(selected);
  }, [createMode, selected]);

  const countryLabel = (code: string | null | undefined) => {
    if (!code) return t('companyProfile.notProvided');
    return countryOptions.options.find((option) => option.code === code)?.label ?? code;
  };

  const currencyLabel = (code: string | null | undefined) => {
    if (!code) return t('companyProfile.bank.noCurrency');
    return currencyOptions.options.find((option) => option.code === code)?.label ?? code;
  };

  const visibleProfiles = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (enabledFilter === 'enabled' && !profile.enabled) return false;
      if (enabledFilter === 'disabled' && profile.enabled) return false;
      if (!keyword) return true;
      return (
        profile.companyName.toLowerCase().includes(keyword) ||
        profile.code.toLowerCase().includes(keyword)
      );
    });
  }, [enabledFilter, profiles, search]);

  const groupedBanks = useMemo(() => {
    const groups = new Map<string, BankAccountProfile[]>();
    for (const account of selected?.bankAccounts ?? []) {
      const key = account.currencyCode ?? '__none__';
      const list = groups.get(key) ?? [];
      list.push(account);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selected]);

  const companyPayload = () => ({
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

  const bankPayload = (bank: BankForm, mode: BankModalMode) => ({
    label: bank.label.trim(),
    accountHolder: bank.accountHolder.trim(),
    bankName: bank.bankName.trim(),
    bankAddress: bank.bankAddress.trim() || null,
    ...(mode === 'edit' && !bank.bankCountryCode.trim()
      ? {}
      : { bankCountryCode: bank.bankCountryCode.trim().toUpperCase() }),
    accountNumber: bank.accountNumber.trim(),
    swiftCode: bank.swiftCode.trim() || null,
    wireRoutingNumber: bank.wireRoutingNumber.trim() || null,
    achRoutingNumber: bank.achRoutingNumber.trim() || null,
    ...(mode === 'edit' && !bank.currencyCode.trim()
      ? {}
      : { currencyCode: bank.currencyCode.trim().toUpperCase() }),
    isDefault: bank.enabled ? bank.isDefault : false,
    enabled: bank.enabled,
    sortOrder: Number(bank.sortOrder || '0'),
  });

  const saveCompany = async () => {
    if (!canManage || !form.companyName.trim()) {
      setError(t('companyProfile.companyNameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let saved: CompanyProfile;
      if (createMode) {
        const company = companyPayload();
        saved =
          canCreateWithBanks && draftBanks.length > 0
            ? await commercialDocumentsApi.createCompanyProfileWithBankAccounts({
                company,
                bankAccounts: draftBanks.map((bank) => bankPayload(bank, 'draft')),
              })
            : await commercialDocumentsApi.createCompanyProfile(company);
        setCreateMode(false);
        setDraftBanks([]);
        toast.success(t('companyProfile.created'));
      } else if (selected) {
        saved = await commercialDocumentsApi.updateCompanyProfile(selected.id, companyPayload());
        toast.success(t('companyProfile.saved'));
      } else {
        return;
      }
      await load(saved.id);
      setSelectedId(saved.id);
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
      toast.success(t('companyProfile.deleted'));
      setDeleteProfileOpen(false);
      setCreateMode(false);
      setSelectedId(null);
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

  const removeCompanyImage = async () => {
    const kind = assetToDelete;
    if (!kind) return;
    const assetId = kind === 'logo' ? form.logoAssetId : form.stampAssetId;
    if (!assetId) {
      setAssetToDelete(null);
      return;
    }
    setBusy(true);
    try {
      const persistedAssetId = selected
        ? kind === 'logo'
          ? selected.logoAssetId
          : selected.stampAssetId
        : null;
      if (!createMode && selected && persistedAssetId === assetId) {
        const result = await commercialDocumentsApi.removeCompanyAsset(selected.id, kind);
        setProfiles((current) =>
          current.map((profile) => (profile.id === result.profile.id ? result.profile : profile)),
        );
        setForm((current) =>
          kind === 'logo'
            ? { ...current, logoAssetId: '', logoUrl: null }
            : { ...current, stampAssetId: '', stampUrl: null },
        );
      } else {
        // The visible image is an unsaved upload. Purging it must target that
        // asset, not the company's persisted logo/stamp; the form reverts to
        // the saved image when one exists.
        await commercialDocumentsApi.removeUploadedCompanyAsset(assetId);
        setForm((current) =>
          kind === 'logo'
            ? {
                ...current,
                logoAssetId: selected?.logoAssetId ?? '',
                logoUrl: selected?.logoUrl ?? null,
              }
            : {
                ...current,
                stampAssetId: selected?.stampAssetId ?? '',
                stampUrl: selected?.stampUrl ?? null,
              },
        );
      }
      setAssetToDelete(null);
      toast.success(t('companyProfile.imageDeleted'));
    } catch (cause) {
      toast.error(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.imageDeleteError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
    if (!canManage) return;
    setCreateMode(true);
    setSelectedId(null);
    setForm(emptyProfile);
    setDraftBanks([]);
    setError(null);
  };

  const selectProfile = (id: string) => {
    setCreateMode(false);
    setSelectedId(id);
  };

  const validateBank = (bank: BankForm, mode: BankModalMode) => {
    if (
      !bank.label.trim() ||
      !bank.accountHolder.trim() ||
      !bank.bankName.trim() ||
      !bank.accountNumber.trim()
    ) {
      return t('errors.VALIDATION_FAILED');
    }
    if (mode !== 'edit' || bank.currencyCode.trim()) {
      if (!bank.currencyCode.trim()) return t('companyProfile.bank.currencyRequired');
    }
    if (mode !== 'edit' || bank.bankCountryCode.trim()) {
      if (!bank.bankCountryCode.trim()) return t('companyProfile.bank.countryRequired');
    }
    if (bank.enabled && !bank.currencyCode.trim()) {
      return t('companyProfile.bank.currencyRequiredToEnable');
    }
    return null;
  };

  const openBank = async (account: BankAccountProfile | null) => {
    setBankError(null);
    if (createMode) {
      setBankMode('draft');
      setBankDraftIndex(null);
      setBankForm({ ...emptyBank });
      setBankOpen(true);
      return;
    }
    if (!account) {
      setBankMode('create');
      setBankDraftIndex(null);
      setBankForm({ ...emptyBank });
      setBankOpen(true);
      return;
    }
    setBankMode('edit');
    setBankDraftIndex(null);
    setBankForm({ ...emptyBank, id: account.id });
    setBankLoading(true);
    setBankOpen(true);
    try {
      const detail = await commercialDocumentsApi.bankAccount(account.id);
      setBankForm(bankFromDetail(detail));
    } catch (cause) {
      setBankError(
        cause instanceof AdminApiError
          ? translateError(locale, cause.code)
          : t('companyProfile.bank.loadError'),
      );
    } finally {
      setBankLoading(false);
    }
  };

  const saveBank = async () => {
    const validation = validateBank(bankForm, bankMode);
    if (validation) {
      setBankError(validation);
      return;
    }
    if (bankMode === 'draft') {
      setDraftBanks((current) => {
        const next = [...current];
        const bank = {
          ...bankForm,
          enabled: bankForm.enabled,
          isDefault: bankForm.enabled && bankForm.isDefault,
        };
        if (bank.isDefault) {
          for (let index = 0; index < next.length; index += 1) {
            const candidate = next[index]!;
            if (candidate.currencyCode === bank.currencyCode) {
              next[index] = { ...candidate, isDefault: false };
            }
          }
        }
        if (bankDraftIndex !== null) next[bankDraftIndex] = bank;
        else next.push(bank);
        return next;
      });
      setBankOpen(false);
      return;
    }
    if (bankMode === 'create' && !selected) return;
    setBusy(true);
    setBankError(null);
    try {
      if (bankMode === 'create') {
        await commercialDocumentsApi.createBankAccount({
          companyProfileId: selected!.id,
          ...bankPayload(bankForm, 'create'),
        });
        toast.success(t('companyProfile.bank.created'));
      } else if (bankForm.id) {
        await commercialDocumentsApi.updateBankAccount(bankForm.id, bankPayload(bankForm, 'edit'));
        toast.success(t('companyProfile.bank.saved'));
      }
      setBankOpen(false);
      await load(selected?.id ?? null);
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

  const runBankAction = async () => {
    if (!confirmAction) return;
    const { type, account } = confirmAction;
    setBusy(true);
    try {
      if (type === 'disable') {
        await commercialDocumentsApi.disableBankAccount(account.id);
        toast.success(t('companyProfile.bank.disabledToast'));
      } else if (type === 'default') {
        await commercialDocumentsApi.updateBankAccount(account.id, {
          isDefault: true,
          enabled: true,
        });
        toast.success(t('companyProfile.bank.defaultSaved'));
      } else {
        await commercialDocumentsApi.updateBankAccount(account.id, {
          enabled: true,
          isDefault: false,
        });
        toast.success(t('companyProfile.bank.restored'));
      }
      setConfirmAction(null);
      await load(selected?.id ?? null);
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

  const editDraftBank = (index: number) => {
    setBankMode('draft');
    setBankDraftIndex(index);
    setBankForm({ ...draftBanks[index]! });
    setBankError(null);
    setBankOpen(true);
  };

  const removeDraftBank = (index: number) => {
    setDraftBanks((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const bankModalTitle =
    bankMode === 'edit'
      ? t('companyProfile.bank.edit')
      : bankMode === 'draft'
        ? t('companyProfile.bank.initialTitle')
        : t('companyProfile.bank.add');

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('companyProfile.title')}
        description={t('companyProfile.description')}
        actions={
          <div className="row-actions">
            <Button variant="secondary" loading={loading} onClick={() => void load(selectedId)}>
              {t('commercialDocuments.actions.refresh')}
            </Button>
            {canManage ? <Button onClick={startCreate}>{t('companyProfile.create')}</Button> : null}
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="document-workbench company-profile-workbench">
        <section className="panel stack-sm">
          <div className="row-between">
            <h2>{t('companyProfile.listTitle')}</h2>
            <span className="muted">
              {t('companyProfile.resultCount', { count: visibleProfiles.length })}
            </span>
          </div>
          <div className="form-grid company-list-filters">
            <Field label={t('companyProfile.search')}>
              {({ inputId }) => (
                <Input
                  inputId={inputId}
                  value={search}
                  placeholder={t('companyProfile.searchPlaceholder')}
                  onChange={(event) => setSearch(event.target.value)}
                />
              )}
            </Field>
            <Field label={t('companyProfile.enabled')}>
              {({ inputId }) => (
                <select
                  id={inputId}
                  className="select"
                  value={enabledFilter}
                  onChange={(event) =>
                    setEnabledFilter(event.target.value as 'all' | 'enabled' | 'disabled')
                  }
                >
                  <option value="all">{t('companyProfile.filterAll')}</option>
                  <option value="enabled">{t('companyProfile.filterEnabled')}</option>
                  <option value="disabled">{t('companyProfile.filterDisabled')}</option>
                </select>
              )}
            </Field>
          </div>

          {loading ? (
            <p>{t('common.loading')}</p>
          ) : visibleProfiles.length === 0 ? (
            <p className="muted">{t('companyProfile.emptyList')}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('companyProfile.companyName')}</th>
                    <th>{t('companyProfile.country')}</th>
                    <th>{t('companyProfile.bankCount')}</th>
                    <th>{t('companyProfile.default')}</th>
                    <th>{t('companyProfile.enabled')}</th>
                    <th>{t('documentTemplates.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProfiles.map((profile) => (
                    <tr
                      key={profile.id}
                      className={profile.id === selectedId ? 'is-selected-row' : ''}
                    >
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => selectProfile(profile.id)}
                        >
                          {profile.companyName}
                        </button>
                        <div className="muted">{profile.code}</div>
                      </td>
                      <td title={addressText(profile)}>
                        {countryLabel(profile.address?.countryCode)}
                      </td>
                      <td>{profile.bankAccounts?.length ?? 0}</td>
                      <td>
                        {profile.isDefault ? (
                          <Badge tone="success">{t('companyProfile.default')}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{profile.enabled ? t('common.yes') : t('common.no')}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => selectProfile(profile.id)}>
                          {t('common.edit')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel stack-sm">
          {!selected && !createMode ? (
            <p className="muted">{t('companyProfile.selectHint')}</p>
          ) : (
            <>
              <div className="row-between">
                <h2>{createMode ? t('companyProfile.createTitle') : selected?.companyName}</h2>
                {!createMode && selected ? (
                  <Badge tone={selected.enabled ? 'success' : 'neutral'}>
                    {selected.enabled ? t('companyProfile.enabled') : t('companyProfile.disabled')}
                  </Badge>
                ) : null}
              </div>

              <h3>{t('companyProfile.companyInformation')}</h3>
              <div className="form-grid">
                <Field label={t('companyProfile.code')}>
                  {({ inputId, describedBy }) => (
                    <Input
                      inputId={inputId}
                      describedBy={describedBy}
                      value={form.code}
                      disabled={!canManage || !createMode}
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
                      type="email"
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
              </div>

              <h3>{t('companyProfile.companyAddress')}</h3>
              <div className="form-grid">
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
                    <CountrySelect
                      inputId={inputId}
                      describedBy={describedBy}
                      value={form.countryCode}
                      onChange={(value) => setForm({ ...form, countryCode: value })}
                      placeholder={t('countrySelect.placeholder')}
                      disabled={!canManage}
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

              <h3>{t('companyProfile.logoStamp')}</h3>
              {canManage ? (
                <>
                  <div className="company-asset-grid">
                    <div className="company-asset-field">
                      <span className="field-label">{t('companyProfile.logo')}</span>
                      <div className="company-asset-preview">
                        {form.logoUrl ? (
                          <img
                            src={form.logoUrl}
                            alt={t('companyProfile.logoPreviewAlt')}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="field-help">
                            {form.logoAssetId
                              ? t('companyProfile.previewUnavailable')
                              : t('companyProfile.noImage')}
                          </span>
                        )}
                      </div>
                      {form.logoAssetId ? (
                        <div className="company-asset-actions">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            aria-label={`${t('companyProfile.deleteImage')} (${logoLabel})`}
                            onClick={() => setAssetToDelete('logo')}
                          >
                            {t('companyProfile.deleteImage')}
                          </Button>
                        </div>
                      ) : null}
                      <Upload
                        key={`logo-${form.logoAssetId || 'empty'}`}
                        accept="image/png,image/jpeg,image/webp"
                        maxBytes={2 * 1024 * 1024}
                        purpose="logo"
                        labels={{
                          chooseFile: t('common.select'),
                          hint: t('companyProfile.uploadHint'),
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
                        onUploaded={(result) =>
                          setForm((current) => ({
                            ...current,
                            logoAssetId: result.id,
                            logoUrl: result.url,
                          }))
                        }
                      />
                    </div>
                    <div className="company-asset-field">
                      <span className="field-label">{t('companyProfile.stamp')}</span>
                      <div className="company-asset-preview">
                        {form.stampUrl ? (
                          <img
                            src={form.stampUrl}
                            alt={t('companyProfile.stampPreviewAlt')}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="field-help">
                            {form.stampAssetId
                              ? t('companyProfile.previewUnavailable')
                              : t('companyProfile.noImage')}
                          </span>
                        )}
                      </div>
                      {form.stampAssetId ? (
                        <div className="company-asset-actions">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            aria-label={`${t('companyProfile.deleteImage')} (${stampLabel})`}
                            onClick={() => setAssetToDelete('stamp')}
                          >
                            {t('companyProfile.deleteImage')}
                          </Button>
                        </div>
                      ) : null}
                      <Upload
                        key={`stamp-${form.stampAssetId || 'empty'}`}
                        accept="image/png,image/jpeg,image/webp"
                        maxBytes={2 * 1024 * 1024}
                        purpose="logo"
                        labels={{
                          chooseFile: t('common.select'),
                          hint: t('companyProfile.uploadHint'),
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
                        onUploaded={(result) =>
                          setForm((current) => ({
                            ...current,
                            stampAssetId: result.id,
                            stampUrl: result.url,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <p className="field-help">{t('companyProfile.imageDeleteHint')}</p>
                </>
              ) : null}

              <div className="row-actions">
                {canManage ? (
                  <Button loading={busy} onClick={() => void saveCompany()}>
                    {createMode ? t('companyProfile.create') : t('companyProfile.save')}
                  </Button>
                ) : null}
                {!createMode && selected && canManage ? (
                  <Button variant="danger" onClick={() => setDeleteProfileOpen(true)}>
                    {t('companyProfile.delete')}
                  </Button>
                ) : null}
              </div>

              <div className="row-between company-bank-heading">
                <div>
                  <h3>{t('companyProfile.banks')}</h3>
                  <p className="muted">
                    {t('companyProfile.bankCountLabel', {
                      count: createMode ? draftBanks.length : (selected?.bankAccounts?.length ?? 0),
                    })}
                  </p>
                </div>
                {canManageBanks && (createMode || selected) ? (
                  <Button variant="secondary" onClick={() => void openBank(null)}>
                    {createMode
                      ? t('companyProfile.bank.addInitial')
                      : t('companyProfile.bank.add')}
                  </Button>
                ) : null}
              </div>

              {createMode ? (
                draftBanks.length === 0 ? (
                  <p className="muted">{t('companyProfile.bank.noInitial')}</p>
                ) : (
                  <div className="bank-account-groups">
                    {draftBanks.map((bank, index) => (
                      <article className="bank-account-card" key={`${bank.currencyCode}-${index}`}>
                        <div className="row-between">
                          <strong>{bank.label || t('companyProfile.bank.untitled')}</strong>
                          <Badge tone={bank.isDefault ? 'success' : 'neutral'}>
                            {bank.isDefault
                              ? t('companyProfile.bank.default')
                              : t('companyProfile.bank.backup')}
                          </Badge>
                        </div>
                        <p>{bank.bankName || '—'}</p>
                        <p className="mono">
                          {bank.currencyCode || t('companyProfile.bank.noCurrency')}
                        </p>
                        <div className="row-actions">
                          <Button size="sm" variant="ghost" onClick={() => editDraftBank(index)}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeDraftBank(index)}>
                            {t('common.remove')}
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )
              ) : groupedBanks.length === 0 ? (
                <p className="muted">{t('companyProfile.bank.empty')}</p>
              ) : (
                <div className="bank-account-groups">
                  {groupedBanks.map(([currency, accounts]) => (
                    <section className="bank-account-group" key={currency}>
                      <h4>
                        {currency === '__none__'
                          ? t('companyProfile.bank.noCurrency')
                          : `${currency} · ${currencyLabel(currency)}`}
                      </h4>
                      <div className="bank-account-grid">
                        {accounts.map((account) => (
                          <article className="bank-account-card" key={account.id}>
                            <div className="row-between">
                              <strong>{account.label}</strong>
                              <div className="row-tight">
                                {account.isDefault ? (
                                  <Badge tone="success">{t('companyProfile.bank.default')}</Badge>
                                ) : null}
                                {!account.enabled ? (
                                  <Badge tone="neutral">{t('companyProfile.disabled')}</Badge>
                                ) : null}
                              </div>
                            </div>
                            <p>{account.bankName}</p>
                            <dl className="bank-account-meta">
                              <dt>{t('companyProfile.bank.currencyCode')}</dt>
                              <dd>{account.currencyCode ?? t('companyProfile.bank.noCurrency')}</dd>
                              <dt>{t('companyProfile.bank.bankCountryCode')}</dt>
                              <dd>{countryLabel(account.bankCountryCode)}</dd>
                              <dt>{t('companyProfile.bank.accountNumber')}</dt>
                              <dd className="mono">{account.maskedAccountNumber}</dd>
                              <dt>{t('companyProfile.bank.swiftCode')}</dt>
                              <dd>
                                {account.hasSwift === true
                                  ? t('companyProfile.bank.swiftConfigured')
                                  : t('companyProfile.bank.swiftNotConfigured')}
                              </dd>
                            </dl>
                            {canManageBanks ? (
                              <div className="row-actions">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void openBank(account)}
                                >
                                  {t('common.edit')}
                                </Button>
                                {account.enabled && !account.isDefault && account.currencyCode ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmAction({ type: 'default', account })}
                                  >
                                    {t('companyProfile.bank.setDefault')}
                                  </Button>
                                ) : null}
                                {account.enabled ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmAction({ type: 'disable', account })}
                                  >
                                    {t('companyProfile.bank.disable')}
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmAction({ type: 'restore', account })}
                                  >
                                    {t('companyProfile.bank.restore')}
                                  </Button>
                                )}
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal
        open={bankOpen}
        title={bankModalTitle}
        size="lg"
        onClose={() => setBankOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBankOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={bankLoading} onClick={() => void saveBank()}>
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
        {bankLoading ? (
          <p>{t('common.loading')}</p>
        ) : (
          <>
            <h3>{t('companyProfile.bank.basicInfo')}</h3>
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
                    onChange={(event) =>
                      setBankForm({ ...bankForm, accountHolder: event.target.value })
                    }
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
              <Field
                label={t('companyProfile.bank.bankCountryCode')}
                help={
                  bankMode === 'edit' && !bankForm.bankCountryCode
                    ? t('companyProfile.bank.legacyCountry')
                    : undefined
                }
              >
                {({ inputId, describedBy }) => (
                  <CountrySelect
                    inputId={inputId}
                    describedBy={describedBy}
                    value={bankForm.bankCountryCode}
                    onChange={(value) => setBankForm({ ...bankForm, bankCountryCode: value })}
                    placeholder={t('countrySelect.placeholder')}
                  />
                )}
              </Field>
              <Field label={t('companyProfile.bank.bankAddress')}>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={bankForm.bankAddress}
                    onChange={(event) =>
                      setBankForm({ ...bankForm, bankAddress: event.target.value })
                    }
                  />
                )}
              </Field>
            </div>

            <h3>{t('companyProfile.bank.receivingInfo')}</h3>
            <div className="form-grid">
              <Field
                label={t('companyProfile.bank.currencyCode')}
                help={
                  bankMode === 'edit' && !bankForm.currencyCode
                    ? t('companyProfile.bank.legacyCurrency')
                    : undefined
                }
              >
                {({ inputId, describedBy }) => (
                  <CurrencySelect
                    inputId={inputId}
                    describedBy={describedBy}
                    value={bankForm.currencyCode}
                    onChange={(value) => setBankForm({ ...bankForm, currencyCode: value })}
                    placeholder={t('companyProfile.bank.selectCurrency')}
                    options={currencyOptions.options}
                    disabled={currencyOptions.loading}
                    ariaLabel={t('companyProfile.bank.currencyCode')}
                  />
                )}
              </Field>
              <Field label={t('companyProfile.bank.accountNumber')} required>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={bankForm.accountNumber}
                    onChange={(event) =>
                      setBankForm({ ...bankForm, accountNumber: event.target.value })
                    }
                  />
                )}
              </Field>
              <Field label={t('companyProfile.bank.swiftCode')}>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    value={bankForm.swiftCode}
                    onChange={(event) =>
                      setBankForm({ ...bankForm, swiftCode: event.target.value })
                    }
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
            </div>

            <h3>{t('companyProfile.bank.settings')}</h3>
            <div className="form-grid">
              <Field label={t('companyProfile.bank.sortOrder')}>
                {({ inputId, describedBy }) => (
                  <Input
                    inputId={inputId}
                    describedBy={describedBy}
                    type="number"
                    min={0}
                    max={1000}
                    value={bankForm.sortOrder}
                    onChange={(event) =>
                      setBankForm({ ...bankForm, sortOrder: event.target.value })
                    }
                  />
                )}
              </Field>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={bankForm.isDefault}
                disabled={!bankForm.enabled || !bankForm.currencyCode}
                onChange={(event) => setBankForm({ ...bankForm, isDefault: event.target.checked })}
              />
              <span>{t('companyProfile.bank.default')}</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={bankForm.enabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setBankForm({
                    ...bankForm,
                    enabled,
                    isDefault: enabled ? bankForm.isDefault : false,
                  });
                }}
              />
              <span>{t('companyProfile.bank.enabled')}</span>
            </label>
          </>
        )}
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
        open={assetToDelete !== null}
        title={t('companyProfile.deleteImage')}
        description={t('companyProfile.deleteImageConfirm', {
          kind: (assetToDelete === 'stamp' ? stampLabel : logoLabel).toLowerCase(),
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={busy}
        onConfirm={() => void removeCompanyImage()}
        onCancel={() => setAssetToDelete(null)}
      />
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'default'
            ? t('companyProfile.bank.setDefaultConfirmTitle', {
                currency: confirmAction.account.currencyCode ?? '',
              })
            : confirmAction?.type === 'disable'
              ? t('companyProfile.bank.disableConfirmTitle')
              : t('companyProfile.bank.restoreConfirmTitle')
        }
        description={
          confirmAction?.type === 'default'
            ? t('companyProfile.bank.setDefaultConfirm')
            : confirmAction?.type === 'disable'
              ? t('companyProfile.bank.disableConfirm')
              : t('companyProfile.bank.restoreConfirm')
        }
        confirmLabel={
          confirmAction?.type === 'default'
            ? t('companyProfile.bank.setDefault')
            : confirmAction?.type === 'disable'
              ? t('companyProfile.bank.disable')
              : t('companyProfile.bank.restore')
        }
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void runBankAction()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
