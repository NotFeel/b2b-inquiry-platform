import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type { CreatePiDocumentInput, UpdatePiDocumentInput } from '@b2b/validation';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/services/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { calculatePiTotals, currencyScale } from './pi-calculator';

// Statuses that may still be edited directly. Once a PI is issued its content is
// frozen and any change produces a new revision (docs/08 §5.3).
const EDITABLE_STATUSES = new Set(['draft', 'review']);

@Injectable()
export class PiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { page: number; pageSize: number; status?: string; q?: string }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { piNo: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const [total, documents] = await this.prisma.$transaction([
      this.prisma.piDocument.count({ where }),
      this.prisma.piDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: documents.map((document) => ({
        id: document.id,
        piNo: document.piNo,
        revisionNo: document.revisionNo,
        status: document.status,
        currency: document.currency,
        issuedAt: document.issuedAt?.toISOString() ?? null,
        validUntil: document.validUntil?.toISOString() ?? null,
        buyer: (document.buyerSnapshot as Record<string, unknown>) ?? {},
        seller: (document.sellerSnapshot as Record<string, unknown>) ?? {},
        terms: (document.termsSnapshot as Record<string, unknown> | null) ?? null,
        subtotal: document.subtotal.toString(),
        discountAmount: document.discountAmount.toString(),
        freightAmount: document.freightAmount.toString(),
        insuranceAmount: document.insuranceAmount.toString(),
        otherCharges: document.otherCharges.toString(),
        totalAmount: document.totalAmount.toString(),
        notes: document.notes,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: string) {
    const document = await this.prisma.piDocument.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!document) throw ApiError.notFound('PI document not found.');
    return {
      id: document.id,
      piNo: document.piNo,
      revisionNo: document.revisionNo,
      status: document.status,
      currency: document.currency,
      issuedAt: document.issuedAt?.toISOString() ?? null,
      validUntil: document.validUntil?.toISOString() ?? null,
      buyer: document.buyerSnapshot,
      seller: document.sellerSnapshot,
      terms: document.termsSnapshot,
      pricingPolicy: document.pricingPolicy,
      subtotal: document.subtotal.toString(),
      discountAmount: document.discountAmount.toString(),
      freightAmount: document.freightAmount.toString(),
      insuranceAmount: document.insuranceAmount.toString(),
      otherCharges: document.otherCharges.toString(),
      totalAmount: document.totalAmount.toString(),
      notes: document.notes,
      items: document.items.map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        sku: item.sku,
        productName: item.productNameSnapshot,
        description: item.descriptionSnapshot,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        discountAmount: item.discountAmount.toString(),
        lineAmount: item.lineAmount.toString(),
        packaging: (item.packagingSnapshot as Record<string, unknown> | null) ?? null,
      })),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  async create(input: CreatePiDocumentInput, actorId: string, requestId: string) {
    const currency = input.currency.toUpperCase();
    const totals = calculatePiTotals({
      currency,
      lines: input.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
      })),
      discountAmount: input.discountAmount,
      freightAmount: input.freightAmount,
      insuranceAmount: input.insuranceAmount,
      otherCharges: input.otherCharges,
    });

    const piNo = input.piNo ?? (await this.generatePiNo());
    const existing = await this.prisma.piDocument.findFirst({ where: { piNo } });
    if (existing) throw new ApiError(ERROR_CODES.conflict, 'This PI number already exists.');

    const document = await this.prisma.piDocument.create({
      data: {
        piNo,
        revisionNo: 1,
        status: 'draft',
        currency,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        sellerSnapshot: input.seller as never,
        buyerSnapshot: input.buyer as never,
        termsSnapshot: (input.terms ?? undefined) as never,
        pricingPolicy: {
          scale: currencyScale(currency),
          rounding: 'HALF_UP',
          computedBy: 'server',
        } as never,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        freightAmount: totals.freightAmount,
        insuranceAmount: totals.insuranceAmount,
        otherCharges: totals.otherCharges,
        totalAmount: totals.totalAmount,
        notes: input.notes ?? null,
        createdById: actorId,
        items: {
          create: input.items.map((item, index) => ({
            lineNo: item.lineNo ?? index + 1,
            sku: item.sku,
            productNameSnapshot: item.productName,
            descriptionSnapshot: item.description ?? null,
            quantity: totals.lines[index]?.quantity ?? item.quantity,
            unit: item.unit,
            unitPrice: totals.lines[index]?.unitPrice ?? item.unitPrice,
            discountAmount: totals.lines[index]?.discountAmount ?? '0',
            lineAmount: totals.lines[index]?.lineAmount ?? '0',
            packagingSnapshot: (item.packaging ?? undefined) as never,
            currency,
          })),
        },
      },
    });

