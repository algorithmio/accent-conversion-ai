const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { getDefaultConfig, mergeConfig, TTS_CONFIG } = require('../config/tts-config');

/**
 * StreamingTTSService - Implements Google Cloud's StreamingSynthesize RPC method
 * for smooth, continuous text-to-speech without robotic jumps between chunks
 */
class StreamingTTSService extends EventEmitter {
  constructor() {
    super();
    
    if (StreamingTTSService.instance) {
      return StreamingTTSService.instance;
    }
    
    this.initializeClient();
    this.activeStreams = new Map();
    
    StreamingTTSService.instance = this;
  }

  /**
   * Initialize Google Cloud TTS client
   */
  initializeClient() {
    try {
      const credentialsPath = path.join(__dirname, '../../config/creds.json');
      
      if (fs.existsSync(credentialsPath)) {
        console.log('✅ StreamingTTS: Using Google Cloud credentials from config/creds.json');
        this.ttsClient = new textToSpeech.TextToSpeechClient({ 
          keyFilename: credentialsPath 
        });
      } else {
        console.log('❌ StreamingTTS: No credentials file found at config/creds.json');
        throw new Error('Google Cloud credentials not found');
      }
    } catch (error) {
      console.error('❌ StreamingTTS: Error initializing client:', error.message);
      throw error;
    }
  }

