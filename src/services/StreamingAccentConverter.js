const speech = require('@google-cloud/speech').v1p1beta1;
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * StreamingAccentConverter - Handles real-time streaming accent conversion
 * This is for future enhancements to support real-time streaming
 */
class StreamingAccentConverter {
  constructor() {
    this.initializeClients();
  }

  /**
   * Get the singleton instance
   * @returns {StreamingAccentConverter} The singleton instance
   */
  static getInstance() {
    if (!StreamingAccentConverter.instance) {
      StreamingAccentConverter.instance = new StreamingAccentConverter();
    }
    return StreamingAccentConverter.instance;
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
        this.sttClient = new speech.SpeechClient({
          keyFilename: credentialsPath
        });
        this.ttsClient = new textToSpeech.TextToSpeechClient({
          keyFilename: credentialsPath
        });
      } else if (process.env.GOOGLE_API_KEY) {
        logger.info('Using Google API Key from environment variables');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
        this.sttClient = new speech.SpeechClient();
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
   * Create STT streaming configuration
   * @returns {Object} Speech recognition request config
   */
  createSTTConfig() {
    return {
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000, // Twilio's sample rate
        languageCode: 'en-IN',
        model: 'telephony',
        useEnhanced: true,
        enableAutomaticPunctuation: true,
        speechContexts: [
          {
            phrases: ["Indian English", "accent", "pronunciation"],
            boost: 10,
          },
        ],
      },
      interimResults: false,
    };
  }

  /**
   * Create stream handler for processing STT results
   * @param {Function} onTranscriptCallback - Callback function for transcripts
   * @returns {Object} Stream handler
   */
  createStreamHandler(onTranscriptCallback) {
    // Last transcript for deduplication
    let lastTranscript = '';

    // Create a recognition stream
    const recognizeStream = this.sttClient.streamingRecognize(this.createSTTConfig())
      .on('data', (data) => {
        if (!data.results || !data.results[0]) return;
        
        const result = data.results[0];
        if (!result.alternatives || !result.alternatives[0]) return;
        
        const transcript = result.alternatives[0].transcript;
        
        if (result.isFinal && transcript !== lastTranscript) {
          logger.info(`Transcribed: ${transcript}`);
          lastTranscript = transcript;
          
          // Call the callback with the transcript
          if (onTranscriptCallback && typeof onTranscriptCallback === 'function') {
            onTranscriptCallback(transcript);
          }
        }
      })
      .on('error', (error) => {
        logger.error('Recognition error:', error.message);
      })
      .on('end', () => {
        logger.info('Speech recognition stream closed');
      });

    return recognizeStream;
  }

  /**
   * Process audio from Twilio Media Stream
   * @param {Stream} twilioStream - Twilio media stream 
   * @param {Function} onTranscriptCallback - Callback function for processing transcripts
   */
  processAudioStream(twilioStream, onTranscriptCallback) {
    try {
      // Create recognize stream
      const recognizeStream = this.createStreamHandler(onTranscriptCallback);
      
      // Pipe the Twilio media stream to the recognize stream
      twilioStream.pipe(recognizeStream);
      
      logger.info('Started processing Twilio audio stream');
      
      // Return the recognize stream for cleanup
      return recognizeStream;
    } catch (error) {
      logger.error('Error processing audio stream:', error);
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
   * Generate a URL for TwiML to play converted audio
   * @param {string} text - Text to convert
   * @param {string} baseUrl - Base URL of the server
   * @returns {Promise<string>} - URL to the audio file
   */
  async generateAudioUrl(text, baseUrl) {
    try {
      const audioContent = await this.convertTextToBritishAccent(text);
      
      if (audioContent) {
        // Generate a unique filename
        const filename = `converted_${Date.now()}.mp3`;
        const filePath = await this.saveAudioToFile(audioContent, filename);
        
        // Create a URL pointing to this audio file
        const audioUrl = `${baseUrl}/audio/${filename}`;
        return audioUrl;
      }
      
      return null;
    } catch (error) {
      logger.error('Error generating audio URL:', error);
      return null;
    }
  }

  /**
   * Save audio buffer to a file
   * @param {Buffer} audioBuffer - The audio buffer to save
   * @param {string} filename - The filename to save to
   * @returns {Promise<string>} - The path to the saved file
   */
  async saveAudioToFile(audioBuffer, filename) {
    const outputDir = path.join(__dirname, '../../public/audio');
    
    // Ensure output directory exists
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
}

module.exports = StreamingAccentConverter; 