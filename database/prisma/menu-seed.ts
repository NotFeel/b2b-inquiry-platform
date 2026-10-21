// Sidebar structure for the back office (docs/16 §4.2).
//
// Six business groups replace the previous flat list of ~20 top-level items.
// Group labels are not links; every leaf points at a real route, and the icon
// names map to the shared icon set in packages/ui.

export interface MenuSeed {
  code: string;
  route: string | null;
  icon: string;
  permissionCode: string | null;
  sortOrder: number;
  labels: Record<string, string>;
  children?: MenuSeed[];
}

export const MENU_SEED: MenuSeed[] = [
  {
    code: 'workspace',
    route: null,
    icon: 'grid',
    permissionCode: 'dashboard.read',
    sortOrder: 10,
    labels: { 'zh-CN': '工作台', 'en-US': 'Workspace' },
    children: [
      {
        code: 'dashboard',
        route: '/dashboard',
        icon: 'grid',
        permissionCode: 'dashboard.read',
        sortOrder: 11,
        labels: { 'zh-CN': '运营总览', 'en-US': 'Overview' },
      },
    ],
  },
  {
    code: 'catalog',
    route: null,
    icon: 'box',
    permissionCode: 'product.read',
    sortOrder: 20,
    labels: { 'zh-CN': '商品目录', 'en-US': 'Catalog' },
    children: [
      {
        code: 'products',
        route: '/products',
        icon: 'box',
        permissionCode: 'product.read',
        sortOrder: 21,
        labels: { 'zh-CN': '商品管理', 'en-US': 'Products' },
      },
      {
        code: 'categories',
        route: '/categories',
        icon: 'tree',
        permissionCode: 'category.read',
        sortOrder: 22,
        labels: { 'zh-CN': '品类管理', 'en-US': 'Categories' },
      },
      {
        code: 'tags',
        route: '/tags',
        icon: 'tag',
        permissionCode: 'tag.read',
        sortOrder: 23,
        labels: { 'zh-CN': '标签管理', 'en-US': 'Tags' },
      },
    ],
  },
  {
    code: 'leads-analytics',
    route: null,
    icon: 'chat',
    permissionCode: 'customer.read',
    sortOrder: 30,
    labels: { 'zh-CN': '询盘与分析', 'en-US': 'Leads & Analytics' },
    children: [
      {
        code: 'customers',
        route: '/leads',
        icon: 'chat',
        permissionCode: 'customer.read',
        sortOrder: 31,
        labels: { 'zh-CN': 'WhatsApp 客户', 'en-US': 'WhatsApp leads' },
      },
      {
        code: 'analytics',
        route: '/analytics',
        icon: 'chart',
        permissionCode: 'analytics.read',
        sortOrder: 32,
        labels: { 'zh-CN': '访问分析', 'en-US': 'Analytics' },
      },
    ],
  },
  {
    code: 'quotes-files',
    route: null,
    icon: 'folder',
    permissionCode: 'quote.read',
    sortOrder: 40,
    labels: { 'zh-CN': '报价与文件', 'en-US': 'Quotes & Files' },
    children: [
      {
        code: 'quote-templates',
        route: '/quote-templates',
        icon: 'file',
        permissionCode: 'quote.read',
        sortOrder: 41,
        labels: { 'zh-CN': '报价模板', 'en-US': 'Quote templates' },
      },
      {
        code: 'quote-exports',
        route: '/quote-exports',
        icon: 'download',
        permissionCode: 'quote.read',
        sortOrder: 42,
        labels: { 'zh-CN': '导出记录', 'en-US': 'Exports' },
      },
      {
        code: 'pdf-conversions',
        route: '/pdf-conversions',
        icon: 'swap',
        permissionCode: 'pdf.convert',
        sortOrder: 43,
        labels: { 'zh-CN': 'Excel 转 PDF', 'en-US': 'Excel to PDF' },
      },
      {
        code: 'pi-documents',
        route: '/pi-documents',
        icon: 'invoice',
        permissionCode: 'pi.read',
        sortOrder: 44,
        labels: { 'zh-CN': '形式发票 PI', 'en-US': 'Proforma invoices' },
      },
    ],
  },
  {
    code: 'content-management',
    route: null,
    icon: 'document',
    permissionCode: 'content.read',
    sortOrder: 50,
    labels: { 'zh-CN': '内容管理', 'en-US': 'Content' },
    children: [
      {
        code: 'ads',
        route: '/ads',
        icon: 'image',
        permissionCode: 'ad.read',
        sortOrder: 51,
        labels: { 'zh-CN': '广告管理', 'en-US': 'Ads' },
      },
      {
        code: 'content',
        route: '/content',
        icon: 'document',
        permissionCode: 'content.read',
        sortOrder: 52,
        labels: { 'zh-CN': '内容页面', 'en-US': 'Content pages' },
      },
      {
        code: 'content.factory-media',
        route: '/content/factory-media',
        icon: 'image',
        permissionCode: 'content.factory-media.read',
        sortOrder: 53,
        labels: { 'zh-CN': '工厂媒体', 'en-US': 'Factory media' },
      },
      {
        code: 'content.factory-process',
        route: '/content/factory-process',
        icon: 'swap',
        permissionCode: 'content.factory-process.read',
        sortOrder: 54,
        labels: { 'zh-CN': '生产流程', 'en-US': 'Factory process' },
      },
      {
        code: 'content.credentials',
        route: '/content/credentials',
        icon: 'document',
        permissionCode: 'content.credentials.read',
        sortOrder: 55,
        labels: { 'zh-CN': '证书与荣誉', 'en-US': 'Certificates & awards' },
      },
      {
        code: 'content.home-sections',
        route: '/content/home-sections',
        icon: 'grid',
        permissionCode: 'content.home-sections.read',
        sortOrder: 56,
        labels: { 'zh-CN': '首页区块', 'en-US': 'Homepage sections' },
      },
    ],
  },
  {
    code: 'administration',
    route: null,
    icon: 'settings',
    permissionCode: null,
    sortOrder: 60,
    labels: { 'zh-CN': '系统管理', 'en-US': 'Administration' },
    children: [
      {
        code: 'users',
        route: '/users',
        icon: 'user',
        permissionCode: 'user.read',
        sortOrder: 61,
        labels: { 'zh-CN': '用户管理', 'en-US': 'Users' },
      },
      {
        code: 'roles',
        route: '/roles',
        icon: 'shield',
        permissionCode: 'role.read',
        sortOrder: 62,
        labels: { 'zh-CN': '角色权限', 'en-US': 'Roles' },
      },
      {
        code: 'menus',
        route: '/menus',
        icon: 'menu',
        permissionCode: 'menu.read',
        sortOrder: 63,
        labels: { 'zh-CN': '菜单管理', 'en-US': 'Menus' },
      },
      {
        code: 'dictionary',
        route: '/dictionary',
        icon: 'book',
        permissionCode: 'dictionary.read',
        sortOrder: 64,
        labels: { 'zh-CN': '字典管理', 'en-US': 'Dictionaries' },
      },
      {
        code: 'settings',
        route: '/settings',
        icon: 'settings',
        permissionCode: 'setting.read',
        sortOrder: 65,
        labels: { 'zh-CN': '全局设置', 'en-US': 'Settings' },
      },
      {
        code: 'audit-logs',
        route: '/audit-logs',
        icon: 'list',
        permissionCode: 'audit.read',
        sortOrder: 66,
        labels: { 'zh-CN': '审计日志', 'en-US': 'Audit log' },
      },
    ],
  },
];
