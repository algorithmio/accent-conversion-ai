const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const { Readable } = require('stream');

class StreamingAccentService {
  constructor() {
    if (StreamingAccentService.instance) {
      return StreamingAccentService.instance;
    }
    
    // Initialize Speech-to-Text client
    this.speechClient = new speech.SpeechClient({
      keyFilename: path.join(__dirname, "../../config/creds.json"),
    });
    
    // Initialize Text-to-Speech client
    this.ttsClient = new textToSpeech.TextToSpeechClient({
      keyFilename: path.join(__dirname, "../../config/creds.json"),
    });
    
    // Cache for recent transcriptions to avoid duplicate TTS calls
    this.transcriptionCache = new Map();
    
    StreamingAccentService.instance = this;
  }

  /**
   * Creates a streaming accent conversion session
   * @param {Function} transcriptionCallback - Callback for transcription results
   * @param {Function} audioCallback - Callback for converted audio results
   * @param {Function} errorCallback - Callback for errors
   * @returns {Object} - Stream control object
   */
  createStreamingSession(transcriptionCallback, audioCallback, errorCallback) {
    try {
      // Create a streaming recognition request
      const recognizeStream = this.speechClient.streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-IN', // Indian English
          enableAutomaticPunctuation: true,
          model: 'telephony',
          useEnhanced: true,
          enableWordTimeOffsets: true,
        },
        interimResults: true,
      });

      // Handle streaming recognition results
      recognizeStream.on('data', async (data) => {
        if (!data.results || !data.results[0]) return;
        
        const result = data.results[0];
        const transcript = result.alternatives[0].transcript;
        const isFinal = result.isFinal;
        
        // Only process non-empty transcripts
        if (transcript.trim() === '') return;
        
        // Send the transcription
        transcriptionCallback({
          text: transcript,
          isFinal: isFinal
        });
        
        // If this is a final result, convert to British English accent
        if (isFinal) {
          try {
            // Check cache first to avoid duplicate TTS requests
            const cacheKey = transcript.trim();
            if (!this.transcriptionCache.has(cacheKey)) {
              const audioContent = await this.convertTextToSpeech(transcript);
              this.transcriptionCache.set(cacheKey, audioContent);
              
              // Limit cache size to avoid memory issues
              if (this.transcriptionCache.size > 100) {
                const oldestKey = this.transcriptionCache.keys().next().value;
                this.transcriptionCache.delete(oldestKey);
              }
            }
            
            // Send the audio result
            audioCallback({
              audio: this.transcriptionCache.get(cacheKey).toString('base64'),
              text: transcript
            });
          } catch (error) {
            errorCallback(error);
          }
        }
      });

      // Handle errors
      recognizeStream.on('error', (error) => {
        console.error('Streaming recognition error:', error);
        errorCallback(error);
      });

      // Handle end of recognition stream
      recognizeStream.on('end', () => {
        console.log('Streaming recognition ended');
      });

      // Return stream control object
      return {
        writeAudio: (audioChunk) => {
          try {
            recognizeStream.write(audioChunk);
          } catch (error) {
            console.error('Error writing to recognition stream:', error);
            errorCallback(error);
          }
        },
        close: () => {
          try {
            recognizeStream.end();
          } catch (error) {
            console.error('Error closing recognition stream:', error);
          }
        }
      };
    } catch (error) {
      console.error('Error creating streaming session:', error);
      errorCallback(error);
      return null;
    }
  }

  /**
   * Converts text to speech with British accent
   * @param {string} text - Text to convert
   * @returns {Promise<Buffer>} - Audio buffer
   */
  async convertTextToSpeech(text) {
    try {
      // Configure request
      const request = {
        input: { text },
        voice: {
          languageCode: 'en-GB',
          name: 'en-GB-Neural2-B', // Using a British voice
          ssmlGender: 'MALE',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0.0,
        },
      };

      // Synthesize speech
      const [response] = await this.ttsClient.synthesizeSpeech(request);
      return Buffer.from(response.audioContent);
    } catch (error) {
      console.error('Error converting text to speech:', error);
      throw error;
    }
  }
}

module.exports = new StreamingAccentService(); 