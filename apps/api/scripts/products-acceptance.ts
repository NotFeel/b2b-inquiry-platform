/**
 * Product management acceptance run (docs/24 §11).
 *
 * Drives the real API, the real database and the real object storage:
 * CRUD with bilingual fields, category/tag validation, the gallery (upload,
 * cover, order, alt text), publishing rules, the storefront projection with a
 * price-leak scan, per-endpoint RBAC, and - the point of the whole exercise -
 * the permanent delete, which is only accepted once the file is verifiably gone
 * from storage.
 *
 * Usage (API + DB + Redis + worker running locally):
 *   QA_ADMIN_USERNAME=<super admin> QA_ADMIN_PASSWORD=<password> \
 *   pnpm --filter @b2b/api run acceptance:products
 *
 * Optional: QA_STORAGE_ROOT (defaults to STORAGE_LOCAL_ROOT) points at the
 * directory the local storage driver writes into, so the script can prove the
 * object is really gone instead of trusting the API's answer.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3002';
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const ADMIN_USERNAME = process.env.QA_ADMIN_USERNAME ?? '';
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD ?? '';
const VIEWER_USERNAME = 'qa.product.viewer';
const VIEWER_PASSWORD = 'QaProductViewer!2026';
const ADMIN_FINAL_PASSWORD = process.env.QA_ADMIN_PASSWORD_FINAL ?? `${ADMIN_PASSWORD}Qa1!`;
const STORAGE_ROOT = process.env.QA_STORAGE_ROOT ?? process.env.STORAGE_LOCAL_ROOT ?? './.data/uploads';

let failures = 0;
let checks = 0;
let adminCookie = '';

function record(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

function expectEq(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(
    name,
    ok,
    ok ? `= ${JSON.stringify(actual)}` : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

interface ApiResponse<T> {
  status: number;
  body: T & { error?: { code?: string; details?: Record<string, unknown> } };
  setCookie: string | null;
}

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { body?: unknown; session?: string; anonymous?: boolean } = {},
): Promise<ApiResponse<T>> {
  const session = options.anonymous ? '' : (options.session ?? adminCookie);
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length > 0 ? JSON.parse(text) : {}) as T & {
      error?: { code?: string; details?: Record<string, unknown> };
    },
    setCookie: response.headers.get('set-cookie'),
  };
}

const codeOf = (response: ApiResponse<unknown>): string | undefined => response.body.error?.code;

// ------------------------------------------------------------------ fixtures

// A real PNG: proper signature, IHDR, zlib-compressed scanlines and CRCs, so
// both the API's header parser and the worker's image pipeline accept it.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolour
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw.writeUInt8(0, rowStart);
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw.writeUInt8((rgb[0] + x) % 256, offset);
      raw.writeUInt8((rgb[1] + y) % 256, offset + 1);
      raw.writeUInt8(rgb[2], offset + 2);
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadImage(
  buffer: Buffer,
  fileName: string,
  contentType = 'image/png',
): Promise<ApiResponse<{ data: { fileAssetId: string; storageKey: string; url: string } }>> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), fileName);
  const response = await fetch(`${API}/admin/media/staging`, {
    method: 'POST',
    headers: adminCookie ? { cookie: adminCookie } : undefined,
    body: form,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text.length > 0 ? JSON.parse(text) : {}) as never,
    setCookie: null,
  };
}

function storagePath(storageKey: string): string {
  const root = isAbsolute(STORAGE_ROOT) ? STORAGE_ROOT : resolve(process.cwd(), '..', '..', STORAGE_ROOT);
  return join(root, storageKey);
}

/** Responsive variants follow `<key without extension>__w<width>.webp`. */
function derivativePath(storageKey: string, width: number): string {
  return storagePath(`${storageKey.replace(/\.[a-z0-9]+$/i, '')}__w${width}.webp`);
}

async function publicFileExists(storageKey: string): Promise<boolean> {
  const response = await fetch(`${API}/files/${storageKey}`, { method: 'GET' });
  return response.status === 200;
}

/** Recursively collects every object key, to prove no price field leaks out. */
function collectKeys(value: unknown, path = '', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeys(item, `${path}[${index}]`, found));
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      found.push(key.toLowerCase());
      collectKeys(child, `${path}.${key}`, found);
    }
  }
  return found;
}

