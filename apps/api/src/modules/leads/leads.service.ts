import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type { CustomerLookupResult, CustomerSummary, InquiryActivitySummary } from '@b2b/contracts';
import type { CreateCustomerInput, CreateInquiryActivityInput } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { digitsOnly, maskPhone, normalizePhone } from './phone';

interface CustomerRecord {
  id: string;
  phoneE164: string;
  countryCode: string | null;
  displayName: string | null;
  note: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  _count: { activities: number };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toCustomerSummary(customer: CustomerRecord, revealPhone: boolean): CustomerSummary {
    return {
      id: customer.id,
      phoneE164: revealPhone ? customer.phoneE164 : maskPhone(customer.phoneE164),
      phoneDisplay: revealPhone ? customer.phoneE164 : maskPhone(customer.phoneE164),
      countryCode: customer.countryCode,
      displayName: customer.displayName,
      note: customer.note,
      activityCount: customer._count.activities,
      lastActivityAt: customer.lastSeenAt.toISOString(),
      createdAt: customer.createdAt.toISOString(),
    };
  }

  private toActivity(activity: {
    id: string;
    customerId: string;
    salespersonName: string;
    salespersonPhone: string | null;
    occurredAt: Date;
    productSkus: unknown;
    note: string | null;
    source: string;
    createdById: string | null;
    createdAt: Date;
    customer: { phoneE164: string };
  }, revealPhone: boolean): InquiryActivitySummary {
    return {
      id: activity.id,
      customerId: activity.customerId,
      customerPhoneDisplay: revealPhone ? activity.customer.phoneE164 : maskPhone(activity.customer.phoneE164),
      salespersonName: activity.salespersonName,
      salespersonPhone: revealPhone ? activity.salespersonPhone : null,
      occurredAt: activity.occurredAt.toISOString(),
      productSkus: Array.isArray(activity.productSkus) ? (activity.productSkus as string[]) : [],
      note: activity.note,
      source: activity.source,
      createdBy: activity.createdById,
      createdAt: activity.createdAt.toISOString(),
    };
  }

  /**
   * Phone search used by the fixed search box in the leads module. The number is
   * normalised first; when it cannot be resolved without a country the caller
   * learns that a country must be chosen instead of getting a silent no-match.
   */
  async lookup(
    phone: string,
    options: { countryCode?: string; revealPhone: boolean },
  ): Promise<CustomerLookupResult> {
    let normalized: string | null = null;
    let countryRequired = false;
    try {
      normalized = normalizePhone(phone, options.countryCode).e164;
    } catch (error) {
      if (error instanceof ApiError && error.code === ERROR_CODES.customerCountryRequired) {
        countryRequired = true;
      } else if (error instanceof ApiError && error.code === ERROR_CODES.customerPhoneInvalid) {
        countryRequired = false;
      } else {
        throw error;
      }
    }

    const exact = normalized
      ? await this.prisma.customer.findUnique({
          where: { phoneE164: normalized },
          include: { _count: { select: { activities: true } } },
        })
      : null;

    const fuzzyTerms = normalized ? [] : [digitsOnly(phone)].filter((value) => value.length >= 5);
    const fuzzy = exact
      ? []
      : await this.prisma.customer.findMany({
          where:
            fuzzyTerms.length > 0
              ? { phoneE164: { contains: fuzzyTerms[0] ?? '' } }
              : normalized
                ? { phoneE164: { contains: normalized.slice(-7) } }
                : { id: '__none__' },
          include: { _count: { select: { activities: true } } },
          take: 10,
        });

    const activities = exact
      ? await this.prisma.inquiryActivity.findMany({
          where: { customerId: exact.id },
          orderBy: { occurredAt: 'desc' },
          take: 20,
          include: { customer: { select: { phoneE164: true } } },
        })
      : [];

    return {
      query: phone,
      normalizedPhone: normalized,
      countryRequired: countryRequired && !exact,
      exactMatch: exact ? this.toCustomerSummary(exact, options.revealPhone) : null,
      fuzzyMatches: fuzzy.map((customer) => this.toCustomerSummary(customer, options.revealPhone)),
      activities: activities.map((activity) => this.toActivity(activity, options.revealPhone)),
    };
  }

