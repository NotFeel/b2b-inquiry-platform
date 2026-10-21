type Level = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// The worker logs structured JSON with the job id so an operator can trace a
// failed export end to end (docs/07 §8).
export class WorkerLogger {
  constructor(
    private readonly level: Level,
    private readonly service = 'worker',
  ) {}

  private write(level: Level, message: string, meta?: Record<string, unknown>): void {
    if (WEIGHT[level] < WEIGHT[this.level]) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...(meta ?? {}),
    });
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.write('info', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.write('debug', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.write('error', message, meta);
  }
}
