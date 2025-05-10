const speech = require("@google-cloud/speech");
const path = require("path");

class TranscriptionService {
  constructor() {
    if (TranscriptionService.instance) {
      return TranscriptionService.instance;
    }

    this.client = new speech.SpeechClient({
      keyFilename: path.join(__dirname, "../../config/creds.json"),
    });
    TranscriptionService.instance = this;
  }

  /**
   * Transcribes audio data using Google Cloud Speech-to-Text
   * @param {Buffer} audioData - Audio data buffer
   * @param {Object} options - Optional configuration
   * @param {string} options.languageCode - Language code (default: 'en-IN')
   * @param {string} options.encoding - Audio encoding (default: 'MP3')
   * @param {number} options.sampleRateHertz - Sample rate in Hz (default: 16000)
   * @returns {Promise<{transcript: string, confidence: number, words: Array}>} - Transcription result
   */
  async transcribe(audioData, options = {}) {
    try {
      // Configure the request
      const request = {
        audio: {
          content: audioData.toString("base64"),
        },
        config: {
          encoding: options.encoding || "MP3",
          sampleRateHertz: options.sampleRateHertz || 16000,
          languageCode: options.languageCode || "en-IN",
          enableAutomaticPunctuation: true,
          model: "telephony",
          useEnhanced: true,
          enableWordTimeOffsets: true,
          enableWordConfidence: true,
          speechContexts: [
            {
              phrases: ["Indian English", "accent", "pronunciation"],
              boost: 20,
            },
          ],
        },
      };

      // Perform the transcription
      const [response] = await this.client.recognize(request);

      // Check if we got results
      if (response.results && response.results.length > 0) {
        const result = response.results[0];
        return {
          transcript: result.alternatives[0].transcript,
          confidence: result.alternatives[0].confidence,
          words: result.alternatives[0].words || [],
        };
      }

      return {
        transcript: "",
        confidence: 0,
        words: [],
      };
    } catch (error) {
      console.error("Error transcribing audio:", error);
      throw error;
    }
  }

  /**
   * Creates a streaming transcription request
   * @returns {Object} Streaming request object
   */
  createStreamingRequest() {
    return this.client.streamingRecognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "en-IN",
        enableAutomaticPunctuation: true,
        model: "telephony",
        useEnhanced: true,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        speechContexts: [
          {
            phrases: ["Indian English", "accent", "pronunciation"],
            boost: 20,
          },
        ],
      },
      interimResults: true,
    });
  }
}

module.exports = new TranscriptionService();
