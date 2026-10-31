import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ReturnType<typeof spawn>;

export interface ReferenceDataStartupOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnLike;
}

function findRepositoryRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'database', 'scripts', 'exec.mjs'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate repository root from ${start}`);
    }
    current = parent;
  }
}

/**
 * Runs the versioned reference-data synchronizer before Nest starts listening.
 *
 * The synchronizer is deliberately separate from schema migrations: it only
 * repairs release-owned permissions, menus, translations, and system
 * dictionaries. A non-zero exit aborts API startup so a process can never serve
 * an admin application with missing authorization or navigation records.
 */
export async function syncReferenceDataAtStartup(
  options: ReferenceDataStartupOptions = {},
): Promise<void> {
  const repositoryRoot = findRepositoryRoot(options.cwd ?? process.cwd());
  const databaseDirectory = join(repositoryRoot, 'database');
  const execScript = join(databaseDirectory, 'scripts', 'exec.mjs');
  const launcher = options.spawnImpl ?? spawn;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };

    const child = launcher(
      process.execPath,
      [execScript, 'tsx', 'prisma/seed.ts', '--reference-only'],
      {
        cwd: databaseDirectory,
        env: options.env ?? process.env,
        stdio: 'inherit',
      },
    );

    child.once('error', (error) => {
      finish(new Error(`Reference-data startup sync could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `Reference-data startup sync failed (${signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`})`,
        ),
      );
    });
  });
}
