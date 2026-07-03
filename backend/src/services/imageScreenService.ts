// Input-image pre-screen. Before we pay Grok to generate a video/image FROM a
// user's photo, run a cheap AWS Rekognition check on the source image and block
// the obviously-egregious cases up front (no Grok cost, no wasted credit). This
// COMPLEMENTS Grok's own output moderation (the backstop) — it does not replace
// it — and is deliberately conservative to fit the app's permissive policy:
// only hard-block (a) explicit nudity/sexual content, and (b) suggestive content
// on an APPARENT MINOR (the highest-risk category, and the one that motivated
// this). Everything else passes through to Grok.
//
// Fail-open by design: a Rekognition error/outage/misconfigured IAM must never
// block a legitimate generation — it logs loudly and allows, since Grok still
// moderates the output.
import {
  RekognitionClient,
  DetectModerationLabelsCommand,
  DetectFacesCommand,
  Attribute,
} from '@aws-sdk/client-rekognition';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { createChildLogger } from './logger';

const log = createChildLogger('ImageScreenService');

const rekognition = new RekognitionClient({
  region: env.aws.region,
  credentials: env.aws.accessKeyId
    ? { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey }
    : undefined,
});

// ── Config (admin-tunable at runtime via the AppSettings table) ───────────────
export interface ImageScreenConfig {
  enabled: boolean; // master on/off
  enforce: boolean; // true = block; false = SHADOW (log "would block" only)
  explicitConfidence: number; // ≥ this Rekognition confidence on Explicit Nudity → block
  suggestiveConfidence: number; // ≥ this on Suggestive → block ONLY if an apparent minor
  minorAgeHigh: number; // a detected face whose estimated MAX age ≤ this counts as "apparent minor"
}

// Default posture: ON + enforcing, conservative thresholds. Safe to ship with no
// users; tune from the admin dashboard (setImageScreenConfig) after watching real
// traffic. Flip enforce→false for shadow mode.
export const DEFAULT_IMAGE_SCREEN_CONFIG: ImageScreenConfig = {
  enabled: true,
  enforce: true,
  explicitConfidence: 90,
  suggestiveConfidence: 75,
  minorAgeHigh: 20,
};

const CONFIG_KEY = 'imageScreenConfig';

function validateConfig(input: unknown): ImageScreenConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    enabled: bool(o.enabled, DEFAULT_IMAGE_SCREEN_CONFIG.enabled),
    enforce: bool(o.enforce, DEFAULT_IMAGE_SCREEN_CONFIG.enforce),
    explicitConfidence: num(o.explicitConfidence, DEFAULT_IMAGE_SCREEN_CONFIG.explicitConfidence),
    suggestiveConfidence: num(
      o.suggestiveConfidence,
      DEFAULT_IMAGE_SCREEN_CONFIG.suggestiveConfidence,
    ),
    minorAgeHigh: num(o.minorAgeHigh, DEFAULT_IMAGE_SCREEN_CONFIG.minorAgeHigh),
  };
}

export async function getImageScreenConfig(): Promise<ImageScreenConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  if (!row) return DEFAULT_IMAGE_SCREEN_CONFIG;
  try {
    return validateConfig(JSON.parse(row.value));
  } catch (err) {
    log.warn('Stored imageScreenConfig is invalid — using default', {
      error: (err as Error).message,
    });
    return DEFAULT_IMAGE_SCREEN_CONFIG;
  }
}

export async function setImageScreenConfig(input: unknown): Promise<ImageScreenConfig> {
  const cfg = validateConfig(input);
  await prisma.appSetting.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  log.info('Image screen config updated', { ...cfg });
  return cfg;
}

// ── Pure decision (unit-tested in isolation) ──────────────────────────────────
export interface ScreenLabel {
  name: string;
  parent: string;
  confidence: number;
}
export interface ScreenFace {
  ageHigh: number;
}
export interface ScreenDecision {
  block: boolean;
  reason?: 'explicit' | 'suggestive_minor';
  detail?: string;
}

// Rekognition top-level moderation categories we care about (labels also carry
// a ParentName pointing at these). See docs "Moderation API".
const EXPLICIT = new Set(['Explicit Nudity', 'Explicit', 'Sexual Activity']);
const SUGGESTIVE = new Set(['Suggestive', 'Non-Explicit Nudity of Intimate parts and Kissing']);

