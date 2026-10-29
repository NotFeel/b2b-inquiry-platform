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

    const requestAborted = this.isRequestAborted(exception, request);
    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    } else if (this.isPayloadTooLarge(exception) || this.isMulterFileTooLarge(exception)) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      body = { code: ERROR_CODES.payloadTooLarge, message: 'Request payload is too large.' };
    } else if (requestAborted) {
      status = HttpStatus.REQUEST_TIMEOUT;
      body = {
        code: ERROR_CODES.requestAborted,
        message: 'The request was interrupted before it completed. Please retry.',
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
    } else if (this.isMulterError(exception)) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        code: ERROR_CODES.validationFailed,
        message: 'The multipart upload is invalid or incomplete.',
      };
    }

    if (requestAborted) {
      this.logger.warn(
        'Upload request aborted by client',
        { requestId, path: request.url, method: request.method, status, code: body.code },
        'AllExceptionsFilter',
      );
    } else if (status >= 500) {
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

    // Once the socket has gone away, writing another response can emit a second
    // ECONNRESET or an unhandled "headers already sent" error. The request is
    // already accounted for in the warning log above.
    if (response.destroyed || response.writableEnded || response.headersSent) {
      return;
    }
    response.status(status).json({ error: { ...body, requestId } });
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
    return (
      candidate.type === 'entity.too.large' || candidate.status === HttpStatus.PAYLOAD_TOO_LARGE
    );
  }

  private isMulterError(exception: unknown): boolean {
    if (typeof exception !== 'object' || exception === null) return false;
    return (exception as { name?: string }).name === 'MulterError';
  }

  private isMulterFileTooLarge(exception: unknown): boolean {
    if (!this.isMulterError(exception)) return false;
    return (exception as { code?: string }).code === 'LIMIT_FILE_SIZE';
  }

  private isRequestAborted(exception: unknown, request: RequestWithContext): boolean {
    // `request.destroyed` is not sufficient evidence of a client disconnect:
    // some body parsers also destroy an errored request. Trust the explicit
    // Node request flag and known abort errors so a deterministic 413 cannot
    // be misreported as a 408.
    if (request.aborted) return true;
    if (typeof exception !== 'object' || exception === null) return false;
    const candidate = exception as { code?: string; message?: string };
    return (
      candidate.code === 'ECONNRESET' ||
      candidate.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
      candidate.message === 'Request aborted'
    );
  }
}
