import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY, Permission } from '../../common/decorators';
import { CommercialDocumentsController } from './commercial-documents.controller';
import { CompanyProfilesController } from './company-profiles.controller';
import { DocumentTemplatesController } from './document-templates.controller';

function permissions(target: object, method: string) {
  const descriptor = Object.getOwnPropertyDescriptor(target, method);
  expect(descriptor).toBeDefined();
  return Reflect.getMetadata(PERMISSIONS_KEY, descriptor!.value);
}

describe('commercial document endpoint authorization metadata', () => {
  it.each([
    ['list', Permission.commercialDocumentRead],
    ['detail', Permission.commercialDocumentRead],
    ['prefill', Permission.commercialDocumentRead],
    ['create', Permission.commercialDocumentCreate],
    ['update', Permission.commercialDocumentUpdate],
    ['preview', Permission.commercialDocumentPreview],
    ['render', Permission.commercialDocumentPreview],
    ['issue', Permission.commercialDocumentIssue],
    ['revision', Permission.commercialDocumentRevisionCreate],
    ['cancel', Permission.commercialDocumentCancel],
    ['download', Permission.commercialDocumentDownload],
  ])('commercial document %s is protected by %s', (method, permission) => {
    expect(permissions(CommercialDocumentsController.prototype, method)).toEqual([permission]);
  });

  it.each([
    ['list', Permission.documentTemplateRead],
    ['activeOptions', Permission.documentTemplateRead],
    ['detail', Permission.documentTemplateRead],
    ['create', Permission.documentTemplateCreate],
    ['update', Permission.documentTemplateUpdate],
    ['validate', Permission.documentTemplateRead],
    ['preview', Permission.documentTemplateRead],
    ['publish', Permission.documentTemplatePublish],
    ['remove', Permission.documentTemplateDelete],
    ['versions', Permission.documentTemplateRead],
  ])('template %s is protected by %s', (method, permission) => {
    expect(permissions(DocumentTemplatesController.prototype, method)).toEqual([permission]);
  });

  it.each([
    ['list', Permission.companyProfileManage],
    ['options', Permission.commercialDocumentRead],
    ['create', Permission.companyProfileManage],
    ['update', Permission.companyProfileManage],
    ['remove', Permission.companyProfileManage],
    ['removeAsset', Permission.companyProfileManage],
    ['removeUploadedAsset', Permission.companyProfileManage],
    ['createBankAccount', Permission.bankAccountManage],
    ['getBankAccount', Permission.bankAccountManage],
    ['updateBankAccount', Permission.bankAccountManage],
    ['removeBankAccount', Permission.bankAccountManage],
  ])('profile %s is protected by %s', (method, permission) => {
    expect(permissions(CompanyProfilesController.prototype, method)).toEqual([permission]);
  });

  it('combined company creation requires both company and bank permissions', () => {
    expect(permissions(CompanyProfilesController.prototype, 'createWithBankAccounts')).toEqual([
      Permission.companyProfileManage,
      Permission.bankAccountManage,
    ]);
  });
});
