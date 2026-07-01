import { useUserStore } from '../store/useUserStore';

export type BodyPhotoAvailability = {
  hasAvatar: boolean;
  hasFullBody: boolean;
  hasMedium: boolean;
  hasTryOnCapability: boolean;
  primaryPerspective: 'full_body' | 'medium' | null;
  availablePerspectives: ('full_body' | 'medium')[];
};

export function useBodyPhotos(): BodyPhotoAvailability {
  const user = useUserStore((s) => s.user);

  const hasAvatar = !!user?.avatarUrl;
  const hasFullBody = !!user?.fullBodyUrl;
  const hasMedium = !!user?.mediumBodyUrl;
  const hasTryOnCapability = hasFullBody || hasMedium;

  const availablePerspectives: ('full_body' | 'medium')[] = [];
  if (hasFullBody) availablePerspectives.push('full_body');
  if (hasMedium) availablePerspectives.push('medium');

  const primaryPerspective = hasFullBody ? 'full_body' : hasMedium ? 'medium' : null;

  return {
    hasAvatar,
    hasFullBody,
    hasMedium,
    hasTryOnCapability,
    primaryPerspective,
    availablePerspectives,
  };
}
