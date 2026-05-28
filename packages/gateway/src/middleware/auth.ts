import { AppError } from '@confer/shared';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { getEnv } from '../env.js';

export interface AuthPayload {
  sub: string;
  username: string;
}

export const authMiddleware = createMiddleware<{
  Variables: { user: AuthPayload };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('unauthorized', 'Missing or invalid authorization header', 401);
  }

  const token = header.slice(7);
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  try {
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
    });

    c.set('user', {
      sub: payload.sub as string,
      username: payload.username as string,
    });
  } catch {
    throw new AppError('unauthorized', 'Invalid or expired token', 401);
  }

  await next();
});
