const StreamingTTSService = require('./StreamingTTSService');
const { EventEmitter } = require('events');
const { TTS_CONFIG } = require('../config/tts-config');

/**
 * StreamingAccentConverterV2 - Enhanced streaming accent converter
 * Integrates StreamingTTSService with Twilio WebSocket for smooth accent conversion
 */
class StreamingAccentConverterV2 extends EventEmitter {
  constructor() {
    super();
    
    if (StreamingAccentConverterV2.instance) {
      return StreamingAccentConverterV2.instance;
    }
    
    this.streamingTTS = new StreamingTTSService();
    this.activeSessions = new Map();
    this.setupEventHandlers();
    
    StreamingAccentConverterV2.instance = this;
  }

  /**
   * Setup event handlers for the streaming TTS service
   */
  setupEventHandlers() {
    // Handle audio chunks from streaming TTS
    this.streamingTTS.on('audioChunk', (data) => {
      this.handleAudioChunk(data);
    });

    // Handle errors
    this.streamingTTS.on('error', (data) => {
      console.error(`❌ StreamingAccentConverter: TTS error for session ${data.sessionId}:`, data.error.message);
      this.handleTTSError(data);
    });

    // Handle session events
    this.streamingTTS.on('sessionClosed', (data) => {
      console.log(`🔚 StreamingAccentConverter: Session ${data.sessionId} closed`);
      this.activeSessions.delete(data.sessionId);
      this.emit('sessionClosed', data);
    });

    this.streamingTTS.on('textAdded', (data) => {
      console.log(`📝 StreamingAccentConverter: Text added to session ${data.sessionId}`);
      this.emit('textAdded', data);
    });

    // Handle session end events
    this.streamingTTS.on('sessionEnd', (data) => {
      console.log(`🔚 StreamingAccentConverter: TTS session ended for ${data.sessionId}`);
      // Session will be cleaned up automatically
    });
  }

  /**
   * Handle TTS errors gracefully
   * @param {Object} errorData - Error data from TTS service
   */
  handleTTSError(errorData) {
    const { sessionId, error } = errorData;
    const sessionData = this.activeSessions.get(sessionId);
    
    if (!sessionData) {
      console.warn(`⚠️  StreamingAccentConverter: Received error for unknown session ${sessionId}`);
      return;
    }

    // Check if it's a recoverable error (timeout/abort)
    const isRecoverableError = error.code === 10 || // ABORTED
                              error.code === 4 ||  // DEADLINE_EXCEEDED
                              error.message.includes('Stream aborted') ||
                              error.message.includes('timeout');

    if (isRecoverableError) {
      console.log(`🔄 StreamingAccentConverter: Recoverable error for session ${sessionId}, TTS service will handle reconnection`);
      // The StreamingTTSService will handle reconnection automatically
      // We just need to keep the session data intact
    } else {
      console.error(`❌ StreamingAccentConverter: Non-recoverable error for session ${sessionId}, closing session`);
      this.closeSession(sessionId);
    }

    // Emit error event for monitoring (but don't let it crash the app)
    try {
      this.emit('error', errorData);
    } catch (emitError) {
      console.error(`❌ StreamingAccentConverter: Error emitting error event:`, emitError.message);
    }
  }

  /**
   * Create a new streaming accent conversion session
   * @param {string} callSid - Twilio call SID
   * @param {string} streamSid - Twilio stream SID
   * @param {Object} ws - WebSocket connection
   * @param {Object} options - Configuration options
   * @returns {Object} - Session control object
   */
  createSession(callSid, streamSid, ws, options = {}) {
    try {
      console.log(`🎯 StreamingAccentConverter: Creating session for call ${callSid}`);
      
      // Create streaming TTS session with minimal config override
      // Let StreamingTTSService handle the default voice configuration
      const ttsSession = this.streamingTTS.createStreamingSession(callSid, {
        // Only override specific settings if needed, let defaults handle voice config
        streamingAudioConfig: {
          audioEncoding: 'MULAW',
          sampleRateHertz: 8000,
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 2.0
        },
        ...options // Allow custom options to override defaults
      });

      // Track session data
      const sessionData = {
        callSid,
        streamSid,
        ws,
        ttsSession,
        startTime: Date.now(),
        audioChunkCount: 0,
        totalAudioSent: 0,
        lastActivityTime: Date.now(),
        textBuffer: [],
        isActive: true
      };

      this.activeSessions.set(callSid, sessionData);

      // Return session control interface
      return {
        callSid,
        streamSid,
        addText: (text) => this.addTextToSession(callSid, text),
        close: () => this.closeSession(callSid),
        isActive: () => this.activeSessions.has(callSid),
        getMetrics: () => this.getSessionMetrics(callSid)
      };

    } catch (error) {
      console.error(`❌ StreamingAccentConverter: Error creating session for ${callSid}:`, error.message);
      throw error;
    }
  }

