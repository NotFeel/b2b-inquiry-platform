import { describe, expect, it, vi } from 'vitest';
import { PROTECTED_MENU_CODES } from '@b2b/contracts';
import { MENU_SEED, type MenuSeed } from './menu-seed';
import { REFERENCE_PERMISSIONS, REFERENCE_ROLES, syncReferenceData } from './seed';
import { COUNTRY_REFERENCE } from './reference-data/countries';

function flattenMenus(menus: MenuSeed[]): MenuSeed[] {
  return menus.flatMap((menu) => [menu, ...flattenMenus(menu.children ?? [])]);
}

describe('reference authorization and navigation seed', () => {
  it('defines all Excel-to-PDF permissions and a protected bilingual menu', () => {
    const permissionCodes = REFERENCE_PERMISSIONS.map((permission) => permission.code);
    expect(permissionCodes).toEqual(
      expect.arrayContaining([
        'excel_pdf.read',
        'excel_pdf.create',
        'excel_pdf.download',
        'excel_pdf.retry',
        'excel_pdf.delete',
      ]),
    );

    const menu = flattenMenus(MENU_SEED).find((candidate) => candidate.code === 'excel-pdf');
    expect(menu).toMatchObject({
      route: '/tools/excel-to-pdf',
      permissionCode: 'excel_pdf.read',
      labels: { 'zh-CN': 'Excel 转 PDF', 'en-US': 'Excel to PDF' },
    });
    expect(PROTECTED_MENU_CODES).toContain('excel-pdf');
  });

  it('does not grant Excel-to-PDF operations to ordinary roles by default', () => {
    const excelPermissions = REFERENCE_PERMISSIONS.map((permission) => permission.code).filter(
      (code) => code.startsWith('excel_pdf.'),
    );
    for (const role of REFERENCE_ROLES.filter((candidate) => candidate.permissions !== 'all')) {
      for (const permission of excelPermissions) {
        expect(role.permissions).not.toContain(permission);
      }
    }
  });

  it('does not grant commercial-document deletion to ordinary roles by default', () => {
    expect(REFERENCE_PERMISSIONS.map((permission) => permission.code)).toContain(
      'commercial_document.delete',
    );
    for (const role of REFERENCE_ROLES.filter((candidate) => candidate.permissions !== 'all')) {
      expect(role.permissions).not.toContain('commercial_document.delete');
    }
  });

  it('defines separate homepage permissions and grants writes only to catalogue maintainers', () => {
    const homePermissions = REFERENCE_PERMISSIONS.map((permission) => permission.code).filter(
      (code) => code.startsWith('homepage.'),
    );
    expect(homePermissions).toEqual([
      'homepage.read',
      'homepage.config.update',
      'homepage.collection.create',
      'homepage.collection.update',
      'homepage.collection.delete',
      'homepage.product.update',
    ]);

    const catalogue = REFERENCE_ROLES.find((role) => role.code === 'catalog_manager');
    expect(catalogue?.permissions).toEqual(expect.arrayContaining(homePermissions));

    const viewer = REFERENCE_ROLES.find((role) => role.code === 'viewer');
    expect(viewer?.permissions).toContain('homepage.read');
    for (const permission of homePermissions.filter((code) => code !== 'homepage.read')) {
      expect(viewer?.permissions).not.toContain(permission);
    }
  });

  it('acquires the transaction advisory lock before touching reference tables', async () => {
    const sentinel = new Error('permission query reached');
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      permission: { findMany: vi.fn().mockRejectedValue(sentinel) },
    };
    const client = {
      $transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
      ),
    };

    await expect(syncReferenceData(client as never)).rejects.toBe(sentinel);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.permission.findMany).toHaveBeenCalledOnce();
  });
});

describe('country reference data', () => {
  it('contains a complete, unique ISO alpha-2 set with bilingual labels', () => {
    expect(COUNTRY_REFERENCE.length).toBeGreaterThanOrEqual(240);
    const codes = COUNTRY_REFERENCE.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [code, en, zh] of COUNTRY_REFERENCE) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(en.trim()).not.toBe('');
      expect(zh.trim()).not.toBe('');
    }
    expect(codes).toEqual(expect.arrayContaining(['US', 'CN', 'GB', 'DE', 'JP', 'AU']));
  });
});
