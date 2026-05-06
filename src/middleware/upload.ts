import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import crypto from 'crypto';
import { Request } from 'express';

// Map MIME type → safe extension (never trust the user-supplied filename extension)
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg':    '.jpg',
  'image/png':     '.png',
  'image/gif':     '.gif',
  'image/webp':    '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
};

function createStorage(subfolder: string): multer.StorageEngine {
  return multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads', subfolder),
    filename: (_req: Request, file: Express.Multer.File, cb) => {
      const ext = MIME_TO_EXT[file.mimetype] || '';
      if (!ext) {
        cb(new Error('Unrecognized file type'), '');
        return;
      }
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });
}

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
  }
}

const ALLOWED_DOC_MIMES: string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  ...ALLOWED_IMAGE_MIMES,
];

function documentFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (ALLOWED_DOC_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Accepted: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, and images.'));
  }
}

function csvFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const ok =
    file.mimetype === 'text/csv' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.mimetype === 'text/plain' ||
    file.originalname.toLowerCase().endsWith('.csv');
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed. Save your Excel sheet as CSV (File → Save As → CSV).'));
  }
}

const imageLimits = { fileSize: 5 * 1024 * 1024 };   // 5 MB

export const uploadProfile      = multer({ storage: createStorage('profiles'),      fileFilter,         limits: imageLimits });
export const uploadAnnouncement = multer({ storage: createStorage('announcements'), fileFilter,         limits: imageLimits });
export const uploadLostFound    = multer({ storage: createStorage('lostfound'),     fileFilter,         limits: imageLimits });
export const uploadEvent        = multer({ storage: createStorage('events'),        fileFilter,         limits: imageLimits });
export const uploadFeedback     = multer({ storage: createStorage('feedback'),      fileFilter,         limits: imageLimits });
export const uploadDocument     = multer({ storage: createStorage('documents'),     fileFilter: documentFileFilter, limits: { fileSize: 25 * 1024 * 1024 } });
export const uploadCsv          = multer({ storage: multer.memoryStorage(),         fileFilter: csvFileFilter,      limits: { fileSize: 2 * 1024 * 1024 } });