  async listCustomers(query: {
    page: number;
    pageSize: number;
    phone?: string;
    countryCode?: string;
    q?: string;
    revealPhone: boolean;
  }) {
    let phoneFilter: string | undefined;
    if (query.phone) {
      try {
        phoneFilter = normalizePhone(query.phone, query.countryCode).e164;
      } catch {
        phoneFilter = undefined;
      }
    }
    const where = {
      ...(phoneFilter ? { phoneE164: { contains: phoneFilter } } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(query.q
        ? {
            OR: [
              { displayName: { contains: query.q, mode: 'insensitive' as const } },
              { phoneE164: { contains: digitsOnly(query.q) || query.q } },
            ],
          }
        : {}),
    };
    const [total, customers] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { activities: true } } },
      }),
    ]);
    return {
      data: customers.map((customer) => this.toCustomerSummary(customer, query.revealPhone)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async createCustomer(input: CreateCustomerInput, actorId: string, requestId: string) {
    const normalized = normalizePhone(input.phone, input.countryCode);
    const existing = await this.prisma.customer.findUnique({ where: { phoneE164: normalized.e164 } });
    if (existing) {
      throw new ApiError(ERROR_CODES.customerPhoneConflict, 'A customer with this phone number already exists.');
    }
    const customer = await this.prisma.customer.create({
      data: {
        phoneE164: normalized.e164,
        countryCode: normalized.countryCode,
        displayName: input.displayName ?? null,
        note: input.note ?? null,
      },
    });
    await this.audit.record({
      actorId,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      requestId,
      metadata: { countryCode: normalized.countryCode },
    });
    return { id: customer.id, phoneE164: customer.phoneE164 };
  }

  /**
   * Records one sales conversation. A customer master record is created on
   * demand, and a concurrent duplicate is resolved by attaching the activity to
   * the existing record instead of losing the operator's input (docs/09 §2).
   */
  async createActivity(
    input: CreateInquiryActivityInput,
    actorId: string,
    requestId: string,
  ) {
    let customerId = input.customerId ?? null;
    let linkedExisting = false;

    if (!customerId) {
      if (!input.phone) {
        throw ApiError.validation('Provide a customer id or a phone number.', {
          phone: 'validation.required',
        });
      }
      const normalized = normalizePhone(input.phone, input.countryCode);
      const existing = await this.prisma.customer.findUnique({ where: { phoneE164: normalized.e164 } });
      if (existing) {
        customerId = existing.id;
        linkedExisting = true;
      } else {
        try {
          const created = await this.prisma.customer.create({
            data: {
              phoneE164: normalized.e164,
              countryCode: normalized.countryCode,
            },
          });
          customerId = created.id;
        } catch {
          // Unique constraint raced with another operator: reuse their record.
          const raced = await this.prisma.customer.findUnique({ where: { phoneE164: normalized.e164 } });
          if (!raced) throw new ApiError(ERROR_CODES.customerPhoneConflict, 'The customer could not be resolved.');
          customerId = raced.id;
          linkedExisting = true;
        }
      }
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.notFound('Customer not found.');

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw ApiError.validation('The conversation time is invalid.', {
        occurredAt: 'validation.datetime.invalid',
      });
    }

    const activity = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.inquiryActivity.create({
        data: {
          customerId: customer.id,
          salespersonUserId: actorId,
          salespersonName: input.salespersonName,
          salespersonPhone: input.salespersonPhone ?? null,
          occurredAt,
          productSkus: input.productSkus,
          note: input.note ?? null,
          source: input.source,
          createdById: actorId,
        },
      });
      await transaction.customer.update({
        where: { id: customer.id },
        data: { lastSeenAt: occurredAt },
      });
      return created;
    });

    await this.audit.record({
      actorId,
      action: 'inquiry_activity.create',
      entityType: 'inquiry_activity',
      entityId: activity.id,
      requestId,
      metadata: { customerId: customer.id, skuCount: input.productSkus.length, linkedExisting },
    });

    return {
      id: activity.id,
      customerId: customer.id,
      linkedExistingCustomer: linkedExisting,
      occurredAt: activity.occurredAt.toISOString(),
    };
  }

  async listActivities(query: {
    page: number;
    pageSize: number;
    customerId?: string;
    from?: string;
    to?: string;
    revealPhone: boolean;
  }) {
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [total, activities] = await this.prisma.$transaction([
      this.prisma.inquiryActivity.count({ where }),
      this.prisma.inquiryActivity.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { customer: { select: { phoneE164: true } } },
      }),
    ]);
    return {
      data: activities.map((activity) => this.toActivity(activity, query.revealPhone)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }
}
