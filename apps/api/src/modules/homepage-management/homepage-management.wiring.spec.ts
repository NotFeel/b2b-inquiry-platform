import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSIONS } from '@b2b/contracts';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../common/decorators';
import { ApiError } from '../../common/errors/api-error';
import { HomepageManagementController } from './homepage-management.controller';
import { PublicHomepageController } from './public-homepage.controller';

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

describe('homepage management admin routes', () => {
  const routes = routesOf(HomepageManagementController.prototype);
  const byName = new Map(routes.map((route) => [route.name, route]));

  it('declares the complete stage C HTTP surface', () => {
    const expected: Record<string, [RequestMethod, string]> = {
      getConfig: [RequestMethod.GET, 'config'],
      updateConfig: [RequestMethod.PATCH, 'config'],
      listCollections: [RequestMethod.GET, 'collections'],
      createCollection: [RequestMethod.POST, 'collections'],
      sortCollections: [RequestMethod.PUT, 'collections/sort'],
      collectionDetail: [RequestMethod.GET, 'collections/:id'],
      updateCollection: [RequestMethod.PATCH, 'collections/:id'],
      removeCollection: [RequestMethod.DELETE, 'collections/:id'],
      updateProducts: [RequestMethod.PUT, 'collections/:id/products'],
    };
    for (const [name, [method, path]] of Object.entries(expected)) {
      expect(byName.get(name), `${name} must exist`).toBeDefined();
      expect([byName.get(name)?.method, byName.get(name)?.path]).toEqual([method, path]);
    }
    expect(routes).toHaveLength(Object.keys(expected).length);
  });

  it('guards every route with an explicit permission and separates mutation rights', () => {
    const expected: Record<string, string> = {
      getConfig: PERMISSIONS.homepageRead,
      updateConfig: PERMISSIONS.homepageConfigUpdate,
      listCollections: PERMISSIONS.homepageRead,
      createCollection: PERMISSIONS.homepageCollectionCreate,
      sortCollections: PERMISSIONS.homepageCollectionUpdate,
      collectionDetail: PERMISSIONS.homepageRead,
      updateCollection: PERMISSIONS.homepageCollectionUpdate,
      removeCollection: PERMISSIONS.homepageCollectionDelete,
      updateProducts: PERMISSIONS.homepageProductUpdate,
    };
    for (const route of routes) {
      expect(route.permissions, `${route.name} must declare a permission`).toEqual([
        expected[route.name],
      ]);
    }
  });

  it('declares the literal sort route before the collection id routes', () => {
    const names = routes.map((route) => route.name);
    expect(names.indexOf('sortCollections')).toBeLessThan(names.indexOf('collectionDetail'));
  });
});

describe('homepage business errors map to distinct HTTP statuses', () => {
  it.each([
    [ERROR_CODES.homepageCollectionNotFound, 404],
    [ERROR_CODES.homepageCollectionCategoryConflict, 409],
    [ERROR_CODES.homepageCollectionCategoryChangeBlocked, 409],
    [ERROR_CODES.homepageCollectionProductCategoryMismatch, 422],
    [ERROR_CODES.homepageCollectionProductDuplicate, 409],
    [ERROR_CODES.homepageCollectionProductLimitExceeded, 422],
    [ERROR_CODES.homepageCollectionConcurrentUpdate, 409],
  ])('%s maps to %s', (code, status) => {
    expect(new ApiError(code, 'x').getStatus()).toBe(status);
  });
});

describe('public homepage routes', () => {
  const routes = routesOf(PublicHomepageController.prototype);
  const byName = new Map(routes.map((route) => [route.name, route]));

  it('declares the complete unauthenticated stage D surface', () => {
    const expected: Record<string, [RequestMethod, string]> = {
      overview: [RequestMethod.GET, '/'],
      newArrivals: [RequestMethod.GET, 'new-arrivals'],
      collectionProducts: [RequestMethod.GET, 'collections/:id/products'],
    };
    expect(routes).toHaveLength(Object.keys(expected).length);
    for (const [name, [method, path]] of Object.entries(expected)) {
      expect(byName.get(name), `${name} must exist`).toBeDefined();
      expect([byName.get(name)?.method, byName.get(name)?.path]).toEqual([method, path]);
    }
  });

  it('marks every route public and never requires an admin permission', () => {
    for (const route of routes) {
      const handler = (PublicHomepageController.prototype as unknown as Record<string, object>)[
        route.name
      ];
      expect(handler, `${route.name} must exist`).toBeDefined();
      if (!handler) continue;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler), `${route.name} must be public`).toBe(
        true,
      );
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    }
  });
});
