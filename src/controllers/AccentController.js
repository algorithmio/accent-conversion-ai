const path = require('path');
const fs = require('fs');
const accentConversionService = require('../services/AccentConversionService');

class AccentController {
  constructor() {
    if (AccentController.instance) {
      return AccentController.instance;
    }
    
    AccentController.instance = this;
  }

  /**
   * Handles audio file upload and accent conversion
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async convertAccent(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded' });
      }

      const inputFilePath = req.file.path;
      
      // Process the file for accent conversion
      const result = await accentConversionService.convertAccent(inputFilePath);
      
      // Return the paths and transcription
      res.json({
        success: true,
        originalText: result.originalText,
        convertedAudioUrl: `/download/${path.basename(result.convertedAudioPath)}`
      });
    } catch (error) {
      console.error('Error in accent conversion controller:', error);
      res.status(500).json({ error: 'Failed to process audio file', details: error.message });
    }
  }

  /**
   * Handles download of converted audio file
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  downloadConvertedAudio(req, res) {
    try {
      const fileName = req.params.fileName;
      const filePath = path.join(process.cwd(), 'converted', fileName);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      res.download(filePath);
    } catch (error) {
      console.error('Error downloading converted audio:', error);
      res.status(500).json({ error: 'Failed to download file', details: error.message });
    }
  }
}

module.exports = new AccentController(); 