  /**
   * Create a new streaming TTS session
   * @param {string} sessionId - Unique identifier for the session
   * @param {Object} options - Configuration options
   * @returns {Object} - Stream control object
   */
  createStreamingSession(sessionId, options = {}) {
    try {
      console.log(`🎵 StreamingTTS: Creating session ${sessionId}`);
      
      // Use centralized configuration with custom options merged
      const config = mergeConfig(options);
      
      console.log(`🎤 StreamingTTS: Using voice: ${config.voice.name} (${config.voice.languageCode})`);

      // Create the streaming synthesis call
      const streamingCall = this.ttsClient.streamingSynthesize();
      
      // Track audio chunks for this session
      const sessionData = {
        streamingCall,
        config,
        isConfigured: false,
        audioBuffer: [],
        totalAudioSize: 0,
        startTime: Date.now(),
        lastTextTime: Date.now(),
        lastKeepaliveTime: Date.now(),
        textQueue: [],
        isActive: true,
        keepaliveInterval: null,
        reconnectAttempts: 0,
        maxReconnectAttempts: TTS_CONFIG.streaming.maxReconnectAttempts
      };

      // Setup keepalive mechanism to prevent 5-second timeout
      this.setupKeepalive(sessionId, sessionData);

      // Handle streaming responses
      streamingCall.on('data', (response) => {
        this.handleStreamingResponse(sessionId, response, sessionData);
      });

      streamingCall.on('error', (error) => {
        console.error(`❌ StreamingTTS: Session ${sessionId} error:`, error.message);
        this.handleStreamError(sessionId, error, sessionData);
      });

      streamingCall.on('end', () => {
        console.log(`🔚 StreamingTTS: Session ${sessionId} ended`);
        this.cleanupSession(sessionId, sessionData);
      });

      // Store session
      this.activeStreams.set(sessionId, sessionData);

      // Send initial configuration
      this.sendInitialConfig(sessionId, config);

      return {
        sessionId,
        addText: (text) => this.addText(sessionId, text),
        close: () => this.closeSession(sessionId),
        isActive: () => this.activeStreams.has(sessionId)
      };

    } catch (error) {
      console.error(`❌ StreamingTTS: Error creating session ${sessionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Setup keepalive mechanism to prevent stream timeout
   * @param {string} sessionId - Session identifier
   * @param {Object} sessionData - Session data
   */
  setupKeepalive(sessionId, sessionData) {
    // Use configured keepalive interval and threshold
    const keepaliveInterval = TTS_CONFIG.streaming.keepaliveIntervalMs;
    const keepaliveThreshold = TTS_CONFIG.streaming.keepaliveThresholdMs;
    
    // Clear any existing keepalive interval
    if (sessionData.keepaliveInterval) {
      clearInterval(sessionData.keepaliveInterval);
      sessionData.keepaliveInterval = null;
    }
    
    sessionData.keepaliveInterval = setInterval(() => {
      if (!sessionData.isActive) {
        clearInterval(sessionData.keepaliveInterval);
        return;
      }

      const timeSinceLastText = Date.now() - sessionData.lastTextTime;
      const timeSinceLastKeepalive = Date.now() - sessionData.lastKeepaliveTime;

      // Only send keepalive if no text has been sent recently and no recent keepalive
      if (timeSinceLastText > keepaliveThreshold && timeSinceLastKeepalive > keepaliveThreshold) {
        try {
          console.log(`💓 StreamingTTS: Sending keepalive for session ${sessionId}`);
          
          // Send empty text to keep stream alive
          const keepaliveRequest = {
            input: {
              text: ' ' // Single space as minimal keepalive
            }
          };

          if (sessionData.streamingCall && sessionData.isConfigured) {
            sessionData.streamingCall.write(keepaliveRequest);
            sessionData.lastKeepaliveTime = Date.now();
          } else {
            // Stream not ready, attempt to recreate
            console.warn(`⚠️  StreamingTTS: Stream not ready for keepalive on session ${sessionId}, attempting recreation`);
            this.recreateStream(sessionId, sessionData);
          }
        } catch (error) {
          console.error(`❌ StreamingTTS: Keepalive error for session ${sessionId}:`, error.message);
          // Attempt to recreate stream on keepalive error
          this.handleStreamError(sessionId, error, sessionData);
        }
      }
    }, keepaliveInterval);

    // Store initial keepalive time
    sessionData.lastKeepaliveTime = Date.now();
  }

  /**
   * Handle stream errors with reconnection logic
   * @param {string} sessionId - Session identifier
   * @param {Error} error - The error that occurred
   * @param {Object} sessionData - Session data
   */
  handleStreamError(sessionId, error, sessionData) {
    // Check if it's a timeout/abort error that we can recover from
    const isRecoverableError = error.code === 10 || // ABORTED
                              error.code === 4 ||  // DEADLINE_EXCEEDED
                              error.message.includes('Stream aborted') ||
                              error.message.includes('timeout');

    if (isRecoverableError && sessionData.reconnectAttempts < sessionData.maxReconnectAttempts) {
      console.log(`🔄 StreamingTTS: Attempting to reconnect session ${sessionId} (attempt ${sessionData.reconnectAttempts + 1}/${sessionData.maxReconnectAttempts})`);
      
      sessionData.reconnectAttempts++;
      
      // Use configured backoff time with exponential backoff
      const backoffTime = TTS_CONFIG.streaming.reconnectBackoffMs * sessionData.reconnectAttempts;
      
      // Attempt to recreate the stream
      setTimeout(() => {
        this.recreateStream(sessionId, sessionData);
      }, backoffTime);
      
    } else {
      // Emit error for non-recoverable errors or max attempts reached
      this.emit('error', { sessionId, error });
      this.cleanupSession(sessionId, sessionData);
    }
  }

  /**
   * Recreate a streaming session after an error
   * @param {string} sessionId - Session identifier
   * @param {Object} sessionData - Session data
   */
  recreateStream(sessionId, sessionData) {
    try {
      if (!sessionData.isActive) {
        return;
      }

      console.log(`🔄 StreamingTTS: Recreating stream for session ${sessionId}`);

      // Create new streaming call
      const newStreamingCall = this.ttsClient.streamingSynthesize();
      
      // Update session data
      sessionData.streamingCall = newStreamingCall;
      sessionData.isConfigured = false;
      sessionData.lastTextTime = Date.now();
      sessionData.lastKeepaliveTime = Date.now();

      // Setup event handlers
      newStreamingCall.on('data', (response) => {
        this.handleStreamingResponse(sessionId, response, sessionData);
      });

      newStreamingCall.on('error', (error) => {
        console.error(`❌ StreamingTTS: Recreated session ${sessionId} error:`, error.message);
        this.handleStreamError(sessionId, error, sessionData);
      });

      newStreamingCall.on('end', () => {
        console.log(`🔚 StreamingTTS: Recreated session ${sessionId} ended`);
        this.cleanupSession(sessionId, sessionData);
      });

      // Send initial configuration
      this.sendInitialConfig(sessionId, sessionData.config);

      console.log(`✅ StreamingTTS: Successfully recreated stream for session ${sessionId}`);

    } catch (error) {
      console.error(`❌ StreamingTTS: Error recreating stream for session ${sessionId}:`, error.message);
      this.emit('error', { sessionId, error });
      this.cleanupSession(sessionId, sessionData);
    }
  }

  /**
   * Send initial configuration to start the streaming session
   * @param {string} sessionId - Session identifier
   * @param {Object} config - TTS configuration
   */
  sendInitialConfig(sessionId, config) {
    const sessionData = this.activeStreams.get(sessionId);
    if (!sessionData || sessionData.isConfigured) return;

    try {
      const initialRequest = {
        streamingConfig: {
          voice: config.voice,
          streamingAudioConfig: config.streamingAudioConfig
        }
      };

      console.log(`⚙️  StreamingTTS: Sending config for session ${sessionId}`);
      sessionData.streamingCall.write(initialRequest);
      sessionData.isConfigured = true;

    } catch (error) {
      console.error(`❌ StreamingTTS: Error sending config for ${sessionId}:`, error.message);
      this.handleStreamError(sessionId, error, sessionData);
    }
  }

  /**
   * Add text to be synthesized in the streaming session
   * @param {string} sessionId - Session identifier
   * @param {string} text - Text to synthesize
   */
  addText(sessionId, text) {
    const sessionData = this.activeStreams.get(sessionId);
    if (!sessionData || !sessionData.isActive) {
      console.warn(`⚠️  StreamingTTS: Session ${sessionId} not active, ignoring text: "${text}"`);
      return;
    }

    if (!text || !text.trim()) {
      console.warn(`⚠️  StreamingTTS: Empty text for session ${sessionId}`);
      return;
    }

    try {
      // Optimize text for better prosody
      const optimizedText = this.optimizeTextForStreaming(text);
      
      console.log(`📝 StreamingTTS: Adding text to session ${sessionId}: "${optimizedText}"`);
      
      const textRequest = {
        input: {
          text: optimizedText
        }
      };

      // Send text immediately for real-time streaming
      if (sessionData.streamingCall && sessionData.isConfigured) {
        sessionData.streamingCall.write(textRequest);
        sessionData.lastTextTime = Date.now();
        sessionData.textQueue.push({
          text: optimizedText,
          timestamp: Date.now()
        });

        // Reset reconnect attempts on successful text send
        sessionData.reconnectAttempts = 0;

        // Emit text added event
        this.emit('textAdded', { sessionId, text: optimizedText });
      } else {
        console.warn(`⚠️  StreamingTTS: Stream not ready for session ${sessionId}, queuing text`);
        // Could implement a queue here for texts sent before stream is ready
      }

    } catch (error) {
      console.error(`❌ StreamingTTS: Error adding text to ${sessionId}:`, error.message);
      this.handleStreamError(sessionId, error, sessionData);
    }
  }

  /**
   * Handle streaming audio responses
   * @param {string} sessionId - Session identifier
   * @param {Object} response - Streaming response from Google TTS
   * @param {Object} sessionData - Session data
   */
  handleStreamingResponse(sessionId, response, sessionData) {
    try {
      if (response.audioContent && response.audioContent.length > 0) {
        const audioChunk = response.audioContent;
        const chunkSize = audioChunk.length;
        
        // Track audio metrics
        sessionData.audioBuffer.push(audioChunk);
        sessionData.totalAudioSize += chunkSize;
        
        const latency = Date.now() - sessionData.lastTextTime;
        
        console.log(`🎵 StreamingTTS: Session ${sessionId} audio chunk: ${chunkSize} bytes, latency: ${latency}ms`);
        
        // Emit audio chunk immediately for real-time playback
        this.emit('audioChunk', {
          sessionId,
          audioContent: audioChunk,
          chunkSize,
          totalSize: sessionData.totalAudioSize,
          latency
        });
      }
    } catch (error) {
      console.error(`❌ StreamingTTS: Error handling response for ${sessionId}:`, error.message);
      this.handleStreamError(sessionId, error, sessionData);
    }
  }

  /**
   * Optimize text for better streaming prosody
   * @param {string} text - Original text
   * @returns {string} - Optimized text
   */
  optimizeTextForStreaming(text) {
    // Ensure text ends with proper punctuation for better prosody
    let optimized = text.trim();
    
    // Add period if text doesn't end with punctuation
    if (!/[.!?]$/.test(optimized)) {
      // Check if it's a complete sentence or phrase
      if (optimized.split(' ').length >= 3) {
        optimized += '.';
      }
    }
    
    // Add slight pause for better chunking (SSML-like)
    if (optimized.length > 20) {
      optimized = optimized.replace(/([.!?])\s+/g, '$1 ');
    }
    
    return optimized;
  }

  /**
   * Clean up session resources
   * @param {string} sessionId - Session identifier
   * @param {Object} sessionData - Session data
   */
  cleanupSession(sessionId, sessionData) {
    try {
      // Clear keepalive interval
      if (sessionData.keepaliveInterval) {
        clearInterval(sessionData.keepaliveInterval);
        sessionData.keepaliveInterval = null;
      }

      // Mark as inactive
      sessionData.isActive = false;

      // Emit session end event
      this.emit('sessionEnd', { sessionId });
      
      // Remove from active streams
      this.activeStreams.delete(sessionId);

    } catch (error) {
      console.error(`❌ StreamingTTS: Error cleaning up session ${sessionId}:`, error.message);
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
      console.log(`🔚 StreamingTTS: Closing session ${sessionId}`);
      
      sessionData.isActive = false;
      
      // End the streaming call gracefully
      if (sessionData.streamingCall) {
        sessionData.streamingCall.end();
      }
      
      // Calculate session metrics
      const duration = Date.now() - sessionData.startTime;
      const textCount = sessionData.textQueue.length;
      const avgLatency = textCount > 0 ? duration / textCount : 0;
      
      console.log(`📊 StreamingTTS: Session ${sessionId} metrics:`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Text chunks: ${textCount}`);
      console.log(`   Total audio: ${sessionData.totalAudioSize} bytes`);
      console.log(`   Avg latency: ${avgLatency.toFixed(1)}ms`);
      console.log(`   Reconnect attempts: ${sessionData.reconnectAttempts}`);
      
      // Emit session closed event
      this.emit('sessionClosed', {
        sessionId,
        metrics: {
          duration,
          textCount,
          totalAudioSize: sessionData.totalAudioSize,
          avgLatency,
          reconnectAttempts: sessionData.reconnectAttempts
        }
      });
      
      // Clean up resources
      this.cleanupSession(sessionId, sessionData);
      
    } catch (error) {
      console.error(`❌ StreamingTTS: Error closing session ${sessionId}:`, error.message);
    }
  }

  /**
   * Get active session count
   * @returns {number} - Number of active sessions
   */
  getActiveSessionCount() {
    return this.activeStreams.size;
  }

  /**
   * Get session metrics
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} - Session metrics or null if not found
   */
  getSessionMetrics(sessionId) {
    const sessionData = this.activeStreams.get(sessionId);
    if (!sessionData) return null;

    return {
      sessionId,
      isActive: sessionData.isActive,
      duration: Date.now() - sessionData.startTime,
      textCount: sessionData.textQueue.length,
      totalAudioSize: sessionData.totalAudioSize,
      lastTextTime: sessionData.lastTextTime
    };
  }

  /**
   * Close all active sessions
   */
  closeAllSessions() {
    console.log(`🔚 StreamingTTS: Closing all ${this.activeStreams.size} sessions`);
    
    for (const sessionId of this.activeStreams.keys()) {
      this.closeSession(sessionId);
    }
  }
}

module.exports = StreamingTTSService; 