function matches(set: Set<string>, l: ScreenLabel): boolean {
  return set.has(l.name) || set.has(l.parent);
}

export function screenImageDecision(
  labels: ScreenLabel[],
  faces: ScreenFace[],
  cfg: ImageScreenConfig,
): ScreenDecision {
  // 1. Explicit nudity / sexual content → block regardless of apparent age.
  const explicit = labels.find(
    (l) => matches(EXPLICIT, l) && l.confidence >= cfg.explicitConfidence,
  );
  if (explicit) {
    return {
      block: true,
      reason: 'explicit',
      detail: `${explicit.name} ${explicit.confidence.toFixed(0)}%`,
    };
  }

  // 2. Suggestive/revealing + an APPARENT MINOR → hard block. Age estimation is a
  // heuristic RISK signal (never an authoritative age check), so it only raises
  // the bar on already-suggestive images.
  const suggestive = labels.find(
    (l) => matches(SUGGESTIVE, l) && l.confidence >= cfg.suggestiveConfidence,
  );
  if (suggestive && faces.length > 0) {
    const youngestMax = Math.min(...faces.map((f) => f.ageHigh));
    if (youngestMax <= cfg.minorAgeHigh) {
      return {
        block: true,
        reason: 'suggestive_minor',
        detail: `${suggestive.name} ${suggestive.confidence.toFixed(0)}% + apparent age ≤ ${youngestMax}`,
      };
    }
  }

  return { block: false };
}

// ── S3-object screen (I/O around the pure decision; fail-open) ─────────────────
export async function screenS3Image(
  bucket: string,
  key: string,
  cfg: ImageScreenConfig,
): Promise<ScreenDecision & { errored?: boolean }> {
  try {
    const image = { S3Object: { Bucket: bucket, Name: key } };
    const [mod, face] = await Promise.all([
      rekognition.send(new DetectModerationLabelsCommand({ Image: image, MinConfidence: 50 })),
      rekognition.send(new DetectFacesCommand({ Image: image, Attributes: [Attribute.AGE_RANGE] })),
    ]);
    const labels: ScreenLabel[] = (mod.ModerationLabels ?? []).map((l) => ({
      name: l.Name ?? '',
      parent: l.ParentName ?? '',
      confidence: l.Confidence ?? 0,
    }));
    const faces: ScreenFace[] = (face.FaceDetails ?? []).map((f) => ({
      ageHigh: f.AgeRange?.High ?? Number.POSITIVE_INFINITY,
    }));
    return screenImageDecision(labels, faces, cfg);
  } catch (err) {
    log.error(
      'Rekognition image screen failed — failing OPEN (Grok output moderation is the backstop)',
      {
        key,
        error: (err as Error).message,
      },
    );
    return { block: false, errored: true };
  }
}

export interface GenerationScreenResult {
  blocked: boolean;
  reason?: ScreenDecision['reason'];
  detail?: string;
  key?: string;
}

// Screen every input image for a generation. In enforce mode, returns
// blocked:true on the first egregious image; in shadow mode, only logs.
export async function screenGenerationImages(
  keys: Array<string | null | undefined>,
): Promise<GenerationScreenResult> {
  const cfg = await getImageScreenConfig();
  if (!cfg.enabled) return { blocked: false };
  const bucket = env.aws.s3Bucket;

  for (const key of keys) {
    if (!key) continue;
    const decision = await screenS3Image(bucket, key, cfg);
    if (decision.block) {
      log.warn(
        cfg.enforce
          ? 'Input image blocked by pre-screen (enforced)'
          : 'Input image WOULD be blocked by pre-screen (shadow mode)',
        { key, reason: decision.reason, detail: decision.detail },
      );
      if (cfg.enforce) {
        return { blocked: true, reason: decision.reason, detail: decision.detail, key };
      }
    }
  }
  return { blocked: false };
}

// User-facing 400 message — deliberately non-accusatory and generic.
export const INPUT_MODERATION_MESSAGE =
  "This image can't be used to generate content. Please choose a different image.";
