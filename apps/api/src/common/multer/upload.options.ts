import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

// Limites communes pour les endpoints d'upload de fichiers : empêche l'abus
// de stockage / DoS via des fichiers volumineux ou de type inattendu.
// Concerne en particulier les endpoints d'ingestion de captures (accessibles
// par clé de service machine-à-machine, donc sans quota utilisateur naturel).

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ATTACHMENT_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);

export const imageUploadOptions = (maxSizeBytes = 8 * 1024 * 1024): MulterOptions => ({
  limits: {
    fileSize: maxSizeBytes,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Type de fichier non autorisé (image JPEG/PNG/WebP attendue).'), false);
      return;
    }
    callback(null, true);
  },
});

export const attachmentUploadOptions = (maxSizeBytes = 20 * 1024 * 1024): MulterOptions => ({
  limits: {
    fileSize: maxSizeBytes,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      callback(new BadRequestException('Type de fichier non autorisé (image ou PDF attendu).'), false);
      return;
    }
    callback(null, true);
  },
});
