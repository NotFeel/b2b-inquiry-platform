// One long-form editor is active at a time. The product editor publishes its
// dirty state here so a locale <Link> can ask before discarding input; the
// browser's beforeunload handler still covers refresh and tab close.
let dirty = false;

export function setAdminFormDirty(value: boolean): void {
  dirty = value;
}

export function hasUnsavedAdminForm(): boolean {
  return dirty;
}
