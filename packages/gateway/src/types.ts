import type { AuthPayload } from './middleware/auth.js';

export type AppEnv = {
  Variables: {
    user: AuthPayload;
  };
};
