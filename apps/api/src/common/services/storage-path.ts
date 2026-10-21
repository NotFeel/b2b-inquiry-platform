import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Resolves a relative filesystem setting against the repository root.
 *
 * Storage paths must not depend on the process working directory: the API starts
 * from `apps/api` and the worker from `apps/worker`, so resolving
 * `./.data/uploads` against `cwd` silently gave the two processes different
 * storage roots and broke public image serving (docs/16 §7.4).
 */
function findRepoRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}

export function resolveFromRepoRoot(value: string): string {
  if (isAbsolute(value)) return value;
  const repoRoot = findRepoRoot(__dirname);
  return resolve(repoRoot, value);
}
