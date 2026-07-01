// Pure selection of the AI Video source inputs from a parsed request. Extracted
// from videoController so it's unit-testable WITHOUT importing the controller's
// DB/Redis/S3 graph, and so the field-name + `req.files` contract is locked.
//
// THE BUG THIS GUARDS AGAINST: the route briefly used multer `.single('photo')`
// (which populates `req.file`, leaving `req.files` undefined) while the
// controller read `req.files.photo` (multer `.fields`). A camera-roll upload was
// then silently dropped and the request 400'd with NO_SOURCE. selectVideoSources
// reads exactly `files.photo[0]` / `files.photo2[0]`, so its tests pin both the
// field names AND that sources come from `req.files` (a `.fields` upload).

export interface VideoSourceInput {
  file?: Express.Multer.File;
  sourceJobId?: string;
  bodyPhoto?: string; // 'full' | 'medium'
}

export interface SelectedVideoSources {
  primary: VideoSourceInput | null; // null = nothing chosen for this slot
  second: VideoSourceInput | null; // the optional transition image
}

export interface VideoRequestFiles {
  photo?: Express.Multer.File[];
  photo2?: Express.Multer.File[];
}

function slot(
  file: Express.Multer.File | undefined,
  sourceJobId: string,
  bodyPhoto: string,
): VideoSourceInput | null {
  if (file) return { file };
  if (sourceJobId) return { sourceJobId };
  if (bodyPhoto === 'full' || bodyPhoto === 'medium') return { bodyPhoto };
  return null;
}

export function selectVideoSources(
  body: Record<string, unknown> | undefined,
  files: VideoRequestFiles | undefined,
): SelectedVideoSources {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return {
    primary: slot(files?.photo?.[0], str(body?.sourceJobId), str(body?.bodyPhoto)),
    second: slot(files?.photo2?.[0], str(body?.sourceJobId2), str(body?.bodyPhoto2)),
  };
}
