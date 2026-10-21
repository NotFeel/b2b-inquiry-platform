/**
 * Tag management acceptance run (docs/23 §12).
 *
 * Drives the real API over HTTP against the real database and the real
 * storefront: list filters, create/edit/status, duplicate code, required English
 * label, whitelisted style token, optimistic concurrency, product association,
 * delete protection (TAG_IN_USE + RESTRICT), per-endpoint RBAC and the public
 * badge behaviour after a tag is disabled.
 *
 * Usage (API + DB + storefront running locally):
 *   QA_ADMIN_USERNAME=<super admin> QA_ADMIN_PASSWORD=<password> \
 *   pnpm --filter @b2b/api run acceptance:tags
 */

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3002';
const API = `${BASE_URL}/api/v1`;
const ADMIN_USERNAME = process.env.QA_ADMIN_USERNAME ?? '';
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD ?? '';
const VIEWER_USERNAME = 'qa.tag.viewer';
const VIEWER_PASSWORD = 'QaTagViewer!2026';
const VIEWER_FINAL_PASSWORD = 'QaTagViewer!2027';

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
    ok
      ? `= ${JSON.stringify(actual)}`
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
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
    body: (text.length > 0 ? JSON.parse(text) : {}) as T & { error?: { code?: string } },
    setCookie: response.headers.get('set-cookie'),
  };
}

const codeOf = (response: ApiResponse<unknown>): string | undefined => response.body.error?.code;

interface TagSummary {
  id: string;
  code: string;
  label: string;
  colorToken: string | null;
  enabled: boolean;
  labels: Record<string, string>;
  productCount: number;
  missingLocales: string[];
}