async function pollOperation(operationId: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'UNKNOWN';
  while (Date.now() < deadline) {
    const response = await call<{ data: { status: string } }>(
      'GET',
      `/admin/file-operations/${operationId}`,
    );
    last = response.body.data?.status ?? 'UNKNOWN';
    if (last === 'SUCCEEDED' || last === 'FAILED') return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  return last;
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('Set QA_ADMIN_USERNAME and QA_ADMIN_PASSWORD to a super administrator.');
  }
  const stamp = Date.now().toString(36).slice(-5);

  // The password may already have been rotated by an earlier run of this run.
  let login = await call('POST', '/admin/auth/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    anonymous: true,
  });
  if (login.status === 401) {
    login = await call('POST', '/admin/auth/login', {
      body: { username: ADMIN_USERNAME, password: ADMIN_FINAL_PASSWORD },
      anonymous: true,
    });
  }
  expectEq('auth.login', login.status, 201);
  adminCookie = login.setCookie?.split(';')[0] ?? '';
  record('auth.sessionCookie', adminCookie.length > 0);

  // A freshly bootstrapped administrator must rotate its password before the
  // back office is reachable; do that once and continue with the new secret.
  // The login response is `{ user, expiresAt }` (not wrapped in `data`).
  const signedIn = login.body as { user?: { mustChangePassword?: boolean } };
  if (signedIn?.user?.mustChangePassword) {
    const rotated = await call('POST', '/admin/auth/change-password', {
      body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_FINAL_PASSWORD },
    });
    record('auth.passwordRotated', rotated.status === 200 || rotated.status === 201, `status=${rotated.status}`);
    const relogin = await call('POST', '/admin/auth/login', {
      body: { username: ADMIN_USERNAME, password: ADMIN_FINAL_PASSWORD },
      anonymous: true,
    });
    adminCookie = relogin.setCookie?.split(';')[0] ?? adminCookie;
    record('auth.reloginAfterRotation', relogin.status === 201);
  }

  // ------------------------------------------------------- category fixture
  const tree = await call<{ data: { id: string; name: string; enabled: boolean }[] }>(
    'GET',
    '/admin/categories/tree?locale=en-US',
  );
  let categoryId = tree.body.data?.[0]?.id;
  if (!categoryId) {
    const created = await call<{ data: { id: string } }>('POST', '/admin/categories', {
      body: {
        code: `qa-products-${stamp}`,
        slug: `qa-products-${stamp}`,
        parentId: null,
        sortOrder: 0,
        enabled: true,
        visible: true,
        translations: [
          { locale: 'en-US', name: `QA products ${stamp}`, description: null },
          { locale: 'zh-CN', name: `QA 商品 ${stamp}`, description: null },
        ],
      },
    });
    categoryId = created.body.data?.id;
  }
  record('category.availableForProduct', Boolean(categoryId), `id=${categoryId}`);

  // ------------------------------------------------------------ create rules
  const sku = `QA-PROD-${stamp}`;
  const slug = `qa-prod-${stamp}`;
  const basePayload = {
    sku,
    slug,
    categoryId,
    priceCny: '123.45',
    publishStatus: 'draft',
    lifecycleStatus: 'available',
    isNew: true,
    isFeatured: false,
    sortOrder: 0,
    lengthMm: 1800,
    widthMm: 60,
    heightMm: 2000,
    weightGrams: 45000,
    packaging: 'Plywood crate',
    cartonLengthCm: 210,
    cartonWidthCm: 80,
    cartonHeightCm: 120,
    cartonWeightKg: '52.5',
    cartonQuantity: 4,
    tagIds: [],
    translations: [
      { locale: 'en-US', name: `QA steel gate ${stamp}`, description: 'Powder coated steel gate.' },
      { locale: 'zh-CN', name: `QA 钢制大门 ${stamp}`, description: '粉末喷涂。' },
    ],
  };

  const created = await call<{ data: { id: string } }>('POST', '/admin/products', {
    body: basePayload,
  });
  expectEq('create.status', created.status, 201);
  const productId = created.body.data?.id;
  record('create.returnsId', Boolean(productId), `id=${productId}`);

  expectEq(
    'create.duplicateSkuRejected',
    codeOf(await call('POST', '/admin/products', { body: { ...basePayload, slug: `${slug}-2` } })),
    'PRODUCT_SKU_CONFLICT',
  );
  expectEq(
    'create.duplicateSlugRejected',
    codeOf(await call('POST', '/admin/products', { body: { ...basePayload, sku: `${sku}-2` } })),
    'PRODUCT_SLUG_CONFLICT',
  );
  expectEq(
    'create.unknownCategoryRejected',
    (
      await call('POST', '/admin/products', {
        body: { ...basePayload, sku: `${sku}-3`, slug: `${slug}-3`, categoryId: '00000000-0000-0000-0000-000000000000' },
      })
    ).status,
    400,
  );
  expectEq(
    'create.requiresEnglishTranslation',
    (
      await call('POST', '/admin/products', {
        body: {
          ...basePayload,
          sku: `${sku}-4`,
          slug: `${slug}-4`,
          translations: [{ locale: 'zh-CN', name: '仅中文' }],
        },
      })
    ).status,
    400,
  );
  expectEq(
    'create.rejectsNegativeDimension',
    (
      await call('POST', '/admin/products', {
        body: { ...basePayload, sku: `${sku}-5`, slug: `${slug}-5`, lengthMm: -5 },
      })
    ).status,
    400,
  );

  // --------------------------------------------------------- publish demands a usable image
  expectEq(
    'publish.withoutImageRejected',
    codeOf(await call('POST', `/admin/products/${productId}/publish`, { body: { publishStatus: 'published' } })),
    'PRODUCT_PUBLISH_REQUIRES_IMAGE',
  );

  // --------------------------------------------------------------- gallery
  const imageBuffers = [
    makePng(600, 400, [200, 40, 40]),
    makePng(640, 480, [40, 160, 90]),
    makePng(800, 600, [50, 80, 200]),
  ];
  const staged: { fileAssetId: string; storageKey: string }[] = [];
  for (const [index, buffer] of imageBuffers.entries()) {
    const uploaded = await uploadImage(buffer, `qa-${stamp}-${index}.png`);
    expectEq(`upload.status#${index}`, uploaded.status, 201);
    if (uploaded.body.data) staged.push(uploaded.body.data);
  }
  expectEq('upload.stagedCount', staged.length, 3);

  // A fake image with a PNG name must be refused by the signature check.
  const fake = await uploadImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'fake.png', 'image/png');
  expectEq('upload.rejectsForgedSignature', fake.status, 400);
  expectEq('upload.forgedSignatureCode', codeOf(fake), 'UPLOAD_SIGNATURE_MISMATCH');

  const attached = await call<{ data: { images: { id: string; isCover: boolean }[]; coverImageId: string } }>(
    'POST',
    `/admin/products/${productId}/images`,
    { body: { assets: staged.map((asset) => ({ fileAssetId: asset.fileAssetId })) } },
  );
  expectEq('gallery.attachStatus', attached.status, 201);
  const imageIds = (attached.body.data?.images ?? []).map((image) => image.id);
  expectEq('gallery.attachedThree', imageIds.length, 3);
  record('gallery.autoCoverAssigned', Boolean(attached.body.data?.coverImageId));

  const reversed = await call<{ data: { images: { id: string; sortOrder: number }[] } }>(
    'PATCH',
    `/admin/products/${productId}/images/order`,
    { body: { imageIds: [...imageIds].reverse() } },
  );
  expectEq('gallery.reorderStatus', reversed.status, 200);
  expectEq(
    'gallery.reorderApplied',
    (reversed.body.data?.images ?? [])
      .filter((image) => imageIds.includes(image.id))
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((image) => image.id),
    [...imageIds].reverse(),
  );

  const secondId = imageIds[1] as string;
  expectEq(
    'gallery.coverChangeStatus',
    (await call('PUT', `/admin/products/${productId}/images/${secondId}/cover`)).status,
    200,
  );
  const afterCover = await call<{ data: { images: { id: string; isCover: boolean }[]; coverImageId: string } }>(
    'GET',
    `/admin/products/${productId}`,
  );
  expectEq('gallery.singleCover', afterCover.body.data?.coverImageId, secondId);
  expectEq(
    'gallery.onlyOneCoverFlag',
    (afterCover.body.data?.images ?? []).filter((image) => image.isCover).length,
    1,
  );

  expectEq(
    'gallery.altTextStatus',
    (
      await call('PATCH', `/admin/products/${productId}/images/${secondId}`, {
        body: { altText: 'QA powder coated gate' },
      })
    ).status,
    200,
  );
  expectEq(
    'gallery.foreignImageRejected',
    (
      await call('PATCH', `/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`, {
        body: { altText: 'x' },
      })
    ).status,
    404,
  );

  // A staged asset already used by this gallery cannot be reused by another
  // product: sharing the object would make a per-product delete unsafe.
  const otherProduct = await call<{ data: { id: string } }>('POST', '/admin/products', {
    body: { ...basePayload, sku: `${sku}-SHARE`, slug: `${slug}-share` },
  });
  const sharedAttempt = await call('POST', `/admin/products/${otherProduct.body.data?.id}/images`, {
    body: { assets: [{ fileAssetId: staged[0]?.fileAssetId }] },
  });
  expectEq('gallery.sharedAssetRejected', codeOf(sharedAttempt), 'ASSET_IN_USE');

  // ------------------------------------------------------------- publishing
  const published = await call('POST', `/admin/products/${productId}/publish`, {
    body: { publishStatus: 'published' },
  });
  expectEq('publish.status', published.status, 201);

  const publicDetail = await call<{ data: Record<string, unknown> }>(
    'GET',
    `/public/products/${slug}`,
    { anonymous: true },
  );
  expectEq('public.detailStatus', publicDetail.status, 200);
  const publicKeys = collectKeys(publicDetail.body);
  record(
    'public.noPriceKeyLeaked',
    !publicKeys.some((key) => key.includes('price') || key.includes('cost')),
    publicKeys.filter((key) => key.includes('price') || key.includes('cost')).join(','),
  );
  record(
    'public.noStorageKeyLeaked',
    !publicKeys.some((key) => key.includes('storagekey')),
  );
  const publicImages = (publicDetail.body.data?.images ?? []) as { url: string }[];
  expectEq('public.imagesVisible', publicImages.length, 3);
  expectEq(
    'public.firstImageIsCover',
    (publicDetail.body.data?.images as { isCover: boolean }[] | undefined)?.[0]?.isCover,
    true,
  );

  // ------------------------------------------------- home pre-order curation
  // Curation is a tag now (`preorder`), not a legacy boolean. The tag drives
  // the home rail and still requires the pre-order lifecycle to take effect.
  const tagOptions = await call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/tags/options?locale=en-US',
  );
  const preorderTagId = (tagOptions.body.data ?? []).find((tag) => tag.code === 'preorder')?.id;
  record('preOrder.tagAvailable', Boolean(preorderTagId));
  expectEq(
    'preOrder.lifecycleAndTagSetToPreorder',
    (
      await call('PATCH', `/admin/products/${productId}`, {
        body: { lifecycleStatus: 'preorder', tagIds: preorderTagId ? [preorderTagId] : [] },
      })
    ).status,
    200,
  );
  const homeRail = await call<{ data: { slug: string }[] }>(
    'GET',
    '/public/products?isPreOrder=true&pageSize=50',
    { anonymous: true },
  );
  record(
    'preOrder.appearsInHomeRail',
    (homeRail.body.data ?? []).some((row) => row.slug === slug),
  );
  expectEq(
    'preOrder.railClearedAfterLifecycleChange',
    (
      await call('PATCH', `/admin/products/${productId}`, {
        body: { lifecycleStatus: 'available' },
      })
    ).status,
    200,
  );
  const afterLifecycle = await call<{ data: { isPreOrder: boolean; lifecycleStatus: string } }>(
    'GET',
    `/admin/products/${productId}`,
  );
  expectEq('preOrder.clearedWithLifecycle', afterLifecycle.body.data?.isPreOrder, false);
  const homeRailAfter = await call<{ data: { slug: string }[] }>(
    'GET',
    '/public/products?isPreOrder=true&pageSize=50',
    { anonymous: true },
  );
  record(
    'preOrder.removedFromHomeRail',
    !(homeRailAfter.body.data ?? []).some((row) => row.slug === slug),
  );

  const storefrontHtml = await fetch(`${APP_BASE_URL}/en-US/products/${slug}`)
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '');
  if (storefrontHtml.length > 0) {
    record('storefront.noPriceInHtml', !storefrontHtml.includes('123.45'));
    record(
      'storefront.imageRendered',
      publicImages.some((image) => storefrontHtml.includes(image.url.replace(API, ''))),
    );
  } else {
    record('storefront.skipped', true, 'storefront not reachable from here');
  }

  expectEq(
    'unpublish.status',
    (await call('POST', `/admin/products/${productId}/unpublish`)).status,
    201,
  );
  expectEq(
    'public.hiddenAfterUnpublish',
    (await call('GET', `/public/products/${slug}`, { anonymous: true })).status,
    404,
  );

  // -------------------------------------------------- permanent image delete
  const deleteTarget = imageIds[0] as string;
  const targetKey = staged[0]?.storageKey as string;
  // Checked before the request: the worker may remove the object within
  // milliseconds of the task being queued.
  record('imageDelete.objectExistsBefore', existsSync(storagePath(targetKey)), targetKey);
  const deleteRequested = await call<{ data: { operationId: string; status: string } }>(
    'DELETE',
    `/admin/products/${productId}/images/${deleteTarget}`,
  );
  expectEq('imageDelete.acceptedStatus', deleteRequested.status, 202);
  expectEq('imageDelete.pendingStatus', deleteRequested.body.data?.status, 'PENDING');

  const operationId = deleteRequested.body.data?.operationId as string;
  expectEq('imageDelete.operationStatus', await pollOperation(operationId), 'SUCCEEDED');
  record('imageDelete.objectGoneFromStorage', !existsSync(storagePath(targetKey)), targetKey);
  record('imageDelete.publicUrlGone', !(await publicFileExists(targetKey)));
  record(
    'imageDelete.derivativesGone',
    !existsSync(derivativePath(targetKey, 320)) && !existsSync(derivativePath(targetKey, 640)),
  );

  const afterDelete = await call<{ data: { images: { id: string }[] } }>(
    'GET',
    `/admin/products/${productId}`,
  );
  record(
    'imageDelete.rowRemoved',
    !(afterDelete.body.data?.images ?? []).some((image) => image.id === deleteTarget),
  );
  expectEq(
    'imageDelete.repeatRejected',
    (
      await call('DELETE', `/admin/products/${productId}/images/${deleteTarget}`)
    ).status,
    404,
  );
  expectEq(
    'imageDelete.retryOnlyWhenFailed',
    codeOf(await call('POST', `/admin/file-operations/${operationId}/retry`)),
    'FILE_OPERATION_NOT_RETRYABLE',
  );
  expectEq(
    'imageDelete.operationRequiresAuth',
    (await call('GET', `/admin/file-operations/${operationId}`, { anonymous: true })).status,
    401,
  );

  // ------------------------------------------------------------- RBAC checks
  const roles = await call<{ data: { id: string; code: string }[] }>('GET', '/admin/roles');
  const viewerRole = (roles.body.data ?? []).find((role) => role.code === 'viewer');
  record('auth.viewerRoleFound', Boolean(viewerRole));
  if (viewerRole) {
    const existing = await call<{ data: { id: string }[] }>(
      'GET',
      `/admin/users?q=${VIEWER_USERNAME}&pageSize=10`,
    );
    let viewerId = existing.body.data?.[0]?.id;
    if (!viewerId) {
      const viewerCreated = await call<{ data: { id: string } }>('POST', '/admin/users', {
        body: {
          username: VIEWER_USERNAME,
          displayName: 'QA product viewer',
          password: VIEWER_PASSWORD,
          roleIds: [viewerRole.id],
        },
      });
      viewerId = viewerCreated.body.data?.id;
    }
    if (viewerId) {
      await call('POST', `/admin/users/${viewerId}/reset-password`, {
        body: { password: VIEWER_PASSWORD },
      });
    }
    let viewerLogin = await call<{ user?: { mustChangePassword?: boolean } }>('POST', '/admin/auth/login', {
      body: { username: VIEWER_USERNAME, password: VIEWER_PASSWORD },
      anonymous: true,
    });
    if (viewerLogin.status === 401) {
      viewerLogin = await call('POST', '/admin/auth/login', {
        body: { username: VIEWER_USERNAME, password: `${VIEWER_PASSWORD}-rotated` },
        anonymous: true,
      });
    }
    let viewerSession = viewerLogin.setCookie?.split(';')[0] ?? '';
    if (viewerLogin.body.user?.mustChangePassword) {
      // A reset password always has to be changed before the back office opens.
      await call('POST', '/admin/auth/change-password', {
        session: viewerSession,
        body: { currentPassword: VIEWER_PASSWORD, newPassword: `${VIEWER_PASSWORD}-rotated` },
      });
      const relogin = await call('POST', '/admin/auth/login', {
        body: { username: VIEWER_USERNAME, password: `${VIEWER_PASSWORD}-rotated` },
        anonymous: true,
      });
      viewerSession = relogin.setCookie?.split(';')[0] ?? viewerSession;
    }
    record('auth.viewerLoggedIn', viewerSession.length > 0);
    expectEq(
      'auth.viewerCanReadProducts',
      (await call('GET', '/admin/products', { session: viewerSession })).status,
      200,
    );
    expectEq(
      'auth.viewerCannotDeleteImage',
      (await call('DELETE', `/admin/products/${productId}/images/${imageIds[2]}`, {
        session: viewerSession,
      })).status,
      403,
    );
    expectEq(
      'auth.viewerCannotUpload',
      (await uploadImageWithSession(makePng(80, 60, [10, 10, 10]), 'viewer.png', viewerSession)).status,
      403,
    );
    expectEq(
      'auth.viewerCannotUpdateProduct',
      (await call('PATCH', `/admin/products/${productId}`, {
        session: viewerSession,
        body: { isFeatured: true },
      })).status,
      403,
    );
    const viewerDetail = await call<{ data: { priceVisible: boolean; priceCny: string | null } }>(
      'GET',
      `/admin/products/${productId}`,
      { session: viewerSession },
    );
    expectEq('auth.viewerCannotSeeCost', viewerDetail.body.data?.priceCny, null);
    expectEq('auth.viewerPriceFlagFalse', viewerDetail.body.data?.priceVisible, false);
  }

  // A publish request that changes nothing is idempotent, so a retried request
  // after a network error cannot fail with a confusing conflict.
  expectEq(
    'publish.idempotentRepeat',
    (await call('POST', `/admin/products/${productId}/publish`, { body: { publishStatus: 'published' } })).status,
    201,
  );
  await call('POST', `/admin/products/${productId}/unpublish`);

  // --------------------------------------------------------- product delete
  const productDelete = await call<{ data: { accepted: boolean; operationId: string } }>(
    'DELETE',
    `/admin/products/${productId}`,
  );
  expectEq('productDelete.acceptedStatus', productDelete.status, 202);
  const productOperation = productDelete.body.data?.operationId as string;
  expectEq('productDelete.operationStatus', await pollOperation(productOperation), 'SUCCEEDED');
  expectEq(
    'productDelete.rowGone',
    (await call('GET', `/admin/products/${productId}`)).status,
    404,
  );
  const remainingKeys = staged.slice(1).map((asset) => asset.storageKey);
  record(
    'productDelete.allImageObjectsGone',
    remainingKeys.every((key) => !existsSync(storagePath(key))),
    remainingKeys.join(','),
  );

  process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
  if (failures > 0) process.exitCode = 1;
}

async function uploadImageWithSession(
  buffer: Buffer,
  fileName: string,
  session: string,
): Promise<ApiResponse<unknown>> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), fileName);
  const response = await fetch(`${API}/admin/media/staging`, {
    method: 'POST',
    headers: { cookie: session },
    body: form,
  });
  return { status: response.status, body: {}, setCookie: null };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
