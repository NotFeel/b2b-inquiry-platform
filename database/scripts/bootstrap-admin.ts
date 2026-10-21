import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../generated/client';

// Creates the initial super administrator.
//
// There is no self-service registration: this command is the only supported way
// to create the first account (docs/01 §3.1, docs/07 §4). It never writes a
// default password to the repository - either BOOTSTRAP_ADMIN_PASSWORD is
// supplied for the run, or a random password is printed exactly once.

const prisma = new PrismaClient();

function generatePassword(length = 20): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_';
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[(bytes[index] ?? 0) % alphabet.length];
  }
  return out;
}

async function main() {
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
    throw new Error(
      'Set BOOTSTRAP_ADMIN_USERNAME to a valid username (3-80 chars: lowercase letters, digits, dot, dash, underscore).',
    );
  }
  const displayName = (process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME ?? username).trim().slice(0, 120);
  const suppliedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';

  if (suppliedPassword && suppliedPassword.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const role = await prisma.role.findUnique({ where: { code: 'super_admin' } });
  if (!role) {
    throw new Error('The super_admin role is missing. Run `pnpm db:seed` first.');
  }

  const existingSuperAdmins = await prisma.adminUser.count({
    where: { userRoles: { some: { roleId: role.id } } },
  });
  const existingUser = await prisma.adminUser.findUnique({ where: { username } });
  if (existingUser) {
    throw new Error(`User "${username}" already exists. Use the back office to reset its password.`);
  }
  if (existingSuperAdmins > 0 && !process.argv.includes('--force')) {
    throw new Error(
      'A super administrator already exists. Pass --force if an additional one is really required.',
    );
  }

  const password = suppliedPassword || generatePassword();
  const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  const user = await prisma.adminUser.create({
    data: {
      username,
      displayName,
      passwordHash,
      status: 'ACTIVE',
      // The first sign-in always requires a password change.
      mustChangePassword: true,
      userRoles: { create: [{ roleId: role.id }] },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: 'auth.bootstrap_admin_created',
      entityType: 'admin_user',
      entityId: user.id,
      metadata: { username, source: 'cli' },
    },
  });

  console.log('Super administrator created.');
  console.log(`  username: ${username}`);
  if (!suppliedPassword) {
    console.log(`  password: ${password}`);
    console.log('  This password is shown once and is never stored in plain text.');
  }
  console.log('  A password change is required at first sign-in.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
