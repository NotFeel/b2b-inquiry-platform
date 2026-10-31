import { describe, expect, it, vi } from 'vitest';
import { PROTECTED_MENU_CODES } from '@b2b/contracts';
import { MENU_SEED, type MenuSeed } from './menu-seed';
import { REFERENCE_PERMISSIONS, REFERENCE_ROLES, syncReferenceData } from './seed';

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