  /**
   * Add text to be converted in a streaming session
   * @param {string} callSid - Call SID
   * @param {string} text - Text to convert
   */
  addTextToSession(callSid, text) {
    const sessionData = this.activeSessions.get(callSid);
    if (!sessionData || !sessionData.isActive) {
      console.warn(`⚠️  StreamingAccentConverter: Session ${callSid} not active, ignoring text: "${text}"`);
      return;
    }

    try {
      // Validate text
      if (!text || !text.trim()) {
        console.warn(`⚠️  StreamingAccentConverter: Empty text for session ${callSid}`);
        return;
      }

      const cleanText = text.trim();
      console.log(`📝 StreamingAccentConverter: Adding text to session ${callSid}: "${cleanText}"`);

      // Add to text buffer for tracking
      sessionData.textBuffer.push({
        text: cleanText,
        timestamp: Date.now()
      });

      // Keep buffer size manageable
      if (sessionData.textBuffer.length > 50) {
        sessionData.textBuffer = sessionData.textBuffer.slice(-25);
      }

      // Send to streaming TTS
      sessionData.ttsSession.addText(cleanText);
      sessionData.lastActivityTime = Date.now();

    } catch (error) {
      console.error(`❌ StreamingAccentConverter: Error adding text to session ${callSid}:`, error.message);
      this.emit('error', { sessionId: callSid, error });
    }
  }

  /**
   * Handle audio chunks from streaming TTS
   * @param {Object} data - Audio chunk data
   */
  handleAudioChunk(data) {
    const { sessionId, audioContent, chunkSize, latency } = data;
    const sessionData = this.activeSessions.get(sessionId);
    
    if (!sessionData || !sessionData.isActive) {
      console.warn(`⚠️  StreamingAccentConverter: Received audio for inactive session ${sessionId}`);
      return;
    }

    try {
      // Check if WebSocket is still open
      if (sessionData.ws.readyState !== sessionData.ws.OPEN) {
        console.warn(`⚠️  StreamingAccentConverter: WebSocket closed for session ${sessionId}`);
        this.closeSession(sessionId);
        return;
      }

      // Convert audio to base64 for Twilio
      const audioBase64 = audioContent.toString('base64');
      
      // Create Twilio media message
      const mediaMessage = {
        event: 'media',
        streamSid: sessionData.streamSid,
        media: {
          payload: audioBase64
        }
      };

      // Send audio via WebSocket
      sessionData.ws.send(JSON.stringify(mediaMessage));
      
      // Update session metrics
      sessionData.audioChunkCount++;
      sessionData.totalAudioSent += chunkSize;
      sessionData.lastActivityTime = Date.now();

      console.log(`🎵 StreamingAccentConverter: Sent audio chunk ${sessionData.audioChunkCount} for session ${sessionId}: ${chunkSize} bytes, latency: ${latency}ms`);

      // Emit audio sent event
      this.emit('audioSent', {
        sessionId,
        chunkNumber: sessionData.audioChunkCount,
        chunkSize,
        totalAudioSent: sessionData.totalAudioSent,
        latency
      });

    } catch (error) {
      console.error(`❌ StreamingAccentConverter: Error sending audio for session ${sessionId}:`, error.message);
      this.emit('error', { sessionId, error });
    }
  }

