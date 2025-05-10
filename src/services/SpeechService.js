const axios = require('axios');
const fs = require('fs');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

class SpeechService {
  constructor() {
    if (SpeechService.instance) {
      return SpeechService.instance;
    }
    
    this.apiKey = process.env.GOOGLE_API_KEY;
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is not set');
    }
    
    // Define the API endpoints
    this.speechEndpoint = 'https://speech.googleapis.com/v1/speech:recognize';
    this.ttsEndpoint = 'https://texttospeech.googleapis.com/v1/text:synthesize';
    
    console.log('SpeechService initialized with API key');
    
    SpeechService.instance = this;
  }

  /**
   * Recognizes speech in audio data (non-streaming version)
   * @param {Buffer} audioData - Audio data buffer
   * @returns {Promise<Object>} - Recognition result with transcript and confidence
   */
  async recognizeSpeech(audioData) {
    try {
      console.log(`Processing audio data: ${audioData.length} bytes`);
      
      // Convert buffer to base64
      const audioBytes = audioData.toString('base64');
      
      // Configure the request
      const requestData = {
        audio: {
          content: audioBytes,
        },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-IN', // Indian English
          enableAutomaticPunctuation: true,
          model: 'default',
        },
      };

      // Send request to Google Speech API with API key in URL
      console.log('Sending request to Speech API');
      const response = await axios.post(
        `${this.speechEndpoint}?key=${this.apiKey}`,
        requestData
      );
      
      console.log('Received response from Speech API');
      
      // Check if we got results
      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        const transcript = result.alternatives[0].transcript;
        const confidence = result.alternatives[0].confidence;
        
        console.log(`Transcript: "${transcript}" (confidence: ${confidence})`);
        
        return {
          transcript,
          confidence,
          isFinal: true
        };
      }
      
      console.log('No speech recognition results');
      return {
        transcript: '',
        confidence: 0,
        isFinal: true
      };
    } catch (error) {
      console.error('Error recognizing speech:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Converts text to speech with British accent for streaming
   * @param {string} text - Text to convert to speech
   * @returns {Promise<Buffer>} - Audio content buffer
   */
  async convertTextToSpeechStream(text) {
    try {
      // Skip empty text
      if (!text || text.trim() === '') {
        console.log('Empty text provided, returning empty buffer');
        return Buffer.alloc(0);
      }
      
      console.log(`Converting text to speech: "${text}"`);
      
      // Configure the request
      const requestData = {
        input: { text: text },
        voice: {
          languageCode: 'en-GB', // British English
          name: 'en-GB-Neural2-B', // Using a British voice
          ssmlGender: 'MALE',
        },
        audioConfig: {
          audioEncoding: 'MP3',
        },
      };

      // Send request to Google TTS API with API key in URL
      console.log('Sending request to Text-to-Speech API');
      const response = await axios.post(
        `${this.ttsEndpoint}?key=${this.apiKey}`,
        requestData
      );
      
      console.log('Received response from Text-to-Speech API');
      
      // The response contains audioContent as base64
      if (response.data && response.data.audioContent) {
        console.log(`Audio content received (${response.data.audioContent.length} characters base64)`);
        // Convert base64 string to Buffer
        return Buffer.from(response.data.audioContent, 'base64');
      } else {
        console.error('Response does not contain audioContent:', response.data);
        return Buffer.alloc(0);
      }
    } catch (error) {
      console.error('Error converting text to speech for streaming:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Converts audio to text using Google Speech-to-Text
   * @param {string} audioFilePath - Path to the audio file
   * @returns {Promise<string>} - Transcribed text
   */
  async convertSpeechToText(audioFilePath) {
    try {
      // Read the audio file
      const file = fs.readFileSync(audioFilePath);
      const audioBytes = file.toString('base64');

      // Configure the request
      const requestData = {
        audio: {
          content: audioBytes,
        },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-IN', // Indian English
        },
      };

      // Send request to Google Speech API with API key in URL
      const response = await axios.post(
        `${this.speechEndpoint}?key=${this.apiKey}`,
        requestData
      );
      
      const transcription = response.data.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      
      return transcription;
    } catch (error) {
      console.error('Error converting speech to text:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Converts text to speech with British accent
   * @param {string} text - Text to convert to speech
   * @param {string} outputFilePath - Path to save the audio file
   * @returns {Promise<string>} - Path to the saved audio file
   */
  async convertTextToSpeech(text, outputFilePath) {
    try {
      // Configure the request
      const requestData = {
        input: { text: text },
        voice: {
          languageCode: 'en-GB', // British English
          name: 'en-GB-Neural2-B', // Using a British voice
          ssmlGender: 'MALE',
        },
        audioConfig: {
          audioEncoding: 'MP3',
        },
      };

      // Send request to Google TTS API with API key in URL
      const response = await axios.post(
        `${this.ttsEndpoint}?key=${this.apiKey}`,
        requestData
      );
      
      // The response contains audioContent as base64
      if (response.data && response.data.audioContent) {
        // Write the audio content to a file
        await writeFile(outputFilePath, Buffer.from(response.data.audioContent, 'base64'));
        return outputFilePath;
      } else {
        throw new Error('Response does not contain audioContent');
      }
    } catch (error) {
      console.error('Error converting text to speech:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new SpeechService(); 