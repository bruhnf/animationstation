// Pure interpreter for an xAI Grok video-generation poll response. Extracted
// from grokService.generateVideo so the success-vs-moderation decision is
// unit-testable in isolation — and so the field-name bug can't come back.
//
// THE BUG THIS GUARDS AGAINST: a successful poll response contains a NORMAL
// field `respect_moderation: true` (e.g. inside `video`). An earlier
// implementation did `/moderat/i.test(body)`, which matched that field NAME and
// classified EVERY video as content-blocked, discarding good clips before they
// could be saved to S3. Rule: SUCCESS (status done + a video url) is decided
// first and always wins; "moderated" requires the explicit structured flag
// `respect_moderation === false` with no usable video.

export interface VideoPollResponse {
  status?: string;
  video?: { url?: string; respect_moderation?: boolean };
  respect_moderation?: boolean;
}

export type VideoPollVerdict =
  | { kind: 'success'; url: string }
  | { kind: 'moderated' }
  | { kind: 'failed' }
  | { kind: 'pending' };

export function classifyVideoPoll(data: VideoPollResponse): VideoPollVerdict {
  // Success first — a finished clip with a URL is delivered regardless of any
  // other field (never confuse `respect_moderation:true` for a block).
  if (data.status === 'done' && data.video?.url) {
    return { kind: 'success', url: data.video.url };
  }
  // Real content block: explicit structured flag, and (implicitly) no usable
  // video since the success check above already returned.
  if (data.respect_moderation === false || data.video?.respect_moderation === false) {
    return { kind: 'moderated' };
  }
  if (data.status === 'failed' || data.status === 'error') {
    return { kind: 'failed' };
  }
  return { kind: 'pending' };
}
