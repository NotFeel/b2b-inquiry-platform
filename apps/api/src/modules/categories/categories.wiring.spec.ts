import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSIONS } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../common/decorators';
import { CategoriesController } from './categories.controller';
import { PublicCategoriesController } from './public-categories.controller';

// Static wiring checks for the category routes (docs/22 §5, §8).
//
// These assertions do not need a database: they prove that the HTTP contract the
// admin UI depends on exists - every error code maps to a real status, every
// admin route carries a permission, and the literal routes are declared before
// the `:id` routes so `/tree` is never swallowed by `/tree` -> `:id`.

interface RouteInfo {
  name: string;
  path: string;
  method: number;
  permissions: string[] | undefined;
}

function routesOf(prototype: object): RouteInfo[] {
  return Object.getOwnPropertyNames(prototype)
    .filter(
      (name) =>
        name !== 'constructor' &&
        typeof (prototype as Record<string, unknown>)[name] === 'function',
    )
    .map((name) => ({
      name,
      path: (Reflect.getMetadata(
        PATH_METADATA,
        (prototype as Record<string, unknown>)[name] as object,
      ) ?? '') as string,
      method: (Reflect.getMetadata(
        METHOD_METADATA,
        (prototype as Record<string, unknown>)[name] as object,
      ) ?? -1) as number,
      permissions: Reflect.getMetadata(
        PERMISSIONS_KEY,
        (prototype as Record<string, unknown>)[name] as object,
      ) as string[] | undefined,
    }));
}

describe('category admin routes', () => {
  const routes = routesOf(CategoriesController.prototype);
  const byName = new Map(routes.map((route) => [route.name, route]));

  it('declares the full set of endpoints the workbench calls', () => {
    const expected: Record<string, [RequestMethod, string]> = {
      // Nest normalises a controller-root route to '/'.
      list: [RequestMethod.GET, '/'],
      tree: [RequestMethod.GET, 'tree'],
      detail: [RequestMethod.GET, ':id'],
      deleteImpact: [RequestMethod.GET, ':id/delete-impact'],
      create: [RequestMethod.POST, '/'],
      update: [RequestMethod.PATCH, ':id'],
      move: [RequestMethod.POST, ':id/move'],
      reorder: [RequestMethod.POST, 'reorder'],
      remove: [RequestMethod.DELETE, ':id'],
    };
    for (const [name, [method, path]] of Object.entries(expected)) {
      expect(byName.get(name), `${name} must exist`).toBeDefined();
      expect([byName.get(name)?.method, byName.get(name)?.path]).toEqual([method, path]);
    }
    expect(routes).toHaveLength(Object.keys(expected).length);
  });

  it('guards every admin route with an explicit permission', () => {
    const expected: Record<string, string> = {
      list: PERMISSIONS.categoryRead,
      tree: PERMISSIONS.categoryRead,
      detail: PERMISSIONS.categoryRead,
      deleteImpact: PERMISSIONS.categoryRead,
      create: PERMISSIONS.categoryCreate,
      update: PERMISSIONS.categoryUpdate,
      move: PERMISSIONS.categoryUpdate,
      reorder: PERMISSIONS.categoryUpdate,
      remove: PERMISSIONS.categoryDelete,
    };
    for (const route of routes) {
      expect(route.permissions, `${route.name} must declare a permission`).toEqual([
        expected[route.name],
      ]);
    }
  });

  it('declares literal paths before their `:id` counterparts', () => {
    const order = routes.map((route) => route.name);
    // `GET /tree` must be declared before `GET /:id`, otherwise the id route
    // would swallow it. (`POST /reorder` cannot collide with `POST /:id/move`:
    // the segment counts differ.)
    expect(order.indexOf('tree')).toBeLessThan(order.indexOf('detail'));
    expect(order.indexOf('list')).toBeLessThan(order.indexOf('detail'));
  });
});

describe('public category routes', () => {
  it('is reachable without a session', () => {
    const prototype = PublicCategoriesController.prototype as unknown as Record<string, unknown>;
    const list = prototype.list as object;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, list)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, list)).toBeUndefined();
  });
});

describe('category error codes map to HTTP statuses', () => {
  // An unmapped business code silently surfaces as HTTP 400 (see api-error.ts);
  // this keeps the contract honest for the codes the category module raises.
  const categoryCodes = [
    ERROR_CODES.categoryCodeConflict,
    ERROR_CODES.categorySlugConflict,
    ERROR_CODES.categoryParentInvalid,
    ERROR_CODES.categoryCycleDetected,
    ERROR_CODES.categoryDepthExceeded,
    ERROR_CODES.categoryHasChildren,
    ERROR_CODES.categoryHasProducts,
    ERROR_CODES.categoryConcurrentUpdate,
  ];

  it('uses the intended status for each code', () => {
    const expected: Record<string, number> = {
      [ERROR_CODES.categoryCodeConflict]: 409,
      [ERROR_CODES.categorySlugConflict]: 409,
      [ERROR_CODES.categoryParentInvalid]: 400,
      [ERROR_CODES.categoryCycleDetected]: 409,
      [ERROR_CODES.categoryDepthExceeded]: 409,
      [ERROR_CODES.categoryHasChildren]: 409,
      [ERROR_CODES.categoryHasProducts]: 409,
      [ERROR_CODES.categoryConcurrentUpdate]: 409,
    };
    for (const code of categoryCodes) {
      const status = new ApiError(code, 'x').getStatus();
      expect(status, `${code} should map to ${expected[code]}`).toBe(expected[code]);
    }
  });
});
