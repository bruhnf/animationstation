/**
 * Classify an image-load failure by probing the URL's HTTP status.
 *
 * React Native's <Image> onError gives no HTTP status, so RetryableImage
 * can't tell a transient blip (worth a retry button) from a permanently
 * dead reference (S3 object deleted → 404 NoSuchKey, or presigned URL
 * expired/denied → 403). After retries are exhausted it probes the URL with
 * a 1-byte ranged GET and feeds the status here.
 *
 * 403/404 → 'permanent': retrying the same URL can never succeed. The UI
 * shows a quiet "Image unavailable" instead of a tap-to-reload that lies.
 * (A 403 from an *expired* presigned URL is also unfixable by retrying —
 * the screen must re-fetch its data to mint fresh URLs, which pull-to-refresh
 * does; the retry button on the same URL still can't work.)
 *
 * Everything else (5xx, 429, network failure → null) → 'transient': keep the
 * tap-to-reload affordance.
 */
export type ImageFailureKind = 'permanent' | 'transient';

export function classifyImageProbe(status: number | null): ImageFailureKind {
  if (status === 403 || status === 404 || status === 410) return 'permanent';
  return 'transient';
}
