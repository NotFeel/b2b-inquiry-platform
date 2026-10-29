import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators';
import { ProductBulkImportController } from './product-bulk-import.controller';

describe('ProductBulkImportController wiring', () => {
  it('exposes the template, validate and commit routes under the admin product import path', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProductBulkImportController)).toBe(
      'admin/products/bulk-import',
    );
    expect(Reflect.getMetadata(PATH_METADATA, ProductBulkImportController.prototype.template)).toBe(
      'template',
    );
    expect(Reflect.getMetadata(PATH_METADATA, ProductBulkImportController.prototype.validate)).toBe(
      'validate',
    );
    expect(Reflect.getMetadata(PATH_METADATA, ProductBulkImportController.prototype.commit)).toBe(
      'commit',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, ProductBulkImportController.prototype.validate),
    ).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, ProductBulkImportController.prototype.commit)).toBe(
      RequestMethod.POST,
    );
  });

  it('requires server-side import/create permissions', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ProductBulkImportController.prototype.validate),
    ).toEqual([PERMISSIONS.productImport]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ProductBulkImportController.prototype.commit),
    ).toEqual([PERMISSIONS.productImport, PERMISSIONS.productCreate]);
  });
});
