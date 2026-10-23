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

// Runtime traffic uses the Neon pooled URL. Prisma migrations must use the
// direct endpoint from a single controlled release job, so the wrapper swaps
// DATABASE_URL only for migrate commands. The value is never printed.
if (
  command === 'prisma' &&
  args[0] === 'migrate' &&
  typeof process.env.DIRECT_DATABASE_URL === 'string' &&
  process.env.DIRECT_DATABASE_URL.trim().length > 0
) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}

const binDir = join(repoRoot, 'node_modules', '.bin');
const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  },
  // Commands run from the package root (the parent of this script) so the
  // Prisma CLI resolves ./prisma/schema.prisma without extra flags.
  cwd: process.env.EXEC_CWD ?? resolve(here, '..'),
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