  /**
   * Close a streaming session
   * @param {string} callSid - Call SID
   */
  closeSession(callSid) {
    const sessionData = this.activeSessions.get(callSid);
    if (!sessionData) {
      console.warn(`⚠️  StreamingAccentConverter: Session ${callSid} not found for closing`);
      return;
    }

    try {
      console.log(`🔚 StreamingAccentConverter: Closing session ${callSid}`);
      
      sessionData.isActive = false;
      
      // Close TTS session
      if (sessionData.ttsSession) {
        sessionData.ttsSession.close();
      }

      // Calculate session metrics
      const duration = Date.now() - sessionData.startTime;
      const textCount = sessionData.textBuffer.length;
      
      console.log(`📊 StreamingAccentConverter: Session ${callSid} final metrics:`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Text chunks processed: ${textCount}`);
      console.log(`   Audio chunks sent: ${sessionData.audioChunkCount}`);
      console.log(`   Total audio sent: ${sessionData.totalAudioSent} bytes`);
      
      // Emit session closed event
      this.emit('sessionClosed', {
        callSid,
        metrics: {
          duration,
          textCount,
          audioChunkCount: sessionData.audioChunkCount,
          totalAudioSent: sessionData.totalAudioSent
        }
      });

      // Remove from active sessions
      this.activeSessions.delete(callSid);

    } catch (error) {
      console.error(`❌ StreamingAccentConverter: Error closing session ${callSid}:`, error.message);
    }
  }

  /**
   * Get session metrics
   * @param {string} callSid - Call SID
   * @returns {Object|null} - Session metrics or null if not found
   */
  getSessionMetrics(callSid) {
    const sessionData = this.activeSessions.get(callSid);
    if (!sessionData) return null;

    const duration = Date.now() - sessionData.startTime;
    const timeSinceLastActivity = Date.now() - sessionData.lastActivityTime;

    return {
      callSid,
      streamSid: sessionData.streamSid,
      isActive: sessionData.isActive,
      duration,
      timeSinceLastActivity,
      textCount: sessionData.textBuffer.length,
      audioChunkCount: sessionData.audioChunkCount,
      totalAudioSent: sessionData.totalAudioSent,
      avgAudioChunkSize: sessionData.audioChunkCount > 0 ? 
        Math.round(sessionData.totalAudioSent / sessionData.audioChunkCount) : 0
    };
  }

  /**
   * Get all active sessions
   * @returns {Array} - Array of session metrics
   */
  getAllActiveSessions() {
    const sessions = [];
    for (const callSid of this.activeSessions.keys()) {
      const metrics = this.getSessionMetrics(callSid);
      if (metrics) {
        sessions.push(metrics);
      }
    }
    return sessions;
  }

  /**
   * Close all active sessions
   */
  closeAllSessions() {
    console.log(`🔚 StreamingAccentConverter: Closing all ${this.activeSessions.size} sessions`);
    
    for (const callSid of this.activeSessions.keys()) {
      this.closeSession(callSid);
    }
  }

  /**
   * Get service health status
   * @returns {Object} - Health status
   */
  getHealthStatus() {
    const activeSessionCount = this.activeSessions.size;
    const ttsActiveSessionCount = this.streamingTTS.getActiveSessionCount();
    
    return {
      status: 'healthy',
      activeSessionCount,
      ttsActiveSessionCount,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }

  /**
   * Cleanup inactive sessions (call periodically)
   * @param {number} maxInactiveTime - Max inactive time in milliseconds (default from config)
   */
  cleanupInactiveSessions(maxInactiveTime = TTS_CONFIG.streaming.maxInactiveTimeMs) {
    const now = Date.now();
    const sessionsToClose = [];

    for (const [callSid, sessionData] of this.activeSessions.entries()) {
      const timeSinceLastActivity = now - sessionData.lastActivityTime;
      
      if (timeSinceLastActivity > maxInactiveTime) {
        console.log(`🧹 StreamingAccentConverter: Session ${callSid} inactive for ${timeSinceLastActivity}ms, closing`);
        sessionsToClose.push(callSid);
      }
    }

    for (const callSid of sessionsToClose) {
      this.closeSession(callSid);
    }

    if (sessionsToClose.length > 0) {
      console.log(`🧹 StreamingAccentConverter: Cleaned up ${sessionsToClose.length} inactive sessions`);
    }
  }
}

module.exports = StreamingAccentConverterV2; 