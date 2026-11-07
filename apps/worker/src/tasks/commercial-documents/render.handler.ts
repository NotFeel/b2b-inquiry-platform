import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CODES, commercialDocumentPdfKey, type DocumentRenderJobPayload } from '@b2b/contracts';
import {
  parseTemplateConfig,
  renderCommercialDocumentHtml,
  type CommercialDocumentRenderData,
  type DocumentPartySnapshot,
} from '@b2b/commercial-documents';
import type { Prisma, PrismaClient } from '@b2b/database';
import type { WorkerEnv } from '../../env';
import type { WorkerLogger } from '../../logger';
import type { ObjectStorage } from '../../storage';
import { convertHtmlWithLibreOffice } from './libreoffice-html.runner';
import { validateCommercialPdf } from './pdf-validator';

interface Dependencies {
  prisma: PrismaClient;
  storage: ObjectStorage;
  env: WorkerEnv;
  logger: WorkerLogger;
}

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Renders the frozen CI/PI snapshot to a private PDF. The job is idempotent per
 * `attemptId`; the outbox provides retries and the renderer never reads the
 * live order, only the document snapshot (docs/41 §7.6, §10.10).
 */
export async function processCommercialDocumentRender(
  payload: DocumentRenderJobPayload,
  deps: Dependencies,
): Promise<void> {
  const { prisma, storage, env, logger } = deps;
  const job = await prisma.documentRenderJob.findUnique({ where: { id: payload.jobId } });
  if (!job || job.attemptId !== payload.attemptId) {
    logger.warn('commercial_document.render_attempt_superseded', { jobId: payload.jobId });
    return;
  }
  if (job.status === 'SUCCEEDED' || job.status === 'CANCELLED') return;

  const claimed = await prisma.documentRenderJob.updateMany({
    where: {
      id: job.id,
      attemptId: payload.attemptId,
      status: { in: ['QUEUED', 'FAILED', 'PROCESSING'] },
    },
    data: {
      status: 'PROCESSING',
      startedAt: job.startedAt ?? new Date(),
      errorCode: null,
    },
  });
  if (claimed.count !== 1) return;

  let workspace: string | null = null;
  try {
    const document = await prisma.commercialDocument.findUnique({
      where: { id: job.documentId },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        template: true,
        templateVersion: true,
        order: { select: { orderNo: true, orderDate: true } },
      },
    });
    if (!document) {
      await failJob(job.id, payload.attemptId, ERROR_CODES.commercialDocumentNotFound, deps);
      return;
    }
    const rawConfig = document.templateVersion?.config ?? document.template?.draftConfig;
    if (!rawConfig) {
      await failJob(job.id, payload.attemptId, ERROR_CODES.commercialDocumentTemplateRequired, deps);
      return;
    }
    const config = parseTemplateConfig(rawConfig);
    const data = buildRenderData(document);
    const assets = await loadAssets(document.sellerSnapshot, deps);

    await fs.mkdir(env.WORKER_TMP_DIR, { recursive: true, mode: 0o700 });
    workspace = await fs.mkdtemp(join(env.WORKER_TMP_DIR, `commercial-document-${randomUUID()}-`));
    const inputPath = join(workspace, 'document.html');
    const outputDir = join(workspace, 'output');
    const profileDir = join(workspace, 'libreoffice-profile');
    await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
    await fs.mkdir(profileDir, { recursive: false, mode: 0o700 });
    await fs.writeFile(inputPath, renderCommercialDocumentHtml(config, data, assets), 'utf8');
    const converted = await convertHtmlWithLibreOffice({
      executable: env.EXCEL_PDF_CONVERTER_PATH,
      inputPath,
      outputDir,
      profileDir,
      timeoutMs: env.COMMERCIAL_DOCUMENT_RENDER_TIMEOUT_MS,
    });
    const validation = await validateCommercialPdf({
      path: converted.outputPath,
      pdfInfoPath: env.EXCEL_PDF_PDFINFO_PATH,
      maxBytes: env.COMMERCIAL_DOCUMENT_PDF_MAX_BYTES,
      maxPages: env.COMMERCIAL_DOCUMENT_PDF_MAX_PAGES,
    });
    const buffer = await fs.readFile(converted.outputPath);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storageKey = commercialDocumentPdfKey(
      document.id,
      document.revisionNo,
      payload.attemptId,
    );
    await storage.put(storageKey, buffer, 'application/pdf');

    await prisma.$transaction([
      prisma.documentRenderJob.update({
        where: { id: job.id, attemptId: payload.attemptId },
        data: {
          status: 'SUCCEEDED',
          fileKey: storageKey,
          sha256,
          sizeBytes: BigInt(validation.sizeBytes),
          completedAt: new Date(),
          errorCode: null,
        },
      }),
      prisma.commercialDocument.update({
        where: { id: document.id },
        data: {
          pdfFileKey: storageKey,
          pdfSha256: sha256,
          pdfSizeBytes: BigInt(validation.sizeBytes),
          generatedAt: new Date(),
        },
      }),
    ]);
    logger.info('commercial_document.rendered', {
      jobId: job.id,
      documentId: document.id,
      documentType: document.documentType,
      pages: validation.pageCount,
      sizeBytes: validation.sizeBytes,
      durationMs: converted.durationMs,
    });
  } catch (error) {
    const code = errorCodeOf(error);
    await failJob(job.id, payload.attemptId, code, deps);
    logger.error('commercial_document.render_failed', {
      jobId: job.id,
      errorCode: code,
    });
    throw error;
  } finally {
    if (workspace) await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function failJob(
  jobId: string,
  attemptId: string,
  errorCode: string,
  deps: Dependencies,
): Promise<void> {
  await deps.prisma.documentRenderJob.updateMany({
    where: { id: jobId, attemptId, status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] } },
    data: { status: 'FAILED', errorCode, completedAt: new Date() },
  });
}

function errorCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z0-9_]+$/.test(message) ? message : ERROR_CODES.commercialDocumentRenderFailed;
}

function buildRenderData(document: {
  documentType: 'PI' | 'CI';
  documentNo: string;
  revisionNo: number;
  status: string;
  locale: string;
  currency: string;
  issueDate: Date | null;
  validUntil: Date | null;
  sellerSnapshot: Prisma.JsonValue;
  buyerSnapshot: Prisma.JsonValue;
  consigneeSnapshot: Prisma.JsonValue | null;
  notifyPartySnapshot: Prisma.JsonValue | null;
  tradeSnapshot: Prisma.JsonValue | null;
  shippingSnapshot: Prisma.JsonValue | null;
  paymentSnapshot: Prisma.JsonValue | null;
  declarationSnapshot: Prisma.JsonValue | null;
  signatureSnapshot: Prisma.JsonValue | null;
  notes: string | null;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  insuranceAmount: Prisma.Decimal;
  otherCharges: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  order: { orderNo: string; orderDate: Date } | null;
  items: Array<{
    lineNo: number;
    skuSnapshot: string;
    descriptionSnapshot: string | null;
    hsCodeSnapshot: string | null;
    originCountrySnapshot: string | null;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    lineAmount: Prisma.Decimal;
    cartons: number | null;
    netWeightKg: Prisma.Decimal | null;
    grossWeightKg: Prisma.Decimal | null;
    cbm: Prisma.Decimal | null;
  }>;
}): CommercialDocumentRenderData {
  const trade = (document.tradeSnapshot as Record<string, unknown> | null) ?? {};
  return {
    documentType: document.documentType,
    documentNo: document.documentNo,
    revisionNo: document.revisionNo,
    status: document.status,
    locale: document.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
    currency: document.currency,
    issueDate: document.issueDate?.toISOString().slice(0, 10) ?? null,
    validUntil: document.validUntil?.toISOString().slice(0, 10) ?? null,
    orderNo: document.order?.orderNo ?? null,
    orderDate: document.order?.orderDate.toISOString().slice(0, 10) ?? null,
    contractNo: (trade.contractNo as string | null | undefined) ?? null,
    buyerReference: (trade.buyerReference as string | null | undefined) ?? null,
    exchangeRateText: (trade.exchangeRateText as string | null | undefined) ?? null,
    seller: document.sellerSnapshot as unknown as DocumentPartySnapshot,
    buyer: document.buyerSnapshot as unknown as DocumentPartySnapshot,
    consignee: document.consigneeSnapshot as unknown as DocumentPartySnapshot | null,
    notifyParty: document.notifyPartySnapshot as unknown as DocumentPartySnapshot | null,
    trade,
    shipping: (document.shippingSnapshot as Record<string, unknown> | null) ?? {},
    payment: document.paymentSnapshot as Record<string, unknown> | null,
    declaration: (document.declarationSnapshot as Record<string, unknown> | null) ?? {},
    signature: (document.signatureSnapshot as Record<string, unknown> | null) ?? {},
    notes: document.notes,
    items: document.items.map((item) => ({
      lineNo: item.lineNo,
      sku: item.skuSnapshot,
      description: item.descriptionSnapshot,
      hsCode: item.hsCodeSnapshot,
      originCountryCode: item.originCountrySnapshot,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice.toString(),
      cartons: item.cartons,
      netWeightKg: item.netWeightKg?.toString() ?? null,
      grossWeightKg: item.grossWeightKg?.toString() ?? null,
      cbm: item.cbm?.toString() ?? null,
      lineAmount: item.lineAmount.toString(),
    })),
    totals: {
      subtotal: document.subtotal.toString(),
      discountAmount: document.discountAmount.toString(),
      freightAmount: document.freightAmount.toString(),
      insuranceAmount: document.insuranceAmount.toString(),
      otherCharges: document.otherCharges.toString(),
      totalAmount: document.totalAmount.toString(),
    },
  };
}

async function loadAssets(
  sellerSnapshot: Prisma.JsonValue,
  deps: Dependencies,
): Promise<{ logoDataUri: string | null; stampDataUri: string | null }> {
  const seller = (sellerSnapshot as Record<string, unknown> | null) ?? {};
  return {
    logoDataUri: await loadAssetDataUri(seller.logoAssetId, deps),
    stampDataUri: await loadAssetDataUri(seller.stampAssetId, deps),
  };
}

async function loadAssetDataUri(assetId: unknown, deps: Dependencies): Promise<string | null> {
  if (typeof assetId !== 'string' || assetId.length === 0) return null;
  const asset = await deps.prisma.fileAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== 'ready') return null;
  const size = Number(asset.sizeBytes);
  if (size <= 0 || size > MAX_ASSET_BYTES) return null;
  const extension = asset.storageKey.split('.').pop()?.toLowerCase() ?? '';
  const mime = ASSET_MIME[extension];
  if (!mime) return null;
  try {
    const buffer = await deps.storage.get(asset.storageKey);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}
