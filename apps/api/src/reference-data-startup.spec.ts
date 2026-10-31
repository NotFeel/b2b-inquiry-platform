import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncReferenceDataAtStartup } from './reference-data-startup';

class FakeChild extends EventEmitter {}

describe('syncReferenceDataAtStartup', () => {
  it('runs the reference-only synchronizer before resolving', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child as never);
    const promise = syncReferenceDataAtStartup({
      cwd: process.cwd(),
      env: { NODE_ENV: 'test' },
      spawnImpl,
    });

    expect(spawnImpl).toHaveBeenCalledOnce();
    const [command, args, options] = spawnImpl.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; stdio: string },
    ];
    expect(command).toBe(process.execPath);
    expect(args.slice(1)).toEqual(['tsx', 'prisma/seed.ts', '--reference-only']);
    expect(args[0]).toBe(join(options.cwd, 'scripts', 'exec.mjs'));
    expect(options.env).toEqual({ NODE_ENV: 'test' });
    expect(options.stdio).toBe('inherit');

    child.emit('exit', 0, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it('fails closed when synchronization exits non-zero', async () => {
    const child = new FakeChild();
    const promise = syncReferenceDataAtStartup({
      cwd: process.cwd(),
      spawnImpl: vi.fn(() => child as never),
    });

    child.emit('exit', 1, null);
    await expect(promise).rejects.toThrow('exit 1');
  });

  it('fails closed when the synchronizer process cannot start', async () => {
    const child = new FakeChild();
    const promise = syncReferenceDataAtStartup({
      cwd: process.cwd(),
      spawnImpl: vi.fn(() => child as never),
    });

    child.emit('error', new Error('spawn failed'));
    await expect(promise).rejects.toThrow('could not start');
  });
});