    await this.audit.record({
      actorId,
      action: 'pi.create',
      entityType: 'pi_document',
      entityId: document.id,
      requestId,
      metadata: { piNo: document.piNo, currency, totalAmount: totals.totalAmount },
    });
    return { id: document.id, piNo: document.piNo, totalAmount: totals.totalAmount };
  }

  async update(id: string, input: UpdatePiDocumentInput, actorId: string, requestId: string) {
    const document = await this.prisma.piDocument.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!document) throw ApiError.notFound('PI document not found.');
    if (!EDITABLE_STATUSES.has(document.status)) {
      throw new ApiError(
        ERROR_CODES.piRevisionRequired,
        'An issued PI cannot be modified. Create a revision instead.',
      );
    }

    const currency = (input.currency ?? document.currency).toUpperCase();
    const lines = input.items
      ? input.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
        }))
      : document.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          discountAmount: item.discountAmount.toString(),
        }));

    const totals = calculatePiTotals({
      currency,
      lines,
      discountAmount: input.discountAmount ?? document.discountAmount.toString(),
      freightAmount: input.freightAmount ?? document.freightAmount.toString(),
      insuranceAmount: input.insuranceAmount ?? document.insuranceAmount.toString(),
      otherCharges: input.otherCharges ?? document.otherCharges.toString(),
    });

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (input.items) {
        await transaction.piItem.deleteMany({ where: { piDocumentId: id } });
        await transaction.piItem.createMany({
          data: input.items.map((item, index) => ({
            piDocumentId: id,
            lineNo: item.lineNo ?? index + 1,
            sku: item.sku,
            productNameSnapshot: item.productName,
            descriptionSnapshot: item.description ?? null,
            quantity: totals.lines[index]?.quantity ?? item.quantity,
            unit: item.unit,
            unitPrice: totals.lines[index]?.unitPrice ?? item.unitPrice,
            discountAmount: totals.lines[index]?.discountAmount ?? '0',
            lineAmount: totals.lines[index]?.lineAmount ?? '0',
            packagingSnapshot: (item.packaging ?? undefined) as never,
            currency,
          })),
        });
      }
      return transaction.piDocument.update({
        where: { id },
        data: {
          currency,
          ...(input.validUntil !== undefined
            ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
            : {}),
          ...(input.issuedAt !== undefined
            ? { issuedAt: input.issuedAt ? new Date(input.issuedAt) : null }
            : {}),
          ...(input.seller ? { sellerSnapshot: input.seller as never } : {}),
          ...(input.buyer ? { buyerSnapshot: input.buyer as never } : {}),
          ...(input.terms ? { termsSnapshot: input.terms as never } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          freightAmount: totals.freightAmount,
          insuranceAmount: totals.insuranceAmount,
          otherCharges: totals.otherCharges,
          totalAmount: totals.totalAmount,
        },
      });
    });

    await this.audit.record({
      actorId,
      action: 'pi.update',
      entityType: 'pi_document',
      entityId: id,
      requestId,
      metadata: { totalAmount: totals.totalAmount, lines: input.items ? 'replaced' : 'unchanged' },
    });
    return { id: updated.id, totalAmount: updated.totalAmount.toString() };
  }

  async setStatus(id: string, status: string, actorId: string, requestId: string) {
    const document = await this.prisma.piDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('PI document not found.');

    const allowed: Record<string, string[]> = {
      draft: ['review', 'cancelled'],
      review: ['draft', 'issued', 'cancelled'],
      issued: ['superseded', 'cancelled'],
      superseded: [],
      cancelled: [],
    };
    if (!(allowed[document.status] ?? []).includes(status)) {
      throw new ApiError(
        ERROR_CODES.piNotEditable,
        `A PI in status "${document.status}" cannot move to "${status}".`,
      );
    }

    const updated = await this.prisma.piDocument.update({
      where: { id },
      data: {
        status,
        ...(status === 'issued' && !document.issuedAt ? { issuedAt: new Date() } : {}),
      },
    });
    await this.audit.record({
      actorId,
      action: `pi.status.${status}`,
      entityType: 'pi_document',
      entityId: id,
      requestId,
      metadata: { from: document.status, to: status },
    });
    return { id: updated.id, status: updated.status };
  }

  /** Creates a new revision from an issued document without touching the original. */
  async createRevision(id: string, actorId: string, requestId: string) {
    const source = await this.prisma.piDocument.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
    if (!source) throw ApiError.notFound('PI document not found.');
    const nextRevision = source.revisionNo + 1;
    const sourceId = source.id;

    const revision = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.piDocument.create({
        data: {
          piNo: source.piNo,
          revisionNo: nextRevision,
          status: 'draft',
          currency: source.currency,
          validUntil: source.validUntil,
          sellerSnapshot: source.sellerSnapshot as never,
          buyerSnapshot: source.buyerSnapshot as never,
          termsSnapshot: (source.termsSnapshot ?? undefined) as never,
          pricingPolicy: (source.pricingPolicy ?? undefined) as never,
          subtotal: source.subtotal,
          discountAmount: source.discountAmount,
          freightAmount: source.freightAmount,
          insuranceAmount: source.insuranceAmount,
          otherCharges: source.otherCharges,
          totalAmount: source.totalAmount,
          notes: source.notes,
          supersedesId: sourceId,
          createdById: actorId,
          items: {
            create: source.items.map((item) => ({
              lineNo: item.lineNo,
              sku: item.sku,
              productNameSnapshot: item.productNameSnapshot,
              descriptionSnapshot: item.descriptionSnapshot,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              lineAmount: item.lineAmount,
              packagingSnapshot: (item.packagingSnapshot ?? undefined) as never,
              currency: item.currency,
            })),
          },
        },
      });
      await transaction.piDocument.update({
        where: { id: sourceId },
        data: { status: 'superseded' },
      });
      return created;
    });

    await this.audit.record({
      actorId,
      action: 'pi.revision.create',
      entityType: 'pi_document',
      entityId: revision.id,
      requestId,
      metadata: { piNo: revision.piNo, revisionNo: revision.revisionNo, supersedes: sourceId },
    });
    return { id: revision.id, revisionNo: revision.revisionNo };
  }

  /**
   * Queues an Excel render of the PI. Rendering happens in the worker so no
   * request thread blocks on spreadsheet generation (docs/08 §1).
   */
  async requestExport(id: string, templateId: string | null, actorId: string, requestId: string) {
    const document = await this.prisma.piDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('PI document not found.');

    const template = templateId
      ? await this.prisma.quoteTemplate.findUnique({ where: { id: templateId } })
      : await this.prisma.quoteTemplate.findFirst({
          where: { templateType: 'pi', status: 'active' },
          orderBy: { version: 'desc' },
        });
    if (!template) {
      throw new ApiError(
        ERROR_CODES.quoteTemplateInvalid,
        'No active PI template is configured. Upload a PI template first.',
      );
    }

    const job = await this.prisma.quoteExportJob.create({
      data: {
        templateId: template.id,
        templateVersion: template.version,
        requestedById: actorId,
        filterSnapshot: { piDocumentId: id, piNo: document.piNo } as never,
        productCount: 1,
        status: 'QUEUED',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await this.audit.record({
      actorId,
      action: 'pi.export',
      entityType: 'pi_document',
      entityId: id,
      requestId,
      metadata: { jobId: job.id, templateId: template.id, templateVersion: template.version },
    });
    return { jobId: job.id };
  }

  private async generatePiNo(): Promise<string> {
    const date = new Date();
    const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = Math.floor(Math.random() * 9000 + 1000);
      const candidate = `PI-${stamp}-${suffix}`;
      const existing = await this.prisma.piDocument.findFirst({ where: { piNo: candidate } });
      if (!existing) return candidate;
    }
    throw new ApiError(
      ERROR_CODES.conflict,
      'Could not allocate a unique PI number. Please retry.',
    );
  }
}
