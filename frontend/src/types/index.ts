export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export type UserTier = 'FREE' | 'BASIC' | 'PREMIUM';

export interface User {
  id: string;
  username: string;
  // Null for anonymous guest accounts (isGuest=true) until they convert.
  email: string | null;
  verified: boolean;
  // True for an anonymous guest session minted on first app open. Guests can
  // browse and run a free creation, but social write actions prompt signup.
  isGuest?: boolean;
  tier: UserTier;
  credits: number;
  creationCount: number;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarUrl?: string;
  fullBodyUrl?: string;
  mediumBodyUrl?: string;
  followingCount: number;
  followersCount: number;
  likesCount: number;
  city?: string;
  state?: string;
  createdAt: string;
  // Server-derived: true if this user's email is in the backend ADMIN_EMAILS allowlist.
  isAdmin?: boolean;
  // ISO timestamp of the user's most recent explicit consent to send body +
  // clothing photos to xAI's Grok Imagine API. Null = no consent on file or
  // revoked; the creation submit endpoint returns AI_CONSENT_REQUIRED and the
  // client surfaces the AiConsentModal before re-submitting.
  aiProcessingConsentAt?: string | null;
}

export interface Creation {
  id: string;
  userId: string;
  status: JobStatus;
  isPrivate?: boolean;
  refImage1Url?: string;
  refImage2Url?: string;
  resultImageUrl?: string;
  resultImage2Url?: string;
  sourceImageUrl?: string;
  perspectivesUsed: string[];
  // IMAGE = clothing creation; VIDEO = an AI-animated clip. Absent on old payloads
  // (treated as IMAGE).
  kind?: 'IMAGE' | 'VIDEO';
  // VIDEO only: presigned URL of the generated .mp4 (poster = sourceImageUrl).
  videoUrl?: string | null;
  // VIDEO only: the motion/animation prompt the user provided.
  motionPrompt?: string | null;
  // Optional user-authored caption shown under the result image on the feed.
  title?: string | null;
  likesCount?: number;
  commentsCount?: number;
  liked?: boolean;
  // Whether the current user has bookmarked this look (Saved Looks).
  saved?: boolean;
  errorMessage?: string;
  createdAt: string;
  // ISO timestamp set when the backend's soft throttle deferred this
  // submission. Null/absent = the worker will pick it up immediately. The
  // Transform screen uses this to render a "starts in X:XX" countdown while
  // the job sits in BullMQ's delayed set.
  scheduledStartAt?: string | null;
  user?: { username: string; firstName?: string; lastName?: string; avatarUrl?: string };
}

// A saved Outfit Designer creation ("virtual custom clothing"). imageUrl is a
// presigned S3 URL minted by the backend at response time.
export interface ClosetItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  jobId: string;
  userId: string;
  body: string;
  // null for top-level comments; set to a top-level comment's id for replies.
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  };
  likesCount: number;
  liked: boolean;
  // Only populated on top-level comments; replies have an empty array.
  replies?: Comment[];
}

export interface PublicUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  bio?: string;
}

export type NotificationType =
  | 'FOLLOW'
  | 'LIKE'
  | 'CREATION_COMPLETE'
  | 'COMMENT'
  | 'COMMENT_REPLY'
  | 'COMMENT_LIKE';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  jobId?: string | null;
  // Set for COMMENT_REPLY (the parent comment that was replied to) and
  // COMMENT_LIKE (the comment that was liked). Used by the mobile app to
  // deep-link straight into the thread and auto-scroll to that comment.
  commentId?: string | null;
  read: boolean;
  createdAt: string;
  actor?: {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  } | null;
  job?: {
    id: string;
    resultImageUrl?: string;
    resultImage2Url?: string;
  } | null;
}
