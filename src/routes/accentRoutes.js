const express = require('express');
const multer = require('multer');
const path = require('path');
const accentController = require('../controllers/AccentController');

// Set up storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to only accept audio files
const fileFilter = (req, file, cb) => {
  // Accept only common audio formats
  if (file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error('Only audio files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  }
});

const router = express.Router();

// Route for converting accent
router.post('/convert', upload.single('audio'), accentController.convertAccent.bind(accentController));

// Route for downloading converted audio
router.get('/download/:fileName', accentController.downloadConvertedAudio.bind(accentController));

module.exports = router; 