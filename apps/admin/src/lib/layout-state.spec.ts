import { describe, expect, it } from 'vitest';
import {
  defaultModeFor,
  isActiveRoute,
  isDrawerOpen,
  loginHrefWithReturnTo,
  nextModeOnMenuToggle,
  nextModeOnRailToggle,
  resolveMode,
  sanitizeReturnTo,
  viewportFor,
} from './layout-state';

describe('viewport mapping', () => {
  it('maps the documented breakpoints', () => {
    expect(viewportFor(360)).toBe('mobile');
    expect(viewportFor(767)).toBe('mobile');
    expect(viewportFor(768)).toBe('tablet');
    expect(viewportFor(1024)).toBe('tablet');
    expect(viewportFor(1279)).toBe('tablet');
    expect(viewportFor(1280)).toBe('desktop');
    expect(viewportFor(1600)).toBe('desktop');
  });

  it('defaults to a safe mode per viewport', () => {
    expect(defaultModeFor('desktop')).toBe('expanded');
    expect(defaultModeFor('tablet')).toBe('rail');
    expect(defaultModeFor('mobile')).toBe('closed');
  });
});

describe('menu toggle transitions', () => {
  it('desktop toggles expanded and closed', () => {
    expect(nextModeOnMenuToggle('expanded', 'desktop')).toBe('closed');
    expect(nextModeOnMenuToggle('closed', 'desktop')).toBe('expanded');
  });

  it('tablet toggles rail and expanded', () => {
    expect(nextModeOnMenuToggle('rail', 'tablet')).toBe('expanded');
    expect(nextModeOnMenuToggle('expanded', 'tablet')).toBe('rail');
  });

  it('never opens the desktop sidebar on mobile', () => {
    expect(nextModeOnMenuToggle('closed', 'mobile')).toBe('closed');
    expect(nextModeOnMenuToggle('expanded', 'mobile')).toBe('expanded');
  });

  it('rail control alternates expanded and rail only', () => {
    expect(nextModeOnRailToggle('expanded')).toBe('rail');
    expect(nextModeOnRailToggle('rail')).toBe('expanded');
  });
});

describe('persisted preference', () => {
  it('ignores a stored desktop preference on mobile', () => {
    expect(resolveMode('expanded', 'mobile')).toBe('closed');
    expect(resolveMode('rail', 'mobile')).toBe('closed');
  });

  it('honours a valid stored preference on desktop and tablet', () => {
    expect(resolveMode('closed', 'desktop')).toBe('closed');
    expect(resolveMode('rail', 'desktop')).toBe('rail');
    expect(resolveMode('closed', 'tablet')).toBe('closed');
  });

  it('falls back when the stored value is missing or corrupt', () => {
    expect(resolveMode(undefined, 'desktop')).toBe('expanded');
    expect(resolveMode('sideways', 'desktop')).toBe('expanded');
    expect(resolveMode(null, 'tablet')).toBe('rail');
  });
});

describe('mobile drawer', () => {
  it('is only open on mobile and is never persisted', () => {
    expect(isDrawerOpen('mobile', true)).toBe(true);
    expect(isDrawerOpen('mobile', false)).toBe(false);
    expect(isDrawerOpen('desktop', true)).toBe(false);
    expect(isDrawerOpen('tablet', true)).toBe(false);
  });
});

describe('returnTo sanitisation', () => {
  const fallback = '/zh-CN/dashboard';

  it('accepts internal paths', () => {
    expect(sanitizeReturnTo('/zh-CN/products?page=2', fallback)).toBe('/zh-CN/products?page=2');
    expect(sanitizeReturnTo('/en-US/audit-logs', fallback)).toBe('/en-US/audit-logs');
  });

  it('rejects external, protocol-relative and scheme payloads', () => {
    expect(sanitizeReturnTo('https://evil.example/x', fallback)).toBe(fallback);
    expect(sanitizeReturnTo('//evil.example/x', fallback)).toBe(fallback);
    expect(sanitizeReturnTo('/\\evil.example', fallback)).toBe(fallback);
    expect(sanitizeReturnTo('javascript:alert(1)', fallback)).toBe(fallback);
    expect(sanitizeReturnTo('products', fallback)).toBe(fallback);
    expect(sanitizeReturnTo(undefined, fallback)).toBe(fallback);
    expect(sanitizeReturnTo('/ok\u0000bad', fallback)).toBe(fallback);
  });

  it('builds an encoded login url that survives a round trip', () => {
    const href = loginHrefWithReturnTo('zh-CN', '/zh-CN/products', '?page=3');
    expect(href.startsWith('/zh-CN/login?returnTo=')).toBe(true);
    const target = decodeURIComponent(href.split('returnTo=')[1] ?? '');
    expect(target).toBe('/zh-CN/products?page=3');
  });
});

describe('active route matching', () => {
  it('matches the route itself and its children', () => {
    expect(isActiveRoute('/zh-CN/products', '/zh-CN/products')).toBe(true);
    expect(isActiveRoute('/zh-CN/products/abc', '/zh-CN/products')).toBe(true);
  });

  it('does not match sibling prefixes', () => {
    expect(isActiveRoute('/zh-CN/products-archive', '/zh-CN/products')).toBe(false);
    expect(isActiveRoute('/zh-CN/audit-logs', '/zh-CN/audit')).toBe(false);
    expect(isActiveRoute('/en-US/products', '/zh-CN/products')).toBe(false);
  });
});
