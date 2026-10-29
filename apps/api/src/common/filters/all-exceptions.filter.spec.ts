import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { ERROR_CODES } from '@b2b/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../logger.service';
import { AllExceptionsFilter } from './all-exceptions.filter';

function context(request: Record<string, unknown> = {}) {
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        requestId: 'request-1',
        url: '/api/v1/admin/products/bulk-import/uploads/id/chunks/0',
        method: 'PUT',
        aborted: false,
        ...request,
      }),
    }),
  } as unknown as ArgumentsHost;
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as JsonLogger;
  return { filter: new AllExceptionsFilter(logger), host, response, logger };
}

describe('AllExceptionsFilter upload errors', () => {
  it('maps a client request abort to a visible 408 instead of logging a 500', () => {
    const { filter, host, response, logger } = context();
    const error = new Error('Request aborted');

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.REQUEST_TIMEOUT);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: ERROR_CODES.requestAborted, requestId: 'request-1' }),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Upload request aborted by client',
      expect.objectContaining({ status: HttpStatus.REQUEST_TIMEOUT }),
      'AllExceptionsFilter',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps Multer file-size rejection to 413', () => {
    const { filter, host, response } = context();

    filter.catch({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' }, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: ERROR_CODES.payloadTooLarge, requestId: 'request-1' }),
    });
  });

  it('keeps an unexpected ordinary error as a 500 with a generic response body', () => {
    const { filter, host, response, logger } = context();

    filter.catch(new Error('database credentials must not leak'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: ERROR_CODES.internalError,
        message: 'Unexpected server error.',
        requestId: 'request-1',
      },
    });
    expect(logger.error).toHaveBeenCalled();
  });
});
