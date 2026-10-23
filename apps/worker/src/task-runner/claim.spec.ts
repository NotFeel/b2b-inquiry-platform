import type { PrismaClient } from '@b2b/database';
import { describe, expect, it, vi } from 'vitest';
import { claimNextTask } from './claim';

const options = {
  workerId: 'worker-test',
  maxAttempts: 3,
  leaseSeconds: 120,
  pollIntervalMs: 1_000,
  retryBaseDelayMs: 1_000,
};

function prismaWithClaims(
  rows: unknown[][],
  attempts = 1,
): { prisma: PrismaClient; unsafe: ReturnType<typeof vi.fn>; raw: ReturnType<typeof vi.fn> } {
  const raw = vi.fn(async () => rows.shift() ?? []);
  const unsafe = vi.fn(async () => [{ attempts }]);
  const transaction = { $queryRaw: raw, $queryRawUnsafe: unsafe };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  return { prisma, unsafe, raw };
}

describe('PostgreSQL task claim', () => {
  it('claims persisted quote work after higher-priority file work is empty', async () => {
    const { prisma, unsafe } = prismaWithClaims([
      [],
      [
        {
          id: '22222222-2222-4222-8222-222222222222',
          templateId: '33333333-3333-4333-8333-333333333333',
          templateVersion: 2,
          filterSnapshot: { locale: 'en-US', categoryId: null, includeDescendants: true },
          attempts: 0,
        },
      ],
    ]);

    const task = await claimNextTask(prisma, options);
    expect(task).toMatchObject({
      source: 'quote_export',
      id: '22222222-2222-4222-8222-222222222222',
      attempts: 1,
      payload: {
        jobId: '22222222-2222-4222-8222-222222222222',
        templateId: '33333333-3333-4333-8333-333333333333',
        templateVersion: 2,
        locale: 'en-US',
      },
    });
    expect(unsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "quote_export_jobs"'),
      'worker-test',
      expect.any(Date),
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('claims image derivative outbox events with their structured payload', async () => {
    const { prisma } = prismaWithClaims([
      [],
      [],
      [
        {
          id: '44444444-4444-4444-8444-444444444444',
          eventType: 'image-derivatives',
          payload: {
            fileAssetId: '55555555-5555-4555-8555-555555555555',
            storageKey: 'product-image/2026/10/source.png',
            widths: [320, 640],
          },
          attempts: 0,
        },
      ],
    ]);

    const task = await claimNextTask(prisma, options);
    expect(task).toMatchObject({
      source: 'outbox',
      eventType: 'image-derivatives',
      attempts: 1,
      payload: {
        fileAssetId: '55555555-5555-4555-8555-555555555555',
        widths: [320, 640],
      },
    });
  });
});
