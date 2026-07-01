import type { UserTier } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string | null;
        tier: UserTier;
        credits: number;
        isGuest: boolean;
      };
    }
  }
}

export {};
