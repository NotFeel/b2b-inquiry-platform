import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSIONS } from '@b2b/contracts';
import { ApiError } from '../../common/errors/api-error';
import { PERMISSIONS_KEY } from '../../common/decorators';
import { TagsController } from './tags.controller';

// Static wiring checks for the tag routes (docs/23 §6, §7, §12.2).
//
// No database needed: these prove the HTTP surface the admin UI calls exists,
// that create/update/delete are separate server-side capabilities, and that the
// literal `/options` route is declared before `/:id`.

interface RouteInfo {
  name: string;
  path: string;
  method: number;
  permissions: string[] | undefined;
}

const routes: RouteInfo[] = Object.getOwnPropertyNames(TagsController.prototype)
  .filter(
    (name) =>
      name !== 'constructor' &&
      typeof (TagsController.prototype as unknown as Record<string, unknown>)[name] === 'function',
  )
  .map((name) => {
    const handler = (TagsController.prototype as unknown as Record<string, unknown>)[
      name
    ] as object;
    return {
      name,
      path: (Reflect.getMetadata(PATH_METADATA, handler) ?? '') as string,
      method: (Reflect.getMetadata(METHOD_METADATA, handler) ?? -1) as number,
      permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[] | undefined,
    };
  });

const byName = new Map(routes.map((route) => [route.name, route]));

describe('tag admin routes', () => {
  it('exposes list, options, detail, create, update, status and delete', () => {
    const expected: Record<string, [RequestMethod, string]> = {
      list: [RequestMethod.GET, '/'],
      options: [RequestMethod.GET, 'options'],
      detail: [RequestMethod.GET, ':id'],
      create: [RequestMethod.POST, '/'],
      update: [RequestMethod.PATCH, ':id'],
      setStatus: [RequestMethod.PATCH, ':id/status'],
      remove: [RequestMethod.DELETE, ':id'],
    };
    for (const [name, [method, path]] of Object.entries(expected)) {
      expect(byName.get(name), `${name} must exist`).toBeDefined();
      expect([byName.get(name)?.method, byName.get(name)?.path]).toEqual([method, path]);
    }
    expect(routes).toHaveLength(Object.keys(expected).length);
  });

  it('guards every route with its own permission', () => {
    const expected: Record<string, string> = {
      list: PERMISSIONS.tagRead,
      options: PERMISSIONS.tagRead,
      detail: PERMISSIONS.tagRead,
      create: PERMISSIONS.tagCreate,
      update: PERMISSIONS.tagUpdate,
      setStatus: PERMISSIONS.tagUpdate,
      remove: PERMISSIONS.tagDelete,
    };
    for (const route of routes) {
      expect(route.permissions, `${route.name} must declare a permission`).toEqual([
        expected[route.name],
      ]);
    }
  });

  it('declares /options before /:id so the picker is not read as an id', () => {
    const order = routes.map((route) => route.name);
    expect(order.indexOf('options')).toBeLessThan(order.indexOf('detail'));
  });
});

describe('tag error codes map to HTTP statuses', () => {
  it('uses the intended status for each code', () => {
    const expected: Record<string, number> = {
      [ERROR_CODES.tagCodeConflict]: 409,
      [ERROR_CODES.tagInUse]: 409,
      [ERROR_CODES.tagNotFound]: 404,
      [ERROR_CODES.tagColorTokenInvalid]: 400,
      [ERROR_CODES.tagTranslationMissing]: 400,
      [ERROR_CODES.tagConcurrentUpdate]: 409,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(new ApiError(code, 'x').getStatus(), `${code} should map to ${status}`).toBe(status);
    }
  });
});
