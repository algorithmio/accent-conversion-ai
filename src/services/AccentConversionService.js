const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const speechService = require('./SpeechService');

class AccentConversionService {
  constructor() {
    if (AccentConversionService.instance) {
      return AccentConversionService.instance;
    }
    
    this.uploadsDir = path.join(process.cwd(), 'uploads');
    this.convertedDir = path.join(process.cwd(), 'converted');
    
    // Ensure directories exist
    this.ensureDirectoryExists(this.uploadsDir);
    this.ensureDirectoryExists(this.convertedDir);
    
    AccentConversionService.instance = this;
  }

  /**
   * Ensures a directory exists, creates it if it doesn't
   * @param {string} dirPath - Directory path
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Converts audio from Indian accent to British accent
   * @param {string} inputFilePath - Path to the input audio file
   * @returns {Promise<string>} - Path to the converted audio file
   */
  async convertAccent(inputFilePath) {
    try {
      // Step 1: Convert speech to text (Indian accent)
      const transcription = await speechService.convertSpeechToText(inputFilePath);
      
      // Step 2: Convert text back to speech with British accent
      const outputFileName = `${uuidv4()}.mp3`;
      const outputFilePath = path.join(this.convertedDir, outputFileName);
      
      await speechService.convertTextToSpeech(transcription, outputFilePath);
      
      return {
        originalText: transcription,
        convertedAudioPath: outputFilePath
      };
    } catch (error) {
      console.error('Error in accent conversion:', error);
      throw error;
    }
  }
}

module.exports = new AccentConversionService(); 