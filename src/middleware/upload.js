const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Map MIME type → safe extension (never trust the user-supplied filename extension)
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
};

function createStorage(subfolder) {
  return multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads', subfolder),
    filename: (req, file, cb) => {
      // Derive extension from validated MIME type, NOT from user-supplied filename
      const ext = MIME_TO_EXT[file.mimetype] || '';
      if (!ext) {
        return cb(new Error('Unrecognized file type'), false);
      }
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  });
}

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function fileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'), false);
  }
}

const ALLOWED_DOC_MIMES = [
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

function documentFileFilter(req, file, cb) {
  if (ALLOWED_DOC_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Accepted: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, and images.'), false);
  }
}

const limits = { fileSize: 5 * 1024 * 1024 }; // 5MB

const uploadProfile = multer({ storage: createStorage('profiles'), fileFilter, limits });
const uploadAnnouncement = multer({ storage: createStorage('announcements'), fileFilter, limits });
const uploadLostFound = multer({ storage: createStorage('lostfound'), fileFilter, limits });
const uploadEvent = multer({ storage: createStorage('events'), fileFilter, limits });
const uploadFeedback = multer({ storage: createStorage('feedback'), fileFilter, limits });
const uploadDocument = multer({ storage: createStorage('documents'), fileFilter: documentFileFilter, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB for documents

// CSV upload — uses memory storage (no file kept on disk, we parse and discard)
function csvFileFilter(req, file, cb) {
  const ok = file.mimetype === 'text/csv' ||
             file.mimetype === 'application/vnd.ms-excel' ||
             file.mimetype === 'text/plain' ||
             file.originalname.toLowerCase().endsWith('.csv');
  if (ok) cb(null, true);
  else cb(new Error('Only CSV files are allowed. Save your Excel sheet as CSV (File → Save As → CSV).'), false);
}
const uploadCsv = multer({ storage: multer.memoryStorage(), fileFilter: csvFileFilter, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB

module.exports = { uploadAnnouncement, uploadLostFound, uploadEvent, uploadFeedback, uploadDocument, uploadCsv, uploadProfile };
