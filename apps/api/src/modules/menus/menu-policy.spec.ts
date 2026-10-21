import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/errors/api-error';
import {
  assertDepthWithinLimit,
  assertExpectedUpdatedAt,
  assertIconIsAllowed,
  assertMenuIsDeletable,
  assertMenuTranslationsComplete,
  assertParentIsValid,
  assertReorderIsComplete,
  assertRouteIsUnique,
  assertRouteMatchesKind,
  childrenOf,
  collectDescendantIds,
  isProtectedMenuCode,
  levelUnder,
  missingMenuTranslationLocales,
  subtreeHeight,
  toTranslationRows,
  type MenuRef,
} from './menu-policy';

const ROWS: MenuRef[] = [
  { id: 'catalog', code: 'catalog', parentId: null, route: null, enabled: true },
  { id: 'products', code: 'products', parentId: 'catalog', route: '/products', enabled: true },
  { id: 'tags', code: 'tags', parentId: 'catalog', route: '/tags', enabled: true },
  { id: 'legacy', code: 'leads', parentId: null, route: '/leads', enabled: false },
];

function codeOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as ApiError).code;
  }
  throw new Error('expected the guard to throw');
}

describe('tree facts', () => {
  it('lists children and descendants', () => {
    expect(childrenOf(ROWS, 'catalog').map((row) => row.code)).toEqual(['products', 'tags']);
    expect([...collectDescendantIds(ROWS, 'catalog')].sort()).toEqual(['products', 'tags']);
    expect([...collectDescendantIds(ROWS, 'products')]).toEqual([]);
  });

  it('computes nesting level and subtree height', () => {
    expect(levelUnder(ROWS, null)).toBe(1);
    expect(levelUnder(ROWS, 'catalog')).toBe(2);
    expect(subtreeHeight(ROWS, 'catalog')).toBe(1);
    expect(subtreeHeight(ROWS, 'products')).toBe(0);
  });

  it('stops walking when a parent chain is already broken', () => {
    const cyclic: MenuRef[] = [
      { id: 'a', code: 'a', parentId: 'b', route: null, enabled: true },
      { id: 'b', code: 'b', parentId: 'a', route: null, enabled: true },
    ];
    expect(levelUnder(cyclic, 'a')).toBeGreaterThan(1);
  });
});

describe('parent validation', () => {
  it('accepts a root menu and an existing parent', () => {
    expect(() => assertParentIsValid({ rows: ROWS, parentId: null })).not.toThrow();
    expect(() => assertParentIsValid({ rows: ROWS, parentId: 'catalog' })).not.toThrow();
  });

  it('rejects a missing parent', () => {
    expect(codeOf(() => assertParentIsValid({ rows: ROWS, parentId: 'ghost' }))).toBe(
      'MENU_PARENT_INVALID',
    );
  });

  it('rejects the node itself and its own descendants', () => {
    expect(
      codeOf(() => assertParentIsValid({ rows: ROWS, parentId: 'catalog', selfId: 'catalog' })),
    ).toBe('MENU_PARENT_CYCLE');
    expect(
      codeOf(() => assertParentIsValid({ rows: ROWS, parentId: 'products', selfId: 'catalog' })),
    ).toBe('MENU_PARENT_CYCLE');
    expect(() =>
      assertParentIsValid({ rows: ROWS, parentId: 'catalog', selfId: 'products' }),
    ).not.toThrow();
  });
});

describe('depth limit', () => {
  it('allows a node within the limit and rejects one beyond it', () => {
    expect(() => assertDepthWithinLimit({ rows: ROWS, parentId: 'catalog' })).not.toThrow();
    const deep: MenuRef[] = [
      { id: 'l1', code: 'l1', parentId: null, route: null, enabled: true },
      { id: 'l2', code: 'l2', parentId: 'l1', route: null, enabled: true },
      { id: 'l3', code: 'l3', parentId: 'l2', route: null, enabled: true },
      { id: 'l4', code: 'l4', parentId: 'l3', route: null, enabled: true },
      { id: 'l5', code: 'l5', parentId: 'l4', route: null, enabled: true },
    ];
    expect(() => assertDepthWithinLimit({ rows: deep, parentId: 'l4' })).not.toThrow();
    expect(codeOf(() => assertDepthWithinLimit({ rows: deep, parentId: 'l5' }))).toBe(
      'MENU_DEPTH_EXCEEDED',
    );
  });

  it('counts the height of a moved subtree', () => {
    expect(
      codeOf(() => assertDepthWithinLimit({ rows: ROWS, parentId: 'catalog', subtreeHeight: 4 })),
    ).toBe('MENU_DEPTH_EXCEEDED');
  });
});

