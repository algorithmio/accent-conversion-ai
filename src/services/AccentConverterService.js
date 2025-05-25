const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * AccentConverterService - Handles accent conversion using Google Cloud TTS
 */
class AccentConverterService {
  constructor() {
    this.initializeClients();
  }

  /**
   * Get the singleton instance
   * @returns {AccentConverterService} The singleton instance
   */
  static getInstance() {
    if (!AccentConverterService.instance) {
      AccentConverterService.instance = new AccentConverterService();
    }
    return AccentConverterService.instance;
  }

  /**
   * Initialize Google Cloud clients with appropriate credentials
   */
  initializeClients() {
    try {
      const credentialsPath = path.join(__dirname, '../../config/creds.json');
      const hasCredentials = fs.existsSync(credentialsPath);

      if (hasCredentials) {
        logger.info('Using Google Cloud credentials from config/creds.json');
        this.ttsClient = new textToSpeech.TextToSpeechClient({
          keyFilename: credentialsPath
        });
      } else if (process.env.GOOGLE_API_KEY) {
        logger.info('Using Google API Key from environment variables');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
        this.ttsClient = new textToSpeech.TextToSpeechClient();
      } else {
        throw new Error('No authentication credentials found. Please provide a credentials file or API key.');
      }
    } catch (error) {
      logger.error('Error initializing Google Cloud clients:', error.message);
      throw error;
    }
  }

  /**
   * Convert text to speech with British accent
   * @param {string} text - The text to convert
   * @returns {Promise<Buffer|null>} - The audio buffer or null if failed
   */
  async convertTextToBritishAccent(text) {
    if (!text || text.trim() === '') {
      logger.warn('Empty text provided for accent conversion');
      return null;
    }

    try {
      logger.info(`Converting text to British accent: ${text}`);
      
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text },
        voice: { 
          languageCode: 'en-GB', 
          name: 'en-GB-Neural2-B',
          ssmlGender: 'MALE' 
        },
        audioConfig: { 
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,
          pitch: 0.0,
          speakingRate: 1.0
        },
      });
      
      return response.audioContent;
    } catch (error) {
      logger.error('Error synthesizing speech:', error.message);
      return null;
    }
  }

  /**
   * Save audio buffer to a file (useful for debugging)
   * @param {Buffer} audioBuffer - The audio buffer to save
   * @param {string} filename - The filename to save to
   * @returns {Promise<string>} - The path to the saved file
   */
  async saveAudioToFile(audioBuffer, filename) {
    const outputDir = path.join(__dirname, '../../temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, filename);
    
    return new Promise((resolve, reject) => {
      fs.writeFile(outputFile, audioBuffer, (err) => {
        if (err) {
          logger.error('Error saving audio file:', err);
          reject(err);
        } else {
          logger.info(`Audio saved to ${outputFile}`);
          resolve(outputFile);
        }
      });
    });
  }

  /**
   * Stream TTS response directly to Twilio (for future improvement)
   * @param {string} text - The text to convert
   * @param {Response} res - Express response object
   */
  async streamTTSResponse(text, res) {
    try {
      const audioContent = await this.convertTextToBritishAccent(text);
      
      if (audioContent) {
        // Set appropriate headers
        res.set('Content-Type', 'audio/mpeg');
        res.send(audioContent);
      } else {
        res.status(500).send('Failed to generate audio');
      }
    } catch (error) {
      logger.error('Error streaming TTS response:', error);
      res.status(500).send('Error generating audio stream');
    }
  }
}

module.exports = AccentConverterService; 