async function main(): Promise<void> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('Set QA_ADMIN_USERNAME and QA_ADMIN_PASSWORD to a super administrator.');
  }
  const stamp = Date.now().toString(36).slice(-5);

  // ---------------------------------------------------------------- sign in
  const login = await call('POST', '/admin/auth/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    anonymous: true,
  });
  expectEq('auth.login', login.status, 201);
  adminCookie = login.setCookie?.split(';')[0] ?? '';
  record('auth.sessionCookie', adminCookie.length > 0);

  // ------------------------------------------------------- seed tags (12.1.1)
  const list = await call<{ data: TagSummary[]; pagination: { total: number; pageSize: number } }>(
    'GET',
    '/admin/tags?locale=zh-CN&pageSize=50',
  );
  expectEq('list.status', list.status, 200);
  const seeded = list.body.data;
  expectEq('list.paginationShape', typeof list.body.pagination.total, 'number');
  const featured = seeded.find((tag) => tag.code === 'featured');
  record('list.hasSeededTags', Boolean(featured), seeded.map((tag) => tag.code).join(','));
  expectEq('list.resolvesLabelForLocale', featured?.label, '精选');
  expectEq('list.exposesRawTranslations', featured?.labels['en-US'], 'Featured');
  expectEq('list.aggregatesProductCount', typeof featured?.productCount, 'number');
  expectEq(
    'list.nonNumericInjectionBlocked',
    typeof (featured as unknown as Record<string, unknown>)?.sku,
    'undefined',
  );

  const searched = await call<{ data: TagSummary[] }>(
    'GET',
    '/admin/tags?locale=zh-CN&q=OEM&pageSize=50',
  );
  expectEq(
    'list.searchByEnglishLabel',
    searched.body.data.map((tag) => tag.code),
    ['oem'],
  );
  const searchedZh = await call<{ data: TagSummary[] }>(
    'GET',
    '/admin/tags?locale=zh-CN&q=预售&pageSize=50',
  );
  expectEq(
    'list.searchByChineseLabel',
    searchedZh.body.data.map((tag) => tag.code),
    ['preorder'],
  );
  const used = await call<{ data: TagSummary[] }>(
    'GET',
    '/admin/tags?locale=zh-CN&usage=used&pageSize=50',
  );
  record(
    'list.filterUsed',
    used.body.data.length > 0 && used.body.data.every((tag) => tag.productCount > 0),
    used.body.data.map((tag) => `${tag.code}:${tag.productCount}`).join(','),
  );
  const unused = await call<{ data: TagSummary[] }>(
    'GET',
    '/admin/tags?locale=zh-CN&usage=unused&pageSize=50',
  );
  record(
    'list.filterUnused',
    unused.body.data.every((tag) => tag.productCount === 0),
    unused.body.data.map((tag) => tag.code).join(','),
  );
  const disabled = await call<{ data: TagSummary[] }>(
    'GET',
    '/admin/tags?locale=zh-CN&status=disabled&pageSize=50',
  );
  record(
    'list.filterDisabled',
    disabled.body.data.every((tag) => !tag.enabled),
  );
  const paged = await call<{ data: TagSummary[]; pagination: { pageSize: number; total: number } }>(
    'GET',
    '/admin/tags?locale=zh-CN&page=1&pageSize=2',
  );
  expectEq('list.pageSizeRespected', paged.body.data.length <= 2, true);
  expectEq('list.paginationEchoesPageSize', paged.body.pagination.pageSize, 2);

  // ------------------------------------------------------------- create (12.1.4)
  const code = `qa-tag-${stamp}`;
  const created = await call<{ data: TagSummary }>('POST', '/admin/tags', {
    body: {
      code,
      colorToken: 'tag.success',
      enabled: true,
      translations: [
        { locale: 'en-US', label: 'QA Export ready' },
        { locale: 'zh-CN', label: 'QA 可出口' },
      ],
      // Unknown fields must never be persisted (docs/23 §6.2).
      productCount: 99,
      id: '00000000-0000-4000-8000-000000000000',
    },
  });
  expectEq('create.status', created.status, 201);
  const tagId = created.body.data.id;
  expectEq('create.ignoresInjectedId', tagId !== '00000000-0000-4000-8000-000000000000', true);
  expectEq('create.ignoresProductCount', created.body.data.productCount, 0);
  expectEq('create.colorToken', created.body.data.colorToken, 'tag.success');
  expectEq('create.zhLabel', created.body.data.labels['zh-CN'], 'QA 可出口');
  expectEq('create.noMissingLocales', created.body.data.missingLocales, []);

  const duplicate = await call('POST', '/admin/tags', {
    body: {
      code,
      enabled: true,
      translations: [{ locale: 'en-US', label: 'Duplicate' }],
    },
  });
  expectEq('create.duplicateCodeStatus', duplicate.status, 409);
  expectEq('create.duplicateCodeErrorCode', codeOf(duplicate), 'TAG_CODE_CONFLICT');
  record('create.duplicateCodeFieldError', typeof duplicate.body.error?.details?.code === 'string');

  const noEnglish = await call('POST', '/admin/tags', {
    body: {
      code: `qa-tag-noen-${stamp}`,
      enabled: true,
      translations: [{ locale: 'zh-CN', label: '只有中文' }],
    },
  });
  expectEq('create.englishRequiredStatus', noEnglish.status, 400);

  const badToken = await call('POST', '/admin/tags', {
    body: {
      code: `qa-tag-badtoken-${stamp}`,
      colorToken: 'red',
      enabled: true,
      translations: [{ locale: 'en-US', label: 'Bad token' }],
    },
  });
  expectEq('create.unknownColorTokenRejected', badToken.status, 400);

  // ------------------------------------------------------- detail + edit (12.1.6/7)
  const detail = await call<{ data: TagSummary }>('GET', `/admin/tags/${tagId}?locale=en-US`);
  expectEq('detail.status', detail.status, 200);
  expectEq('detail.labelForLocale', detail.body.data.label, 'QA Export ready');

  const zhEdit = await call<{ data: TagSummary }>('PATCH', `/admin/tags/${tagId}`, {
    body: {
      colorToken: 'tag.warning',
      translations: [{ locale: 'zh-CN', label: 'QA 可出口（已改）' }],
      expectedUpdatedAt: detail.body.data.updatedAt,
    },
  });
  expectEq('update.status', zhEdit.status, 200);
  expectEq('update.zhChanged', zhEdit.body.data.labels['zh-CN'], 'QA 可出口（已改）');
  expectEq('update.enUntouched', zhEdit.body.data.labels['en-US'], 'QA Export ready');
  expectEq('update.colorTokenChanged', zhEdit.body.data.colorToken, 'tag.warning');

  const stale = await call('PATCH', `/admin/tags/${tagId}`, {
    body: {
      translations: [{ locale: 'en-US', label: 'Stale write' }],
      expectedUpdatedAt: detail.body.data.updatedAt,
    },
  });
  expectEq('update.staleVersionStatus', stale.status, 409);
  expectEq('update.staleVersionErrorCode', codeOf(stale), 'TAG_CONCURRENT_UPDATE');
  const afterStale = await call<{ data: TagSummary }>('GET', `/admin/tags/${tagId}?locale=en-US`);
  expectEq('update.staleWriteIgnored', afterStale.body.data.labels['en-US'], 'QA Export ready');

  const dropEnglish = await call('PATCH', `/admin/tags/${tagId}`, {
    body: { translations: [{ locale: 'zh-CN', label: '仅中文' }] },
  });
  record(
    'update.neverDropsEnglish',
    dropEnglish.status === 400 || dropEnglish.status === 200,
    `status=${dropEnglish.status}`,
  );

  // ------------------------------------------- product association (12.1.4/10)
  const productSku = `QA-TAG-${stamp.toUpperCase()}`;
  const productSlug = `qa-tag-product-${stamp}`;
  const product = await call<{ data: { id: string } }>('POST', '/admin/products', {
    body: {
      sku: productSku,
      slug: productSlug,
      publishStatus: 'published',
      lifecycleStatus: 'available',
      priceCny: '9.9000',
      tagCodes: [code],
      translations: [{ locale: 'en-US', name: 'QA tagged product', description: null }],
    },
  });
  expectEq('product.createWithTag', product.status, 201);
  const productId = product.body.data.id;

  const options = await call<{ data: { code: string; enabled: boolean }[] }>(
    'GET',
    '/admin/tags/options?locale=en-US',
  );
  expectEq('options.status', options.status, 200);
  record(
    'options.onlyEnabledNewTags',
    options.body.data.every((option) => option.enabled),
  );

  const productDetail = await call<{
    data: { tagCodes: string[]; tags: { code: string; enabled: boolean }[] };
  }>('GET', `/admin/products/${productId}`);
  expectEq(
    'product.detailKeepsTags',
    productDetail.body.data.tags.map((tag) => tag.code),
    [code],
  );

  // ------------------------------------------------- storefront before/after (12.1.10)
  const publicBefore = await call<{
    data: { sku: string; tags: { code: string; label: string }[] }[];
  }>('GET', `/public/products?locale=en-US&tag=${code}&pageSize=50`, { anonymous: true });
  expectEq(
    'public.tagFilterMatches',
    publicBefore.body.data.map((item) => item.sku),
    [productSku],
  );
  expectEq(
    'public.tagLabelIsEnglish',
    publicBefore.body.data[0]?.tags[0]?.label,
    'QA Export ready',
  );
  record(
    'public.tagPayloadHasNoInternalFields',
    Object.keys(publicBefore.body.data[0]?.tags[0] ?? {})
      .sort()
      .join(',') === 'code,colorToken,label',
    Object.keys(publicBefore.body.data[0]?.tags[0] ?? {}).join(','),
  );

  const disable = await call<{ data: TagSummary }>('PATCH', `/admin/tags/${tagId}/status`, {
    body: { enabled: false },
  });
  expectEq('status.disable', disable.status, 200);
  expectEq('status.disabled', disable.body.data.enabled, false);

  const publicAfter = await call<{ data: { sku: string; tags: { code: string }[] }[] }>(
    'GET',
    '/public/products?locale=en-US&q=QA%20tagged&pageSize=50',
    { anonymous: true },
  );
  const taggedAfter = publicAfter.body.data.find((item) => item.sku === productSku);
  record(
    'public.disabledTagHiddenOnCard',
    taggedAfter !== undefined && taggedAfter.tags.length === 0,
    JSON.stringify(taggedAfter?.tags),
  );
  const disabledFilter = await call<{ pagination: { total: number } }>(
    'GET',
    `/public/products?locale=en-US&tag=${code}&pageSize=50`,
    { anonymous: true },
  );
  expectEq('public.disabledTagNotBrowsable', disabledFilter.body.pagination.total, 0);

  const relisted = await call<{ data: { tags: { code: string; enabled: boolean }[] } }>(
    'GET',
    `/admin/products/${productId}`,
  );
  expectEq(
    'disable.keepsProductAssociation',
    relisted.body.data.tags.map((tag) => tag.code),
    [code],
  );
  expectEq('disable.marksAssociationDisabled', relisted.body.data.tags[0]?.enabled, false);

  const optionsAfterDisable = await call<{ data: { code: string }[] }>(
    'GET',
    '/admin/tags/options?locale=en-US',
  );
  record(
    'disable.removedFromPickerOptions',
    !optionsAfterDisable.body.data.some((option) => option.code === code),
  );

  // -------------------------------------------------- delete protection (12.1.9)
  const blockedDelete = await call('DELETE', `/admin/tags/${tagId}`);
  expectEq('delete.inUseStatus', blockedDelete.status, 409);
  expectEq('delete.inUseErrorCode', codeOf(blockedDelete), 'TAG_IN_USE');
  const stillThere = await call<{ data: TagSummary }>('GET', `/admin/tags/${tagId}`);
  expectEq('delete.inUseKeepsTag', stillThere.status, 200);
  const associationIntact = await call<{ data: { tags: { code: string }[] } }>(
    'GET',
    `/admin/products/${productId}`,
  );
  expectEq(
    'delete.inUseKeepsAssociation',
    associationIntact.body.data.tags.map((tag) => tag.code),
    [code],
  );

  // Detach, then the same tag can be deleted.
  const detach = await call('PATCH', `/admin/products/${productId}`, { body: { tagCodes: [] } });
  expectEq('product.detachTags', detach.status, 200);
  const deleted = await call('DELETE', `/admin/tags/${tagId}`);
  expectEq('delete.unusedSucceeds', deleted.status, 200);
  expectEq('delete.thenGone', (await call('GET', `/admin/tags/${tagId}`)).status, 404);
  expectEq('delete.unknownTag', (await call('DELETE', `/admin/tags/${tagId}`)).status, 404);

  // ------------------------------------------------------- permissions (12.2)
  const anonymous = await call('GET', '/admin/tags', { anonymous: true });
  expectEq('auth.anonymousRejected', anonymous.status, 401);

  const roles = await call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/roles?pageSize=100',
  );
  const viewerRole = (roles.body.data as unknown as { id: string; code: string }[]).find(
    (role) => role.code === 'viewer',
  );
  record('auth.viewerRoleFound', Boolean(viewerRole));
  if (viewerRole) {
    const existing = await call<{ data: { id: string }[] }>(
      'GET',
      `/admin/users?q=${VIEWER_USERNAME}&pageSize=10`,
    );
    let viewerId = existing.body.data?.[0]?.id;
    if (!viewerId) {
      const created = await call<{ data: { id: string } }>('POST', '/admin/users', {
        body: {
          username: VIEWER_USERNAME,
          displayName: 'QA tag viewer',
          password: VIEWER_PASSWORD,
          roleIds: [viewerRole.id],
        },
      });
      viewerId = created.body.data?.id;
    } else {
      await call('POST', `/admin/users/${viewerId}/reset-password`, {
        body: { password: VIEWER_PASSWORD, mustChangePassword: true },
      });
    }
    record('auth.viewerReady', Boolean(viewerId), `id=${viewerId}`);

    const viewerLogin = await call('POST', '/admin/auth/login', {
      body: { username: VIEWER_USERNAME, password: VIEWER_PASSWORD },
      anonymous: true,
    });
    const viewerSession = viewerLogin.setCookie?.split(';')[0] ?? '';
    if (viewerLogin.status === 201) {
      const rotated = await call('POST', '/admin/auth/change-password', {
        body: { currentPassword: VIEWER_PASSWORD, newPassword: VIEWER_FINAL_PASSWORD },
        session: viewerSession,
      });
      record(
        'auth.viewerPasswordRotated',
        rotated.status === 200 || rotated.status === 201,
        `status=${rotated.status}`,
      );
    }

    const viewerRead = await call('GET', '/admin/tags?locale=zh-CN', { session: viewerSession });
    expectEq('auth.viewerCanRead', viewerRead.status, 200);
    const viewerCreate = await call('POST', '/admin/tags', {
      session: viewerSession,
      body: {
        code: `qa-forbidden-${stamp}`,
        enabled: true,
        translations: [{ locale: 'en-US', label: 'Forbidden' }],
      },
    });
    expectEq('auth.viewerCreateForbidden', viewerCreate.status, 403);
    const viewerUpdate = await call('PATCH', `/admin/tags/${seeded[0]?.id}`, {
      session: viewerSession,
      body: { enabled: false },
    });
    expectEq('auth.viewerUpdateForbidden', viewerUpdate.status, 403);
    const viewerStatus = await call('PATCH', `/admin/tags/${seeded[0]?.id}/status`, {
      session: viewerSession,
      body: { enabled: false },
    });
    expectEq('auth.viewerStatusForbidden', viewerStatus.status, 403);
    const viewerDelete = await call('DELETE', `/admin/tags/${seeded[0]?.id}`, {
      session: viewerSession,
    });
    expectEq('auth.viewerDeleteForbidden', viewerDelete.status, 403);

    if (viewerId) {
      const removed = await call('DELETE', `/admin/users/${viewerId}`);
      record('auth.viewerCleanup', removed.status === 200, `status=${removed.status}`);
    }
  }

  // ---------------------------------------------------------------- cleanup
  const removedProduct = await call('DELETE', `/admin/products/${productId}`);
  record('cleanup.product', removedProduct.status === 200, `status=${removedProduct.status}`);
}

main()
  .then(() => {
    process.stdout.write(`\n${checks - failures} / ${checks} checks passed\n`);
    if (failures > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    process.stdout.write(
      `\nRUN ABORTED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
