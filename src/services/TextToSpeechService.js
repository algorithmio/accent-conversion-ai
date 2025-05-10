const textToSpeech = require("@google-cloud/text-to-speech");
const fs = require("fs");
const path = require("path");

class TextToSpeechService {
  constructor() {
    if (TextToSpeechService.instance) {
      return TextToSpeechService.instance;
    }

    this.client = new textToSpeech.TextToSpeechClient({
      keyFilename: path.join(__dirname, "../../config/creds.json"),
    });
    TextToSpeechService.instance = this;
  }

  /**
   * Converts text to speech using Google Cloud Text-to-Speech
   * @param {string} text - Text to convert to speech
   * @param {Object} options - Optional configuration
   * @param {string} options.voiceName - Voice name (default: 'en-GB-Standard-A')
   * @param {string} options.outputFile - Path to save the audio file
   * @param {number} options.speakingRate - Speaking rate (default: 1.0)
   * @param {number} options.pitch - Voice pitch (default: 0.0)
   * @returns {Promise<{audioContent: Buffer, audioConfig: Object}>} - Audio data and configuration
   */
  async synthesize(text, options = {}) {
    try {
      const request = {
        input: { text },
        voice: {
          languageCode: "en-GB",
          name: options.voiceName || "en-GB-Standard-A",
          ssmlGender: "FEMALE",
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: options.speakingRate || 1.0,
          pitch: options.pitch || 0.0,
          volumeGainDb: 0.0,
          effectsProfileId: ["large-home-entertainment-class-device"],
        },
      };

      const [response] = await this.client.synthesizeSpeech(request);
      const audioContent = Buffer.from(response.audioContent);

      // Save to file if outputFile is provided
      if (options.outputFile) {
        fs.writeFileSync(options.outputFile, audioContent);
      }

      return {
        audioContent,
        audioConfig: request.audioConfig,
      };
    } catch (error) {
      console.error("Error synthesizing speech:", error);
      throw error;
    }
  }

  /**
   * Lists available voices for a specific language
   * @param {string} languageCode - Language code (default: 'en-GB')
   * @returns {Promise<Array>} List of available voices
   */
  async listVoices(languageCode = "en-GB") {
    try {
      const [response] = await this.client.listVoices();
      return response.voices.filter((voice) =>
        voice.languageCodes.includes(languageCode)
      );
    } catch (error) {
      console.error("Error listing voices:", error);
      throw error;
    }
  }
}

module.exports = new TextToSpeechService();
