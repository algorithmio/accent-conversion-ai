const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { EventEmitter } = require('events');

class DeepgramStreamingService extends EventEmitter {
  constructor() {
    super();
    
    if (DeepgramStreamingService.instance) {
      return DeepgramStreamingService.instance;
    }

    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error('DEEPGRAM_API_KEY environment variable is required');
    }
    
    this.deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    this.activeStreams = new Map();
    
    DeepgramStreamingService.instance = this;
  }

  /**
   * Creates a new streaming session for real-time transcription
   * @param {string} sessionId - Unique identifier for the session
   * @param {Object} options - Configuration options
   * @returns {Object} - Session control object
   */
  createStreamingSession(sessionId, options = {}) {
    try {
      console.log(`🎯 DeepgramStreamingService: Creating session ${sessionId}`);

      // Create live transcription connection
      const deepgramLive = this.deepgram.listen.live({
        model: 'nova-3',
        language: 'en-IN',
        smart_format: true,
        interim_results: true,
        encoding: 'mulaw',
        sample_rate: 8000,
        channels: 1,
        ...options
      });

      // Track words and timestamps for better deduplication
      const sessionData = {
        sessionId,
        stream: deepgramLive,
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        processedWords: new Map(), // Track words by their start time
        lastTranscript: '',
        isActive: true
      };

      // Handle transcription results
      deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
        const { is_final, channel } = data;

        if (channel?.alternatives?.[0]) {
          const transcript = channel.alternatives[0].transcript;
          const words = channel.alternatives[0].words || [];
          
          if (!transcript || transcript.trim() === '') return;

          // Process words with timestamps for better tracking
          if (words && Array.isArray(words)) {
            this.processNewWords(sessionData, words, is_final);
          }

          // Emit transcription event
          this.emit('transcription', {
            sessionId,
            transcript,
            isFinal: is_final,
            words,
            confidence: channel.alternatives[0].confidence
          });
        }
      });

      // Handle connection open
      deepgramLive.on(LiveTranscriptionEvents.Open, () => {
        console.log(`🔗 DeepgramStreamingService: Session ${sessionId} opened`);
      });

      // Handle connection close
      deepgramLive.on(LiveTranscriptionEvents.Close, () => {
        console.log(`🔚 DeepgramStreamingService: Session ${sessionId} closed`);
        this.closeSession(sessionId);
      });

      // Handle errors
      deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
        console.error(`❌ DeepgramStreamingService: Error in session ${sessionId}:`, error);
        this.emit('error', { sessionId, error });
      });

      this.activeStreams.set(sessionId, sessionData);

      return {
        sessionId,
        stream: deepgramLive,
        send: (audioData) => this.sendAudio(sessionId, audioData),
        close: () => this.closeSession(sessionId),
        isActive: () => this.isSessionActive(sessionId)
      };
    } catch (error) {
      console.error(`❌ DeepgramStreamingService: Error creating session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Process new words from transcription
   * @param {Object} sessionData - Session data
   * @param {Array} words - Array of word objects with timestamps
   * @param {boolean} isFinal - Whether this is a final transcription
   */
  processNewWords(sessionData, words, isFinal) {
    for (const word of words) {
      const wordKey = `${word.start}_${word.word}`;
      
      // Skip if we've already processed this word in a final transcription
      if (sessionData.processedWords.has(wordKey) && sessionData.processedWords.get(wordKey).isFinal) {
        continue;
      }

      // Update or add the word to our tracking
      sessionData.processedWords.set(wordKey, {
        word: word.word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
        isFinal
      });
    }

    // Clean up old words (keep last 100)
    if (sessionData.processedWords.size > 100) {
      const oldestEntries = Array.from(sessionData.processedWords.entries())
        .sort(([, a], [, b]) => a.start - b.start)
        .slice(0, sessionData.processedWords.size - 100);
      
      for (const [key] of oldestEntries) {
        sessionData.processedWords.delete(key);
      }
    }
  }

  /**
   * Send audio data to the streaming session
   * @param {string} sessionId - Session identifier
   * @param {Buffer} audioData - Audio data buffer
   */
  sendAudio(sessionId, audioData) {
    const sessionData = this.activeStreams.get(sessionId);
    
    if (!sessionData || !sessionData.isActive) {
      console.warn(`⚠️ DeepgramStreamingService: Attempted to send audio to inactive session ${sessionId}`);
      return;
    }

    try {
      sessionData.stream.send(audioData);
      sessionData.lastActivityTime = Date.now();
    } catch (error) {
      console.error(`❌ DeepgramStreamingService: Error sending audio for session ${sessionId}:`, error);
      this.emit('error', { sessionId, error });
    }
  }

  /**
   * Close a streaming session
   * @param {string} sessionId - Session identifier
   */
  closeSession(sessionId) {
    const sessionData = this.activeStreams.get(sessionId);
    
    if (!sessionData) return;

    try {
      sessionData.isActive = false;
      sessionData.stream.finish();
      this.activeStreams.delete(sessionId);
      
      console.log(`👋 DeepgramStreamingService: Closed session ${sessionId}`);
      this.emit('sessionClosed', { sessionId });
    } catch (error) {
      console.error(`❌ DeepgramStreamingService: Error closing session ${sessionId}:`, error);
    }
  }

  /**
   * Check if a session is active
   * @param {string} sessionId - Session identifier
   * @returns {boolean} - Whether the session is active
   */
  isSessionActive(sessionId) {
    const sessionData = this.activeStreams.get(sessionId);
    return sessionData?.isActive || false;
  }

  /**
   * Clean up inactive sessions
   */
  cleanupInactiveSessions() {
    const now = Date.now();
    
    for (const [sessionId, sessionData] of this.activeStreams.entries()) {
      if (now - sessionData.lastActivityTime > 5 * 60 * 1000) { // 5 minutes
        console.log(`🧹 DeepgramStreamingService: Cleaning up inactive session ${sessionId}`);
        this.closeSession(sessionId);
      }
    }
  }
}

module.exports = DeepgramStreamingService; 