/**
 * Build the admin dashboard URL from APP_URL. The dashboard is served by the
 * backend at `<APP_URL>/admin` (e.g. https://api.tryon-mirror.ai/admin).
 *
 * Pure + side-effect-free so it can be unit-tested. Replaces an earlier
 * `appUrl.replace('/api', '')` that was a bug: `/api` also matches inside
 * `https://api…`, so it corrupted the host (→ `https:/.evofaceflow.com`). We only
 * strip trailing slashes here.
 */
export function adminDashboardUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/admin`;
}
