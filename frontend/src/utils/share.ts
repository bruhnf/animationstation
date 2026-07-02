import { Share } from 'react-native';
import { BASE_URL } from '../config/api';

// Public share page for a creation lives at the API host root (/t/<jobId>),
// served by the backend with OpenGraph meta for rich link previews. BASE_URL
// ends in /api, so strip that to get the host.
export function creationShareUrl(jobId: string): string {
  return `${BASE_URL.replace(/\/api\/?$/, '')}/t/${jobId}`;
}

// Open the native share sheet for a (public, completed) creation. No-ops on
// cancel/error — sharing is never critical-path.
export async function shareCreation(jobId: string): Promise<void> {
  const url = creationShareUrl(jobId);
  try {
    await Share.share({
      message: `Check out my AI creation on AnimationStation: ${url}`,
      url,
    });
  } catch {
    // cancelled or unavailable — ignore
  }
}
