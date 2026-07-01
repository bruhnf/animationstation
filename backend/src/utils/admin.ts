import { env } from '../config/env';

// True if the given email address is in the ADMIN_EMAILS allowlist.
// Server-side admin endpoints separately require the ADMIN_API_KEY header;
// this flag only controls UI visibility of the Admin Console in the app.
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.adminEmails.includes(email.toLowerCase());
}
