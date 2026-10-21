// JS mirror of the design tokens in styles/tokens.css, for the few places where
// a CSS variable is not usable (inline chart colours, media query logic).

export const tokens = {
  colorPrimary: '#0f766e',
  colorPrimaryHover: '#115e59',
  colorPrimarySoft: '#e6f4f1',
  colorText: '#17212b',
  colorTextSecondary: '#64748b',
  colorTextMuted: '#94a3b8',
  colorPage: '#f5f7fa',
  colorSurface: '#ffffff',
  colorSurfaceSunken: '#f8fafc',
  colorBorder: '#e2e8f0',
  colorBorderStrong: '#cbd5e1',
  colorSuccess: '#15803d',
  colorWarning: '#b45309',
  colorDanger: '#b91c1c',
  colorInfo: '#1d4ed8',
  colorWhatsapp: '#25d366',
  containerMax: 1280,
  sidebarWidth: 248,
  sidebarWidthCollapsed: 72,
  topbarHeight: 64,
  breakpoints: {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    xxl: 1536,
  },
} as const;

export const MAX_UPLOAD_BYTES_DEFAULT = 10 * 1024 * 1024;
