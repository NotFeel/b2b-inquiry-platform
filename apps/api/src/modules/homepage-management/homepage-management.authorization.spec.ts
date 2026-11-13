import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSIONS } from '@b2b/contracts';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthenticatedActor } from '../../common/request-context';
import { HomepageManagementController } from './homepage-management.controller';

function contextFor(handler: object, actor?: AuthenticatedActor): ExecutionContext {
  const request = {
    actor,
    path: '/api/v1/admin/homepage-management/config',
  };
  return {
    getHandler: () => handler,
    getClass: () => HomepageManagementController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function actorWith(permissions: string[]): AuthenticatedActor {
  return {
    id: 'actor-1',
    username: 'catalog-manager',
    displayName: 'Catalog manager',
    roles: ['catalog_manager'],
    permissions: new Set(permissions),
    sessionId: 'session-1',
    mustChangePassword: false,
  };
}

describe('homepage management endpoint authorization', () => {
  const guard = new PermissionsGuard(new Reflector());
  const updateHandler = HomepageManagementController.prototype.updateConfig;

  it('rejects an unauthenticated request', () => {
    expect(() => guard.canActivate(contextFor(updateHandler))).toThrow(
      expect.objectContaining({ code: ERROR_CODES.unauthorized }),
    );
  });

  it('rejects an authenticated account without the endpoint permission', () => {
    expect(() =>
      guard.canActivate(contextFor(updateHandler, actorWith([PERMISSIONS.homepageRead]))),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.forbidden }));
  });

  it('allows the explicitly granted mutation permission', () => {
    expect(
      guard.canActivate(contextFor(updateHandler, actorWith([PERMISSIONS.homepageConfigUpdate]))),
    ).toBe(true);
  });
});
