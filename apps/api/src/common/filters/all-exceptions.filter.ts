import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import type { Response } from 'express';
import { ApiError } from '../errors/api-error';
import { JsonLogger } from '../logger.service';
import type { RequestWithContext } from '../request-context';

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Single place that renders `{ error: { code, message, details, requestId } }`
// and keeps stack traces, SQL and secrets out of the response (docs/05 §1).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithContext>();
    const requestId = request.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = {
      code: ERROR_CODES.internalError,
      message: 'Unexpected server error.',
    };

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const typed = payload as ErrorBody;
        body = { code: typed.code, message: typed.message, details: typed.details };
      } else {
        body = {
          code: this.mapStatusToCode(status),
          message: typeof payload === 'string' ? payload : exception.message,
        };
      }
    } else if (this.isPayloadTooLarge(exception)) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      body = { code: ERROR_CODES.payloadTooLarge, message: 'Request payload is too large.' };
    }

    if (status >= 500) {
      this.logger.error(
        'Unhandled request error',
        exception instanceof Error ? exception.stack : String(exception),
        'AllExceptionsFilter',
        { requestId, path: request.url, method: request.method, status },
      );
    } else {
      this.logger.warn(
        'Request rejected',
        { requestId, path: request.url, method: request.method, status, code: body.code },
        'AllExceptionsFilter',
      );
    }

    response.status(status).json({
      error: { ...body, requestId },
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.validationFailed;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.unauthorized;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.forbidden;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.notFound;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.conflict;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.rateLimited;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ERROR_CODES.payloadTooLarge;
      default:
        return status >= 500 ? ERROR_CODES.internalError : ERROR_CODES.validationFailed;
    }
  }

  private isPayloadTooLarge(exception: unknown): boolean {
    if (typeof exception !== 'object' || exception === null) return false;
    const candidate = exception as { type?: string; status?: number };
    return candidate.type === 'entity.too.large' || candidate.status === HttpStatus.PAYLOAD_TOO_LARGE;
  }
}