describe('route rules', () => {
  it('requires an https URL for external links and a relative path otherwise', () => {
    expect(() =>
      assertRouteMatchesKind({ external: true, route: 'https://example.com/x' }),
    ).not.toThrow();
    expect(() => assertRouteMatchesKind({ external: false, route: '/products' })).not.toThrow();
    expect(() => assertRouteMatchesKind({ external: false, route: null })).not.toThrow();
    expect(codeOf(() => assertRouteMatchesKind({ external: true, route: '/products' }))).toBe(
      'MENU_TYPE_ROUTE_MISMATCH',
    );
    expect(
      codeOf(() => assertRouteMatchesKind({ external: false, route: 'https://example.com' })),
    ).toBe('MENU_TYPE_ROUTE_MISMATCH');
  });

  it('rejects a route that another enabled menu already owns', () => {
    expect(() => assertRouteIsUnique({ route: null, conflicts: [ROWS[1]!] })).not.toThrow();
    expect(() => assertRouteIsUnique({ route: '/new', conflicts: [] })).not.toThrow();
    expect(codeOf(() => assertRouteIsUnique({ route: '/products', conflicts: [ROWS[1]!] }))).toBe(
      'MENU_ROUTE_EXISTS',
    );
  });
});

describe('icon allow-list', () => {
  it('accepts supported names and rejects unknown ones', () => {
    expect(() => assertIconIsAllowed('grid')).not.toThrow();
    expect(() => assertIconIsAllowed('folder')).not.toThrow();
    expect(() => assertIconIsAllowed(null)).not.toThrow();
    expect(codeOf(() => assertIconIsAllowed('<script>'))).toBe('MENU_ICON_INVALID');
  });

  it('protects the seeded navigation skeleton', () => {
    expect(isProtectedMenuCode('administration')).toBe(true);
    expect(isProtectedMenuCode('system')).toBe(false);
  });
});

describe('delete protection', () => {
  it('refuses a menu with children before anything else', () => {
    const error = codeOf(() => assertMenuIsDeletable({ code: 'catalog', childCount: 3 }));
    expect(error).toBe('MENU_HAS_CHILDREN');
  });

  it('refuses a protected system menu', () => {
    expect(codeOf(() => assertMenuIsDeletable({ code: 'users', childCount: 0 }))).toBe(
      'MENU_SYSTEM_PROTECTED',
    );
  });

  it('allows deleting a custom, childless menu', () => {
    expect(() => assertMenuIsDeletable({ code: 'custom-report', childCount: 0 })).not.toThrow();
  });
});

describe('sibling reorder', () => {
  it('requires the complete sibling set exactly once', () => {
    expect(() =>
      assertReorderIsComplete({ orderedIds: ['b', 'a'], siblingIds: ['a', 'b'] }),
    ).not.toThrow();
    expect(
      codeOf(() => assertReorderIsComplete({ orderedIds: ['a'], siblingIds: ['a', 'b'] })),
    ).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() => assertReorderIsComplete({ orderedIds: ['a', 'z'], siblingIds: ['a', 'b'] })),
    ).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() => assertReorderIsComplete({ orderedIds: ['a', 'a'], siblingIds: ['a', 'b'] })),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('labels and concurrency', () => {
  it('trims labels, drops empty ones and sorts by locale', () => {
    expect(toTranslationRows({ 'zh-CN': ' 商品目录 ', 'en-US': '  ', 'xx-XX': 'x' })).toEqual([
      { locale: 'xx-XX', label: 'x' },
      { locale: 'zh-CN', label: '商品目录' },
    ]);
  });

  it('requires both supported locales for enabled and visible menus', () => {
    expect(missingMenuTranslationLocales({ 'zh-CN': '商品目录', 'en-US': 'Catalog' })).toEqual([]);
    expect(missingMenuTranslationLocales({ 'zh-CN': '商品目录' })).toEqual(['en-US']);
    expect(
      codeOf(() =>
        assertMenuTranslationsComplete({
          labels: { 'zh-CN': '商品目录' },
          enabled: true,
          visible: true,
        }),
      ),
    ).toBe('MENU_TRANSLATION_MISSING');
    expect(() =>
      assertMenuTranslationsComplete({
        labels: { 'zh-CN': '商品目录' },
        enabled: true,
        visible: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertMenuTranslationsComplete({
        labels: { 'zh-CN': '商品目录' },
        enabled: false,
        visible: true,
      }),
    ).not.toThrow();
  });

  it('reports a stale editor as MENU_MODIFIED', () => {
    const updatedAt = new Date('2026-10-15T10:00:00.000Z');
    expect(() => assertExpectedUpdatedAt(updatedAt.toISOString(), updatedAt)).not.toThrow();
    expect(() => assertExpectedUpdatedAt(undefined, updatedAt)).not.toThrow();
    expect(codeOf(() => assertExpectedUpdatedAt('2026-10-15T09:00:00.000Z', updatedAt))).toBe(
      'MENU_MODIFIED',
    );
  });
});
