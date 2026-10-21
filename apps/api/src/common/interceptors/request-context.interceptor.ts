import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { JsonLogger } from '../logger.service';
import type { RequestWithContext } from '../request-context';

// Every request gets a requestId that is echoed back to the caller and used in
// logs, audit rows and job records (docs/07 §8).
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: JsonLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();

    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,120}$/.test(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    const startedAt = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.info('request.completed', {
            requestId,
            method: request.method,
            path: request.route?.path ?? request.path,
            status: response.statusCode,
            durationMs: Date.now() - startedAt,
            actorId: request.actor?.id,
          });
        },
      }),
    );
  }
}
