import { promises as fs } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveExecutablePath } from './resolve-executable';

describe('resolveExecutablePath', () => {
  it('resolves a command name from PATH', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'b2b-resolve-executable-'));
    const executable = join(root, 'fake-soffice');
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n');
    await fs.chmod(executable, 0o700);

    try {
      await expect(
        resolveExecutablePath('fake-soffice', `${root}${delimiter}/missing`),
      ).resolves.toBe(executable);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps an explicit absolute path authoritative when it is missing', async () => {
    await expect(
      resolveExecutablePath('/definitely/missing/soffice', process.env.PATH),
    ).resolves.toBeNull();
  });
});
