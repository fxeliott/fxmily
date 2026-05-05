import type { DefaultSession, DefaultUser } from 'next-auth';
import type { JWT as DefaultJWT } from 'next-auth/jwt';
import type { UserRole, UserStatus } from '@/generated/prisma/client';

/**
 * Extends Auth.js types with Fxmily-specific fields propagated through the JWT
 * and exposed to server/client via `auth()` and `useSession()`.
 *
 * Do NOT import this file from runtime code — it's a `.d.ts` ambient module
 * augmentation only.
 */

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    role: UserRole;
    status: UserStatus;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    role?: UserRole;
    status?: UserStatus;
  }
}
