import { afterEach, describe, expect, it } from 'vitest';
import { hasUnsavedAdminForm, setAdminFormDirty } from './unsaved-form';

describe('unsaved form guard', () => {
  afterEach(() => setAdminFormDirty(false));

  it('tracks the active long-form editor dirty state', () => {
    expect(hasUnsavedAdminForm()).toBe(false);
    setAdminFormDirty(true);
    expect(hasUnsavedAdminForm()).toBe(true);
    setAdminFormDirty(false);
    expect(hasUnsavedAdminForm()).toBe(false);
  });
});
