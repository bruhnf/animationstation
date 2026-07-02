import multer from 'multer';
import path from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const storage = multer.memoryStorage();

// Sentinel set on the fileFilter rejection so the error wrapper below can map an
// unsupported file type to a 415 (multer surfaces it as a generic Error, not a
// MulterError, so we tag it to tell it apart from a real internal error).
const INVALID_FILE_TYPE = 'INVALID_FILE_TYPE';

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error('Only JPEG, PNG, WebP, and HEIC images are allowed') as Error & {
      code?: string;
    };
    err.code = INVALID_FILE_TYPE;
    cb(err);
  }
}

// Wrap a multer middleware so upload failures return actionable 4xx responses
// instead of falling through to the global handler as an opaque 500. Without
// this, an oversized photo, a wrong file type, or too many files all surface to
// the user as "Internal server error".
function withUploadErrors(mw: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            res.status(413).json({ error: 'Image is too large. Maximum size is 10 MB.' });
            return;
          case 'LIMIT_FILE_COUNT':
          case 'LIMIT_UNEXPECTED_FILE':
            res
              .status(400)
              .json({ error: 'Unexpected upload. Send exactly one image in the "photos" field.' });
            return;
          default:
            res.status(400).json({ error: `Upload error: ${err.message}` });
            return;
        }
      }
      if (err && typeof err === 'object' && (err as { code?: string }).code === INVALID_FILE_TYPE) {
        res.status(415).json({ error: (err as Error).message });
        return;
      }
      // Unknown error — let the global error handler deal with it (500).
      next(err);
    });
  };
}

export const uploadSingle = withUploadErrors(
  multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES },
  }).single('photo'),
);

// For creation: only 1 photo allowed
export const uploadMultiple = withUploadErrors(
  multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  }).array('photos', 1),
);

// AI Video: a primary source `photo` plus an OPTIONAL second `photo2` (the
// transition target). Both are camera-roll uploads; the creation / body-photo
// source types come as text fields instead. req.files is keyed by field name.
export const uploadVideoSources = withUploadErrors(
  multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES, files: 2 },
  }).fields([
    { name: 'photo', maxCount: 1 },
    { name: 'photo2', maxCount: 1 },
  ]),
);

export function safeFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  return `${Date.now()}${ext}`;
}
