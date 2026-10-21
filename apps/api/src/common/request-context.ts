import type { Request } from 'express';

export interface AuthenticatedActor {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: Set<string>;
  sessionId: string;
  mustChangePassword: boolean;
}

export interface RequestWithContext extends Request {
  requestId?: string;
  actor?: AuthenticatedActor;
}

export function requestIdOf(request: RequestWithContext): string {
  return request.requestId ?? 'unknown';
}
