// Runs a CLI with the repository `.env` loaded.
//
// The Prisma CLI only reads `.env` next to the schema or in the current working
// directory, while this repository keeps a single root `.env`. This wrapper
// loads the root file (if present) and then executes the requested command, so
// scripts behave identically from any working directory without extra deps.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const envFiles = [
  process.env.ENV_FILE,
  join(repoRoot, '.env'),
  join(repoRoot, '.env.local'),
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

let loaded = false;
for (const file of envFiles) {
  if (loadEnvFile(file)) {
    loaded = true;
    break;
  }
}
if (!loaded) {
  process.stderr.write(
    '[exec] No .env file found at the repository root; relying on the ambient environment.\n',
  );
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write('[exec] Usage: node scripts/exec.mjs <command> [args...]\n');
  process.exit(1);
}

// Runtime traffic uses the Neon pooled URL. Prisma migrations and the
// release-owned reference synchronizer use the direct endpoint so they do not
// compete with application traffic for a pooled session. The value is never
// printed.
const isReferenceSeed =
  command === 'tsx' &&
  args[0] === 'prisma/seed.ts' &&
  args.includes('--reference-only');
if (
  ((command === 'prisma' && args[0] === 'migrate') || isReferenceSeed) &&
  typeof process.env.DIRECT_DATABASE_URL === 'string' &&
  process.env.DIRECT_DATABASE_URL.trim().length > 0
) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

// Prisma and other database CLIs are declared in the @b2b/database
// workspace package, not at the monorepo root. In production images the
// root .bin directory therefore may not contain a prisma executable.
// Prefer the package-local binaries, then fall back to root binaries.
const packageBinDir = join(here, '..', 'node_modules', '.bin');
const rootBinDir = join(repoRoot, 'node_modules', '.bin');
const pathEntries = [packageBinDir, rootBinDir, process.env.PATH ?? '']
  .filter(Boolean)
  .join(process.platform === 'win32' ? ';' : ':');

const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: pathEntries,
  },
  // Commands run from the package root (the parent of this script) so the
  // Prisma CLI resolves ./prisma/schema.prisma without extra flags.
  cwd: process.env.EXEC_CWD ?? resolve(here, '..'),
});

child.on('error', (error) => {
  process.stderr.write(
    `[exec] Failed to start "${command}": ${error.message}. Checked PATH: ${pathEntries}\n`,
  );
  process.exit(127);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
