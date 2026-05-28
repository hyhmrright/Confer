import { AppError } from '@confer/shared';
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.status as 400);
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid request data',
          details: err.flatten().fieldErrors,
        },
      },
      400,
    );
  }

  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
      },
    },
    500,
  );
};
