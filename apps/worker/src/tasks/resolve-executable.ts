import { constants as fsConstants, promises as fs } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';

/**
 * Resolves an executable configured either as an absolute/relative path or as
 * a command name found on PATH. Returning the resolved path prevents a valid
 * command such as `soffice` from being mistaken for a missing file when the
 * worker starts it with the OS paths used by desktop development.
 */
export async function resolveExecutablePath(
  command: string,
  searchPath = process.env.PATH ?? '',
  cwd = process.cwd(),
): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');
  const candidates = hasPathSeparator
    ? [isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)]
    : searchPath
        .split(delimiter)
        .filter((entry) => entry.length > 0)
        .map((entry) => resolve(entry, trimmed));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}
