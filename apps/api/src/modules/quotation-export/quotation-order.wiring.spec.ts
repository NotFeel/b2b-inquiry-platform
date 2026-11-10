import { describe, expect, it } from 'vitest';
import { Permission, PERMISSIONS_KEY } from '../../common/decorators';
import { QuotationOrderController } from './quotation-order.controller';

describe('quotation/order endpoint authorization metadata', () => {
  it.each([
    ['config', Permission.quotationRead],
    ['products', Permission.quotationRead],
    ['preview', Permission.quotationCalculate],
    ['createQuotation', Permission.quotationCreate],
    ['quotations', Permission.quotationRead],
    ['quotationDetail', Permission.quotationRead],
    ['quotationEditData', [Permission.quotationUpdate, Permission.quotationCostRead]],
    ['updateQuotation', Permission.quotationUpdate],
    ['deleteQuotation', Permission.quotationDelete],
    ['convert', Permission.quotationConvertToOrder],
    ['createOrder', Permission.orderCreate],
    ['orders', Permission.orderRead],
    ['orderDetail', Permission.orderRead],
    ['updateOrderCustomerSnapshot', Permission.orderCustomerSnapshotUpdate],
    ['syncOrderCustomerProfile', [Permission.orderCustomerProfileSync, Permission.customerUpdate]],
  ])('%s is protected by %s', (method, permission) => {
    const descriptor = Object.getOwnPropertyDescriptor(QuotationOrderController.prototype, method);
    expect(descriptor).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, descriptor!.value)).toEqual(
      Array.isArray(permission) ? permission : [permission],
    );
  });
});
