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
        languageCode: 'en-IN', // Indian English
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
      interimResults: false, // Only get final results for conversion
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
    let isStreamActive = true;

    // Create a recognition stream
    const recognizeStream = this.sttClient.streamingRecognize(this.createSTTConfig())
      .on('data', (data) => {
        try {
          if (!data.results || !data.results[0]) return;
          
          const result = data.results[0];
          if (!result.alternatives || !result.alternatives[0]) return;
          
          const transcript = result.alternatives[0].transcript;
          
          if (result.isFinal && transcript && transcript.trim() !== '' && transcript !== lastTranscript) {
            logger.info(`Transcribed: ${transcript}`);
            lastTranscript = transcript;
            
            // Call the callback with the transcript
            if (onTranscriptCallback && typeof onTranscriptCallback === 'function') {
              onTranscriptCallback(transcript);
            }
          }
        } catch (error) {
          logger.error('Error processing recognition data:', error);
        }
      })
      .on('error', (error) => {
        logger.error('Recognition error:', error.message || error);
        isStreamActive = false;
        
        // Try to recreate the stream after a short delay
        setTimeout(() => {
          if (onTranscriptCallback) {
            logger.info('Attempting to recreate recognition stream...');
            this.createStreamHandler(onTranscriptCallback);
          }
        }, 1000);
      })
      .on('end', () => {
        logger.info('Speech recognition stream ended');
        isStreamActive = false;
      });

    // Add a method to check if stream is active
    recognizeStream.isActive = () => isStreamActive;

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
          audioEncoding: 'MULAW',  // MULAW format for Twilio compatibility
          sampleRateHertz: 8000,   // Twilio's sample rate
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
}

module.exports = StreamingAccentConverter; 