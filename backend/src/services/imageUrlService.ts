import { getPresignedUrl } from './s3Service';

const READ_TTL_SECONDS = 3600;

async function presignMaybe(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  if (key.startsWith('http')) {
    // Legacy row written before the lockdown — pull the key out of the URL.
    try {
      const parsed = new URL(key);
      key = parsed.pathname.replace(/^\//, '');
    } catch {
      return key;
    }
  }
  return getPresignedUrl(key, READ_TTL_SECONDS);
}

export async function presignUserPhotos<
  T extends {
    avatarUrl?: string | null;
    fullBodyUrl?: string | null;
    mediumBodyUrl?: string | null;
  },
>(user: T): Promise<T> {
  const [avatarUrl, fullBodyUrl, mediumBodyUrl] = await Promise.all([
    presignMaybe(user.avatarUrl),
    presignMaybe(user.fullBodyUrl),
    presignMaybe(user.mediumBodyUrl),
  ]);
  return { ...user, avatarUrl, fullBodyUrl, mediumBodyUrl };
}

export async function presignCreation<
  T extends {
    refImage1Url?: string | null;
    refImage2Url?: string | null;
    sourceImageUrl?: string | null;
    resultImageUrl?: string | null;
    resultImage2Url?: string | null;
    videoUrl?: string | null;
  },
>(job: T): Promise<T> {
  const [refImage1Url, refImage2Url, sourceImageUrl, resultImageUrl, resultImage2Url, videoUrl] =
    await Promise.all([
      presignMaybe(job.refImage1Url),
      presignMaybe(job.refImage2Url),
      presignMaybe(job.sourceImageUrl),
      presignMaybe(job.resultImageUrl),
      presignMaybe(job.resultImage2Url),
      presignMaybe(job.videoUrl),
    ]);
  return {
    ...job,
    refImage1Url,
    refImage2Url,
    sourceImageUrl,
    resultImageUrl,
    resultImage2Url,
    ...(job.videoUrl !== undefined ? { videoUrl } : {}),
  };
}

export async function presignCreations<T extends Parameters<typeof presignCreation>[0]>(
  jobs: T[],
): Promise<T[]> {
  return Promise.all(jobs.map((j) => presignCreation(j)));
}

export async function presignAvatarOnly<T extends { avatarUrl?: string | null }>(
  user: T,
): Promise<T> {
  return { ...user, avatarUrl: await presignMaybe(user.avatarUrl) };
}

// Closet items store their generated outfit image as an S3 key in `imageUrl`.
export async function presignClosetItem<T extends { imageUrl: string }>(item: T): Promise<T> {
  return { ...item, imageUrl: (await presignMaybe(item.imageUrl)) ?? item.imageUrl };
}

export async function presignClosetItems<T extends { imageUrl: string }>(items: T[]): Promise<T[]> {
  return Promise.all(items.map((i) => presignClosetItem(i)));
}
